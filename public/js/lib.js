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
// The NUUVI gradient (pink → lilac), the default wherever a picture or color is missing.
export const BRAND_GRADIENT = ['#EE719E', '#C79AD8', '#B8A6DB'];
// Gradient presets — the first is the NUUVI gradient.
export const GRADIENT_PRESETS = [BRAND_GRADIENT, ['#F7A8C4', '#EE719E', '#9D7BD8'], ['#9DB7B8', '#A9A8CF', '#B8A6DB'], ['#F7D9A8', '#EE719E'],
  ['#7AA7FF', '#B8A6DB', '#EE719E'], ['#2A2A2D', '#8F8D8E'], ['#E85D4A', '#F2B04C'], ['#4CB8A6', '#2E6FB8']];

export function applyColors(root) {
  for (const el of root.querySelectorAll('[data-color]')) el.style.setProperty('--c', el.dataset.color);
  // Gradient characters: --g is the full sweep, --g1/--g2/--g3 are its first, middle and last colors.
  for (const el of root.querySelectorAll('[data-grad]')) {
    const stops = el.dataset.grad.split(',').filter((x) => /^#[0-9a-f]{6}$/i.test(x));
    if (stops.length < 2) continue;
    el.style.setProperty('--g', `linear-gradient(100deg, ${stops.join(', ')})`);
    el.style.setProperty('--g1', stops[0]);
    el.style.setProperty('--g2', stops[Math.floor(stops.length / 2)]);
    el.style.setProperty('--g3', stops[stops.length - 1]);
  }
}
// A writer's own gradient (their display name and writing-style bars); the NUUVI gradient until they pick one.
// A writer's own gradient on their name, if they picked one (otherwise the name is plain).
export const userGrad = (u) => (u?.gradient?.length ? raw(` data-grad="${esc(u.gradient.join(','))}"`) : '');
export const gradAttr = (c) => (c?.gradient?.length ? raw(` data-grad="${esc(c.gradient.join(','))}"`) : '');

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
// Header pictures: center-cropped to the banner's 3:1 shape at full width (GIFs go up as they are).
export async function uploadBanner(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image');
  if (file.type === 'image/gif') return uploadImage(file);
  const bitmap = await createImageBitmap(file);
  const w = bitmap.width;
  const h = Math.min(bitmap.height, Math.round(w / 3));
  const cw = h === bitmap.height ? Math.round(h * 3) : w;
  const width = Math.min(2400, cw);
  if (cw < 900) toast(`Heads-up: this picture is narrow (${bitmap.width} px wide); headers look best 1800 px wide or more.`);
  // Faces usually sit in the upper half, so the crop leans a little above center.
  const sy = Math.max(0, Math.round((bitmap.height - h) * 0.4));
  const sx = Math.max(0, Math.round((w - cw) / 2));
  const canvas = drawSharp(bitmap, sx, sy, cw, h, width, Math.round(width / 3));
  return uploadFile(await encode(canvas));
}

// Pictures go up sharp: they're kept at twice the size they're shown (for phone screens), shrunk
// in gentle steps with the browser's best smoothing, and saved at high quality. A picture that's
// already small enough goes up untouched. Very small pictures get a heads-up that they may look soft.
const sharpSize = (maxSize) => Math.min(2560, Math.max(800, Math.round(maxSize * 2)));
async function encode(canvas) {
  let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.92));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  return blob;
}
function drawSharp(bitmap, sx, sy, sw, sh, w, h) {
  // Halve the picture until it's close to the target, then draw it at the final size.
  let src = bitmap;
  let cw = sw;
  let ch = sh;
  let x = sx;
  let y = sy;
  while (cw / 2 > w && ch / 2 > h) {
    const step = document.createElement('canvas');
    step.width = Math.round(cw / 2);
    step.height = Math.round(ch / 2);
    const g = step.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, x, y, cw, ch, 0, 0, step.width, step.height);
    src = step; cw = step.width; ch = step.height; x = 0; y = 0;
  }
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, x, y, cw, ch, 0, 0, w, h);
  return out;
}

export async function uploadImage(file, maxSize = 640) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image');
  // GIFs go up as they are, so they keep moving (resizing would flatten them to one frame).
  if (file.type === 'image/gif') {
    if (file.size > 15 * 1024 * 1024) throw new Error('GIFs can be up to 15 MB');
    return uploadFile(file);
  }
  const bitmap = await createImageBitmap(file);
  const target = sharpSize(maxSize);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest < Math.min(600, maxSize)) toast(`Heads-up: this picture is small (${bitmap.width} × ${bitmap.height}), so it may look soft when shown big.`);
  // Already the right size, in a format browsers show everywhere: send it as it is (no re-saving).
  if (longest <= target && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 7.5 * 1024 * 1024) return uploadFile(file);
  const scale = Math.min(1, target / longest);
  const canvas = drawSharp(bitmap, 0, 0, bitmap.width, bitmap.height, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  return uploadFile(await encode(canvas));
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

// Roleplay formatting. Input is escaped first, so only these patterns produce markup.
// Discord style: **bold**, *action*, _italic_, ***both***, __underline__, ~~strike~~, ||spoiler||,
//   `code`, ```code blocks```, # / ## / ### headings, -# small print, > quote, >>> quote-the-rest,
//   - lists, 1. lists, [text](https://link), bare links (picture and GIF links show as pictures).
// Jcink / forum style: [center] [left] [right] [align=…] [box] [h] [indent] [quote(=Name)] [list(=1)][*]…
//   [code] [hr] [img] [url(=…)] [color=…] [highlight=…] [size=small|big|huge|1-7] [font=…] [caps]
//   [b] [i] [u] [s] [strike] [sup] [sub] [spoiler]
// Plus "dialogue" and @mentions. Colors become data-color (applied by applyColors), so no inline styles.
const PIC = /^(?:https:\/\/[^\s"<>\[\]]+|\/uploads\/[\w-]+\.(?:png|jpg|webp|gif))$/;
const PIC_LINK = /^https:\/\/(?:[^\s"<>]+\.(?:png|jpe?g|gif|webp|avif)(?:[?#][^\s"<>]*)?|(?:media\d*|i)\.giphy\.com\/[^\s"<>]+|media\d*\.tenor\.com\/[^\s"<>]+)$/i;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const colorOk = (c) => HEX.test(c) || /^[a-z]{3,20}$/i.test(c);
const BLOCKS = { center: 'fx-center', right: 'fx-right', left: 'fx-left', box: 'fx-box', h: 'fx-h', indent: 'fx-indent' };
const SIZES = { tiny: 'small', small: 'small', big: 'big', huge: 'huge', 1: 'tiny', 2: 'small', 3: '', 4: 'big', 5: 'big', 6: 'huge', 7: 'huge' };
// Sans-serif fonts only (serif names fall back to the normal text font).
const FONTS = {
  sans: 'sans', 'sans-serif': 'sans', arial: 'sans', helvetica: 'sans', verdana: 'verdana', tahoma: 'verdana', trebuchet: 'trebuchet', 'trebuchet ms': 'trebuchet',
  rounded: 'rounded', mono: 'mono', monospace: 'mono', typewriter: 'mono', 'comic sans ms': 'comic', comic: 'comic', impact: 'impact',
};

// Escaped quotes or brackets never belong in a link (they'd only be there to break out of it).
const safeUrl = (url) => !/&(?:quot|#39|lt|gt);/.test(url);
const LINK_OPEN = (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer nofollow">`;

function inlineFormat(s) {
  // Code and links are set aside first so no other formatting can reach inside them.
  const kept = [];
  const keep = (markup) => `\u0000${kept.push(markup) - 1}\u0000`;
  return s
    .replace(/`([^`\n]+)`/g, (m, code) => keep(`<code>${code}</code>`))
    .replace(/\[img\]\s*(\S+?)\s*\[\/img\]/gi, (m, url) => (PIC.test(url) && safeUrl(url)
      ? keep(`<img class="fx-img" src="${url}" alt="" loading="lazy">`) : m))
    .replace(/\[url=([^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, (m, url, text) => (/^https?:\/\/[^\s"<>]+$/.test(url) && safeUrl(url)
      ? `${keep(LINK_OPEN(url))}${text}</a>` : m))
    .replace(/\[url\]\s*(https?:\/\/[^\s"<>\[]+?)\s*\[\/url\]/gi, (m, url) => (safeUrl(url) ? keep(`${LINK_OPEN(url)}${url}</a>`) : m))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s()"<>]+)\)/g, (m, text, url) => (safeUrl(url) ? `${keep(LINK_OPEN(url))}${text}</a>` : m))
    .replace(/(^|[\s(>]|&quot;|“)(https?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<"])+)/g, (m, pre, found) => {
      const url = pictureLink(found.replace(/[.,!?;:)\]']+$/, ''));
      const rest = found.slice(found.replace(/[.,!?;:)\]']+$/, '').length);
      if (!safeUrl(url) || url.length < 10) return m;
      return pre + keep(PIC_LINK.test(url) ? `<img class="fx-img" src="${url}" alt="" loading="lazy">` : `${LINK_OPEN(url)}${url}</a>`) + rest;
    })
    .replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, (m, c, text) => (colorOk(c) ? `<span class="fx-color" data-color="${c}">${text}</span>` : m))
    .replace(/\[highlight=([^\]]+)\]([\s\S]*?)\[\/highlight\]/gi, (m, c, text) => (colorOk(c) ? `<mark class="fx-hl" data-color="${c}">${text}</mark>` : m))
    .replace(/\[size=([^\]]+)\]([\s\S]*?)\[\/size\]/gi, (m, size, text) => {
      const k = SIZES[size.trim().toLowerCase()];
      return k === undefined ? m : k ? `<span class="fx-${k}">${text}</span>` : text;
    })
    .replace(/\[font=([^\]]+)\]([\s\S]*?)\[\/font\]/gi, (m, font, text) => {
      const k = FONTS[font.replace(/&quot;|&#39;/g, '').trim().toLowerCase()];
      return k ? `<span class="fx-font-${k}">${text}</span>` : text;
    })
    .replace(/\[caps\]([\s\S]*?)\[\/caps\]/gi, '<span class="fx-caps">$1</span>')
    // <hl> / [hl]: a soft highlight around the words in the character's own color; the text keeps its color.
    .replace(/\[hl\]([\s\S]*?)\[\/hl\]/gi, '<mark class="fx-chip">$1</mark>')
    .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="spoiler" tabindex="0">$1</span>')
    .replace(/\[sup\]([\s\S]*?)\[\/sup\]/gi, '<sup>$1</sup>')
    .replace(/\[sub\]([\s\S]*?)\[\/sub\]/gi, '<sub>$1</sub>')
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    .replace(/\[(?:s|strike)\]([\s\S]*?)\[\/(?:s|strike)\]/gi, '<s>$1</s>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em class="action">$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="action">$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[\s(>])_([^_\s](?:[^_]*?[^_\s])?)_(?=$|[\s.,!?;:)<])/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" tabindex="0">$1</span>')
    .replace(/(&quot;|“)(.+?)(&quot;|”)/g, '<span class="dialogue">$1$2$3</span>')
    .replace(/(^|[\s(>])@([^\s@<&]+?)(?=[.,!?;:)\]]*(?:\s|$|<|&))/gu, '$1<span class="mention">@$2</span>')
    // #hashtags open THE NU filtered to that tag.
    .replace(/(^|[\s(>])#((?=[\p{L}\p{N}_]*\p{L})[\p{L}\p{N}_]{2,40})/gu, (m, pre, tag) => `${pre}<a class="hashtag" href="#/nu/tag/${encodeURIComponent(tag)}">#${tag}</a>`)
    .replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i])
    .replace(/[ \t]{2,}|^ |\n /g, keepSpaces);
}

// Extra spaces stay as typed (browsers squeeze them into one): every space after the first in a run,
// and a space at the start of a line, becomes a non-breaking space. Tabs count as four spaces.
function keepSpaces(run) {
  const nl = run.startsWith('\n') ? '\n' : '';
  const spaces = run.replace(/\n/, '').replace(/\t/g, '    ');
  if (nl || run === ' ') return `${nl}\u00a0${'\u00a0'.repeat(spaces.length - 1)}`;
  return ` ${'\u00a0'.repeat(spaces.length - 1)}`;
}
// An AKA line: **double stars** (or <b>) in the character's color, <i> <u> <s> and <hl> highlights, and spaces kept as typed.
export const akaHtml = (aka) => esc(aka)
  .replace(/\*\*(.+?)\*\*|&lt;(?:b|strong)&gt;(.+?)&lt;\/(?:b|strong)&gt;/gi, (m, a, b) => `<b class="accent">${a ?? b}</b>`)
  .replace(/&lt;(i|em)&gt;(.+?)&lt;\/\1&gt;/gi, '<i>$2</i>')
  .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/gi, '<u>$1</u>')
  .replace(/&lt;(s|strike)&gt;(.+?)&lt;\/\1&gt;/gi, '<s>$2</s>')
  .replace(/&lt;hl&gt;(.+?)&lt;\/hl&gt;|\[hl\](.+?)\[\/hl\]/gi, (m, a, b) => `<mark class="fx-chip">${a ?? b}</mark>`)
  .replace(/[ \t]{2,}|^ /g, keepSpaces);

// Discord-style line codes inside a paragraph: headings, small print, quotes and lists.
function lineBlocks(para) {
  const lines = para.split('\n');
  const out = [];
  let text = [];
  const flush = () => { if (text.length) out.push(`<p>${inlineFormat(text.join('\n')).replace(/\n/g, '<br>')}</p>`); text = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = l.match(/^&gt;&gt;&gt; ?(.*)$/))) {
      flush();
      out.push(`<blockquote>${inlineFormat([m[1], ...lines.slice(i + 1)].join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
      break;
    } else if (/^&gt;(?: |$)/.test(l)) {
      flush();
      const q = [];
      while (i < lines.length && /^&gt;(?: |$)/.test(lines[i])) q.push(lines[i++].replace(/^&gt; ?/, ''));
      i--;
      out.push(`<blockquote>${inlineFormat(q.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
    } else if ((m = l.match(/^(#{1,3}) (.+)$/))) {
      flush();
      out.push(`<div class="fx-h${m[1].length}">${inlineFormat(m[2])}</div>`);
    } else if ((m = l.match(/^-# (.+)$/))) {
      flush();
      out.push(`<div class="fx-sub">${inlineFormat(m[1])}</div>`);
    } else if (/^\s*(?:[-*•]|\d{1,3}[.)]) \S/.test(l)) {
      flush();
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && (ordered ? /^\s*\d{1,3}[.)] \S/ : /^\s*[-*•] \S/).test(lines[i])) items.push(lines[i++].replace(/^\s*(?:[-*•]|\d{1,3}[.)]) /, ''));
      i--;
      const start = ordered ? Number(l.match(/\d+/)[0]) : 1;
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag} class="fx-list"${ordered && start !== 1 ? ` start="${start}"` : ''}>${items.map((it) => `<li>${inlineFormat(it)}</li>`).join('')}</${tag}>`);
    } else {
      text.push(l);
    }
  }
  flush();
  return out.join('');
}

function paragraphs(text) {
  return text
    .replace(/^[ \t]*\[hr\][ \t]*$/gim, '\n\n[hr]\n\n')
    .split(/\n{2,}/)
    .map((para) => para.replace(/^\n+|\n+$/g, ''))
    .filter((para) => para.trim())
    .map((para) => {
      if (/^\s*\[hr\]\s*$/i.test(para)) return '<hr class="fx-hr">';
      if (/^\s*\u0001\d+\u0001\s*$/.test(para)) return para.trim();
      return lineBlocks(para);
    })
    .join('');
}

// Block codes can hold several paragraphs (and other blocks), so they're split out first.
function blocks(text) {
  const m = text.match(/\[(center|right|left|box|h|indent|quote|list)(?:=([^\]\n]*))?\]([\s\S]*?)\[\/\1\]/i);
  if (!m) return paragraphs(text);
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const tag = m[1].toLowerCase();
  let inner;
  if (tag === 'quote') {
    const who = (m[2] || '').replace(/&quot;|&#39;/g, '').trim();
    inner = `<blockquote class="fx-quote">${who ? `<cite>${inlineFormat(who)}</cite>` : ''}${blocks(m[3])}</blockquote>`;
  } else if (tag === 'list') {
    const items = m[3].split(/\[\*\]/).slice(1).map((it) => it.trim()).filter(Boolean);
    const ordered = !!m[2];
    inner = `<${ordered ? 'ol' : 'ul'} class="fx-list">${items.map((it) => `<li>${inlineFormat(it).replace(/\n/g, '<br>')}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  } else {
    inner = `<div class="${BLOCKS[tag]}">${tag === 'h' ? inlineFormat(m[3].trim()) : blocks(m[3])}</div>`;
  }
  return `${paragraphs(before)}${inner}${blocks(after)}`;
}

// Simple HTML works too (<center>, <b>, <i>, <br>, <font color>, <span style="color: …">, <a href>,
// <img src>, <h1>…): each tag is turned into the matching formatting code, so nothing unsafe can
// get through. (The text arrives already escaped, so tags look like &lt;b&gt; here.)
const Q = '(?:&quot;|&#39;)?';
const attr = (name) => new RegExp(`\\b${name}\\s*=\\s*${Q}([^&\\s>]+(?:\\s[^&>]*?)?)${Q}(?=\\s|&gt;|/)`, 'i');
const styleProp = (style, prop) => (style.match(new RegExp(`${prop}\\s*:\\s*([^;&]+)`, 'i')) || [])[1]?.trim();
function htmlCodes(s) {
  if (!/&lt;\/?[a-z]/i.test(s)) return s;
  const pair = (tags, fn) => {
    const re = new RegExp(`&lt;(${tags})((?:\\s[^]*?)?)&gt;([\\s\\S]*?)&lt;\\/\\1\\s*&gt;`, 'gi');
    let prev;
    do { prev = s; s = s.replace(re, (m, tag, attrs, inner) => fn(tag.toLowerCase(), attrs || '', inner)); } while (s !== prev);
  };
  const aligned = (attrs, inner, fallback = null) => {
    const a = (attrs.match(attr('align')) || [])[1] || styleProp(attrs.replace(/&quot;|&#39;/g, ''), 'text-align') || fallback;
    return /^(center|right|left)$/i.test(a || '') ? `[${a.toLowerCase()}]${inner}[/${a.toLowerCase()}]` : inner;
  };
  const styled = (attrs, inner) => {
    const st = (attrs.match(/style\s*=\s*(?:&quot;|&#39;)([^]*?)(?:&quot;|&#39;)/i) || [])[1] || '';
    let out = inner;
    const color = styleProp(st, 'color') || (attrs.match(attr('color')) || [])[1];
    const bg = styleProp(st, 'background(?:-color)?');
    const weight = styleProp(st, 'font-weight');
    const fstyle = styleProp(st, 'font-style');
    const deco = styleProp(st, 'text-decoration');
    const face = styleProp(st, 'font-family') || (attrs.match(attr('face')) || [])[1];
    const size = (attrs.match(attr('size')) || [])[1];
    if (color) out = `[color=${color}]${out}[/color]`;
    if (bg) out = `[highlight=${bg}]${out}[/highlight]`;
    if (weight && /bold|[6-9]00/.test(weight)) out = `[b]${out}[/b]`;
    if (fstyle === 'italic') out = `[i]${out}[/i]`;
    if (deco && /underline/.test(deco)) out = `[u]${out}[/u]`;
    if (deco && /line-through/.test(deco)) out = `[s]${out}[/s]`;
    if (face) out = `[font=${face.split(',')[0].replace(/&quot;|&#39;/g, '')}]${out}[/font]`;
    if (size) out = `[size=${size}]${out}[/size]`;
    return aligned(attrs.replace(/&quot;|&#39;/g, '"'), out);
  };
  s = s.replace(/&lt;br\s*\/?&gt;/gi, '\n').replace(/&lt;hr\s*\/?&gt;/gi, '\n[hr]\n')
    .replace(/&lt;img\b([^]*?)\/?&gt;/gi, (m, a) => { const src = (a.match(attr('src')) || [])[1]; return src ? `[img]${src}[/img]` : m; });
  pair('center', (t, a, inner) => `[center]${inner}[/center]`);
  pair('b|strong', (t, a, inner) => `[b]${inner}[/b]`);
  pair('i|em', (t, a, inner) => `[i]${inner}[/i]`);
  pair('u|ins', (t, a, inner) => `[u]${inner}[/u]`);
  pair('s|strike|del', (t, a, inner) => `[s]${inner}[/s]`);
  pair('sup', (t, a, inner) => `[sup]${inner}[/sup]`);
  pair('sub', (t, a, inner) => `[sub]${inner}[/sub]`);
  pair('small', (t, a, inner) => `[size=small]${inner}[/size]`);
  pair('big', (t, a, inner) => `[size=big]${inner}[/size]`);
  pair('mark', (t, a, inner) => `[highlight=#fff3a3]${inner}[/highlight]`);
  pair('hl', (t, a, inner) => `[hl]${inner}[/hl]`);
  pair('code', (t, a, inner) => `\`${inner}\``);
  pair('blockquote', (t, a, inner) => `[quote]${inner}[/quote]`);
  pair('h1|h2|h3|h4|h5|h6', (t, a, inner) => `\n${'#'.repeat(Math.min(3, Number(t[1])))} ${inner.replace(/\n/g, ' ')}\n`);
  pair('a', (t, a, inner) => { const href = (a.match(attr('href')) || [])[1]; return href && /^https?:\/\//i.test(href) ? `[url=${href}]${inner}[/url]` : inner; });
  pair('font|span', (t, a, inner) => styled(a, inner));
  pair('div|p', (t, a, inner) => `${styled(a, inner)}\n`);
  pair('ul|ol', (t, a, inner) => `[list${t === 'ol' ? '=1' : ''}]${inner.replace(/&lt;li[^]*?&gt;/gi, '[*]').replace(/&lt;\/li\s*&gt;/gi, '')}[/list]`);
  return s;
}

export function formatPost(text) {
  let s = esc(String(text ?? '').replace(/[\u0000\u0001]/g, ''));
  // Code blocks keep their text exactly as typed, so they're set aside before anything else.
  const codes = [];
  const code = (body) => `\n\n\u0001${codes.push(`<pre class="fx-code"><code>${body.replace(/^\n+|\n+$/g, '')}</code></pre>`) - 1}\u0001\n\n`;
  s = s.replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, (m, body) => code(body))
    .replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (m, body) => code(body))
    .replace(/\[align=(left|center|right)\]([\s\S]*?)\[\/align\]/gi, '[$1]$2[/$1]');
  s = htmlCodes(s);
  return raw(blocks(s).replace(/\u0001(\d+)\u0001/g, (_, i) => codes[i]));
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
  // Positions are measured on screen, then divided by the interface zoom (Settings → Interface size).
  const z = Number(getComputedStyle(document.documentElement).zoom) || 1;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth * z;
  const h = pop.offsetHeight * z;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
  pop.style.left = `${left / z}px`;
  pop.style.top = `${top / z}px`;
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
  // Every icon is from Uicons by Flaticon (flaticon.com/uicons), regular rounded (solid for the filled heart, star and verified badge).
  menu: raw('<svg class="fi i-menu" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 11H23Q23.4 11 23.7 11.3Q24 11.6 24 12Q24 12.4 23.7 12.7Q23.4 13 23 13H1Q0.6 13 0.3 12.7Q0 12.4 0 12Q0 11.6 0.3 11.3Q0.6 11 1 11ZM1 4H23Q23.4 4 23.7 4.3Q24 4.6 24 5Q24 5.4 23.7 5.7Q23.4 6 23 6H1Q0.6 6 0.3 5.7Q0 5.4 0 5V5Q0 4.6 0.3 4.3Q0.6 4 1 4ZM1 18H23Q23.4 18 23.7 18.3Q24 18.6 24 19V19Q24 19.4 23.7 19.7Q23.4 20 23 20H1Q0.6 20 0.3 19.7Q0 19.4 0 19Q0 18.6 0.3 18.3Q0.6 18 1 18Z"/></svg>'),
  apps: raw('<svg class="fi i-apps" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 0H4Q2.3 0 1.2 1.2Q0 2.3 0 4V7Q0 8.6 1.2 9.8Q2.3 11 4 11H7Q8.6 11 9.8 9.8Q11 8.6 11 7V4Q11 2.3 9.8 1.2Q8.6 0 7 0ZM9 7Q9 7.8 8.4 8.4Q7.8 9 7 9H4Q3.2 9 2.6 8.4Q2 7.8 2 7V4Q2 3.2 2.6 2.6Q3.2 2 4 2H7Q7.8 2 8.4 2.6Q9 3.2 9 4ZM20 0H17Q15.4 0 14.2 1.2Q13 2.3 13 4V7Q13 8.6 14.2 9.8Q15.4 11 17 11H20Q21.7 11 22.8 9.8Q24 8.6 24 7V4Q24 2.3 22.8 1.2Q21.7 0 20 0ZM22 7Q22 7.8 21.4 8.4Q20.8 9 20 9H17Q16.2 9 15.6 8.4Q15 7.8 15 7V4Q15 3.2 15.6 2.6Q16.2 2 17 2H20Q20.8 2 21.4 2.6Q22 3.2 22 4ZM7 13H4Q2.3 13 1.2 14.2Q0 15.4 0 17V20Q0 21.7 1.2 22.8Q2.3 24 4 24H7Q8.6 24 9.8 22.8Q11 21.7 11 20V17Q11 15.4 9.8 14.2Q8.6 13 7 13ZM9 20Q9 20.8 8.4 21.4Q7.8 22 7 22H4Q3.2 22 2.6 21.4Q2 20.8 2 20V17Q2 16.2 2.6 15.6Q3.2 15 4 15H7Q7.8 15 8.4 15.6Q9 16.2 9 17ZM20 13H17Q15.4 13 14.2 14.2Q13 15.4 13 17V20Q13 21.7 14.2 22.8Q15.4 24 17 24H20Q21.7 24 22.8 22.8Q24 21.7 24 20V17Q24 15.4 22.8 14.2Q21.7 13 20 13ZM22 20Q22 20.8 21.4 21.4Q20.8 22 20 22H17Q16.2 22 15.6 21.4Q15 20.8 15 20V17Q15 16.2 15.6 15.6Q16.2 15 17 15H20Q20.8 15 21.4 15.6Q22 16.2 22 17Z"/></svg>'),
  user: raw('<svg class="fi i-user" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12Q13.6 12 15 11.2Q16.4 10.4 17.2 9Q18 7.6 18 6Q18 4.4 17.2 3Q16.4 1.6 15 0.8Q13.6 0 12 0Q10.4 0 9 0.8Q7.6 1.6 6.8 3Q6 4.4 6 6Q6 7.6 6.8 9Q7.6 10.4 9 11.2Q10.4 12 12 12ZM12 2Q13.7 2 14.8 3.2Q16 4.3 16 6Q16 7.7 14.8 8.8Q13.7 10 12 10Q10.3 10 9.2 8.8Q8 7.7 8 6Q8 4.3 9.2 3.2Q10.3 2 12 2ZM12 14Q9.5 14 7.5 15.2Q5.4 16.4 4.2 18.5Q3 20.6 3 23Q3 23.4 3.3 23.7Q3.6 24 4 24Q4.4 24 4.7 23.7Q5 23.4 5 23Q5 21.1 6 19.5Q6.9 17.9 8.5 17Q10.1 16 12 16Q13.9 16 15.5 17Q17.1 17.9 18.1 19.5Q19 21.1 19 23Q19 23.4 19.3 23.7Q19.6 24 20 24Q20.4 24 20.7 23.7Q21 23.4 21 23Q21 20.6 19.8 18.5Q18.6 16.4 16.5 15.2Q14.5 14 12 14Z"/></svg>'),
  userAdd: raw('<svg class="fi i-userAdd" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 11H21V9Q21 8.6 20.7 8.3Q20.4 8 20 8Q19.6 8 19.3 8.3Q19 8.6 19 9V11H17Q16.6 11 16.3 11.3Q16 11.6 16 12Q16 12.4 16.3 12.7Q16.6 13 17 13H19V15Q19 15.4 19.3 15.7Q19.6 16 20 16Q20.4 16 20.7 15.7Q21 15.4 21 15V13H23Q23.4 13 23.7 12.7Q24 12.4 24 12Q24 11.6 23.7 11.3Q23.4 11 23 11ZM9 12Q10.6 12 12 11.2Q13.4 10.4 14.2 9Q15 7.6 15 6Q15 4.4 14.2 3Q13.4 1.6 12 0.8Q10.6 0 9 0Q7.4 0 6 0.8Q4.6 1.6 3.8 3Q3 4.4 3 6Q3 7.6 3.8 9Q4.6 10.4 6 11.2Q7.4 12 9 12ZM9 2Q10.6 2 11.8 3.2Q13 4.3 13 6Q13 7.7 11.8 8.8Q10.6 10 9 10Q7.4 10 6.2 8.8Q5 7.7 5 6Q5 4.3 6.2 3.2Q7.4 2 9 2ZM9 14Q6.6 14 4.5 15.2Q2.4 16.4 1.2 18.5Q0 20.6 0 23Q0 23.4 0.3 23.7Q0.6 24 1 24Q1.4 24 1.7 23.7Q2 23.4 2 23Q2 21.1 3 19.5Q3.9 17.9 5.5 17Q7.1 16 9 16Q10.9 16 12.5 17Q14.1 17.9 15 19.5Q16 21.1 16 23Q16 23.4 16.3 23.7Q16.6 24 17 24Q17.4 24 17.7 23.7Q18 23.4 18 23Q18 20.6 16.8 18.5Q15.6 16.4 13.5 15.2Q11.4 14 9 14Z"/></svg>'),
  power: raw('<svg class="fi i-power" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3.8Q15 4.2 15.2 4.4Q15.4 4.6 15.6 4.8Q18.2 5.9 19.6 8.2Q21.1 10.6 21 13.3Q21 15.8 19.7 17.8Q18.5 19.8 16.4 21Q14.3 22.2 11.9 22.1Q9.4 22.1 7.4 20.8Q5.3 19.6 4.1 17.5Q3 15.4 3 13Q3 10.3 4.5 8.1Q5.9 5.8 8.4 4.8Q8.6 4.6 8.8 4.4Q9 4.2 9 3.8H9Q9 3.3 8.6 3Q8.1 2.7 7.6 2.9Q5.3 3.9 3.6 5.9Q2 7.8 1.4 10.3Q0.7 12.7 1.2 15.2Q1.8 17.8 3.3 19.8Q4.9 21.8 7.2 22.9Q9.4 24 12 24Q14.6 24 16.8 22.9Q19.1 21.8 20.7 19.8Q22.2 17.8 22.8 15.2Q23.3 12.7 22.6 10.3Q22 7.8 20.4 5.9Q18.7 3.9 16.4 2.9Q15.9 2.7 15.4 3Q15 3.3 15 3.8ZM12 0Q12.4 0 12.7 0.3Q13 0.6 13 1V7Q13 7.4 12.7 7.7Q12.4 8 12 8Q11.6 8 11.3 7.7Q11 7.4 11 7V1Q11 0.6 11.3 0.3Q11.6 0 12 0Z"/></svg>'),
  fingerprint: raw('<svg class="fi i-fingerprint" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22.3Q5.6 22.3 5.4 22.1Q5.1 21.8 5 21.5Q4.9 21.2 5 20.9Q5.2 20.6 5.4 20.4Q7.1 19.4 7.9 17.7Q8.6 16.2 8.9 14.2Q9 13 9 11Q9 9.8 9.9 8.9Q10.7 8 12 8Q13.3 8 14.2 8.9Q15 9.8 15 11Q15 11.4 14.7 11.7Q14.4 12 14 12Q13.6 12 13.3 11.7Q13 11.4 13 11Q13 10.6 12.7 10.3Q12.4 10 12 10Q11.6 10 11.3 10.3Q11 10.6 11 11Q11 13.3 10.8 14.6Q10.6 17 9.7 18.7Q8.6 20.9 6.5 22.2Q6.2 22.3 6 22.3ZM11 23.7Q14.4 20.2 14.9 14.1Q15 13.7 14.7 13.4Q14.4 13 14 13Q13.6 13 13.3 13.2Q13 13.5 12.9 13.9Q12.5 19.4 9.5 22.3Q9.2 22.6 9.2 23Q9.2 23.4 9.5 23.7Q9.8 24 10.2 24Q10.6 24 11 23.7ZM16.2 23.5Q17 22 17.7 20.3Q17.8 19.9 17.6 19.6Q17.4 19.2 17 19.1Q16.6 19 16.3 19.1Q15.9 19.3 15.8 19.7Q15.2 21.1 14.4 22.5Q14.2 22.8 14.3 23.2Q14.4 23.7 14.8 23.9Q15.1 24.1 15.5 24Q15.9 23.8 16.2 23.5ZM18.5 17.2Q19 14.2 19 11Q19 8.8 17.8 7Q16.6 5.3 14.5 4.5Q12.5 3.7 10.4 4.2Q8.2 4.7 6.8 6.3Q6.4 6.8 6.6 7.4Q6.7 7.9 7.3 8Q7.9 8.1 8.2 7.7Q9.3 6.5 10.8 6.1Q12.3 5.8 13.8 6.3Q15.2 6.9 16.1 8.2Q17 9.4 17 11Q17 13.9 16.6 16.8Q16.5 17.2 16.7 17.6Q17 17.9 17.4 18H17.5Q17.8 18 18.1 17.8Q18.4 17.5 18.5 17.2ZM7 11Q7 10.6 7 10.2Q7.2 9.6 6.8 9.2Q6.3 8.8 5.8 9Q5.2 9.2 5.1 9.8Q5 10.4 5 11Q5 18 1 18Q0.6 18 0.3 18.3Q0 18.6 0 19Q0 19.4 0.3 19.7Q0.6 20 1 20Q3.9 20 5.5 17.7Q7 15.4 7 11ZM20.7 23.4Q23.2 17.4 23 11Q23 8.5 21.9 6.2Q21.7 5.8 21.3 5.7Q21 5.6 20.6 5.8Q20.2 5.9 20 6.3Q19.9 6.7 20.1 7.1Q21 9 21 11Q21.2 17 18.9 22.6Q18.7 23 18.9 23.4Q19 23.8 19.4 23.9Q19.6 24 19.8 24Q20.1 24 20.3 23.8Q20.6 23.7 20.7 23.4ZM3 14V11Q3 8.6 4.2 6.5Q5.4 4.4 7.5 3.2Q9.5 2 12 2Q15 2 17.4 3.8Q17.8 4.1 18.2 4Q18.6 3.9 18.8 3.6Q19 3.3 19 2.9Q19 2.5 18.6 2.2Q17.2 1.1 15.5 0.6Q13.8 0 12 0Q9 0 6.5 1.5Q4 3 2.5 5.5Q1 8 1 11V14Q1 14.4 1.3 14.7Q1.6 15 2 15Q2.4 15 2.7 14.7Q3 14.4 3 14Z"/></svg>'),
  music: raw('<svg class="fi i-music" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.6 1Q21.8 0.3 21 0.1Q20.2 -0.1 19.3 0.1L10.1 1.8Q8.3 2.2 7.2 3.5Q6 4.9 6 6.7V16.6Q5 16 4 16Q2.3 16 1.2 17.2Q0 18.3 0 20Q0 21.7 1.2 22.8Q2.3 24 4 24Q5.7 24 6.8 22.8Q8 21.7 8 20V10.9Q8 10.2 8.5 9.6Q9 9 9.6 8.9L20.8 6.8Q21.3 6.7 21.6 7Q22 7.4 22 7.8V13.5Q21 13 20 13Q18.3 13 17.2 14.2Q16 15.4 16 17Q16 18.6 17.2 19.8Q18.3 21 20 21Q21.7 21 22.8 19.8Q24 18.6 24 17V4Q24 3.1 23.6 2.3Q23.3 1.5 22.6 1ZM4 22Q3.2 22 2.6 21.4Q2 20.8 2 20Q2 19.2 2.6 18.6Q3.2 18 4 18Q4.8 18 5.4 18.6Q6 19.2 6 20Q6 20.8 5.4 21.4Q4.8 22 4 22ZM20.5 4.9 9.3 7Q8.6 7 8 7.4V6.7Q8 5.6 8.7 4.8Q9.4 3.9 10.5 3.8L19.6 2Q20.6 1.8 21.3 2.4Q22 3 22 4V5Q21.3 4.7 20.5 4.9ZM20 19Q19.2 19 18.6 18.4Q18 17.8 18 17Q18 16.2 18.6 15.6Q19.2 15 20 15Q20.8 15 21.4 15.6Q22 16.2 22 17Q22 17.8 21.4 18.4Q20.8 19 20 19Z"/></svg>'),
  // Drawn a little inside its box so it sits level with the text beside it.
  episode: raw('<svg class="fi i-episode" viewBox="-3.5 -3.5 31 31" aria-hidden="true"><path d="M20.5 8 11 1Q9.8 0.2 8.4 0Q7 -0.1 5.7 0.6Q4.5 1.2 3.8 2.4Q3 3.6 3 5V19Q3 20.4 3.8 21.6Q4.5 22.8 5.8 23.4Q7 24.1 8.4 24Q9.8 23.8 11 23L20.5 16Q21.4 15.4 22 14.3Q22.6 13.2 22.6 12Q22.6 10.8 22 9.7Q21.4 8.6 20.5 8ZM19.3 14.4 9.8 21.4Q9.1 21.9 8.2 22Q7.4 22.1 6.6 21.7Q5.9 21.3 5.5 20.6Q5 19.8 5 19V5Q5 4.2 5.4 3.4Q5.9 2.7 6.6 2.4Q7.3 2 8 2Q9 2 9.8 2.6L19.3 9.6Q19.9 10 20.2 10.6Q20.6 11.3 20.6 12Q20.6 12.7 20.2 13.4Q19.9 14 19.3 14.4Z"/></svg>'),
  sparkle: raw('<svg class="fi i-sparkle" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 24Q19.2 24 19 23.8Q18.7 23.7 18.6 23.4L17.8 21.3L15.6 20.4Q15.4 20.2 15.2 20Q15 19.8 15 19.4Q15 19.1 15.2 18.9Q15.4 18.6 15.7 18.5L17.8 17.7L18.6 15.6Q18.7 15.4 19 15.2Q19.2 15 19.5 15Q19.8 15 20.1 15.2Q20.3 15.4 20.4 15.6L21.3 17.8L23.4 18.6Q23.7 18.7 23.8 19Q24 19.2 24 19.5Q24 19.8 23.8 20.1Q23.7 20.3 23.4 20.4L21.3 21.3L20.4 23.4Q20.3 23.7 20.1 23.8Q19.8 24 19.5 24ZM10 21Q9.4 21 8.8 20.6Q8.2 20.2 8.1 19.6L6.5 14.6L1.4 12.9Q0.7 12.6 0.4 12.1Q0 11.5 0 10.9Q0 10.2 0.4 9.7Q0.8 9.2 1.4 9L6.5 7.4L8.2 2.4Q8.3 1.8 8.9 1.4Q9.4 1 10.1 1Q10.8 1 11.3 1.4Q11.8 1.8 12 2.4L13.5 7.4L18.6 9Q19.2 9.3 19.6 9.8Q20 10.3 20 11Q20 11.7 19.6 12.2Q19.2 12.7 18.6 13L13.5 14.6L11.9 19.6Q11.8 20.2 11.2 20.6Q10.6 21 10 21ZM10.1 3 8.2 8.6Q8 9 7.5 9.2L2 10.9L7.6 12.8Q8.1 13 8.2 13.4L10 19L11.8 13.4Q11.9 13 12.5 12.8L18 11L12.5 9.2Q11.9 9 11.8 8.6ZM18.3 12ZM20.5 7Q20.2 7 19.9 6.8Q19.6 6.6 19.5 6.2L19.2 4.8L17.8 4.4Q17.4 4.3 17.2 4Q17 3.8 17 3.4Q17 3.1 17.2 2.8Q17.4 2.6 17.8 2.5L19.2 2.2L19.5 0.7Q19.6 0.4 19.9 0.2Q20.2 0 20.5 0Q20.9 0 21.1 0.2Q21.4 0.4 21.4 0.7L21.8 2.2L23.3 2.6Q23.6 2.6 23.8 2.9Q24 3.1 24 3.5Q24 3.8 23.8 4.1Q23.6 4.4 23.3 4.5L21.8 4.8L21.4 6.2Q21.4 6.6 21.1 6.8Q20.9 7 20.5 7Z"/></svg>'),
  users: raw('<svg class="fi i-users" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 13Q5.6 13 4.3 11.7Q3 10.4 3 8.5Q3 6.6 4.3 5.3Q5.6 4 7.5 4Q9.4 4 10.7 5.3Q12 6.6 12 8.5Q12 10.4 10.7 11.7Q9.4 13 7.5 13ZM7.5 6Q6.5 6 5.8 6.7Q5 7.4 5 8.5Q5 9.5 5.8 10.3Q6.5 11 7.5 11Q8.6 11 9.3 10.2Q10 9.5 10 8.5Q10 7.4 9.3 6.7Q8.6 6 7.5 6ZM15 23V22.5Q15 20.5 14 18.8Q13 17 11.2 16Q9.5 15 7.5 15Q5.4 15 3.7 16Q2 17 1 18.8Q0 20.5 0 22.5V23Q0 23.4 0.3 23.7Q0.6 24 1 24Q1.4 24 1.7 23.7Q2 23.4 2 23V22.5Q2 21 2.7 19.8Q3.4 18.5 4.7 17.7Q6 17 7.5 17Q9 17 10.2 17.7Q11.5 18.5 12.2 19.8Q13 21 13 22.5V23Q13 23.4 13.3 23.7Q13.6 24 14 24Q14.4 24 14.7 23.7Q15 23.4 15 23ZM24 18Q24 15.9 22.9 14.2Q21.8 12.5 19.9 11.6Q18 10.8 15.9 11.1Q13.8 11.4 12.3 12.8Q11.9 13.2 12 13.8Q12.2 14.3 12.7 14.5Q13.2 14.6 13.7 14.2Q14.8 13.3 16.2 13Q17.7 12.8 19 13.4Q20.4 14 21.2 15.3Q22 16.6 22 18Q22 18.4 22.3 18.7Q22.6 19 23 19Q23.4 19 23.7 18.7Q24 18.4 24 18ZM17.5 9Q15.6 9 14.3 7.7Q13 6.4 13 4.5Q13 2.6 14.3 1.3Q15.6 0 17.5 0Q19.4 0 20.7 1.3Q22 2.6 22 4.5Q22 6.4 20.7 7.7Q19.4 9 17.5 9ZM17.5 2Q16.5 2 15.8 2.7Q15 3.4 15 4.5Q15 5.5 15.8 6.3Q16.5 7 17.5 7Q18.6 7 19.3 6.2Q20 5.5 20 4.5Q20 3.4 19.3 2.7Q18.6 2 17.5 2Z"/></svg>'),
  home: raw('<svg class="fi i-home" viewBox="0 0 24 24" aria-hidden="true"><path d="M23.1 9 15.5 1.5Q14.6 0.6 13.3 0.2Q12 -0.2 10.7 0.2Q9.4 0.6 8.5 1.5L0.9 9Q0 9.9 0 11.2V21Q0 22.2 0.9 23.1Q1.8 24 3 24H21Q22.2 24 23.1 23.1Q24 22.2 24 21V11.2Q24 9.9 23.1 9ZM15 22H9V18.1Q9 16.8 9.9 15.9Q10.7 15 12 15Q13.3 15 14.2 15.9Q15 16.8 15 18.1ZM22 21Q22 21.4 21.7 21.7Q21.4 22 21 22H17V18.1Q17 16.7 16.3 15.6Q15.7 14.4 14.5 13.7Q13.4 13 12 13Q10.6 13 9.5 13.7Q8.3 14.4 7.7 15.6Q7 16.7 7 18.1V22H3Q2.6 22 2.3 21.7Q2 21.4 2 21V11.2Q2 10.8 2.3 10.5L9.8 2.9Q10.7 2 12 2Q13.3 2 14.2 2.9L21.7 10.5Q22 10.8 22 11.2Z"/></svg>'),
  bell: raw('<svg class="fi i-bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.6 13.7 20.6 6.8Q20.1 4.8 18.7 3.2Q17.4 1.7 15.4 0.8Q13.5 -0.1 11.4 -0Q9.3 0.1 7.4 1Q5.6 1.9 4.3 3.6Q3 5.2 2.6 7.3L1.1 13.9Q0.9 15 1.1 16.2Q1.4 17.3 2.1 18.2Q2.8 19 3.8 19.5Q4.9 20 6 20H7.1Q7.4 21.8 8.8 22.9Q10.2 24 12 24Q13.8 24 15.2 22.9Q16.6 21.8 16.9 20H17.8Q18.9 20 20 19.5Q21 19 21.7 18Q22.4 17.1 22.6 16Q22.9 14.8 22.6 13.7ZM12 22Q11 22 10.3 21.4Q9.5 20.9 9.2 20H14.8Q14.5 20.9 13.7 21.4Q13 22 12 22ZM20.2 16.8Q19.7 17.4 19.1 17.7Q18.5 18 17.8 18H6Q5.3 18 4.7 17.7Q4.1 17.4 3.6 16.9Q3.2 16.3 3 15.7Q2.9 15 3 14.3L4.6 7.8Q5 5.3 7 3.7Q9 2.1 11.5 2Q14 1.9 16 3.4Q18.1 5 18.7 7.4L20.6 14.2Q20.8 14.9 20.7 15.6Q20.6 16.2 20.2 16.8Z"/></svg>'),
  compass: raw('<svg class="fi i-compass" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.1V1Q13 0.6 12.7 0.3Q12.4 0 12 0Q11.6 0 11.3 0.3Q11 0.6 11 1V2.1Q8.2 2.3 6 3.8Q3.7 5.4 2.3 7.8Q1 10.2 1 13.1Q1 16 2.5 18.5Q4 21 6.5 22.5Q9 24 12 24Q15 24 17.5 22.5Q20 21 21.5 18.5Q23 16 23 13.1Q23 10.2 21.7 7.8Q20.3 5.4 18 3.8Q15.8 2.3 13 2.1ZM13 21.9V21Q13 20.6 12.7 20.3Q12.4 20 12 20Q11.6 20 11.3 20.3Q11 20.6 11 21V21.9Q9 21.7 7.2 20.6Q5.5 19.5 4.4 17.8Q3.3 16.1 3 14H4Q4.4 14 4.7 13.7Q5 13.4 5 13Q5 12.6 4.7 12.3Q4.4 12 4 12H3Q3.3 9.9 4.4 8.2Q5.5 6.5 7.2 5.4Q9 4.3 11 4.1V5Q11 5.4 11.3 5.7Q11.6 6 12 6Q12.4 6 12.7 5.7Q13 5.4 13 5V4.1Q15 4.3 16.8 5.4Q18.5 6.5 19.6 8.2Q20.7 9.9 21 12H20Q19.6 12 19.3 12.3Q19 12.6 19 13Q19 13.4 19.3 13.7Q19.6 14 20 14H21Q20.7 16.1 19.6 17.8Q18.5 19.5 16.8 20.6Q15 21.7 13 21.9ZM15.4 11.7Q15 11 14.5 10.4Q14 9.9 13.4 9.7L7.8 7.6Q7.6 7.4 7.3 7.5Q7 7.6 6.8 7.8Q6.6 8 6.5 8.3Q6.5 8.6 6.6 8.9L8.6 14.3Q9 15 9.5 15.6Q10 16.1 10.6 16.3L16.2 18.4Q16.3 18.5 16.5 18.5Q16.9 18.5 17.2 18.2Q17.4 18 17.5 17.7Q17.5 17.4 17.4 17.1ZM11.4 14.5Q10.8 14.2 10.6 13.6L9.3 10.2L12.6 11.5Q13.2 11.8 13.4 12.4L14.7 15.8Z"/></svg>'),
  refresh: raw('<svg class="fi i-refresh" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2Q14 2 15.8 2.8Q17.7 3.6 19.1 5H16Q15.6 5 15.3 5.3Q15 5.6 15 6H15Q15 6.4 15.3 6.7Q15.6 7 16 7H20.2Q20.9 7 21.4 6.4Q22 5.9 22 5.1V1Q22 0.6 21.7 0.3Q21.4 0 21 0Q20.6 0 20.3 0.3Q20 0.6 20 1V3Q17.4 0.8 14.1 0.2Q10.8 -0.4 7.6 0.8Q4.5 2.1 2.4 4.8Q0.3 7.5 0.1 10.9Q0 11.4 0.3 11.7Q0.6 12 1 12Q1.4 12 1.7 11.8Q2 11.5 2 11.1Q2.2 8.6 3.6 6.5Q5 4.4 7.2 3.2Q9.4 2 12 2ZM23 12Q22.6 12 22.3 12.2Q22 12.5 22 12.9Q21.7 15.8 19.9 18.1Q18.2 20.4 15.4 21.4Q12.6 22.4 9.8 21.8Q7 21.1 4.9 19H8Q8.4 19 8.7 18.7Q9 18.4 9 18H9Q9 17.6 8.7 17.3Q8.4 17 8 17H3.8Q3.1 17 2.6 17.5Q2 18.1 2 18.9V23Q2 23.4 2.3 23.7Q2.6 24 3 24H3Q3.4 24 3.7 23.7Q4 23.4 4 23V21Q6.6 23.2 9.9 23.8Q13.2 24.4 16.4 23.2Q19.5 21.9 21.6 19.2Q23.7 16.5 23.9 13.1Q24 12.6 23.7 12.3Q23.4 12 23 12Z"/></svg>'),
  plus: raw('<svg class="fi i-plus" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 11H13V1Q13 0.6 12.7 0.3Q12.4 0 12 0Q11.6 0 11.3 0.3Q11 0.6 11 1V11H1Q0.6 11 0.3 11.3Q0 11.6 0 12Q0 12.4 0.3 12.7Q0.6 13 1 13H11V23Q11 23.4 11.3 23.7Q11.6 24 12 24Q12.4 24 12.7 23.7Q13 23.4 13 23V13H23Q23.4 13 23.7 12.7Q24 12.4 24 12Q24 11.6 23.7 11.3Q23.4 11 23 11Z"/></svg>'),
  sparkles: raw('<svg class="fi i-sparkles" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 24Q19.2 24 19 23.8Q18.7 23.7 18.6 23.4L17.8 21.3L15.6 20.4Q15.4 20.2 15.2 20Q15 19.8 15 19.4Q15 19.1 15.2 18.9Q15.4 18.6 15.7 18.5L17.8 17.7L18.6 15.6Q18.7 15.4 19 15.2Q19.2 15 19.5 15Q19.8 15 20.1 15.2Q20.3 15.4 20.4 15.6L21.3 17.8L23.4 18.6Q23.7 18.7 23.8 19Q24 19.2 24 19.5Q24 19.8 23.8 20.1Q23.7 20.3 23.4 20.4L21.3 21.3L20.4 23.4Q20.3 23.7 20.1 23.8Q19.8 24 19.5 24ZM10 21Q9.4 21 8.8 20.6Q8.2 20.2 8.1 19.6L6.5 14.6L1.4 12.9Q0.7 12.6 0.4 12.1Q0 11.5 0 10.9Q0 10.2 0.4 9.7Q0.8 9.2 1.4 9L6.5 7.4L8.2 2.4Q8.3 1.8 8.9 1.4Q9.4 1 10.1 1Q10.8 1 11.3 1.4Q11.8 1.8 12 2.4L13.5 7.4L18.6 9Q19.2 9.3 19.6 9.8Q20 10.3 20 11Q20 11.7 19.6 12.2Q19.2 12.7 18.6 13L13.5 14.6L11.9 19.6Q11.8 20.2 11.2 20.6Q10.6 21 10 21ZM10.1 3 8.2 8.6Q8 9 7.5 9.2L2 10.9L7.6 12.8Q8.1 13 8.2 13.4L10 19L11.8 13.4Q11.9 13 12.5 12.8L18 11L12.5 9.2Q11.9 9 11.8 8.6ZM18.3 12ZM20.5 7Q20.2 7 19.9 6.8Q19.6 6.6 19.5 6.2L19.2 4.8L17.8 4.4Q17.4 4.3 17.2 4Q17 3.8 17 3.4Q17 3.1 17.2 2.8Q17.4 2.6 17.8 2.5L19.2 2.2L19.5 0.7Q19.6 0.4 19.9 0.2Q20.2 0 20.5 0Q20.9 0 21.1 0.2Q21.4 0.4 21.4 0.7L21.8 2.2L23.3 2.6Q23.6 2.6 23.8 2.9Q24 3.1 24 3.5Q24 3.8 23.8 4.1Q23.6 4.4 23.3 4.5L21.8 4.8L21.4 6.2Q21.4 6.6 21.1 6.8Q20.9 7 20.5 7Z"/></svg>'),
  layout: raw('<svg class="fi i-layout" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 11H13Q13.8 11 14.4 10.4Q15 9.8 15 9V2Q15 1.2 14.4 0.6Q13.8 0 13 0H2Q1.2 0 0.6 0.6Q0 1.2 0 2V9Q0 9.8 0.6 10.4Q1.2 11 2 11ZM2 2H13V9H2ZM22 0H19Q18.2 0 17.6 0.6Q17 1.2 17 2V9Q17 9.8 17.6 10.4Q18.2 11 19 11H22Q22.8 11 23.4 10.4Q24 9.8 24 9V2Q24 1.2 23.4 0.6Q22.8 0 22 0ZM22 9H19V2H22ZM5 13H2Q1.2 13 0.6 13.6Q0 14.2 0 15V22Q0 22.8 0.6 23.4Q1.2 24 2 24H5Q5.8 24 6.4 23.4Q7 22.8 7 22V15Q7 14.2 6.4 13.6Q5.8 13 5 13ZM5 22H2V15H5ZM22 13H11Q10.2 13 9.6 13.6Q9 14.2 9 15V22Q9 22.8 9.6 23.4Q10.2 24 11 24H22Q22.8 24 23.4 23.4Q24 22.8 24 22V15Q24 14.2 23.4 13.6Q22.8 13 22 13ZM22 22H11V15H22Z"/></svg>'),
  mask: raw('<svg class="fi i-mask" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4 1.4Q19 0.6 16.6 0.2Q14.2 -0.1 11.5 0.1Q10.2 0.2 9.2 1.1Q8.2 2 7.9 3.3L7.7 5.3H7.4Q5 5.6 2.6 6.5Q1.3 7 0.6 8.1Q-0.2 9.3 0 10.6L1 17.5Q1.4 19.7 4 21.5Q5.8 22.8 8.5 23.8Q9 24 9.7 24Q10.8 24 11.7 23.4Q15 21 16.3 18.6L16.4 18.4Q18.9 17.4 20.5 16.1Q22.6 14.4 23 12.4L24 5.6Q24.2 4.2 23.4 3.1Q22.7 1.9 21.4 1.4ZM10.6 21.8Q9.9 22.2 9.1 21.9Q6.5 20.9 4.8 19.6Q3.2 18.4 3 17.2L2 10.3Q1.9 9.7 2.3 9.2Q2.6 8.6 3.2 8.4Q5.4 7.7 7.4 7.4L7 10.2Q6.9 10.5 6.9 10.8Q6.4 10.5 5.9 10.6Q5.4 10.6 5 11.1Q4.6 11.5 4.4 12.2Q4.4 12.5 4.6 12.6Q4.7 12.8 5 12.8L7.2 12.5Q7.6 13.4 8.3 14.5Q7.4 14.8 6.6 15.6Q5.9 16.5 5.6 17.5Q5.5 17.8 5.8 18.1Q6.1 18.3 6.4 18.1Q8.3 16.8 10.3 16.6Q11.2 17.4 12.2 18.2Q12.9 18.7 13.7 18.9Q12.5 20.3 10.5 21.8ZM22 5.3 21 12.2Q20.8 13.4 19.2 14.6Q17.5 15.8 14.9 16.9Q14.1 17.1 13.4 16.6Q11.1 15 9.9 13.3Q8.7 11.7 8.9 10.5L9.9 3.6Q10 3 10.5 2.5Q11 2.1 11.7 2.1L13.2 2Q14.8 2 16.2 2.2Q18.5 2.5 20.8 3.4Q21.4 3.5 21.7 4.1Q22.1 4.6 22 5.3ZM18.6 11.4Q17.8 12.3 16.7 12.8Q15.7 13.3 14.5 13.1Q13.4 13 12.5 12.2Q11.6 11.4 11.2 10.3Q11 9.9 11.4 9.7Q11.7 9.4 12 9.7Q13.5 10.5 14.9 10.7Q16.2 10.9 18 10.5Q18.3 10.4 18.5 10.7Q18.7 11 18.6 11.4ZM19.4 7.3Q19.4 7.5 19.3 7.7Q19.1 7.8 18.9 7.8L16.5 7.5Q16.2 7.4 16.1 7.2Q16 7 16.1 6.8Q16.5 6.2 17 5.9Q17.4 5.5 18 5.6Q18.5 5.7 18.9 6.2Q19.3 6.6 19.4 7.3ZM11.4 6.2Q11.8 5.5 12.3 5.2Q12.8 4.9 13.3 5Q13.8 5 14.2 5.5Q14.6 5.9 14.7 6.6Q14.8 6.9 14.6 7Q14.5 7.2 14.2 7.2L11.8 6.8Q11.5 6.8 11.4 6.6Q11.4 6.4 11.4 6.2Z"/></svg>'),
  gear: raw('<svg class="fi i-gear" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8Q10.3 8 9.2 9.2Q8 10.3 8 12Q8 13.7 9.2 14.8Q10.3 16 12 16Q13.7 16 14.8 14.8Q16 13.7 16 12Q16 10.3 14.8 9.2Q13.7 8 12 8ZM12 14Q11.2 14 10.6 13.4Q10 12.8 10 12Q10 11.2 10.6 10.6Q11.2 10 12 10Q12.8 10 13.4 10.6Q14 11.2 14 12Q14 12.8 13.4 13.4Q12.8 14 12 14ZM21.3 13.9 20.9 13.7Q21.1 12 20.9 10.3L21.3 10.1Q22 9.7 22.4 9Q22.8 8.3 22.8 7.5Q22.8 6.7 22.4 6Q22 5.3 21.3 4.9Q20.6 4.5 19.8 4.5Q19 4.5 18.3 4.9L17.8 5.1Q16.6 4.1 15 3.5V3Q15 1.8 14.2 0.9Q13.3 0 12 0Q10.7 0 9.8 0.9Q9 1.8 9 3V3.5Q7.4 4.1 6.2 5.1L5.7 4.9Q4.6 4.2 3.4 4.6Q2.2 5 1.6 6Q1 7 1.3 8.2Q1.6 9.4 2.7 10.1L3.1 10.3Q2.9 12 3.1 13.7L2.7 13.9Q1.6 14.6 1.3 15.8Q1 17 1.6 18Q2.2 19 3.4 19.4Q4.6 19.8 5.7 19.1L6.2 18.9Q7.4 19.9 9 20.5V21Q9 22.2 9.9 23.1Q10.7 24 12 24Q13.3 24 14.1 23.1Q15 22.2 15 21V20.5Q16.6 19.9 17.8 18.9L18.3 19.1Q19.4 19.8 20.6 19.4Q21.8 19 22.4 18Q23 17 22.7 15.8Q22.4 14.6 21.3 13.9ZM18.7 10.2Q19.3 12 18.7 13.8Q18.6 14.2 18.8 14.5Q18.9 14.8 19.2 15L20.3 15.6Q20.6 15.8 20.8 16.2Q20.9 16.6 20.7 17Q20.5 17.4 20.1 17.5Q19.7 17.6 19.3 17.4L18.2 16.7Q17.9 16.6 17.6 16.6Q17.2 16.6 17 16.9Q15.6 18.3 13.8 18.8Q13.4 18.9 13.2 19.2Q13 19.4 13 19.8V21Q13 21.4 12.7 21.7Q12.4 22 12 22Q11.6 22 11.3 21.7Q11 21.4 11 21V19.8Q11 19.4 10.8 19.2Q10.6 18.9 10.2 18.8Q8.4 18.3 7 16.9Q6.8 16.6 6.4 16.6Q6.1 16.6 5.8 16.7L4.7 17.4Q4.2 17.7 3.7 17.4Q3.2 17 3.2 16.5Q3.2 15.9 3.7 15.6L4.8 15Q5.1 14.8 5.2 14.5Q5.4 14.2 5.3 13.8Q4.7 12 5.3 10.2Q5.4 9.8 5.2 9.5Q5.1 9.2 4.8 9L3.7 8.4Q3.2 8.1 3.2 7.5Q3.2 7 3.7 6.6Q4.2 6.3 4.7 6.6L5.8 7.3Q6.1 7.4 6.4 7.4Q6.8 7.4 7 7.1Q8.4 5.7 10.2 5.2Q10.6 5.1 10.8 4.8Q11 4.6 11 4.2V3Q11 2.6 11.3 2.3Q11.6 2 12 2Q12.4 2 12.7 2.3Q13 2.6 13 3V4.2Q13 4.6 13.2 4.8Q13.4 5.1 13.8 5.2Q15.6 5.7 17 7.1Q17.2 7.4 17.6 7.4Q17.9 7.4 18.2 7.3L19.3 6.6Q19.8 6.3 20.3 6.6Q20.8 7 20.8 7.5Q20.8 8.1 20.3 8.4L19.2 9Q18.9 9.2 18.8 9.5Q18.6 9.8 18.7 10.2Z"/></svg>'),
  shield: raw('<svg class="fi i-shield" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.6 2.2 12.3 0.1Q12 -0.1 11.7 0.1L5.4 2.2Q3.9 2.6 3 4Q2 5.3 2 6.9V12Q2 15.4 4.4 18.4Q6.2 20.6 9 22.4Q10.4 23.4 11.6 23.9Q12 24.1 12.4 23.9Q13.6 23.4 15 22.4Q17.8 20.6 19.6 18.4Q22 15.4 22 12V6.9Q22 5.3 21 4Q20.1 2.6 18.6 2.2ZM20 12Q20 14.5 18.3 16.8Q17 18.6 14.8 20.2Q13.4 21.1 12 21.9Q10.6 21.1 9.2 20.2Q7 18.6 5.7 16.8Q4 14.5 4 12V6.9Q4 5.9 4.6 5.1Q5.1 4.3 6.1 4L12 2.1L17.9 4Q18.9 4.3 19.4 5.1Q20 5.9 20 6.9Z"/></svg>'),
  send: raw('<svg class="fi i-send" viewBox="0 0 24 24" aria-hidden="true"><path d="M23.1 0.9Q22.6 0.3 21.8 0.1Q21 -0.1 20.3 0.1L4.3 3.4Q2.9 3.7 1.8 4.6Q0.7 5.4 0.3 6.8Q-0.2 8.2 0.2 9.6Q0.5 11 1.4 11.9L3.2 13.7Q3.4 13.9 3.4 14.3V17.5Q3.5 18.2 3.8 18.8V18.9Q4.2 19.8 5.1 20.2L5.2 20.2Q5.8 20.5 6.5 20.5H9.7Q10.1 20.5 10.3 20.8L12.1 22.6Q12.8 23.2 13.7 23.6Q14.6 24 15.5 24Q16.4 24 17.2 23.8Q18.6 23.3 19.4 22.2Q20.3 21.1 20.6 19.8L23.9 3.7Q24.1 3 23.9 2.2Q23.7 1.4 23.1 0.9ZM4.6 12.2 2.9 10.6Q2.2 9.9 2 9.1Q1.8 8.2 2.1 7.4Q2.4 6.6 3.1 6.1Q3.8 5.5 4.6 5.4L20.5 2.1L5.4 17.1V14.3Q5.4 13.1 4.6 12.2ZM18.6 19.4Q18.5 20.2 17.9 20.9Q17.4 21.6 16.6 21.8Q15.8 22.1 14.9 21.9Q14.1 21.8 13.5 21.1L11.8 19.4Q10.9 18.5 9.7 18.6H6.9L21.9 3.5Z"/></svg>'),
  warn: raw('<svg class="fi i-warn" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 13V7Q11 6.6 11.3 6.3Q11.6 6 12 6Q12.4 6 12.7 6.3Q13 6.6 13 7V13Q13 13.4 12.7 13.7Q12.4 14 12 14Q11.6 14 11.3 13.7Q11 13.4 11 13ZM12 15Q11.4 15 10.9 15.4Q10.5 15.8 10.5 16.5Q10.5 17.1 10.9 17.6Q11.4 18 12 18Q12.6 18 13.1 17.6Q13.5 17.1 13.5 16.5Q13.5 15.8 13.1 15.4Q12.6 15 12 15ZM23.6 19.8Q23 20.9 22 21.4Q21 22 19.6 22H4.5Q3 22 2 21.4Q1 20.9 0.4 19.9Q-0.1 18.9 0 17.6Q0.2 16.4 1 15.3L9 2.6Q9.5 1.8 10.3 1.4Q11.1 1 12 1Q12.9 1 13.7 1.4Q14.5 1.8 15 2.6L23.1 15.4Q23.8 16.4 24 17.6Q24.1 18.9 23.6 19.8ZM21.4 16.5Q21.4 16.4 21.4 16.4L13.4 3.7Q12.9 3 12 3Q11.1 3 10.6 3.7L2.6 16.4Q2.2 17 2 17.7Q1.9 18.4 2.2 19Q2.7 20 4.4 20H19.5Q21.3 20 21.8 19Q22.1 18.4 22 17.8Q21.8 17.1 21.4 16.5Z"/></svg>'),
  more: raw('<svg class="fi i-more" viewBox="0 0 24 24" aria-hidden="true"><path d="M0 12Q0 12.8 0.6 13.4Q1.2 14 2 14Q2.8 14 3.4 13.4Q4 12.8 4 12Q4 11.2 3.4 10.6Q2.8 10 2 10Q1.2 10 0.6 10.6Q0 11.2 0 12ZM10 12Q10 12.8 10.6 13.4Q11.2 14 12 14Q12.8 14 13.4 13.4Q14 12.8 14 12Q14 11.2 13.4 10.6Q12.8 10 12 10Q11.2 10 10.6 10.6Q10 11.2 10 12ZM20 12Q20 12.8 20.6 13.4Q21.2 14 22 14Q22.8 14 23.4 13.4Q24 12.8 24 12Q24 11.2 23.4 10.6Q22.8 10 22 10Q21.2 10 20.6 10.6Q20 11.2 20 12Z"/></svg>'),
  hash: raw('<svg class="fi i-hash" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7H18.2L19 1.1Q19 0.7 18.8 0.4Q18.6 0.1 18.2 -0Q17.8 -0.1 17.4 0.2Q17 0.5 17 0.9L16.2 7H9.2L10 1.1Q10.1 0.6 9.6 0.2Q9.1 -0.2 8.6 0.1Q8.1 0.3 8 0.9L7.2 7H2Q1.6 7 1.3 7.3Q1 7.6 1 8Q1 8.4 1.3 8.7Q1.6 9 2 9H6.9L6.1 15H1Q0.6 15 0.3 15.3Q0 15.6 0 16Q0 16.4 0.3 16.7Q0.6 17 1 17H5.8L5 22.9Q5 23.3 5.2 23.6Q5.4 23.9 5.8 24Q6.2 24.1 6.6 23.8Q7 23.5 7 23.1L7.8 17H14.8L14 22.9Q13.9 23.3 14.2 23.6Q14.5 23.9 14.9 24Q15.3 24.1 15.6 23.8Q15.9 23.5 16 23.1L16.8 17H22Q22.4 17 22.7 16.7Q23 16.4 23 16Q23 15.6 22.7 15.3Q22.4 15 22 15H17.1L17.9 9H23Q23.4 9 23.7 8.7Q24 8.4 24 8Q24 7.6 23.7 7.3Q23.4 7 23 7ZM15.1 15H8.1L8.9 9H15.9Z"/></svg>'),
  chevron: raw('<svg class="fi i-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.7 8.2Q18.4 7.9 18 7.9Q17.6 7.9 17.3 8.2L12.7 12.8Q12.4 13.1 12 13.1Q11.6 13.1 11.3 12.8L6.7 8.2Q6.4 7.9 6 7.9Q5.6 7.9 5.3 8.2Q5 8.5 5 8.9Q5 9.4 5.3 9.6L9.9 14.2Q10.7 15.1 12 15.1Q13.3 15.1 14.2 14.2L18.7 9.6Q19 9.4 19 8.9Q19 8.5 18.7 8.2Z"/></svg>'),
  back: raw('<svg class="fi i-back" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 12.7Q10.3 12.4 10.3 12Q10.3 11.6 10.6 11.3L15.2 6.7Q15.5 6.4 15.5 6Q15.5 5.6 15.2 5.3Q14.9 5 14.5 5Q14.1 5 13.8 5.3L9.2 9.8Q8.3 10.7 8.3 12Q8.3 13.3 9.2 14.2L13.8 18.7Q14.1 19 14.5 19Q14.9 19 15.2 18.7Q15.5 18.4 15.5 18Q15.5 17.6 15.2 17.3Z"/></svg>'),
  sun: raw('<svg class="fi i-sun" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 11H19Q18.8 10.2 18.5 9.4L22 7.4Q22.6 7 22.6 6.5Q22.6 5.9 22 5.6Q21.5 5.3 21 5.6L17.5 7.7Q17 7 16.3 6.5L18.4 3Q18.6 2.6 18.4 2.2Q18.3 1.8 18 1.6Q17.7 1.4 17.3 1.5Q16.9 1.6 16.6 2L14.6 5.5Q13.8 5.2 13 5V1Q13 0.6 12.7 0.3Q12.4 0 12 0Q11.6 0 11.3 0.3Q11 0.6 11 1V5Q10.2 5.2 9.4 5.5L7.4 2Q7.1 1.6 6.7 1.5Q6.3 1.4 6 1.6Q5.7 1.8 5.6 2.2Q5.4 2.6 5.6 3L7.7 6.5Q7 7 6.5 7.7L3 5.6Q2.5 5.3 2 5.6Q1.4 5.9 1.4 6.5Q1.4 7 2 7.4L5.5 9.4Q5.2 10.2 5 11H1Q0.6 11 0.3 11.3Q0 11.6 0 12Q0 12.4 0.3 12.7Q0.6 13 1 13H5.1Q5.2 13.8 5.5 14.6L2 16.6Q1.4 17 1.4 17.5Q1.4 18.1 2 18.4Q2.5 18.7 3 18.4L6.5 16.3Q7 17 7.7 17.5L5.6 21Q5.4 21.4 5.6 21.8Q5.7 22.2 6 22.4Q6.3 22.6 6.7 22.5Q7.1 22.4 7.4 22L9.4 18.5Q10.2 18.8 11 19V23Q11 23.4 11.3 23.7Q11.6 24 12 24Q12.4 24 12.7 23.7Q13 23.4 13 23V18.9Q13.8 18.8 14.6 18.5L16.6 22Q16.9 22.4 17.3 22.5Q17.7 22.6 18 22.4Q18.3 22.2 18.4 21.8Q18.6 21.4 18.4 21L16.3 17.5Q17 17 17.5 16.3L21 18.4Q21.5 18.7 22 18.4Q22.6 18.1 22.6 17.5Q22.6 17 22 16.6L18.5 14.6Q18.8 13.8 19 13H23Q23.4 13 23.7 12.7Q24 12.4 24 12Q24 11.6 23.7 11.3Q23.4 11 23 11ZM12 17Q9.7 17 8.3 15.4Q7 14 7 12Q7 10 8.3 8.6Q9.7 7 12 7Q14.3 7 15.7 8.6Q17 10 17 12Q17 14 15.7 15.4Q14.3 17 12 17Z"/></svg>'),
  moon: raw('<svg class="fi i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 24Q12.5 24 10.1 23Q7.8 21.9 6.1 20Q4.4 18.2 3.6 15.7Q2.8 13.3 3.1 10.7Q3.4 8.1 4.7 5.8Q6.1 3.6 8.3 2.1Q10.5 0.6 13 0.2Q15.6 -0.2 18.1 0.3Q18.8 0.6 19.3 1Q19.8 1.5 19.9 2.2Q20.1 2.8 19.9 3.4Q19.7 4.1 19.2 4.6Q17 6.6 16.3 9.3Q15.7 11.9 16.6 14.5Q17.6 17.1 20 19Q20.6 19.4 20.8 20.1Q21 20.7 21 21.4Q20.9 22 20.4 22.6Q20 23.1 19.4 23.3Q17.2 24 15 24ZM15 2Q14.2 2 13.4 2.2Q11.2 2.5 9.4 3.7Q7.6 5 6.4 6.8Q5.3 8.7 5 10.9Q4.8 13 5.5 15.1Q6.2 17.1 7.6 18.7Q9.7 21 12.7 21.7Q15.8 22.5 18.6 21.4Q19 21.4 19 21Q19 20.7 18.8 20.6Q15.9 18.4 14.8 15.2Q13.6 12.1 14.4 8.8Q15.2 5.5 17.8 3.1Q18.1 3 18 2.7Q17.9 2.4 17.6 2.3Q16.4 2 15 2Z"/></svg>'),
  sliders: raw('<svg class="fi i-sliders" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 4.7H3.8Q4.1 6 5.1 6.8Q6.1 7.5 7.3 7.5Q8.6 7.5 9.6 6.8Q10.6 6 11 4.7H23Q23.4 4.7 23.7 4.4Q24 4.2 24 3.8Q24 3.4 23.7 3Q23.4 2.7 23 2.7H11Q10.6 1.5 9.6 0.8Q8.6 0 7.3 0Q6.1 0 5.1 0.8Q4.1 1.5 3.8 2.7H1Q0.6 2.7 0.3 3Q0 3.4 0 3.8Q0 4.2 0.3 4.4Q0.6 4.7 1 4.7ZM7.4 2Q8.1 2 8.6 2.5Q9.1 3 9.1 3.8Q9.1 4.5 8.6 5Q8.1 5.5 7.4 5.5Q6.6 5.5 6.1 5Q5.6 4.5 5.6 3.8Q5.6 3 6.1 2.5Q6.6 2 7.4 2ZM23 11H20.2Q19.9 9.8 18.9 9Q17.9 8.2 16.7 8.2Q15.4 8.2 14.4 9Q13.4 9.8 13 11H1Q0.6 11 0.3 11.3Q0 11.6 0 12Q0 12.4 0.3 12.7Q0.6 13 1 13H13Q13.4 14.2 14.4 15Q15.4 15.8 16.7 15.8Q17.9 15.8 18.9 15Q19.9 14.2 20.2 13H23Q23.4 13 23.7 12.7Q24 12.4 24 12Q24 11.6 23.7 11.3Q23.4 11 23 11ZM16.6 13.8Q15.9 13.8 15.4 13.2Q14.9 12.7 14.9 12Q14.9 11.3 15.4 10.8Q15.9 10.2 16.6 10.2Q17.4 10.2 17.9 10.8Q18.4 11.3 18.4 12Q18.4 12.7 17.9 13.2Q17.4 13.8 16.6 13.8ZM23 19.3H11Q10.6 18 9.6 17.2Q8.6 16.5 7.3 16.5Q6.1 16.5 5.1 17.2Q4.1 18 3.8 19.3H1Q0.6 19.3 0.3 19.6Q0 19.8 0 20.2Q0 20.6 0.3 21Q0.6 21.3 1 21.3H3.8Q4.1 22.5 5.1 23.2Q6.1 24 7.3 24Q8.6 24 9.6 23.2Q10.6 22.5 11 21.3H23Q23.4 21.3 23.7 21Q24 20.6 24 20.2Q24 19.8 23.7 19.6Q23.4 19.3 23 19.3ZM7.4 22Q6.6 22 6.1 21.5Q5.6 21 5.6 20.2Q5.6 19.5 6.1 19Q6.6 18.5 7.4 18.5Q8.1 18.5 8.6 19Q9.1 19.5 9.1 20.2Q9.1 21 8.6 21.5Q8.1 22 7.4 22Z"/></svg>'),
  logout: raw('<svg class="fi i-logout" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.4 15Q11 15 10.8 15.3Q10.5 15.6 10.5 16V19Q10.5 20.2 9.6 21.1Q8.7 22 7.4 22H5Q3.8 22 2.9 21.1Q2 20.2 2 19V5Q2 3.8 2.9 2.9Q3.8 2 5 2H7.4Q8.7 2 9.6 2.9Q10.5 3.8 10.5 5V8Q10.5 8.4 10.8 8.7Q11 9 11.5 9Q11.9 9 12.2 8.7Q12.5 8.4 12.5 8V5Q12.5 3.7 11.8 2.5Q11.1 1.4 10 0.7Q8.8 0 7.4 0H5Q3.7 0 2.5 0.7Q1.4 1.4 0.7 2.5Q0 3.7 0 5V19Q0 20.3 0.7 21.5Q1.4 22.6 2.5 23.3Q3.7 24 5 24H7.4Q8.8 24 10 23.3Q11.1 22.6 11.8 21.5Q12.5 20.3 12.5 19V16Q12.5 15.6 12.2 15.3Q11.9 15 11.4 15ZM22.9 9.8 18.3 5.3Q17.8 4.9 17.3 5Q16.7 5.2 16.6 5.8Q16.5 6.3 16.9 6.7L21.1 11H6Q5.6 11 5.3 11.3Q5 11.6 5 12Q5 12.4 5.3 12.7Q5.6 13 6 13L21.2 13L16.9 17.3Q16.5 17.7 16.6 18.2Q16.7 18.8 17.3 19Q17.8 19.1 18.2 18.7L22.9 14.2Q23.8 13.3 23.8 12Q23.8 10.7 22.9 9.8Z"/></svg>'),
  quill: raw('<svg class="fi i-quill" viewBox="0 0 24 24" aria-hidden="true"><path d="M23.7 7.3Q23.4 7 23 7Q22.6 7 22.3 7.3L20 9.6L14.4 4L16.7 1.7Q17 1.4 17 1Q17 0.6 16.7 0.3Q16.4 0 16 0Q15.6 0 15.3 0.3L12.5 3.1L6.6 5.3Q5.4 5.8 4.6 6.6Q3.8 7.4 3.5 8.6L0.1 20.6Q-0.1 21.3 0.1 22Q0.2 22.7 0.8 23.2Q1.6 24 2.7 24Q3.1 24 3.4 23.9L15.4 20.5Q16.5 20.2 17.4 19.4Q18.2 18.6 18.6 17.4L20.9 11.5L23.7 8.7Q24 8.4 24 8Q24 7.6 23.7 7.3ZM16.8 16.7Q16.6 17.4 16 17.9Q15.4 18.4 14.8 18.6L3.7 21.8L9.5 15.9Q9.8 16 10 16Q10.8 16 11.4 15.4Q12 14.8 12 14Q12 13.2 11.4 12.6Q10.8 12 10 12Q9.2 12 8.6 12.6Q8 13.2 8 14Q8 14.2 8.1 14.5L2.2 20.3L5.4 9.2Q5.6 8.5 6.1 8Q6.6 7.4 7.3 7.2L12.7 5.2L18.8 11.3Z"/></svg>'),
  chat: raw('<svg class="fi i-chat" viewBox="0 0 24 24" aria-hidden="true"><path d="M24 11.3Q23.8 8 22.1 5.4Q20.3 2.8 17.5 1.3Q14.7 -0.2 11.5 -0Q8.3 0.1 5.6 1.8Q3 3.5 1.4 6.3Q-0.1 9 0 12.2Q0.1 15.4 1.7 18.2Q3.4 20.9 6.1 22.4Q8.8 24 12 24H19Q20.3 24 21.5 23.3Q22.6 22.6 23.3 21.5Q24 20.3 24 19ZM22 19Q22 20.2 21.1 21.1Q20.2 22 19 22H12Q9.8 22 7.9 21.1Q6 20.2 4.6 18.6Q3.1 17 2.5 15Q1.8 13 2.1 10.8Q2.3 8.6 3.5 6.7Q4.7 4.8 6.6 3.6Q8.5 2.4 10.7 2.1Q11.4 2 12 2Q13.8 2 15.4 2.6Q17 3.2 18.4 4.3Q20 5.6 20.9 7.4Q21.8 9.3 22 11.4ZM8 9H12Q12.4 9 12.7 8.7Q13 8.4 13 8Q13 7.6 12.7 7.3Q12.4 7 12 7H8Q7.6 7 7.3 7.3Q7 7.6 7 8Q7 8.4 7.3 8.7Q7.6 9 8 9ZM16 11H8Q7.6 11 7.3 11.3Q7 11.6 7 12Q7 12.4 7.3 12.7Q7.6 13 8 13H16Q16.4 13 16.7 12.7Q17 12.4 17 12Q17 11.6 16.7 11.3Q16.4 11 16 11ZM16 15H8Q7.6 15 7.3 15.3Q7 15.6 7 16Q7 16.4 7.3 16.7Q7.6 17 8 17H16Q16.4 17 16.7 16.7Q17 16.4 17 16Q17 15.6 16.7 15.3Q16.4 15 16 15Z"/></svg>'),
  calendar: raw('<svg class="fi i-calendar" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 2H18V1Q18 0.6 17.7 0.3Q17.4 0 17 0Q16.6 0 16.3 0.3Q16 0.6 16 1V2H8V1Q8 0.6 7.7 0.3Q7.4 0 7 0Q6.6 0 6.3 0.3Q6 0.6 6 1V2H5Q3.7 2 2.5 2.7Q1.4 3.4 0.7 4.5Q0 5.7 0 7V19Q0 20.3 0.7 21.5Q1.4 22.6 2.5 23.3Q3.7 24 5 24H19Q20.3 24 21.5 23.3Q22.6 22.6 23.3 21.5Q24 20.3 24 19V7Q24 5.7 23.3 4.5Q22.6 3.4 21.5 2.7Q20.3 2 19 2ZM2 7Q2 5.8 2.9 4.9Q3.8 4 5 4H19Q20.2 4 21.1 4.9Q22 5.8 22 7V8H2ZM19 22H5Q3.8 22 2.9 21.1Q2 20.2 2 19V10H22V19Q22 20.2 21.1 21.1Q20.2 22 19 22ZM10.5 15Q10.5 15.6 10.9 16Q11.4 16.5 12 16.5Q12.6 16.5 13.1 16Q13.5 15.6 13.5 15Q13.5 14.4 13.1 14Q12.6 13.5 12 13.5Q11.4 13.5 10.9 14Q10.5 14.4 10.5 15ZM5.5 15Q5.5 15.6 6 16Q6.4 16.5 7 16.5Q7.6 16.5 8 16Q8.5 15.6 8.5 15Q8.5 14.4 8 14Q7.6 13.5 7 13.5Q6.4 13.5 6 14Q5.5 14.4 5.5 15ZM15.5 15Q15.5 15.6 16 16Q16.4 16.5 17 16.5Q17.6 16.5 18 16Q18.5 15.6 18.5 15Q18.5 14.4 18 14Q17.6 13.5 17 13.5Q16.4 13.5 16 14Q15.5 14.4 15.5 15Z"/></svg>'),
  crown: raw('<svg class="fi i-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.8 4.6Q22.2 4.3 21.6 4.4Q21 4.6 20.6 5L18 7.6L13.4 3Q12.8 2.4 12 2.4Q11.2 2.4 10.6 3L6 7.6L3.4 5Q3 4.6 2.4 4.4Q1.8 4.3 1.2 4.6Q0.6 4.8 0.3 5.3Q0 5.8 0 6.4V17Q0 18.3 0.7 19.5Q1.4 20.6 2.5 21.3Q3.7 22 5 22H19Q20.3 22 21.5 21.3Q22.6 20.6 23.3 19.5Q24 18.3 24 17V6.4Q24 5.8 23.7 5.3Q23.4 4.8 22.8 4.6ZM22 17Q22 18.2 21.1 19.1Q20.2 20 19 20H5Q3.8 20 2.9 19.1Q2 18.2 2 17V6.4L5.3 9.7Q5.6 10 6 10Q6.4 10 6.7 9.7L12 4.4L17.3 9.7Q17.6 10 18 10Q18.4 10 18.7 9.7L22 6.4Z"/></svg>'),
  link: raw('<svg class="fi i-link" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.8 16.2Q7.5 15.8 7.2 15.5Q7 15.1 7 14.7Q7 14.2 7.4 14Q7.8 13.8 8.2 13.8Q8.6 13.9 8.8 14.2Q9 14.5 9.3 14.7Q10.5 16 12.2 16Q14 16 15.3 14.7L20.7 9.3Q22 8 22 6.2Q22 4.5 20.8 3.2Q19.5 2 17.8 2Q16 2 14.7 3.3L13.7 4.3Q13.4 4.6 13 4.6Q12.6 4.6 12.3 4.3Q12 4 12 3.6Q12 3.2 12.2 2.9L13.4 1.8Q14.6 0.6 16.2 0.2Q17.8 -0.2 19.4 0.2Q21 0.6 22.2 1.8Q23.4 3 23.8 4.6Q24.2 6.2 23.8 7.8Q23.4 9.4 22.2 10.6L16.6 16.2Q15.8 17 14.6 17.5Q13.5 18 12.3 18Q11 18 9.9 17.5Q8.7 17 7.8 16.2ZM6.2 24Q7.5 24 8.6 23.5Q9.8 23 10.6 22.2L11.8 21.1Q12 20.8 12 20.4Q12 20 11.7 19.7Q11.4 19.4 11 19.4Q10.6 19.4 10.3 19.7L9.3 20.7Q8 22 6.2 22Q4.5 22 3.2 20.8Q2 19.5 2 17.8Q2 16 3.3 14.7L8.7 9.3Q10 8 11.8 8Q13.5 8 14.7 9.3Q15 9.5 15.2 9.8Q15.4 10.1 15.8 10.2Q16.2 10.2 16.6 10Q17 9.8 17 9.3Q17 8.9 16.8 8.5Q16.6 8.2 16.2 7.8Q15.3 7 14.2 6.5Q13 6 11.8 6Q10.5 6 9.4 6.5Q8.2 7 7.4 7.8L1.8 13.4Q1 14.2 0.5 15.4Q0 16.5 0 17.8Q0 19 0.5 20.2Q1 21.3 1.8 22.2Q2.7 23 3.9 23.5Q5 24 6.2 24Z"/></svg>'),
  lock: raw('<svg class="fi i-lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8.4V7Q19 5.1 18 3.5Q17.1 1.9 15.5 1Q13.9 0 12 0Q10.1 0 8.5 1Q6.9 1.9 5.9 3.5Q5 5.1 5 7V8.4Q3.6 9 2.8 10.3Q2 11.5 2 13V19Q2 20.3 2.7 21.5Q3.4 22.6 4.5 23.3Q5.7 24 7 24H17Q18.3 24 19.5 23.3Q20.6 22.6 21.3 21.5Q22 20.3 22 19V13Q22 11.5 21.2 10.3Q20.4 9 19 8.4ZM7 7Q7 5.7 7.7 4.5Q8.3 3.4 9.5 2.7Q10.6 2 12 2Q13.4 2 14.5 2.7Q15.7 3.4 16.3 4.5Q17 5.7 17 7V8H7ZM20 19Q20 20.2 19.1 21.1Q18.2 22 17 22H7Q5.8 22 4.9 21.1Q4 20.2 4 19V13Q4 11.8 4.9 10.9Q5.8 10 7 10H17Q18.2 10 19.1 10.9Q20 11.8 20 13ZM12 14Q11.6 14 11.3 14.3Q11 14.6 11 15V17Q11 17.4 11.3 17.7Q11.6 18 12 18Q12.4 18 12.7 17.7Q13 17.4 13 17V15Q13 14.6 12.7 14.3Q12.4 14 12 14Z"/></svg>'),
  check: raw('<svg class="fi i-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.3 4.4 8.5 18.2Q8.2 18.6 7.8 18.6Q7.4 18.6 7.1 18.2L1.8 12.9Q1.4 12.6 1 12.6Q0.6 12.6 0.3 12.9Q0 13.2 0 13.6Q0 14 0.3 14.3L5.7 19.7Q6.6 20.6 7.8 20.6Q9 20.6 9.9 19.7L23.8 5.8Q24 5.5 24 5.1Q24 4.7 23.8 4.4Q23.4 4.2 23 4.2Q22.6 4.2 22.3 4.4Z"/></svg>'),
  star: raw('<svg class="fi i-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M1.4 12.4 4.9 15 3.5 19.2Q3.2 20.2 3.5 21.2Q3.8 22.2 4.7 22.8Q5.6 23.4 6.6 23.4Q7.7 23.4 8.5 22.8L12 20.2L15.5 22.8Q16.3 23.4 17.4 23.4Q18.4 23.4 19.3 22.8Q20.2 22.2 20.5 21.2Q20.8 20.2 20.5 19.2L19.1 15L22.6 12.4Q23.5 11.8 23.8 10.8Q24.2 9.8 23.8 8.8Q23.5 7.8 22.7 7.2Q21.8 6.6 20.8 6.6H16.4L15 2.4Q14.7 1.4 13.9 0.8Q13 0.2 12 0.2Q11 0.2 10.1 0.8Q9.3 1.4 9 2.4L7.6 6.6H3.2Q2.2 6.6 1.3 7.2Q0.5 7.8 0.2 8.8Q-0.2 9.8 0.2 10.8Q0.5 11.8 1.4 12.4Z"/></svg>'),
  quote: raw('<svg class="fi i-quote" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4Q2.3 4 1.2 5.2Q0 6.3 0 8V12Q0 12.8 0.6 13.4Q1.2 14 2 14H7.9Q7.5 16.2 5.8 17.6Q4.2 19 2 19Q1.6 19 1.3 19.3Q1 19.6 1 20Q1 20.4 1.3 20.7Q1.6 21 2 21Q4.2 21 6 19.9Q7.8 18.9 8.9 17Q10 15.2 10 13V6Q10 5.2 9.4 4.6Q8.8 4 8 4ZM22 4H18Q16.3 4 15.2 5.2Q14 6.3 14 8V12Q14 12.8 14.6 13.4Q15.2 14 16 14H21.9Q21.5 16.2 19.8 17.6Q18.2 19 16 19Q15.6 19 15.3 19.3Q15 19.6 15 20Q15 20.4 15.3 20.7Q15.6 21 16 21Q18.2 21 20 19.9Q21.8 18.9 22.9 17Q24 15.2 24 13V6Q24 5.2 23.4 4.6Q22.8 4 22 4Z"/></svg>'),
  broadcast: raw('<svg class="fi i-broadcast" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5Q10.6 5.5 9.5 6.5Q8.5 7.5 8.5 9Q8.5 10.2 9.2 11.1Q9.9 12 11 12.3V23Q11 23.4 11.3 23.7Q11.6 24 12 24Q12.4 24 12.7 23.7Q13 23.4 13 23V12.3Q14.1 12 14.8 11.1Q15.5 10.2 15.5 9Q15.5 7.5 14.5 6.5Q13.4 5.5 12 5.5ZM12 10.5Q11.4 10.5 10.9 10Q10.5 9.6 10.5 9Q10.5 8.4 10.9 8Q11.4 7.5 12 7.5Q12.6 7.5 13.1 8Q13.5 8.4 13.5 9Q13.5 9.6 13.1 10Q12.6 10.5 12 10.5ZM7.8 4.8Q6.9 5.7 6.4 6.8Q6 7.8 6 9Q6 10.2 6.4 11.4Q6.9 12.5 7.8 13.3Q8.1 13.6 8.1 14Q8.1 14.4 7.8 14.7Q7.4 15 7 15Q6.6 15 6.3 14.7Q5.2 13.6 4.6 12.1Q4 10.6 4 9Q4 7.4 4.6 6Q5.2 4.6 6.3 3.4Q6.6 3.1 7 3.1Q7.4 3.1 7.8 3.4Q8.1 3.7 8.1 4.1Q8.1 4.6 7.8 4.8ZM20 9Q20 10.6 19.4 12.1Q18.8 13.6 17.7 14.7Q17.4 15 17 15Q16.6 15 16.2 14.7Q15.9 14.4 15.9 14Q15.9 13.6 16.2 13.3Q17.1 12.5 17.6 11.4Q18 10.2 18 9Q18 7.8 17.6 6.8Q17.1 5.7 16.2 4.8Q15.9 4.6 15.9 4.1Q15.9 3.7 16.2 3.4Q16.6 3.1 17 3.1Q17.4 3.1 17.7 3.4Q18.8 4.6 19.4 6Q20 7.4 20 9ZM5 16.2Q5.2 16.5 5.2 16.9Q5.2 17.3 4.9 17.6Q4.6 17.8 4.2 17.8Q3.8 17.8 3.5 17.6Q1.2 15.3 0.4 12.2Q-0.4 9 0.4 6Q1.2 2.9 3.5 0.6Q3.8 0.3 4.2 0.3Q4.6 0.3 4.9 0.6Q5.2 0.9 5.2 1.3Q5.2 1.7 5 2Q3 3.9 2.4 6.5Q1.7 9 2.4 11.6Q3 14.2 5 16.2ZM20.5 17.6Q20.2 17.8 19.8 17.8Q19.4 17.8 19.1 17.6Q18.8 17.3 18.8 16.9Q18.8 16.5 19 16.2Q21 14.2 21.6 11.6Q22.3 9 21.6 6.5Q21 3.9 19 2Q18.8 1.7 18.8 1.3Q18.8 0.9 19.1 0.6Q19.4 0.3 19.8 0.3Q20.2 0.3 20.5 0.6Q22.8 2.9 23.6 6Q24.4 9 23.6 12.2Q22.8 15.3 20.5 17.6Z"/></svg>'),
  profile: raw('<svg class="fi i-profile" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4H15V3Q15 1.8 14.2 0.9Q13.3 0 12 0Q10.7 0 9.8 0.9Q9 1.8 9 3V4H5Q3.7 4 2.5 4.7Q1.4 5.4 0.7 6.5Q0 7.7 0 9V19Q0 20.3 0.7 21.5Q1.4 22.6 2.5 23.3Q3.7 24 5 24H19Q20.3 24 21.5 23.3Q22.6 22.6 23.3 21.5Q24 20.3 24 19V9Q24 7.7 23.3 6.5Q22.6 5.4 21.5 4.7Q20.3 4 19 4ZM11 3Q11 2.6 11.3 2.3Q11.6 2 12 2Q12.4 2 12.7 2.3Q13 2.6 13 3V5Q13 5.4 12.7 5.7Q12.4 6 12 6Q11.6 6 11.3 5.7Q11 5.4 11 5ZM22 19Q22 20.2 21.1 21.1Q20.2 22 19 22H5Q3.8 22 2.9 21.1Q2 20.2 2 19V9Q2 7.8 2.9 6.9Q3.8 6 5 6H9.2Q9.5 6.9 10.3 7.4Q11 8 12 8Q13 8 13.7 7.4Q14.5 6.9 14.8 6H19Q20.2 6 21.1 6.9Q22 7.8 22 9ZM10 10H5Q4.6 10 4.3 10.3Q4 10.6 4 11V19Q4 19.4 4.3 19.7Q4.6 20 5 20H10Q10.4 20 10.7 19.7Q11 19.4 11 19V11Q11 10.6 10.7 10.3Q10.4 10 10 10ZM9 18H6V12H9ZM20 15Q20 15.4 19.7 15.7Q19.4 16 19 16H14Q13.6 16 13.3 15.7Q13 15.4 13 15Q13 14.6 13.3 14.3Q13.6 14 14 14H19Q19.4 14 19.7 14.3Q20 14.6 20 15ZM20 11Q20 11.4 19.7 11.7Q19.4 12 19 12H14Q13.6 12 13.3 11.7Q13 11.4 13 11Q13 10.6 13.3 10.3Q13.6 10 14 10H19Q19.4 10 19.7 10.3Q20 10.6 20 11ZM18 19Q18 19.4 17.7 19.7Q17.4 20 17 20H14Q13.6 20 13.3 19.7Q13 19.4 13 19Q13 18.6 13.3 18.3Q13.6 18 14 18H17Q17.4 18 17.7 18.3Q18 18.6 18 19Z"/></svg>'),
  feather: raw('<svg class="fi i-feather" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.8 1.2Q22.1 0.4 21.1 0.1Q20.1 -0.2 19 0.1Q15.1 1.1 11.6 3.1Q8.2 5 5.3 7.8Q4.1 9 3.5 10.6Q3 12.1 3 13.7Q3.1 16.1 4.6 18L0.3 22.3Q-0.2 22.7 0 23.3Q0.2 23.8 0.7 24Q1.3 24.2 1.7 23.7L6 19.4Q8 21 10.6 21Q12.2 21 13.8 20.3Q15.4 19.7 16.5 18.5Q18.5 16.5 20.2 13.4Q21.6 11.1 22.7 8.4Q23.5 6.3 23.9 5Q24.2 3.9 23.9 2.9Q23.6 1.9 22.8 1.2ZM5 13.6Q5 12.4 5.4 11.3Q5.8 10.2 6.6 9.3Q7.2 8.7 8 8.1V14.6L6 16.6Q5.1 15.2 5 13.6ZM15 17Q13.6 18.6 11.4 18.9Q9.3 19.2 7.4 18L12.4 13H18.2Q16.8 15.2 15 17ZM21.9 4.5Q21 7.8 19.4 11H14.4L17.7 7.7Q18.2 7.3 18 6.7Q17.8 6.2 17.3 6Q16.7 5.8 16.3 6.3L10 12.6V6.5Q14.4 3.4 19.5 2.1Q19.8 2 20 2Q20.8 2 21.4 2.6Q21.8 3 21.9 3.4Q22.1 3.9 21.9 4.5Z"/></svg>'),
  heart: raw('<svg class="fi i-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 1.9Q15.8 1.9 14.3 2.8Q12.8 3.7 12 5.2Q11.2 3.7 9.7 2.8Q8.2 1.9 6.4 2Q4.6 2 3.1 3Q1.6 3.9 0.8 5.5Q-0.1 7.1 0 9Q0 12.1 2.9 15.8Q5.1 18.7 8.8 21.8Q10.2 23 12 23Q13.8 23 15.2 21.8Q18.9 18.7 21.1 15.8Q24 12.1 24 9Q24.1 7.1 23.2 5.5Q22.4 3.9 20.9 3Q19.4 2 17.5 1.9ZM13.9 20.3Q13.1 21 12 21Q10.9 21 10.1 20.3Q6.2 17.1 4.1 14.1Q2 11.1 2 9Q1.9 7.7 2.5 6.6Q3.1 5.4 4.2 4.7Q5.2 4 6.5 4Q7.8 4 8.8 4.7Q9.9 5.4 10.5 6.6Q11 7.7 11 9Q11 9.4 11.3 9.7Q11.6 10 12 10Q12.4 10 12.7 9.7Q13 9.4 13 9Q13 7.7 13.5 6.6Q14.1 5.4 15.2 4.7Q16.2 4 17.5 4Q18.8 4 19.8 4.7Q20.9 5.4 21.5 6.6Q22.1 7.7 22 9Q22 11.1 19.9 14.1Q17.8 17.1 13.9 20.3Z"/></svg>'),
  heartFill: raw('<svg class="fi i-heartFill" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 1.9Q15.8 1.9 14.3 2.8Q12.8 3.7 12 5.2Q11.2 3.7 9.7 2.8Q8.2 1.9 6.4 2Q4.6 2 3.1 3Q1.6 3.9 0.8 5.5Q-0.1 7.1 0 9Q0 12.1 2.9 15.8Q5.1 18.7 8.8 21.8Q10.2 23 12 23Q13.8 23 15.2 21.8Q18.9 18.7 21.1 15.8Q24 12.1 24 9Q24.1 7.1 23.2 5.5Q22.4 3.9 20.9 3Q19.4 2 17.5 1.9Z"/></svg>'),
  starOutline: raw('<svg class="fi i-starOutline" viewBox="0 0 24 24" aria-hidden="true"><path d="M23.8 8.8Q23.5 7.8 22.7 7.2Q21.8 6.6 20.8 6.6H16.4L15 2.4Q14.7 1.4 13.9 0.8Q13 0.2 12 0.2Q11 0.2 10.1 0.8Q9.3 1.4 9 2.4L7.6 6.6H3.2Q2.2 6.6 1.3 7.2Q0.5 7.8 0.2 8.8Q-0.2 9.8 0.2 10.8Q0.5 11.8 1.4 12.4L4.9 15L3.5 19.2Q3.2 20.2 3.5 21.2Q3.8 22.2 4.7 22.8Q5.6 23.4 6.6 23.4Q7.7 23.4 8.5 22.8L12 20.2L15.5 22.8Q16.3 23.4 17.4 23.4Q18.4 23.4 19.3 22.8Q20.2 22.2 20.5 21.2Q20.8 20.2 20.5 19.2L19.1 15L22.6 12.4Q23.5 11.8 23.8 10.8Q24.2 9.8 23.8 8.8ZM21.5 10.8 17.4 13.8Q17.1 14 17 14.3Q16.9 14.6 17 15L18.6 19.8Q18.7 20.2 18.6 20.6Q18.4 21 18.1 21.2Q17.8 21.4 17.4 21.4Q17 21.4 16.6 21.2L12.6 18.2Q12.3 18 12 18Q11.7 18 11.4 18.2L7.4 21.2Q7 21.4 6.6 21.4Q6.2 21.4 5.9 21.2Q5.5 21 5.4 20.6Q5.3 20.2 5.4 19.8L7 15Q7.1 14.6 7 14.3Q6.9 14 6.6 13.8L2.5 10.8Q2.2 10.6 2 10.2Q1.9 9.8 2 9.4Q2.2 9 2.5 8.8Q2.8 8.6 3.2 8.6H8.3Q8.6 8.6 8.9 8.4Q9.2 8.2 9.3 7.8L10.8 3Q11 2.6 11.3 2.4Q11.6 2.2 12 2.2Q12.4 2.2 12.7 2.4Q13 2.6 13.2 3L14.7 7.8Q14.8 8.2 15.1 8.4Q15.4 8.6 15.7 8.6H20.8Q21.2 8.6 21.5 8.8Q21.8 9 22 9.4Q22.1 9.8 22 10.2Q21.8 10.6 21.5 10.8Z"/></svg>'),
  image: raw('<svg class="fi i-image" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 0H5Q3.7 0 2.5 0.7Q1.4 1.4 0.7 2.5Q0 3.7 0 5V19Q0 20.3 0.7 21.5Q1.4 22.6 2.5 23.3Q3.7 24 5 24H19Q20.3 24 21.5 23.3Q22.6 22.6 23.3 21.5Q24 20.3 24 19V5Q24 3.7 23.3 2.5Q22.6 1.4 21.5 0.7Q20.3 0 19 0ZM5 2H19Q20.2 2 21.1 2.9Q22 3.8 22 5V19Q22 19.7 21.7 20.3L12.6 11.1Q11.8 10.4 10.9 10Q10 9.7 9 9.7Q8 9.7 7.1 10Q6.2 10.4 5.4 11.1L2 14.6V5Q2 3.8 2.9 2.9Q3.8 2 5 2ZM5 22Q3.8 22 2.9 21.1Q2 20.2 2 19V17.4L6.9 12.6Q7.8 11.7 9 11.7Q10.2 11.7 11.1 12.6L20.3 21.7Q19.7 22 19 22ZM16 10.5Q17.4 10.5 18.5 9.5Q19.5 8.5 19.5 7Q19.5 5.5 18.5 4.5Q17.4 3.5 16 3.5Q14.6 3.5 13.5 4.5Q12.5 5.5 12.5 7Q12.5 8.5 13.5 9.5Q14.6 10.5 16 10.5ZM16 5.5Q16.6 5.5 17.1 6Q17.5 6.4 17.5 7Q17.5 7.6 17.1 8Q16.6 8.5 16 8.5Q15.4 8.5 14.9 8Q14.5 7.6 14.5 7Q14.5 6.4 14.9 6Q15.4 5.5 16 5.5Z"/></svg>'),
  video: raw('<svg class="fi i-video" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.9 6.6Q22.4 6.3 21.8 6.4Q21.3 6.4 20.8 6.7L19 8.6Q18.8 6.6 17.4 5.3Q15.9 4 14 4H5Q3.7 4 2.5 4.7Q1.4 5.4 0.7 6.5Q0 7.7 0 9V15Q0 16.3 0.7 17.5Q1.4 18.6 2.5 19.3Q3.7 20 5 20H14Q16 20 17.4 18.6Q18.8 17.3 19 15.4L20.8 17.2Q21.4 17.6 22 17.6Q22.5 17.6 23 17.4Q23.4 17.1 23.7 16.6Q24 16.2 24 15.6V8.3Q24 7.8 23.7 7.3Q23.4 6.8 22.9 6.6ZM14 18H5Q3.8 18 2.9 17.1Q2 16.2 2 15V9Q2 7.8 2.9 6.9Q3.8 6 5 6H14Q15.3 6 16.1 6.9Q17 7.8 17 9V15Q17 16.2 16.2 17.1Q15.3 18 14 18ZM19 12.6V11.4L22 8.4V15.6Z"/></svg>'),
  mic: raw('<svg class="fi i-mic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20Q14.2 20 16 18.9Q17.8 17.8 18.9 16Q20 14.2 20 12V8Q20 5.8 18.9 4Q17.8 2.2 16 1.1Q14.2 0 12 0Q9.8 0 8 1.1Q6.2 2.2 5.1 4Q4 5.8 4 8V12Q4 14.2 5.1 16Q6.2 17.8 8 18.9Q9.8 20 12 20ZM12 2Q14.2 2 15.8 3.4Q17.5 4.8 17.9 7H15Q14.6 7 14.3 7.3Q14 7.6 14 8Q14 8.4 14.3 8.7Q14.6 9 15 9H18V11H15Q14.6 11 14.3 11.3Q14 11.6 14 12Q14 12.4 14.3 12.7Q14.6 13 15 13H17.9Q17.5 15.2 15.8 16.6Q14.2 18 12 18Q9.8 18 8.2 16.6Q6.5 15.2 6.1 13H9Q9.4 13 9.7 12.7Q10 12.4 10 12Q10 11.6 9.7 11.3Q9.4 11 9 11H6V9H9Q9.4 9 9.7 8.7Q10 8.4 10 8Q10 7.6 9.7 7.3Q9.4 7 9 7H6.1Q6.5 4.8 8.2 3.4Q9.8 2 12 2ZM23 12Q22.6 12 22.3 12.3Q22 12.6 22 13Q22 15.4 20.8 17.5Q19.6 19.6 17.5 20.8Q15.4 22 13 22H11Q8.6 22 6.5 20.8Q4.4 19.6 3.2 17.5Q2 15.4 2 13Q2 12.6 1.7 12.3Q1.4 12 1 12Q0.6 12 0.3 12.3Q0 12.6 0 13Q0 16 1.5 18.5Q3 21 5.5 22.5Q8 24 11 24H13Q16 24 18.5 22.5Q21 21 22.5 18.5Q24 16 24 13Q24 12.6 23.7 12.3Q23.4 12 23 12Z"/></svg>'),
  live: raw('<svg class="fi i-live" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 10Q12.8 10 13.4 10.6Q14 11.2 14 12Q14 12.8 13.4 13.4Q12.8 14 12 14Q11.2 14 10.6 13.4Q10 12.8 10 12Q10 11.2 10.6 10.6Q11.2 10 12 10ZM20.5 20.5Q22.8 18.2 23.6 15.1Q24.4 12 23.6 8.9Q22.8 5.8 20.5 3.5Q20.2 3.2 19.8 3.2Q19.4 3.2 19.1 3.5Q18.8 3.8 18.8 4.2Q18.8 4.6 19.1 5Q21 6.9 21.6 9.4Q22.3 12 21.6 14.6Q21 17.1 19.1 19Q18.8 19.4 18.8 19.8Q18.8 20.2 19.1 20.5Q19.4 20.8 19.8 20.8Q20.2 20.8 20.5 20.5ZM17 17Q17.9 15.9 18.5 14.7Q19 13.4 19 12Q19 10.6 18.5 9.3Q17.9 8.1 17 7Q16.6 6.7 16.2 6.7Q15.8 6.7 15.6 7Q15.3 7.4 15.3 7.8Q15.3 8.2 15.5 8.5Q17 9.9 17 12Q17 14.1 15.5 15.5Q15.3 15.8 15.3 16.2Q15.3 16.6 15.6 16.9Q15.8 17.2 16.2 17.2Q16.6 17.2 17 17ZM5 20.5Q5.2 20.2 5.2 19.8Q5.2 19.4 5 19Q3 17.2 2.4 14.6Q1.7 12 2.4 9.4Q3 6.9 5 5Q5.2 4.6 5.2 4.2Q5.2 3.8 4.9 3.5Q4.6 3.2 4.2 3.2Q3.8 3.2 3.5 3.5Q1.2 5.8 0.4 8.9Q-0.4 12 0.4 15.1Q1.2 18.2 3.5 20.5Q3.8 20.8 4.2 20.8Q4.6 20.8 5 20.5ZM8.5 17Q8.8 16.6 8.8 16.2Q8.8 15.8 8.5 15.5Q7.5 14.6 7.2 13.3Q6.8 12 7.2 10.7Q7.5 9.4 8.5 8.5Q8.8 8.2 8.8 7.8Q8.8 7.4 8.5 7.1Q8.2 6.8 7.8 6.8Q7.4 6.8 7 7Q5.7 8.4 5.2 10.2Q4.8 12 5.2 13.8Q5.7 15.6 7 17Q7.4 17.3 7.8 17.3Q8.2 17.3 8.5 17Z"/></svg>'),
  text: raw('<svg class="fi i-text" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 0H5Q3.7 0 2.5 0.7Q1.4 1.4 0.7 2.5Q0 3.7 0 5V19Q0 20.3 0.7 21.5Q1.4 22.6 2.5 23.3Q3.7 24 5 24H19Q20.3 24 21.5 23.3Q22.6 22.6 23.3 21.5Q24 20.3 24 19V5Q24 3.7 23.3 2.5Q22.6 1.4 21.5 0.7Q20.3 0 19 0ZM22 19Q22 20.2 21.1 21.1Q20.2 22 19 22H5Q3.8 22 2.9 21.1Q2 20.2 2 19V5Q2 3.8 2.9 2.9Q3.8 2 5 2H19Q20.2 2 21.1 2.9Q22 3.8 22 5ZM18 9Q18 9.4 17.7 9.7Q17.4 10 17 10Q16.6 10 16.3 9.7Q16 9.4 16 9Q16 8.6 15.7 8.3Q15.4 8 15 8H13V16H14Q14.4 16 14.7 16.3Q15 16.6 15 17Q15 17.4 14.7 17.7Q14.4 18 14 18H10Q9.6 18 9.3 17.7Q9 17.4 9 17Q9 16.6 9.3 16.3Q9.6 16 10 16H11V8H9Q8.6 8 8.3 8.3Q8 8.6 8 9Q8 9.4 7.7 9.7Q7.4 10 7 10Q6.6 10 6.3 9.7Q6 9.4 6 9Q6 7.8 6.9 6.9Q7.8 6 9 6H15Q16.2 6 17.1 6.9Q18 7.8 18 9Z"/></svg>'),
  verified: raw('<svg class="fi i-verified" viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12Q24 10.8 23.5 9.7Q23 8.6 22.1 7.8Q22.2 6.6 21.8 5.5Q21.4 4.4 20.5 3.5Q19.6 2.6 18.5 2.2Q17.4 1.8 16.2 1.9Q15.2 0.7 13.6 0.2Q12 -0.2 10.4 0.2Q8.8 0.6 7.8 1.9Q6.6 1.8 5.5 2.2Q4.4 2.6 3.5 3.5Q2.6 4.4 2.2 5.5Q1.8 6.6 2 7.8Q0.7 8.8 0.2 10.4Q-0.2 12 0.2 13.6Q0.6 15.2 1.9 16.2Q1.8 17.4 2.2 18.5Q2.6 19.6 3.5 20.5Q4.4 21.4 5.5 21.8Q6.6 22.2 7.8 22.1Q8.8 23.3 10.4 23.8Q12 24.2 13.6 23.8Q15.2 23.4 16.2 22.1Q17.4 22.2 18.5 21.8Q19.6 21.4 20.5 20.5Q21.4 19.6 21.8 18.5Q22.2 17.4 22 16.2Q23 15.4 23.5 14.3Q24 13.2 24 12ZM17.5 10.6 12.8 15.1Q11.9 16 10.7 16Q9.4 16 8.6 15.1L6.3 13Q6 12.7 6 12.3Q6 11.9 6.3 11.6Q6.6 11.3 7 11.3Q7.4 11.3 7.7 11.6L9.9 13.7Q10.2 14 10.7 14Q11.1 14 11.4 13.7L16.2 9.1Q16.5 8.8 16.9 8.8Q17.3 8.9 17.6 9.2Q17.8 9.4 17.8 9.8Q17.8 10.2 17.5 10.6Z"/></svg>'),
  grid: raw('<svg class="fi i-grid" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 0H4Q2.3 0 1.2 1.2Q0 2.3 0 4V7Q0 8.6 1.2 9.8Q2.3 11 4 11H7Q8.6 11 9.8 9.8Q11 8.6 11 7V4Q11 2.3 9.8 1.2Q8.6 0 7 0ZM9 7Q9 7.8 8.4 8.4Q7.8 9 7 9H4Q3.2 9 2.6 8.4Q2 7.8 2 7V4Q2 3.2 2.6 2.6Q3.2 2 4 2H7Q7.8 2 8.4 2.6Q9 3.2 9 4ZM20 0H17Q15.4 0 14.2 1.2Q13 2.3 13 4V7Q13 8.6 14.2 9.8Q15.4 11 17 11H20Q21.7 11 22.8 9.8Q24 8.6 24 7V4Q24 2.3 22.8 1.2Q21.7 0 20 0ZM22 7Q22 7.8 21.4 8.4Q20.8 9 20 9H17Q16.2 9 15.6 8.4Q15 7.8 15 7V4Q15 3.2 15.6 2.6Q16.2 2 17 2H20Q20.8 2 21.4 2.6Q22 3.2 22 4ZM7 13H4Q2.3 13 1.2 14.2Q0 15.4 0 17V20Q0 21.7 1.2 22.8Q2.3 24 4 24H7Q8.6 24 9.8 22.8Q11 21.7 11 20V17Q11 15.4 9.8 14.2Q8.6 13 7 13ZM9 20Q9 20.8 8.4 21.4Q7.8 22 7 22H4Q3.2 22 2.6 21.4Q2 20.8 2 20V17Q2 16.2 2.6 15.6Q3.2 15 4 15H7Q7.8 15 8.4 15.6Q9 16.2 9 17ZM20 13H17Q15.4 13 14.2 14.2Q13 15.4 13 17V20Q13 21.7 14.2 22.8Q15.4 24 17 24H20Q21.7 24 22.8 22.8Q24 21.7 24 20V17Q24 15.4 22.8 14.2Q21.7 13 20 13ZM22 20Q22 20.8 21.4 21.4Q20.8 22 20 22H17Q16.2 22 15.6 21.4Q15 20.8 15 20V17Q15 16.2 15.6 15.6Q16.2 15 17 15H20Q20.8 15 21.4 15.6Q22 16.2 22 17Z"/></svg>'),
  play: raw('<svg class="fi i-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 8 11 1Q9.8 0.2 8.4 0Q7 -0.1 5.7 0.6Q4.5 1.2 3.8 2.4Q3 3.6 3 5V19Q3 20.4 3.8 21.6Q4.5 22.8 5.8 23.4Q7 24.1 8.4 24Q9.8 23.8 11 23L20.5 16Q21.4 15.4 22 14.3Q22.6 13.2 22.6 12Q22.6 10.8 22 9.7Q21.4 8.6 20.5 8ZM19.3 14.4 9.8 21.4Q9.1 21.9 8.2 22Q7.4 22.1 6.6 21.7Q5.9 21.3 5.5 20.6Q5 19.8 5 19V5Q5 4.2 5.4 3.4Q5.9 2.7 6.6 2.4Q7.3 2 8 2Q9 2 9.8 2.6L19.3 9.6Q19.9 10 20.2 10.6Q20.6 11.3 20.6 12Q20.6 12.7 20.2 13.4Q19.9 14 19.3 14.4Z"/></svg>'),
  reply: raw('<svg class="fi i-reply" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 2Q22.6 2 22.3 2.3Q22 2.6 22 3V11Q22 12.2 21.1 13.1Q20.2 14 19 14H2.6L7.8 8.7Q8 8.4 8 8Q8 7.6 7.7 7.3Q7.4 7 7 7Q6.6 7 6.3 7.3L0.9 12.9Q0 13.8 0 15Q0 16.2 0.9 17.1L6.3 22.7Q6.6 23 7 23Q7.4 23 7.7 22.7Q8 22.4 8 22Q8 21.6 7.8 21.3L2.6 16H19Q20.3 16 21.5 15.3Q22.6 14.6 23.3 13.5Q24 12.4 24 11V3Q24 2.6 23.7 2.3Q23.4 2 23 2Z"/></svg>'),
  search: raw('<svg class="fi i-search" viewBox="0 0 24 24" aria-hidden="true"><path d="M23.7 22.3 17.8 16.3Q19.4 14.3 19.9 11.8Q20.3 9.2 19.5 6.8Q18.6 4.3 16.7 2.6Q14.7 0.8 12.2 0.2Q9.8 -0.3 7.2 0.4Q4.7 1 2.9 2.9Q1 4.7 0.4 7.2Q-0.3 9.8 0.2 12.2Q0.8 14.7 2.6 16.7Q4.3 18.6 6.8 19.5Q9.2 20.3 11.8 19.9Q14.3 19.4 16.3 17.8L22.3 23.7Q22.6 24 23 24Q23.4 24 23.7 23.7Q24 23.4 24 23Q24 22.6 23.7 22.3ZM10 18Q7.8 18 6 16.9Q4.2 15.8 3.1 14Q2 12.2 2 10Q2 7.8 3.1 6Q4.2 4.2 6 3.1Q7.8 2 10 2Q12.2 2 14 3.1Q15.8 4.2 16.9 6Q18 7.8 18 10Q18 12.2 16.9 14Q15.8 15.8 14 16.9Q12.2 18 10 18Z"/></svg>'),
  phone: raw('<svg class="fi i-phone" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 1Q13 0.6 13.3 0.3Q13.6 0 14 0Q16.7 0 19 1.4Q21.3 2.7 22.6 5Q24 7.3 24 10Q24 10.4 23.7 10.7Q23.4 11 23 11Q22.6 11 22.3 10.7Q22 10.4 22 10Q22 7.8 20.9 6Q19.8 4.2 18 3.1Q16.2 2 14 2Q13.6 2 13.3 1.7Q13 1.4 13 1ZM14 6Q15.7 6 16.8 7.2Q18 8.3 18 10Q18 10.4 18.3 10.7Q18.6 11 19 11Q19.4 11 19.7 10.7Q20 10.4 20 10Q20 8.4 19.2 7Q18.4 5.6 17 4.8Q15.6 4 14 4Q13.6 4 13.3 4.3Q13 4.6 13 5Q13 5.4 13.3 5.7Q13.6 6 14 6ZM23.1 16.7Q24 17.7 24 19Q24 20.2 23.1 21.1L22.2 22.2Q19.8 24.4 16.2 23.8Q12.9 23.4 9.3 20.8Q5.8 18.3 3.3 14.8Q0.6 11.2 0.2 7.9Q-0.4 4.2 1.8 1.8L3 0.9Q3.8 0 5.1 0Q6.4 0 7.3 0.9L9.1 3.4Q10 4.2 10 5.5Q10 6.7 9.1 7.6L8 9.1Q9 11.4 10.8 13.2Q12.6 15 14.9 16L16.4 14.9Q17.3 14 18.5 14Q19.8 14 20.6 14.9ZM21.7 18.2Q20.5 17.3 19.3 16.3Q19 16 18.5 16Q18.1 16 17.8 16.3L15.7 17.9Q15.3 18.3 14.7 18.1Q11.7 17 9.4 14.6Q7 12.3 5.9 9.3Q5.7 8.7 6.1 8.3L7.7 6.2Q8 5.9 8 5.5Q8 5 7.7 4.7L5.8 2.3Q5.5 2 5.1 2Q4.6 2 4.3 2.3L3.1 3.4Q1.5 5.3 2.2 8.3Q2.9 11 5.2 14Q7.4 16.9 10.4 19Q13.4 21.2 16.1 21.8Q19 22.4 20.7 20.8L21.6 19.8Q22 19.4 22 19Q22 18.6 21.7 18.2Z"/></svg>'),
  card: raw('<svg class="fi i-card" viewBox="0 0 24 24" aria-hidden="true"><path d="M24 4V20Q24 21.7 22.8 22.8Q21.7 24 20 24H17Q16.6 24 16.3 23.7Q16 23.4 16 23Q16 22.6 16.3 22.3Q16.6 22 17 22H20Q20.8 22 21.4 21.4Q22 20.8 22 20V4Q22 3.2 21.4 2.6Q20.8 2 20 2H17Q16.6 2 16.3 1.7Q16 1.4 16 1Q16 0.6 16.3 0.3Q16.6 0 17 0H20Q21.7 0 22.8 1.2Q24 2.3 24 4ZM17 14.5 11.7 19.8Q10.9 20.5 9.8 20.5Q9.2 20.5 8.7 20.2Q7.9 20 7.5 19.3Q7 18.6 7 17.8V16H3Q1.8 16 0.9 15.1Q0 14.2 0 13V11Q0 9.8 0.9 8.9Q1.8 8 3 8H7V6.2Q7 5.4 7.5 4.7Q7.9 4 8.7 3.7Q9.4 3.4 10.3 3.5Q11.1 3.7 11.7 4.2L17 9.5Q18 10.6 18 12Q18 13.4 17 14.5ZM15.6 11 10.3 5.7Q9.9 5.4 9.5 5.6Q9 5.8 9 6.2V9Q9 9.4 8.7 9.7Q8.4 10 8 10H3Q2.6 10 2.3 10.3Q2 10.6 2 11V13Q2 13.4 2.3 13.7Q2.6 14 3 14H8Q8.4 14 8.7 14.3Q9 14.6 9 15V17.8Q9 18.2 9.5 18.4Q9.9 18.6 10.2 18.3L15.6 13Q16 12.6 16 12Q16 11.4 15.6 11Z"/></svg>'),
  smartphone: raw('<svg class="fi i-smartphone" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 0Q15 0 12 0H9Q7.6 0 6.5 0.7Q5.4 1.4 4.7 2.5Q4 3.7 4 5V19Q4 20.3 4.7 21.5Q5.4 22.6 6.5 23.3Q7.7 24 9 24H15Q16.3 24 17.5 23.3Q18.6 22.6 19.3 21.5Q20 20.3 20 19V5Q20 3.7 19.3 2.5Q18.6 1.4 17.5 0.7Q16.4 0 15 0ZM18 19Q18 20.2 17.1 21.1Q16.2 22 15 22H9Q7.8 22 6.9 21.1Q6 20.2 6 19V5Q6 3.9 6.7 3.1Q7.4 2.2 8.4 2.1L9.1 3.4Q9.4 4 10 4H14Q14.6 4 14.9 3.4L15.6 2.1Q16.6 2.2 17.3 3.1Q18 3.9 18 5ZM13 20H11Q10.6 20 10.3 19.7Q10 19.4 10 19Q10 18.6 10.3 18.3Q10.6 18 11 18H13Q13.4 18 13.7 18.3Q14 18.6 14 19Q14 19.4 13.7 19.7Q13.4 20 13 20Z"/></svg>'),
  book: raw('<svg class="fi i-book" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.2 2.2Q21.4 1.4 20.3 1.2Q19.2 0.9 18.1 1.1L14.2 1.8Q12.9 2 12 3Q11.1 2 9.7 1.8L5.9 1.1Q4.8 0.9 3.7 1.2Q2.6 1.4 1.8 2.2Q1 2.9 0.5 3.9Q0 4.9 0 6V16.8Q0 18.6 1.2 20Q2.3 21.4 4.1 21.7L10.4 22.9Q12 23.1 13.6 22.9L19.9 21.7Q21.7 21.4 22.8 20Q24 18.6 24 16.8V6Q24 4.9 23.5 3.9Q23 2.9 22.2 2.2ZM11 21Q10.9 20.9 10.7 20.9L4.5 19.8Q3.4 19.5 2.7 18.7Q2 17.9 2 16.8V6Q2 4.7 2.9 3.8Q3.8 3 5 3L5.5 3L9.4 3.8Q10.1 3.8 10.5 4.4Q11 5 11 5.7ZM22 16.8Q22 17.9 21.3 18.7Q20.6 19.5 19.5 19.8L13 21V5.7Q13 5 13.4 4.4Q13.9 3.8 14.6 3.8L18.5 3Q19.1 3 19.8 3.1Q20.4 3.3 20.9 3.7Q21.4 4.2 21.7 4.8Q22 5.4 22 6Z"/></svg>'),
  mute: raw('<svg class="fi i-mute" viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 0.4Q13.3 0.1 12.8 0.2Q10.6 0.6 8.6 1.9Q6.6 3.1 5.3 5H5Q3.7 5 2.5 5.6Q1.4 6.3 0.7 7.5Q0 8.6 0 10V14Q0 15.4 0.7 16.5Q1.4 17.7 2.5 18.4Q3.7 19 5 19H5.3Q6.6 20.9 8.6 22.1Q10.6 23.4 12.8 23.8L13 23.8Q13.4 23.8 13.7 23.6Q14 23.3 14 22.8V1.2Q14 0.7 13.7 0.4ZM12 21.5Q10.5 21 9.2 20.1Q7.8 19.1 6.9 17.8L6.6 17.4Q6.3 17 5.8 17H5Q3.8 17 2.9 16.2Q2 15.3 2 14V10Q2 8.7 2.9 7.8Q3.8 7 5 7H5.8Q6.3 7 6.6 6.6L6.9 6.2Q7.8 4.9 9.2 3.9Q10.5 3 12 2.5ZM23.8 14.3Q24 14.6 24 15Q24 15.4 23.7 15.7Q23.4 16 23 16Q22.6 16 22.3 15.7L20 13.4L17.8 15.7Q17.4 16 17 16Q16.6 16 16.3 15.7Q16 15.4 16 15Q16 14.6 16.3 14.3L18.6 12L16.3 9.7Q16 9.4 16 9Q16 8.6 16.3 8.3Q16.6 8 17 8Q17.4 8 17.8 8.3L20 10.6L22.3 8.3Q22.6 8 23 8Q23.4 8 23.7 8.3Q24 8.6 24 9Q24 9.4 23.8 9.7L21.4 12Z"/></svg>'),
  sound: raw('<svg class="fi i-sound" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.3Q20.5 4 20.1 4Q19.7 4 19.4 4.3Q19.1 4.6 19.1 5Q19.1 5.4 19.4 5.7Q21.1 7.4 21.7 9.7Q22.3 12 21.7 14.3Q21.1 16.6 19.4 18.3Q19.1 18.6 19.1 19Q19.1 19.4 19.4 19.7Q19.7 20 20.1 20Q20.5 20 20.8 19.7Q22.9 17.6 23.6 14.8Q24.4 12 23.6 9.2Q22.9 6.4 20.8 4.3ZM18.1 7.3Q17.8 7 17.4 7Q17 7 16.7 7.3Q16.4 7.6 16.4 8Q16.4 8.4 16.6 8.7Q17.6 9.6 17.9 10.8Q18.2 12 17.9 13.2Q17.6 14.4 16.6 15.3Q16.4 15.6 16.4 16Q16.4 16.4 16.7 16.7Q17 17 17.4 17Q17.8 17 18.1 16.7Q19.4 15.4 19.8 13.7Q20.2 12 19.8 10.3Q19.4 8.6 18.1 7.3ZM13.8 0.2Q11.5 0.6 9.6 1.9Q7.6 3.1 6.2 5H5Q3.7 5 2.5 5.7Q1.4 6.3 0.7 7.5Q0 8.6 0 10V14Q0 15.4 0.7 16.5Q1.4 17.7 2.5 18.3Q3.7 19 5 19H6.2Q7.6 20.9 9.6 22.1Q11.5 23.4 13.8 23.8L14 23.8Q14.4 23.8 14.7 23.5Q15 23.2 15 22.8V1.2Q15 0.7 14.7 0.4Q14.3 0.1 13.8 0.2ZM13 21.5Q11.4 21 10 20Q8.6 18.9 7.6 17.4Q7.4 17 6.8 17H5Q3.8 17 2.9 16.1Q2 15.3 2 14V10Q2 8.7 2.9 7.8Q3.8 7 5 7H6.8Q7.4 7 7.6 6.6Q8.6 5.1 10 4Q11.4 3 13 2.5Z"/></svg>'),
  pushpin: raw('<svg class="fi i-pushpin" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 24Q1.4 24 1.7 23.7L8.3 17.1L9.6 18.4Q10.2 19.1 11.2 19.6Q12.2 20 13.2 20Q13.8 20 14.5 19.8Q15.5 19.4 16.2 18.6Q16.9 17.7 17 16.6Q17.1 15.1 16.7 13.6L16.5 12.6Q16.4 12 16.8 11.6L18.4 10.1Q18.5 9.9 18.6 9.9Q18.7 9.9 18.8 10Q19.5 10.8 20.7 11Q21.8 11.1 22.7 10.5Q23.8 9.6 24 8.2Q24.1 6.9 23.1 5.8L18.2 1Q17.4 0.2 16.3 0Q15.2 -0.1 14.2 0.6Q13.1 1.4 13 2.8Q12.9 4.2 13.9 5.1V5.2Q14.1 5.3 14.1 5.4Q14.1 5.5 13.9 5.6L12.3 7.2Q11.9 7.6 11.4 7.5L10.6 7.3Q9 6.9 7.5 7Q6.4 7.2 5.5 7.9Q4.6 8.6 4.2 9.6Q3.8 10.7 4.1 11.9Q4.3 13 5.2 13.8L7 15.7L0.3 22.3Q0.1 22.5 0 22.8Q0 23.1 0.1 23.4Q0.2 23.7 0.4 23.8Q0.7 24 1 24ZM6.2 10.3Q6.3 9.8 6.8 9.4Q7.2 9.1 7.7 9L8.4 9Q9.3 9 10.1 9.2L10.9 9.4Q11.7 9.6 12.4 9.4Q13.2 9.2 13.8 8.6L15.4 7Q16.1 6.4 16.1 5.4Q16.1 4.5 15.4 3.8L15.3 3.7Q15 3.4 15 2.9Q15 2.5 15.4 2.2Q15.8 2 16.2 2Q16.6 2.1 16.8 2.4L21.7 7.3Q22.1 7.6 22 8.1Q21.9 8.6 21.6 8.8Q21.3 9 20.9 9Q20.5 8.9 20.2 8.6Q19.5 7.9 18.6 7.9Q17.7 7.9 17 8.6L15.4 10.2Q14.8 10.8 14.6 11.5Q14.4 12.2 14.6 13L14.8 14.1Q15.1 15.3 15 16.5Q15 17 14.6 17.4Q14.3 17.8 13.8 17.9Q13 18.1 12.3 17.8Q11.5 17.6 11 17L6.6 12.4Q6.2 12 6 11.4Q5.9 10.9 6.2 10.3Z"/></svg>'),
  pin: raw('<svg class="fi i-pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6Q10.3 6 9.2 7.2Q8 8.3 8 10Q8 11.7 9.2 12.8Q10.3 14 12 14Q13.7 14 14.8 12.8Q16 11.7 16 10Q16 8.3 14.8 7.2Q13.7 6 12 6ZM12 12Q11.2 12 10.6 11.4Q10 10.8 10 10Q10 9.2 10.6 8.6Q11.2 8 12 8Q12.8 8 13.4 8.6Q14 9.2 14 10Q14 10.8 13.4 11.4Q12.8 12 12 12ZM12 24Q10.7 24 9.6 23.4Q8.4 22.9 7.7 21.8Q1.9 13.8 1.9 10.1Q1.9 7.4 3.3 5Q4.6 2.7 7 1.4Q9.3 0 12 0Q14.7 0 17 1.4Q19.4 2.7 20.7 5Q22.1 7.4 22.1 10.1Q22.1 13.8 16.3 21.8Q15.6 22.9 14.4 23.4Q13.3 24 12 24ZM12 2.2Q9.8 2.2 8 3.2Q6.2 4.3 5.2 6.1Q4.2 7.9 4.2 10.1Q4.2 11.6 5.5 14.3Q6.9 17 9.4 20.6Q9.9 21.1 10.6 21.5Q11.3 21.8 12 21.8Q12.7 21.8 13.4 21.5Q14.1 21.1 14.6 20.6Q17.1 17 18.5 14.3Q19.8 11.6 19.8 10.1Q19.8 7.9 18.8 6.1Q17.8 4.3 16 3.2Q14.2 2.2 12 2.2Z"/></svg>'),
  archive: raw('<svg class="fi i-archive" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 0H5Q3.7 0 2.5 0.7Q1.4 1.4 0.7 2.5Q0 3.7 0 5V19Q0 20.3 0.7 21.5Q1.4 22.6 2.5 23.3Q3.7 24 5 24H19Q20.3 24 21.5 23.3Q22.6 22.6 23.3 21.5Q24 20.3 24 19V5Q24 3.7 23.3 2.5Q22.6 1.4 21.5 0.7Q20.3 0 19 0ZM22 5H15V2H19Q20.2 2 21.1 2.9Q22 3.8 22 5ZM11 2H13V7Q13 7.4 12.7 7.7Q12.4 8 12 8Q11.6 8 11.3 7.7Q11 7.4 11 7ZM5 2H9V5H2Q2 3.8 2.9 2.9Q3.8 2 5 2ZM19 22H5Q3.8 22 2.9 21.1Q2 20.2 2 19V7H9Q9 8.2 9.9 9.1Q10.7 10 12 10Q13.3 10 14.2 9.1Q15 8.2 15 7H22V19Q22 20.2 21.1 21.1Q20.2 22 19 22ZM20 19Q20 19.4 19.7 19.7Q19.4 20 19 20H16Q15.6 20 15.3 19.7Q15 19.4 15 19Q15 18.6 15.3 18.3Q15.6 18 16 18H19Q19.4 18 19.7 18.3Q20 18.6 20 19Z"/></svg>'),
  camera: raw('<svg class="fi i-camera" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4H18.5L16.3 1.2Q15.9 0.6 15.3 0.3Q14.6 0 13.9 0H10.1Q9.4 0 8.7 0.3Q8.1 0.6 7.7 1.2L5.5 4H5Q3.7 4 2.5 4.7Q1.4 5.4 0.7 6.5Q0 7.7 0 9V19Q0 20.3 0.7 21.5Q1.4 22.6 2.5 23.3Q3.7 24 5 24H19Q20.3 24 21.5 23.3Q22.6 22.6 23.3 21.5Q24 20.3 24 19V9Q24 7.7 23.3 6.5Q22.6 5.4 21.5 4.7Q20.3 4 19 4ZM9.3 2.4Q9.6 2 10.1 2H13.9Q14.4 2 14.7 2.4L16 4H8ZM22 19Q22 20.2 21.1 21.1Q20.2 22 19 22H5Q3.8 22 2.9 21.1Q2 20.2 2 19V9Q2 7.8 2.9 6.9Q3.8 6 5 6H19Q20.2 6 21.1 6.9Q22 7.8 22 9ZM12 8Q10.4 8 9 8.8Q7.6 9.6 6.8 11Q6 12.4 6 14Q6 15.6 6.8 17Q7.6 18.4 9 19.2Q10.4 20 12 20Q13.6 20 15 19.2Q16.4 18.4 17.2 17Q18 15.6 18 14Q18 12.4 17.2 11Q16.4 9.6 15 8.8Q13.6 8 12 8ZM12 18Q10.3 18 9.2 16.8Q8 15.7 8 14Q8 12.3 9.2 11.2Q10.3 10 12 10Q13.7 10 14.8 11.2Q16 12.3 16 14Q16 15.7 14.8 16.8Q13.7 18 12 18Z"/></svg>'),
  warning: raw('<svg class="fi i-warning" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0Q8.7 0 6 1.6Q3.2 3.2 1.6 6Q0 8.7 0 12Q0 15.3 1.6 18Q3.2 20.8 6 22.4Q8.7 24 12 24Q15.3 24 18 22.4Q20.8 20.8 22.4 18Q24 15.3 24 12Q24 8.7 22.4 6Q20.8 3.2 18 1.6Q15.3 0 12 0ZM12 22Q9.3 22 7 20.6Q4.7 19.3 3.4 17Q2 14.7 2 12Q2 9.3 3.4 7Q4.7 4.7 7 3.4Q9.3 2 12 2Q14.7 2 17 3.4Q19.3 4.7 20.6 7Q22 9.3 22 12Q22 14.7 20.6 17Q19.3 19.3 17 20.6Q14.7 22 12 22ZM12 5Q11.6 5 11.3 5.3Q11 5.6 11 6V14Q11 14.4 11.3 14.7Q11.6 15 12 15Q12.4 15 12.7 14.7Q13 14.4 13 14V6Q13 5.6 12.7 5.3Q12.4 5 12 5ZM12 17Q12.4 17 12.7 17.3Q13 17.6 13 18Q13 18.4 12.7 18.7Q12.4 19 12 19Q11.6 19 11.3 18.7Q11 18.4 11 18Q11 17.6 11.3 17.3Q11.6 17 12 17Z"/></svg>'),
  hourglass: raw('<svg class="fi i-hourglass" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 24H7Q6.2 24 5.4 23.6Q4.6 23.3 4 22.6Q3.4 21.9 3.1 21.1Q2.9 20.3 3 19.4Q3.4 17.3 4.6 15.4Q5.7 13.4 7.4 12Q5.7 10.6 4.6 8.6Q3.4 6.7 3 4.6Q2.9 3.7 3.1 2.9Q3.4 2.1 4 1.4Q4.6 0.7 5.4 0.4Q6.2 0 7 0H17Q17.8 0 18.6 0.4Q19.4 0.7 20 1.4Q20.6 2.1 20.9 2.9Q21.1 3.7 21 4.6Q20.6 6.7 19.4 8.6Q18.3 10.6 16.6 12Q18.2 13.4 19.4 15.4Q20.6 17.3 21 19.4Q21.1 20.3 20.9 21.1Q20.6 21.9 20 22.6Q19.4 23.3 18.6 23.6Q17.8 24 17 24ZM17 2H7Q6.1 2 5.5 2.7Q4.9 3.4 5 4.2Q5.6 8 9.6 11.2Q10 11.5 10 12Q10 12.5 9.6 12.8Q5.6 16 5 19.8Q4.9 20.6 5.5 21.3Q6.1 22 7 22H17Q17.9 22 18.5 21.3Q19.1 20.6 19 19.8Q18.4 16 14.4 12.8Q14 12.5 14 12Q14 11.5 14.4 11.2Q18.4 8 19 4.2Q19.1 3.4 18.5 2.7Q17.9 2 17 2ZM15.7 20H8.3Q7.8 20 7.5 19.6Q7.2 19.1 7.4 18.6Q8.6 16.1 10.9 14.3L11.4 13.9Q11.7 13.8 12 13.8Q12.3 13.8 12.6 13.9L13.1 14.3Q15.4 16.1 16.6 18.6Q16.8 19.1 16.5 19.6Q16.2 20 15.7 20ZM10 18H14Q13.1 16.9 12 16Q10.9 16.9 10 18Z"/></svg>'),
};

// The picture panel behind every + that adds pictures (Discord-style): it slides up from the
// bottom with Camera and Photos tiles, then your recent NUUVI pictures (tap to pick, then Add), and
// a bar of buttons underneath: Photos, Link / GIF, plus anything the chat box adds (content
// warning, formatting…). Camera and Photos open the phone's own camera and photo library (iPhones
// may ask for permission the first time). Websites can't show the whole camera roll inside the
// page, so the grid below shows pictures you've already put on NUUVI.
let sheetSeq = 0;
export function attachSheet({ max = 10, onPictures, extras = [] } = {}) {
  document.querySelector('dialog.sheet')?.remove();
  document.activeElement?.blur?.(); // put the keyboard away first, or it hides the panel
  const n = ++sheetSeq;
  const d = document.createElement('dialog');
  d.className = 'sheet';
  // Real file inputs, opened by <label>s: the dependable way to reach the photo library on iPhones.
  const lib = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, id: `sheet-lib-${n}`, className: 'sheet-file' });
  const cam = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', id: `sheet-cam-${n}`, className: 'sheet-file' });
  cam.setAttribute('capture', 'environment');
  const panel = document.createElement('div');
  panel.className = 'sheet-panel';
  d.append(lib, cam, panel);
  document.body.append(d);
  let recent = null;
  const chosen = [];
  const close = () => { d.classList.add('closing'); setTimeout(() => { if (d.open) d.close(); d.remove(); }, 180); };
  const takeFiles = async (input) => {
    const files = [...input.files].slice(0, max);
    close();
    if (!files.length) return;
    toast(files.length > 1 ? `Uploading ${files.length} pictures…` : 'Uploading…');
    const urls = [];
    for (const file of files) { try { urls.push(await uploadImage(file, 1600)); } catch (err) { toast(err.message); } }
    if (urls.length) onPictures(urls);
  };
  lib.addEventListener('change', () => takeFiles(lib));
  cam.addEventListener('change', () => takeFiles(cam));
  const list = extras.filter(Boolean);
  const draw = () => {
    render(panel, html`
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head"><b>${chosen.length ? `${chosen.length} picked` : 'Add pictures'}</b>
        ${chosen.length ? html`<button type="button" class="primary sm" data-add>Add ${chosen.length}</button>` : html`<button type="button" class="icon-btn sm" data-x aria-label="Close">✕</button>`}</div>
      <div class="sheet-grid">
        <label class="sheet-tile sheet-big" for="sheet-cam-${n}">${icons.camera}<span>Camera</span></label>
        <label class="sheet-tile sheet-big" for="sheet-lib-${n}">${icons.image}<span>Photos</span></label>
        ${recent === null ? [0, 1, 2, 3, 4, 5].map(() => html`<span class="sheet-tile sheet-wait"></span>`)
          : recent.map((u) => { const i = chosen.indexOf(u) + 1; return html`<button type="button" class="sheet-tile sheet-pic ${i ? 'on' : ''}" data-pic="${u}" aria-pressed="${!!i}"><img src="${u}" alt="" loading="lazy"><span class="sheet-check">${i || ''}</span></button>`; })}
        ${recent && !recent.length ? html`<p class="sheet-empty">Tap <b>Photos</b> to pick from your phone or computer. Pictures you've put on NUUVI also show up here.</p>` : ''}
      </div>
      <nav class="sheet-bar">
        <label for="sheet-lib-${n}">${icons.image}<span>Photos</span></label>
        <button type="button" data-link>${icons.link}<span>Link / GIF</span></button>
        ${list.map((x, i) => html`<button type="button" data-extra="${i}">${x.icon || icons.more}<span>${x.label}</span></button>`)}
      </nav>`);
  };
  // Size it from the visible screen (minus the interface zoom), so it never runs off the bottom.
  const fit = () => {
    const z = Number(getComputedStyle(document.documentElement).zoom) || 1;
    const h = (window.visualViewport?.height ?? window.innerHeight) / z;
    d.style.setProperty('--sheet-h', `${Math.round(Math.min(h * 0.74, 660))}px`);
  };
  fit();
  window.visualViewport?.addEventListener('resize', fit);
  d.addEventListener('close', () => window.visualViewport?.removeEventListener('resize', fit));
  draw();
  d.showModal();
  api('/api/uploads/recent').then((r) => { recent = r.pictures; if (d.isConnected) draw(); }).catch(() => { recent = []; if (d.isConnected) draw(); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('click', async (e) => {
    if (e.target === d || e.target.closest('[data-x]')) return close();
    const pic = e.target.closest('[data-pic]');
    if (pic) {
      const i = chosen.indexOf(pic.dataset.pic);
      if (i >= 0) chosen.splice(i, 1); else if (chosen.length < max) chosen.push(pic.dataset.pic); else toast(`Up to ${max} pictures`);
      return draw();
    }
    if (e.target.closest('[data-add]')) { const urls = [...chosen]; close(); return onPictures(urls); }
    if (e.target.closest('[data-link]')) { close(); const u = await askImageLink(); if (u) onPictures([u]); return; }
    const x = e.target.closest('[data-extra]');
    if (x) { close(); list[Number(x.dataset.extra)].action(); }
  });
  // Swipe the panel down to close it.
  let y0 = null;
  d.addEventListener('touchstart', (e) => { y0 = e.target.closest('.sheet-grip, .sheet-head') ? e.touches[0].clientY : null; }, { passive: true });
  d.addEventListener('touchmove', (e) => { if (y0 !== null && e.touches[0].clientY - y0 > 70) { y0 = null; close(); } }, { passive: true });
  return { close };
}

// A small "Jump to latest" button that appears when you've scrolled up a chat, and takes you
// back down to the newest message.
export function jumpToLatest(scroller, { label = 'Jump to latest' } = {}) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jump-latest';
  btn.hidden = true;
  render(btn, html`${icons.chevron}<span>${label}</span>`);
  scroller.parentElement.append(btn);
  const check = () => { btn.hidden = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < Math.min(400, scroller.clientHeight * 0.4); };
  scroller.addEventListener('scroll', check, { passive: true });
  btn.addEventListener('click', () => { scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }); });
  check();
  return check;
}

// The formatting guide: every code with a Copy button (and Insert, when there's a box to put it in).
export const FORMAT_GUIDE = [
  ['Discord style', null],
  ['*action* or _italic_', 'italic action'], ['**bold**', 'bold'], ['***bold italic***', 'both at once'], ['__underline__', 'underline'], ['~~strike~~', 'strikethrough'],
  ['"dialogue"', 'dialogue'], ['||spoiler||', 'hidden until tapped'], ['`code`', 'typewriter text, no formatting inside'],
  ['# Heading', 'big heading (## and ### for smaller ones, at the start of a line)'], ['-# small print', 'small grey text under something'],
  ['> quote', 'a quote (each line that starts with >)'], ['- item', 'a bullet list (1. for numbers), one per line'], ['[text](https://…)', 'a link with your own words'],
  ['@username', 'mention someone'],
  ['HTML', null],
  ['<center>Centered text</center>', 'centered'], ['<div align="right">Right side</div>', 'right (or left)'],
  ['<b>bold</b> <i>italic</i> <u>underline</u>', 'the basics'], ['<s>struck</s>', 'strikethrough'],
  ['<span style="color: #EE719E">pink words</span>', 'any color'], ['<font color="#C79AD8">purple</font>', 'old-school color'],
  ['<hl>highlighted</hl>', 'highlight in your character’s color (the words keep their color)'], ['<mark>highlighted</mark>', 'yellow marker'], ['<small>small print</small>', 'smaller text'], ['<br>', 'a line break'], ['<hr>', 'a divider line'],
  ['<h1>Title</h1>', 'a heading (h2, h3 smaller)'], ['<blockquote>Quote</blockquote>', 'a quote block'],
  ['<a href="https://…">link</a>', 'a link'], ['<img src="https://…/pic.gif">', 'a picture or GIF'],
  ['Forum (Jcink) style', null],
  ['[center]…[/center]', 'centered (can hold paragraphs); also [left] [right]'], ['[indent]…[/indent]', 'indented'],
  ['[box]…[/box]', 'a box in your character’s color'], ['[quote=Name]…[/quote]', 'a quote block, with who said it'],
  ['[list][*]one[*]two[/list]', 'bullet list ([list=1] for numbers)'], ['[h]Heading[/h]', 'a big heading'], ['[hr]', 'a divider line (on its own line)'],
  ['[color=#ff7aa2]…[/color]', 'any color, as a #hex code or a name like red'], ['[hl]…[/hl]', 'highlight in your character’s color'], ['[highlight=yellow]…[/highlight]', 'highlighted, like a marker'],
  ['[size=small]…[/size]', 'small, big or huge (or 1–7)'], ['[font=Verdana]…[/font]', 'Arial, Verdana, Trebuchet, Rounded, Mono, Impact or Comic Sans'],
  ['[caps]…[/caps]', 'ALL CAPS'], ['[spoiler]…[/spoiler]', 'hidden until tapped'], ['[img]https://…[/img]', 'a picture or GIF from a link'],
  ['Ready-made layouts', null],
  ['<center><h2>Title</h2><i>a short tagline</i></center>\n<hr>\nYour text here.', 'a centered title card'],
  ['[box][center][b]NAME[/b]\n[size=small]age · job · city[/size][/center][/box]', 'a character info box'],
  ['<center><span style="color: #EE719E">❝ a quote they said ❞</span></center>', 'a centered colored quote'],
];

export function formattingGuide({ insert = null } = {}) {
  return modal(html`
    <div class="fmt-guide">
      <h2>Formatting</h2>
      <p class="muted small">Tap <b>Copy</b> to grab a code${insert ? html`, or <b>Insert</b> to drop it into your post` : ''}. Mix and match them; formatted words take your character’s color.</p>
      <dl>${FORMAT_GUIDE.map(([code, what], i) => (what === null ? html`<dt class="fmt-sec">${code}</dt>` : html`
        <div class="fmt-row"><dt><code>${code}</code></dt><dd>${what}</dd>
          <span class="fmt-btns"><button type="button" class="sm" data-copy="${i}">Copy</button>${insert ? html`<button type="button" class="sm primary" data-insert="${i}">Insert</button>` : ''}</span></div>`))}</dl>
      <div class="actions end"><button type="button" class="primary" data-close>Done</button></div>
    </div>`, {
    init: (d, close) => d.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) {
        const text = FORMAT_GUIDE[Number(c.dataset.copy)][0];
        try { await navigator.clipboard.writeText(text); c.textContent = 'Copied ✓'; } catch { toast('Couldn’t copy. Press and hold the code to copy it'); }
        setTimeout(() => { c.textContent = 'Copy'; }, 1400);
      }
      const ins = e.target.closest('[data-insert]');
      if (ins) { insert(FORMAT_GUIDE[Number(ins.dataset.insert)][0]); close(null); }
    }),
  });
}

// Typing "@" in a caption or comment suggests characters (by @handle or name); pick one, or keep
// typing the handle in full. Mentions show in NUUVI pink.
// What a character @handle can contain (same rule as the server): anything but spaces, @, # and < > & " ' ` / \.
export const HANDLE_CHAR = '[^\\s\\p{C}@#<>&"\'`/\\\\]';
// The @words in some text, as typed (may carry punctuation after them: "@mina♡!!").
export const mentionTokens = (text) => [...String(text || '').matchAll(new RegExp(`@(${HANDLE_CHAR}{1,60})`, 'gu'))].map((m) => m[1]);
// Which handle an @word means: the whole word, else with punctuation/emoji on the end dropped one by one.
export function resolveMention(token, find) {
  let t = [...token];
  while (t.length) {
    const hit = find(t.join(''));
    if (hit) return hit;
    if (/[\p{L}\p{N}]/u.test(t.at(-1))) return null;
    t = t.slice(0, -1);
  }
  return null;
}

let mentionCache = null;
export function mentionPicker(field) {
  if (!field || field.dataset.mentions) return;
  field.dataset.mentions = '1';
  const list = document.createElement('div');
  list.className = 'mention-list';
  list.hidden = true;
  field.insertAdjacentElement('afterend', list);
  let items = [];
  let active = 0;
  const query = () => {
    const before = field.value.slice(0, field.selectionStart ?? field.value.length);
    const m = before.match(new RegExp(`(^|\\s)@(${HANDLE_CHAR}{0,30})$`, 'u'));
    return m ? { q: m[2].toLowerCase(), start: before.length - m[2].length - 1 } : null;
  };
  const close = () => { list.hidden = true; items = []; };
  const choose = (c) => {
    const q = query();
    if (!q) return close();
    const end = field.selectionStart ?? field.value.length;
    const insert = `@${c.handle} `;
    field.value = field.value.slice(0, q.start) + insert + field.value.slice(end);
    const at = q.start + insert.length;
    field.focus();
    field.setSelectionRange(at, at);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  };
  const draw = () => {
    render(list, html`${items.map((c, i) => html`<button type="button" class="mention-opt ${i === active ? 'on' : ''}" data-i="${i}">
      ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' })}<b>@${c.handle}</b><small>${c.name}${c.npc ? ' · NPC' : ''}</small></button>`)}`);
    list.hidden = !items.length;
  };
  field.addEventListener('input', async () => {
    const q = query();
    if (!q) return close();
    mentionCache ??= api('/api/profiles').then((r) => r.profiles.filter((c) => c.handle)).catch(() => []);
    const all = await mentionCache;
    items = all.filter((c) => c.handle.toLowerCase().startsWith(q.q) || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q.q))).slice(0, 6);
    active = 0;
    draw();
  });
  field.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; draw(); }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); choose(items[active]); }
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  field.addEventListener('blur', () => setTimeout(close, 180));
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(items[Number(b.dataset.i)]); });
}

// Instead of uploading, use a picture that's already online (Pinterest, Tumblr, Imgur…).
// Note: the site hosting the picture can see the addresses of people who view it.
// A Giphy page link (giphy.com/gifs/…-ID) becomes the GIF itself, so it shows as a picture.
export function pictureLink(url) {
  const m = url.match(/^https:\/\/(?:www\.)?giphy\.com\/(?:gifs|stickers)\/(?:[\w-]*-)?([A-Za-z0-9]{6,})\/?(?:[?#].*)?$/);
  return m ? `https://media.giphy.com/media/${m[1]}/giphy.gif` : url;
}

export async function askImageLink(title = 'Use a picture link') {
  const v = await promptModal(title, { label: 'Paste the picture’s or GIF’s web address (Pinterest, Tumblr, Giphy, Tenor…)', placeholder: 'https://i.pinimg.com/…', maxlength: 2000, ok: 'Use picture' });
  if (!v) return null;
  const url = pictureLink(v.trim());
  try { if (new URL(url).protocol === 'https:') return url; } catch { /* not a URL */ }
  toast('That needs to be a picture link starting with https://');
  return null;
}

// Post text as plain words (for previews): formatting codes and markup symbols removed.
export const plainText = (body = '', max = 80) => {
  const t = String(body).replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ').replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, '$1').replace(/^\s*(?:-#|#{1,3}|&gt;&gt;&gt;|>>>|[-•]|\d{1,3}[.)]) /gm, '')
    .replace(/\[\/?(?:center|right|left|align|box|h|hr|indent|quote|list|code|color|highlight|size|font|caps|spoiler|sup|sub|strike|url|b|i|u|s|\*)(?:=[^\]]*)?\]/gi, ' ').replace(/\|\||[*_~`>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// ---------- Translation ----------
// Shows "See translation" only on text that doesn't look like English. Uses the browser's own
// on-device translator where there is one (recent Chrome), otherwise opens Google Translate.
const FOREIGN_SCRIPT = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Greek}]/u;
const FOREIGN_WORDS = new Set('que de el la los las por para con una pero muy est une des avec pas mais pour und der die das nicht ist ich du não você muito está obrigado che sono non della kamu aku yang dan tidak ang mga naman siya ako ikaw'.split(' '));
const ENGLISH_WORDS = new Set('the and you i is it to of a in that this for my me so be are was on with what just like love omg lol'.split(' '));
export function looksForeign(text = '') {
  const t = String(text);
  if (FOREIGN_SCRIPT.test(t)) return true;
  const words = t.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 2) return false;
  const foreign = words.filter((w) => FOREIGN_WORDS.has(w)).length;
  const english = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  return foreign >= 2 && foreign > english;
}
// ---------- Writing tools (Claude) ----------
// Whether the site has Claude switched on (an Anthropic API key). Asked once per visit.
let aiOn = null;
export function aiEnabled() {
  aiOn ??= api('/api/ai/status').then((r) => r.enabled).catch(() => false);
  return aiOn;
}

// "Check my writing": Claude fixes spelling and grammar in a text box (keeping the writer's voice and
// any formatting codes), then shows the result to look over before it replaces what was written.
export async function checkWriting(field) {
  const original = field.value;
  if (!original.trim()) { toast('Write something first'); return; }
  toast('Checking your writing…');
  let out;
  try { out = await api('/api/ai/check', { method: 'POST', body: { text: original } }); } catch (err) { toast(err.message); return; }
  if (!out.changed) { toast('Looks good! Nothing to fix.'); return; }
  const res = await modal(html`<form class="ai-check">
    <h2>${icons.sparkles} Checked</h2>
    ${out.changes.length ? html`<ul class="ai-changes">${out.changes.map((c) => html`<li>${c}</li>`)}</ul>` : ''}
    <label for="ai-text">Your writing, fixed <small class="muted">(you can still change it)</small></label>
    <textarea id="ai-text" name="text" rows="8">${out.text}</textarea>
    <div class="actions end"><button type="button" data-close>Keep mine</button><button type="submit" class="primary">Use this</button></div>
  </form>`);
  if (!res) return;
  field.value = res.text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.focus();
}

export async function translateText(text) {
  if (await aiEnabled()) {
    try { return (await api('/api/ai/translate', { method: 'POST', body: { text } })).text; } catch (err) { toast(err.message); return null; }
  }
  try {
    if ('LanguageDetector' in self && 'Translator' in self) {
      const detector = await self.LanguageDetector.create();
      const [best] = await detector.detect(text);
      const from = best?.detectedLanguage;
      if (from && from !== 'en' && from !== 'und') {
        const translator = await self.Translator.create({ sourceLanguage: from, targetLanguage: 'en' });
        return await translator.translate(text);
      }
    }
  } catch { /* fall through to Google Translate */ }
  window.open(`https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  return null;
}

// ---------- Picture viewer ----------
// Pictures people send open full-screen inside NUUVI (not a new tab). Several pictures in one
// message can be flipped through with the arrows, a swipe, or the arrow keys.
export function openLightbox(urls, start = 0) {
  if (!urls.length) return;
  let i = Math.max(0, Math.min(start, urls.length - 1));
  document.querySelector('.lightbox')?.remove();
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Picture');
  const draw = () => render(box, html`
    <button type="button" class="lb-close" data-lb="close" aria-label="Close">✕</button>
    ${urls.length > 1 ? html`<span class="lb-count">${i + 1} / ${urls.length}</span>
      <button type="button" class="lb-nav prev" data-lb="prev" aria-label="Previous" ${i === 0 ? 'hidden' : ''}>${icons.chevron}</button>
      <button type="button" class="lb-nav next" data-lb="next" aria-label="Next" ${i === urls.length - 1 ? 'hidden' : ''}>${icons.chevron}</button>` : ''}
    <img class="lb-img" src="${urls[i]}" alt="">
    <a class="lb-open" href="${urls[i]}" target="_blank" rel="noopener noreferrer">Open original</a>`);
  const go = (d) => { const n = i + d; if (n >= 0 && n < urls.length) { i = n; draw(); } };
  const close = () => { box.classList.add('out'); document.removeEventListener('keydown', onKey); setTimeout(() => box.remove(), 180); };
  const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lb]');
    if (b) { e.preventDefault(); if (b.dataset.lb === 'close') close(); else go(b.dataset.lb === 'next' ? 1 : -1); return; }
    if (e.target === box) close();
  });
  let sx = null;
  box.addEventListener('touchstart', (e) => { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    sx = null;
  });
  document.addEventListener('keydown', onKey);
  draw();
  document.body.append(box);
}
