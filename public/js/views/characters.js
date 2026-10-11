import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, uploadImage, formatPost, timeAgo } from '../lib.js';
import { state, page, myCharacters, setAmbient, routeAlive, ensureAlive, kindIcon } from '../main.js';
import { openThreadForm } from './threads.js';

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
        <div id="pic-preview">${avatar({ name: c.name || '?', src: c.avatar, color: c.color || '#F8769C', size: 'xl' })}</div>
        <div class="stack">
          <label class="btn sm file-btn">Avatar picture<input type="file" accept="image/*" id="pic-file" hidden></label>
          <label class="btn sm file-btn">Portrait (big picture)<input type="file" accept="image/*" id="portrait-file" hidden></label>
          <span class="hint" id="portrait-state">${c.portrait ? 'Portrait set ✓' : 'Shown large on their profile'}</span>
          <input type="hidden" name="avatar" value="${c.avatar || ''}">
          <input type="hidden" name="portrait" value="${c.portrait || ''}">
        </div>
      </div>
      <div class="row">
        <div><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="60" value="${c.name || ''}"></div>
        <div class="fixed"><label for="c-color">Color</label><input id="c-color" type="color" name="color" value="${c.color || '#F8769C'}"></div>
      </div>
      <label for="c-tag">Tagline</label>
      <input id="c-tag" name="tagline" maxlength="140" placeholder="A wandering bard with a debt to pay" value="${c.tagline || ''}">
      <label>Details</label>
      <div id="details">${details.map(detailRow)}</div>
      <datalist id="detail-suggestions">${DETAIL_SUGGESTIONS.map((d) => html`<option value="${d}">`)}</datalist>
      <button type="button" class="sm" id="add-detail">${icons.plus} Add detail</button>
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
      upload('#pic-file', 512, (url) => { form.avatar.value = url; showPic(); });
      upload('#portrait-file', 1400, (url) => {
        form.portrait.value = url;
        $('#portrait-state', d).textContent = 'Portrait set ✓';
        if (!form.avatar.value) { form.avatar.value = url; showPic(); }
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
      data.details = $$('.detail-row', form).map((r) => ({ label: r.querySelector('.d-label').value, value: r.querySelector('.d-value').value }))
        .filter((x) => x.label.trim() && x.value.trim());
      await api(c.id ? `/api/characters/${c.id}` : '/api/characters', { method: c.id ? 'PUT' : 'POST', body: data });
      return true;
    },
  });
}

export function characterCard(c, { editable = false } = {}) {
  const pic = c.portrait || c.avatar;
  return html`
    <a class="card char-card" href="#/c/${c.id}" data-color="${c.color}">
      <span class="char-card-pic">${pic ? html`<img src="${pic}" alt="" loading="lazy">` : html`<span class="initial">${c.name.charAt(0).toUpperCase()}</span>`}</span>
      <span class="char-info"><h3 class="cast-name" data-color="${c.color}">${c.name}</h3><p>${c.followers !== undefined ? `${c.followers} followers${c.tagline ? ' · ' : ''}` : ''}${c.tagline || ''}</p></span>
      ${editable ? html`<button class="sm edit-btn" data-edit="${c.id}">Edit</button>` : ''}
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

const fmtCount = (n) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n));

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

export async function viewCharacter(id) {
  const alive = routeAlive();
  const [{ character: c, stats, threads, followedBy }, mine] = await Promise.all([
    api(`/api/characters/${id}`),
    state.user ? myCharacters() : [],
  ]);
  ensureAlive(alive);
  const own = c.owner.id === state.user?.id;
  const pic = c.portrait || c.avatar;
  const following = followedBy.length > 0;
  const followable = mine.filter((m) => m.id !== c.id);
  page({
    alive,
    title: c.name,
    subtitle: c.tagline,
    actions: own ? html`<button class="sm" id="edit">Edit</button>` : '',
    body: html`
      <article class="social-profile" data-color="${c.color}">
        <section class="sp-hero">
          ${pic ? html`<img src="${pic}" alt="${c.name}">` : html`<span class="initial">${c.name.charAt(0).toUpperCase()}</span>`}
          <div class="sp-fade"></div>
          <div class="sp-id">
            <h1>${c.name}</h1>
            <a class="sp-handle" href="#/u/${c.owner.id}">played by @${c.owner.username}</a>
          </div>
        </section>
        <div class="sp-actions">
          ${own ? html`<button class="sp-follow" id="edit-2">Edit character</button>`
            : html`<button class="sp-follow ${following ? 'following' : ''}" id="follow">${following ? 'Following' : 'Follow'}</button>`}
          <button class="icon-btn sp-round" id="start-thread" title="Start a thread with ${c.name}" aria-label="Start a thread with ${c.name}">${icons.chat}</button>
        </div>
        <div class="sp-stats">
          <button type="button" data-list="following"><b>${fmtCount(stats.following)}</b><span>Following</span></button>
          <button type="button" data-list="followers"><b>${fmtCount(stats.followers)}</b><span>Followers</span></button>
          <button type="button" id="to-threads"><b>${fmtCount(stats.threads)}</b><span>Active threads</span></button>
        </div>
        ${c.tagline || c.bio ? html`<section class="sp-box">
          ${c.tagline ? html`<p class="sp-tagline">${c.tagline}</p>` : ''}
          ${c.bio ? html`<div class="prose">${formatPost(c.bio)}</div>` : ''}
        </section>` : ''}
        ${c.details.length ? html`<div class="info-grid">${c.details.map((d) => html`<div class="info"><span class="eyebrow">${d.label}</span><div>${d.value}</div></div>`)}</div>` : ''}
        <div class="sp-stats small-stats"><span><b>${fmtCount(stats.posts)}</b> posts</span><span><b>${fmtCount(stats.words)}</b> words written</span></div>
        <h2 class="section-title" id="threads-title">Threads</h2>
        ${threads.length ? html`<div class="sp-threads">${threads.map((t) => html`
          <a class="sp-thread status-${t.status}" href="#/s/${t.storyId}/${t.id}">
            <span class="sp-t-icon">${kindIcon(t.kind)}</span>
            <span class="grow"><strong>${t.name}</strong><small>${t.storyTitle} · ${t.postCount} posts${t.lastPostAt ? ` · ${timeAgo(t.lastPostAt)}` : ''}</small></span>
            <span class="pill-tag status-${t.status}">${({ open: 'Open', closed: 'Private', complete: 'Complete' })[t.status]}</span>
          </a>`)}</div>` : html`<p class="muted">Not in any threads yet.</p>`}
      </article>`,
  });
  setAmbient(pic);
  const reload = () => viewCharacter(id);
  for (const b of ['#edit', '#edit-2']) {
    $(`#main ${b}`)?.addEventListener('click', async () => {
      if (await editCharacter(c)) { state.characters = null; reload(); }
    });
  }
  $$('#main [data-list]').forEach((b) => b.addEventListener('click', () => showPeople(
    b.dataset.list === 'followers' ? `Following ${c.name}` : `${c.name} follows`, `/api/characters/${c.id}/${b.dataset.list}`,
  )));
  $('#main #start-thread').addEventListener('click', async () => {
    if (!state.user) return toast('Sign in first');
    openThreadForm({ tag: [c.id] });
  });
  $('#main #to-threads').addEventListener('click', () => $('#threads-title').scrollIntoView({ behavior: 'smooth' }));
  $('#main #follow')?.addEventListener('click', (e) => {
    if (!state.user) return toast('Sign in first');
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
