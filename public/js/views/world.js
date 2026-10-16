// Ties (who a character is to whom, drawn as a web or a family tree) and a character's Timeline.
import { html, raw, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, formatPost } from '../lib.js';

// The kinds of tie, in groups for the picker.
const TIE_GROUPS = [
  ['Love', [['partner', 'Partner'], ['spouse', 'Husband or wife'], ['crush', 'Crush'], ['ex', 'Ex'], ['complicated', "It's complicated"]]],
  ['Family', [['parent', 'Parent'], ['stepparent', 'Stepparent'], ['child', 'Child'], ['stepchild', 'Stepchild'],
    ['sibling', 'Sibling'], ['halfsibling', 'Half-sibling'], ['stepsibling', 'Stepsibling'], ['grandparent', 'Grandparent'],
    ['grandchild', 'Grandchild'], ['auntuncle', 'Aunt or uncle'], ['nibling', 'Niece or nephew'], ['cousin', 'Cousin'],
    ['inlaw', 'In-law'], ['family', 'Other family']]],
  ['Everyone else', [['bestfriend', 'Best friend'], ['friend', 'Friend'], ['rival', 'Rival'], ['enemy', 'Enemy'],
    ['coworker', 'Coworker'], ['roommate', 'Roommate'], ['mentor', 'Mentor'], ['other', 'Other']]],
];
export const TIE_NAMES = Object.fromEntries(TIE_GROUPS.flatMap(([, kinds]) => kinds));
const FAMILY = new Set(TIE_GROUPS[1][1].map(([k]) => k));
// One colour per kind, so the web reads at a glance (family in greens).
const TIE_COLORS = {
  partner: '#E0446A', spouse: '#C92F5A', crush: '#F07AA0', ex: '#8A8F98', complicated: '#B5655A',
  bestfriend: '#F2A93B', friend: '#4FA3E0', rival: '#E07B39', enemy: '#C8382F', coworker: '#7C8794',
  roommate: '#56B6C2', mentor: '#9C7AE0', other: '#9AA0A6',
};
for (const k of FAMILY) TIE_COLORS[k] = '#2E9E6E';
// When the other writer named the tie, flip it round: they call us their child, so they're our parent.
const FLIP = { parent: 'child', child: 'parent', stepparent: 'stepchild', stepchild: 'stepparent', grandparent: 'grandchild',
  grandchild: 'grandparent', auntuncle: 'nibling', nibling: 'auntuncle', mentor: 'other' };
const tieName = (t) => t.label || TIE_NAMES[t.kind] || t.kind;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const niceDate = (d) => { const [y, m, day] = d.slice(0, 10).split('-').map(Number); return `${MONTHS[m - 1]} ${day}, ${y}`; };

// ---------- Ties ----------
// The web: the character in the middle, everyone they're tied to around them.
function tieWeb(c, ties) {
  const W = 320, R = 118, mid = W / 2;
  const n = ties.length;
  const spots = ties.map((t, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { t, x: mid + Math.cos(a) * R, y: mid + Math.sin(a) * R };
  });
  const svg = `<svg class="tie-web" viewBox="0 0 ${W} ${W}" role="img" aria-label="${c.name.replace(/"/g, '')}'s ties">
    ${spots.map((s) => `<line x1="${mid}" y1="${mid}" x2="${s.x.toFixed(1)}" y2="${s.y.toFixed(1)}" stroke="${TIE_COLORS[s.t.kind] || '#999'}" stroke-width="${s.t.mutual ? 3 : 1.6}" ${s.t.mutual ? '' : 'stroke-dasharray="5 4"'}/>`).join('')}
  </svg>`;
  return html`<div class="tie-stage">
    ${raw(svg)}
    <span class="tie-node center" data-x="50" data-y="50">${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'lg' })}</span>
    ${spots.map((s) => html`<a class="tie-node" href="#/c/${s.t.other.id}" data-x="${(s.x / W * 100).toFixed(2)}" data-y="${(s.y / W * 100).toFixed(2)}" title="${s.t.other.name}">
      ${avatar({ name: s.t.other.name, src: s.t.other.avatar, color: s.t.other.color, size: 'sm' })}
      <small data-tie="${s.t.kind}">${tieName(s.t)}</small></a>`)}
  </div>`;
}

async function tieForm(c, tie = null) {
  let pick = tie?.other ?? null;
  let everyone = [];
  try {
    const { writers } = await api('/api/directory');
    everyone = writers.flatMap((w) => w.characters.map((x) => ({ ...x, writer: w.username }))).filter((x) => x.id !== c.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* the picker just stays empty */ }
  return modal(html`
    <form class="tie-form">
      <h2>${tie ? `${c.name} and ${tie.other.name}` : `Add a tie for ${c.name}`}</h2>
      ${tie ? '' : html`
        <label for="tf-q">Who</label>
        <input type="search" class="search" id="tf-q" placeholder="Search characters…" autocomplete="off">
        <div class="pc-list tf-list" id="tf-list"></div>`}
      <label for="tf-kind">They are ${c.name}'s</label>
      <select id="tf-kind" name="kind">${TIE_GROUPS.map(([g, kinds]) => html`<optgroup label="${g}">${kinds.map(([k, v]) => html`<option value="${k}" ${(tie?.kind ?? 'friend') === k ? 'selected' : ''}>${v}</option>`)}</optgroup>`)}</select>
      <p class="hint">Family ties also build ${c.name}'s family tree.</p>
      <label for="tf-label">Your own word for it <span class="muted small">(optional)</span></label>
      <input id="tf-label" name="label" maxlength="40" value="${tie?.label ?? ''}" placeholder="e.g. ride or die, the one that got away">
      <label for="tf-since">Since <span class="muted small">(optional)</span></label>
      <input id="tf-since" name="since" type="date" value="${tie?.since ?? ''}">
      <label for="tf-note">A note <span class="muted small">(optional)</span></label>
      <textarea id="tf-note" name="note" maxlength="300" rows="3" placeholder="How they met, what happened…">${tie?.note ?? ''}</textarea>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${tie ? 'Save' : 'Add tie'}</button></div>
    </form>`, {
    init: (d) => {
      const list = $('#tf-list', d);
      if (!list) return;
      const draw = (q = '') => {
        const shown = everyone.filter((x) => !q || `${x.name} ${x.handle} ${x.writer}`.toLowerCase().includes(q)).slice(0, 60);
        render(list, shown.length ? html`${shown.map((x) => html`
          <button type="button" class="pc-item ${pick?.id === x.id ? 'on' : ''}" data-pick="${x.id}" aria-pressed="${pick?.id === x.id}">
            ${avatar({ name: x.name, src: x.avatar, color: x.color, size: 'sm' })}<span class="grow"><b>${x.name}</b><small>@${x.handle} · ${x.writer}</small></span><span class="pc-check">${pick?.id === x.id ? '✓' : ''}</span></button>`)}`
          : html`<p class="muted small">No one matches.</p>`);
      };
      draw();
      $('#tf-q', d).addEventListener('input', (e) => draw(e.target.value.trim().toLowerCase()));
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        pick = everyone.find((x) => x.id === Number(b.dataset.pick));
        draw($('#tf-q', d).value.trim().toLowerCase());
      });
    },
    submit: async (data) => {
      if (!pick) throw new Error('Pick who the tie is with');
      await api(`/api/characters/${c.id}/ties/${pick.id}`, { method: 'PUT', body: { kind: data.kind, label: data.label, note: data.note, since: data.since || null } });
      return true;
    },
  });
}

// The family tree: one row per generation, oldest at the top, with lines drawn between relatives.
function familyTree(fam) {
  const rows = new Map();
  for (const m of fam.members) { if (!rows.has(m.gen)) rows.set(m.gen, []); rows.get(m.gen).push(m); }
  const relName = (m) => {
    if (!m.relation) return '';
    if (m.relation.label && !m.relation.theirs) return m.relation.label;
    const k = m.relation.theirs ? (FLIP[m.relation.kind] || m.relation.kind) : m.relation.kind;
    return TIE_NAMES[k] || k;
  };
  const GEN = { '-3': 'Great-grandparents', '-2': 'Grandparents', '-1': 'Parents', 0: '', 1: 'Children', 2: 'Grandchildren', 3: 'Great-grandchildren' };
  const order = (list, gen) => {
    const byName = (a, b) => a.character.name.localeCompare(b.character.name);
    if (gen !== 0) return [...list].sort(byName);
    // The middle row: siblings and cousins on the left, the character, then their partner.
    const love = (m) => ['partner', 'spouse'].includes(m.relation?.kind);
    const center = list.filter((m) => m.character.id === fam.center);
    return [...list.filter((m) => m.character.id !== fam.center && !love(m)).sort(byName), ...center, ...list.filter(love).sort(byName)];
  };
  return html`<div class="ftree" data-links="${JSON.stringify(fam.links)}">
    <svg class="ftree-lines" aria-hidden="true"></svg>
    ${[...rows.keys()].sort((a, b) => a - b).map((g) => html`<div class="ftree-row">
      ${GEN[g] !== undefined && GEN[g] ? html`<span class="ftree-gen">${GEN[g]}</span>` : ''}
      <div class="ftree-people">${order(rows.get(g), g).map((m) => html`
        <a class="ftree-node ${m.character.id === fam.center ? 'center' : ''}" href="#/c/${m.character.id}" data-fid="${m.character.id}">
          ${avatar({ name: m.character.name, src: m.character.avatar, color: m.character.color, size: m.character.id === fam.center ? 'lg' : '' })}
          <b>${m.character.name}</b>${relName(m) ? html`<small>${relName(m)}</small>` : ''}
        </a>`)}</div></div>`)}
  </div>`;
}

// Lines between relatives, measured once the people are on screen (and again if it changes size).
function layoutTree(tree) {
  if (!tree) return;
  const links = JSON.parse(tree.dataset.links || '[]');
  const draw = () => {
    const box = tree.getBoundingClientRect();
    const z = Number(getComputedStyle(document.documentElement).zoom) || 1;
    const at = (id) => {
      const node = tree.querySelector(`[data-fid="${id}"]`);
      const a = node?.querySelector('.avatar');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const n = node.getBoundingClientRect();
      return { row: node.closest('.ftree-row'), x: (r.left + r.width / 2 - box.left) / z, top: (r.top - box.top) / z, bottom: (n.bottom - box.top + 4) / z, mid: (r.top + r.height / 2 - box.top) / z, half: r.width / 2 / z };
    };
    const svg = tree.querySelector('.ftree-lines');
    svg.setAttribute('viewBox', `0 0 ${box.width / z} ${box.height / z}`);
    svg.innerHTML = links.map((l) => {
      let a = at(l.from), b = at(l.to);
      if (!a || !b) return '';
      const color = TIE_COLORS[l.kind] || '#2E9E6E';
      if (a.row === b.row) {
        // Same row: partners side by side get a straight line; siblings and cousins a bracket above.
        const [left, right] = a.x < b.x ? [a, b] : [b, a];
        if (['partner', 'spouse', 'inlaw'].includes(l.kind)) return `<line x1="${left.x + left.half}" y1="${right.mid}" x2="${right.x - right.half}" y2="${right.mid}" stroke="${color}" stroke-width="2.5"/>`;
        const y = Math.min(left.top, right.top) - 10;
        return `<path d="M${left.x} ${left.top} V${y} H${right.x} V${right.top}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
      }
      if (a.mid > b.mid) [a, b] = [b, a];
      const midY = (a.bottom + b.top) / 2;
      const far = b.top - a.bottom > 150;
      return `<path d="M${a.x} ${a.bottom} V${midY} H${b.x} V${b.top}" fill="none" stroke="${color}" stroke-width="2" ${far ? 'stroke-dasharray="5 4"' : ''}/>`;
    }).join('');
  };
  draw();
  new ResizeObserver(draw).observe(tree);
}

let tieView = 'web';
try { tieView = sessionStorage.getItem('nuuvi:tie-view') || 'web'; } catch { /* ignore */ }

export function drawTies(pane, c, { own, isAlive = () => true }) {
  render(pane, html`<p class="muted small ig-loading">Loading…</p>`);
  const load = async () => {
    let r, fam, prof;
    try {
      [r, fam, prof] = await Promise.all([api(`/api/characters/${c.id}/ties`), api(`/api/characters/${c.id}/family`), api(`/api/profiles/${c.id}`).catch(() => null)]);
    } catch (err) { if (isAlive()) render(pane, html`<div class="empty"><p>${err.message}</p></div>`); return; }
    if (!isAlive()) return;
    const { ties, incoming } = r;
    const notes = prof?.dossier?.sections?.relationships || '';
    const family = fam.members.length > 1;
    const view = tieView === 'tree' ? 'tree' : 'web';
    render(pane, html`
      <div class="tie-bar">
        <div class="seg" role="tablist" aria-label="Show ties as">
          <button type="button" class="chip ${view === 'web' ? 'on' : ''}" data-tie-view="web" aria-pressed="${view === 'web'}">${icons.ties} Web</button>
          <button type="button" class="chip ${view === 'tree' ? 'on' : ''}" data-tie-view="tree" aria-pressed="${view === 'tree'}">${icons.users} Family tree</button>
        </div>
        ${own ? html`<button class="primary" id="tie-add">${icons.plus} Add a tie</button>` : ''}
      </div>
      ${view === 'tree'
        ? (family ? familyTree(fam) : html`<div class="empty"><p>No family yet.</p><p class="small muted">${own ? `Add a tie and pick a family kind (parent, sibling, cousin…) to start ${c.name}'s family tree.` : `${c.name}'s writer hasn't added any family yet.`}</p></div>`)
        : ties.length ? tieWeb(c, ties) : html`<div class="empty"><p>No ties yet.</p><p class="small muted">${own ? `Add the people who matter to ${c.name}: best friends, exes, rivals, family.` : `${c.name}'s writer hasn't added anyone yet.`}</p></div>`}
      ${ties.length ? html`<ul class="tie-list">${ties.map((t, i) => html`
        <li class="tie-row">
          <a href="#/c/${t.other.id}">${avatar({ name: t.other.name, src: t.other.avatar, color: t.other.color, size: 'sm' })}</a>
          <div class="grow">
            <a class="tie-who" href="#/c/${t.other.id}"><b>${t.other.name}</b></a>
            <div class="tie-what"><span class="tie-chip" data-tie="${t.kind}">${tieName(t)}</span>
              ${t.mutual ? html`<span class="small muted">${t.mutual.kind === t.kind && !t.mutual.label ? 'both ways' : `they say: ${tieName(t.mutual)}`}</span>` : html`<span class="small muted">one way</span>`}
              ${t.since ? html`<span class="small muted">· since ${niceDate(t.since)}</span>` : ''}</div>
            ${t.note ? html`<p class="small tie-note">${t.note}</p>` : ''}
          </div>
          ${own ? html`<button class="icon-btn" data-tie-more="${i}" aria-label="Change this tie">${icons.more}</button>` : ''}
        </li>`)}</ul>` : ''}
      ${incoming.length ? html`<h3 class="tie-h">Also tied to ${c.name}</h3>
        <ul class="tie-list">${incoming.map((t) => html`<li class="tie-row">
          <a href="#/c/${t.from.id}">${avatar({ name: t.from.name, src: t.from.avatar, color: t.from.color, size: 'sm' })}</a>
          <div class="grow"><a class="tie-who" href="#/c/${t.from.id}"><b>${t.from.name}</b></a>
            <div class="tie-what"><span class="small muted">calls ${c.name} their</span> <span class="tie-chip" data-tie="${t.kind}">${tieName(t)}</span></div></div>
          ${own ? html`<button class="ghost small-btn" data-tie-back="${t.from.id}">Add back</button>` : ''}
        </li>`)}</ul>` : ''}
      ${notes || own ? html`<section class="tie-notes">
        <div class="tie-notes-head"><h3 class="tie-h">Relationship notes</h3>${own ? html`<button type="button" class="sm" id="tie-notes-edit">${icons.quill} ${notes ? 'Edit' : 'Write notes'}</button>` : ''}</div>
        ${notes ? html`<div class="body prose">${formatPost(notes)}</div>` : html`<p class="small muted">Anything the ties don't say: history, how they met, what's unresolved. Formatting works here.</p>`}
      </section>` : ''}`);
    if (view === 'tree' && family) layoutTree($('.ftree', pane));
    $$('[data-tie-view]', pane).forEach((b) => b.addEventListener('click', () => {
      tieView = b.dataset.tieView;
      try { sessionStorage.setItem('nuuvi:tie-view', tieView); } catch { /* ignore */ }
      load();
    }));
    $('#tie-notes-edit', pane)?.addEventListener('click', async () => {
      const text = await modal(html`<form>
        <h2>${c.name}: relationship notes</h2>
        <textarea name="notes" rows="10" maxlength="20000" placeholder="Formatting works here (bold, colors, centering…)">${notes}</textarea>
        <div class="error"></div>
        <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save</button></div>
      </form>`, { submit: async ({ notes: v }) => {
        const dossier = { ...(prof?.dossier || {}), sections: { ...(prof?.dossier?.sections || {}), relationships: v } };
        await api(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier } });
        return true;
      } });
      if (text) { toast('Saved'); load(); }
    });
    // Node spots and chip colours come from data attributes (no inline styles allowed).
    $$('.tie-node', pane).forEach((n) => { n.style.setProperty('left', `${n.dataset.x}%`); n.style.setProperty('top', `${n.dataset.y}%`); });
    $$('[data-tie]', pane).forEach((n) => n.style.setProperty('--tc', TIE_COLORS[n.dataset.tie] || '#999'));
    $('#tie-add', pane)?.addEventListener('click', async () => { if (await tieForm(c)) { toast('Tie added'); load(); } });
    $$('[data-tie-more]', pane).forEach((b) => b.addEventListener('click', () => {
      const t = ties[Number(b.dataset.tieMore)];
      menu(b, [
        { label: 'Edit', action: async () => { if (await tieForm(c, t)) { toast('Saved'); load(); } } },
        { label: 'Remove', danger: true, action: async () => {
          if (!await confirmModal(`Remove ${t.other.name} from ${c.name}'s ties?`, { ok: 'Remove', danger: true })) return;
          try { await api(`/api/characters/${c.id}/ties/${t.other.id}`, { method: 'DELETE' }); load(); } catch (err) { toast(err.message); }
        } },
      ]);
    }));
    $$('[data-tie-back]', pane).forEach((b) => b.addEventListener('click', async () => {
      const t = incoming.find((x) => x.from.id === Number(b.dataset.tieBack));
      if (await tieForm(c, { other: t.from, kind: t.kind, label: '', note: '', since: t.since })) { toast('Tie added'); load(); }
    }));
  };
  load();
}

// ---------- Timeline ----------
const TL_ICON = { post: icons.image, musing: icons.quill, episode: icons.episode, finished: icons.check, plan: icons.calendar, tie: icons.ties, arrived: icons.star };
function tlLine(it) {
  switch (it.type) {
    case 'post': return html`Posted${it.location ? html` at <b>${it.location}</b>` : ''}`;
    case 'musing': return 'Wrote a musing';
    case 'episode': return html`Joined <b>${it.text}</b>`;
    case 'finished': return html`Finished <b>${it.text}</b>`;
    case 'plan': return html`<b>${it.text}</b>`;
    case 'tie': return html`<b>${it.text}</b> <span class="tie-chip" data-tie="${it.kind}">${it.label || TIE_NAMES[it.kind] || it.kind}</span>`;
    default: return html`Arrived in Ardell City`;
  }
}

// Pick a new date for something on the timeline.
async function editDate(c, it) {
  const own = ['episode', 'finished', 'arrived'].includes(it.type);
  const what = { post: 'This post moves to that day (its comments move with it).', musing: 'This musing moves to that day (its comments move with it).',
    tie: 'This changes the "since" date on the tie too.', plan: 'The plan moves to that day, at the same time.' }[it.type]
    || 'This only changes the date on the timeline.';
  return modal(html`<form>
    <h2>Change the date</h2>
    <p class="small muted">${what}</p>
    <label for="tl-date">Date</label>
    <input id="tl-date" name="date" type="date" required value="${it.at.slice(0, 10)}">
    <div class="error"></div>
    <div class="actions end">
      ${own && it.edited ? html`<button type="button" id="tl-reset">Use the real date</button><span class="grow"></span>` : ''}
      <button type="button" data-close>Cancel</button><button type="submit" class="primary">Save</button>
    </div>
  </form>`, {
    init: (d, close) => {
      $('#tl-reset', d)?.addEventListener('click', async () => {
        try { await api(`/api/characters/${c.id}/timeline`, { method: 'PUT', body: { item: it.key, date: it.at.slice(0, 10), reset: true } }); close(true); } catch (err) { toast(err.message); }
      });
    },
    submit: async ({ date }) => { await api(`/api/characters/${c.id}/timeline`, { method: 'PUT', body: { item: it.key, date } }); return true; },
  });
}

export function drawTimeline(pane, c, { isAlive = () => true } = {}) {
  render(pane, html`<p class="muted small ig-loading">Loading…</p>`);
  const redraw = () => drawTimeline(pane, c, { isAlive });
  api(`/api/characters/${c.id}/timeline`).then(({ items, locked, canEdit }) => {
    if (!isAlive()) return;
    // Group by month, newest first.
    const groups = [];
    for (const it of items) {
      const key = it.at.slice(0, 7);
      if (groups.at(-1)?.key !== key) groups.push({ key, items: [] });
      groups.at(-1).items.push(it);
    }
    const monthName = (k) => { const [y, m] = k.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
    render(pane, html`
      ${locked ? html`<p class="small muted tl-locked">${icons.lock} Posts are hidden: this account is private.</p>` : ''}
      <ol class="timeline">${groups.map((g) => html`
        <li class="tl-month"><h3>${monthName(g.key)}</h3>
          <ol>${g.items.map((it) => {
            const inner = html`<span class="tl-dot">${TL_ICON[it.type] || icons.star}</span>
              <span class="grow"><span class="tl-line">${tlLine(it)}</span>
                ${it.type === 'post' || it.type === 'musing' ? (it.text ? html`<span class="tl-text">${it.text}</span>` : '') : it.sub ? html`<span class="tl-text muted">${it.sub}</span>` : ''}
                <small class="muted">${niceDate(it.at)}${it.edited ? ' · date set by hand' : ''}</small></span>
              ${it.picture ? html`<img class="tl-pic" src="${it.picture}" alt="" loading="lazy">` : ''}`;
            return html`<li class="tl-item tl-${it.type}">${it.link ? html`<a href="${it.link}">${inner}</a>` : html`<div>${inner}</div>`}
              ${canEdit ? html`<button type="button" class="icon-btn sm tl-edit" data-tl="${items.indexOf(it)}" aria-label="Change the date">${icons.pencil}</button>` : ''}</li>`;
          })}</ol></li>`)}</ol>`);
    $$('[data-tie]', pane).forEach((n) => n.style.setProperty('--tc', TIE_COLORS[n.dataset.tie] || '#999'));
    $$('[data-tl]', pane).forEach((b) => b.addEventListener('click', async () => {
      if (await editDate(c, items[Number(b.dataset.tl)])) { toast('Date changed'); redraw(); }
    }));
  }).catch((err) => { if (isAlive()) render(pane, html`<div class="empty"><p>${err.message}</p></div>`); });
}
