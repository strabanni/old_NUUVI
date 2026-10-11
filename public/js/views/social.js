// Character social media: posts (text, photo, video, voice note, stream), likes, comments.
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, uploadImage, uploadFile, timeAgo, formatPost } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive } from '../main.js';

const KINDS = [['text', 'Text', 'text'], ['photo', 'Photo', 'image'], ['video', 'Video', 'video'], ['voice', 'Voice note', 'mic'], ['stream', 'Stream', 'live']];
export const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const nameBadge = (ch) => html`<span class="sp-name">${ch.name}</span>${ch.verified ? html`<span class="verified" title="Verified">${icons.verified}</span>` : ''}`;

function mediaHtml(p, { full = false } = {}) {
  if (p.kind === 'photo') {
    return html`<div class="sm-photos ${p.media.length > 1 ? 'multi' : ''} no-swipe">${p.media.map((u) => html`<img src="${u}" alt="" loading="lazy">`)}</div>`;
  }
  if (p.kind === 'video') return html`<video class="sm-video" src="${p.media[0]}" controls playsinline preload="metadata"></video>`;
  if (p.kind === 'voice') {
    return html`<div class="voice-note" data-src="${p.media[0]}">
      <button type="button" class="vn-play" aria-label="Play voice note">${icons.play}</button>
      <span class="vn-bars" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => html`<i data-h="${20 + ((i * 37 + p.id * 13) % 70)}"></i>`)}</span>
      <span class="vn-time">${p.meta.duration ? fmtTime(p.meta.duration) : '0:00'}</span>
    </div>`;
  }
  if (p.kind === 'stream') {
    return html`<div class="sm-stream">
      ${p.media[0] ? html`<img src="${p.media[0]}" alt="" loading="lazy">` : ''}
      <span class="live-badge ${p.meta.live === false ? 'ended' : ''}">${p.meta.live === false ? 'Ended' : 'LIVE'}</span>
      ${p.meta.viewers !== undefined ? html`<span class="viewers">${icons.users} ${compact(p.meta.viewers)} ${p.meta.live === false ? 'watched' : 'watching'}</span>` : ''}
      <h3>${p.title}</h3>
    </div>`;
  }
  return '';
}

// The song attached to a post, under the poster's name (like Instagram). Links open in a new tab.
export function songLine(m) {
  if (!m?.title) return '';
  const label = html`${icons.music}<span class="song-t">${m.title}</span>${m.artist ? html`<span class="song-a"> · ${m.artist}</span>` : ''}`;
  return m.url
    ? html`<a class="song" href="${m.url}" target="_blank" rel="noopener noreferrer nofollow" title="Listen: ${m.title}${m.artist ? ` by ${m.artist}` : ''}">${label}</a>`
    : html`<span class="song">${label}</span>`;
}

// A post as shown in the feed and on profiles.
export function socialCard(p, { full = false } = {}) {
  const ch = p.character;
  const liked = p.likedBy.length > 0;
  return html`
    <article class="sm-card kind-${p.kind}" data-social="${p.id}" data-color="${ch.color}">
      <header class="sm-head">
        ${avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'sm' })}
        <div class="sm-id">
          <a href="#/c/${ch.id}" class="sm-who">${nameBadge(ch)}</a>
          ${songLine(p.meta.music)}
        </div>
        <a class="sm-when" href="#/p/${p.id}">${timeAgo(p.createdAt)}</a>
        <button class="icon-btn sm sm-more" data-sm="more" aria-label="Post options">${icons.more}</button>
      </header>
      ${mediaHtml(p, { full })}
      ${p.body ? html`<div class="sm-body ${p.kind === 'text' ? 'big' : ''}">${formatPost(p.body)}</div>` : ''}
      <footer class="sm-actions">
        <button type="button" class="sm-act ${liked ? 'on' : ''}" data-sm="like" aria-pressed="${liked}">${liked ? icons.heartFill : icons.heart}<span>${compact(p.likes)}</span></button>
        <a class="sm-act" href="#/p/${p.id}">${icons.chat}<span>${compact(p.commentCount)}</span></a>
      </footer>
      ${!full && p.comments.length ? html`<div class="sm-comments">${p.comments.map((c) => html`
        <p><a href="#/c/${c.character.id}">${c.character.name}</a> ${c.body}</p>`)}
        ${p.commentCount > p.comments.length ? html`<a class="small muted" href="#/p/${p.id}">View all ${p.commentCount} comments</a>` : ''}</div>` : ''}
    </article>`;
}

export function styleBars(root) {
  for (const i of root.querySelectorAll('.vn-bars i')) i.style.height = `${i.dataset.h}%`;
}

// Wires likes, menus and voice notes inside `root`; `posts` maps id → post; `redraw(post)` re-renders one.
export function bindSocial(root, posts, redraw) {
  styleBars(root);
  root.addEventListener('click', async (e) => {
    const vn = e.target.closest('.vn-play');
    if (vn) return playVoice(vn.closest('.voice-note'));
    const b = e.target.closest('[data-sm]');
    if (!b) return;
    const card = b.closest('[data-social]');
    const p = posts.get(Number(card.dataset.social));
    if (b.dataset.sm === 'like') await toggleLike(p, b, redraw);
    if (b.dataset.sm === 'more') {
      const mine = p.userId === state.user.id;
      menu(b, [
        { label: 'Open post', action: () => { location.hash = `#/p/${p.id}`; } },
        mine && { label: p.meta.music ? 'Edit post or song' : 'Edit post / add a song', action: () => editCaption(p, redraw) },
        p.kind === 'stream' && mine && { label: p.meta.live === false ? 'Mark as live again' : 'End stream', action: () => updatePost(p, { meta: { ...p.meta, live: p.meta.live === false } }, redraw) },
        (mine || state.user.isAdmin) && { label: 'Delete post', danger: true, action: () => deletePost(p, card) },
      ]);
    }
  });
}

let playing = null;
function playVoice(el) {
  if (playing && playing.el !== el) { playing.audio.pause(); playing.el.classList.remove('playing'); }
  if (playing?.el === el) {
    if (playing.audio.paused) { playing.audio.play(); el.classList.add('playing'); } else { playing.audio.pause(); el.classList.remove('playing'); }
    return;
  }
  const audio = new Audio(el.dataset.src);
  const time = el.querySelector('.vn-time');
  const bars = [...el.querySelectorAll('.vn-bars i')];
  audio.addEventListener('timeupdate', () => {
    time.textContent = fmtTime(audio.currentTime);
    const done = audio.duration ? audio.currentTime / audio.duration : 0;
    bars.forEach((bar, i) => bar.classList.toggle('done', i / bars.length < done));
  });
  audio.addEventListener('ended', () => { el.classList.remove('playing'); bars.forEach((bar) => bar.classList.remove('done')); playing = null; });
  playing = { el, audio };
  el.classList.add('playing');
  audio.play().catch(() => toast("Couldn't play this voice note"));
}

async function toggleLike(p, anchor, redraw) {
  const mine = await myCharacters();
  const act = async (c) => {
    const on = p.likedBy.includes(c.id);
    try {
      const { post } = await api(`/api/social/${p.id}/${on ? 'unlike' : 'like'}`, { method: 'POST', body: { asCharacterId: c.id } });
      redraw(post);
    } catch (err) { toast(err.message); }
  };
  if (!mine.length) return toast('Create a character first');
  if (mine.length === 1) return act(mine[0]);
  menu(anchor, mine.map((c) => ({ label: `${p.likedBy.includes(c.id) ? '♥ Unlike as' : '♡ Like as'} ${c.name}`, action: () => act(c) })));
}

async function updatePost(p, body, redraw) {
  try { redraw((await api(`/api/social/${p.id}`, { method: 'PUT', body })).post); } catch (err) { toast(err.message); }
}

// Song fields shared by the composer and the editor.
const songFields = (m = {}) => html`
  <details class="song-fields" ${m.title ? 'open' : ''}>
    <summary>${icons.music} Add a song</summary>
    <div class="row">
      <div><label for="s-song">Song title</label><input id="s-song" name="songTitle" maxlength="120" value="${m.title || ''}" placeholder="Ditto"></div>
      <div><label for="s-artist">Artist</label><input id="s-artist" name="songArtist" maxlength="120" value="${m.artist || ''}" placeholder="NewJeans"></div>
    </div>
    <label for="s-link">Link <span class="muted small">(optional — Spotify, Apple Music, YouTube…)</span></label>
    <input id="s-link" name="songUrl" type="url" maxlength="500" value="${m.url || ''}" placeholder="https://">
  </details>`;
const songFrom = (data) => {
  const music = { title: (data.songTitle || '').trim(), artist: (data.songArtist || '').trim(), url: (data.songUrl || '').trim() };
  return music.title || music.artist || music.url ? music : null;
};

async function editCaption(p, redraw) {
  const res = await modal(html`<form><h2>Edit post</h2><label for="e-body">Caption</label><textarea id="e-body" name="body" rows="5" maxlength="5000">${p.body}</textarea>
    ${p.kind === 'stream' ? html`<label>Stream title</label><input name="title" maxlength="120" value="${p.title}">` : ''}
    ${songFields(p.meta.music)}
    <div class="error"></div><div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Save</button></div></form>`, {
    submit: async (data) => {
      const body = { body: data.body, music: songFrom(data) };
      if (p.kind === 'stream') body.title = data.title;
      return (await api(`/api/social/${p.id}`, { method: 'PUT', body })).post;
    },
  });
  if (res) redraw(res);
}

async function deletePost(p, card) {
  if (!(await confirmModal('Delete this post?', { ok: 'Delete', danger: true }))) return;
  await api(`/api/social/${p.id}`, { method: 'DELETE' });
  card.remove();
  if (location.hash === `#/p/${p.id}`) history.back();
}

// ---------- New post ----------
export async function openSocialComposer({ characterId = null } = {}) {
  const mine = await myCharacters(true);
  if (!mine.length) { toast('Create a character first — posts are made by characters'); location.hash = '#/characters'; return null; }
  let kind = 'text';
  let media = [];
  let duration = 0;
  let recorder = null;

  const result = await modal(html`
    <form class="social-form">
      <span class="eyebrow">New post</span>
      <label for="s-char">Post as</label>
      <select id="s-char" name="characterId">${mine.map((c) => html`<option value="${c.id}" ${c.id === characterId ? 'selected' : ''}>${c.name}</option>`)}</select>
      <div class="kind-picker" role="group" aria-label="Post type">${KINDS.map(([k, label, icon]) => html`
        <button type="button" class="kind-btn" data-kind="${k}" aria-pressed="${k === kind}">${icons[icon]}<span>${label}</span></button>`)}</div>
      <div id="s-media"></div>
      <div id="s-stream" hidden>
        <label for="s-title">Stream title</label>
        <input id="s-title" name="title" maxlength="120" placeholder="late night q&a 🌙">
        <label for="s-viewers">Viewers</label>
        <input id="s-viewers" name="viewers" inputmode="numeric" placeholder="12,000">
      </div>
      <label for="s-body" id="s-body-label">What's happening?</label>
      <textarea id="s-body" name="body" rows="4" maxlength="5000" placeholder="Write a caption… @mentions and *formatting* work"></textarea>
      ${songFields()}
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Post</button></div>
    </form>`, {
    init: (d) => {
      const form = d.querySelector('form');
      const box = $('#s-media', d);
      const drawMedia = () => {
        $('#s-stream', d).hidden = kind !== 'stream';
        $('#s-body-label', d).textContent = kind === 'text' ? "What's happening?" : 'Caption (optional)';
        if (kind === 'text') return render(box, html``);
        if (kind === 'voice') {
          return render(box, html`
            <div class="recorder">
              ${media.length ? html`<audio src="${media[0]}" controls></audio><button type="button" class="sm" id="rec-clear">Re-record</button>`
                : html`<button type="button" class="primary" id="rec-btn">${icons.mic} <span>Record</span></button><span class="hint" id="rec-time">up to 3 minutes</span>
                  <label class="btn sm file-btn">Upload audio<input type="file" accept="audio/*" id="s-file" hidden></label>`}
            </div>`);
        }
        const accept = kind === 'video' ? 'video/mp4,video/quicktime,video/webm' : 'image/*';
        render(box, html`
          <div class="media-picker">
            ${media.map((u, i) => (kind === 'video' ? html`<video src="${u}" muted playsinline></video>` : html`<span class="thumb"><img src="${u}" alt=""><button type="button" data-rm="${i}" aria-label="Remove">✕</button></span>`))}
            ${(kind === 'photo' && media.length < 10) || (!media.length) ? html`<label class="add-media">${kind === 'video' ? icons.video : icons.image}
              <span>${kind === 'photo' ? 'Add photos' : kind === 'video' ? 'Add a video' : 'Add a thumbnail'}</span>
              <input type="file" accept="${accept}" id="s-file" ${kind === 'photo' ? 'multiple' : ''} hidden></label>` : ''}
          </div>`);
      };
      const setKind = (k) => {
        if (recorder) { recorder.stop(); recorder = null; }
        kind = k; media = []; duration = 0;
        $$('.kind-btn', d).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
        drawMedia();
      };
      $$('.kind-btn', d).forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
      d.addEventListener('change', async (e) => {
        if (e.target.id !== 's-file') return;
        const files = [...e.target.files];
        try {
          for (const f of files) {
            toast('Uploading…');
            const url = f.type.startsWith('image/') ? await uploadImage(f, kind === 'photo' ? 1600 : 1200) : await uploadFile(f);
            if (kind === 'voice') duration = await audioDuration(url);
            media.push(url);
          }
          toast('Uploaded');
        } catch (err) { toast(err.message); }
        drawMedia();
      });
      d.addEventListener('click', async (e) => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { media.splice(Number(rm.dataset.rm), 1); drawMedia(); }
        if (e.target.closest('#rec-clear')) { media = []; drawMedia(); }
        if (e.target.closest('#rec-btn')) {
          if (recorder) { recorder.stop(); return; }
          recorder = await startRecording({
            tick: (s) => { const t = $('#rec-time', d); if (t) t.textContent = `${fmtTime(s)} — tap to stop`; },
            done: async (blob, secs) => {
              recorder = null;
              try {
                media = [await uploadFile(blob)];
                duration = secs;
              } catch (err) { toast(err.message); }
              drawMedia();
            },
          });
          if (recorder) $('#rec-btn span', d).textContent = 'Stop';
        }
      });
      drawMedia();
      form.body.focus();
    },
    submit: async (data) => {
      const payload = { characterId: Number(data.characterId), kind, body: data.body, media };
      const music = songFrom(data);
      if (music) payload.music = music;
      if (kind === 'stream') {
        payload.title = data.title;
        payload.meta = { viewers: Number(String(data.viewers || '0').replace(/[,\s]/g, '')) || 0, live: true };
      }
      if (kind === 'voice') payload.meta = { duration };
      return (await api('/api/social', { method: 'POST', body: payload })).post;
    },
  });
  if (recorder) recorder.stop();
  if (result) toast('Posted');
  return result;
}

function audioDuration(url) {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.addEventListener('loadedmetadata', () => resolve(Number.isFinite(a.duration) ? Math.round(a.duration) : 0));
    a.addEventListener('error', () => resolve(0));
  });
}

async function startRecording({ tick, done }) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("This browser can't record audio — upload a file instead"); return null; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Microphone permission was denied'); return null; }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const started = Date.now();
  const timer = setInterval(() => {
    const s = (Date.now() - started) / 1000;
    tick(s);
    if (s >= 180) rec.stop();
  }, 250);
  rec.addEventListener('dataavailable', (e) => chunks.push(e.data));
  rec.addEventListener('stop', () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
    done(blob, Math.round((Date.now() - started) / 1000));
  });
  rec.start();
  return rec;
}

// ---------- Single post page ----------
export async function viewSocialPost(id) {
  const alive = routeAlive();
  const [{ post }, mine] = await Promise.all([api(`/api/social/${id}`), myCharacters()]);
  ensureAlive(alive);
  const posts = new Map([[post.id, post]]);
  const body = page({
    alive,
    title: html`${post.character.name}'s post`,
    subtitle: timeAgo(post.createdAt),
    body: html`
      <div class="sm-single">
        <div id="sm-post"></div>
        <section class="card sm-thread">
          <h2 class="section-title">Comments</h2>
          <div id="sm-comments"></div>
          ${mine.length ? html`<form id="sm-comment" class="comment-form">
            <select name="characterId" aria-label="Comment as">${mine.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
            <input name="body" maxlength="2000" placeholder="Add a comment…" required autocomplete="off">
            <button class="primary sm" type="submit">Post</button>
          </form>` : html`<p class="muted small">Create a character to comment.</p>`}
        </section>
      </div>`,
  });
  const draw = (p) => {
    posts.set(p.id, p);
    render($('#sm-post', body), socialCard(p, { full: true }));
    styleBars($('#sm-post', body));
    render($('#sm-comments', body), p.comments.length ? html`${p.comments.map((c) => html`
      <div class="comment" data-cid="${c.id}">
        <a href="#/c/${c.character.id}">${avatar({ name: c.character.name, src: c.character.avatar, color: c.character.color, size: 'sm' })}</a>
        <div class="grow"><a href="#/c/${c.character.id}"><b>${c.character.name}</b></a> ${c.body}<div class="small muted">${timeAgo(c.createdAt)}</div></div>
        ${c.userId === state.user.id || p.userId === state.user.id || state.user.isAdmin ? html`<button class="icon-btn sm" data-del="${c.id}" aria-label="Delete comment">✕</button>` : ''}
      </div>`)}` : html`<p class="muted small">No comments yet.</p>`);
  };
  draw(post);
  bindSocial($('#sm-post', body), posts, draw);
  $('#sm-comments', body).addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    await api(`/api/social/comments/${del.dataset.del}`, { method: 'DELETE' });
    draw((await api(`/api/social/${id}`)).post);
  });
  const form = $('#sm-comment', body);
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { post: updated } = await api(`/api/social/${id}/comments`, { method: 'POST', body: { characterId: Number(form.characterId.value), body: form.body.value } });
      form.body.value = '';
      draw(updated);
    } catch (err) { toast(err.message); }
  });
}
