// Character social media: posts (text, photo, video, voice note, stream), likes, comments.
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, uploadImage, uploadFile, timeAgo, formatPost, askImageLink, gradAttr, looksForeign, translateText } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive } from '../main.js';
import { fillLocations } from './threads.js';

const KINDS = [['text', 'Text', 'text'], ['photo', 'Photo', 'image'], ['video', 'Video', 'video'], ['voice', 'Voice note', 'mic'], ['stream', 'Stream', 'live']];
export const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K` : String(n));
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Social posts go out under the character's @username (their given name shows on their profile).
export const handleOf = (ch) => (ch.handle ? `@${ch.handle}` : ch.name);
export const npcBadges = (ch) => html`${ch.npc ? html`<span class="npc-badge" title="NPC">NPC</span>` : ''}${ch.bot === 'bot' ? html`<span class="npc-badge auto" title="Posts and comments on its own">AUTO</span>` : ''}`;
export const nameBadge = (ch) => html`<span class="sp-name">${handleOf(ch)}</span>${ch.verified ? html`<span class="verified" title="Verified">${icons.verified}</span>` : ''}${npcBadges(ch)}`;

function mediaHtml(p, { full = false } = {}) {
  if (p.kind === 'photo') {
    // Instagram-style carousel: swipe (or the arrows on a computer); "1/3" and dots show there's more.
    const n = p.media.length;
    return html`<div class="np-media carousel ${n > 1 ? 'multi' : ''}" data-n="${n}">
      <div class="car-track no-swipe">${p.media.map((u, i) => html`<img src="${u}" alt="" loading="${i ? 'lazy' : 'eager'}" draggable="false">`)}</div>
      ${n > 1 ? html`<span class="car-count" aria-hidden="true">1/${n}</span>
        <button type="button" class="car-btn prev" data-car="-1" aria-label="Previous photo" hidden>${icons.chevron}</button>
        <button type="button" class="car-btn next" data-car="1" aria-label="Next photo">${icons.chevron}</button>
        <div class="car-dots" aria-hidden="true">${p.media.map((_, i) => html`<i class="${i ? '' : 'on'}"></i>`)}</div>` : ''}
      <span class="np-burst" aria-hidden="true">${icons.heartFill}</span>
    </div>`;
  }
  // Videos play by themselves, muted and looping, while on screen (like Instagram): no black play
  // overlay, shaped to the video itself. Tap for sound.
  if (p.kind === 'video') {
    return html`<div class="np-media np-vid">
      <video class="sm-video" src="${p.media[0]}" muted loop playsinline autoplay preload="metadata" disablepictureinpicture></video>
      <button type="button" class="vid-sound" data-sm="sound" aria-label="Turn sound on">${icons.mute}</button>
      <span class="np-burst" aria-hidden="true">${icons.heartFill}</span>
    </div>`;
  }
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

// Short Instagram-style times: "5m", "3h", "2d", then the date.
export function agoShort(sql) {
  const d = new Date(`${String(sql).replace(' ', 'T')}${String(sql).includes('T') ? '' : 'Z'}`);
  const m = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 10080) return `${Math.floor(m / 1440)}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A commenter's name: characters in their own color (or gradient), the crowd in plain grey.
export const commenterName = (cm) => (cm.character
  ? html`<a class="np-handle c-name" href="#/c/${cm.character.id}" data-color="${cm.character.color}"${gradAttr(cm.character)}>${handleOf(cm.character)}</a>${cm.character.verified ? html`<span class="verified sm" title="Verified">${icons.verified}</span>` : ''}`
  : html`<span class="np-handle fan">${cm.handle}</span>`);

// Comments and crowd comments together, oldest first.
export const allComments = (p) => [...p.comments, ...(p.buzz || [])].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

// A post as shown on THE : NU and on profiles — laid out like an Instagram post.
export function socialCard(p, { full = false } = {}) {
  const ch = p.character;
  const liked = p.likedBy.length > 0;
  const preview = allComments(p).filter((c) => !c.parentId).slice(-2);
  return html`
    <article class="np sm-card kind-${p.kind}" data-social="${p.id}" data-color="${ch.color}"${gradAttr(ch)}>
      <header class="np-head">
        <a class="np-av" href="#/c/${ch.id}">${avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'sm' })}</a>
        <div class="np-id">
          <div class="np-line"><a href="#/c/${ch.id}" class="np-who">${nameBadge(ch)}</a><span class="np-dot">•</span><a class="np-ago" href="#/p/${p.id}">${agoShort(p.createdAt)}</a></div>
          ${p.location ? html`<span class="np-sub loc-tag">${icons.pin} ${p.location}</span>` : ''}
          ${songLine(p.meta.music)}
        </div>
        <button class="icon-btn sm np-more" data-sm="more" aria-label="Post options">${icons.more}</button>
      </header>
      ${p.kind === 'text' ? html`<div class="np-textpost" data-sm="dbl"><div class="body">${formatPost(p.body)}</div><span class="np-burst" aria-hidden="true">${icons.heartFill}</span></div>` : mediaHtml(p, { full })}
      <div class="np-actions">
        <button type="button" class="np-act like ${liked ? 'on' : ''}" data-sm="like" aria-pressed="${liked}" aria-label="${liked ? 'Unlike' : 'Like'}">${liked ? icons.heartFill : icons.heart}</button>
        <a class="np-act" href="#/p/${p.id}" aria-label="Comments">${icons.chat}</a>
        <button type="button" class="np-act" data-sm="share" aria-label="Copy link">${icons.send}</button>
      </div>
      <div class="np-likes"><b>${p.likes.toLocaleString()} ${p.likes === 1 ? 'like' : 'likes'}</b></div>
      ${p.kind !== 'text' && p.body ? html`<div class="np-caption"><a class="np-handle" href="#/c/${ch.id}">${handleOf(ch)}</a> <span class="body">${formatPost(p.body)}</span></div>` : ''}
      ${!full ? html`
        ${p.commentCount > preview.length ? html`<a class="np-viewall" href="#/p/${p.id}">View all ${p.commentCount.toLocaleString()} comments</a>` : ''}
        ${preview.map((c) => html`<p class="np-comment">${commenterName(c)} <span>${c.body}</span></p>`)}
        <a class="np-addc" href="#/p/${p.id}">Add a comment…</a>` : ''}
      <a class="np-time" href="#/p/${p.id}">${timeAgo(p.createdAt)}</a>
    </article>`;
}

// Carousel: keep the "1/3" counter, dots and arrows in step with the photo showing.
function syncCarousel(car) {
  const track = car.querySelector('.car-track');
  const n = Number(car.dataset.n);
  const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const count = car.querySelector('.car-count');
  if (count) count.textContent = `${i + 1}/${n}`;
  car.querySelectorAll('.car-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  const prev = car.querySelector('.car-btn.prev');
  const next = car.querySelector('.car-btn.next');
  if (prev) prev.hidden = i <= 0;
  if (next) next.hidden = i >= n - 1;
}

export function styleBars(root) {
  for (const i of root.querySelectorAll('.vn-bars i')) i.style.height = `${i.dataset.h}%`;
}

// Wires likes, menus and voice notes inside `root`; `posts` maps id → post; `redraw(post)` re-renders one.
// Videos on screen play (muted, looping); off screen they pause. Each video's box takes its shape
// (between 4:5 tall and 1.91:1 wide), so nothing is squashed or boxed in black.
const seen = new WeakSet();
const vidObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const en of entries) {
    const v = en.target;
    if (en.isIntersecting && en.intersectionRatio > 0.5) v.play().catch(() => {}); else v.pause();
  }
}, { threshold: [0, 0.5, 1] }) : null;
export function wireVideos(root) {
  for (const v of root.querySelectorAll('.np-vid video')) {
    if (seen.has(v)) continue;
    seen.add(v);
    v.muted = true;
    const shape = () => {
      if (!v.videoWidth) return;
      const r = Math.min(1.91, Math.max(0.8, v.videoWidth / v.videoHeight));
      v.parentElement.style.setProperty('--vr', String(r));
    };
    v.addEventListener('loadedmetadata', shape);
    shape();
    vidObserver?.observe(v);
  }
}

export function bindSocial(root, posts, redraw) {
  styleBars(root);
  wireVideos(root);
  new MutationObserver(() => wireVideos(root)).observe(root, { childList: true, subtree: true });
  root.addEventListener('scroll', (e) => {
    const car = e.target.closest?.('.carousel');
    if (car) syncCarousel(car);
  }, true);
  // Double-tap (or double-click) a photo to like it, like Instagram.
  root.addEventListener('dblclick', async (e) => {
    const media = e.target.closest('.np-media, .np-textpost');
    const card = media?.closest('[data-social]');
    if (!card) return;
    const burst = media.querySelector('.np-burst');
    burst?.classList.remove('go'); void burst?.offsetWidth; burst?.classList.add('go');
    const p = posts.get(Number(card.dataset.social));
    if (!p.likedBy.length) await toggleLike(p, card.querySelector('[data-sm="like"]'), redraw, { quick: true });
  });
  root.addEventListener('click', async (e) => {
    const vn = e.target.closest('.vn-play');
    if (vn) return playVoice(vn.closest('.voice-note'));
    const arrow = e.target.closest('[data-car]');
    if (arrow) {
      const track = arrow.closest('.carousel').querySelector('.car-track');
      track.scrollBy({ left: Number(arrow.dataset.car) * track.clientWidth, behavior: 'smooth' });
      return;
    }
    const b = e.target.closest('[data-sm]');
    if (!b) return;
    if (b.dataset.sm === 'sound') {
      // One video with sound at a time.
      const v = b.parentElement.querySelector('video');
      const on = v.muted;
      root.querySelectorAll('.np-vid video').forEach((x) => { x.muted = true; x.parentElement.classList.remove('sound'); });
      v.muted = !on;
      b.parentElement.classList.toggle('sound', on);
      b.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
      render(b, on ? icons.sound : icons.mute);
      if (on) v.play().catch(() => {});
      return;
    }
    const card = b.closest('[data-social]');
    const p = posts.get(Number(card.dataset.social));
    if (b.dataset.sm === 'like') { b.classList.add('pop'); await toggleLike(p, b, redraw); }
    if (b.dataset.sm === 'share') {
      const url = `${location.origin}/#/p/${p.id}`;
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
    }
    if (b.dataset.sm === 'more') {
      const mine = p.userId === state.user.id;
      menu(b, [
        { label: 'Open post', action: () => { location.hash = `#/p/${p.id}`; } },
        mine && { label: p.meta.music ? 'Edit post or song' : 'Edit post / add a song', action: () => editCaption(p, redraw) },
        mine && { label: 'Set like & comment numbers', action: () => editCounts(p, redraw) },
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

// Like as one of your characters. With several, the heart asks which; a double-tap just uses the
// one you liked as last time.
async function toggleLike(p, anchor, redraw, { quick = false } = {}) {
  const mine = await myCharacters();
  const act = async (c) => {
    try { localStorage.setItem('nuuvi:like-as', String(c.id)); } catch { /* ignore */ }
    const on = p.likedBy.includes(c.id);
    try {
      const { post } = await api(`/api/social/${p.id}/${on ? 'unlike' : 'like'}`, { method: 'POST', body: { asCharacterId: c.id } });
      redraw(post);
    } catch (err) { toast(err.message); }
  };
  if (!mine.length) return toast('Create a character first');
  if (mine.length === 1) return act(mine[0]);
  if (quick) {
    let last = null;
    try { last = Number(localStorage.getItem('nuuvi:like-as')); } catch { /* ignore */ }
    return act(mine.find((c) => c.id === last) || mine[0]);
  }
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
// Tag a place, like Instagram's location line.
const locationField = (v = '') => html`
  <label for="s-loc">${icons.pin} Location <span class="muted small">(optional)</span></label>
  <input id="s-loc" name="location" maxlength="100" list="s-loc-list" value="${v}" placeholder="Add a location" autocomplete="off">
  <datalist id="s-loc-list"></datalist>`;
const songFrom = (data) => {
  const music = { title: (data.songTitle || '').trim(), artist: (data.songArtist || '').trim(), url: (data.songUrl || '').trim() };
  return music.title || music.artist || music.url ? music : null;
};

async function editCaption(p, redraw) {
  const res = await modal(html`<form><h2>Edit post</h2><label for="e-body">Caption</label><textarea id="e-body" name="body" rows="5" maxlength="5000">${p.body}</textarea>
    ${p.kind === 'stream' ? html`<label>Stream title</label><input name="title" maxlength="120" value="${p.title}">` : ''}
    ${locationField(p.location || '')}
    ${songFields(p.meta.music)}
    <div class="error"></div><div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Save</button></div></form>`, {
    init: (d) => fillLocations($('#s-loc-list', d)),
    submit: async (data) => {
      const body = { body: data.body, music: songFrom(data), location: data.location || '' };
      if (p.kind === 'stream') body.title = data.title;
      return (await api(`/api/social/${p.id}`, { method: 'PUT', body })).post;
    },
  });
  if (res) redraw(res);
}

// Famous characters can show bigger numbers: the writer sets the likes and comments shown on a post.
// Leave a box empty to show the real count.
async function editCounts(p, redraw) {
  const res = await modal(html`<form><h2>Like & comment numbers</h2>
    <p class="muted small">Shown on this post instead of the real counts. Leave a box empty to show the real number.</p>
    <div class="row">
      <div><label for="e-likes">Likes</label><input id="e-likes" name="likes" inputmode="numeric" pattern="[0-9,.]*" placeholder="real count" value="${p.likesDisplay ?? ''}"></div>
      <div><label for="e-comments">Comments</label><input id="e-comments" name="comments" inputmode="numeric" pattern="[0-9,.]*" placeholder="real count" value="${p.commentsDisplay ?? ''}"></div>
    </div>
    <div class="error"></div><div class="actions end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Save</button></div></form>`, {
    submit: async (data) => {
      const num = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(/[,\s]/g, '')));
      return (await api(`/api/social/${p.id}`, { method: 'PUT', body: { likesDisplay: num(data.likes), commentsDisplay: num(data.comments) } })).post;
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
      ${locationField()}
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
          </div>
          ${kind !== 'video' && ((kind === 'photo' && media.length < 10) || !media.length) ? html`<button type="button" class="sm link-btn" id="s-link-pic">${icons.image} Use a picture link instead</button>` : ''}
          ${kind === 'photo' ? html`<p class="hint size-hint">Best size: 1080 × 1350 (4:5, tall) or 1080 × 1080 (square). Every photo in a post shows at the first photo's shape.</p>` : ''}`);
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
        if (e.target.closest('#s-link-pic')) {
          const url = await askImageLink();
          if (url) { media.push(url); drawMedia(); }
        }
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
      fillLocations($('#s-loc-list', d));
      form.body.focus();
    },
    submit: async (data) => {
      const payload = { characterId: Number(data.characterId), kind, body: data.body, media, location: data.location || '' };
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
  let replyTo = null; // { id (comment id, or null for a crowd comment), handle }
  const body = page({
    alive,
    title: html`${handleOf(post.character)}'s post`,
    subtitle: timeAgo(post.createdAt),
    body: html`
      <div class="sm-single">
        <div id="sm-post"></div>
        <section class="card np-thread">
          <div id="sm-comments"></div>
          ${mine.length ? html`<form id="sm-comment" class="np-cform">
            <div class="np-replying" id="np-replying" hidden></div>
            <div class="np-cform-row">
              <select name="characterId" aria-label="Comment as">${mine.map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select>
              <input name="body" maxlength="2000" placeholder="Add a comment…" required autocomplete="off">
              <button class="link np-post-btn" type="submit">Post</button>
            </div>
          </form>` : html`<p class="muted small">Create a character to comment.</p>`}
        </section>
      </div>`,
  });
  const form = $('#sm-comment', body);
  const commentRow = (c, p, reply = false) => {
    const ch = c.character;
    const canDelete = ch && (c.userId === state.user.id || p.userId === state.user.id || state.user.isAdmin);
    return html`
      <div class="cm ${reply ? 'reply' : ''} ${ch ? 'by-char' : 'by-fan'}" ${ch ? html`data-cid="${c.id}"` : html`data-bid="${c.id}"`}>
        ${ch ? html`<a href="#/c/${ch.id}" class="cm-av">${avatar({ name: ch.name, src: ch.avatar, color: ch.color, size: 'sm' })}</a>`
          : html`<span class="cm-av">${avatar({ name: c.handle, color: '#8F8D8E', size: 'sm' })}</span>`}
        <div class="cm-main">
          <p class="cm-text">${commenterName(c)} <span class="cm-body">${c.body}</span></p>
          <div class="cm-tr" hidden></div>
          <div class="cm-meta">
            <span>${agoShort(c.createdAt)}</span>
            ${c.likes ? html`<span>${c.likes.toLocaleString()} ${c.likes === 1 ? 'like' : 'likes'}</span>` : ''}
            ${mine.length ? html`<button type="button" class="link" data-reply="${ch ? c.id : ''}" data-handle="${ch ? (ch.handle || ch.name) : c.handle}">Reply</button>` : ''}
            ${looksForeign(c.body) ? html`<button type="button" class="link" data-tr>See translation</button>` : ''}
            ${canDelete ? html`<button type="button" class="link" data-del="${c.id}">Delete</button>` : ''}
          </div>
        </div>
        <button type="button" class="cm-heart" aria-label="Like comment">${icons.heart}</button>
      </div>`;
  };
  const draw = (p) => {
    posts.set(p.id, p);
    render($('#sm-post', body), socialCard(p, { full: true }));
    styleBars($('#sm-post', body));
    const all = allComments(p);
    const top = all.filter((c) => !c.parentId);
    const repliesOf = (c) => (c.character ? p.comments.filter((r) => r.parentId === c.id) : []);
    render($('#sm-comments', body), top.length ? html`${top.map((c) => html`${commentRow(c, p)}${repliesOf(c).length ? html`<div class="cm-replies">${repliesOf(c).map((r) => commentRow(r, p, true))}</div>` : ''}`)}`
      : html`<p class="muted small np-empty">No comments yet. Start the conversation.</p>`);
  };
  draw(post);
  bindSocial($('#sm-post', body), posts, draw);
  const setReply = (r) => {
    replyTo = r;
    const chip = $('#np-replying', body);
    if (!chip) return;
    chip.hidden = !r;
    if (r) {
      render(chip, html`<span>Replying to <b>@${r.handle}</b></span><button type="button" class="icon-btn sm" id="np-cancel-reply" aria-label="Cancel reply">✕</button>`);
      form.body.value = `@${r.handle} `;
      form.body.focus();
    }
  };
  $('#sm-comments', body).addEventListener('click', async (e) => {
    const heart = e.target.closest('.cm-heart');
    if (heart) { heart.classList.toggle('on'); heart.classList.add('pop'); return; }
    const rep = e.target.closest('[data-reply]');
    if (rep) return setReply({ id: rep.dataset.reply ? Number(rep.dataset.reply) : null, handle: rep.dataset.handle });
    const tr = e.target.closest('[data-tr]');
    if (tr) {
      const row = tr.closest('.cm');
      const out = $('.cm-tr', row);
      if (!out.hidden) { out.hidden = true; tr.textContent = 'See translation'; return; }
      tr.textContent = 'Translating…';
      const text = await translateText($('.cm-body', row).textContent);
      if (text) { out.textContent = text; out.hidden = false; tr.textContent = 'Hide translation'; } else tr.textContent = 'See translation';
      return;
    }
    const del = e.target.closest('[data-del]');
    if (!del) return;
    await api(`/api/social/comments/${del.dataset.del}`, { method: 'DELETE' });
    draw((await api(`/api/social/${id}`)).post);
  });
  form?.addEventListener('click', (e) => { if (e.target.closest('#np-cancel-reply')) { setReply(null); form.body.value = ''; } });
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = { characterId: Number(form.characterId.value), body: form.body.value };
      if (replyTo?.id) payload.parentId = replyTo.id;
      const { post: updated } = await api(`/api/social/${id}/comments`, { method: 'POST', body: payload });
      form.body.value = '';
      setReply(null);
      draw(updated);
    } catch (err) { toast(err.message); }
  });
}
