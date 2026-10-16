// Phones: each character has one, with contacts, one-to-one texts and group texts.
// The home is a soft gradient header, a contact strip and a chat list; conversations look like
// iMessage: blue and gray bubbles with tails, tapbacks, an emoji picker, calls and "Read".
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, promptModal, formatPost, uploadImage, askImageLink, plainText, applyColors, store, attachSheet, jumpToLatest } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive, onLeave, bus, loadStory, replaceHash, previousHash, storyNow } from '../main.js';

const lastKey = 'nuuvi:phone';
export const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];
// The emoji picker: a few rows of the ones people use most, by kind.
const EMOJI = {
  Smileys: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫠 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 👻 👽 🤖 💩',
  Hearts: '❤️ 🩷 🧡 💛 💚 🩵 💙 💜 🖤 🩶 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 💕 💞 💓 💗 💖 💘 💝 💟 💋 💌',
  Hands: '👍 👎 👏 🙌 🫶 👐 🤲 🤝 🙏 ✌️ 🤞 🫰 🤟 🤘 👌 🤌 🤏 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🫵 ✍️ 💅',
  People: '👀 👁️ 👄 🫦 🧠 🙋 🙅 🙆 💁 🤷 🤦 🙇 💃 🕺 👯 🧍 🏃 🚶 👫 👬 👭 💏 💑',
  Things: '🔥 ✨ 🌟 ⭐ 💫 🎉 🎊 🎂 🎁 🎈 🍾 🥂 🍷 🍸 🍹 🍺 ☕ 🧋 🍕 🍔 🍟 🍜 🍣 🍰 🍓 🍒 🍑 🌹 🌸 💐 🌙 ☀️ 🌧️ ❄️ 🌈 🎵 🎶 🎧 🎤 📸 📱 💻 💸 💰 💎 👑 💍 🚗 ✈️ 🏠 🗝️ 🔪 💊 🩸 🚬',
  Symbols: '‼️ ❓ ❗ ❕ ❔ 💯 ✅ ❌ ⭕ 🚫 ⚠️ 💤 💢 💥 💦 💨 🕊️ 🤍 ♾️ 🆗 🆒 🔞 ‼️',
};
const emojiOnly = (s) => { const t = (s || '').trim(); return !!t && t.length <= 24 && /\p{Extended_Pictographic}/u.test(t) && !/[\p{L}\p{N}<>]/u.test(t); };
export function emojiGrid() {
  return html`<div class="emoji-grid no-swipe">${Object.entries(EMOJI).map(([k, list]) => html`<p class="emoji-cat">${k}</p>${[...new Set(list.split(' '))].map((e) => html`<button type="button" class="emoji-btn" data-emoji="${e}">${e}</button>`)}`)}</div>`;
}
// A group's picture: its own photo, or the first two people overlapping.
function groupAvatar(t, size = '') {
  if (t.photo) return html`<span class="ph-gav ${size}"><img class="avatar" src="${t.photo}" alt=""></span>`;
  const [a, b] = t.members;
  return html`<span class="ph-gav two ${size}">${a ? avatar({ name: a.contactName || a.name, src: a.avatar, color: a.color }) : ''}${b ? avatar({ name: b.contactName || b.name, src: b.avatar, color: b.color }) : ''}</span>`;
}
const clock = (sql) => new Date(`${sql.replace(' ', 'T')}Z`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function shortWhen(sql) {
  const d = new Date(`${sql.replace(' ', 'T')}Z`);
  const days = Math.floor((Date.now() - d) / 864e5);
  if (days < 1 && d.getDate() === new Date().getDate()) return clock(sql);
  if (days < 2) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const live = (type, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(type, h); onLeave(() => bus.removeEventListener(type, h)); };

// Add contacts: tick as many characters as you like (anyone in the directory). With just one
// ticked, you can also save them under a name of your own.
async function pickContact(me, existing) {
  const { writers } = await api('/api/directory');
  const all = writers.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w.username })))
    .filter((c) => c.id !== me.id && !existing.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const picked = new Set();
  return modal(html`
    <form class="pick-contact">
      <h2>Add contacts</h2>
      <input type="search" class="search" id="pc-q" placeholder="Search characters…" aria-label="Search characters" autocomplete="off">
      <p class="small muted" id="pc-count">Tick everyone you want to add.</p>
      <div class="pc-list" id="pc-list"></div>
      <div id="pc-name-box" hidden>
        <label for="pc-name">Save them as <span class="muted small">(optional, only you see this)</span></label>
        <input id="pc-name" name="name" maxlength="60" placeholder="e.g. hyung 🖤">
      </div>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary" id="pc-ok">Add</button></div>
    </form>`, {
    init: (d) => {
      const list = $('#pc-list', d);
      const draw = (q = '') => {
        const shown = all.filter((c) => picked.has(c.id) || !q || `${c.name} ${c.handle} ${c.writer}`.toLowerCase().includes(q));
        render(list, shown.length ? html`${shown.slice(0, 80).map((c) => html`
          <button type="button" class="pc-item ${picked.has(c.id) ? 'on' : ''}" data-pick="${c.id}" aria-pressed="${picked.has(c.id)}">
            ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}<span class="grow"><b>${c.name}</b><small>@${c.handle} · ${c.writer}</small></span><span class="pc-check">${picked.has(c.id) ? '✓' : ''}</span></button>`)}`
          : html`<p class="muted small">${all.length ? 'No one matches.' : 'Everyone is already in your contacts.'}</p>`);
        $('#pc-count', d).textContent = picked.size ? `${picked.size} ticked` : 'Tick everyone you want to add.';
        $('#pc-ok', d).textContent = picked.size > 1 ? `Add ${picked.size} contacts` : 'Add';
        $('#pc-name-box', d).hidden = picked.size !== 1;
      };
      draw();
      $('#pc-q', d).addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        const cid = Number(b.dataset.pick);
        if (picked.has(cid)) picked.delete(cid); else picked.add(cid);
        draw($('#pc-q', d).value.trim().toLowerCase());
      });
    },
    submit: async (data) => {
      if (!picked.size) throw new Error('Tick at least one person');
      const ids = [...picked];
      const added = [];
      for (const contactId of ids) {
        const body = { contactId, ...(ids.length === 1 ? { name: data.name } : {}) };
        added.push((await api(`/api/phone/${me.id}/contacts`, { method: 'POST', body })).contact);
      }
      return added;
    },
  });
}

// Start a group text: pick two or more people (contacts first) and, if you like, a name.
async function newGroup(me, contacts) {
  const { writers } = await api('/api/directory');
  const saved = new Map(contacts.map((c) => [c.id, c.name]));
  const all = writers.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w.username, shown: saved.get(c.id) || c.name })))
    .filter((c) => c.id !== me.id).sort((a, b) => (saved.has(b.id) - saved.has(a.id)) || a.shown.localeCompare(b.shown));
  const picked = new Set();
  return modal(html`
    <form class="pick-contact">
      <h2>New group</h2>
      <input name="title" maxlength="60" placeholder="Group name (optional)" aria-label="Group name" autocomplete="off">
      <input type="search" class="search" id="ng-q" placeholder="Add people…" aria-label="Search characters" autocomplete="off">
      <p class="small muted" id="ng-count">Pick at least two people.</p>
      <div class="pc-list" id="ng-list"></div>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Start group</button></div>
    </form>`, {
    init: (d) => {
      const list = $('#ng-list', d);
      const draw = (q = '') => {
        const shown = all.filter((c) => picked.has(c.id) || !q || `${c.shown} ${c.name} ${c.handle} ${c.writer}`.toLowerCase().includes(q));
        render(list, shown.length ? html`${shown.slice(0, 80).map((c) => html`
          <button type="button" class="pc-item ${picked.has(c.id) ? 'on' : ''}" data-pick="${c.id}" aria-pressed="${picked.has(c.id)}">
            ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}<span class="grow"><b>${c.shown}</b><small>@${c.handle} · ${c.writer}</small></span><span class="pc-check">${picked.has(c.id) ? '✓' : ''}</span></button>`)}`
          : html`<p class="muted small">No one matches.</p>`);
        $('#ng-count', d).textContent = picked.size ? `${picked.size} picked${picked.size < 2 ? ', pick one more' : ''}` : 'Pick at least two people.';
      };
      draw();
      $('#ng-q', d).addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        const cid = Number(b.dataset.pick);
        if (picked.has(cid)) picked.delete(cid); else picked.add(cid);
        draw($('#ng-q', d).value.trim().toLowerCase());
      });
    },
    submit: async (data) => {
      if (picked.size < 2) throw new Error('Pick at least two people');
      return (await api(`/api/phone/${me.id}/groups`, { method: 'POST', body: { memberIds: [...picked], title: data.title } })).thread;
    },
  });
}

// ---------- Phone home: contacts strip + conversations ----------
// Opened from inside a story (#/s/5/phone…) the phone stays in that story, with its sidebar;
// from the main menu it's #/phone….
const phoneBase = () => location.hash.match(/^#\/s\/\d+\/phone/)?.[0] ?? '#/phone';
async function keepStory() {
  const sid = Number(location.hash.match(/^#\/s\/(\d+)\/phone/)?.[1]);
  if (sid && state.story?.story.id !== sid) await loadStory(sid);
}

export async function viewPhone(cidStr) {
  const alive = routeAlive();
  await keepStory();
  const mine = await myCharacters(true);
  ensureAlive(alive);
  if (!mine.length) {
    page({ alive, title: 'Phone', body: html`<div class="card empty"><p>Phones belong to characters.</p><p><a class="btn primary" href="#/characters">Create a character</a></p></div>` });
    return;
  }
  const cid = Number(cidStr) || Number(store.get(lastKey)) || mine[0].id;
  if (!mine.some((c) => c.id === cid)) return replaceHash(`${phoneBase()}/${mine[0].id}`);
  if (!cidStr) return replaceHash(`${phoneBase()}/${cid}`);
  store.set(lastKey, String(cid));
  const data0 = await api(`/api/phone/${cid}`);
  ensureAlive(alive);
  const me = data0.character;
  const body = page({ alive, title: `${me.name}'s phone`, subtitle: `@${me.handle}`, className: 'phone-body', body: html`
    <div class="phone-split"><div class="phone" id="phone"></div>
      <div class="phone ph-pick"><div class="ph-pick-inner">${icons.chat}<p>Pick a conversation, or tap <b>Add</b> to save someone's number.</p></div></div></div>` });
  mountPhoneList($('#phone', body), { cid, mine, data: data0 });
}

// The phone's home: search, the contact strip and the conversation list.
// Used on its own (phones) and as the left column beside a conversation (computers).
export function mountPhoneList(root, { cid, mine, data: initial, activeTid = null }) {
  let data = initial;
  const me = data.character;
  let q = '';
  let unread = {};
  // Do this writer's other phones have texts waiting? (a dot on the switch button)
  const otherUnread = () => mine.some((m) => m.id !== cid && unread[m.id]);

  function draw() {
    const contacts = data.contacts.filter((c) => !q || c.name.toLowerCase().includes(q));
    // The conversation that's open beside the list has just been read.
    const threads = data.threads.map((t) => (t.id === activeTid ? { ...t, unread: 0 } : t)).filter((t) => !q || t.name.toLowerCase().includes(q) || (t.last?.text || '').toLowerCase().includes(q));
    render(root, html`
      <section class="ph-hero">
        <div class="ph-top">
          <label class="ph-search">${icons.search}<input type="search" id="ph-q" placeholder="Search…" value="${q}" aria-label="Search contacts and messages"></label>
          <button type="button" class="ph-switch ${otherUnread() ? 'has-dot' : ''}" id="ph-switch" aria-label="Switch phone${otherUnread() ? ' (another phone has new texts)' : ''}" title="Switch phone">${avatar({ name: me.name, src: me.avatar, color: me.color, size: 'xs' })}${icons.chevron}<i class="ph-dot" aria-hidden="true"></i></button>
        </div>
        <h1>Messages</h1>
        <div class="ph-contacts no-swipe">
          <button type="button" class="ph-contact add" id="ph-add"><span class="ph-av">${icons.plus}</span><span>Add</span></button>
          <button type="button" class="ph-contact add" id="ph-group"><span class="ph-av">${icons.users}</span><span>Group</span></button>
          ${contacts.map((c) => html`
            <button type="button" class="ph-contact" data-open="${c.id}" title="${c.name}"><span class="ph-av">${avatar({ name: c.character.name, src: c.character.avatar, color: c.character.color })}</span><span>${c.name}</span></button>`)}
        </div>
      </section>
      <section class="ph-list">
        ${threads.length ? threads.map((t) => html`
          <a class="ph-row ${t.unread ? 'unread' : ''} ${t.id === activeTid ? 'active' : ''}" href="${phoneBase()}/${me.id}/t/${t.id}" ${t.group ? '' : html`data-contact="${t.other.id}"`}>
            <span class="ph-row-av">${t.group ? groupAvatar(t) : avatar({ name: t.other.name, src: t.other.avatar, color: t.other.color })}</span>
            <span class="grow"><b>${t.name}</b><small>${t.last ? `${t.last.mine ? 'You: ' : ''}${t.last.text}` : 'No messages yet'}</small></span>
            <span class="ph-meta">${t.last?.at || t.lastAt ? html`<small>${shortWhen(t.last?.at || t.lastAt)}</small>` : ''}${t.unread ? html`<span class="badge">${t.unread}</span>` : ''}</span>
          </a>`) : html`<div class="ph-empty"><p>No messages yet.</p><p class="small">Tap <b>Add</b> to save someone's number, then tap them to text.</p></div>`}
      </section>`);
    applyColors(root);
  }
  draw();
  const loadUnread = () => api('/api/phone/unread').then((r) => { unread = r.unread; const sw = $('#ph-switch', root); if (sw) sw.classList.toggle('has-dot', otherUnread()); }).catch(() => {});
  loadUnread();

  const reload = async () => { data = await api(`/api/phone/${cid}`); draw(); loadUnread(); };
  const open = async (otherId) => {
    const { thread } = await api(`/api/phone/${cid}/threads`, { method: 'POST', body: { withId: otherId } });
    location.hash = `${phoneBase()}/${cid}/t/${thread.id}`;
  };
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'ph-q') return;
    q = e.target.value.trim().toLowerCase();
    const pos = e.target.selectionStart;
    draw();
    const input = $('#ph-q', root);
    input.focus();
    input.setSelectionRange(pos, pos);
  });
  root.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-open]');
    if (c) { open(Number(c.dataset.open)); return; }
    if (e.target.closest('#ph-group')) {
      const g = await newGroup(me, data.contacts);
      if (g) location.hash = `${phoneBase()}/${cid}/t/${g.id}`;
      return;
    }
    if (e.target.closest('#ph-add')) {
      const added = await pickContact(me, new Set(data.contacts.map((x) => x.id)));
      if (added?.length) { toast(added.length === 1 ? `${added[0].name} saved to contacts` : `${added.length} contacts saved`); reload(); }
      return;
    }
    const sw = e.target.closest('#ph-switch');
    if (sw) {
      // Each phone shows how many unread texts it has.
      await loadUnread();
      menu(sw, mine.map((m) => ({
        label: `${m.id === cid ? '✓ ' : ''}${m.name}'s phone${unread[m.id] ? `  ● ${unread[m.id]} new` : ''}`,
        action: () => { location.hash = `${phoneBase()}/${m.id}`; },
      })));
    }
  });
  root.addEventListener('contextmenu', async (e) => {
    const c = e.target.closest('[data-open]');
    if (!c) return;
    e.preventDefault();
    contactMenu(c, Number(c.dataset.open));
  });
  async function contactMenu(anchor, id) {
    const contact = data.contacts.find((x) => x.id === id)
      || (() => { const t = data.threads.find((x) => x.other?.id === id); return t && { id, name: t.name, character: t.other }; })();
    if (!contact) return;
    // Pictures and names saved here are this phone's own: the character's writer still sees theirs.
    const savePic = async (avatar) => { await api(`/api/phone/${cid}/contacts`, { method: 'POST', body: { contactId: id, avatar } }); reload(); toast('Contact picture changed'); };
    menu(anchor, [
      { label: 'Text', action: () => open(id) },
      { label: 'Rename contact', action: async () => {
        const name = await promptModal('Save them as', { value: contact.name, required: false, maxlength: 60 });
        if (name !== null) { await api(`/api/phone/${cid}/contacts`, { method: 'POST', body: { contactId: id, name } }); reload(); }
      } },
      { label: 'Change contact picture', action: () => {
        const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
        f.onchange = async () => { try { await savePic(await uploadImage(f.files[0], 400)); } catch (err) { toast(err.message); } };
        f.click();
      } },
      { label: 'Use a picture link', action: async () => { const u = await askImageLink('Contact picture'); if (u) savePic(u); } },
      contact.customAvatar && { label: 'Back to their own picture', action: () => savePic('') },
      { label: 'View profile', action: () => { location.hash = `#/c/${id}`; } },
      { label: 'Remove contact', danger: true, action: async () => { await api(`/api/phone/${cid}/contacts/${id}`, { method: 'DELETE' }); reload(); } },
    ]);
  }
  // Long-press on phones is turned into a right-click app-wide (main.js), so these menus open either way.
  root.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('[data-contact]');
    if (!row) return;
    e.preventDefault();
    contactMenu(row, Number(row.dataset.contact));
  });
  live('dm', () => reload());
  live('dm-thread', () => reload());
}

// ---------- A conversation ----------
// Looks like iMessage: your texts in blue on the right, theirs in gray on the left, a tail on the
// last bubble of each run, the time shown when there's a gap, tapbacks on bubbles, "Read" under
// your last text, and calls as a line in the middle. Hold (or double-tap) a bubble to react,
// reply, copy or delete.
const at = (sql) => new Date(`${sql.replace(' ', 'T')}Z`);
const pad2 = (n) => String(n).padStart(2, '0');
const localValue = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const whenLabel = (d) => d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const callLength = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} hr ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} sec`);
function stamp(d) {
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return html`<b>Today</b> ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return html`<b>Yesterday</b> ${time}`;
  if (today - d < 6 * 864e5) return html`<b>${d.toLocaleDateString(undefined, { weekday: 'long' })}</b> ${time}`;
  return html`<b>${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b> at ${time}`;
}

export async function viewPhoneThread(cidStr, tidStr) {
  const alive = routeAlive();
  await keepStory();
  const cid = Number(cidStr);
  let { thread, messages, hasMore } = await api(`/api/phone/threads/${tidStr}?as=${cid}`);
  ensureAlive(alive);
  const me = thread.me;
  const byId = new Map(messages.map((m) => [m.id, m]));
  let replying = null;
  let sendAt = null; // a time set for the next text (null: now in Ardell City)
  let attached = [];
  let showEmoji = false;
  const people = () => new Map(thread.members.map((c) => [c.id, c]));
  const nameOf = (id) => (id === me.id ? 'You' : people().get(id)?.contactName || people().get(id)?.name || 'Someone');
  const first = (id) => nameOf(id).split(' ')[0];

  const wide = matchMedia('(min-width: 900px)').matches;
  const head = () => html`
    <a class="ph-back" href="${phoneBase()}/${cid}" data-ph-back aria-label="Back">${icons.back}</a>
    <a class="ph-who" ${thread.group ? html`href="#" data-ginfo` : html`href="#/c/${thread.other.id}"`}>
      ${thread.group ? groupAvatar(thread, 'sm') : avatar({ name: thread.other.name, src: thread.other.avatar, color: thread.other.color, size: 'sm' })}
      <span class="ph-who-name">${thread.name}${icons.chevron}</span>
      ${thread.group ? html`<small>${thread.members.length + 1} people</small>` : ''}
    </a>
    <span class="ph-chat-actions">
      <button type="button" class="ph-pill" id="ph-call" aria-label="${thread.group ? 'Call the group' : `Call ${thread.name}`}">${icons.phone}</button>
      ${thread.group ? html`<button type="button" class="ph-pill" data-ginfo aria-label="Group details">${icons.users}</button>`
        : html`<a class="ph-pill" href="#/c/${thread.other.id}" aria-label="Contact profile">${icons.card}</a>`}
    </span>`;
  const body = page({ alive, title: thread.name, subtitle: thread.group ? `${thread.members.length + 1} people` : `@${thread.other.handle}`, className: 'phone-body', body: html`
    <div class="phone-split">${wide ? html`<div class="phone" id="phone"></div>` : ''}
    <div class="phone chat ph-ios">
      <section class="ph-chat">
        <header class="ph-chat-head" id="ph-head">${head()}</header>
        <div class="ph-msgs" id="ph-msgs"></div>
      </section>
      <div class="ph-extra" id="ph-extra" hidden></div>
      <form class="chatbar ph-compose" id="ph-compose">
        <button type="button" class="chatbar-plus" id="ph-attach" aria-label="Add a photo">${icons.plus}</button>
        <span class="ph-field">
          <textarea name="body" id="ph-input" rows="1" autocomplete="off" placeholder="${thread.group ? 'iMessage' : 'Text Message'}" aria-label="Message"></textarea>
          <button type="button" class="ph-emoji-btn ph-when-btn" id="ph-when" aria-label="Set the time it's sent" title="Set the time it's sent">${icons.hourglass}</button>
          <button type="button" class="ph-emoji-btn" id="ph-emoji" aria-label="Emoji" aria-pressed="false">☺︎</button>
          <button type="submit" class="chatbar-send" aria-label="Send">${icons.send}</button>
        </span>
      </form>
    </div></div>` });
  if (wide) {
    // On a computer, the contacts and the conversation share one page.
    Promise.all([myCharacters(), api(`/api/phone/${cid}`)]).then(([mine, data]) => {
      if (alive()) mountPhoneList($('#phone', body), { cid, mine, data, activeTid: thread.id });
    }).catch(() => {});
  }
  const list = $('#ph-msgs', body);
  jumpToLatest(list);
  // Phones: a conversation fills the whole screen (the side menu steps aside), like iMessage.
  document.body.classList.add('ph-full');
  onLeave(() => document.body.classList.remove('ph-full'));
  const form = $('#ph-compose', body);
  const input = $('#ph-input', body);
  const extra = $('#ph-extra', body);

  const reactionsHtml = (m) => {
    if (!m.reactions?.length) return '';
    const counts = new Map();
    for (const r of m.reactions) counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
    const mineOn = m.reactions.some((r) => r.characterId === me.id);
    return html`<button type="button" class="ph-tb ${mineOn ? 'by-me' : ''}" data-who="${m.id}" aria-label="Reactions">${[...counts].slice(0, 3).map(([e, n]) => html`<span>${e}${n > 1 ? html`<small>${n}</small>` : ''}</span>`)}</button>`;
  };

  function draw(stick = true) {
    // In time order (texts can be given a time of their own), then in the order they were written.
    const sorted = [...byId.values()].sort((a, b) => (at(a.createdAt) - at(b.createdAt)) || (a.id - b.id));
    const items = [];
    if (hasMore) items.push(html`<button type="button" class="ph-more" id="ph-more">Earlier messages</button>`);
    // "Read" goes under your last text (one-to-one only).
    const lastMine = [...sorted].reverse().find((m) => m.characterId === me.id && m.kind !== 'call');
    sorted.forEach((m, i) => {
      const prev = sorted[i - 1];
      const next = sorted[i + 1];
      const d = at(m.createdAt);
      const gap = !prev || d - at(prev.createdAt) > 15 * 60000;
      if (gap) items.push(html`<div class="ph-stamp">${stamp(d)}</div>`);
      if (m.kind === 'call') {
        const mineCall = m.characterId === me.id;
        const c = m.call || { answered: false, video: false, duration: 0 };
        const what = c.video ? 'FaceTime' : 'call';
        const who = mineCall ? html`You called ${thread.group ? 'the group' : thread.name}` : html`<b>${nameOf(m.characterId)}</b> called`;
        items.push(html`<div class="ph-call-line ${c.answered ? 'answered' : 'missed'}" data-id="${m.id}">${c.video ? icons.video : icons.phone}<span>${c.answered
          ? html`${who} · ${c.video ? 'FaceTime' : 'Voice call'}, ${callLength(c.duration)}`
          : mineCall ? html`${who} · no answer` : html`Missed ${what} from <b>${nameOf(m.characterId)}</b>`}</span><time>${clock(m.createdAt)}</time></div>`);
        return;
      }
      const mine = m.characterId === me.id;
      const sameAsPrev = prev && prev.kind !== 'call' && prev.characterId === m.characterId && !gap;
      const sameAsNext = next && next.kind !== 'call' && next.characterId === m.characterId && at(next.createdAt) - d <= 15 * 60000;
      const big = !m.media.length && !m.replyTo && emojiOnly(m.body);
      const sender = thread.group && !mine ? people().get(m.characterId) : null;
      items.push(html`
        <div class="ph-msg ${mine ? 'mine' : 'theirs'} ${sameAsNext ? '' : 'tail'} ${sameAsPrev ? 'cont' : ''} ${big ? 'big-emoji' : ''} ${m.reactions?.length ? 'has-tb' : ''}" data-id="${m.id}">
          ${thread.group && !mine ? html`<span class="ph-msg-av">${sameAsNext ? '' : avatar({ name: nameOf(m.characterId), src: sender?.avatar, color: sender?.color })}</span>` : ''}
          <div class="ph-col">
            ${sender && !sameAsPrev ? html`<span class="ph-sender">${first(m.characterId)}</span>` : ''}
            ${m.replyTo ? html`<button type="button" class="ph-quote" data-jump="${m.replyTo.id}"><small>${icons.reply} ${nameOf(m.replyTo.characterId) === 'You' ? 'You' : first(m.replyTo.characterId)}</small><span>${m.replyTo.text || (m.replyTo.hasMedia ? 'Photo' : '')}</span></button>` : ''}
            ${m.media.length ? html`<div class="ph-pics b-pics n${Math.min(m.media.length, 4)}">${m.media.map((u) => html`<a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="" loading="lazy"></a>`)}</div>` : ''}
            ${m.body ? html`<div class="ph-bubble" title="${clock(m.createdAt)}">${big ? m.body.trim() : html`<span class="ph-text">${formatPost(m.body)}</span>`}</div>` : ''}
            ${reactionsHtml(m)}
          </div>
          <span class="ph-tools"><button type="button" data-tapback="${m.id}" aria-label="React">☺︎</button><button type="button" data-reply="${m.id}" aria-label="Reply">${icons.reply}</button></span>
        </div>`);
      if (m === lastMine && !thread.group) items.push(html`<div class="ph-receipt">${thread.readUpTo >= m.id ? 'Read' : 'Delivered'}</div>`);
    });
    if (!sorted.length) items.push(html`<p class="ph-hint">This is the start of your texts with ${thread.name}.</p>`);
    render(list, html`${items}`);
    if (stick) list.scrollTop = list.scrollHeight;
  }
  draw();
  list.addEventListener('load', () => { if (list.scrollHeight - list.scrollTop - list.clientHeight < 400) list.scrollTop = list.scrollHeight; }, true);

  const markRead = () => {
    const last = Math.max(0, ...byId.keys());
    if (last) api(`/api/phone/threads/${thread.id}/read`, { method: 'POST', body: { as: me.id, lastId: last } }).catch(() => {});
  };
  markRead();

  function drawExtra() {
    extra.hidden = !replying && !attached.length && !showEmoji && !sendAt;
    $('#ph-when', body).classList.toggle('on', !!sendAt);
    $('#ph-emoji', body).setAttribute('aria-pressed', String(showEmoji));
    render(extra, html`
      ${replying ? html`<div class="reply-bar">${icons.reply}<span>Replying to <b>${replying.characterId === me.id ? 'yourself' : nameOf(replying.characterId)}</b><small>${plainText(replying.body) || 'Photo'}</small></span>
        <button type="button" class="icon-btn sm" id="ph-unreply" aria-label="Cancel reply">✕</button></div>` : ''}
      ${attached.length ? html`<div class="attach-row">${attached.map((u, i) => html`<span class="thumb"><img src="${u}" alt=""><button type="button" data-unattach="${i}" aria-label="Remove">✕</button></span>`)}</div>` : ''}
      ${sendAt ? html`<div class="reply-bar ph-when-bar">${icons.hourglass}<span>Sends as <b>${whenLabel(sendAt)}</b><small>Each text after this one moves on a minute.</small></span>
        <button type="button" class="icon-btn sm" data-when-edit aria-label="Change the time">✎</button>
        <button type="button" class="icon-btn sm" id="ph-unwhen" aria-label="Send at the current time">✕</button></div>` : ''}
      ${showEmoji ? html`<div class="ph-emoji-panel">${emojiGrid()}</div>` : ''}`);
  }
  extra.addEventListener('click', (e) => {
    if (e.target.closest('#ph-unreply')) { replying = null; drawExtra(); return; }
    if (e.target.closest('#ph-unwhen')) { sendAt = null; drawExtra(); return; }
    if (e.target.closest('[data-when-edit]')) { pickTime(); return; }
    const rm = e.target.closest('[data-unattach]');
    if (rm) { attached.splice(Number(rm.dataset.unattach), 1); drawExtra(); return; }
    const em = e.target.closest('[data-emoji]');
    if (em) {
      // Put the emoji where the cursor is, without opening the keyboard on phones.
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + em.dataset.emoji + input.value.slice(input.selectionEnd ?? pos);
      const caret = pos + em.dataset.emoji.length;
      try { input.setSelectionRange(caret, caret); } catch { /* not focused */ }
      form.classList.toggle('has-text', !!input.value.trim());
    }
  });
  $('#ph-emoji', body).addEventListener('click', () => { showEmoji = !showEmoji; drawExtra(); if (showEmoji) input.blur(); });
  input.addEventListener('focus', () => { if (showEmoji && !matchMedia('(min-width: 900px)').matches) { showEmoji = false; drawExtra(); } });

  // ---- Tapbacks and the message menu ----
  async function react(m, emoji) {
    try {
      const { reactions } = await api(`/api/phone/messages/${m.id}/react`, { method: 'POST', body: { as: me.id, emoji } });
      byId.set(m.id, { ...m, reactions });
      draw(false);
    } catch (err) { toast(err.message); }
  }
  function closeTapback() { document.querySelector('.ph-tb-layer')?.remove(); }
  onLeave(closeTapback);
  function openTapback(m) {
    closeTapback();
    if (!m) return;
    const mine = m.characterId === me.id;
    const myEmoji = m.reactions?.find((r) => r.characterId === me.id)?.emoji;
    const layer = document.createElement('div');
    layer.className = `ph-tb-layer ${mine ? 'mine' : ''}`;
    const drawLayer = (picking = false) => render(layer, html`
      <div class="ph-tb-back" data-tb-close></div>
      <div class="ph-tb-card" role="dialog" aria-label="React to this message">
        ${picking ? html`<div class="ph-tb-pick">${emojiGrid()}</div>` : html`
        <div class="ph-tb-bar">${TAPBACKS.map((e) => html`<button type="button" class="${e === myEmoji ? 'on' : ''}" data-tb="${e}" aria-label="React ${e}">${e}</button>`)}
          <button type="button" class="ph-tb-more" data-tb-more aria-label="More emoji">＋</button></div>`}
        <div class="ph-tb-menu">
          <p class="ph-tb-time">${mine ? 'Sent' : `From ${nameOf(m.characterId)} ·`} ${at(m.createdAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>
          <button type="button" data-tb-reply>${icons.reply}<span>Reply</span></button>
          ${m.body ? html`<button type="button" data-tb-copy><span class="ph-tb-ic">⧉</span><span>Copy</span></button>` : ''}
          ${mine ? html`<button type="button" class="danger" data-tb-del><span class="ph-tb-ic">✕</span><span>Delete</span></button>` : ''}
        </div>
      </div>`);
    drawLayer();
    document.body.append(layer);
    navigator.vibrate?.(8);
    layer.addEventListener('click', async (e) => {
      const pick = e.target.closest('[data-tb], [data-emoji]');
      if (pick) { closeTapback(); react(m, pick.dataset.tb || pick.dataset.emoji); return; }
      if (e.target.closest('[data-tb-more]')) { drawLayer(true); return; }
      if (e.target.closest('[data-tb-reply]')) { closeTapback(); replying = m; drawExtra(); input.focus(); return; }
      if (e.target.closest('[data-tb-copy]')) {
        closeTapback();
        try { await navigator.clipboard.writeText(plainText(m.body)); toast('Copied'); } catch { toast('Couldn’t copy'); }
        return;
      }
      if (e.target.closest('[data-tb-del]')) {
        closeTapback();
        if (!(await confirmModal('Delete this message for everyone?', { ok: 'Delete', danger: true }))) return;
        await api(`/api/phone/messages/${m.id}`, { method: 'DELETE' }).catch((err) => toast(err.message));
        return;
      }
      if (e.target.closest('[data-tb-close]')) closeTapback();
    });
  }
  const onKey = (e) => { if (e.key === 'Escape') closeTapback(); };
  document.addEventListener('keydown', onKey);
  onLeave(() => document.removeEventListener('keydown', onKey));

  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.ph-msg');
    if (!row || e.target.closest('a[href]:not([target])')) return;
    e.preventDefault();
    const m = byId.get(Number(row.dataset.id));
    if (m) openTapback(m);
  });
  let lastTap = { id: 0, t: 0 };
  list.addEventListener('click', async (e) => {
    if (e.target.closest('#ph-more')) {
      const firstId = Math.min(...byId.keys());
      const older = await api(`/api/phone/threads/${thread.id}?as=${me.id}&before=${firstId}`);
      for (const m of older.messages) byId.set(m.id, m);
      hasMore = older.hasMore;
      const keep = list.scrollHeight - list.scrollTop;
      draw(false);
      list.scrollTop = list.scrollHeight - keep;
      return;
    }
    const j = e.target.closest('[data-jump]');
    if (j) { $(`.ph-msg[data-id="${j.dataset.jump}"]`, list)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const who = e.target.closest('[data-who]');
    if (who) {
      const m = byId.get(Number(who.dataset.who));
      toast(m.reactions.map((r) => `${r.emoji} ${nameOf(r.characterId)}`).join('  ·  '));
      return;
    }
    const tb = e.target.closest('[data-tapback]');
    if (tb) { openTapback(byId.get(Number(tb.dataset.tapback))); return; }
    const r = e.target.closest('[data-reply]');
    if (r) { replying = byId.get(Number(r.dataset.reply)); drawExtra(); input.focus(); return; }
    // Double-tap a bubble to react (like on an iPhone).
    const row = e.target.closest('.ph-msg');
    if (row && !e.target.closest('a')) {
      const now = Date.now();
      if (lastTap.id === row.dataset.id && now - lastTap.t < 350) { lastTap = { id: 0, t: 0 }; openTapback(byId.get(Number(row.dataset.id))); return; }
      lastTap = { id: row.dataset.id, t: now };
    }
  });

  $('#ph-attach', body).addEventListener('click', () => attachSheet({
    max: Math.max(0, 10 - attached.length),
    onPictures: (urls) => { attached.push(...urls.slice(0, 10 - attached.length)); drawExtra(); },
  }));

  // ---- Header: call, group details, back ----
  const headEl = $('#ph-head', body);
  headEl.addEventListener('click', async (e) => {
    if (e.target.closest('#ph-call')) {
      placeCall();
      return;
    }
    if (e.target.closest('[data-ginfo]')) { e.preventDefault(); groupInfo(); return; }
    // The phone's own back arrow is a real "back": if the page before was this phone's list, step back
    // to it (so the top Back button keeps working); otherwise swap to the list without adding a step.
    const back = e.target.closest('[data-ph-back]');
    if (back) {
      e.preventDefault();
      const to = back.getAttribute('href');
      if (previousHash() === to) history.back(); else replaceHash(to);
    }
  });
  const refreshThread = async () => {
    try {
      const fresh = await api(`/api/phone/threads/${thread.id}?as=${me.id}`);
      thread = fresh.thread;
      render(headEl, head());
      draw(false);
    } catch { location.hash = `${phoneBase()}/${cid}`; } // removed from the group
  };
  async function groupInfo() {
    const { writers } = await api('/api/directory');
    const inGroup = new Set([me.id, ...thread.members.map((c) => c.id)]);
    const canAdd = writers.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w.username }))).filter((c) => !inGroup.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const starter = thread.createdBy === me.id;
    await modal(html`
      <form class="pick-contact ph-ginfo">
        <div class="ph-ginfo-top">${groupAvatar(thread, 'xl')}<button type="button" class="sm" id="gi-photo">Change photo</button></div>
        <label for="gi-title">Group name</label>
        <input id="gi-title" name="title" maxlength="60" value="${thread.title}" placeholder="${thread.name}">
        <p class="small muted">${thread.members.length + 1} people</p>
        <div class="pc-list">
          <div class="pc-item on">${avatar({ name: me.name, src: me.avatar, color: me.color, size: 'sm' })}<span class="grow"><b>${me.name}</b><small>You</small></span></div>
          ${thread.members.map((c) => html`<div class="pc-item">${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}<span class="grow"><b>${c.contactName}</b><small>@${c.handle}</small></span>
            ${starter ? html`<button type="button" class="sm danger" data-gi-remove="${c.id}">Remove</button>` : ''}</div>`)}
        </div>
        <label for="gi-add">Add people</label>
        <select id="gi-add"><option value="">Pick someone…</option>${canAdd.map((c) => html`<option value="${c.id}">${c.name} (@${c.handle} · ${c.writer})</option>`)}</select>
        <div class="error"></div>
        <div class="actions"><button type="button" class="danger" id="gi-leave">Leave group</button><span class="grow"></span><button type="button" data-close>Close</button><button type="submit" class="primary">Save</button></div>
      </form>`, {
      init: (d, close) => {
        $('#gi-add', d).addEventListener('change', async (e) => {
          const add = Number(e.target.value);
          if (!add) return;
          try { await api(`/api/phone/threads/${thread.id}/members`, { method: 'POST', body: { as: me.id, memberIds: [add] } }); toast('Added to the group'); close(true); refreshThread(); } catch (err) { toast(err.message); }
        });
        $('#gi-photo', d).addEventListener('click', () => attachSheet({
          max: 1,
          onPictures: async ([url]) => {
            if (!url) return;
            try { await api(`/api/phone/threads/${thread.id}`, { method: 'PUT', body: { as: me.id, photo: url } }); close(true); refreshThread(); } catch (err) { toast(err.message); }
          },
        }));
        d.addEventListener('click', async (e) => {
          const rm = e.target.closest('[data-gi-remove]');
          if (rm) {
            try { await api(`/api/phone/threads/${thread.id}/members/${rm.dataset.giRemove}?as=${me.id}`, { method: 'DELETE' }); close(true); refreshThread(); } catch (err) { toast(err.message); }
            return;
          }
          if (e.target.closest('#gi-leave')) {
            if (!(await confirmModal('Leave this group? You won’t get its texts any more.', { ok: 'Leave', danger: true }))) return;
            try { await api(`/api/phone/threads/${thread.id}/members/${me.id}?as=${me.id}`, { method: 'DELETE' }); close(true); replaceHash(`${phoneBase()}/${cid}`); } catch (err) { toast(err.message); }
          }
        });
      },
      submit: async (data) => {
        await api(`/api/phone/threads/${thread.id}`, { method: 'PUT', body: { as: me.id, title: data.title } });
        refreshThread();
        return true;
      },
    });
  }

  // The message box grows with what you write (up to about six lines), like iMessage.
  function fitInput() {
    input.style.setProperty('height', 'auto');
    input.style.setProperty('height', `${Math.min(input.scrollHeight, 140)}px`);
  }
  form.addEventListener('input', () => { form.classList.toggle('has-text', !!input.value.trim()); fitInput(); });
  // Enter sends on a computer (Shift+Enter for a new line); on a phone the return key adds a line.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
  });
  $('#ph-when', body).addEventListener('click', () => pickTime());

  // ---- Times: when a text or call happens in the story ----
  // Suggests realistic gaps after the last text (a reply a minute later, half an hour, the next morning…).
  function lastTime() {
    const all = [...byId.values()];
    return all.length ? new Date(Math.max(...all.map((m) => at(m.createdAt).getTime()))) : storyNow();
  }
  async function askTime(start, title) {
    const base = lastTime();
    const quick = [[1, 'a minute later'], [5, '5 min later'], [30, '30 min later'], [120, '2 hours later'], [60 * 9, 'next morning']];
    return modal(html`
      <form class="ph-time-form">
        <h2>${title}</h2>
        <p class="hint">The last text was ${whenLabel(base)}.</p>
        <div class="chips ph-time-quick">${quick.map(([mins, label]) => html`<button type="button" class="chip-btn" data-plus="${mins}">${label}</button>`)}</div>
        <label for="ph-time">Date and time</label>
        <input id="ph-time" name="when" type="datetime-local" value="${localValue(start || base)}" required>
        <div class="error"></div>
        <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Use this time</button></div>
      </form>`, {
      init: (d) => {
        d.addEventListener('click', (e) => {
          const q = e.target.closest('[data-plus]');
          if (!q) return;
          let t = new Date(base.getTime() + Number(q.dataset.plus) * 60000);
          // "Next morning": the next day at about 8–9.
          if (q.dataset.plus === String(60 * 9)) { t = new Date(base); t.setDate(t.getDate() + 1); t.setHours(8, Math.floor(Math.random() * 50), 0, 0); }
          $('#ph-time', d).value = localValue(t);
        });
      },
      submit: async (data) => {
        const t = new Date(data.when);
        if (Number.isNaN(t.getTime())) throw new Error('Pick a date and time');
        return t;
      },
    });
  }
  async function pickTime() {
    const t = await askTime(sendAt, 'When is this sent?');
    if (t) { sendAt = t; drawExtra(); }
  }
  async function placeCall() {
    const res = await modal(html`
      <form class="ph-call-form">
        <h2>${thread.group ? 'Call the group' : `Call ${thread.name}`}</h2>
        <div class="post-cat" role="radiogroup" aria-label="Kind of call">
          <label><input type="radio" name="video" value="" checked><span>${icons.phone} Voice</span></label>
          <label><input type="radio" name="video" value="1"><span>${icons.video} FaceTime</span></label>
        </div>
        <div class="post-cat" role="radiogroup" aria-label="Did they pick up?">
          <label><input type="radio" name="answered" value="1" checked><span>Picked up</span></label>
          <label><input type="radio" name="answered" value=""><span>No answer</span></label>
        </div>
        <div id="ph-call-len">
          <label>How long was the call?</label>
          <div class="row-inline"><input name="hours" type="number" min="0" max="23" value="0" aria-label="Hours"> <span>hr</span>
            <input name="minutes" type="number" min="0" max="59" value="5" aria-label="Minutes"> <span>min</span>
            <input name="seconds" type="number" min="0" max="59" value="0" aria-label="Seconds"> <span>sec</span></div>
        </div>
        <label for="ph-call-time">When</label>
        <input id="ph-call-time" name="when" type="datetime-local" value="${localValue(sendAt || storyNow())}">
        <p class="hint">Calls are just for the story. A call nobody picks up shows as a missed call for ${thread.group ? 'everyone' : thread.name}.</p>
        <div class="error"></div>
        <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Add call</button></div>
      </form>`, {
      init: (d) => d.addEventListener('change', () => { $('#ph-call-len', d).hidden = !d.querySelector('[name=answered]:checked').value; }),
      submit: async (data) => {
        const duration = (Number(data.hours) || 0) * 3600 + (Number(data.minutes) || 0) * 60 + (Number(data.seconds) || 0);
        const answered = !!data.answered;
        if (answered && duration <= 0) throw new Error('Give the call a length');
        const when = data.when ? new Date(data.when) : null;
        return (await api(`/api/phone/threads/${thread.id}/call`, { method: 'POST', body: { as: me.id, answered, video: !!data.video, duration, ...(when && !Number.isNaN(when.getTime()) ? { at: when.toISOString() } : {}) } })).message;
      },
    });
    if (res) { byId.set(res.id, res); draw(); }
  }
  // Texts go out one after another, in the order written: the box empties straight away so the next
  // one can be typed while the last is still sending (and comes back if sending fails).
  let queue = Promise.resolve();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !attached.length) return;
    const payload = { as: me.id, body: text, media: attached, replyTo: replying?.id ?? null, ...(sendAt ? { at: sendAt.toISOString() } : {}) };
    // A set time moves on a minute for the next text, so a run of texts reads naturally.
    if (sendAt) sendAt = new Date(sendAt.getTime() + 60000);
    input.value = '';
    fitInput();
    form.classList.remove('has-text');
    attached = [];
    replying = null;
    drawExtra();
    if (!showEmoji) input.focus();
    queue = queue.then(async () => {
      try {
        const { message } = await api(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: payload });
        byId.set(message.id, message);
        draw();
      } catch (err) {
        toast(err.message);
        if (!input.value) { input.value = text; fitInput(); form.classList.toggle('has-text', !!text); }
      }
    });
  });

  live('dm', (m) => {
    if (m.threadId !== thread.id || byId.has(m.id)) return;
    byId.set(m.id, m);
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 200;
    draw(near);
    if (document.visibilityState === 'visible') markRead();
  });
  live('dm-delete', ({ id, threadId }) => { if (threadId === thread.id && byId.delete(id)) draw(false); });
  live('dm-react', ({ id, threadId, reactions }) => {
    const m = byId.get(id);
    if (threadId !== thread.id || !m) return;
    byId.set(id, { ...m, reactions });
    draw(false);
  });
  live('dm-read', ({ threadId, characterId, lastId }) => {
    if (threadId !== thread.id || characterId === me.id || thread.group) return;
    if (lastId > thread.readUpTo) { thread.readUpTo = lastId; draw(false); }
  });
  live('dm-thread', ({ threadId }) => { if (threadId === thread.id) refreshThread(); });
  // Phones drop the live connection when locked or switched away from. When it comes back (and
  // every 15 seconds as a safety net), fetch any texts that arrived meanwhile.
  const catchUp = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const latest = await api(`/api/phone/threads/${thread.id}?as=${me.id}`);
      const fresh = latest.messages.filter((m) => !byId.has(m.id));
      // Tapbacks and "Read" can change without a new text, so take those too.
      let changed = latest.thread.readUpTo !== thread.readUpTo;
      thread.readUpTo = latest.thread.readUpTo;
      for (const m of latest.messages) {
        const old = byId.get(m.id);
        if (old && JSON.stringify(old.reactions) !== JSON.stringify(m.reactions)) { byId.set(m.id, m); changed = true; }
      }
      if (!fresh.length) { if (changed) draw(false); return; }
      fresh.forEach((m) => byId.set(m.id, m));
      draw(true);
      markRead();
    } catch { /* offline: try again later */ }
  };
  live('reconnect', catchUp);
  const poll = setInterval(catchUp, 15000);
  onLeave(() => clearInterval(poll));
}
