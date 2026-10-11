// App shell: Discord-style chrome (story rail, sidebar, members panel, mobile drawer + tab bar),
// routing, and the live event connection.
import { html, raw, render, api, $, $$, store, toast, avatar, icons, menu, confirmModal } from './lib.js';
import { viewLanding, viewReset } from './views/auth.js';
import { viewHome, viewDiscover, viewNewStory, viewJoin } from './views/home.js';
import { viewChannel } from './views/channel.js';
import { viewStorySettings } from './views/story-settings.js';
import { viewCharacters, viewCharacter } from './views/characters.js';
import { viewUser, viewSettings } from './views/people.js';
import { viewNotifications } from './views/notifications.js';
import { viewAdmin } from './views/admin.js';

export const state = {
  user: null,
  home: { stories: [], notificationsUnread: 0, reportsOpen: 0 },
  story: null, // { story, role, notify, members, channels, cast }
  blocks: new Set(),
  characters: null,
  route: { storyId: null, channelId: null },
};

// Views subscribe to live events through this bus.
export const bus = new EventTarget();
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

let cleanup = [];
export const onLeave = (fn) => cleanup.push(fn);

// Views await data before rendering; if the route changed meanwhile, they must not render.
// Each view grabs alive() synchronously when it starts and passes it to page().
let routeSeq = 0;
class StaleView extends Error {}
export function routeAlive() {
  const seq = routeSeq;
  return () => seq === routeSeq;
}
export function ensureAlive(alive) {
  if (!alive()) throw new StaleView();
}

// ---------- Data ----------
export async function refreshHome() {
  if (!state.user) return;
  state.home = await api('/api/home');
  renderRail();
  renderSidebar();
  renderTabbar();
  updateTitle();
}

export async function loadStory(id) {
  state.story = await api(`/api/stories/${id}`);
  if (state.route.storyId === id) setAmbient(state.story.story.banner || state.story.story.icon);
  renderSidebar();
  renderMembers();
  return state.story;
}

export async function myCharacters(force = false) {
  if (!state.characters || force) state.characters = (await api('/api/characters')).characters;
  return state.characters;
}

export async function refreshBlocks() {
  if (!state.user) return;
  state.blocks = new Set((await api('/api/blocks')).users.map((u) => u.id));
}

// ---------- Look & feel ----------
export const THEMES = [['auto', 'Auto'], ['dusk', 'Dusk'], ['midnight', 'Midnight'], ['bluehour', 'Blue hour'], ['aurora', 'Aurora'], ['mist', 'Mist']];
const THEME_COLORS = { dusk: '#2b2830', midnight: '#0a0a0c', bluehour: '#1e1d22', aurora: '#fbe7dc', mist: '#dcdbd8' };

export function currentThemePick() { return store.get('nuuvi:theme') || 'auto'; }

export function applyTheme(pick = currentThemePick()) {
  store.set('nuuvi:theme', pick === 'auto' ? null : pick);
  const light = window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = pick === 'auto' ? (light ? 'mist' : 'dusk') : pick;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLORS[theme]);
}

// The blurred picture behind everything (a story's banner, a profile's portrait…).
let ambientSrc = null;
export function setAmbient(src) {
  const img = $('#ambient img');
  if (!img || src === ambientSrc) return;
  ambientSrc = src || null;
  img.classList.remove('on');
  if (!src) return;
  img.onload = () => { if (ambientSrc === src) img.classList.add('on'); };
  img.src = src;
}

function updateTitle() {
  const n = state.home.notificationsUnread;
  document.title = n ? `(${n}) NUUVI` : 'NUUVI';
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// ---------- Chrome ----------
const storyIcon = (s) => (s.icon
  ? html`<img src="${s.icon}" alt="">`
  : html`<span data-color="${s.color}">${s.title.trim().slice(0, 2)}</span>`);

function renderRail() {
  const rail = $('#rail');
  if (!state.user) return render(rail, html``);
  const active = state.route.storyId;
  render(rail, html`
    <a href="#/home" class="rail-item home ${!active ? 'active' : ''}" title="Home" aria-label="Home">
      <img src="/icon.svg" alt="">
      ${state.home.notificationsUnread ? html`<span class="badge">${state.home.notificationsUnread}</span>` : ''}
    </a>
    <div class="rail-sep"></div>
    ${state.home.stories.map((s) => html`
      <a href="#/s/${s.id}" class="rail-item ${active === s.id ? 'active' : ''} ${s.unread ? 'unread' : ''}" title="${s.title}" aria-label="${s.title}">
        <span class="pill"></span>${storyIcon(s)}
        ${s.mentions ? html`<span class="badge">${s.mentions}</span>` : ''}
      </a>`)}
    <a href="#/new" class="rail-item action" title="Start a story" aria-label="Start a story">${icons.plus}</a>
    <a href="#/discover" class="rail-item action" title="Discover stories" aria-label="Discover stories">${icons.compass}</a>`);
}

function userPanel() {
  const u = state.user;
  return html`
    <footer class="user-panel">
      <a href="#/u/${u.id}" class="me">${avatar({ name: u.displayName, src: u.avatar, color: '#7c5cff' })}
        <span><strong>${u.displayName}</strong><small>@${u.username}</small></span></a>
      <a href="#/settings" class="icon-btn" title="Settings" aria-label="Settings">${icons.gear}</a>
    </footer>`;
}

function renderSidebar() {
  const side = $('#sidebar');
  if (!state.user) return render(side, html``);
  const hash = location.hash || '#/';
  const s = state.story;
  if (state.route.storyId && s && s.story.id === state.route.storyId) {
    const isOwner = s.role === 'owner';
    render(side, html`
      <button class="side-head story-head-btn ${s.story.banner ? 'has-banner' : ''}" id="story-menu">
        ${s.story.banner ? html`<img src="${s.story.banner}" alt="">` : ''}
        <span>${s.story.title}</span>${icons.chevron}
      </button>
      <div class="side-scroll">
        ${!s.role ? html`<div class="join-hint">
            <p>You're reading as a guest.</p>
            ${s.story.status === 'open' ? html`<button class="primary block" id="side-join">Join this story</button>` : html`<p class="muted small">Closed to new writers.</p>`}
          </div>` : ''}
        <div class="side-section">
          <span>Channels</span>
          ${isOwner ? html`<a href="#/s/${s.story.id}/settings" class="icon-btn sm" title="Add or edit channels" aria-label="Add or edit channels">${icons.plus}</a>` : ''}
        </div>
        ${s.channels.map((c) => {
          const myTurn = c.turns.enabled && c.turns.current === state.user.id;
          return html`
          <a href="#/s/${s.story.id}/${c.id}" class="chan ${state.route.channelId === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''}">
            <span class="hash">${icons.hash}</span><span class="name">${c.name}</span>
            ${myTurn ? html`<span class="turn-dot" title="Your turn">${icons.hourglass}</span>` : ''}
            ${c.mentions ? html`<span class="badge">${c.mentions}</span>` : ''}
          </a>`;
        })}
      </div>
      ${userPanel()}`);
    $('#story-menu').addEventListener('click', (e) => storyMenu(e.currentTarget));
    $('#side-join')?.addEventListener('click', joinCurrentStory);
  } else {
    const link = (href, label, icon, badge = 0) => html`
      <a href="${href}" class="nav-link ${hash === href ? 'active' : ''}">${icon}<span>${label}</span>${badge ? html`<span class="badge">${badge}</span>` : ''}</a>`;
    render(side, html`
      <div class="side-head"><span>NUUVI</span><span class="script muted">your stories</span></div>
      <div class="side-scroll">
        ${link('#/home', 'Home', icons.home)}
        ${link('#/notifications', 'Notifications', icons.bell, state.home.notificationsUnread)}
        ${link('#/discover', 'Discover', icons.compass)}
        ${link('#/characters', 'Characters', icons.mask)}
        ${state.user.isAdmin ? link('#/admin', 'Admin', icons.shield, state.home.reportsOpen) : ''}
        ${link('#/settings', 'Settings', icons.gear)}
        <div class="side-section"><span>Your stories</span><a href="#/new" class="icon-btn sm" title="Start a story" aria-label="Start a story">${icons.plus}</a></div>
        ${state.home.stories.length ? state.home.stories.map((st) => html`
          <a href="#/s/${st.id}" class="nav-link story-link ${st.unread ? 'unread' : ''}">
            <span class="mini-icon">${storyIcon(st)}</span><span>${st.title}</span>
            ${st.mentions ? html`<span class="badge">${st.mentions}</span>` : ''}
          </a>`) : html`<p class="muted small pad">No stories yet.</p>`}
      </div>
      ${userPanel()}`);
  }
}

function renderMembers() {
  const panel = $('#members');
  const s = state.story;
  if (!state.route.storyId || !s) { document.body.classList.remove('has-members'); return render(panel, html``); }
  document.body.classList.add('has-members');
  const group = (title, list) => (list.length ? html`
    <div class="side-section"><span>${title} — ${list.length}</span></div>
    ${list.map((m) => html`<a class="member" href="#/u/${m.id}">${avatar({ name: m.displayName, src: m.avatar, color: '#6b6880' })}
      <span>${m.displayName}${state.blocks.has(m.id) ? html` <small class="muted">(blocked)</small>` : ''}</span></a>`)}` : '');
  render(panel, html`
    <div class="side-scroll">
      ${group('Owner', s.members.filter((m) => m.role === 'owner'))}
      ${group('Writers', s.members.filter((m) => m.role !== 'owner'))}
      ${s.cast.length ? html`<div class="side-section"><span>Cast — ${s.cast.length}</span></div>
        ${s.cast.map((c) => html`<a class="member" href="#/c/${c.id}">${avatar({ name: c.name, src: c.avatar, color: c.color })}<span data-color="${c.color}" class="cast-name">${c.name}</span></a>`)}` : ''}
    </div>`);
}

function renderTabbar() {
  const bar = $('#tabbar');
  if (!state.user) return render(bar, html``);
  const hash = location.hash;
  const tab = (href, label, icon, badge = 0, match = href) => html`
    <a href="${href}" class="${hash.startsWith(match) ? 'active' : ''}">${icon}<span>${label}</span>${badge ? html`<span class="badge">${badge}</span>` : ''}</a>`;
  render(bar, html`
    ${tab('#/home', 'Home', icons.home)}
    ${tab('#/notifications', 'Alerts', icons.bell, state.home.notificationsUnread)}
    ${tab('#/characters', 'Characters', icons.mask)}
    ${tab('#/settings', 'You', avatar({ name: state.user.displayName, src: state.user.avatar, color: '#7c5cff', size: 'xs' }))}`);
}

async function joinCurrentStory() {
  const id = state.story.story.id;
  try {
    await api(`/api/stories/${id}/join`, { method: 'POST', body: {} });
    toast('Welcome to the story!');
    await refreshHome();
    router();
  } catch (err) { toast(err.message); }
}

function storyMenu(anchor) {
  const s = state.story;
  const id = s.story.id;
  const setNotify = async (level) => {
    await api(`/api/stories/${id}/notify`, { method: 'PUT', body: { level } });
    s.notify = level;
    toast({ all: 'Notifying you about every post', mentions: 'Only @mentions and your turns', none: 'Muted (turns still notify)' }[level]);
  };
  menu(anchor, [
    s.role === 'owner' && { label: 'Story settings', action: () => { location.hash = `#/s/${id}/settings`; } },
    s.role === 'owner' && { label: 'Copy invite link', action: () => copyText(`${location.origin}/#/join/${id}/${s.story.inviteCode}`, 'Invite link copied') },
    s.role && { label: `${s.notify === 'all' ? '✓ ' : ''}Notify: every post`, action: () => setNotify('all') },
    s.role && { label: `${s.notify === 'mentions' ? '✓ ' : ''}Notify: mentions & turns`, action: () => setNotify('mentions') },
    s.role && { label: `${s.notify === 'none' ? '✓ ' : ''}Notify: nothing`, action: () => setNotify('none') },
    s.role === 'writer' && {
      label: 'Leave story', danger: true,
      action: async () => {
        if (!(await confirmModal('Leave this story? Your posts will stay.', { ok: 'Leave', danger: true }))) return;
        await api(`/api/stories/${id}/leave`, { method: 'POST', body: {} });
        await refreshHome();
        location.hash = '#/home';
      },
    },
  ]);
}

export async function copyText(text, message = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(message); } catch { window.prompt('Copy this:', text); }
}

// ---------- Page scaffold ----------
// Every page renders a header (with the mobile drawer button) and a body.
export function page({ title, subtitle = '', actions = '', body, className = '', alive }) {
  if (alive) ensureAlive(alive);
  const main = $('#main');
  render(main, html`
    <header class="main-head">
      <button class="icon-btn only-mobile" data-drawer aria-label="Open navigation">${icons.menu}</button>
      <div class="head-title"><h1>${title}</h1>${subtitle ? html`<span class="topic">${subtitle}</span>` : ''}</div>
      <div class="head-actions">${actions}${state.route.storyId ? html`<button class="icon-btn" data-members aria-label="Members" title="Members">${icons.users}</button>` : ''}</div>
    </header>
    <div class="main-body ${className}">${body}</div>`);
  return $('.main-body', main);
}

// ---------- Mobile drawer ----------
const closeDrawers = () => document.body.classList.remove('drawer-open', 'members-open');
function setupDrawer() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-drawer]')) { document.body.classList.add('drawer-open'); return; }
    if (e.target.closest('[data-members]')) {
      const wide = window.matchMedia('(min-width: 1200px)').matches;
      if (wide) {
        document.body.classList.toggle('members-hidden');
        store.set('nuuvi:members-hidden', document.body.classList.contains('members-hidden') ? '1' : null);
      } else {
        document.body.classList.toggle('members-open');
      }
      return;
    }
    if (e.target.id === 'scrim') closeDrawers();
    // Following a link inside a drawer closes it.
    if (e.target.closest('#rail a, #sidebar a, #members a')) {
      // Tapping a story icon keeps the drawer open so you can pick a channel, like Discord.
      if (!e.target.closest('#rail a[href^="#/s/"]')) closeDrawers();
    }
  });
  if (store.get('nuuvi:members-hidden')) document.body.classList.add('members-hidden');

  // Swipe right to open the drawer, left to close it.
  let start = null;
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!start || window.matchMedia('(min-width: 900px)').matches) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const quick = Date.now() - start.time < 600;
    if (quick && Math.abs(dx) > 70 && Math.abs(dy) < 50 && !e.target.closest('textarea, input, .no-swipe')) {
      const body = document.body.classList;
      if (dx > 0) {
        if (body.contains('members-open')) body.remove('members-open');
        else if (state.user) body.add('drawer-open');
      } else if (body.contains('drawer-open')) body.remove('drawer-open');
      else if (state.route.storyId) body.add('members-open');
    }
    start = null;
  }, { passive: true });
}

// ---------- Live events ----------
let source = null;
let sourceKey = null;
function connectLive() {
  const storyId = state.route.storyId;
  const key = state.user ? `u:${storyId ?? ''}` : storyId ? `a:${storyId}` : null;
  if (key === sourceKey) return;
  source?.close();
  source = null;
  sourceKey = key;
  if (!key) return;
  source = new EventSource(`/api/events${storyId ? `?story=${storyId}` : ''}`);
  let opened = false;
  source.addEventListener('open', () => { if (opened) emit('reconnect'); opened = true; });
  for (const type of ['post', 'edit', 'delete', 'channel', 'story', 'notification', 'kicked']) {
    source.addEventListener(type, (e) => handleLive(type, JSON.parse(e.data)));
  }
}

function handleLive(type, data) {
  if (type === 'post' && data.userId !== state.user?.id) {
    const viewing = state.route.channelId === data.channelId && document.visibilityState === 'visible';
    if (!viewing) {
      const s = state.home.stories.find((x) => x.id === data.storyId);
      if (s) s.unread += 1;
      const c = state.story?.channels.find((x) => x.id === data.channelId);
      if (c) c.unread += 1;
      renderRail();
      renderSidebar();
    }
  }
  if (type === 'channel' && state.story?.story.id === data.storyId) {
    const i = state.story.channels.findIndex((c) => c.id === data.id);
    if (i >= 0) state.story.channels[i] = { ...state.story.channels[i], ...data, unread: state.story.channels[i].unread, mentions: state.story.channels[i].mentions };
    renderSidebar();
  }
  if (type === 'story') {
    if (state.story?.story.id === data.storyId) {
      loadStory(data.storyId).then(() => emit('story-updated')).catch(() => { location.hash = '#/home'; });
    }
    refreshHome().catch(() => {});
  }
  if (type === 'notification') {
    const inChannel = data.channel && state.route.channelId === data.channel.id && document.visibilityState === 'visible';
    if (!inChannel) {
      refreshHome().catch(() => {});
      if (data.type === 'turn') toast(`It's your turn in #${data.channel?.name}`);
      else if (data.type === 'mention') toast(`${data.actor?.displayName} mentioned you`);
    }
  }
  if (type === 'kicked' && state.route.storyId === data.storyId) {
    toast('You were removed from this story');
    location.hash = '#/home';
  }
  emit(type, data);
}

// ---------- Routing ----------
const routes = [
  [/^#\/?$/, () => (state.user ? location.replace('#/home') : viewLanding())],
  [/^#\/register\/([\w-]+)$/, (code) => (state.user ? location.replace('#/home') : viewLanding({ invite: code }))],
  [/^#\/reset\/([\w-]+)$/, (token) => viewReset(token)],
  [/^#\/home$/, viewHome, true],
  [/^#\/discover$/, viewDiscover],
  [/^#\/new$/, viewNewStory, true],
  [/^#\/notifications$/, viewNotifications, true],
  [/^#\/characters$/, viewCharacters, true],
  [/^#\/c\/(\d+)$/, viewCharacter],
  [/^#\/u\/(\d+)$/, viewUser],
  [/^#\/settings$/, viewSettings, true],
  [/^#\/admin$/, viewAdmin, true],
  [/^#\/join\/(\d+)\/([\w-]+)$/, viewJoin, true],
  [/^#\/s\/(\d+)\/settings$/, viewStorySettings, true],
  [/^#\/s\/(\d+)(?:\/(\d+))?$/, viewChannel],
];

export async function router() {
  routeSeq += 1;
  cleanup.forEach((fn) => fn());
  cleanup = [];
  document.querySelector('.popover')?.remove();
  const hash = location.hash || '#/';
  const found = routes.find(([re]) => re.test(hash));
  const storyMatch = hash.match(/^#\/s\/(\d+)(?:\/(\d+))?/);
  state.route = { storyId: storyMatch ? Number(storyMatch[1]) : null, channelId: storyMatch?.[2] ? Number(storyMatch[2]) : null };
  if (!state.route.storyId) state.story = null;
  setAmbient(state.route.storyId && state.story ? state.story.story.banner || state.story.story.icon : null);

  document.body.classList.toggle('guest', !state.user);
  document.body.classList.toggle('in-channel', !!state.route.channelId);
  document.body.classList.remove('members-open');
  renderRail();
  renderSidebar();
  renderMembers();
  renderTabbar();
  connectLive();

  if (!found) return page({ title: 'Not found', body: html`<div class="empty"><p>That page doesn't exist.</p><a href="#/home">Go home</a></div>` });
  const [re, fn, needsUser] = found;
  if (needsUser && !state.user) {
    store.set('nuuvi:after-login', hash);
    return location.replace('#/');
  }
  try {
    await fn(...hash.match(re).slice(1));
  } catch (err) {
    if (err instanceof StaleView) return;
    if (err.status === 401) {
      store.set('nuuvi:after-login', hash);
      return location.replace('#/');
    }
    page({ title: err.status === 404 ? 'Not found' : 'Something went wrong', body: html`<div class="empty"><p>${err.message}</p><a href="#/home">Go home</a></div>` });
  }
}

export async function signedIn(user) {
  state.user = user;
  state.characters = null;
  await Promise.all([refreshHome(), refreshBlocks()]);
  const next = store.get('nuuvi:after-login');
  store.set('nuuvi:after-login', null);
  sourceKey = null;
  location.hash = next && next !== '#/' ? next : '#/home';
  router();
}

export function signedOut() {
  state.user = null;
  state.home = { stories: [], notificationsUnread: 0, reportsOpen: 0 };
  state.characters = null;
  state.blocks = new Set();
  sourceKey = null;
  location.hash = '#/';
}

// ---------- Boot ----------
async function boot() {
  try {
    state.user = (await api('/api/me')).user;
  } catch {
    state.user = null;
  }
  if (state.user) await Promise.all([refreshHome(), refreshBlocks()]).catch(() => {});
  setupDrawer();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme());
  window.addEventListener('hashchange', router);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) {
      refreshHome().catch(() => {});
      emit('reconnect');
    }
  });
  router();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Clicking a push notification while the app is open navigates here.
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.url) location.hash = e.data.url.replace(/^\/?/, ''); });
  }
}

boot();
