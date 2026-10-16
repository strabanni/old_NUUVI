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
  // Every icon is from Phosphor (phosphor-icons.com, MIT licence), Light weight: thin and simple like
  // Figma's own toolbar icons (Fill for the liked heart, the star and the verified badge).
  menu: raw('<svg class="fi i-menu" viewBox="0 0 256 256" aria-hidden="true"><path d="M222,128a6,6,0,0,1-6,6H40a6,6,0,0,1,0-12H216A6,6,0,0,1,222,128ZM40,70H216a6,6,0,0,0,0-12H40a6,6,0,0,0,0,12ZM216,186H40a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12Z"/></svg>'),
  apps: raw('<svg class="fi i-apps" viewBox="0 0 256 256" aria-hidden="true"><path d="M104,42H56A14,14,0,0,0,42,56v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V56A14,14,0,0,0,104,42Zm2,62a2,2,0,0,1-2,2H56a2,2,0,0,1-2-2V56a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Zm94-62H152a14,14,0,0,0-14,14v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V56A14,14,0,0,0,200,42Zm2,62a2,2,0,0,1-2,2H152a2,2,0,0,1-2-2V56a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Zm-98,34H56a14,14,0,0,0-14,14v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V152A14,14,0,0,0,104,138Zm2,62a2,2,0,0,1-2,2H56a2,2,0,0,1-2-2V152a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Zm94-62H152a14,14,0,0,0-14,14v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V152A14,14,0,0,0,200,138Zm2,62a2,2,0,0,1-2,2H152a2,2,0,0,1-2-2V152a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Z"/></svg>'),
  user: raw('<svg class="fi i-user" viewBox="0 0 256 256" aria-hidden="true"><path d="M229.19,213c-15.81-27.32-40.63-46.49-69.47-54.62a70,70,0,1,0-63.44,0C67.44,166.5,42.62,185.67,26.81,213a6,6,0,1,0,10.38,6C56.4,185.81,90.34,166,128,166s71.6,19.81,90.81,53a6,6,0,1,0,10.38-6ZM70,96a58,58,0,1,1,58,58A58.07,58.07,0,0,1,70,96Z"/></svg>'),
  userAdd: raw('<svg class="fi i-userAdd" viewBox="0 0 256 256" aria-hidden="true"><path d="M254,136a6,6,0,0,1-6,6H230v18a6,6,0,0,1-12,0V142H200a6,6,0,0,1,0-12h18V112a6,6,0,0,1,12,0v18h18A6,6,0,0,1,254,136Zm-57.41,60.14a6,6,0,1,1-9.18,7.72C166.9,179.45,138.69,166,108,166s-58.89,13.45-79.41,37.86a6,6,0,0,1-9.18-7.72C35.14,177.41,55,164.48,77,158.25a66,66,0,1,1,62,0C161,164.48,180.86,177.41,196.59,196.14ZM108,154a54,54,0,1,0-54-54A54.06,54.06,0,0,0,108,154Z"/></svg>'),
  power: raw('<svg class="fi i-power" viewBox="0 0 256 256" aria-hidden="true"><path d="M122,128V48a6,6,0,0,1,12,0v80a6,6,0,0,1-12,0Zm57.28-77A6,6,0,0,0,172.72,61C196.41,76.47,210,100.88,210,128a82,82,0,0,1-164,0c0-27.12,13.59-51.53,37.28-67A6,6,0,0,0,76.72,51C49.57,68.68,34,96.75,34,128a94,94,0,0,0,188,0C222,96.75,206.43,68.68,179.28,51Z"/></svg>'),
  fingerprint: raw('<svg class="fi i-fingerprint" viewBox="0 0 256 256" aria-hidden="true"><path d="M70,128a132.68,132.68,0,0,1-14,59.58,6,6,0,0,1-5.38,3.33,6,6,0,0,1-5.36-8.67A120.74,120.74,0,0,0,58,128,69.72,69.72,0,0,1,84.25,73.36a6,6,0,0,1,7.51,9.37A57.73,57.73,0,0,0,70,128Zm58-6a6,6,0,0,0-6,6,186.07,186.07,0,0,1-23.23,90.07,6,6,0,0,0,10.5,5.82A198.14,198.14,0,0,0,134,128,6,6,0,0,0,128,122Zm0-32a38,38,0,0,0-38,38,6,6,0,0,0,12,0,26,26,0,0,1,52,0,216.06,216.06,0,0,1-20.71,92.85A6,6,0,1,0,144.16,226,227.94,227.94,0,0,0,166,128,38,38,0,0,0,128,90Zm0-64A102.11,102.11,0,0,0,26,128a90,90,0,0,1-5.12,30,6,6,0,1,0,11.31,4A101.83,101.83,0,0,0,38,128a90,90,0,0,1,180,0,284.7,284.7,0,0,1-5.33,54.84,6,6,0,0,0,4.72,7.05,6.8,6.8,0,0,0,1.17.11,6,6,0,0,0,5.88-4.84A295.92,295.92,0,0,0,230,128,102.12,102.12,0,0,0,128,26ZM94,154.13a6,6,0,0,0-7.07,4.69,152.82,152.82,0,0,1-17.44,46,6,6,0,0,0,10.4,6,164.77,164.77,0,0,0,18.8-49.65A6,6,0,0,0,94,154.13ZM128,58a70.76,70.76,0,0,0-8.75.54,6,6,0,1,0,1.49,11.91A58,58,0,0,1,186,128a252.27,252.27,0,0,1-1.94,31.26,6,6,0,0,0,5.21,6.69,6.59,6.59,0,0,0,.75,0,6,6,0,0,0,5.95-5.26A266.46,266.46,0,0,0,198,128,70.08,70.08,0,0,0,128,58ZM185.44,186.2a6,6,0,0,0-7.31,4.31c-1.47,5.74-3.18,11.49-5.06,17.09a6,6,0,0,0,11.38,3.82c2-5.88,3.75-11.9,5.3-17.92A6,6,0,0,0,185.44,186.2Z"/></svg>'),
  music: raw('<svg class="fi i-music" viewBox="0 0 256 256" aria-hidden="true"><path d="M211.69,19.27a6,6,0,0,0-5.15-1.09l-128,32A6,6,0,0,0,74,56V170.11A34,34,0,1,0,86,196V108.68l116-29v58.43A34,34,0,1,0,214,164V24A6,6,0,0,0,211.69,19.27ZM52,218a22,22,0,1,1,22-22A22,22,0,0,1,52,218ZM86,96.32V60.68l116-29V67.32ZM180,186a22,22,0,1,1,22-22A22,22,0,0,1,180,186Z"/></svg>'),
  // Drawn a little inside its box so it sits level with the text beside it.
  episode: raw('<svg class="fi i-episode" viewBox="0 0 256 256" aria-hidden="true"><path d="M231.36,116.19,87.28,28.06a14,14,0,0,0-14.18-.27A13.69,13.69,0,0,0,66,39.87V216.13a13.69,13.69,0,0,0,7.1,12.08,14,14,0,0,0,14.18-.27l144.08-88.13a13.82,13.82,0,0,0,0-23.62Zm-6.26,13.38L81,217.7a2,2,0,0,1-2.06,0,1.78,1.78,0,0,1-1-1.61V39.87a1.78,1.78,0,0,1,1-1.61A2.06,2.06,0,0,1,80,38a2,2,0,0,1,1,.31L225.1,126.43a1.82,1.82,0,0,1,0,3.14Z"/></svg>'),
  sparkle: raw('<svg class="fi i-sparkle" viewBox="0 0 256 256" aria-hidden="true"><path d="M196.89,130.94,144.4,111.6,125.06,59.11a13.92,13.92,0,0,0-26.12,0L79.6,111.6,27.11,130.94a13.92,13.92,0,0,0,0,26.12L79.6,176.4l19.34,52.49a13.92,13.92,0,0,0,26.12,0L144.4,176.4l52.49-19.34a13.92,13.92,0,0,0,0-26.12Zm-4.15,14.86-55.08,20.3a6,6,0,0,0-3.56,3.56l-20.3,55.08a1.92,1.92,0,0,1-3.6,0L89.9,169.66a6,6,0,0,0-3.56-3.56L31.26,145.8a1.92,1.92,0,0,1,0-3.6l55.08-20.3a6,6,0,0,0,3.56-3.56l20.3-55.08a1.92,1.92,0,0,1,3.6,0l20.3,55.08a6,6,0,0,0,3.56,3.56l55.08,20.3a1.92,1.92,0,0,1,0,3.6ZM146,40a6,6,0,0,1,6-6h18V16a6,6,0,0,1,12,0V34h18a6,6,0,0,1,0,12H182V64a6,6,0,0,1-12,0V46H152A6,6,0,0,1,146,40ZM246,88a6,6,0,0,1-6,6H230v10a6,6,0,0,1-12,0V94H208a6,6,0,0,1,0-12h10V72a6,6,0,0,1,12,0V82h10A6,6,0,0,1,246,88Z"/></svg>'),
  users: raw('<svg class="fi i-users" viewBox="0 0 256 256" aria-hidden="true"><path d="M112.6,158.43a58,58,0,1,0-57.2,0A93.83,93.83,0,0,0,5.21,196.72a6,6,0,0,0,10.05,6.56,82,82,0,0,1,137.48,0,6,6,0,0,0,10-6.56A93.83,93.83,0,0,0,112.6,158.43ZM38,108a46,46,0,1,1,46,46A46.06,46.06,0,0,1,38,108Zm211,97a6,6,0,0,1-8.3-1.74A81.8,81.8,0,0,0,172,166a6,6,0,0,1,0-12,46,46,0,1,0-17.08-88.73,6,6,0,1,1-4.46-11.14,58,58,0,0,1,50.14,104.3,93.83,93.83,0,0,1,50.19,38.29A6,6,0,0,1,249,205Z"/></svg>'),
  home: raw('<svg class="fi i-home" viewBox="0 0 256 256" aria-hidden="true"><path d="M217.9,110.1l-80-80a14,14,0,0,0-19.8,0l-80,80A13.92,13.92,0,0,0,34,120v96a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V158h36v58a6,6,0,0,0,6,6h64a6,6,0,0,0,6-6V120A13.92,13.92,0,0,0,217.9,110.1ZM210,210H158V152a6,6,0,0,0-6-6H104a6,6,0,0,0-6,6v58H46V120a2,2,0,0,1,.58-1.42l80-80a2,2,0,0,1,2.84,0l80,80A2,2,0,0,1,210,120Z"/></svg>'),
  bell: raw('<svg class="fi i-bell" viewBox="0 0 256 256" aria-hidden="true"><path d="M220.07,176.94C214.41,167.2,206,139.73,206,104a78,78,0,1,0-156,0c0,35.74-8.42,63.2-14.08,72.94A14,14,0,0,0,48,198H90.48a38,38,0,0,0,75,0H208a14,14,0,0,0,12.06-21.06ZM128,218a26,26,0,0,1-25.29-20h50.58A26,26,0,0,1,128,218Zm81.71-33a1.9,1.9,0,0,1-1.7,1H48a1.9,1.9,0,0,1-1.7-1,2,2,0,0,1,0-2C53.87,170,62,139.69,62,104a66,66,0,1,1,132,0c0,35.68,8.14,65.95,15.71,79A2,2,0,0,1,209.71,185Z"/></svg>'),
  compass: raw('<svg class="fi i-compass" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218ZM173.32,74.63l-64,32a6,6,0,0,0-2.69,2.69l-32,64A6,6,0,0,0,80,182a6.06,6.06,0,0,0,2.68-.63l64-32a6,6,0,0,0,2.69-2.69l32-64a6,6,0,0,0-8.05-8.05Zm-33.79,64.9L93.42,162.58l23-46.11,46.11-23Z"/></svg>'),
  refresh: raw('<svg class="fi i-refresh" viewBox="0 0 256 256" aria-hidden="true"><path d="M238,56v48a6,6,0,0,1-6,6H184a6,6,0,0,1,0-12h32.55l-30.38-27.8c-.06-.06-.12-.13-.19-.19a82,82,0,1,0-1.7,117.65,6,6,0,0,1,8.24,8.73A93.46,93.46,0,0,1,128,222h-1.28A94,94,0,1,1,194.37,61.4L226,90.35V56a6,6,0,1,1,12,0Z"/></svg>'),
  plus: raw('<svg class="fi i-plus" viewBox="0 0 256 256" aria-hidden="true"><path d="M222,128a6,6,0,0,1-6,6H134v82a6,6,0,0,1-12,0V134H40a6,6,0,0,1,0-12h82V40a6,6,0,0,1,12,0v82h82A6,6,0,0,1,222,128Z"/></svg>'),
  sparkles: raw('<svg class="fi i-sparkles" viewBox="0 0 256 256" aria-hidden="true"><path d="M196.89,130.94,144.4,111.6,125.06,59.11a13.92,13.92,0,0,0-26.12,0L79.6,111.6,27.11,130.94a13.92,13.92,0,0,0,0,26.12L79.6,176.4l19.34,52.49a13.92,13.92,0,0,0,26.12,0L144.4,176.4l52.49-19.34a13.92,13.92,0,0,0,0-26.12Zm-4.15,14.86-55.08,20.3a6,6,0,0,0-3.56,3.56l-20.3,55.08a1.92,1.92,0,0,1-3.6,0L89.9,169.66a6,6,0,0,0-3.56-3.56L31.26,145.8a1.92,1.92,0,0,1,0-3.6l55.08-20.3a6,6,0,0,0,3.56-3.56l20.3-55.08a1.92,1.92,0,0,1,3.6,0l20.3,55.08a6,6,0,0,0,3.56,3.56l55.08,20.3a1.92,1.92,0,0,1,0,3.6ZM146,40a6,6,0,0,1,6-6h18V16a6,6,0,0,1,12,0V34h18a6,6,0,0,1,0,12H182V64a6,6,0,0,1-12,0V46H152A6,6,0,0,1,146,40ZM246,88a6,6,0,0,1-6,6H230v10a6,6,0,0,1-12,0V94H208a6,6,0,0,1,0-12h10V72a6,6,0,0,1,12,0V82h10A6,6,0,0,1,246,88Z"/></svg>'),
  layout: raw('<svg class="fi i-layout" viewBox="0 0 256 256" aria-hidden="true"><path d="M216,42H40A14,14,0,0,0,26,56V200a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A14,14,0,0,0,216,42ZM40,54H216a2,2,0,0,1,2,2V98H38V56A2,2,0,0,1,40,54ZM38,200V110H98v92H40A2,2,0,0,1,38,200Zm178,2H110V110H218v90A2,2,0,0,1,216,202Z"/></svg>'),
  mask: raw('<svg class="fi i-mask" viewBox="0 0 256 256" aria-hidden="true"><path d="M188.47,124a6,6,0,1,1-8.94,8c-3.06-3.42-9.74-6-15.53-6s-12.47,2.58-15.53,6a6,6,0,0,1-8.94-8c5.35-6,15.19-10,24.47-10S183.12,118,188.47,124Zm-80.94,8a6,6,0,1,0,8.94-8c-5.35-6-15.19-10-24.47-10s-19.12,4-24.47,10a6,6,0,1,0,8.94,8c3.06-3.42,9.74-6,15.53-6S104.47,128.58,107.53,132Zm58.73,31.43a6,6,0,0,0-8.46.67,38.89,38.89,0,0,1-59.6,0,6,6,0,1,0-9.13,7.79,50.9,50.9,0,0,0,77.86,0A6,6,0,0,0,166.26,163.43ZM222,48v55.77c0,35.45-9.53,68.86-26.83,94.06C177.4,223.74,153.54,238,128,238s-49.4-14.26-67.17-40.16C43.53,172.64,34,139.23,34,103.78V48A14,14,0,0,1,53.06,35C67.25,40.46,95.86,49.7,128,49.7S188.75,40.46,202.94,35A14,14,0,0,1,222,48Zm-12,0a2,2,0,0,0-.87-1.66,1.93,1.93,0,0,0-1.85-.21C192.31,52,162.1,61.7,128,61.7S63.69,52,48.72,46.14a2,2,0,0,0-1.85.21A2,2,0,0,0,46,48v55.76C46,171.17,82.79,226,128,226s82-54.83,82-122.22Z"/></svg>'),
  gear: raw('<svg class="fi i-gear" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,82a46,46,0,1,0,46,46A46.06,46.06,0,0,0,128,82Zm0,80a34,34,0,1,1,34-34A34,34,0,0,1,128,162Zm108-54.4a6,6,0,0,0-2.92-4L202.64,86.22l-.42-.71L202.1,51.2A6,6,0,0,0,200,46.64a110.12,110.12,0,0,0-36.07-20.31,6,6,0,0,0-4.84.45L128.46,43.86h-1L96.91,26.76a6,6,0,0,0-4.86-.44A109.92,109.92,0,0,0,56,46.68a6,6,0,0,0-2.12,4.55l-.16,34.34c-.14.23-.28.47-.41.71L22.91,103.57A6,6,0,0,0,20,107.62a104.81,104.81,0,0,0,0,40.78,6,6,0,0,0,2.92,4l30.42,17.33.42.71.12,34.31A6,6,0,0,0,56,209.36a110.12,110.12,0,0,0,36.07,20.31,6,6,0,0,0,4.84-.45l30.61-17.08h1l30.56,17.1A6.09,6.09,0,0,0,162,230a5.83,5.83,0,0,0,1.93-.32,109.92,109.92,0,0,0,36-20.36,6,6,0,0,0,2.12-4.55l.16-34.34c.14-.23.28-.47.41-.71l30.42-17.29a6,6,0,0,0,2.92-4.05A104.81,104.81,0,0,0,236,107.6Zm-11.25,35.79L195.32,160.1a6.07,6.07,0,0,0-2.28,2.3c-.59,1-1.21,2.11-1.86,3.14a6,6,0,0,0-.91,3.16l-.16,33.21a98.15,98.15,0,0,1-27.52,15.53L133,200.88a6,6,0,0,0-2.93-.77h-.14c-1.24,0-2.5,0-3.74,0a6,6,0,0,0-3.07.76L93.45,217.43a98,98,0,0,1-27.56-15.49l-.12-33.17a6,6,0,0,0-.91-3.16c-.64-1-1.27-2.08-1.86-3.14a6,6,0,0,0-2.27-2.3L31.3,143.4a93,93,0,0,1,0-30.79L60.68,95.9A6.07,6.07,0,0,0,63,93.6c.59-1,1.21-2.11,1.86-3.14a6,6,0,0,0,.91-3.16l.16-33.21A98.15,98.15,0,0,1,93.41,38.56L123,55.12a5.81,5.81,0,0,0,3.07.76c1.24,0,2.5,0,3.74,0a6,6,0,0,0,3.07-.76l29.65-16.56a98,98,0,0,1,27.56,15.49l.12,33.17a6,6,0,0,0,.91,3.16c.64,1,1.27,2.08,1.86,3.14a6,6,0,0,0,2.27,2.3L224.7,112.6A93,93,0,0,1,224.73,143.39Z"/></svg>'),
  shield: raw('<svg class="fi i-shield" viewBox="0 0 256 256" aria-hidden="true"><path d="M208,42H48A14,14,0,0,0,34,56v56c0,51.94,25.12,83.4,46.2,100.64,22.73,18.6,45.27,24.89,46.22,25.15a6,6,0,0,0,3.16,0c.95-.26,23.49-6.55,46.22-25.15C196.88,195.4,222,163.94,222,112V56A14,14,0,0,0,208,42Zm2,70c0,37.76-13.94,68.39-41.44,91.06A131.17,131.17,0,0,1,128,225.72a130.94,130.94,0,0,1-40.56-22.66C59.94,180.39,46,149.76,46,112V56a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Z"/></svg>'),
  send: raw('<svg class="fi i-send" viewBox="0 0 256 256" aria-hidden="true"><path d="M225.88,30.12a13.83,13.83,0,0,0-13.7-3.58l-.11,0L20.14,84.77A14,14,0,0,0,18,110.85l85.56,41.64L145.12,238a13.87,13.87,0,0,0,12.61,8c.4,0,.81,0,1.21-.05a13.9,13.9,0,0,0,12.29-10.09l58.2-191.93,0-.11A13.83,13.83,0,0,0,225.88,30.12Zm-8,10.4L159.73,232.43l0,.11a2,2,0,0,1-3.76.26l-40.68-83.58,49-49a6,6,0,1,0-8.49-8.49l-49,49L23.15,100a2,2,0,0,1,.31-3.74l.11,0L215.48,38.08a1.94,1.94,0,0,1,1.92.52A2,2,0,0,1,217.92,40.52Z"/></svg>'),
  warn: raw('<svg class="fi i-warn" viewBox="0 0 256 256" aria-hidden="true"><path d="M235.07,189.09,147.61,37.22h0a22.75,22.75,0,0,0-39.22,0L20.93,189.09a21.53,21.53,0,0,0,0,21.72A22.35,22.35,0,0,0,40.55,222h174.9a22.35,22.35,0,0,0,19.6-11.19A21.53,21.53,0,0,0,235.07,189.09ZM224.66,204.8a10.46,10.46,0,0,1-9.21,5.2H40.55a10.46,10.46,0,0,1-9.21-5.2,9.51,9.51,0,0,1,0-9.72L118.79,43.21a10.75,10.75,0,0,1,18.42,0l87.46,151.87A9.51,9.51,0,0,1,224.66,204.8ZM122,144V104a6,6,0,0,1,12,0v40a6,6,0,0,1-12,0Zm16,36a10,10,0,1,1-10-10A10,10,0,0,1,138,180Z"/></svg>'),
  more: raw('<svg class="fi i-more" viewBox="0 0 256 256" aria-hidden="true"><path d="M138,128a10,10,0,1,1-10-10A10,10,0,0,1,138,128ZM60,118a10,10,0,1,0,10,10A10,10,0,0,0,60,118Zm136,0a10,10,0,1,0,10,10A10,10,0,0,0,196,118Z"/></svg>'),
  hash: raw('<svg class="fi i-hash" viewBox="0 0 256 256" aria-hidden="true"><path d="M224,90H173l8.89-48.93a6,6,0,1,0-11.8-2.14L160.81,90H109l8.89-48.93a6,6,0,0,0-11.8-2.14L96.81,90H48a6,6,0,0,0,0,12H94.63l-9.46,52H32a6,6,0,0,0,0,12H83L74.1,214.93a6,6,0,0,0,4.83,7A5.64,5.64,0,0,0,80,222a6,6,0,0,0,5.89-4.93L95.19,166H147l-8.89,48.93a6,6,0,0,0,4.83,7,5.64,5.64,0,0,0,1.08.1,6,6,0,0,0,5.89-4.93L159.19,166H208a6,6,0,0,0,0-12H161.37l9.46-52H224a6,6,0,0,0,0-12Zm-74.83,64H97.37l9.46-52h51.8Z"/></svg>'),
  chevron: raw('<svg class="fi i-chevron" viewBox="0 0 256 256" aria-hidden="true"><path d="M212.24,100.24l-80,80a6,6,0,0,1-8.48,0l-80-80a6,6,0,0,1,8.48-8.48L128,167.51l75.76-75.75a6,6,0,0,1,8.48,8.48Z"/></svg>'),
  back: raw('<svg class="fi i-back" viewBox="0 0 256 256" aria-hidden="true"><path d="M164.24,203.76a6,6,0,1,1-8.48,8.48l-80-80a6,6,0,0,1,0-8.48l80-80a6,6,0,0,1,8.48,8.48L88.49,128Z"/></svg>'),
  sun: raw('<svg class="fi i-sun" viewBox="0 0 256 256" aria-hidden="true"><path d="M122,40V16a6,6,0,0,1,12,0V40a6,6,0,0,1-12,0Zm68,88a62,62,0,1,1-62-62A62.07,62.07,0,0,1,190,128Zm-12,0a50,50,0,1,0-50,50A50.06,50.06,0,0,0,178,128ZM59.76,68.24a6,6,0,1,0,8.48-8.48l-16-16a6,6,0,0,0-8.48,8.48Zm0,119.52-16,16a6,6,0,1,0,8.48,8.48l16-16a6,6,0,1,0-8.48-8.48ZM192,70a6,6,0,0,0,4.24-1.76l16-16a6,6,0,0,0-8.48-8.48l-16,16A6,6,0,0,0,192,70Zm4.24,117.76a6,6,0,0,0-8.48,8.48l16,16a6,6,0,0,0,8.48-8.48ZM46,128a6,6,0,0,0-6-6H16a6,6,0,0,0,0,12H40A6,6,0,0,0,46,128Zm82,82a6,6,0,0,0-6,6v24a6,6,0,0,0,12,0V216A6,6,0,0,0,128,210Zm112-88H216a6,6,0,0,0,0,12h24a6,6,0,0,0,0-12Z"/></svg>'),
  moon: raw('<svg class="fi i-moon" viewBox="0 0 256 256" aria-hidden="true"><path d="M232.13,143.64a6,6,0,0,0-6-1.49A90.07,90.07,0,0,1,113.86,29.85a6,6,0,0,0-7.49-7.48A102.88,102.88,0,0,0,54.48,58.68,102,102,0,0,0,197.32,201.52a102.88,102.88,0,0,0,36.31-51.89A6,6,0,0,0,232.13,143.64Zm-42,48.29a90,90,0,0,1-126-126A90.9,90.9,0,0,1,99.65,37.66,102.06,102.06,0,0,0,218.34,156.35,90.9,90.9,0,0,1,190.1,191.93Z"/></svg>'),
  sliders: raw('<svg class="fi i-sliders" viewBox="0 0 256 256" aria-hidden="true"><path d="M40,86H74.6a30,30,0,0,0,58.8,0H216a6,6,0,0,0,0-12H133.4a30,30,0,0,0-58.8,0H40a6,6,0,0,0,0,12Zm64-24A18,18,0,1,1,86,80,18,18,0,0,1,104,62ZM216,170H197.4a30,30,0,0,0-58.8,0H40a6,6,0,0,0,0,12h98.6a30,30,0,0,0,58.8,0H216a6,6,0,0,0,0-12Zm-48,24a18,18,0,1,1,18-18A18,18,0,0,1,168,194Z"/></svg>'),
  logout: raw('<svg class="fi i-logout" viewBox="0 0 256 256" aria-hidden="true"><path d="M118,216a6,6,0,0,1-6,6H48a6,6,0,0,1-6-6V40a6,6,0,0,1,6-6h64a6,6,0,0,1,0,12H54V210h58A6,6,0,0,1,118,216Zm110.24-92.24-40-40a6,6,0,0,0-8.48,8.48L209.51,122H112a6,6,0,0,0,0,12h97.51l-29.75,29.76a6,6,0,1,0,8.48,8.48l40-40A6,6,0,0,0,228.24,123.76Z"/></svg>'),
  quill: raw('<svg class="fi i-quill" viewBox="0 0 256 256" aria-hidden="true"><path d="M246,92.68a13.94,13.94,0,0,0-4.1-9.9L173.21,14.1a14,14,0,0,0-19.8,0L124.68,42.83,66.22,64.76a14,14,0,0,0-8.9,10.8L34.08,215A6,6,0,0,0,40,222a6.61,6.61,0,0,0,1-.08l139.44-23.24a14,14,0,0,0,10.81-8.9l21.92-58.46,28.74-28.74A13.92,13.92,0,0,0,246,92.68Zm-66,92.89a2,2,0,0,1-1.54,1.27L57.49,207l52.87-52.88a26,26,0,1,0-8.48-8.48L49,198.53l20.17-121A2,2,0,0,1,70.43,76l56.06-21L201,129.51ZM110,132a14,14,0,1,1,14,14A14,14,0,0,1,110,132ZM233.41,94.1,208,119.51,136.48,48,161.9,22.58a2,2,0,0,1,2.83,0l68.68,68.69a2,2,0,0,1,0,2.83Z"/></svg>'),
  chat: raw('<svg class="fi i-chat" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,26A102,102,0,0,0,38.35,176.69L26.73,211.56a14,14,0,0,0,17.71,17.71l34.87-11.62A102,102,0,1,0,128,26Zm0,192a90,90,0,0,1-45.06-12.08,6.09,6.09,0,0,0-3-.81,6.2,6.2,0,0,0-1.9.31L40.65,217.88a2,2,0,0,1-2.53-2.53L50.58,178a6,6,0,0,0-.5-4.91A90,90,0,1,1,128,218Z"/></svg>'),
  calendar: raw('<svg class="fi i-calendar" viewBox="0 0 256 256" aria-hidden="true"><path d="M208,34H182V24a6,6,0,0,0-12,0V34H86V24a6,6,0,0,0-12,0V34H48A14,14,0,0,0,34,48V208a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V48A14,14,0,0,0,208,34ZM48,46H74V56a6,6,0,0,0,12,0V46h84V56a6,6,0,0,0,12,0V46h26a2,2,0,0,1,2,2V82H46V48A2,2,0,0,1,48,46ZM208,210H48a2,2,0,0,1-2-2V94H210V208A2,2,0,0,1,208,210Z"/></svg>'),
  crown: raw('<svg class="fi i-crown" viewBox="0 0 256 256" aria-hidden="true"><path d="M246,80a26,26,0,1,0-46.6,15.84l-29.83,36.72-26-59.76a26,26,0,1,0-31.16,0l-26,59.76L56.6,95.84a26,26,0,1,0-22.36,10.09L49,194.3A14,14,0,0,0,62.78,206H193.22A14,14,0,0,0,207,194.3l14.73-88.37A26,26,0,0,0,246,80ZM128,38a14,14,0,1,1-14,14A14,14,0,0,1,128,38ZM22,80A14,14,0,1,1,36,94,14,14,0,0,1,22,80ZM195.2,192.33a2,2,0,0,1-2,1.67H62.78a2,2,0,0,1-2-1.67L46.08,104l1.22-.55,36,44.36A6,6,0,0,0,88,150a5.52,5.52,0,0,0,.81-.06,6,6,0,0,0,4.69-3.55l29.92-68.8a25.79,25.79,0,0,0,9.16,0l29.92,68.8a6,6,0,0,0,4.69,3.55,5.52,5.52,0,0,0,.81.06,6,6,0,0,0,4.66-2.22l36-44.36,1.22.55ZM220,94a14,14,0,1,1,14-14A14,14,0,0,1,220,94Z"/></svg>'),
  link: raw('<svg class="fi i-link" viewBox="0 0 256 256" aria-hidden="true"><path d="M238,88.18a52.42,52.42,0,0,1-15.4,35.66l-34.75,34.75A52.28,52.28,0,0,1,150.62,174h-.05A52.63,52.63,0,0,1,98,119.9a6,6,0,0,1,6-5.84h.17a6,6,0,0,1,5.83,6.16A40.62,40.62,0,0,0,150.58,162h0a40.4,40.4,0,0,0,28.73-11.9l34.75-34.74A40.63,40.63,0,0,0,156.63,57.9l-11,11a6,6,0,0,1-8.49-8.49l11-11a52.62,52.62,0,0,1,74.43,0A52.83,52.83,0,0,1,238,88.18Zm-127.62,98.9-11,11A40.36,40.36,0,0,1,70.6,210h0a40.63,40.63,0,0,1-28.7-69.36L76.62,105.9A40.63,40.63,0,0,1,146,135.77a6,6,0,0,0,5.83,6.16H152a6,6,0,0,0,6-5.84A52.63,52.63,0,0,0,68.14,97.42L33.38,132.16A52.63,52.63,0,0,0,70.56,222h0a52.26,52.26,0,0,0,37.22-15.42l11-11a6,6,0,1,0-8.49-8.48Z"/></svg>'),
  lock: raw('<svg class="fi i-lock" viewBox="0 0 256 256" aria-hidden="true"><path d="M208,82H174V56a46,46,0,0,0-92,0V82H48A14,14,0,0,0,34,96V208a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V96A14,14,0,0,0,208,82ZM94,56a34,34,0,0,1,68,0V82H94ZM210,208a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V96a2,2,0,0,1,2-2H208a2,2,0,0,1,2,2Zm-72-56a10,10,0,1,1-10-10A10,10,0,0,1,138,152Z"/></svg>'),
  check: raw('<svg class="fi i-check" viewBox="0 0 256 256" aria-hidden="true"><path d="M228.24,76.24l-128,128a6,6,0,0,1-8.48,0l-56-56a6,6,0,0,1,8.48-8.48L96,191.51,219.76,67.76a6,6,0,0,1,8.48,8.48Z"/></svg>'),
  star: raw('<svg class="fi i-star" viewBox="0 0 256 256" aria-hidden="true"><path d="M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z"/></svg>'),
  quote: raw('<svg class="fi i-quote" viewBox="0 0 256 256" aria-hidden="true"><path d="M100,58H40A14,14,0,0,0,26,72v64a14,14,0,0,0,14,14h62v10a34,34,0,0,1-34,34,6,6,0,0,0,0,12,46.06,46.06,0,0,0,46-46V72A14,14,0,0,0,100,58Zm2,80H40a2,2,0,0,1-2-2V72a2,2,0,0,1,2-2h60a2,2,0,0,1,2,2ZM216,58H156a14,14,0,0,0-14,14v64a14,14,0,0,0,14,14h62v10a34,34,0,0,1-34,34,6,6,0,0,0,0,12,46.06,46.06,0,0,0,46-46V72A14,14,0,0,0,216,58Zm2,80H156a2,2,0,0,1-2-2V72a2,2,0,0,1,2-2h60a2,2,0,0,1,2,2Z"/></svg>'),
  broadcast: raw('<svg class="fi i-broadcast" viewBox="0 0 256 256" aria-hidden="true"><path d="M228,88.59l-176.08-54A14,14,0,0,0,34,48V192a14,14,0,0,0,14,14,14.59,14.59,0,0,0,4-.59L138,179v13a14,14,0,0,0,14,14h32a14,14,0,0,0,14-14V160.62l30-9.19A14.07,14.07,0,0,0,238,138V102A14,14,0,0,0,228,88.59ZM48.56,193.92a2,2,0,0,1-1.76-.32A2,2,0,0,1,46,192V48a2,2,0,0,1,.8-1.6A2.05,2.05,0,0,1,48,46a1.79,1.79,0,0,1,.49.08L138,73.53v92.95ZM186,192a2,2,0,0,1-2,2H152a2,2,0,0,1-2-2V175.35l36-11Zm40-54a2,2,0,0,1-1.44,1.92l-.08,0L150,162.8V77.21l74.56,22.87A2,2,0,0,1,226,102Z"/></svg>'),
  profile: raw('<svg class="fi i-profile" viewBox="0 0 256 256" aria-hidden="true"><path d="M151.11,166.13a38,38,0,1,0-46.22,0A65.75,65.75,0,0,0,75.2,188.4a6,6,0,0,0,9.6,7.2,54,54,0,0,1,86.4,0,6,6,0,0,0,9.6-7.2A65.75,65.75,0,0,0,151.11,166.13ZM128,110a26,26,0,1,1-26,26A26,26,0,0,1,128,110Zm72-84H56A14,14,0,0,0,42,40V216a14,14,0,0,0,14,14H200a14,14,0,0,0,14-14V40A14,14,0,0,0,200,26Zm2,190a2,2,0,0,1-2,2H56a2,2,0,0,1-2-2V40a2,2,0,0,1,2-2H200a2,2,0,0,1,2,2ZM90,64a6,6,0,0,1,6-6h64a6,6,0,0,1,0,12H96A6,6,0,0,1,90,64Z"/></svg>'),
  feather: raw('<svg class="fi i-feather" viewBox="0 0 256 256" aria-hidden="true"><path d="M238,80A62,62,0,0,0,132.18,36.14L62.1,105.41a13.94,13.94,0,0,0-4.1,9.9v74.21L27.76,219.76a6,6,0,1,0,8.48,8.48L66.48,198h74.21a13.94,13.94,0,0,0,9.9-4.1l0,0,68.83-69.63h0l.39-.4A61.6,61.6,0,0,0,238,80ZM140.64,44.64a50,50,0,0,1,72,69.36H150.48l37.76-37.76a6,6,0,0,0-8.48-8.48l-48,48h0L118,129.52V67ZM70,115.31a2,2,0,0,1,.56-1.39l35.44-35v62.63l-36,36Zm72.09,70.11a2,2,0,0,1-1.4.58H78.48l37.76-37.75h0L138.48,126h62.35Z"/></svg>'),
  heart: raw('<svg class="fi i-heart" viewBox="0 0 256 256" aria-hidden="true"><path d="M178,42c-21,0-39.26,9.47-50,25.34C117.26,51.47,99,42,78,42a60.07,60.07,0,0,0-60,60c0,29.2,18.2,59.59,54.1,90.31a334.68,334.68,0,0,0,53.06,37,6,6,0,0,0,5.68,0,334.68,334.68,0,0,0,53.06-37C219.8,161.59,238,131.2,238,102A60.07,60.07,0,0,0,178,42ZM128,217.11C111.59,207.64,30,157.72,30,102A48.05,48.05,0,0,1,78,54c20.28,0,37.31,10.83,44.45,28.27a6,6,0,0,0,11.1,0C140.69,64.83,157.72,54,178,54a48.05,48.05,0,0,1,48,48C226,157.72,144.41,207.64,128,217.11Z"/></svg>'),
  heartFill: raw('<svg class="fi i-heartFill" viewBox="0 0 256 256" aria-hidden="true"><path d="M240,102c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,228.66,16,172,16,102A62.07,62.07,0,0,1,78,40c20.65,0,38.73,8.88,50,23.89C139.27,48.88,157.35,40,178,40A62.07,62.07,0,0,1,240,102Z"/></svg>'),
  starOutline: raw('<svg class="fi i-starOutline" viewBox="0 0 256 256" aria-hidden="true"><path d="M237.28,97.87A14.18,14.18,0,0,0,224.76,88l-60.25-4.87-23.22-56.2a14.37,14.37,0,0,0-26.58,0L91.49,83.11,31.24,88a14.18,14.18,0,0,0-12.52,9.89A14.43,14.43,0,0,0,23,113.32L69,152.93l-14,59.25a14.4,14.4,0,0,0,5.59,15,14.1,14.1,0,0,0,15.91.6L128,196.12l51.58,31.71a14.1,14.1,0,0,0,15.91-.6,14.4,14.4,0,0,0,5.59-15l-14-59.25L233,113.32A14.43,14.43,0,0,0,237.28,97.87Zm-12.14,6.37-48.69,42a6,6,0,0,0-1.92,5.92l14.88,62.79a2.35,2.35,0,0,1-.95,2.57,2.24,2.24,0,0,1-2.6.1L131.14,184a6,6,0,0,0-6.28,0L70.14,217.61a2.24,2.24,0,0,1-2.6-.1,2.35,2.35,0,0,1-1-2.57l14.88-62.79a6,6,0,0,0-1.92-5.92l-48.69-42a2.37,2.37,0,0,1-.73-2.65,2.28,2.28,0,0,1,2.07-1.65l63.92-5.16a6,6,0,0,0,5.06-3.69l24.63-59.6a2.35,2.35,0,0,1,4.38,0l24.63,59.6a6,6,0,0,0,5.06,3.69l63.92,5.16a2.28,2.28,0,0,1,2.07,1.65A2.37,2.37,0,0,1,225.14,104.24Z"/></svg>'),
  image: raw('<svg class="fi i-image" viewBox="0 0 256 256" aria-hidden="true"><path d="M216,42H40A14,14,0,0,0,26,56V200a14,14,0,0,0,14,14H216a14,14,0,0,0,14-14V56A14,14,0,0,0,216,42ZM40,54H216a2,2,0,0,1,2,2V163.57L188.53,134.1a14,14,0,0,0-19.8,0l-21.42,21.42L101.9,110.1a14,14,0,0,0-19.8,0L38,154.2V56A2,2,0,0,1,40,54ZM38,200V171.17l52.58-52.58a2,2,0,0,1,2.84,0L176.83,202H40A2,2,0,0,1,38,200Zm178,2H193.8l-38-38,21.41-21.42a2,2,0,0,1,2.83,0l38,38V200A2,2,0,0,1,216,202ZM146,100a10,10,0,1,1,10,10A10,10,0,0,1,146,100Z"/></svg>'),
  video: raw('<svg class="fi i-video" viewBox="0 0 256 256" aria-hidden="true"><path d="M250.83,74.71a6,6,0,0,0-6.16.3L206,100.79V72a14,14,0,0,0-14-14H32A14,14,0,0,0,18,72V184a14,14,0,0,0,14,14H192a14,14,0,0,0,14-14V155.21L244.67,181a6,6,0,0,0,9.33-5V80A6,6,0,0,0,250.83,74.71ZM194,184a2,2,0,0,1-2,2H32a2,2,0,0,1-2-2V72a2,2,0,0,1,2-2H192a2,2,0,0,1,2,2Zm48-19.21-36-24V115.21l36-24Z"/></svg>'),
  mic: raw('<svg class="fi i-mic" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,174a46.06,46.06,0,0,0,46-46V64a46,46,0,0,0-92,0v64A46.06,46.06,0,0,0,128,174ZM94,64a34,34,0,0,1,68,0v64a34,34,0,0,1-68,0Zm40,141.75V240a6,6,0,0,1-12,0V205.75A78.09,78.09,0,0,1,50,128a6,6,0,0,1,12,0,66,66,0,0,0,132,0,6,6,0,0,1,12,0A78.09,78.09,0,0,1,134,205.75Z"/></svg>'),
  live: raw('<svg class="fi i-live" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,90a38,38,0,1,0,38,38A38,38,0,0,0,128,90Zm0,64a26,26,0,1,1,26-26A26,26,0,0,1,128,154Zm78-26a77.74,77.74,0,0,1-19.86,52,6,6,0,0,1-8.94-8,65.93,65.93,0,0,0,0-88,6,6,0,1,1,8.94-8A77.74,77.74,0,0,1,206,128ZM67.18,102.31A65.93,65.93,0,0,0,78.8,172a6,6,0,0,1-.47,8.47,6,6,0,0,1-8.47-.47,77.93,77.93,0,0,1,0-104,6,6,0,1,1,8.94,8A66.21,66.21,0,0,0,67.18,102.31ZM246,128a117.71,117.71,0,0,1-33.71,82.58,6,6,0,0,1-8.58-8.4,105.88,105.88,0,0,0,0-148.36,6,6,0,0,1,8.58-8.4A117.71,117.71,0,0,1,246,128ZM52.29,202.18a6,6,0,0,1-8.58,8.4,117.92,117.92,0,0,1,0-165.16,6,6,0,1,1,8.58,8.4,105.88,105.88,0,0,0,0,148.36Z"/></svg>'),
  text: raw('<svg class="fi i-text" viewBox="0 0 256 256" aria-hidden="true"><path d="M34,64a6,6,0,0,1,6-6H216a6,6,0,0,1,0,12H40A6,6,0,0,1,34,64Zm6,46H168a6,6,0,0,0,0-12H40a6,6,0,0,0,0,12Zm176,28H40a6,6,0,0,0,0,12H216a6,6,0,0,0,0-12Zm-48,40H40a6,6,0,0,0,0,12H168a6,6,0,0,0,0-12Z"/></svg>'),
  verified: raw('<svg class="fi i-verified" viewBox="0 0 256 256" aria-hidden="true"><path d="M225.86,102.82c-3.77-3.94-7.67-8-9.14-11.57-1.36-3.27-1.44-8.69-1.52-13.94-.15-9.76-.31-20.82-8-28.51s-18.75-7.85-28.51-8c-5.25-.08-10.67-.16-13.94-1.52-3.56-1.47-7.63-5.37-11.57-9.14C146.28,23.51,138.44,16,128,16s-18.27,7.51-25.18,14.14c-3.94,3.77-8,7.67-11.57,9.14C88,40.64,82.56,40.72,77.31,40.8c-9.76.15-20.82.31-28.51,8S41,67.55,40.8,77.31c-.08,5.25-.16,10.67-1.52,13.94-1.47,3.56-5.37,7.63-9.14,11.57C23.51,109.72,16,117.56,16,128s7.51,18.27,14.14,25.18c3.77,3.94,7.67,8,9.14,11.57,1.36,3.27,1.44,8.69,1.52,13.94.15,9.76.31,20.82,8,28.51s18.75,7.85,28.51,8c5.25.08,10.67.16,13.94,1.52,3.56,1.47,7.63,5.37,11.57,9.14C109.72,232.49,117.56,240,128,240s18.27-7.51,25.18-14.14c3.94-3.77,8-7.67,11.57-9.14,3.27-1.36,8.69-1.44,13.94-1.52,9.76-.15,20.82-.31,28.51-8s7.85-18.75,8-28.51c.08-5.25.16-10.67,1.52-13.94,1.47-3.56,5.37-7.63,9.14-11.57C232.49,146.28,240,138.44,240,128S232.49,109.73,225.86,102.82Zm-52.2,6.84-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"/></svg>'),
  grid: raw('<svg class="fi i-grid" viewBox="0 0 256 256" aria-hidden="true"><path d="M104,42H56A14,14,0,0,0,42,56v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V56A14,14,0,0,0,104,42Zm2,62a2,2,0,0,1-2,2H56a2,2,0,0,1-2-2V56a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Zm94-62H152a14,14,0,0,0-14,14v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V56A14,14,0,0,0,200,42Zm2,62a2,2,0,0,1-2,2H152a2,2,0,0,1-2-2V56a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Zm-98,34H56a14,14,0,0,0-14,14v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V152A14,14,0,0,0,104,138Zm2,62a2,2,0,0,1-2,2H56a2,2,0,0,1-2-2V152a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Zm94-62H152a14,14,0,0,0-14,14v48a14,14,0,0,0,14,14h48a14,14,0,0,0,14-14V152A14,14,0,0,0,200,138Zm2,62a2,2,0,0,1-2,2H152a2,2,0,0,1-2-2V152a2,2,0,0,1,2-2h48a2,2,0,0,1,2,2Z"/></svg>'),
  play: raw('<svg class="fi i-play" viewBox="0 0 256 256" aria-hidden="true"><path d="M231.36,116.19,87.28,28.06a14,14,0,0,0-14.18-.27A13.69,13.69,0,0,0,66,39.87V216.13a13.69,13.69,0,0,0,7.1,12.08,14,14,0,0,0,14.18-.27l144.08-88.13a13.82,13.82,0,0,0,0-23.62Zm-6.26,13.38L81,217.7a2,2,0,0,1-2.06,0,1.78,1.78,0,0,1-1-1.61V39.87a1.78,1.78,0,0,1,1-1.61A2.06,2.06,0,0,1,80,38a2,2,0,0,1,1,.31L225.1,126.43a1.82,1.82,0,0,1,0,3.14Z"/></svg>'),
  reply: raw('<svg class="fi i-reply" viewBox="0 0 256 256" aria-hidden="true"><path d="M230,200a6,6,0,0,1-12,0,90.1,90.1,0,0,0-90-90H46.49l37.75,37.76a6,6,0,1,1-8.48,8.48l-48-48a6,6,0,0,1,0-8.48l48-48a6,6,0,0,1,8.48,8.48L46.49,98H128A102.12,102.12,0,0,1,230,200Z"/></svg>'),
  search: raw('<svg class="fi i-search" viewBox="0 0 256 256" aria-hidden="true"><path d="M228.24,219.76l-51.38-51.38a86.15,86.15,0,1,0-8.48,8.48l51.38,51.38a6,6,0,0,0,8.48-8.48ZM38,112a74,74,0,1,1,74,74A74.09,74.09,0,0,1,38,112Z"/></svg>'),
  phone: raw('<svg class="fi i-phone" viewBox="0 0 256 256" aria-hidden="true"><path d="M221.59,160.3l-47.24-21.17a14,14,0,0,0-13.28,1.22,4.81,4.81,0,0,0-.56.42l-24.69,21a1.88,1.88,0,0,1-1.68.06c-15.87-7.66-32.31-24-40-39.65a1.91,1.91,0,0,1,0-1.68l21.07-25a6.13,6.13,0,0,0,.42-.58,14,14,0,0,0,1.12-13.27L95.73,34.49a14,14,0,0,0-14.56-8.38A54.24,54.24,0,0,0,34,80c0,78.3,63.7,142,142,142a54.25,54.25,0,0,0,53.89-47.17A14,14,0,0,0,221.59,160.3ZM176,210C104.32,210,46,151.68,46,80A42.23,42.23,0,0,1,82.67,38h.23a2,2,0,0,1,1.84,1.31l21.1,47.11a2,2,0,0,1,0,1.67L84.73,113.15a4.73,4.73,0,0,0-.43.57,14,14,0,0,0-.91,13.73c8.87,18.16,27.17,36.32,45.53,45.19a14,14,0,0,0,13.77-1c.19-.13.38-.27.56-.42l24.68-21a1.92,1.92,0,0,1,1.6-.1l47.25,21.17a2,2,0,0,1,1.21,2A42.24,42.24,0,0,1,176,210Z"/></svg>'),
  card: raw('<svg class="fi i-card" viewBox="0 0 256 256" aria-hidden="true"><path d="M198,112a6,6,0,0,1-6,6H152a6,6,0,0,1,0-12h40A6,6,0,0,1,198,112Zm-6,26H152a6,6,0,0,0,0,12h40a6,6,0,0,0,0-12Zm38-82V200a14,14,0,0,1-14,14H40a14,14,0,0,1-14-14V56A14,14,0,0,1,40,42H216A14,14,0,0,1,230,56Zm-12,0a2,2,0,0,0-2-2H40a2,2,0,0,0-2,2V200a2,2,0,0,0,2,2H216a2,2,0,0,0,2-2ZM133.81,166.51a6,6,0,0,1-11.62,3C119.34,158.38,108.08,150,96,150s-23.33,8.38-26.19,19.5a6,6,0,0,1-11.62-3A38,38,0,0,1,76.78,143a30,30,0,1,1,38.45,0A38,38,0,0,1,133.81,166.51ZM96,138a18,18,0,1,0-18-18A18,18,0,0,0,96,138Z"/></svg>'),
  smartphone: raw('<svg class="fi i-smartphone" viewBox="0 0 256 256" aria-hidden="true"><path d="M176,18H80A22,22,0,0,0,58,40V216a22,22,0,0,0,22,22h96a22,22,0,0,0,22-22V40A22,22,0,0,0,176,18ZM70,62H186V194H70ZM80,30h96a10,10,0,0,1,10,10V50H70V40A10,10,0,0,1,80,30Zm96,196H80a10,10,0,0,1-10-10V206H186v10A10,10,0,0,1,176,226Z"/></svg>'),
  book: raw('<svg class="fi i-book" viewBox="0 0 256 256" aria-hidden="true"><path d="M232,50H160a38,38,0,0,0-32,17.55A38,38,0,0,0,96,50H24a6,6,0,0,0-6,6V200a6,6,0,0,0,6,6H96a26,26,0,0,1,26,26,6,6,0,0,0,12,0,26,26,0,0,1,26-26h72a6,6,0,0,0,6-6V56A6,6,0,0,0,232,50ZM96,194H30V62H96a26,26,0,0,1,26,26V204.31A37.86,37.86,0,0,0,96,194Zm130,0H160a37.87,37.87,0,0,0-26,10.32V88a26,26,0,0,1,26-26h66Z"/></svg>'),
  mute: raw('<svg class="fi i-mute" viewBox="0 0 256 256" aria-hidden="true"><path d="M52.44,36A6,6,0,0,0,43.56,44L78,81.94l-.08.06H32A14,14,0,0,0,18,96v64a14,14,0,0,0,14,14H77.94l70.38,54.74A6,6,0,0,0,158,224V169.92L203.56,220a6,6,0,0,0,8.88-8.08ZM30,160V96a2,2,0,0,1,2-2H74v68H32A2,2,0,0,1,30,160Zm116,51.73L86,165.07V90.93l.11-.08L146,156.72Zm41.5-66.53a26,26,0,0,0,0-34.37,6,6,0,1,1,9-7.93,38,38,0,0,1,0,50.24,6,6,0,0,1-9-7.94ZM107.41,66.68a6,6,0,0,1,1.06-8.42l39.85-31A6,6,0,0,1,158,32v74.83a6,6,0,0,1-12,0V44.27L115.83,67.73A6,6,0,0,1,107.41,66.68ZM246,128a77.86,77.86,0,0,1-19.86,52,6,6,0,1,1-8.94-8,66,66,0,0,0,0-88,6,6,0,1,1,8.94-8A77.86,77.86,0,0,1,246,128Z"/></svg>'),
  sound: raw('<svg class="fi i-sound" viewBox="0 0 256 256" aria-hidden="true"><path d="M154.64,26.61a6,6,0,0,0-6.32.65L77.94,82H32A14,14,0,0,0,18,96v64a14,14,0,0,0,14,14H77.94l70.38,54.74A6,6,0,0,0,158,224V32A6,6,0,0,0,154.64,26.61ZM30,160V96a2,2,0,0,1,2-2H74v68H32A2,2,0,0,1,30,160Zm116,51.73L86,165.07V90.93l60-46.66Zm50.53-108.85a38,38,0,0,1,0,50.24,6,6,0,1,1-9-7.94,26,26,0,0,0,0-34.37,6,6,0,0,1,9-7.93ZM246,128a77.86,77.86,0,0,1-19.86,52,6,6,0,1,1-8.94-8,66,66,0,0,0,0-88,6,6,0,1,1,8.94-8A77.86,77.86,0,0,1,246,128Z"/></svg>'),
  pushpin: raw('<svg class="fi i-pushpin" viewBox="0 0 256 256" aria-hidden="true"><path d="M233.91,82.79,173.22,22.1a14,14,0,0,0-19.81,0L98.93,76.77c-9.52-3.25-34-8.34-59.71,12.41A14,14,0,0,0,38.1,110l49.71,49.71-44.05,44a6,6,0,1,0,8.48,8.48l44.05-44.05L146,217.89a14,14,0,0,0,9.9,4.11q.49,0,1,0a14,14,0,0,0,10.19-5.54c19.72-26.21,17.15-47.23,12.46-59.3l54.37-54.55A14,14,0,0,0,233.91,82.79ZM225.42,94.1h0l-57.27,57.46a6,6,0,0,0-1.11,6.92c9.94,19.88-1.71,40.32-9.54,50.72a2,2,0,0,1-3,.2L46.58,101.51a2,2,0,0,1,.18-3c12.5-10.09,24.5-12.76,33.7-12.76a42.13,42.13,0,0,1,17.25,3.41A6,6,0,0,0,104.64,88L161.9,30.59a2,2,0,0,1,2.83,0l60.69,60.68A2,2,0,0,1,225.42,94.1Z"/></svg>'),
  pin: raw('<svg class="fi i-pin" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,66a38,38,0,1,0,38,38A38,38,0,0,0,128,66Zm0,64a26,26,0,1,1,26-26A26,26,0,0,1,128,130Zm0-112a86.1,86.1,0,0,0-86,86c0,30.91,14.34,63.74,41.47,94.94a252.32,252.32,0,0,0,41.09,38,6,6,0,0,0,6.88,0,252.32,252.32,0,0,0,41.09-38c27.13-31.2,41.47-64,41.47-94.94A86.1,86.1,0,0,0,128,18Zm0,206.51C113,212.93,54,163.62,54,104a74,74,0,0,1,148,0C202,163.62,143,212.93,128,224.51Z"/></svg>'),
  archive: raw('<svg class="fi i-archive" viewBox="0 0 256 256" aria-hidden="true"><path d="M224,50H32A14,14,0,0,0,18,64V88a14,14,0,0,0,14,14h2v90a14,14,0,0,0,14,14H208a14,14,0,0,0,14-14V102h2a14,14,0,0,0,14-14V64A14,14,0,0,0,224,50ZM210,192a2,2,0,0,1-2,2H48a2,2,0,0,1-2-2V102H210ZM226,88a2,2,0,0,1-2,2H32a2,2,0,0,1-2-2V64a2,2,0,0,1,2-2H224a2,2,0,0,1,2,2ZM98,136a6,6,0,0,1,6-6h48a6,6,0,0,1,0,12H104A6,6,0,0,1,98,136Z"/></svg>'),
  camera: raw('<svg class="fi i-camera" viewBox="0 0 256 256" aria-hidden="true"><path d="M208,58H179.21L165,36.67A6,6,0,0,0,160,34H96a6,6,0,0,0-5,2.67L76.78,58H48A22,22,0,0,0,26,80V192a22,22,0,0,0,22,22H208a22,22,0,0,0,22-22V80A22,22,0,0,0,208,58Zm10,134a10,10,0,0,1-10,10H48a10,10,0,0,1-10-10V80A10,10,0,0,1,48,70H80a6,6,0,0,0,5-2.67L99.21,46h57.57L171,67.33A6,6,0,0,0,176,70h32a10,10,0,0,1,10,10ZM128,90a42,42,0,1,0,42,42A42,42,0,0,0,128,90Zm0,72a30,30,0,1,1,30-30A30,30,0,0,1,128,162Z"/></svg>'),
  warning: raw('<svg class="fi i-warning" viewBox="0 0 256 256" aria-hidden="true"><path d="M128,26A102,102,0,1,0,230,128,102.12,102.12,0,0,0,128,26Zm0,192a90,90,0,1,1,90-90A90.1,90.1,0,0,1,128,218Zm-6-82V80a6,6,0,0,1,12,0v56a6,6,0,0,1-12,0Zm16,36a10,10,0,1,1-10-10A10,10,0,0,1,138,172Z"/></svg>'),
  hourglass: raw('<svg class="fi i-hourglass" viewBox="0 0 256 256" aria-hidden="true"><path d="M198,75.64V40a14,14,0,0,0-14-14H72A14,14,0,0,0,58,40V76a14.06,14.06,0,0,0,5.6,11.2L118,128,63.6,168.8A14.06,14.06,0,0,0,58,180v36a14,14,0,0,0,14,14H184a14,14,0,0,0,14-14V180.36a14.08,14.08,0,0,0-5.56-11.17L138,128l54.49-41.19A14.08,14.08,0,0,0,198,75.64ZM186,180.36V216a2,2,0,0,1-2,2H72a2,2,0,0,1-2-2V180a2,2,0,0,1,.8-1.6L128,135.51l57.22,43.25A2,2,0,0,1,186,180.36Zm0-104.72a2,2,0,0,1-.79,1.6L128,120.49,70.8,77.6A2,2,0,0,1,70,76V40a2,2,0,0,1,2-2H184a2,2,0,0,1,2,2Z"/></svg>'),
  ties: raw('<svg class="fi i-ties" viewBox="0 0 256 256" aria-hidden="true"><path d="M200,154a29.87,29.87,0,0,0-19.5,7.23L154.88,141.3A29.83,29.83,0,0,0,158,128a30.52,30.52,0,0,0-.22-3.6L174,119a30,30,0,1,0-4-15,30.52,30.52,0,0,0,.22,3.6L154,113a29.91,29.91,0,0,0-32.42-14.31l-8.14-18.3a30,30,0,1,0-11,4.88l8.14,18.3A29.92,29.92,0,0,0,102.06,143L74,168a30.08,30.08,0,1,0,8,9L110,152a29.91,29.91,0,0,0,37.47-1.23l25.62,19.93A30,30,0,1,0,200,154Zm0-68a18,18,0,1,1-18,18A18,18,0,0,1,200,86ZM78,56A18,18,0,1,1,96,74,18,18,0,0,1,78,56ZM56,210a18,18,0,1,1,18-18A18,18,0,0,1,56,210Zm72-64a18,18,0,1,1,18-18A18,18,0,0,1,128,146Zm72,56a18,18,0,1,1,18-18A18,18,0,0,1,200,202Z"/></svg>'),
  newspaper: raw('<svg class="fi i-newspaper" viewBox="0 0 256 256" aria-hidden="true"><path d="M182,112a6,6,0,0,1-6,6H96a6,6,0,0,1,0-12h80A6,6,0,0,1,182,112Zm-6,26H96a6,6,0,0,0,0,12h80a6,6,0,0,0,0-12Zm54-74V184a22,22,0,0,1-22,22H32a22,22,0,0,1-22-21.91V88a6,6,0,0,1,12,0v96a10,10,0,0,0,20,0V64A14,14,0,0,1,56,50H216A14,14,0,0,1,230,64Zm-12,0a2,2,0,0,0-2-2H56a2,2,0,0,0-2,2V184a21.84,21.84,0,0,1-2.41,10H208a10,10,0,0,0,10-10Z"/></svg>'),
  timeline: raw('<svg class="fi i-timeline" viewBox="0 0 256 256" aria-hidden="true"><path d="M134,80v44.6l37.09,22.25a6,6,0,0,1-6.18,10.3l-40-24A6,6,0,0,1,122,128V80a6,6,0,0,1,12,0Zm-6-46A93.4,93.4,0,0,0,61.51,61.56c-8.58,8.68-16,17-23.51,25.8V64a6,6,0,0,0-12,0v40a6,6,0,0,0,6,6H72a6,6,0,0,0,0-12H44.73C52.86,88.29,60.79,79.35,70,70a82,82,0,1,1,1.7,117.62,6,6,0,1,0-8.24,8.72A94,94,0,1,0,128,34Z"/></svg>'),
  poll: raw('<svg class="fi i-poll" viewBox="0 0 256 256" aria-hidden="true"><path d="M224,202H214V40a6,6,0,0,0-6-6H152a6,6,0,0,0-6,6V82H96a6,6,0,0,0-6,6v42H48a6,6,0,0,0-6,6v66H32a6,6,0,0,0,0,12H224a6,6,0,0,0,0-12ZM158,46h44V202H158ZM102,94h44V202H102ZM54,142H90v60H54Z"/></svg>'),
  caretLeft: raw('<svg class="fi i-caretLeft" viewBox="0 0 256 256" aria-hidden="true"><path d="M164.24,203.76a6,6,0,1,1-8.48,8.48l-80-80a6,6,0,0,1,0-8.48l80-80a6,6,0,0,1,8.48,8.48L88.49,128Z"/></svg>'),
  caretRight: raw('<svg class="fi i-caretRight" viewBox="0 0 256 256" aria-hidden="true"><path d="M180.24,132.24l-80,80a6,6,0,0,1-8.48-8.48L167.51,128,91.76,52.24a6,6,0,0,1,8.48-8.48l80,80A6,6,0,0,1,180.24,132.24Z"/></svg>'),
  trash: raw('<svg class="fi i-trash" viewBox="0 0 256 256" aria-hidden="true"><path d="M216,50H174V40a22,22,0,0,0-22-22H104A22,22,0,0,0,82,40V50H40a6,6,0,0,0,0,12H50V208a14,14,0,0,0,14,14H192a14,14,0,0,0,14-14V62h10a6,6,0,0,0,0-12ZM94,40a10,10,0,0,1,10-10h48a10,10,0,0,1,10,10V50H94ZM194,208a2,2,0,0,1-2,2H64a2,2,0,0,1-2-2V62H194ZM110,104v64a6,6,0,0,1-12,0V104a6,6,0,0,1,12,0Zm48,0v64a6,6,0,0,1-12,0V104a6,6,0,0,1,12,0Z"/></svg>'),
  pencil: raw('<svg class="fi i-pencil" viewBox="0 0 256 256" aria-hidden="true"><path d="M225.9,74.78,181.21,30.09a14,14,0,0,0-19.8,0L38.1,153.41a13.94,13.94,0,0,0-4.1,9.9V208a14,14,0,0,0,14,14H92.69a13.94,13.94,0,0,0,9.9-4.1L225.9,94.58a14,14,0,0,0,0-19.8ZM94.1,209.41a2,2,0,0,1-1.41.59H48a2,2,0,0,1-2-2V163.31a2,2,0,0,1,.59-1.41L136,72.48,183.51,120ZM217.41,86.1,192,111.51,144.49,64,169.9,38.58a2,2,0,0,1,2.83,0l44.68,44.69a2,2,0,0,1,0,2.83Z"/></svg>'),
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
