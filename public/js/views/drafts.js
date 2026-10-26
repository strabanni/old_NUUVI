// Drafts: THE NU posts saved for any of your characters, to post whenever you like. Open one to
// change it or post it; the window works just like making a new post.
import { html, render, api, $, toast, avatar, icons, confirmModal, timeAgo, applyColors } from '../lib.js';
import { page, routeAlive, ensureAlive } from '../main.js';
import { openSocialComposer } from './social.js';

const KIND_WORDS = { text: 'Text', photo: 'Photo', video: 'Video', voice: 'Voice note', stream: 'Live stream' };

export async function viewDrafts() {
  const alive = routeAlive();
  let { drafts } = await api('/api/drafts');
  ensureAlive(alive);
  let who = 'all'; // which character's drafts are showing
  const body = page({
    alive,
    title: 'Drafts',
    subtitle: 'Posts saved for later',
    actions: html`<button class="primary sm" id="draft-new">${icons.plus} New draft</button>`,
    body: html`<div id="drafts"></div>`,
  });
  const box = $('#drafts', body);
  const draw = () => {
    const chars = [...new Map(drafts.map((d) => [d.character.id, d.character])).values()];
    if (who !== 'all' && !chars.some((c) => String(c.id) === who)) who = 'all';
    const shown = drafts.filter((d) => who === 'all' || String(d.character.id) === who);
    render(
      box,
      html`
      ${
        chars.length > 1
          ? html`<div class="chips no-swipe dr-who"><button type="button" class="chip-btn" data-who="all" aria-pressed="${who === 'all'}">Everyone (${drafts.length})</button>
          ${chars.map(
            (c) =>
              html`<button type="button" class="chip-btn" data-who="${c.id}" aria-pressed="${who === String(c.id)}">${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' })} ${c.name}</button>`,
          )}</div>`
          : ''
      }
      ${
        shown.length
          ? html`<div class="dr-list">${shown.map((d) => {
              const p = d.payload;
              const pics = Array.isArray(p.media) ? p.media : [];
              return html`
            <article class="dr-card" data-color="${d.character.color}">
              <button type="button" class="dr-open" data-open="${d.id}" aria-label="Open this draft">
                <span class="dr-head">${avatar({ name: d.character.name, src: d.character.avatar, color: d.character.color, size: 'sm' })}
                  <span class="grow"><b>${d.character.name}</b><small>${KIND_WORDS[p.kind] || 'Post'}${p.category === 'musing' ? ' · musing' : ''} · saved ${timeAgo(d.updatedAt)}</small></span></span>
                ${
                  pics.length && p.kind === 'photo'
                    ? html`<span class="dr-pics">${pics.slice(0, 4).map((u) => html`<img src="${u}" alt="" loading="lazy">`)}${pics.length > 4 ? html`<i>+${pics.length - 4}</i>` : ''}</span>`
                    : ''
                }
                ${p.title ? html`<span class="dr-title">${p.title}</span>` : ''}
                <span class="dr-body">${(p.body || '').trim() || html`<span class="muted">No caption yet</span>`}</span>
              </button>
              <div class="dr-actions">
                <button type="button" class="primary sm" data-post="${d.id}">${icons.send} Post now</button>
                <button type="button" class="sm" data-open="${d.id}">${icons.pencil} Edit</button>
                <button type="button" class="sm ghost danger" data-del="${d.id}" aria-label="Delete draft">${icons.trash}</button>
              </div>
            </article>`;
            })}</div>`
          : html`<div class="empty dr-empty">${icons.drafts}<h2>No drafts yet</h2>
          <p class="muted">Write a post for any of your characters and tap <b>Save as draft</b> instead of Post. It waits here until you're ready.</p></div>`
      }`,
    );
    applyColors(box);
  };
  const reload = async () => {
    ({ drafts } = await api('/api/drafts'));
    draw();
  };
  draw();
  const open = async (id) => {
    const d = drafts.find((x) => x.id === id);
    if (!d) return;
    const res = await openSocialComposer({ draft: d });
    if (res) reload();
  };
  box.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-who]');
    if (w) {
      who = w.dataset.who;
      return draw();
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!(await confirmModal('Delete this draft?', { ok: 'Delete', danger: true }))) return;
      await api(`/api/drafts/${del.dataset.del}`, { method: 'DELETE' });
      toast('Draft deleted');
      return reload();
    }
    const post = e.target.closest('[data-post]');
    if (post) {
      const d = drafts.find((x) => x.id === Number(post.dataset.post));
      if (!d) return;
      post.disabled = true;
      try {
        await api('/api/social', { method: 'POST', body: d.payload });
        await api(`/api/drafts/${d.id}`, { method: 'DELETE' });
        toast(`Posted as ${d.character.name}`);
      } catch (err) {
        toast(err.message);
      }
      return reload();
    }
    const o = e.target.closest('[data-open]');
    if (o) open(Number(o.dataset.open));
  });
  $('#main #draft-new')?.addEventListener('click', async () => {
    const res = await openSocialComposer({ characterId: who === 'all' ? null : Number(who) });
    if (res) reload();
  });
}
