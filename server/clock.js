// The date in Ardell City. An admin can leave it on the real date, fix it to a date of their choice,
// or start it on a date and let it move on by one day every N real days (a slower story clock).
// Times of day always follow the real clock; only the date changes.
const DAY = 86400000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readClock(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'clock'").get();
  let c = {};
  try {
    c = row ? JSON.parse(row.value) : {};
  } catch {
    c = {};
  }
  const mode = ['fixed', 'timer'].includes(c.mode) && DATE.test(c.date || '') ? c.mode : 'real';
  return {
    mode,
    date: mode === 'real' ? null : c.date,
    anchor: Number(c.anchor) || Date.now(),
    every: Math.min(365, Math.max(1, Number(c.every) || 2)),
  };
}

export function writeClock(db, { mode, date, every }) {
  const c = {
    mode: ['fixed', 'timer'].includes(mode) ? mode : 'real',
    date: DATE.test(date || '') ? date : null,
    anchor: Date.now(),
    every: Math.min(365, Math.max(1, Math.round(Number(every) || 2))),
  };
  if (c.mode !== 'real' && !c.date) throw Object.assign(new Error('Pick a date'), { status: 400 });
  db.prepare("INSERT INTO settings (key, value) VALUES ('clock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    JSON.stringify(c),
  );
  return readClock(db);
}

// Today's date in Ardell City as YYYY-MM-DD (UTC calendar), at real time `now`.
export function storyDate(clock, now = Date.now()) {
  if (clock.mode === 'real') return new Date(now).toISOString().slice(0, 10);
  const start = Date.parse(`${clock.date}T00:00:00Z`);
  const days = clock.mode === 'timer' ? Math.floor((now - clock.anchor) / (clock.every * DAY)) : 0;
  return new Date(start + Math.max(0, days) * DAY).toISOString().slice(0, 10);
}

// "Now" in Ardell City as SQLite text: the story date with the real time of day. Null when the
// clock is on the real date (so the database's own datetime('now') is used).
export function storyNowSql(clock, now = Date.now()) {
  if (clock.mode === 'real') return null;
  const real = new Date(now).toISOString();
  return `${storyDate(clock, now)} ${real.slice(11, 19)}`;
}

// What the browser needs to work out the same date itself.
export const publicClock = (clock, now = Date.now()) => ({ ...clock, today: storyDate(clock, now), serverNow: now });
