import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { PATHS, ensureHome } from './config.mjs';

/** Queue items are Markdown files: `key: value` frontmatter, then the caption. */
export function parseItem(file) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { file, meta, caption: m[2].trim() };
}

export function writeItem(item) {
  const head = Object.entries(item.meta)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  writeFileSync(item.file, `---\n${head}\n---\n${item.caption}\n`);
}

export function loadQueue() {
  if (!existsSync(PATHS.queue)) return [];
  return readdirSync(PATHS.queue)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseItem(join(PATHS.queue, f)))
    .filter(Boolean);
}

export function findItem(id) {
  const item = loadQueue().find((i) => i.meta.id === id);
  if (!item) throw new Error(`no queue item "${id}"`);
  return item;
}

export function mediaPath(p) {
  return isAbsolute(p) ? p : existsSync(resolve(p)) ? resolve(p) : join(PATHS.media, p);
}

/** Adds a draft for a video or image; the caption can be filled in later. */
export function addItem({ media, caption = '', hook = '', id }) {
  ensureHome();
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (id ?? media.split('/').pop().replace(/\.[^.]+$/, '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const itemId = id ?? `${stamp}--${slug}`;
  const file = join(PATHS.queue, `${itemId}.md`);
  if (existsSync(file)) throw new Error(`queue item ${itemId} already exists`);
  const item = { file, meta: { id: itemId, media: resolve(media), status: 'draft', hook }, caption };
  writeItem(item);
  return item;
}

export function readLedger() {
  if (!existsSync(PATHS.ledger)) return [];
  return readFileSync(PATHS.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function appendLedger(entry) {
  ensureHome();
  appendFileSync(PATHS.ledger, `${JSON.stringify(entry)}\n`);
}

export function writeLedger(entries) {
  writeFileSync(PATHS.ledger, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
}
