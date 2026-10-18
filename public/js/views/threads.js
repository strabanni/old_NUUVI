// The feed (every thread you can see, filterable by type) and the start/edit-a-thread form.
import {
  html,
  render,
  applyColors,
  api,
  $,
  $$,
  toast,
  avatar,
  icons,
  modal,
  uploadImage,
  askImageLink,
  attachSheet,
} from '../lib.js';
import { state, page, loadStory, refreshHome, myCharacters, routeAlive, KIND_LABELS, kindIcon, channelIcon } from '../main.js';

const STATUS_LABELS = { open: 'Open', closed: 'Private', complete: 'Complete' };
export const statusPill = (c) =>
  c.kind === 'ooc' ? '' : html`<span class="pill-tag status-${c.status}">${STATUS_LABELS[c.status]}</span>`;

const parseDate = (d) => new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z');
const shortDate = (d) => parseDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function avatarStack(chars, max = 4) {
  return html`<span class="avatar-stack">${chars.slice(0, max).map((c) => avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' }))}${chars.length > max ? html`<span class="more">+${chars.length - max}</span>` : ''}</span>`;
}

export function feedCard(item) {
  const pic = item.banner || item.story.banner || item.starter?.portrait || item.starter?.avatar;
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
const bricks = new ResizeObserver((entries) => {
  for (const e of entries) fitBrick(e.target);
});
export function masonry(root) {
  for (const el of root.querySelectorAll('.feed-grid > *')) {
    fitBrick(el);
    bricks.observe(el);
  }
}

// Start a new thread, or edit one (pass `channel`). If no story is given, the form asks which.
// Quick picks for a comms thread's icon (texts, DMs, socials, work chat…).
const COMMS_EMOJI = ['💬', '📱', '💌', '📸', '🐦', '🎮', '💼', '🖤', '🩷', '✨', '🔒', '📞'];

// Places already used anywhere on NUUVI (episodes, posts, social posts), as suggestions for a
// location field; writers can always type a new one.
let locationCache = null;
export async function fillLocations(list) {
  if (!list) return;
  locationCache ??= api('/api/locations')
    .then((r) => r.locations)
    .catch(() => []);
  render(list, html`${(await locationCache).map((l) => html`<option value="${l}"></option>`)}`);
}
export const forgetLocations = () => {
  locationCache = null;
};

// Ask for a place: pick one already used on NUUVI, or type a new one. Resolves to the text ('' clears it), or null if cancelled.
export async function askLocation(current = '', title = 'Where is this?') {
  const res = await modal(
    html`<form>
    <h2>${title}</h2>
    <label for="ask-loc">Location</label>
    <input id="ask-loc" name="location" maxlength="100" list="ask-loc-list" value="${current}" placeholder="Pick or type a place" autocomplete="off">
    <datalist id="ask-loc-list"></datalist>
    <div class="actions end">${current ? html`<button type="button" id="ask-loc-clear">Remove</button>` : ''}<button type="button" data-close>Cancel</button><button type="submit" class="primary">Done</button></div>
  </form>`,
    {
      init: (d, close) => {
        fillLocations($('#ask-loc-list', d));
        $('#ask-loc', d).focus();
        $('#ask-loc-clear', d)?.addEventListener('click', () => close({ location: '' }));
      },
    },
  );
  if (!res) return null;
  forgetLocations();
  return String(res.location || '').trim();
}

export async function openThreadForm({ storyId = null, channel = null, tag = [], eventId = null, kind: startKind = null } = {}) {
  document.body.classList.remove('drawer-open', 'members-open');
  const editing = !!channel;
  const sid = storyId ?? channel?.storyId;
  const myStories = state.home.stories;
  if (!sid && !myStories.length) return toast('Join or start a story first');
  const [characters, storyDetail] = await Promise.all([myCharacters(true), sid ? api(`/api/stories/${sid}`) : null]);
  // Texts live in the Phone now, and out-of-character talk in Messages: no new comms or OOC channels
  // (older ones can still be edited).
  const kinds = [
    ['thread', 'Episode'],
    ['para', 'Self para (solo writing)'],
    ['event', 'Event'],
    ...(channel?.kind === 'comms' ? [['comms', 'Comms (texts)']] : []),
    ...(channel?.kind === 'ooc' ? [['ooc', 'OOC channel']] : []),
  ];
  const c = channel || { kind: startKind || 'thread', eventId };

  const result = await modal(
    html`
    <form class="thread-form">
      <h2>${editing ? 'Edit episode' : 'New episode'}</h2>
      ${
        !sid
          ? html`<label for="t-story">Story</label>
        <select id="t-story" name="storyId">${myStories.map((s) => html`<option value="${s.id}">${s.title}</option>`)}</select>`
          : ''
      }
      <label for="t-name">Title</label>
      <input id="t-name" name="name" required maxlength="80" value="${c.name || ''}" placeholder="childhood friends reunited">
      <div class="row">
        <div><label for="t-kind">Type</label><select id="t-kind" name="kind">${kinds.map(([v, l]) => html`<option value="${v}" ${(c.kind || 'thread') === v ? 'selected' : ''}>${l}</option>`)}</select></div>
        <div><label for="t-status">Who can write</label><select id="t-status" name="status">
          <option value="open" ${(c.status || 'open') === 'open' ? 'selected' : ''}>Open: anyone in the story</option>
          <option value="closed" ${c.status === 'closed' ? 'selected' : ''}>Private: tagged characters only</option>
          ${editing ? html`<option value="complete" ${c.status === 'complete' ? 'selected' : ''}>Complete: read only</option>` : ''}
        </select></div>
      </div>
      <label>Episode picture <span class="muted small">(shows at the top of the episode and on THE NU, best 1600 × 900)</span></label>
      <div class="t-banner" id="t-banner">${c.banner ? html`<img src="${c.banner}" alt="">` : html`<span>${icons.image} Add a picture</span>`}</div>
      <input type="hidden" name="banner" value="${c.banner || ''}">
      <div class="row">
        <div><label for="t-season">Season <span class="muted small">(optional)</span></label>
          <input id="t-season" name="season" type="number" min="1" max="99" inputmode="numeric" value="${c.season || ''}" placeholder="1"></div>
        <div><label for="t-loc">Location</label>
          <input id="t-loc" name="location" maxlength="100" list="nuuvi-locations" value="${c.location || ''}" placeholder="Pick or type a place"></div>
      </div>
      <datalist id="nuuvi-locations"></datalist>
      <div id="t-icon" ${(c.kind || 'thread') === 'comms' ? '' : 'hidden'}>
        <label>Icon <span class="muted small">(which app is this? Pick an emoji or use a picture)</span></label>
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
      ${
        !editing && characters.length
          ? html`
        <label for="t-char">Starring</label>
        <select id="t-char" name="characterId"><option value="">Nobody yet</option>${characters.map((ch) => html`<option value="${ch.id}">${ch.name}</option>`)}</select>`
          : ''
      }
      <label>Tag characters</label>
      <div id="t-tagged" class="tag-picker"><span class="muted small">${sid ? 'Loading…' : 'Pick a story first'}</span></div>
      <label for="t-summary">Plot / summary <span class="muted small">(shown at the top of the thread)</span></label>
      <textarea id="t-summary" name="summary" maxlength="3000" rows="4" placeholder="Where are they, what just happened, what's at stake?">${c.summary || ''}</textarea>
      <label for="t-tags">Tags</label>
      <input id="t-tags" name="tags" maxlength="400" value="${(c.tags || []).join(', ')}" placeholder="angst, reunion, slow burn">
      <div class="error"></div>
      <div class="actions end">
        ${editing ? html`<button type="button" class="danger" id="t-delete">Delete</button><span class="spacer"></span>` : ''}
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">${editing ? 'Save' : 'Start episode'}</button>
      </div>
    </form>`,
    {
      init: (d, close) => {
        const form = d.querySelector('form');
        // Event threads pick one of the story's ongoing events; comms can optionally be part of one.
        const evSelect = $('#t-ev', d);
        const loadEvents = async (sidNow, keep = c.eventId) => {
          if (!sidNow) return render(evSelect, html`<option value="">Pick a story first</option>`);
          const { events } = await api(`/api/calendar?story=${sidNow}`).catch(() => ({ events: [] }));
          const live = events.filter((e) => e.id === keep || new Date(e.endsAt || e.startsAt) >= new Date(Date.now() - 864e5));
          render(
            evSelect,
            html`<option value="">${form.kind.value === 'event' ? 'Choose an event…' : 'Not part of an event'}</option>
          ${live.map((e) => html`<option value="${e.id}" ${e.id === keep ? 'selected' : ''}>${e.title} · ${new Date(e.startsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</option>`)}`,
          );
          if (!live.length && form.kind.value === 'event') $('#t-ev-note', d).textContent = 'No upcoming events yet. Add one';
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
          if (pick) {
            $('#t-icon-text', d).value = pick.dataset.emoji;
            setIcon(pick.dataset.emoji);
          }
          if (e.target.closest('#t-icon-clear')) {
            $('#t-icon-text', d).value = '';
            setIcon('');
          }
          if (e.target.closest('#t-icon-link')) {
            const url = await askImageLink();
            if (url) setIcon(url);
          }
        });
        $('#t-icon-text', d).addEventListener('input', (e) => setIcon(e.target.value.trim()));
        $('#t-icon-file', d).addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            setIcon(await uploadImage(file, 256, { square: true }));
          } catch (err) {
            toast(err.message);
          }
        });
        // Episode picture (tap to change; long-press-free so it works the same on phones).
        const drawBanner = () =>
          render(
            $('#t-banner', d),
            form.banner.value
              ? html`<img src="${form.banner.value}" alt=""><button type="button" class="t-banner-x" aria-label="Remove picture">✕</button>`
              : html`<span>${icons.image} Add a picture</span>`,
          );
        drawBanner();
        $('#t-banner', d).addEventListener('click', (e) => {
          if (e.target.closest('.t-banner-x')) {
            form.banner.value = '';
            return drawBanner();
          }
          attachSheet({
            max: 1,
            onPictures: ([u]) => {
              form.banner.value = u;
              drawBanner();
            },
          });
        });
        fillLocations($('#nuuvi-locations', d));
        const picker = $('#t-tagged', d);
        const loadTaggable = async (id) => {
          const { characters: all } = await api(`/api/stories/${id}/characters`).catch(() => ({ characters: [] }));
          const pre = new Set([...(channel?.participantIds || []), ...tag]);
          render(
            picker,
            all.length
              ? html`${all.map(
                  (ch) => html`
          <label class="tag-option"><input type="checkbox" value="${ch.id}" ${pre.has(ch.id) ? 'checked' : ''}>
            ${avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'xs' })}<span>${ch.name}</span><small>${ch.npc ? `NPC · ${ch.ownerName}` : ch.ownerName}</small></label>`,
                )}`
              : html`<span class="muted small">No characters in this story yet.</span>`,
          );
        };
        if (sid) loadTaggable(sid);
        form.storyId?.addEventListener('change', () => loadTaggable(form.storyId.value));
        if (form.storyId) loadTaggable(form.storyId.value);
        $('#t-delete', d)?.addEventListener('click', async () => {
          if (!confirm(`Delete "${c.name}" and every post in it?`)) return;
          try {
            await api(`/api/channels/${c.id}`, { method: 'DELETE' });
            close('deleted');
          } catch (err) {
            toast(err.message);
          }
        });
      },
      submit: async (data) => {
        const form = document.querySelector('dialog .thread-form');
        const tagged = $$('#t-tagged input:checked', form).map((i) => Number(i.value));
        // Characters who were in the cast and got unticked: they're taken out of the episode.
        const untagged = editing
          ? $$('#t-tagged input:not(:checked)', form)
              .map((i) => Number(i.value))
              .filter((cid) => (channel?.participantIds || []).includes(cid))
          : [];
        const target = Number(data.storyId || sid);
        const payload = {
          name: data.name,
          kind: data.kind,
          status: data.status,
          summary: data.summary,
          tags: data.tags,
          tagged,
          untagged,
          eventId: ['event', 'comms'].includes(data.kind) && data.eventId ? Number(data.eventId) : null,
          banner: data.banner || null,
          season: data.season ? Number(data.season) : null,
          location: data.location || '',
        };
        if (data.kind === 'comms') payload.icon = data.icon || null;
        if (!editing && data.characterId) payload.characterId = Number(data.characterId);
        const res = editing
          ? await api(`/api/channels/${c.id}`, { method: 'PUT', body: payload })
          : await api(`/api/stories/${target}/channels`, { method: 'POST', body: payload });
        return { storyId: target, channel: res.channel };
      },
    },
  );
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
