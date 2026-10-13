// Messages: private, out-of-character conversations between writers (this replaced OOC channels).
// Computers show the conversation list and the open conversation side by side; phones show one at a time.
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, formatPost, uploadImage, askImageLink, userGrad } from '../lib.js';
import { state, page, routeAlive, ensureAlive, onLeave, bus, refreshHome } from '../main.js';
import { agoShort } from './social.js';

const live = (type, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(type, h); onLeave(() => bus.removeEventListener(type, h)); };
const wide = () => matchMedia('(min-width: 900px)').matches;
const parse = (sql) => new Date(`${sql.replace(' ', 'T')}Z`);

// Start a conversation with anyone on NUUVI.
export async function newMessage() {
  const { writers } = await api('/api/directory');
  const others = writers.filter((w) => w.id !== state.user.id);
  const res = await modal(html`<div class="dm-pick">
    <h2>New message</h2>
    <input type="search" id="dm-q" placeholder="Search writers…" aria-label="Search writers">
    <div class="dm-pick-list" id="dm-pick-list">${others.map((w) => html`
      <button type="button" class="dm-row" data-to="${w.id}" data-name="${`${w.username} ${w.displayName}`.toLowerCase()}">${avatar({ name: w.displayName, src: w.avatar, color: '#8F8D8E' })}
        <span class="grow"><b>${w.displayName}</b><small>@${w.username}</small></span></button>`)}</div>
    <div class="actions end"><button type="button" data-close>Cancel</button></div>
  </div>`, {
    init: (d, close) => {
      $('#dm-q', d).addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('[data-to]', d).forEach((b) => { b.hidden = q && !b.dataset.name.includes(q); }); });
      d.addEventListener('click', (e) => { const b = e.target.closest('[data-to]'); if (b) close(Number(b.dataset.to)); });
    },
  });
  if (res) location.hash = `#/messages/${res}`;
}

function conversationList(convos, activeId) {
  return html`
    <div class="dm-list-head"><h2>Messages</h2><button type="button" class="icon-btn" id="dm-new" aria-label="New message" title="New message">${icons.edit || icons.plus}</button></div>
    ${convos.length ? convos.map((c) => html`
      <a class="dm-row ${c.unread ? 'unread' : ''} ${c.with.id === activeId ? 'active' : ''}" href="#/messages/${c.with.id}">
        ${avatar({ name: c.with.displayName, src: c.with.avatar, color: '#8F8D8E' })}
        <span class="grow"><b class="u-grad"${userGrad(c.with)}>${c.with.displayName}</b><small>${c.last ? `${c.last.mine ? 'You: ' : ''}${c.last.text}` : ''}</small></span>
        <span class="dm-meta">${c.lastAt ? html`<small>${agoShort(c.lastAt)}</small>` : ''}${c.unread ? html`<span class="badge">${c.unread}</span>` : ''}</span>
      </a>`) : html`<div class="dm-empty"><p>No messages yet.</p><p class="small muted">Talk plots, plans and anything out of character — privately.</p><button class="primary sm" id="dm-new-2">New message</button></div>`}`;
}

export async function viewMessages(userIdStr) {
  const alive = routeAlive();
  const otherId = Number(userIdStr) || null;
  const showList = !otherId || wide();
  const [{ conversations }, chat] = await Promise.all([
    showList ? api('/api/messages') : { conversations: [] },
    otherId ? api(`/api/messages/${otherId}`) : null,
  ]);
  ensureAlive(alive);
  const other = chat?.with;
  const body = page({
    alive,
    title: other ? other.displayName : 'Messages',
    subtitle: other ? `@${other.username} · private` : 'Private conversations between writers',
    className: 'dm-body',
    body: html`<div class="dm-split ${otherId ? 'has-chat' : ''}">
      ${showList ? html`<section class="dm-list" id="dm-list">${conversationList(conversations, otherId)}</section>` : ''}
      ${otherId ? html`<section class="dm-chat">
        <header class="dm-chat-head">
          <a class="dm-back" href="#/messages" aria-label="Back to messages">${icons.back}</a>
          <a href="#/u/${other.id}" class="dm-who">${avatar({ name: other.displayName, src: other.avatar, color: '#8F8D8E', size: 'sm' })}<span><b class="u-grad"${userGrad(other)}>${other.displayName}</b><small>@${other.username}</small></span></a>
        </header>
        <div class="dm-msgs" id="dm-msgs"></div>
        ${chat.blocked ? html`<p class="dm-blocked">You can't message each other.</p>` : html`
        <form class="chatbar" id="dm-form">
          <button type="button" class="chatbar-plus" id="dm-attach" aria-label="Add a photo">${icons.plus}</button>
          <input name="body" id="dm-input" autocomplete="off" placeholder="Message @${other.username}" aria-label="Message">
          <button type="submit" class="chatbar-send" aria-label="Send">${icons.send}</button>
        </form>`}
      </section>` : wide() ? html`<section class="dm-chat dm-pick-one"><div>${icons.chat}<p>Your messages</p><small class="muted">Pick a conversation, or start a new one.</small><button class="primary sm" id="dm-new-3">New message</button></div></section>` : ''}
    </div>`,
  });
  body.addEventListener('click', (e) => { if (e.target.closest('#dm-new, #dm-new-2, #dm-new-3')) newMessage(); });
  const reloadList = async () => {
    const list = $('#dm-list', body);
    if (!list) return;
    render(list, conversationList((await api('/api/messages')).conversations, otherId));
  };
  live('message', (m) => { if (!otherId || !m.between.includes(otherId)) reloadList().catch(() => {}); });
  if (!otherId) return;

  // ---- The open conversation ----
  const msgs = new Map(chat.messages.map((m) => [m.id, m]));
  let hasMore = chat.hasMore;
  const list = $('#dm-msgs', body);
  const draw = (stick = true) => {
    const sorted = [...msgs.values()].sort((a, b) => a.id - b.id);
    let day = null;
    let prev = null;
    const items = [];
    if (hasMore) items.push(html`<button type="button" class="ph-more" id="dm-more">Earlier messages</button>`);
    if (!sorted.length) items.push(html`<div class="dm-start">${avatar({ name: other.displayName, src: other.avatar, color: '#8F8D8E', size: 'xl' })}<h3>${other.displayName}</h3><p class="muted small">This is the start of your private messages with @${other.username}.</p></div>`);
    for (const m of sorted) {
      const d = parse(m.createdAt);
      if (d.toDateString() !== day) { day = d.toDateString(); items.push(html`<div class="dm-day"><span>${d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>`); }
      const mine = m.userId === state.user.id;
      const grouped = prev && prev.userId === m.userId && d - parse(prev.createdAt) < 5 * 60000;
      items.push(html`<div class="dm-msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}" data-id="${m.id}">
        <div class="dm-bubble">
          ${m.media.length ? html`<div class="b-pics n${Math.min(m.media.length, 4)}">${m.media.map((u) => html`<a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="" loading="lazy"></a>`)}</div>` : ''}
          ${m.body ? html`<div class="body">${formatPost(m.body)}</div>` : ''}
          <time>${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
        </div>
        ${mine ? html`<button type="button" class="dm-del" data-del="${m.id}" aria-label="Delete">✕</button>` : ''}
      </div>`);
      prev = m;
    }
    render(list, html`${items}`);
    if (stick) list.scrollTop = list.scrollHeight;
  };
  draw();
  const markRead = () => api(`/api/messages/${otherId}/read`, { method: 'POST', body: {} }).then(() => refreshHome()).catch(() => {});
  markRead();
  list.addEventListener('click', async (e) => {
    if (e.target.closest('#dm-more')) {
      const first = Math.min(...msgs.keys());
      const older = await api(`/api/messages/${otherId}?before=${first}`);
      older.messages.forEach((m) => msgs.set(m.id, m));
      hasMore = older.hasMore;
      const h = list.scrollHeight;
      draw(false);
      list.scrollTop = list.scrollHeight - h;
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) { await api(`/api/messages/item/${del.dataset.del}`, { method: 'DELETE' }); msgs.delete(Number(del.dataset.del)); draw(false); }
  });
  live('message', (m) => {
    if (!m.between.includes(otherId) || !m.between.includes(state.user.id)) return;
    msgs.set(m.id, m);
    draw();
    if (m.userId !== state.user.id) markRead();
    reloadList().catch(() => {});
  });
  live('message-delete', ({ id }) => { if (msgs.delete(id)) draw(false); });

  const form = $('#dm-form', body);
  if (!form) return;
  const input = $('#dm-input', body);
  const send = async (payload) => {
    try {
      const { message } = await api(`/api/messages/${otherId}`, { method: 'POST', body: payload });
      msgs.set(message.id, message);
      draw();
    } catch (err) { toast(err.message); }
  };
  form.addEventListener('input', () => form.classList.toggle('has-text', !!input.value.trim()));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    form.classList.remove('has-text');
    send({ body: text });
  });
  $('#dm-attach', body).addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Upload a photo', action: () => {
      const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*';
      f.onchange = async () => { try { send({ media: [await uploadImage(f.files[0], 1600)] }); } catch (err) { toast(err.message); } };
      f.click();
    } },
    { label: 'Photo or GIF link', action: async () => { const u = await askImageLink(); if (u) send({ media: [u] }); } },
  ]));
  if (wide()) input.focus();
}
