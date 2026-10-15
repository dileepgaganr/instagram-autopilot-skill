import { getCred, requireCred, setCred } from './creds.mjs';

export const API = process.env.IGAP_GRAPH_URL ?? 'https://graph.instagram.com/v25.0';
const REFRESH_DAYS = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function call(path, params = {}, { method = 'GET', token } = {}) {
  const query = new URLSearchParams({ ...params, access_token: token ?? requireCred('access-token') });
  const res = method === 'GET' ? await fetch(`${API}${path}?${query}`) : await fetch(`${API}${path}`, { method, body: query });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error(`Instagram ${path} ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
    err.code = body.error?.code;
    throw err;
  }
  return body;
}

export async function whoami(token) {
  return call('/me', { fields: 'user_id,username,account_type,followers_count,media_count' }, { token });
}

/** Long-lived tokens last 60 days; a weekly refresh keeps them alive with no new login. */
export async function refreshIfDue({ force = false } = {}) {
  const last = Date.parse(getCred('token-refreshed') ?? 0) || 0;
  if (!force && Date.now() - last < REFRESH_DAYS * 864e5) return false;
  const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(requireCred('access-token'))}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`token refresh failed: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  setCred('access-token', body.access_token);
  setCred('token-refreshed', new Date().toISOString());
  return true;
}

export async function publishingQuota() {
  const user = requireCred('user-id');
  const { data } = await call(`/${user}/content_publishing_limit`, { fields: 'quota_usage,config' });
  return data?.[0];
}

/** Container → wait for FINISHED → media_publish → permalink. */
export async function publish({ url, caption, isVideo, shareToFeed = true, pollMs = 10_000, maxPolls = 30 }) {
  const user = requireCred('user-id');
  const params = isVideo ? { media_type: 'REELS', video_url: url, caption, share_to_feed: String(shareToFeed) } : { image_url: url, caption };
  const container = await call(`/${user}/media`, params, { method: 'POST' });
  for (let i = 0; ; i += 1) {
    const { status_code: status, status: detail } = await call(`/${container.id}`, { fields: 'status_code,status' });
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Instagram processing ${status}: ${detail ?? ''}`);
    if (i >= maxPolls) throw new Error(`still processing after ${Math.round((pollMs * maxPolls) / 60000)} min; nothing published`);
    await sleep(pollMs);
  }
  const media = await call(`/${user}/media_publish`, { creation_id: container.id }, { method: 'POST' });
  const { permalink } = await call(`/${media.id}`, { fields: 'permalink,timestamp' });
  return { mediaId: media.id, permalink };
}

const REEL_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'];
const IMAGE_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'];

/** Lifetime insights for one post; drops metrics the API rejects instead of failing the whole sync. */
export async function mediaInsights(mediaId, isVideo) {
  let metrics = isVideo ? REEL_METRICS : IMAGE_METRICS;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data } = await call(`/${mediaId}/insights`, { metric: metrics.join(',') });
      return Object.fromEntries((data ?? []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? null]));
    } catch (err) {
      const bad = metrics.find((m) => err.message.includes(m));
      if (!bad) throw err;
      metrics = metrics.filter((m) => m !== bad);
    }
  }
  return {};
}

/** Followers online per hour as the API reports it ({ "0": n, … "23": n }); undefined when the account can't get it. */
export async function onlineFollowers() {
  try {
    const user = requireCred('user-id');
    const { data } = await call(`/${user}/insights`, { metric: 'online_followers', period: 'lifetime' });
    const value = data?.[0]?.values?.at(-1)?.value;
    return value && Object.keys(value).length ? value : undefined;
  } catch {
    return undefined;
  }
}
