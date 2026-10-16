// Ties (who a character is to whom), a character's Timeline, and The Ardell Daily (the city's paper).
import { html, raw, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal } from '../lib.js';
import { page, routeAlive, ensureAlive } from '../main.js';
import { compact } from './social.js';

export const TIE_NAMES = {
  partner: 'Partner', crush: 'Crush', ex: 'Ex', bestfriend: 'Best friend', friend: 'Friend', sibling: 'Sibling',
  family: 'Family', parent: 'Parent', child: 'Child', rival: 'Rival', enemy: 'Enemy', coworker: 'Coworker',
  roommate: 'Roommate', mentor: 'Mentor', complicated: "It's complicated", other: 'Other',
};
// One colour per kind, so the web reads at a glance.
const TIE_COLORS = {
  partner: '#E0446A', crush: '#F07AA0', ex: '#8A8F98', bestfriend: '#F2A93B', friend: '#4FA3E0', sibling: '#3DBE8B',
  family: '#2E9E6E', parent: '#2E9E6E', child: '#2E9E6E', rival: '#E07B39', enemy: '#C8382F', coworker: '#7C8794',
  roommate: '#56B6C2', mentor: '#9C7AE0', complicated: '#B5655A', other: '#9AA0A6',
};
const tieName = (t) => t.label || TIE_NAMES[t.kind] || t.kind;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const niceDate = (d) => { const [y, m, day] = d.slice(0, 10).split('-').map(Number); return `${MONTHS[m - 1]} ${day}, ${y}`; };

// ---------- Ties ----------
// The web: the character in the middle, everyone they're tied to around them.
function tieWeb(c, ties) {
  const W = 320, R = 118, mid = W / 2;
  const n = ties.length;
  const spots = ties.map((t, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { t, x: mid + Math.cos(a) * R, y: mid + Math.sin(a) * R };
  });
  const svg = `<svg class="tie-web" viewBox="0 0 ${W} ${W}" role="img" aria-label="${c.name.replace(/"/g, '')}'s ties">
    ${spots.map((s) => `<line x1="${mid}" y1="${mid}" x2="${s.x.toFixed(1)}" y2="${s.y.toFixed(1)}" stroke="${TIE_COLORS[s.t.kind] || '#999'}" stroke-width="${s.t.mutual ? 3 : 1.6}" ${s.t.mutual ? '' : 'stroke-dasharray="5 4"'}/>`).join('')}
  </svg>`;
  return html`<div class="tie-stage">
    ${raw(svg)}
    <span class="tie-node center" data-x="50" data-y="50">${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'lg' })}</span>
    ${spots.map((s) => html`<a class="tie-node" href="#/c/${s.t.other.id}" data-x="${(s.x / W * 100).toFixed(2)}" data-y="${(s.y / W * 100).toFixed(2)}" title="${s.t.other.name}">
      ${avatar({ name: s.t.other.name, src: s.t.other.avatar, color: s.t.other.color, size: 'sm' })}
      <small data-tie="${s.t.kind}">${tieName(s.t)}</small></a>`)}
  </div>`;
}

async function tieForm(c, tie = null) {
  let pick = tie?.other ?? null;
  let everyone = [];
  try {
    const { writers } = await api('/api/directory');
    everyone = writers.flatMap((w) => w.characters.map((x) => ({ ...x, writer: w.username }))).filter((x) => x.id !== c.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* the picker just stays empty */ }
  return modal(html`
    <form class="tie-form">
      <h2>${tie ? `${c.name} and ${tie.other.name}` : `Add a tie for ${c.name}`}</h2>
      ${tie ? '' : html`
        <label for="tf-q">Who</label>
        <input type="search" class="search" id="tf-q" placeholder="Search characters…" autocomplete="off">
        <div class="pc-list tf-list" id="tf-list"></div>`}
      <label for="tf-kind">They are ${c.name}'s</label>
      <select id="tf-kind" name="kind">${Object.entries(TIE_NAMES).map(([k, v]) => html`<option value="${k}" ${(tie?.kind ?? 'friend') === k ? 'selected' : ''}>${v}</option>`)}</select>
      <label for="tf-label">Your own word for it <span class="muted small">(optional)</span></label>
      <input id="tf-label" name="label" maxlength="40" value="${tie?.label ?? ''}" placeholder="e.g. ride or die, the one that got away">
      <label for="tf-since">Since <span class="muted small">(optional)</span></label>
      <input id="tf-since" name="since" type="date" value="${tie?.since ?? ''}">
      <label for="tf-note">A note <span class="muted small">(optional)</span></label>
      <textarea id="tf-note" name="note" maxlength="300" rows="3" placeholder="How they met, what happened…">${tie?.note ?? ''}</textarea>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${tie ? 'Save' : 'Add tie'}</button></div>
    </form>`, {
    init: (d) => {
      const list = $('#tf-list', d);
      if (!list) return;
      const draw = (q = '') => {
        const shown = everyone.filter((x) => !q || `${x.name} ${x.handle} ${x.writer}`.toLowerCase().includes(q)).slice(0, 60);
        render(list, shown.length ? html`${shown.map((x) => html`
          <button type="button" class="pc-item ${pick?.id === x.id ? 'on' : ''}" data-pick="${x.id}" aria-pressed="${pick?.id === x.id}">
            ${avatar({ name: x.name, src: x.avatar, color: x.color, size: 'sm' })}<span class="grow"><b>${x.name}</b><small>@${x.handle} · ${x.writer}</small></span><span class="pc-check">${pick?.id === x.id ? '✓' : ''}</span></button>`)}`
          : html`<p class="muted small">No one matches.</p>`);
      };
      draw();
      $('#tf-q', d).addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        pick = everyone.find((x) => x.id === Number(b.dataset.pick));
        draw($('#tf-q', d).value.trim().toLowerCase());
      });
    },
    submit: async (data) => {
      if (!pick) throw new Error('Pick who the tie is with');
      await api(`/api/characters/${c.id}/ties/${pick.id}`, { method: 'PUT', body: { kind: data.kind, label: data.label, note: data.note, since: data.since || null } });
      return true;
    },
  });
}

export function drawTies(pane, c, { own, isAlive = () => true }) {
  render(pane, html`<p class="muted small ig-loading">Loading…</p>`);
  const load = async () => {
    let r;
    try { r = await api(`/api/characters/${c.id}/ties`); } catch (err) { if (isAlive()) render(pane, html`<div class="empty"><p>${err.message}</p></div>`); return; }
    if (!isAlive()) return;
    const { ties, incoming } = r;
    render(pane, html`
      ${own ? html`<div class="tie-bar"><button class="primary" id="tie-add">${icons.plus} Add a tie</button></div>` : ''}
      ${ties.length ? tieWeb(c, ties) : html`<div class="empty"><p>No ties yet.</p><p class="small muted">${own ? `Add the people who matter to ${c.name}: best friends, exes, rivals, family.` : `${c.name}'s writer hasn't added anyone yet.`}</p></div>`}
      ${ties.length ? html`<ul class="tie-list">${ties.map((t, i) => html`
        <li class="tie-row">
          <a href="#/c/${t.other.id}">${avatar({ name: t.other.name, src: t.other.avatar, color: t.other.color, size: 'sm' })}</a>
          <div class="grow">
            <a class="tie-who" href="#/c/${t.other.id}"><b>${t.other.name}</b></a>
            <div class="tie-what"><span class="tie-chip" data-tie="${t.kind}">${tieName(t)}</span>
              ${t.mutual ? html`<span class="small muted">${t.mutual.kind === t.kind && !t.mutual.label ? 'both ways' : `they say: ${tieName(t.mutual)}`}</span>` : html`<span class="small muted">one way</span>`}
              ${t.since ? html`<span class="small muted">· since ${niceDate(t.since)}</span>` : ''}</div>
            ${t.note ? html`<p class="small tie-note">${t.note}</p>` : ''}
          </div>
          ${own ? html`<button class="icon-btn" data-tie-more="${i}" aria-label="Change this tie">${icons.more}</button>` : ''}
        </li>`)}</ul>` : ''}
      ${incoming.length ? html`<h3 class="tie-h">Also tied to ${c.name}</h3>
        <ul class="tie-list">${incoming.map((t) => html`<li class="tie-row">
          <a href="#/c/${t.from.id}">${avatar({ name: t.from.name, src: t.from.avatar, color: t.from.color, size: 'sm' })}</a>
          <div class="grow"><a class="tie-who" href="#/c/${t.from.id}"><b>${t.from.name}</b></a>
            <div class="tie-what"><span class="small muted">calls ${c.name} their</span> <span class="tie-chip" data-tie="${t.kind}">${tieName(t)}</span></div></div>
          ${own ? html`<button class="ghost small-btn" data-tie-back="${t.from.id}">Add back</button>` : ''}
        </li>`)}</ul>` : ''}`);
    // Node spots and chip colours come from data attributes (no inline styles allowed).
    $$('.tie-node', pane).forEach((n) => { n.style.setProperty('left', `${n.dataset.x}%`); n.style.setProperty('top', `${n.dataset.y}%`); });
    $$('[data-tie]', pane).forEach((n) => n.style.setProperty('--tc', TIE_COLORS[n.dataset.tie] || '#999'));
    $('#tie-add', pane)?.addEventListener('click', async () => { if (await tieForm(c)) { toast('Tie added'); load(); } });
    $$('[data-tie-more]', pane).forEach((b) => b.addEventListener('click', () => {
      const t = ties[Number(b.dataset.tieMore)];
      menu(b, [
        { label: 'Edit', action: async () => { if (await tieForm(c, t)) { toast('Saved'); load(); } } },
        { label: 'Remove', danger: true, action: async () => {
          if (!await confirmModal(`Remove ${t.other.name} from ${c.name}'s ties?`, { ok: 'Remove', danger: true })) return;
          try { await api(`/api/characters/${c.id}/ties/${t.other.id}`, { method: 'DELETE' }); load(); } catch (err) { toast(err.message); }
        } },
      ]);
    }));
    $$('[data-tie-back]', pane).forEach((b) => b.addEventListener('click', async () => {
      const t = incoming.find((x) => x.from.id === Number(b.dataset.tieBack));
      if (await tieForm(c, { other: t.from, kind: t.kind, label: '', note: '', since: t.since })) { toast('Tie added'); load(); }
    }));
  };
  load();
}

// ---------- Timeline ----------
const TL_ICON = { post: icons.image, musing: icons.quill, episode: icons.episode, finished: icons.check, plan: icons.calendar, tie: icons.ties, arrived: icons.star };
function tlLine(it) {
  switch (it.type) {
    case 'post': return html`Posted${it.location ? html` at <b>${it.location}</b>` : ''}`;
    case 'musing': return 'Wrote a musing';
    case 'episode': return html`Joined <b>${it.text}</b>`;
    case 'finished': return html`Finished <b>${it.text}</b>`;
    case 'plan': return html`<b>${it.text}</b>`;
    case 'tie': return html`Became ${it.label ? html`<b>${it.label}</b> with` : html`<b>${(TIE_NAMES[it.kind] || it.kind).toLowerCase()}</b>${['ex', 'crush', 'complicated'].includes(it.kind) ? ' with' : 's with'}`} <b>${it.text}</b>`;
    default: return html`Arrived in Ardell City`;
  }
}

export function drawTimeline(pane, c, { isAlive = () => true } = {}) {
  render(pane, html`<p class="muted small ig-loading">Loading…</p>`);
  api(`/api/characters/${c.id}/timeline`).then(({ items, locked }) => {
    if (!isAlive()) return;
    // Group by month, newest first.
    const groups = [];
    for (const it of items) {
      const key = it.at.slice(0, 7);
      if (groups.at(-1)?.key !== key) groups.push({ key, items: [] });
      groups.at(-1).items.push(it);
    }
    const monthName = (k) => { const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
    render(pane, html`
      ${locked ? html`<p class="small muted tl-locked">${icons.lock} Posts are hidden: this account is private.</p>` : ''}
      <ol class="timeline">${groups.map((g) => html`
        <li class="tl-month"><h3>${monthName(g.key)}</h3>
          <ol>${g.items.map((it) => {
            const inner = html`<span class="tl-dot">${TL_ICON[it.type] || icons.star}</span>
              <span class="grow"><span class="tl-line">${tlLine(it)}</span>
                ${it.type === 'post' || it.type === 'musing' ? (it.text ? html`<span class="tl-text">${it.text}</span>` : '') : it.sub ? html`<span class="tl-text muted">${it.sub}</span>` : ''}
                <small class="muted">${niceDate(it.at)}</small></span>
              ${it.picture ? html`<img class="tl-pic" src="${it.picture}" alt="" loading="lazy">` : ''}`;
            return html`<li class="tl-item tl-${it.type}">${it.link ? html`<a href="${it.link}">${inner}</a>` : html`<div>${inner}</div>`}</li>`;
          })}</ol></li>`)}</ol>`);
  }).catch((err) => { if (isAlive()) render(pane, html`<div class="empty"><p>${err.message}</p></div>`); });
}

// ---------- The Ardell Daily ----------
const shiftDay = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export async function viewDaily(date) {
  const alive = routeAlive();
  const d = await api(`/api/daily${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  ensureAlive(alive);
  const [lead, ...more] = d.stories;
  const weekday = WEEKDAYS[new Date(`${d.day}T12:00:00Z`).getUTCDay()];
  const quiet = !d.stories.length && !d.ties.length && !d.follows.length && !d.episodes.length && !d.birthdays.length && !d.plans.length && !d.gossip.length;
  const who = (x) => html`<a href="#/c/${x.id}">${x.name}</a>`;
  const story = (p, big = false) => html`
    <a class="dl-story ${big ? 'lead' : ''} ${p.picture ? 'has-pic' : ''}" href="#/p/${p.id}">
      ${p.picture ? html`<img src="${p.picture}" alt="" loading="lazy">` : ''}
      <span class="dl-copy">
        <span class="dl-kicker">${p.character.name}${p.location ? ` · ${p.location}` : ''}</span>
        <span class="dl-head">${p.text || 'A new post'}</span>
        <small class="muted">${compact(p.score)} likes</small>
      </span>
    </a>`;
  const body = page({
    alive,
    title: 'The Ardell Daily',
    className: 'daily-page',
    body: html`
      <article class="daily">
        <header class="dl-mast">
          <nav class="dl-nav">
            <a class="icon-btn" href="#/daily/${shiftDay(d.day, -1)}" aria-label="The day before">${icons.caretLeft}</a>
            <span class="dl-date">${weekday}, ${niceDate(d.day)}${d.day === d.today ? ' · Today' : ''}</span>
            ${d.day < d.today ? html`<a class="icon-btn" href="#/daily/${shiftDay(d.day, 1)}" aria-label="The next day">${icons.caretRight}</a>` : html`<span class="dl-nav-gap" aria-hidden="true"></span>`}
          </nav>
          <h1 class="dl-title">The Ardell Daily</h1>
          <p class="dl-stats">${d.stats.posts} posts · ${d.stats.comments} comments · ${d.stats.texts} texts sent · ${d.stats.calls} calls made</p>
        </header>
        ${quiet ? html`<div class="empty"><p><b>A quiet day in Ardell City.</b></p><p class="small muted">Nothing made the paper. Try the day before, or post something.</p></div>` : ''}
        ${lead ? html`<section class="dl-front">${story(lead, true)}</section>` : ''}
        <div class="dl-cols">
          <div class="dl-main">
            ${more.length ? html`<section><h2 class="dl-h">Also in the feed</h2><div class="dl-more">${more.slice(0, 9).map((p) => story(p))}</div></section>` : ''}
            ${d.episodes.length ? html`<section><h2 class="dl-h">Episodes</h2><ul class="dl-list">${d.episodes.map((e) => html`
              <li><a href="#/s/${e.storyId}/${e.id}"><b>${e.name}</b></a> <span class="dl-tag">${({ new: 'New', active: 'Ongoing', finished: 'Finished' })[e.what]}</span>
                <small class="muted">${e.storyTitle}</small>${e.summary ? html`<p class="small">${e.summary}</p>` : ''}</li>`)}</ul></section>` : ''}
          </div>
          <aside class="dl-side">
            ${d.birthdays.length ? html`<section><h2 class="dl-h">Birthdays</h2><ul class="dl-list">${d.birthdays.map((b) => html`<li class="dl-person">${avatar({ name: b.name, src: b.avatar, color: b.color, size: 'xs' })} ${who(b)}</li>`)}</ul></section>` : ''}
            ${d.ties.length || d.follows.length ? html`<section><h2 class="dl-h">Spotted</h2><ul class="dl-list">
              ${d.ties.map((t) => html`<li>${who(t.from)} and ${who(t.to)}: <b>${t.label || (TIE_NAMES[t.kind] || t.kind).toLowerCase()}</b></li>`)}
              ${d.follows.map((f) => html`<li>${who(f.from)} followed ${who(f.to)}</li>`)}</ul></section>` : ''}
            ${d.plans.length ? html`<section><h2 class="dl-h">Around town</h2><ul class="dl-list">${d.plans.map((p) => html`
              <li><b>${p.title}</b> <small class="muted">${who(p.character)}${p.location ? ` · ${p.location}` : ''}${p.allDay ? '' : ` · ${p.at.slice(11, 16)}`}</small></li>`)}</ul></section>` : ''}
            ${d.gossip.length ? html`<section class="dl-gossip"><h2 class="dl-h">The gossip column</h2>${d.gossip.slice(0, 4).map((g) => html`<a href="#/p/${g.id}"><p>${g.text}</p></a>`)}</section>` : ''}
          </aside>
        </div>
      </article>`,
  });
  return body;
}
