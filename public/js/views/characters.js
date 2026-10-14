import { html, esc, raw, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, uploadImage, formatPost, timeAgo, askImageLink, gradAttr, applyColors, BRAND_GRADIENT, GRADIENT_PRESETS } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive, kindIcon } from '../main.js';
import { openThreadForm } from './threads.js';
import { compact, openSocialComposer, handleOf, npcBadges, showPeople } from './social.js';
import { dossierAbout, editDossier } from './profiles.js';

const DETAIL_SUGGESTIONS = ['Age', 'Pronouns', 'Face claim', 'Occupation', 'Species', 'Height', 'Birthday', 'Alignment'];

function detailRow(d = {}) {
  return html`
    <div class="detail-row">
      <input class="d-label" maxlength="30" placeholder="Label" value="${d.label || ''}" list="detail-suggestions" aria-label="Detail name">
      <input class="d-value" maxlength="200" placeholder="Value" value="${d.value || ''}" aria-label="Detail value">
      <button type="button" class="icon-btn sm" data-remove aria-label="Remove detail">✕</button>
    </div>`;
}


function characterForm(c = {}) {
  const details = c.details?.length ? c.details : [{ label: 'Age' }, { label: 'Pronouns' }];
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
          <span class="hint size-hint">Best sizes: avatar 800 × 800 (square) · portrait 1200 × 1500 (4:5, tall) · banner 1800 × 600 (3:1)</span>
          <span class="row-inline">
            <label class="btn sm file-btn">Thread picture<input type="file" accept="image/*" id="thread-file" hidden></label><button type="button" class="sm link-btn" data-link="threadAvatar">Link</button>
            <button type="button" class="sm" id="thread-clear" ${c.threadAvatar ? '' : 'hidden'}>Use avatar</button>
          </span>
          <span class="hint" id="thread-state">${c.threadAvatar ? 'Thread picture set ✓' : 'Optional — shown on their thread posts instead of their social media avatar'}</span>
          <span class="row-inline">
            <label class="btn sm file-btn">Profile banner<input type="file" accept="image/*" id="banner-file" hidden></label><button type="button" class="sm link-btn" data-link="banner">Link</button>
            <button type="button" class="sm" id="banner-clear" ${c.banner ? '' : 'hidden'}>Remove banner</button>
          </span>
          <span class="hint" id="banner-state">${c.banner ? 'Banner set ✓' : 'Optional — a wide picture across the top of their profile'}</span>
          <input type="hidden" name="avatar" value="${c.avatar || ''}">
          <input type="hidden" name="portrait" value="${c.portrait || ''}">
          <input type="hidden" name="banner" value="${c.banner || ''}">
          <input type="hidden" name="threadAvatar" value="${c.threadAvatar || ''}">
        </div>
      </div>
      <div class="row">
        <div><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="60" value="${c.name || ''}"></div>
        <div><label for="c-handle">Username</label><span class="at-input"><span>@</span><input id="c-handle" name="handle" maxlength="30" pattern="[A-Za-z0-9._]+" value="${c.handle || ''}" placeholder="made from their name"></span></div>
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
          <p class="grad-preview body"><b class="g-name">${c.name || 'Their name'}</b> — <strong>bold</strong>, <em class="action">an action</em>, <span class="dialogue">"dialogue"</span>, <u>underlined</u>.</p>
          <p class="hint">Bold takes the first color, actions the middle, underlines the last, and dialogue and their name sweep through the whole gradient.</p>
        </div>
      </div>
      <label for="c-tag">Tagline</label>
      <input id="c-tag" name="tagline" maxlength="140" placeholder="A wandering bard with a debt to pay" value="${c.tagline || ''}">
      <label>Details</label>
      <div id="details">${details.map(detailRow)}</div>
      <datalist id="detail-suggestions">${DETAIL_SUGGESTIONS.map((d) => html`<option value="${d}">`)}</datalist>
      <button type="button" class="sm" id="add-detail">${icons.plus} Add detail</button>
      <label for="c-aka">AKA line <span class="muted small">— shown under their name in episodes. Wrap words in **double stars** to show them in the character's color.</span></label>
      <input id="c-aka" name="aka" maxlength="200" value="${c.aka || ''}" placeholder="aka **the prodigy**, (he / him) ; twenty8 ; ceo of trinity healthcare">
      <div class="row">
        <div><label for="c-followers">Followers shown</label><input id="c-followers" name="followersDisplay" inputmode="numeric" placeholder="real count" value="${c.followersDisplay ?? ''}"></div>
        <div><label for="c-following">Following shown</label><input id="c-following" name="followingDisplay" inputmode="numeric" placeholder="real count" value="${c.followingDisplay ?? ''}"></div>
      </div>
      <p class="hint">Leave the counts empty to show real follows. Set them for celebrities, influencers and the like.</p>
      <label class="check"><input type="checkbox" name="verified" ${c.verified ? 'checked' : ''}> Verified badge (for public figures)</label>
      <p class="hint">Their username is who they post as on the feed; their name shows at the top of their profile.</p>
      <fieldset class="npc-box">
        <label class="check"><input type="checkbox" name="npc" ${c.npc ? 'checked' : ''}> This is an NPC <span class="muted small">(gets an NPC badge)</span></label>
        <div class="npc-auto" ${c.npc ? '' : 'hidden'}>
          <label for="c-npc-tags">Categories <span class="muted small">— so others can find them on the NPCs page (comma separated)</span></label>
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
      const showPic = () => render(preview, avatar({ name: form.name.value || '?', src: form.avatar.value, color: form.color.value, size: 'xl' }));
      const upload = (id, size, done) => $(id, d).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { done(await uploadImage(file, size)); } catch (err) { toast(err.message); }
      });
      const set = {
        avatar: (url) => { form.avatar.value = url; showPic(); },
        portrait: (url) => {
          form.portrait.value = url;
          $('#portrait-state', d).textContent = 'Portrait set ✓';
          if (!form.avatar.value) { form.avatar.value = url; showPic(); }
        },
        threadAvatar: (url) => {
          form.threadAvatar.value = url;
          $('#thread-state', d).textContent = 'Thread picture set ✓';
          $('#thread-clear', d).hidden = false;
        },
        banner: (url) => {
          form.banner.value = url;
          $('#banner-state', d).textContent = 'Banner set ✓';
          $('#banner-clear', d).hidden = false;
        },
      };
      upload('#pic-file', 512, set.avatar);
      upload('#portrait-file', 1400, set.portrait);
      upload('#banner-file', 1800, set.banner);
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
      $('#banner-clear', d).addEventListener('click', (e) => {
        form.banner.value = '';
        $('#banner-state', d).textContent = 'No banner';
        e.currentTarget.hidden = true;
      });
      form.color.addEventListener('input', showPic);
      const gbox = $('.grad-box', d);
      const stops = () => $$('[data-stop]', d).filter((x) => x.dataset.stop !== '2' || $('#g-three', d).checked).map((x) => x.value);
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
        $$('[data-stop]', d).forEach((x, i) => { if (g[i]) x.value = g[i]; });
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
      const list = $('#details', d);
      $('#add-detail', d).addEventListener('click', () => {
        if (list.children.length >= 16) return toast('16 details at most');
        list.insertAdjacentHTML('beforeend', detailRow().v);
        list.lastElementChild.querySelector('input').focus();
      });
      list.addEventListener('click', (e) => { if (e.target.closest('[data-remove]')) e.target.closest('.detail-row').remove(); });
      $('#char-delete', d)?.addEventListener('click', async () => {
        if (!(await confirmModal(`Delete ${c.name}? Their posts will remain, without a name.`, { ok: 'Delete', danger: true }))) return;
        await api(`/api/characters/${c.id}`, { method: 'DELETE' });
        close(true);
      });
    },
    submit: async (data) => {
      data.verified = !!form.verified.checked;
      data.npc = !!form.npc.checked;
      data.gradient = form.useGradient.checked ? $$('[data-stop]', form).filter((x) => x.dataset.stop !== '2' || form.querySelector('#g-three').checked).map((x) => x.value) : '';
      if (data.gradient) data.color = data.gradient[0];
      delete data.useGradient;
      data.bot = data.npc ? (form.querySelector('input[name=bot]:checked')?.value || null) : null;
      data.botLines = Object.fromEntries($$('[data-lines]', form).map((t) => [t.dataset.lines, t.value.split('\n').map((l) => l.trim()).filter(Boolean)]));
      if (!data.handle) delete data.handle;
      data.details = $$('.detail-row', form).map((r) => ({ label: r.querySelector('.d-label').value, value: r.querySelector('.d-value').value }))
        .filter((x) => x.label.trim() && x.value.trim());
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
  const badge = c.bot === 'gossip' ? 'Anonymous' : c.npc ? 'NPC' : c.verified ? 'Verified' : followers ? `${compact(followers)} followers` : '';
  return html`
    <a class="char-card" href="#/c/${c.id}" data-color="${c.color}"${gradAttr(c)} data-tilt>
      ${pic ? html`<img src="${pic}" alt="" loading="lazy">` : html`<span class="initial">${c.name.charAt(0).toUpperCase()}</span>`}
      <span class="cc-top">
        ${badge ? html`<span class="cc-badge">${c.verified ? icons.verified : c.npc ? '' : icons.starOutline}${badge}</span>` : ''}
        <span class="cc-name">${c.name}</span>
      </span>
      <span class="cc-glass">
        ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'sm' })}
        <span class="cc-who"><b>@${c.handle || c.name}</b>${c.tagline ? html`<small>${c.tagline}</small>` : ''}</span>
        ${editable ? html`<button class="cc-btn" data-edit="${c.id}">Edit</button>` : html`<span class="cc-btn">View</span>`}
      </span>
    </a>`;
}

export async function viewCharacters() {
  const alive = routeAlive();
  const characters = await myCharacters(true);
  const body = page({
    alive,
    title: 'Your characters',
    banner: 'your cast',
    subtitle: `${characters.length} in your cast`,
    actions: html`<button class="primary" id="new-char">${icons.plus} New</button>`,
    body: characters.length
      ? html`<div class="char-grid">${characters.map((c) => characterCard(c, { editable: true }))}</div>`
      : html`<div class="card empty"><p class="script">every story needs a cast</p><p>Create your first character to start writing in character.</p></div>`,
  });
  const done = async (changed) => { if (changed) { toast('Saved'); state.characters = null; await viewCharacters(); } };
  $('#main #new-char').addEventListener('click', async () => done(await editCharacter()));
  $$('[data-edit]', body).forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    done(await editCharacter(characters.find((c) => c.id === Number(b.dataset.edit))));
  }));
}

// Instagram-style profile: header (picture, counts, what the owner wrote), then Posts / Threads / About tabs.
export async function viewCharacter(id) {
  const alive = routeAlive();
  const [{ character: c, stats, threads, followedBy }, mine, { posts }] = await Promise.all([
    api(`/api/characters/${id}`),
    state.user ? myCharacters() : [],
    api(`/api/social?character=${id}`),
  ]);
  ensureAlive(alive);
  const own = c.owner?.id === state.user?.id;
  const pic = c.portrait || c.avatar;
  const following = followedBy.length > 0;
  const followable = mine.filter((m) => m.id !== c.id);
  let tab = sessionStorage.getItem('nuuvi:char-tab') || 'posts';
  const body = page({
    alive,
    title: c.name,
    subtitle: c.tagline,
    actions: html`<button class="icon-btn" id="char-more" aria-label="More">${icons.more}</button>`,
    body: html`
      ${c.banner ? html`<div class="ig-banner"><img src="${c.banner}" alt=""></div>` : ''}
      <article class="ig-profile ${c.banner ? 'has-banner' : ''}" data-color="${c.color}"${gradAttr(c)}>
        <header class="ig-head">
          <span class="ig-avatar">${pic ? html`<img src="${c.avatar || pic}" alt="">` : avatar({ name: c.name, color: c.color, size: 'xxl' })}</span>
          <div class="ig-stats">
            <button type="button" data-tab-go="posts"><b>${compact(stats.socialPosts)}</b><span>Posts</span></button>
            <button type="button" data-list="followers"><b>${compact(stats.followers)}</b><span>Followers</span></button>
            <button type="button" data-list="following"><b>${compact(stats.following)}</b><span>Following</span></button>
            <button type="button" data-tab-go="threads"><b>${compact(stats.threads)}</b><span>Threads</span></button>
          </div>
        </header>
        <div class="ig-id">
          <h1 class="ig-name">${handleOf(c)}${c.verified ? html`<span class="verified" title="Verified">${icons.verified}</span>` : ''}${npcBadges(c)}</h1>
          ${c.tagline ? html`<p class="ig-tagline">${c.tagline}</p>` : ''}
          ${c.bio ? html`<div class="ig-bio prose">${formatPost(c.bio)}</div>` : ''}
        </div>
        <div class="ig-actions">
          ${own ? html`<button id="edit">Edit profile</button><button class="primary" id="new-post">${icons.plus} New post</button>
              ${followable.length ? html`<button id="follow">${following ? html`${icons.check} Following` : html`${icons.userAdd} Follow`}</button>` : ''}`
            : html`<button class="${following ? '' : 'primary'}" id="follow">${following ? html`${icons.check} Following` : html`${icons.userAdd} Follow`}</button>
              <button id="start-thread">${icons.episode} Start an episode</button>`}
        </div>
        <nav class="ig-tabs" role="tablist">
          <button role="tab" data-tab="posts">${icons.grid}<span>Posts</span></button>
          <button role="tab" data-tab="threads">${icons.episode}<span>Episodes</span></button>
          <button role="tab" data-tab="about">${icons.profile}<span>About</span></button>
        </nav>
        <section id="ig-pane"></section>
      </article>`,
  });
  const pane = $('#ig-pane', body);
  let profile = null;
  const thumb = (p) => html`
    <a class="ig-tile kind-${p.kind}" href="#/p/${p.id}">
      ${p.kind === 'photo' ? html`<img src="${p.media[0]}" alt="" loading="lazy">${p.media.length > 1 ? html`<span class="ig-badge">${icons.grid}</span>` : ''}`
        : p.kind === 'video' ? html`<video src="${p.media[0]}" muted playsinline preload="metadata"></video><span class="ig-badge">${icons.play}</span>`
        : p.kind === 'stream' ? html`${p.media[0] ? html`<img src="${p.media[0]}" alt="">` : ''}<span class="ig-live">${p.meta.live === false ? 'ENDED' : 'LIVE'}</span><span class="ig-text">${p.title}</span>`
        : p.kind === 'voice' ? html`<span class="ig-text">${icons.mic} ${p.body || 'Voice note'}</span>`
        : html`<span class="ig-text">${p.body.slice(0, 140)}</span>`}
      ${p.pinned ? html`<span class="ig-pin" title="Pinned">${icons.pushpin}</span>` : ''}
      <span class="ig-hover">${icons.heartFill} ${compact(p.likes)} &nbsp; ${icons.chat} ${compact(p.commentCount)}</span>
    </a>`;
  const draw = () => {
    $$('[data-tab]', body).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (tab === 'posts') {
      render(pane, posts.length ? html`<div class="ig-grid">${posts.map(thumb)}</div>`
        : html`<div class="empty"><p>No posts yet.</p>${own ? html`<p><button class="primary" id="first-post">Make ${c.name}'s first post</button></p>` : ''}</div>`);
      $('#first-post', pane)?.addEventListener('click', newPost);
    } else if (tab === 'threads') {
      render(pane, threads.length ? html`<div class="sp-threads">${threads.map((t) => html`
        <a class="sp-thread status-${t.status}" href="#/s/${t.storyId}/${t.id}">
          <span class="sp-t-icon">${kindIcon(t.kind)}</span>
          <span class="grow"><strong>${t.name}</strong><small>${t.storyTitle} · ${t.postCount} posts${t.lastPostAt ? ` · ${timeAgo(t.lastPostAt)}` : ''}</small></span>
          <span class="pill-tag status-${t.status}">${({ open: 'Open', closed: 'Private', complete: 'Complete' })[t.status]}</span>
        </a>`)}</div>` : html`<div class="empty"><p>Not in any episodes yet.</p></div>`);
    } else {
      // About: the character's details, then their full profile (facts, personality, history…).
      const drawAbout = (prof) => {
        render(pane, html`
          ${c.aka ? html`<div class="info wide"><span class="eyebrow">AKA</span><div class="aka-text">${raw(esc(c.aka).replace(/\*\*(.+?)\*\*/g, '<b class="accent">$1</b>'))}</div></div>` : ''}
          ${c.details.length ? html`<div class="info-grid">${c.details.map((d) => html`<div class="info"><span class="eyebrow">${d.label}</span><div>${d.value}</div></div>`)}</div>` : ''}
          <div class="small-stats"><span><b>${compact(stats.posts)}</b> episode posts</span><span><b>${compact(stats.words)}</b> words written</span></div>
          ${prof ? dossierAbout(c, prof.dossier, { canEdit: prof.canEdit }) : html`<p class="muted small">Loading profile…</p>`}`);
        applyColors(pane);
        $('#about-edit', pane)?.addEventListener('click', async () => {
          if (await editDossier(c, prof.dossier)) { profile = null; draw(); }
        });
      };
      if (profile) drawAbout(profile);
      else {
        drawAbout(null);
        api(`/api/profiles/${c.id}`).then((r) => { profile = r; if (tab === 'about') drawAbout(r); }).catch(() => {});
      }
    }
  };
  draw();
  $$('[data-tab]', body).forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    try { sessionStorage.setItem('nuuvi:char-tab', tab); } catch { /* ignore */ }
    draw();
  }));
  $$('[data-tab-go]', body).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tabGo; draw(); $('.ig-tabs', body).scrollIntoView({ behavior: 'smooth' }); }));
  $$('[data-list]', body).forEach((b) => b.addEventListener('click', () => showPeople(
    b.dataset.list === 'followers' ? `Following ${c.name}` : `${c.name} follows`, `/api/characters/${c.id}/${b.dataset.list}`,
  )));
  const reload = () => viewCharacter(id);
  async function newPost() { if (await openSocialComposer({ characterId: c.id })) { tab = 'posts'; reload(); } }
  $('#new-post', body)?.addEventListener('click', newPost);
  $('#edit', body)?.addEventListener('click', async () => { if (await editCharacter(c)) { state.characters = null; reload(); } });
  $('#start-thread', body)?.addEventListener('click', () => openThreadForm({ tag: [c.id] }));
  $('#main #char-more').addEventListener('click', (e) => menu(e.currentTarget, [
    c.owner && { label: `View ${c.owner.displayName}'s profile`, action: () => { location.hash = `#/u/${c.owner.id}`; } },
    own && { label: 'Edit character', action: () => $('#edit', body).click() },
  ]));
  $('#follow', body)?.addEventListener('click', (e) => {
    if (!followable.length) return toast('Create a character first — characters follow characters');
    const act = async (me) => {
      const on = followedBy.includes(me.id);
      try {
        await api(`/api/characters/${c.id}/${on ? 'unfollow' : 'follow'}`, { method: 'POST', body: { asCharacterId: me.id } });
        toast(on ? `${me.name} unfollowed ${c.name}` : `${me.name} now follows ${c.name}`);
        reload();
      } catch (err) { toast(err.message); }
    };
    if (followable.length === 1) return act(followable[0]);
    menu(e.currentTarget, followable.map((me) => ({
      label: followedBy.includes(me.id) ? `✓ ${me.name} follows — unfollow` : `Follow as ${me.name}`,
      action: () => act(me),
    })));
  });
}
