// Ties (who a character is to whom, drawn as one family-tree-style chart) and a character's Timeline.
import { html, render, api, $, $$, toast, avatar, icons, menu, modal, confirmModal, formatPost } from '../lib.js';

// The kinds of tie, in groups for the picker.
const TIE_GROUPS = [
  [
    'Love',
    [
      ['partner', 'Partner'],
      ['spouse', 'Husband or wife'],
      ['crush', 'Crush'],
      ['ex', 'Ex'],
      ['complicated', "It's complicated"],
    ],
  ],
  [
    'Family',
    [
      ['parent', 'Parent'],
      ['stepparent', 'Stepparent'],
      ['child', 'Child'],
      ['stepchild', 'Stepchild'],
      ['sibling', 'Sibling'],
      ['halfsibling', 'Half-sibling'],
      ['stepsibling', 'Stepsibling'],
      ['grandparent', 'Grandparent'],
      ['grandchild', 'Grandchild'],
      ['auntuncle', 'Aunt or uncle'],
      ['nibling', 'Niece or nephew'],
      ['cousin', 'Cousin'],
      ['inlaw', 'In-law'],
      ['family', 'Other family'],
    ],
  ],
  [
    'Everyone else',
    [
      ['bestfriend', 'Best friend'],
      ['friend', 'Friend'],
      ['rival', 'Rival'],
      ['enemy', 'Enemy'],
      ['coworker', 'Coworker'],
      ['roommate', 'Roommate'],
      ['mentor', 'Mentor'],
      ['other', 'Other'],
    ],
  ],
];
export const TIE_NAMES = Object.fromEntries(TIE_GROUPS.flatMap(([, kinds]) => kinds));
const FAMILY = new Set(TIE_GROUPS[1][1].map(([k]) => k));
// One colour per kind, so the web reads at a glance (family in greens).
const TIE_COLORS = {
  partner: '#E0446A',
  spouse: '#C92F5A',
  crush: '#F07AA0',
  ex: '#8A8F98',
  complicated: '#B5655A',
  bestfriend: '#F2A93B',
  friend: '#4FA3E0',
  rival: '#E07B39',
  enemy: '#C8382F',
  coworker: '#7C8794',
  roommate: '#56B6C2',
  mentor: '#9C7AE0',
  other: '#9AA0A6',
};
for (const k of FAMILY) TIE_COLORS[k] = '#2E9E6E';
// When the other writer named the tie, flip it round: they call us their child, so they're our parent.
const FLIP = {
  parent: 'child',
  child: 'parent',
  stepparent: 'stepchild',
  stepchild: 'stepparent',
  grandparent: 'grandchild',
  grandchild: 'grandparent',
  auntuncle: 'nibling',
  nibling: 'auntuncle',
  mentor: 'other',
};
const tieName = (t) => t.label || TIE_NAMES[t.kind] || t.kind;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const niceDate = (d) => {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${day}, ${y}`;
};

// ---------- Ties ----------
// A tie's own colour if its writer picked one, otherwise the colour for that kind of tie.
const HEX = /^#[0-9a-f]{6}$/i;
const tieColor = (kind, own) => (HEX.test(own || '') ? own : TIE_COLORS[kind] || '#2E9E6E');

// Each person's picture is the icon they use in threads (or their profile picture if they have none).
const iconOf = (x) => avatar({ name: x.name, src: x.threadAvatar || x.avatar, color: x.color, size: 'sm' });

async function tieForm(c, tie = null) {
  let pick = tie?.other ?? null;
  let everyone = [];
  try {
    const { writers } = await api('/api/directory');
    everyone = writers
      .flatMap((w) => w.characters.map((x) => ({ ...x, writer: w.username })))
      .filter((x) => x.id !== c.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    /* the picker just stays empty */
  }
  return modal(
    html`
    <form class="tie-form">
      <h2>${tie ? `${c.name} and ${tie.other.name}` : `Add a tie for ${c.name}`}</h2>
      ${
        tie
          ? ''
          : html`
        <label for="tf-q">Who</label>
        <input type="search" class="search" id="tf-q" placeholder="Search characters…" autocomplete="off">
        <div class="pc-list tf-list" id="tf-list"></div>`
      }
      <label for="tf-kind">They are ${c.name}'s</label>
      <select id="tf-kind" name="kind">${TIE_GROUPS.map(([g, kinds]) => html`<optgroup label="${g}">${kinds.map(([k, v]) => html`<option value="${k}" ${(tie?.kind ?? 'friend') === k ? 'selected' : ''}>${v}</option>`)}</optgroup>`)}</select>
      <label for="tf-label">Your own word for it <span class="muted small">(optional)</span></label>
      <input id="tf-label" name="label" maxlength="40" value="${tie?.label ?? ''}" placeholder="e.g. ride or die, the one that got away">
      <label for="tf-hex">Line colour <span class="muted small">(optional)</span></label>
      <div class="tf-color">
        <input type="color" id="tf-pick" value="${tieColor(tie?.kind ?? 'friend', tie?.color)}" aria-label="Pick a colour">
        <input id="tf-hex" name="color" maxlength="7" value="${tie?.color ?? ''}" placeholder="#hex, or empty for the usual colour" autocomplete="off" spellcheck="false">
        <button type="button" class="ghost small-btn" id="tf-reset">Usual</button>
      </div>
      <label for="tf-since">Since <span class="muted small">(optional)</span></label>
      <input id="tf-since" name="since" type="date" value="${tie?.since ?? ''}">
      <label for="tf-note">A note <span class="muted small">(optional)</span></label>
      <textarea id="tf-note" name="note" maxlength="300" rows="3" placeholder="How they met, what happened…">${tie?.note ?? ''}</textarea>
      <div class="error"></div>
      <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${tie ? 'Save' : 'Add tie'}</button></div>
    </form>`,
    {
      init: (d) => {
        // The colour picker and the hex box follow each other; an empty hex box means the kind's colour.
        const [pickIn, hexIn, kindIn] = [$('#tf-pick', d), $('#tf-hex', d), $('#tf-kind', d)];
        pickIn.addEventListener('input', () => (hexIn.value = pickIn.value));
        hexIn.addEventListener('input', () => {
          const v = hexIn.value.trim();
          const full = v.startsWith('#') ? v : `#${v}`;
          if (HEX.test(full)) pickIn.value = full.toLowerCase();
          else if (!v) pickIn.value = tieColor(kindIn.value);
        });
        kindIn.addEventListener('change', () => !hexIn.value.trim() && (pickIn.value = tieColor(kindIn.value)));
        $('#tf-reset', d).addEventListener('click', () => {
          hexIn.value = '';
          pickIn.value = tieColor(kindIn.value);
        });
        const list = $('#tf-list', d);
        if (!list) return;
        const draw = (q = '') => {
          const shown = everyone.filter((x) => !q || `${x.name} ${x.handle} ${x.writer}`.toLowerCase().includes(q)).slice(0, 60);
          render(
            list,
            shown.length
              ? html`${shown.map(
                  (x) => html`
          <button type="button" class="pc-item ${pick?.id === x.id ? 'on' : ''}" data-pick="${x.id}" aria-pressed="${pick?.id === x.id}">
            ${avatar({ name: x.name, src: x.avatar, color: x.color, size: 'sm' })}<span class="grow"><b>${x.name}</b><small>@${x.handle} · ${x.writer}</small></span><span class="pc-check">${pick?.id === x.id ? '✓' : ''}</span></button>`,
                )}`
              : html`<p class="muted small">No one matches.</p>`,
          );
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
        let hex = String(data.color || '').trim();
        if (hex && !hex.startsWith('#')) hex = `#${hex}`;
        if (hex && !HEX.test(hex)) throw new Error('Colours look like #e0446a (a # and 6 letters or numbers)');
        await api(`/api/characters/${c.id}/ties/${pick.id}`, {
          method: 'PUT',
          body: { kind: data.kind, label: data.label, note: data.note, since: data.since || null, color: hex || null },
        });
        return true;
      },
    },
  );
}

// Everyone in one chart, laid out like a family tree: a row per generation (oldest at the top),
// the character in the middle row with their siblings and partner, then children, and last a row
// for everyone else they're tied to (friends, exes, rivals…), joined to the character by a line.
function tieChart(c, fam, ties, incoming) {
  const inTree = new Set(fam.members.map((m) => m.character.id));
  const circle = [
    ...ties
      .filter((t) => !inTree.has(t.other.id))
      .map((t) => ({ character: t.other, kind: t.kind, label: t.label, color: t.color, oneWay: !t.mutual })),
    ...incoming
      .filter((t) => !inTree.has(t.from.id))
      .map((t) => ({ character: t.from, kind: FLIP[t.kind] || t.kind, label: '', color: t.color, oneWay: true, theirs: true })),
  ];
  const links = [
    ...fam.links,
    ...circle.map((m) => ({
      from: fam.center,
      to: m.character.id,
      kind: m.kind,
      color: m.color,
      oneWay: m.oneWay,
      circle: true,
    })),
  ];
  const rows = new Map();
  for (const m of fam.members) {
    if (!rows.has(m.gen)) rows.set(m.gen, []);
    rows.get(m.gen).push(m);
  }
  const relOf = (m) => {
    if (!m.relation) return null;
    const kind = m.relation.theirs ? FLIP[m.relation.kind] || m.relation.kind : m.relation.kind;
    return { kind, color: m.relation.color, name: (!m.relation.theirs && m.relation.label) || TIE_NAMES[kind] || kind };
  };
  const GEN = {
    '-3': 'Great-grandparents',
    '-2': 'Grandparents',
    '-1': 'Parents',
    1: 'Children',
    2: 'Grandchildren',
    3: 'Great-grandchildren',
  };
  const order = (list, gen) => {
    const byName = (x, y) => x.character.name.localeCompare(y.character.name);
    if (gen !== 0) return [...list].sort(byName);
    // The middle row: siblings and cousins on the left, the character, then their partner.
    const love = (m) => ['partner', 'spouse'].includes(relOf(m)?.kind);
    const center = list.filter((m) => m.character.id === fam.center);
    return [
      ...list.filter((m) => m.character.id !== fam.center && !love(m)).sort(byName),
      ...center,
      ...list.filter(love).sort(byName),
    ];
  };
  const node = (x, rel, { center = false, oneWay = false } = {}) => html`
    <a class="ftree-node ${center ? 'center' : ''} ${oneWay ? 'one-way' : ''}" href="#/c/${x.id}" data-fid="${x.id}" title="${x.name}">
      ${avatar({ name: x.name, src: x.threadAvatar || x.avatar, color: x.color, size: center ? 'lg' : '' })}
      <b>${x.name}</b>${rel ? html`<span class="tie-chip" data-tie="${rel.kind}" data-tc="${rel.color ?? ''}">${rel.name}</span>` : ''}
    </a>`;
  return html`<div class="ftree" data-links="${JSON.stringify(links)}">
    <svg class="ftree-lines" aria-hidden="true"></svg>
    ${[...rows.keys()]
      .sort((x, y) => x - y)
      .map(
        (g) => html`<div class="ftree-row">
      ${GEN[g] ? html`<span class="ftree-gen">${GEN[g]}</span>` : ''}
      <div class="ftree-people">${order(rows.get(g), g).map((m) => node(m.character, relOf(m), { center: m.character.id === fam.center }))}</div></div>`,
      )}
    ${
      circle.length
        ? html`<div class="ftree-row ftree-circle">
      <span class="ftree-gen">Friends, loves &amp; rivals</span>
      <div class="ftree-people">${circle.sort((x, y) => x.character.name.localeCompare(y.character.name)).map((m) => node(m.character, { kind: m.kind, color: m.color, name: m.label || TIE_NAMES[m.kind] || m.kind }, { oneWay: m.oneWay }))}</div></div>`
        : ''
    }
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
      return {
        row: node.closest('.ftree-row'),
        x: (r.left + r.width / 2 - box.left) / z,
        top: (r.top - box.top) / z,
        bottom: (n.bottom - box.top + 4) / z,
        mid: (r.top + r.height / 2 - box.top) / z,
        half: r.width / 2 / z,
      };
    };
    const svg = tree.querySelector('.ftree-lines');
    svg.setAttribute('viewBox', `0 0 ${box.width / z} ${box.height / z}`);
    svg.innerHTML = links
      .map((l) => {
        let a = at(l.from),
          b = at(l.to);
        if (!a || !b) return '';
        const color = tieColor(l.kind, l.color);
        if (a.row === b.row) {
          // Same row: partners side by side get a straight line; siblings and cousins a bracket above.
          const [left, right] = a.x < b.x ? [a, b] : [b, a];
          if (['partner', 'spouse', 'inlaw'].includes(l.kind))
            return `<line x1="${left.x + left.half}" y1="${right.mid}" x2="${right.x - right.half}" y2="${right.mid}" stroke="${color}" stroke-width="2.5"/>`;
          const y = Math.min(left.top, right.top) - 10;
          return `<path d="M${left.x} ${left.top} V${y} H${right.x} V${right.top}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
        }
        if (a.mid > b.mid) [a, b] = [b, a];
        // Friends and the rest hang off a rail just above their row; family lines meet halfway.
        const midY = l.circle ? b.top - 26 : (a.bottom + b.top) / 2;
        const dashed = l.oneWay || (!l.circle && b.top - a.bottom > 150);
        return `<path d="M${a.x} ${a.bottom} V${midY} H${b.x} V${b.top}" fill="none" stroke="${color}" stroke-width="${l.circle ? 1.6 : 2}" ${dashed ? 'stroke-dasharray="5 4"' : ''} ${l.circle ? 'opacity=".75"' : ''}/>`;
      })
      .join('');
  };
  draw();
  new ResizeObserver(draw).observe(tree);
}

// Character names in the relationship notes become links to their pages.
function linkNames(root, people) {
  const named = [...new Map(people.filter((p) => p.name?.trim().length > 1).map((p) => [p.name.toLowerCase(), p])).values()].sort(
    (x, y) => y.name.length - x.name.length,
  );
  if (!root || !named.length) return;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${named.map((p) => esc(p.name)).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const byName = new Map(named.map((p) => [p.name.toLowerCase(), p]));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const t of texts) {
    const text = t.nodeValue;
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index + m[1].length;
      frag.append(text.slice(last, start));
      const a = document.createElement('a');
      a.href = `#/c/${byName.get(m[2].toLowerCase()).id}`;
      a.className = 'name-link';
      a.textContent = m[2];
      frag.append(a);
      last = start + m[2].length;
    }
    frag.append(text.slice(last));
    t.replaceWith(frag);
  }
}

export function drawTies(pane, c, { own, isAlive = () => true }) {
  render(pane, html`<p class="muted small ig-loading">Loading…</p>`);
  const load = async () => {
    let r, fam, prof, dir;
    try {
      [r, fam, prof, dir] = await Promise.all([
        api(`/api/characters/${c.id}/ties`),
        api(`/api/characters/${c.id}/family`),
        api(`/api/profiles/${c.id}`).catch(() => null),
        api('/api/directory').catch(() => ({ writers: [] })),
      ]);
    } catch (err) {
      if (isAlive()) render(pane, html`<div class="empty"><p>${err.message}</p></div>`);
      return;
    }
    if (!isAlive()) return;
    const { ties, incoming } = r;
    const notes = prof?.dossier?.sections?.relationships || '';
    const anyone = ties.length || incoming.length || fam.members.length > 1;
    render(
      pane,
      html`
      ${own ? html`<div class="tie-bar"><span></span><button class="primary" id="tie-add">${icons.plus} Add a tie</button></div>` : ''}
      ${
        anyone
          ? tieChart(c, fam, ties, incoming)
          : html`<div class="empty"><p>No ties yet.</p><p class="small muted">${own ? `Add the people who matter to ${c.name}: family, best friends, exes, rivals.` : `${c.name}'s writer hasn't added anyone yet.`}</p></div>`
      }
      ${anyone ? html`<p class="small muted tie-key">Solid line: both writers agree. Dashed: only one side has said so far.</p>` : ''}
      ${
        notes || own
          ? html`<section class="tie-notes">
        <div class="tie-notes-head"><h3 class="tie-h">Relationship notes</h3>${own ? html`<button type="button" class="sm" id="tie-notes-edit">${icons.quill} ${notes ? 'Edit' : 'Write notes'}</button>` : ''}</div>
        ${notes ? html`<div class="body prose" id="tie-notes-body">${formatPost(notes)}</div>` : html`<p class="small muted">Anything the ties don't say: history, how they met, what's unresolved. Write a character's name and it links to their page.</p>`}
      </section>`
          : ''
      }
      ${
        ties.length || incoming.length
          ? html`<details class="tie-manage" ${own ? '' : ''}>
        <summary>${own ? 'Change or remove ties' : 'Every tie, with notes'} <span class="muted">(${ties.length + incoming.length})</span></summary>
        <ul class="tie-list">${ties.map(
          (t, i) => html`
          <li class="tie-row">
            <a href="#/c/${t.other.id}">${iconOf(t.other)}</a>
            <div class="grow">
              <a class="tie-who" href="#/c/${t.other.id}"><b>${t.other.name}</b></a>
              <div class="tie-what"><span class="tie-chip" data-tie="${t.kind}" data-tc="${t.color ?? ''}">${tieName(t)}</span>
                ${t.mutual ? html`<span class="small muted">${t.mutual.kind === t.kind && !t.mutual.label ? 'both ways' : `they say: ${tieName(t.mutual)}`}</span>` : html`<span class="small muted">one way</span>`}
                ${t.since ? html`<span class="small muted">· since ${niceDate(t.since)}</span>` : ''}</div>
              ${t.note ? html`<p class="small tie-note">${t.note}</p>` : ''}
            </div>
            ${own ? html`<button class="icon-btn" data-tie-more="${i}" aria-label="Change this tie">${icons.more}</button>` : ''}
          </li>`,
        )}
          ${incoming.map(
            (t) => html`<li class="tie-row">
            <a href="#/c/${t.from.id}">${iconOf(t.from)}</a>
            <div class="grow"><a class="tie-who" href="#/c/${t.from.id}"><b>${t.from.name}</b></a>
              <div class="tie-what"><span class="small muted">calls ${c.name} their</span> <span class="tie-chip" data-tie="${t.kind}" data-tc="${t.color ?? ''}">${tieName(t)}</span></div></div>
            ${own ? html`<button class="ghost small-btn" data-tie-back="${t.from.id}">Add back</button>` : ''}
          </li>`,
          )}</ul>
      </details>`
          : ''
      }`,
    );
    layoutTree($('.ftree', pane));
    // Names in the notes link to those characters (everyone on NUUVI, plus first names of people in the chart).
    const everyone = dir.writers.flatMap((w) => w.characters);
    const close = [...fam.members.map((m) => m.character), ...ties.map((t) => t.other), ...incoming.map((t) => t.from)];
    const firsts = close
      .map((x) => ({ id: x.id, name: x.name.split(/\s+/)[0] }))
      .filter(
        (x, _, all) =>
          x.name.length > 2 && all.filter((y) => y.name.toLowerCase() === x.name.toLowerCase() && y.id !== x.id).length === 0,
      );
    linkNames($('#tie-notes-body', pane), [...everyone, ...close, ...firsts]);
    $('#tie-notes-edit', pane)?.addEventListener('click', async () => {
      const text = await modal(
        html`<form>
        <h2>${c.name}: relationship notes</h2>
        <p class="hint">Write a character's name and it links to their page.</p>
        <textarea name="notes" rows="10" maxlength="20000" placeholder="Formatting works here (bold, colors, centering…)">${notes}</textarea>
        <div class="error"></div>
        <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save</button></div>
      </form>`,
        {
          submit: async ({ notes: v }) => {
            const dossier = { ...(prof?.dossier || {}), sections: { ...(prof?.dossier?.sections || {}), relationships: v } };
            await api(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier } });
            return true;
          },
        },
      );
      if (text) {
        toast('Saved');
        load();
      }
    });
    // Chip colours come from data attributes (no inline styles allowed).
    $$('[data-tie]', pane).forEach((n) => n.style.setProperty('--tc', tieColor(n.dataset.tie, n.dataset.tc)));
    $('#tie-add', pane)?.addEventListener('click', async () => {
      if (await tieForm(c)) {
        toast('Tie added');
        load();
      }
    });
    $$('[data-tie-more]', pane).forEach((b) =>
      b.addEventListener('click', () => {
        const t = ties[Number(b.dataset.tieMore)];
        menu(b, [
          {
            label: 'Edit',
            action: async () => {
              if (await tieForm(c, t)) {
                toast('Saved');
                load();
              }
            },
          },
          {
            label: 'Remove',
            danger: true,
            action: async () => {
              if (!(await confirmModal(`Remove ${t.other.name} from ${c.name}'s ties?`, { ok: 'Remove', danger: true }))) return;
              try {
                await api(`/api/characters/${c.id}/ties/${t.other.id}`, { method: 'DELETE' });
                load();
              } catch (err) {
                toast(err.message);
              }
            },
          },
        ]);
      }),
    );
    $$('[data-tie-back]', pane).forEach((b) =>
      b.addEventListener('click', async () => {
        const t = incoming.find((x) => x.from.id === Number(b.dataset.tieBack));
        if (await tieForm(c, { other: t.from, kind: FLIP[t.kind] || t.kind, label: '', note: '', since: t.since })) {
          toast('Tie added');
          load();
        }
      }),
    );
  };
  load();
}

// ---------- Timeline ----------
// The important things that happened to a character, added by their writer, oldest first.
function eventForm(c, ev = null) {
  return modal(
    html`<form class="tl-form">
    <h2>${ev ? 'Change this event' : `Add to ${c.name}'s timeline`}</h2>
    <label for="tl-date">When</label>
    <input id="tl-date" name="date" type="date" required value="${ev?.date ?? ''}">
    <label for="tl-title">What happened</label>
    <input id="tl-title" name="title" maxlength="140" required value="${ev?.title ?? ''}" placeholder="e.g. Moved to Ardell City, met Jun, lost the election">
    <label for="tl-note">More about it <span class="muted small">(optional)</span></label>
    <textarea id="tl-note" name="note" rows="4" maxlength="2000" placeholder="Anything worth remembering">${ev?.note ?? ''}</textarea>
    <div class="error"></div>
    <div class="actions end">
      ${ev ? html`<button type="button" class="danger" id="tl-del">Delete</button><span class="grow"></span>` : ''}
      <button type="button" data-close>Cancel</button><button type="submit" class="primary">${ev ? 'Save' : 'Add'}</button>
    </div>
  </form>`,
    {
      init: (d, close) => {
        $('#tl-del', d)?.addEventListener('click', async () => {
          try {
            await api(`/api/characters/${c.id}/timeline/${ev.id}`, { method: 'DELETE' });
            close('deleted');
          } catch (err) {
            toast(err.message);
          }
        });
      },
      submit: async (data) => {
        const body = { date: data.date, title: data.title, note: data.note };
        if (ev) await api(`/api/characters/${c.id}/timeline/${ev.id}`, { method: 'PUT', body });
        else await api(`/api/characters/${c.id}/timeline`, { method: 'POST', body });
        return 'saved';
      },
    },
  );
}

export function drawTimeline(pane, c, { isAlive = () => true } = {}) {
  render(pane, html`<p class="muted small ig-loading">Loading…</p>`);
  const redraw = () => drawTimeline(pane, c, { isAlive });
  api(`/api/characters/${c.id}/timeline`)
    .then(({ events, canEdit }) => {
      if (!isAlive()) return;
      const years = [];
      for (const e of events) {
        const y = e.date.slice(0, 4);
        if (years.at(-1)?.y !== y) years.push({ y, events: [] });
        years.at(-1).events.push(e);
      }
      render(
        pane,
        html`
      ${canEdit ? html`<div class="tie-bar"><span></span><button class="primary" id="tl-add">${icons.plus} Add an event</button></div>` : ''}
      ${
        events.length
          ? html`<ol class="timeline">${years.map(
              (g) => html`
        <li class="tl-month"><h3>${g.y}</h3>
          <ol>${g.events.map(
            (e) => html`<li class="tl-item">
            <div><span class="tl-dot">${icons.star}</span>
              <span class="grow"><b class="tl-line">${e.title}</b>${e.note ? html`<span class="tl-text">${e.note}</span>` : ''}<small class="muted">${niceDate(e.date)}</small></span></div>
            ${canEdit ? html`<button type="button" class="icon-btn sm tl-edit" data-ev="${e.id}" aria-label="Change this event">${icons.pencil}</button>` : ''}
          </li>`,
          )}</ol></li>`,
            )}</ol>`
          : html`<div class="empty"><p>No events yet.</p><p class="small muted">${canEdit ? `Add the moments that shaped ${c.name}: where they grew up, big wins, losses, turning points.` : `${c.name}'s writer hasn't added any events yet.`}</p></div>`
      }`,
      );
      $('#tl-add', pane)?.addEventListener('click', async () => {
        if (await eventForm(c)) {
          toast('Added');
          redraw();
        }
      });
      $$('[data-ev]', pane).forEach((b) =>
        b.addEventListener('click', async () => {
          const r = await eventForm(
            c,
            events.find((e) => e.id === Number(b.dataset.ev)),
          );
          if (r) {
            toast(r === 'deleted' ? 'Deleted' : 'Saved');
            redraw();
          }
        }),
      );
    })
    .catch((err) => {
      if (isAlive()) render(pane, html`<div class="empty"><p>${err.message}</p></div>`);
    });
}
