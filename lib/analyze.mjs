import { execFileSync, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

/** Reels limits from Meta's Content Publishing docs (checked 2026-10). Edit if Meta changes them. */
export const REELS_SPEC = {
  containers: ['mov', 'mp4', 'quicktime'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac'],
  minFps: 23,
  maxFps: 60,
  maxWidth: 1920,
  minDuration: 3,
  maxDuration: 900,
  maxBytes: 300 * 1024 * 1024,
  maxAudioHz: 48000,
};

const num = (v) => (v === undefined || v === null || v === 'N/A' ? undefined : Number(v));
const round = (v, d = 2) => (v === undefined || Number.isNaN(v) ? undefined : Math.round(v * 10 ** d) / 10 ** d);

export function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString();
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const rotation = Math.abs(num(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation) ?? num(v?.tags?.rotate) ?? 0);
  const [fw, fh] = rotation % 180 === 90 ? [v?.height, v?.width] : [v?.width, v?.height];
  const [n, d] = (v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return {
    duration: round(num(j.format.duration)),
    bytes: statSync(file).size,
    container: j.format.format_name,
    width: fw,
    height: fh,
    fps: d ? round(n / d) : undefined,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    audioHz: num(a?.sample_rate),
    hasAudio: Boolean(a),
  };
}

/** One ffmpeg pass over a downscaled copy: scene cuts, frozen and black stretches, silences, loudness. */
export function scan(file, hasAudio) {
  const vf = 'scale=320:-2,scdet=threshold=10,blackdetect=d=0.3:pix_th=0.1,freezedetect=n=0.003:d=1.5';
  const args = ['-hide_banner', '-nostats', '-i', file, '-vf', vf];
  if (hasAudio) args.push('-af', 'silencedetect=n=-35dB:d=0.4,ebur128');
  else args.push('-an');
  args.push('-f', 'null', '-');
  const log = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stderr;
  const all = (re) => [...log.matchAll(re)].map((m) => Number(m[1]));
  const pairs = (startRe, endRe) => {
    const starts = all(startRe);
    const ends = all(endRe);
    return starts.map((s, i) => [s, ends[i]]);
  };
  const summary = log.slice(log.lastIndexOf('Summary:'));
  return {
    cuts: [...new Set(all(/lavfi\.scd\.time:\s*([\d.]+)/g).map((t) => round(t)))],
    black: [...log.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]),
    frozen: pairs(/freeze_start:\s*([\d.]+)/g, /freeze_end:\s*([\d.]+)/g),
    silences: pairs(/silence_start:\s*(-?[\d.]+)/g, /silence_end:\s*([\d.]+)/g),
    lufs: hasAudio ? num(summary.match(/I:\s*(-?[\d.]+) LUFS/)?.[1]) : undefined,
  };
}

/** Timing features the learner correlates with performance. */
export function features(p, s) {
  const dur = p.duration ?? 0;
  const bounds = [0, ...s.cuts.filter((t) => t > 0.05 && t < dur - 0.05), dur];
  const shots = bounds.slice(1).map((t, i) => t - bounds[i]);
  const silences = s.silences.map(([a, b]) => [Math.max(0, a), b ?? dur]);
  const silent = silences.reduce((t, [a, b]) => t + (b - a), 0);
  const spansAll = ([a, b]) => a <= 0.05 && b >= dur - 0.05;
  const lead = silences.find((s) => s[0] <= 0.05 && !spansAll(s));
  const tail = silences.find((s) => s[1] >= dur - 0.05 && !spansAll(s));
  const frozen = s.frozen.map(([a, b]) => (b ?? dur) - a);
  const sorted = [...shots].sort((x, y) => x - y);
  return {
    duration_s: round(dur),
    aspect: p.width && p.height ? round(p.width / p.height, 3) : undefined,
    cuts: s.cuts.length,
    first_cut_s: round(bounds[1]),
    cuts_per_10s: dur ? round((s.cuts.length / dur) * 10) : 0,
    median_shot_s: round(sorted[Math.floor(sorted.length / 2)] ?? dur),
    longest_shot_s: round(Math.max(...shots, 0)),
    longest_frozen_s: round(Math.max(...frozen, 0)),
    lead_silence_s: p.hasAudio ? round(lead ? lead[1] : 0) : undefined,
    tail_silence_s: p.hasAudio ? round(tail ? dur - tail[0] : 0) : undefined,
    sound_coverage: p.hasAudio && dur ? round(1 - silent / dur) : undefined,
    lufs: round(s.lufs, 1),
    opens_black: s.black.some(([a]) => a < 0.1),
  };
}

/** Hard failures block posting; warnings are what `tweak` can fix or a human should look at. */
export function review(p, f, rules) {
  const errors = [];
  const warnings = [];
  const fixable = [];
  const container = p.container.split(',');
  if (!REELS_SPEC.containers.some((c) => container.includes(c))) errors.push(`container ${p.container} (needs MP4/MOV)`);
  if (!REELS_SPEC.videoCodecs.includes(p.videoCodec)) fixable.push(`video codec ${p.videoCodec} (needs H.264/HEVC)`);
  if (p.hasAudio && !REELS_SPEC.audioCodecs.includes(p.audioCodec)) fixable.push(`audio codec ${p.audioCodec} (needs AAC)`);
  if (p.audioHz > REELS_SPEC.maxAudioHz) fixable.push(`audio ${p.audioHz} Hz (max 48 kHz)`);
  if (p.fps < REELS_SPEC.minFps || p.fps > REELS_SPEC.maxFps) fixable.push(`${p.fps} fps (needs 23–60)`);
  if (p.width > REELS_SPEC.maxWidth) fixable.push(`${p.width}px wide (max 1920)`);
  if (p.bytes > REELS_SPEC.maxBytes) fixable.push(`${Math.round(p.bytes / 1048576)} MB (max 300)`);
  if (p.duration < REELS_SPEC.minDuration) errors.push(`${p.duration}s long (min 3s)`);
  if (p.duration > REELS_SPEC.maxDuration) errors.push(`${p.duration}s long (max 15 min)`);
  if (f.aspect && Math.abs(f.aspect - 9 / 16) > 0.02) fixable.push(`aspect ${f.aspect} (Reels fill the screen at 9:16)`);
  if (p.width && p.width < 1080) warnings.push(`${p.width}px wide; 1080 looks sharper`);
  if (f.lead_silence_s > rules.max_lead_silence_s) fixable.push(`${f.lead_silence_s}s of silence before anything is said`);
  if (f.opens_black) fixable.push('opens on a black frame');
  if (f.lufs !== undefined && Math.abs(f.lufs - rules.target_lufs) > 2) fixable.push(`loudness ${f.lufs} LUFS (target ${rules.target_lufs})`);
  if (f.duration_s > rules.target_max_s) warnings.push(`${f.duration_s}s; your target is ≤${rules.target_max_s}s (tweak --cap trims the end)`);
  if (f.longest_frozen_s > rules.max_shot_s) warnings.push(`the picture holds still for ${f.longest_frozen_s}s — static stretches are where viewers swipe away`);
  else if (f.cuts > 0 && f.longest_shot_s > rules.max_shot_s * 2) warnings.push(`longest shot runs ${f.longest_shot_s}s with no cut`);
  if (f.first_cut_s > 3 && f.cuts > 0) warnings.push(`first cut at ${f.first_cut_s}s; the hook window is the first 3s`);
  if (p.hasAudio && f.sound_coverage < 0.05) warnings.push('audio is near-silent the whole way through (below -35 dB)');
  if (f.tail_silence_s > 1) fixable.push(`${f.tail_silence_s}s of silence at the end`);
  return { errors, fixable, warnings };
}

export function analyze(file, rules) {
  const p = probe(file);
  if (!p.width) throw new Error(`${file} has no video stream`);
  const f = features(p, scan(file, p.hasAudio));
  return { file, probe: p, features: f, ...review(p, f, rules) };
}
