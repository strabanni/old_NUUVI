import { html, render, api, $, $$, bindForm, timeAgo, toast, uploadImage, avatar, icons, askImageLink, applyColors } from '../lib.js';
import { state, page, refreshHome, myCharacters, routeAlive, ensureAlive, greeting } from '../main.js';
import { feedCard, masonry } from './threads.js';

export function storyCard(s) {
  return html`
    <a class="card story-card" href="#/s/${s.id}" data-color="${s.color}">
      <div class="story-cover">
        ${s.banner ? html`<img src="${s.banner}" alt="" loading="lazy">` : ''}
        ${s.unread ? html`<span class="badge soft">${s.unread} new</span>` : ''}
        <div class="cover-title">
          <span class="story-icon">${s.icon ? html`<img src="${s.icon}" alt="">` : html`<span data-color="${s.color}">${s.title.trim().slice(0, 2)}</span>`}</span>
          <h3>${s.title}</h3>
        </div>
      </div>
      <div class="story-card-body">
        ${s.summary ? html`<p class="summary">${s.summary}</p>` : ''}
        <div class="tags">
          ${s.genre ? html`<span class="tag">${s.genre}</span>` : ''}
          <span class="tag rating-${s.rating}">${s.rating}</span>
          ${s.contentWarnings.length ? html`<span class="tag cw" title="${s.contentWarnings.join(', ')}">CW: ${s.contentWarnings.slice(0, 2).join(', ')}${s.contentWarnings.length > 2 ? '…' : ''}</span>` : ''}
          ${s.visibility === 'private' ? html`<span class="tag">Private</span>` : ''}
          ${s.status === 'closed' ? html`<span class="tag closed">Closed</span>` : ''}
        </div>
        <div class="byline">${s.postCount} posts · ${s.memberCount} writers · by ${s.ownerName} · ${timeAgo(s.updatedAt)}</div>
      </div>
    </a>`;
}

const fmt = (n) => Number(n || 0).toLocaleString();

// The lore: a wide card on Home that opens a story's Overview (or the list, with more than one).
function loreCard(stories) {
  const withLore = stories.filter((s) => s.hasOverview);
  const s = withLore[0];
  if (!stories.length) return '';
  return html`<a class="lore-card" href="${withLore.length === 1 ? `#/s/${s.id}/overview` : '#/lore'}">
    <span class="eyebrow">${icons.book} the lore${s ? html` · ${withLore.length === 1 ? s.title : `${withLore.length} stories`}` : ''}</span>
    <b>${s ? s.loreTagline || 'Read the overview' : 'No lore written yet'}</b>
    <small>${s ? 'The world, the companies and the gossip. Read this first.' : 'Story owners write it under Overview in their story.'}</small>
    <span class="lore-go">${s ? 'Read the overview' : 'Open'} ${icons.chevron}</span>
  </a>`;
}

export async function viewHome() {
  const alive = routeAlive();
  await refreshHome();
  const { stories, stats = {} } = state.home;
  const [characters, mine, cal, notes] = await Promise.all([
    myCharacters(true), api('/api/feed?filter=mine').catch(() => ({ items: [] })),
    api('/api/calendar').catch(() => ({ events: [] })), api('/api/notifications').catch(() => ({ notifications: [] })),
  ]);
  const turns = [];
  // Stories where it's your turn somewhere.
  await Promise.all(stories.filter((s) => s.mentions).map(async (s) => {
    const d = await api(`/api/stories/${s.id}`).catch(() => null);
    for (const c of d?.channels ?? []) if (c.turns.enabled && c.turns.current === state.user.id) turns.push({ story: s, channel: c });
  }));
  const u = state.user;
  // "This week": yesterday + the next five days, with each day's events.
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i - 1); return d; });
  const eventsOn = (day) => cal.events.filter((e) => {
    const s = new Date(e.startsAt); s.setHours(0, 0, 0, 0);
    const end = new Date(e.endsAt || e.startsAt); end.setHours(0, 0, 0, 0);
    return day >= s && day <= end;
  });
  const upcoming = cal.events.filter((e) => new Date(e.endsAt || e.startsAt) >= new Date()).slice(0, 3);
  const homeBody = page({
    alive,
    title: html`<span class="script">home</span>`,
    banner: 'write together, in your own little world.',
    body: html`
      <section class="card welcome phone-only">
        ${avatar({ name: u.displayName, src: u.avatar, color: '#EE719E', size: 'xl square' })}
        <div>
          <h1>${greeting()}</h1>
          <p class="stats-line">You have <b>${fmt(stats.posts)}</b> posts, <b>${fmt(stats.words)}</b> words and <b>${fmt(stats.characters)}</b> characters</p>
        </div>
        <nav class="quick-tiles" aria-label="Shortcuts">
          <a class="tile" href="#/new" title="Start a story" aria-label="Start a story">${icons.plus}</a>
          <a class="tile" href="#/notifications" title="Notifications" aria-label="Notifications">${icons.bell}${state.home.notificationsUnread ? html`<span class="badge">${state.home.notificationsUnread}</span>` : ''}</a>
          <a class="tile" href="#/feed" title="Feed" aria-label="Feed">${icons.apps}</a>
          <a class="tile" href="#/u/${u.id}" title="Your profile" aria-label="Your profile">${icons.layout}</a>
          <a class="tile" href="#/settings" title="Settings" aria-label="Settings">${icons.gear}</a>
        </nav>
      </section>

      <section class="bento">
        <div class="bento-hero">
          <div>
            <span class="eyebrow">nuuvi</span>
            <h2>Start something new.</h2>
            <p>${stories.length ? `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} · ${characters.length} ${characters.length === 1 ? 'character' : 'characters'}` : 'Start a story or join one to begin.'}</p>
          </div>
          <div class="bento-actions">
            <button class="primary" data-quick="thread">${icons.episode} New episode</button>
            <button data-quick="post">${icons.image} New post</button>
            <button data-quick="event">${icons.calendar} New event</button>
          </div>
        </div>
        <div class="bento-week card">
          <div class="bw-head"><b>${new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><a href="#/events" class="see-all">Calendar</a></div>
          <div class="bw-days no-swipe">${weekDays.map((d, i) => html`<button type="button" class="bw-day ${i === 1 ? 'today' : ''} ${eventsOn(d).length ? 'has' : ''}" data-day="${i}" aria-pressed="${i === 1}">
            <small>${d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</small><b>${d.getDate()}</b></button>`)}</div>
          <div class="bw-list" id="bw-list"></div>
          ${upcoming.length ? html`<div class="bw-up"><span class="eyebrow">Coming up</span>${upcoming.map((e) => html`
            <a class="bw-up-item" href="#/e/${e.id}"><span class="bw-up-date"><small>${new Date(e.startsAt).toLocaleDateString(undefined, { month: 'short' })}</small><b>${new Date(e.startsAt).getDate()}</b></span>
              <span class="grow"><b>${e.title}</b><small>${e.story.title}${e.location ? ` · ${e.location}` : ''}</small></span>${icons.chevron}</a>`)}</div>` : ''}
        </div>
        <div class="bento-notes card">
          <div class="bw-head"><b>Latest</b><a href="#/notifications" class="see-all">All</a></div>
          ${notes.notifications.length ? html`<div class="bn-list">${notes.notifications.slice(0, 4).map((n) => html`
            <a class="bn-item ${n.read ? '' : 'unread'}" href="${n.url}">${avatar({ name: n.actor?.displayName || 'N', src: n.actor?.avatar, color: '#48484A', size: 'sm' })}
              <span class="grow"><span>${n.actor?.displayName || 'NUUVI'}</span><small>${n.text || n.type}</small></span><small>${timeAgo(n.createdAt)}</small></a>`)}</div>`
            : html`<p class="muted small">Nothing new.</p>`}
        </div>
      </section>
      ${loreCard(stories)}

      ${turns.length ? html`<section class="stack spaced">
        ${turns.map((t) => html`<a class="card turn-card" href="#/s/${t.story.id}/${t.channel.id}">${icons.hourglass}<span>It's your turn in <strong>#${t.channel.name}</strong> · ${t.story.title}</span></a>`)}
      </section>` : ''}

      <h2 class="section-title">Your episodes <a class="see-all" href="#/feed">See all</a></h2>
      ${mine.items.length ? html`<div class="feed-grid">${mine.items.slice(0, 4).map(feedCard)}</div>`
        : html`<div class="card empty small"><p>No episodes yet. Open a story and tap <b>New episode</b>, or browse the <a href="#/feed">feed</a> for open ones.</p></div>`}

      <h2 class="section-title">Your cast</h2>
      <div class="cast-row no-swipe">
        <a href="#/characters" aria-label="New character"><span class="add">${icons.plus}</span><span>New</span></a>
        ${characters.map((c) => html`<a href="#/c/${c.id}">${avatar({ name: c.name, src: c.avatar, color: c.color })}<span>${c.name}</span></a>`)}
      </div>

      <h2 class="section-title">Your stories</h2>
      ${stories.length ? html`<div class="grid">${stories.map(storyCard)}</div>` : html`
        <div class="card empty">
          <p>You're not in any stories yet.</p>
          <p><a class="btn primary" href="#/new">Start one</a> &nbsp; <a class="btn" href="#/discover">Find one</a></p>
        </div>`}`,
  });
  masonry(homeBody);
  const drawDay = (i) => {
    $$('.bw-day', homeBody).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.day) === i)));
    const evs = eventsOn(weekDays[i]);
    render($('#bw-list', homeBody), evs.length ? html`${evs.map((e) => html`
      <a class="bw-ev" href="#/e/${e.id}" data-color="${e.story.color}"><span class="bw-bar"></span>
        <span class="grow"><b>${e.title}</b><small>${new Date(e.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${e.location ? ` · ${e.location}` : ''}</small></span>
        ${e.participants.length ? html`<span class="avatar-stack">${e.participants.slice(0, 3).map((c) => avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' }))}</span>` : ''}</a>`)}`
      : html`<p class="bw-none">Nothing planned${i === 1 ? ' today' : ''}.</p>`);
    applyColors(homeBody);
  };
  drawDay(1);
  homeBody.addEventListener('click', async (e) => {
    const d = e.target.closest('.bw-day');
    if (d) { drawDay(Number(d.dataset.day)); return; }
    const q = e.target.closest('[data-quick]');
    if (!q) return;
    if (q.dataset.quick === 'thread') { const { openThreadForm } = await import('./threads.js'); openThreadForm(); }
    if (q.dataset.quick === 'post') { const { openSocialComposer } = await import('./social.js'); if (await openSocialComposer()) location.hash = '#/feed'; }
    if (q.dataset.quick === 'event') {
      const { openEventForm } = await import('./events.js');
      const made = await openEventForm();
      if (made && made !== 'deleted') location.hash = `#/e/${made.id}`;
    }
  });
}

export async function viewDiscover() {
  const alive = routeAlive();
  const body = page({
    alive,
    title: 'Discover',
    subtitle: 'Public stories on this NUUVI',
    body: html`<input type="search" id="q" class="search" placeholder="Search titles, genres…" aria-label="Search stories"><div id="list" class="grid"></div>`,
  });
  const list = $('#list', body);
  const load = async (q = '') => {
    const { stories } = await api(`/api/stories?q=${encodeURIComponent(q)}`);
    render(list, stories.length ? html`${stories.map(storyCard)}` : html`<div class="empty">${q ? 'No matching stories.' : 'No public stories yet.'}</div>`);
  };
  let t;
  $('#q', body).addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => load(e.target.value).catch((err) => toast(err.message)), 250);
  });
  await load();
}

export function storyFields(s = {}) {
  return html`
    <label for="title">Title</label>
    <input id="title" name="title" required maxlength="120" value="${s.title || ''}">
    <label for="summary">Premise</label>
    <textarea id="summary" name="summary" maxlength="5000" rows="5" placeholder="Setting, tone, what you're looking for in partners…">${s.summary || ''}</textarea>
    <div class="row">
      <div><label for="genre">Genre</label><input id="genre" name="genre" maxlength="60" placeholder="Fantasy, sci-fi, slice of life…" value="${s.genre || ''}"></div>
      <div><label for="rating">Rating</label>
        <select id="rating" name="rating">
          ${[['G', 'G — all ages'], ['T', 'T — teen'], ['M', 'M — mature']].map(([v, l]) => html`<option value="${v}" ${(s.rating || 'T') === v ? 'selected' : ''}>${l}</option>`)}
        </select></div>
      <div><label for="visibility">Who can see it</label>
        <select id="visibility" name="visibility">
          <option value="private" ${s.visibility !== 'public' ? 'selected' : ''}>Private — invite only</option>
          <option value="public" ${s.visibility === 'public' ? 'selected' : ''}>Public — listed in Discover</option>
        </select></div>
    </div>
    <label for="contentWarnings">Content warnings <span class="muted small">(comma separated — readers see these before entering)</span></label>
    <input id="contentWarnings" name="contentWarnings" maxlength="800" placeholder="e.g. violence, character death" value="${(s.contentWarnings || []).join(', ')}">
    <div class="row">
      <div class="fixed"><label for="color">Icon color</label><input type="color" id="color" name="color" value="${s.color || '#EE719E'}"></div>
      <div><label for="icon-file">Icon picture</label>
        <span class="row-inline"><input type="file" id="icon-file" accept="image/*"><button type="button" class="sm link-btn" data-link="icon">Link</button></span><input type="hidden" name="icon" value="${s.icon || ''}"></div>
    </div>
    <label for="banner-file">Banner picture <span class="muted small">— shown on the story card</span></label>
    <span class="row-inline"><input type="file" id="banner-file" accept="image/*"><button type="button" class="sm link-btn" data-link="banner">Link</button></span><input type="hidden" name="banner" value="${s.banner || ''}">`;
}

export function bindIconUpload(form) {
  const hook = (inputId, field, size, label) => form.querySelector(inputId).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      form[field].value = await uploadImage(file, size);
      toast(`${label} uploaded`);
    } catch (err) { toast(err.message); }
  });
  hook('#icon-file', 'icon', 256, 'Icon');
  hook('#banner-file', 'banner', 1600, 'Banner');
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-link]');
    if (!b) return;
    const url = await askImageLink();
    if (url) { form[b.dataset.link].value = url; toast(`${b.dataset.link === 'icon' ? 'Icon' : 'Banner'} set`); }
  });
}

export function viewNewStory() {
  const alive = routeAlive();
  const body = page({
    alive,
    title: 'Start a story',
    body: html`
      <form class="card narrow" id="story-form">
        ${storyFields()}
        <p class="small muted">Your story starts with two channels — <strong>#main-story</strong> and <strong>#ooc-chat</strong>. You can add more later.</p>
        <div class="error"></div>
        <div class="actions"><button type="submit" class="primary">Create story</button><a href="#/home">Cancel</a></div>
      </form>`,
  });
  const form = $('#story-form', body);
  bindIconUpload(form);
  bindForm(form, async (data) => {
    if (!data.icon) delete data.icon;
    if (!data.banner) delete data.banner;
    const { story, channels } = await api('/api/stories', { method: 'POST', body: data });
    await refreshHome();
    location.hash = `#/s/${story.id}/${channels[0].id}`;
  });
}

export async function viewJoin(id, code) {
  const alive = routeAlive();
  await api(`/api/stories/${id}/join`, { method: 'POST', body: { inviteCode: code } });
  await refreshHome();
  ensureAlive(alive);
  toast('You joined the story!');
  location.replace(`#/s/${id}`);
}
