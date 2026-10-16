// Character profiles: a detailed dossier for any character on NUUVI, NPCs included. Everyone can
// read them; the character's writer (or an admin) edits them.
import { fail, str } from '../http.js';
import { toCharacter, toUser, requireUser, uploadRef } from '../model.js';
import { headlineSet } from '../headline.js';

// Quick facts, in the order they're shown.
export const FACTS = ['fullName', 'nicknames', 'age', 'birthday', 'zodiac', 'pronouns', 'gender', 'sexuality', 'height',
  'nationality', 'hometown', 'residence', 'occupation', 'affiliation', 'relationship', 'faceclaim'];
// Long sections, in the order they're shown.
export const BENTO_SLOTS = ['main', 'tall', 'a', 'b', 'r', 's1', 's2', 's3', 'w1', 'w2'];
export const SECTIONS = ['personality', 'appearance', 'history', 'relationships', 'goals', 'trivia'];

// A playlist link from Spotify, Apple Music, YouTube (or YouTube Music) or SoundCloud → the player
// that can be shown on the profile. { url, embed, service, size } — size picks the player's height.
export function playlistEmbed(link) {
  // The Share → Embed code from Spotify, Apple Music, YouTube or SoundCloud works too: use its link.
  const code = String(link).match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  if (code) link = code[1].replace(/&amp;/g, '&');
  // SoundCloud's embed code points at its player; the track's own link is inside it.
  try { const p = new URL(String(link).trim()); if (p.hostname === 'w.soundcloud.com' && p.searchParams.get('url')) link = p.searchParams.get('url'); } catch { /* checked below */ }
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
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    const list = u.searchParams.get('list');
    const video = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
    // youtube.com/embed/ID (from YouTube's embed code)
    const embedded = u.pathname.match(/^\/embed\/([\w-]{6,20})/)?.[1];
    if (embedded && embedded !== 'videoseries') return { url, service: 'youtube', size: 'video', embed: `https://www.youtube-nocookie.com/embed/${embedded}` };
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
    const dossier = parse(row.dossier);
    // The lines their headline rotates through (Claude's, if it wrote some; or the built-in set).
    if (!dossier.headlines?.length) dossier.headlines = headlineSet(dossier.headline);
    return { data: { character: toCharacter(row), dossier, owner: toUser(owner), canEdit: canEdit(row, user) } };
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
      // The song on their profile: a share link (or embed code) shown as that service's own player.
      song: d.song ? (typeof d.song === 'object' && d.song.url === old.song?.url ? old.song : playlistEmbed(typeof d.song === 'string' ? d.song : d.song.url)) : null,
      // Lines with the same energy that it rotates through; rewritten when the headline changes.
      headlines: text(d.headline, 'Headline', 40).toUpperCase() === (old.headline || '').toUpperCase() && Array.isArray(old.headlines) ? old.headlines : headlineSet(text(d.headline, 'Headline', 40)),
      // Which post sits in which box of the profile grid (the writer's choice; the rest fill with
      // their newest posts).
      bento: Object.fromEntries(Object.entries(d.bento && typeof d.bento === 'object' ? d.bento : {})
        .filter(([k, v]) => BENTO_SLOTS.includes(k) && Number.isInteger(v) && v > 0)),
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
    // A new headline: Claude (when it's on) writes more lines in the same voice, in the background.
    if (dossier.headline && dossier.headline.toUpperCase() !== (old.headline || '').toUpperCase() && ctx.ai?.enabled) {
      ctx.ai.ask({
        system: 'You write the big greeting line shown before a roleplay character\'s first name on their profile, like "OHH SHIT IT\'S" before ", AEDAN!". Given the writer\'s line, write 9 more lines with exactly the same energy, slang and attitude (same swearing level, same mood), each one ending so the name reads naturally after a comma. Keep each under 30 characters, all caps, no name, no emoji, no commas, no trailing punctuation.',
        content: dossier.headline,
        schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } }, required: ['lines'], additionalProperties: false },
        effort: 'low',
      }).then(({ lines }) => {
        const now = db.prepare('SELECT dossier FROM characters WHERE id = ?').get(row.id);
        const cur = parse(now?.dossier);
        if (!now || cur.headline !== dossier.headline) return; // changed again since
        const clean = lines.map((l) => String(l).trim().toUpperCase().replace(/,/g, '').replace(/[.!]+$/, '').slice(0, 40)).filter(Boolean);
        cur.headlines = [...new Set([dossier.headline.trim().toUpperCase(), ...clean])].slice(0, 10);
        db.prepare('UPDATE characters SET dossier = ? WHERE id = ?').run(JSON.stringify(cur), row.id);
      }).catch(() => {});
    }
    return { data: { dossier, character: toCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(row.id)) } };
  });
}
