// The suggestion box: ideas for making NUUVI better. Everyone can add one and vote for the ones
// they'd most like; the team marks where each stands (planned, done, not planned) and can reply.
import { html, render, api, $, $$, toast, avatar, icons, confirmModal, promptModal, timeAgo } from '../lib.js';
import { page, routeAlive, ensureAlive } from '../main.js';

const STATUS = { open: 'Open', planned: 'Planned', done: 'Done', declined: 'Not planned' };
const TABS = [
  ['top', 'Top'],
  ['new', 'Newest'],
  ['planned', 'Planned'],
  ['done', 'Done'],
];
let tab = 'top';

export async function viewSuggestions() {
  const alive = routeAlive();
  let { suggestions, staff } = await api('/api/suggestions');
  ensureAlive(alive);
  const body = page({
    alive,
    title: 'Suggestions',
    subtitle: 'Ideas to make NUUVI better',
    body: html`
      <form class="sg-form card">
        <label for="sg-title">What would make NUUVI better?</label>
        <input id="sg-title" name="title" maxlength="140" required placeholder="e.g. Let characters have a playlist on their profile">
        <textarea name="body" rows="3" maxlength="5000" placeholder="Tell us more (optional): how it would work, why it would help…" aria-label="Details"></textarea>
        <div class="actions end"><button type="submit" class="primary">${icons.bulb} Suggest it</button></div>
      </form>
      <div class="seg sg-tabs no-swipe" role="group" aria-label="Show">${TABS.map(([k, v]) => html`<button type="button" data-tab="${k}">${v}</button>`)}</div>
      <div id="sg-list"></div>`,
  });
  const list = $('#sg-list', body);
  const draw = () => {
    $$('[data-tab]', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    let shown = suggestions;
    if (tab === 'top')
      shown = suggestions
        .filter((s) => s.status === 'open' || s.status === 'planned')
        .sort((a, b) => b.votes - a.votes || b.id - a.id);
    if (tab === 'new') shown = [...suggestions].sort((a, b) => b.id - a.id);
    if (tab === 'planned') shown = suggestions.filter((s) => s.status === 'planned').sort((a, b) => b.votes - a.votes);
    if (tab === 'done') shown = suggestions.filter((s) => s.status === 'done' || s.status === 'declined');
    render(
      list,
      shown.length
        ? html`<div class="sg-list">${shown.map(
            (s) => html`
          <article class="sg-card st-${s.status}">
            <button type="button" class="sg-vote" data-vote="${s.id}" aria-pressed="${s.voted}" aria-label="${s.voted ? 'Take back your vote' : 'Vote for this'}">
              ${s.voted ? icons.heartFill : icons.heart}<b>${s.votes}</b></button>
            <div class="sg-main">
              <div class="sg-top"><span class="sg-status st-${s.status}">${STATUS[s.status]}</span></div>
              <h3>${s.title}</h3>
              ${s.body ? html`<p class="sg-body">${s.body}</p>` : ''}
              <p class="sg-by">${avatar({ name: s.writer.displayName, src: s.writer.avatar, size: 'xs' })} ${s.writer.displayName} · ${timeAgo(s.createdAt)}</p>
              ${s.reply ? html`<div class="sg-reply"><b>${icons.chat} From the team</b><p>${s.reply}</p></div>` : ''}
              ${
                staff || s.canEdit || s.canDelete
                  ? html`<div class="sg-tools">
                ${
                  staff
                    ? html`<select data-status="${s.id}" aria-label="Status">${Object.entries(STATUS).map(([k, v]) => html`<option value="${k}" ${s.status === k ? 'selected' : ''}>${v}</option>`)}</select>
                  <button type="button" class="sm" data-reply="${s.id}">${icons.chat} ${s.reply ? 'Change reply' : 'Reply'}</button>`
                    : ''
                }
                ${s.canEdit ? html`<button type="button" class="sm" data-edit="${s.id}">${icons.pencil} Edit</button>` : ''}
                ${s.canDelete ? html`<button type="button" class="sm ghost danger" data-del="${s.id}" aria-label="Remove">${icons.trash}</button>` : ''}
              </div>`
                  : ''
              }
            </div>
          </article>`,
          )}</div>`
        : html`<div class="empty"><p>${tab === 'done' ? 'Nothing finished yet.' : tab === 'planned' ? 'Nothing planned yet.' : 'No suggestions yet. Be the first!'}</p></div>`,
    );
  };
  const put = (s) => {
    suggestions = suggestions.map((x) => (x.id === s.id ? s : x));
    draw();
  };
  draw();
  $('.sg-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const { suggestion } = await api('/api/suggestions', {
        method: 'POST',
        body: { title: f.title.value, body: f.body.value },
      });
      suggestions = [suggestion, ...suggestions];
      f.reset();
      tab = 'new';
      draw();
      toast('Thanks! Your suggestion is in');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      return draw();
    }
    const v = e.target.closest('[data-vote]');
    if (v) return put((await api(`/api/suggestions/${v.dataset.vote}/vote`, { method: 'POST', body: {} })).suggestion);
    const r = e.target.closest('[data-reply]');
    if (r) {
      const s = suggestions.find((x) => x.id === Number(r.dataset.reply));
      const text = await promptModal('Reply from the team', {
        value: s.reply,
        multiline: true,
        maxlength: 3000,
        required: false,
      });
      if (text === null) return;
      return put((await api(`/api/suggestions/${s.id}`, { method: 'PUT', body: { reply: text } })).suggestion);
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const s = suggestions.find((x) => x.id === Number(ed.dataset.edit));
      const title = await promptModal('Your suggestion', { value: s.title, maxlength: 140 });
      if (title === null) return;
      const more = await promptModal('More detail (optional)', {
        value: s.body,
        multiline: true,
        maxlength: 5000,
        required: false,
      });
      if (more === null) return;
      return put((await api(`/api/suggestions/${s.id}`, { method: 'PUT', body: { title, body: more } })).suggestion);
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!(await confirmModal('Remove this suggestion?', { ok: 'Remove', danger: true }))) return;
      await api(`/api/suggestions/${del.dataset.del}`, { method: 'DELETE' });
      suggestions = suggestions.filter((x) => x.id !== Number(del.dataset.del));
      draw();
    }
  });
  body.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]');
    if (!sel) return;
    try {
      put((await api(`/api/suggestions/${sel.dataset.status}`, { method: 'PUT', body: { status: sel.value } })).suggestion);
      toast(`Marked ${STATUS[sel.value].toLowerCase()}`);
    } catch (err) {
      toast(err.message);
    }
  });
}
