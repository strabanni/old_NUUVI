import { html, render, api, $, $$, toast, avatar, icons, modal, confirmModal, uploadImage, formatPost } from '../lib.js';
import { state, page, myCharacters, setAmbient, routeAlive, ensureAlive } from '../main.js';

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
        <div id="pic-preview">${avatar({ name: c.name || '?', src: c.avatar, color: c.color || '#c6b2f0', size: 'xl' })}</div>
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
        <div class="fixed"><label for="c-color">Color</label><input id="c-color" type="color" name="color" value="${c.color || '#c6b2f0'}"></div>
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
      <span class="char-info"><h3 class="cast-name" data-color="${c.color}">${c.name}</h3>${c.tagline ? html`<p>${c.tagline}</p>` : ''}</span>
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

export async function viewCharacter(id) {
  const alive = routeAlive();
  const { character: c } = await api(`/api/characters/${id}`);
  ensureAlive(alive);
  const mine = c.owner.id === state.user?.id;
  const pic = c.portrait || c.avatar;
  page({
    alive,
    title: c.name,
    subtitle: c.tagline,
    actions: mine ? html`<button class="sm" id="edit">Edit</button>` : '',
    body: html`
      <div class="char-layout">
        <div class="portrait" data-color="${c.color}">
          ${pic ? html`<img src="${pic}" alt="${c.name}">` : html`<span class="initial">${c.name.charAt(0).toUpperCase()}</span>`}
          ${c.details.length ? html`<span class="name-tag"><b>${c.name}</b>${c.details[0] ? html` (${c.details[0].value})` : ''}</span>` : ''}
        </div>
        <section class="card char-sheet" data-color="${c.color}">
          <span class="script">character profile</span>
          <h1 class="big-name cast-name" data-color="${c.color}">${c.name}</h1>
          ${c.tagline ? html`<p class="muted">${c.tagline}</p>` : ''}
          <a class="played-by" href="#/u/${c.owner.id}">${avatar({ name: c.owner.displayName, src: c.owner.avatar, size: 'xs' })} played by ${c.owner.displayName}</a>
          ${c.details.length ? html`<div class="info-grid">${c.details.map((d) => html`<div class="info"><span class="eyebrow">${d.label}</span><div>${d.value}</div></div>`)}</div>` : ''}
        </section>
      </div>
      ${c.bio ? html`<section class="card spaced"><span class="eyebrow">Biography</span><div class="prose spaced">${formatPost(c.bio)}</div></section>` : ''}`,
  });
  setAmbient(pic);
  $('#main #edit')?.addEventListener('click', async () => {
    if (await editCharacter(c)) { state.characters = null; viewCharacter(id); }
  });
}
