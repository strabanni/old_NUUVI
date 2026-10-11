// Admin panel: reports, people, invites, stories, moderation log.
import { html, render, api, $, $$, bindForm, toast, avatar, confirmModal, promptModal, modal, timeAgo, formatPost } from '../lib.js';
import { state, page, refreshHome, copyText, routeAlive, ensureAlive } from '../main.js';

const TABS = [['reports', 'Reports'], ['users', 'People'], ['invites', 'Invites'], ['stories', 'Stories'], ['log', 'Log']];

export async function viewAdmin() {
  const alive = routeAlive();
  if (!state.user.isAdmin) return location.replace('#/home');
  const overview = await api('/api/admin/overview');
  let tab = sessionStorage.getItem('nuuvi:admin-tab') || 'reports';
  const body = page({
    alive,
    title: 'Admin',
    subtitle: `${overview.users} people · ${overview.stories} stories · ${overview.posts} posts`,
    body: html`
      <nav class="tabs scroll-x no-swipe" role="tablist">${TABS.map(([k, label]) => html`
        <button role="tab" data-tab="${k}">${label}${k === 'reports' && overview.openReports ? html` <span class="badge">${overview.openReports}</span>` : ''}</button>`)}</nav>
      <div id="admin-pane"></div>`,
  });
  const pane = $('#admin-pane', body);
  const show = async (k) => {
    tab = k;
    try { sessionStorage.setItem('nuuvi:admin-tab', k); } catch { /* ignore */ }
    $$('[data-tab]', body).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
    await ({ reports, users, invites, stories, log })[k](pane);
  };
  $$('[data-tab]', body).forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  await show(tab);
}

async function reports(pane, status = 'open') {
  const { reports: list } = await api(`/api/admin/reports?status=${status}`);
  render(pane, html`
    <div class="seg">${['open', 'resolved', 'dismissed'].map((s) => html`<button data-status="${s}" aria-pressed="${s === status}">${s}</button>`)}</div>
    ${list.length ? html`<div class="stack">${list.map((r) => html`
      <div class="card report" data-id="${r.id}">
        <div class="report-head">
          <span><strong>${r.reporter?.displayName ?? 'Someone'}</strong> reported ${r.post ? 'a post by' : ''} <a href="#/u/${r.target?.id}">${r.target?.displayName ?? 'a deleted user'}</a>
            ${r.target?.suspended ? html`<span class="tag closed">suspended</span>` : ''}</span>
          <span class="small muted">${timeAgo(r.createdAt)}</span>
        </div>
        <p class="report-reason">“${r.reason}”</p>
        ${r.snapshot ? html`
          <div class="report-snapshot">
            <div class="small muted">${r.snapshot.character ? `As ${r.snapshot.character} · ` : ''}${r.story ? `in ${r.story.title}` : ''}${r.post && !r.post.stillExists ? ' · post deleted' : ''}</div>
            <div class="body">${formatPost(r.snapshot.body || '')}</div>
          </div>` : ''}
        <div class="actions">
          ${r.post?.stillExists ? html`<button class="sm danger" data-act="delete-post">Delete post</button>` : ''}
          ${r.target && !r.target.suspended && r.target.id !== state.user.id ? html`<button class="sm danger" data-act="ban">Suspend ${r.target.displayName}</button>` : ''}
          ${status === 'open' ? html`<button class="sm primary" data-act="resolved">Mark resolved</button><button class="sm" data-act="dismissed">Dismiss</button>` : html`<button class="sm" data-act="open">Reopen</button>`}
        </div>
      </div>`)}</div>` : html`<div class="empty">No ${status} reports.</div>`}`);
  $$('[data-status]', pane).forEach((b) => b.addEventListener('click', () => reports(pane, b.dataset.status)));
  pane.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const r = list.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
    try {
      if (b.dataset.act === 'delete-post') {
        if (!(await confirmModal('Delete this post for everyone?', { ok: 'Delete', danger: true }))) return;
        await api(`/api/posts/${r.post.id}`, { method: 'DELETE' });
      } else if (b.dataset.act === 'ban') {
        if (!(await banUser(r.target))) return;
      } else {
        await api(`/api/admin/reports/${r.id}`, { method: 'POST', body: { status: b.dataset.act } });
      }
      await refreshHome();
      reports(pane, status);
    } catch (err) { toast(err.message); }
  };
}

async function banUser(u) {
  const reason = await promptModal(`Suspend ${u.displayName}?`, {
    label: "They'll be signed out and can't sign in until you lift it. Reason (for your records):", ok: 'Suspend', required: false, maxlength: 500,
  });
  if (reason === null) return false;
  await api(`/api/admin/users/${u.id}/ban`, { method: 'POST', body: { reason } });
  toast(`${u.displayName} is suspended`);
  return true;
}

async function users(pane) {
  const { users: list } = await api('/api/admin/users');
  render(pane, html`<div class="stack">${list.map((u) => html`
    <div class="row-item wrap" data-id="${u.id}">
      ${avatar({ name: u.displayName, src: u.avatar })}
      <div class="grow">
        <a href="#/u/${u.id}"><strong>${u.displayName}</strong></a> <span class="small muted">@${u.username}</span>
        ${u.isAdmin ? html`<span class="tag">Admin</span>` : ''} ${u.suspended ? html`<span class="tag closed" title="${u.banReason || ''}">Suspended</span>` : ''}
        <div class="small muted">joined ${timeAgo(u.joinedAt)} · ${u.postCount} posts</div>
      </div>
      ${u.id !== state.user.id ? html`
        <button class="sm" data-act="reset">Reset link</button>
        <button class="sm" data-act="admin">${u.isAdmin ? 'Remove admin' : 'Make admin'}</button>
        ${u.suspended ? html`<button class="sm" data-act="unban">Lift suspension</button>` : html`<button class="sm danger" data-act="ban">Suspend</button>`}` : html`<span class="small muted">you</span>`}
    </div>`)}</div>`);
  pane.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const u = list.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
    try {
      if (b.dataset.act === 'ban' && !(await banUser(u))) return;
      if (b.dataset.act === 'unban') await api(`/api/admin/users/${u.id}/unban`, { method: 'POST', body: {} });
      if (b.dataset.act === 'admin') {
        if (!(await confirmModal(`${u.isAdmin ? 'Remove admin rights from' : 'Give admin rights to'} ${u.displayName}?`))) return;
        await api(`/api/admin/users/${u.id}/role`, { method: 'PUT', body: { isAdmin: !u.isAdmin } });
      }
      if (b.dataset.act === 'reset') {
        const { token } = await api(`/api/admin/users/${u.id}/reset`, { method: 'POST', body: {} });
        const link = `${location.origin}/#/reset/${token}`;
        await modal(html`<form><h2>Password reset link</h2><p>Send this to ${u.displayName} privately. It works once, for 24 hours.</p>
          <input readonly value="${link}"><div class="actions end"><button type="button" data-close>Close</button><button type="submit" class="primary">Copy</button></div></form>`,
        { submit: () => copyText(link, 'Link copied') });
      }
      users(pane);
    } catch (err) { toast(err.message); }
  };
}

async function invites(pane) {
  const { invites: list } = await api('/api/admin/invites');
  render(pane, html`
    <form class="card" id="new-invite">
      <h3>Invite someone</h3>
      <div class="row">
        <div><label for="inv-note">Who is it for?</label><input id="inv-note" name="note" maxlength="100" placeholder="e.g. Sam"></div>
        <div class="fixed"><label for="inv-uses">Uses</label><input id="inv-uses" name="maxUses" type="number" min="1" max="100" value="1"></div>
        <div class="fixed"><label for="inv-days">Expires (days)</label><input id="inv-days" name="expiresDays" type="number" min="0" max="365" value="7"></div>
      </div>
      <div class="error"></div>
      <div class="actions"><button type="submit" class="primary">Create invite link</button></div>
    </form>
    <div class="stack">${list.map((i) => html`
      <div class="row-item wrap ${i.active ? '' : 'inactive'}" data-id="${i.id}" data-code="${i.code}">
        <div class="grow">
          <strong>${i.note || 'Invite'}</strong> <code>${i.code}</code>
          <div class="small muted">${i.uses}/${i.maxUses} used · ${i.revoked ? 'revoked' : i.expiresAt ? `expires ${new Date(i.expiresAt).toLocaleDateString()}` : 'never expires'} · by ${i.createdBy ?? '—'}</div>
        </div>
        ${i.active ? html`<button class="sm" data-act="copy">Copy link</button><button class="sm danger" data-act="revoke">Revoke</button>` : ''}
      </div>`)}</div>`);
  bindForm($('#new-invite', pane), async (data) => {
    const { code } = await api('/api/admin/invites', { method: 'POST', body: data });
    await copyText(`${location.origin}/#/register/${code}`, 'Invite link created and copied');
    invites(pane);
  });
  pane.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const row = b.closest('[data-id]');
    if (b.dataset.act === 'copy') copyText(`${location.origin}/#/register/${row.dataset.code}`, 'Invite link copied');
    if (b.dataset.act === 'revoke') {
      await api(`/api/admin/invites/${row.dataset.id}`, { method: 'DELETE' });
      invites(pane);
    }
  };
}

async function stories(pane) {
  const { stories: list } = await api('/api/admin/stories');
  render(pane, html`
    <p class="small muted">Admins see titles only — private stories stay private. Reported posts show up under Reports.</p>
    <div class="stack">${list.map((s) => html`
    <div class="row-item wrap" data-id="${s.id}">
      <div class="grow"><strong>${s.title}</strong> <span class="tag">${s.visibility}</span>
        <div class="small muted">by ${s.ownerName} · ${s.memberCount} writers · ${s.postCount} posts · updated ${timeAgo(s.updatedAt)}</div></div>
      <button class="sm danger" data-act="delete">Delete</button>
    </div>`)}</div>`);
  pane.onclick = async (e) => {
    const b = e.target.closest('[data-act="delete"]');
    if (!b) return;
    const s = list.find((x) => x.id === Number(b.closest('[data-id]').dataset.id));
    if (!(await confirmModal(`Delete "${s.title}" and everything in it?`, { ok: 'Delete', danger: true }))) return;
    await api(`/api/admin/stories/${s.id}`, { method: 'DELETE' });
    await refreshHome();
    stories(pane);
  };
}

async function log(pane) {
  const { entries } = await api('/api/admin/log');
  pane.onclick = null;
  render(pane, entries.length ? html`<div class="log">${entries.map((e) => html`
    <div class="row-item"><span class="small muted nowrap">${timeAgo(e.createdAt)}</span><span class="grow"><strong>${e.actor ?? '—'}</strong> ${e.action.replace(/-/g, ' ')} <span class="muted">${e.detail}</span></span></div>`)}</div>`
    : html`<div class="empty">Nothing yet.</div>`);
}
