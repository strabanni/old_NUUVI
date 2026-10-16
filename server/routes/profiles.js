// Character profiles: a detailed dossier for any character on NUUVI, NPCs included. Everyone can
// read them; the character's writer (or an admin) edits them.
import { fail, str } from '../http.js';
import { toCharacter, toUser, requireUser, uploadRef } from '../model.js';

// Quick facts, in the order they're shown.
export const FACTS = ['fullName', 'nicknames', 'age', 'birthday', 'zodiac', 'pronouns', 'gender', 'sexuality', 'height',
  'nationality', 'hometown', 'residence', 'occupation', 'affiliation', 'relationship', 'faceclaim'];
// Long sections, in the order they're shown.
export const SECTIONS = ['personality', 'appearance', 'history', 'relationships', 'goals', 'trivia'];

// A playlist link from Spotify, Apple Music, YouTube (or YouTube Music) or SoundCloud → the player
// that can be shown on the profile. { url, embed, service, size } — size picks the player's height.
export function playlistEmbed(link) {
  let u;
  try { u = new URL(String(link).trim()); } catch { fail(400, 'That playlist link doesn’t look right'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(400, 'That playlist link doesn’t look right');
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const url = u.href;
  if (host === 'open.spotify.com') {
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]+)/);
    if (!m) fail(400, 'Use a Spotify playlist, album, song or artist link');
    return { url, service: 'spotify', size: m[1] === 'track' || m[1] === 'episode' ? 'short' : 'tall', embed: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
  }
  if (host === 'music.apple.com' || host === 'embed.music.apple.com') {
    if (!/^\/[a-z]{2}\/(playlist|album|song|artist|station)\//.test(u.pathname)) fail(400, 'Use an Apple Music playlist, album or song link');
    const short = /\/song\//.test(u.pathname) || u.searchParams.has('i');
    return { url, service: 'apple', size: short ? 'short' : 'tall', embed: `https://embed.music.apple.com${u.pathname}${u.search}` };
  }
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) {
    const list = u.searchParams.get('list');
    const video = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
    if (list && /^[\w-]+$/.test(list)) return { url, service: 'youtube', size: 'video', embed: `https://www.youtube-nocookie.com/embed/videoseries?list=${list}` };
    if (video && /^[\w-]{6,20}$/.test(video)) return { url, service: 'youtube', size: 'video', embed: `https://www.youtube-nocookie.com/embed/${video}` };
    fail(400, 'Use a YouTube playlist or video link');
  }
  if (host === 'soundcloud.com' || host === 'm.soundcloud.com') {
    if (u.pathname.split('/').filter(Boolean).length < 2) fail(400, 'Use a SoundCloud playlist or track link');
    const clean = `https://soundcloud.com${u.pathname}`;
    return { url, service: 'soundcloud', size: /\/sets\//.test(u.pathname) ? 'tall' : 'short',
      embed: `https://w.soundcloud.com/player/?url=${encodeURIComponent(clean)}&color=%23ee719e&visual=false&show_comments=false` };
  }
  fail(400, 'Playlist links can be from Spotify, Apple Music, YouTube or SoundCloud');
}

const parse = (json) => { try { return JSON.parse(json || '{}') || {}; } catch { return {}; } };

// A birthday as people write it ("March 3", "3rd of March", "03/03", "1999-03-03") → { month, day }.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function parseBirthday(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(Number(m[2]), Number(m[3]));
  const name = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}`).test(t));
  const num = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (name >= 0 && num) return valid(name + 1, Number(num[1]));
  m = t.match(/\b(\d{1,2})[/.](\d{1,2})\b/);
  if (m) return valid(Number(m[1]), Number(m[2])); // month/day, the way it's written in the US
  return null;
}
function valid(month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

export function profileRoutes(r, ctx) {
  const { db } = ctx;
  const canEdit = (row, user) => !!user && (row.user_id === user.id || user.isAdmin);

  r.get('/api/profiles', ({ user, query }) => {
    requireUser(user);
    const q = (query.get('q') || '').trim().toLowerCase().slice(0, 60);
    const rows = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM characters c JOIN users u ON u.id = c.user_id
      WHERE (c.bot IS NULL OR c.bot != 'gossip') ORDER BY c.npc, c.name COLLATE NOCASE`).all();
    const profiles = rows.map((c) => {
      const d = parse(c.dossier);
      return {
        ...toCharacter(c), ownerName: c.owner_name, mine: c.user_id === user.id,
        quote: d.quote || '', occupation: d.facts?.occupation || '', age: d.facts?.age || '',
        filled: Object.values(d.sections || {}).filter(Boolean).length + Object.values(d.facts || {}).filter(Boolean).length,
      };
    }).filter((c) => !q || `${c.name} ${c.handle} ${c.aka} ${c.occupation} ${c.ownerName}`.toLowerCase().includes(q));
    return { data: { profiles } };
  });

  // Every character's birthday (from their profile), for the calendar and the birthday posts.
  r.get('/api/birthdays', ({ user }) => {
    requireUser(user);
    const rows = db.prepare("SELECT * FROM characters WHERE dossier LIKE '%birthday%' AND (bot IS NULL OR bot != 'gossip')").all();
    const birthdays = rows.map((c) => ({ c, b: parseBirthday(parse(c.dossier).facts?.birthday) })).filter((x) => x.b)
      .map(({ c, b }) => ({ id: c.id, name: c.name, handle: c.handle, avatar: c.avatar, color: c.color, gradient: c.gradient ? c.gradient.split(',') : null, ...b }));
    return { data: { birthdays } };
  });

  r.get('/api/profiles/:id', ({ user, params }) => {
    requireUser(user);
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(params.id);
    if (!row || (row.bot === 'gossip' && row.user_id !== user.id)) fail(404, 'Character not found');
    const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    return { data: { character: toCharacter(row), dossier: parse(row.dossier), owner: toUser(owner), canEdit: canEdit(row, user) } };
  });

  r.put('/api/profiles/:id', ({ user, params, body }) => {
    requireUser(user);
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(params.id);
    if (!row || !canEdit(row, user)) fail(404, 'Character not found');
    const old = parse(row.dossier);
    const d = body.dossier && typeof body.dossier === 'object' ? body.dossier : fail(400, 'Expected a profile');
    const text = (v, label, max) => str(typeof v === 'string' ? v : '', label, { max }) ?? '';
    const facts = {};
    for (const k of FACTS) { const v = text(d.facts?.[k], k, 160); if (v) facts[k] = v; }
    const sections = {};
    for (const k of SECTIONS) { const v = text(d.sections?.[k], k, 20000); if (v) sections[k] = v; }
    const keep = new Set(old.gallery || []);
    const pic = (v) => (keep.has(v) ? v : uploadRef(db, v, user.id));
    const dossier = {
      quote: text(d.quote, 'Quote', 300),
      // The big line at the top of the profile, before their name ("OHH SHIT IT'S", then ", AEDAN!").
      headline: text(d.headline, 'Headline', 40),
      tagline: text(d.tagline, 'Tagline', 160),
      cover: d.cover ? (d.cover === old.cover ? old.cover : uploadRef(db, d.cover, user.id) ?? fail(400, 'Cover picture missing')) : null,
      facts, sections,
      traits: (Array.isArray(d.traits) ? d.traits : []).map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 12),
      likes: text(d.likes, 'Likes', 1000),
      dislikes: text(d.dislikes, 'Dislikes', 1000),
      gallery: (Array.isArray(d.gallery) ? d.gallery : []).slice(0, 20).map((v) => pic(v) ?? fail(400, 'Picture missing')),
      // Songs, each with an optional link (Spotify, Apple Music, YouTube, SoundCloud) shown as its own little player.
      playlist: (Array.isArray(d.playlist) ? d.playlist : []).slice(0, 12).map((t) => {
        const song = { title: String(t?.title ?? '').trim().slice(0, 80), artist: String(t?.artist ?? '').trim().slice(0, 80) };
        const link = typeof t?.link === 'string' ? t.link.trim() : t?.link?.url;
        if (link) song.link = playlistEmbed(String(link).slice(0, 500));
        return song;
      }).filter((t) => t.title || t.link),
    };
    const json = JSON.stringify(dossier);
    if (json.length > 120000) fail(413, 'That profile is too long');
    db.prepare('UPDATE characters SET dossier = ?, pronouns = ? WHERE id = ?').run(json, facts.pronouns || null, row.id);
    return { data: { dossier, character: toCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id)) } };
  });
}
