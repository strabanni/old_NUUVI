import { html, render, api, $, $$, avatar, icons, timeAgo } from '../lib.js';
import { page, refreshHome, routeAlive, ensureAlive } from '../main.js';

function describe(n) {
  const where = n.channel ? html`<strong>#${n.channel.name}</strong> in ${n.story?.title}` : '';
  switch (n.type) {
    case 'post': return n.count > 1 ? html`${n.count} new posts in ${where}` : html`<strong>${n.actor?.displayName}</strong> posted in ${where}`;
    case 'mention': return html`<strong>${n.actor?.displayName}</strong> mentioned you in ${where}`;
    case 'turn': return html`It's your turn in ${where}`;
    case 'report': return html`${n.text}`;
    case 'follow': return html`<strong>${n.text}</strong>`;
    case 'tag': return html`<strong>${n.actor?.displayName}</strong> tagged your character in ${where}`;
    case 'reply': return html`<strong>${n.actor?.displayName}</strong> replied to you in ${where}`;
    case 'dm': return html`<strong>${n.count > 1 ? `${n.count} new texts` : 'New text'}</strong>`;
    default: return n.text;
  }
}

// Tabs like a phone's notification centre: everything, things addressed to you, activity on
// your posts and characters, and system notices.
const GROUPS = {
  all: () => true,
  mentions: (n) => ['mention', 'reply', 'tag', 'dm', 'turn'].includes(n.type),
  activity: (n) => ['post', 'like', 'comment', 'follow'].includes(n.type),
  system: (n) => ['report'].includes(n.type) || !['mention', 'reply', 'tag', 'dm', 'turn', 'post', 'like', 'comment', 'follow'].includes(n.type),
};
const TAB_LABELS = [['all', 'All'], ['mentions', 'For you'], ['activity', 'Activity'], ['system', 'System']];
const iconFor = (n) => (n.type === 'turn' ? icons.hourglass : n.type === 'report' ? icons.shield : n.type === 'dm' ? icons.chat
  : avatar({ name: n.actor?.displayName, src: n.actor?.avatar }));

export async function viewNotifications() {
  const alive = routeAlive();
  const { notifications } = await api('/api/notifications');
  let tab = sessionStorage.getItem('nuuvi:notif-tab') || 'all';
  const body = page({
    alive,
    title: 'Notifications',
    subtitle: `${notifications.filter((n) => !n.read).length} unread`,
    actions: notifications.some((n) => !n.read) ? html`<button class="sm" id="read-all">Mark all read</button>` : '',
    body: html`
      <div class="notif-panel">
        <nav class="notif-tabs" role="tablist">${TAB_LABELS.map(([k, label]) => {
          const unread = notifications.filter((n) => !n.read && GROUPS[k](n)).length;
          return html`<button role="tab" data-ntab="${k}" aria-selected="${k === tab}">${label}${unread ? html`<span class="badge">${unread}</span>` : ''}</button>`;
        })}<span class="notif-tab-ink" aria-hidden="true"></span></nav>
        <div id="notif-list"></div>
      </div>`,
  });
  const list = $('#notif-list', body);
  const ink = $('.notif-tab-ink', body);
  function draw() {
    $$('[data-ntab]', body).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ntab === tab)));
    const active = $(`[data-ntab="${tab}"]`, body);
    ink.style.setProperty('--x', `${active.offsetLeft}px`);
    ink.style.setProperty('--w', `${active.offsetWidth}px`);
    const shown = notifications.filter(GROUPS[tab]);
    render(list, shown.length ? html`<div class="notif-list">${shown.map((n) => html`
      <a class="notif ${n.read ? '' : 'unread'} type-${n.type}" href="${n.url}" data-id="${n.id}">
        <span class="notif-icon">${iconFor(n)}</span>
        <span class="grow">
          <span>${describe(n)}</span>
          ${n.text && !['report', 'follow', 'tag'].includes(n.type) ? html`<span class="notif-text">${n.text}</span>` : ''}
        </span>
        <span class="notif-when">${timeAgo(n.createdAt)}</span>
      </a>`)}</div>`
      : html`<div class="empty"><p>${tab === 'all' ? "You're all caught up." : 'Nothing here.'}</p>${tab === 'all' ? html`<p class="small muted">Turn on notifications for this device in <a href="#/settings">Settings</a>.</p>` : ''}</div>`);
  }
  requestAnimationFrame(draw);
  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ntab]');
    if (t) { tab = t.dataset.ntab; try { sessionStorage.setItem('nuuvi:notif-tab', tab); } catch { /* ignore */ } draw(); return; }
    const a = e.target.closest('.notif.unread');
    if (a) api('/api/notifications/read', { method: 'POST', body: { ids: [Number(a.dataset.id)] } }).then(refreshHome).catch(() => {});
  });
  $('#main #read-all')?.addEventListener('click', async () => {
    await api('/api/notifications/read', { method: 'POST', body: {} });
    await refreshHome();
    viewNotifications();
  });
}
