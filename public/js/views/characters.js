import { html, esc, raw, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, uploadImage, formatPost, timeAgo, askImageLink } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive, kindIcon } from '../main.js';
import { openThreadForm } from './threads.js';
import { compact, openSocialComposer } from './social.js';

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
          <span class="row-inline">
            <label class="btn sm file-btn">Profile banner<input type="file" accept="image/*" id="banner-file" hidden></label><button type="button" class="sm link-btn" data-link="banner">Link</button>
            <button type="button" class="sm" id="banner-clear" ${c.banner ? '' : 'hidden'}>Remove banner</button>
          </span>
          <span class="hint" id="banner-state">${c.banner ? 'Banner set ✓' : 'Optional — a wide picture across the top of their profile'}</span>
          <input type="hidden" name="avatar" value="${c.avatar || ''}">
          <input type="hidden" name="portrait" value="${c.portrait || ''}">
          <input type="hidden" name="banner" value="${c.banner || ''}">
        </div>
      </div>
      <div class="row">
        <div><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="60" value="${c.name || ''}"></div>
        <div class="fixed"><label for="c-color">Color</label><input id="c-color" type="color" name="color" value="${c.color || '#EE719E'}"></div>
      </div>
      <label for="c-tag">Tagline</label>
      <input id="c-tag" name="tagline" maxlength="140" placeholder="A wandering bard with a debt to pay" value="${c.tagline || ''}">
      <label>Details</label>
      <div id="details">${details.map(detailRow)}</div>
      <datalist id="detail-suggestions">${DETAIL_SUGGESTIONS.map((d) => html`<option value="${d}">`)}</datalist>
      <button type="button" class="sm" id="add-detail">${icons.plus} Add detail</button>
      <label for="c-aka">AKA line <span class="muted small">— shown under their name in threads. Wrap words in **double stars** to show them in the character's color.</span></label>
      <input id="c-aka" name="aka" maxlength="200" value="${c.aka || ''}" placeholder="aka **the prodigy**, (he / him) ; twenty8 ; ceo of trinity healthcare">
      <div class="row">
        <div><label for="c-followers">Followers shown</label><input id="c-followers" name="followersDisplay" inputmode="numeric" placeholder="real count" value="${c.followersDisplay ?? ''}"></div>
        <div><label for="c-following">Following shown</label><input id="c-following" name="followingDisplay" inputmode="numeric" placeholder="real count" value="${c.followingDisplay ?? ''}"></div>
      </div>
      <p class="hint">Leave the counts empty to show real follows. Set them for celebrities, influencers and the like.</p>
      <label class="check"><input type="checkbox" name="verified" ${c.verified ? 'checked' : ''}> Verified badge (for public figures)</label>
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
        banner: (url) => {
          form.banner.value = url;
          $('#banner-state', d).textContent = 'Banner set ✓';
          $('#banner-clear', d).hidden = false;
        },
      };
      upload('#pic-file', 512, set.avatar);
      upload('#portrait-file', 1400, set.portrait);
      upload('#banner-file', 1800, set.banner);
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
      data.details = $$('.detail-row', form).map((r) => ({ label: r.querySelector('.d-label').value, value: r.querySelector('.d-value').value }))
        .filter((x) => x.label.trim() && x.value.trim());
      await api(c.id ? `/api/characters/${c.id}` : '/api/characters', { method: c.id ? 'PUT' : 'POST', body: data });
      return true;
    },
  });
}

// Portrait card (Sophie Bennett reference): picture, name, tagline, counts, follow.
export function characterCard(c, { editable = false } = {}) {
  const pic = c.portrait || c.avatar;
  const followers = c.followersDisplay ?? c.followers;
  return html`
    <a class="char-card" href="#/c/${c.id}" data-color="${c.color}">
      ${pic ? html`<img src="${pic}" alt="" loading="lazy">` : html`<span class="initial">${c.name.charAt(0).toUpperCase()}</span>`}
      <span class="cc-fade"></span>
      <span class="cc-info">
        <span class="cc-name">${c.name}${c.verified ? html`<span class="verified">${icons.verified}</span>` : ''}</span>
        ${c.tagline ? html`<span class="cc-tag">${c.tagline}</span>` : ''}
        <span class="cc-foot">
          ${followers !== undefined && followers !== null ? html`<span class="cc-stat">${icons.users} ${compact(followers)}</span>` : ''}
          ${editable ? html`<button class="cc-btn" data-edit="${c.id}">Edit</button>` : html`<span class="cc-btn">View ${icons.plus}</span>`}
        </span>
      </span>
    </a>`;
}

export async function viewCharacters() {
  const alive = routeAlive();
  const characters = await myCharacters(true);
  const body = page({
    alive,
    title: 'Your characters',
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

async function showPeople(title, url) {
  const { characters } = await api(url);
  await modal(html`
    <div>
      <h2>${title}</h2>
      ${characters.length ? html`<div class="stack">${characters.map((c) => html`
        <a class="row-item" href="#/c/${c.id}" data-close>${avatar({ name: c.name, src: c.avatar, color: c.color })}
          <div class="grow"><strong>${c.name}</strong>${c.tagline ? html`<div class="small muted">${c.tagline}</div>` : ''}</div></a>`)}</div>`
        : html`<p class="muted">Nobody yet.</p>`}
      <div class="actions end"><button type="button" data-close>Close</button></div>
    </div>`);
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
  const own = c.owner.id === state.user?.id;
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
      <article class="ig-profile ${c.banner ? 'has-banner' : ''}" data-color="${c.color}">
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
          <h1 class="ig-name">${c.name}${c.verified ? html`<span class="verified" title="Verified">${icons.verified}</span>` : ''}</h1>
          ${c.tagline ? html`<p class="ig-tagline">${c.tagline}</p>` : ''}
          ${c.bio ? html`<div class="ig-bio prose">${formatPost(c.bio)}</div>` : ''}
        </div>
        <div class="ig-actions">
          ${own ? html`<button id="edit">Edit profile</button><button class="primary" id="new-post">${icons.plus} New post</button>`
            : html`<button class="${following ? '' : 'primary'}" id="follow">${following ? html`${icons.check} Following` : html`${icons.userAdd} Follow`}</button>
              <button id="start-thread">${icons.quill} Start a thread</button>`}
        </div>
        <nav class="ig-tabs" role="tablist">
          <button role="tab" data-tab="posts">${icons.grid}<span>Posts</span></button>
          <button role="tab" data-tab="threads">${icons.quill}<span>Threads</span></button>
          <button role="tab" data-tab="about">${icons.profile}<span>About</span></button>
        </nav>
        <section id="ig-pane"></section>
      </article>`,
  });
  const pane = $('#ig-pane', body);
  const thumb = (p) => html`
    <a class="ig-tile kind-${p.kind}" href="#/p/${p.id}">
      ${p.kind === 'photo' ? html`<img src="${p.media[0]}" alt="" loading="lazy">${p.media.length > 1 ? html`<span class="ig-badge">${icons.grid}</span>` : ''}`
        : p.kind === 'video' ? html`<video src="${p.media[0]}" muted playsinline preload="metadata"></video><span class="ig-badge">${icons.play}</span>`
        : p.kind === 'stream' ? html`${p.media[0] ? html`<img src="${p.media[0]}" alt="">` : ''}<span class="ig-live">${p.meta.live === false ? 'ENDED' : 'LIVE'}</span><span class="ig-text">${p.title}</span>`
        : p.kind === 'voice' ? html`<span class="ig-text">${icons.mic} ${p.body || 'Voice note'}</span>`
        : html`<span class="ig-text">${p.body.slice(0, 140)}</span>`}
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
        </a>`)}</div>` : html`<div class="empty"><p>Not in any threads yet.</p></div>`);
    } else {
      render(pane, html`
        ${c.aka ? html`<div class="info wide"><span class="eyebrow">AKA</span><div class="aka-text">${raw(esc(c.aka).replace(/\*\*(.+?)\*\*/g, '<b class="accent">$1</b>'))}</div></div>` : ''}
        ${c.details.length ? html`<div class="info-grid">${c.details.map((d) => html`<div class="info"><span class="eyebrow">${d.label}</span><div>${d.value}</div></div>`)}</div>` : ''}
        <div class="small-stats"><span><b>${compact(stats.posts)}</b> thread posts</span><span><b>${compact(stats.words)}</b> words written</span></div>
        ${!c.aka && !c.details.length ? html`<div class="empty"><p>Nothing here yet.</p></div>` : ''}`);
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
    { label: `View ${c.owner.displayName}'s profile`, action: () => { location.hash = `#/u/${c.owner.id}`; } },
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
