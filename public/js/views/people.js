// User profiles and your own settings (profile, password, notifications, blocked people).
import { html, render, api, $, $$, bindForm, toast, avatar, icons, confirmModal, promptModal, uploadImage, formatPost, timeAgo, askImageLink, userGrad, applyColors, BRAND_GRADIENT, GRADIENT_PRESETS } from '../lib.js';
import { state, page, refreshBlocks, signedOut, router, applyTheme, currentThemePick, THEMES, routeAlive, ensureAlive, APP_BUILD, showWhatsNew } from '../main.js';
import { characterCard } from './characters.js';

const ACTIVITY = { active: 'Very active', moderate: 'Moderately active', low: 'Low activity', hiatus: 'On hiatus' };
const PLOTS = { open: 'Accepting plots', selective: 'Selective', closed: 'Not accepting plots' };
export const STYLE_LABELS = [
  ['communication', 'Communication'], ['oneLiners', 'One-liners'], ['rapidFire', 'Rapid fire'],
  ['longThreads', 'Long threads'], ['development', 'Development'], ['plottingFirst', 'Plotting first'],
];
const fmt = (n) => Number(n || 0).toLocaleString();

export async function viewUser(id) {
  const alive = routeAlive();
  const { user: u, characters, blocked, stats } = await api(`/api/users/${id}`);
  ensureAlive(alive);
  const me = u.id === state.user?.id;
  const p = u.profile || {};
  const info = [
    ['Pronouns', p.pronouns], ['Age', p.age], ['Time zone', p.timezone],
    ['Activity', ACTIVITY[p.activity]], ['Seeking plots', PLOTS[p.plots]], ['Status', p.status],
  ].filter(([, v]) => v);
  const styles = STYLE_LABELS.filter(([k]) => p.styles?.[k] !== undefined);
  page({
    alive,
    title: html`<span class="eyebrow">Viewing profile</span>`,
    actions: !me && state.user ? html`
      <a class="btn sm primary" href="#/messages/${u.id}">${icons.chat}<span class="lbl">Message</span></a>
      <button class="sm" id="block">${blocked ? 'Unblock' : 'Block'}</button>
      <button class="sm" id="report">Report</button>` : me ? html`<a class="btn sm" href="#/settings">Edit profile</a>` : '',
    body: html`
      <section class="profile-hero ${u.banner ? '' : 'no-img'}">
        ${u.banner ? html`<img class="hero-img" src="${u.banner}" alt="">` : ''}
        <div class="hero-row">
          ${avatar({ name: u.displayName, src: u.avatar, color: '#EE719E', size: 'xxl square' })}
          <div>
            <h1 class="big-name u-grad"${userGrad(u)}>${u.displayName}</h1>
            <div class="handle">@${u.username} · joined ${timeAgo(u.joinedAt)}
              ${u.isAdmin ? html` · <span class="grad-text">admin</span>` : ''}${u.suspended ? html` · <span class="muted">suspended</span>` : ''}</div>
          </div>
        </div>
      </section>
      <div class="stat-row">
        <div class="stat"><b>${fmt(stats.posts)}</b><span>Posts</span></div>
        <div class="stat"><b>${fmt(stats.words)}</b><span>Words</span></div>
        <div class="stat"><b>${fmt(stats.characters)}</b><span>Characters</span></div>
        <div class="stat"><b>${fmt(stats.stories)}</b><span>Stories</span></div>
      </div>
      ${info.length ? html`<div class="info-grid">${info.map(([k, v]) => html`<div class="info"><span class="eyebrow">${k}</span><div>${v}</div></div>`)}</div>` : ''}
      <div class="profile-cols">
        <section class="card">
          <span class="eyebrow">About</span>
          ${u.bio ? html`<div class="prose spaced">${formatPost(u.bio)}</div>` : html`<p class="muted spaced"><em>No information</em></p>`}
          ${p.lookingFor ? html`<span class="eyebrow block-gap">Looking for</span><div class="prose">${formatPost(p.lookingFor)}</div>` : ''}
        </section>
        ${styles.length ? html`<section class="card"${userGrad(u)}>
          <span class="eyebrow">Writing style</span>
          <div class="spaced">${styles.map(([k, label]) => html`
            <div class="meter"><div class="meter-head"><span>${label}</span><span>${p.styles[k]}%</span></div>
              <div class="meter-track"><div class="meter-fill" data-w="${p.styles[k]}"></div></div></div>`)}</div>
        </section>` : ''}
      </div>
      ${p.limits ? html`<div class="limits-box"><div><h3><span class="grad-text">Not</span> ( interested )</h3><div class="prose">${formatPost(p.limits)}</div></div></div>` : ''}
      ${characters.length ? html`
        <h2 class="section-title">Characters</h2>
        <div class="char-grid">${characters.map((c) => characterCard(c))}</div>` : ''}`,
  });
  for (const el of document.querySelectorAll('#main .meter-fill')) el.style.setProperty('--w', `${el.dataset.w}%`);
  applyColors($('#main'));
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
  const pr = u.profile || {};
  const [{ users: blockedUsers }, sub] = await Promise.all([api('/api/blocks'), currentSubscription().catch(() => null)]);
  const body = page({
    alive,
    title: 'Settings',
    actions: html`<button type="button" class="primary" id="settings-save">${icons.check}<span class="lbl">Save</span></button>`,
    body: html`
      <div class="settings-grid">
        <section class="card">
          <h2>Appearance</h2>
          <p class="muted small">Saved on this device.</p>
          <div class="theme-swatches">${THEMES.map(([k, label]) => html`
            <button type="button" class="swatch" data-theme-pick="${k}" aria-pressed="${currentThemePick() === k}"><i></i>${label}</button>`)}</div>
          <label>Text size</label>
          <div class="seg" role="group" aria-label="Text size">${[['', 'Default'], ['large', 'Large'], ['larger', 'Larger']].map(([k, label]) => html`
            <button type="button" data-text-size="${k}" aria-pressed="${(document.documentElement.dataset.text || '') === k}">${label}</button>`)}</div>
          <label>Interface size</label>
          <div class="seg scale-seg" role="group" aria-label="Interface size">${[['xsmall', 'Smallest'], ['compact', 'Small'], ['standard', 'Standard'], ['large', 'Large'], ['xlarge', 'Largest']].map(([k, label]) => html`
            <button type="button" data-ui-size="${k}" aria-pressed="${document.documentElement.dataset.ui === k}">${label}</button>`)}</div>
          <p class="hint">Makes the whole app smaller or bigger on this device — buttons, text and pictures together.</p>
          <p class="hint">Light and Dark use pink (#EE719E) only for highlights. Auto follows your device's light or dark setting.</p>
          <p class="hint">Icons: <a href="https://www.flaticon.com/uicons" target="_blank" rel="noopener noreferrer">Uicons by Flaticon</a>.</p>
          <p class="hint">You're on update <b>${APP_BUILD}</b>. <button type="button" class="link" id="whats-new">What's new?</button></p>
        </section>

        <section class="card">
          <h2>Profile</h2>
          <form id="profile">
            <div class="char-pic-row">
              <div id="me-pic">${avatar({ name: u.displayName, src: u.avatar, color: '#EE719E', size: 'xl square' })}</div>
              <div class="stack">
                <span class="row-inline"><label class="btn sm file-btn">Profile picture<input type="file" accept="image/*" id="me-file" hidden></label><button type="button" class="sm link-btn" data-link="avatar">Link</button></span>
                <span class="row-inline"><label class="btn sm file-btn">Banner<input type="file" accept="image/*" id="banner-file" hidden></label><button type="button" class="sm link-btn" data-link="banner">Link</button></span>
                <span class="hint" id="banner-state">${u.banner ? 'Banner set ✓' : 'A wide picture for the top of your profile'}</span>
                <input type="hidden" name="avatar" value="${u.avatar || ''}">
                <input type="hidden" name="banner" value="${u.banner || ''}">
              </div>
            </div>
            <label for="p-name">Display name</label>
            <input id="p-name" name="displayName" required maxlength="40" value="${u.displayName}">
            <label>Your colors</label>
            <div class="grad-box me-grad"${userGrad(u)}>
              <div class="grad-presets">${GRADIENT_PRESETS.map((g, i) => html`<button type="button" class="grad-preset" data-preset="${i}" data-grad="${g.join(',')}" aria-label="Gradient ${i + 1}"></button>`)}</div>
              <div class="grad-stops">
                ${[0, 1, 2].map((i) => html`<input type="color" data-stop="${i}" value="${(u.gradient || BRAND_GRADIENT)[i] || '#B8A6DB'}" aria-label="Color ${i + 1}">`)}
                <label class="check small"><input type="checkbox" id="g-three" ${(u.gradient || BRAND_GRADIENT).length > 2 ? 'checked' : ''}> 3 colors</label>
              </div>
              <p class="grad-preview"><b class="u-grad big">${u.displayName}</b></p>
              <div class="meter"><div class="meter-head"><span>Writing style</span><span>70%</span></div><div class="meter-track"><div class="meter-fill" data-w="70"></div></div></div>
              <p class="hint">Your display name and the writing-style bars on your profile use these colors.</p>
            </div>
            <div class="row">
              <div><label for="p-pronouns">Pronouns</label><input id="p-pronouns" name="pronouns" maxlength="30" value="${pr.pronouns || ''}" placeholder="she/her"></div>
              <div><label for="p-age">Age</label><input id="p-age" name="age" maxlength="20" value="${pr.age || ''}" placeholder="optional"></div>
              <div><label for="p-tz">Time zone</label><input id="p-tz" name="timezone" maxlength="40" value="${pr.timezone || ''}" placeholder="GMT-5"></div>
            </div>
            <div class="row">
              <div><label for="p-activity">Activity</label><select id="p-activity" name="activity">
                ${[['', '—'], ['active', 'Very active'], ['moderate', 'Moderately active'], ['low', 'Low activity'], ['hiatus', 'On hiatus']].map(([v, l]) => html`<option value="${v}" ${pr.activity === v ? 'selected' : ''}>${l}</option>`)}
              </select></div>
              <div><label for="p-plots">Seeking plots</label><select id="p-plots" name="plots">
                ${[['', '—'], ['open', 'Accepting plots'], ['selective', 'Selective'], ['closed', 'Not accepting']].map(([v, l]) => html`<option value="${v}" ${pr.plots === v ? 'selected' : ''}>${l}</option>`)}
              </select></div>
            </div>
            <label for="p-status">Status</label>
            <input id="p-status" name="status" maxlength="80" value="${pr.status || ''}" placeholder="drowning in drafts">
            <label for="p-bio">About you</label>
            <textarea id="p-bio" name="bio" maxlength="2000" rows="4" placeholder="Writing style, favourite genres, reply speed…">${u.bio}</textarea>
            <label>Writing style</label>
            ${STYLE_LABELS.map(([k, label]) => html`
              <div class="meter"><div class="meter-head"><span>${label}</span><span id="v-${k}">${pr.styles?.[k] ?? '—'}${pr.styles?.[k] !== undefined ? '%' : ''}</span></div>
                <input type="range" min="0" max="100" step="5" name="style-${k}" value="${pr.styles?.[k] ?? 50}" data-set="${pr.styles?.[k] !== undefined ? '1' : ''}" aria-label="${label}"></div>`)}
            <label for="p-looking">Looking for</label>
            <textarea id="p-looking" name="lookingFor" maxlength="4000" rows="3" placeholder="Genres, pairings, plot ideas…">${pr.lookingFor || ''}</textarea>
            <label for="p-limits">Limits — not interested in</label>
            <textarea id="p-limits" name="limits" maxlength="4000" rows="3" placeholder="Hard limits, banned face claims…">${pr.limits || ''}</textarea>
            <div class="error"></div>
            <div class="actions"><a class="btn" href="#/u/${u.id}">View profile</a></div>
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
      profile.avatar.value = await uploadImage(file, 512);
      render($('#me-pic', body), avatar({ name: u.displayName, src: profile.avatar.value, size: 'xl square' }));
    } catch (err) { toast(err.message); }
  });
  $('#banner-file', body).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      profile.banner.value = await uploadImage(file, 1600);
      $('#banner-state', body).textContent = 'Banner set ✓';
    } catch (err) { toast(err.message); }
  });
  profile.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-link]');
    if (!b) return;
    const url = await askImageLink();
    if (!url) return;
    profile[b.dataset.link].value = url;
    if (b.dataset.link === 'avatar') render($('#me-pic', body), avatar({ name: u.displayName, src: url, size: 'xl square' }));
    else $('#banner-state', body).textContent = 'Banner set ✓';
  });
  // Your colors: presets, 2 or 3 stops, and a live preview.
  const gbox = $('.me-grad', body);
  const stops = () => $$('[data-stop]', gbox).filter((x) => x.dataset.stop !== '2' || $('#g-three', gbox).checked).map((x) => x.value);
  const drawGrad = () => {
    $('[data-stop="2"]', gbox).hidden = !$('#g-three', gbox).checked;
    gbox.dataset.grad = stops().join(',');
    applyColors(gbox.parentElement);
  };
  $('.meter-fill', gbox).style.setProperty('--w', '70%');
  gbox.addEventListener('input', drawGrad);
  gbox.addEventListener('change', drawGrad);
  gbox.addEventListener('click', (e) => {
    const p = e.target.closest('[data-preset]');
    if (!p) return;
    const g = GRADIENT_PRESETS[Number(p.dataset.preset)];
    $$('[data-stop]', gbox).forEach((x, i) => { if (g[i]) x.value = g[i]; });
    $('#g-three', gbox).checked = g.length > 2;
    drawGrad();
  });
  drawGrad();
  for (const r of profile.querySelectorAll('input[type=range]')) {
    r.addEventListener('input', () => { r.dataset.set = '1'; $(`#v-${r.name.slice(6)}`, body).textContent = `${r.value}%`; });
  }
  body.addEventListener('click', (e) => {
    const ts = e.target.closest('[data-text-size]');
    if (ts) {
      const v = ts.dataset.textSize;
      if (v) document.documentElement.dataset.text = v; else delete document.documentElement.dataset.text;
      try { if (v) localStorage.setItem('nuuvi:text', v); else localStorage.removeItem('nuuvi:text'); } catch { /* ignore */ }
      body.querySelectorAll('[data-text-size]').forEach((b) => b.setAttribute('aria-pressed', String(b === ts)));
      return;
    }
    const us = e.target.closest('[data-ui-size]');
    if (us) {
      if (us.dataset.uiSize === document.documentElement.dataset.ui) return;
      try { localStorage.setItem('nuuvi:ui', us.dataset.uiSize); } catch { /* ignore */ }
      window.nuuviScale?.apply(us.dataset.uiSize);
      body.querySelectorAll('[data-ui-size]').forEach((b) => b.setAttribute('aria-pressed', String(b === us)));
      return;
    }
    const sw = e.target.closest('[data-theme-pick]');
    if (!sw) return;
    applyTheme(sw.dataset.themePick);
    body.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b === sw)));
  });
  $('#whats-new', body).addEventListener('click', () => showWhatsNew());
  // Save sits at the top of the page, always in reach.
  $('#main #settings-save').addEventListener('click', () => profile.requestSubmit());
  bindForm(profile, async (data) => {
    const styles = {};
    for (const r of profile.querySelectorAll('input[type=range]')) if (r.dataset.set) styles[r.name.slice(6)] = Number(r.value);
    const { displayName, bio, avatar: av, banner, ...rest } = data;
    const fields = {};
    for (const k of ['pronouns', 'age', 'timezone', 'status', 'activity', 'plots', 'lookingFor', 'limits']) fields[k] = rest[k] ?? '';
    const payload = { displayName, bio, profile: { ...fields, styles }, gradient: stops() };
    if (av) payload.avatar = av;
    if (banner) payload.banner = banner;
    state.user = (await api('/api/me', { method: 'PUT', body: payload })).user;
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
