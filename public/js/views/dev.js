// The Development hub (in the sidebar): where writers keep plot points, ideas and storyline concepts,
// and talk them over in comments. Tap a card to read it in full; its writer can change, pin or
// remove it. "Only me" notes are private drafts nobody else sees.
import { html, render, api, $, $$, toast, avatar, icons, modal, confirmModal, formatPost, timeAgo, applyColors } from '../lib.js';
import { state, page, routeAlive, ensureAlive, replaceHash } from '../main.js';

const KINDS = { plot: 'Plot point', idea: 'Idea', storyline: 'Storyline' };
const KIND_TABS = [
  ['all', 'All'],
  ['plot', 'Plot points'],
  ['idea', 'Ideas'],
  ['storyline', 'Storylines'],
];
const STATUSES = { open: 'Open', developing: 'Developing', used: 'Used in a story', shelved: 'Shelved' };

// Where the list is (kept while you open notes and come back).
const view = { kind: 'all', status: 'all', mine: false, q: '' };

function noteForm(note = null) {
  const kind = note?.kind ?? (view.kind === 'all' ? 'idea' : view.kind);
  return modal(
    html`
    <form class="dev-form">
      <h2>${note ? 'Change this note' : 'New note'}</h2>
      <div class="seg dev-kind" role="group" aria-label="Kind">${Object.entries(KINDS).map(
        ([k, v]) => html`<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${v}</button>`,
      )}</div>
      <input type="hidden" name="kind" value="${kind}">
      <label for="dv-title">Title</label>
      <input id="dv-title" name="title" maxlength="140" required value="${note?.title ?? ''}" placeholder="e.g. The blackout gala">
      <label for="dv-body">Details <span class="muted small">(optional)</span></label>
      <textarea id="dv-body" name="body" rows="8" maxlength="20000" placeholder="What happens, who's involved, how it could play out…">${note?.body ?? ''}</textarea>
      <label for="dv-status">Status</label>
      <select id="dv-status" name="status">${Object.entries(STATUSES).map(
        ([k, v]) => html`<option value="${k}" ${(note?.status ?? 'open') === k ? 'selected' : ''}>${v}</option>`,
      )}</select>
      <label class="check"><input type="checkbox" name="private" ${note?.private ? 'checked' : ''}> Only me (a private draft nobody else sees)</label>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${note ? 'Save' : 'Add note'}</button></div>
    </form>`,
    {
      init: (d) => {
        d.querySelector('.dev-kind').addEventListener('click', (e) => {
          const b = e.target.closest('[data-kind]');
          if (!b) return;
          d.querySelector('input[name=kind]').value = b.dataset.kind;
          $$('[data-kind]', d).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        });
        if (!note) $('#dv-title', d).focus();
      },
      submit: async (data) => {
        const body = { ...data, private: !!data.private };
        const res = await api(note ? `/api/dev/${note.id}` : '/api/dev', { method: note ? 'PUT' : 'POST', body });
        return res.note;
      },
    },
  );
}

// One note in full, with its comments. Resolves once it's closed (true if anything changed).
async function openNote(id) {
  let changed = false;
  let data;
  try {
    data = await api(`/api/dev/${id}`);
  } catch (err) {
    toast(err.message);
    return false;
  }
  await modal(html`<div class="dev-open" id="dev-open"></div>`, {
    init: (d, close) => {
      const box = $('#dev-open', d);
      const draw = () => {
        const { note: n, comments } = data;
        render(
          box,
          html`
          <div class="dev-tags"><span class="dev-kind-tag kind-${n.kind}">${KINDS[n.kind]}</span><span class="dev-status st-${n.status}">${STATUSES[n.status]}</span>
            ${n.private ? html`<span class="dev-flag">${icons.lock} Only me</span>` : ''}${n.pinned ? html`<span class="dev-flag">${icons.pushpin} Pinned</span>` : ''}</div>
          <h2>${n.title}</h2>
          <p class="dev-by">${avatar({ name: n.writer.displayName, src: n.writer.avatar, size: 'xs' })} <a href="#/u/${n.writer.id}" data-close>${n.writer.displayName}</a> · ${timeAgo(n.createdAt)}${n.updatedAt !== n.createdAt ? html` · changed ${timeAgo(n.updatedAt)}` : ''}</p>
          ${n.body ? html`<div class="dev-body prose">${formatPost(n.body)}</div>` : html`<p class="muted small">No details yet.</p>`}
          ${
            n.canEdit
              ? html`<div class="dev-tools">
            <button type="button" class="sm" data-act="edit">${icons.pencil} Change</button>
            <button type="button" class="sm" data-act="pin">${icons.pushpin} ${n.pinned ? 'Unpin' : 'Pin to the top'}</button>
            <button type="button" class="sm ghost danger" data-act="delete">${icons.trash} Remove</button></div>`
              : ''
          }
          <h3 class="dev-c-head">Comments <span class="muted">(${comments.length})</span></h3>
          ${
            comments.length
              ? html`<ul class="dev-comments">${comments.map(
                  (c) => html`<li>${avatar({ name: c.writer.displayName, src: c.writer.avatar, size: 'xs' })}
                <div class="grow"><b>${c.writer.displayName}</b> <span class="muted small">${timeAgo(c.createdAt)}</span>
                  <div class="dev-c-body">${formatPost(c.body)}</div></div>
                ${c.canDelete ? html`<button type="button" class="icon-btn sm" data-del-comment="${c.id}" aria-label="Remove comment">${icons.trash}</button>` : ''}</li>`,
                )}</ul>`
              : html`<p class="muted small">No comments yet. Share a thought below.</p>`
          }
          <form class="dev-c-form">
            <textarea name="body" rows="2" maxlength="5000" placeholder="Add a comment…" aria-label="Add a comment" required></textarea>
            <button type="submit" class="primary sm">Post</button>
          </form>
          <div class="actions end"><button type="button" data-close>Close</button></div>`,
        );
        applyColors(box);
        $$('[data-close]', box).forEach((b) => b.addEventListener('click', () => close(null)));
      };
      const reload = async () => {
        data = await api(`/api/dev/${id}`);
        changed = true;
        draw();
      };
      draw();
      box.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const text = form.body.value.trim();
        if (!text) return;
        form.querySelector('button').disabled = true;
        try {
          await api(`/api/dev/${id}/comments`, { method: 'POST', body: { body: text } });
          await reload();
        } catch (err) {
          toast(err.message);
          form.querySelector('button').disabled = false;
        }
      });
      box.addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del-comment]');
        if (del) {
          if (!(await confirmModal('Remove this comment?', { ok: 'Remove', danger: true }))) return;
          await api(`/api/dev/${id}/comments/${del.dataset.delComment}`, { method: 'DELETE' });
          return reload();
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'edit' && (await noteForm(data.note))) await reload();
        if (act === 'pin') {
          await api(`/api/dev/${id}`, { method: 'PUT', body: { pinned: !data.note.pinned } });
          await reload();
        }
        if (act === 'delete') {
          if (!(await confirmModal(`Remove “${data.note.title}” and its comments?`, { ok: 'Remove', danger: true }))) return;
          await api(`/api/dev/${id}`, { method: 'DELETE' });
          toast('Removed');
          changed = true;
          close(null);
        }
      });
    },
  });
  return changed;
}

export async function viewDev(openId = null) {
  const alive = routeAlive();
  const { notes } = await api('/api/dev');
  ensureAlive(alive);
  const body = page({
    alive,
    title: 'Development',
    subtitle: 'Plan stories together',
    actions: html`<button class="primary sm" id="dev-new">${icons.plus} New</button>`,
    body: html`
      <div class="dev-bar">
        <input type="search" class="search" id="dev-q" placeholder="Search notes…" aria-label="Search notes" value="${view.q}">
        <div class="seg dev-tabs no-swipe" role="group" aria-label="Show">${KIND_TABS.map(
          ([k, v]) => html`<button type="button" data-tab="${k}">${v}</button>`,
        )}</div>
        <div class="dev-filters">
          <select id="dev-status" aria-label="Status"><option value="all">Any status</option>${Object.entries(STATUSES).map(
            ([k, v]) => html`<option value="${k}" ${view.status === k ? 'selected' : ''}>${v}</option>`,
          )}</select>
          <label class="check"><input type="checkbox" id="dev-mine" ${view.mine ? 'checked' : ''}> Only mine</label>
        </div>
      </div>
      <div id="dev-list"></div>`,
  });
  const draw = () => {
    $$('[data-tab]', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === view.kind)));
    const q = view.q.toLowerCase();
    const shown = notes.filter(
      (n) =>
        (view.kind === 'all' || n.kind === view.kind) &&
        (view.status === 'all' || n.status === view.status) &&
        (!view.mine || n.writer.id === state.user.id) &&
        (!q || `${n.title} ${n.body} ${n.writer.displayName}`.toLowerCase().includes(q)),
    );
    render(
      $('#dev-list', body),
      shown.length
        ? html`<div class="dev-grid">${shown.map(
            (n) => html`
          <button type="button" class="dev-card kind-${n.kind}" data-open="${n.id}">
            <span class="dev-tags"><span class="dev-kind-tag kind-${n.kind}">${KINDS[n.kind]}</span><span class="dev-status st-${n.status}">${STATUSES[n.status]}</span>
              ${n.pinned ? html`<span class="dev-flag" title="Pinned">${icons.pushpin}</span>` : ''}${n.private ? html`<span class="dev-flag" title="Only me">${icons.lock}</span>` : ''}</span>
            <b class="dev-title">${n.title}</b>
            ${n.body ? html`<span class="dev-snip">${n.body.replace(/\s+/g, ' ').slice(0, 220)}</span>` : ''}
            <span class="dev-meta">${avatar({ name: n.writer.displayName, src: n.writer.avatar, size: 'xs' })}<span>${n.writer.displayName} · ${timeAgo(n.updatedAt)}</span>
              ${n.commentCount ? html`<span class="dev-cc">${icons.chat} ${n.commentCount}</span>` : ''}</span>
          </button>`,
          )}</div>`
        : html`<div class="empty dev-empty">${icons.sparkles}<h2>${notes.length ? 'Nothing matches' : 'Nothing here yet'}</h2>
          <p class="muted">${notes.length ? 'Try another tab or search.' : 'Add the first plot point, idea or storyline concept, so everyone has one place to plan together.'}</p></div>`,
    );
    applyColors(body);
  };
  draw();
  const refresh = async () => {
    const fresh = await api('/api/dev');
    notes.splice(0, notes.length, ...fresh.notes);
    draw();
  };
  // Opened from a link (a notification): afterwards the address goes back to the list, which
  // shows it again fresh. Opened from the list: the list updates if anything changed.
  const show = async (id, fromLink = false) => {
    const changed = await openNote(id);
    if (fromLink) replaceHash('#/dev');
    else if (changed) refresh();
  };
  body.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      view.kind = tab.dataset.tab;
      return draw();
    }
    const card = e.target.closest('[data-open]');
    if (card) show(Number(card.dataset.open));
  });
  $('#dev-q', body).addEventListener('input', (e) => {
    view.q = e.target.value.trim();
    draw();
  });
  $('#dev-status', body).addEventListener('change', (e) => {
    view.status = e.target.value;
    draw();
  });
  $('#dev-mine', body).addEventListener('change', (e) => {
    view.mine = e.target.checked;
    draw();
  });
  $('#main #dev-new')?.addEventListener('click', async () => {
    const note = await noteForm();
    if (!note) return;
    toast('Added');
    await refresh();
  });
  if (openId) show(Number(openId), true);
}
