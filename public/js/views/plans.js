// Character plans on the calendar: appointments, fittings, surgeries, work shifts, dates, classes…
// Just for fun and for building out characters' lives (separate from story events). Plans can repeat,
// for things like work schedules. Shown on the Calendar page and Home's week.
import { html, api, $, toast, modal, confirmModal, avatar, applyColors, formatPost } from '../lib.js';
import { state, myCharacters } from '../main.js';

export const PLAN_KINDS = [
  ['appointment', '📅', 'Appointment'], ['doctor', '🩺', 'Doctor'], ['fitting', '🪡', 'Fitting'], ['surgery', '🏥', 'Surgery'],
  ['work', '💼', 'Work'], ['date', '💕', 'Date'], ['class', '🎓', 'Class'], ['trip', '✈️', 'Trip'], ['party', '🎉', 'Party'], ['other', '📌', 'Other'],
];
const REPEATS = [['none', "Doesn't repeat"], ['daily', 'Every day'], ['weekdays', 'Every weekday (Mon–Fri)'], ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'], ['monthly', 'Every month']];
export const kindIcon = (k) => (PLAN_KINDS.find((x) => x[0] === k) || PLAN_KINDS.at(-1))[1];
const kindLabel = (k) => (PLAN_KINDS.find((x) => x[0] === k) || PLAN_KINDS.at(-1))[2];

const dayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const DAY = 86400000;
// Does this plan happen on `day` (a local date)? Repeating plans count every time they come round.
export function planOn(p, day) {
  const d = dayOf(day);
  const start = dayOf(p.startsAt);
  const end = dayOf(p.endsAt || p.startsAt);
  if (d < start) return false;
  if (p.repeatUntil && d > dayOf(p.repeatUntil)) return false;
  const days = Math.round((d - start) / DAY);
  switch (p.repeat) {
    case 'daily': return true;
    case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
    case 'weekly': return days % 7 === 0;
    case 'biweekly': return days % 14 === 0;
    case 'monthly': return d.getDate() === start.getDate();
    default: return d <= end;
  }
}
export const plansOn = (plans, day) => plans.filter((p) => planOn(p, day))
  .sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || new Date(a.startsAt).toTimeString().localeCompare(new Date(b.startsAt).toTimeString()));
export const planTime = (p) => (p.allDay ? 'All day' : new Date(p.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  + (p.endsAt && dayOf(p.endsAt).getTime() === dayOf(p.startsAt).getTime() ? `–${new Date(p.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''));
export const whoOf = (p) => (p.character ? p.character.name : p.owner.displayName);
export const loadPlans = () => api('/api/plans').then((r) => r.plans).catch(() => []);

const pad = (n) => String(n).padStart(2, '0');
const localDT = (iso) => { if (!iso) return ''; const t = new Date(iso); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`; };
const localD = (iso) => localDT(iso).slice(0, 10);

// Add or change a plan. Resolves with the saved plan, 'deleted', or nothing.
export async function openPlanForm({ plan = null, date = null } = {}) {
  const mine = await myCharacters(true);
  const p = plan || {};
  const startDefault = (() => { const d = date ? new Date(date) : new Date(); if (!plan) d.setHours(date ? 12 : d.getHours() + 1, 0, 0, 0); return d.toISOString(); })();
  return modal(html`
    <form class="plan-form">
      <span class="eyebrow">${plan ? 'Edit plan' : 'New plan'}</span>
      <h2>${plan ? p.title : 'Put it on the calendar'}</h2>
      <p class="hint">Appointments, fittings, work shifts, dates… just for fun, to build out your characters' lives.</p>
      <div class="row">
        <div><label for="pl-who">Whose plan</label>
          <select id="pl-who" name="characterId"><option value="">Just me (no character)</option>
            ${mine.map((c) => html`<option value="${c.id}" ${(p.character?.id ?? mine[0]?.id) === c.id ? 'selected' : ''}>${c.name}</option>`)}</select></div>
        <div><label for="pl-kind">Kind</label>
          <select id="pl-kind" name="kind">${PLAN_KINDS.map(([k, icon, label]) => html`<option value="${k}" ${(p.kind || 'appointment') === k ? 'selected' : ''}>${icon} ${label}</option>`)}</select></div>
      </div>
      <label for="pl-title">What</label>
      <input id="pl-title" name="title" required maxlength="120" value="${p.title || ''}" placeholder="Dress fitting at Maison Vey">
      <label class="check-row"><input type="checkbox" name="allDay" id="pl-allday" ${p.allDay ? 'checked' : ''}><span>All day</span></label>
      <div class="row">
        <div><label for="pl-start">Starts</label>
          <input id="pl-start" name="startsAt" type="${p.allDay ? 'date' : 'datetime-local'}" required value="${p.allDay ? localD(p.startsAt || startDefault) : localDT(p.startsAt || startDefault)}"></div>
        <div><label for="pl-end">Ends <span class="muted small">(optional)</span></label>
          <input id="pl-end" name="endsAt" type="${p.allDay ? 'date' : 'datetime-local'}" value="${p.allDay ? localD(p.endsAt) : localDT(p.endsAt)}"></div>
      </div>
      <div class="row">
        <div><label for="pl-repeat">Repeats</label>
          <select id="pl-repeat" name="repeat">${REPEATS.map(([k, label]) => html`<option value="${k}" ${(p.repeat || 'none') === k ? 'selected' : ''}>${label}</option>`)}</select></div>
        <div id="pl-until-box" ${(p.repeat || 'none') === 'none' ? 'hidden' : ''}><label for="pl-until">Until <span class="muted small">(optional)</span></label>
          <input id="pl-until" name="repeatUntil" type="date" value="${localD(p.repeatUntil)}"></div>
      </div>
      <label for="pl-where">Where <span class="muted small">(optional)</span></label>
      <input id="pl-where" name="location" maxlength="200" list="pl-where-list" value="${p.location || ''}" placeholder="Ardell General, Montclair Harbor" autocomplete="off">
      <datalist id="pl-where-list"></datalist>
      <label for="pl-notes">Notes <span class="muted small">(optional)</span></label>
      <textarea id="pl-notes" name="notes" rows="3" maxlength="3000" placeholder="Bring the blue suit. Don't tell Mina.">${p.notes || ''}</textarea>
      <label class="check-row"><input type="checkbox" name="private" ${p.private ? 'checked' : ''}><span>Only me <small class="muted">(other writers won't see this plan)</small></span></label>
      <div class="error"></div>
      <div class="actions end">
        ${plan ? html`<button type="button" class="danger" id="pl-delete">Delete</button><span class="spacer"></span>` : ''}
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">${plan ? 'Save' : 'Add to calendar'}</button>
      </div>
    </form>`, {
    init: (d, close) => {
      const form = d.querySelector('form');
      // All day switches the time boxes to date boxes (keeping the dates).
      $('#pl-allday', d).addEventListener('change', (e) => {
        for (const el of [form.startsAt, form.endsAt]) {
          const v = el.value;
          el.type = e.target.checked ? 'date' : 'datetime-local';
          el.value = v ? (e.target.checked ? v.slice(0, 10) : `${v.slice(0, 10)}T${v.slice(11, 16) || '12:00'}`) : '';
        }
      });
      $('#pl-repeat', d).addEventListener('change', (e) => { $('#pl-until-box', d).hidden = e.target.value === 'none'; });
      import('./threads.js').then(({ fillLocations }) => fillLocations?.($('#pl-where-list', d))).catch(() => {});
      $('#pl-delete', d)?.addEventListener('click', async () => {
        if (!(await confirmModal(`Delete “${p.title}”${p.repeat !== 'none' ? ' (every time it repeats)' : ''}?`, { ok: 'Delete', danger: true }))) return;
        try { await api(`/api/plans/${p.id}`, { method: 'DELETE' }); close('deleted'); } catch (err) { toast(err.message); }
      });
    },
    submit: async (data) => {
      const allDay = data.allDay === 'on';
      const at = (v, endOfDay = false) => (v ? new Date(allDay ? `${v.slice(0, 10)}T${endOfDay ? '23:59' : '00:00'}` : v).toISOString() : null);
      const body = {
        characterId: data.characterId ? Number(data.characterId) : null, kind: data.kind, title: data.title, allDay,
        startsAt: at(data.startsAt), endsAt: at(data.endsAt, true), repeat: data.repeat,
        repeatUntil: data.repeatUntil ? new Date(`${data.repeatUntil}T23:59`).toISOString() : null,
        location: data.location || '', notes: data.notes || '', private: data.private === 'on',
      };
      const res = plan ? await api(`/api/plans/${p.id}`, { method: 'PUT', body }) : await api('/api/plans', { method: 'POST', body });
      toast(plan ? 'Plan saved' : 'Added to the calendar');
      return res.plan;
    },
  });
}

// A plan, opened from the calendar. Its writer can edit or delete it. Resolves true if it changed.
export async function showPlan(p) {
  const mineToo = p.userId === state.user.id;
  const res = await modal(html`
    <div class="plan-view" data-color="${p.character?.color || '#EE719E'}">
      <span class="eyebrow">${kindIcon(p.kind)} ${kindLabel(p.kind)}${p.private ? ' · only you' : ''}</span>
      <h2>${p.title}</h2>
      <p class="plan-when"><b>${new Date(p.startsAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</b> · ${planTime(p)}
        ${p.repeat !== 'none' ? html`<br><small class="muted">↻ ${REPEATS.find((r) => r[0] === p.repeat)?.[1]}${p.repeatUntil ? ` until ${new Date(p.repeatUntil).toLocaleDateString()}` : ''}</small>` : ''}</p>
      ${p.location ? html`<p class="muted">📍 ${p.location}</p>` : ''}
      ${p.character ? html`<a class="plan-who" href="#/c/${p.character.id}" data-close>${avatar({ name: p.character.name, src: p.character.avatar, color: p.character.color, size: 'sm' })}<span>${p.character.name}</span></a>`
        : html`<p class="muted small">${p.owner.displayName}'s plan</p>`}
      ${p.notes ? html`<div class="body plan-notes">${formatPost(p.notes)}</div>` : ''}
      <div class="actions end">${mineToo ? html`<button type="button" id="plan-edit">Edit</button>` : ''}<button type="button" class="primary" data-close>Close</button></div>
    </div>`, {
    init: (d, close) => {
      applyColors(d);
      $('#plan-edit', d)?.addEventListener('click', async () => { close(null); if (await openPlanForm({ plan: p })) document.dispatchEvent(new CustomEvent('nuuvi:plans')); });
    },
  });
  return res;
}
