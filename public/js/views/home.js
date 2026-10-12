import { html, render, api, $, bindForm, timeAgo, toast, uploadImage, avatar, icons, askImageLink } from '../lib.js';
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

export async function viewHome() {
  const alive = routeAlive();
  await refreshHome();
  const { stories, stats = {} } = state.home;
  const [characters, mine] = await Promise.all([myCharacters(true), api('/api/feed?filter=mine').catch(() => ({ items: [] }))]);
  const turns = [];
  // Stories where it's your turn somewhere.
  await Promise.all(stories.filter((s) => s.mentions).map(async (s) => {
    const d = await api(`/api/stories/${s.id}`).catch(() => null);
    for (const c of d?.channels ?? []) if (c.turns.enabled && c.turns.current === state.user.id) turns.push({ story: s, channel: c });
  }));
  const u = state.user;
  const homeBody = page({
    alive,
    title: html`<span class="script">home</span>`,
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
          <a class="tile" href="#/u/${u.id}" title="Your profile" aria-label="Your profile">${icons.fingerprint}</a>
          <a class="tile" href="#/settings" title="Settings" aria-label="Settings">${icons.gear}</a>
        </nav>
      </section>

      ${turns.length ? html`<section class="stack spaced">
        ${turns.map((t) => html`<a class="card turn-card" href="#/s/${t.story.id}/${t.channel.id}">${icons.hourglass}<span>It's your turn in <strong>#${t.channel.name}</strong> · ${t.story.title}</span></a>`)}
      </section>` : ''}

      <h2 class="section-title">Your threads <a class="see-all" href="#/feed">See all</a></h2>
      ${mine.items.length ? html`<div class="feed-grid">${mine.items.slice(0, 4).map(feedCard)}</div>`
        : html`<div class="card empty small"><p>No threads yet. Open a story and tap <b>New thread</b>, or browse the <a href="#/feed">feed</a> for open ones.</p></div>`}

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
