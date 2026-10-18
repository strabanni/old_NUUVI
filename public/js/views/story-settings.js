// Owner tools for a story: details, channels, turn order, invites, members.
import { html, render, api, $, bindForm, toast, avatar, icons, confirmModal, promptModal } from '../lib.js';
import { state, page, loadStory, refreshHome, copyText, routeAlive, ensureAlive, replaceHash } from '../main.js';
import { storyFields, bindIconUpload } from './home.js';
import { openThreadForm } from './threads.js';

export async function viewStorySettings(idStr) {
  const alive = routeAlive();
  const id = Number(idStr);
  const s = await loadStory(id);
  ensureAlive(alive);
  // Story owners and admins.
  if (s.role !== 'owner' && !state.user?.isAdmin) return replaceHash(`#/s/${id}`);
  const story = s.story;
  const inviteLink = () => `${location.origin}/#/join/${id}/${state.story.story.inviteCode}`;

  const body = page({
    alive,
    title: 'Story settings',
    subtitle: story.title,
    actions: html`<a class="btn sm" href="#/s/${id}">${icons.back} Back</a>`,
    body: html`
      <div class="settings-grid">
        <section class="card">
          <h2>Details</h2>
          <form id="details">
            ${storyFields(story)}
            <label for="status">New writers</label>
            <select id="status" name="status">
              <option value="open" ${story.status === 'open' ? 'selected' : ''}>Open: anyone who can see the story may join</option>
              <option value="closed" ${story.status === 'closed' ? 'selected' : ''}>Closed: invite link only</option>
            </select>
            <div class="error"></div>
            <div class="actions"><button type="submit" class="primary">Save</button></div>
          </form>
        </section>

        <section class="card">
          <h2>Episodes & channels</h2>
          <p class="muted small">Use channels for chapters, locations or side scenes, like channels in a Discord server.</p>
          <div id="channels" class="stack"></div>
          <div class="actions"><button id="add-channel">${icons.plus} New episode or channel</button></div>
        </section>

        <section class="card">
          <h2>Turn order</h2>
          <p class="muted small">Optional, per channel. When it's someone's turn they get a notification, and posting in character (or as narrator) passes the turn on.</p>
          <label for="turn-channel">Channel</label>
          <select id="turn-channel">${s.channels.map((c) => html`<option value="${c.id}">#${c.name}</option>`)}</select>
          <div id="turns"></div>
        </section>

        <section class="card">
          <h2>Invite writers</h2>
          <p class="muted small">Anyone with this link (who has an account) can join, even if the story is private or closed.</p>
          <input id="invite" readonly value="${inviteLink()}">
          <div class="actions"><button id="copy">Copy link</button><button id="regen">Make a new link</button></div>
        </section>

        <section class="card">
          <h2>Writers</h2>
          <p class="muted small">${story.visibility === 'private' ? 'This story is private: only the writers here can see it (admins too, unless you add them).' : 'Add someone straight in by their username.'}</p>
          <form class="add-writer" id="add-writer">
            <input name="username" placeholder="@username" autocomplete="off" aria-label="Username" required>
            <button class="primary" type="submit">Add</button>
          </form>
          <div id="member-list" class="stack"></div>
        </section>

        <section class="card danger-zone">
          <h2>Delete story</h2>
          <p class="muted small">Deletes every channel and post. This can't be undone.</p>
          <button class="danger" id="delete">Delete story</button>
        </section>
      </div>`,
  });

  // ----- Details -----
  const form = $('#details', body);
  bindIconUpload(form);
  bindForm(form, async (data) => {
    await api(`/api/stories/${id}`, { method: 'PUT', body: data });
    await Promise.all([loadStory(id), refreshHome()]);
    toast('Saved');
  });

  // ----- Channels -----
  const channelsEl = $('#channels', body);
  function drawChannels() {
    render(
      channelsEl,
      html`${state.story.channels.map(
        (c, i) => html`
      <div class="row-item" data-id="${c.id}">
        <span class="hash">${icons.hash}</span>
        <div class="grow"><strong>${c.name}</strong>${c.topic ? html`<div class="small muted">${c.topic}</div>` : ''}</div>
        <button class="icon-btn sm" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button class="icon-btn sm" data-act="down" ${i === state.story.channels.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        <button class="sm" data-act="edit">Edit</button>
        <button class="sm danger" data-act="delete">Delete</button>
      </div>`,
      )}`,
    );
  }
  drawChannels();
  channelsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const cid = Number(btn.closest('[data-id]').dataset.id);
    const c = state.story.channels.find((x) => x.id === cid);
    try {
      if (btn.dataset.act === 'up' || btn.dataset.act === 'down') {
        await api(`/api/channels/${cid}`, { method: 'PUT', body: { move: btn.dataset.act } });
      } else if (btn.dataset.act === 'edit') {
        const { participants } = await api(`/api/channels/${cid}`);
        if (!(await openThreadForm({ storyId: id, channel: { ...c, participantIds: participants.map((x) => x.id) } }))) return;
      } else if (btn.dataset.act === 'delete') {
        if (!(await confirmModal(`Delete #${c.name} and all of its posts?`, { ok: 'Delete', danger: true }))) return;
        await api(`/api/channels/${cid}`, { method: 'DELETE' });
      }
      await loadStory(id);
      drawChannels();
      drawTurnChannels();
    } catch (err) {
      toast(err.message);
    }
  });
  $('#add-channel', body).addEventListener('click', () => openThreadForm({ storyId: id }));

  // ----- Turn order -----
  const turnSelect = $('#turn-channel', body);
  const turnsEl = $('#turns', body);
  function drawTurnChannels() {
    const current = turnSelect.value;
    render(turnSelect, html`${state.story.channels.map((c) => html`<option value="${c.id}">#${c.name}</option>`)}`);
    if (state.story.channels.some((c) => String(c.id) === current)) turnSelect.value = current;
    drawTurns();
  }
  let draftOrder = null;
  let draftEnabled = null;
  function drawTurns() {
    const c = state.story.channels.find((x) => x.id === Number(turnSelect.value));
    if (!c) return render(turnsEl, html``);
    draftOrder ??= c.turns.order.length ? [...c.turns.order] : state.story.members.map((m) => m.id);
    draftEnabled ??= c.turns.enabled;
    const members = state.story.members;
    const byId = (uid) => members.find((m) => m.id === uid);
    const outside = members.filter((m) => !draftOrder.includes(m.id));
    render(
      turnsEl,
      html`
      <label class="check"><input type="checkbox" id="turns-on" ${draftEnabled ? 'checked' : ''}> Use turn order in #${c.name}</label>
      <ol class="turn-list">
        ${draftOrder.filter(byId).map(
          (uid, i) => html`
          <li data-uid="${uid}">
            ${avatar({ name: byId(uid).displayName, src: byId(uid).avatar, size: 'xs' })}
            <span class="grow">${byId(uid).displayName}${c.turns.enabled && c.turns.current === uid ? html` <span class="tag">current</span>` : ''}</span>
            <button class="icon-btn sm" data-t="up" ${i === 0 ? 'disabled' : ''} aria-label="Earlier">↑</button>
            <button class="icon-btn sm" data-t="down" aria-label="Later">↓</button>
            <button class="sm" data-t="current">Make current</button>
            <button class="icon-btn sm" data-t="remove" aria-label="Remove">✕</button>
          </li>`,
        )}
      </ol>
      ${outside.length ? html`<p class="small muted">Not in the order: ${outside.map((m) => html`<button class="link" data-add="${m.id}">+ ${m.displayName}</button> `)}</p>` : ''}
      <div class="actions"><button class="primary" id="save-turns">Save turn order</button></div>`,
    );
  }
  turnSelect.addEventListener('change', () => {
    draftOrder = null;
    draftEnabled = null;
    drawTurns();
  });
  turnsEl.addEventListener('change', (e) => {
    if (e.target.id === 'turns-on') draftEnabled = e.target.checked;
  });
  turnsEl.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      draftOrder.push(Number(add.dataset.add));
      return drawTurns();
    }
    const b = e.target.closest('[data-t]');
    const cid = Number(turnSelect.value);
    if (b) {
      const uid = Number(b.closest('[data-uid]').dataset.uid);
      const i = draftOrder.indexOf(uid);
      if (b.dataset.t === 'up' && i > 0) [draftOrder[i - 1], draftOrder[i]] = [draftOrder[i], draftOrder[i - 1]];
      if (b.dataset.t === 'down' && i < draftOrder.length - 1)
        [draftOrder[i + 1], draftOrder[i]] = [draftOrder[i], draftOrder[i + 1]];
      if (b.dataset.t === 'remove') draftOrder.splice(i, 1);
      if (b.dataset.t === 'current') {
        await saveTurns(cid, { current: uid, enabled: true });
        return;
      }
      return drawTurns();
    }
    if (e.target.id === 'save-turns') await saveTurns(cid, {});
  });
  async function saveTurns(cid, extra) {
    try {
      await api(`/api/channels/${cid}/turns`, { method: 'PUT', body: { enabled: draftEnabled, order: draftOrder, ...extra } });
      await loadStory(id);
      draftOrder = null;
      draftEnabled = null;
      drawTurns();
      toast('Turn order saved');
    } catch (err) {
      toast(err.message);
    }
  }
  drawTurns();

  // ----- Invite -----
  $('#copy', body).addEventListener('click', () => copyText(inviteLink(), 'Invite link copied'));
  $('#regen', body).addEventListener('click', async () => {
    const { story: updated } = await api(`/api/stories/${id}`, { method: 'PUT', body: { regenerateInvite: true } });
    state.story.story.inviteCode = updated.inviteCode;
    $('#invite', body).value = inviteLink();
    toast('New link made. The old one no longer works');
  });

  // ----- Members -----
  const membersEl = $('#member-list', body);
  function drawMembers() {
    render(
      membersEl,
      html`${state.story.members.map(
        (m) => html`
      <div class="row-item">
        ${avatar({ name: m.displayName, src: m.avatar })}
        <div class="grow"><a href="#/u/${m.id}">${m.displayName}</a> <span class="small muted">@${m.username}</span></div>
        ${m.role === 'owner' ? html`<span class="tag">Owner</span>` : html`<button class="sm danger" data-kick="${m.id}">Remove</button>`}
      </div>`,
      )}`,
    );
  }
  drawMembers();
  $('#add-writer', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.username;
    try {
      const { member } = await api(`/api/stories/${id}/members`, { method: 'POST', body: { username: input.value } });
      input.value = '';
      toast(`${member.displayName} was added`);
      await loadStory(id);
      drawMembers();
    } catch (err) {
      toast(err.message);
    }
  });
  membersEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kick]');
    if (!b) return;
    const m = state.story.members.find((x) => x.id === Number(b.dataset.kick));
    if (
      !(await confirmModal(`Remove ${m.displayName} from this story? They won't be able to rejoin. Their posts stay.`, {
        ok: 'Remove',
        danger: true,
      }))
    )
      return;
    try {
      await api(`/api/stories/${id}/kick`, { method: 'POST', body: { userId: m.id } });
      await loadStory(id);
      drawMembers();
      draftOrder = null;
      draftEnabled = null;
      drawTurns();
    } catch (err) {
      toast(err.message);
    }
  });

  // ----- Delete -----
  $('#delete', body).addEventListener('click', async () => {
    const typed = await promptModal('Delete story', {
      label: `Type the title to confirm: ${story.title}`,
      ok: 'Delete forever',
      maxlength: 120,
    });
    if (typed !== story.title) {
      if (typed !== null) toast("Title didn't match");
      return;
    }
    await api(`/api/stories/${id}`, { method: 'DELETE' });
    await refreshHome();
    toast('Story deleted');
    location.hash = '#/home';
  });
}
