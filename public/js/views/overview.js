// A story's overview: the lore page. Hero with the story's tagline and numbers, a contents bar,
// the intro and numbered sections, and the organizations of the world (conglomerates with their
// subsidiaries, then independents). Cards expand in place.
import { html, render, api, $, $$, toast, icons, modal, confirmModal, formatPost, applyColors } from '../lib.js';
import { state, page, loadStory, routeAlive, ensureAlive } from '../main.js';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
const pad = (n) => String(n).padStart(2, '0');

// A line from the gossip column, set as a pull quote.
const whisper = (text, cls = '') => html`<blockquote class="ov-whisper ${cls}"><span class="ov-qmark" aria-hidden="true">“</span><div class="prose">${formatPost(text)}</div></blockquote>`;

function orgCard(o, subs = []) {
  return html`
    <article class="ov-org ${o.kind}" data-org>
      <header>
        <div class="ov-org-id">
          <span class="eyebrow">${o.kind === 'conglomerate' ? 'Conglomerate' : o.kind === 'independent' ? 'Independent' : o.motto || 'Company'}</span>
          <h3>${o.name}</h3>
          ${o.motto && o.kind !== 'subsidiary' ? html`<p class="ov-motto"><q>${o.motto}</q></p>` : ''}
        </div>
        ${o.founded ? html`<span class="ov-founded"><small>founded</small><b>${o.founded}</b></span>` : ''}
      </header>
      ${o.body ? html`<div class="ov-org-body prose clamp">${formatPost(o.body)}</div>
        <button type="button" class="ov-more" data-more>Read more ${icons.chevron}</button>` : ''}
      ${o.whisper ? whisper(o.whisper) : ''}
      ${subs.length ? html`<div class="ov-subs">
        <span class="eyebrow">Subsidiaries</span>
        <div class="ov-sub-chips">${subs.map((s, i) => html`<button type="button" class="ov-sub-chip" data-sub="${i}" aria-expanded="false">${s.name}</button>`)}</div>
        ${subs.map((s, i) => html`<div class="ov-sub-panel" data-sub-panel="${i}" hidden>
          <div class="ov-sub-head"><b>${s.name}</b>${s.motto ? html`<span>${s.motto}</span>` : ''}</div>
          <div class="prose">${formatPost(s.body || '')}</div>${s.whisper ? whisper(s.whisper, 'small') : ''}</div>`)}
      </div>` : ''}
      ${o.credit ? html`<footer class="ov-credit">${o.credit}</footer>` : ''}
    </article>`;
}

export async function viewOverview(idStr) {
  const alive = routeAlive();
  const storyId = Number(idStr);
  const [s, data] = await Promise.all([state.story?.story.id === storyId ? state.story : loadStory(storyId), api(`/api/stories/${storyId}/overview`)]);
  ensureAlive(alive);
  const { overview: o, canEdit, stats } = data;
  const story = s.story;
  const empty = !o.intro && !o.sections?.length && !o.orgs?.length;
  const orgs = o.orgs || [];
  const congloms = orgs.filter((x) => x.kind === 'conglomerate');
  const subsOf = (name) => orgs.filter((x) => x.kind === 'subsidiary' && x.parent === name);
  const orphans = orgs.filter((x) => x.kind === 'subsidiary' && !congloms.some((c) => c.name === x.parent));
  const indies = orgs.filter((x) => x.kind === 'independent' || x.kind === 'other').concat(orphans);
  const toc = [
    ...(o.intro ? [['the-world', 'The world']] : []),
    ...(o.sections || []).filter((x) => x.title).map((x) => [slug(x.title), x.title]),
    ...(orgs.length ? [['organizations', 'Organizations']] : []),
  ];

  const body = page({
    alive,
    title: 'Overview',
    subtitle: story.title,
    actions: canEdit ? html`<button class="primary" id="ov-edit">${icons.gear}<span class="lbl">${empty ? 'Write it' : 'Edit'}</span></button>` : '',
    body: html`
      <article class="overview" data-color="${story.color}">
        <section class="ov-hero">
          ${story.banner ? html`<img src="${story.banner}" alt="">` : ''}
          <div class="ov-hero-glass">
            <span class="eyebrow">Overview · ${story.title}</span>
            <h1>${o.tagline || story.title}</h1>
            <div class="ov-stats">
              <a href="#/directory"><b>${stats.writers}</b><span>writers</span></a>
              <a href="#/directory"><b>${stats.characters}</b><span>characters</span></a>
              <a href="#/feed"><b>${stats.threads}</b><span>episodes</span></a>
              <a href="#/events"><b>${stats.events}</b><span>upcoming events</span></a>
            </div>
          </div>
        </section>
        ${toc.length > 1 ? html`<nav class="ov-toc no-swipe" aria-label="Contents">${toc.map(([id, label]) => html`<a href="#ov-${id}" data-jump="${id}">${label}</a>`)}</nav>` : ''}
        ${empty ? html`<div class="card empty"><p>No overview yet.</p>${canEdit ? html`<p class="small">Write the lore everyone should read first: the world, its rules, its companies.</p>
          <p><button class="primary" id="ov-load-lore">${icons.book} Load the FOYAEN × ENTITY lore</button></p>
          <p class="small muted">Puts in everything: the intro, the sections, all nine companies and the gossip column. You can edit any of it after.</p>` : ''}</div>` : ''}
        ${o.letter ? html`<section class="ov-letter">
          <span class="eyebrow">the column · hot off the group chat</span>
          <div class="prose">${formatPost(o.letter)}</div>
          ${o.signoff ? html`<p class="ov-signoff">${o.signoff}</p>` : ''}
        </section>` : ''}
        ${o.intro ? html`<section class="ov-block ov-intro" id="ov-the-world"><div class="prose">${formatPost(o.intro)}</div></section>` : ''}
        ${(o.sections || []).map((x, i) => html`
          <section class="ov-block ov-section" id="ov-${slug(x.title || `s${i}`)}">
            <span class="ov-num">${pad(i + 1)}</span>
            <div>${x.title ? html`<h2>${x.title}</h2>` : ''}<div class="prose">${formatPost(x.body)}</div></div>
          </section>`)}
        ${orgs.length ? html`
          <section id="ov-organizations">
            <h2 class="section-title">Organizations</h2>
            <div class="ov-congloms">${congloms.map((c) => orgCard(c, subsOf(c.name)))}</div>
            ${indies.length ? html`
              <div class="ov-indies-head"><h2 class="section-title">Independent companies</h2>${o.independentNote ? whisper(o.independentNote, 'small') : ''}</div>
              <div class="ov-indies">${indies.map((x) => orgCard(x))}</div>` : ''}
          </section>` : ''}
      </article>`,
  });
  applyColors(body);
  // "Read more" only where the text is actually cut off.
  requestAnimationFrame(() => $$('.ov-org-body.clamp', body).forEach((el) => {
    if (el.scrollHeight <= el.clientHeight + 4) { el.classList.remove('clamp'); el.nextElementSibling?.remove(); }
  }));
  body.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (more) {
      const text = more.previousElementSibling;
      const open = text.classList.toggle('clamp');
      more.classList.toggle('open', !open);
      more.firstChild.textContent = open ? 'Read more ' : 'Show less ';
      return;
    }
    const chip = e.target.closest('[data-sub]');
    if (chip) {
      const card = chip.closest('[data-org]');
      const wasOpen = chip.getAttribute('aria-expanded') === 'true';
      $$('[data-sub]', card).forEach((c) => c.setAttribute('aria-expanded', 'false'));
      $$('[data-sub-panel]', card).forEach((p) => { p.hidden = true; });
      if (!wasOpen) {
        chip.setAttribute('aria-expanded', 'true');
        $(`[data-sub-panel="${chip.dataset.sub}"]`, card).hidden = false;
      }
      return;
    }
    const j = e.target.closest('[data-jump]');
    if (j) {
      e.preventDefault();
      $(`#ov-${j.dataset.jump}`, body)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  $('#main #ov-load-lore')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const { LORE_PRESET } = await import('../lore-preset.js');
    await api(`/api/stories/${storyId}/overview`, { method: 'PUT', body: LORE_PRESET });
    toast('Lore loaded');
    await loadStory(storyId);
    viewOverview(idStr);
  });
  $('#main #ov-edit')?.addEventListener('click', async () => {
    if (await editOverview(storyId, o)) { await loadStory(storyId); viewOverview(idStr); }
  });
}

// ---------- Editor ----------
const sectionRow = (x = {}) => html`
  <div class="ov-row" data-row="section">
    <div class="ov-row-head"><input data-f="title" maxlength="160" placeholder="Section title" value="${x.title || ''}"><button type="button" class="icon-btn sm" data-del aria-label="Remove">✕</button></div>
    <textarea data-f="body" rows="5" placeholder="What everyone should know… (formatting works)">${x.body || ''}</textarea>
  </div>`;
const orgRow = (x = {}) => html`
  <div class="ov-row" data-row="org">
    <div class="ov-row-head"><input data-f="name" maxlength="120" placeholder="Name" value="${x.name || ''}"><button type="button" class="icon-btn sm" data-del aria-label="Remove">✕</button></div>
    <div class="row">
      <div><select data-f="kind">${[['conglomerate', 'Conglomerate'], ['subsidiary', 'Subsidiary of…'], ['independent', 'Independent'], ['other', 'Other']].map(([v, l]) => html`<option value="${v}" ${(x.kind || 'independent') === v ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div><input data-f="parent" maxlength="120" placeholder="Parent (for subsidiaries)" value="${x.parent || ''}"></div>
      <div class="fixed"><input data-f="founded" maxlength="40" placeholder="Founded" value="${x.founded || ''}"></div>
    </div>
    <input data-f="motto" maxlength="300" placeholder="Motto / one-line description" value="${x.motto || ''}">
    <textarea data-f="body" rows="4" placeholder="Description">${x.body || ''}</textarea>
    <input data-f="whisper" maxlength="500" placeholder="Gossip line (optional): what the column says about them" value="${x.whisper || ''}">
    <input data-f="credit" maxlength="80" placeholder="Credit (optional, e.g. © coi)" value="${x.credit || ''}">
  </div>`;

async function editOverview(storyId, o) {
  let tab = 'intro';
  return modal(html`
    <form class="ov-editor">
      <span class="eyebrow">Overview</span>
      <h2>The lore everyone reads first</h2>
      <div class="seg" role="group">${[['intro', 'Intro'], ['sections', 'Sections'], ['orgs', 'Organizations']].map(([k, l]) => html`<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`)}</div>
      <div data-pane="intro">
        <label for="ov-tag">Tagline</label><input id="ov-tag" name="tagline" maxlength="300" value="${o.tagline || ''}" placeholder="nobody in this world actually meets by accident.">
        <label for="ov-intro">Intro</label><textarea id="ov-intro" name="intro" rows="10" placeholder="Set the scene…">${o.intro || ''}</textarea>
        <p class="hint">All the formatting codes work here: **bold**, *italic*, [center], [h], [box], [hr], [color=#hex] and the rest.</p>
        <label for="ov-letter">Gossip column</label><textarea id="ov-letter" name="letter" rows="6" placeholder="hi, hello, welcome to the city…">${o.letter || ''}</textarea>
        <label for="ov-signoff">Column sign-off</label><input id="ov-signoff" name="signoff" maxlength="120" value="${o.signoff || ''}" placeholder="no comment, ever. — the column">
        <p class="hint">The column sits at the top of the overview, like a note from the city's anonymous insider. Each organization can have its own gossip line too.</p>
        <span class="row-inline"><button type="button" class="sm" id="ov-preset">${icons.book} Start from our lore (FOYAEN × ENTITY)</button>
        <button type="button" class="sm" id="ov-gossip">🖤 Add the gossip column only</button></span>
      </div>
      <div data-pane="sections" hidden><div id="ov-sections">${(o.sections || []).map(sectionRow)}</div><button type="button" class="sm" data-add="section">${icons.plus} Add section</button></div>
      <div data-pane="orgs" hidden>
        <label for="ov-note">Line under "Independent companies"</label><input id="ov-note" name="independentNote" maxlength="300" value="${o.independentNote || ''}">
        <div id="ov-orgs">${(o.orgs || []).map(orgRow)}</div><button type="button" class="sm" data-add="org">${icons.plus} Add organization</button>
      </div>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save overview</button></div>
    </form>`, {
    init: (d) => {
      const form = d.querySelector('form');
      const show = (k) => {
        tab = k;
        $$('[data-tab]', d).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === k)));
        $$('[data-pane]', d).forEach((p) => { p.hidden = p.dataset.pane !== k; });
      };
      d.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-tab]');
        if (t) return show(t.dataset.tab);
        const add = e.target.closest('[data-add]');
        if (add) {
          const box = $(add.dataset.add === 'section' ? '#ov-sections' : '#ov-orgs', d);
          box.insertAdjacentHTML('beforeend', (add.dataset.add === 'section' ? sectionRow() : orgRow()).v);
          box.lastElementChild.querySelector('input, textarea').focus();
          return;
        }
        if (e.target.closest('[data-del]')) { e.target.closest('.ov-row').remove(); return; }
        if (e.target.closest('#ov-preset')) {
          if ((form.intro.value || $$('.ov-row', d).length) && !(await confirmModal('Replace what\'s here with the FOYAEN × ENTITY lore?', { ok: 'Replace' }))) return;
          const { LORE_PRESET: p } = await import('../lore-preset.js');
          form.tagline.value = p.tagline;
          form.intro.value = p.intro;
          form.independentNote.value = p.independentNote;
          form.letter.value = p.letter;
          form.signoff.value = p.signoff;
          render($('#ov-sections', d), html`${p.sections.map(sectionRow)}`);
          render($('#ov-orgs', d), html`${p.orgs.map(orgRow)}`);
          toast('Lore loaded — check it over, then save');
          return;
        }
        if (e.target.closest('#ov-gossip')) {
          // Fills in just the column and the gossip lines, keeping everything else as it is.
          if ((form.letter.value.trim() || $$('[data-f="whisper"]', d).some((f) => f.value.trim()))
            && !(await confirmModal('Replace the gossip column and gossip lines with ours?', { ok: 'Replace' }))) return;
          const { LORE_PRESET: p } = await import('../lore-preset.js');
          form.letter.value = p.letter;
          form.signoff.value = p.signoff;
          let n = 0;
          for (const row of $$('[data-row="org"]', d)) {
            const name = $('[data-f="name"]', row).value.trim().toLowerCase();
            const match = p.orgs.find((x) => x.name.toLowerCase() === name);
            if (match?.whisper) { $('[data-f="whisper"]', row).value = match.whisper; n++; }
          }
          toast(`Gossip column added${n ? ` with ${n} gossip line${n === 1 ? '' : 's'}` : ''} — save to keep it`);
        }
      });
    },
    submit: async (data) => {
      const form = document.querySelector('dialog .ov-editor');
      const rows = (kind) => $$(`[data-row="${kind}"]`, form).map((r) => Object.fromEntries($$('[data-f]', r).map((f) => [f.dataset.f, f.value])));
      await api(`/api/stories/${storyId}/overview`, { method: 'PUT', body: {
        tagline: data.tagline, intro: data.intro, independentNote: data.independentNote, letter: data.letter, signoff: data.signoff, sections: rows('section'), orgs: rows('org') } });
      toast('Overview saved');
      return true;
    },
  });
}

// ---------- The lore, from the sidebar ----------
// One story with lore: straight to its Overview. Otherwise, a list of your stories' overviews.
export async function viewLore() {
  const alive = routeAlive();
  const { stories } = await api('/api/stories?scope=mine');
  ensureAlive(alive);
  const withLore = stories.filter((s) => s.hasOverview);
  if (withLore.length === 1) return location.replace(`#/s/${withLore[0].id}/overview`);
  page({
    alive,
    title: 'Lore',
    subtitle: 'Each story\'s overview: the world, its companies and its gossip',
    body: stories.length ? html`<div class="lore-list">${stories.map((s) => html`
      <a class="lore-card" href="#/s/${s.id}/overview">
        <span class="eyebrow">${icons.book} ${s.title}</span>
        <b>${s.hasOverview ? s.loreTagline || 'Read the overview' : 'No overview yet'}</b>
        <small>${s.hasOverview ? 'Read this first.' : s.ownerId === state.user.id ? 'Open it and tap Edit → Start from our lore, or write your own.' : 'The story owner hasn\'t written it yet.'}</small>
        <span class="lore-go">Open ${icons.chevron}</span>
      </a>`)}</div>`
      : html`<div class="card empty"><p>Join or start a story to see its lore.</p><p><a class="btn primary" href="#/discover">Discover stories</a></p></div>`,
  });
}
