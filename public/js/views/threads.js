// The feed (every thread you can see, filterable by type) and the start/edit-a-thread form.
import { html, render, api, $, $$, toast, avatar, icons, modal } from '../lib.js';
import { state, page, loadStory, refreshHome, myCharacters, routeAlive, KIND_LABELS, kindIcon } from '../main.js';

const STATUS_LABELS = { open: 'Open', closed: 'Private', complete: 'Complete' };
export const statusPill = (c) => (c.kind === 'ooc' ? '' : html`<span class="pill-tag status-${c.status}">${STATUS_LABELS[c.status]}</span>`);

const parseDate = (d) => new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z');
const shortDate = (d) => parseDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function avatarStack(chars, max = 4) {
  return html`<span class="avatar-stack">${chars.slice(0, max).map((c) => avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' }))}${chars.length > max ? html`<span class="more">+${chars.length - max}</span>` : ''}</span>`;
}

export function feedCard(item) {
  const pic = item.story.banner || item.starter?.portrait || item.starter?.avatar;
  const when = item.kind === 'event' && item.eventAt ? item.eventAt : item.lastPostAt || item.createdAt;
  return html`
    <a class="feed-card kind-${item.kind}" href="#/s/${item.storyId}/${item.id}" data-color="${item.story.color}">
      <div class="fc-media">
        ${pic ? html`<img src="${pic}" alt="" loading="lazy">` : ''}
        <div class="fc-chips">
          <span class="chip">${item.kind === 'event' && item.eventAt ? parseDate(item.eventAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : shortDate(when)}</span>
          <span class="chip icon" title="${KIND_LABELS[item.kind]}">${kindIcon(item.kind)}</span>
          ${item.unread ? html`<span class="chip new">${item.unread} new</span>` : ''}
        </div>
        <h3>${item.name}</h3>
      </div>
      <div class="fc-body">
        ${item.summary ? html`<p class="fc-summary">${item.summary}</p>` : item.lastPost ? html`<p class="fc-summary"><b>${item.lastPost.by}:</b> ${item.lastPost.text}</p>` : ''}
        ${item.tags.length ? html`<div class="tags">${item.tags.map((t) => html`<span class="tag">#${t}</span>`)}</div>` : ''}
        <div class="fc-foot">
          ${item.participants.length ? avatarStack(item.participants) : ''}
          <span class="fc-where">${item.story.title} · ${item.postCount} posts</span>
          ${statusPill(item)}
        </div>
      </div>
    </a>`;
}

const FILTERS = [['all', 'All'], ['open', 'Open threads'], ['mine', 'My threads'], ['thread', 'Threads'], ['comms', 'Comms'], ['event', 'Events'], ['ooc', 'OOC']];

function dayGroup(item) {
  const d = parseDate(item.lastPostAt || item.createdAt);
  const mins = (Date.now() - d) / 60000;
  if (mins < 60) return 'Now';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

export async function viewFeed() {
  const alive = routeAlive();
  let filter = sessionStorage.getItem('nuuvi:feed-filter') || 'all';
  const body = page({
    alive,
    title: 'Feed',
    subtitle: 'Threads, comms and events across your stories',
    body: html`
      <div class="feed-tools no-swipe">
        <label class="search-pill">${icons.compass}<input type="search" id="q" placeholder="Search threads, tags, stories…" aria-label="Search the feed"></label>
        <div class="chips scroll-x" role="tablist">${FILTERS.map(([k, label]) => html`<button class="chip-btn" data-f="${k}" aria-pressed="${k === filter}">${label}</button>`)}</div>
      </div>
      <div id="feed-list"></div>`,
  });
  const list = $('#feed-list', body);
  let q = '';
  const load = async () => {
    const { items } = await api(`/api/feed?filter=${filter}&q=${encodeURIComponent(q)}`);
    if (!items.length) {
      return render(list, html`<div class="empty"><p>Nothing here yet.</p>${state.home.stories.length ? html`<p class="small">Start a thread from any story's sidebar.</p>` : html`<p class="small"><a href="#/discover">Find a story</a> to join.</p>`}</div>`);
    }
    const groups = [];
    for (const it of items) {
      const g = dayGroup(it);
      if (!groups.length || groups.at(-1).label !== g) groups.push({ label: g, items: [] });
      groups.at(-1).items.push(it);
    }
    render(list, html`${groups.map((g) => html`
      <div class="feed-day"><span class="${g.label === 'Now' ? 'now' : ''}">${g.label}</span></div>
      <div class="feed-grid">${g.items.map(feedCard)}</div>`)}`);
  };
  $$('[data-f]', body).forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.f;
    try { sessionStorage.setItem('nuuvi:feed-filter', filter); } catch { /* ignore */ }
    $$('[data-f]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    load().catch((err) => toast(err.message));
  }));
  let t;
  $('#q', body).addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { q = e.target.value; load().catch((err) => toast(err.message)); }, 250);
  });
  await load();
}

// Start a new thread, or edit one (pass `channel`). If no story is given, the form asks which.
export async function openThreadForm({ storyId = null, channel = null, tag = [] } = {}) {
  document.body.classList.remove('drawer-open', 'members-open');
  const editing = !!channel;
  const sid = storyId ?? channel?.storyId;
  const myStories = state.home.stories;
  if (!sid && !myStories.length) return toast('Join or start a story first');
  const [characters, storyDetail] = await Promise.all([myCharacters(true), sid ? api(`/api/stories/${sid}`) : null]);
  const isOwner = storyDetail?.role === 'owner' || state.user.isAdmin;
  const kinds = [['thread', 'Thread'], ['comms', 'Comms (texts & socials)'], ...(isOwner || channel?.kind === 'event' ? [['event', 'Event']] : []), ...(isOwner || channel?.kind === 'ooc' ? [['ooc', 'OOC channel']] : [])];
  const c = channel || {};
  const eventLocal = c.eventAt ? new Date(c.eventAt).toISOString().slice(0, 16) : '';

  const result = await modal(html`
    <form class="thread-form">
      <span class="eyebrow">${editing ? 'Edit thread' : 'New thread'}</span>
      <h2>${editing ? c.name : 'Start something'}</h2>
      ${!sid ? html`<label for="t-story">Story</label>
        <select id="t-story" name="storyId">${myStories.map((s) => html`<option value="${s.id}">${s.title}</option>`)}</select>` : ''}
      <label for="t-name">Title</label>
      <input id="t-name" name="name" required maxlength="80" value="${c.name || ''}" placeholder="childhood friends reunited">
      <div class="row">
        <div><label for="t-kind">Type</label><select id="t-kind" name="kind">${kinds.map(([v, l]) => html`<option value="${v}" ${(c.kind || 'thread') === v ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div><label for="t-status">Who can write</label><select id="t-status" name="status">
          <option value="open" ${(c.status || 'open') === 'open' ? 'selected' : ''}>Open — anyone in the story</option>
          <option value="closed" ${c.status === 'closed' ? 'selected' : ''}>Private — tagged characters only</option>
          ${editing ? html`<option value="complete" ${c.status === 'complete' ? 'selected' : ''}>Complete — read only</option>` : ''}
        </select></div>
      </div>
      <div id="t-event" ${(c.kind || 'thread') === 'event' ? '' : 'hidden'}>
        <label for="t-when">Event date & time</label>
        <input id="t-when" type="datetime-local" name="eventAt" value="${eventLocal}">
      </div>
      ${!editing && characters.length ? html`
        <label for="t-char">Starring</label>
        <select id="t-char" name="characterId"><option value="">— nobody yet —</option>${characters.map((ch) => html`<option value="${ch.id}">${ch.name}</option>`)}</select>` : ''}
      <label>Tag characters</label>
      <div id="t-tagged" class="tag-picker"><span class="muted small">${sid ? 'Loading…' : 'Pick a story first'}</span></div>
      <label for="t-summary">Plot / summary <span class="muted small">— shown at the top of the thread</span></label>
      <textarea id="t-summary" name="summary" maxlength="3000" rows="4" placeholder="Where are they, what just happened, what's at stake?">${c.summary || ''}</textarea>
      <label for="t-tags">Tags</label>
      <input id="t-tags" name="tags" maxlength="400" value="${(c.tags || []).join(', ')}" placeholder="angst, reunion, slow burn">
      <div class="error"></div>
      <div class="actions end">
        ${editing ? html`<button type="button" class="danger" id="t-delete">Delete</button><span class="spacer"></span>` : ''}
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">${editing ? 'Save' : 'Start thread'}</button>
      </div>
    </form>`, {
    init: (d, close) => {
      const form = d.querySelector('form');
      form.kind.addEventListener('change', () => { $('#t-event', d).hidden = form.kind.value !== 'event'; });
      const picker = $('#t-tagged', d);
      const loadTaggable = async (id) => {
        const { characters: all } = await api(`/api/stories/${id}/characters`).catch(() => ({ characters: [] }));
        const pre = new Set([...(channel?.participantIds || []), ...tag]);
        render(picker, all.length ? html`${all.map((ch) => html`
          <label class="tag-option"><input type="checkbox" value="${ch.id}" ${pre.has(ch.id) ? 'checked' : ''}>
            ${avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'xs' })}<span>${ch.name}</span><small>${ch.ownerName}</small></label>`)}`
          : html`<span class="muted small">No characters in this story yet.</span>`);
      };
      if (sid) loadTaggable(sid);
      form.storyId?.addEventListener('change', () => loadTaggable(form.storyId.value));
      if (form.storyId) loadTaggable(form.storyId.value);
      $('#t-delete', d)?.addEventListener('click', async () => {
        if (!confirm(`Delete "${c.name}" and every post in it?`)) return;
        try {
          await api(`/api/channels/${c.id}`, { method: 'DELETE' });
          close('deleted');
        } catch (err) { toast(err.message); }
      });
    },
    submit: async (data) => {
      const form = document.querySelector('dialog .thread-form');
      const tagged = $$('#t-tagged input:checked', form).map((i) => Number(i.value));
      const target = Number(data.storyId || sid);
      const payload = {
        name: data.name, kind: data.kind, status: data.status, summary: data.summary, tags: data.tags, tagged,
        eventAt: data.kind === 'event' && data.eventAt ? new Date(data.eventAt).toISOString() : null,
      };
      if (!editing && data.characterId) payload.characterId = Number(data.characterId);
      const res = editing
        ? await api(`/api/channels/${c.id}`, { method: 'PUT', body: payload })
        : await api(`/api/stories/${target}/channels`, { method: 'POST', body: payload });
      return { storyId: target, channel: res.channel };
    },
  });
  if (!result) return null;
  if (result === 'deleted') {
    toast('Thread deleted');
    await loadStory(sid);
    location.hash = `#/s/${sid}`;
    return null;
  }
  await Promise.all([loadStory(result.storyId), refreshHome()]);
  toast(editing ? 'Thread updated' : 'Thread started');
  if (!editing) location.hash = `#/s/${result.storyId}/${result.channel.id}`;
  return result.channel;
}


