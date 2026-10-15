#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { analyze } from '../lib/analyze.mjs';
import { run, postItem, schedule } from '../lib/autopilot.mjs';
import { lintCaption } from '../lib/caption.mjs';
import { HOME, PATHS, ensureHome, loadConfig, saveConfig, setPath } from '../lib/config.mjs';
import { getCred, setCred } from '../lib/creds.mjs';
import { publishingQuota, refreshIfDue, whoami } from '../lib/instagram.mjs';
import { buildPlaybook, effectiveRules, learn, loadPlaybook, outcomes, syncInsights } from '../lib/learn.mjs';
import { addItem, findItem, loadQueue, mediaPath, readLedger, writeItem } from '../lib/queue.mjs';
import { chooseSlots, parseWhen } from '../lib/timing.mjs';
import { tweak } from '../lib/tweak.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => rest.includes(n);
const opt = (n) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined);
const VALUE_OPTS = new Set(['--caption-file', '--caption', '--hook', '--id', '--at', '--every']);
const positional = rest.filter((a, i) => !a.startsWith('--') && !VALUE_OPTS.has(rest[i - 1]));
const json = (o) => console.log(JSON.stringify(o, null, 2));

async function ask(q, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => rl.output.write(s.startsWith(q) ? s : '');
  try {
    return (await rl.question(q)).trim();
  } finally {
    if (hidden) rl.output.write('\n');
    rl.close();
  }
}

/** A file path or a queue id → the media file. */
function resolveMedia(arg) {
  if (!arg) throw new Error('give a video file or a queue id');
  if (existsSync(arg)) return resolve(arg);
  return mediaPath(findItem(arg).meta.media);
}

const commands = {
  async setup() {
    ensureHome();
    const token = flag('--new') || !getCred('access-token') ? await ask('Instagram access token (Meta app dashboard → Instagram → Generate token), hidden: ', true) : getCred('access-token');
    const me = await whoami(token);
    setCred('access-token', token);
    setCred('user-id', me.user_id);
    if (!getCred('token-refreshed')) setCred('token-refreshed', new Date().toISOString());
    console.log(`Connected @${me.username} (${me.account_type}, ${me.followers_count ?? '?'} followers).`);
    const config = loadConfig();
    if (config.hosting.provider === 'github-release' && !config.hosting.repo) {
      const repo = await ask('Public GitHub repo for media files, owner/name (blank to set later): ');
      if (repo) saveConfig({ hosting: { repo } });
      const user = repo ? await ask('gh login that can write to it (blank = active gh account): ') : '';
      if (user) saveConfig({ hosting: { gh_user: user } });
    }
    console.log(`Config: ${PATHS.config}\nTimezone: ${loadConfig().timezone}  (change: igap config set timezone Europe/London)`);
  },

  async status() {
    const config = loadConfig();
    const queue = loadQueue();
    const count = (s) => queue.filter((i) => i.meta.status === s).length;
    const pb = loadPlaybook();
    const last = getCred('token-refreshed');
    console.log(`home        ${HOME}`);
    console.log(`account     ${getCred('user-id') ? `connected (user ${getCred('user-id')})` : 'not connected — igap setup'}`);
    console.log(`token       ${last ? `refreshed ${Math.floor((Date.now() - Date.parse(last)) / 864e5)}d ago (auto weekly; dies after 60d unused)` : '-'}`);
    console.log(`approval    ${config.approval}   cap ${config.daily_cap}/day   gap ${config.min_gap_hours}h   tz ${config.timezone}`);
    console.log(`hosting     ${config.hosting.provider}${config.hosting.repo ? ` ${config.hosting.repo}` : ''}`);
    console.log(`queue       ${count('draft')} draft · ${count('approved')} approved · ${count('blocked')} blocked · ${count('posted')} posted`);
    console.log(`playbook    ${pb ? `${pb.confidence}, ${pb.n} settled posts, updated ${pb.updated.slice(0, 10)}` : 'none yet'}`);
    console.log(`slots       ${chooseSlots(pb, config).slots.join(', ')}  (${chooseSlots(pb, config).source})`);
    if (getCred('user-id') && flag('--live')) json(await publishingQuota());
  },

  config() {
    const [action, key, value] = positional;
    if (action === 'set') return setPath(key, value);
    json(loadConfig());
  },

  add() {
    const [media] = positional;
    if (!media || !existsSync(media)) throw new Error('usage: igap add <video-or-image> [--caption-file f] [--hook tag]');
    const caption = opt('--caption-file') ? readFileSync(opt('--caption-file'), 'utf8') : opt('--caption') ?? '';
    const item = addItem({ media, caption, hook: opt('--hook') ?? '', id: opt('--id') });
    console.log(`added ${item.meta.id} → ${item.file}`);
  },

  list() {
    for (const i of loadQueue()) {
      const when = i.meta.scheduled_at ? new Date(i.meta.scheduled_at).toLocaleString() : '';
      console.log(`${i.meta.status.padEnd(9)} ${i.meta.id.padEnd(40)} ${when.padEnd(22)} ${(i.meta.blocked_reason ?? i.caption.split('\n')[0]).slice(0, 60)}`);
    }
  },

  analyze() {
    const report = analyze(resolveMedia(positional[0]), effectiveRules(loadConfig()));
    if (flag('--json')) return json(report);
    const f = report.features;
    console.log(`${report.file}\n  ${report.probe.width}×${report.probe.height} ${report.probe.fps}fps ${report.probe.videoCodec}/${report.probe.audioCodec ?? 'no audio'} ${f.duration_s}s ${Math.round(report.probe.bytes / 1048576)}MB`);
    console.log(`  cuts ${f.cuts} (first ${f.first_cut_s}s, ${f.cuts_per_10s}/10s) · longest still ${f.longest_frozen_s}s · lead silence ${f.lead_silence_s ?? '-'}s · sound ${f.sound_coverage ?? '-'} · ${f.lufs ?? '-'} LUFS`);
    for (const [label, list] of [['ERROR', report.errors], ['FIX  ', report.fixable], ['WARN ', report.warnings]]) for (const m of list) console.log(`  ${label} ${m}`);
    if (!report.errors.length && !report.fixable.length && !report.warnings.length) console.log('  ok');
  },

  tweak() {
    const rules = effectiveRules(loadConfig());
    const report = analyze(resolveMedia(positional[0]), rules);
    const out = tweak(report, rules, { cap: flag('--cap'), force: flag('--force') });
    console.log(out.changes.length ? `${out.file}\n  ${out.changes.join('\n  ')}` : 'nothing to fix');
  },

  lint() {
    const item = findItem(positional[0]);
    const r = lintCaption(item.caption, loadConfig().caption);
    console.log(`feed shows: "${r.fold}"`);
    for (const m of r.errors) console.log(`  ERROR ${m}`);
    for (const m of r.warnings) console.log(`  WARN  ${m}`);
    if (!r.errors.length && !r.warnings.length) console.log('  ok');
    process.exitCode = r.errors.length ? 1 : 0;
  },

  approve() {
    const config = loadConfig();
    const item = findItem(positional[0]);
    if (!item.caption.trim()) throw new Error('caption is empty; write it first');
    const lint = lintCaption(item.caption, config.caption);
    if (lint.errors.length) throw new Error(`caption: ${lint.errors.join('; ')}`);
    const { when, source } = schedule(item, config, opt('--at') ? parseWhen(opt('--at'), config.timezone) : undefined);
    console.log(`approved ${item.meta.id} for ${when.toLocaleString()} (${source})`);
  },

  unapprove() {
    const item = findItem(positional[0]);
    Object.assign(item.meta, { status: 'draft', scheduled_at: '', blocked_reason: '', attempts: '' });
    writeItem(item);
    console.log(`${item.meta.id} back to draft`);
  },

  async post() {
    const item = findItem(positional[0]);
    if (item.meta.status !== 'approved') throw new Error(`${item.meta.id} is ${item.meta.status}; approve it first`);
    const res = await postItem(item, loadConfig(), { dryRun: flag('--dry-run') });
    json(res);
  },

  async run() {
    await run(loadConfig(), { dryRun: flag('--dry-run') });
  },

  async sync() {
    const r = await syncInsights({ settleHours: loadConfig().learn.settle_hours });
    console.log(`insights updated for ${r.updated} of ${r.total} posts`);
  },

  async learn() {
    const pb = flag('--offline') ? buildPlaybook(readLedger(), { minPosts: loadConfig().learn.min_posts }) : await learn(loadConfig());
    commands.report(pb);
  },

  report(pb = loadPlaybook()) {
    if (!pb) return console.log('no playbook yet: igap learn');
    console.log(`Playbook — ${pb.n} settled posts, confidence ${pb.confidence}, median views ${pb.median_views ?? '-'}`);
    for (const s of pb.signals) console.log(`  signal  ${s.reading} (rho ${s.rho})`);
    for (const [name, rows] of Object.entries(pb.buckets ?? {})) if (rows.length) console.log(`  ${name.padEnd(8)}${rows.map((r) => `${r.key} ×${r.median_multiple} (n${r.n})`).join(' · ')}`);
    if (Object.keys(pb.targets).length) console.log(`  applies ${JSON.stringify(pb.targets)}`);
    if (pb.slots.length) console.log(`  slots   ${pb.slots.join(', ')}`);
    for (const n of pb.notes) console.log(`  note    ${n}`);
    const posts = outcomes(readLedger().filter((e) => e.insights));
    for (const p of posts.slice(-10)) console.log(`  ${p.id.padEnd(36)} views ${p.insights.views ?? '-'} ×${p.multiple?.toFixed(2) ?? '-'} watched ${p.watch_through ?? '-'} ${p.permalink ?? ''}`);
  },

  async refresh() {
    await refreshIfDue({ force: true });
    console.log('token refreshed');
  },

  schedule() {
    const node = process.execPath;
    const bin = join(ROOT, 'cli', 'igap.mjs');
    const every = Number(opt('--every') ?? 15);
    if (process.platform === 'darwin') {
      const plist = join(homedir(), 'Library/LaunchAgents/com.instagram-autopilot.run.plist');
      mkdirSync(dirname(plist), { recursive: true });
      const tpl = readFileSync(join(ROOT, 'templates/launchd.plist'), 'utf8').replaceAll('{{NODE}}', node).replaceAll('{{BIN}}', bin).replaceAll('{{EVERY}}', String(every * 60)).replaceAll('{{HOME}}', HOME).replaceAll('{{PATH}}', process.env.PATH);
      if (!flag('--print')) {
        writeFileSync(plist, tpl);
        try {
          execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' });
        } catch {}
        execFileSync('launchctl', ['load', plist]);
        return console.log(`scheduled every ${every} min: ${plist}\nlogs: ${PATHS.log}\nstop: launchctl unload ${plist}`);
      }
      return console.log(tpl);
    }
    console.log(`# crontab -e, then add:\n*/${every} * * * * IGAP_HOME=${HOME} ${node} ${bin} run >> ${PATHS.log} 2>&1\n\n# or systemd: see ${join(ROOT, 'templates')}`);
  },
};

const help = `igap — Instagram autopilot

  setup                      connect the account (token from the Meta app dashboard)
  status [--live]            account, queue, playbook, slots
  add <file> [--caption-file f] [--hook tag]
  list                       queue
  analyze <file|id> [--json] specs, cuts, stills, silence, loudness
  tweak <file|id> [--cap]    fixed copy in ~/.instagram-autopilot/media/tweaked
  lint <id>                  caption check + what the feed shows
  approve <id> [--at "Tue 12:00" | "2026-10-20 18:30"]
  unapprove <id>
  post <id> [--dry-run]      post an approved item now
  run [--dry-run]            one scheduler tick (what the timer runs)
  sync | learn [--offline] | report
  schedule [--every 15] [--print]
  config [set <key> <value>]
  refresh                    force a token refresh`;

const fn = commands[cmd];
if (!fn) {
  console.log(help);
  process.exit(cmd ? 1 : 0);
}
Promise.resolve(fn()).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
