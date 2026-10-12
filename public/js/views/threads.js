// The feed (every thread you can see, filterable by type) and the start/edit-a-thread form.
import { html, render, applyColors, api, $, $$, toast, avatar, icons, modal, uploadImage, askImageLink } from '../lib.js';
import { socialCard, bindSocial, openSocialComposer, styleBars } from './social.js';
import { eventFeedCard } from './events.js';
import { state, page, loadStory, refreshHome, myCharacters, routeAlive, KIND_LABELS, kindIcon, channelIcon } from '../main.js';

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

// Brick-wall feed: every card keeps its natural height and the grid packs them in order,
// left to right. Rows are 2px tall, so each card spans as many rows as it is tall; a
// ResizeObserver keeps that right as pictures load, text wraps or the window resizes.
// offsetHeight (not the on-screen size) so it stays right at any Interface size.
const ROW = 2;
const fitBrick = (el) => {
  const gap = parseFloat(getComputedStyle(el).marginBottom) || 0;
  el.style.gridRowEnd = `span ${Math.max(1, Math.ceil((el.offsetHeight + gap) / ROW))}`;
};
const bricks = new ResizeObserver((entries) => { for (const e of entries) fitBrick(e.target); });
export function masonry(root) {
  for (const el of root.querySelectorAll('.feed-grid > *')) { fitBrick(el); bricks.observe(el); }
}

const FILTERS = [['all', 'All'], ['open', 'Open episodes'], ['para', 'Self paras'], ['social', 'Social'], ['event', 'Events']];

function dayGroup(item) {
  const d = parseDate(item.sortAt || item.lastPostAt || item.createdAt);
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
  if (!FILTERS.some(([k]) => k === filter)) filter = 'all';
  const body = page({
    alive,
    title: 'Feed',
    banner: 'what everyone’s up to',
    subtitle: 'Open threads, self paras, social posts and events',
    actions: html`<a class="btn sm" href="#/events" aria-label="Events">${icons.calendar}<span class="lbl">Events</span></a><button class="primary sm" id="new-post">${icons.plus}<span class="lbl">New post</span></button>`,
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
    socialPosts.clear();
    for (const it of items) if (it.type === 'social') socialPosts.set(it.id, it);
    const groups = [];
    for (const it of items) {
      const g = dayGroup(it);
      if (!groups.length || groups.at(-1).label !== g) groups.push({ label: g, items: [] });
      groups.at(-1).items.push(it);
    }
    render(list, html`${groups.map((g) => html`
      <div class="feed-day"><span class="${g.label === 'Now' ? 'now' : ''}">${g.label}</span></div>
      <div class="feed-grid">${g.items.map((it) => (it.type === 'social' ? socialCard(it) : it.type === 'event' ? eventFeedCard(it) : feedCard(it)))}</div>`)}`);
    styleBars(list);
    masonry(list);
  };
  const socialPosts = new Map();
  bindSocial(list, socialPosts, (p) => {
    socialPosts.set(p.id, p);
    const el = list.querySelector(`[data-social="${p.id}"]`);
    if (el) { el.outerHTML = socialCard(p).v; applyColors(list); styleBars(list); masonry(list); }
  });
  $('#main #new-post').addEventListener('click', async () => { if (await openSocialComposer()) load(); });
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
// Quick picks for a comms thread's icon (texts, DMs, socials, work chat…).
const COMMS_EMOJI = ['💬', '📱', '💌', '📸', '🐦', '🎮', '💼', '🖤', '🩷', '✨', '🔒', '📞'];

export async function openThreadForm({ storyId = null, channel = null, tag = [], eventId = null, kind: startKind = null } = {}) {
  document.body.classList.remove('drawer-open', 'members-open');
  const editing = !!channel;
  const sid = storyId ?? channel?.storyId;
  const myStories = state.home.stories;
  if (!sid && !myStories.length) return toast('Join or start a story first');
  const [characters, storyDetail] = await Promise.all([myCharacters(true), sid ? api(`/api/stories/${sid}`) : null]);
  const isOwner = storyDetail?.role === 'owner' || state.user.isAdmin;
  const kinds = [['thread', 'Episode'], ['para', 'Self para (solo writing)'], ['comms', 'Comms (texts)'], ['event', 'Event'], ...(isOwner || channel?.kind === 'ooc' ? [['ooc', 'OOC channel']] : [])];
  const c = channel || { kind: startKind || 'thread', eventId };

  const result = await modal(html`
    <form class="thread-form">
      <span class="eyebrow">${editing ? 'Edit episode' : 'New episode'}</span>
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
      <div id="t-icon" ${(c.kind || 'thread') === 'comms' ? '' : 'hidden'}>
        <label>Icon <span class="muted small">— which app is this? Pick an emoji or use a picture</span></label>
        <div class="icon-picker">
          <span class="icon-preview" id="t-icon-preview"></span>
          ${COMMS_EMOJI.map((e) => html`<button type="button" class="emoji-pick" data-emoji="${e}">${e}</button>`)}
        </div>
        <div class="row-inline">
          <input id="t-icon-text" maxlength="8" placeholder="or type an emoji" value="${c.icon && !/^(\/|https:)/.test(c.icon) ? c.icon : ''}">
          <label class="btn sm file-btn">Upload<input type="file" accept="image/*" id="t-icon-file" hidden></label>
          <button type="button" class="sm link-btn" id="t-icon-link">Link</button>
          <button type="button" class="sm" id="t-icon-clear">None</button>
        </div>
        <input type="hidden" name="icon" value="${c.icon || ''}">
      </div>
      <div id="t-event" ${['event', 'comms'].includes(c.kind || 'thread') ? '' : 'hidden'}>
        <label for="t-ev">Event <span class="muted small" id="t-ev-note"></span></label>
        <div class="row-inline"><select id="t-ev" name="eventId"><option value="">Loading…</option></select>
          <button type="button" class="sm" id="t-ev-new">${icons.plus} New event</button></div>
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
        <button type="submit" class="primary">${editing ? 'Save' : 'Start episode'}</button>
      </div>
    </form>`, {
    init: (d, close) => {
      const form = d.querySelector('form');
      // Event threads pick one of the story's ongoing events; comms can optionally be part of one.
      const evSelect = $('#t-ev', d);
      const loadEvents = async (sidNow, keep = c.eventId) => {
        if (!sidNow) return render(evSelect, html`<option value="">Pick a story first</option>`);
        const { events } = await api(`/api/calendar?story=${sidNow}`).catch(() => ({ events: [] }));
        const live = events.filter((e) => e.id === keep || new Date(e.endsAt || e.startsAt) >= new Date(Date.now() - 864e5));
        render(evSelect, html`<option value="">${form.kind.value === 'event' ? 'Choose an event…' : '— not part of an event —'}</option>
          ${live.map((e) => html`<option value="${e.id}" ${e.id === keep ? 'selected' : ''}>${e.title} · ${new Date(e.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</option>`)}`);
        if (!live.length && form.kind.value === 'event') $('#t-ev-note', d).textContent = '— no upcoming events yet, add one';
      };
      const syncKind = () => {
        $('#t-event', d).hidden = !['event', 'comms'].includes(form.kind.value);
        $('#t-icon', d).hidden = form.kind.value !== 'comms';
        evSelect.required = form.kind.value === 'event';
        $('#t-ev-note', d).textContent = form.kind.value === 'event' ? '' : '(optional)';
        loadEvents(form.storyId?.value || sid, Number(evSelect.value) || c.eventId);
      };
      form.kind.addEventListener('change', syncKind);
      form.storyId?.addEventListener('change', syncKind);
      syncKind();
      $('#t-ev-new', d).addEventListener('click', async () => {
        const { openEventForm } = await import('./events.js');
        const made = await openEventForm({ storyId: Number(form.storyId?.value || sid) });
        if (made && made !== 'deleted') loadEvents(made.storyId, made.id);
      });
      const setIcon = (v) => {
        form.icon.value = v || '';
        render($('#t-icon-preview', d), v ? channelIcon({ icon: v, kind: 'comms' }) : kindIcon('comms'));
      };
      setIcon(form.icon.value);
      $('#t-icon', d).addEventListener('click', async (e) => {
        const pick = e.target.closest('[data-emoji]');
        if (pick) { $('#t-icon-text', d).value = pick.dataset.emoji; setIcon(pick.dataset.emoji); }
        if (e.target.closest('#t-icon-clear')) { $('#t-icon-text', d).value = ''; setIcon(''); }
        if (e.target.closest('#t-icon-link')) { const url = await askImageLink(); if (url) setIcon(url); }
      });
      $('#t-icon-text', d).addEventListener('input', (e) => setIcon(e.target.value.trim()));
      $('#t-icon-file', d).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { setIcon(await uploadImage(file, 256)); } catch (err) { toast(err.message); }
      });
      const picker = $('#t-tagged', d);
      const loadTaggable = async (id) => {
        const { characters: all } = await api(`/api/stories/${id}/characters`).catch(() => ({ characters: [] }));
        const pre = new Set([...(channel?.participantIds || []), ...tag]);
        render(picker, all.length ? html`${all.map((ch) => html`
          <label class="tag-option"><input type="checkbox" value="${ch.id}" ${pre.has(ch.id) ? 'checked' : ''}>
            ${avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'xs' })}<span>${ch.name}</span><small>${ch.npc ? `NPC · ${ch.ownerName}` : ch.ownerName}</small></label>`)}`
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
        eventId: ['event', 'comms'].includes(data.kind) && data.eventId ? Number(data.eventId) : null,
      };
      if (data.kind === 'comms') payload.icon = data.icon || null;
      if (!editing && data.characterId) payload.characterId = Number(data.characterId);
      const res = editing
        ? await api(`/api/channels/${c.id}`, { method: 'PUT', body: payload })
        : await api(`/api/stories/${target}/channels`, { method: 'POST', body: payload });
      return { storyId: target, channel: res.channel };
    },
  });
  if (!result) return null;
  if (result === 'deleted') {
    toast('Episode deleted');
    await loadStory(sid);
    location.hash = `#/s/${sid}`;
    return null;
  }
  await Promise.all([loadStory(result.storyId), refreshHome()]);
  toast(editing ? 'Episode updated' : 'Episode started');
  if (!editing) location.hash = `#/s/${result.storyId}/${result.channel.id}`;
  return result.channel;
}
