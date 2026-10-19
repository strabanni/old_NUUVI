// The world around the characters:
// - Ties: how one character relates to another (best friend, ex, rival, family…), drawn as one
//   family-tree-style chart on profiles.
// - Timeline: the important events in a character's life, added by their writer.
import { fail, str, oneOf, color } from '../http.js';
import { toCharacter, requireUser, isBlocked } from '../model.js';

export const TIE_KINDS = [
  'partner',
  'spouse',
  'crush',
  'ex',
  'bestfriend',
  'friend',
  'parent',
  'stepparent',
  'child',
  'stepchild',
  'sibling',
  'halfsibling',
  'stepsibling',
  'grandparent',
  'grandchild',
  'auntuncle',
  'nibling',
  'cousin',
  'inlaw',
  'family',
  'rival',
  'enemy',
  'coworker',
  'roommate',
  'mentor',
  'complicated',
  'other',
];
// Family ties, and how many generations away the other person is (-1 = a generation up).
export const FAMILY_GEN = {
  parent: -1,
  stepparent: -1,
  grandparent: -2,
  auntuncle: -1,
  child: 1,
  stepchild: 1,
  grandchild: 2,
  nibling: 1,
  sibling: 0,
  halfsibling: 0,
  stepsibling: 0,
  cousin: 0,
  spouse: 0,
  partner: 0,
  inlaw: 0,
  family: 0,
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function worldRoutes(r, ctx) {
  const { db } = ctx;
  const character = (id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  const blockedEither = (a, b) => isBlocked(db, a, b) || isBlocked(db, b, a);
  // Stories the viewer may see (public, or ones they're in).
  const VISIBLE = "(s.visibility = 'public' OR s.id IN (SELECT story_id FROM story_members WHERE user_id = :viewer))";

  // ---------- Ties ----------
  const toTie = (t, other, mirror) => ({
    kind: t.kind,
    label: t.label,
    color: t.color ?? null,
    note: t.note,
    since: t.since,
    createdAt: t.created_at,
    other: toCharacter(other),
    // How the other character sees it, if their writer has said.
    mutual: mirror ? { kind: mirror.kind, label: mirror.label } : null,
  });

  r.get('/api/characters/:id/ties', ({ user, params }) => {
    requireUser(user);
    const c = character(params.id) ?? fail(404, 'Character not found');
    const out = db
      .prepare('SELECT * FROM character_ties WHERE character_id = ? ORDER BY created_at')
      .all(c.id)
      .map((t) => ({ t, other: character(t.other_id) }))
      .filter(({ other }) => other && !blockedEither(user.id, other.user_id))
      .map(({ t, other }) =>
        toTie(t, other, db.prepare('SELECT * FROM character_ties WHERE character_id = ? AND other_id = ?').get(other.id, c.id)),
      );
    // Others who've named a tie to this character that this character hasn't named back.
    const named = new Set(out.map((t) => t.other.id));
    const incoming = db
      .prepare('SELECT * FROM character_ties WHERE other_id = ? ORDER BY created_at')
      .all(c.id)
      .filter((t) => !named.has(t.character_id))
      .map((t) => ({ t, other: character(t.character_id) }))
      .filter(({ other }) => other && !blockedEither(user.id, other.user_id))
      .map(({ t, other }) => ({
        kind: t.kind,
        label: t.label,
        color: t.color ?? null,
        note: t.note,
        since: t.since,
        createdAt: t.created_at,
        from: toCharacter(other),
      }));
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
    // Their own colour for the tie (a hex like #e0446a), or empty for the kind's colour.
    const tint = body.color ? color(body.color) : null;
    const since = body.since
      ? DATE.test(String(body.since))
        ? String(body.since)
        : fail(400, "That date doesn't look right")
      : null;
    const had = db.prepare('SELECT 1 FROM character_ties WHERE character_id = ? AND other_id = ?').get(c.id, other.id);
    db.prepare(
      `INSERT INTO character_ties (character_id, other_id, kind, label, note, since, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
      ON CONFLICT(character_id, other_id) DO UPDATE SET kind = excluded.kind, label = excluded.label, note = excluded.note, since = excluded.since, color = excluded.color`,
    ).run(c.id, other.id, kind, label, note, since, tint, ctx.storyNow());
    // Adding them back answers their "added you to their ties" notification.
    db.prepare(
      "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND type = 'tie' AND character_id = ? AND from_character_id = ? AND read_at IS NULL",
    ).run(user.id, c.id, other.id);
    if (!had && other.user_id !== user.id) {
      ctx.notify({
        userId: other.user_id,
        type: 'tie',
        actorId: user.id,
        characterId: other.id,
        fromCharacterId: c.id,
        text: `${c.name} added ${other.name} to their ties`,
      });
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
  // The important things that happened to a character, added by their writer: a date, what
  // happened, and a note. Oldest first, so it reads like their story.
  const toEvent = (e) => ({ id: e.id, date: e.date, title: e.title, note: e.note });
  const eventInput = (body) => {
    const date = String(body.date || '');
    if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) fail(400, 'Pick a date');
    const title = (str(body.title, 'What happened', { min: 1, max: 140, required: true }) ?? '').trim();
    if (!title) fail(400, 'Say what happened');
    const note = (str(body.note, 'Note', { max: 2000 }) ?? '').trim();
    return { date, title, note };
  };
  const ownCharacter = (id, user) => {
    const c = character(id);
    if (!c || (c.user_id !== user.id && !user.isAdmin)) fail(404, 'Character not found');
    return c;
  };

  r.get('/api/characters/:id/timeline', ({ user, params }) => {
    requireUser(user);
    const c = character(params.id) ?? fail(404, 'Character not found');
    if (blockedEither(user.id, c.user_id)) fail(404, 'Character not found');
    const events = db.prepare('SELECT * FROM timeline_events WHERE character_id = ? ORDER BY date, id').all(c.id).map(toEvent);
    return { data: { events, canEdit: c.user_id === user.id || !!user.isAdmin } };
  });

  r.post('/api/characters/:id/timeline', ({ user, params, body }) => {
    requireUser(user);
    const c = ownCharacter(params.id, user);
    if (db.prepare('SELECT COUNT(*) AS n FROM timeline_events WHERE character_id = ?').get(c.id).n >= 300)
      fail(400, 'That timeline is full');
    const e = eventInput(body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO timeline_events (character_id, date, title, note) VALUES (?, ?, ?, ?)')
      .run(c.id, e.date, e.title, e.note);
    return {
      status: 201,
      data: { event: toEvent(db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(lastInsertRowid)) },
    };
  });

  r.put('/api/characters/:id/timeline/:eventId', ({ user, params, body }) => {
    requireUser(user);
    const c = ownCharacter(params.id, user);
    const e = eventInput(body);
    const res = db
      .prepare('UPDATE timeline_events SET date = ?, title = ?, note = ? WHERE id = ? AND character_id = ?')
      .run(e.date, e.title, e.note, params.eventId, c.id);
    if (!res.changes) fail(404, 'Event not found');
    return { data: { event: toEvent(db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(params.eventId)) } };
  });

  r.delete('/api/characters/:id/timeline/:eventId', ({ user, params }) => {
    requireUser(user);
    const c = ownCharacter(params.id, user);
    db.prepare('DELETE FROM timeline_events WHERE id = ? AND character_id = ?').run(params.eventId, c.id);
    return { data: { ok: true } };
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
          if (!links.has(key)) links.set(key, { from, to, kind: t.kind, label: t.label, color: t.color ?? null });
        }
      }
      frontier = next;
    }
    // How each person is related to the character in the middle, when the middle character's
    // writer (or theirs) has said.
    const direct = new Map();
    for (const t of tiesOf.all(c.id, c.id, ...kinds)) {
      if (t.character_id === c.id) direct.set(t.other_id, { kind: t.kind, label: t.label, color: t.color ?? null });
      else if (!direct.has(t.character_id))
        direct.set(t.character_id, { kind: t.kind, label: t.label, color: t.color ?? null, theirs: true });
    }
    const members = [...people.values()].map((p) => ({
      character: toCharacter(p),
      gen: gen.get(p.id),
      relation: direct.get(p.id) ?? null,
    }));
    return { data: { center: c.id, members, links: [...links.values()].filter((l) => people.has(l.from) && people.has(l.to)) } };
  });
}
