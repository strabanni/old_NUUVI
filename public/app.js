// NUUVI front end: a small hash-routed single-page app with no dependencies.

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const toastEl = document.getElementById('toast');

const state = { user: null, characters: null };
let cleanup = []; // run when leaving a view (closing live connections etc.)

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Tagged template that escapes interpolations unless they are wrapped with raw().
class Raw { constructor(v) { this.v = v; } }
const raw = (v) => new Raw(v);
function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const str = Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.v : esc(x))).join('')
      : v instanceof Raw ? v.v : v === false || v == null ? '' : esc(v);
    return out + str + s;
  }, ''));
}

function render(target, content) {
  target.innerHTML = content.v;
  // Inline style attributes are blocked by the CSP, so colors are applied here.
  for (const el of target.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};

const initial = (name) => esc((name || '?').trim().charAt(0).toUpperCase());
const words = (text) => (text.match(/\S+/g) || []).length;

function timeAgo(sqlDate) {
  const then = new Date(sqlDate.replace(' ', 'T') + 'Z');
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return then.toLocaleDateString();
}

// Roleplay-flavoured formatting: *actions*, **bold**, "dialogue", paragraphs.
// Input is escaped first, so only these patterns produce markup.
function formatPost(text) {
  return esc(text)
    .split(/\n{2,}/)
    .map((para) => '<p>' + para
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em class="action">$1</em>')
      .replace(/(&quot;|“)(.+?)(&quot;|”)/g, '<span class="dialogue">$1$2$3</span>')
      .replace(/\n/g, '<br>') + '</p>')
    .join('');
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindForm(form, handler) {
  const errorEl = form.querySelector('.error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type=submit]');
    if (submit) submit.disabled = true;
    if (errorEl) errorEl.textContent = '';
    try {
      await handler(formData(form));
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message; else toast(err.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

async function myCharacters(force = false) {
  if (!state.characters || force) state.characters = (await api('/api/characters')).characters;
  return state.characters;
}

// ---------- Navigation ----------
function renderNav(route) {
  const links = state.user
    ? [['#/stories', 'My stories'], ['#/discover', 'Discover'], ['#/characters', 'Characters'], ['#/profile', state.user.displayName]]
    : [['#/discover', 'Discover'], ['#/', 'Sign in']];
  render(nav, html`${links.map(([href, label]) => html`<a href="${href}" class="${route === href ? 'active' : ''}">${label}</a>`)}`);
}

const routes = [
  [/^#\/?$/, viewHome],
  [/^#\/discover$/, viewDiscover],
  [/^#\/stories$/, viewMyStories],
  [/^#\/new$/, viewNewStory],
  [/^#\/s\/(\d+)$/, viewStory],
  [/^#\/s\/(\d+)\/settings$/, viewStorySettings],
  [/^#\/join\/(\d+)\/([\w-]+)$/, viewJoin],
  [/^#\/characters$/, viewCharacters],
  [/^#\/c\/(\d+)$/, viewCharacter],
  [/^#\/profile$/, viewProfile],
];

async function router() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  const hash = location.hash || '#/';
  renderNav(hash);
  const found = routes.find(([re]) => re.test(hash));
  if (!found) return render(view, html`<div class="empty"><h2>Page not found</h2><a href="#/">Go home</a></div>`);
  const [re, fn] = found;
  try {
    await fn(...hash.match(re).slice(1));
  } catch (err) {
    if (err.status === 401) return requireLogin();
    render(view, html`<div class="empty"><h2>${err.status === 404 ? 'Not found' : 'Something went wrong'}</h2><p>${err.message}</p><a href="#/">Go home</a></div>`);
  }
  view.focus({ preventScroll: true });
}

function requireLogin() {
  store.set('nuuvi:after-login', location.hash);
  location.hash = '#/';
}

function needUser() {
  if (!state.user) {
    requireLogin();
    return false;
  }
  return true;
}

// ---------- Views ----------
function viewHome() {
  if (state.user) {
    location.replace('#/stories');
    return;
  }
  render(view, html`
    <section class="hero">
      <h1>Write <span>together</span>.</h1>
      <p>NUUVI is a home for roleplayers. Build your characters, open a story, and trade posts with your partners — in character or out.</p>
    </section>
    <section class="card auth">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-tab="login">Sign in</button>
        <button type="button" role="tab" aria-selected="false" data-tab="register">Create account</button>
      </div>
      <form id="auth-form">
        <label for="username">Username</label>
        <input id="username" name="username" autocomplete="username" required minlength="3" maxlength="24">
        <div id="display-wrap" hidden>
          <label for="displayName">Display name <span class="muted small">(optional)</span></label>
          <input id="displayName" name="displayName" maxlength="40">
        </div>
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required minlength="8">
        <div class="actions"><button type="submit" class="primary">Sign in</button></div>
        <div class="error"></div>
      </form>
    </section>
    <section class="grid features">
      <div class="card"><h3>Character sheets</h3><p class="muted">Keep every OC in one place — name, tagline, color, and a full bio.</p></div>
      <div class="card"><h3>Story threads</h3><p class="muted">Public or invite-only stories with in-character, narration and OOC posts.</p></div>
      <div class="card"><h3>Live & installable</h3><p class="muted">New replies appear instantly. Add NUUVI to your home screen and use it like an app.</p></div>
    </section>`);

  let mode = 'login';
  const form = document.getElementById('auth-form');
  for (const tab of view.querySelectorAll('[data-tab]')) {
    tab.addEventListener('click', () => {
      mode = tab.dataset.tab;
      view.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      document.getElementById('display-wrap').hidden = mode !== 'register';
      form.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      form.querySelector('[type=submit]').textContent = mode === 'register' ? 'Create account' : 'Sign in';
    });
  }
  bindForm(form, async (data) => {
    const { user } = await api(`/api/auth/${mode}`, { method: 'POST', body: data });
    state.user = user;
    state.characters = null;
    const next = store.get('nuuvi:after-login');
    store.set('nuuvi:after-login', null);
    location.hash = next && next !== '#/' ? next : mode === 'register' ? '#/characters' : '#/stories';
  });
}

function storyCard(s) {
  return html`
    <a class="card story-card" href="#/s/${s.id}">
      <h3>${s.title}</h3>
      <p>${s.summary || 'No summary yet.'}</p>
      <div class="tags">
        ${s.genre ? html`<span class="tag">${s.genre}</span>` : ''}
        <span class="tag rating-${s.rating}">${s.rating}</span>
        ${s.visibility === 'private' ? html`<span class="tag">Private</span>` : ''}
        ${s.status === 'closed' ? html`<span class="tag closed">Closed</span>` : ''}
        <span class="tag">${s.postCount} posts</span>
        <span class="tag">${s.memberCount} writers</span>
      </div>
      <p class="small muted">by ${s.ownerName} · updated ${timeAgo(s.updatedAt)}</p>
    </a>`;
}

async function storyList({ title, scope, intro, emptyText }) {
  render(view, html`
    <div class="toolbar">
      <h1>${title}</h1>
      ${state.user ? html`<a class="btn primary" href="#/new">+ New story</a>` : ''}
    </div>
    ${intro ? html`<p class="muted">${intro}</p>` : ''}
    <div class="toolbar"><input type="search" id="q" placeholder="Search titles, genres…" aria-label="Search stories"></div>
    <div id="list" class="grid"></div>`);
  const list = document.getElementById('list');
  const load = async (q = '') => {
    const { stories } = await api(`/api/stories?scope=${scope}&q=${encodeURIComponent(q)}`);
    render(list, stories.length ? html`${stories.map(storyCard)}` : html`<div class="empty">${q ? 'No matching stories.' : emptyText}</div>`);
  };
  let t;
  document.getElementById('q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => load(e.target.value).catch((err) => toast(err.message)), 250);
  });
  await load();
}

function viewDiscover() {
  return storyList({
    title: 'Discover',
    scope: 'public',
    intro: 'Public stories looking for readers and writers.',
    emptyText: 'No public stories yet — be the first to start one.',
  });
}

function viewMyStories() {
  if (!needUser()) return;
  return storyList({
    title: 'My stories',
    scope: 'mine',
    emptyText: 'You are not in any stories yet. Start one, or find one on Discover.',
  });
}

function storyFields(s = {}) {
  return html`
    <label for="title">Title</label>
    <input id="title" name="title" required maxlength="120" value="${s.title || ''}">
    <label for="summary">Premise / summary</label>
    <textarea id="summary" name="summary" maxlength="5000" placeholder="Setting, tone, what kind of partners you're looking for…">${s.summary || ''}</textarea>
    <div class="row">
      <div><label for="genre">Genre</label><input id="genre" name="genre" maxlength="60" placeholder="Fantasy, sci-fi, slice of life…" value="${s.genre || ''}"></div>
      <div><label for="rating">Rating</label>
        <select id="rating" name="rating">
          ${[['G', 'G — all ages'], ['T', 'T — teen'], ['M', 'M — mature']].map(([v, l]) => html`<option value="${v}" ${(s.rating || 'T') === v ? raw('selected') : ''}>${l}</option>`)}
        </select></div>
      <div><label for="visibility">Visibility</label>
        <select id="visibility" name="visibility">
          <option value="public" ${s.visibility !== 'private' ? raw('selected') : ''}>Public</option>
          <option value="private" ${s.visibility === 'private' ? raw('selected') : ''}>Private (invite only)</option>
        </select></div>
    </div>`;
}

function viewNewStory() {
  if (!needUser()) return;
  render(view, html`
    <h1>Start a story</h1>
    <form class="card" id="story-form">
      ${storyFields()}
      <div class="actions"><button type="submit" class="primary">Create story</button><a href="#/stories">Cancel</a></div>
      <div class="error"></div>
    </form>`);
  bindForm(document.getElementById('story-form'), async (data) => {
    const { story } = await api('/api/stories', { method: 'POST', body: data });
    location.hash = `#/s/${story.id}`;
  });
}

function postHtml(p, { role }) {
  const mine = state.user && p.userId === state.user.id;
  const canDelete = mine || role === 'owner';
  const name = p.kind === 'ic' ? (p.character?.name || 'Unknown character') : p.kind === 'narration' ? 'Narrator' : p.author.displayName;
  const color = p.kind === 'ic' && p.character ? p.character.color : '';
  return html`
    <article class="post ${p.kind}" id="post-${p.id}" data-id="${p.id}" ${color ? html`data-color="${color}"` : ''}>
      <header>
        ${p.kind === 'ic' ? html`<span class="avatar lg" data-color="${color}">${raw(initial(name))}</span>` : ''}
        <div class="who">
          ${p.kind === 'ic' && p.character ? html`<a href="#/c/${p.character.id}"><strong>${name}</strong></a>` : html`<strong>${name}</strong>`}
          ${p.kind === 'ooc' ? html` <span class="ooc-badge">OOC</span>` : ''}
          <div class="small muted">${p.kind === 'ooc' ? '' : `written by ${p.author.displayName} · `}${p.wordCount} words</div>
        </div>
        <div class="meta small muted">
          <span title="${p.createdAt} UTC">${timeAgo(p.createdAt)}${p.editedAt ? ' · edited' : ''}</span>
          <span>
            ${mine ? html`<button class="link" data-act="edit">Edit</button>` : ''}
            ${canDelete ? html` <button class="link" data-act="delete">Delete</button>` : ''}
          </span>
        </div>
      </header>
      <div class="body">${raw(formatPost(p.body))}</div>
    </article>`;
}

async function viewStory(id) {
  const [{ story, role, members, cast }, { posts }] = await Promise.all([
    api(`/api/stories/${id}`),
    api(`/api/stories/${id}/posts`),
  ]);
  const characters = role ? await myCharacters() : [];
  const draftKey = `nuuvi:draft:${id}`;
  const prefKey = `nuuvi:as:${id}`;
  const knownPosts = new Map(posts.map((p) => [p.id, p]));

  render(view, html`
    <section class="story-head">
      <div class="toolbar">
        <h1>${story.title}</h1>
        <div class="actions">
          ${role === 'owner' ? html`<a class="btn" href="#/s/${id}/settings">Settings</a>` : ''}
          ${!role && state.user && story.status === 'open' ? html`<button class="primary" id="join">Join story</button>` : ''}
          ${role === 'writer' ? html`<button id="leave">Leave</button>` : ''}
        </div>
      </div>
      <div class="tags">
        ${story.genre ? html`<span class="tag">${story.genre}</span>` : ''}
        <span class="tag rating-${story.rating}">Rated ${story.rating}</span>
        ${story.visibility === 'private' ? html`<span class="tag">Private</span>` : ''}
        ${story.status === 'closed' ? html`<span class="tag closed">Closed to new writers</span>` : ''}
      </div>
      ${story.summary ? html`<p class="summary">${story.summary}</p>` : ''}
      <p class="small muted">Writers: ${members.map((m) => m.displayName).join(', ')}</p>
      ${cast.length ? html`<div class="cast">${cast.map((c) => html`<a class="chip" href="#/c/${c.id}"><span class="avatar" data-color="${c.color}">${raw(initial(c.name))}</span>${c.name}</a>`)}</div>` : ''}
    </section>
    <section class="feed" id="feed" aria-live="polite"></section>
    ${role ? html`
      <section class="composer">
        <form class="card" id="composer">
          <div class="row">
            <div class="seg" role="group" aria-label="Post type">
              <button type="button" data-kind="ic">In character</button>
              <button type="button" data-kind="narration">Narration</button>
              <button type="button" data-kind="ooc">OOC</button>
            </div>
            <select name="characterId" id="as" aria-label="Write as">
              ${characters.map((c) => html`<option value="${c.id}">${c.name}</option>`)}
            </select>
            ${!characters.length ? html`<a href="#/characters" id="need-char" class="small">Create a character first →</a>` : ''}
          </div>
          <textarea id="post-body" aria-label="Your post" name="body" maxlength="20000" placeholder="*She pushed open the tavern door…* &quot;Is anyone here?&quot;"></textarea>
          <div class="row">
            <span class="hint grow">*actions* · **bold** · "dialogue" · Ctrl+Enter to post</span>
            <span class="hint" id="wc">0 words</span>
            <button type="submit" class="primary">Post</button>
          </div>
          <div class="error"></div>
        </form>
      </section>` : state.user
        ? html`<p class="empty">${story.status === 'open' ? 'Join this story to start writing.' : 'This story is closed to new writers.'}</p>`
        : html`<p class="empty"><a href="#/">Sign in</a> to join and write.</p>`}`);

  const feed = document.getElementById('feed');
  const drawFeed = () => {
    const list = [...knownPosts.values()].sort((a, b) => a.id - b.id);
    render(feed, list.length ? html`${list.map((p) => postHtml(p, { role }))}` : html`<div class="empty">No posts yet. Set the scene!</div>`);
  };
  drawFeed();

  document.getElementById('join')?.addEventListener('click', async () => {
    try {
      await api(`/api/stories/${id}/join`, { method: 'POST', body: {} });
      toast('Welcome to the story!');
      router();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('leave')?.addEventListener('click', async () => {
    if (!confirm('Leave this story? Your posts will stay.')) return;
    try {
      await api(`/api/stories/${id}/leave`, { method: 'POST', body: {} });
      location.hash = '#/stories';
    } catch (err) { toast(err.message); }
  });

  // Edit / delete posts
  feed.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const article = btn.closest('.post');
    const post = knownPosts.get(Number(article.dataset.id));
    if (btn.dataset.act === 'delete') {
      if (!confirm('Delete this post?')) return;
      try {
        await api(`/api/posts/${post.id}`, { method: 'DELETE' });
        knownPosts.delete(post.id);
        drawFeed();
      } catch (err) { toast(err.message); }
    } else if (btn.dataset.act === 'edit') {
      const body = article.querySelector('.body');
      render(body, html`
        <form class="stack">
          <textarea name="body" maxlength="20000">${post.body}</textarea>
          <div class="actions"><button type="submit" class="primary">Save</button><button type="button" data-cancel>Cancel</button></div>
          <div class="error"></div>
        </form>`);
      const form = body.querySelector('form');
      form.querySelector('textarea').focus();
      form.querySelector('[data-cancel]').addEventListener('click', drawFeed);
      bindForm(form, async (data) => {
        const { post: updated } = await api(`/api/posts/${post.id}`, { method: 'PUT', body: data });
        knownPosts.set(updated.id, updated);
        drawFeed();
      });
    }
  });

  // Live updates
  const source = new EventSource(`/api/stories/${id}/events`);
  const atBottom = () => window.innerHeight + window.scrollY >= document.body.scrollHeight - 200;
  source.addEventListener('post', (e) => {
    const p = JSON.parse(e.data);
    if (knownPosts.has(p.id)) return;
    const stick = atBottom();
    knownPosts.set(p.id, p);
    drawFeed();
    if (stick) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    else if (p.userId !== state.user?.id) toast('New post');
  });
  source.addEventListener('edit', (e) => {
    const p = JSON.parse(e.data);
    // Don't clobber a post that is currently being edited here.
    if (document.querySelector(`#post-${p.id} form`)) return;
    knownPosts.set(p.id, p);
    drawFeed();
  });
  source.addEventListener('delete', (e) => {
    knownPosts.delete(JSON.parse(e.data).id);
    drawFeed();
  });
  cleanup.push(() => source.close());

  if (!role) return;

  // Composer
  const composer = document.getElementById('composer');
  const textarea = composer.querySelector('textarea');
  const select = composer.querySelector('select');
  const wc = document.getElementById('wc');
  let kind = characters.length ? 'ic' : 'ooc';
  const setKind = (k) => {
    kind = k;
    composer.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
    select.hidden = k !== 'ic' || !characters.length;
  };
  composer.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.kind === 'ic' && !characters.length) return toast('Create a character first');
    setKind(b.dataset.kind);
  }));
  setKind(kind);

  const savedAs = store.get(prefKey);
  if (savedAs && characters.some((c) => String(c.id) === savedAs)) select.value = savedAs;
  select.addEventListener('change', () => store.set(prefKey, select.value));

  textarea.value = store.get(draftKey) || '';
  const updateCount = () => { wc.textContent = `${words(textarea.value)} words`; };
  updateCount();
  textarea.addEventListener('input', () => {
    store.set(draftKey, textarea.value);
    updateCount();
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) composer.requestSubmit();
  });

  bindForm(composer, async (data) => {
    const body = { kind, body: data.body };
    if (kind === 'ic') body.characterId = Number(select.value);
    const { post } = await api(`/api/stories/${id}/posts`, { method: 'POST', body });
    knownPosts.set(post.id, post);
    textarea.value = '';
    store.set(draftKey, null);
    updateCount();
    drawFeed();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });
}

async function viewStorySettings(id) {
  if (!needUser()) return;
  const { story, role, members } = await api(`/api/stories/${id}`);
  if (role !== 'owner') {
    location.replace(`#/s/${id}`);
    return;
  }
  const inviteLink = () => `${location.origin}/#/join/${id}/${story.inviteCode}`;
  render(view, html`
    <p><a href="#/s/${id}">← Back to story</a></p>
    <h1>Story settings</h1>
    <form class="card" id="settings">
      ${storyFields(story)}
      <label for="status">Accepting new writers?</label>
      <select id="status" name="status">
        <option value="open" ${story.status === 'open' ? raw('selected') : ''}>Open — anyone who can see it may join</option>
        <option value="closed" ${story.status === 'closed' ? raw('selected') : ''}>Closed — invite link only</option>
      </select>
      <div class="actions"><button type="submit" class="primary">Save</button></div>
      <div class="error"></div>
    </form>
    <section class="card stack spaced">
      <h2>Invite writers</h2>
      <p class="muted small">Anyone with this link can join, even if the story is private or closed.</p>
      <input id="invite" readonly value="${inviteLink()}">
      <div class="actions"><button id="copy">Copy link</button><button id="regen">New link</button></div>
      <p class="small muted">Writers: ${members.map((m) => `${m.displayName} (@${m.username})`).join(', ')}</p>
    </section>
    <section class="card stack spaced">
      <h2>Danger zone</h2>
      <p class="muted small">Deleting a story removes every post in it. This cannot be undone.</p>
      <div><button class="danger" id="delete">Delete story</button></div>
    </section>`);

  bindForm(document.getElementById('settings'), async (data) => {
    await api(`/api/stories/${id}`, { method: 'PUT', body: data });
    toast('Saved');
  });
  document.getElementById('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(inviteLink()); toast('Invite link copied'); } catch { document.getElementById('invite').select(); }
  });
  document.getElementById('regen').addEventListener('click', async () => {
    const { story: updated } = await api(`/api/stories/${id}`, { method: 'PUT', body: { regenerateInvite: true } });
    story.inviteCode = updated.inviteCode;
    document.getElementById('invite').value = inviteLink();
    toast('Old link no longer works');
  });
  document.getElementById('delete').addEventListener('click', async () => {
    if (prompt(`Type the story title to delete it:\n${story.title}`) !== story.title) return;
    await api(`/api/stories/${id}`, { method: 'DELETE' });
    toast('Story deleted');
    location.hash = '#/stories';
  });
}

async function viewJoin(id, code) {
  if (!needUser()) return;
  await api(`/api/stories/${id}/join`, { method: 'POST', body: { inviteCode: code } });
  toast('You joined the story!');
  location.replace(`#/s/${id}`);
}

function characterForm(c = {}) {
  return html`
    <form id="char-form">
      <h2>${c.id ? 'Edit character' : 'New character'}</h2>
      <div class="row">
        <div><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="60" value="${c.name || ''}"></div>
        <div class="fixed"><label for="c-color">Color</label><input id="c-color" type="color" name="color" value="${c.color || '#9b7bff'}"></div>
      </div>
      <label for="c-tag">Tagline</label>
      <input id="c-tag" name="tagline" maxlength="140" placeholder="A wandering bard with a debt to pay" value="${c.tagline || ''}">
      <label for="c-bio">Bio</label>
      <textarea id="c-bio" name="bio" maxlength="10000" rows="8" placeholder="Appearance, personality, history, relationships…">${c.bio || ''}</textarea>
      <div class="actions">
        <button type="submit" class="primary">Save</button>
        <button type="button" data-close>Cancel</button>
        ${c.id ? html`<button type="button" class="danger" data-delete>Delete</button>` : ''}
      </div>
      <div class="error"></div>
    </form>`;
}

async function viewCharacters() {
  if (!needUser()) return;
  const characters = await myCharacters(true);
  render(view, html`
    <div class="toolbar"><h1>Your characters</h1><button class="primary" id="new-char">+ New character</button></div>
    ${characters.length ? html`<div class="stack">${characters.map((c) => html`
      <div class="card character-card">
        <span class="avatar lg" data-color="${c.color}">${raw(initial(c.name))}</span>
        <div class="info">
          <h3><a href="#/c/${c.id}">${c.name}</a></h3>
          ${c.tagline ? html`<p class="muted">${c.tagline}</p>` : ''}
        </div>
        <button data-edit="${c.id}">Edit</button>
      </div>`)}</div>`
      : html`<div class="card empty"><p>Every story needs a cast. Create your first character to start writing in character.</p></div>`}
    <dialog id="char-dialog"></dialog>`);

  const dialog = document.getElementById('char-dialog');
  const open = (c) => {
    render(dialog, characterForm(c));
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!confirm(`Delete ${c.name}? Their posts will remain but show as an unknown character.`)) return;
      await api(`/api/characters/${c.id}`, { method: 'DELETE' });
      dialog.close();
      viewCharacters();
    });
    bindForm(dialog.querySelector('form'), async (data) => {
      await api(c?.id ? `/api/characters/${c.id}` : '/api/characters', { method: c?.id ? 'PUT' : 'POST', body: data });
      dialog.close();
      toast('Character saved');
      viewCharacters();
    });
    dialog.showModal();
  };
  document.getElementById('new-char').addEventListener('click', () => open({}));
  view.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => open(characters.find((c) => c.id === Number(b.dataset.edit)))));
}

async function viewCharacter(id) {
  const { character: c } = await api(`/api/characters/${id}`);
  render(view, html`
    <div class="card" data-color="${c.color}">
      <div class="character-card">
        <span class="avatar lg" data-color="${c.color}">${raw(initial(c.name))}</span>
        <div class="info">
          <h1>${c.name}</h1>
          ${c.tagline ? html`<p class="muted">${c.tagline}</p>` : ''}
          <p class="small muted">Played by ${c.owner.displayName} (@${c.owner.username})</p>
        </div>
      </div>
      ${c.bio ? html`<div class="post"><div class="body">${raw(formatPost(c.bio))}</div></div>` : html`<p class="muted">No bio yet.</p>`}
    </div>`);
}

function viewProfile() {
  if (!needUser()) return;
  const u = state.user;
  render(view, html`
    <h1>Your profile</h1>
    <form class="card" id="profile">
      <p class="muted">Signed in as @${u.username}</p>
      <label for="p-name">Display name</label>
      <input id="p-name" name="displayName" required maxlength="40" value="${u.displayName}">
      <label for="p-bio">About you</label>
      <textarea id="p-bio" name="bio" maxlength="2000" placeholder="Writing style, preferred genres, timezone, reply speed…">${u.bio}</textarea>
      <div class="actions"><button type="submit" class="primary">Save</button><button type="button" id="logout">Sign out</button></div>
      <div class="error"></div>
    </form>`);
  bindForm(document.getElementById('profile'), async (data) => {
    state.user = (await api('/api/me', { method: 'PUT', body: data })).user;
    renderNav(location.hash);
    toast('Profile saved');
  });
  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    state.user = null;
    state.characters = null;
    location.hash = '#/';
  });
}

// ---------- Boot ----------
async function boot() {
  try {
    state.user = (await api('/api/me')).user;
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', router);
  router();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

boot();
