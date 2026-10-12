// NPCs: everyone's non-player characters in one place, so anyone can find them and tag them
// into episodes. Filter by category tag or search.
import { html, render, api, $, $$, icons, applyColors } from '../lib.js';
import { state, page, routeAlive, ensureAlive } from '../main.js';
import { characterCard, editCharacter } from './characters.js';

export async function viewNpcs() {
  const alive = routeAlive();
  let { npcs, tags } = await api('/api/npcs');
  ensureAlive(alive);
  let tag = '';
  let q = '';
  const body = page({
    alive,
    title: 'NPCs',
    subtitle: `${npcs.length} shared by everyone`,
    banner: 'the people in the background',
    actions: html`<button class="primary" id="new-npc">${icons.plus}<span class="lbl">Add an NPC</span></button>`,
    body: html`
      <div class="dir-tools">
        <input type="search" class="search" id="npc-q" placeholder="Search NPCs, categories, writers…" aria-label="Search NPCs">
      </div>
      <div class="chips no-swipe" id="npc-tags"></div>
      <p class="hint">Anyone can tag these NPCs into their episodes, even in stories their writer isn't in. Mark your own characters as NPCs in their editor.</p>
      <div id="npc-list"></div>`,
  });
  const list = $('#npc-list', body);
  function draw() {
    render($('#npc-tags', body), html`<button type="button" class="chip-btn" data-tag="" aria-pressed="${!tag}">All</button>
      ${tags.map((t) => html`<button type="button" class="chip-btn" data-tag="${t}" aria-pressed="${tag === t}">#${t}</button>`)}`);
    const shown = npcs.filter((n) => (!tag || n.npcTags.includes(tag))
      && (!q || `${n.name} ${n.handle} ${n.tagline} ${n.npcTags.join(' ')} ${n.owner.username} ${n.owner.displayName}`.toLowerCase().includes(q)));
    render(list, html`${tag ? html`<h2 class="cat-title"><span>${tag}</span><small>${shown.length} ${shown.length === 1 ? 'NPC' : 'NPCs'}</small></h2>` : ''}${shown.length ? html`<div class="char-grid npc-grid">${shown.map((n) => html`
      <div class="npc-item">
        ${characterCard(n, { editable: n.owner.id === state.user.id })}
        <div class="npc-meta"><span class="muted small">by @${n.owner.username}</span>
          ${n.npcTags.map((t) => html`<button type="button" class="tag" data-tag="${t}">#${t}</button>`)}</div>
      </div>`)}</div>`
      : html`<div class="empty"><p>${npcs.length ? 'No NPCs match.' : 'No NPCs yet.'}</p><p><button class="primary" id="empty-npc">Add the first one</button></p></div>`}`);
    applyColors(list);
  }
  draw();
  const add = async () => { if (await editCharacter({ npc: true })) viewNpcs(); };
  $('#main #new-npc').addEventListener('click', add);
  body.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tag]');
    if (t) { e.preventDefault(); tag = t.dataset.tag === tag ? '' : t.dataset.tag; draw(); return; }
    if (e.target.closest('#empty-npc')) { add(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      e.preventDefault();
      if (await editCharacter(npcs.find((n) => n.id === Number(ed.dataset.edit)))) viewNpcs();
    }
  });
  $('#npc-q', body).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
}
