// Admin panel: reports, people, invites, stories, moderation log.
import { html, render, api, $, $$, bindForm, toast, avatar, confirmModal, promptModal, modal, timeAgo, formatPost, icons, uploadImage, askImageLink } from '../lib.js';
import { state, page, refreshHome, copyText, routeAlive, ensureAlive, loadHeaders } from '../main.js';

const TABS = [['reports', 'Reports'], ['users', 'People'], ['invites', 'Invites'], ['stories', 'Stories'], ['log', 'Log'], ['npcs', 'NPCs & bots'], ['headers', 'Headers']];

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
  let pane = $('#admin-pane', body);
  const show = async (k) => {
    tab = k;
    try { sessionStorage.setItem('nuuvi:admin-tab', k); } catch { /* ignore */ }
    $$('[data-tab]', body).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
    // A fresh pane each time, so listeners from the previous tab don't pile up.
    const fresh = pane.cloneNode(false);
    pane.replaceWith(fresh);
    pane = fresh;
    await ({ reports, users, invites, stories, log, npcs, headers })[k](pane);
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
      <div class="actions"><button type="submit" class="primary">${icons.userAdd} Create invite link</button></div>
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

// NPCs & bots: global automation settings, and every automatic NPC / gossip account with "try it now".
async function npcs(pane) {
  const { settings: s, characters } = await api('/api/admin/bots');
  render(pane, html`
    <section class="card">
      <h3>Automation</h3>
      <form id="bot-settings" class="stack">
        <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}> NPCs post and comment on their own</label>
        <div class="row">
          <div><label for="b-chance">Chance an NPC comments on a new post</label>
            <select id="b-chance" name="commentChance">${[0.1, 0.2, 0.35, 0.5, 0.75, 1].map((v) => html`<option value="${v}" ${Math.abs(s.commentChance - v) < 0.001 ? 'selected' : ''}>${Math.round(v * 100)}%</option>`)}</select></div>
          <div><label for="b-max">Most NPC comments per post</label><input id="b-max" type="number" name="maxCommentsPerPost" min="0" max="10" value="${s.maxCommentsPerPost}"></div>
          <div><label for="b-every">Each NPC posts about every</label>
            <select id="b-every" name="postEveryHours">${[[3, '3 hours'], [6, '6 hours'], [12, '12 hours'], [24, 'day'], [72, '3 days'], [168, 'week']].map(([v, l]) => html`<option value="${v}" ${s.postEveryHours === v ? 'selected' : ''}>${l}</option>`)}</select></div>
        </div>
        <label class="check"><input type="checkbox" name="gossipAboutThreads" ${s.gossipAboutThreads ? 'checked' : ''}> The gossip account posts tips when public episodes start or finish</label>
        <p class="hint">Private episodes and private stories are never gossiped about. Comments show up a minute or two after a post, like real people.</p>
        <div class="error"></div>
        <div class="actions"><button type="submit" class="primary">Save</button></div>
      </form>
    </section>
    <section class="card">
      <h3>Automatic NPCs and gossip accounts</h3>
      ${characters.length ? html`<div class="stack">${characters.map((c) => html`
        <div class="row-item">
          ${avatar({ name: c.name, src: c.avatar, color: c.color })}
          <div class="grow"><a href="#/c/${c.id}"><strong>${c.name}</strong></a> <span class="npc-badge">${c.bot === 'gossip' ? 'GOSSIP' : 'AUTO'}</span>
            <div class="small muted">@${c.handle} · run by ${c.ownerName} · ${c.lines.comments || 0} comment lines · ${c.lines.posts || 0} post lines${c.bot === 'gossip' ? ` · ${(c.lines.tips || 0) + (c.lines.finished || 0)} tips` : ''}</div></div>
          <button class="sm" data-run="${c.id}" data-what="post">Post now</button>
          ${c.bot === 'bot' ? html`<button class="sm" data-run="${c.id}" data-what="comment">Comment now</button>` : ''}
        </div>`)}</div>`
        : html`<p class="muted">None yet. Open any character → Edit → tick <b>This is an NPC</b> and choose <b>They post and comment on their own</b> (or, for you as admin, <b>Anonymous gossip account</b>), then give them lines.</p>`}
    </section>`);
  bindForm($('#bot-settings', pane), async (data) => {
    await api('/api/admin/bots', { method: 'PUT', body: {
      enabled: !!pane.querySelector('[name=enabled]').checked, gossipAboutThreads: !!pane.querySelector('[name=gossipAboutThreads]').checked,
      commentChance: Number(data.commentChance), maxCommentsPerPost: Number(data.maxCommentsPerPost), postEveryHours: Number(data.postEveryHours) } });
    toast('Saved');
  });
  pane.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-run]');
    if (!b) return;
    try {
      const { socialId } = await api('/api/admin/bots/run', { method: 'POST', body: { characterId: Number(b.dataset.run), what: b.dataset.what } });
      toast(b.dataset.what === 'comment' ? 'Commented on the newest post' : 'Posted');
      if (socialId) location.hash = `#/p/${socialId}`;
    } catch (err) { toast(err.message); }
  });
}

// Header pictures that rotate across the top of the main pages (Home, Feed, Events, Directory…).
async function headers(pane) {
  let list = [...(await loadHeaders(true))];
  const save = async () => {
    try { list = (await api('/api/headers', { method: 'PUT', body: { headers: list } })).headers; await loadHeaders(true); toast('Headers saved'); } catch (err) { toast(err.message); }
    draw();
  };
  const draw = () => render(pane, html`
    <section class="card">
      <h3>Header pictures</h3>
      <p class="muted small">They crossfade every 8 seconds at the top of Home, Feed, Events, Directory, Characters and Notifications. With none, the pink-lilac gradient shows. Wide pictures work best (about 1800 × 600).</p>
      <div class="hdr-grid">${list.map((u, i) => html`<figure class="hdr-item"><img src="${u}" alt=""><button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Remove">✕</button></figure>`)}</div>
      <div class="actions">
        <label class="btn file-btn">${icons.image} Upload pictures<input type="file" accept="image/*" multiple id="hdr-file" hidden></label>
        <button type="button" id="hdr-link">Add a picture link</button>
      </div>
    </section>`);
  draw();
  pane.addEventListener('change', async (e) => {
    if (e.target.id !== 'hdr-file') return;
    for (const f of e.target.files) { try { toast('Uploading…'); list.push(await uploadImage(f, 2000)); } catch (err) { toast(err.message); } }
    save();
  });
  pane.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { list.splice(Number(rm.dataset.rm), 1); save(); return; }
    if (e.target.closest('#hdr-link')) { const url = await askImageLink(); if (url) { list.push(url); save(); } }
  });
}
