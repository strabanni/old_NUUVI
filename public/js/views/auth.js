import { html, render, api, $, $$, bindForm } from '../lib.js';
import { signedIn, routeAlive, ensureAlive } from '../main.js';

export async function viewLanding({ invite = '' } = {}) {
  const alive = routeAlive();
  const status = await api('/api/auth/status').catch(() => ({ inviteRequired: true, firstUser: false }));
  ensureAlive(alive);
  let mode = invite || status.firstUser ? 'register' : 'login';
  const main = $('#main');
  render(main, html`
    <div class="landing">
      <section class="hero">
        <img src="/icon.svg" alt="" width="72" height="72">
        <h1>Write <span>together</span>.</h1>
        <p>A private home for your roleplay group. Characters, scenes and long-form posts — without handing your data to anyone else.</p>
      </section>
      <section class="card auth">
        ${status.firstUser ? html`<p class="notice">Welcome! This is a brand-new NUUVI. The first account you create becomes the <strong>admin</strong> account.</p>` : ''}
        <div class="tabs" role="tablist">
          <button type="button" role="tab" data-tab="login">Sign in</button>
          <button type="button" role="tab" data-tab="register">Create account</button>
        </div>
        <form id="auth-form">
          <label for="username">Username</label>
          <input id="username" name="username" autocomplete="username" autocapitalize="off" required minlength="3" maxlength="24">
          <div class="register-only">
            <label for="displayName">Display name <span class="muted small">(optional)</span></label>
            <input id="displayName" name="displayName" maxlength="40">
            ${status.inviteRequired ? html`
              <label for="invite">Invite code</label>
              <input id="invite" name="invite" value="${invite}" autocomplete="off" placeholder="Ask the admin for one">` : ''}
          </div>
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required minlength="8">
          <div class="error"></div>
          <button type="submit" class="primary block">Sign in</button>
        </form>
      </section>
      <section class="features">
        <div><h3>Stories & scenes</h3><p>Each story gets its own channels, like a server — one for the scene, one for OOC chat, add as many as you like.</p></div>
        <div><h3>Characters</h3><p>Pictures, colors, bios. Post as any of them, or as the narrator.</p></div>
        <div><h3>Turns & dice</h3><p>Optional turn order with "your turn" alerts, and server-rolled dice nobody can fudge.</p></div>
      </section>
    </div>`);

  const form = $('#auth-form');
  const setMode = (m) => {
    mode = m;
    $$('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === m)));
    form.classList.toggle('registering', m === 'register');
    form.password.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    form.querySelector('[type=submit]').textContent = m === 'register' ? 'Create account' : 'Sign in';
  };
  $$('[data-tab]').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.tab)));
  setMode(mode);
  bindForm(form, async (data) => {
    if (mode === 'login') { delete data.displayName; delete data.invite; }
    const { user } = await api(`/api/auth/${mode}`, { method: 'POST', body: data });
    await signedIn(user);
  });
}

export function viewReset(token) {
  render($('#main'), html`
    <div class="landing">
      <section class="card auth">
        <h2>Choose a new password</h2>
        <form id="reset-form">
          <label for="password">New password</label>
          <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
          <div class="error"></div>
          <button type="submit" class="primary block">Save and sign in</button>
        </form>
      </section>
    </div>`);
  bindForm($('#reset-form'), async ({ password }) => {
    const { user } = await api('/api/auth/reset', { method: 'POST', body: { token, password } });
    await signedIn(user);
  });
}
