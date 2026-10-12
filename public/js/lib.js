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

// Uploads a file as-is (videos, audio). Images should go through uploadImage instead.
export async function uploadFile(file) {
  const type = (file.type || '').split(';')[0] || 'application/octet-stream';
  const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': type }, body: file, credentials: 'same-origin' });
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
// **bold**, *action*, __underline__, ~~strike~~, ||spoiler||, "dialogue", @mentions, > quotes,
// plus forum-style add-on codes writers use to build their own post layouts:
//   [center] [right] [box] [h] … [/…] (blocks)   [hr]   [img]https://…[/img]   [url=https://…]text[/url]
//   [color=#hex] [size=small|big|huge] [caps] [b] [i] [u] [s] … [/…] (inline)
// Colors become data-color (applied by render()), so no inline styles are needed.
const PIC = /^(?:https:\/\/[^\s"<>\[\]]+|\/uploads\/[\w-]+\.(?:png|jpg|webp|gif))$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const BLOCKS = { center: 'fx-center', right: 'fx-right', box: 'fx-box', h: 'fx-h' };

// Escaped quotes or brackets never belong in a link (they'd only be there to break out of it).
const safeUrl = (url) => !/&(?:quot|#39|lt|gt);/.test(url);

function inlineFormat(s) {
  // Links are set aside first so no other formatting can reach inside an address.
  const kept = [];
  const keep = (markup) => `\u0000${kept.push(markup) - 1}\u0000`;
  return s
    .replace(/\[img\]\s*(\S+?)\s*\[\/img\]/gi, (m, url) => (PIC.test(url) && safeUrl(url)
      ? keep(`<img class="fx-img" src="${url}" alt="" loading="lazy">`) : m))
    .replace(/\[url=([^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, (m, url, text) => (/^https?:\/\/[^\s"<>]+$/.test(url) && safeUrl(url)
      ? `${keep(`<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">`)}${text}</a>` : m))
    .replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (m, c, text) => (HEX.test(c) ? `<span class="fx-color" data-color="${c}">${text}</span>` : m))
    .replace(/\[size=(small|big|huge)\]([\s\S]*?)\[\/size\]/gi, (m, size, text) => `<span class="fx-${size.toLowerCase()}">${text}</span>`)
    .replace(/\[caps\]([\s\S]*?)\[\/caps\]/gi, '<span class="fx-caps">$1</span>')
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="action">$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>')
    .replace(/(&quot;|“)(.+?)(&quot;|”)/g, '<span class="dialogue">$1$2$3</span>')
    .replace(/(^|[\s(>])@([^\s@<&]+?)(?=[.,!?;:)\]]*(?:\s|$|<|&))/gu, '$1<span class="mention">@$2</span>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]);
}

function paragraphs(text) {
  return text
    .replace(/^[ \t]*\[hr\][ \t]*$/gim, '\n\n[hr]\n\n')
    .split(/\n{2,}/)
    .map((para) => para.replace(/^\n+|\n+$/g, ''))
    .filter((para) => para.trim())
    .map((para) => {
      if (/^\s*\[hr\]\s*$/i.test(para)) return '<hr class="fx-hr">';
      const lines = para.split('\n');
      if (lines.every((l) => l.startsWith('&gt; ') || l === '&gt;')) {
        return `<blockquote>${inlineFormat(lines.map((l) => l.replace(/^&gt; ?/, '')).join('<br>'))}</blockquote>`;
      }
      return `<p>${inlineFormat(para).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

// Block codes can hold several paragraphs (and other blocks), so they're split out first.
function blocks(text) {
  const m = text.match(/\[(center|right|box|h)\]([\s\S]*?)\[\/\1\]/i);
  if (!m) return paragraphs(text);
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const tag = m[1].toLowerCase();
  const inner = tag === 'h' ? inlineFormat(m[2].trim()) : blocks(m[2]);
  return `${paragraphs(before)}<div class="${BLOCKS[tag]}">${inner}</div>${blocks(after)}`;
}

export function formatPost(text) {
  return raw(blocks(esc(String(text ?? "").replace(/\u0000/g, ""))));
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

// The NUUVI logo. Colors come from CSS (--logo-*), so it follows the theme like the brand sheet:
// pink tile on base and light, black tile with a pink ring on dark.
export const logoMark = raw('<svg class="logo-mark" viewBox="0 0 100 100" role="img" aria-label="NUUVI"><rect class="lg-tile" x="1.5" y="1.5" width="97" height="97" rx="26"/><path class="lg-n" d="M21.5 73V49C21.5 29 41 25 50 41L59.5 59C63 65.5 67 69.5 77 69.5"/><path class="lg-spark" d="M75.5 15C76.6 25 79.5 28.4 90.5 29.8C79.5 31.2 76.6 34.6 75.5 45C74.4 34.6 71.5 31.2 60.5 29.8C71.5 28.4 74.4 25 75.5 15Z"/></svg>');
export const wordmark = raw('<svg class="wordmark" viewBox="0 0 142 40" role="img" aria-label="nuuvi"><g class="lg-word"><path d="M5 35V22.5a10 10 0 0 1 20 0V35"/><path d="M38 13V25.5a10 10 0 0 0 20 0V13V35"/><path d="M71 13V25.5a10 10 0 0 0 20 0V13V35"/><path d="M103 13L113.5 35L124 13"/><path d="M137 15V35"/></g><circle class="lg-dot" cx="137" cy="4.6" r="4.6"/></svg>');

export const icons = {
  // Uicons by Flaticon (flaticon.com/uicons): user, menu-burger, apps, user-add, power, fingerprint, music-alt.
  menu: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.5 10.5H1.5Q0.9 10.5 0.4 10.9Q0 11.4 0 12Q0 12.6 0.4 13.1Q0.9 13.5 1.5 13.5H22.5Q23.1 13.5 23.6 13.1Q24 12.6 24 12Q24 11.4 23.6 10.9Q23.1 10.5 22.5 10.5ZM1.5 6.5H22.5Q23.1 6.5 23.6 6Q24 5.6 24 5Q24 4.4 23.6 4Q23.1 3.5 22.5 3.5H1.5Q0.9 3.5 0.4 4Q0 4.4 0 5Q0 5.6 0.4 6Q0.9 6.5 1.5 6.5ZM22.5 17.5H1.5Q0.9 17.5 0.4 18Q0 18.4 0 19Q0 19.6 0.4 20Q0.9 20.5 1.5 20.5H22.5Q23.1 20.5 23.6 20Q24 19.6 24 19Q24 18.4 23.6 18Q23.1 17.5 22.5 17.5Z"/></svg>'),
  apps: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 0H7Q8.6 0 9.8 1.2Q11 2.3 11 4V7Q11 8.6 9.8 9.8Q8.6 11 7 11H4Q2.3 11 1.2 9.8Q0 8.6 0 7V4Q0 2.3 1.2 1.2Q2.3 0 4 0ZM17 0H20Q21.7 0 22.8 1.2Q24 2.3 24 4V7Q24 8.6 22.8 9.8Q21.7 11 20 11H17Q15.4 11 14.2 9.8Q13 8.6 13 7V4Q13 2.3 14.2 1.2Q15.4 0 17 0ZM4 13H7Q8.6 13 9.8 14.2Q11 15.4 11 17V20Q11 21.7 9.8 22.8Q8.6 24 7 24H4Q2.3 24 1.2 22.8Q0 21.7 0 20V17Q0 15.4 1.2 14.2Q2.3 13 4 13ZM17 13H20Q21.7 13 22.8 14.2Q24 15.4 24 17V20Q24 21.7 22.8 22.8Q21.7 24 20 24H17Q15.4 24 14.2 22.8Q13 21.7 13 20V17Q13 15.4 14.2 14.2Q15.4 13 17 13Z"/></svg>'),
  user: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6Q6 7.6 6.8 9Q7.6 10.4 9 11.2Q10.4 12 12 12Q13.6 12 15 11.2Q16.4 10.4 17.2 9Q18 7.6 18 6Q18 4.4 17.2 3Q16.4 1.6 15 0.8Q13.6 0 12 0Q10.4 0 9 0.8Q7.6 1.6 6.8 3Q6 4.4 6 6ZM12 14Q9.5 14 7.5 15.2Q5.4 16.4 4.2 18.5Q3 20.6 3 23Q3 23.4 3.3 23.7Q3.6 24 4 24H20Q20.4 24 20.7 23.7Q21 23.4 21 23Q21 20.6 19.8 18.5Q18.6 16.4 16.5 15.2Q14.5 14 12 14Z"/></svg>'),
  userAdd: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 11H21V9Q21 8.6 20.7 8.3Q20.4 8 20 8Q19.6 8 19.3 8.3Q19 8.6 19 9V11H17Q16.6 11 16.3 11.3Q16 11.6 16 12Q16 12.4 16.3 12.7Q16.6 13 17 13H19V15Q19 15.4 19.3 15.7Q19.6 16 20 16Q20.4 16 20.7 15.7Q21 15.4 21 15V13H23Q23.4 13 23.7 12.7Q24 12.4 24 12Q24 11.6 23.7 11.3Q23.4 11 23 11ZM3 6Q3 7.6 3.8 9Q4.6 10.4 6 11.2Q7.4 12 9 12Q10.6 12 12 11.2Q13.4 10.4 14.2 9Q15 7.6 15 6Q15 4.4 14.2 3Q13.4 1.6 12 0.8Q10.6 0 9 0Q7.4 0 6 0.8Q4.6 1.6 3.8 3Q3 4.4 3 6ZM9 14Q6.6 14 4.5 15.2Q2.4 16.4 1.2 18.5Q0 20.6 0 23Q0 23.4 0.3 23.7Q0.6 24 1 24H17Q17.4 24 17.7 23.7Q18 23.4 18 23Q18 20.6 16.8 18.5Q15.6 16.4 13.5 15.2Q11.4 14 9 14Z"/></svg>'),
  power: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0Q12.6 0 13.1 0.4Q13.5 0.9 13.5 1.5V6.5Q13.5 7.1 13.1 7.6Q12.6 8 12 8Q11.4 8 10.9 7.6Q10.5 7.1 10.5 6.5V1.5Q10.5 0.9 10.9 0.4Q11.4 0 12 0ZM15.5 5Q15.5 5.8 16.2 6.2Q18 7.3 19 9.2Q20 11 20 13.2Q19.9 15.4 18.8 17.2Q17.7 19 15.8 20Q13.9 21 11.8 21Q9.7 21 7.8 19.8Q6 18.7 5 16.8Q4 15 4 12.8Q4.1 10.7 5.2 8.8Q6.2 7.2 7.8 6.2Q8.5 5.8 8.5 5Q8.5 4.3 8 3.9Q7.6 3.4 7 3.4Q6.6 3.4 6.2 3.7Q3.7 5.3 2.3 7.8Q1 10.4 1 13.3Q1.1 16.2 2.7 18.8Q4.2 21.4 6.8 22.7Q9.4 24.1 12.4 24Q15.3 23.9 17.8 22.4Q20.3 20.8 21.7 18.2Q23 15.6 23 12.7Q22.9 9.8 21.4 7.2Q20 5 17.8 3.7Q17.3 3.4 16.7 3.5Q16.1 3.6 15.8 4.2Q15.5 4.5 15.5 5Z"/></svg>'),
  fingerprint: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22.3Q5.6 22.3 5.4 22.1Q5.1 21.8 5 21.5Q4.9 21.2 5 20.9Q5.2 20.6 5.4 20.4Q7.1 19.4 7.9 17.7Q8.6 16.2 8.9 14.2Q9 13 9 11Q9 9.8 9.9 8.9Q10.7 8 12 8Q13.3 8 14.2 8.9Q15 9.8 15 11Q15 11.4 14.7 11.7Q14.4 12 14 12Q13.6 12 13.3 11.7Q13 11.4 13 11Q13 10.6 12.7 10.3Q12.4 10 12 10Q11.6 10 11.3 10.3Q11 10.6 11 11Q11 13.3 10.8 14.6Q10.6 17 9.7 18.7Q8.6 20.9 6.5 22.2Q6.2 22.3 6 22.3ZM11 23.7Q14.4 20.2 14.9 14.1Q15 13.7 14.7 13.4Q14.4 13 14 13Q13.6 13 13.3 13.2Q13 13.5 12.9 13.9Q12.5 19.4 9.5 22.3Q9.2 22.6 9.2 23Q9.2 23.4 9.5 23.7Q9.8 24 10.2 24Q10.6 24 11 23.7ZM16.2 23.5Q17 22 17.7 20.3Q17.8 19.9 17.6 19.6Q17.4 19.2 17 19.1Q16.6 19 16.3 19.1Q15.9 19.3 15.8 19.7Q15.2 21.1 14.4 22.5Q14.2 22.8 14.3 23.2Q14.4 23.7 14.8 23.9Q15.1 24.1 15.5 24Q15.9 23.8 16.2 23.5ZM18.5 17.2Q19 14.2 19 11Q19 8.8 17.8 7Q16.6 5.3 14.5 4.5Q12.5 3.7 10.4 4.2Q8.2 4.7 6.8 6.3Q6.4 6.8 6.6 7.4Q6.7 7.9 7.3 8Q7.9 8.1 8.2 7.7Q9.3 6.5 10.8 6.1Q12.3 5.8 13.8 6.3Q15.2 6.9 16.1 8.2Q17 9.4 17 11Q17 13.9 16.6 16.8Q16.5 17.2 16.7 17.6Q17 17.9 17.4 18H17.5Q17.8 18 18.1 17.8Q18.4 17.5 18.5 17.2ZM7 11Q7 10.6 7 10.2Q7.2 9.6 6.8 9.2Q6.3 8.8 5.8 9Q5.2 9.2 5.1 9.8Q5 10.4 5 11Q5 18 1 18Q0.6 18 0.3 18.3Q0 18.6 0 19Q0 19.4 0.3 19.7Q0.6 20 1 20Q3.9 20 5.5 17.7Q7 15.4 7 11ZM20.7 23.4Q23.2 17.4 23 11Q23 8.5 21.9 6.2Q21.7 5.8 21.3 5.7Q21 5.6 20.6 5.8Q20.2 5.9 20 6.3Q19.9 6.7 20.1 7.1Q21 9 21 11Q21.2 17 18.9 22.6Q18.7 23 18.9 23.4Q19 23.8 19.4 23.9Q19.6 24 19.8 24Q20.1 24 20.3 23.8Q20.6 23.7 20.7 23.4ZM3 14V11Q3 8.6 4.2 6.5Q5.4 4.4 7.5 3.2Q9.5 2 12 2Q15 2 17.4 3.8Q17.8 4.1 18.2 4Q18.6 3.9 18.8 3.6Q19 3.3 19 2.9Q19 2.5 18.6 2.2Q17.2 1.1 15.5 0.6Q13.8 0 12 0Q9 0 6.5 1.5Q4 3 2.5 5.5Q1 8 1 11V14Q1 14.4 1.3 14.7Q1.6 15 2 15Q2.4 15 2.7 14.7Q3 14.4 3 14Z"/></svg>'),
  music: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.9 0.7Q22.4 0.2 21.8 0.1Q21.1 -0.1 20.5 0.1L8.5 2.3Q7.4 2.5 6.7 3.3Q6 4.2 6 5.3V16.6Q5 16 4 16Q2.3 16 1.2 17.2Q0 18.3 0 20Q0 21.7 1.2 22.8Q2.3 24 4 24Q5.7 24 6.8 22.8Q8 21.7 8 20V9.4L22 6.8V13.6Q21 13 20 13Q18.3 13 17.2 14.2Q16 15.4 16 17Q16 18.6 17.2 19.8Q18.3 21 20 21Q21.7 21 22.8 19.8Q24 18.6 24 17V3Q24 2.3 23.7 1.7Q23.4 1.1 22.9 0.7Z"/></svg>'),
  sparkle: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.5 5.2 2 6.9 8 7.6-6 .7-7.5 2.4-8 7.6-.5-5.2-2-6.9-8-7.6 6-.7 7.5-2.4 8-7.6zM19 15.5c.2 2 .8 2.6 3 2.9-2.2.3-2.8.9-3 2.9-.2-2-.8-2.6-3-2.9 2.2-.3 2.8-.9 3-2.9z"/></svg>'),
  users: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.1 4.6 1.8 5.3 4.9"/></svg>'),
  home: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>'),
  bell: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>'),
  compass: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>'),
  plus: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'),
  mask: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7c3-1 6-1 9 1 3-2 6-2 9-1 0 6-3 10-6 10-1.5 0-2-1.5-3-1.5S10.5 17 9 17c-3 0-6-4-6-10z"/><circle cx="8" cy="11" r="1.3"/><circle cx="16" cy="11" r="1.3"/></svg>'),
  gear: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'),
  shield: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>'),
  send: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6 16-3-7z"/></svg>'),
  warn: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>'),
  more: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5" class="fill"/><circle cx="12" cy="12" r="1.5" class="fill"/><circle cx="19" cy="12" r="1.5" class="fill"/></svg>'),
  hash: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7 21M17 3l-2 18M4 8.5h17M3 15.5h17"/></svg>'),
  chevron: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'),
  back: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>'),
  sun: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>'),
  moon: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'),
  sliders: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>'),
  logout: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v6a3 3 0 0 0 3 3h11"/><path d="m15 10 4 4-4 4"/></svg>'),
  quill: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4c-7 1-11 5-13 12l-2 4"/><path d="M8 14c3 0 6-1 8-4"/></svg>'),
  chat: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 4v-4h0.5A2.5 2.5 0 0 1 4 13.5z"/></svg>'),
  calendar: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>'),
  lock: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'),
  check: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>'),
  star: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" class="fill"/></svg>'),
  quote: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v10H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>'),
  broadcast: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.6" class="fill"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>'),
  profile: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>'),
  feather: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C12 4 6 9 5 19"/><path d="M5 19c4 0 9-2 12-7l-6 1 7-5"/></svg>'),
  heart: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-8.6-9A4.6 4.6 0 0 1 12 7.3 4.6 4.6 0 0 1 20.6 11C19 15.6 12 20 12 20z"/></svg>'),
  heartFill: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 20s-7-4.4-8.6-9A4.6 4.6 0 0 1 12 7.3 4.6 4.6 0 0 1 20.6 11C19 15.6 12 20 12 20z"/></svg>'),
  starOutline: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>'),
  image: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></svg>'),
  video: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 10.5 5-3v9l-5-3z"/></svg>'),
  mic: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>'),
  live: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.2" class="fill"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></svg>'),
  text: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 11h14M5 16h9"/></svg>'),
  verified: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 2.5l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 21.5l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z"/><path d="m8.5 12 2.4 2.4 4.6-4.8" stroke="var(--base)" stroke-width="2"/></svg>'),
  grid: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>'),
  play: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.5v13l11-6.5z"/></svg>'),
  reply: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/></svg>'),
  search: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>'),
  phone: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.7l1.4 4-2 1.3a11 11 0 0 0 6.5 6.5l1.3-2 4 1.4v2.7a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/></svg>'),
  card: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9.5" cy="11" r="2"/><path d="M6.5 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14.5 10h3M14.5 13.5h3"/></svg>'),
  smartphone: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M10.5 5.5h3M11 18.5h2"/></svg>'),
  hourglass: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/></svg>'),
};

// Instead of uploading, use a picture that's already online (Pinterest, Tumblr, Imgur…).
// Note: the site hosting the picture can see the addresses of people who view it.
export async function askImageLink(title = 'Use a picture link') {
  const v = await promptModal(title, { label: 'Paste the picture’s web address', placeholder: 'https://i.pinimg.com/…', maxlength: 2000, ok: 'Use picture' });
  if (!v) return null;
  const url = v.trim();
  try { if (new URL(url).protocol === 'https:') return url; } catch { /* not a URL */ }
  toast('That needs to be a picture link starting with https://');
  return null;
}

// Post text as plain words (for previews): formatting codes and markup symbols removed.
export const plainText = (body = '', max = 80) => {
  const t = String(body).replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ').replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?(?:center|right|box|h|hr|color|size|caps|b|i|u|s)(?:=[^\]]*)?\]/gi, ' ').replace(/\|\||[*_~`>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
