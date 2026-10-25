// Characters: the create/edit form, the character cards in lists, and a character's own page
// (picture, numbers, bio, and the Posts / Tagged / Episodes / Ties / Timeline / About tabs).
import {
  html,
  esc,
  raw,
  render,
  api,
  $,
  $$,
  toast,
  avatar,
  icons,
  menu,
  modal,
  confirmModal,
  uploadImage,
  formatPost,
  timeAgo,
  askImageLink,
  gradAttr,
  applyColors,
  attachSheet,
  BRAND_GRADIENT,
  GRADIENT_PRESETS,
  akaHtml,
} from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive, kindIcon, replaceHash } from '../main.js';
import { openThreadForm } from './threads.js';
import { compact, openSocialComposer, handleOf, npcBadges, showPeople } from './social.js';
import { dossierAbout, editDossier, wireGallery } from './profiles.js';
import { loadStoryGroups, openStoryViewer, openStoryComposer } from './stories.js';
import { drawTies, drawTimeline } from './world.js';
import { openBatch } from './batches.js';

// The two details every character has, each picked from a short list.
const DETAILS = [
  { key: 'ship', label: 'Shipping status', choices: ['Open to ships', 'Taken', 'Closed to ships', 'Ask the writer'] },
  { key: 'kill', label: 'Permission to kill', choices: ['Yes', 'No', 'Ask first'] },
];
const detailOf = (c, label) => (c.details || []).find((d) => d.label === label)?.value || '';
const shownDetails = (c) => DETAILS.map((d) => ({ label: d.label, value: detailOf(c, d.label) })).filter((d) => d.value);

function characterForm(c = {}) {
  return html`
    <form class="char-form">
      <span class="script muted">${c.id ? 'edit' : 'a new'} character</span>
      <h2>${c.name || 'Who are they?'}</h2>
      <div class="char-pic-row">
        <div id="pic-preview">${avatar({ name: c.name || '?', src: c.avatar, color: c.color || '#EE719E', size: 'xl' })}</div>
        <div class="stack">
          <span class="row-inline"><label class="btn sm file-btn">Avatar picture<input type="file" accept="image/*" id="pic-file" hidden></label><button type="button" class="sm link-btn" data-link="avatar">Link</button></span>
          <span class="row-inline"><label class="btn sm file-btn">Portrait (big picture)<input type="file" accept="image/*" id="portrait-file" hidden></label><button type="button" class="sm link-btn" data-link="portrait">Link</button></span>
          <span class="hint" id="portrait-state">${c.portrait ? 'Portrait set ✓' : 'Shown large on their character card'}</span>
          <span class="hint size-hint">Best sizes: avatar 800 × 800 (square) · portrait 1200 × 1500 (4:5, tall)</span>
          <span class="row-inline">
            <label class="btn sm file-btn">Thread picture<input type="file" accept="image/*" id="thread-file" hidden></label><button type="button" class="sm link-btn" data-link="threadAvatar">Link</button>
            <button type="button" class="sm" id="thread-clear" ${c.threadAvatar ? '' : 'hidden'}>Use avatar</button>
          </span>
          <span class="hint" id="thread-state">${c.threadAvatar ? 'Thread picture set ✓' : 'Optional. Shown on their thread posts instead of their social media avatar'}</span>
          <input type="hidden" name="avatar" value="${c.avatar || ''}">
          <input type="hidden" name="portrait" value="${c.portrait || ''}">
          <input type="hidden" name="threadAvatar" value="${c.threadAvatar || ''}">
        </div>
      </div>
      <div class="row">
        <div><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="60" value="${c.name || ''}"></div>
        <div><label for="c-handle">Username</label><span class="at-input"><span>@</span><input id="c-handle" name="handle" maxlength="30" value="${c.handle || ''}" placeholder="made from their name"></span></div>
        <div class="fixed"><label for="c-color">Color</label><input id="c-color" type="color" name="color" value="${c.color || '#EE719E'}"></div>
      </div>
      <div class="grad-box" data-grad="${(c.gradient || BRAND_GRADIENT).join(',')}">
        <label class="check"><input type="checkbox" name="useGradient" ${c.gradient || !c.id ? 'checked' : ''}> Use a gradient instead</label>
        <div class="grad-edit" ${c.gradient || !c.id ? '' : 'hidden'}>
          <div class="grad-presets">${GRADIENT_PRESETS.map((g, i) => html`<button type="button" class="grad-preset" data-preset="${i}" data-grad="${g.join(',')}" aria-label="Gradient ${i + 1}"></button>`)}</div>
          <div class="grad-stops">
            ${[0, 1, 2].map((i) => html`<input type="color" data-stop="${i}" value="${(c.gradient || BRAND_GRADIENT)[i] || '#B8A6DB'}" aria-label="Gradient color ${i + 1}">`)}
            <label class="check small"><input type="checkbox" id="g-three" ${(c.gradient || BRAND_GRADIENT).length > 2 ? 'checked' : ''}> 3 colors</label>
          </div>
          <p class="grad-preview body"><b class="g-name">${c.name || 'Their name'}</b>: <strong>bold</strong>, <em class="action">an action</em>, <span class="dialogue">"dialogue"</span>, <u>underlined</u>.</p>
          <p class="hint">Bold takes the first color, actions the middle, underlines the last, and dialogue and their name sweep through the whole gradient.</p>
        </div>
      </div>
      <label for="c-tag">Tagline</label>
      <input id="c-tag" name="tagline" maxlength="140" placeholder="A wandering bard with a debt to pay" value="${c.tagline || ''}">
      <div class="detail-picks">${DETAILS.map(
        (d) => html`<div>
        <label for="d-${d.key}">${d.label}</label>
        <select id="d-${d.key}" name="detail-${d.key}">
          <option value="">Not set</option>
          ${d.choices.map((v) => html`<option ${detailOf(c, d.label) === v ? 'selected' : ''}>${v}</option>`)}
        </select></div>`,
      )}</div>
      <label for="c-aka">AKA line <span class="muted small">(shown under their name in episodes). Wrap words in **double stars** to show them in the character's color.</span></label>
      <input id="c-aka" name="aka" maxlength="200" value="${c.aka || ''}" placeholder="aka **the prodigy**, (he / him) ; twenty8 ; ceo of trinity healthcare">
      <div class="row">
        <div><label for="c-followers">Followers shown</label><input id="c-followers" name="followersDisplay" inputmode="numeric" placeholder="real count" value="${c.followersDisplay ?? ''}"></div>
        <div><label for="c-following">Following shown</label><input id="c-following" name="followingDisplay" inputmode="numeric" placeholder="real count" value="${c.followingDisplay ?? ''}"></div>
      </div>
      <p class="hint">Leave the counts empty to show real follows. Set them for celebrities, influencers and the like.</p>
      <label class="check"><input type="checkbox" name="verified" ${c.verified ? 'checked' : ''}> Verified badge (for public figures)</label>
      <p class="hint">Their username is who they post as on the feed; their name shows at the top of their profile.</p>
      ${
        c.id
          ? html`<fieldset class="status-box">
        <legend>Status</legend>
        <div class="post-cat status-seg" role="radiogroup" aria-label="Status">
          <label><input type="radio" name="status" value="" ${!c.status ? 'checked' : ''}><span>Playable</span></label>
          <label><input type="radio" name="status" value="deceased" ${c.status === 'deceased' ? 'checked' : ''}><span>Deceased</span></label>
          <label><input type="radio" name="status" value="mia" ${c.status === 'mia' ? 'checked' : ''}><span>Missing in action</span></label>
        </div>
        <p class="hint">Deceased or missing characters stay on NUUVI with everything they've written, but they're no longer playable: no new posts, comments, likes, follows or texts as them. They don't become NPCs. Switch back to Playable any time (for a flashback, or a comeback).</p>
      </fieldset>`
          : ''
      }
      <label class="check"><input type="checkbox" name="private" ${c.private ? 'checked' : ''}> Private account <span class="muted small">(only followers see their posts and stories; others have to ask to follow)</span></label>
      <label class="check"><input type="checkbox" name="brand" ${c.brand ? 'checked' : ''}> This is a brand account <span class="muted small">(a shop, label, café, magazine… gets a Brand badge and shows under Directory → Brands)</span></label>
      <fieldset class="npc-box">
        <label class="check"><input type="checkbox" name="npc" ${c.npc ? 'checked' : ''}> This is supporting cast (an NPC) <span class="muted small">(listed under Supporting Cast, not with the main cast)</span></label>
        <div class="npc-auto" ${c.npc ? '' : 'hidden'}>
          <label for="c-npc-tags">Categories <span class="muted small">(so others can find them under Supporting Cast, comma separated)</span></label>
          <input id="c-npc-tags" name="npcTags" maxlength="300" value="${(c.npcTags || []).join(', ')}" placeholder="staff, foyaen, nightlife">
          <label class="check"><input type="radio" name="bot" value="" ${!c.bot ? 'checked' : ''}> I post for them myself</label>
          <label class="check"><input type="radio" name="bot" value="bot" ${c.bot === 'bot' ? 'checked' : ''}> They post and comment on their own</label>
          ${state.user?.isAdmin ? html`<label class="check"><input type="radio" name="bot" value="gossip" ${c.bot === 'gossip' ? 'checked' : ''}> Anonymous gossip account <span class="muted small">(admin only · nobody sees who runs it)</span></label>` : ''}
          <div class="npc-lines" ${c.bot ? '' : 'hidden'}>
            <p class="hint">One line per row. They pick one at random. Placeholders: <code>{name}</code> <code>{handle}</code> (whose post they're commenting on), <code>{someone}</code> (a random character), and for gossip tips <code>{a}</code> <code>{b}</code> <code>{thread}</code> <code>{story}</code>.</p>
            <label for="c-l-comments">Comments on others' posts</label>
            <textarea id="c-l-comments" rows="4" data-lines="comments" placeholder="{name} ate this 🔥">${(c.botLines?.comments || []).join('\n')}</textarea>
            <label for="c-l-posts">Their own posts</label>
            <textarea id="c-l-posts" rows="4" data-lines="posts" placeholder="people watching at the plaza is undefeated">${(c.botLines?.posts || []).join('\n')}</textarea>
            <div class="npc-gossip" ${c.bot === 'gossip' ? '' : 'hidden'}>
              <label for="c-l-tips">Tips when a public episode starts</label>
              <textarea id="c-l-tips" rows="3" data-lines="tips" placeholder="👀 spotted: {a} and {b} at {thread}">${(c.botLines?.tips || []).join('\n')}</textarea>
              <label for="c-l-finished">Tips when an episode is completed</label>
              <textarea id="c-l-finished" rows="3" data-lines="finished" placeholder="so THAT is how {thread} ended">${(c.botLines?.finished || []).join('\n')}</textarea>
            </div>
          </div>
        </div>
      </fieldset>
      <label for="c-bio">Bio</label>
      <textarea id="c-bio" name="bio" maxlength="20000" rows="8" placeholder="Appearance, personality, history, relationships… (*formatting* works here too)">${c.bio || ''}</textarea>
      <div class="error"></div>
      <div class="actions end">
        ${c.id ? html`<button type="button" class="danger" id="char-delete">Delete</button><span class="spacer"></span>` : ''}
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`;
}

export function editCharacter(c = {}) {
  let form;
  return modal(characterForm(c), {
    init: (d, close) => {
      form = d.querySelector('form');
      const preview = $('#pic-preview', d);
      const showPic = () =>
        render(preview, avatar({ name: form.name.value || '?', src: form.avatar.value, color: form.color.value, size: 'xl' }));
      const upload = (id, size, done) =>
        $(id, d).addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            done(await uploadImage(file, size, { square: id === '#pic-file' || id === '#thread-file' }));
          } catch (err) {
            toast(err.message);
          }
        });
      const set = {
        avatar: (url) => {
          form.avatar.value = url;
          showPic();
        },
        portrait: (url) => {
          form.portrait.value = url;
          $('#portrait-state', d).textContent = 'Portrait set ✓';
          if (!form.avatar.value) {
            form.avatar.value = url;
            showPic();
          }
        },
        threadAvatar: (url) => {
          form.threadAvatar.value = url;
          $('#thread-state', d).textContent = 'Thread picture set ✓';
          $('#thread-clear', d).hidden = false;
        },
      };
      upload('#pic-file', 512, set.avatar);
      upload('#portrait-file', 1400, set.portrait);
      upload('#thread-file', 800, set.threadAvatar);
      $('#thread-clear', d).addEventListener('click', (e) => {
        form.threadAvatar.value = '';
        $('#thread-state', d).textContent = 'Their avatar is used on thread posts';
        e.currentTarget.hidden = true;
      });
      d.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-link]');
        if (!b) return;
        const url = await askImageLink();
        if (url) set[b.dataset.link](url);
      });
      form.color.addEventListener('input', showPic);
      const gbox = $('.grad-box', d);
      const stops = () =>
        $$('[data-stop]', d)
          .filter((x) => x.dataset.stop !== '2' || $('#g-three', d).checked)
          .map((x) => x.value);
      const drawGrad = () => {
        $('.grad-edit', d).hidden = !form.useGradient.checked;
        $('[data-stop="2"]', d).hidden = !$('#g-three', d).checked;
        gbox.dataset.grad = stops().join(',');
        applyColors(d);
      };
      gbox.addEventListener('input', drawGrad);
      gbox.addEventListener('change', drawGrad);
      gbox.addEventListener('click', (e) => {
        const p = e.target.closest('[data-preset]');
        if (!p) return;
        const g = GRADIENT_PRESETS[Number(p.dataset.preset)];
        $$('[data-stop]', d).forEach((x, i) => {
          if (g[i]) x.value = g[i];
        });
        $('#g-three', d).checked = g.length > 2;
        drawGrad();
      });
      drawGrad();
      const npcBox = $('.npc-box', d);
      const drawNpc = () => {
        $('.npc-auto', d).hidden = !form.npc.checked;
        const bot = form.querySelector('input[name=bot]:checked')?.value || '';
        $('.npc-lines', d).hidden = !form.npc.checked || !bot;
        $('.npc-gossip', d).hidden = bot !== 'gossip';
      };
      npcBox.addEventListener('change', drawNpc);
      $('#char-delete', d)?.addEventListener('click', async () => {
        if (!(await confirmModal(`Delete ${c.name}? Their posts will remain, without a name.`, { ok: 'Delete', danger: true })))
          return;
        await api(`/api/characters/${c.id}`, { method: 'DELETE' });
        close(true);
      });
    },
    submit: async (data) => {
      data.verified = !!form.verified.checked;
      data.npc = !!form.npc.checked;
      data.brand = !!form.brand.checked;
      data.private = !!form.private.checked;
      data.gradient = form.useGradient.checked
        ? $$('[data-stop]', form)
            .filter((x) => x.dataset.stop !== '2' || form.querySelector('#g-three').checked)
            .map((x) => x.value)
        : '';
      if (data.gradient) data.color = data.gradient[0];
      delete data.useGradient;
      data.bot = data.npc ? form.querySelector('input[name=bot]:checked')?.value || null : null;
      data.botLines = Object.fromEntries(
        $$('[data-lines]', form).map((t) => [
          t.dataset.lines,
          t.value
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
        ]),
      );
      if (!data.handle) delete data.handle;
      data.details = DETAILS.map((x) => ({ label: x.label, value: data[`detail-${x.key}`] || '' })).filter((x) => x.value);
      for (const x of DETAILS) delete data[`detail-${x.key}`];
      await api(c.id ? `/api/characters/${c.id}` : '/api/characters', { method: c.id ? 'PUT' : 'POST', body: data });
      return true;
    },
  });
}

// Portrait card (Sophie Bennett reference): picture, name, tagline, counts, follow.
// Creator-card style (stacked-cards reference): name and a badge at the top, the picture behind,
// and a frosted strip at the bottom with their @username, tagline and a button.
export function characterCard(c, { editable = false } = {}) {
  const pic = c.portrait || c.avatar;
  const followers = c.followersDisplay ?? c.followers;
  const badge =
    c.status === 'deceased'
      ? 'Deceased'
      : c.status === 'mia'
        ? 'Missing'
        : c.bot === 'gossip'
          ? 'Anonymous'
          : c.brand
            ? 'Brand'
            : c.npc
              ? 'NPC'
              : c.verified
                ? 'Verified'
                : followers
                  ? `${compact(followers)} followers`
                  : '';
  return html`
    <a class="char-card ${c.status ? 'char-gone' : ''}" href="#/c/${c.id}" data-color="${c.color}"${gradAttr(c)} data-tilt>
      ${pic ? html`<img src="${pic}" alt="" loading="lazy">` : html`<span class="initial">${c.name.charAt(0).toUpperCase()}</span>`}
      <span class="cc-top">
        ${badge ? html`<span class="cc-badge">${c.status ? '' : c.verified ? icons.verified : c.npc ? '' : icons.starOutline}${badge}</span>` : ''}
        <span class="cc-name">${c.name}</span>
      </span>
      <span class="cc-glass">
        ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}
        <span class="cc-who"><b>@${c.handle || c.name}</b>${c.tagline ? html`<small>${c.tagline}</small>` : ''}</span>
        ${editable ? html`<button class="cc-btn" data-edit="${c.id}">Edit</button>` : html`<span class="cc-btn">View</span>`}
      </span>
    </a>`;
}

// Your characters live in the Directory now, under "Me".
export function viewCharacters() {
  sessionStorage.setItem('nuuvi:dir-once', 'me');
  replaceHash('#/directory');
}

// Instagram-style profile: header (picture, counts, what the owner wrote), then Posts / Threads / About tabs.
export async function viewCharacter(id) {
  const alive = routeAlive();
  const [
    { character: c, stats, threads, followedBy, requested = [], locked = false, requestCount = 0 },
    mine,
    { posts },
    storyGroups,
    prof0,
  ] = await Promise.all([
    api(`/api/characters/${id}`),
    state.user ? myCharacters() : [],
    api(`/api/social?character=${id}`),
    loadStoryGroups(),
    api(`/api/profiles/${id}`).catch(() => null),
  ]);
  // Their story, if they have one up: a ring round the picture (tap it to watch).
  const storyGroup = storyGroups.find((g) => g.character.id === Number(id));
  ensureAlive(alive);
  const own = c.owner?.id === state.user?.id;
  const pic = c.portrait || c.avatar;
  const following = followedBy.length > 0;
  const followable = mine.filter((m) => m.id !== c.id && !m.status);
  let tab = sessionStorage.getItem('nuuvi:char-tab') || 'posts';
  const body = page({
    alive,
    // The top bar, like Instagram: their @handle and blue tick (their name sits by the picture).
    title: html`${c.private ? html`<span class="ig-lock" title="Private account" aria-label="Private account">${icons.lock}</span>` : ''}${handleOf(c)}${c.verified ? html`<span class="verified" title="Verified">${icons.verified}</span>` : ''}`,
    actions: html`<button class="icon-btn" id="char-more" aria-label="More">${icons.more}</button>`,
    body: html`
      <article class="ig-profile ig2 ${c.status ? `gone gone-${c.status}` : ''}" data-color="${c.color}"${gradAttr(c)}>
        <header class="ig-head">
          ${
            own
              ? html`<button type="button" class="ig-avatar own ${storyGroup ? `has-story ${storyGroup.allSeen ? 'seen' : ''}` : ''}" id="pic-avatar" aria-label="Change the profile picture">${pic ? html`<img src="${c.avatar || pic}" alt="">` : avatar({ name: c.name, color: c.color, size: 'xxl' })}<span class="ig-cam">${icons.camera}</span></button>`
              : storyGroup
                ? html`<button type="button" class="ig-avatar has-story ${storyGroup.allSeen ? 'seen' : ''}" id="watch-story" aria-label="Watch ${c.name}'s story">${pic ? html`<img src="${c.avatar || pic}" alt="">` : avatar({ name: c.name, color: c.color, size: 'xxl' })}</button>`
                : html`<span class="ig-avatar">${pic ? html`<img src="${c.avatar || pic}" alt="">` : avatar({ name: c.name, color: c.color, size: 'xxl' })}</span>`
          }
          <div class="ig-side">
            <h1 class="ig-name">${c.name}${npcBadges(c)}</h1>
            <div class="ig-stats">
              <button type="button" data-tab-go="posts"><b>${compact(stats.socialPosts)}</b><span>posts</span></button>
              <button type="button" data-list="followers"><b>${compact(stats.followers)}</b><span>followers</span></button>
              <button type="button" data-list="following"><b>${compact(stats.following)}</b><span>following</span></button>
            </div>
          </div>
        </header>
        ${c.status ? html`<div class="gone-ribbon" role="note"><b>${c.status === 'deceased' ? 'Deceased' : 'Missing in action'}</b><span>No longer playable${c.npc ? '' : ' · not supporting cast'}</span></div>` : ''}
        <div class="ig-id">
          ${c.tagline ? html`<p class="ig-cat">${c.tagline}</p>` : ''}
          ${c.bio ? html`<div class="ig-bio prose">${formatPost(c.bio)}</div>` : ''}
          ${c.owner ? html`<a class="ig-link" href="#/u/${c.owner.id}">${icons.user}<span>Written by ${c.owner.displayName || c.owner.username}</span></a>` : ''}
        </div>
        <div class="ig-actions">
          ${
            own
              ? html`<button id="edit">Edit profile</button>${c.status ? '' : html`<button class="primary" id="new-post">${icons.plus} New post</button>`}
              ${c.npc && !c.status ? html`<button id="photo-batch">${icons.image} Photo batch</button>` : ''}
              ${followable.length ? html`<button id="follow">${following ? 'Following' : 'Follow'}</button>` : ''}
              ${c.private ? html`<button id="follow-requests">Requests${requestCount ? html` <span class="badge">${requestCount}</span>` : ''}</button>` : ''}`
              : html`<button class="${following || requested.length ? '' : 'primary'}" id="follow">${following ? 'Following' : requested.length ? 'Requested' : 'Follow'}</button>
              <button id="start-thread">Start an episode</button>
              <button class="ig-sq" data-tab-go="threads" aria-label="Episodes" title="Episodes">${icons.episode}</button>`
          }
        </div>
        <nav class="ig-tabs" role="tablist">
          <button role="tab" data-tab="posts">${icons.grid}<span>Posts</span></button>
          <button role="tab" data-tab="tagged">${icons.user}<span>Tagged</span></button>
          <button role="tab" data-tab="threads">${icons.episode}<span>Episodes</span></button>
          <button role="tab" data-tab="ties">${icons.ties}<span>Ties</span></button>
          <button role="tab" data-tab="timeline">${icons.timeline}<span>Timeline</span></button>
          <button role="tab" data-tab="about">${icons.profile}<span>About</span></button>
        </nav>
        <section id="ig-pane"></section>
      </article>`,
  });
  const pane = $('#ig-pane', body);
  let profile = prof0;
  let tagged = null; // other characters' posts this character is tagged in (loaded when the tab opens)
  const thumb = (p) => html`
    <a class="ig-tile kind-${p.kind}" href="#/p/${p.id}">
      ${
        p.kind === 'photo'
          ? html`<img src="${p.media[0]}" alt="" loading="lazy">${p.media.length > 1 ? html`<span class="ig-badge">${icons.grid}</span>` : ''}`
          : p.kind === 'video'
            ? html`<video src="${p.media[0]}" muted playsinline preload="metadata"></video><span class="ig-badge">${icons.play}</span>`
            : p.kind === 'stream'
              ? html`${p.media[0] ? html`<img src="${p.media[0]}" alt="">` : ''}<span class="ig-live">${p.meta.live === false ? 'ENDED' : 'LIVE'}</span><span class="ig-text">${p.title}</span>`
              : p.kind === 'voice'
                ? html`<span class="ig-text">${icons.mic} ${p.body || 'Voice note'}</span>`
                : html`<span class="ig-text">${p.body.slice(0, 140)}</span>`
      }
      ${p.pinned ? html`<span class="ig-pin" title="Pinned">${icons.pushpin}</span>` : ''}
      <span class="ig-hover">${icons.heartFill} ${compact(p.likes)} &nbsp; ${icons.chat} ${compact(p.commentCount)}</span>
    </a>`;
  const draw = () => {
    $$('[data-tab]', body).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (tab === 'posts' && locked) {
      // A private account you don't follow (yet).
      render(
        pane,
        html`<div class="empty ig-private">${icons.lock}<p><b>This account is private</b></p><p class="small muted">${requested.length ? 'Your follow request is waiting for an answer.' : `Follow ${c.name} to see their posts and stories.`}</p></div>`,
      );
    } else if (tab === 'posts') {
      render(
        pane,
        posts.length
          ? html`<div class="ig-grid">${posts.map(thumb)}</div>`
          : html`<div class="empty"><p>No posts yet.</p>${own && !c.status ? html`<p><button class="primary" id="first-post">Make ${c.name}'s first post</button></p>` : ''}</div>`,
      );
      $('#first-post', pane)?.addEventListener('click', newPost);
    } else if (tab === 'tagged') {
      // Posts by others that tag this character on a photo or @mention them (like Instagram's Tagged).
      if (!tagged) {
        render(pane, html`<p class="muted small ig-loading">Loading…</p>`);
        api(`/api/social?tagged=${c.id}`)
          .then((r) => {
            tagged = r.posts;
            if (tab === 'tagged') draw();
          })
          .catch(() => {
            tagged = [];
            if (tab === 'tagged') draw();
          });
        return;
      }
      render(
        pane,
        tagged.length
          ? html`<div class="ig-grid">${tagged.map((p) => html`<div class="ig-tagged">${thumb(p)}<a class="ig-by" href="#/c/${p.character.id}">${avatar({ name: p.character.name, src: p.character.avatar, color: p.character.color, size: 'xs' })}</a></div>`)}</div>`
          : html`<div class="empty"><p>No tagged posts yet.</p><p class="small muted">When someone tags ${c.name} on a photo or @mentions them in a post, it shows here.</p></div>`,
      );
    } else if (tab === 'ties') {
      drawTies(pane, c, { own, isAlive: () => tab === 'ties' && pane.isConnected });
    } else if (tab === 'timeline') {
      drawTimeline(pane, c, { isAlive: () => tab === 'timeline' && pane.isConnected });
    } else if (tab === 'threads') {
      render(
        pane,
        threads.length
          ? html`<div class="sp-threads">${threads.map(
              (t) => html`
        <a class="sp-thread status-${t.status}" href="#/s/${t.storyId}/${t.id}">
          <span class="sp-t-icon">${kindIcon(t.kind)}</span>
          <span class="grow"><strong>${t.name}</strong><small>${t.storyTitle} · ${t.postCount} posts${t.lastPostAt ? ` · ${timeAgo(t.lastPostAt)}` : ''}</small></span>
          <span class="pill-tag status-${t.status}">${{ open: 'Open', closed: 'Private', complete: 'Complete' }[t.status]}</span>
        </a>`,
            )}</div>`
          : html`<div class="empty"><p>Not in any episodes yet.</p></div>`,
      );
    } else {
      // About: the character's details, then their full profile (facts, personality, history…).
      const drawAbout = (prof) => {
        render(
          pane,
          html`
          ${c.aka ? html`<div class="info wide"><span class="eyebrow">AKA</span><div class="aka-text">${raw(akaHtml(c.aka))}</div></div>` : ''}
          ${shownDetails(c).length ? html`<div class="info-grid">${shownDetails(c).map((d) => html`<div class="info"><span class="eyebrow">${d.label}</span><div>${d.value}</div></div>`)}</div>` : ''}
          <div class="small-stats"><span><b>${compact(stats.posts)}</b> episode posts</span><span><b>${compact(stats.words)}</b> words written</span></div>
          ${prof ? dossierAbout(c, prof.dossier, { canEdit: prof.canEdit }) : html`<p class="muted small">Loading profile…</p>`}`,
        );
        applyColors(pane);
        wireGallery(pane);
        $('#about-edit', pane)?.addEventListener('click', async () => {
          if (await editDossier(c, prof.dossier)) {
            profile = null;
            draw();
          }
        });
      };
      if (profile) drawAbout(profile);
      else {
        drawAbout(null);
        api(`/api/profiles/${c.id}`)
          .then((r) => {
            profile = r;
            if (tab === 'about') drawAbout(r);
          })
          .catch(() => {});
      }
    }
  };
  draw();
  $$('[data-tab]', body).forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab;
      try {
        sessionStorage.setItem('nuuvi:char-tab', tab);
      } catch {
        /* ignore */
      }
      draw();
    }),
  );
  $$('[data-tab-go]', body).forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tabGo;
      draw();
      $('.ig-tabs', body).scrollIntoView({ behavior: 'smooth' });
    }),
  );
  $$('[data-list]', body).forEach((b) =>
    b.addEventListener('click', () =>
      showPeople(
        b.dataset.list === 'followers' ? `Following ${c.name}` : `${c.name} follows`,
        `/api/characters/${c.id}/${b.dataset.list}`,
      ),
    ),
  );
  const reload = () => viewCharacter(id);
  // Your own character: tap the profile picture to change it right here.
  const changePic = (field, label) =>
    attachSheet({
      max: 1,
      square: field === 'avatar',
      onPictures: async ([url]) => {
        if (!url) return;
        try {
          await api(`/api/characters/${c.id}`, { method: 'PUT', body: { [field]: url } });
          toast(`${label} updated`);
          reload();
        } catch (err) {
          toast(err.message);
        }
      },
    });
  $('#pic-avatar', body)?.addEventListener('click', () => changePic('avatar', 'Profile picture'));
  async function newPost() {
    if (await openSocialComposer({ characterId: c.id })) {
      tab = 'posts';
      reload();
    }
  }
  $('#new-post', body)?.addEventListener('click', newPost);
  $('#photo-batch', body)?.addEventListener('click', () => openBatch(c));
  $('#edit', body)?.addEventListener('click', async () => {
    if (await editCharacter(c)) {
      state.characters = null;
      reload();
    }
  });
  $('#start-thread', body)?.addEventListener('click', () => openThreadForm({ tag: [c.id] }));
  $('#watch-story', body)?.addEventListener('click', () => openStoryViewer([storyGroup], 0, { onClose: reload }));
  $('#main #char-more').addEventListener('click', (e) =>
    menu(e.currentTarget, [
      storyGroup && own && { label: 'Watch their story', action: () => openStoryViewer([storyGroup], 0, { onClose: reload }) },
      own &&
        !c.status && {
          label: 'Add to their story',
          action: async () => {
            if (await openStoryComposer({ characterId: c.id })) reload();
          },
        },
      c.owner && {
        label: `View ${c.owner.displayName}'s profile`,
        action: () => {
          location.hash = `#/u/${c.owner.id}`;
        },
      },
      own && { label: 'Edit character', action: () => $('#edit', body).click() },
    ]),
  );
  // Your private character: who's asked to follow, to approve or decline.
  $('#follow-requests', body)?.addEventListener('click', async () => {
    const { requests } = await api(`/api/characters/${c.id}/requests`);
    await modal(
      html`<div class="follow-reqs">
      <h2>Follow requests</h2>
      <p class="hint">${c.name}'s account is private: only followers see their posts and stories.</p>
      <div class="pc-list" id="fr-list">${
        requests.length
          ? requests.map(
              (r) => html`
        <div class="pc-item" data-req="${r.id}">${avatar({ name: r.name, src: r.avatar, color: r.color, size: 'sm' })}<span class="grow"><b>${r.name}</b><small>@${r.handle}</small></span>
          <button type="button" class="sm primary" data-fr="approve">Approve</button><button type="button" class="sm" data-fr="decline">Decline</button></div>`,
            )
          : html`<p class="muted small">No requests right now.</p>`
      }</div>
      <div class="actions end"><button type="button" data-close>Done</button></div></div>`,
      {
        init: (d) =>
          d.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-fr]');
            if (!b) return;
            const row = b.closest('[data-req]');
            try {
              await api(`/api/characters/${c.id}/requests/${row.dataset.req}`, {
                method: 'POST',
                body: { approve: b.dataset.fr === 'approve' },
              });
              render(row, html`<span class="grow muted small">${b.dataset.fr === 'approve' ? 'Approved' : 'Declined'}</span>`);
            } catch (err) {
              toast(err.message);
            }
          }),
      },
    );
    reload();
  });
  $('#follow', body)?.addEventListener('click', (e) => {
    if (!followable.length) return toast('Create a character first. Characters follow characters');
    const act = async (me) => {
      // Following, or a request still waiting: tap again to undo.
      const on = followedBy.includes(me.id) || requested.includes(me.id);
      try {
        const res = await api(`/api/characters/${c.id}/${on ? 'unfollow' : 'follow'}`, {
          method: 'POST',
          body: { asCharacterId: me.id },
        });
        toast(
          on
            ? followedBy.includes(me.id)
              ? `${me.name} unfollowed ${c.name}`
              : 'Follow request cancelled'
            : res.requested
              ? `Follow request sent. ${c.name}'s writer will approve or decline it`
              : `${me.name} now follows ${c.name}`,
        );
        reload();
      } catch (err) {
        toast(err.message);
      }
    };
    if (followable.length === 1) return act(followable[0]);
    menu(
      e.currentTarget,
      followable.map((me) => ({
        label: followedBy.includes(me.id)
          ? `✓ ${me.name} follows (unfollow)`
          : requested.includes(me.id)
            ? `${me.name}: requested (cancel)`
            : `Follow as ${me.name}`,
        action: () => act(me),
      })),
    );
  });
}
