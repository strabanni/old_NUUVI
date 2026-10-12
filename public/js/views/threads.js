// The feed (every thread you can see, filterable by type) and the start/edit-a-thread form.
import { html, render, applyColors, api, $, $$, toast, avatar, icons, modal, uploadImage, askImageLink } from '../lib.js';
import { socialCard, bindSocial, openSocialComposer, styleBars } from './social.js';
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
const ROW = 2;
const fitBrick = (el) => {
  const gap = parseFloat(getComputedStyle(el).marginBottom) || 0;
  el.style.gridRowEnd = `span ${Math.max(1, Math.ceil((el.getBoundingClientRect().height + gap) / ROW))}`;
};
const bricks = new ResizeObserver((entries) => { for (const e of entries) fitBrick(e.target); });
export function masonry(root) {
  for (const el of root.querySelectorAll('.feed-grid > *')) { fitBrick(el); bricks.observe(el); }
}

const FILTERS = [['all', 'All'], ['open', 'Open threads'], ['para', 'Self paras'], ['social', 'Social'], ['event', 'Events']];

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
      <div class="feed-grid">${g.items.map((it) => (it.type === 'social' ? socialCard(it) : feedCard(it)))}</div>`)}`);
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

export async function openThreadForm({ storyId = null, channel = null, tag = [] } = {}) {
  document.body.classList.remove('drawer-open', 'members-open');
  const editing = !!channel;
  const sid = storyId ?? channel?.storyId;
  const myStories = state.home.stories;
  if (!sid && !myStories.length) return toast('Join or start a story first');
  const [characters, storyDetail] = await Promise.all([myCharacters(true), sid ? api(`/api/stories/${sid}`) : null]);
  const isOwner = storyDetail?.role === 'owner' || state.user.isAdmin;
  const kinds = [['thread', 'Thread'], ['para', 'Self para (solo writing)'], ['comms', 'Comms (texts)'], ...(isOwner || channel?.kind === 'event' ? [['event', 'Event']] : []), ...(isOwner || channel?.kind === 'ooc' ? [['ooc', 'OOC channel']] : [])];
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
      form.kind.addEventListener('change', () => {
        $('#t-event', d).hidden = form.kind.value !== 'event';
        $('#t-icon', d).hidden = form.kind.value !== 'comms';
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



// ---------- Events ----------
// Two layouts to choose between: date cards, or a month calendar.
export async function viewEvents() {
  const alive = routeAlive();
  const { items } = await api('/api/feed?filter=event');
  const events = items.filter((e) => e.eventAt).sort((a, b) => (a.eventAt < b.eventAt ? -1 : 1));
  const undated = items.filter((e) => !e.eventAt);
  let layout = sessionStorage.getItem('nuuvi:events-layout') || 'cards';
  let month = (() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); })();
  const body = page({
    alive,
    title: 'Events',
    subtitle: `${events.length} scheduled`,
    actions: html`<div class="seg" role="group" aria-label="Layout">
      <button data-layout="cards" aria-pressed="${layout === 'cards'}">Cards</button>
      <button data-layout="calendar" aria-pressed="${layout === 'calendar'}">Calendar</button></div>`,
    body: html`<div id="events-view"></div>`,
  });
  const view = $('#events-view', body);
  const card = (e) => {
    const d = new Date(e.eventAt);
    return html`
      <a class="event-card" href="#/s/${e.storyId}/${e.id}" data-color="${e.story.color}">
        <span class="ev-date"><small>${d.toLocaleDateString(undefined, { month: 'short' })}</small><b>${d.getDate()}</b></span>
        <span class="grow">
          <strong>${e.name}</strong>
          <small>${d.toLocaleDateString(undefined, { weekday: 'long' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${e.story.title}</small>
          ${e.summary ? html`<span class="ev-sum">${e.summary}</span>` : ''}
        </span>
        ${e.participants.length ? avatarStack(e.participants) : ''}
      </a>`;
  };
  function draw() {
    if (layout === 'cards') {
      const upcoming = events.filter((e) => new Date(e.eventAt) >= new Date(Date.now() - 864e5));
      const past = events.filter((e) => new Date(e.eventAt) < new Date(Date.now() - 864e5)).reverse();
      render(view, html`
        ${upcoming.length ? html`<h2 class="section-title">Upcoming</h2><div class="event-list">${upcoming.map(card)}</div>` : html`<div class="empty"><p>No upcoming events.</p><p class="small">Story owners can add one from a story's sidebar → New thread → Event.</p></div>`}
        ${past.length ? html`<h2 class="section-title">Past</h2><div class="event-list past">${past.map(card)}</div>` : ''}
        ${undated.length ? html`<h2 class="section-title">No date yet</h2><div class="feed-grid">${undated.map(feedCard)}</div>` : ''}`);
      masonry(view);
      return;
    }
    const first = new Date(month);
    const startDay = (first.getDay() + 6) % 7; // weeks start on Monday
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);
    const today = new Date();
    const onDay = (d) => events.filter((e) => { const x = new Date(e.eventAt); return x.getFullYear() === first.getFullYear() && x.getMonth() === first.getMonth() && x.getDate() === d; });
    render(view, html`
      <div class="cal-head">
        <button class="icon-btn" data-month="-1" aria-label="Previous month">${icons.back}</button>
        <h2>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button class="icon-btn flip" data-month="1" aria-label="Next month">${icons.back}</button>
      </div>
      <div class="calendar">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<span class="cal-dow">${d}</span>`)}
        ${cells.map((d) => (d === null ? html`<span class="cal-cell empty"></span>` : html`
          <div class="cal-cell ${today.getFullYear() === first.getFullYear() && today.getMonth() === first.getMonth() && today.getDate() === d ? 'today' : ''}">
            <span class="cal-num">${d}</span>
            ${onDay(d).map((e) => html`<a class="cal-ev" href="#/s/${e.storyId}/${e.id}" title="${e.name}">${new Date(e.eventAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ${e.name}</a>`)}
          </div>`))}
      </div>`);
  }
  const onClick = (e) => {
    const l = e.target.closest('[data-layout]');
    if (l) {
      layout = l.dataset.layout;
      try { sessionStorage.setItem('nuuvi:events-layout', layout); } catch { /* ignore */ }
      $$('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b === l)));
      draw();
    }
    const m = e.target.closest('[data-month]');
    if (m) { month = new Date(month.getFullYear(), month.getMonth() + Number(m.dataset.month), 1); draw(); }
  };
  $('#main .head-actions').addEventListener('click', onClick);
  view.addEventListener('click', onClick);
  draw();
}
