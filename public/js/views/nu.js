// THE NU — everything happening in NUUVI, laid out like an Instagram feed: one column of posts,
// newest first, in the order they were made. Character posts, open episodes, self paras, events
// and connections (muse ideas anyone can pick up) all share the same post shape.
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, formatPost, timeAgo, applyColors, gradAttr, userGrad, uploadImage, askImageLink, logoMark } from '../lib.js';
import { state, page, myCharacters, playableCharacters, routeAlive, ensureAlive, kindIcon, previousHash } from '../main.js';
import { socialCard, bindSocial, openSocialComposer, styleBars, handleOf, nameBadge, agoShort } from './social.js';

const ONE = { thread: 'Episode', para: 'Self para', event: 'Event', comms: 'Comms', ooc: 'OOC' };
// The social feed comes first; episodes and the rest are a tap away.
const FILTERS = [['social', 'Feed'], ['open', 'Episodes'], ['musing', 'Musings'], ['connection', 'Connections'], ['event', 'Events'], ['all', 'Everything']];
const parseDate = (d) => new Date(String(d).includes('T') ? d : `${String(d).replace(' ', 'T')}Z`);

// Posts that come from a writer (connections, episodes): their picture, display name and @username.
const writerHead = (u, sub) => html`
  <a class="np-av" href="#/u/${u.id}">${avatar({ name: u.displayName, src: u.avatar, color: '#EE719E', size: 'sm' })}</a>
  <div class="np-id">
    <div class="np-line"><a class="np-who" href="#/u/${u.id}"><span class="sp-name u-grad"${userGrad(u)}>${u.displayName}</span></a><span class="np-user">@${u.username}</span></div>
    <span class="np-sub">${sub}</span>
  </div>`;

// An episode or self para, as a post: the story as the poster, the cover as the picture.
// How far along an episode is, like Netflix's red bar: it creeps forward with every post (fast at
// first, then slower) and only fills up when the episode is ended.
const progressOf = (it) => (it.status === 'complete' ? 1 : Math.min(0.92, 0.04 + 0.9 * (1 - Math.exp(-(it.postCount || 0) / 30))));

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
        ${it.status === 'complete' ? html`<span class="np-finished">${icons.check} Finished</span>` : ''}
        <span class="np-progress ${it.status === 'complete' ? 'done' : ''}" data-p="${progressOf(it).toFixed(3)}" role="progressbar" aria-label="Episode progress" aria-valuenow="${Math.round(progressOf(it) * 100)}" aria-valuemin="0" aria-valuemax="100"><i></i></span>
      </a>
      <div class="np-actions">
        <a class="np-act" href="#/s/${it.storyId}/${it.id}" aria-label="Read">${icons.episode}</a>
        ${it.participants.length ? html`<span class="np-with">${it.participants.slice(0, 3).map((c) => avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' }))}<span>with ${it.participants.slice(0, 2).map((c) => c.name).join(', ')}${it.participants.length > 2 ? ` +${it.participants.length - 2}` : ''}</span></span>` : ''}
        <a class="btn sm np-cta" href="#/s/${it.storyId}/${it.id}">${it.status === 'open' ? 'Join in' : it.status === 'complete' ? 'Rewatch' : 'Read'}</a>
      </div>
      <div class="np-caption"><b>${it.name}</b> ${it.summary || (it.lastPost ? html`<span class="muted">${it.lastPost.by}: ${it.lastPost.text}</span>` : '')}</div>
      ${it.tags.length ? html`<div class="np-tags">${it.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <span class="np-time">${it.postCount} ${it.postCount === 1 ? 'post' : 'posts'} · ${timeAgo(it.createdAt)}</span>
    </article>`;
}

// "Happy birthday" from NUUVI Official, pinned on a character's birthday.
const BDAY_LINES = [
  'Another year of iconic behaviour. Ardell City is celebrating you today.',
  'Cake, candles and a little chaos: today is all about you.',
  'The city lights are a little brighter tonight. Happy birthday!',
  'Make a wish (and make it dramatic).',
];
function birthdayPost(b) {
  const line = BDAY_LINES[(b.id + new Date().getFullYear()) % BDAY_LINES.length];
  return html`
    <article class="np np-bday" data-color="${b.color}"${gradAttr(b)}>
      <header class="np-head">
        <span class="np-av official">${logoMark}</span>
        <div class="np-id">
          <div class="np-line"><span class="np-who">nuuvi.official</span><span class="verified sm" title="Verified">${icons.verified}</span></div>
          <span class="np-sub">${icons.pin} Pinned · today</span>
        </div>
      </header>
      <a class="np-media np-bday-card" href="#/c/${b.id}">
        <span class="bday-confetti" aria-hidden="true">🎉 🎂 ✨ 🎈 🥂</span>
        <span class="bday-av">${avatar({ name: b.name, src: b.avatar, color: b.color })}</span>
        <span class="bday-title">Happy birthday,<br><b>${b.handle ? `@${b.handle}` : b.name}</b></span>
      </a>
      <div class="np-caption"><span class="np-handle">nuuvi.official</span> <span class="body">${line} 🎂 Drop your wishes for <a href="#/c/${b.id}">${b.name}</a> below.</span></div>
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
  const takers = k.takers || (k.takenBy ? [k.takenBy] : []);
  const slots = k.slots || 1;
  const imIn = takers.some((t) => t.userId === state.user.id);
  const label = k.full ? html`${icons.lock} ${slots > 1 ? 'Full' : 'Taken'}` : slots > 1 ? html`Looking for ${slots} · ${takers.length}/${slots}` : 'Looking for…';
  return html`
    <article class="np np-conn ${k.full ? 'taken' : ''}" data-conn="${k.id}" data-color="${ch.color}"${gradAttr(ch)}>
      <header class="np-head">
        ${writerHead(k.author || { id: k.userId, displayName: 'A writer', username: '' }, html`${icons.link} ${slots > 1 ? 'Group connection' : 'Connection'} for <a href="#/c/${ch.id}" class="np-handle c-name" data-color="${ch.color}"${gradAttr(ch)}>${handleOf(ch)}</a> · ${agoShort(k.createdAt)}`)}
        ${mineToo || imIn || state.user.isAdmin ? html`<button class="icon-btn sm np-more" data-k="more" aria-label="Connection options">${icons.more}</button>` : ''}
      </header>
      <div class="np-media np-conn-card ${k.media.length ? '' : 'no-img'}">
        ${k.media[0] ? html`<img src="${k.media[0]}" alt="" loading="lazy">` : ''}
        <span class="np-conn-label">${label}</span>
        <span class="np-cover-title">${k.title}</span>
      </div>
      ${slots > 1 ? html`<div class="np-slots" aria-label="${takers.length} of ${slots} spots taken">${Array.from({ length: slots }, (_, i) => html`<i class="${i < takers.length ? 'on' : ''}"></i>`)}</div>` : ''}
      <div class="np-actions">
        ${takers.length ? html`<span class="np-lock">${k.full ? icons.lock : icons.users} ${takers.map((t, i) => html`${i ? ', ' : ''}<a href="#/c/${t.character.id}">${handleOf(t.character)}</a>`)}${slots > 1 ? html` <span class="muted">· ${takers.length}/${slots}</span>` : ''}</span>` : ''}
        ${!k.full && !mineToo && !imIn ? html`<button type="button" class="primary sm np-cta" data-k="take">${slots > 1 ? 'Join' : 'Pick it up'}</button>`
          : !takers.length && mineToo ? html`<span class="np-with muted">Waiting for someone to pick it up</span>` : ''}
      </div>
      ${k.body ? html`<div class="np-caption">${k.author ? html`<a class="np-handle" href="#/u/${k.author.id}">${k.author.username}</a> ` : ''}<span class="body">${formatPost(k.body)}</span></div>` : ''}
      ${k.tags.length ? html`<div class="np-tags">${k.tags.map((t) => html`<span>#${t}</span>`)}</div>` : ''}
      <span class="np-time">${timeAgo(k.createdAt)}</span>
    </article>`;
}

// Pick up a connection: choose which of your muses it's for.
async function takeConnection(k) {
  const mine = await playableCharacters();
  if (!mine.length) return toast('Create a character first');
  const res = await modal(html`<form>
    <h2>Pick up “${k.title}”</h2>
    <p class="muted small">From ${k.author ? k.author.displayName : 'a writer'}, for ${handleOf(k.character)}. ${(k.slots || 1) > 1 ? `It needs ${k.slots} people; it locks when everyone's in.` : 'Once you pick it up it\'s locked for everyone else.'}</p>
    <label for="k-as">Which muse is this for?</label>
    <select id="k-as" name="characterId">${mine.map((c) => html`<option value="${c.id}">${c.name}${c.handle ? ` (@${c.handle})` : ''}</option>`)}</select>
    <div class="error"></div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Pick it up</button></div>
  </form>`, { submit: async (data) => (await api(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: Number(data.characterId) } })).connection });
  return res;
}

// Put a new connection out on THE NU, or edit one (`k`).
export async function openConnectionComposer(k = null) {
  const mine = await playableCharacters(true);
  if (!mine.length) { toast('Create a character first'); return null; }
  const pics = [...(k?.media || [])];
  const taken = k?.takers?.length || 0;
  return modal(html`<form class="conn-form">
    <h2>${k ? 'Edit connection' : 'New connection'}</h2>
    ${k ? '' : html`<p class="muted small">Put out an idea for your muse. Anyone can pick it up for one of theirs; it locks once everyone you need has joined.</p>`}
    <label for="k-char">Which muse is it for?</label>
    <select id="k-char" name="characterId">${mine.map((c) => html`<option value="${c.id}" ${k?.character?.id === c.id ? 'selected' : ''}>${c.name}</option>`)}</select>
    <label for="k-title">What are you looking for?</label>
    <input id="k-title" name="title" maxlength="140" required placeholder="the ex who still has my hoodie" value="${k?.title || ''}">
    <label for="k-body">Details</label>
    <textarea id="k-body" name="body" rows="5" maxlength="8000" placeholder="History, vibe, what you'd love to write… (formatting works)">${k?.body || ''}</textarea>
    <div class="row">
      <div><label for="k-slots">How many people?</label>
        <input id="k-slots" name="slots" type="number" min="${Math.max(1, taken)}" max="20" value="${k?.slots || 1}" inputmode="numeric"></div>
      <div><label for="k-tags">Tags</label>
        <input id="k-tags" name="tags" maxlength="200" placeholder="ex, angst, enemies to lovers" value="${(k?.tags || []).join(', ')}"></div>
    </div>
    <p class="hint">More than 1 makes it a group connection (a friend group, a band, a family…).</p>
    <div class="row-inline"><label class="btn sm file-btn">${icons.image} Add a picture<input type="file" accept="image/*" id="k-file" hidden></label><button type="button" class="sm" id="k-link">Picture link</button><span class="hint" id="k-pics"></span>
      <button type="button" class="sm" id="k-clear" ${pics.length ? '' : 'hidden'}>Remove pictures</button></div>
    <div class="error"></div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">${k ? 'Save' : 'Post connection'}</button></div>
  </form>`, {
    init: (d) => {
      const show = () => { $('#k-pics', d).textContent = pics.length ? `${pics.length} picture${pics.length === 1 ? '' : 's'} added ✓` : ''; $('#k-clear', d).hidden = !pics.length; };
      show();
      $('#k-file', d).addEventListener('change', async (e) => { try { pics.push(await uploadImage(e.target.files[0], 1600)); show(); } catch (err) { toast(err.message); } });
      $('#k-link', d).addEventListener('click', async () => { const u = await askImageLink(); if (u) { pics.push(u); show(); } });
      $('#k-clear', d).addEventListener('click', () => { pics.length = 0; show(); });
    },
    submit: async (data) => {
      const body = { ...data, characterId: Number(data.characterId), slots: Number(data.slots) || 1, media: pics };
      return k ? (await api(`/api/connections/${k.id}`, { method: 'PUT', body })).connection
        : (await api('/api/connections', { method: 'POST', body })).connection;
    },
  });
}

export async function viewNu(tagStr = null) {
  const alive = routeAlive();
  // #/nu/tag/<tag>: everything with that hashtag.
  const tag = tagStr ? decodeURIComponent(tagStr) : null;
  // Opening THE NU starts on the social feed. Coming back from a post or an episode keeps the tab you were on.
  const back = /^#\/(p|s|e|c)\//.test(previousHash() || '');
  let filter = (back && sessionStorage.getItem('nuuvi:nu-filter')) || 'social';
  if (!FILTERS.some(([k]) => k === filter)) filter = 'social';
  const mine = await myCharacters(true);
  ensureAlive(alive);
  const body = page({
    alive,
    title: tag ? `#${tag}` : 'THE NU',
    subtitle: tag ? 'Posts with this hashtag' : '',
    className: 'nu-body',
    actions: html`<button class="icon-btn sm only-mobile" id="nu-refresh" aria-label="Refresh">${icons.refresh}</button><button class="primary sm" id="nu-new">${icons.plus}<span class="lbl">New</span></button>`,
    body: html`
      <div class="nu-layout">
        <div class="nu-col">
          <div class="nu-stories no-swipe" id="nu-stories"></div>
          <div class="nu-tools no-swipe">
            <div class="chips scroll-x" role="tablist">${FILTERS.map(([k, label]) => html`<button class="chip-btn ${k === 'open' ? 'nu-ep-chip' : ''}" data-f="${k}" aria-pressed="${k === filter}">${k === 'open' ? icons.episode : ''}${label}</button>`)}</div>
          </div>
          <div id="nu-list" class="nu-list"></div>
        </div>
        <aside class="nu-side">
          <a class="nu-me" href="#/u/${state.user.id}">${avatar({ name: state.user.displayName, src: state.user.avatar, color: '#EE719E' })}<span><b>${state.user.username}</b><small>${state.user.displayName}</small></span></a>
          ${mine.length ? html`<div class="nu-side-head"><span>Your cast</span><a href="#/characters">See all</a></div>
            ${mine.slice(0, 6).map((c) => html`<a class="nu-side-row" href="#/c/${c.id}">${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}<span><b>${c.handle || c.name}</b><small>${c.name}</small></span></a>`)}` : ''}
          <div class="nu-side-head"><span>Share something</span></div>
          <button class="nu-side-btn" data-new="post">${icons.image} New post</button>
          <button class="nu-side-btn" data-new="musing">${icons.quill} New musing</button>
          <button class="nu-side-btn" data-new="connection">${icons.link} New connection</button>
          <p class="nu-foot">THE NU · everything in NUUVI, newest first</p>
        </aside>
      </div>`,
  });
  const list = $('#nu-list', body);
  let birthdays = null;
  const social = new Map();
  const conns = new Map();
  const load = async () => {
    const { items } = await api(`/api/feed?filter=${filter}${tag ? `&q=${encodeURIComponent(`#${tag}`)}` : ''}`);
    ensureAlive(alive);
    social.clear(); conns.clear();
    for (const it of items) { if (it.type === 'social') social.set(it.id, it); if (it.type === 'connection') conns.set(it.id, it); }
    // Story bubbles: the characters who posted most recently.
    const seen = new Map();
    for (const it of items) if (it.type === 'social' && !seen.has(it.character.id)) seen.set(it.character.id, it.character);
    render($('#nu-stories', body), seen.size ? html`${[...seen.values()].slice(0, 14).map((c) => html`
      <a class="nu-story" href="#/c/${c.id}"><span class="ring">${avatar({ name: c.name, src: c.avatar, color: c.color })}</span><small>${c.handle || c.name}</small></a>`)}` : '');
    // Birthdays today: a post from NUUVI Official, pinned to the top for the whole day.
    birthdays ??= (await api('/api/birthdays').catch(() => ({ birthdays: [] }))).birthdays;
    const now = new Date();
    const today = tag || filter === 'connection' || filter === 'event' ? [] : birthdays.filter((b) => b.month === now.getMonth() + 1 && b.day === now.getDate());
    render(list, items.length || today.length ? html`${today.map(birthdayPost)}${items.map((it) => (it.type === 'social' ? socialCard(it) : it.type === 'event' ? eventPost(it) : it.type === 'connection' ? connectionPost(it) : threadPost(it)))}`
      : html`<div class="empty"><p>Nothing on THE NU yet.</p><p class="small">Make a post, put out a connection, or start an episode.</p></div>`);
    styleBars(list);
    applyColors(list);
    // Progress bars: their width comes from the episode (set here, since inline styles aren't allowed).
    for (const bar of list.querySelectorAll('.np-progress[data-p]')) bar.style.setProperty('--p', bar.dataset.p);
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
    if (b.dataset.k === 'take') { const taken = await takeConnection(k); if (taken) { redrawConn(taken); toast('Picked up. It\'s yours'); } }
    if (b.dataset.k === 'more') {
      const owner = k.userId === state.user.id || state.user.isAdmin;
      const takers = k.takers || [];
      const release = async (body) => redrawConn((await api(`/api/connections/${k.id}/release`, { method: 'POST', body })).connection);
      menu(b, [
        owner && { label: 'Edit connection', action: async () => { const made = await openConnectionComposer(k); if (made) redrawConn(made); } },
        !owner && takers.some((t) => t.userId === state.user.id) && { label: 'Leave this connection', action: () => release({}) },
        ...(owner ? takers.map((t) => ({ label: `Remove ${t.character.name}`, action: () => release({ characterId: t.character.id }) })) : []),
        owner && takers.length > 1 && { label: 'Open it up again (remove everyone)', action: () => release({}) },
        (k.userId === state.user.id || state.user.isAdmin) && { label: 'Delete connection', danger: true, action: async () => {
          if (!(await confirmModal('Delete this connection?', { ok: 'Delete', danger: true }))) return;
          await api(`/api/connections/${k.id}`, { method: 'DELETE' });
          b.closest('[data-conn]').remove();
        } },
      ]);
    }
  });
  const create = async (what) => {
    const made = what === 'connection' ? await openConnectionComposer() : await openSocialComposer({ category: what === 'musing' ? 'musing' : 'post' });
    if (made) load();
  };
  // Phones: a refresh button to pull in the newest posts.
  $('#main #nu-refresh')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.classList.contains('spin')) return;
    b.classList.add('spin');
    try { await load(); window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (err) { toast(err.message); } finally { b.classList.remove('spin'); }
  });
  $('#main #nu-new').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'New post', action: () => create('post') },
    { label: 'New musing', action: () => create('musing') },
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
