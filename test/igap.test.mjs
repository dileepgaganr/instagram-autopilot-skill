import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const HOME = mkdtempSync(join(tmpdir(), 'igap-test-'));
const BIN = join(HOME, 'bin');
process.env.IGAP_HOME = HOME;
process.env.IGAP_STORAGE = 'file';
execFileSync('mkdir', ['-p', BIN]);
writeFileSync(join(BIN, 'gh'), '#!/bin/sh\necho "gh $*" >> "$IGAP_HOME/gh.log"\n');
chmodSync(join(BIN, 'gh'), 0o755);
process.env.PATH = `${BIN}:${process.env.PATH}`;

const { analyze } = await import('../lib/analyze.mjs');
const { tweak } = await import('../lib/tweak.mjs');
const { lintCaption } = await import('../lib/caption.mjs');
const { nextSlot, zoned } = await import('../lib/timing.mjs');
const { buildPlaybook, spearman } = await import('../lib/learn.mjs');
const { DEFAULTS, loadConfig, saveConfig } = await import('../lib/config.mjs');
const { setCred } = await import('../lib/creds.mjs');
const { addItem, findItem, readLedger } = await import('../lib/queue.mjs');
const { run, schedule } = await import('../lib/autopilot.mjs');
const { syncInsights, learn } = await import('../lib/learn.mjs');

/** 16:9, 1.5s of silence, a hard cut at 3s, a 5s frozen stretch, quiet audio — every common problem at once. */
const SAMPLE = join(HOME, 'sample.mp4');
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=3',
  '-f', 'lavfi', '-i', 'color=c=0x3366cc:size=1280x720:rate=30:duration=6',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo:d=1.5',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=7.5',
  '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v];[3:a]volume=0.3,aformat=channel_layouts=stereo[t];[2:a][t]concat=n=2:v=0:a=1[a]',
  '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', SAMPLE,
]);

test('analysis finds the cut, the still stretch, the dead air, the aspect and the loudness', () => {
  const r = analyze(SAMPLE, DEFAULTS.video);
  assert.equal(r.errors.length, 0);
  assert.ok(Math.abs(r.features.first_cut_s - 3) < 0.2, `first cut ${r.features.first_cut_s}`);
  assert.ok(r.features.longest_frozen_s > 4, `frozen ${r.features.longest_frozen_s}`);
  assert.ok(r.features.lead_silence_s >= 1.3, `lead ${r.features.lead_silence_s}`);
  assert.ok(r.fixable.some((m) => m.includes('aspect')));
  assert.ok(r.fixable.some((m) => m.includes('silence before')));
  assert.ok(r.fixable.some((m) => m.includes('LUFS')));
  assert.ok(r.warnings.some((m) => m.includes('holds still')));
});

test('tweak produces a 9:16, 1080×1920, -14 LUFS copy with the dead air gone', () => {
  const before = analyze(SAMPLE, DEFAULTS.video);
  const out = tweak(before, DEFAULTS.video);
  const after = analyze(out.file, DEFAULTS.video);
  assert.equal(after.probe.width, 1080);
  assert.equal(after.probe.height, 1920);
  assert.ok(after.features.lead_silence_s <= DEFAULTS.video.max_lead_silence_s, `lead ${after.features.lead_silence_s}`);
  assert.ok(Math.abs(after.features.lufs - -14) <= 1.5, `lufs ${after.features.lufs}`);
  assert.equal(after.fixable.length, 0, after.fixable.join('; '));
});

test('caption lint: fold, hashtag cap, invisible characters, required phrases', () => {
  const r = lintCaption(`Hey everyone​ this is a test #a #b #c #d #e #f`, { ...DEFAULTS.caption, require_phrases: ['AI voice'] });
  assert.ok(r.errors.some((m) => m.includes('6 hashtags')));
  assert.ok(r.errors.some((m) => m.includes('AI voice')));
  assert.ok(r.warnings.some((m) => m.includes('invisible')));
  assert.ok(r.warnings.some((m) => m.includes('greeting')));
  assert.ok(!r.text.includes('​'));
});

test('slots respect timezone, daily cap and minimum gap', () => {
  const tz = 'America/Chicago';
  const after = new Date('2026-10-19T12:00:00Z');
  const first = nextSlot({ slots: ['Tue 12:00', 'Tue 13:00', 'Wed 19:00'], tz, dailyCap: 1, minGapHours: 6, taken: [], after });
  assert.equal(zoned(first, tz).weekday, 'Tue');
  assert.equal(zoned(first, tz).hour, 12);
  const second = nextSlot({ slots: ['Tue 12:00', 'Tue 13:00', 'Wed 19:00'], tz, dailyCap: 1, minGapHours: 6, taken: [first], after });
  assert.equal(zoned(second, tz).weekday, 'Wed');
});

test('learning: spearman, buckets, and a frozen-stretch target from a synthetic history', () => {
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) - 1) < 1e-9);
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]) + 1) < 1e-9);
  const ledger = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    settled: true,
    hour: 12,
    weekday: i % 2 ? 'Tue' : 'Sat',
    features: { duration_s: i < 5 ? 20 : 70, longest_frozen_s: i < 5 ? 1 + i * 0.1 : 5 + i * 0.1, lead_silence_s: 0 },
    caption_features: { caption_chars: 100 },
    insights: { views: i < 5 ? 1000 + i * 10 : 200 + i * 10, reach: 900 },
  }));
  const pb = buildPlaybook(ledger, { minPosts: 6 });
  assert.equal(pb.confidence, 'low');
  assert.ok(pb.signals.some((s) => s.feature === 'longest_frozen_s' && s.rho < 0));
  assert.equal(pb.targets.target_max_s, 30);
  assert.ok(pb.targets.max_shot_s <= 1.5);
});

test('end to end: add → approve → run posts once, then sync + learn read it back', async () => {
  setCred('access-token', 'tok');
  setCred('user-id', '1784');
  setCred('token-refreshed', new Date().toISOString());
  saveConfig({ hosting: { provider: 'github-release', repo: 'someone/media' }, timezone: 'UTC' });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push(`${init.method ?? 'GET'} ${url.replace(/\?.*/, '')}`);
    const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (url.startsWith('https://github.com/')) return new Response(null, { status: 200 });
    if (url.includes('/content_publishing_limit')) return ok({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
    if (url.endsWith('/1784/media')) return ok({ id: 'C1' });
    if (url.includes('/C1?')) return ok({ status_code: 'FINISHED' });
    if (url.endsWith('/media_publish')) return ok({ id: 'M1' });
    if (url.includes('/M1?fields=permalink')) return ok({ permalink: 'https://www.instagram.com/reel/X/' });
    if (url.includes('/M1/insights')) return ok({ data: [{ name: 'views', values: [{ value: 1234 }] }, { name: 'reach', values: [{ value: 900 }] }, { name: 'ig_reels_avg_watch_time', values: [{ value: 4000 }] }] });
    if (url.includes('/1784/insights')) return ok({ data: [] });
    return new Response(JSON.stringify({ error: { message: `unmocked ${url}` } }), { status: 400 });
  };
  const item = addItem({ media: SAMPLE, caption: 'One still frame cost this video half its viewers. Here is the fix.', hook: 'the-reveal' });
  schedule(item, loadConfig(), new Date(Date.now() - 60_000));
  await run(loadConfig());
  const posted = findItem(item.meta.id);
  assert.equal(posted.meta.status, 'posted');
  assert.equal(posted.meta.permalink, 'https://www.instagram.com/reel/X/');
  assert.ok(calls.some((c) => c === 'POST https://graph.instagram.com/v25.0/1784/media'));
  const [entry] = readLedger();
  assert.ok(entry.tweaks.length > 0, 'posted the tweaked copy');
  assert.equal(entry.features.duration_s < 9, true);

  await run(loadConfig());
  assert.equal(calls.filter((c) => c.endsWith('/media_publish')).length, 1, 'daily cap holds');

  const r = await syncInsights({ settleHours: 0, now: Date.now() + 2 * 36e5 });
  assert.equal(r.updated, 1);
  assert.equal(readLedger()[0].insights.views, 1234);
  const pb = await learn(loadConfig());
  assert.equal(pb.n, 1);
  assert.equal(pb.confidence, 'collecting');
});
