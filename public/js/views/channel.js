// A channel inside a story: the post feed, turn order bar and composer.
import {
  html, render, applyColors, api, $, $$, store, toast, avatar, icons, menu, modal, confirmModal, promptModal,
  formatPost, timeStamp, minutesBetween, words, bindForm,
} from '../lib.js';
import { state, page, loadStory, myCharacters, onLeave, bus, refreshHome, refreshBlocks, copyText, routeAlive, ensureAlive } from '../main.js';

const nameOf = (u) => u?.displayName ?? 'someone';

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
  const characters = role ? await myCharacters() : [];
  const unreadAtOpen = channel().unread;
  const { posts: initial, hasMore: initialMore } = await api(`/api/channels/${channelId}/posts`);
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
    title: html`<span class="hash-title">${icons.hash}</span>${c.name}`,
    subtitle: c.topic,
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
  const identityKey = (p) => `${p.userId}:${p.kind}:${p.character?.id ?? ''}`;

  function postHeader(p) {
    if (p.kind === 'ic' && p.character) {
      return html`<a href="#/c/${p.character.id}" class="name" data-color="${p.character.color}">${p.character.name}</a>
        <span class="by">played by <a href="#/u/${p.userId}">${p.author.displayName}</a></span>`;
    }
    if (p.kind === 'narration') return html`<span class="name narrator">Narrator</span><span class="by">by <a href="#/u/${p.userId}">${p.author.displayName}</a></span>`;
    if (p.kind === 'roll' && p.character) {
      return html`<a href="#/c/${p.character.id}" class="name" data-color="${p.character.color}">${p.character.name}</a>
        <span class="by">rolled by <a href="#/u/${p.userId}">${p.author.displayName}</a></span>`;
    }
    return html`<a href="#/u/${p.userId}" class="name plain">${p.author.displayName}</a>${p.kind === 'ooc' ? html`<span class="ooc-badge">OOC</span>` : ''}`;
  }

  function postAvatar(p) {
    if ((p.kind === 'ic' || p.kind === 'roll') && p.character) return avatar({ name: p.character.name, src: p.character.avatar, color: p.character.color, size: 'lg' });
    if (p.kind === 'narration') return html`<span class="avatar lg narrator-av" aria-hidden="true">${icons.mask}</span>`;
    return avatar({ name: p.author.displayName, src: p.author.avatar, color: '#6b6880', size: 'lg' });
  }

  function rollHtml(r) {
    const parts = r.terms.map((t, i) => {
      const sign = i === 0 ? (t.sign < 0 ? '−' : '') : t.sign < 0 ? ' − ' : ' + ';
      return t.dice ? html`${sign}${t.dice} <span class="rolls">[${t.rolls.join(', ')}]</span>` : html`${sign}${t.value}`;
    });
    return html`<div class="roll-card">${icons.dice}<span class="expr">${parts}</span><span class="total">${r.total}</span></div>`;
  }

  function postBody(p) {
    const content = html`
      ${p.roll ? rollHtml(p.roll) : ''}
      ${p.body ? html`<div class="body">${formatPost(p.body)}</div>` : ''}`;
    return p.cw ? html`<div class="cw-wrap"><button class="cw-toggle" type="button">${icons.warn} CW: ${p.cw} — tap to show</button><div class="cw-content">${content}</div></div>` : content;
  }

  function postHtml(p, prev) {
    if (blocked(p)) {
      return html`<article class="post blocked" id="post-${p.id}" data-id="${p.id}">
        <div class="blocked-note">Post from a blocked user. <button class="link" data-act="reveal">Show</button></div>
        <div class="hidden-content">${postBody(p)}</div></article>`;
    }
    const grouped = prev && !blocked(prev) && identityKey(prev) === identityKey(p) && minutesBetween(prev.createdAt, p.createdAt) < 10 && p.id !== dividerBefore && dayLabel(prev.createdAt) === dayLabel(p.createdAt);
    const color = (p.kind === 'ic' || p.kind === 'roll') && p.character ? p.character.color : '';
    return html`
      <article class="post kind-${p.kind} ${grouped ? 'grouped' : ''} ${p.userId === state.user?.id ? 'mine' : ''}" id="post-${p.id}" data-id="${p.id}" ${color ? html`data-color="${color}"` : ''}>
        <div class="gutter">${grouped ? html`<time class="hover-time">${timeStamp(p.createdAt).replace(/^.* at /, '')}</time>` : postAvatar(p)}</div>
        <div class="content">
          ${grouped ? '' : html`<header>${postHeader(p)}<time title="${p.createdAt} UTC">${timeStamp(p.createdAt)}</time></header>`}
          ${postBody(p)}
          <footer class="post-meta">${p.wordCount ? html`<span>${p.wordCount} words</span>` : ''}${p.editedAt ? html`<span>edited</span>` : ''}<span class="meta-time">${timeStamp(p.createdAt).replace(/^Today at /, '')}</span></footer>
          <button class="icon-btn sm post-menu" data-act="menu" aria-label="Post options">${icons.more}</button>
        </div>
      </article>`;
  }

  function drawFeed({ keepScroll = false } = {}) {
    const list = [...posts.values()].sort((a, b) => a.id - b.id);
    const before = scroller.scrollHeight - scroller.scrollTop;
    let prev = null;
    const items = [];
    if (hasMore) items.push(html`<div class="load-more"><button id="load-more">Load earlier posts</button></div>`);
    else items.push(html`<div class="channel-start"><div class="big-hash">${icons.hash}</div><h2>Welcome to #${channel().name}</h2><p class="muted">${channel().topic || 'This is the beginning of the channel.'}</p></div>`);
    for (const p of list) {
      const day = dayLabel(p.createdAt);
      if (day !== dayLabel(prev?.createdAt)) items.push(html`<div class="day-pill"><span>${day}</span></div>`);
      if (p.id === dividerBefore) items.push(html`<div class="new-divider">New</div>`);
      items.push(postHtml(p, prev));
      prev = p;
    }
    render(feed, html`${items}`);
    if (keepScroll) scroller.scrollTop = scroller.scrollHeight - before;
  }

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
  const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

  drawFeed();
  const divider = $('.new-divider', feed);
  if (divider) divider.scrollIntoView({ block: 'center' });
  else toBottom();
  // Images can change the height after first paint.
  requestAnimationFrame(() => { if (!divider) toBottom(); });

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
    const cw = e.target.closest('.cw-toggle');
    if (cw) { cw.parentElement.classList.toggle('open'); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const article = btn.closest('.post');
    const p = posts.get(Number(article.dataset.id));
    if (btn.dataset.act === 'reveal') { article.classList.toggle('revealed'); return; }
    if (btn.dataset.act === 'menu') postMenu(btn, p, article);
  });

  function postMenu(anchor, p, article) {
    const mine = p.userId === state.user?.id;
    const canDelete = mine || role === 'owner' || state.user?.isAdmin;
    menu(anchor, [
      mine && p.kind !== 'roll' && { label: 'Edit', action: () => editPost(p, article) },
      { label: 'Copy text', action: () => copyText(p.body || `${p.roll?.expr} → ${p.roll?.total}`, 'Copied') },
      !mine && state.user && { label: `Reply to ${p.author.displayName}`, action: () => mention(p.author.username) },
      !mine && state.user && { label: 'Report post', action: () => reportPost(p) },
      !mine && state.user && (state.blocks.has(p.userId)
        ? { label: `Unblock ${p.author.displayName}`, action: () => toggleBlock(p.author, false) }
        : { label: `Block ${p.author.displayName}`, danger: true, action: () => toggleBlock(p.author, true) }),
      canDelete && { label: 'Delete', danger: true, action: () => deletePost(p) },
    ]);
  }

  function editPost(p, article) {
    const content = $('.content', article);
    render(content, html`
      <form class="edit-form">
        <textarea name="body" maxlength="30000" rows="6">${p.body}</textarea>
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
  if (!role) {
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
    const isOocChannel = /ooc/i.test(channel().name);
    // identity: "c:<id>" | "narration" | "ooc"
    let identity = store.get(asKey) || '';
    const valid = (v) => v === 'narration' || v === 'ooc' || (v.startsWith('c:') && characters.some((ch) => `c:${ch.id}` === v));
    if (isOocChannel) identity = 'ooc';
    else if (!valid(identity)) identity = characters.length ? `c:${characters[0].id}` : 'narration';
    let cw = '';

    render(wrap, html`
      <form class="composer" id="composer">
        <div class="composer-top">
          <button type="button" class="identity no-swipe" id="identity" aria-label="Choose who you're writing as"></button>
          <span class="cw-chip" id="cw-chip" hidden></span>
          <span class="spacer"></span>
          <span class="hint" id="wc">0 words</span>
        </div>
        <div class="composer-box">
          <div class="composer-tools"><button type="button" class="icon-btn" id="more-btn" title="Dice & content warnings" aria-label="More options">${icons.plus}</button></div>
          <textarea id="post-body" name="body" rows="1" maxlength="30000" aria-label="Write a post"></textarea>
          <div class="composer-tools"><button type="submit" class="icon-btn send" title="Post (Ctrl+Enter)" aria-label="Post">${icons.send}</button></div>
        </div>
        <div class="error"></div>
      </form>`);

    const form = $('#composer', wrap);
    const ta = $('#post-body', form);
    const idBtn = $('#identity', form);
    const wc = $('#wc', form);
    const cwChip = $('#cw-chip', form);

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
      { label: '🎲  Roll dice', action: () => rollDialog() },
      { label: `⚠  ${cw ? 'Change' : 'Add'} content warning`, action: askCw },
    ]));

    async function sendPost(payload) {
      const { post } = await api(`/api/channels/${channelId}/posts`, { method: 'POST', body: payload });
      posts.set(post.id, post);
      dividerBefore = null;
      drawFeed();
      toBottom();
    }

    function payloadBase(kindIfCharacter = 'ic') {
      if (identity.startsWith('c:')) return { kind: kindIfCharacter, characterId: Number(identity.slice(2)) };
      return { kind: kindIfCharacter === 'roll' ? 'roll' : identity };
    }

    async function rollDialog(prefill = '') {
      const res = await modal(html`
        <form>
          <h2>Roll dice</h2>
          <label for="dice-expr">Dice</label>
          <input id="dice-expr" name="dice" required maxlength="60" placeholder="1d20+5" value="${prefill || store.get('nuuvi:last-dice') || '1d20'}" autocomplete="off">
          <div class="dice-quick">${['1d20', '2d6', '1d100', '4d6', '1d8+2'].map((d) => html`<button type="button" class="sm" data-dice="${d}">${d}</button>`)}</div>
          <label for="dice-note">What for? <span class="muted small">(optional)</span></label>
          <input id="dice-note" name="note" maxlength="300" placeholder="Stealth check">
          <div class="error"></div>
          <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Roll</button></div>
        </form>`, {
        init: (d) => {
          $$('[data-dice]', d).forEach((b) => b.addEventListener('click', () => { d.querySelector('#dice-expr').value = b.dataset.dice; }));
          d.querySelector('#dice-expr').select();
        },
        submit: async (data) => {
          await sendPost({ ...payloadBase('roll'), dice: data.dice, body: data.note, cw });
          store.set('nuuvi:last-dice', data.dice);
          return true;
        },
      });
      if (res) ta.focus();
    }

    bindForm(form, async () => {
      const text = ta.value.trim();
      if (!text) return;
      const rollCmd = text.match(/^\/(?:r|roll)\s+(\S+)\s*([\s\S]*)$/i);
      if (rollCmd) await sendPost({ ...payloadBase('roll'), dice: rollCmd[1], body: rollCmd[2], cw });
      else await sendPost({ ...payloadBase(), body: text, cw });
      ta.value = '';
      cw = '';
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
