// The Archive: a permanent place (under Home in the sidebar, it can't be removed) that keeps
// every story that has been marked complete. Archived stories stay readable but nobody can post;
// the owner (or an admin) can reopen one, and it goes back to the story list.
import { html, api, $, icons, timeAgo } from '../lib.js';
import { state, page, routeAlive, ensureAlive, refreshHome, setStoryComplete } from '../main.js';

export async function viewArchive() {
  const alive = routeAlive();
  await refreshHome();
  ensureAlive(alive);
  const done = state.home.stories.filter((s) => s.completedAt).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const canReopen = (s) => s.role === 'owner' || s.ownerId === state.user.id || state.user.isAdmin;
  const body = page({
    alive,
    title: 'Archive',
    subtitle: 'Completed stories, kept safe and read-only',
    body: done.length
      ? html`<div class="archive-grid">${done.map(
          (s) => html`
      <article class="archive-card" data-id="${s.id}">
        <a class="archive-cover" href="#/s/${s.id}" data-color="${s.color}">
          ${s.banner ? html`<img src="${s.banner}" alt="" loading="lazy">` : ''}
          <span class="archive-icon">${s.icon ? html`<img src="${s.icon}" alt="">` : s.title.slice(0, 2)}</span>
        </a>
        <div class="archive-info">
          <a href="#/s/${s.id}"><b>${s.title}</b></a>
          <small class="muted">Completed ${timeAgo(s.completedAt)} · ${s.memberCount} writers · ${s.postCount} posts</small>
          <div class="archive-actions"><a class="btn sm" href="#/s/${s.id}">Read</a>
            ${canReopen(s) ? html`<button type="button" class="sm" data-reopen="${s.id}">Reopen</button>` : ''}</div>
        </div>
      </article>`,
        )}</div>`
      : html`<div class="empty archive-empty">${icons.archive}<h2>Nothing archived yet</h2>
        <p class="muted">When a story is finished, its owner can mark it complete (long-press or right-click the story, or open its menu). It moves here, read-only, and can be reopened any time.</p></div>`,
  });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-reopen]');
    if (!b) return;
    await setStoryComplete(Number(b.dataset.reopen), false);
    viewArchive();
  });
}
