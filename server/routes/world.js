// The world around the characters:
// - Ties: how one character relates to another (best friend, ex, rival…), drawn as a web on profiles.
// - Timeline: a character's life in story order (posts, episodes, plans, ties).
// - The Ardell Daily: a newspaper for any day in Ardell City, written from what happened that day.
import { fail, str, oneOf } from '../http.js';
import { toCharacter, requireUser, isBlocked, canSeeAccount, CAN_SEE_ACCOUNT } from '../model.js';
import { parseBirthday } from './profiles.js';
import { storyDate } from '../clock.js';
import { plainText } from '../text.js';

export const TIE_KINDS = ['partner', 'crush', 'ex', 'bestfriend', 'friend', 'sibling', 'family', 'parent', 'child',
  'rival', 'enemy', 'coworker', 'roommate', 'mentor', 'complicated', 'other'];
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
        items.push({ type: p.category === 'musing' ? 'musing' : 'post', at: p.created_at, text: plainText(p.body, 160) || p.title || '',
          picture: p.kind === 'photo' || p.kind === 'stream' ? media[0] ?? null : null, location: p.location ?? null, link: `#/p/${p.id}` });
      }
    }
    // Episodes they're in (in stories the viewer can see): when they first wrote in it, and if it ended.
    for (const e of db.prepare(`SELECT ch.id, ch.name, ch.story_id, ch.status, ch.created_at, ch.last_post_at, s.title AS story_title,
        (SELECT MIN(p.created_at) FROM posts p WHERE p.channel_id = ch.id AND p.character_id = :c) AS first_at
      FROM channel_characters cc JOIN channels ch ON ch.id = cc.channel_id JOIN stories s ON s.id = ch.story_id
      WHERE cc.character_id = :c AND ch.kind != 'ooc' AND ${VISIBLE}`).all({ c: c.id, viewer: user.id })) {
      items.push({ type: 'episode', at: e.first_at || e.created_at, text: e.name, sub: e.story_title, link: `#/s/${e.story_id}/${e.id}` });
      if (e.status === 'complete' && e.last_post_at) items.push({ type: 'finished', at: e.last_post_at, text: e.name, sub: e.story_title, link: `#/s/${e.story_id}/${e.id}` });
    }
    // Plans on the calendar (private ones only for their writer).
    for (const p of db.prepare('SELECT * FROM plans WHERE character_id = ? AND (private = 0 OR user_id = ?) ORDER BY starts_at DESC LIMIT 80').all(c.id, user.id)) {
      items.push({ type: 'plan', at: p.starts_at.replace('T', ' ').slice(0, 19), text: p.title, sub: [p.location, p.kind].filter(Boolean).join(' · ') });
    }
    // Ties: when they became someone's best friend, ex, rival…
    for (const t of db.prepare('SELECT * FROM character_ties WHERE character_id = ?').all(c.id)) {
      const other = character(t.other_id);
      if (!other || blockedEither(user.id, other.user_id)) continue;
      items.push({ type: 'tie', at: t.since ? `${t.since} 12:00:00` : t.created_at, text: other.name, kind: t.kind, label: t.label, link: `#/c/${other.id}` });
    }
    items.push({ type: 'arrived', at: c.created_at, text: c.name });
    // Dates come as "2026-10-16 09:00:00" or "2026-10-16T09:00:00.000Z": compare them the same way.
    const key = (at) => String(at).replace('T', ' ').slice(0, 19);
    items.sort((a, b) => (key(a.at) < key(b.at) ? 1 : key(a.at) > key(b.at) ? -1 : 0));
    const b = parseBirthday(parse(c.dossier).facts?.birthday);
    return { data: { items, birthday: b, locked: !seePosts } };
  });

  // ---------- The Ardell Daily ----------
  // A newspaper for one day in Ardell City (today in the city by default), written from what happened.
  r.get('/api/daily', ({ user, query }) => {
    requireUser(user);
    const today = storyDate(ctx.clock());
    const day = DATE.test(query.get('date') || '') ? query.get('date') : today;
    const args = { viewer: user.id, day };
    const dayOnly = { day };
    const NOT_BLOCKED = `p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = :viewer)
      AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = :viewer)`;
    // The day's posts, most liked first (likes the writer set count too, like the feed shows).
    const posts = db.prepare(`SELECT p.*, c.name AS c_name, c.handle AS c_handle, c.avatar AS c_avatar, c.color AS c_color, c.bot AS c_bot,
        COALESCE(p.likes_display, 0) + (SELECT COUNT(*) FROM social_likes l WHERE l.post_id = p.id) AS score
      FROM social_posts p JOIN characters c ON c.id = p.character_id
      WHERE substr(p.created_at, 1, 10) = :day AND ${NOT_BLOCKED} AND ${CAN_SEE_ACCOUNT}
      ORDER BY score DESC, p.id DESC LIMIT 40`).all(args);
    const post = (p) => {
      const media = JSON.parse(p.media || '[]');
      return { id: p.id, text: plainText(p.body, 220) || p.title || '', picture: p.kind === 'photo' || p.kind === 'stream' ? media[0] ?? null : null,
        location: p.location ?? null, at: p.created_at, score: p.score,
        character: { id: p.character_id, name: p.c_name, handle: p.c_handle, avatar: p.c_avatar, color: p.c_color } };
    };
    const gossip = posts.filter((p) => p.c_bot === 'gossip').map(post);
    const stories = posts.filter((p) => p.c_bot !== 'gossip').map(post);
    // Spotted: new ties and follows that day.
    const ties = db.prepare(`SELECT t.*, a.name AS a_name, b.name AS b_name, a.user_id AS a_user, b.user_id AS b_user FROM character_ties t
      JOIN characters a ON a.id = t.character_id JOIN characters b ON b.id = t.other_id
      WHERE COALESCE(t.since, substr(t.created_at, 1, 10)) = :day`).all(dayOnly)
      .filter((t) => !blockedEither(user.id, t.a_user) && !blockedEither(user.id, t.b_user))
      .map((t) => ({ from: { id: t.character_id, name: t.a_name }, to: { id: t.other_id, name: t.b_name }, kind: t.kind, label: t.label }))
      // Two characters who named each other are one piece of news, not two.
      .filter((t, _, all) => !all.some((o) => o.from.id === t.to.id && o.to.id === t.from.id && o.from.id < t.from.id));
    const follows = db.prepare(`SELECT f.follower_id, f.followed_id, a.name AS a_name, b.name AS b_name, a.user_id AS a_user, b.user_id AS b_user
      FROM character_follows f JOIN characters a ON a.id = f.follower_id JOIN characters b ON b.id = f.followed_id
      WHERE substr(f.created_at, 1, 10) = :day AND a.user_id != b.user_id ORDER BY f.created_at DESC LIMIT 8`).all(dayOnly)
      .filter((f) => !blockedEither(user.id, f.a_user) && !blockedEither(user.id, f.b_user))
      .map((f) => ({ from: { id: f.follower_id, name: f.a_name }, to: { id: f.followed_id, name: f.b_name } }));
    // Episodes that started, or were finished, that day (in stories the reader can see).
    const episodes = db.prepare(`SELECT ch.id, ch.name, ch.story_id, ch.status, ch.summary, s.title AS story_title,
        CASE WHEN substr(ch.created_at, 1, 10) = :day THEN 'new' ELSE 'active' END AS what
      FROM channels ch JOIN stories s ON s.id = ch.story_id
      WHERE ch.kind != 'ooc' AND ${VISIBLE} AND (substr(ch.created_at, 1, 10) = :day OR substr(ch.last_post_at, 1, 10) = :day)
      ORDER BY ch.last_post_at DESC LIMIT 8`).all(args)
      .map((e) => ({ id: e.id, name: e.name, storyId: e.story_id, storyTitle: e.story_title, what: e.status === 'complete' ? 'finished' : e.what, summary: plainText(e.summary || '', 160) }));
    // Birthdays and public plans on that date.
    const [, mm, dd] = day.split('-').map(Number);
    const birthdays = db.prepare("SELECT id, name, avatar, color, user_id, dossier FROM characters WHERE dossier LIKE '%birthday%'").all()
      .filter((c) => !blockedEither(user.id, c.user_id))
      .filter((c) => { const b = parseBirthday(parse(c.dossier).facts?.birthday); return b && b.month === mm && b.day === dd; })
      .map((c) => ({ id: c.id, name: c.name, avatar: c.avatar, color: c.color }));
    const plans = db.prepare(`SELECT pl.title, pl.kind, pl.location, pl.starts_at, pl.all_day, c.id AS cid, c.name AS c_name, c.user_id AS c_user
      FROM plans pl JOIN characters c ON c.id = pl.character_id
      WHERE pl.private = 0 AND substr(pl.starts_at, 1, 10) = :day ORDER BY pl.starts_at LIMIT 12`).all(dayOnly)
      .filter((p) => !blockedEither(user.id, p.c_user))
      .map((p) => ({ title: p.title, kind: p.kind, location: p.location, at: p.starts_at, allDay: !!p.all_day, character: { id: p.cid, name: p.c_name } }));
    // Numbers for the day (texts are private, so only how many).
    const n = (sql) => db.prepare(sql).get(dayOnly).n;
    const stats = {
      posts: n('SELECT COUNT(*) AS n FROM social_posts WHERE substr(created_at, 1, 10) = :day'),
      comments: n('SELECT COUNT(*) AS n FROM social_comments WHERE substr(created_at, 1, 10) = :day'),
      texts: n("SELECT COUNT(*) AS n FROM phone_messages WHERE substr(created_at, 1, 10) = :day AND kind = 'text'"),
      calls: n("SELECT COUNT(*) AS n FROM phone_messages WHERE substr(created_at, 1, 10) = :day AND kind = 'call'"),
    };
    return { data: { day, today, stories, gossip, ties, follows, episodes, birthdays, plans, stats } };
  });
}
