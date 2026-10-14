// THE : NU — everything happening in NUUVI, laid out like an Instagram feed: one column of posts,
// newest first, in the order they were made. Character posts, open episodes, self paras, events
// and connections (muse ideas anyone can pick up) all share the same post shape.
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, formatPost, timeAgo, applyColors, gradAttr, userGrad, uploadImage, askImageLink } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive, kindIcon } from '../main.js';
import { socialCard, bindSocial, openSocialComposer, styleBars, handleOf, nameBadge, agoShort } from './social.js';

const ONE = { thread: 'Episode', para: 'Self para', event: 'Event', comms: 'Comms', ooc: 'OOC' };
const FILTERS = [['all', 'All'], ['social', 'Posts'], ['open', 'Episodes'], ['connection', 'Connections'], ['event', 'Events']];
const parseDate = (d) => new Date(String(d).includes('T') ? d : `${String(d).replace(' ', 'T')}Z`);

// Posts that come from a writer (connections, episodes): their picture, display name and @username.
const writerHead = (u, sub) => html`
  <a class="np-av" href="#/u/${u.id}">${avatar({ name: u.displayName, src: u.avatar, color: '#EE719E', size: 'sm' })}</a>
  <div class="np-id">
    <div class="np-line"><a class="np-who" href="#/u/${u.id}"><span class="sp-name u-grad"${userGrad(u)}>${u.displayName}</span></a><span class="np-user">@${u.username}</span></div>
    <span class="np-sub">${sub}</span>
  </div>`;

// An episode or self para, as a post: the story as the poster, the cover as the picture.
function threadPost(it) {
  // The episode's own picture first; the story's header only when the episode has none.
  const pic = it.banner || it.story.banner || it.starter?.portrait || it.starter?.avatar;
  return html`
    <article class="np np-thread-post" data-color="${it.story.color}">
      <header class="np-head">
        ${it.author ? writerHead(it.author, html`${kindIcon(it.kind)} ${ONE[it.kind] || 'Episode'} in <a href="#/s/${it.storyId}">${it.story.title}</a> · ${agoShort(it.createdAt)}`) : html`
        <a class="np-av story" href="#/s/${it.storyId}">${avatar({ name: it.story.title, src: it.story.icon, color: it.story.color, size: 'sm' })}</a>
        <div class="np-id">
          <div class="np-line"><a class="np-who" href="#/s/${it.storyId}">${it.story.title}</a><span class="np-dot">•</span><span class="np-ago">${agoShort(it.createdAt)}</span></div>
          <span class="np-sub">${kindIcon(it.kind)} ${ONE[it.kind] || 'Episode'}${it.status === 'open' ? ' · open to join' : ''}</span>
        </div>`}
      </header>
      <a class="np-media np-cover ${pic ? '' : 'no-img'}" href="#/s/${it.storyId}/${it.id}">
        ${pic ? html`<img src="${pic}" alt="" loading="lazy">` : ''}
        <span class="np-cover-title"><small>${it.season ? `Season ${it.season} · ` : ''}${ONE[it.kind] || 'Episode'}</small>${it.name}</span>
        ${it.location ? html`<span class="np-loc">${icons.pin} ${it.location}</span>` : ''}
        ${it.unread ? html`<span class="car-count">${it.unread} new</span>` : ''}
      </a>
      <div class="np-actions">
        <a class="np-act" href="#/s/${it.storyId}/${it.id}" aria-label="Read">${icons.episode}</a>
        ${it.participants.length ? html`<span class="np-with">${it.participants.slice(0, 3).map((c) => avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' }))}<span>with ${it.participants.slice(0, 2).map((c) => c.name).join(', ')}${it.participants.length > 2 ? ` +${it.participants.length - 2}` : ''}</span></span>` : ''}
        <a class="btn sm np-cta" href="#/s/${it.storyId}/${it.id}">${it.status === 'open' ? 'Join in' : 'Read'}</a>
      </div>
      <div class="np-caption"><b>${it.name}</b> ${it.summary || (it.lastPost ? html`<span class="muted">${it.lastPost.by}: ${it.lastPost.text}</span>` : '')}</div>
      ${it.tags.length ? html`<div class="np-tags">${it.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <span class="np-time">${it.postCount} ${it.postCount === 1 ? 'post' : 'posts'} · ${timeAgo(it.createdAt)}</span>
    </article>`;
}

function eventPost(e) {
  const d = new Date(e.startsAt);
  const pic = e.banner || e.story.banner;
  return html`
    <article class="np np-event-post" data-color="${e.story.color}">
      <header class="np-head">
        <a class="np-av story" href="#/s/${e.story.id}">${avatar({ name: e.story.title, src: e.story.icon, color: e.story.color, size: 'sm' })}</a>
        <div class="np-id">
          <div class="np-line"><a class="np-who" href="#/e/${e.id}">${e.story.title}</a><span class="np-dot">•</span><span class="np-ago">${agoShort(e.createdAt)}</span></div>
          <span class="np-sub">${icons.calendar} Event${e.location ? ` · ${e.location}` : ''}</span>
        </div>
      </header>
      <a class="np-media np-cover ${pic ? '' : 'no-img'}" href="#/e/${e.id}">
        ${pic ? html`<img src="${pic}" alt="" loading="lazy">` : ''}
        <span class="np-date"><small>${d.toLocaleDateString(undefined, { month: 'short' })}</small><b>${d.getDate()}</b></span>
        <span class="np-cover-title"><small>${d.toLocaleString(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}</small>${e.title}</span>
      </a>
      <div class="np-actions">
        <a class="np-act" href="#/e/${e.id}" aria-label="Open event">${icons.calendar}</a>
        <span class="np-with">${e.threadCount} ${e.threadCount === 1 ? 'episode' : 'episodes'}</span>
        <a class="btn sm np-cta" href="#/e/${e.id}">See event</a>
      </div>
      ${e.summary ? html`<div class="np-caption"><b>${e.title}</b> ${e.summary}</div>` : ''}
      <span class="np-time">${timeAgo(e.createdAt)}</span>
    </article>`;
}

// A connection: the muse who wants someone, what they're looking for, and whether it's still open.
export function connectionPost(k) {
  const ch = k.character;
  const mineToo = k.userId === state.user.id;
  return html`
    <article class="np np-conn ${k.takenBy ? 'taken' : ''}" data-conn="${k.id}" data-color="${ch.color}"${gradAttr(ch)}>
      <header class="np-head">
        ${writerHead(k.author || { id: k.userId, displayName: 'A writer', username: '' }, html`${icons.link} Connection for <a href="#/c/${ch.id}" class="np-handle c-name" data-color="${ch.color}"${gradAttr(ch)}>${handleOf(ch)}</a> · ${agoShort(k.createdAt)}`)}
        ${mineToo || k.takenBy?.userId === state.user.id || state.user.isAdmin ? html`<button class="icon-btn sm np-more" data-k="more" aria-label="Connection options">${icons.more}</button>` : ''}
      </header>
      <div class="np-media np-conn-card ${k.media.length ? '' : 'no-img'}">
        ${k.media[0] ? html`<img src="${k.media[0]}" alt="" loading="lazy">` : ''}
        <span class="np-conn-label">${k.takenBy ? html`${icons.lock} Taken` : 'Looking for…'}</span>
        <span class="np-cover-title">${k.title}</span>
      </div>
      <div class="np-actions">
        ${k.takenBy ? html`<span class="np-lock">${icons.lock} Picked up by ${k.takenBy.user ? html`<a href="#/u/${k.takenBy.user.id}">${k.takenBy.user.displayName}</a> for ` : ''}<a href="#/c/${k.takenBy.character.id}">${handleOf(k.takenBy.character)}</a></span>`
          : mineToo ? html`<span class="np-with muted">Waiting for someone to pick it up</span>`
          : html`<button type="button" class="primary sm np-cta" data-k="take">Pick it up</button>`}
      </div>
      ${k.body ? html`<div class="np-caption">${k.author ? html`<a class="np-handle" href="#/u/${k.author.id}">${k.author.username}</a> ` : ''}<span class="body">${formatPost(k.body)}</span></div>` : ''}
      ${k.tags.length ? html`<div class="np-tags">${k.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <span class="np-time">${timeAgo(k.createdAt)}</span>
    </article>`;
}

// Pick up a connection: choose which of your muses it's for.
async function takeConnection(k) {
  const mine = await myCharacters();
  if (!mine.length) return toast('Create a character first');
  const res = await modal(html`<form>
    <span class="eyebrow">Pick up a connection</span>
    <h2>${k.title}</h2>
    <p class="muted small">From ${k.author ? k.author.displayName : 'a writer'}, for ${handleOf(k.character)}. Once you pick it up it's locked for everyone else.</p>
    <label for="k-as">Which muse is this for?</label>
    <select id="k-as" name="characterId">${mine.map((c) => html`<option value="${c.id}">${c.name}${c.handle ? ` (@${c.handle})` : ''}</option>`)}</select>
    <div class="error"></div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Pick it up</button></div>
  </form>`, { submit: async (data) => (await api(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: Number(data.characterId) } })).connection });
  return res;
}

// Put a new connection out on THE : NU.
export async function openConnectionComposer() {
  const mine = await myCharacters(true);
  if (!mine.length) { toast('Create a character first'); return null; }
  const pics = [];
  return modal(html`<form class="conn-form">
    <span class="eyebrow">New connection</span>
    <h2>Looking for someone?</h2>
    <p class="muted small">Put out an idea for your muse. Anyone can pick it up for one of theirs; then it locks.</p>
    <label for="k-char">Which muse is it for?</label>
    <select id="k-char" name="characterId">${mine.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
    <label for="k-title">What are you looking for?</label>
    <input id="k-title" name="title" maxlength="140" required placeholder="the ex who still has my hoodie">
    <label for="k-body">Details</label>
    <textarea id="k-body" name="body" rows="5" maxlength="8000" placeholder="History, vibe, what you'd love to write… (formatting works)"></textarea>
    <label for="k-tags">Tags</label>
    <input id="k-tags" name="tags" maxlength="200" placeholder="ex, angst, enemies to lovers">
    <div class="row-inline"><label class="btn sm file-btn">${icons.image} Add a picture<input type="file" accept="image/*" id="k-file" hidden></label><button type="button" class="sm" id="k-link">Picture link</button><span class="hint" id="k-pics"></span></div>
    <div class="error"></div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Post connection</button></div>
  </form>`, {
    init: (d) => {
      const show = () => { $('#k-pics', d).textContent = pics.length ? `${pics.length} picture${pics.length === 1 ? '' : 's'} added ✓` : ''; };
      $('#k-file', d).addEventListener('change', async (e) => { try { pics.push(await uploadImage(e.target.files[0], 1600)); show(); } catch (err) { toast(err.message); } });
      $('#k-link', d).addEventListener('click', async () => { const u = await askImageLink(); if (u) { pics.push(u); show(); } });
    },
    submit: async (data) => (await api('/api/connections', { method: 'POST', body: { ...data, characterId: Number(data.characterId), media: pics } })).connection,
  });
}

export async function viewNu() {
  const alive = routeAlive();
  let filter = sessionStorage.getItem('nuuvi:nu-filter') || 'all';
  if (!FILTERS.some(([k]) => k === filter)) filter = 'all';
  const mine = await myCharacters(true);
  ensureAlive(alive);
  const body = page({
    alive,
    title: 'THE : NU',
    className: 'nu-body',
    actions: html`<button class="primary sm" id="nu-new">${icons.plus}<span class="lbl">New</span></button>`,
    body: html`
      <div class="nu-layout">
        <div class="nu-col">
          <div class="nu-stories no-swipe" id="nu-stories"></div>
          <div class="nu-tools no-swipe">
            <div class="chips scroll-x" role="tablist">${FILTERS.map(([k, label]) => html`<button class="chip-btn" data-f="${k}" aria-pressed="${k === filter}">${label}</button>`)}</div>
          </div>
          <div id="nu-list" class="nu-list"></div>
        </div>
        <aside class="nu-side">
          <a class="nu-me" href="#/u/${state.user.id}">${avatar({ name: state.user.displayName, src: state.user.avatar, color: '#EE719E' })}<span><b>${state.user.username}</b><small>${state.user.displayName}</small></span></a>
          ${mine.length ? html`<div class="nu-side-head"><span>Your cast</span><a href="#/characters">See all</a></div>
            ${mine.slice(0, 6).map((c) => html`<a class="nu-side-row" href="#/c/${c.id}">${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}<span><b>${c.handle || c.name}</b><small>${c.name}</small></span></a>`)}` : ''}
          <div class="nu-side-head"><span>Share something</span></div>
          <button class="nu-side-btn" data-new="post">${icons.image} New post</button>
          <button class="nu-side-btn" data-new="connection">${icons.link} New connection</button>
          <p class="nu-foot">THE : NU · everything in NUUVI, newest first</p>
        </aside>
      </div>`,
  });
  const list = $('#nu-list', body);
  const social = new Map();
  const conns = new Map();
  const load = async () => {
    const { items } = await api(`/api/feed?filter=${filter}`);
    ensureAlive(alive);
    social.clear(); conns.clear();
    for (const it of items) { if (it.type === 'social') social.set(it.id, it); if (it.type === 'connection') conns.set(it.id, it); }
    // Story bubbles: the characters who posted most recently.
    const seen = new Map();
    for (const it of items) if (it.type === 'social' && !seen.has(it.character.id)) seen.set(it.character.id, it.character);
    render($('#nu-stories', body), seen.size ? html`${[...seen.values()].slice(0, 14).map((c) => html`
      <a class="nu-story" href="#/c/${c.id}"><span class="ring">${avatar({ name: c.name, src: c.avatar, color: c.color })}</span><small>${c.handle || c.name}</small></a>`)}` : '');
    render(list, items.length ? html`${items.map((it) => (it.type === 'social' ? socialCard(it) : it.type === 'event' ? eventPost(it) : it.type === 'connection' ? connectionPost(it) : threadPost(it)))}`
      : html`<div class="empty"><p>Nothing on THE : NU yet.</p><p class="small">Make a post, put out a connection, or start an episode.</p></div>`);
    styleBars(list);
    applyColors(list);
  };
  bindSocial(list, social, (p) => {
    social.set(p.id, p);
    const el = list.querySelector(`[data-social="${p.id}"]`);
    if (el) { el.outerHTML = socialCard(p).v; applyColors(list); styleBars(list); }
  });
  const redrawConn = (k) => {
    conns.set(k.id, k);
    const el = list.querySelector(`[data-conn="${k.id}"]`);
    if (el) { el.outerHTML = connectionPost(k).v; applyColors(list); }
  };
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = conns.get(Number(b.closest('[data-conn]').dataset.conn));
    if (b.dataset.k === 'take') { const taken = await takeConnection(k); if (taken) { redrawConn(taken); toast('Picked up — it\'s yours'); } }
    if (b.dataset.k === 'more') {
      menu(b, [
        k.takenBy && { label: 'Open it up again', action: async () => redrawConn((await api(`/api/connections/${k.id}/release`, { method: 'POST', body: {} })).connection) },
        (k.userId === state.user.id || state.user.isAdmin) && { label: 'Delete connection', danger: true, action: async () => {
          if (!(await confirmModal('Delete this connection?', { ok: 'Delete', danger: true }))) return;
          await api(`/api/connections/${k.id}`, { method: 'DELETE' });
          b.closest('[data-conn]').remove();
        } },
      ]);
    }
  });
  const create = async (what) => {
    const made = what === 'connection' ? await openConnectionComposer() : await openSocialComposer();
    if (made) load();
  };
  $('#main #nu-new').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'New post', action: () => create('post') },
    { label: 'New connection', action: () => create('connection') },
  ]));
  body.addEventListener('click', (e) => { const n = e.target.closest('[data-new]'); if (n) create(n.dataset.new); });
  $$('[data-f]', body).forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    try { sessionStorage.setItem('nuuvi:nu-filter', filter); } catch { /* ignore */ }
    $$('[data-f]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    list.classList.remove('swap'); void list.offsetWidth; list.classList.add('swap');
    load().catch((err) => toast(err.message));
  }));
  await load();
}
