// Parses a pasted YouTube link into { kind, ref } and fetches a title (best effort).
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com']);
const ID = /^[a-zA-Z0-9_-]{11}$/;
const LIST = /^[a-zA-Z0-9_-]{10,60}$/;

function parseYouTube(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || !HOSTS.has(u.hostname)) return null;

  let id = null;
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
  else if (u.pathname === '/watch') id = u.searchParams.get('v');
  else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/);
    if (m) id = m[1];
  }
  if (id && ID.test(id)) return { kind: 'video', ref: id };

  const list = u.searchParams.get('list');
  if (list && LIST.test(list)) return { kind: 'playlist', ref: list };
  return null;
}

async function fetchTitle(url, fallback) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return fallback;
    const data = await r.json();
    return String(data.title || fallback).slice(0, 200);
  } catch {
    return fallback; // offline / blocked / slow: never fail the request because of a title
  }
}

module.exports = { parseYouTube, fetchTitle };
