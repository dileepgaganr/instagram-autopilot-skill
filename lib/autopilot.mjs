import { appendFileSync } from 'node:fs';
import { PATHS, ensureHome } from './config.mjs';
import { analyze } from './analyze.mjs';
import { lintCaption } from './caption.mjs';
import { hostMedia, verifyPublic } from './hosting.mjs';
import { publish, publishingQuota, refreshIfDue } from './instagram.mjs';
import { effectiveRules, learn, loadPlaybook, syncInsights } from './learn.mjs';
import { appendLedger, loadQueue, mediaPath, readLedger, writeItem } from './queue.mjs';
import { chooseSlots, hourOf, nextSlot, weekdayOf, zoned } from './timing.mjs';
import { tweak } from './tweak.mjs';

const isVideoFile = (p) => /\.(mp4|mov|m4v)$/i.test(p);

function log(line) {
  ensureHome();
  appendFileSync(PATHS.log, `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

const takenTimes = (queue, ledger) => [
  ...ledger.map((e) => new Date(e.posted_at)),
  ...queue.filter((i) => i.meta.status === 'approved' && i.meta.scheduled_at).map((i) => new Date(i.meta.scheduled_at)),
];

/** Approves an item and books it into the next free slot (or the time you give). */
export function schedule(item, config, at) {
  const queue = loadQueue().filter((i) => i.meta.id !== item.meta.id);
  const { slots, source } = chooseSlots(loadPlaybook(), config);
  const when = at ?? nextSlot({ slots, tz: config.timezone, dailyCap: config.daily_cap, minGapHours: config.min_gap_hours, taken: takenTimes(queue, readLedger()) });
  if (!when) throw new Error('no free slot in the next 14 days; raise daily_cap or add slots');
  item.meta.status = 'approved';
  item.meta.scheduled_at = when.toISOString();
  writeItem(item);
  return { when, source: at ? 'the time you gave' : source };
}

/** Checks, optionally fixes, uploads and publishes one item; records everything the learner needs. */
export async function postItem(item, config, { dryRun = false } = {}) {
  const rules = effectiveRules(config);
  const source = mediaPath(item.meta.media);
  const video = isVideoFile(source);
  let file = source;
  let report;
  let changes = [];
  if (video) {
    report = analyze(source, rules);
    if (report.errors.length) throw new Error(`video can't be posted: ${report.errors.join('; ')}`);
    if (report.fixable.length && config.auto_tweak) {
      const out = dryRun ? { file: source, changes: report.fixable.map((f) => `would fix: ${f}`) } : tweak(report, rules);
      file = out.file;
      changes = out.changes;
      if (!dryRun && changes.length) report = analyze(file, rules);
    }
  }
  const cap = lintCaption(item.caption, config.caption);
  if (cap.errors.length) throw new Error(`caption: ${cap.errors.join('; ')}`);
  if (dryRun) return { dryRun: true, file, changes, warnings: [...(report?.warnings ?? []), ...cap.warnings], fold: cap.fold };

  const url = await verifyPublic(item.meta.media_url ?? (await hostMedia(file, config.hosting)));
  const { mediaId, permalink } = await publish({ url, caption: cap.text, isVideo: video });
  const now = new Date();
  appendLedger({
    id: item.meta.id,
    media_id: mediaId,
    permalink,
    posted_at: now.toISOString(),
    weekday: weekdayOf(now, config.timezone),
    hour: hourOf(now, config.timezone),
    is_video: video,
    hook: item.meta.hook || undefined,
    tweaks: changes,
    features: report?.features,
    caption_features: cap.features,
    rules_used: rules,
  });
  item.meta.status = 'posted';
  item.meta.permalink = permalink;
  item.meta.posted_at = now.toISOString();
  writeItem(item);
  return { permalink, changes };
}

/** One scheduler tick: keep the token alive, learn from what's settled, post at most one due item. */
export async function run(config, { dryRun = false, now = new Date() } = {}) {
  try {
    if (!dryRun && (await refreshIfDue())) log('token refreshed');
  } catch (err) {
    log(`WARN ${err.message}`);
  }
  try {
    const { updated } = dryRun ? { updated: 0 } : await syncInsights({ settleHours: config.learn.settle_hours });
    if (updated) {
      const pb = await learn(config);
      log(`insights updated for ${updated} post(s); playbook ${pb.confidence} (${pb.n} settled)`);
    }
  } catch (err) {
    log(`WARN insights: ${err.message}`);
  }

  const ledger = readLedger();
  const today = zoned(now, config.timezone).dateKey;
  const postedToday = ledger.filter((e) => zoned(new Date(e.posted_at), config.timezone).dateKey === today).length;
  const last = ledger.map((e) => Date.parse(e.posted_at)).sort().at(-1);
  if (postedToday >= config.daily_cap) return log(`idle: daily cap ${config.daily_cap} reached`);
  if (last && now - last < config.min_gap_hours * 36e5) return log(`idle: last post under ${config.min_gap_hours}h ago`);

  const queue = loadQueue();
  if (config.approval === 'auto') {
    for (const item of queue.filter((i) => i.meta.status === 'draft' && i.caption.trim())) {
      const { when, source } = schedule(item, config);
      log(`auto-approved ${item.meta.id} for ${when.toISOString()} (${source})`);
    }
  }
  const due = loadQueue()
    .filter((i) => i.meta.status === 'approved' && i.meta.scheduled_at && Date.parse(i.meta.scheduled_at) <= now)
    .sort((a, b) => Date.parse(a.meta.scheduled_at) - Date.parse(b.meta.scheduled_at));
  if (!due.length) return log('idle: nothing due');

  const item = due[0];
  if (!dryRun) {
    const quota = await publishingQuota().catch(() => undefined);
    if (quota && quota.config?.quota_total && quota.quota_usage >= quota.config.quota_total) return log('idle: Instagram publishing quota used up for 24h');
  }
  try {
    const res = await postItem(item, config, { dryRun });
    log(dryRun ? `DRY ${item.meta.id}: ${res.changes.join('; ') || 'no tweaks'}${res.warnings.length ? ` | warnings: ${res.warnings.join('; ')}` : ''}` : `POSTED ${item.meta.id} → ${res.permalink}${res.changes.length ? ` (tweaks: ${res.changes.join('; ')})` : ''}`);
  } catch (err) {
    const content = /^(video can't|caption:)/.test(err.message);
    const attempts = Number(item.meta.attempts ?? 0) + 1;
    item.meta.attempts = attempts;
    if (content || attempts >= 3) {
      item.meta.status = 'blocked';
      item.meta.blocked_reason = err.message.replace(/\n/g, ' ').slice(0, 300);
    }
    if (!dryRun) writeItem(item);
    log(`${item.meta.status === 'blocked' ? 'BLOCKED' : `RETRY ${attempts}/3`} ${item.meta.id}: ${err.message}`);
  }
}
