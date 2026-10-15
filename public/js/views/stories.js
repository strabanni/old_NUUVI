// Stories on THE NU, like Instagram's: the row of circles at the top of the feed. A character posts a
// photo, a video or a text card on a colour; it stays up for 24 hours. Tap a circle to watch:
// bars along the top fill as each one plays, tap the right side for the next one and the left for
// the one before, hold to pause, swipe down (or press Esc) to close, and reply from the bottom.
import { html, render, api, $, $$, toast, avatar, icons, modal, confirmModal, attachSheet, uploadFile, applyColors } from '../lib.js';
import { state, playableCharacters, onLeave } from '../main.js';
import { agoShort, handleOf } from './social.js';

const PHOTO_MS = 5000;
const TEXT_COLORS = ['#C93D72', '#EE719E', '#1C1C1E', '#3A5A8C', '#2E7D5B', '#B5651D', '#6B4FA0', '#F2F2F2'];

export const loadStoryGroups = () => api('/api/social-stories').then((r) => r.groups).catch(() => []);

// The row of circles. "Your story" comes first (tap + to add one), then everyone else's: a pink
// ring while there's something you haven't watched, grey once you've seen it all.
export async function mountStoryStrip(box) {
  const [groups, mine] = await Promise.all([loadStoryGroups(), playableCharacters().catch(() => [])]);
  if (!box.isConnected) return;
  const own = groups.filter((g) => g.mine);
  const others = groups.filter((g) => !g.mine);
  const me = own[0]?.character || mine[0];
  render(box, html`
    ${me ? html`<div class="nu-story you">
      <button type="button" class="ring ${own.length ? (own.every((g) => g.allSeen) ? 'seen' : '') : 'none'}" data-sv="${own.length ? 'mine' : 'new'}" aria-label="${own.length ? 'Watch your story' : 'Add to your story'}">${avatar({ name: me.name, src: me.avatar, color: me.color })}</button>
      <button type="button" class="sv-add" data-sv="new" aria-label="Add to your story">${icons.plus}</button>
      <small>Your story</small></div>` : ''}
    ${others.map((g, i) => html`<button type="button" class="nu-story" data-sv="${i}" aria-label="Watch ${g.character.name}'s story">
      <span class="ring ${g.allSeen ? 'seen' : ''}">${avatar({ name: g.character.name, src: g.character.avatar, color: g.character.color })}</span>
      <small>${g.character.handle || g.character.name}</small></button>`)}`);
  applyColors(box);
  box.onclick = async (e) => {
    const b = e.target.closest('[data-sv]');
    if (!b) return;
    if (b.dataset.sv === 'new') {
      if (await openStoryComposer()) mountStoryStrip(box);
      return;
    }
    const list = b.dataset.sv === 'mine' ? own : others;
    const at = b.dataset.sv === 'mine' ? 0 : Number(b.dataset.sv);
    openStoryViewer(list, at, { onClose: () => mountStoryStrip(box) });
  };
}

// Post a story: a photo, a video, or words on a colour.
export async function openStoryComposer({ characterId = null } = {}) {
  const mine = await playableCharacters(true);
  if (!mine.length) { toast('Create a character first. Stories are posted by characters'); return null; }
  let kind = 'photo';
  let media = null;
  let bg = TEXT_COLORS[0];
  return modal(html`
    <form class="story-form">
      <h2>New story</h2>
      <label for="st-char">Post as</label>
      <select id="st-char" name="characterId">${mine.map((c) => html`<option value="${c.id}" ${c.id === characterId ? 'selected' : ''}>${c.name}</option>`)}</select>
      <div class="seg st-kinds" role="group" aria-label="Story type">
        <button type="button" data-kind="photo" aria-pressed="true">${icons.image} Photo</button>
        <button type="button" data-kind="video" aria-pressed="false">${icons.video} Video</button>
        <button type="button" data-kind="text" aria-pressed="false">${icons.text} Text</button>
      </div>
      <div class="st-preview" id="st-preview"></div>
      <div class="st-colors" id="st-colors" hidden>${TEXT_COLORS.map((c) => html`<button type="button" class="st-color" data-bg="${c}" data-color="${c}" aria-label="Background ${c}" aria-pressed="${c === bg}"></button>`)}</div>
      <label for="st-body" id="st-body-label">Caption <span class="muted small">(optional)</span></label>
      <textarea id="st-body" name="body" rows="2" maxlength="500" placeholder="Say something…"></textarea>
      <p class="hint">Stories show at the top of THE NU for 24 hours.</p>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Share</button></div>
    </form>`, {
    init: (d) => {
      const preview = $('#st-preview', d);
      const draw = () => {
        $$('[data-kind]', d).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
        $('#st-colors', d).hidden = kind !== 'text';
        render($('#st-body-label', d), kind === 'text' ? html`Your text` : html`Caption <span class="muted small">(optional)</span>`);
        $$('.st-color', d).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bg === bg)));
        if (kind === 'text') {
          render(preview, html`<div class="st-card" data-color="${bg}"><span>${$('#st-body', d).value || 'Your words here'}</span></div>`);
        } else if (media) {
          render(preview, html`${kind === 'video' ? html`<video src="${media}" muted playsinline autoplay loop></video>` : html`<img src="${media}" alt="">`}
            <button type="button" class="sm st-swap" data-pick>Change</button>`);
        } else {
          render(preview, html`<button type="button" class="st-pick" data-pick>${kind === 'video' ? icons.video : icons.image}<span>${kind === 'video' ? 'Choose a video' : 'Choose a photo'}</span></button>`);
        }
        applyColors(preview);
      };
      draw();
      $('#st-body', d).addEventListener('input', () => { if (kind === 'text') draw(); });
      d.addEventListener('click', (e) => {
        const k = e.target.closest('[data-kind]');
        if (k) { if (k.dataset.kind !== kind) { kind = k.dataset.kind; media = null; } draw(); return; }
        const c = e.target.closest('[data-bg]');
        if (c) { bg = c.dataset.bg; draw(); return; }
        if (!e.target.closest('[data-pick]')) return;
        if (kind === 'photo') {
          attachSheet({ max: 1, onPictures: ([url]) => { if (url) { media = url; draw(); } } });
        } else {
          const f = Object.assign(document.createElement('input'), { type: 'file', accept: 'video/mp4,video/quicktime,video/webm' });
          f.onchange = async () => {
            if (!f.files[0]) return;
            toast('Uploading…');
            try { media = await uploadFile(f.files[0]); toast('Uploaded'); draw(); } catch (err) { toast(err.message); }
          };
          f.click();
        }
      });
    },
    submit: async (data) => {
      if (kind !== 'text' && !media) throw new Error(kind === 'video' ? 'Choose a video first' : 'Choose a photo first');
      const body = { characterId: Number(data.characterId), kind, body: data.body || '', ...(kind === 'text' ? { bg } : { media }) };
      const { story } = await api('/api/social-stories', { method: 'POST', body });
      toast('Added to your story');
      return story;
    },
  });
}

// The full-screen viewer. `groups` is a list of { character, stories }; it starts at groups[at]
// on the first story not seen yet, and moves on to the next person when one finishes.
export function openStoryViewer(groups, at = 0, { onClose } = {}) {
  if (!groups.length) return;
  document.querySelector('.sv')?.remove();
  let gi = at;
  let si = Math.max(0, groups[gi].stories.findIndex((s) => !s.seen));
  let started = 0;
  let elapsed = 0;
  let paused = false;
  let raf = 0;
  let replyAs = null;
  const root = document.createElement('div');
  root.className = 'sv';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Story');
  document.body.append(root);
  document.body.classList.add('sv-open');

  const story = () => groups[gi].stories[si];
  const duration = () => {
    const v = $('video.sv-media', root);
    return story().kind === 'video' && v && Number.isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration, 60) * 1000 : PHOTO_MS;
  };

  function draw() {
    const g = groups[gi];
    const s = story();
    const c = g.character;
    render(root, html`
      <div class="sv-frame">
        <div class="sv-bars">${g.stories.map((x, i) => html`<i><b class="${i < si ? 'done' : ''}"></b></i>`)}</div>
        <header class="sv-head">
          <a class="sv-who" href="#/c/${c.id}" data-sv-close>${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}<b>${handleOf(c)}</b><small>${agoShort(s.createdAt)}</small></a>
          <span class="sv-head-actions">
            ${s.kind === 'video' ? html`<button type="button" class="sv-btn" data-sv-sound aria-label="Sound on">${icons.mute}</button>` : ''}
            ${s.mine || state.user.isAdmin ? html`<button type="button" class="sv-btn" data-sv-delete aria-label="Delete this story">${icons.more}</button>` : ''}
            <button type="button" class="sv-btn" data-sv-close aria-label="Close">✕</button>
          </span>
        </header>
        <div class="sv-stage">
          ${s.kind === 'photo' ? html`<img class="sv-media" src="${s.media}" alt="">`
            : s.kind === 'video' ? html`<video class="sv-media" src="${s.media}" playsinline muted autoplay preload="auto"></video>`
            : html`<div class="sv-text" data-color="${s.bg || TEXT_COLORS[0]}"><p>${s.body}</p></div>`}
          ${s.kind !== 'text' && s.body ? html`<p class="sv-caption">${s.body}</p>` : ''}
          <button type="button" class="sv-tap prev" data-sv-step="-1" aria-label="Previous"></button>
          <button type="button" class="sv-tap next" data-sv-step="1" aria-label="Next"></button>
        </div>
        <footer class="sv-foot">
          ${s.mine ? html`<span class="sv-views">${icons.users} Seen by ${s.views ?? 0}</span>`
            : html`<form class="sv-reply" id="sv-reply"><input name="text" autocomplete="off" maxlength="1000" placeholder="Reply to ${handleOf(c)}…" aria-label="Reply">
              <button type="button" class="sv-btn" data-sv-heart aria-label="Send a heart">${icons.heart}</button>
              <button type="submit" class="sv-btn" aria-label="Send">${icons.send}</button></form>`}
        </footer>
      </div>`);
    applyColors(root);
    started = performance.now();
    elapsed = 0;
    const v = $('video.sv-media', root);
    if (v) {
      v.addEventListener('ended', () => step(1));
      v.play().catch(() => {});
    }
    if (!s.seen) {
      s.seen = true;
      g.allSeen = g.stories.every((x) => x.seen);
      api(`/api/social-stories/${s.id}/seen`, { method: 'POST', body: {} }).catch(() => {});
    }
    tick();
  }

  function tick() {
    cancelAnimationFrame(raf);
    const bar = $$('.sv-bars b', root)[si];
    const loop = () => {
      const now = performance.now();
      const p = paused ? elapsed : elapsed + (now - started);
      const frac = Math.min(1, p / duration());
      bar?.style.setProperty('width', `${frac * 100}%`);
      if (frac >= 1 && story().kind !== 'video') { step(1); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  function pause() {
    if (paused) return;
    paused = true;
    elapsed += performance.now() - started;
    $('video.sv-media', root)?.pause();
  }
  function resume() {
    if (!paused) return;
    paused = false;
    started = performance.now();
    $('video.sv-media', root)?.play().catch(() => {});
  }
  function step(dir) {
    const g = groups[gi];
    if (dir > 0) {
      if (si < g.stories.length - 1) si += 1;
      else if (gi < groups.length - 1) { gi += 1; si = Math.max(0, groups[gi].stories.findIndex((s) => !s.seen)); }
      else return close();
    } else if (si > 0) si -= 1;
    else if (gi > 0) { gi -= 1; si = groups[gi].stories.length - 1; }
    else { started = performance.now(); elapsed = 0; return; } // first story: start it again
    paused = false;
    draw();
  }
  function close() {
    cancelAnimationFrame(raf);
    root.remove();
    document.body.classList.remove('sv-open');
    document.removeEventListener('keydown', onKey);
    onClose?.();
  }
  const onKey = (e) => {
    if (e.target.closest?.('.sv-reply')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === ' ') { e.preventDefault(); if (paused) resume(); else pause(); }
  };
  document.addEventListener('keydown', onKey);
  onLeave(() => { if (root.isConnected) close(); });

  // Hold to pause; a quick tap on either side moves on. Swipe down to close.
  let down = null;
  root.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.sv-stage')) return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    setTimeout(() => { if (down && performance.now() - down.t >= 180) pause(); }, 200);
  });
  root.addEventListener('pointerup', (e) => {
    if (!down) return;
    const d = down;
    down = null;
    if (e.clientY - d.y > 90 && Math.abs(e.clientX - d.x) < 80) { close(); return; }
    if (paused && performance.now() - d.t >= 180) { resume(); return; }
    const tap = e.target.closest('[data-sv-step]');
    if (tap) step(Number(tap.dataset.svStep));
  });
  root.addEventListener('pointercancel', () => { down = null; resume(); });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.sv-stage')) e.preventDefault(); });

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-sv-close]')) { close(); return; }
    const snd = e.target.closest('[data-sv-sound]');
    if (snd) {
      const v = $('video.sv-media', root);
      if (v) { v.muted = !v.muted; render(snd, v.muted ? icons.mute : icons.sound); snd.setAttribute('aria-label', v.muted ? 'Sound on' : 'Sound off'); }
      return;
    }
    if (e.target.closest('[data-sv-delete]')) {
      pause();
      if (!(await confirmModal('Delete this story?', { ok: 'Delete', danger: true }))) { resume(); return; }
      try {
        await api(`/api/social-stories/${story().id}`, { method: 'DELETE' });
        const g = groups[gi];
        g.stories.splice(si, 1);
        if (!g.stories.length) { groups.splice(gi, 1); if (!groups.length) return close(); gi = Math.min(gi, groups.length - 1); si = 0; } else si = Math.min(si, g.stories.length - 1);
        toast('Story deleted');
        paused = false;
        draw();
      } catch (err) { toast(err.message); resume(); }
      return;
    }
    if (e.target.closest('[data-sv-heart]')) { reply('❤️'); return; }
    // Keyboard (Enter / Space on the side buttons) moves too; pointer taps are handled above.
    const tap = e.target.closest('[data-sv-step]');
    if (tap && e.detail === 0) step(Number(tap.dataset.svStep));
  });
  root.addEventListener('focusin', (e) => { if (e.target.closest('.sv-reply')) pause(); });
  root.addEventListener('focusout', (e) => { if (e.target.closest('.sv-reply')) resume(); });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.text;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.blur();
    reply(text);
  });

  // A reply goes to the character's phone as a text, from one of your characters (like a DM on Instagram).
  async function reply(text) {
    const to = groups[gi].character;
    try {
      const mine = await playableCharacters();
      if (!mine.length) { toast('Create a character first to reply'); return; }
      const as = mine.find((c) => c.id === replyAs) || mine[0];
      replyAs = as.id;
      const { thread } = await api(`/api/phone/${as.id}/threads`, { method: 'POST', body: { withId: to.id } });
      const body = text === '❤️' ? '❤️ Loved your story' : `Replied to your story: ${text}`;
      await api(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: { as: as.id, body } });
      toast(`Sent to ${to.name} from ${as.name}'s phone`);
    } catch (err) { toast(err.message); }
  }

  draw();
}
