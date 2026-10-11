import { html, render, api, $, $$, toast, avatar, icons, modal, confirmModal, uploadImage, formatPost } from '../lib.js';
import { state, page, myCharacters, routeAlive, ensureAlive } from '../main.js';

function characterForm(c = {}) {
  return html`
    <form class="char-form">
      <h2>${c.id ? 'Edit character' : 'New character'}</h2>
      <div class="char-pic-row">
        <div class="char-pic" id="pic-preview">${avatar({ name: c.name || '?', src: c.avatar, color: c.color || '#9b7bff', size: 'xl' })}</div>
        <div class="stack">
          <label class="btn sm file-btn">Upload picture<input type="file" accept="image/*" id="pic-file" hidden></label>
          ${c.avatar ? html`<button type="button" class="link" id="pic-clear">Remove picture</button>` : ''}
          <input type="hidden" name="avatar" value="${c.avatar || ''}">
        </div>
      </div>
      <div class="row">
        <div><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="60" value="${c.name || ''}"></div>
        <div class="fixed"><label for="c-color">Color</label><input id="c-color" type="color" name="color" value="${c.color || '#9b7bff'}"></div>
      </div>
      <label for="c-tag">Tagline</label>
      <input id="c-tag" name="tagline" maxlength="140" placeholder="A wandering bard with a debt to pay" value="${c.tagline || ''}">
      <label for="c-bio">Bio</label>
      <textarea id="c-bio" name="bio" maxlength="20000" rows="9" placeholder="Appearance, personality, history, relationships… (*formatting* works here too)">${c.bio || ''}</textarea>
      <div class="error"></div>
      <div class="actions end">
        ${c.id ? html`<button type="button" class="danger" id="char-delete">Delete</button><span class="spacer"></span>` : ''}
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">Save</button>
      </div>
    </form>`;
}

export function editCharacter(c = {}) {
  return modal(characterForm(c), {
    init: (d, close) => {
      const form = d.querySelector('form');
      const preview = $('#pic-preview', d);
      const showPic = () => render(preview, avatar({ name: form.name.value || '?', src: form.avatar.value, color: form.color.value, size: 'xl' }));
      $('#pic-file', d).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          form.avatar.value = await uploadImage(file, 512);
          showPic();
        } catch (err) { toast(err.message); }
      });
      $('#pic-clear', d)?.addEventListener('click', () => { form.avatar.value = ''; showPic(); });
      form.color.addEventListener('input', showPic);
      $('#char-delete', d)?.addEventListener('click', async () => {
        if (!(await confirmModal(`Delete ${c.name}? Their posts will remain, without a name.`, { ok: 'Delete', danger: true }))) return;
        await api(`/api/characters/${c.id}`, { method: 'DELETE' });
        close(true);
      });
    },
    submit: async (data) => {
      await api(c.id ? `/api/characters/${c.id}` : '/api/characters', { method: c.id ? 'PUT' : 'POST', body: data });
      return true;
    },
  });
}

export async function viewCharacters() {
  const alive = routeAlive();
  const characters = await myCharacters(true);
  const body = page({
    alive,
    title: 'Your characters',
    actions: html`<button class="primary" id="new-char">${icons.plus} New</button>`,
    body: characters.length
      ? html`<div class="char-grid">${characters.map((c) => html`
          <div class="card char-card" data-color="${c.color}">
            <a href="#/c/${c.id}" class="char-card-pic">${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xl' })}</a>
            <div class="grow">
              <h3><a href="#/c/${c.id}" data-color="${c.color}" class="cast-name">${c.name}</a></h3>
              ${c.tagline ? html`<p class="muted small">${c.tagline}</p>` : ''}
            </div>
            <button class="sm" data-edit="${c.id}">Edit</button>
          </div>`)}</div>`
      : html`<div class="card empty"><p>Every story needs a cast. Create your first character to start writing in character.</p></div>`,
  });
  const done = async (changed) => { if (changed) { toast('Saved'); await viewCharacters(); } };
  $('#main .head-actions #new-char').addEventListener('click', async () => done(await editCharacter()));
  $$('[data-edit]', body).forEach((b) => b.addEventListener('click', async () => {
    done(await editCharacter(characters.find((c) => c.id === Number(b.dataset.edit))));
  }));
}

export async function viewCharacter(id) {
  const alive = routeAlive();
  const { character: c } = await api(`/api/characters/${id}`);
  const mine = c.owner.id === state.user?.id;
  page({
    alive,
    title: c.name,
    actions: mine ? html`<button class="sm" id="edit">Edit</button>` : '',
    body: html`
      <article class="card profile narrow" data-color="${c.color}">
        <div class="profile-banner"></div>
        <div class="profile-head">
          ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xxl' })}
          <div>
            <h2 class="cast-name" data-color="${c.color}">${c.name}</h2>
            ${c.tagline ? html`<p class="muted">${c.tagline}</p>` : ''}
            <p class="small muted">Played by <a href="#/u/${c.owner.id}">${c.owner.displayName}</a></p>
          </div>
        </div>
        ${c.bio ? html`<div class="body prose">${formatPost(c.bio)}</div>` : html`<p class="muted">No bio yet.</p>`}
      </article>`,
  });
  $('#main #edit')?.addEventListener('click', async () => {
    if (await editCharacter(c)) { state.characters = null; viewCharacter(id); }
  });
}
