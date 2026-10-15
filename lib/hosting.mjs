import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** Instagram downloads media from a public URL, so local files are uploaded somewhere public first. */
export async function hostMedia(file, hosting) {
  const name = `${createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10)}-${basename(file).replace(/[^\w.-]+/g, '-')}`;
  if (hosting.provider === 'github-release') return githubRelease(file, name, hosting);
  if (hosting.provider === 'command') return customCommand(file, name, hosting.command);
  throw new Error(`hosting provider "${hosting.provider}" can't upload local files; give the item a media_url instead`);
}

function githubRelease(file, name, { repo, tag = 'media' }) {
  if (!repo) throw new Error('hosting.repo is not set — run: igap config set hosting.repo owner/name');
  const gh = (...args) => execFileSync('gh', args, { stdio: 'pipe' });
  try {
    gh('release', 'view', tag, '-R', repo);
  } catch {
    gh('release', 'create', tag, '-R', repo, '--title', 'Media', '--notes', 'Public media for scheduled Instagram posts.');
  }
  const dir = mkdtempSync(join(tmpdir(), 'igap-'));
  try {
    copyFileSync(file, join(dir, name));
    gh('release', 'upload', tag, join(dir, name), '-R', repo, '--clobber');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return `https://github.com/${repo}/releases/download/${tag}/${name}`;
}

/** Any uploader you like (rclone, aws s3, scp…): {file} and {name} are substituted; stdout's last line is the URL. */
function customCommand(file, name, template) {
  if (!template) throw new Error('hosting.command is not set');
  const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const out = execSync(template.replaceAll('{file}', quote(file)).replaceAll('{name}', quote(name)), { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
  const url = out.split('\n').pop().trim();
  if (!/^https:\/\//.test(url)) throw new Error(`hosting command did not print an https URL (got "${url.slice(0, 80)}")`);
  return url;
}

/** Follows redirects and confirms the file is publicly downloadable before Instagram tries. */
export async function verifyPublic(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) throw new Error(`media URL is not publicly reachable (${res.status}): ${url}`);
  return res.url || url;
}
