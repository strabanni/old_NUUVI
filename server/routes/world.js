// The world around the characters:
// - Ties: how one character relates to another (best friend, ex, rival, family…), drawn as a web
//   and as a family tree on profiles.
// - Timeline: a character's life in story order (posts, episodes, plans, ties). Their writer can
//   change the date of anything on it.
import { fail, str, oneOf } from '../http.js';
import { toCharacter, requireUser, isBlocked, canSeeAccount } from '../model.js';
import { parseBirthday } from './profiles.js';
import { plainText } from '../text.js';

export const TIE_KINDS = ['partner', 'spouse', 'crush', 'ex', 'bestfriend', 'friend',
  'parent', 'stepparent', 'child', 'stepchild', 'sibling', 'halfsibling', 'stepsibling', 'grandparent', 'grandchild',
  'auntuncle', 'nibling', 'cousin', 'inlaw', 'family',
  'rival', 'enemy', 'coworker', 'roommate', 'mentor', 'complicated', 'other'];
// Family ties, and how many generations away the other person is (-1 = a generation up).
export const FAMILY_GEN = {
  parent: -1, stepparent: -1, grandparent: -2, auntuncle: -1,
  child: 1, stepchild: 1, grandchild: 2, nibling: 1,
  sibling: 0, halfsibling: 0, stepsibling: 0, cousin: 0, spouse: 0, partner: 0, inlaw: 0, family: 0,
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const parse = (json) => { try { return JSON.parse(json || '{}') || {}; } catch { return {}; } };

export function worldRoutes(r, ctx) {
  const { db } = ctx;
  const character = (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const blockedEither = (a, b) => isBlocked(db, a, b) || isBlocked(db, b, a);
  // Stories the viewer may see (public, or ones they're in).
  const VISIBLE = '(s.visibility = \'public\' OR s.id IN (SELECT story_id FROM story_members WHERE user_id = :viewer))';

  // ---------- Ties ----------
  const toTie = (t, other, mirror) => ({
    kind: t.kind, label: t.label, note: t.note, since: t.since, createdAt: t.created_at,
    other: toCharacter(other),
    // How the other character sees it, if their writer has said.
    mutual: mirror ? { kind: mirror.kind, label: mirror.label } : null,
  });

  r.get('/api/characters/:id/ties', ({ user, params }) => {
    requireUser(user);
    const c = character(params.id) ?? fail(404, 'Character not found');
    const out = db.prepare('SELECT * FROM character_ties WHERE character_id = ? ORDER BY created_at').all(c.id)
      .map((t) => ({ t, other: character(t.other_id) }))
      .filter(({ other }) => other && !blockedEither(user.id, other.user_id))
      .map(({ t, other }) => toTie(t, other, db.prepare('SELECT * FROM character_ties WHERE character_id = ? AND other_id = ?').get(other.id, c.id)));
    // Others who've named a tie to this character that this character hasn't named back.
    const named = new Set(out.map((t) => t.other.id));
    const incoming = db.prepare('SELECT * FROM character_ties WHERE other_id = ? ORDER BY created_at').all(c.id)
      .filter((t) => !named.has(t.character_id))
      .map((t) => ({ t, other: character(t.character_id) }))
      .filter(({ other }) => other && !blockedEither(user.id, other.user_id))
      .map(({ t, other }) => ({ kind: t.kind, label: t.label, note: t.note, since: t.since, createdAt: t.created_at, from: toCharacter(other) }));
    return { data: { ties: out, incoming, kinds: TIE_KINDS } };
  });

  r.put('/api/characters/:id/ties/:otherId', ({ user, params, body }) => {
    requireUser(user);
    const c = character(params.id);
    if (!c || c.user_id !== user.id) fail(404, 'Character not found');
    const other = character(params.otherId);
    if (!other || other.id === c.id) fail(400, 'Pick someone else');
    if (blockedEither(user.id, other.user_id)) fail(403, "You can't tie these characters together");
    const kind = oneOf(body.kind, 'Kind of tie', TIE_KINDS) ?? 'friend';
    const label = (str(body.label, 'Label', { max: 40 }) ?? '').trim();
    const note = (str(body.note, 'Note', { max: 300 }) ?? '').trim();
    const since = body.since ? (DATE.test(String(body.since)) ? String(body.since) : fail(400, "That date doesn't look right")) : null;
    const had = db.prepare('SELECT 1 FROM character_ties WHERE character_id = ? AND other_id = ?').get(c.id, other.id);
    db.prepare(`INSERT INTO character_ties (character_id, other_id, kind, label, note, since, created_at) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
      ON CONFLICT(character_id, other_id) DO UPDATE SET kind = excluded.kind, label = excluded.label, note = excluded.note, since = excluded.since`)
      .run(c.id, other.id, kind, label, note, since, ctx.storyNow());
    if (!had && other.user_id !== user.id) {
      ctx.notify({ userId: other.user_id, type: 'tie', actorId: user.id, characterId: other.id, fromCharacterId: c.id,
        text: `${c.name} added ${other.name} to their ties`, });
    }
    return { data: { ok: true } };
  });

  r.delete('/api/characters/:id/ties/:otherId', ({ user, params }) => {
    requireUser(user);
    const c = character(params.id);
    if (!c || c.user_id !== user.id) fail(404, 'Character not found');
    db.prepare('DELETE FROM character_ties WHERE character_id = ? AND other_id = ?').run(c.id, params.otherId);
    return { data: { ok: true } };
  });

  // ---------- Timeline ----------
  // Everything in a character's life, newest first, by in-story date.
  r.get('/api/characters/:id/timeline', ({ user, params }) => {
    requireUser(user);
    const c = character(params.id) ?? fail(404, 'Character not found');
    if (blockedEither(user.id, c.user_id)) fail(404, 'Character not found');
    const items = [];
    const seePosts = user.isAdmin || canSeeAccount(db, c, user.id);
    if (seePosts) {
      for (const p of db.prepare('SELECT * FROM social_posts WHERE character_id = ? ORDER BY created_at DESC LIMIT 120').all(c.id)) {
        const media = JSON.parse(p.media || '[]');
        items.push({ type: p.category === 'musing' ? 'musing' : 'post', key: `post:${p.id}`, at: p.created_at, text: plainText(p.body, 160) || p.title || '',
          picture: p.kind === 'photo' || p.kind === 'stream' ? media[0] ?? null : null, location: p.location ?? null, link: `#/p/${p.id}` });
      }
    }
    // Episodes they're in (in stories the viewer can see): when they first wrote in it, and if it ended.
    for (const e of db.prepare(`SELECT ch.id, ch.name, ch.story_id, ch.status, ch.created_at, ch.last_post_at, s.title AS story_title,
        (SELECT MIN(p.created_at) FROM posts p WHERE p.channel_id = ch.id AND p.character_id = :c) AS first_at
      FROM channel_characters cc JOIN channels ch ON ch.id = cc.channel_id JOIN stories s ON s.id = ch.story_id
      WHERE cc.character_id = :c AND ch.kind != 'ooc' AND ${VISIBLE}`).all({ c: c.id, viewer: user.id })) {
      items.push({ type: 'episode', key: `episode:${e.id}`, at: e.first_at || e.created_at, text: e.name, sub: e.story_title, link: `#/s/${e.story_id}/${e.id}` });
      if (e.status === 'complete' && e.last_post_at) items.push({ type: 'finished', key: `finished:${e.id}`, at: e.last_post_at, text: e.name, sub: e.story_title, link: `#/s/${e.story_id}/${e.id}` });
    }
    // Plans on the calendar (private ones only for their writer).
    for (const p of db.prepare('SELECT * FROM plans WHERE character_id = ? AND (private = 0 OR user_id = ?) ORDER BY starts_at DESC LIMIT 80').all(c.id, user.id)) {
      items.push({ type: 'plan', key: `plan:${p.id}`, at: p.starts_at.replace('T', ' ').slice(0, 19), text: p.title, sub: [p.location, p.kind].filter(Boolean).join(' · ') });
    }
    // Ties: when they became someone's best friend, ex, rival…
    for (const t of db.prepare('SELECT * FROM character_ties WHERE character_id = ?').all(c.id)) {
      const other = character(t.other_id);
      if (!other || blockedEither(user.id, other.user_id)) continue;
      items.push({ type: 'tie', key: `tie:${t.other_id}`, at: t.since ? `${t.since} 12:00:00` : t.created_at, text: other.name, kind: t.kind, label: t.label, link: `#/c/${other.id}` });
    }
    items.push({ type: 'arrived', key: 'arrived', at: c.created_at, text: c.name });
    // Dates the writer set by hand.
    const set = new Map(db.prepare('SELECT item, at FROM timeline_dates WHERE character_id = ?').all(c.id).map((x) => [x.item, x.at]));
    for (const it of items) if (set.has(it.key)) { it.at = set.get(it.key); it.edited = true; }
    // Dates come as "2026-10-16 09:00:00" or "2026-10-16T09:00:00.000Z": compare them the same way.
    const key = (at) => String(at).replace('T', ' ').slice(0, 19);
    items.sort((a, b) => (key(a.at) < key(b.at) ? 1 : key(a.at) > key(b.at) ? -1 : 0));
    const b = parseBirthday(parse(c.dossier).facts?.birthday);
    return { data: { items, birthday: b, locked: !seePosts, canEdit: c.user_id === user.id || !!user.isAdmin } };
  });

  // ---------- Family tree ----------
  // Everyone linked to the character by family ties (theirs and their relatives', up to 3 steps out),
  // each placed on a generation row, plus the ties between them to draw the lines.
  r.get('/api/characters/:id/family', ({ user, params }) => {
    requireUser(user);
    const c = character(params.id) ?? fail(404, 'Character not found');
    if (blockedEither(user.id, c.user_id)) fail(404, 'Character not found');
    const kinds = Object.keys(FAMILY_GEN);
    const marks = kinds.map(() => '?').join(', ');
    const tiesOf = db.prepare(`SELECT * FROM character_ties WHERE (character_id = ? OR other_id = ?) AND kind IN (${marks})`);
    const gen = new Map([[c.id, 0]]);
    const people = new Map([[c.id, c]]);
    const links = new Map();
    let frontier = [c.id];
    for (let step = 0; step < 3 && frontier.length && people.size < 40; step++) {
      const next = [];
      for (const id of frontier) {
        for (const t of tiesOf.all(id, id, ...kinds)) {
          // Partners only count as family for the character in the middle, not for every relative.
          if (t.kind === 'partner' && t.character_id !== c.id && t.other_id !== c.id) continue;
          const [from, to] = [t.character_id, t.other_id];
          const otherId = from === id ? to : from;
          if (!people.has(otherId)) {
            const o = character(otherId);
            if (!o || blockedEither(user.id, o.user_id) || people.size >= 40) continue;
            people.set(otherId, o);
            gen.set(otherId, from === id ? gen.get(id) + FAMILY_GEN[t.kind] : gen.get(id) - FAMILY_GEN[t.kind]);
            next.push(otherId);
          }
          const key = [Math.min(from, to), Math.max(from, to)].join('-');
          if (!links.has(key)) links.set(key, { from, to, kind: t.kind, label: t.label });
        }
      }
      frontier = next;
    }
    // How each person is related to the character in the middle, when the middle character's
    // writer (or theirs) has said.
    const direct = new Map();
    for (const t of tiesOf.all(c.id, c.id, ...kinds)) {
      if (t.character_id === c.id) direct.set(t.other_id, { kind: t.kind, label: t.label });
      else if (!direct.has(t.character_id)) direct.set(t.character_id, { kind: t.kind, label: t.label, theirs: true });
    }
    const members = [...people.values()].map((p) => ({ character: toCharacter(p), gen: gen.get(p.id), relation: direct.get(p.id) ?? null }));
    return { data: { center: c.id, members, links: [...links.values()].filter((l) => people.has(l.from) && people.has(l.to)) } };
  });

  // ---------- Changing a date on the timeline ----------
  // item is what the timeline gave it: post:ID, tie:OTHER_ID, plan:ID, episode:ID, finished:ID or
  // arrived. Posts, ties and plans get their own date changed (so it's the same everywhere);
  // the rest keep the date the writer set just for the timeline.
  r.put('/api/characters/:id/timeline', ({ user, params, body }) => {
    requireUser(user);
    const c = character(params.id);
    if (!c || (c.user_id !== user.id && !user.isAdmin)) fail(404, 'Character not found');
    const date = String(body.date || '');
    if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail(400, "That date doesn't look right");
    const item = String(body.item || '');
    const [type, rawId] = item.split(':');
    const id = Number(rawId);
    const days = (from) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`)) / 86400000);
    if (type === 'post') {
      const p = db.prepare('SELECT * FROM social_posts WHERE id = ? AND character_id = ?').get(id, c.id) ?? fail(404, 'Post not found');
      const d = days(p.created_at);
      // The post moves to that day (same time of day); its comments move with it.
      db.prepare("UPDATE social_posts SET created_at = ? || substr(created_at, 11) WHERE id = ?").run(date, p.id);
      if (d) db.prepare("UPDATE social_comments SET created_at = datetime(created_at, ? || ' days') WHERE post_id = ?").run(String(d), p.id);
    } else if (type === 'tie') {
      const t = db.prepare('UPDATE character_ties SET since = ? WHERE character_id = ? AND other_id = ?').run(date, c.id, id);
      if (!t.changes) fail(404, 'Tie not found');
    } else if (type === 'plan') {
      const p = db.prepare('SELECT * FROM plans WHERE id = ? AND character_id = ?').get(id, c.id) ?? fail(404, 'Plan not found');
      if (p.user_id !== user.id && !user.isAdmin) fail(404, 'Plan not found');
      const d = days(p.starts_at);
      const shift = (v) => (v ? new Date(Date.parse(v.length > 16 ? v : `${v}Z`) + d * 86400000).toISOString().slice(0, v.length) : v);
      db.prepare('UPDATE plans SET starts_at = ?, ends_at = ? WHERE id = ?').run(date + p.starts_at.slice(10), shift(p.ends_at), p.id);
    } else if (['episode', 'finished'].includes(type) || item === 'arrived') {
      if (body.reset) db.prepare('DELETE FROM timeline_dates WHERE character_id = ? AND item = ?').run(c.id, item);
      else db.prepare(`INSERT INTO timeline_dates (character_id, item, at) VALUES (?, ?, ?)
        ON CONFLICT(character_id, item) DO UPDATE SET at = excluded.at`).run(c.id, item, `${date} 12:00:00`);
    } else fail(400, "That can't be changed");
    return { data: { ok: true } };
  });
}
