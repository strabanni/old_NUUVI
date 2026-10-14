// A story's overview: the lore page everyone reads first. Intro, titled sections, and the
// organizations of the world (conglomerates with their subsidiaries, independents).
import { fail } from '../http.js';
import { requireUser, storyAccess, requireOwner } from '../model.js';
import { LORE_PRESET } from '../../public/js/lore-preset.js';

const KINDS = ['conglomerate', 'subsidiary', 'independent', 'other'];

function text(v, field, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') fail(400, `${field} must be text`);
  if (v.length > max) fail(400, `${field} is too long (${max.toLocaleString()} characters at most)`);
  return v.trim();
}
const list = (v, field, max) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(400, `${field} must be a list`);
  if (v.length > max) fail(400, `At most ${max} ${field.toLowerCase()}`);
  return v.filter((x) => x && typeof x === 'object');
};

export function overviewInput(body) {
  const orgs = list(body.orgs, 'Organizations', 80).map((o) => ({
    name: text(o.name, 'Name', 120),
    kind: KINDS.includes(o.kind) ? o.kind : 'other',
    parent: text(o.parent, 'Parent', 120),
    founded: text(o.founded, 'Founded', 40),
    motto: text(o.motto, 'Motto', 300),
    body: text(o.body, 'Description', 20000),
    credit: text(o.credit, 'Credit', 80),
    whisper: text(o.whisper, 'Gossip line', 500),
  })).filter((o) => o.name);
  return {
    tagline: text(body.tagline, 'Tagline', 300),
    intro: text(body.intro, 'Intro', 30000),
    sections: list(body.sections, 'Sections', 40).map((x) => ({ title: text(x.title, 'Section title', 160), body: text(x.body, 'Section', 30000) }))
      .filter((x) => x.title || x.body),
    independentNote: text(body.independentNote, 'Note', 300),
    letter: text(body.letter, 'Gossip column', 5000),
    signoff: text(body.signoff, 'Sign-off', 120),
    orgs,
  };
}

export function overviewRoutes(r, ctx) {
  const { db, hub } = ctx;

  // Lore that was already saved (edited by an admin) gets the companies added since, once: MOSSETA,
  // NOER and OKINE under FOYAEN, MONO under ENTITY, and INTRÉPIDE's updated wording. Each new company
  // goes after the last one under the same parent. Nothing an admin wrote is changed.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'lore_v2'").get()) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'lore'").get();
    if (row) {
      const lore = JSON.parse(row.value);
      lore.orgs ??= [];
      const has = (name) => lore.orgs.some((o) => o.name?.toUpperCase() === name.toUpperCase());
      for (const org of LORE_PRESET.orgs.filter((o) => ['MOSSETA', 'NOER', 'OKINE', 'MONO'].includes(o.name) && !has(o.name))) {
        let at = -1;
        lore.orgs.forEach((o, n) => { if (o.name === org.parent || o.parent === org.parent) at = n; });
        lore.orgs.splice(at < 0 ? lore.orgs.length : at + 1, 0, { ...org });
      }
      const intrepide = lore.orgs.find((o) => /^INTR[ÉE]PIDE/i.test(o.name || ''));
      if (intrepide?.body?.endsWith('with minimal interference.')) intrepide.body = intrepide.body.replace(/minimal interference\.$/, 'minimal authority intervention.');
      db.prepare("UPDATE settings SET value = ? WHERE key = 'lore'").run(JSON.stringify(lore));
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('lore_v2', '1')").run();
  }

  r.get('/api/stories/:id/overview', ({ user, params }) => {
    requireUser(user);
    const { row, role } = storyAccess(db, params.id, user);
    const n = (sql) => db.prepare(sql).get(row.id).n;
    return {
      data: {
        overview: JSON.parse(row.overview || '{}'),
        canEdit: role === 'owner' || user.isAdmin,
        stats: {
          writers: n('SELECT COUNT(*) AS n FROM story_members WHERE story_id = ?'),
          characters: n(`SELECT COUNT(DISTINCT c.id) AS n FROM characters c JOIN story_members m ON m.user_id = c.user_id
            WHERE m.story_id = ? AND (c.bot IS NULL OR c.bot != 'gossip')`),
          threads: n("SELECT COUNT(*) AS n FROM channels WHERE story_id = ? AND kind IN ('thread', 'para', 'event', 'comms')"),
          events: n("SELECT COUNT(*) AS n FROM events WHERE story_id = ? AND COALESCE(ends_at, starts_at) >= datetime('now', '-1 day')"),
        },
      },
    };
  });

  // ---------- The lore: one overview of the whole NUUVI world, not tied to any story ----------
  // Starts out as the FOYAEN × ENTITY lore; admins can edit it.
  r.get('/api/lore', ({ user }) => {
    requireUser(user);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'lore'").get();
    const n = (sql) => db.prepare(sql).get().n;
    return {
      data: {
        overview: row ? JSON.parse(row.value) : LORE_PRESET,
        canEdit: !!user.isAdmin,
        stats: {
          writers: n('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NULL'),
          characters: n("SELECT COUNT(*) AS n FROM characters WHERE bot IS NULL OR bot != 'gossip'"),
          threads: n("SELECT COUNT(*) AS n FROM channels WHERE kind IN ('thread', 'para', 'event', 'comms')"),
          events: n("SELECT COUNT(*) AS n FROM events WHERE COALESCE(ends_at, starts_at) >= datetime('now', '-1 day')"),
        },
      },
    };
  });

  r.put('/api/lore', ({ user, body }) => {
    requireUser(user);
    if (!user.isAdmin) fail(403, 'Only admins can edit the lore');
    const overview = overviewInput(body);
    db.prepare("INSERT INTO settings (key, value) VALUES ('lore', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(overview));
    return { data: { overview } };
  });

  r.put('/api/stories/:id/overview', ({ user, params, body }) => {
    requireUser(user);
    const { row, role } = storyAccess(db, params.id, user);
    requireOwner(role, user);
    const overview = overviewInput(body);
    db.prepare('UPDATE stories SET overview = ? WHERE id = ?').run(JSON.stringify(overview), row.id);
    hub.sendStory(row.id, 'story', { storyId: row.id });
    return { data: { overview } };
  });
}
