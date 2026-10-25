// Character profiles: every character on NUUVI, NPCs included, can have a detailed profile (quick
// facts, personality, history and a gallery), shown in the About tab on
// their page. Everyone reads them; the writer (or an admin) edits.
import { html, render, api, $, $$, toast, icons, modal, formatPost, gradAttr, attachSheet, formattingGuide } from '../lib.js';
import { state, replaceHash } from '../main.js';

// The two details every character has, each picked from a short list. Shown and set in the About tab,
// just under the profile editor button.
const DETAILS = [
  { key: 'ship', label: 'Shipping status', choices: ['Open to ships', 'Taken', 'Closed to ships', 'Ask the writer'] },
  { key: 'kill', label: 'Permission to kill', choices: ['Yes', 'No', 'Ask first'] },
];
const detailOf = (c, label) => (c.details || []).find((x) => x.label === label)?.value || '';
const shownDetails = (c) => DETAILS.map((x) => ({ label: x.label, value: detailOf(c, x.label) })).filter((x) => x.value);

const FACT_LABELS = [
  ['fullName', 'Full name'],
  ['nicknames', 'Nicknames'],
  ['age', 'Age'],
  ['birthday', 'Birthday'],
  ['zodiac', 'Zodiac'],
  ['pronouns', 'Pronouns'],
  ['gender', 'Gender'],
  ['sexuality', 'Sexuality'],
  ['height', 'Height'],
  ['nationality', 'Nationality'],
  ['hometown', 'Hometown'],
  ['residence', 'Lives in'],
  ['occupation', 'Occupation'],
  ['affiliation', 'Affiliation'],
  ['relationship', 'Relationship'],
  ['faceclaim', 'Face claim'],
];
// Relationships live in the Ties tab now (the web, the family tree and the relationship notes).
const SECTION_LABELS = [
  ['personality', 'Personality'],
  ['appearance', 'Appearance'],
  ['history', 'History'],
  ['goals', 'Goals & fears'],
  ['trivia', 'Trivia'],
];

// Profiles live in the About tab on each character's page now; the old Profiles pages lead there.
export function viewProfiles() {
  replaceHash('#/directory');
}
export function viewProfile(idStr) {
  try {
    sessionStorage.setItem('nuuvi:char-tab', 'about');
  } catch {
    /* ignore */
  }
  replaceHash(`#/c/${idStr}`);
}

// A character's profile, for the About tab on their page (their picture is already at the top of
// that page, so it starts with their shipping status and permission to kill, then quote and traits).
export function dossierAbout(c, d, { canEdit = false } = {}) {
  const facts = FACT_LABELS.filter(([k]) => d.facts?.[k]);
  const sections = SECTION_LABELS.filter(([k]) => d.sections?.[k]);
  const empty =
    !facts.length && !sections.length && !d.quote && !d.gallery?.length && !d.traits?.length && !d.likes && !d.dislikes;
  return html`<div class="dossier about-dossier" data-color="${c.color}"${gradAttr(c)}>
    ${canEdit ? html`<div class="about-edit"><button type="button" class="sm" id="about-edit">${icons.quill} ${empty ? 'Fill in the profile' : 'Edit profile details'}</button></div>` : ''}
    ${
      shownDetails(c).length
        ? html`<div class="info-grid ds-details">${shownDetails(c).map((x) => html`<div class="info"><span class="eyebrow">${x.label}</span><div>${x.value}</div></div>`)}</div>`
        : ''
    }
    ${
      d.quote || d.traits?.length
        ? html`<section class="ds-card ds-intro">
      ${d.quote ? html`<blockquote class="ds-quote">${d.quote}</blockquote>` : ''}
      ${d.traits?.length ? html`<div class="ds-traits">${d.traits.map((t) => html`<span>${t}</span>`)}</div>` : ''}
    </section>`
        : ''
    }

    ${
      facts.length
        ? html`<section class="ds-card ds-facts"><h3 class="ds-title">The basics</h3>
      <dl>${facts.map(([k, l]) => html`<div><dt>${l}</dt><dd>${d.facts[k]}</dd></div>`)}</dl></section>`
        : ''
    }

    ${
      d.likes || d.dislikes
        ? html`<section class="ds-card ds-likes">
      ${d.likes ? html`<div><h3 class="ds-title">Loves</h3><p>${d.likes}</p></div>` : ''}
      ${d.dislikes ? html`<div><h3 class="ds-title">Can't stand</h3><p>${d.dislikes}</p></div>` : ''}</section>`
        : ''
    }

    ${sections.map(([k, l]) => html`<section class="ds-card ds-section"><h3 class="ds-title">${l}</h3><div class="body">${formatPost(d.sections[k])}</div></section>`)}

    ${
      d.gallery?.length
        ? html`<section class="ds-card ds-gallery-card"><h3 class="ds-title">Gallery</h3>
      <div class="ds-flow" data-flow>
        <div class="ds-flow-track" tabindex="0" aria-label="Gallery: swipe or use the arrows">${d.gallery.map(
          (u, i) => html`
          <a class="ds-flow-card" href="${u}" data-i="${i}"><img src="${u}" alt="" loading="lazy" draggable="false"><span class="ds-flow-expand">${icons.expand || '⤢'} Expand</span></a>`,
        )}</div>
        ${
          d.gallery.length > 1
            ? html`<button type="button" class="ds-flow-nav prev" data-flow-go="-1" aria-label="Previous picture">‹</button>
          <button type="button" class="ds-flow-nav next" data-flow-go="1" aria-label="Next picture">›</button>`
            : ''
        }
      </div>
      ${d.gallery.length > 1 ? html`<div class="ds-flow-dots" aria-hidden="true">${d.gallery.map((_, i) => html`<i data-dot="${i}"></i>`)}</div>` : ''}
    </section>`
        : ''
    }

  </div>`;
}

// ---------- Editor ----------
export async function editDossier(c, d) {
  const gallery = [...(d.gallery || [])];
  let cover = d.cover || null;
  const ownChar = c.owner?.id === state.user?.id;
  return modal(
    html`<form class="ds-editor">
    <h2>${c.name}: profile details</h2>
    <nav class="ds-tabs" role="tablist">${[
      ['id', 'Identity'],
      ['facts', 'Facts'],
      ['story', 'Story'],
      ['extras', 'Gallery'],
    ].map(
      ([k, l], i) => html`
      <button type="button" class="chip ${i ? '' : 'on'}" data-tab="${k}">${l}</button>`,
    )}</nav>
    <div data-pane="id">
      <label>Signature quote</label><input name="quote" maxlength="300" value="${d.quote || ''}" placeholder="Something they'd say">
      <label>Traits <small class="muted">(comma separated)</small></label><input name="traits" value="${(d.traits || []).join(', ')}" placeholder="loyal, reckless, night owl">
      <label>Loves</label><textarea name="likes" rows="2" maxlength="1000">${d.likes || ''}</textarea>
      <label>Can't stand</label><textarea name="dislikes" rows="2" maxlength="1000">${d.dislikes || ''}</textarea>
      ${
        ownChar
          ? html`<div class="detail-picks">${DETAILS.map(
              (x) => html`<div>
        <label for="d-${x.key}">${x.label}</label>
        <select id="d-${x.key}" name="detail-${x.key}">
          <option value="">Not set</option>
          ${x.choices.map((v) => html`<option ${detailOf(c, x.label) === v ? 'selected' : ''}>${v}</option>`)}
        </select></div>`,
            )}</div>`
          : ''
      }
    </div>
    <div data-pane="facts" hidden><div class="ds-fact-grid">${FACT_LABELS.map(
      ([k, l]) => html`
      <div><label>${l}</label><input name="f_${k}" maxlength="160" value="${d.facts?.[k] || ''}"></div>`,
    )}</div></div>
    <div data-pane="story" hidden><p class="hint">HTML, Discord and forum codes all work here. <button type="button" class="link" id="ds-fmt">Formatting codes to copy</button></p>${SECTION_LABELS.map(
      ([k, l]) => html`
      <label>${l}</label><textarea name="s_${k}" rows="5" maxlength="20000" placeholder="Formatting works here (bold, colors, centering…)">${d.sections?.[k] || ''}</textarea>`,
    )}</div>
    <div data-pane="extras" hidden>
      <label>Gallery <small class="muted">(up to 20 pictures)</small></label>
      <div class="ds-gal-edit" id="ds-gal"></div>
      <div class="actions"><button type="button" class="sm" id="ds-gal-add">Add pictures</button></div>
    </div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save profile</button></div>
  </form>`,
    {
      init: (dlg, close) => {
        const drawGal = () =>
          render(
            $('#ds-gal', dlg),
            html`${gallery.map((u, i) => html`<span class="thumb"><img src="${u}" alt=""><button type="button" data-rm-pic="${i}" aria-label="Remove">✕</button></span>`)}`,
          );
        drawGal();
        dlg.addEventListener('click', (e) => {
          const tab = e.target.closest('[data-tab]');
          if (tab) {
            $$('[data-tab]', dlg).forEach((b) => b.classList.toggle('on', b === tab));
            $$('[data-pane]', dlg).forEach((p) => {
              p.hidden = p.dataset.pane !== tab.dataset.tab;
            });
          }
          if (e.target.closest('#ds-fmt')) formattingGuide();
          if (e.target.closest('#ds-gal-add'))
            attachSheet({
              max: 20 - gallery.length,
              onPictures: (urls) => {
                gallery.push(...urls.slice(0, 20 - gallery.length));
                drawGal();
              },
            });
          const rp = e.target.closest('[data-rm-pic]');
          if (rp) {
            gallery.splice(Number(rp.dataset.rmPic), 1);
            drawGal();
          }
        });
        // On the dialog, in the capture phase, so this runs instead of the modal's own form handling.
        dlg.addEventListener(
          'submit',
          async (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const f = e.target;
            const dossier = {
              song: d.song || null, // the song on their profile (set on the profile itself)
              quote: f.quote.value,
              likes: f.likes.value,
              dislikes: f.dislikes.value,
              cover,
              traits: f.traits.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
              facts: Object.fromEntries(FACT_LABELS.map(([k]) => [k, f[`f_${k}`].value])),
              // Relationship notes are edited in the Ties tab; keep them as they are.
              sections: {
                ...Object.fromEntries(SECTION_LABELS.map(([k]) => [k, f[`s_${k}`].value])),
                relationships: d.sections?.relationships || '',
              },
              // The playlist is no longer shown or edited; any saved one is kept (its first link can be their song).
              gallery,
              playlist: (d.playlist || []).map((t) => ({ title: t.title, artist: t.artist, link: t.link?.url || '' })),
            };
            try {
              await api(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier } });
              if (ownChar) {
                const details = DETAILS.map((x) => ({ label: x.label, value: f[`detail-${x.key}`].value })).filter(
                  (x) => x.value,
                );
                const before = DETAILS.map((x) => detailOf(c, x.label)).join('|');
                if (DETAILS.map((x) => f[`detail-${x.key}`].value).join('|') !== before) {
                  await api(`/api/characters/${c.id}`, { method: 'PUT', body: { details } });
                  c.details = details; // so the About tab shows them straight away
                }
              }
              toast('Profile saved');
              close(true);
            } catch (err) {
              toast(err.message);
            }
          },
          true,
        );
      },
    },
  );
}

// The gallery carousel: swipe (phones), scroll or drag (computers), or the ‹ › arrows. The picture in
// the middle is big and flat; the ones beside it turn away and tuck behind, like cards in a museum.
export function wireGallery(root) {
  for (const flow of $$('[data-flow]', root)) {
    const track = $('.ds-flow-track', flow);
    const cards = $$('.ds-flow-card', track);
    const dots = $$('[data-dot]', flow.parentElement);
    let active = 0;
    const centerOf = (card) => card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2;
    const update = () => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      cards.forEach((card, i) => {
        const d = Math.max(-3, Math.min(3, (card.offsetLeft + card.offsetWidth / 2 - mid) / (card.offsetWidth || 1)));
        card.style.setProperty('--d', d.toFixed(3));
        card.style.setProperty('--ad', Math.abs(d).toFixed(3));
        card.style.zIndex = String(100 - Math.round(Math.abs(d) * 10));
        if (Math.abs(d) < Math.abs((cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid) / (cards[best].offsetWidth || 1)))
          best = i;
      });
      active = best;
      cards.forEach((card, i) => card.classList.toggle('on', i === active));
      dots.forEach((dot, i) => dot.classList.toggle('on', i === active));
    };
    const go = (i) => {
      const n = Math.max(0, Math.min(cards.length - 1, i));
      track.scrollTo({ left: centerOf(cards[n]), behavior: 'smooth' });
    };
    let frame = 0;
    track.addEventListener(
      'scroll',
      () => {
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            update();
          });
      },
      { passive: true },
    );
    flow.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-flow-go]');
      if (nav) {
        go(active + Number(nav.dataset.flowGo));
        return;
      }
      // Tapping a picture at the side brings it to the middle; the middle one opens big.
      const card = e.target.closest('.ds-flow-card');
      if (card && (dragged || Number(card.dataset.i) !== active)) {
        e.preventDefault();
        if (!dragged) go(Number(card.dataset.i));
      }
    });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        go(active + (e.key === 'ArrowRight' ? 1 : -1));
      }
    });
    // Drag with the mouse on computers.
    let dragged = false;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const x0 = e.clientX;
      const s0 = track.scrollLeft;
      dragged = false;
      track.classList.add('dragging');
      const move = (ev) => {
        if (Math.abs(ev.clientX - x0) > 5) dragged = true;
        track.scrollLeft = s0 - (ev.clientX - x0);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        track.classList.remove('dragging');
        update();
        go(active);
        setTimeout(() => {
          dragged = false;
        }, 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    requestAnimationFrame(() => {
      track.scrollLeft = centerOf(cards[0]);
      update();
    });
    window.addEventListener('resize', update, { passive: true });
  }
}
