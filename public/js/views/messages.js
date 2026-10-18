// Messages: private, out-of-character conversations between writers (this replaced OOC channels).
// Computers show the conversation list and the open conversation side by side; phones show one at a time.
import {
  html,
  render,
  api,
  $,
  $$,
  toast,
  avatar,
  icons,
  menu,
  modal,
  promptModal,
  confirmModal,
  formatPost,
  plainText,
  userGrad,
  attachSheet,
  jumpToLatest,
} from '../lib.js';
import { state, page, routeAlive, ensureAlive, onLeave, bus, refreshHome } from '../main.js';
import { agoShort } from './social.js';

const live = (type, fn) => {
  const h = (e) => fn(e.detail);
  bus.addEventListener(type, h);
  onLeave(() => bus.removeEventListener(type, h));
};
const wide = () => matchMedia('(min-width: 900px)').matches;
const parse = (sql) => new Date(`${sql.replace(' ', 'T')}Z`);

// Start a conversation with anyone on NUUVI.
export async function newMessage() {
  const { writers } = await api('/api/directory');
  const others = writers.filter((w) => w.id !== state.user.id);
  const res = await modal(
    html`<div class="dm-pick">
    <h2>New message</h2>
    <input type="search" id="dm-q" placeholder="Search writers…" aria-label="Search writers">
    <div class="dm-pick-list" id="dm-pick-list">${others.map(
      (w) => html`
      <button type="button" class="dm-row" data-to="${w.id}" data-name="${`${w.username} ${w.displayName}`.toLowerCase()}">${avatar({ name: w.displayName, src: w.avatar, color: '#8F8D8E' })}
        <span class="grow"><b>${w.displayName}</b><small>@${w.username}</small></span></button>`,
    )}</div>
    <div class="actions end"><button type="button" data-close>Cancel</button></div>
  </div>`,
    {
      init: (d, close) => {
        $('#dm-q', d).addEventListener('input', (e) => {
          const q = e.target.value.toLowerCase();
          $$('[data-to]', d).forEach((b) => {
            b.hidden = q && !b.dataset.name.includes(q);
          });
        });
        d.addEventListener('click', (e) => {
          const b = e.target.closest('[data-to]');
          if (b) close(Number(b.dataset.to));
        });
      },
    },
  );
  if (res) location.hash = `#/messages/${res}`;
}

// People to talk to: everyone online first, then the other writers (tap one to open a chat).
function peopleStrip(writers) {
  const online = new Set(state.online);
  const people = writers
    .filter((w) => w.id !== state.user.id)
    .sort((a, b) => online.has(b.id) - online.has(a.id) || a.displayName.localeCompare(b.displayName));
  if (!people.length) return '';
  return html`<div class="dm-people no-swipe" aria-label="Start a chat">${people.slice(0, 40).map(
    (w) => html`
    <a class="dm-person" href="#/messages/${w.id}" title="Message ${w.displayName}">
      <span class="av-wrap ${online.has(w.id) ? 'is-online' : ''}">${avatar({ name: w.displayName, src: w.avatar, color: '#8F8D8E' })}<i class="online-dot"></i></span>
      <small>${w.displayName}</small></a>`,
  )}</div>`;
}

function conversationList(convos, activeId, writers = []) {
  return html`
    <div class="dm-list-head"><h2>Messages</h2><button type="button" class="icon-btn" id="dm-new" aria-label="New message" title="New message">${icons.edit || icons.plus}</button></div>
    ${peopleStrip(writers)}
    ${
      convos.length
        ? convos.map(
            (c) => html`
      <a class="dm-row ${c.unread ? 'unread' : ''} ${c.with.id === activeId ? 'active' : ''}" href="#/messages/${c.with.id}">
        ${avatar({ name: c.with.displayName, src: c.with.avatar, color: '#8F8D8E' })}
        <span class="grow"><b class="u-grad"${userGrad(c.with)}>${c.with.displayName}</b><small>${c.last ? `${c.last.mine ? 'You: ' : ''}${c.last.text}` : ''}</small></span>
        <span class="dm-meta">${c.lastAt ? html`<small>${agoShort(c.lastAt)}</small>` : ''}${c.unread ? html`<span class="badge">${c.unread}</span>` : ''}</span>
      </a>`,
          )
        : html`<div class="dm-empty"><p>No messages yet.</p><p class="small muted">Talk plots, plans and anything out of character, privately.</p><button class="primary sm" id="dm-new-2">New message</button></div>`
    }`;
}

export async function viewMessages(userIdStr) {
  const alive = routeAlive();
  const otherId = Number(userIdStr) || null;
  const showList = !otherId || wide();
  const [{ conversations }, chat, { writers }] = await Promise.all([
    showList ? api('/api/messages') : { conversations: [] },
    otherId ? api(`/api/messages/${otherId}`) : null,
    showList ? api('/api/directory').catch(() => ({ writers: [] })) : { writers: [] },
  ]);
  ensureAlive(alive);
  const other = chat?.with;
  const body = page({
    alive,
    title: other ? other.displayName : 'Messages',
    subtitle: other ? `@${other.username} · private` : 'Private conversations between writers',
    className: 'dm-body',
    body: html`<div class="dm-split ${otherId ? 'has-chat' : ''}">
      ${showList ? html`<section class="dm-list" id="dm-list">${conversationList(conversations, otherId, writers)}</section>` : ''}
      ${
        otherId
          ? html`<section class="dm-chat">
        <header class="dm-chat-head">
          <a class="dm-back" href="#/messages" aria-label="Back to messages">${icons.back}</a>
          <a href="#/u/${other.id}" class="dm-who">${avatar({ name: other.displayName, src: other.avatar, color: '#8F8D8E', size: 'sm' })}<span><b class="u-grad"${userGrad(other)}>${other.displayName}</b><small>@${other.username}</small></span></a>
        </header>
        <div class="dm-msgs" id="dm-msgs"></div>
        <div class="dm-replying" id="dm-replying" hidden></div>
        ${
          chat.blocked
            ? html`<p class="dm-blocked">You can't message each other.</p>`
            : html`
        <form class="chatbar" id="dm-form">
          <button type="button" class="chatbar-plus" id="dm-attach" aria-label="Add a photo">${icons.plus}</button>
          <input name="body" id="dm-input" autocomplete="off" placeholder="Message @${other.username}" aria-label="Message">
          <button type="submit" class="chatbar-send" aria-label="Send">${icons.send}</button>
        </form>`
        }
      </section>`
          : wide()
            ? html`<section class="dm-chat dm-pick-one"><div>${icons.chat}<p>Your messages</p><small class="muted">Pick a conversation, or start a new one.</small><button class="primary sm" id="dm-new-3">New message</button></div></section>`
            : ''
      }
    </div>`,
  });
  body.addEventListener('click', (e) => {
    if (e.target.closest('#dm-new, #dm-new-2, #dm-new-3')) newMessage();
  });
  const reloadList = async () => {
    const list = $('#dm-list', body);
    if (!list) return;
    render(list, conversationList((await api('/api/messages')).conversations, otherId, writers));
  };
  live('message', (m) => {
    if (!otherId || !m.between.includes(otherId)) reloadList().catch(() => {});
  });
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
    if (!sorted.length)
      items.push(
        html`<div class="dm-start">${avatar({ name: other.displayName, src: other.avatar, color: '#8F8D8E', size: 'xl' })}<h3>${other.displayName}</h3><p class="muted small">This is the start of your private messages with @${other.username}.</p></div>`,
      );
    for (const m of sorted) {
      const d = parse(m.createdAt);
      if (d.toDateString() !== day) {
        day = d.toDateString();
        items.push(
          html`<div class="dm-day"><span>${d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>`,
        );
      }
      const mine = m.userId === state.user.id;
      const who = mine ? state.user : other;
      const grouped = prev && prev.userId === m.userId && d - parse(prev.createdAt) < 5 * 60000 && !m.replyTo;
      // Discord-style: no bubbles. Picture, name and time once, then the messages underneath.
      items.push(html`<div class="dm-msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}" data-id="${m.id}">
        ${
          grouped
            ? html`<span class="dm-gutter"><time>${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></span>`
            : html`<a class="dm-av" href="#/u/${who.id}">${avatar({ name: who.displayName, src: who.avatar, color: '#8F8D8E' })}</a>`
        }
        <div class="dm-content">
          ${grouped ? '' : html`<div class="dm-meta-line"><span class="dm-name u-grad"${userGrad(who)}>${who.displayName}</span><time>${d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></div>`}
          ${m.replyTo ? html`<button type="button" class="dm-quote" data-jump="${m.replyTo.id}">${icons.reply}<b>${m.replyTo.userId === state.user.id ? state.user.displayName : other.displayName}</b><span>${plainText(m.replyTo.text) || (m.replyTo.hasMedia ? 'Photo' : '')}</span></button>` : ''}
          ${m.media.length ? html`<div class="b-pics n${Math.min(m.media.length, 4)}">${m.media.map((u) => html`<a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="" loading="lazy"></a>`)}</div>` : ''}
          ${m.body ? html`<div class="body">${formatPost(m.body)}${m.editedAt ? html` <small class="dm-edited" title="Edited">(edited)</small>` : ''}</div>` : ''}
        </div>
        <span class="dm-tools">
          <button type="button" data-reply="${m.id}" aria-label="Reply" title="Reply">${icons.reply}</button>
          ${mine && m.body ? html`<button type="button" data-edit="${m.id}" aria-label="Edit" title="Edit">✎</button>` : ''}
          ${mine ? html`<button type="button" data-del="${m.id}" aria-label="Delete" title="Delete">✕</button>` : ''}
        </span>
      </div>`);
      prev = m;
    }
    render(list, html`${items}`);
    if (stick) list.scrollTop = list.scrollHeight;
  };
  draw();
  jumpToLatest(list);
  const markRead = () =>
    api(`/api/messages/${otherId}/read`, { method: 'POST', body: {} })
      .then(() => refreshHome())
      .catch(() => {});
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
    const j = e.target.closest('[data-jump]');
    if (j) {
      $(`.dm-msg[data-id="${j.dataset.jump}"]`, list)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const rep = e.target.closest('[data-reply]');
    if (rep) {
      startReply(msgs.get(Number(rep.dataset.reply)));
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      editMessage(msgs.get(Number(ed.dataset.edit)));
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) deleteMessage(Number(del.dataset.del));
  });
  // Hold a message (phones) or right-click it: Reply, Edit, Copy, Delete.
  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.dm-msg');
    if (!row || e.target.closest('a[href]:not([target])')) return;
    e.preventDefault();
    const m = msgs.get(Number(row.dataset.id));
    if (!m) return;
    const mine = m.userId === state.user.id;
    menu(row.querySelector('.dm-content') || row, [
      { label: 'Reply', action: () => startReply(m) },
      mine && m.body && { label: 'Edit', action: () => editMessage(m) },
      m.body && {
        label: 'Copy text',
        action: async () => {
          try {
            await navigator.clipboard.writeText(plainText(m.body));
            toast('Copied');
          } catch {
            toast('Couldn’t copy');
          }
        },
      },
      mine && { label: 'Delete', danger: true, action: () => deleteMessage(m.id) },
    ]);
  });
  async function deleteMessage(mid) {
    if (!(await confirmModal('Delete this message for both of you?', { ok: 'Delete', danger: true }))) return;
    try {
      await api(`/api/messages/item/${mid}`, { method: 'DELETE' });
      msgs.delete(mid);
      draw(false);
    } catch (err) {
      toast(err.message);
    }
  }
  async function editMessage(m) {
    const text = await promptModal('Edit message', { value: m.body, multiline: true, maxlength: 4000, ok: 'Save' });
    if (text === null || text.trim() === m.body) return;
    try {
      const { message } = await api(`/api/messages/item/${m.id}`, { method: 'PUT', body: { body: text.trim() } });
      msgs.set(message.id, message);
      draw(false);
    } catch (err) {
      toast(err.message);
    }
  }
  let replying = null;
  const replyBox = $('#dm-replying', body);
  function drawReply() {
    replyBox.hidden = !replying;
    render(
      replyBox,
      replying
        ? html`<div class="reply-bar">${icons.reply}<span>Replying to <b>${replying.userId === state.user.id ? 'yourself' : other.displayName}</b><small>${plainText(replying.body) || 'Photo'}</small></span>
      <button type="button" class="icon-btn sm" id="dm-unreply" aria-label="Cancel reply">✕</button></div>`
        : '',
    );
  }
  replyBox.addEventListener('click', (e) => {
    if (e.target.closest('#dm-unreply')) {
      replying = null;
      drawReply();
    }
  });
  function startReply(m) {
    if (!m || chat.blocked) return;
    replying = m;
    drawReply();
    $('#dm-input', body)?.focus();
  }
  live('message', (m) => {
    if (!m.between.includes(otherId) || !m.between.includes(state.user.id)) return;
    msgs.set(m.id, m);
    draw();
    if (m.userId !== state.user.id) markRead();
    reloadList().catch(() => {});
  });
  live('message-delete', ({ id }) => {
    if (msgs.delete(id)) draw(false);
  });
  live('message-edit', (m) => {
    if (msgs.has(m.id)) {
      msgs.set(m.id, m);
      draw(false);
    }
  });
  // Phones drop the live connection when locked or switched away from. When it comes back (and
  // every 15 seconds as a safety net), fetch anything that arrived meanwhile.
  const catchUp = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const latest = await api(`/api/messages/${otherId}`);
      const fresh = latest.messages.filter((m) => !msgs.has(m.id));
      if (!fresh.length) return;
      fresh.forEach((m) => msgs.set(m.id, m));
      draw();
      if (fresh.some((m) => m.userId !== state.user.id)) markRead();
    } catch {
      /* offline: try again later */
    }
  };
  live('reconnect', catchUp);
  const poll = setInterval(catchUp, 15000);
  onLeave(() => clearInterval(poll));

  const form = $('#dm-form', body);
  if (!form) return;
  const input = $('#dm-input', body);
  const send = async (payload) => {
    try {
      const { message } = await api(`/api/messages/${otherId}`, {
        method: 'POST',
        body: { ...payload, replyTo: replying?.id ?? null },
      });
      msgs.set(message.id, message);
      replying = null;
      drawReply();
      draw();
    } catch (err) {
      toast(err.message);
    }
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
  $('#dm-attach', body).addEventListener('click', () => attachSheet({ onPictures: (urls) => send({ media: urls }) }));
  if (wide()) input.focus();
}
