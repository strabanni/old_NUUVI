// App shell: Discord-style chrome (story rail, sidebar, members panel, mobile drawer + tab bar),
// routing, and the live event connection.
import { html, raw, render, api, $, $$, store, toast, avatar, icons, menu, modal, confirmModal, logoMark, wordmark, userGrad, uploadImage, uploadBanner, askImageLink, openLightbox } from './lib.js';
import { viewLanding, viewReset } from './views/auth.js';
import { viewHome, viewDiscover, viewNewStory, viewJoin } from './views/home.js';
import { viewChannel } from './views/channel.js';
import { viewStorySettings } from './views/story-settings.js';
import { viewCharacters, viewCharacter } from './views/characters.js';
import { viewUser, viewSettings } from './views/people.js';
import { viewNotifications } from './views/notifications.js';
import { viewAdmin } from './views/admin.js';
import { openThreadForm } from './views/threads.js';
import { viewNu } from './views/nu.js';
import { viewMessages } from './views/messages.js';
import { viewEvents, viewEvent } from './views/events.js';
import { viewDirectory } from './views/directory.js';
import { viewPhone, viewPhoneThread } from './views/phone.js';
import { viewLore } from './views/overview.js';
import { viewArchive } from './views/archive.js';
import { viewProfiles, viewProfile } from './views/profiles.js';
import { viewNpcs, viewLocations } from './views/npcs.js';
import { viewSocialPost } from './views/social.js';

let railDrag = null; // a story being dragged in the sidebar (see "Drag stories" below)
let railDragged = false;

export const state = {
  user: null,
  home: { stories: [], notificationsUnread: 0, reportsOpen: 0 },
  story: null, // { story, role, notify, members, channels, cast }
  blocks: new Set(),
  characters: null,
  route: { storyId: null, channelId: null },
  online: [], // user ids with the app open right now
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
  renderUserbar();
  renderRail();
  renderSidebar();
  updateTitle();
}

export async function loadStory(id) {
  state.story = await api(`/api/stories/${id}`);
  renderSidebar();
  renderMembers();
  return state.story;
}

// Cached briefly so a character made on another device shows up within a minute.
let charactersAt = 0;
export async function myCharacters(force = false) {
  if (!state.characters || force || Date.now() - charactersAt > 60000) {
    state.characters = (await api('/api/characters')).characters;
    charactersAt = Date.now();
  }
  return state.characters;
}

// Your characters who can be played (not deceased or missing in action): the ones offered when you
// post, comment, like, follow or write in an episode.
export const playableCharacters = async (force = false) => (await myCharacters(force)).filter((c) => !c.status);

export async function loadOnline() {
  if (!state.user) return;
  state.online = (await api('/api/online')).users.map((u) => u.id);
  renderRail();
}

async function showOnline(anchor) {
  const { users } = await api('/api/online');
  menu(anchor, users.length ? users.map((u) => ({ label: `● ${u.displayName}${u.id === state.user.id ? ' (you)' : ''}`, action: () => { location.hash = `#/u/${u.id}`; } }))
    : [{ label: 'Nobody else is online', action: () => {} }]);
}

export async function refreshBlocks() {
  if (!state.user) return;
  state.blocks = new Set((await api('/api/blocks')).users.map((u) => u.id));
}

// ---------- Look & feel ----------
export const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
const THEME_COLORS = { light: '#FFFFFF', dark: '#0E0E0F' };
// The user bar's theme button flips between these.
const THEME_CYCLE = { light: 'dark', dark: 'light' };
const THEME_NAMES = { light: 'Light mode', dark: 'Dark mode' };
// Auto flips to whichever mode the device isn't showing right now.
const nextTheme = () => THEME_CYCLE[currentThemePick()] || (document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

export function currentThemePick() {
  const v = store.get('nuuvi:theme');
  // The old Neutral themes became plain Light and Dark.
  if (v === 'mono-light' || v === 'mono-dark') return v.slice(5);
  return ['light', 'dark'].includes(v) ? v : 'auto';
}

export function applyTheme(pick = currentThemePick()) {
  store.set('nuuvi:theme', pick === 'auto' ? null : pick);
  const light = window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = pick === 'auto' ? (light ? 'light' : 'dark') : pick;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = 'neutral';
  document.documentElement.dataset.brand = 'pink';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', THEME_COLORS[theme]);
  if (state.user) { renderUserbar(); renderRail(); }
}

// The blurred picture behind everything (a story's banner, a profile's portrait…).
// Profile/story pictures used to be blurred behind the app; that tinted dark and light mode,
// so it's off. Kept as a no-op so views can still call it.
export function setAmbient() {}

function updateTitle() {
  const n = state.home.notificationsUnread;
  document.title = n ? `(${n}) NUUVI` : 'NUUVI';
  if ('setAppBadge' in navigator) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// ---------- Chrome ----------
const storyIcon = (s) => (s.icon
  ? html`<img src="${s.icon}" alt="">`
  : html`<span data-color="${s.color}">${s.title.trim().slice(0, 2)}</span>`);

const fmt = (n) => Number(n || 0).toLocaleString();

// The Blue Hour-style user bar. Horizontal across the top on computers; on phones it runs
// vertically down the drawer, where the story rail is.
function userTiles({ vertical = false } = {}) {
  const next = nextTheme();
  const n = state.home.notificationsUnread;
  const tile = (attrs, label, icon, badge = 0) => html`
    <${raw(attrs.href ? 'a' : 'button')} class="ub-tile" ${raw(attrs.href ? `href="${attrs.href}"` : `type="button" data-ub="${attrs.act}"`)} title="${label}" aria-label="${label}">
      ${icon}${badge ? html`<span class="badge">${badge}</span>` : ''}
    </${raw(attrs.href ? 'a' : 'button')}>`;
  return html`
    <nav class="ub-tiles ${vertical ? 'vertical' : ''}" aria-label="Your shortcuts">
      ${tile({ act: 'theme' }, `Switch to ${THEME_NAMES[next]}`, { light: icons.sun, dark: icons.moon }[next])}
      ${tile({ href: '#/nu' }, 'THE : NU', icons.apps)}
      ${tile({ href: '#/notifications' }, 'Notifications', icons.bell, n)}
      ${tile({ href: '#/characters' }, 'Your characters', icons.user)}
      ${tile({ href: '#/settings' }, 'You & settings', icons.crown)}
      ${tile({ act: 'logout' }, 'Sign out', icons.power)}
    </nav>`;
}

// A little hello that changes: first visit, coming back after a while, time of day, or
// something quirky. Picked once per visit so it doesn't change while you click around.
// {n} marks where the name goes.
const GREETINGS = {
  first: ['Welcome to NUUVI, {n}', 'Hi {n}, nice to meet you', 'Welcome in, {n}', 'Make yourself at home, {n}'],
  long: ['Look who’s back, {n}', 'Long time no see, {n}', 'We missed you, {n}', 'The return of {n}'],
  back: ['Welcome back, {n}', 'Good to see you, {n}', 'Hey again, {n}', 'There you are, {n}'],
  morning: ['Good morning, {n}', 'Rise and write, {n}', 'Morning, {n}'],
  afternoon: ['Good afternoon, {n}', 'Afternoon, {n}', 'Hey {n}, how’s your day?'],
  evening: ['Good evening, {n}', 'Evening, {n}', 'Cozy writing hours, {n}'],
  night: ['Up late, {n}?', 'Hello, night owl {n}', 'Midnight muse, {n}?'],
  quirky: ['Plot twist: it’s {n}', 'The muse has arrived, {n}', 'Pen’s ready, {n}', 'Main character energy, {n}',
    'Your characters missed you, {n}', 'Cue the entrance, {n}', 'Ready for the next arc, {n}?', 'Hi {n}, spill the plot'],
};
let greetingPick = null;
function greetingFor(name) {
  if (!greetingPick) {
    const now = Date.now();
    const last = Number(store.get('nuuvi:last-visit')) || 0;
    store.set('nuuvi:last-visit', String(now));
    const hour = new Date().getHours();
    const away = last ? now - last : Infinity;
    const day = 864e5;
    let pool;
    if (!last) pool = GREETINGS.first;
    else if (away > 7 * day) pool = GREETINGS.long;
    else if (Math.random() < 0.3) pool = GREETINGS.quirky;
    else if (away > day && Math.random() < 0.5) pool = GREETINGS.back;
    else pool = hour < 5 || hour >= 22 ? GREETINGS.night : hour < 12 ? GREETINGS.morning : hour < 17 ? GREETINGS.afternoon : GREETINGS.evening;
    greetingPick = pool[Math.floor(Math.random() * pool.length)];
  }
  const [before, after] = greetingPick.split('{n}');
  return html`${before}<a class="u-grad greet-name"${userGrad(state.user)} href="#/u/${state.user.id}" title="Your profile">${name}</a>${after}`;
}
export const greeting = () => greetingFor(state.user.displayName);

function welcomeText() {
  const u = state.user;
  const st = state.home.stats || {};
  return html`
    <div class="ub-text">
      <h2>${greetingFor(u.displayName)}</h2>
      <p>You have <b>${fmt(st.posts)}</b> posts and <b>${fmt(st.characters)}</b> characters</p>
    </div>`;
}

function renderUserbar() {
  const bar = $('#userbar');
  if (!state.user) return render(bar, html``);
  const u = state.user;
  const crumb = $('#crumb')?.textContent || '';
  render(bar, html`
    <div class="ub-crumb"><a href="#/home">NUUVI</a><i>···</i><span id="crumb">${crumb}</span></div>
    <div class="ub-main">
      <a class="ub-avatar" href="#/u/${u.id}" aria-label="Your profile">${avatar({ name: u.displayName, src: u.avatar, color: '#EE719E', size: 'square' })}</a>
      ${welcomeText()}
      ${userTiles()}
    </div>`);
}

function renderRail() {
  const rail = $('#rail');
  if (railDrag) return; // not while a story is being dragged
  if (!state.user) return render(rail, html``);
  const u = state.user;
  // Completed stories live in the Archive (a fixed item under Home), not in the list.
  const archivedCount = state.home.stories.filter((s) => s.completedAt).length;
  const activeStory = state.home.stories.find((s) => s.id === state.route.storyId);
  const inArchive = /^#\/archive/.test(location.hash) || !!activeStory?.completedAt;
  const inMessages = /^#\/messages/.test(location.hash);
  const active = inArchive ? null : state.route.storyId;
  render(rail, html`
    <button type="button" class="rail-item rail-logo ${state.online.length > 1 ? 'others' : ''}" id="online-btn"
      title="NUUVI · ${state.online.length} online" aria-label="NUUVI — ${state.online.length} people online">
      ${logoMark}<span class="online-badge"><span class="pulse"></span>${state.online.length || ''}</span>
    </button>
    <div class="rail-sep rail-sep-top"></div>
    <a href="#/home" class="rail-item home-link ${!active && !inArchive && !inMessages ? 'active' : ''}" title="Home" aria-label="Home">${icons.home}</a>
    <a href="#/archive" class="rail-item archive-link ${inArchive ? 'active' : ''}" title="Archive: completed stories" aria-label="Archive">${icons.archive}${archivedCount ? html`<i class="rail-count">${archivedCount}</i>` : ''}</a>
    <a href="#/messages" class="rail-item messages-link phone-only-flex ${inMessages ? 'active' : ''}" title="Messages" aria-label="Messages">${icons.chat}${state.home.messagesUnread ? html`<span class="badge">${state.home.messagesUnread}</span>` : ''}</a>
    <div class="rail-sep rail-sep-stories"></div>
    ${state.home.stories.filter((s) => !s.completedAt).map((s) => html`
      <a href="#/s/${s.id}" class="rail-item ${active === s.id ? 'active' : ''} ${s.unread ? 'unread' : ''}" data-story-id="${s.id}" draggable="false" title="${s.title}" aria-label="${s.title}">
        <span class="pill"></span>${storyIcon(s)}
        ${s.mentions ? html`<span class="badge">${s.mentions}</span>` : ''}
      </a>`)}
    <a href="#/new" class="rail-item action" title="Start a story" aria-label="Start a story">${icons.plus}</a>
    <a href="#/discover" class="rail-item action" title="Discover stories" aria-label="Discover stories">${icons.compass}</a>
    <div class="rail-user only-mobile">
      <div class="rail-sep"></div>
      ${userTiles({ vertical: true })}
      <a class="ub-avatar" href="#/u/${u.id}" aria-label="Your profile">${avatar({ name: u.displayName, src: u.avatar, color: '#EE719E', size: 'square' })}</a>
    </div>`);
}

export const KIND_LABELS = { thread: 'Episodes', para: 'Self paras', comms: 'Comms', event: 'Events', ooc: 'Out of character' };
export const kindIcon = (kind) => ({ thread: icons.episode, para: icons.feather, comms: icons.chat, event: icons.calendar, ooc: icons.hash })[kind] || icons.hash;
// A channel's own icon (set per comms thread): a picture, an emoji, or the icon for its type.
export const channelIcon = (c) => (!c.icon ? kindIcon(c.kind)
  : /^(\/|https:)/.test(c.icon) ? html`<img class="ch-icon-img" src="${c.icon}" alt="">`
    : html`<span class="ch-emoji">${c.icon}</span>`);

// How episodes are ordered in a story's sidebar (each person picks; remembered on this device).
const EP_SORTS = [['custom', 'Story order'], ['last', 'Latest post first'], ['new', 'Newest first'], ['old', 'Oldest first'], ['name', 'Name (A–Z)']];
const epSort = () => (EP_SORTS.some(([k]) => k === store.get('nuuvi:ep-sort')) ? store.get('nuuvi:ep-sort') : 'custom');
function sortEpisodes(list) {
  const by = epSort();
  const time = (t) => (t ? new Date(`${String(t).replace(' ', 'T')}Z`).getTime() || 0 : 0);
  const out = [...list];
  if (by === 'last') out.sort((a, b) => time(b.lastPostAt || b.createdAt) - time(a.lastPostAt || a.createdAt));
  else if (by === 'new') out.sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id - a.id);
  else if (by === 'old') out.sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.id - b.id);
  else if (by === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

function renderSidebar() {
  const side = $('#sidebar');
  if (!state.user) return render(side, html``);
  const hash = location.hash || '#/';
  const s = state.story;
  const mobileWelcome = html`<div class="side-welcome only-mobile">${welcomeText()}</div>`;
  if (state.route.storyId && s && s.story.id === state.route.storyId) {
    // Comms became the Phone (and OOC became private Messages, in the main menu). Older comms/OOC
    // channels stay readable under "Old chats".
    const groups = ['thread', 'para', 'event'].map((k) => [k, sortEpisodes(s.channels.filter((c) => c.kind === k))]).filter(([, list]) => list.length);
    const archived = s.channels.filter((c) => c.kind === 'comms' || c.kind === 'ooc');
    render(side, html`
      ${mobileWelcome}
      <button class="side-head story-head-btn ${s.story.banner ? 'has-banner' : ''}" id="story-menu">
        ${s.story.banner ? html`<img src="${s.story.banner}" alt="">` : ''}
        <span>${s.story.title}</span>${icons.chevron}
      </button>
      <div class="side-scroll">
        ${!s.role ? html`<div class="join-hint">
            <p>You're reading as a guest.</p>
            ${s.story.status === 'open' ? html`<button class="primary block" id="side-join">Join this story</button>` : html`<p class="muted small">Closed to new writers.</p>`}
          </div>` : s.story.completedAt ? html`<a class="side-archived" href="#/archive">${icons.archive}<span>Complete · in the Archive</span></a>`
          : html`<button class="block new-thread-btn" id="new-thread">${icons.plus} New episode</button>`}
        ${groups.map(([kind, list], gi) => html`
          <div class="side-section"><span>${KIND_LABELS[kind]}</span>${gi === 0 ? html`<button type="button" class="icon-btn xs ep-sort-btn" id="ep-sort" title="Order: ${EP_SORTS.find(([k]) => k === epSort())[1]}" aria-label="Change the order of episodes">${icons.sliders}</button>` : ''}</div>
          ${list.map((c) => {
            const myTurn = c.turns.enabled && c.turns.current === state.user.id;
            return html`
            <a href="#/s/${s.story.id}/${c.id}" class="chan ${state.route.channelId === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''} status-${c.status}">
              <span class="hash">${channelIcon(c)}</span><span class="name">${c.name}</span>
              ${c.kind !== 'ooc' && c.status !== 'open' ? html`<span class="chan-status" title="${c.status === 'closed' ? 'Private episode' : 'Complete'}">${c.status === 'closed' ? icons.lock : icons.check}</span>` : ''}
              ${myTurn ? html`<span class="turn-dot" title="Your turn">${icons.hourglass}</span>` : ''}
              ${c.mentions ? html`<span class="badge">${c.mentions}</span>` : ''}
            </a>`;
          })}`)}
        <div class="side-section"><span>Texts</span></div>
        <a href="#/s/${s.story.id}/phone" class="chan ${/^#\/s\/\d+\/phone/.test(hash) ? 'active' : ''}">${icons.smartphone}<span class="name">Phone</span></a>
        ${archived.length ? html`<details class="side-archive"><summary class="side-section"><span>Old chats</span></summary>${archived.map((c) => html`
          <a href="#/s/${s.story.id}/${c.id}" class="chan ${state.route.channelId === c.id ? 'active' : ''} ${c.unread ? 'unread' : ''}"><span class="hash">${channelIcon(c)}</span><span class="name">${c.name}</span></a>`)}</details>` : ''}
      </div>`);
    $('#story-menu').addEventListener('click', (e) => storyMenu(e.currentTarget));
    $('#ep-sort')?.addEventListener('click', (e) => menu(e.currentTarget, EP_SORTS.map(([k, label]) => ({
      label: `${k === epSort() ? '✓ ' : ''}${label}`,
      action: () => { store.set('nuuvi:ep-sort', k === 'custom' ? null : k); renderSidebar(); },
    }))));
    $('#side-join')?.addEventListener('click', joinCurrentStory);
    $('#new-thread')?.addEventListener('click', async () => {
      openThreadForm({ storyId: s.story.id });
    });
  } else {
    const link = (href, label, icon, badge = 0) => html`
      <a href="${href}" class="nav-link ${hash === href ? 'active' : ''}">${icon}<span>${label}</span>${badge ? html`<span class="badge">${badge}</span>` : ''}</a>`;
    render(side, html`
      ${mobileWelcome}
      <div class="side-head"><a href="#/home" class="side-brand" aria-label="NUUVI home">${wordmark}</a></div>
      <div class="side-scroll">
        <a href="#/u/${state.user.id}" class="nav-link me-link ${hash === `#/u/${state.user.id}` ? 'active' : ''}">${avatar({ name: state.user.displayName, src: state.user.avatar, color: '#EE719E', size: 'xs' })}<span class="u-grad"${userGrad(state.user)}>${state.user.displayName}</span><small>@${state.user.username}</small></a>
        ${link('#/home', 'Home', icons.home)}
        ${link('#/nu', 'THE : NU', icons.apps)}
        ${link('#/notifications', 'Notifications', icons.bell, state.home.notificationsUnread)}
        ${link('#/phone', 'Phone', icons.smartphone)}
        <span class="desk-only-block">${link('#/messages', 'Messages', icons.chat, state.home.messagesUnread)}</span>
        ${link('#/directory', 'Directory', icons.users)}
        ${link('#/archive', 'Archive', icons.archive)}
        ${link('#/lore', 'Lore', icons.book)}
        ${link('#/discover', 'Discover', icons.compass)}
        ${state.user.isAdmin ? link('#/admin', 'Admin', icons.shield, state.home.reportsOpen) : ''}
        <div class="side-section"><span>Your stories</span><a href="#/new" class="icon-btn sm" title="Start a story" aria-label="Start a story">${icons.plus}</a></div>
        ${state.home.stories.length ? state.home.stories.map((st) => html`
          <a href="#/s/${st.id}" class="nav-link story-link ${st.unread ? 'unread' : ''}">
            <span class="mini-icon">${storyIcon(st)}</span><span>${st.title}</span>
            ${st.mentions ? html`<span class="badge">${st.mentions}</span>` : ''}
          </a>`) : html`<p class="muted small pad">No stories yet.</p>`}
      </div>`);
  }
}

function renderMembers() {
  const panel = $('#members');
  const s = state.story;
  if (!state.route.storyId || !s) { document.body.classList.remove('has-members'); return render(panel, html``); }
  document.body.classList.add('has-members');
  const group = (title, list) => (list.length ? html`
    <div class="side-section"><span>${title} — ${list.length}</span></div>
    ${list.map((m) => html`<a class="member ${state.online.includes(m.id) ? 'is-online' : ''}" href="#/u/${m.id}"><span class="av-wrap">${avatar({ name: m.displayName, src: m.avatar, color: '#48484A' })}<i class="online-dot"></i></span>
      <span><span class="u-grad"${userGrad(m)}>${m.displayName}</span>${state.blocks.has(m.id) ? html` <small class="muted">(blocked)</small>` : ''}</span></a>`)}` : '');
  render(panel, html`
    <div class="side-scroll">
      ${group('Owner', s.members.filter((m) => m.role === 'owner'))}
      ${group('Writers', s.members.filter((m) => m.role !== 'owner'))}
      ${s.cast.length ? html`<div class="side-section"><span>Cast — ${s.cast.length}</span></div>
        ${s.cast.map((c) => html`<a class="member" href="#/c/${c.id}">${avatar({ name: c.name, src: c.avatar, color: c.color })}<span data-color="${c.color}" class="cast-name">${c.name}</span></a>`)}` : ''}
    </div>`);
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

// Story owners and admins can change a story.
export const canManageStory = (s) => s?.role === 'owner' || !!state.user?.isAdmin;

// Change a story's header picture or icon straight from its menu (upload or link).
async function changeStoryPicture(id, field, anchor) {
  const pick = () => new Promise((resolve) => {
    menu(anchor && anchor.isConnected ? anchor : $('#main .main-head') || document.body, [
      { label: field === 'banner' ? 'Upload a header picture' : 'Upload an icon', action: () => {
        const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
        f.onchange = async () => { try { resolve(field === 'banner' ? await uploadBanner(f.files[0]) : await uploadImage(f.files[0], 400)); } catch (err) { toast(err.message); resolve(null); } };
        f.click();
      } },
      { label: 'Use a picture link', action: async () => resolve(await askImageLink(field === 'banner' ? 'Header picture link' : 'Icon link')) },
      { label: field === 'banner' ? 'Remove the header picture' : 'Remove the icon', danger: true, action: () => resolve('') },
    ]);
  });
  const value = await pick();
  if (value === null || value === undefined) return;
  try {
    await api(`/api/stories/${id}`, { method: 'PUT', body: { [field]: value } });
    toast(field === 'banner' ? (value ? 'Header picture changed' : 'Header picture removed') : (value ? 'Icon changed' : 'Icon removed'));
    await refreshHome();
    if (state.story?.story.id === id) await loadStory(id);
    renderRail(); renderSidebar();
  } catch (err) { toast(err.message); }
}

// Completing a story moves it to the Archive: still readable, but nobody can post in it.
export async function setStoryComplete(id, complete) {
  if (complete && !(await confirmModal('Mark this story complete? It moves to the Archive and becomes read-only. You can reopen it any time.', { ok: 'Mark complete' }))) return;
  try {
    await api(`/api/stories/${id}`, { method: 'PUT', body: { complete } });
    await refreshHome();
    if (state.story?.story.id === id) await loadStory(id);
    renderRail();
    toast(complete ? 'Moved to the Archive' : 'Reopened. It\'s back in your stories');
    if (/^#\/s\//.test(location.hash)) router();
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
    canManageStory(s) && { label: 'Story settings', action: () => { location.hash = `#/s/${id}/settings`; } },
    canManageStory(s) && { label: 'Change header picture', action: () => changeStoryPicture(id, 'banner', anchor) },
    canManageStory(s) && { label: 'Change icon', action: () => changeStoryPicture(id, 'icon', anchor) },
    canManageStory(s) && (s.story.completedAt
      ? { label: 'Reopen story (take it out of the Archive)', action: () => setStoryComplete(id, false) }
      : { label: 'Mark story complete (move to the Archive)', action: () => setStoryComplete(id, true) }),
    canManageStory(s) && s.story.inviteCode && { label: 'Copy invite link', action: () => copyText(`${location.origin}/#/join/${id}/${s.story.inviteCode}`, 'Invite link copied') },
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
// Header pictures for the main pages: they crossfade every 8 seconds (the NUUVI gradient
// shows until an admin adds pictures under Admin → Headers).
let headerPics = null;
export async function loadHeaders(force = false) {
  if (!headerPics || force) headerPics = (await api('/api/headers').catch(() => ({ headers: [] }))).headers;
  return headerPics;
}
function startBanner(main) {
  const banner = $('.page-banner', main);
  if (!banner) return;
  const show = (pics) => {
    if (!pics.length || !banner.isConnected) return;
    let i = Math.floor(Math.random() * pics.length);
    // Pictures load one ahead of time, not all at once, to spare phone data.
    const imgs = [];
    const get = (n) => {
      // Pictures fill the banner (the bundled ones are pre-cropped to its 3:1 shape).
      if (!imgs[n]) {
        const slide = document.createElement('div');
        slide.className = 'pb-slide';
        const img = new Image(); img.alt = ''; img.decoding = 'async'; img.className = 'pb-fg'; img.src = pics[n]; slide.append(img);
        slide.img = slide.lastChild;
        banner.prepend(slide);
        imgs[n] = slide;
      }
      return imgs[n];
    };
    get(i).classList.add('on');
    if (pics.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    get((i + 1) % pics.length);
    const timer = setInterval(() => {
      if (!banner.isConnected) return clearInterval(timer);
      const next = get((i + 1) % pics.length);
      if (!next.img.complete) return; // still loading: try again next time
      imgs[i].classList.remove('on');
      i = (i + 1) % pics.length;
      next.classList.add('on');
      get((i + 1) % pics.length);
    }, 4 * 60 * 1000); // a new header picture every 4 minutes
    onLeave(() => clearInterval(timer));
  };
  loadHeaders().then(show);
}

export function page({ title, subtitle = '', actions = '', body, className = '', alive, banner = false }) {
  if (alive) ensureAlive(alive);
  const main = $('#main');
  if (banner) {
    body = html`<section class="page-banner" aria-hidden="true"><div class="pb-glass"><span class="eyebrow">nuuvi</span><b>${banner === true ? title : banner}</b></div></section>${body}`;
  }
  // Phones: a back arrow on every page but Home; the menu button moves to the right-hand end.
  const atHome = /^#\/(home)?$/.test(location.hash || '#/');
  const menuBtn = html`<button class="icon-btn only-mobile" data-drawer aria-label="Open navigation">${icons.menu}</button>`;
  render(main, html`
    <header class="main-head">
      ${atHome ? menuBtn : html`<button class="icon-btn only-mobile back-btn" data-back aria-label="Back">${icons.back}</button>`}
      <div class="head-title"><h1>${title}</h1>${subtitle ? html`<span class="topic">${subtitle}</span>` : ''}</div>
      <div class="head-actions">${actions}${state.route.storyId ? html`<button class="icon-btn" data-members aria-label="Members" title="Members">${icons.users}</button>` : ''}${atHome ? '' : menuBtn}</div>
    </header>
    <div class="main-body ${className}">${body}</div>`);
  // Replay the page's entrance animation (see "Motion" in styles.css).
  main.classList.remove('enter'); void main.offsetWidth; main.classList.add('enter');
  const crumb = $('#crumb');
  if (crumb) crumb.textContent = $('.head-title h1', main)?.textContent.trim() || '';
  if (banner) startBanner(main);
  return $('.main-body', main);
}

// How many pages deep we are in this visit (for the back button).
// Each history entry is stamped with its depth (and the page before it), so Back always knows
// where it will land: going back, going forward and replacing a page are all told apart.
let replacing = false;
let navDepth = Number.isInteger(history.state?.nv) ? history.state.nv : 0;
const stamp = (nv, prev) => history.replaceState({ ...(history.state || {}), nv, prev }, '', location.href);
if (!Number.isInteger(history.state?.nv)) stamp(0, null);
let currentHash = location.hash || '#/';
let currentPrev = history.state?.prev ?? null;
window.addEventListener('hashchange', (e) => {
  const before = currentHash;
  currentHash = location.hash || '#/';
  if (replacing) { replacing = false; stamp(navDepth, currentPrev); return; }
  if (Number.isInteger(history.state?.nv)) { navDepth = history.state.nv; currentPrev = history.state.prev ?? null; return; } // back or forward
  navDepth += 1;
  currentPrev = new URL(e.oldURL).hash || before;
  stamp(navDepth, currentPrev);
});
// Swap the current page for another without adding a step to Back.
export function replaceHash(hash) {
  if ((location.hash || '#/') === hash) return;
  replacing = true;
  location.replace(hash);
}
// The page Back would return to (null at the first page).
export const previousHash = () => (navDepth > 0 ? currentPrev : null);
export function goBack(fallback = '#/home') {
  if (navDepth > 0) history.back(); else location.hash = fallback;
}

// Pictures people send (in messages, texts, chats, episodes and formatted posts) open in the
// in-app viewer instead of a new tab.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const link = e.target.closest('.b-pics a');
  const inline = !link && e.target.closest('img.fx-img');
  if (!link && !inline) return;
  e.preventDefault();
  if (link) {
    const all = [...link.closest('.b-pics').querySelectorAll('a')];
    openLightbox(all.map((a) => a.getAttribute('href')), all.indexOf(link));
  } else {
    openLightbox([inline.getAttribute('src')]);
  }
});

// ---------- Long-press (phones) = right-click (computers) ----------
// Holding a finger on something opens the same menu a right-click does: story icons, the story
// header, contacts, episodes in the sidebar…
let pressTimer = null;
let pressFired = false;
let pressStart = null;
document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  pressFired = false;
  pressStart = [t.clientX, t.clientY];
  const target = e.target;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressFired = true;
    navigator.vibrate?.(12);
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY }));
  }, 480);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (pressStart && t && Math.hypot(t.clientX - pressStart[0], t.clientY - pressStart[1]) > 10) clearTimeout(pressTimer);
}, { passive: true });
document.addEventListener('touchend', () => clearTimeout(pressTimer));
document.addEventListener('touchcancel', () => clearTimeout(pressTimer));
// The tap that ends a long-press shouldn't also open the link underneath.
document.addEventListener('click', (e) => { if (pressFired) { e.preventDefault(); e.stopPropagation(); pressFired = false; } }, true);

// ---------- Drag stories in the sidebar to put them in your own order ----------
// Computers: press and drag a story icon. Phones: hold a story (its menu opens), then slide your
// finger and the menu gives way to the drag. The order is saved to your account.
const railZoom = () => Number(getComputedStyle(document.documentElement).zoom) || 1;
function railDragStart(item, y) {
  document.querySelector('.popover')?.remove();
  const rail = $('#rail');
  railDrag = { item, rail, y, grabY: y, scroll: rail.scrollTop };
  railDragged = true;
  item.classList.add('dragging');
  rail.classList.add('sorting');
  navigator.vibrate?.(8);
}
function railDragMove(y) {
  const d = railDrag;
  if (!d) return;
  d.y = y;
  const { item, rail } = d;
  const others = [...rail.querySelectorAll('.rail-item[data-story-id]')].filter((x) => x !== item);
  // Move the icon in the list once the finger/pointer passes the middle of a neighbour.
  const before = others.find((x) => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
  const firstAfter = before ?? others.at(-1)?.nextElementSibling ?? null;
  if (firstAfter !== item && item.nextElementSibling !== firstAfter) {
    const top = item.getBoundingClientRect().top;
    rail.insertBefore(item, firstAfter);
    d.grabY += item.getBoundingClientRect().top - top;
  }
  // Scroll the sidebar when dragging near its top or bottom edge.
  const rr = rail.getBoundingClientRect();
  if (y < rr.top + 40) rail.scrollTop -= 8; else if (y > rr.bottom - 40) rail.scrollTop += 8;
  item.style.transform = `translateY(${(y - d.grabY) / railZoom()}px) scale(1.08)`;
}
async function railDragEnd() {
  const d = railDrag;
  if (!d) return;
  railDrag = null;
  d.item.classList.remove('dragging');
  d.item.style.transform = '';
  d.rail.classList.remove('sorting');
  setTimeout(() => { railDragged = false; }, 0);
  const ids = [...d.rail.querySelectorAll('.rail-item[data-story-id]')].map((x) => Number(x.dataset.storyId));
  if (ids.join() === state.home.stories.map((x) => x.id).join()) return;
  const byId = new Map(state.home.stories.map((x) => [x.id, x]));
  state.home.stories = ids.map((id) => byId.get(id)).filter(Boolean);
  try { await api('/api/home/order', { method: 'PUT', body: { storyIds: ids } }); } catch (err) { toast(err.message); }
  renderRail();
}
// Mouse
let railPress = null;
document.addEventListener('mousedown', (e) => {
  const item = e.button === 0 && e.target.closest('#rail .rail-item[data-story-id]');
  if (item) railPress = { item, y: e.clientY };
});
document.addEventListener('mousemove', (e) => {
  if (railDrag) { e.preventDefault(); railDragMove(e.clientY); return; }
  if (railPress && Math.abs(e.clientY - railPress.y) > 6) { railDragStart(railPress.item, railPress.y); railPress = null; railDragMove(e.clientY); }
});
document.addEventListener('mouseup', () => { railPress = null; railDragEnd(); });
document.addEventListener('dragstart', (e) => { if (e.target.closest?.('#rail')) e.preventDefault(); });
// Touch: after the long-press, sliding the finger starts the drag (and keeps the page from scrolling).
let railTouch = null;
document.addEventListener('touchstart', (e) => {
  const item = e.touches.length === 1 && e.target.closest('#rail .rail-item[data-story-id]');
  railTouch = item ? { item, y: e.touches[0].clientY, at: Date.now() } : null;
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const y = e.touches[0]?.clientY;
  if (railDrag) { e.preventDefault(); railDragMove(y); return; }
  if (railTouch && pressFired && Math.abs(y - railTouch.y) > 8) { e.preventDefault(); railDragStart(railTouch.item, railTouch.y); railTouch = null; railDragMove(y); }
}, { passive: false });
document.addEventListener('touchend', () => { railTouch = null; railDragEnd(); });
document.addEventListener('touchcancel', () => { railTouch = null; railDragEnd(); });
// A drop shouldn't also open the story underneath.
document.addEventListener('click', (e) => { if (railDragged && e.target.closest('#rail')) { e.preventDefault(); e.stopPropagation(); } }, true);

document.addEventListener('contextmenu', async (e) => {
  if (!state.user) return;
  const railStory = e.target.closest('[data-story-id]');
  const head = e.target.closest('#story-menu');
  const chan = e.target.closest('.side-scroll a.chan[href^="#/s/"]');
  if (!railStory && !head && !chan) return;
  e.preventDefault();
  if (head) { storyMenu(head); return; }
  if (chan) {
    const id = Number(chan.getAttribute('href').split('/')[3]);
    const c = state.story?.channels.find((x) => x.id === id);
    if (!c) return;
    const mineToManage = canManageStory(state.story) || c.createdBy === state.user.id;
    menu(chan, [
      { label: 'Open', action: () => { location.hash = chan.getAttribute('href'); } },
      mineToManage && { label: 'Edit episode', action: () => openThreadForm({ storyId: state.story.story.id, channel: c }) },
      mineToManage && { label: 'Delete', danger: true, action: async () => {
        if (!(await confirmModal(`Delete "${c.name}" and every post in it?`, { ok: 'Delete', danger: true }))) return;
        try {
          await api(`/api/channels/${c.id}`, { method: 'DELETE' });
          const sid = state.story.story.id;
          await loadStory(sid);
          renderSidebar();
          if (state.route.channelId === c.id) location.hash = `#/s/${sid}`;
        } catch (err) { toast(err.message); }
      } },
      { label: 'Copy link', action: () => copyText(`${location.origin}/${chan.getAttribute('href')}`, 'Link copied') },
    ]);
    return;
  }
  const id = Number(railStory.dataset.storyId);
  const st = state.home.stories.find((x) => x.id === id);
  const manage = st?.role === 'owner' || st?.ownerId === state.user.id || state.user.isAdmin;
  menu(railStory, [
    { label: 'Open', action: () => { location.hash = `#/s/${id}`; } },
    manage && { label: 'Story settings', action: () => { location.hash = `#/s/${id}/settings`; } },
    manage && { label: 'Change header picture', action: () => changeStoryPicture(id, 'banner', railStory) },
    manage && { label: 'Change icon', action: () => changeStoryPicture(id, 'icon', railStory) },
    manage && { label: 'Mark story complete (move to the Archive)', action: () => setStoryComplete(id, true) },
  ]);
});

// ---------- Mobile drawer ----------
const closeDrawers = () => document.body.classList.remove('drawer-open', 'members-open');
function setupDrawer() {
  document.addEventListener('click', async (e) => {
    if (e.target.closest('#online-btn')) { showOnline(e.target.closest('#online-btn')); return; }
    if (e.target.closest('[data-back]')) {
      // Back to the previous page in NUUVI, or Home if this was the first page opened.
      goBack();
      return;
    }
    const ub = e.target.closest('[data-ub]');
    if (ub?.dataset.ub === 'theme') {
      applyTheme(nextTheme());
      router(); // redraw the page so every part picks up the new colours
      return;
    }
    if (ub?.dataset.ub === 'logout') {
      if (!(await confirmModal('Sign out of NUUVI on this device?', { ok: 'Sign out' }))) return;
      await api('/api/auth/logout', { method: 'POST', body: {} });
      closeDrawers();
      signedOut();
      return;
    }
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
      // Tapping a story icon opens its channel list beside the rail, like Discord.
      if (e.target.closest('#rail a[href^="#/s/"]')) {
        if (window.matchMedia('(max-width: 899px)').matches) document.body.classList.add('drawer-open');
      } else closeDrawers();
    }
  });
  if (store.get('nuuvi:members-hidden')) document.body.classList.add('members-hidden');

  // Cards marked data-tilt lean gently toward the pointer (mouse / trackpad only, not when motion is reduced).
  const canTilt = window.matchMedia('(hover: hover) and (pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (canTilt) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest?.('[data-tilt]');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 8}deg`);
      card.style.setProperty('--rx', `${(0.5 - (e.clientY - r.top) / r.height) * 8}deg`);
    });
    document.addEventListener('pointerout', (e) => {
      const card = e.target.closest?.('[data-tilt]');
      if (card && !card.contains(e.relatedTarget)) { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
    });
  }

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
// Each tab tells the server whether it's in front of you; phone/desktop pop-ups only go out
// when no NUUVI tab is (so you're not pinged about things you're already looking at).
const TAB_ID = Math.random().toString(36).slice(2, 12);
document.addEventListener('visibilitychange', () => {
  if (!state.user) return;
  api('/api/live/visible', { method: 'POST', body: { tab: TAB_ID, visible: document.visibilityState === 'visible' } }).catch(() => {});
});

function connectLive() {
  const storyId = state.route.storyId;
  const key = state.user ? `u:${storyId ?? ''}` : storyId ? `a:${storyId}` : null;
  if (key === sourceKey) return;
  source?.close();
  source = null;
  sourceKey = key;
  if (!key) return;
  const params = new URLSearchParams({ tab: TAB_ID, visible: document.visibilityState === 'visible' ? '1' : '0' });
  if (storyId) params.set('story', storyId);
  source = new EventSource(`/api/events?${params}`);
  let opened = false;
  source.addEventListener('open', () => { if (opened) emit('reconnect'); opened = true; });
  // If the browser gives up on the connection (phones do, after sleeping), start a new one.
  source.addEventListener('error', () => {
    if (source?.readyState === EventSource.CLOSED) setTimeout(() => { sourceKey = null; connectLive(); }, 3000);
  });
  for (const type of ['post', 'edit', 'delete', 'channel', 'story', 'notification', 'kicked', 'presence', 'dm', 'dm-delete', 'message', 'message-delete', 'buzz']) {
    source.addEventListener(type, (e) => handleLive(type, JSON.parse(e.data)));
  }
}

function handleLive(type, data) {
  if (type === 'presence') {
    state.online = data.online;
    renderRail();
    renderMembers();
    return;
  }
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
    // No pop-ups inside the app: the bell's count updates quietly.
    if (!inChannel) refreshHome().catch(() => {});
  }
  if (type === 'kicked' && state.route.storyId === data.storyId) {
    toast('You were removed from this story');
    location.hash = '#/home';
  }
  emit(type, data);
}

// ---------- Routing ----------
const routes = [
  [/^#\/?$/, () => (state.user ? replaceHash('#/home') : viewLanding())],
  [/^#\/register\/([\w-]+)$/, (code) => (state.user ? replaceHash('#/home') : viewLanding({ invite: code }))],
  [/^#\/reset\/([\w-]+)$/, (token) => viewReset(token)],
  [/^#\/home$/, viewHome, true],
  [/^#\/discover$/, viewDiscover],
  [/^#\/messages$/, () => viewMessages(), true],
  [/^#\/messages\/(\d+)$/, viewMessages, true],
  [/^#\/nu$/, () => viewNu(), true],
  [/^#\/nu\/tag\/([^/]+)$/, viewNu, true],
  [/^#\/feed$/, () => replaceHash('#/nu'), true],
  [/^#\/events$/, viewEvents, true],
  [/^#\/e\/(\d+)$/, viewEvent, true],
  [/^#\/p\/(\d+)$/, viewSocialPost, true],
  [/^#\/new$/, viewNewStory, true],
  [/^#\/notifications$/, viewNotifications, true],
  [/^#\/characters$/, viewCharacters, true],
  [/^#\/directory$/, viewDirectory, true],
  [/^#\/npcs$/, viewNpcs, true],
  [/^#\/locations$/, viewLocations, true],
  [/^#\/lore$/, viewLore, true],
  [/^#\/archive$/, viewArchive, true],
  [/^#\/profiles$/, viewProfiles, true],
  [/^#\/profiles\/(\d+)$/, viewProfile, true],
  [/^#\/phone(?:\/(\d+))?$/, viewPhone, true],
  [/^#\/phone\/(\d+)\/t\/(\d+)$/, viewPhoneThread, true],
  [/^#\/c\/(\d+)$/, viewCharacter],
  [/^#\/u\/(\d+)$/, viewUser],
  [/^#\/settings$/, viewSettings, true],
  [/^#\/admin$/, viewAdmin, true],
  [/^#\/join\/(\d+)\/([\w-]+)$/, viewJoin, true],
  [/^#\/s\/(\d+)\/settings$/, viewStorySettings, true],
  // The phone, opened from inside a story: same phone, the story's sidebar stays.
  [/^#\/s\/\d+\/phone(?:\/(\d+))?$/, viewPhone, true],
  [/^#\/s\/\d+\/phone\/(\d+)\/t\/(\d+)$/, viewPhoneThread, true],
  // Old story-overview links lead to the one Lore page.
  [/^#\/s\/(\d+)\/overview$/, () => replaceHash('#/lore'), true],
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

  document.body.classList.toggle('guest', !state.user);
  renderUserbar();
  document.body.classList.toggle('in-channel', !!state.route.channelId);
  document.body.classList.remove('members-open');
  renderRail();
  renderSidebar();
  renderMembers();
  connectLive();

  if (!found) return page({ title: 'Not found', body: html`<div class="empty"><p>That page doesn't exist.</p><a href="#/home">Go home</a></div>` });
  const [re, fn, needsUser] = found;
  if (needsUser && !state.user) {
    store.set('nuuvi:after-login', hash);
    return replaceHash('#/');
  }
  try {
    await fn(...hash.match(re).slice(1));
  } catch (err) {
    if (err instanceof StaleView) return;
    if (err.status === 401) {
      store.set('nuuvi:after-login', hash);
      return replaceHash('#/');
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
  loadOnline().catch(() => {});
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
// ---------- What's new ----------
// Each update has a code (public/changelog.json, newest first). The first time you open NUUVI after an
// update, a card shows what changed. If an update lands while NUUVI is open, a bar offers to refresh.
export const APP_BUILD = 'NV-42';
let changelog = null;
export async function loadChangelog() {
  if (!changelog) changelog = await fetch('/changelog.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => []);
  return changelog;
}
export async function showWhatsNew(entry) {
  const list = await loadChangelog();
  const e = entry || list[0];
  if (!e) return;
  modal(html`
    <div class="whats-new">
      <span class="wn-code">Update ${e.code}</span>
      <h2>${e.title}</h2>
      <p class="muted small">${new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
      <ul>${e.items.map((it) => html`<li>${it}</li>`)}</ul>
      <div class="actions end"><button type="button" class="primary" data-close>Got it</button></div>
    </div>`).then(() => store.set('nuuvi:seen-update', e.code));
}
async function checkForUpdate() {
  // Only the site's owner gets told about updates (everyone else just gets the new version).
  if (!state.home.isOwner) return;
  changelog = null;
  const latest = (await loadChangelog())[0];
  if (!latest) return;
  if (latest.code !== APP_BUILD) {
    // A newer NUUVI is on the server than the one running in this tab.
    if ($('#update-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.className = 'update-bar';
    render(bar, html`<span>NUUVI was updated <b>(${latest.code})</b></span><button type="button" class="primary sm">Refresh</button>`);
    bar.querySelector('button').addEventListener('click', () => location.reload());
    document.body.append(bar);
    return;
  }
  if (store.get('nuuvi:seen-update') !== latest.code) showWhatsNew(latest);
}

async function boot() {
  try {
    state.user = (await api('/api/me')).user;
  } catch {
    state.user = null;
  }
  if (state.user) await Promise.all([refreshHome(), refreshBlocks(), loadOnline()]).catch(() => {});
  setupDrawer();
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme());
  window.addEventListener('hashchange', router);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) {
      if (!source || source.readyState === EventSource.CLOSED) { sourceKey = null; connectLive(); }
      refreshHome().catch(() => {});
      emit('reconnect');
    }
  });
  router();
  if (state.user) {
    checkForUpdate().catch(() => {});
    bus.addEventListener('reconnect', () => checkForUpdate().catch(() => {}));
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // Clicking a push notification while the app is open navigates here.
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.url) location.hash = e.data.url.replace(/^\/?/, ''); });
  }
}

boot();
