// Shared helpers: safe HTML templating, API calls, formatting, small UI utilities.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Tagged template that escapes interpolations unless they were produced by html`` or raw().
class Raw { constructor(v) { this.v = v; } toString() { return this.v; } }
export const raw = (v) => new Raw(v);
export function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => {
    if (i === 0) return s;
    const v = values[i - 1];
    const str = Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.v : esc(x))).join('')
      : v instanceof Raw ? v.v : v === false || v == null ? '' : esc(v);
    return out + str + s;
  }, ''));
}

export function render(target, content) {
  target.innerHTML = content instanceof Raw ? content.v : esc(content);
  applyColors(target);
}

// Inline style attributes are blocked by the CSP, so colors are applied from data attributes.
export function applyColors(root) {
  for (const el of root.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Resizes an image in the browser (which also strips EXIF data like GPS location) and uploads it.
export async function uploadImage(file, maxSize = 640) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.88));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

export function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2800);
}

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) {
    try { value == null || value === '' ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* unavailable */ }
  },
};

export const words = (text) => (text.match(/\S+/g) || []).length;

const parseDate = (sqlDate) => new Date(sqlDate.replace(' ', 'T') + 'Z');

export function timeAgo(sqlDate) {
  const then = parseDate(sqlDate);
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return then.toLocaleDateString();
}

export function timeStamp(sqlDate) {
  const d = parseDate(sqlDate);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${time}`;
  return `${d.toLocaleDateString()} ${time}`;
}

export const minutesBetween = (a, b) => Math.abs(parseDate(a) - parseDate(b)) / 60000;

// Roleplay formatting. Input is escaped first, so only these patterns produce markup:
// **bold**, *action*, __underline__, ~~strike~~, ||spoiler||, "dialogue", @mentions, > quotes.
export function formatPost(text) {
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="action">$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>')
    .replace(/(&quot;|“)(.+?)(&quot;|”)/g, '<span class="dialogue">$1$2$3</span>')
    .replace(/(^|[^\w])@([a-zA-Z0-9_]{3,24})/g, '$1<span class="mention">@$2</span>');
  return raw(esc(text)
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split('\n');
      if (lines.every((l) => l.startsWith('&gt; ') || l === '&gt;')) {
        return `<blockquote>${inline(lines.map((l) => l.replace(/^&gt; ?/, '')).join('<br>'))}</blockquote>`;
      }
      return `<p>${inline(para).replace(/\n/g, '<br>')}</p>`;
    })
    .join(''));
}

const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

// Avatar: an uploaded picture if there is one, otherwise an initial on a colored circle.
export function avatar({ name, color, src, size = '' }) {
  return src
    ? html`<img class="avatar ${size}" src="${src}" alt="" loading="lazy">`
    : html`<span class="avatar ${size}" data-color="${color || '#6b6880'}" aria-hidden="true">${initial(name)}</span>`;
}

export function formData(form) {
  const data = {};
  for (const [k, v] of new FormData(form).entries()) if (!(v instanceof File)) data[k] = v;
  return data;
}

export function bindForm(form, handler) {
  const errorEl = form.querySelector('.error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type=submit]');
    if (submit) submit.disabled = true;
    if (errorEl) errorEl.textContent = '';
    try {
      await handler(formData(form), form);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message; else toast(err.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

// Promise-based modal built on <dialog>. Resolves with the form data (or opts.submit's result), or null if cancelled.
export function modal(content, opts = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    document.body.append(dialog);
    render(dialog, content);
    const close = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(null); });
    for (const b of dialog.querySelectorAll('[data-close]')) b.addEventListener('click', () => close(null));
    const form = dialog.querySelector('form');
    if (form) bindForm(form, async (data) => close(opts.submit ? await opts.submit(data) : data));
    dialog.showModal();
    opts.init?.(dialog, close);
  });
}

export function confirmModal(message, { ok = 'Confirm', danger = false } = {}) {
  return modal(html`
    <form method="dialog">
      <p>${message}</p>
      <div class="actions end">
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="${danger ? 'danger-fill' : 'primary'}">${ok}</button>
      </div>
    </form>`).then((v) => v !== null);
}

export function promptModal(title, { label = '', value = '', placeholder = '', ok = 'Save', multiline = false, maxlength = 200, required = true } = {}) {
  return modal(html`
    <form>
      <h2>${title}</h2>
      ${label ? html`<label for="pm-input">${label}</label>` : ''}
      ${multiline
        ? html`<textarea id="pm-input" name="value" maxlength="${maxlength}" placeholder="${placeholder}" ${required ? 'required' : ''}>${value}</textarea>`
        : html`<input id="pm-input" name="value" maxlength="${maxlength}" placeholder="${placeholder}" value="${value}" ${required ? 'required' : ''}>`}
      <div class="error"></div>
      <div class="actions end">
        <button type="button" data-close>Cancel</button>
        <button type="submit" class="primary">${ok}</button>
      </div>
    </form>`, { init: (d) => d.querySelector('#pm-input').focus() }).then((v) => (v ? v.value : null));
}

// A small popover menu anchored to a button. items: [{ label, action, danger }]
export function menu(anchor, items) {
  document.querySelector('.popover')?.remove();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.setAttribute('role', 'menu');
  render(pop, html`${items.filter(Boolean).map((it, i) => html`<button type="button" role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.label}</button>`)}`);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  const below = r.bottom + 4;
  pop.style.top = below + pop.offsetHeight > window.innerHeight - 8 ? `${Math.max(8, r.top - pop.offsetHeight - 4)}px` : `${below}px`;
  const list = items.filter(Boolean);
  const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true));
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    pop.remove();
    document.removeEventListener('pointerdown', off, true);
    list[Number(b.dataset.i)].action();
  });
  pop.querySelector('button')?.focus();
}

export const icons = {
  menu: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>'),
  users: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.1 4.6 1.8 5.3 4.9"/></svg>'),
  home: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>'),
  bell: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>'),
  compass: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>'),
  plus: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'),
  mask: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7c3-1 6-1 9 1 3-2 6-2 9-1 0 6-3 10-6 10-1.5 0-2-1.5-3-1.5S10.5 17 9 17c-3 0-6-4-6-10z"/><circle cx="8" cy="11" r="1.3"/><circle cx="16" cy="11" r="1.3"/></svg>'),
  gear: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'),
  shield: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>'),
  dice: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><circle cx="8.5" cy="8.5" r="1.2" class="fill"/><circle cx="15.5" cy="15.5" r="1.2" class="fill"/><circle cx="12" cy="12" r="1.2" class="fill"/></svg>'),
  send: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7z"/></svg>'),
  warn: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>'),
  more: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" class="fill"/><circle cx="12" cy="12" r="1.5" class="fill"/><circle cx="19" cy="12" r="1.5" class="fill"/></svg>'),
  hash: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7 21M17 3l-2 18M4 8.5h17M3 15.5h17"/></svg>'),
  chevron: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'),
  back: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>'),
  hourglass: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/></svg>'),
};
