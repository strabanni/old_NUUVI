import { html, api, $, avatar, icons, timeAgo } from '../lib.js';
import { page, refreshHome, routeAlive, ensureAlive } from '../main.js';

function describe(n) {
  const where = n.channel ? html`<strong>#${n.channel.name}</strong> in ${n.story?.title}` : '';
  switch (n.type) {
    case 'post': return n.count > 1 ? html`${n.count} new posts in ${where}` : html`<strong>${n.actor?.displayName}</strong> posted in ${where}`;
    case 'mention': return html`<strong>${n.actor?.displayName}</strong> mentioned you in ${where}`;
    case 'turn': return html`It's your turn in ${where}`;
    case 'report': return html`${n.text}`;
    default: return n.text;
  }
}

export async function viewNotifications() {
  const alive = routeAlive();
  const { notifications } = await api('/api/notifications');
  const body = page({
    alive,
    title: 'Notifications',
    actions: notifications.some((n) => !n.read) ? html`<button class="sm" id="read-all">Mark all read</button>` : '',
    body: notifications.length
      ? html`<div class="notif-list">${notifications.map((n) => html`
          <a class="notif ${n.read ? '' : 'unread'} type-${n.type}" href="${n.url}" data-id="${n.id}">
            <span class="notif-icon">${n.type === 'turn' ? icons.hourglass : n.type === 'report' ? icons.shield : avatar({ name: n.actor?.displayName, src: n.actor?.avatar })}</span>
            <span class="grow">
              <span>${describe(n)}</span>
              ${n.text && n.type !== 'report' ? html`<span class="notif-text">${n.text}</span>` : ''}
              <span class="small muted">${timeAgo(n.createdAt)}</span>
            </span>
          </a>`)}</div>`
      : html`<div class="empty"><p>You're all caught up.</p><p class="small muted">Turn on notifications for this device in <a href="#/settings">Settings</a>.</p></div>`,
  });
  body.addEventListener('click', (e) => {
    const a = e.target.closest('.notif.unread');
    if (a) api('/api/notifications/read', { method: 'POST', body: { ids: [Number(a.dataset.id)] } }).then(refreshHome).catch(() => {});
  });
  $('#main #read-all')?.addEventListener('click', async () => {
    await api('/api/notifications/read', { method: 'POST', body: {} });
    await refreshHome();
    viewNotifications();
  });
}
