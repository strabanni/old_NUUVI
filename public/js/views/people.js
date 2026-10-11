// User profiles and your own settings (profile, password, notifications, blocked people).
import { html, render, api, $, bindForm, toast, avatar, icons, confirmModal, promptModal, uploadImage, formatPost, timeAgo } from '../lib.js';
import { state, page, refreshBlocks, signedOut, router, routeAlive, ensureAlive } from '../main.js';

export async function viewUser(id) {
  const alive = routeAlive();
  const { user: u, characters, blocked } = await api(`/api/users/${id}`);
  const me = u.id === state.user?.id;
  page({
    alive,
    title: u.displayName,
    actions: !me && state.user ? html`
      <button class="sm" id="block">${blocked ? 'Unblock' : 'Block'}</button>
      <button class="sm" id="report">Report</button>` : me ? html`<a class="btn sm" href="#/settings">Edit profile</a>` : '',
    body: html`
      <article class="card profile narrow">
        <div class="profile-banner"></div>
        <div class="profile-head">
          ${avatar({ name: u.displayName, src: u.avatar, color: '#7c5cff', size: 'xxl' })}
          <div>
            <h2>${u.displayName} ${u.isAdmin ? html`<span class="tag">Admin</span>` : ''} ${u.suspended ? html`<span class="tag closed">Suspended</span>` : ''}</h2>
            <p class="muted">@${u.username} · joined ${timeAgo(u.joinedAt)}</p>
          </div>
        </div>
        ${u.bio ? html`<div class="body prose">${formatPost(u.bio)}</div>` : ''}
        ${characters.length ? html`
          <h3>Characters</h3>
          <div class="stack">${characters.map((c) => html`
            <a class="row-item" href="#/c/${c.id}">${avatar({ name: c.name, src: c.avatar, color: c.color })}
              <div class="grow"><strong class="cast-name" data-color="${c.color}">${c.name}</strong>${c.tagline ? html`<div class="small muted">${c.tagline}</div>` : ''}</div></a>`)}
          </div>` : ''}
      </article>`,
  });
  $('#main #block')?.addEventListener('click', async () => {
    if (!blocked && !(await confirmModal(`Block ${u.displayName}? Their posts will be hidden for you, they can't notify you, and they can't join stories you own.`, { ok: 'Block', danger: true }))) return;
    await api(blocked ? `/api/blocks/${u.id}` : '/api/blocks', { method: blocked ? 'DELETE' : 'POST', body: blocked ? undefined : { userId: u.id } });
    await refreshBlocks();
    toast(blocked ? 'Unblocked' : 'Blocked');
    viewUser(id);
  });
  $('#main #report')?.addEventListener('click', async () => {
    const reason = await promptModal(`Report ${u.displayName}`, { label: 'What happened? Only admins will see this.', multiline: true, ok: 'Send report', maxlength: 1000 });
    if (!reason) return;
    await api(`/api/users/${u.id}/report`, { method: 'POST', body: { reason } });
    toast('Report sent to the admins');
  });
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush() {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone()
    ? 'On iPhone/iPad, first add NUUVI to your Home Screen (Share → Add to Home Screen), then open it from there.'
    : "This browser doesn't support notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. You can change this in your browser settings.');
  const { publicKey } = await api('/api/push/key');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
  await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

export async function viewSettings() {
  const alive = routeAlive();
  const u = state.user;
  const [{ users: blockedUsers }, sub] = await Promise.all([api('/api/blocks'), currentSubscription().catch(() => null)]);
  const body = page({
    alive,
    title: 'Settings',
    body: html`
      <div class="settings-grid">
        <section class="card">
          <h2>Profile</h2>
          <form id="profile">
            <div class="char-pic-row">
              <div id="me-pic">${avatar({ name: u.displayName, src: u.avatar, color: '#7c5cff', size: 'xl' })}</div>
              <div class="stack">
                <label class="btn sm file-btn">Upload picture<input type="file" accept="image/*" id="me-file" hidden></label>
                <input type="hidden" name="avatar" value="${u.avatar || ''}">
              </div>
            </div>
            <label for="p-name">Display name</label>
            <input id="p-name" name="displayName" required maxlength="40" value="${u.displayName}">
            <label for="p-bio">About you</label>
            <textarea id="p-bio" name="bio" maxlength="2000" rows="4" placeholder="Writing style, favourite genres, time zone, reply speed…">${u.bio}</textarea>
            <div class="error"></div>
            <div class="actions"><button type="submit" class="primary">Save profile</button></div>
          </form>
        </section>

        <section class="card">
          <h2>Notifications on this device</h2>
          <p class="muted small">Get notified about new posts, @mentions and your turns — even when NUUVI is closed.
            Notification contents are end-to-end encrypted on their way to your device.</p>
          ${isIos() && !isStandalone() ? html`<p class="notice small">On iPhone/iPad: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open NUUVI from your Home Screen, then turn notifications on here.</p>` : ''}
          <div class="actions">
            ${sub ? html`<button id="push-off">Turn off</button><button id="push-test">Send a test</button>` : html`<button class="primary" id="push-on">Turn on notifications</button>`}
          </div>
          <p class="small muted">Per-story settings (every post, mentions only, or nothing) are in each story's menu.</p>
        </section>

        <section class="card">
          <h2>Password</h2>
          <form id="password">
            <label for="cur">Current password</label>
            <input id="cur" name="current" type="password" autocomplete="current-password" required>
            <label for="next">New password</label>
            <input id="next" name="next" type="password" autocomplete="new-password" required minlength="8">
            <div class="error"></div>
            <div class="actions"><button type="submit">Change password</button></div>
          </form>
          <p class="small muted">Changing it signs you out everywhere else.</p>
        </section>

        <section class="card">
          <h2>Blocked people</h2>
          ${blockedUsers.length ? html`<div class="stack">${blockedUsers.map((b) => html`
            <div class="row-item">${avatar({ name: b.displayName, src: b.avatar })}<div class="grow">${b.displayName} <span class="small muted">@${b.username}</span></div>
              <button class="sm" data-unblock="${b.id}">Unblock</button></div>`)}</div>`
            : html`<p class="muted small">You haven't blocked anyone. You can block someone from their profile or from any of their posts.</p>`}
        </section>

        <section class="card">
          <h2>Install the app</h2>
          <p class="muted small">NUUVI works as an app. <strong>iPhone/iPad:</strong> Safari → Share → Add to Home Screen.
            <strong>Android:</strong> Chrome menu → Install app. <strong>Computer:</strong> the install icon in Chrome or Edge's address bar.</p>
        </section>

        <section class="card">
          <h2>Account</h2>
          <p class="muted small">Signed in as @${u.username}${u.isAdmin ? ' (admin)' : ''}.</p>
          <button id="logout">${icons.back} Sign out</button>
        </section>
      </div>`,
  });

  const profile = $('#profile', body);
  $('#me-file', body).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      profile.avatar.value = await uploadImage(file, 256);
      render($('#me-pic', body), avatar({ name: u.displayName, src: profile.avatar.value, size: 'xl' }));
    } catch (err) { toast(err.message); }
  });
  bindForm(profile, async (data) => {
    state.user = (await api('/api/me', { method: 'PUT', body: data })).user;
    toast('Profile saved');
    router();
  });
  bindForm($('#password', body), async (data, form) => {
    await api('/api/me/password', { method: 'PUT', body: data });
    form.reset();
    toast('Password changed');
  });
  $('#push-on', body)?.addEventListener('click', async () => {
    try { await enablePush(); toast('Notifications are on'); viewSettings(); } catch (err) { toast(err.message); }
  });
  $('#push-off', body)?.addEventListener('click', async () => {
    const s = await currentSubscription();
    if (s) {
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: s.endpoint } });
      await s.unsubscribe();
    }
    toast('Notifications are off on this device');
    viewSettings();
  });
  $('#push-test', body)?.addEventListener('click', async () => {
    await api('/api/push/test', { method: 'POST', body: {} });
    toast('Test sent — it should pop up in a moment');
  });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unblock]');
    if (!b) return;
    await api(`/api/blocks/${b.dataset.unblock}`, { method: 'DELETE' });
    await refreshBlocks();
    viewSettings();
  });
  $('#logout', body).addEventListener('click', async () => {
    const s = await currentSubscription().catch(() => null);
    if (s) await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: s.endpoint } }).catch(() => {});
    await api('/api/auth/logout', { method: 'POST', body: {} });
    signedOut();
  });
}
