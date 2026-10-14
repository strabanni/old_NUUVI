// Phones: each character has one, with contacts and private one-to-one texts.
// Styled after a modern messaging app: a soft gradient header, a contact strip and a chat list,
// and conversations on a gradient with small frosted bubbles.
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, promptModal, formatPost, uploadImage, askImageLink, plainText, applyColors, store, attachSheet, jumpToLatest } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive, onLeave, bus, loadStory, replaceHash, previousHash } from '../main.js';

const lastKey = 'nuuvi:phone';
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

// Pick a character to add as a contact (anyone in the directory).
async function pickContact(me, existing) {
  const { writers } = await api('/api/directory');
  const all = writers.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w.username })))
    .filter((c) => c.id !== me.id && !existing.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  return modal(html`
    <form class="pick-contact">
      <h2>Add a contact</h2>
      <input type="search" class="search" id="pc-q" placeholder="Search characters…" aria-label="Search characters" autocomplete="off">
      <div class="pc-list" id="pc-list"></div>
      <label for="pc-name">Save them as <span class="muted small">(optional — only you see this)</span></label>
      <input id="pc-name" name="name" maxlength="60" placeholder="e.g. hyung 🖤">
      <input type="hidden" name="contactId" required>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Add contact</button></div>
    </form>`, {
    init: (d) => {
      const list = $('#pc-list', d);
      const form = d.querySelector('form');
      const draw = (q = '') => {
        const shown = all.filter((c) => !q || `${c.name} ${c.handle} ${c.writer}`.toLowerCase().includes(q));
        render(list, shown.length ? html`${shown.slice(0, 60).map((c) => html`
          <button type="button" class="pc-item ${String(c.id) === form.contactId.value ? 'on' : ''}" data-pick="${c.id}">
            ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}<span class="grow"><b>${c.name}</b><small>@${c.handle} · ${c.writer}</small></span></button>`)}`
          : html`<p class="muted small">No one matches.</p>`);
      };
      draw();
      $('#pc-q', d).addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        form.contactId.value = b.dataset.pick;
        $$('.pc-item', list).forEach((x) => x.classList.toggle('on', x === b));
      });
    },
    submit: async (data) => {
      if (!data.contactId) throw new Error('Pick someone first');
      return (await api(`/api/phone/${me.id}/contacts`, { method: 'POST', body: { contactId: Number(data.contactId), name: data.name } })).contact;
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

// The phone's home: search, "Let's Stay Connected", the contact strip and the conversation list.
// Used on its own (phones) and as the left column beside a conversation (computers).
export function mountPhoneList(root, { cid, mine, data: initial, activeTid = null }) {
  let data = initial;
  const me = data.character;
  let q = '';

  function draw() {
    const contacts = data.contacts.filter((c) => !q || c.name.toLowerCase().includes(q));
    // The conversation that's open beside the list has just been read.
    const threads = data.threads.map((t) => (t.id === activeTid ? { ...t, unread: 0 } : t)).filter((t) => !q || t.name.toLowerCase().includes(q) || (t.last?.text || '').toLowerCase().includes(q));
    render(root, html`
      <section class="ph-hero">
        <div class="ph-top">
          <label class="ph-search">${icons.search}<input type="search" id="ph-q" placeholder="Search…" value="${q}" aria-label="Search contacts and messages"></label>
          <button type="button" class="ph-switch" id="ph-switch" aria-label="Switch phone" title="Switch phone">${avatar({ name: me.name, src: me.avatar, color: me.color, size: 'xs' })}${icons.chevron}</button>
        </div>
        <h1>Let's Stay<br>Connected</h1>
        <div class="ph-contacts no-swipe">
          <button type="button" class="ph-contact add" id="ph-add"><span class="ph-av">${icons.plus}</span><span>Add</span></button>
          ${contacts.map((c) => html`
            <button type="button" class="ph-contact" data-open="${c.id}" title="${c.name}"><span class="ph-av">${avatar({ name: c.character.name, src: c.character.avatar, color: c.character.color })}</span><span>${c.name}</span></button>`)}
        </div>
      </section>
      <section class="ph-list">
        ${threads.length ? threads.map((t) => html`
          <a class="ph-row ${t.unread ? 'unread' : ''} ${t.id === activeTid ? 'active' : ''}" href="${phoneBase()}/${me.id}/t/${t.id}" data-contact="${t.other.id}">
            <span class="ph-row-av">${avatar({ name: t.other.name, src: t.other.avatar, color: t.other.color })}</span>
            <span class="grow"><b>${t.name}</b><small>${t.last ? `${t.last.mine ? 'You: ' : ''}${t.last.text}` : 'Say hi 👋'}</small></span>
            <span class="ph-meta">${t.lastAt ? html`<small>${shortWhen(t.lastAt)}</small>` : ''}${t.unread ? html`<span class="badge">${t.unread}</span>` : ''}</span>
          </a>`) : html`<div class="ph-empty"><p>No messages yet.</p><p class="small">Tap <b>Add</b> to save someone's number, then tap them to text.</p></div>`}
      </section>`);
    applyColors(root);
  }
  draw();

  const reload = async () => { data = await api(`/api/phone/${cid}`); draw(); };
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
    if (e.target.closest('#ph-add')) {
      const added = await pickContact(me, new Set(data.contacts.map((x) => x.id)));
      if (added) { toast(`${added.name} saved to contacts`); reload(); }
      return;
    }
    const sw = e.target.closest('#ph-switch');
    if (sw) {
      menu(sw, mine.map((m) => ({ label: `${m.id === cid ? '✓ ' : ''}${m.name}'s phone`, action: () => { location.hash = `${phoneBase()}/${m.id}`; } })));
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
      || (() => { const t = data.threads.find((x) => x.other.id === id); return t && { id, name: t.name, character: t.other }; })();
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
}

// ---------- A conversation ----------
export async function viewPhoneThread(cidStr, tidStr) {
  const alive = routeAlive();
  await keepStory();
  const cid = Number(cidStr);
  let { thread, messages, hasMore } = await api(`/api/phone/threads/${tidStr}?as=${cid}`);
  ensureAlive(alive);
  const me = thread.me;
  const other = thread.other;
  const byId = new Map(messages.map((m) => [m.id, m]));
  let replying = null;
  let attached = [];

  const wide = matchMedia('(min-width: 900px)').matches;
  const body = page({ alive, title: thread.name, subtitle: `@${other.handle}`, className: 'phone-body', body: html`
    <div class="phone-split">${wide ? html`<div class="phone" id="phone"></div>` : ''}
    <div class="phone chat">
      <section class="ph-chat">
        <header class="ph-chat-head">
          <a class="ph-back" href="${phoneBase()}/${cid}" data-ph-back aria-label="Back">${icons.back}</a>
          <a class="ph-chat-av" href="#/c/${other.id}">${avatar({ name: other.name, src: other.avatar, color: other.color, size: 'sm' })}</a>
          <h2>${thread.name}</h2>
          <span class="ph-chat-actions">
            <button type="button" class="ph-pill" id="ph-call" aria-label="Call">${icons.phone}</button>
            <a class="ph-pill" href="#/c/${other.id}" aria-label="Contact profile">${icons.card}</a>
          </span>
        </header>
        <div class="ph-msgs" id="ph-msgs"></div>
      </section>
      <div class="ph-extra" id="ph-extra" hidden></div>
      <form class="chatbar ph-compose" id="ph-compose">
        <button type="button" class="chatbar-plus" id="ph-attach" aria-label="Add a photo">${icons.plus}</button>
        <input name="body" id="ph-input" autocomplete="off" placeholder="Message ${thread.name}" aria-label="Message">
        <button type="submit" class="chatbar-send" aria-label="Send">${icons.send}</button>
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
  const form = $('#ph-compose', body);
  const input = $('#ph-input', body);
  const extra = $('#ph-extra', body);

  const bubble = (m) => {
    const mine = m.characterId === me.id;
    const reply = m.replyTo ? byId.get(m.replyTo.id) : null;
    return html`
      <div class="ph-msg ${mine ? 'mine' : ''}" data-id="${m.id}">
        <div class="ph-bubble">
          ${m.replyTo ? html`<button type="button" class="ph-quote" data-jump="${m.replyTo.id}">${icons.reply}<span>${m.replyTo.text || (m.replyTo.hasMedia ? 'Photo' : '')}</span></button>` : ''}
          ${m.media.length ? html`<div class="b-pics n${Math.min(m.media.length, 4)}">${m.media.map((u) => html`<a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="" loading="lazy"></a>`)}</div>` : ''}
          ${m.body ? html`<span class="ph-text">${formatPost(m.body)}</span>` : ''}
          <time>${clock(m.createdAt)}</time>
        </div>
        <span class="ph-tools"><button type="button" data-reply="${m.id}" aria-label="Reply">${icons.reply}</button>${mine ? html`<button type="button" data-del="${m.id}" aria-label="Delete">✕</button>` : ''}</span>
      </div>`;
  };
  const dayOf = (m) => new Date(`${m.createdAt.replace(' ', 'T')}Z`).toDateString();
  function draw(stick = true) {
    const sorted = [...byId.values()].sort((a, b) => a.id - b.id);
    let prevDay = null;
    const items = [];
    if (hasMore) items.push(html`<button type="button" class="ph-more" id="ph-more">Earlier messages</button>`);
    for (const m of sorted) {
      if (dayOf(m) !== prevDay) {
        prevDay = dayOf(m);
        const d = new Date(`${m.createdAt.replace(' ', 'T')}Z`);
        items.push(html`<div class="ph-day">${d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>`);
      }
      items.push(bubble(m));
    }
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
    extra.hidden = !replying && !attached.length;
    render(extra, html`
      ${replying ? html`<div class="reply-bar">${icons.reply}<span>Replying to <b>${replying.characterId === me.id ? 'yourself' : thread.name}</b><small>${plainText(replying.body) || 'Photo'}</small></span>
        <button type="button" class="icon-btn sm" id="ph-unreply" aria-label="Cancel reply">✕</button></div>` : ''}
      ${attached.length ? html`<div class="attach-row">${attached.map((u, i) => html`<span class="thumb"><img src="${u}" alt=""><button type="button" data-unattach="${i}" aria-label="Remove">✕</button></span>`)}</div>` : ''}`);
  }
  extra.addEventListener('click', (e) => {
    if (e.target.closest('#ph-unreply')) { replying = null; drawExtra(); }
    const rm = e.target.closest('[data-unattach]');
    if (rm) { attached.splice(Number(rm.dataset.unattach), 1); drawExtra(); }
  });

  list.addEventListener('click', async (e) => {
    if (e.target.closest('#ph-more')) {
      const first = Math.min(...byId.keys());
      const older = await api(`/api/phone/threads/${thread.id}?as=${me.id}&before=${first}`);
      for (const m of older.messages) byId.set(m.id, m);
      hasMore = older.hasMore;
      const keep = list.scrollHeight - list.scrollTop;
      draw(false);
      list.scrollTop = list.scrollHeight - keep;
      return;
    }
    const j = e.target.closest('[data-jump]');
    if (j) { $(`.ph-msg[data-id="${j.dataset.jump}"]`, list)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const r = e.target.closest('[data-reply]');
    if (r) { replying = byId.get(Number(r.dataset.reply)); drawExtra(); input.focus(); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!(await confirmModal('Delete this message for everyone?', { ok: 'Delete', danger: true }))) return;
      await api(`/api/phone/messages/${del.dataset.del}`, { method: 'DELETE' }).catch((err) => toast(err.message));
      return;
    }
    // Tap a message to show its reply / delete buttons (phones).
    const msg = e.target.closest('.ph-msg');
    if (msg && !e.target.closest('a')) {
      const open = msg.classList.contains('show-tools');
      $$('.ph-msg.show-tools', list).forEach((x) => x.classList.remove('show-tools'));
      if (!open) msg.classList.add('show-tools');
    }
  });

  $('#ph-attach', body).addEventListener('click', () => attachSheet({
    max: Math.max(0, 10 - attached.length),
    onPictures: (urls) => { attached.push(...urls.slice(0, 10 - attached.length)); drawExtra(); },
  }));
  $('#ph-call', body).addEventListener('click', () => toast(`Calling ${thread.name}… 📞 (calls are just for the story)`));
  // The phone's own back arrow is a real "back": if the page before was this phone's list, step back
  // to it (so the top Back button keeps working); otherwise swap to the list without adding a step.
  $('[data-ph-back]', body).addEventListener('click', (e) => {
    e.preventDefault();
    const list = e.currentTarget.getAttribute('href');
    if (previousHash() === list) history.back(); else replaceHash(list);
  });

  let sending = false;
  form.addEventListener('input', () => form.classList.toggle('has-text', !!input.value.trim()));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if ((!text && !attached.length) || sending) return;
    sending = true;
    try {
      const { message } = await api(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: { as: me.id, body: text, media: attached, replyTo: replying?.id ?? null } });
      byId.set(message.id, message);
      input.value = '';
      form.classList.remove('has-text');
      attached = [];
      replying = null;
      drawExtra();
      draw();
    } catch (err) { toast(err.message); } finally { sending = false; input.focus(); }
  });

  live('dm', (m) => {
    if (m.threadId !== thread.id || byId.has(m.id)) return;
    byId.set(m.id, m);
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 200;
    draw(near);
    if (document.visibilityState === 'visible') markRead();
  });
  live('dm-delete', ({ id, threadId }) => { if (threadId === thread.id && byId.delete(id)) draw(false); });
  // Phones drop the live connection when locked or switched away from. When it comes back (and
  // every 15 seconds as a safety net), fetch any texts that arrived meanwhile.
  const catchUp = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const latest = await api(`/api/phone/threads/${thread.id}?as=${me.id}`);
      const fresh = latest.messages.filter((m) => !byId.has(m.id));
      if (!fresh.length) return;
      fresh.forEach((m) => byId.set(m.id, m));
      draw(true);
      markRead();
    } catch { /* offline: try again later */ }
  };
  live('reconnect', catchUp);
  const poll = setInterval(catchUp, 15000);
  onLeave(() => clearInterval(poll));
}
