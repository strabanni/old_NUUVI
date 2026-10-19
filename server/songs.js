// Song previews for posts. When a post has a song, NUUVI looks it up on Apple Music's free search
// (no key needed) and keeps the link to its 30-second preview, so the song can play on the feed.

const SEARCH = 'https://itunes.apple.com/search';
// Only play previews from Apple's own servers.
const PREVIEW_HOST = /^https:\/\/[\w.-]+\.(itunes\.apple\.com|mzstatic\.com|apple\.com)\//;

export function createSongs({ fetch: get = globalThis.fetch } = {}) {
  const found = new Map(); // "title|artist" → preview link ('' = none), kept while the server runs

  // The preview link for a song, '' if Apple doesn't have it, or null if the search didn't work.
  async function find(title, artist = '') {
    const key = `${title}|${artist}`.toLowerCase();
    if (found.has(key)) return found.get(key);
    const url = `${SEARCH}?${new URLSearchParams({ term: `${title} ${artist}`.trim(), media: 'music', entity: 'song', limit: '5' })}`;
    try {
      const res = await get(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const { results = [] } = await res.json();
      // The best match: same title (and artist, if given), otherwise the first result.
      const same = (a, b) =>
        String(a || '')
          .toLowerCase()
          .includes(String(b || '').toLowerCase());
      const hit =
        results.find((r) => same(r.trackName, title) && (!artist || same(r.artistName, artist))) ??
        results.find((r) => same(r.trackName, title)) ??
        results[0];
      const preview = PREVIEW_HOST.test(hit?.previewUrl || '') ? hit.previewUrl : '';
      if (found.size > 2000) found.clear();
      found.set(key, preview);
      return preview;
    } catch {
      return null;
    }
  }

  return { find };
}
