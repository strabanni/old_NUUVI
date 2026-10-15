// Calendar events: the events page (cards or a month calendar), the new/edit event form,
// and an event's own page listing every thread and comms that's part of it.
import { html, render, api, $, $$, toast, icons, modal, confirmModal, uploadImage, askImageLink, applyColors, menu, avatar } from '../lib.js';
import { loadPlans, plansOn, planTime, kindIcon, whoOf, openPlanForm, showPlan } from './plans.js';
import { state, page, routeAlive, ensureAlive, loadStory } from '../main.js';
import { feedCard, masonry, avatarStack, openThreadForm } from './threads.js';

const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const whenText = (e) => {
  const s = new Date(e.startsAt);
  const end = e.endsAt ? new Date(e.endsAt) : null;
  if (!end) return `${fmtDay(s)} · ${fmtTime(s)}`;
  return s.toDateString() === end.toDateString() ? `${fmtDay(s)} · ${fmtTime(s)} – ${fmtTime(end)}` : `${fmtDay(s)} ${fmtTime(s)} – ${fmtDay(end)} ${fmtTime(end)}`;
};
const ongoing = (e) => new Date(e.endsAt || e.startsAt) >= new Date(Date.now() - 864e5);
const localInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// The event as a card in the feed.
export function eventFeedCard(e) {
  const d = new Date(e.startsAt);
  return html`
    <a class="feed-card kind-event" href="#/e/${e.id}" data-color="${e.story.color}">
      <div class="fc-media">
        ${e.banner || e.story.banner ? html`<img src="${e.banner || e.story.banner}" alt="" loading="lazy">` : ''}
        <div class="fc-chips">
          <span class="chip">${d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          <span class="chip icon" title="Event">${icons.calendar}</span>
        </div>
        <h3>${e.title}</h3>
      </div>
      <div class="fc-body">
        ${e.summary ? html`<p class="fc-summary">${e.summary}</p>` : ''}
        <div class="fc-foot">
          ${e.participants.length ? avatarStack(e.participants) : ''}
          <span class="fc-where">${e.location ? `${e.location} · ` : ''}${e.story.title} · ${e.threadCount} ${e.threadCount === 1 ? 'episode' : 'episodes'}</span>
        </div>
      </div>
    </a>`;
}

// New / edit event. Returns the saved event (or 'deleted').
export async function openEventForm({ event = null, storyId = null } = {}) {
  const stories = state.home.stories;
  if (!event && !stories.length) { toast('Join or start a story first'); return null; }
  const e = event || {};
  return modal(html`
    <form class="event-form">
      <h2>${event ? 'Edit event' : 'New event'}</h2>
      ${event ? '' : html`<label for="ev-story">Story</label>
        <select id="ev-story" name="storyId">${stories.map((s) => html`<option value="${s.id}" ${s.id === storyId ? 'selected' : ''}>${s.title}</option>`)}</select>`}
      <label for="ev-title">Title</label>
      <input id="ev-title" name="title" required maxlength="120" value="${e.title || ''}" placeholder="Trinity Foundation Gala">
      <div class="row">
        <div><label for="ev-start">Starts</label><input id="ev-start" type="datetime-local" name="startsAt" required value="${localInput(e.startsAt)}"></div>
        <div><label for="ev-end">Ends <span class="muted small">(optional)</span></label><input id="ev-end" type="datetime-local" name="endsAt" value="${localInput(e.endsAt)}"></div>
      </div>
      <label for="ev-where">Where</label>
      <input id="ev-where" name="location" maxlength="200" value="${e.location || ''}" placeholder="The Plaza, 5th Ave">
      <label for="ev-sum">Details</label>
      <textarea id="ev-sum" name="summary" rows="5" maxlength="5000" placeholder="Dress code, who's invited, what's at stake…">${e.summary || ''}</textarea>
      <label>Banner <span class="muted small">(optional)</span></label>
      <span class="row-inline"><label class="btn sm file-btn">Upload<input type="file" accept="image/*" id="ev-banner-file" hidden></label>
        <button type="button" class="sm link-btn" id="ev-banner-link">Link</button><span class="hint" id="ev-banner-state">${e.banner ? 'Banner set ✓' : ''}</span></span>
      <input type="hidden" name="banner" value="${e.banner || ''}">
      <div class="error"></div>
      <div class="actions end">
        ${event ? html`<button type="button" class="danger" id="ev-delete">Delete</button><span class="spacer"></span>` : ''}
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">${event ? 'Save' : 'Add to calendar'}</button>
      </div>
    </form>`, {
    init: (d, close) => {
      const form = d.querySelector('form');
      const setBanner = (url) => { form.banner.value = url; $('#ev-banner-state', d).textContent = 'Banner set ✓'; };
      $('#ev-banner-file', d).addEventListener('change', async (ev) => {
        const f = ev.target.files[0];
        if (f) try { setBanner(await uploadImage(f, 1600)); } catch (err) { toast(err.message); }
      });
      $('#ev-banner-link', d).addEventListener('click', async () => { const url = await askImageLink(); if (url) setBanner(url); });
      $('#ev-delete', d)?.addEventListener('click', async () => {
        if (!(await confirmModal(`Delete “${e.title}”? Its episodes stay, they just won't be part of an event anymore.`, { ok: 'Delete', danger: true }))) return;
        try { await api(`/api/calendar/${e.id}`, { method: 'DELETE' }); close('deleted'); } catch (err) { toast(err.message); }
      });
    },
    submit: async (data) => {
      const body = {
        title: data.title, location: data.location, summary: data.summary, banner: data.banner || null,
        startsAt: data.startsAt ? new Date(data.startsAt).toISOString() : null,
        endsAt: data.endsAt ? new Date(data.endsAt).toISOString() : null,
      };
      const res = event
        ? await api(`/api/calendar/${e.id}`, { method: 'PUT', body })
        : await api(`/api/stories/${data.storyId}/calendar`, { method: 'POST', body });
      return res.event;
    },
  });
}

// Events page: cards or a month calendar. Tapping an event opens its page.
export async function viewEvents() {
  const alive = routeAlive();
  const [{ events }, { birthdays }, plansAll] = await Promise.all([api('/api/calendar'), api('/api/birthdays').catch(() => ({ birthdays: [] })), loadPlans()]);
  let plans = plansAll;
  ensureAlive(alive);
  let layout = sessionStorage.getItem('nuuvi:events-layout') || 'cards';
  let month = (() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); })();
  const body = page({
    alive,
    title: 'Events',
    banner: 'Coming up in your stories',
    subtitle: `${events.filter(ongoing).length} coming up`,
    actions: html`<div class="seg" role="group" aria-label="Layout">
      <button data-layout="cards" aria-pressed="${layout === 'cards'}">Cards</button>
      <button data-layout="calendar" aria-pressed="${layout === 'calendar'}">Calendar</button></div>
      <button id="new-plan" title="Appointments, work shifts, dates… for your characters">${icons.calendar}<span class="lbl">New plan</span></button>
      <button class="primary" id="new-event">${icons.plus}<span class="lbl">New event</span></button>`,
    body: html`<div id="events-view"></div>`,
  });
  const view = $('#events-view', body);
  const card = (e) => {
    const d = new Date(e.startsAt);
    return html`
      <a class="event-card" href="#/e/${e.id}" data-color="${e.story.color}">
        <span class="ev-date"><small>${d.toLocaleDateString(undefined, { month: 'short' })}</small><b>${d.getDate()}</b></span>
        <span class="grow">
          <strong>${e.title}</strong>
          <small>${whenText(e)}${e.location ? ` · ${e.location}` : ''} · ${e.story.title}</small>
          ${e.summary ? html`<span class="ev-sum">${e.summary}</span>` : ''}
          <small class="ev-count">${e.threadCount} ${e.threadCount === 1 ? 'episode' : 'episodes'}</small>
        </span>
        ${e.participants.length ? avatarStack(e.participants) : ''}
      </a>`;
  };
  // Character plans in the next two weeks, day by day (repeating ones each time they come round).
  const planWeeks = () => {
    const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; })
      .map((d) => [d, plansOn(plans, d)]).filter(([, l]) => l.length);
    return html`<h2 class="section-title">Character plans <small class="muted">next 2 weeks</small></h2>
      ${days.length ? html`<div class="plan-days">${days.map(([d, list]) => html`
        <div class="plan-day"><span class="plan-day-date"><small>${d.toLocaleDateString(undefined, { weekday: 'short' })}</small><b>${d.getDate()}</b></span>
          <div class="grow">${list.map(planRow)}</div></div>`)}</div>`
        : html`<div class="empty small"><p>No plans yet. <button class="link" id="empty-plan">Add an appointment, shift or date</button></p></div>`}`;
  };
  const planRow = (p) => html`<button type="button" class="plan-row" data-plan="${p.id}" data-color="${p.character?.color || '#EE719E'}">
    <span class="plan-ico">${kindIcon(p.kind)}</span><span class="grow"><b>${p.title}</b><small>${planTime(p)} · ${whoOf(p)}${p.location ? ` · ${p.location}` : ''}</small></span>
    ${p.character ? avatar({ name: p.character.name, src: p.character.avatar, color: p.character.color, size: 'xs' }) : ''}</button>`;
  function draw() {
    if (layout === 'cards') {
      const upcoming = events.filter(ongoing);
      const past = events.filter((e) => !ongoing(e)).reverse();
      render(view, html`
        ${upcoming.length ? html`<h2 class="section-title">Upcoming</h2><div class="event-list">${upcoming.map(card)}</div>`
          : html`<div class="empty"><p>No upcoming events.</p><p><button class="primary" id="empty-new">Add one</button></p></div>`}
        ${planWeeks()}
        ${past.length ? html`<h2 class="section-title">Past</h2><div class="event-list past">${past.map(card)}</div>` : ''}`);
      applyColors(view);
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
    // An event shows on every day it runs.
    const onDay = (d) => events.filter((e) => {
      const day = new Date(first.getFullYear(), first.getMonth(), d);
      const s = new Date(e.startsAt); s.setHours(0, 0, 0, 0);
      const end = new Date(e.endsAt || e.startsAt); end.setHours(0, 0, 0, 0);
      return day >= s && day <= end;
    });
    render(view, html`
      <div class="cal-head">
        <button class="icon-btn" data-month="-1" aria-label="Previous month">${icons.back}</button>
        <h2>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
        <button class="icon-btn flip" data-month="1" aria-label="Next month">${icons.back}</button>
      </div>
      <div class="calendar">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<span class="cal-dow">${d}</span>`)}
        ${cells.map((d) => (d === null ? html`<span class="cal-cell empty"></span>` : html`
          <div class="cal-cell ${today.getFullYear() === first.getFullYear() && today.getMonth() === first.getMonth() && today.getDate() === d ? 'today' : ''}" data-day="${d}">
            <span class="cal-num">${d}</span>
            ${birthdays.filter((b) => b.month === first.getMonth() + 1 && b.day === d).map((b) => html`<a class="cal-ev cal-bday" href="#/c/${b.id}" title="${b.name}'s birthday">🎂 ${b.name}</a>`)}
            ${onDay(d).map((e) => html`<a class="cal-ev" href="#/e/${e.id}" title="${e.title}">${fmtTime(new Date(e.startsAt))} ${e.title}</a>`)}
            ${plansOn(plans, new Date(first.getFullYear(), first.getMonth(), d)).map((p) => html`<button type="button" class="cal-ev cal-plan" data-plan="${p.id}" data-color="${p.character?.color || '#EE719E'}" title="${whoOf(p)}: ${p.title}">${kindIcon(p.kind)} ${p.title}</button>`)}
          </div>`))}
      </div>
      <p class="hint">Tap an empty spot on a day to add an event or a character plan then.</p>`);
    applyColors(view);
  }
  const create = async () => {
    const made = await openEventForm({ storyId: state.route.storyId });
    if (made && made !== 'deleted') { toast('Added to the calendar'); location.hash = `#/e/${made.id}`; }
  };
  const onClick = async (e) => {
    const l = e.target.closest('[data-layout]');
    if (l) {
      layout = l.dataset.layout;
      try { sessionStorage.setItem('nuuvi:events-layout', layout); } catch { /* ignore */ }
      $$('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b === l)));
      draw();
      return;
    }
    const m = e.target.closest('[data-month]');
    if (m) { month = new Date(month.getFullYear(), month.getMonth() + Number(m.dataset.month), 1); draw(); return; }
    if (e.target.closest('#new-event, #empty-new')) { create(); return; }
    if (e.target.closest('#new-plan, #empty-plan')) { if (await openPlanForm()) refreshPlans(); return; }
    const pl = e.target.closest('[data-plan]');
    if (pl) { const p = plans.find((x) => x.id === Number(pl.dataset.plan)); if (p) showPlan(p); return; }
    const cell = e.target.closest('.cal-cell[data-day]');
    if (cell && !e.target.closest('a')) {
      const date = new Date(month.getFullYear(), month.getMonth(), Number(cell.dataset.day));
      menu(cell, [
        { label: 'New event', action: create },
        { label: 'Character plan', action: async () => { if (await openPlanForm({ date })) refreshPlans(); } },
      ]);
    }
  };
  const refreshPlans = async () => {
    if (!alive()) { document.removeEventListener('nuuvi:plans', refreshPlans); return; }
    plans = await loadPlans(); draw();
  };
  document.addEventListener('nuuvi:plans', refreshPlans);
  $('#main .head-actions').addEventListener('click', onClick);
  view.addEventListener('click', onClick);
  draw();
}

// One event: banner, when/where, details, and every thread that's part of it.
export async function viewEvent(idStr) {
  const alive = routeAlive();
  const { event: e, threads, canEdit, canAddThreads } = await api(`/api/calendar/${idStr}`);
  ensureAlive(alive);
  const body = page({
    alive,
    title: e.title,
    subtitle: e.story.title,
    actions: html`${canEdit ? html`<button class="icon-btn" id="ev-edit" title="Edit event" aria-label="Edit event">${icons.gear}</button>` : ''}`,
    body: html`
      <article class="event-page" data-color="${e.story.color}">
        <div class="ev-hero">${e.banner || e.story.banner ? html`<img src="${e.banner || e.story.banner}" alt="">` : ''}
          <div class="ev-hero-text"><h1>${e.title}</h1><p class="ev-sub">Event in ${e.story.title}</p></div></div>
        <div class="ev-facts">
          <div class="info"><span class="eyebrow">When</span><div>${whenText(e)}</div></div>
          ${e.location ? html`<div class="info"><span class="eyebrow">Where</span><div>${e.location}</div></div>` : ''}
          <div class="info"><span class="eyebrow">Episodes</span><div>${threads.length}</div></div>
        </div>
        ${e.summary ? html`<div class="card ev-summary">${e.summary}</div>` : ''}
        <div class="section-title ev-threads-head"><span>Episodes at this event</span>
          ${canAddThreads ? html`<button class="primary sm" id="ev-thread">${icons.plus} Start an episode here</button>` : ''}</div>
        ${threads.length ? html`<div class="feed-grid">${threads.map(feedCard)}</div>`
          : html`<div class="empty"><p>No episodes yet.</p></div>`}
      </article>`,
  });
  applyColors(body);
  masonry(body);
  $('#main #ev-edit')?.addEventListener('click', async () => {
    const res = await openEventForm({ event: e });
    if (res === 'deleted') { toast('Event deleted'); location.hash = '#/events'; } else if (res) viewEvent(idStr);
  });
  $('#ev-thread', body)?.addEventListener('click', async () => {
    await loadStory(e.storyId).catch(() => {});
    openThreadForm({ storyId: e.storyId, eventId: e.id, kind: 'event' });
  });
}
