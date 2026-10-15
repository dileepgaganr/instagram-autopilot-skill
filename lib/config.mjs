import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = process.env.IGAP_HOME ?? join(homedir(), '.instagram-autopilot');
export const PATHS = {
  config: join(HOME, 'config.json'),
  queue: join(HOME, 'queue'),
  media: join(HOME, 'media'),
  ledger: join(HOME, 'ledger.jsonl'),
  playbook: join(HOME, 'playbook.json'),
  log: join(HOME, 'autopilot.log'),
};

export const DEFAULTS = {
  approval: 'manual',
  daily_cap: 1,
  min_gap_hours: 6,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  auto_tweak: true,
  hosting: { provider: 'github-release', repo: '', gh_user: '', tag: 'media', command: '' },
  caption: { max_hashtags: 5, fold_chars: 125, require_phrases: [], banned_phrases: [] },
  video: { target_lufs: -14, max_lead_silence_s: 0.4, max_shot_s: 4, target_max_s: 90 },
  learn: { min_posts: 6, settle_hours: 48 },
  starter_slots: ['Tue 12:00', 'Wed 19:00', 'Thu 12:00', 'Sat 10:00'],
};

/** Creates the data folders on first use. */
export function ensureHome() {
  for (const dir of [HOME, PATHS.queue, PATHS.media]) mkdirSync(dir, { recursive: true });
}

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v;
  return out;
}

export function loadConfig() {
  const user = existsSync(PATHS.config) ? JSON.parse(readFileSync(PATHS.config, 'utf8')) : {};
  return merge(DEFAULTS, user);
}

export function saveConfig(patch) {
  ensureHome();
  const current = existsSync(PATHS.config) ? JSON.parse(readFileSync(PATHS.config, 'utf8')) : {};
  writeFileSync(PATHS.config, `${JSON.stringify(merge(current, patch), null, 2)}\n`);
}

/** Dotted-path setter used by `igap config set a.b value`. */
export function setPath(key, raw) {
  let value = raw;
  try {
    value = JSON.parse(raw);
  } catch {}
  const patch = {};
  const parts = key.split('.');
  parts.reduce((o, p, i) => (o[p] = i === parts.length - 1 ? value : {}), patch);
  saveConfig(patch);
}
