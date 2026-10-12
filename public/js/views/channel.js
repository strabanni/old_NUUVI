// A channel inside a story: the post feed, turn order bar and composer.
import {
  html, raw, esc, render, applyColors, api, $, $$, store, toast, avatar, icons, menu, modal, confirmModal, promptModal,
  formatPost, timeStamp, minutesBetween, words, bindForm, uploadImage, askImageLink, plainText, gradAttr,
} from '../lib.js';
import {
  state, page, loadStory, myCharacters, onLeave, bus, refreshHome, refreshBlocks, copyText, routeAlive, ensureAlive, KIND_LABELS, kindIcon, channelIcon,
} from '../main.js';
import { statusPill, openThreadForm } from './threads.js';

const nameOf = (u) => u?.displayName ?? 'someone';
// Small post time for episodes: "7:34 PM" today, "Oct 12" before that (full time on hover).
const shortTime = (sql) => {
  const d = new Date(`${sql.replace(' ', 'T')}Z`);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
};

// Every formatting code, with what it looks like.
const FORMATS = [
  ['*action*', 'italic action'], ['**bold**', 'bold'], ['__underline__', 'underline'], ['~~strike~~', 'strikethrough'],
  ['"dialogue"', 'dialogue'], ['||spoiler||', 'hidden until tapped'], ['> quote', 'a quote (start the line with >)'], ['@username', 'mention someone'],
  ['[center]…[/center]', 'centered (can hold paragraphs)'], ['[right]…[/right]', 'right-aligned'], ['[box]…[/box]', 'a box in your character’s color'],
  ['[h]Heading[/h]', 'a big heading'], ['[hr]', 'a divider line (on its own line)'], ['[color=#ff7aa2]…[/color]', 'any color, as a #hex code'],
  ['[size=small]…[/size]', 'small, big or huge'], ['[caps]…[/caps]', 'ALL CAPS'], ['[b] [i] [u] [s]', 'bold, italic, underline, strike'],
  ['[img]https://…[/img]', 'a picture from a link'], ['[url=https://…]text[/url]', 'a link'],
];
function formattingGuide() {
  modal(html`
    <div class="fmt-guide">
      <h2>Formatting</h2>
      <p class="muted small">Mix and match these to build your own post layouts. Formatted words take your character’s color.</p>
      <dl>${FORMATS.map(([code, what]) => html`<dt><code>${code}</code></dt><dd>${what}</dd>`)}</dl>
      <div class="actions end"><button type="button" class="primary" data-close>Got it</button></div>
    </div>`);
}

function dayLabel(sqlDate) {
  if (!sqlDate) return '';
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export async function viewChannel(storyIdStr, channelIdStr) {
  const alive = routeAlive();
  const storyId = Number(storyIdStr);
  const cached = state.story?.story.id === storyId;
  const s = cached ? state.story : await loadStory(storyId);
  if (cached) loadStory(storyId).catch(() => {}); // refresh unread counts in the background

  ensureAlive(alive);
  // No channel picked: go to the last one you used, or the first.
  if (!channelIdStr) {
    const last = Number(store.get(`nuuvi:last-channel:${storyId}`));
    // First visit to a story with lore: start on its overview.
    if (!last && s.story.hasOverview) return location.replace(`#/s/${storyId}/overview`);
    const target = s.channels.find((c) => c.id === last) ?? s.channels[0];
    return location.replace(`#/s/${storyId}/${target.id}`);
  }
  const channelId = Number(channelIdStr);
  const channel = () => state.story.channels.find((c) => c.id === channelId);
  if (!channel()) return location.replace(`#/s/${storyId}`);
  store.set(`nuuvi:last-channel:${storyId}`, String(channelId));

  // Content warning gate, once per story per device.
  const story = s.story;
  if ((story.contentWarnings.length || story.rating === 'M') && !store.get(`nuuvi:cw-ok:${storyId}`) && s.role !== 'owner') {
    const body = page({
    alive,
      title: story.title,
      body: html`
        <div class="card narrow cw-gate">
          <div class="cw-icon">${icons.warn}</div>
          <h2>Before you read</h2>
          ${story.rating === 'M' ? html`<p>This story is rated <strong>Mature</strong>.</p>` : ''}
          ${story.contentWarnings.length ? html`<p>It contains:</p><div class="tags center">${story.contentWarnings.map((w) => html`<span class="tag cw">${w}</span>`)}</div>` : ''}
          <div class="actions center"><a class="btn" href="#/home">Go back</a><button class="primary" id="cw-ok">Continue</button></div>
        </div>`,
    });
    $('#cw-ok', body).addEventListener('click', () => {
      store.set(`nuuvi:cw-ok:${storyId}`, '1');
      viewChannel(storyIdStr, channelIdStr);
    });
    return;
  }

  const role = s.role;
  const characters = role ? await myCharacters(true) : []; // always fresh (characters may be made on another device)
  const unreadAtOpen = channel().unread;
  const [{ posts: initial, hasMore: initialMore }, detail] = await Promise.all([
    api(`/api/channels/${channelId}/posts`),
    api(`/api/channels/${channelId}`),
  ]);
  const participants = detail.participants;
  // For comms: who you're texting, by the contact names you chose.
  const commsTitle = () => participants.filter((x) => x.userId !== state.user?.id)
    .map((x) => (detail.contacts || {})[x.id] || x.name).join(', ');
  // Threads and events read like a forum; comms and OOC read like a chat.
  const storyStyle = () => ['thread', 'event'].includes(channel().kind);
  const posts = new Map(initial.map((p) => [p.id, p]));
  let hasMore = initialMore;

  // First unread post (for the "new" divider): walk back over others' posts.
  let dividerBefore = null;
  if (unreadAtOpen) {
    let n = unreadAtOpen;
    for (const p of [...initial].reverse()) {
      if (p.userId !== state.user?.id) n -= 1;
      if (n <= 0) { dividerBefore = p.id; break; }
    }
    dividerBefore ??= initial[0]?.id ?? null;
  }

  const c = channel();
  const body = page({
    alive,
    title: c.kind === 'comms' && commsTitle() ? html`<span class="hash-title">${channelIcon(c)}</span>${commsTitle()}` : html`<span class="hash-title">${channelIcon(c)}</span>${c.name}`,
    subtitle: c.topic || (c.kind === 'ooc' ? 'Out of character' : `${KIND_LABELS[c.kind]} · ${({ open: 'open', closed: 'private', complete: 'complete' })[c.status]}`),
    actions: html`
      <button class="btn sm starred-btn" id="starred-btn" title="Starred moments" hidden>${icons.star}<b>0</b></button>
      ${detail.canManage && c.kind !== 'ooc' ? html`<button class="icon-btn" id="edit-thread" title="Episode details" aria-label="Episode details">${icons.gear}</button>` : ''}`,
    className: 'channel-body',
    body: html`
      <div class="feed-scroll" id="feed-scroll">
        <div class="feed" id="feed" aria-live="polite"></div>
      </div>
      <div id="turn-bar"></div>
      <div id="composer-wrap"></div>`,
  });
  const feed = $('#feed', body);
  const scroller = $('#feed-scroll', body);

  // ---------- Feed rendering ----------
  const blocked = (p) => state.blocks.has(p.userId);

  const charLink = (ch) => html`<a href="#/c/${ch.id}">${ch.name}</a>`;

  // "AKA ✱ THE PRODIGY, (HE/HIM) ; TWENTY8 ; CEO OF …" from the character's tagline and details.
  // The "aka" line is written by the character's owner; **text** shows in pink.
  function akaLine(ch) {
    if (!ch.aka) return '';
    return html`<div class="tp-aka">${raw(esc(ch.aka).replace(/\*\*(.+?)\*\*/g, '<b class="accent">$1</b>'))}</div>`;
  }

  // Comms show your own contact names for other people's characters.
  const contacts = detail.contacts || {};
  const shownName = (ch) => (channel().kind === 'comms' && ch.userId !== state.user?.id && contacts[ch.id]) || ch.name;
  const starred = new Set(detail.starred || []);

  function cwWrap(p, content) {
    return p.cw ? html`<div class="cw-wrap"><button class="cw-toggle" type="button">${icons.warn} CW: ${p.cw} — tap to show</button><div class="cw-content">${content}</div></div>` : content;
  }

  const menuBtn = html`<button class="icon-btn sm post-menu" data-act="menu" aria-label="Post options">${icons.more}</button>`;

  // Forum-style thread post (in-character or narration in a thread / event).
  // Thread posts alternate sides on their own: the name/picture flips whenever a different writer posts.
  function threadPost(p, side = 'left') {
    const ch = p.kind === 'ic' ? p.character : null;
    const others = participants.filter((x) => x.id !== ch?.id);
    const pic = ch?.avatar || ch?.portrait;
    return html`
      <article class="tpost align-${side} ${p.userId === state.user?.id ? 'mine' : ''} ${starred.has(p.id) ? 'is-starred' : ''}" id="post-${p.id}" data-id="${p.id}" ${ch ? html`data-color="${ch.color}"${gradAttr(ch)}` : ''}>
        <header class="tp-head">
          <div class="tp-id">
            ${ch ? html`<a class="tp-name" href="#/c/${ch.id}">${ch.name}</a>${akaLine(ch)}`
              : html`<span class="tp-name narrator">the narrator</span><div class="tp-aka"><span class="muted">written by</span> <a href="#/u/${p.userId}">${p.author.displayName}</a></div>`}
          </div>
          ${ch ? html`<a class="tp-avatar" href="#/c/${ch.id}" aria-label="${ch.name}">${pic ? html`<img src="${pic}" alt="">` : avatar({ name: ch.name, color: ch.color, size: 'xl square' })}</a>`
            : html`<span class="tp-avatar narrator-av">${icons.mask}</span>`}
        </header>
        <div class="tp-bar">
          <span class="tp-when"><time title="${timeStamp(p.createdAt)}">${shortTime(p.createdAt)}</time>${p.editedAt ? ' · edited' : ''}</span>
          ${ch ? html`<a href="#/c/${ch.id}" class="tp-act">${icons.profile}<span>Open profile</span></a>` : html`<a href="#/u/${p.userId}" class="tp-act">${icons.profile}<span>Open profile</span></a>`}
          <button class="tp-act star-btn" type="button" data-act="star" aria-pressed="${starred.has(p.id)}">${starred.has(p.id) ? icons.star : icons.starOutline}<span>${starred.has(p.id) ? 'Starred' : 'Star'}</span></button>
          ${menuBtn}
        </div>
        <div class="tp-body">
          <div class="tp-star">${icons.star}</div>
          ${cwWrap(p, html`${p.body ? html`<div class="body">${formatPost(p.body)}</div>` : ''}${pictures(p)}`)}
          <footer class="tp-foot">
            <span>${p.wordCount} words</span>
            ${others.length ? html`<span>for ${others.map((o, i) => html`${i ? ', ' : ''}${charLink(o)}`)}</span>` : ''}
          </footer>
        </div>
      </article>`;
  }

  // Chat bubble (comms texts, OOC chatter, and OOC asides inside threads).
  function bubble(p, prev) {
    const mine = p.userId === state.user?.id;
    const ch = p.kind === 'ic' ? p.character : null;
    const name = ch ? shownName(ch) : p.kind === 'narration' ? 'Narrator' : p.author.displayName;
    const key = (x) => `${x.userId}:${x.kind}:${x.character?.id ?? ''}`;
    const grouped = prev && !blocked(prev) && key(prev) === key(p) && minutesBetween(prev.createdAt, p.createdAt) < 10 && p.id !== dividerBefore && dayLabel(prev.createdAt) === dayLabel(p.createdAt);
    const av = ch ? avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'sm' }) : avatar({ name: p.author.displayName, src: p.author.avatar, color: '#48484A', size: 'sm' });
    return html`
      <article class="bubble ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} kind-${p.kind}" id="post-${p.id}" data-id="${p.id}" ${ch ? html`data-color="${ch.color}"${gradAttr(ch)}` : ''}>
        ${mine ? '' : html`<a class="b-av" href="${ch ? `#/c/${ch.id}` : `#/u/${p.userId}`}">${grouped ? '' : av}</a>`}
        <div class="b-col">
          ${grouped ? '' : html`<div class="b-name">${ch ? html`<a href="#/c/${ch.id}" class="cast-name" data-color="${ch.color}">${name}</a>` : html`<a href="#/u/${p.userId}">${name}</a>`}${p.kind === 'ooc' && storyStyle() ? html` <span class="ooc-badge">OOC</span>` : ''}</div>`}
          <div class="b-bubble ${p.body ? '' : 'pics-only'}">
            ${p.replyTo ? html`<button type="button" class="b-reply" data-act="jump" data-to="${p.replyTo.id}" data-color="${p.replyTo.color || ''}">
              ${icons.reply}<b>${p.replyTo.name}</b><span>${p.replyTo.text || (p.replyTo.hasMedia ? 'Picture' : '')}</span></button>` : ''}
            ${cwWrap(p, html`${pictures(p)}${p.body ? html`<div class="body">${formatPost(p.body)}</div>` : ''}`)}
            <span class="b-time">${timeStamp(p.createdAt).replace(/^Today at /, '')}${p.editedAt ? ' · edited' : ''}</span>
            ${state.user && role ? html`<button class="icon-btn sm b-reply-btn" data-act="reply" aria-label="Reply" title="Reply">${icons.reply}</button>` : ''}
            ${menuBtn}
          </div>
        </div>
      </article>`;
  }

  // Pictures attached to a message (uploads or picture links). Tap to open full size.
  function pictures(p) {
    if (!p.media?.length) return '';
    return html`<div class="b-pics n${Math.min(p.media.length, 4)}">${p.media.map((u) => html`
      <a href="${u}" target="_blank" rel="noopener noreferrer"><img src="${u}" alt="" loading="lazy"></a>`)}</div>`;
  }

  function postHtml(p, prev, side) {
    if (blocked(p)) {
      return html`<article class="post blocked" id="post-${p.id}" data-id="${p.id}">
        <div class="blocked-note">Post from a blocked user. <button class="link" data-act="reveal">Show</button></div>
        <div class="hidden-content">${cwWrap(p, html`<div class="body">${formatPost(p.body)}</div>`)}</div></article>`;
    }
    return storyStyle() && p.kind !== 'ooc' ? threadPost(p, side) : bubble(p, prev);
  }

  // Top of a thread: title, status, tags, cast and the plot box.
  function threadHead() {
    const ch = channel();
    const when = ch.eventAt ? new Date(ch.eventAt) : null;
    if (!storyStyle() && ch.kind !== 'comms') {
      return html`<div class="channel-start"><div class="big-hash">${kindIcon(ch.kind)}</div><h2>Welcome to #${ch.name}</h2><p class="muted">${ch.topic || 'This is the beginning of the channel.'}</p></div>`;
    }
    return html`
      <section class="thread-head">
        ${when ? html`<div class="event-date"><span>${when.toLocaleDateString(undefined, { month: 'short' })}</span><b>${when.getDate()}</b></div>` : ''}
        <span class="eyebrow">${KIND_LABELS[ch.kind]} · ${state.story.story.title}</span>
        ${ch.icon ? html`<span class="th-icon">${channelIcon(ch)}</span>` : ''}
        <h1 class="th-title">${ch.kind === 'comms' && commsTitle() ? commsTitle() : ch.name}</h1>
        ${ch.kind === 'comms' ? html`<p class="muted small">${commsTitle() ? `${ch.name} · ` : ''}<button class="link" id="contacts-btn" type="button">Edit contact names</button></p>` : ''}
        <div class="th-meta">
          ${statusPill(ch)}
          ${when ? html`<span class="pill-tag">${when.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>` : ''}
          ${ch.tags.map((t) => html`<span class="tag">#${t}</span>`)}
        </div>
        ${participants.length ? html`<div class="th-cast">${participants.map((x) => html`<a class="chip-link" href="#/c/${x.id}">${avatar({ name: x.name, src: x.avatar, color: x.color, size: 'xs' })}${x.name}</a>`)}</div>` : ''}
        ${ch.summary ? html`<div class="plot-box"><span class="plot-star">${icons.star}</span>
          ${participants.length ? html`<b class="plot-title">${participants.slice(0, 3).map((x) => x.name).join(' × ')}</b> ` : ''}${ch.summary}</div>` : ''}
      </section>`;
  }

  function drawFeed({ keepScroll = false } = {}) {
    const list = [...posts.values()].sort((a, b) => a.id - b.id);
    const before = scroller.scrollHeight - scroller.scrollTop;
    let prev = null;
    let side = 'right';
    let lastWriter = null;
    const items = [];
    if (hasMore) items.push(html`<div class="load-more"><button id="load-more">Load earlier posts</button></div>`);
    else items.push(threadHead());
    for (const p of list) {
      const day = dayLabel(p.createdAt);
      if (day !== dayLabel(prev?.createdAt)) items.push(html`<div class="day-pill"><span>${day}</span></div>`);
      if (p.id === dividerBefore) items.push(html`<div class="new-divider">New</div>`);
      if (storyStyle() && p.kind !== 'ooc') {
        const writer = p.kind === 'ic' && p.character ? `c${p.character.id}` : `u${p.userId}`;
        if (writer !== lastWriter) side = side === 'left' ? 'right' : 'left';
        lastWriter = writer;
      }
      items.push(postHtml(p, prev, side));
      prev = p;
    }
    feed.classList.toggle('chat-style', !storyStyle());
    render(feed, html`${items}`);
    if (keepScroll) scroller.scrollTop = scroller.scrollHeight - before;
  }

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
  const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

  drawFeed();
  const divider = $('.new-divider', feed);
  if (divider) divider.scrollIntoView({ block: 'center' });
  else toBottom();
  // Images can change the height after first paint; stay pinned to the bottom if you were there.
  requestAnimationFrame(() => { if (!divider) toBottom(); });
  feed.addEventListener('load', (e) => {
    if (e.target.tagName === 'IMG' && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < e.target.offsetHeight + 200) toBottom();
  }, true);

  // ---------- Read state ----------
  let readTimer;
  function markRead() {
    if (!role || document.visibilityState !== 'visible') return;
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      const ch = channel();
      if (!ch) return;
      const lastId = Math.max(0, ...posts.keys());
      await api(`/api/channels/${channelId}/read`, { method: 'POST', body: { lastId } }).catch(() => {});
      ch.unread = 0;
      ch.mentions = 0;
      refreshHome().catch(() => {});
    }, 600);
  }
  markRead();

  // ---------- Feed interactions ----------
  feed.addEventListener('click', async (e) => {
    if (e.target.id === 'load-more') {
      e.target.disabled = true;
      const first = Math.min(...posts.keys());
      const older = await api(`/api/channels/${channelId}/posts?before=${first}`);
      for (const p of older.posts) posts.set(p.id, p);
      hasMore = older.hasMore;
      drawFeed({ keepScroll: true });
      return;
    }
    const spoiler = e.target.closest('.spoiler');
    if (spoiler) { spoiler.classList.add('revealed'); return; }
    // On touch screens a message's reply / ⋯ buttons appear when you tap it.
    const tapped = e.target.closest('.bubble');
    if (tapped && !e.target.closest('a, button, .b-pics')) {
      const wasOpen = tapped.classList.contains('show-actions');
      $$('.bubble.show-actions', feed).forEach((x) => x.classList.remove('show-actions'));
      if (!wasOpen) tapped.classList.add('show-actions');
    }
    const cw = e.target.closest('.cw-toggle');
    if (cw) { cw.parentElement.classList.toggle('open'); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const article = btn.closest('[data-id]');
    const p = posts.get(Number(article.dataset.id));
    if (btn.dataset.act === 'reveal') { article.classList.toggle('revealed'); return; }
    if (btn.dataset.act === 'jump') { jumpTo(Number(btn.dataset.to)); return; }
    if (btn.dataset.act === 'reply') { startReply(p); return; }
    if (btn.dataset.act === 'menu') postMenu(btn, p, article);
    if (btn.dataset.act === 'star') toggleStar(p);
  });

  function postMenu(anchor, p, article) {
    const mine = p.userId === state.user?.id;
    const canDelete = mine || role === 'owner' || state.user?.isAdmin;
    menu(anchor, [
      mine && { label: 'Edit', action: () => editPost(p, article) },
      { label: starred.has(p.id) ? 'Remove star' : 'Star this moment', action: () => toggleStar(p) },
      { label: 'Copy text', action: () => copyText(p.body, 'Copied') },
      role && !storyStyle() && { label: 'Reply', action: () => startReply(p) },
      role && storyStyle() && !mine && { label: `Mention ${p.author.displayName}`, action: () => mention(p.author.username) },
      !mine && state.user && { label: 'Report post', action: () => reportPost(p) },
      !mine && state.user && (state.blocks.has(p.userId)
        ? { label: `Unblock ${p.author.displayName}`, action: () => toggleBlock(p.author, false) }
        : { label: `Block ${p.author.displayName}`, danger: true, action: () => toggleBlock(p.author, true) }),
      canDelete && { label: 'Delete', danger: true, action: () => deletePost(p) },
    ]);
  }

  function editPost(p, article) {
    const content = $('.tp-body, .b-bubble, .content', article);
    render(content, html`
      <form class="edit-form">
        <textarea name="body" rows="6">${p.body}</textarea>
        <input name="cw" maxlength="100" placeholder="Content warning (optional)" value="${p.cw}">
        <div class="error"></div>
        <div class="actions"><button type="submit" class="primary">Save</button><button type="button" data-cancel>Cancel</button><span class="hint">Esc to cancel</span></div>
      </form>`);
    const form = $('form', content);
    const ta = $('textarea', form);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const cancel = () => drawFeed({ keepScroll: true });
    form.querySelector('[data-cancel]').addEventListener('click', cancel);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });
    bindForm(form, async (data) => {
      const { post } = await api(`/api/posts/${p.id}`, { method: 'PUT', body: data });
      posts.set(post.id, post);
      drawFeed({ keepScroll: true });
    });
  }

  async function deletePost(p) {
    if (!(await confirmModal('Delete this post? This cannot be undone.', { ok: 'Delete', danger: true }))) return;
    try {
      await api(`/api/posts/${p.id}`, { method: 'DELETE' });
      posts.delete(p.id);
      drawFeed({ keepScroll: true });
    } catch (err) { toast(err.message); }
  }

  async function reportPost(p) {
    const reason = await promptModal('Report this post', {
      label: 'What is wrong with it? Only admins will see this.', multiline: true, ok: 'Send report', maxlength: 1000,
    });
    if (!reason) return;
    try {
      await api(`/api/posts/${p.id}/report`, { method: 'POST', body: { reason } });
      toast('Report sent to the admins');
    } catch (err) { toast(err.message); }
  }

  async function toggleBlock(u, block) {
    if (block && !(await confirmModal(`Block ${u.displayName}? Their posts will be hidden for you, they won't be able to notify you, and they can't join stories you own.`, { ok: 'Block', danger: true }))) return;
    await api(block ? '/api/blocks' : `/api/blocks/${u.id}`, { method: block ? 'POST' : 'DELETE', body: block ? { userId: u.id } : undefined });
    await refreshBlocks();
    drawFeed({ keepScroll: true });
    toast(block ? `${u.displayName} is blocked` : `${u.displayName} is unblocked`);
  }

  // ---------- Turn bar ----------
  const turnBar = $('#turn-bar', body);
  function drawTurns() {
    const t = channel()?.turns;
    if (!t?.enabled || !t.order.length) return render(turnBar, html``);
    const member = (id) => state.story.members.find((m) => m.id === id);
    const mine = t.current === state.user?.id;
    render(turnBar, html`
      <div class="turn-bar ${mine ? 'mine' : ''}">
        <span class="turn-icon">${icons.hourglass}</span>
        <span class="turn-text">${mine ? html`<strong>It's your turn!</strong>` : html`Waiting on <strong>${nameOf(member(t.current))}</strong>`}</span>
        <span class="turn-order no-swipe">${t.order.map((id, i) => html`${i ? ' → ' : ''}<span class="${id === t.current ? 'current' : ''}">${nameOf(member(id))}</span>`)}</span>
        ${mine ? html`<button class="sm" id="turn-pass">Pass</button>` : role === 'owner' ? html`<button class="sm" id="turn-pass">Skip</button>` : ''}
      </div>`);
    $('#turn-pass', turnBar)?.addEventListener('click', async () => {
      try { await api(`/api/channels/${channelId}/turns/advance`, { method: 'POST', body: {} }); } catch (err) { toast(err.message); }
    });
  }
  drawTurns();

  // ---------- Composer ----------
  const wrap = $('#composer-wrap', body);
  let mention = () => {};
  let startReply = () => {};
  if (role && !detail.canPost) {
    render(wrap, html`<div class="composer-locked">${channel().status === 'complete' ? 'This episode is complete — it\'s read-only now.' : 'This is a private episode for the characters in it.'}</div>`);
  } else if (!role) {
    render(wrap, state.user
      ? html`<div class="composer-locked">${story.status === 'open' ? html`You're reading as a guest. <button class="primary sm" id="join-here">Join to write</button>` : 'This story is closed to new writers.'}</div>`
      : html`<div class="composer-locked"><a href="#/">Sign in</a> to write.</div>`);
    $('#join-here', wrap)?.addEventListener('click', () => $('#side-join')?.click());
  } else {
    setupComposer();
  }

  function setupComposer() {
    const draftKey = `nuuvi:draft:${channelId}`;
    const asKey = `nuuvi:as:${storyId}`;
    const isOocChannel = channel().kind === 'ooc';
    // identity: "c:<id>" | "narration" | "ooc"
    let identity = store.get(asKey) || '';
    const valid = (v) => v === 'narration' || v === 'ooc' || (v.startsWith('c:') && characters.some((ch) => `c:${ch.id}` === v));
    if (isOocChannel) identity = 'ooc';
    else if (!valid(identity)) identity = characters.length ? `c:${characters[0].id}` : 'narration';
    let cw = '';

    render(wrap, html`
      <form class="composer" id="composer">
        <div class="composer-extra" id="composer-extra" hidden></div>
        <div class="composer-top">
          <button type="button" class="identity no-swipe" id="identity" aria-label="Choose who you're writing as"></button>
          <span class="cw-chip" id="cw-chip" hidden></span>
          <span class="spacer"></span>
          <span class="hint" id="wc">0 words</span>
        </div>
        <div class="composer-box">
          <div class="composer-tools"><button type="button" class="icon-btn" id="more-btn" title="Content warning & more" aria-label="More options">${icons.plus}</button></div>
          <textarea id="post-body" name="body" rows="1" aria-label="Write a post"></textarea>
          <div class="composer-tools"><button type="submit" class="icon-btn send" title="Post (Ctrl+Enter)" aria-label="Post">${icons.send}</button></div>
        </div>
        <div class="error"></div>
      </form>`);

    const form = $('#composer', wrap);
    const ta = $('#post-body', form);
    const idBtn = $('#identity', form);
    const wc = $('#wc', form);
    const cwChip = $('#cw-chip', form);
    const extra = $('#composer-extra', form);
    let attached = [];
    let replying = null;

    // Reply bar and attached pictures, above the text box.
    function drawExtra() {
      extra.hidden = !replying && !attached.length;
      render(extra, html`
        ${replying ? html`<div class="reply-bar">${icons.reply}<span>Replying to <b>${replying.character ? shownName(replying.character) : replying.author.displayName}</b>
          <small>${plainText(replying.body) || 'Picture'}</small></span><button type="button" class="icon-btn sm" id="reply-cancel" aria-label="Cancel reply">✕</button></div>` : ''}
        ${attached.length ? html`<div class="attach-row">${attached.map((u, i) => html`
          <span class="thumb"><img src="${u}" alt=""><button type="button" data-unattach="${i}" aria-label="Remove picture">✕</button></span>`)}</div>` : ''}`);
    }
    extra.addEventListener('click', (e) => {
      if (e.target.closest('#reply-cancel')) { replying = null; drawExtra(); return; }
      const rm = e.target.closest('[data-unattach]');
      if (rm) { attached.splice(Number(rm.dataset.unattach), 1); drawExtra(); }
    });
    startReply = (p) => { replying = p; drawExtra(); ta.focus(); };
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.multiple = true;
    picker.hidden = true;
    form.append(picker);
    picker.addEventListener('change', async () => {
      for (const f of [...picker.files].slice(0, 10 - attached.length)) {
        try { toast('Uploading…'); attached.push(await uploadImage(f, 1600)); } catch (err) { toast(err.message); }
      }
      picker.value = '';
      drawExtra();
    });
    const addPictureLink = async () => {
      const url = await askImageLink();
      if (url) { attached.push(url); drawExtra(); }
    };

    function drawIdentity() {
      const ch = identity.startsWith('c:') ? characters.find((x) => `c:${x.id}` === identity) : null;
      render(idBtn, ch
        ? html`${avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'xs' })}<span data-color="${ch.color}" class="id-name">${ch.name}</span>${icons.chevron}`
        : identity === 'narration'
          ? html`<span class="avatar xs narrator-av">${icons.mask}</span><span class="id-name">Narrator</span>${icons.chevron}`
          : html`${avatar({ name: state.user.displayName, src: state.user.avatar, size: 'xs' })}<span class="id-name">${state.user.displayName} <small>(OOC)</small></span>${icons.chevron}`);
      ta.placeholder = ch ? `Write as ${ch.name}…` : identity === 'narration' ? 'Describe the scene…' : `Message #${channel().name}`;
    }
    drawIdentity();

    idBtn.addEventListener('click', () => menu(idBtn, [
      ...characters.map((ch) => ({ label: `${identity === `c:${ch.id}` ? '✓ ' : ''}${ch.name}`, action: () => setIdentity(`c:${ch.id}`) })),
      { label: `${identity === 'narration' ? '✓ ' : ''}Narrator`, action: () => setIdentity('narration') },
      { label: `${identity === 'ooc' ? '✓ ' : ''}Out of character (you)`, action: () => setIdentity('ooc') },
      { label: '+ New character…', action: () => { location.hash = '#/characters'; } },
    ]));
    function setIdentity(v) {
      identity = v;
      if (!isOocChannel) store.set(asKey, v);
      drawIdentity();
      ta.focus();
    }

    const autosize = () => {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight + 2, window.innerHeight * 0.45)}px`;
    };
    ta.value = store.get(draftKey) || '';
    const update = () => { wc.textContent = `${words(ta.value)} words`; autosize(); };
    update();
    ta.addEventListener('input', () => { store.set(draftKey, ta.value); update(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
    });

    const askCw = async () => {
      const v = await promptModal('Content warning', { label: 'Readers will have to tap to reveal this post.', value: cw, placeholder: 'e.g. gore, spiders', ok: 'Set', maxlength: 100 });
      if (v === null) return;
      cw = v.trim();
      cwChip.hidden = !cw;
      cwChip.textContent = `CW: ${cw} ✕`;
    };
    cwChip.addEventListener('click', () => { cw = ''; cwChip.hidden = true; });

    const moreBtn = $('#more-btn', form);
    moreBtn.addEventListener('click', () => menu(moreBtn, [
      attached.length < 10 && { label: 'Add pictures…', action: () => picker.click() },
      attached.length < 10 && { label: 'Add a picture link…', action: addPictureLink },
      { label: `${cw ? 'Change' : 'Add'} content warning`, action: askCw },
      detail.canManage && channel().kind !== 'ooc' && { label: 'Episode details…', action: editThread },
      channel().kind === 'comms' && { label: 'Contact names…', action: editContacts },
      { label: 'Formatting guide', action: formattingGuide },
    ]));

    async function sendPost(payload) {
      const { post } = await api(`/api/channels/${channelId}/posts`, { method: 'POST', body: payload });
      posts.set(post.id, post);
      dividerBefore = null;
      drawFeed();
      toBottom();
    }

    function payloadBase() {
      if (identity.startsWith('c:')) return { kind: 'ic', characterId: Number(identity.slice(2)) };
      return { kind: identity };
    }

    bindForm(form, async () => {
      const text = ta.value.trim();
      if (!text && !attached.length) return;
      await sendPost({ ...payloadBase(), body: text, cw, media: attached, replyTo: replying?.id ?? null });
      ta.value = '';
      cw = '';
      attached = [];
      replying = null;
      drawExtra();
      cwChip.hidden = true;
      store.set(draftKey, null);
      update();
    });

    mention = (username) => {
      const insert = `@${username} `;
      ta.value = ta.value ? `${ta.value.replace(/\s*$/, ' ')}${insert}` : insert;
      update();
      ta.focus();
    };

    if (!characters.length && !isOocChannel) {
      const note = document.createElement('p');
      note.className = 'hint pad-x';
      render(note, html`No characters yet — <a href="#/characters">create one</a> to write in character. You can still narrate or chat OOC.`);
      form.prepend(note);
    }
  }

  async function toggleStar(p) {
    const on = starred.has(p.id);
    try {
      await api(`/api/posts/${p.id}/star`, { method: on ? 'DELETE' : 'POST', body: on ? undefined : {} });
      if (on) starred.delete(p.id); else starred.add(p.id);
      drawFeed({ keepScroll: true });
      drawStarBtn();
      toast(on ? 'Star removed' : 'Starred — find it again from ★ at the top');
    } catch (err) { toast(err.message); }
  }

  // Jump back to a starred moment (loading older posts if needed).
  async function jumpTo(postId) {
    while (!posts.has(postId) && hasMore) {
      const first = Math.min(...posts.keys());
      const older = await api(`/api/channels/${channelId}/posts?before=${first}`);
      for (const p of older.posts) posts.set(p.id, p);
      hasMore = older.hasMore;
    }
    drawFeed({ keepScroll: true });
    const el = $(`#post-${postId}`, feed);
    if (!el) return toast('That post was deleted');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  function drawStarBtn() {
    const b = $('#main #starred-btn');
    if (!b) return;
    b.hidden = !starred.size;
    b.querySelector('b').textContent = starred.size;
  }
  $('#main #starred-btn')?.addEventListener('click', async (e) => {
    const anchor = e.currentTarget;
    const known = posts;
    menu(anchor, [...starred].sort((x, y) => x - y).map((id) => {
      const p = known.get(id);
      const who = p ? (p.character?.name || p.author.displayName) : 'Earlier post';
      const snip = p ? plainText(p.body, 60) : '';
      return { label: `★ ${who}${snip ? ` — ${snip}` : ''}`, action: () => jumpTo(id) };
    }));
  });
  drawStarBtn();

  async function editContacts() {
    const others = participants.filter((x) => x.userId !== state.user?.id);
    if (!others.length) return toast('No one else is in this chat yet');
    const res = await modal(html`
      <form>
        <h2>Contact names</h2>
        <p class="muted small">Only you see these. They're what this chat — and every other text from them — shows as for you.</p>
        ${others.map((x) => html`<label for="cn-${x.id}">${x.name}</label><input id="cn-${x.id}" name="${x.id}" maxlength="60" value="${contacts[x.id] || ''}" placeholder="${x.name}">`)}
        <div class="error"></div>
        <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save</button></div>
      </form>`);
    if (!res) return;
    await Promise.all(Object.entries(res).map(([cid, name]) => api(`/api/contacts/${cid}`, { method: 'PUT', body: { name } })));
    viewChannel(storyIdStr, channelIdStr);
  }

  async function editThread() {
    const updated = await openThreadForm({ storyId, channel: { ...channel(), participantIds: participants.map((x) => x.id) } });
    if (updated) viewChannel(storyIdStr, channelIdStr);
  }
  $('#main #edit-thread')?.addEventListener('click', editThread);
  feed.addEventListener('click', (e) => { if (e.target.closest('#contacts-btn')) editContacts(); });

  // ---------- Live updates ----------
  const on = (type, fn) => {
    const h = (e) => fn(e.detail);
    bus.addEventListener(type, h);
    onLeave(() => bus.removeEventListener(type, h));
  };
  on('post', (p) => {
    if (p.channelId !== channelId || posts.has(p.id)) return;
    const stick = nearBottom();
    posts.set(p.id, p);
    drawFeed({ keepScroll: !stick });
    if (stick) toBottom();
    markRead();
  });
  on('edit', (p) => {
    if (p.channelId !== channelId) return;
    if ($(`#post-${p.id} form`, feed)) { posts.set(p.id, p); return; } // don't clobber an open editor
    posts.set(p.id, p);
    drawFeed({ keepScroll: true });
  });
  on('delete', ({ id }) => {
    if (posts.delete(id)) drawFeed({ keepScroll: true });
  });
  on('channel', (ch) => { if (ch.id === channelId) drawTurns(); });
  on('story-updated', () => {
    if (!channel()) { location.hash = `#/s/${storyId}`; return; }
    $('.head-title h1', document).lastChild.textContent = channel().name;
    drawTurns();
  });
  on('reconnect', async () => {
    const after = Math.max(0, ...posts.keys());
    const { posts: missed } = await api(`/api/channels/${channelId}/posts?after=${after}`).catch(() => ({ posts: [] }));
    if (!missed.length) return;
    const stick = nearBottom();
    for (const p of missed) posts.set(p.id, p);
    drawFeed({ keepScroll: !stick });
    if (stick) toBottom();
    markRead();
  });
  onLeave(() => clearTimeout(readTimer));
  applyColors(document.querySelector('#main'));
}
