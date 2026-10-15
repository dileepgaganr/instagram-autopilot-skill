import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PATHS } from './config.mjs';
import { mediaInsights, onlineFollowers } from './instagram.mjs';
import { readLedger, writeLedger } from './queue.mjs';

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return undefined;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : undefined);
const HOURS = 36e5;

/** Pulls insights for posts that are still moving (younger than 7 days, or never settled). */
export async function syncInsights({ settleHours = 48, now = Date.now() } = {}) {
  const ledger = readLedger();
  let updated = 0;
  for (const e of ledger) {
    if (!e.media_id) continue;
    const age = (now - Date.parse(e.posted_at)) / HOURS;
    if (age < 1 || (e.settled && age > 7 * 24)) continue;
    try {
      e.insights = await mediaInsights(e.media_id, e.is_video);
      e.insights_at = new Date(now).toISOString();
      e.settled = age >= settleHours;
      updated += 1;
    } catch (err) {
      e.insights_error = err.message;
    }
  }
  if (updated) writeLedger(ledger);
  return { updated, total: ledger.length };
}

/** Per-post outcome numbers: views over the account median, watch-through, and shares+saves per reach. */
export function outcomes(posts) {
  const base = median(posts.map((p) => p.insights?.views ?? p.insights?.reach));
  return posts.map((p) => {
    const i = p.insights ?? {};
    const views = i.views ?? i.reach;
    const watch = i.ig_reels_avg_watch_time && p.features?.duration_s ? i.ig_reels_avg_watch_time / 1000 / p.features.duration_s : undefined;
    return { ...p, multiple: base ? views / base : undefined, watch_through: round(Math.min(watch ?? NaN, 1.5)), save_share_rate: i.reach ? round(((i.shares ?? 0) + (i.saved ?? 0)) / i.reach, 4) : undefined };
  });
}

function ranks(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = [];
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation; undefined below 4 pairs. */
export function spearman(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 4) return undefined;
  const rx = ranks(pairs.map((p) => p[0]));
  const ry = ranks(pairs.map((p) => p[1]));
  const mx = rx.reduce((a, b) => a + b) / rx.length;
  const my = ry.reduce((a, b) => a + b) / ry.length;
  const cov = rx.reduce((s, r, i) => s + (r - mx) * (ry[i] - my), 0);
  const sx = Math.sqrt(rx.reduce((s, r) => s + (r - mx) ** 2, 0));
  const sy = Math.sqrt(ry.reduce((s, r) => s + (r - my) ** 2, 0));
  return sx && sy ? cov / (sx * sy) : undefined;
}

const NUMERIC = ['duration_s', 'first_cut_s', 'cuts_per_10s', 'longest_frozen_s', 'lead_silence_s', 'lufs', 'caption_chars', 'first_line_chars', 'hashtags', 'hour'];
const durationBucket = (d) => (d <= 15 ? '≤15s' : d <= 30 ? '15–30s' : d <= 60 ? '30–60s' : d <= 90 ? '60–90s' : '>90s');
const BUCKET_MAX = { '≤15s': 15, '15–30s': 30, '30–60s': 60, '60–90s': 90 };

function bucketTable(posts, keyOf) {
  const groups = {};
  for (const p of posts) {
    const k = keyOf(p);
    if (k === undefined || k === '') continue;
    (groups[k] ??= []).push(p.multiple);
  }
  return Object.entries(groups)
    .map(([key, ms]) => ({ key, n: ms.length, median_multiple: round(median(ms)) }))
    .sort((a, b) => b.median_multiple - a.median_multiple);
}

/** Turns settled posts into a playbook: signals, buckets, and the targets autopilot applies. */
export function buildPlaybook(ledger, { minPosts = 6, online } = {}) {
  const settled = outcomes(ledger.filter((e) => e.settled && e.insights));
  const n = settled.length;
  const confidence = n < minPosts ? 'collecting' : n < 12 ? 'low' : n < 30 ? 'medium' : 'high';
  const playbook = { updated: new Date().toISOString(), n, confidence, median_views: median(settled.map((p) => p.insights.views ?? p.insights.reach)), signals: [], buckets: {}, targets: {}, slots: [], online_peaks: [], notes: [] };
  if (online) {
    const top = Object.entries(online).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => `${String(h).padStart(2, '0')}:00`);
    playbook.online_peaks = top;
    playbook.notes.push('online_peaks hours are as Instagram reports them; check they match your timezone before relying on them');
  }
  if (n < minPosts) {
    playbook.notes.push(`${n}/${minPosts} settled posts; keeping your configured defaults until there is enough data`);
    return playbook;
  }
  const flat = settled.map((p) => ({ ...p.features, ...p.caption_features, hour: p.hour, multiple: p.multiple, watch_through: p.watch_through }));
  for (const key of NUMERIC) {
    for (const outcome of ['multiple', 'watch_through']) {
      const rho = spearman(flat.map((f) => f[key]), flat.map((f) => f[outcome]));
      if (rho !== undefined && Math.abs(rho) >= 0.4) playbook.signals.push({ feature: key, outcome, rho: round(rho), reading: `${rho > 0 ? 'higher' : 'lower'} ${key} went with ${outcome === 'multiple' ? 'more views' : 'more of the video watched'}` });
    }
  }
  playbook.buckets.duration = bucketTable(settled, (p) => (p.features?.duration_s ? durationBucket(p.features.duration_s) : undefined));
  playbook.buckets.slot = bucketTable(settled, (p) => (p.weekday ? `${p.weekday} ${String(p.hour).padStart(2, '0')}:00` : undefined));
  playbook.buckets.hook = bucketTable(settled, (p) => p.hook);

  const bestDuration = playbook.buckets.duration.find((b) => b.n >= 2);
  if (bestDuration && bestDuration.median_multiple >= 1.2 && BUCKET_MAX[bestDuration.key]) playbook.targets.target_max_s = BUCKET_MAX[bestDuration.key];
  const frozen = playbook.signals.find((s) => s.feature === 'longest_frozen_s' && s.rho < 0);
  if (frozen) {
    const winners = settled.filter((p) => p.multiple >= 1).map((p) => p.features?.longest_frozen_s);
    const cap = median(winners);
    if (cap) playbook.targets.max_shot_s = Math.max(1.5, round(cap, 1));
  }
  const lead = playbook.signals.find((s) => s.feature === 'lead_silence_s' && s.rho < 0);
  if (lead) playbook.targets.max_lead_silence_s = 0.2;
  playbook.slots = playbook.buckets.slot.filter((b) => b.n >= 2 && b.median_multiple >= 1).slice(0, 3).map((b) => b.key);
  if (!playbook.signals.length) playbook.notes.push('no feature moved the numbers clearly yet (|rho| < 0.4); more posts, or try changing one thing at a time');
  playbook.notes.push('correlation on a small sample is a hint, not proof; the targets change only one setting per signal');
  return playbook;
}

export async function learn(config) {
  const playbook = buildPlaybook(readLedger(), { minPosts: config.learn.min_posts, online: await onlineFollowers() });
  writeFileSync(PATHS.playbook, `${JSON.stringify(playbook, null, 2)}\n`);
  return playbook;
}

export function loadPlaybook() {
  return existsSync(PATHS.playbook) ? JSON.parse(readFileSync(PATHS.playbook, 'utf8')) : undefined;
}

/** Your video rules with the learned targets laid over them, once the playbook has enough posts. */
export function effectiveRules(config, playbook = loadPlaybook()) {
  const learned = playbook && playbook.confidence !== 'collecting' ? playbook.targets : {};
  return { ...config.video, ...learned };
}
