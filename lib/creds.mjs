import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, ensureHome } from './config.mjs';

const SERVICE = process.env.IGAP_KEYCHAIN_SERVICE ?? 'instagram-autopilot';
const FILE = join(HOME, 'credentials.json');
const useKeychain = process.platform === 'darwin' && process.env.IGAP_CREDENTIALS !== 'file';

function fileStore() {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
}

/** Values `igap setup` saved: the macOS Keychain, or a 0600 file elsewhere. */
export function getCred(name) {
  if (useKeychain) {
    try {
      return execFileSync('security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return undefined;
    }
  }
  return fileStore()[name];
}

export function requireCred(name) {
  const v = getCred(name);
  if (!v) throw new Error(`missing credential "${name}" — run: igap setup`);
  return v;
}

export function setCred(name, value) {
  if (useKeychain) {
    execFileSync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', name, '-w', String(value)], { stdio: 'ignore' });
    return;
  }
  ensureHome();
  writeFileSync(FILE, JSON.stringify({ ...fileStore(), [name]: String(value) }, null, 2));
  chmodSync(FILE, 0o600);
}
