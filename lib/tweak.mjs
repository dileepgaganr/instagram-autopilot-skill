import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PATHS } from './config.mjs';

/**
 * Re-encodes a copy to Reels spec and fixes what analysis flagged: dead air or black at the start,
 * silence at the end, loudness, aspect (blurred fill, never a crop of the subject), fps and codecs.
 */
export function plan(report, rules, { cap = false } = {}) {
  const f = report.features;
  const p = report.probe;
  const changes = [];
  let start = 0;
  if (f.lead_silence_s > rules.max_lead_silence_s) {
    start = Math.max(0, f.lead_silence_s - 0.15);
    changes.push(`cut ${start.toFixed(2)}s of silence from the start`);
  }
  let end = f.duration_s;
  if (f.tail_silence_s > 1) {
    end = f.duration_s - f.tail_silence_s + 0.3;
    changes.push(`cut ${(f.duration_s - end).toFixed(2)}s of silence from the end`);
  }
  if (end - start < 3) {
    start = 0;
    end = f.duration_s;
    changes.splice(0, changes.length);
  }
  if (cap && end - start > rules.target_max_s) {
    end = start + rules.target_max_s;
    changes.push(`capped length at ${rules.target_max_s}s`);
  }
  const needsFrame = !f.aspect || Math.abs(f.aspect - 9 / 16) > 0.02 || p.width !== 1080;
  if (needsFrame) changes.push(Math.abs((f.aspect ?? 0) - 9 / 16) > 0.02 ? 'fit to 1080×1920 with a blurred fill' : 'scaled to 1080×1920');
  const fps = p.fps < 23 || p.fps > 60 ? 30 : undefined;
  if (fps) changes.push(`frame rate ${p.fps} → 30`);
  const loud = p.hasAudio && f.lufs !== undefined && Math.abs(f.lufs - rules.target_lufs) > 1;
  if (loud) changes.push(`loudness ${f.lufs} → ${rules.target_lufs} LUFS`);
  if (p.videoCodec !== 'h264' || (p.hasAudio && p.audioCodec !== 'aac')) changes.push('re-encoded to H.264/AAC');
  return { start, end, needsFrame, fps, loud, changes };
}

export function tweak(report, rules, opts = {}) {
  const pl = plan(report, rules, opts);
  if (!pl.changes.length && !opts.force) return { file: report.file, changes: [] };
  const outDir = join(PATHS.media, 'tweaked');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${basename(report.file).replace(/\.[^.]+$/, '')}.ig.mp4`);
  const tail = [pl.fps ? `fps=${pl.fps}` : null, 'format=yuv420p'].filter(Boolean).join(',');
  const filter = [
    pl.needsFrame
      ? `[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:5[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${tail}[v]`
      : `[0:v]${tail}[v]`,
  ];
  if (report.probe.hasAudio) filter.push(`[0:a]${pl.loud ? `loudnorm=I=${rules.target_lufs}:TP=-1.5:LRA=11,` : ''}aresample=48000[a]`);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(pl.start), '-to', String(pl.end), '-i', report.file, '-filter_complex', filter.join(';'), '-map', '[v]'];
  if (report.probe.hasAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-movflags', '+faststart', out);
  const run = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr.slice(-400)}`);
  return { file: out, changes: pl.changes };
}
