import { html, render, api, $, bindForm, timeAgo, toast, uploadImage } from '../lib.js';
import { state, page, refreshHome, routeAlive, ensureAlive } from '../main.js';

export function storyCard(s) {
  return html`
    <a class="card story-card" href="#/s/${s.id}">
      <div class="story-card-head">
        <span class="story-icon">${s.icon ? html`<img src="${s.icon}" alt="">` : html`<span data-color="${s.color}">${s.title.trim().slice(0, 2)}</span>`}</span>
        <div>
          <h3>${s.title}</h3>
          <p class="small muted">by ${s.ownerName} · updated ${timeAgo(s.updatedAt)}</p>
        </div>
        ${s.unread ? html`<span class="badge soft">${s.unread} new</span>` : ''}
      </div>
      ${s.summary ? html`<p class="summary">${s.summary}</p>` : ''}
      <div class="tags">
        ${s.genre ? html`<span class="tag">${s.genre}</span>` : ''}
        <span class="tag rating-${s.rating}">${s.rating}</span>
        ${s.contentWarnings.length ? html`<span class="tag cw" title="${s.contentWarnings.join(', ')}">CW: ${s.contentWarnings.slice(0, 3).join(', ')}${s.contentWarnings.length > 3 ? '…' : ''}</span>` : ''}
        ${s.visibility === 'private' ? html`<span class="tag">Private</span>` : ''}
        ${s.status === 'closed' ? html`<span class="tag closed">Closed</span>` : ''}
        <span class="tag">${s.postCount} posts · ${s.memberCount} writers</span>
      </div>
    </a>`;
}

export async function viewHome() {
  const alive = routeAlive();
  await refreshHome();
  const { stories } = state.home;
  const turns = [];
  // Stories where it's your turn somewhere.
  await Promise.all(stories.filter((s) => s.mentions).map(async (s) => {
    const d = await api(`/api/stories/${s.id}`).catch(() => null);
    for (const c of d?.channels ?? []) if (c.turns.enabled && c.turns.current === state.user.id) turns.push({ story: s, channel: c });
  }));
  page({
    alive,
    title: `Welcome back, ${state.user.displayName}`,
    actions: html`<a class="btn primary" href="#/new">New story</a>`,
    body: html`
      ${turns.length ? html`<section class="stack">
        ${turns.map((t) => html`<a class="card turn-card" href="#/s/${t.story.id}/${t.channel.id}">⏳ It's your turn in <strong>#${t.channel.name}</strong> · ${t.story.title}</a>`)}
      </section>` : ''}
      <h2 class="section-title">Your stories</h2>
      ${stories.length ? html`<div class="grid">${stories.map(storyCard)}</div>` : html`
        <div class="card empty">
          <p>You're not in any stories yet.</p>
          <p><a class="btn primary" href="#/new">Start one</a> &nbsp; <a class="btn" href="#/discover">Find one</a></p>
          <p class="small muted">Tip: set up a character first under <a href="#/characters">Characters</a>.</p>
        </div>`}`,
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
      <div class="fixed"><label for="color">Icon color</label><input type="color" id="color" name="color" value="${s.color || '#7c5cff'}"></div>
      <div><label for="icon-file">Icon picture <span class="muted small">(optional)</span></label>
        <input type="file" id="icon-file" accept="image/*"><input type="hidden" name="icon" value="${s.icon || ''}"></div>
    </div>`;
}

export function bindIconUpload(form) {
  form.querySelector('#icon-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      form.icon.value = await uploadImage(file, 256);
      toast('Icon uploaded');
    } catch (err) { toast(err.message); }
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
