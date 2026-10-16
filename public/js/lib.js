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
  // iOS-style icons from Framework7 Icons (framework7.io/icons, MIT licence), drawn to match Apple's
  // SF Symbols (Apple doesn't allow SF Symbols themselves on websites). Fill versions for the liked
  // heart, the star and the verified badge.
  menu: raw('<svg class="fi i-menu" viewBox="0 0 56 56" aria-hidden="true"><path d="M 6.0626 19.5390 L 49.9144 19.5390 C 50.8984 19.5390 51.7187 18.7656 51.7187 17.7812 C 51.7187 16.7968 50.8984 16 49.9144 16 L 6.0626 16 C 5.0782 16 4.2813 16.7968 4.2813 17.7812 C 4.2813 18.7656 5.0782 19.5390 6.0626 19.5390 Z M 6.0626 29.7578 L 49.9144 29.7578 C 50.8984 29.7578 51.7187 28.9843 51.7187 28 C 51.7187 26.9921 50.8984 26.1953 49.9144 26.1953 L 6.0626 26.1953 C 5.0782 26.1953 4.2813 26.9921 4.2813 28 C 4.2813 28.9843 5.0782 29.7578 6.0626 29.7578 Z M 6.0626 40 L 49.9144 40 C 50.8984 40 51.7187 39.2031 51.7187 38.1953 C 51.7187 37.2109 50.8984 36.4375 49.9144 36.4375 L 6.0626 36.4375 C 5.0782 36.4375 4.2813 37.2109 4.2813 38.1953 C 4.2813 39.2031 5.0782 40 6.0626 40 Z"/></svg>'),
  apps: raw('<svg class="fi i-apps" viewBox="0 0 56 56" aria-hidden="true"><path d="M 10.9023 26.0664 L 21.5898 26.0664 C 24.5663 26.0664 26.0663 24.5664 26.0663 21.4727 L 26.0663 10.9961 C 26.0663 7.9023 24.5663 6.4258 21.5898 6.4258 L 10.9023 6.4258 C 7.9257 6.4258 6.4257 7.9023 6.4257 10.9961 L 6.4257 21.4727 C 6.4257 24.5664 7.9257 26.0664 10.9023 26.0664 Z M 34.4335 26.0664 L 45.0976 26.0664 C 48.0976 26.0664 49.5743 24.5664 49.5743 21.4727 L 49.5743 10.9961 C 49.5743 7.9023 48.0976 6.4258 45.0976 6.4258 L 34.4335 6.4258 C 31.4570 6.4258 29.9570 7.9023 29.9570 10.9961 L 29.9570 21.4727 C 29.9570 24.5664 31.4570 26.0664 34.4335 26.0664 Z M 10.9492 22.7617 C 10.1288 22.7617 9.7304 22.3398 9.7304 21.4727 L 9.7304 10.9961 C 9.7304 10.1523 10.1288 9.7305 10.9492 9.7305 L 21.5195 9.7305 C 22.3398 9.7305 22.7617 10.1523 22.7617 10.9961 L 22.7617 21.4727 C 22.7617 22.3398 22.3398 22.7617 21.5195 22.7617 Z M 34.4804 22.7617 C 33.6601 22.7617 33.2617 22.3398 33.2617 21.4727 L 33.2617 10.9961 C 33.2617 10.1523 33.6601 9.7305 34.4804 9.7305 L 45.0742 9.7305 C 45.8710 9.7305 46.2695 10.1523 46.2695 10.9961 L 46.2695 21.4727 C 46.2695 22.3398 45.8710 22.7617 45.0742 22.7617 Z M 10.9023 49.5742 L 21.5898 49.5742 C 24.5663 49.5742 26.0663 48.0977 26.0663 45.0039 L 26.0663 34.5039 C 26.0663 31.4336 24.5663 29.9336 21.5898 29.9336 L 10.9023 29.9336 C 7.9257 29.9336 6.4257 31.4336 6.4257 34.5039 L 6.4257 45.0039 C 6.4257 48.0977 7.9257 49.5742 10.9023 49.5742 Z M 34.4335 49.5742 L 45.0976 49.5742 C 48.0976 49.5742 49.5743 48.0977 49.5743 45.0039 L 49.5743 34.5039 C 49.5743 31.4336 48.0976 29.9336 45.0976 29.9336 L 34.4335 29.9336 C 31.4570 29.9336 29.9570 31.4336 29.9570 34.5039 L 29.9570 45.0039 C 29.9570 48.0977 31.4570 49.5742 34.4335 49.5742 Z M 10.9492 46.2695 C 10.1288 46.2695 9.7304 45.8477 9.7304 45.0039 L 9.7304 34.5274 C 9.7304 33.6602 10.1288 33.2383 10.9492 33.2383 L 21.5195 33.2383 C 22.3398 33.2383 22.7617 33.6602 22.7617 34.5274 L 22.7617 45.0039 C 22.7617 45.8477 22.3398 46.2695 21.5195 46.2695 Z M 34.4804 46.2695 C 33.6601 46.2695 33.2617 45.8477 33.2617 45.0039 L 33.2617 34.5274 C 33.2617 33.6602 33.6601 33.2383 34.4804 33.2383 L 45.0742 33.2383 C 45.8710 33.2383 46.2695 33.6602 46.2695 34.5274 L 46.2695 45.0039 C 46.2695 45.8477 45.8710 46.2695 45.0742 46.2695 Z"/></svg>'),
  user: raw('<svg class="fi i-user" viewBox="0 0 56 56" aria-hidden="true"><path d="M 28.0117 28.0234 C 33.5898 28.0234 38.1367 23.0547 38.1367 17.0078 C 38.1367 11.0078 33.6367 6.2969 28.0117 6.2969 C 22.4570 6.2969 17.8867 11.1016 17.8867 17.0547 C 17.9101 23.0782 22.4570 28.0234 28.0117 28.0234 Z M 28.0117 24.4844 C 24.5898 24.4844 21.6601 21.2031 21.6601 17.0547 C 21.6601 12.9766 24.5430 9.8360 28.0117 9.8360 C 31.5274 9.8360 34.3633 12.9297 34.3633 17.0078 C 34.3633 21.1563 31.4805 24.4844 28.0117 24.4844 Z M 13.2930 49.7031 L 42.7305 49.7031 C 46.6211 49.7031 48.4726 48.5313 48.4726 45.9531 C 48.4726 39.8125 40.7383 30.9297 28.0117 30.9297 C 15.2852 30.9297 7.5274 39.8125 7.5274 45.9531 C 7.5274 48.5313 9.3789 49.7031 13.2930 49.7031 Z M 12.1679 46.1641 C 11.5586 46.1641 11.3008 46.0000 11.3008 45.5078 C 11.3008 41.6641 17.2539 34.4687 28.0117 34.4687 C 38.7695 34.4687 44.6992 41.6641 44.6992 45.5078 C 44.6992 46.0000 44.4648 46.1641 43.8555 46.1641 Z"/></svg>'),
  userAdd: raw('<svg class="fi i-userAdd" viewBox="0 0 56 56" aria-hidden="true"><path d="M 33.7304 24.1211 C 39.3085 24.1211 43.8554 19.1523 43.8554 13.1055 C 43.8554 7.1055 39.3554 2.3945 33.7304 2.3945 C 28.1757 2.3945 23.6054 7.1992 23.6054 13.1523 C 23.6288 19.1758 28.1757 24.1211 33.7304 24.1211 Z M 33.7304 20.5821 C 30.3085 20.5821 27.3788 17.3008 27.3788 13.1523 C 27.3788 9.0742 30.2616 5.9336 33.7304 5.9336 C 37.2460 5.9336 40.0819 9.0274 40.0819 13.1055 C 40.0819 17.2539 37.1991 20.5821 33.7304 20.5821 Z M 33.7304 27.0274 C 29.4882 27.0274 25.7851 28.0117 22.7851 29.6055 C 23.7694 30.3789 24.6600 31.2695 25.4335 32.3008 C 27.7304 31.2461 30.5194 30.5664 33.7304 30.5664 C 44.4647 30.5664 50.4178 37.7617 50.4178 41.6055 C 50.4178 42.0977 50.1835 42.2617 49.5739 42.2617 L 28.8319 42.2617 C 28.8085 43.4805 28.5975 44.6758 28.2460 45.8008 L 48.4493 45.8008 C 52.3397 45.8008 54.1915 44.6289 54.1915 42.0508 C 54.1915 35.9102 46.4333 27.0274 33.7304 27.0274 Z M 13.7147 53.6055 C 20.1835 53.6055 25.621 48.1914 25.621 41.6992 C 25.621 35.1601 20.2538 29.7930 13.7147 29.7930 C 7.1991 29.7930 1.8085 35.1601 1.8085 41.6992 C 1.8085 48.2383 7.1991 53.6055 13.7147 53.6055 Z M 13.7382 49.4336 C 12.9178 49.4336 12.1913 48.8711 12.1913 47.9805 L 12.1913 43.1289 L 7.7147 43.1289 C 6.9178 43.1289 6.2616 42.4727 6.2616 41.6992 C 6.2616 40.9023 6.9178 40.2461 7.7147 40.2461 L 12.1913 40.2461 L 12.1913 35.3945 C 12.1913 34.5039 12.9178 33.9648 13.7382 33.9648 C 14.5351 33.9648 15.2616 34.5039 15.2616 35.3945 L 15.2616 40.2461 L 19.7382 40.2461 C 20.5351 40.2461 21.1678 40.9023 21.1678 41.6992 C 21.1678 42.4727 20.5351 43.1289 19.7382 43.1289 L 15.2616 43.1289 L 15.2616 47.9805 C 15.2616 48.8711 14.5351 49.4336 13.7382 49.4336 Z"/></svg>'),
  power: raw('<svg class="fi i-power" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.9999 28.7617 C 29.1249 28.7617 29.8749 27.9414 29.8749 26.7695 L 29.8749 5.7227 C 29.8749 4.5273 29.1249 3.7305 27.9999 3.7305 C 26.8749 3.7305 26.1014 4.5273 26.1014 5.7227 L 26.1014 26.7695 C 26.1014 27.9414 26.8749 28.7617 27.9999 28.7617 Z M 27.9999 52.2695 C 40.7265 52.2695 51.2970 41.7227 51.2970 28.9961 C 51.2970 22.0820 48.1796 15.8008 43.2811 11.5351 C 41.3358 9.8008 38.5467 12.5430 40.7733 14.4883 C 44.7811 17.9805 47.2889 23.2070 47.2889 28.9961 C 47.2889 39.7070 38.6874 48.3086 27.9999 48.3086 C 17.2889 48.3086 8.6874 39.7070 8.6874 28.9961 C 8.6874 23.2070 11.2187 18.0039 15.2265 14.4883 C 17.4296 12.5430 14.6405 9.8008 12.7187 11.5351 C 7.8202 15.8008 4.7030 22.0820 4.7030 28.9961 C 4.7030 41.7227 15.2733 52.2695 27.9999 52.2695 Z"/></svg>'),
  fingerprint: raw('<svg class="fi i-fingerprint" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.9883 51.6719 C 28.3633 51.6719 28.9726 51.5313 29.5821 51.2031 C 42.8945 43.7266 47.4883 40.5625 47.4883 32.0078 L 47.4883 14.0781 C 47.4883 11.6172 46.4101 10.8438 44.4414 10.0000 C 41.6758 8.8516 32.7226 5.6406 29.9570 4.6797 C 29.3242 4.4687 28.6680 4.3281 27.9883 4.3281 C 27.3321 4.3281 26.6758 4.5156 26.0430 4.6797 C 23.2774 5.5234 14.3242 8.8750 11.5586 10.0000 C 9.5899 10.8203 8.5117 11.6172 8.5117 14.0781 L 8.5117 32.0078 C 8.5117 40.5625 13.1289 43.7031 26.4180 51.2031 C 27.0274 51.5313 27.6133 51.6719 27.9883 51.6719 Z M 27.9883 47.4063 C 27.6367 47.4063 27.2383 47.2656 26.5352 46.8438 C 15.7070 40.2813 12.2383 38.3594 12.2383 31.1406 L 12.2383 14.7813 C 12.2383 13.9844 12.4023 13.6797 13.0352 13.4219 C 16.5977 12.0156 23.4648 9.5781 27.0742 8.2891 C 27.4258 8.1484 27.7305 8.0781 27.9883 8.0781 C 28.2695 8.0781 28.5508 8.1484 28.9258 8.2891 C 32.5352 9.5781 39.3321 12.1797 42.9648 13.4219 C 43.5977 13.6562 43.7617 13.9844 43.7617 14.7813 L 43.7617 31.1406 C 43.7617 38.3594 40.2695 40.2578 29.4648 46.8438 C 28.7617 47.2656 28.3633 47.4063 27.9883 47.4063 Z M 22.1523 38.3125 L 33.8242 38.3125 C 35.4648 38.3125 36.2383 37.4922 36.2383 35.7344 L 36.2383 26.6406 C 36.2383 25.0938 35.6289 24.2734 34.3867 24.1094 L 34.3867 21.3203 C 34.3867 17.0078 31.8086 14.1016 27.9883 14.1016 C 24.1914 14.1016 21.5899 17.0078 21.5899 21.3203 L 21.5899 24.1328 C 20.3711 24.2969 19.7617 25.1172 19.7617 26.6406 L 19.7617 35.7344 C 19.7617 37.4922 20.5352 38.3125 22.1523 38.3125 Z M 24.0274 21.0625 C 24.0274 18.2969 25.6211 16.4687 27.9883 16.4687 C 30.3789 16.4687 31.9492 18.2969 31.9492 21.0625 L 31.9492 24.0625 L 24.0274 24.0860 Z"/></svg>'),
  music: raw('<svg class="fi i-music" viewBox="0 0 56 56" aria-hidden="true"><path d="M 42.6484 15.1797 L 42.6484 6.3437 C 42.6484 5.0312 41.5703 4.1641 40.3047 4.4453 L 27.8594 7.1406 C 26.2656 7.4922 25.3984 8.3359 25.3984 9.7422 L 25.5391 35.8047 C 25.5391 36.8828 25.0469 37.5859 24.0860 37.7734 L 20.3594 38.5703 C 15.5781 39.5547 13.3516 42.0156 13.3516 45.6015 C 13.3516 49.2578 16.1875 51.8359 20.1484 51.8359 C 23.6172 51.8359 28.8672 49.2344 28.8672 42.3437 L 28.8672 20.8984 C 28.8672 19.7265 29.0547 19.5156 30.1094 19.3047 L 41.2656 16.8437 C 42.1094 16.6563 42.6484 16 42.6484 15.1797 Z"/></svg>'),
  episode: raw('<svg class="fi i-episode" viewBox="0 0 56 56" aria-hidden="true"><path d="M 13.0937 47.8398 C 14.0313 47.8398 14.8281 47.4648 15.7656 46.9258 L 43.0937 31.1289 C 45.0391 29.9805 45.7187 29.2305 45.7187 27.9883 C 45.7187 26.7461 45.0391 25.9961 43.0937 24.8711 L 15.7656 9.0508 C 14.8281 8.5118 14.0313 8.1602 13.0937 8.1602 C 11.3594 8.1602 10.2813 9.4727 10.2813 11.5118 L 10.2813 44.4649 C 10.2813 46.5039 11.3594 47.8398 13.0937 47.8398 Z M 14.2891 43.3633 C 14.1484 43.3633 14.0547 43.2695 14.0547 43.0820 L 14.0547 12.8945 C 14.0547 12.7070 14.1484 12.6133 14.2891 12.6133 C 14.3828 12.6133 14.4766 12.6602 14.5703 12.7305 L 40.5156 27.7305 C 40.6328 27.8008 40.7266 27.8711 40.7266 27.9883 C 40.7266 28.1055 40.6328 28.1992 40.5156 28.2461 L 14.5703 43.2695 C 14.4766 43.3164 14.3828 43.3633 14.2891 43.3633 Z"/></svg>'),
  sparkle: raw('<svg class="fi i-sparkle" viewBox="0 0 56 56" aria-hidden="true"><path d="M 26.6875 12.6602 C 26.9687 12.6602 27.1094 12.4961 27.1797 12.2383 C 27.9062 8.3242 27.8594 8.2305 31.9375 7.4570 C 32.2187 7.4102 32.3828 7.2461 32.3828 6.9648 C 32.3828 6.6836 32.2187 6.5195 31.9375 6.4726 C 27.8828 5.6524 28.0000 5.5586 27.1797 1.6914 C 27.1094 1.4336 26.9687 1.2695 26.6875 1.2695 C 26.4062 1.2695 26.2656 1.4336 26.1953 1.6914 C 25.3750 5.5586 25.5156 5.6524 21.4375 6.4726 C 21.1797 6.5195 20.9922 6.6836 20.9922 6.9648 C 20.9922 7.2461 21.1797 7.4102 21.4375 7.4570 C 25.5156 8.2774 25.4687 8.3242 26.1953 12.2383 C 26.2656 12.4961 26.4062 12.6602 26.6875 12.6602 Z M 15.3438 28.7852 C 15.7891 28.7852 16.0938 28.5039 16.1406 28.0821 C 16.9844 21.8242 17.1953 21.8242 23.6641 20.5821 C 24.0860 20.5117 24.3906 20.2305 24.3906 19.7852 C 24.3906 19.3633 24.0860 19.0586 23.6641 18.9883 C 17.1953 18.0977 16.9609 17.8867 16.1406 11.5117 C 16.0938 11.0899 15.7891 10.7852 15.3438 10.7852 C 14.9219 10.7852 14.6172 11.0899 14.5703 11.5352 C 13.7969 17.8164 13.4687 17.7930 7.0469 18.9883 C 6.6250 19.0821 6.3203 19.3633 6.3203 19.7852 C 6.3203 20.2539 6.6250 20.5117 7.1406 20.5821 C 13.5156 21.6133 13.7969 21.7774 14.5703 28.0352 C 14.6172 28.5039 14.9219 28.7852 15.3438 28.7852 Z M 31.2344 54.7305 C 31.8438 54.7305 32.2891 54.2852 32.4062 53.6524 C 34.0703 40.8086 35.8750 38.8633 48.5781 37.4570 C 49.2344 37.3867 49.6797 36.8945 49.6797 36.2852 C 49.6797 35.6758 49.2344 35.2070 48.5781 35.1133 C 35.8750 33.7070 34.0703 31.7617 32.4062 18.9180 C 32.2891 18.2852 31.8438 17.8633 31.2344 17.8633 C 30.6250 17.8633 30.1797 18.2852 30.0860 18.9180 C 28.4219 31.7617 26.5938 33.7070 13.9140 35.1133 C 13.2344 35.2070 12.7891 35.6758 12.7891 36.2852 C 12.7891 36.8945 13.2344 37.3867 13.9140 37.4570 C 26.5703 39.1211 28.3281 40.8321 30.0860 53.6524 C 30.1797 54.2852 30.6250 54.7305 31.2344 54.7305 Z"/></svg>'),
  users: raw('<svg class="fi i-users" viewBox="0 0 56 56" aria-hidden="true"><path d="M 38.4460 29.2320 C 43.2316 29.2320 47.1322 24.9692 47.1322 19.7814 C 47.1322 14.6540 43.2514 10.5922 38.4460 10.5922 C 33.6803 10.5922 29.7593 14.7143 29.7593 19.8216 C 29.7794 24.9893 33.6803 29.2320 38.4460 29.2320 Z M 15.2818 29.6744 C 19.4240 29.6744 22.8222 25.9545 22.8222 21.3900 C 22.8222 16.9262 19.4642 13.3269 15.2818 13.3269 C 11.1396 13.3269 7.7213 16.9865 7.7414 21.4303 C 7.7615 25.9746 11.1396 29.6744 15.2818 29.6744 Z M 38.4460 26.1958 C 35.5101 26.1958 32.9966 23.3807 32.9966 19.8216 C 32.9966 16.3229 35.4699 13.6285 38.4460 13.6285 C 41.4419 13.6285 43.8950 16.2827 43.8950 19.7814 C 43.8950 23.3405 41.4217 26.1958 38.4460 26.1958 Z M 15.2818 26.6783 C 12.8287 26.6783 10.7375 24.3257 10.7375 21.4303 C 10.7375 18.5951 12.8086 16.3229 15.2818 16.3229 C 17.8154 16.3229 19.8462 18.5549 19.8462 21.3900 C 19.8462 24.3257 17.7550 26.6783 15.2818 26.6783 Z M 4.1019 48.1131 L 19.8865 48.1131 C 18.9213 47.5702 18.1773 46.3637 18.3181 45.1372 L 3.5993 45.1372 C 3.1971 45.1372 2.9960 44.9763 2.9960 44.5943 C 2.9960 39.6076 8.6865 34.9426 15.2617 34.9426 C 17.7953 34.9426 20.0674 35.5458 22.0179 36.6920 C 22.6613 35.8877 23.3852 35.1839 24.2900 34.5606 C 21.6961 32.8514 18.5795 31.9667 15.2617 31.9667 C 6.8366 31.9667 0 38.0794 0 44.7752 C 0 47.0072 1.3673 48.1131 4.1019 48.1131 Z M 25.8182 48.1131 L 51.0736 48.1131 C 54.4113 48.1131 56 47.1077 56 44.8959 C 56 39.6277 49.3440 32.0069 38.4460 32.0069 C 27.5274 32.0069 20.8717 39.6277 20.8717 44.8959 C 20.8717 47.1077 22.4602 48.1131 25.8182 48.1131 Z M 24.8530 45.0769 C 24.3302 45.0769 24.1091 44.9361 24.1091 44.5138 C 24.1091 41.2162 29.2164 35.0431 38.4460 35.0431 C 47.6552 35.0431 52.7624 41.2162 52.7624 44.5138 C 52.7624 44.9361 52.5614 45.0769 52.0384 45.0769 Z"/></svg>'),
  home: raw('<svg class="fi i-home" viewBox="0 0 56 56" aria-hidden="true"><path d="M 12.6251 52.6445 L 43.3986 52.6445 C 46.7267 52.6445 48.6722 50.7695 48.6722 47.4648 L 48.6722 26.0664 L 51.6952 28.8320 C 52.1877 29.3008 52.7267 29.6289 53.3829 29.6289 C 54.4845 29.6289 55.3749 28.9492 55.3749 27.8242 C 55.3749 27.1211 55.1171 26.6758 54.6722 26.2774 L 46.5391 18.8476 L 46.5391 5.0430 C 46.5391 4.0117 45.8829 3.3555 44.8519 3.3555 L 41.7813 3.3555 C 40.7735 3.3555 40.0704 4.0117 40.0704 5.0430 L 40.0704 12.9648 L 30.8126 4.5274 C 29.9923 3.7774 29.0079 3.3555 28.0001 3.3555 C 26.9923 3.3555 26.0079 3.7774 25.1876 4.5274 L 1.3282 26.2774 C .9064 26.6758 .6251 27.1211 .6251 27.8242 C .6251 28.9492 1.5157 29.6289 2.6173 29.6289 C 3.2970 29.6289 3.8360 29.3008 4.3048 28.8320 L 7.3282 26.0898 L 7.3282 47.4648 C 7.3282 50.7695 9.2735 52.6445 12.6251 52.6445 Z M 34.7501 33.3086 C 34.7501 32.2305 34.0470 31.5508 32.9689 31.5508 L 23.0313 31.5508 C 21.9532 31.5508 21.2267 32.2305 21.2267 33.3086 L 21.2267 48.8711 L 13.4220 48.8711 C 11.9220 48.8711 11.1017 48.0508 11.1017 46.5273 L 11.1017 22.6445 L 27.1798 7.9961 C 27.4142 7.7617 27.6954 7.6211 28.0001 7.6211 C 28.3048 7.6211 28.5860 7.7383 28.8439 7.9961 L 44.8984 22.6445 L 44.8984 46.5273 C 44.8984 48.0508 44.0781 48.8711 42.6017 48.8711 L 34.7501 48.8711 Z"/></svg>'),
  bell: raw('<svg class="fi i-bell" viewBox="0 0 56 56" aria-hidden="true"><path d="M 9.4257 43.7500 L 33.0273 43.7500 C 32.8632 46.9141 30.8242 48.9297 28.0117 48.9297 C 25.1757 48.9297 23.1601 46.9141 22.9726 43.7500 L 19.3164 43.7500 C 19.5039 48.2500 23.0429 52.2109 28.0117 52.2109 C 32.9570 52.2109 36.4960 48.2500 36.6835 43.7500 L 46.5742 43.7500 C 48.8005 43.7500 50.1133 42.6016 50.1133 40.9141 C 50.1133 38.5703 47.7460 36.4609 45.7070 34.375 C 44.1601 32.7578 43.7382 29.4297 43.5742 26.7344 C 43.3867 17.5000 41.0195 11.5234 34.7617 9.2734 C 33.9882 6.2266 31.4570 3.7891 28.0117 3.7891 C 24.5429 3.7891 22.0351 6.2266 21.2382 9.2734 C 15.0039 11.5234 12.6132 17.5000 12.4492 26.7344 C 12.2617 29.4297 11.8632 32.7578 10.2929 34.375 C 8.2773 36.4609 5.8867 38.5703 5.8867 40.9141 C 5.8867 42.6016 7.2226 43.7500 9.4257 43.7500 Z M 10.4570 40.2109 L 10.4570 39.9297 C 10.8789 39.2266 12.2617 37.8672 13.5039 36.4844 C 15.1679 34.6094 15.9648 31.6094 16.1757 27.0156 C 16.3632 16.7969 19.4101 13.5156 23.4413 12.4375 C 24.0273 12.2969 24.3320 11.9922 24.3554 11.4062 C 24.4492 8.9453 25.8320 7.2344 28.0117 7.2344 C 30.1679 7.2344 31.5742 8.9453 31.6445 11.4062 C 31.6679 11.9922 31.9960 12.2969 32.5820 12.4375 C 36.5898 13.5156 39.6367 16.7969 39.8476 27.0156 C 40.0351 31.6094 40.8320 34.6094 42.5195 36.4844 C 43.7382 37.8672 45.1445 39.2266 45.5664 39.9297 L 45.5664 40.2109 Z"/></svg>'),
  compass: raw('<svg class="fi i-compass" viewBox="0 0 56 56" aria-hidden="true"><path d="M24,0 C37.254834,0 48,10.745166 48,24 C48,37.254834 37.254834,48 24,48 C10.745166,48 0,37.254834 0,24 C0,10.745166 10.745166,0 24,0 Z M24,4 C12.954305,4 4,12.954305 4,24 C4,35.045695 12.954305,44 24,44 C35.045695,44 44,35.045695 44,24 C44,12.954305 35.045695,4 24,4 Z M34.6764378,12.8571429 L27.4033395,27.4033395 L12.8571429,34.6764378 L20.1302412,20.1302412 L34.6764378,12.8571429 Z M22.314158,22.1670955 L17.5475451,29.9860356 L25.3664852,25.2194227 L22.314158,22.1670955 Z" transform="translate(4 4)"/></svg>'),
  refresh: raw('<svg class="fi i-refresh" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.1446 26.1836 C 27.7070 26.1836 28.1524 25.9961 28.5039 25.6445 L 38.1602 15.9414 C 38.5586 15.5430 38.7461 15.0742 38.7461 14.5352 C 38.7461 14.0195 38.5352 13.5039 38.1602 13.1289 L 28.5039 3.3320 C 28.1758 2.9570 27.7070 2.7695 27.1211 2.7695 C 26.0899 2.7695 25.2930 3.6133 25.2930 4.6914 C 25.2930 5.1836 25.4570 5.6523 25.8086 6.0274 L 32.0664 12.1679 C 30.7305 11.9336 29.3477 11.7930 27.9883 11.7930 C 16.5039 11.7930 7.2930 21.0039 7.2930 32.4883 C 7.2930 43.9961 16.5039 53.2305 27.9883 53.2305 C 39.4726 53.2305 48.7070 43.9961 48.7070 32.4883 C 48.7070 31.3633 47.9102 30.5430 46.7383 30.5430 C 45.6367 30.5430 44.9336 31.3633 44.9336 32.4883 C 44.9336 41.9101 37.3867 49.4570 27.9883 49.4570 C 18.5899 49.4570 11.0664 41.9101 11.0664 32.4883 C 11.0664 23.0898 18.5899 15.5664 27.9883 15.5664 C 29.7930 15.5664 31.4102 15.7070 32.8399 16.0117 L 25.8320 22.9726 C 25.4570 23.3477 25.2930 23.8164 25.2930 24.3086 C 25.2930 25.3867 26.0899 26.1836 27.1446 26.1836 Z"/></svg>'),
  plus: raw('<svg class="fi i-plus" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.9883 47.7344 C 29.1367 47.7344 30.0976 46.8203 30.0976 45.6953 L 30.0976 30.1094 L 45.2383 30.1094 C 46.3633 30.1094 47.3476 29.1484 47.3476 28 C 47.3476 26.8516 46.3633 25.9141 45.2383 25.9141 L 30.0976 25.9141 L 30.0976 10.3047 C 30.0976 9.1797 29.1367 8.2656 27.9883 8.2656 C 26.8398 8.2656 25.9024 9.1797 25.9024 10.3047 L 25.9024 25.9141 L 10.7617 25.9141 C 9.6367 25.9141 8.6524 26.8516 8.6524 28 C 8.6524 29.1484 9.6367 30.1094 10.7617 30.1094 L 25.9024 30.1094 L 25.9024 45.6953 C 25.9024 46.8203 26.8398 47.7344 27.9883 47.7344 Z"/></svg>'),
  sparkles: raw('<svg class="fi i-sparkles" viewBox="0 0 56 56" aria-hidden="true"><path d="M 21.8712 15.5664 C 22.1524 15.5664 22.2930 15.4024 22.3399 15.1445 C 23.1368 11.3945 23.0899 11.2539 27.0040 10.4570 C 27.2852 10.4102 27.4493 10.2461 27.4493 9.9883 C 27.4493 9.7070 27.2852 9.5429 27.0040 9.4961 C 23.0899 8.6992 23.1368 8.5586 22.3399 4.8320 C 22.2930 4.5742 22.1524 4.3867 21.8712 4.3867 C 21.5899 4.3867 21.4493 4.5742 21.3790 4.8320 C 20.6055 8.5586 20.6524 8.6992 16.7149 9.4961 C 16.4571 9.5429 16.2696 9.7070 16.2696 9.9883 C 16.2696 10.2461 16.4571 10.4102 16.7149 10.4570 C 20.6524 11.2539 20.6055 11.3945 21.3790 15.1445 C 21.4493 15.4024 21.5899 15.5664 21.8712 15.5664 Z M 41.2306 23.8398 C 41.5587 23.8398 41.7462 23.6289 41.7930 23.3242 C 42.6134 18.8711 42.6368 18.5898 47.3475 17.7695 C 47.6523 17.7227 47.8866 17.5117 47.8866 17.1836 C 47.8866 16.8555 47.6523 16.6680 47.3475 16.5976 C 42.6368 15.8008 42.6134 15.5195 41.7930 11.0664 C 41.7462 10.7617 41.5587 10.5273 41.2306 10.5273 C 40.9024 10.5273 40.6915 10.7617 40.6446 11.0664 C 39.8477 15.5195 39.8243 15.8008 35.1134 16.5976 C 34.7852 16.6680 34.5743 16.8555 34.5743 17.1836 C 34.5743 17.5117 34.7852 17.7227 35.1134 17.7695 C 39.8243 18.5898 39.8477 18.8711 40.6446 23.3242 C 40.6915 23.6289 40.9024 23.8398 41.2306 23.8398 Z M 9.0274 30.5664 C 9.3555 30.5664 9.5430 30.3320 9.5899 30.0273 C 10.4102 25.5742 10.4337 25.2929 15.1446 24.4961 C 15.4493 24.4258 15.6837 24.2383 15.6837 23.9102 C 15.6837 23.5820 15.4493 23.3711 15.1446 23.3242 C 10.4337 22.5039 10.4102 22.2227 9.5899 17.7695 C 9.5430 17.4649 9.3555 17.2539 9.0274 17.2539 C 8.6993 17.2539 8.4884 17.4649 8.4415 17.7695 C 7.6212 22.2227 7.6212 22.5039 2.9102 23.3242 C 2.5821 23.3711 2.3712 23.5820 2.3712 23.9102 C 2.3712 24.2383 2.5821 24.4258 2.9102 24.4961 C 7.6212 25.2929 7.6212 25.5742 8.4415 30.0273 C 8.4884 30.3320 8.6993 30.5664 9.0274 30.5664 Z M 49.0352 50.6055 C 50.0432 51.6133 51.7304 51.6133 52.6448 50.6055 C 53.6288 49.5742 53.6288 47.9805 52.6448 46.9961 L 30.3790 24.6367 C 29.3946 23.6524 27.7071 23.6524 26.7696 24.6367 C 25.7852 25.6680 25.8087 27.2851 26.7696 28.2695 Z M 35.4181 34.5039 L 28.5508 27.6133 C 28.1290 27.1914 28.0118 26.7461 28.4102 26.3242 C 28.8087 25.9492 29.2540 26.0429 29.6993 26.4883 L 36.5899 33.3789 Z M 20.1602 50.9805 C 20.5821 50.9805 20.8868 50.6758 20.9337 50.2305 C 21.7071 43.9727 22.0118 43.8086 28.3634 42.7773 C 28.8790 42.6836 29.1837 42.4492 29.1837 41.9805 C 29.1837 41.5352 28.8790 41.2539 28.4571 41.1836 C 22.0587 39.9649 21.7071 39.9883 20.9337 33.7305 C 20.8868 33.2851 20.5821 32.9805 20.1602 32.9805 C 19.7149 32.9805 19.4102 33.2851 19.3634 33.7070 C 18.5430 40.0586 18.3087 40.2695 11.8399 41.1836 C 11.4181 41.2305 11.1134 41.5352 11.1134 41.9805 C 11.1134 42.4258 11.4181 42.6836 11.8399 42.7773 C 18.3087 44.0195 18.5196 44.0195 19.3634 50.2773 C 19.4102 50.6758 19.7149 50.9805 20.1602 50.9805 Z"/></svg>'),
  layout: raw('<svg class="fi i-layout" viewBox="0 0 56 56" aria-hidden="true"><path d="M 8.0663 26.0664 L 47.9334 26.0664 C 51.5195 26.0664 53.3243 24.3086 53.3243 20.6992 L 53.3243 11.7461 C 53.3243 8.1602 51.5195 6.4258 47.9334 6.4258 L 8.0663 6.4258 C 4.4804 6.4258 2.6757 8.1602 2.6757 11.7461 L 2.6757 20.6992 C 2.6757 24.3086 4.4804 26.0664 8.0663 26.0664 Z M 8.3476 22.5274 C 6.9648 22.5274 6.2148 21.8008 6.2148 20.3477 L 6.2148 12.1445 C 6.2148 10.6680 6.9648 9.9649 8.3476 9.9649 L 47.6521 9.9649 C 49.0350 9.9649 49.7852 10.6680 49.7852 12.1445 L 49.7852 20.3477 C 49.7852 21.8008 49.0350 22.5274 47.6521 22.5274 Z M 8.0663 49.5742 L 47.9334 49.5742 C 51.5195 49.5742 53.3243 47.8399 53.3243 44.2305 L 53.3243 35.2539 C 53.3243 31.6914 51.5195 29.9336 47.9334 29.9336 L 8.0663 29.9336 C 4.4804 29.9336 2.6757 31.6914 2.6757 35.2539 L 2.6757 44.2305 C 2.6757 47.8399 4.4804 49.5742 8.0663 49.5742 Z M 8.3476 46.0352 C 6.9648 46.0352 6.2148 45.3086 6.2148 43.8555 L 6.2148 35.6523 C 6.2148 34.1758 6.9648 33.4727 8.3476 33.4727 L 47.6521 33.4727 C 49.0350 33.4727 49.7852 34.1758 49.7852 35.6523 L 49.7852 43.8555 C 49.7852 45.3086 49.0350 46.0352 47.6521 46.0352 Z"/></svg>'),
  mask: raw('<svg class="fi i-mask" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.9999 51.9063 C 41.0546 51.9063 51.9063 41.0781 51.9063 28 C 51.9063 14.9453 41.0312 4.0937 27.9765 4.0937 C 14.8983 4.0937 4.0937 14.9453 4.0937 28 C 4.0937 41.0781 14.9218 51.9063 27.9999 51.9063 Z M 27.9999 35.9922 C 20.9452 35.9922 15.5077 38.5 13.1405 41.3125 C 9.9999 37.7968 8.1014 33.1328 8.1014 28 C 8.1014 16.9609 16.9140 8.0781 27.9765 8.0781 C 39.0155 8.0781 47.8983 16.9609 47.9219 28 C 47.9219 33.1563 46.0234 37.8203 42.8593 41.3359 C 40.4921 38.5234 35.0546 35.9922 27.9999 35.9922 Z M 27.9999 32.0078 C 32.4999 32.0547 36.0390 28.2109 36.0390 23.1719 C 36.0390 18.4375 32.4765 14.5 27.9999 14.5 C 23.4999 14.5 19.9140 18.4375 19.9609 23.1719 C 19.9843 28.2109 23.4765 31.9609 27.9999 32.0078 Z"/></svg>'),
  gear: raw('<svg class="fi i-gear" viewBox="0 0 56 56" aria-hidden="true"><path d="M18.2918704,0.682944646 L20.3171289,2.92622342 C22.5361373,5.38410946 26.1397265,5.3776124 28.3528693,2.92622342 L30.2521549,0.822478633 C32.5839645,1.4499386 34.7753833,2.41991367 36.7691418,3.67513451 L36.6322262,6.35564535 C36.4633143,9.66270916 39.0160307,12.2062374 42.3143528,12.0377719 L44.7391942,11.9139205 C45.970889,14.0228998 46.8900976,16.3366849 47.4333262,18.7917819 L45.7437747,20.3171289 C43.2858887,22.5361373 43.2923858,26.1397265 45.7437747,28.3528693 L47.3039836,29.7614443 C46.6873969,32.2638048 45.6782881,34.6116668 44.3457025,36.735985 L42.3143528,36.6322262 C39.007289,36.4633143 36.4637608,39.0160307 36.6322262,42.3143528 L36.7359799,44.3457057 C34.6116668,45.6782881 32.2638048,46.6873969 29.7614443,47.3039836 L28.3528693,45.7437747 C26.1338609,43.2858887 22.5302717,43.2923858 20.3171289,45.7437747 L18.7917819,47.4333262 C16.3366849,46.8900976 14.0228998,45.970889 11.9139205,44.7391942 L12.0377719,42.3143528 C12.2066839,39.007289 9.65396742,36.4637608 6.35564535,36.6322262 L3.67513117,36.7691365 C2.41991367,34.7753833 1.4499386,32.5839645 0.822478633,30.2521549 L2.92622342,28.3528693 C5.38410946,26.1338609 5.3776124,22.5302717 2.92622342,20.3171289 L0.682944646,18.2918704 C1.23975257,16.0094974 2.12293759,13.8550207 3.28024752,11.8806926 L6.35564535,12.0377719 C9.66270916,12.2066839 12.2062374,9.65396742 12.0377719,6.35564535 L11.8806926,3.28024752 C13.8550207,2.12293759 16.0094974,1.23975257 18.2918704,0.682944646 Z M16.7256456,4.44999867 C16.3680614,4.5830738 16.0143918,4.72596655 15.6649839,4.87849119 L15.6911683,5.3911466 C15.9929207,11.2990434 11.3040265,15.9931752 5.39114661,15.6911683 L4.8784912,15.6649838 C4.72596656,16.0143918 4.58307381,16.3680614 4.44999868,16.7256456 L4.82312058,17.0625044 C9.21400567,21.0266472 9.2177092,27.6614485 4.82312058,31.6289348 L4.65050066,31.7847781 C4.8175234,32.1991992 4.99787387,32.6079553 5.19123643,33.0104816 L5.39114661,33.000271 C11.2419278,32.7014358 15.9022991,37.2972177 15.69853,43.1291478 C16.1923007,43.3436519 16.6945117,43.5389223 17.2041918,43.7144479 C21.0763433,39.5916597 27.3599325,39.5262017 31.3077432,43.5279548 C31.8779091,43.3144137 32.4380042,43.0759167 32.9866081,42.8132437 C32.9594643,37.2979481 37.2937012,32.9592904 42.8132466,32.9866016 C43.0759195,32.4379975 43.3144164,31.8779023 43.5279572,31.3077365 C39.529445,27.3629141 39.5883149,21.0793847 43.7144475,17.2041904 C43.5389218,16.6945104 43.3436515,16.1922996 43.1291474,15.6985291 C37.3945193,15.8988384 32.8475535,11.3933767 32.9897182,5.66905791 L33.010482,5.1912368 C32.6079555,4.99787406 32.1991992,4.8175235 31.7847781,4.65050071 L31.6289348,4.82312057 C27.6647921,9.21400566 21.0299908,9.2177092 17.0625045,4.82312057 L16.7256456,4.44999867 Z M24,15 C28.9705627,15 33,19.0294373 33,24 C33,28.9705627 28.9705627,33 24,33 C19.0294373,33 15,28.9705627 15,24 C15,19.0294373 19.0294373,15 24,15 Z M24,18 C20.6862915,18 18,20.6862915 18,24 C18,27.3137085 20.6862915,30 24,30 C27.3137085,30 30,27.3137085 30,24 C30,20.6862915 27.3137085,18 24,18 Z" transform="translate(4 4)"/></svg>'),
  shield: raw('<svg class="fi i-shield" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.9883 51.6719 C 28.3633 51.6719 28.9726 51.5313 29.5821 51.2031 C 42.8945 43.7266 47.4883 40.5625 47.4883 32.0078 L 47.4883 14.0781 C 47.4883 11.6172 46.4101 10.8438 44.4414 10.0000 C 41.6758 8.8516 32.7226 5.6406 29.9570 4.6797 C 29.3242 4.4687 28.6680 4.3281 27.9883 4.3281 C 27.3321 4.3281 26.6758 4.5156 26.0430 4.6797 C 23.2774 5.5234 14.3242 8.8750 11.5586 10.0000 C 9.5899 10.8203 8.5117 11.6172 8.5117 14.0781 L 8.5117 32.0078 C 8.5117 40.5625 13.1289 43.7031 26.4180 51.2031 C 27.0274 51.5313 27.6133 51.6719 27.9883 51.6719 Z M 27.9883 47.4063 C 27.6367 47.4063 27.2383 47.2656 26.5352 46.8438 C 15.7070 40.2813 12.2383 38.3594 12.2383 31.1406 L 12.2383 14.7813 C 12.2383 13.9844 12.4023 13.6797 13.0352 13.4219 C 16.5977 12.0156 23.4648 9.5781 27.0742 8.2891 C 27.4258 8.1484 27.7305 8.0781 27.9883 8.0781 C 28.2695 8.0781 28.5508 8.1484 28.9258 8.2891 C 32.5352 9.5781 39.3321 12.1797 42.9648 13.4219 C 43.5977 13.6562 43.7617 13.9844 43.7617 14.7813 L 43.7617 31.1406 C 43.7617 38.3594 40.2695 40.2578 29.4648 46.8438 C 28.7617 47.2656 28.3633 47.4063 27.9883 47.4063 Z"/></svg>'),
  send: raw('<svg class="fi i-send" viewBox="0 0 56 56" aria-hidden="true"><path d="M 32.7812 52.5508 C 34.4687 52.5508 35.6640 51.0977 36.5312 48.8477 L 51.8829 8.7461 C 52.3048 7.6679 52.5626 6.7070 52.5626 5.9101 C 52.5626 4.3867 51.6016 3.4492 50.0781 3.4492 C 49.2813 3.4492 48.3203 3.6836 47.2423 4.1055 L 6.9296 19.5508 C 4.9609 20.3008 3.4374 21.4961 3.4374 23.2070 C 3.4374 25.3633 5.0780 26.0898 7.3280 26.7695 L 24.2499 31.7383 L 29.1718 48.4492 C 29.8749 50.8164 30.6015 52.5508 32.7812 52.5508 Z M 25.3046 28.1758 L 9.1328 23.2305 C 8.7577 23.1133 8.6406 23.0195 8.6406 22.8555 C 8.6406 22.6914 8.7343 22.5742 9.0859 22.4336 L 40.7733 10.4336 C 42.6484 9.7305 44.4531 8.7930 46.1874 7.9961 C 44.6406 9.2617 42.7187 10.7617 41.4296 12.0508 Z M 33.1562 47.3945 C 32.9687 47.3945 32.8749 47.2305 32.7577 46.8555 L 27.8124 30.6836 L 43.9374 14.5586 C 45.2031 13.2930 46.7733 11.3242 48.0155 9.7305 C 47.2187 11.5117 46.2812 13.3164 45.5546 15.2148 L 33.5546 46.9023 C 33.4140 47.2539 33.3202 47.3945 33.1562 47.3945 Z"/></svg>'),
  warn: raw('<svg class="fi i-warn" viewBox="0 0 56 56" aria-hidden="true"><path d="M 9.9647 50.2070 L 46.0351 50.2070 C 50.0195 50.2070 52.5040 47.3476 52.5040 43.7383 C 52.5040 42.6601 52.2227 41.5586 51.6367 40.5508 L 33.5663 9.0742 C 32.3476 6.9414 30.2147 5.7930 28.0116 5.7930 C 25.8319 5.7930 23.6757 6.9414 22.4335 9.0742 L 4.3632 40.5742 C 3.7772 41.5820 3.4960 42.6601 3.4960 43.7383 C 3.4960 47.3476 6.0038 50.2070 9.9647 50.2070 Z M 10.0116 46.5273 C 8.3710 46.5273 7.2929 45.1914 7.2929 43.7383 C 7.2929 43.3164 7.3632 42.8242 7.5976 42.3320 L 25.6444 10.8554 C 26.1600 9.9648 27.0976 9.5430 28.0116 9.5430 C 28.9257 9.5430 29.8163 9.9414 30.3319 10.8554 L 48.3789 42.3555 C 48.6131 42.8242 48.7303 43.3164 48.7303 43.7383 C 48.7303 45.1914 47.6051 46.5273 45.9882 46.5273 Z M 28.0116 34.4101 C 29.1366 34.4101 29.7929 33.7539 29.8163 32.5352 L 30.1444 20.1836 C 30.1678 18.9883 29.2304 18.0976 27.9882 18.0976 C 26.7225 18.0976 25.8319 18.9648 25.8554 20.1601 L 26.1600 32.5352 C 26.1835 33.7305 26.8398 34.4101 28.0116 34.4101 Z M 28.0116 42.0273 C 29.3710 42.0273 30.5429 40.9492 30.5429 39.5898 C 30.5429 38.2070 29.3944 37.1523 28.0116 37.1523 C 26.6288 37.1523 25.4804 38.2305 25.4804 39.5898 C 25.4804 40.9258 26.6522 42.0273 28.0116 42.0273 Z"/></svg>'),
  more: raw('<svg class="fi i-more" viewBox="0 0 56 56" aria-hidden="true"><path d="M 15.3203 28 C 15.3203 25.3984 13.2344 23.3125 10.5860 23.3125 C 7.9844 23.3125 5.8985 25.3984 5.8985 28 C 5.8985 30.6016 7.9844 32.6875 10.5860 32.6875 C 13.2344 32.6875 15.3203 30.6016 15.3203 28 Z M 32.6641 28 C 32.6641 25.3984 30.6016 23.3125 28.0000 23.3125 C 25.3984 23.3125 23.3360 25.3984 23.3360 28 C 23.3360 30.6016 25.3984 32.6875 28.0000 32.6875 C 30.6016 32.6875 32.6641 30.6016 32.6641 28 Z M 50.1015 28 C 50.1015 25.3984 47.9922 23.3125 45.4141 23.3125 C 42.7657 23.3125 40.6797 25.3984 40.6797 28 C 40.6797 30.6016 42.7657 32.6875 45.4141 32.6875 C 47.9922 32.6875 50.1015 30.6016 50.1015 28 Z"/></svg>'),
  hash: raw('<svg class="fi i-hash" viewBox="0 0 56 56" aria-hidden="true"><path d="M 8.7461 37.7031 L 15.8945 37.7031 L 13.7617 48.2969 C 13.7148 48.5312 13.6914 48.8125 13.6914 49.0469 C 13.6914 50.1953 14.4883 50.8281 15.5898 50.8281 C 16.7148 50.8281 17.5351 50.2187 17.7695 49.0703 L 20.0664 37.7031 L 31.1524 37.7031 L 29.0195 48.2969 C 28.9492 48.5312 28.9258 48.8125 28.9258 49.0469 C 28.9258 50.1953 29.7227 50.8281 30.8476 50.8281 C 31.9727 50.8281 32.7929 50.2187 33.0273 49.0703 L 35.3008 37.7031 L 43.6680 37.7031 C 44.9570 37.7031 45.8476 36.7656 45.8476 35.5 C 45.8476 34.4687 45.1445 33.6250 44.0898 33.6250 L 36.1445 33.6250 L 38.6289 21.25 L 46.8320 21.25 C 48.1211 21.25 49.0117 20.3125 49.0117 19.0468 C 49.0117 18.0156 48.3086 17.1719 47.2539 17.1719 L 39.4492 17.1719 L 41.3711 7.7265 C 41.3945 7.5859 41.4414 7.2812 41.4414 6.9766 C 41.4414 5.8281 40.6211 5.1719 39.4961 5.1719 C 38.1836 5.1719 37.5976 5.8984 37.3633 7.0000 L 35.3008 17.1719 L 24.2148 17.1719 L 26.1367 7.7265 C 26.1602 7.5859 26.2070 7.2812 26.2070 6.9766 C 26.2070 5.8281 25.3633 5.1719 24.2617 5.1719 C 22.9258 5.1719 22.3164 5.8984 22.1055 7.0000 L 20.0429 17.1719 L 12.3555 17.1719 C 11.0664 17.1719 10.1758 18.1563 10.1758 19.4453 C 10.1758 20.5 10.8789 21.25 11.9336 21.25 L 19.2227 21.25 L 16.7383 33.6250 L 9.1680 33.6250 C 7.8789 33.6250 6.9883 34.6094 6.9883 35.8984 C 6.9883 36.9531 7.6914 37.7031 8.7461 37.7031 Z M 20.8867 33.6250 L 23.3945 21.25 L 34.4805 21.25 L 31.9727 33.6250 Z"/></svg>'),
  chevron: raw('<svg class="fi i-chevron" viewBox="0 0 56 56" aria-hidden="true"><path d="M 18.6953 48.3672 C 19.2813 48.3672 19.7969 48.1328 20.2187 47.7344 L 38.7813 29.5703 C 39.2266 29.1250 39.4609 28.5859 39.4609 28.0000 C 39.4609 27.3906 39.2266 26.8281 38.7813 26.4297 L 20.2187 8.2890 C 19.8203 7.8672 19.2813 7.6328 18.6953 7.6328 C 17.4766 7.6328 16.5391 8.5703 16.5391 9.7890 C 16.5391 10.3515 16.7969 10.9141 17.1718 11.3125 L 34.2109 28.0000 L 17.1718 44.6875 C 16.7969 45.0859 16.5391 45.6250 16.5391 46.2109 C 16.5391 47.4297 17.4766 48.3672 18.6953 48.3672 Z"/></svg>'),
  back: raw('<svg class="fi i-back" viewBox="0 0 56 56" aria-hidden="true"><path d="M 35.8047 47.7226 C 36.2031 48.1211 36.7187 48.3555 37.3281 48.3555 C 38.5469 48.3555 39.4609 47.4414 39.4609 46.2226 C 39.4609 45.6367 39.2266 45.0976 38.8515 44.6992 L 21.7891 28.0117 L 38.8515 11.3242 C 39.2266 10.9258 39.4609 10.3633 39.4609 9.8007 C 39.4609 8.5820 38.5469 7.6445 37.3281 7.6445 C 36.7187 7.6445 36.2031 7.8789 35.8047 8.2773 L 17.2422 26.4414 C 16.7969 26.8164 16.5391 27.4023 16.5391 28.0117 C 16.5391 28.5976 16.7969 29.1367 17.2422 29.5820 Z"/></svg>'),
  sun: raw('<svg class="fi i-sun" viewBox="0 0 56 56" aria-hidden="true"><path d="M 30.0391 4.6094 C 30.0391 3.5078 29.1016 2.5703 28.0001 2.5703 C 26.8985 2.5703 25.9610 3.5078 25.9610 4.6094 L 25.9610 9.5312 C 25.9610 10.6328 26.8985 11.5703 28.0001 11.5703 C 29.1016 11.5703 30.0391 10.6328 30.0391 9.5312 Z M 39.5782 13.5390 C 38.8047 14.3359 38.8047 15.6484 39.5782 16.4219 C 40.3751 17.2187 41.6642 17.2422 42.4844 16.4219 L 45.9766 12.9297 C 46.7737 12.1328 46.7737 10.8203 45.9766 10.0234 C 45.2032 9.25 43.8907 9.25 43.0938 10.0234 Z M 13.5157 16.4219 C 14.2891 17.2187 15.6016 17.2187 16.3985 16.4219 C 17.1720 15.6719 17.1720 14.3125 16.4220 13.5390 L 12.9298 10.0234 C 12.1798 9.2734 10.8438 9.25 10.0469 10.0234 C 9.2735 10.7968 9.2735 12.1328 10.0235 12.9063 Z M 28.0001 16.0468 C 21.4610 16.0468 16.0469 21.4609 16.0469 28.0000 C 16.0469 34.5390 21.4610 39.9766 28.0001 39.9766 C 34.5157 39.9766 39.9298 34.5390 39.9298 28.0000 C 39.9298 21.4609 34.5157 16.0468 28.0001 16.0468 Z M 28.0001 19.6328 C 32.5704 19.6328 36.3673 23.4297 36.3673 28.0000 C 36.3673 32.5703 32.5704 36.3906 28.0001 36.3906 C 23.4063 36.3906 19.6094 32.5703 19.6094 28.0000 C 19.6094 23.4297 23.4063 19.6328 28.0001 19.6328 Z M 51.3203 30.0390 C 52.4219 30.0390 53.3593 29.1016 53.3593 28.0000 C 53.3593 26.8984 52.4219 25.9609 51.3203 25.9609 L 46.4220 25.9609 C 45.3204 25.9609 44.3829 26.8984 44.3829 28.0000 C 44.3829 29.1016 45.3204 30.0390 46.4220 30.0390 Z M 4.6798 25.9609 C 3.5782 25.9609 2.6407 26.8984 2.6407 28.0000 C 2.6407 29.1016 3.5782 30.0390 4.6798 30.0390 L 9.5782 30.0390 C 10.6798 30.0390 11.6173 29.1016 11.6173 28.0000 C 11.6173 26.8984 10.6798 25.9609 9.5782 25.9609 Z M 42.4610 39.6016 C 41.6642 38.8281 40.3751 38.8281 39.5782 39.6016 C 38.8047 40.3750 38.8047 41.6875 39.5782 42.4844 L 43.0938 46.0000 C 43.8907 46.7734 45.2032 46.7500 45.9766 45.9766 C 46.7737 45.2031 46.7737 43.8906 45.9766 43.0937 Z M 10.0235 43.0703 C 9.2266 43.8437 9.2266 45.1797 10.0001 45.9531 C 10.7735 46.7266 12.1094 46.7500 12.9063 45.9766 L 16.3985 42.4844 C 17.1720 41.7109 17.1720 40.3984 16.4220 39.6016 C 15.6485 38.8281 14.3126 38.8281 13.5157 39.6016 Z M 30.0391 46.4687 C 30.0391 45.3672 29.1016 44.4297 28.0001 44.4297 C 26.8985 44.4297 25.9610 45.3672 25.9610 46.4687 L 25.9610 51.3906 C 25.9610 52.4922 26.8985 53.4297 28.0001 53.4297 C 29.1016 53.4297 30.0391 52.4922 30.0391 51.3906 Z"/></svg>'),
  moon: raw('<svg class="fi i-moon" viewBox="0 0 56 56" aria-hidden="true"><path d="M 41.2423 36.1211 C 28.3048 36.1211 20.2892 28.3399 20.2892 15.8477 C 20.2892 12.2852 20.8985 9.1445 21.7657 7.4570 C 22.1173 6.7774 22.1642 6.4492 22.1642 5.9805 C 22.1642 5.2070 21.4610 4.2930 20.4767 4.2930 C 20.2892 4.2930 19.8438 4.3633 19.1642 4.6211 C 10.5157 8.1367 4.4220 17.2774 4.4220 27.1211 C 4.4220 41.3477 14.7345 51.7070 28.9610 51.7070 C 39.1798 51.7070 47.4298 46.3633 51.2502 37.5977 C 51.5079 36.9883 51.5780 36.4726 51.5780 36.2148 C 51.5780 35.2539 50.7347 34.5977 50.0315 34.5977 C 49.6331 34.5977 49.3753 34.6211 48.8127 34.8320 C 46.8907 35.6055 44.0314 36.1211 41.2423 36.1211 Z M 8.1016 26.9570 C 8.1016 19.6680 11.8751 12.7305 17.9689 8.9101 C 17.2189 11.0899 16.7970 13.5039 16.7970 16.1758 C 16.7970 30.8242 25.7267 39.5430 40.7032 39.5430 C 43.0938 39.5430 45.1563 39.2617 47.0782 38.5821 C 43.5157 44.4648 36.6485 48.0508 29.1251 48.0508 C 16.9610 48.0508 8.1016 39.1914 8.1016 26.9570 Z"/></svg>'),
  sliders: raw('<svg class="fi i-sliders" viewBox="0 0 56 56" aria-hidden="true"><path d="M 36.4023 19.3164 C 38.8398 19.3164 40.9257 17.7461 41.6992 15.5898 L 49.8085 15.5898 C 50.7695 15.5898 51.6133 14.7461 51.6133 13.6914 C 51.6133 12.6367 50.7695 11.8164 49.8085 11.8164 L 41.7226 11.8164 C 40.9257 9.6367 38.8398 8.0430 36.4023 8.0430 C 33.9648 8.0430 31.8789 9.6367 31.1054 11.8164 L 6.2851 11.8164 C 5.2304 11.8164 4.3867 12.6367 4.3867 13.6914 C 4.3867 14.7461 5.2304 15.5898 6.2851 15.5898 L 31.1054 15.5898 C 31.8789 17.7461 33.9648 19.3164 36.4023 19.3164 Z M 36.4023 16.4336 C 34.8789 16.4336 33.6601 15.2148 33.6601 13.6679 C 33.6601 12.1211 34.8789 10.9258 36.4023 10.9258 C 37.9492 10.9258 39.1445 12.1211 39.1445 13.6679 C 39.1445 15.2148 37.9492 16.4336 36.4023 16.4336 Z M 6.1913 26.1133 C 5.2304 26.1133 4.3867 26.9570 4.3867 28.0117 C 4.3867 29.0664 5.2304 29.8867 6.1913 29.8867 L 14.5586 29.8867 C 15.3320 32.0898 17.4179 33.6601 19.8554 33.6601 C 22.3164 33.6601 24.4023 32.0898 25.1757 29.8867 L 49.7149 29.8867 C 50.7695 29.8867 51.6133 29.0664 51.6133 28.0117 C 51.6133 26.9570 50.7695 26.1133 49.7149 26.1133 L 25.1757 26.1133 C 24.3789 23.9570 22.2929 22.3867 19.8554 22.3867 C 17.4413 22.3867 15.3554 23.9570 14.5586 26.1133 Z M 19.8554 30.7539 C 18.3320 30.7539 17.1132 29.5352 17.1132 28.0117 C 17.1132 26.4648 18.3320 25.2695 19.8554 25.2695 C 21.4257 25.2695 22.5976 26.4648 22.5976 28.0117 C 22.5976 29.5352 21.4257 30.7539 19.8554 30.7539 Z M 36.4023 47.9570 C 38.8398 47.9570 40.9257 46.3867 41.6992 44.2070 L 49.8085 44.2070 C 50.7695 44.2070 51.6133 43.3867 51.6133 42.3320 C 51.6133 41.2773 50.7695 40.4336 49.8085 40.4336 L 41.6992 40.4336 C 40.9257 38.2539 38.8398 36.7070 36.4023 36.7070 C 33.9648 36.7070 31.8789 38.2539 31.1054 40.4336 L 6.2851 40.4336 C 5.2304 40.4336 4.3867 41.2773 4.3867 42.3320 C 4.3867 43.3867 5.2304 44.2070 6.2851 44.2070 L 31.1054 44.2070 C 31.8789 46.3867 33.9648 47.9570 36.4023 47.9570 Z M 36.4023 45.0742 C 34.8789 45.0742 33.6601 43.8555 33.6601 42.3320 C 33.6601 40.7617 34.8789 39.5898 36.4023 39.5898 C 37.9492 39.5898 39.1445 40.7617 39.1445 42.3320 C 39.1445 43.8555 37.9492 45.0742 36.4023 45.0742 Z"/></svg>'),
  logout: raw('<svg class="fi i-logout" viewBox="0 0 56 56" aria-hidden="true"><path d="M35.8906,20.9883 C35.8906,21.4805 35.7266,21.8789 35.2578,22.3477 L27.6172,30.2695 C27.2656,30.6211 26.8906,30.8321 26.375,30.8321 C25.4141,30.8321 24.7344,30.1289 24.7344,29.1445 C24.7344,28.6758 24.9219,28.1836 25.2969,27.8555 L29.0703,24.293 L30.7344,22.6992 L27.2422,22.8633 L2.5156,22.8633 C1.5313,22.8633 0.7109,21.9961 0.7109,20.9883 C0.7109,19.9805 1.5313,19.1367 2.5156,19.1367 L27.2422,19.1367 L30.7344,19.2774 L29.0703,17.6836 L25.2969,14.1445 C24.9219,13.8164 24.7344,13.3242 24.7344,12.8789 C24.7344,11.8945 25.4141,11.168 26.375,11.168 C26.8906,11.168 27.2656,11.3555 27.6172,11.707 L35.2578,19.6289 C35.7266,20.0977 35.8906,20.5195 35.8906,20.9883 Z M51.2891,34.4414 C51.2891,39.3164 48.875,41.8008 44.0234,41.8008 L19.836,41.8008 C15.0078,41.8008 12.5703,39.3164 12.5703,34.4414 L12.5703,27.668 L16.3438,27.668 L16.3438,34.3711 C16.3438,36.7148 17.6094,38.0274 20.0469,38.0274 L43.8359,38.0274 C46.2734,38.0274 47.5156,36.7148 47.5156,34.3711 L47.5156,7.6055 C47.5156,5.3086 46.2734,3.9726 43.8359,3.9726 L20.0469,3.9726 C17.6094,3.9726 16.3438,5.3086 16.3438,7.6055 L16.3438,14.3086 L12.5703,14.3086 L12.5703,7.5586 C12.5703,2.6367 15.0078,0.1992 19.836,0.1992 L44.0234,0.1992 C48.8516,0.1992 51.2891,2.6367 51.2891,7.5586 L51.2891,34.4414 Z" transform="translate(2 7)"/></svg>'),
  quill: raw('<svg class="fi i-quill" viewBox="0 0 56 56" aria-hidden="true"><path d="M 13.4570 44.7578 C 19.9492 51.25 28.3866 53.1953 32.5351 53.5937 C 33.7539 53.7344 34.4335 52.9844 34.5273 52.2110 C 34.6210 51.3906 34.1054 50.5000 32.9335 50.3359 C 29.1835 49.8203 21.4257 48.1328 15.8007 42.4375 C 6.6132 33.2266 4.8788 19.3047 12.3788 11.8047 C 18.4726 5.7344 28.6210 6.5078 36.0976 10.5391 L 38.5351 8.1719 C 29.4413 2.7110 17.2070 2.2656 10.0351 9.4610 C 1.5039 18.0156 2.6288 33.9297 13.4570 44.7578 Z M 47.8164 11.5469 L 49.6913 9.6719 C 50.5817 8.7813 50.6288 7.4688 49.7149 6.6250 L 49.1053 6.0625 C 48.3085 5.3125 47.0663 5.3359 46.1992 6.1563 L 44.3476 8.0547 Z M 25.0585 34.2578 L 46.1054 13.2344 L 42.6132 9.7656 L 21.5898 30.7656 L 19.6445 35.2422 C 19.4570 35.7344 19.9492 36.2266 20.4648 36.0625 Z M 21.9882 37.75 C 29.6523 45.4141 41.9804 48.4375 48.8710 41.5703 C 54.4961 35.9219 53.7694 25.8906 47.7461 17.2656 L 45.3554 19.6563 C 50.1368 26.7344 51.0742 34.6797 46.5273 39.2266 C 40.9961 44.7578 31.8554 42.1328 25.5742 36.2032 Z"/></svg>'),
  chat: raw('<svg class="fi i-chat" viewBox="0 0 56 56" aria-hidden="true"><path d="M17.5035668,40.5296937 C19.0024662,40.0159063 20.530255,39.9036804 22.1150875,40.242095 C23.3913721,40.4234251 24.6878688,40.5153676 26,40.5153676 C38.462083,40.5153676 48.2812121,32.2755588 48.2812121,22.5377685 C48.2812121,12.8019501 38.4617239,4.56240733 26,4.56240733 C13.5368558,4.56240733 3.71878789,12.8012343 3.71878789,22.5377685 C3.71878789,27.5645198 6.32376869,32.3237361 10.8918817,35.7272859 C11.006387,35.811306 11.2685741,35.9959543 11.5565666,36.1954672 C11.6839828,36.2837375 11.8060878,36.367737 11.8989137,36.4310247 C11.8796069,36.4178214 11.9540395,36.4678495 11.851738,36.407108 L12.042003,36.5200778 L12.2201977,36.6512631 C14.0421606,37.9925748 14.911757,39.7895096 15.034093,41.7494472 C16.0115023,41.2059428 16.9508283,40.7191594 17.5035668,40.5296937 Z M0.17,22.559188 C0.17,10.5904526 11.7325761,0.885839053 26,0.885839053 C40.2652635,0.885839053 51.83,10.5904526 51.83,22.559188 C51.83,34.5300838 40.2652635,44.2346974 26,44.2346974 C24.4509778,44.2346974 22.9365222,44.120195 21.4631148,43.9019924 C21.4609543,43.9019924 21.4566335,43.899832 21.4544731,43.899832 C17.9653923,43.0680697 16.4876639,46.9481868 8.53731265,48.9595393 C6.90403396,49.3743402 6.7074356,48.9616997 7.95831967,47.6352009 C10.2224415,45.2392934 12.4044672,41.3332512 10.1360246,39.6632454 C10.0668911,39.6221974 9.19192037,39.0194398 8.85921546,38.7753121 C3.5294555,34.8044573 0.17,29.0080463 0.17,22.559188 Z" transform="translate(2 3)"/></svg>'),
  calendar: raw('<svg class="fi i-calendar" viewBox="0 0 56 56" aria-hidden="true"><path d="M 11.9923 49.5742 L 44.0079 49.5742 C 48.9066 49.5742 51.3671 47.1367 51.3671 42.3086 L 51.3671 13.6914 C 51.3671 8.8633 48.9066 6.4258 44.0079 6.4258 L 11.9923 6.4258 C 7.1173 6.4258 4.6329 8.8398 4.6329 13.6914 L 4.6329 42.3086 C 4.6329 47.1602 7.1173 49.5742 11.9923 49.5742 Z M 11.6642 45.8008 C 9.5782 45.8008 8.4064 44.6992 8.4064 42.5195 L 8.4064 20.4180 C 8.4064 18.2617 9.5782 17.1367 11.6642 17.1367 L 44.3126 17.1367 C 46.3985 17.1367 47.5938 18.2617 47.5938 20.4180 L 47.5938 42.5195 C 47.5938 44.6992 46.3985 45.8008 44.3126 45.8008 Z M 23.4064 25.5508 L 24.7892 25.5508 C 25.6095 25.5508 25.8907 25.3164 25.8907 24.4961 L 25.8907 23.1133 C 25.8907 22.2930 25.6095 22.0352 24.7892 22.0352 L 23.4064 22.0352 C 22.5860 22.0352 22.3282 22.2930 22.3282 23.1133 L 22.3282 24.4961 C 22.3282 25.3164 22.5860 25.5508 23.4064 25.5508 Z M 31.2111 25.5508 L 32.5704 25.5508 C 33.4142 25.5508 33.6720 25.3164 33.6720 24.4961 L 33.6720 23.1133 C 33.6720 22.2930 33.4142 22.0352 32.5704 22.0352 L 31.2111 22.0352 C 30.3907 22.0352 30.1095 22.2930 30.1095 23.1133 L 30.1095 24.4961 C 30.1095 25.3164 30.3907 25.5508 31.2111 25.5508 Z M 38.9923 25.5508 L 40.3751 25.5508 C 41.1954 25.5508 41.4767 25.3164 41.4767 24.4961 L 41.4767 23.1133 C 41.4767 22.2930 41.1954 22.0352 40.3751 22.0352 L 38.9923 22.0352 C 38.1720 22.0352 37.8907 22.2930 37.8907 23.1133 L 37.8907 24.4961 C 37.8907 25.3164 38.1720 25.5508 38.9923 25.5508 Z M 15.6251 33.2149 L 17.0079 33.2149 C 17.8282 33.2149 18.1095 32.9805 18.1095 32.1602 L 18.1095 30.7774 C 18.1095 29.9571 17.8282 29.7227 17.0079 29.7227 L 15.6251 29.7227 C 14.8048 29.7227 14.5235 29.9571 14.5235 30.7774 L 14.5235 32.1602 C 14.5235 32.9805 14.8048 33.2149 15.6251 33.2149 Z M 23.4064 33.2149 L 24.7892 33.2149 C 25.6095 33.2149 25.8907 32.9805 25.8907 32.1602 L 25.8907 30.7774 C 25.8907 29.9571 25.6095 29.7227 24.7892 29.7227 L 23.4064 29.7227 C 22.5860 29.7227 22.3282 29.9571 22.3282 30.7774 L 22.3282 32.1602 C 22.3282 32.9805 22.5860 33.2149 23.4064 33.2149 Z M 31.2111 33.2149 L 32.5704 33.2149 C 33.4142 33.2149 33.6720 32.9805 33.6720 32.1602 L 33.6720 30.7774 C 33.6720 29.9571 33.4142 29.7227 32.5704 29.7227 L 31.2111 29.7227 C 30.3907 29.7227 30.1095 29.9571 30.1095 30.7774 L 30.1095 32.1602 C 30.1095 32.9805 30.3907 33.2149 31.2111 33.2149 Z M 38.9923 33.2149 L 40.3751 33.2149 C 41.1954 33.2149 41.4767 32.9805 41.4767 32.1602 L 41.4767 30.7774 C 41.4767 29.9571 41.1954 29.7227 40.3751 29.7227 L 38.9923 29.7227 C 38.1720 29.7227 37.8907 29.9571 37.8907 30.7774 L 37.8907 32.1602 C 37.8907 32.9805 38.1720 33.2149 38.9923 33.2149 Z M 15.6251 40.9024 L 17.0079 40.9024 C 17.8282 40.9024 18.1095 40.6445 18.1095 39.8242 L 18.1095 38.4414 C 18.1095 37.6211 17.8282 37.3867 17.0079 37.3867 L 15.6251 37.3867 C 14.8048 37.3867 14.5235 37.6211 14.5235 38.4414 L 14.5235 39.8242 C 14.5235 40.6445 14.8048 40.9024 15.6251 40.9024 Z M 23.4064 40.9024 L 24.7892 40.9024 C 25.6095 40.9024 25.8907 40.6445 25.8907 39.8242 L 25.8907 38.4414 C 25.8907 37.6211 25.6095 37.3867 24.7892 37.3867 L 23.4064 37.3867 C 22.5860 37.3867 22.3282 37.6211 22.3282 38.4414 L 22.3282 39.8242 C 22.3282 40.6445 22.5860 40.9024 23.4064 40.9024 Z M 31.2111 40.9024 L 32.5704 40.9024 C 33.4142 40.9024 33.6720 40.6445 33.6720 39.8242 L 33.6720 38.4414 C 33.6720 37.6211 33.4142 37.3867 32.5704 37.3867 L 31.2111 37.3867 C 30.3907 37.3867 30.1095 37.6211 30.1095 38.4414 L 30.1095 39.8242 C 30.1095 40.6445 30.3907 40.9024 31.2111 40.9024 Z"/></svg>'),
  crown: raw('<svg class="fi i-crown" viewBox="0 0 56 56" aria-hidden="true"><path d="M 40.3633 52.1992 L 40.3633 34.4336 C 44.1836 31.0117 46.5976 26.0430 46.6211 20.5586 C 46.6445 10.2461 38.2070 1.8320 27.9883 1.8320 C 17.7461 1.8320 9.3555 10.2461 9.3555 20.5586 C 9.3555 26.0664 11.7930 31.0586 15.6367 34.5039 L 15.6367 52.1992 C 15.6367 53.5820 16.3867 54.1680 17.3476 54.1680 C 18.1445 54.1680 18.7773 53.6992 19.4102 53.0664 L 27.0273 45.4727 C 27.4258 45.0977 27.7305 44.9570 28.0117 44.9570 C 28.2930 44.9570 28.5742 45.0977 28.9961 45.4727 L 36.6133 53.0664 C 37.2695 53.7227 37.9023 54.1680 38.6758 54.1680 C 39.6602 54.1680 40.3633 53.5820 40.3633 52.1992 Z M 28.0117 35.5117 C 19.6680 35.4883 13.1758 28.8555 13.1758 20.5586 C 13.1758 12.2383 19.6680 5.5586 28.0117 5.5586 C 36.3320 5.5586 42.8242 12.2383 42.8476 20.5586 C 42.8711 28.8555 36.3320 35.5352 28.0117 35.5117 Z"/></svg>'),
  link: raw('<svg class="fi i-link" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.7071 37.6563 L 30.8243 34.4922 C 27.7306 34.2578 25.7150 33.3203 24.1915 31.7968 C 20.0899 27.6953 20.1134 21.8828 24.1681 17.8281 L 31.8087 10.1875 C 35.9103 6.1094 41.6759 6.0859 45.7540 10.1875 C 49.8791 14.2890 49.8321 20.0781 45.7775 24.1328 L 41.1837 28.7265 C 41.8399 30.2265 41.9806 31.9609 41.7462 33.4843 L 48.6134 26.6172 C 54.2385 20.9922 54.2851 13.0468 48.5899 7.3516 C 42.8947 1.6563 34.9493 1.7031 29.3243 7.3281 L 21.3321 15.3437 C 15.7071 20.9687 15.6603 28.9375 21.3556 34.6094 C 22.8321 36.0859 24.7071 37.1406 27.7071 37.6563 Z M 28.2931 18.3437 L 25.1759 21.5078 C 28.2696 21.7656 30.2852 22.6797 31.8087 24.2031 C 35.9103 28.3047 35.8868 34.1172 31.8321 38.1719 L 24.1681 45.8125 C 20.0899 49.8906 14.3009 49.9141 10.2228 45.8359 C 6.1212 41.7109 6.1447 35.9453 10.2228 31.8672 L 14.8165 27.2734 C 14.1603 25.7968 13.9962 24.0390 14.2306 22.5156 L 7.3634 29.3828 C 1.7618 35.0078 1.7149 42.9765 7.3868 48.6484 C 13.0821 54.3437 21.0509 54.2968 26.6525 48.6953 L 34.6681 40.6562 C 40.2931 35.0312 40.3399 27.0625 34.6447 21.3906 C 33.1681 19.9141 31.2931 18.8594 28.2931 18.3437 Z"/></svg>'),
  lock: raw('<svg class="fi i-lock" viewBox="0 0 56 56" aria-hidden="true"><path d="M 28 4.0937 C 21.4609 4.0937 15.4844 8.7578 15.4844 18.3437 L 15.4844 23.6641 C 12.7656 24.0391 11.4063 25.7969 11.4063 29.1250 L 11.4063 46.3516 C 11.4063 50.1719 13.1641 51.9063 16.6797 51.9063 L 39.3203 51.9063 C 42.8359 51.9063 44.5937 50.1719 44.5937 46.3516 L 44.5937 29.1250 C 44.5937 25.7969 43.2344 24.0391 40.5156 23.6641 L 40.5156 18.3437 C 40.5156 8.7578 34.5390 4.0937 28 4.0937 Z M 19.2578 17.8281 C 19.2578 11.2891 23.1484 7.7032 28 7.7032 C 32.8281 7.7032 36.7422 11.2891 36.7422 17.8281 L 36.7422 23.5703 L 19.2578 23.5703 Z M 39.2031 27.1094 C 40.3047 27.1094 40.8203 27.5781 40.8203 28.8672 L 40.8203 46.5859 C 40.8203 47.8984 40.3047 48.3906 39.2031 48.3906 L 16.7968 48.3906 C 15.7187 48.3906 15.1797 47.8984 15.1797 46.5859 L 15.1797 28.8672 C 15.1797 27.5781 15.7187 27.1094 16.7968 27.1094 Z"/></svg>'),
  check: raw('<svg class="fi i-check" viewBox="0 0 56 56" aria-hidden="true"><path d="M 23.0781 48.0273 C 24.0859 48.0273 24.8828 47.5820 25.4453 46.7148 L 47.5937 11.8398 C 48.0156 11.1602 48.2031 10.6445 48.2031 10.1054 C 48.2031 8.8164 47.3359 7.9727 46.0469 7.9727 C 45.1328 7.9727 44.5937 8.2773 44.0313 9.1680 L 22.9844 42.7070 L 12.0625 28.4102 C 11.4766 27.5898 10.9140 27.2617 10.0469 27.2617 C 8.7344 27.2617 7.7969 28.1758 7.7969 29.4649 C 7.7969 30.0039 8.0313 30.6133 8.4766 31.1758 L 20.6406 46.6680 C 21.3672 47.5820 22.0703 48.0273 23.0781 48.0273 Z"/></svg>'),
  star: raw('<svg class="fi i-star" viewBox="0 0 56 56" aria-hidden="true"><path d="M 11.9688 52.2930 C 12.9298 53.0195 14.1485 52.7617 15.6016 51.7071 L 28.0001 42.6133 L 40.4220 51.7071 C 41.8751 52.7617 43.0704 53.0195 44.0548 52.2930 C 45.0157 51.5664 45.2267 50.3711 44.6407 48.6602 L 39.7422 34.0820 L 52.2578 25.0820 C 53.7112 24.0508 54.2968 22.9727 53.9219 21.8008 C 53.5470 20.6758 52.4454 20.1133 50.6406 20.1367 L 35.2891 20.2305 L 30.6251 5.5820 C 30.0626 3.8476 29.2188 2.9805 28.0001 2.9805 C 26.8048 2.9805 25.9610 3.8476 25.3985 5.5820 L 20.7344 20.2305 L 5.3829 20.1367 C 3.5782 20.1133 2.4766 20.6758 2.1016 21.8008 C 1.7032 22.9727 2.3126 24.0508 3.7657 25.0820 L 16.2813 34.0820 L 11.3829 48.6602 C 10.7969 50.3711 11.0079 51.5664 11.9688 52.2930 Z"/></svg>'),
  quote: raw('<svg class="fi i-quote" viewBox="0 0 56 56" aria-hidden="true"><path d="M 16.5860 52.2461 C 17.7579 52.2461 18.5548 51.6367 19.9610 50.3711 L 28.0704 43.1758 L 43.0938 43.1758 C 50.0783 43.1758 53.8280 39.3086 53.8280 32.4414 L 53.8280 14.4883 C 53.8280 7.6211 50.0783 3.7539 43.0938 3.7539 L 12.9064 3.7539 C 5.9454 3.7539 2.1720 7.5976 2.1720 14.4883 L 2.1720 32.4414 C 2.1720 39.3320 5.9454 43.1758 12.9064 43.1758 L 14.0313 43.1758 L 14.0313 49.2695 C 14.0313 51.0742 14.9688 52.2461 16.5860 52.2461 Z M 17.5469 47.9570 L 17.5469 41.1602 C 17.5469 39.8945 17.0782 39.4023 15.7891 39.4023 L 12.9298 39.4023 C 8.1720 39.4023 5.9454 36.9883 5.9454 32.4180 L 5.9454 14.4883 C 5.9454 9.9180 8.1720 7.5273 12.9298 7.5273 L 43.0938 7.5273 C 47.8280 7.5273 50.0548 9.9180 50.0548 14.4883 L 50.0548 32.4180 C 50.0548 36.9883 47.8280 39.4023 43.0938 39.4023 L 27.9064 39.4023 C 26.6173 39.4023 25.9376 39.5898 25.0469 40.5039 Z M 17.2423 22.3633 C 17.2423 24.9414 18.8360 26.9336 21.4142 26.9336 C 22.3516 26.9336 23.2891 26.7695 23.8751 26.0430 L 24.0626 26.0430 C 23.2188 27.8945 21.5079 29.0898 20.0313 29.4649 C 19.1876 29.6992 18.9298 30.0742 18.9298 30.6133 C 18.9298 31.1992 19.3985 31.6445 20.0548 31.6445 C 22.3516 31.6445 26.9220 28.9258 26.9220 23.2071 C 26.9220 20.1367 24.9298 17.7695 22.0001 17.7695 C 19.2813 17.7695 17.2423 19.6680 17.2423 22.3633 Z M 29.4298 22.3633 C 29.4298 24.9414 31.0235 26.9336 33.6016 26.9336 C 34.5391 26.9336 35.4766 26.7695 36.0626 26.0430 L 36.2501 26.0430 C 35.4064 27.8945 33.6954 29.0898 32.2188 29.4649 C 31.3751 29.6992 31.1173 30.0742 31.1173 30.6133 C 31.1173 31.1992 31.5860 31.6445 32.2423 31.6445 C 34.5391 31.6445 39.1329 28.9258 39.1329 23.2071 C 39.1329 20.1367 37.1173 17.7695 34.1876 17.7695 C 31.4688 17.7695 29.4298 19.6680 29.4298 22.3633 Z"/></svg>'),
  broadcast: raw('<svg class="fi i-broadcast" viewBox="0 0 56 56" aria-hidden="true"><path d="M 43.8321 39.0391 C 44.5821 39.9062 45.8946 39.9062 46.7852 38.9219 C 50.6756 34.7031 52.8788 29.0781 52.8788 23.0078 C 52.8788 16.9375 50.6756 11.3125 46.7852 7.0938 C 45.8946 6.1094 44.5821 6.1094 43.8321 6.9765 C 43.0821 7.8203 43.2930 8.9219 44.1602 9.8828 C 47.3007 13.3750 49.0585 17.9687 49.0585 23.0078 C 49.0585 28.0469 47.3007 32.6406 44.1602 36.1328 C 43.2930 37.0938 43.0821 38.1953 43.8321 39.0391 Z M 12.1681 39.0391 C 12.9181 38.1953 12.6837 37.0938 11.8399 36.1328 C 8.6993 32.6406 6.9415 28.0469 6.9415 23.0078 C 6.9415 17.9687 8.6993 13.3750 11.8399 9.8828 C 12.6837 8.9219 12.9181 7.8203 12.1681 6.9765 C 11.4181 6.1094 10.1055 6.1094 9.1915 7.0938 C 5.3008 11.3125 3.1212 16.9375 3.1212 23.0078 C 3.1212 29.0781 5.3008 34.7031 9.1915 38.9219 C 10.1055 39.9062 11.4181 39.9062 12.1681 39.0391 Z M 19.1993 32.3594 C 19.9493 31.5156 19.6212 30.4609 18.8946 29.4531 C 17.4884 27.7187 16.7852 25.4453 16.7852 23.0078 C 16.7852 20.5703 17.5352 18.3672 18.8946 16.5625 C 19.6212 15.5313 19.9493 14.5000 19.1993 13.6562 C 18.4259 12.7656 17.0196 12.7422 16.1993 13.8203 C 14.1602 16.3516 12.9649 19.5625 12.9649 23.0078 C 12.9649 26.4531 14.1602 29.6641 16.1993 32.1953 C 17.0196 33.2734 18.4259 33.2500 19.1993 32.3594 Z M 36.7774 32.3594 C 37.5743 33.2500 38.9571 33.2734 39.8008 32.1953 C 41.8399 29.6641 43.0118 26.4531 43.0118 23.0078 C 43.0118 19.5625 41.8399 16.3516 39.8008 13.8203 C 38.9571 12.7422 37.5743 12.7656 36.7774 13.6562 C 36.0274 14.5000 36.3555 15.5313 37.0821 16.5625 C 38.4415 18.3672 39.1915 20.5703 39.1915 23.0078 C 39.1915 25.4453 38.4884 27.7187 37.0821 29.4531 C 36.3555 30.4609 36.0274 31.5156 36.7774 32.3594 Z M 27.9884 49.8906 C 29.1134 49.8906 29.7930 49.0937 29.7930 47.875 L 29.7930 26.8281 C 31.2228 26.1484 32.2071 24.6953 32.2071 23.0078 C 32.2071 20.6641 30.3555 18.7656 27.9884 18.7656 C 25.6446 18.7656 23.7930 20.6641 23.7930 23.0078 C 23.7930 24.6953 24.7540 26.1484 26.2071 26.8281 L 26.2071 47.875 C 26.2071 49.0703 26.9337 49.8906 27.9884 49.8906 Z"/></svg>'),
  profile: raw('<svg class="fi i-profile" viewBox="0 0 56 56" aria-hidden="true"><path d="M 7.7148 49.5742 L 48.2852 49.5742 C 53.1836 49.5742 55.6446 47.1367 55.6446 42.3086 L 55.6446 13.6914 C 55.6446 8.8633 53.1836 6.4258 48.2852 6.4258 L 7.7148 6.4258 C 2.8398 6.4258 .3554 8.8398 .3554 13.6914 L .3554 42.3086 C .3554 47.1602 2.8398 49.5742 7.7148 49.5742 Z M 7.7851 45.8008 C 5.4413 45.8008 4.1288 44.5586 4.1288 42.1211 L 4.1288 13.8789 C 4.1288 11.4414 5.4413 10.1992 7.7851 10.1992 L 48.2147 10.1992 C 50.5350 10.1992 51.8708 11.4414 51.8708 13.8789 L 51.8708 42.1211 C 51.8708 44.5586 50.5350 45.8008 48.2147 45.8008 L 43.6681 45.8008 L 43.6681 45.7539 C 41.7226 40.8086 36.2382 36.3320 27.9882 36.3320 C 19.8085 36.3320 14.3007 40.8086 12.4023 45.6602 L 12.4023 45.8008 Z M 27.9882 32.6523 C 32.2070 32.7227 35.5585 29.0898 35.5585 24.3555 C 35.5585 19.9258 32.2070 16.2930 27.9882 16.2930 C 23.7929 16.2930 20.3944 19.9258 20.4413 24.3555 C 20.4648 29.0898 23.7929 32.6055 27.9882 32.6523 Z"/></svg>'),
  feather: raw('<svg class="fi i-feather" viewBox="0 0 56 56" aria-hidden="true"><path d="M 13.4570 44.7578 C 19.9492 51.25 28.3866 53.1953 32.5351 53.5937 C 33.7539 53.7344 34.4335 52.9844 34.5273 52.2110 C 34.6210 51.3906 34.1054 50.5000 32.9335 50.3359 C 29.1835 49.8203 21.4257 48.1328 15.8007 42.4375 C 6.6132 33.2266 4.8788 19.3047 12.3788 11.8047 C 18.4726 5.7344 28.6210 6.5078 36.0976 10.5391 L 38.5351 8.1719 C 29.4413 2.7110 17.2070 2.2656 10.0351 9.4610 C 1.5039 18.0156 2.6288 33.9297 13.4570 44.7578 Z M 47.8164 11.5469 L 49.6913 9.6719 C 50.5817 8.7813 50.6288 7.4688 49.7149 6.6250 L 49.1053 6.0625 C 48.3085 5.3125 47.0663 5.3359 46.1992 6.1563 L 44.3476 8.0547 Z M 25.0585 34.2578 L 46.1054 13.2344 L 42.6132 9.7656 L 21.5898 30.7656 L 19.6445 35.2422 C 19.4570 35.7344 19.9492 36.2266 20.4648 36.0625 Z M 21.9882 37.75 C 29.6523 45.4141 41.9804 48.4375 48.8710 41.5703 C 54.4961 35.9219 53.7694 25.8906 47.7461 17.2656 L 45.3554 19.6563 C 50.1368 26.7344 51.0742 34.6797 46.5273 39.2266 C 40.9961 44.7578 31.8554 42.1328 25.5742 36.2032 Z"/></svg>'),
  heart: raw('<svg class="fi i-heart" viewBox="0 0 56 56" aria-hidden="true"><path d="M 4.7265 20.6406 C 4.7265 30.6250 13.0937 40.4453 26.2890 48.8828 C 26.8046 49.1875 27.5078 49.5156 28.0000 49.5156 C 28.4922 49.5156 29.1953 49.1875 29.6875 48.8828 C 42.9062 40.4453 51.2735 30.6250 51.2735 20.6406 C 51.2735 12.3438 45.5781 6.4844 37.9843 6.4844 C 33.6250 6.4844 30.1094 8.5469 28.0000 11.7109 C 25.8906 8.5703 22.3515 6.4844 18.0156 6.4844 C 10.4219 6.4844 4.7265 12.3438 4.7265 20.6406 Z M 8.5000 20.6406 C 8.5000 14.4063 12.5312 10.2578 17.9687 10.2578 C 22.3750 10.2578 24.8828 13.0000 26.4062 15.3438 C 27.0390 16.2813 27.4375 16.5391 28.0000 16.5391 C 28.5625 16.5391 28.9141 16.2578 29.5937 15.3438 C 31.1875 13.0469 33.6484 10.2578 38.0312 10.2578 C 43.4687 10.2578 47.5000 14.4063 47.5000 20.6406 C 47.5000 29.3594 38.2890 38.7578 28.4687 45.2734 C 28.2343 45.4375 28.0937 45.5547 28.0000 45.5547 C 27.9062 45.5547 27.7422 45.4375 27.5078 45.2734 C 17.7109 38.7578 8.5000 29.3594 8.5000 20.6406 Z"/></svg>'),
  heartFill: raw('<svg class="fi i-heartFill" viewBox="0 0 56 56" aria-hidden="true"><path d="M 28.0000 49.5156 C 28.4922 49.5156 29.1953 49.1875 29.6875 48.8828 C 42.9765 40.5156 51.2735 30.6250 51.2735 20.6406 C 51.2735 12.3438 45.5781 6.4844 37.9843 6.4844 C 33.6250 6.4844 30.1094 9.0625 28.0000 13.0234 C 25.8906 9.0860 22.3515 6.4844 18.0156 6.4844 C 10.4219 6.4844 4.7265 12.3438 4.7265 20.6406 C 4.7265 30.6250 12.9531 40.6328 26.2890 48.8828 C 26.8046 49.1875 27.5078 49.5156 28.0000 49.5156 Z"/></svg>'),
  starOutline: raw('<svg class="fi i-starOutline" viewBox="0 0 56 56" aria-hidden="true"><path d="M 11.9688 52.2930 C 12.9298 53.0195 14.1485 52.7617 15.6016 51.7071 L 28.0001 42.6133 L 40.4220 51.7071 C 41.8751 52.7617 43.0704 53.0195 44.0548 52.2930 C 45.0157 51.5664 45.2267 50.3711 44.6407 48.6602 L 39.7422 34.0820 L 52.2578 25.0820 C 53.7112 24.0508 54.2968 22.9727 53.9219 21.8008 C 53.5470 20.6758 52.4454 20.1133 50.6406 20.1367 L 35.2891 20.2305 L 30.6251 5.5820 C 30.0626 3.8476 29.2188 2.9805 28.0001 2.9805 C 26.8048 2.9805 25.9610 3.8476 25.3985 5.5820 L 20.7344 20.2305 L 5.3829 20.1367 C 3.5782 20.1133 2.4766 20.6758 2.1016 21.8008 C 1.7032 22.9727 2.3126 24.0508 3.7657 25.0820 L 16.2813 34.0820 L 11.3829 48.6602 C 10.7969 50.3711 11.0079 51.5664 11.9688 52.2930 Z M 15.3438 47.6524 C 15.2969 47.6055 15.3204 47.5820 15.3438 47.4414 L 20.0079 34.0352 C 20.3126 33.1211 20.1485 32.3945 19.3282 31.8320 L 7.6563 23.7695 C 7.5391 23.6992 7.5157 23.6524 7.5391 23.5820 C 7.5626 23.5117 7.6095 23.5117 7.7501 23.5117 L 21.9298 23.7695 C 22.8907 23.7930 23.5001 23.3945 23.8048 22.4336 L 27.8595 8.8633 C 27.9063 8.7227 27.9532 8.6758 28.0001 8.6758 C 28.0704 8.6758 28.1173 8.7227 28.1407 8.8633 L 32.2188 22.4336 C 32.5001 23.3945 33.1329 23.7930 34.0938 23.7695 L 48.2733 23.5117 C 48.4139 23.5117 48.4610 23.5117 48.4845 23.5820 C 48.508 23.6524 48.4610 23.6992 48.3674 23.7695 L 36.6954 31.8320 C 35.8751 32.3945 35.6876 33.1211 36.0157 34.0352 L 40.6798 47.4414 C 40.7032 47.5820 40.7266 47.6055 40.6798 47.6524 C 40.6329 47.7227 40.5626 47.6758 40.4688 47.6055 L 29.1954 39.0039 C 28.4454 38.4180 27.5782 38.4180 26.8282 39.0039 L 15.5548 47.6055 C 15.4610 47.6758 15.3907 47.7227 15.3438 47.6524 Z"/></svg>'),
  image: raw('<svg class="fi i-image" viewBox="0 0 56 56" aria-hidden="true"><path d="M 7.7148 49.5742 L 48.2852 49.5742 C 53.1836 49.5742 55.6446 47.1367 55.6446 42.3086 L 55.6446 13.6914 C 55.6446 8.8633 53.1836 6.4258 48.2852 6.4258 L 7.7148 6.4258 C 2.8398 6.4258 .3554 8.8398 .3554 13.6914 L .3554 42.3086 C .3554 47.1602 2.8398 49.5742 7.7148 49.5742 Z M 39.2851 27.9414 C 38.2304 27.0039 37.0351 26.5118 35.7695 26.5118 C 34.4570 26.5118 33.3085 26.9571 32.2304 27.9180 L 21.6366 37.3867 L 17.3007 33.4492 C 16.3163 32.5820 15.2617 32.1133 14.1366 32.1133 C 13.1054 32.1133 12.0976 32.5586 11.1366 33.4258 L 4.1288 39.7305 L 4.1288 13.8789 C 4.1288 11.4414 5.4413 10.1992 7.7851 10.1992 L 48.2147 10.1992 C 50.5350 10.1992 51.8708 11.4414 51.8708 13.8789 L 51.8708 39.7539 Z M 17.8163 28.1992 C 20.8398 28.1992 23.3241 25.7149 23.3241 22.6680 C 23.3241 19.6445 20.8398 17.1367 17.8163 17.1367 C 14.7695 17.1367 12.2851 19.6445 12.2851 22.6680 C 12.2851 25.7149 14.7695 28.1992 17.8163 28.1992 Z"/></svg>'),
  video: raw('<svg class="fi i-video" viewBox="0 0 56 56" aria-hidden="true"><path d="M29,0 C32.8659932,0 36,3.13400675 36,7 L36,10.261 L43.5999096,3.77068042 C44.1295012,3.3183501 44.7887131,3.04945248 45.4793999,3.00019625 L45.71066,2.99196205 C47.4436914,2.99196205 48.8599059,4.34841681 48.9555152,6.05753814 L48.96066,6.24196205 L48.96066,25.9014683 C48.96066,26.6666961 48.6906425,27.4073827 48.1981634,27.993077 C47.0857837,29.3160053 45.143496,29.5293645 43.7744003,28.511847 L43.6190513,28.3889718 L36,21.983 L36,25 C36,28.8659932 32.8659932,32 29,32 L7,32 C3.13400675,32 0,28.8659932 0,25 L0,7 C0,3.13400675 3.13400675,0 7,0 L29,0 Z M29,3 L7,3 C4.85780461,3 3.10892112,4.68396847 3.00489531,6.80035966 L3,7 L3,25 C3,27.1421954 4.68396847,28.8910789 6.80035966,28.9951047 L7,29 L29,29 C31.1421954,29 32.8910789,27.3160315 32.9951047,25.1996403 L33,25 L33,7 C33,4.85780461 31.3160315,3.10892112 29.1996403,3.00489531 L29,3 Z M45.71066,5.99196205 C45.6709751,5.99196205 45.6321584,6.00140236 45.5972785,6.01915093 L45.5482946,6.05186346 L36.396837,13.8682298 L36.3596833,13.9076863 C36.3380383,13.9363555 36.3228173,13.9693731 36.315075,14.0044514 L36.3092024,14.0583284 L36.3092024,18.2064969 L36.3151812,18.2608529 C36.3230618,18.2962279 36.3385501,18.3294871 36.3605538,18.3582852 L36.3983094,18.3978433 L45.549767,26.0928148 L45.6063817,26.1287514 C45.7061,26.1745719 45.8279575,26.1504261 45.9020064,26.0623613 C45.9272617,26.0323257 45.9449116,25.9969912 45.953872,25.9593311 L45.96066,25.9014683 L45.96066,6.24196205 L45.9540573,6.18463934 C45.9281468,6.07419546 45.8290067,5.99196205 45.71066,5.99196205 Z" transform="translate(3.5 12)"/></svg>'),
  mic: raw('<svg class="fi i-mic" viewBox="0 0 56 56" aria-hidden="true"><path d="M 36.5429 26.8516 L 36.5429 12.1094 C 36.5429 6.6953 33.0508 2.9219 28.0117 2.9219 C 22.9727 2.9219 19.4805 6.6953 19.4805 12.1094 L 19.4805 26.8516 C 19.4805 32.2422 22.9727 36.0390 28.0117 36.0390 C 33.0508 36.0390 36.5429 32.2422 36.5429 26.8516 Z M 33.0039 26.8516 C 33.0039 30.3203 31.0117 32.5469 28.0117 32.5469 C 25.0117 32.5469 23.0195 30.3203 23.0195 26.8516 L 23.0195 12.1094 C 23.0195 8.6406 25.0117 6.4141 28.0117 6.4141 C 31.0117 6.4141 33.0039 8.6406 33.0039 12.1094 Z M 17.5351 49.5391 C 16.5508 49.5391 15.7773 50.3359 15.7773 51.3203 C 15.7773 52.3047 16.5508 53.0781 17.5351 53.0781 L 38.4883 53.0781 C 39.4727 53.0781 40.2461 52.3047 40.2461 51.3203 C 40.2461 50.3359 39.4727 49.5391 38.4883 49.5391 L 29.7695 49.5391 L 29.7695 44.0781 C 38.7227 43.3281 44.7695 36.9063 44.7695 27.6953 L 44.7695 22.9375 C 44.7695 21.9531 43.9961 21.1797 43.0117 21.1797 C 42.0273 21.1797 41.2305 21.9531 41.2305 22.9375 L 41.2305 27.5547 C 41.2305 35.5469 36.0273 40.8437 28.0117 40.8437 C 19.9961 40.8437 14.7695 35.5469 14.7695 27.5547 L 14.7695 22.9375 C 14.7695 21.9531 13.9961 21.1797 13.0117 21.1797 C 12.0273 21.1797 11.2305 21.9531 11.2305 22.9375 L 11.2305 27.6953 C 11.2305 36.9063 17.3008 43.3281 26.2305 44.0781 L 26.2305 49.5391 Z"/></svg>'),
  live: raw('<svg class="fi i-live" viewBox="0 0 56 56" aria-hidden="true"><path d="M 45.9825 48.7874 C 46.6062 49.4713 47.6926 49.5517 48.4567 48.7472 C 53.2440 43.7385 56 37.0202 56 29.6782 C 56 22.3363 53.2440 15.5978 48.4567 10.6093 C 47.6926 9.7846 46.6062 9.8650 45.9825 10.5490 C 45.3592 11.2529 45.4997 12.2386 46.2239 13.0030 C 50.3880 17.3679 52.7213 23.2213 52.7213 29.6782 C 52.7213 36.1351 50.3880 41.9684 46.2239 46.3334 C 45.4997 47.0977 45.3592 48.1035 45.9825 48.7874 Z M 10.0172 48.7874 C 10.6408 48.1035 10.5000 47.0977 9.7758 46.3334 C 5.6121 41.9684 3.2787 36.1351 3.2787 29.6782 C 3.2787 23.2213 5.6121 17.3679 9.7758 13.0030 C 10.5000 12.2386 10.6408 11.2529 10.0172 10.5490 C 9.3937 9.8650 8.3074 9.7846 7.5230 10.6093 C 2.7557 15.5978 0 22.3363 0 29.6782 C 0 37.0202 2.7557 43.7385 7.5230 48.7472 C 8.3074 49.5517 9.3937 49.4713 10.0172 48.7874 Z M 40.1695 43.4368 C 40.8129 44.1811 41.9396 44.1811 42.7038 43.3161 C 46.0431 39.6954 47.9340 34.8880 47.9340 29.6782 C 47.9340 24.4684 46.0431 19.6409 42.7038 16.0202 C 41.9396 15.1754 40.8129 15.1553 40.1695 15.9196 C 39.5260 16.6438 39.7270 17.5892 40.4512 18.4139 C 43.1466 21.4110 44.6552 25.3334 44.6552 29.6782 C 44.6552 34.0029 43.1466 37.9455 40.4512 40.9426 C 39.7270 41.7673 39.5260 42.6926 40.1695 43.4368 Z M 15.8304 43.4368 C 16.4741 42.6926 16.2730 41.7673 15.5488 40.9426 C 12.8534 37.9455 11.3448 34.0029 11.3448 29.6782 C 11.3448 25.3334 12.8534 21.4110 15.5488 18.4139 C 16.2730 17.5892 16.4741 16.6438 15.8304 15.9196 C 15.1868 15.1553 14.0603 15.1754 13.2758 16.0202 C 9.9368 19.6409 8.0661 24.4684 8.0661 29.6782 C 8.0661 34.8880 9.9368 39.6954 13.2758 43.3161 C 14.0603 44.1811 15.1868 44.1811 15.8304 43.4368 Z M 21.4626 37.7041 C 22.1063 36.9799 21.8247 36.0748 21.2011 35.2098 C 19.9942 33.7012 19.3907 31.7702 19.3907 29.6782 C 19.3907 27.5863 19.9942 25.6351 21.2011 24.1466 C 21.8247 23.2615 22.1063 22.3765 21.4626 21.6524 C 20.7988 20.8880 19.5919 20.8679 18.8678 21.7932 C 17.1379 23.9656 16.1121 26.7213 16.1121 29.6782 C 16.1121 32.6351 17.1379 35.3909 18.8678 37.5632 C 19.5919 38.4684 20.7988 38.4483 21.4626 37.7041 Z M 34.5373 37.7041 C 35.2011 38.4483 36.4080 38.4684 37.1120 37.5632 C 38.8619 35.3909 39.8679 32.6351 39.8679 29.6782 C 39.8679 26.7213 38.8619 23.9656 37.1120 21.7932 C 36.4080 20.8679 35.2011 20.8880 34.5373 21.6524 C 33.8936 22.3765 34.1752 23.2615 34.7988 24.1466 C 35.9453 25.6753 36.5890 27.5863 36.5890 29.6782 C 36.5890 31.7702 36.0057 33.7012 34.7988 35.2098 C 34.1551 36.0748 33.8936 36.9799 34.5373 37.7041 Z M 28.0000 32.5949 C 29.5689 32.5949 30.9568 31.2673 30.9568 29.6380 C 30.9568 28.0288 29.5689 26.6811 28.0000 26.6811 C 26.4109 26.6811 25.0430 28.0288 25.0430 29.6380 C 25.0430 31.2673 26.4109 32.5949 28.0000 32.5949 Z"/></svg>'),
  text: raw('<svg class="fi i-text" viewBox="0 0 56 56" aria-hidden="true"><path d="M 3.5430 45.2969 C 4.7149 45.2969 5.3008 44.8281 5.7696 43.5391 L 8.7696 35.2422 L 22.5977 35.2422 L 25.6211 43.5391 C 26.0665 44.8281 26.6758 45.2969 27.8477 45.2969 C 29.1133 45.2969 29.9336 44.5703 29.9336 43.3750 C 29.9336 42.9766 29.8633 42.6250 29.6758 42.1094 L 18.6836 12.8594 C 18.1446 11.4062 17.1836 10.7031 15.6836 10.7031 C 14.2305 10.7031 13.2696 11.4062 12.7540 12.8359 L 1.7383 42.1328 C 1.5508 42.6484 1.4805 43.0000 1.4805 43.3984 C 1.4805 44.5937 2.2540 45.2969 3.5430 45.2969 Z M 9.9180 31.6562 L 15.6133 15.8828 L 15.7540 15.8828 L 21.4258 31.6562 Z M 42.2852 45.2734 C 45.8478 45.2734 49.1992 43.3281 50.6291 40.3281 L 50.6992 40.3281 L 50.6992 43.3750 C 50.6992 44.5234 51.5195 45.2969 52.6211 45.2969 C 53.7462 45.2969 54.5195 44.5234 54.5195 43.2812 L 54.5195 27.7656 C 54.5195 22.7031 50.8163 19.4453 44.9104 19.4453 C 40.5274 19.4453 36.8946 21.3672 35.5352 24.3437 C 35.2774 24.9297 35.1133 25.4922 35.1133 25.9844 C 35.1133 27.0156 35.8633 27.6719 36.8711 27.6719 C 37.6211 27.6719 38.1602 27.4140 38.5352 26.7578 C 39.8008 24.0625 41.7930 22.8203 44.8163 22.8203 C 48.4259 22.8203 50.5585 24.8359 50.5585 28.0937 L 50.5585 30.0625 L 43.0821 30.4844 C 37.1992 30.8125 33.9180 33.5313 33.9180 37.8437 C 33.9180 42.3203 37.3399 45.2734 42.2852 45.2734 Z M 43.2227 42.0156 C 40.0821 42.0156 37.9727 40.3047 37.9727 37.7734 C 37.9727 35.3125 39.9414 33.6719 43.5740 33.4375 L 50.5585 32.9922 L 50.5585 35.4297 C 50.5585 39.1328 47.3008 42.0156 43.2227 42.0156 Z"/></svg>'),
  verified: raw('<svg class="fi i-verified" viewBox="0 0 56 56" aria-hidden="true"><path d="M 23.6641 52.3985 C 26.6172 55.375 29.3594 55.3516 32.3126 52.3985 L 35.9219 48.8125 C 36.2969 48.4610 36.6250 48.3203 37.1172 48.3203 L 42.1797 48.3203 C 46.3749 48.3203 48.3204 46.3985 48.3204 42.1797 L 48.3204 37.1172 C 48.3204 36.625 48.4610 36.2969 48.8124 35.9219 L 52.3749 32.3125 C 55.3749 29.3594 55.3514 26.6172 52.3749 23.6641 L 48.8124 20.0547 C 48.4610 19.7031 48.3204 19.3516 48.3204 18.8829 L 48.3204 13.7969 C 48.3204 9.625 46.3985 7.6563 42.1797 7.6563 L 37.1172 7.6563 C 36.6250 7.6563 36.2969 7.5391 35.9219 7.1875 L 32.3126 3.6016 C 29.3594 .6250 26.6172 .6485 23.6641 3.6016 L 20.0547 7.1875 C 19.7032 7.5391 19.3516 7.6563 18.8828 7.6563 L 13.7969 7.6563 C 9.6016 7.6563 7.6563 9.5782 7.6563 13.7969 L 7.6563 18.8829 C 7.6563 19.3516 7.5391 19.7031 7.1876 20.0547 L 3.6016 23.6641 C .6251 26.6172 .6485 29.3594 3.6016 32.3125 L 7.1876 35.9219 C 7.5391 36.2969 7.6563 36.625 7.6563 37.1172 L 7.6563 42.1797 C 7.6563 46.3750 9.6016 48.3203 13.7969 48.3203 L 18.8828 48.3203 C 19.3516 48.3203 19.7032 48.4610 20.0547 48.8125 Z M 24.0391 39.7891 C 23.3126 39.7891 22.8438 39.5547 22.4923 39.1563 L 14.6641 30.4609 C 14.3360 30.0860 14.1485 29.6172 14.1485 29.125 C 14.1485 28.0234 14.9923 27.2031 16.1876 27.2031 C 16.8204 27.2031 17.2891 27.4141 17.7110 27.8594 L 23.9219 34.7266 L 35.9923 17.7344 C 36.4610 17.0547 36.9297 16.7734 37.7501 16.7734 C 38.8985 16.7734 39.7188 17.6172 39.7188 18.7188 C 39.7188 19.1172 39.5547 19.5860 39.2969 19.9609 L 25.6328 39.0625 C 25.2813 39.5078 24.7423 39.7891 24.0391 39.7891 Z"/></svg>'),
  grid: raw('<svg class="fi i-grid" viewBox="0 0 56 56" aria-hidden="true"><path d="M 43.2646 27.6955 L 52.2405 27.6955 C 54.7402 27.6955 56.0000 26.4357 56.0000 23.8375 L 56.0000 15.0389 C 56.0000 12.4406 54.7402 11.2005 52.2405 11.2005 L 43.2646 11.2005 C 40.7648 11.2005 39.5051 12.4406 39.5051 15.0389 L 39.5051 23.8375 C 39.5051 26.4357 40.7648 27.6955 43.2646 27.6955 Z M 3.7596 27.6955 L 12.7353 27.6955 C 15.2351 27.6955 16.4949 26.4357 16.4949 23.8375 L 16.4949 15.0389 C 16.4949 12.4406 15.2351 11.2005 12.7353 11.2005 L 3.7596 11.2005 C 1.2598 11.2005 0 12.4406 0 15.0389 L 0 23.8375 C 0 26.4357 1.2598 27.6955 3.7596 27.6955 Z M 23.5220 27.6955 L 32.4781 27.6955 C 34.9976 27.6955 36.2378 26.4357 36.2378 23.8375 L 36.2378 15.0389 C 36.2378 12.4406 34.9976 11.2005 32.4781 11.2005 L 23.5220 11.2005 C 21.0222 11.2005 19.7624 12.4406 19.7624 15.0389 L 19.7624 23.8375 C 19.7624 26.4357 21.0222 27.6955 23.5220 27.6955 Z M 3.7989 24.9201 C 3.1100 24.9201 2.7754 24.5658 2.7754 23.8375 L 2.7754 15.0389 C 2.7754 14.3302 3.1100 13.9759 3.7989 13.9759 L 12.6763 13.9759 C 13.3652 13.9759 13.7195 14.3302 13.7195 15.0389 L 13.7195 23.8375 C 13.7195 24.5658 13.3652 24.9201 12.6763 24.9201 Z M 23.5613 24.9201 C 22.8725 24.9201 22.5378 24.5658 22.5378 23.8375 L 22.5378 15.0389 C 22.5378 14.3302 22.8725 13.9759 23.5613 13.9759 L 32.4584 13.9759 C 33.1276 13.9759 33.4623 14.3302 33.4623 15.0389 L 33.4623 23.8375 C 33.4623 24.5658 33.1276 24.9201 32.4584 24.9201 Z M 43.3041 24.9201 C 42.6151 24.9201 42.2806 24.5658 42.2806 23.8375 L 42.2806 15.0389 C 42.2806 14.3302 42.6151 13.9759 43.3041 13.9759 L 52.1816 13.9759 C 52.8899 13.9759 53.2245 14.3302 53.2245 15.0389 L 53.2245 23.8375 C 53.2245 24.5658 52.8899 24.9201 52.1816 24.9201 Z M 3.7596 47.4382 L 12.7353 47.4382 C 15.2351 47.4382 16.4949 46.1981 16.4949 43.5999 L 16.4949 34.7816 C 16.4949 32.2031 15.2351 30.9433 12.7353 30.9433 L 3.7596 30.9433 C 1.2598 30.9433 0 32.2031 0 34.7816 L 0 43.5999 C 0 46.1981 1.2598 47.4382 3.7596 47.4382 Z M 23.5220 47.4382 L 32.4781 47.4382 C 34.9976 47.4382 36.2378 46.1981 36.2378 43.5999 L 36.2378 34.7816 C 36.2378 32.2031 34.9976 30.9433 32.4781 30.9433 L 23.5220 30.9433 C 21.0222 30.9433 19.7624 32.2031 19.7624 34.7816 L 19.7624 43.5999 C 19.7624 46.1981 21.0222 47.4382 23.5220 47.4382 Z M 43.2646 47.4382 L 52.2405 47.4382 C 54.7402 47.4382 56.0000 46.1981 56.0000 43.5999 L 56.0000 34.7816 C 56.0000 32.2031 54.7402 30.9433 52.2405 30.9433 L 43.2646 30.9433 C 40.7648 30.9433 39.5051 32.2031 39.5051 34.7816 L 39.5051 43.5999 C 39.5051 46.1981 40.7648 47.4382 43.2646 47.4382 Z M 3.7989 44.6628 C 3.1100 44.6628 2.7754 44.3085 2.7754 43.5999 L 2.7754 34.8013 C 2.7754 34.0730 3.1100 33.7187 3.7989 33.7187 L 12.6763 33.7187 C 13.3652 33.7187 13.7195 34.0730 13.7195 34.8013 L 13.7195 43.5999 C 13.7195 44.3085 13.3652 44.6628 12.6763 44.6628 Z M 23.5613 44.6628 C 22.8725 44.6628 22.5378 44.3085 22.5378 43.5999 L 22.5378 34.8013 C 22.5378 34.0730 22.8725 33.7187 23.5613 33.7187 L 32.4584 33.7187 C 33.1276 33.7187 33.4623 34.0730 33.4623 34.8013 L 33.4623 43.5999 C 33.4623 44.3085 33.1276 44.6628 32.4584 44.6628 Z M 43.3041 44.6628 C 42.6151 44.6628 42.2806 44.3085 42.2806 43.5999 L 42.2806 34.8013 C 42.2806 34.0730 42.6151 33.7187 43.3041 33.7187 L 52.1816 33.7187 C 52.8899 33.7187 53.2245 34.0730 53.2245 34.8013 L 53.2245 43.5999 C 53.2245 44.3085 52.8899 44.6628 52.1816 44.6628 Z"/></svg>'),
  play: raw('<svg class="fi i-play" viewBox="0 0 56 56" aria-hidden="true"><path d="M 13.0937 47.8398 C 14.0313 47.8398 14.8281 47.4648 15.7656 46.9258 L 43.0937 31.1289 C 45.0391 29.9805 45.7187 29.2305 45.7187 27.9883 C 45.7187 26.7461 45.0391 25.9961 43.0937 24.8711 L 15.7656 9.0508 C 14.8281 8.5118 14.0313 8.1602 13.0937 8.1602 C 11.3594 8.1602 10.2813 9.4727 10.2813 11.5118 L 10.2813 44.4649 C 10.2813 46.5039 11.3594 47.8398 13.0937 47.8398 Z"/></svg>'),
  reply: raw('<svg class="fi i-reply" viewBox="0 0 56 56" aria-hidden="true"><path d="M 25.6563 49.5039 C 27.2266 49.5039 28.3985 48.3320 28.3985 46.7617 L 28.3985 37.8086 L 29.0782 37.8086 C 38.1485 37.8086 43.8907 40.1055 47.9687 47.7695 C 48.7891 49.2695 49.8671 49.5039 50.8516 49.5039 C 52.1174 49.5039 53.2655 48.3789 53.2655 46.3633 C 53.2655 29.0429 45.9298 18.2383 29.0782 18.2383 L 28.3985 18.2383 L 28.3985 9.3789 C 28.3985 7.8086 27.2266 6.4961 25.6095 6.4961 C 24.4376 6.4961 23.7344 7.0820 22.4220 8.1836 L 3.9298 25.4805 C 3.0626 26.3477 2.7345 27.2148 2.7345 28.0117 C 2.7345 28.7851 3.0626 29.6524 3.9298 30.5195 L 22.4220 47.9805 C 23.5939 48.9883 24.4844 49.5039 25.6563 49.5039 Z M 24.2970 44.4648 C 24.1563 44.4648 24.0392 44.3945 23.8985 44.2539 L 7.2110 28.4570 C 7.0001 28.2695 6.9532 28.1524 6.9532 28.0117 C 6.9532 27.8711 7.0235 27.7305 7.2110 27.5664 L 23.8985 11.5586 C 23.9923 11.4648 24.1329 11.3711 24.2970 11.3711 C 24.4844 11.3711 24.6251 11.5117 24.6251 11.6992 L 24.6251 21.0039 C 24.6251 21.5429 24.8595 21.7773 25.3985 21.7773 L 28.5626 21.7773 C 44.6407 21.7773 49.4687 32.9336 49.9377 43.9961 C 49.9377 44.1602 49.8671 44.2539 49.7735 44.2539 C 49.6564 44.2539 49.6094 44.1836 49.5393 44.0195 C 46.8671 38.0898 39.6720 34.2695 28.5626 34.2695 L 25.3985 34.2695 C 24.8595 34.2695 24.6251 34.5039 24.6251 35.0429 L 24.6251 44.1133 C 24.6251 44.3242 24.4844 44.4648 24.2970 44.4648 Z"/></svg>'),
  search: raw('<svg class="fi i-search" viewBox="0 0 56 56" aria-hidden="true"><path d="M 23.9570 41.7695 C 27.8476 41.7695 31.4804 40.5039 34.4336 38.3945 L 45.5429 49.5039 C 46.0585 50.0195 46.7382 50.2774 47.4414 50.2774 C 48.9648 50.2774 50.0664 49.1055 50.0664 47.6055 C 50.0664 46.9023 49.8322 46.2461 49.3162 45.7305 L 38.2773 34.6679 C 40.5976 31.6211 41.9804 27.8476 41.9804 23.7461 C 41.9804 13.8320 33.8710 5.7226 23.9570 5.7226 C 14.0195 5.7226 5.9336 13.8320 5.9336 23.7461 C 5.9336 33.6601 14.0195 41.7695 23.9570 41.7695 Z M 23.9570 37.8789 C 16.1992 37.8789 9.8242 31.4805 9.8242 23.7461 C 9.8242 16.0117 16.1992 9.6133 23.9570 9.6133 C 31.6914 9.6133 38.0898 16.0117 38.0898 23.7461 C 38.0898 31.4805 31.6914 37.8789 23.9570 37.8789 Z"/></svg>'),
  phone: raw('<svg class="fi i-phone" viewBox="0 0 56 56" aria-hidden="true"><path d="M 39.1563 50.9336 C 43.2345 50.9336 45.9298 49.8321 48.3202 47.1602 C 48.5079 46.9727 48.6720 46.7617 48.8592 46.5742 C 50.2656 45.0039 50.9218 43.4570 50.9218 41.9805 C 50.9218 40.2930 49.9378 38.7226 47.8517 37.2695 L 41.0313 32.5352 C 38.9219 31.0821 36.4610 30.9180 34.4923 32.8633 L 32.6876 34.6680 C 32.1485 35.2070 31.6798 35.2305 31.1407 34.9023 C 29.8985 34.1055 27.3438 31.8789 25.6094 30.1445 C 23.7813 28.3399 22.0001 26.3242 21.0860 24.8477 C 20.7579 24.3086 20.8047 23.8633 21.3438 23.3242 L 23.1250 21.5195 C 25.0938 19.5508 24.9298 17.0664 23.4766 14.9805 L 18.7188 8.1602 C 17.2891 6.0742 15.7188 5.1133 14.0313 5.0899 C 12.5547 5.0664 11.0079 5.7461 9.4376 7.1523 C 9.2266 7.3399 9.0391 7.5039 8.8282 7.6680 C 6.1798 10.0586 5.0782 12.7539 5.0782 16.8086 C 5.0782 23.5117 9.2032 31.6680 16.7735 39.2383 C 24.2969 46.7617 32.4766 50.9336 39.1563 50.9336 Z M 39.1798 47.3242 C 33.2032 47.4414 25.5391 42.8477 19.4688 36.8008 C 13.3516 30.7070 8.5469 22.7852 8.6641 16.8086 C 8.7110 14.2305 9.6016 12.0039 11.4532 10.4102 C 11.5938 10.2695 11.7345 10.1523 11.8985 10.0352 C 12.5782 9.4258 13.3516 9.0977 14.0079 9.0977 C 14.7110 9.0977 15.3204 9.3555 15.7657 10.0586 L 20.3126 16.8789 C 20.8047 17.6055 20.8516 18.4258 20.1250 19.1523 L 18.0625 21.2148 C 16.4219 22.8321 16.5625 24.8008 17.7345 26.3711 C 19.0704 28.1758 21.3907 30.8008 23.1719 32.5821 C 24.9766 34.3867 27.8126 36.9180 29.6172 38.2774 C 31.1876 39.4492 33.1798 39.5664 34.7969 37.9492 L 36.8594 35.8867 C 37.5860 35.1602 38.3829 35.2070 39.1094 35.6758 L 45.9298 40.2227 C 46.6329 40.6914 46.9141 41.2774 46.9141 41.9805 C 46.9141 42.6602 46.5860 43.4102 45.9532 44.1133 C 45.8360 44.2774 45.7423 44.3945 45.6016 44.5586 C 43.9845 46.3867 41.7579 47.2774 39.1798 47.3242 Z"/></svg>'),
  card: raw('<svg class="fi i-card" viewBox="0 0 56 56" aria-hidden="true"><path d="M 9.6249 47.7109 L 46.3751 47.7109 C 51.2735 47.7109 53.7344 45.2969 53.7344 40.4687 L 53.7344 15.5547 C 53.7344 10.7266 51.2735 8.2891 46.3751 8.2891 L 9.6249 8.2891 C 4.7265 8.2891 2.2656 10.7266 2.2656 15.5547 L 2.2656 40.4687 C 2.2656 45.2969 4.7265 47.7109 9.6249 47.7109 Z M 6.0390 15.7656 C 6.0390 13.3281 7.3515 12.0625 9.6952 12.0625 L 46.3280 12.0625 C 48.6484 12.0625 49.9607 13.3281 49.9607 15.7656 L 49.9607 17.7344 L 6.0390 17.7344 Z M 9.6952 43.9375 C 7.3515 43.9375 6.0390 42.6953 6.0390 40.2578 L 6.0390 23.0547 L 49.9607 23.0547 L 49.9607 40.2578 C 49.9607 42.6953 48.6484 43.9375 46.3280 43.9375 Z M 12.3905 37.0000 L 18.1327 37.0000 C 19.5156 37.0000 20.4296 36.0859 20.4296 34.7500 L 20.4296 30.4140 C 20.4296 29.1015 19.5156 28.1640 18.1327 28.1640 L 12.3905 28.1640 C 11.0078 28.1640 10.0937 29.1015 10.0937 30.4140 L 10.0937 34.7500 C 10.0937 36.0859 11.0078 37.0000 12.3905 37.0000 Z"/></svg>'),
  smartphone: raw('<svg class="fi i-smartphone" viewBox="0 0 56 56" aria-hidden="true"><path d="M24,0 C26.209139,0 28,1.790861 28,4 L28,48 C28,50.209139 26.209139,52 24,52 L4,52 C1.790861,52 0,50.209139 0,48 L0,4 C0,1.790861 1.790861,0 4,0 L24,0 Z M23,7 L5,7 C4.44771525,7 4,7.44771525 4,8 L4,47 C4,47.5522847 4.44771525,48 5,48 L23,48 C23.5522847,48 24,47.5522847 24,47 L24,8 C24,7.44771525 23.5522847,7 23,7 Z M19,44 C19.5522847,44 20,44.4477153 20,45 C20,45.5522847 19.5522847,46 19,46 L9,46 C8.44771525,46 8,45.5522847 8,45 C8,44.4477153 8.44771525,44 9,44 L19,44 Z M17.5,3 L12.5,3 C12.2238576,3 12,3.22385763 12,3.5 C12,3.77614237 12.2238576,4 12.5,4 L17.5,4 C17.7761424,4 18,3.77614237 18,3.5 C18,3.22385763 17.7761424,3 17.5,3 Z M10.5,3 C10.2238576,3 10,3.22385763 10,3.5 C10,3.77614237 10.2238576,4 10.5,4 C10.7761424,4 11,3.77614237 11,3.5 C11,3.22385763 10.7761424,3 10.5,3 Z" transform="translate(14 2)"/></svg>'),
  book: raw('<svg class="fi i-book" viewBox="0 0 56 56" aria-hidden="true"><path d="M 28.0118 11.3945 C 26.2071 9.1445 21.7774 7.1523 16.8555 7.1523 C 10.3399 7.1523 5.0899 10.5039 3.8008 13.6445 L 3.8008 46.3867 C 3.8008 48.1680 4.9727 48.8477 6.2383 48.8477 C 7.2696 48.8477 7.8555 48.5430 8.4883 48.0508 C 9.8243 46.9023 12.5196 45.3555 16.8555 45.3555 C 21.1680 45.3555 24.1914 46.8555 25.3633 47.9102 C 25.9727 48.4023 26.7227 48.8477 28.0118 48.8477 C 29.2774 48.8477 30.0040 48.3555 30.6368 47.9102 C 31.8790 46.9258 34.8321 45.3555 39.1446 45.3555 C 43.4805 45.3555 46.1992 46.9258 47.5120 48.0508 C 48.1446 48.5430 48.7307 48.8477 49.7617 48.8477 C 51.0275 48.8477 52.1992 48.1680 52.1992 46.3867 L 52.1992 13.6445 C 50.9104 10.5039 45.6602 7.1523 39.1446 7.1523 C 34.2227 7.1523 29.7930 9.1445 28.0118 11.3945 Z M 7.5743 14.7695 C 8.1133 13.3164 11.5118 10.6914 16.8555 10.6914 C 22.1758 10.6914 25.6446 13.3398 26.1133 14.7695 L 26.1133 44.4180 C 23.8868 42.7539 20.4883 41.8164 16.8555 41.8164 C 13.1992 41.8164 9.8008 42.7539 7.5743 44.5117 Z M 48.4259 14.7695 L 48.4259 44.5117 C 46.1992 42.7539 42.8008 41.8164 39.1446 41.8164 C 35.5118 41.8164 32.1133 42.7539 29.8868 44.4180 L 29.8868 14.7695 C 30.3555 13.3398 33.8243 10.6914 39.1446 10.6914 C 44.4883 10.6914 47.8868 13.3164 48.4259 14.7695 Z"/></svg>'),
  mute: raw('<svg class="fi i-mute" viewBox="0 0 56 56" aria-hidden="true"><path d="M 39.7187 33.5664 L 39.7187 8.2070 C 39.7187 6.6367 38.5702 5.3242 36.9296 5.3242 C 35.7812 5.3242 35.0312 5.8867 33.7655 7.0117 L 22.9374 16.6445 L 25.5390 19.2695 L 35.2187 10.4805 C 35.3359 10.3867 35.4531 10.2929 35.6171 10.2929 C 35.8046 10.2929 35.9452 10.4336 35.9452 10.6211 L 35.9452 29.7929 Z M 46.7733 49.9727 C 47.4999 50.6758 48.6484 50.6758 49.3280 49.9727 C 50.0312 49.2461 50.0548 48.1211 49.3280 47.4180 L 9.2030 7.2929 C 8.4999 6.5898 7.3280 6.5898 6.6249 7.2929 C 5.9452 7.9727 5.9452 9.1680 6.6249 9.8476 Z M 36.9765 48.3320 C 38.0077 48.3320 38.8984 47.7930 39.4374 46.7383 L 36.5780 43.9961 L 24.6952 33.7070 C 24.1796 33.2617 23.8984 33.1914 23.2421 33.1914 L 15.4843 33.1914 C 14.5702 33.1914 14.0077 32.6289 14.0077 31.7148 L 14.0077 21.5898 L 11.1952 18.5898 C 10.5390 19.5273 10.2343 20.7227 10.2343 22.2695 L 10.2343 31.4102 C 10.2343 34.9258 12.0155 36.7305 15.3202 36.7305 L 22.1640 36.7305 C 22.3984 36.7305 22.5859 36.8008 22.7499 36.9414 L 33.7655 46.8086 C 34.9140 47.8398 35.8280 48.3320 36.9765 48.3320 Z"/></svg>'),
  sound: raw('<svg class="fi i-sound" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.4492 49.5039 C 29.0429 49.5039 30.1914 48.3320 30.1914 46.7617 L 30.1914 9.3789 C 30.1914 7.8086 29.0429 6.4961 27.4023 6.4961 C 26.2539 6.4961 25.5039 7.0586 24.2382 8.1836 L 13.2226 17.9570 C 13.0820 18.0977 12.8711 18.1680 12.6367 18.1680 L 5.6757 18.1680 C 2.3476 18.1680 .7070 19.8320 .7070 23.3711 L .7070 32.6992 C .7070 36.2383 2.3476 37.9024 5.6757 37.9024 L 12.6367 37.9024 C 12.8711 37.9024 13.0820 37.9726 13.2226 38.1133 L 24.2382 47.9805 C 25.3867 49.0117 26.3008 49.5039 27.4492 49.5039 Z M 47.6994 44.7227 C 48.6133 45.3320 49.7384 45.0977 50.3946 44.1602 C 53.4882 39.8477 55.2930 34.1055 55.2930 28.1055 C 55.2930 22.0820 53.5117 16.3398 50.3946 12.0273 C 49.7149 11.1133 48.6133 10.8789 47.6994 11.4883 C 46.8085 12.0977 46.6679 13.2461 47.3711 14.2539 C 49.9256 18.0039 51.5197 22.9258 51.5197 28.1055 C 51.5197 33.2851 49.9727 38.2539 47.3711 41.9570 C 46.6914 42.9648 46.8085 44.1133 47.6994 44.7227 Z M 26.0898 44.5586 C 25.9726 44.5586 25.8320 44.4883 25.6914 44.3477 L 15.3086 34.9961 C 14.7460 34.4805 14.2773 34.3633 13.6445 34.3633 L 5.8398 34.3633 C 4.9257 34.3633 4.4804 33.9414 4.4804 33.0039 L 4.4804 23.0664 C 4.4804 22.1524 4.9257 21.7070 5.8398 21.7070 L 13.6445 21.7070 C 14.2773 21.7070 14.7226 21.6133 15.3086 21.0742 L 25.6914 11.6524 C 25.8086 11.5586 25.9492 11.4648 26.0898 11.4648 C 26.3008 11.4648 26.4179 11.6055 26.4179 11.7929 L 26.4179 44.2070 C 26.4179 44.4180 26.3008 44.5586 26.0898 44.5586 Z M 38.3476 38.3945 C 39.1445 38.9570 40.2929 38.7695 40.9726 37.8555 C 42.8005 35.3945 43.9021 31.7851 43.9021 28.1055 C 43.9021 24.4258 42.7775 20.8398 40.9726 18.3320 C 40.2929 17.4180 39.1679 17.2305 38.3476 17.7929 C 37.3164 18.4726 37.1992 19.6680 37.9492 20.6992 C 39.3086 22.5273 40.1289 25.3164 40.1289 28.1055 C 40.1289 30.8945 39.2617 33.6836 37.9257 35.5351 C 37.2226 36.5429 37.3398 37.6914 38.3476 38.3945 Z"/></svg>'),
  pushpin: raw('<svg class="fi i-pushpin" viewBox="0 0 56 56" aria-hidden="true"><path d="M 13.4219 35.9688 L 25.9375 35.9688 L 25.9375 48.0156 C 25.9375 51.5781 27.4375 54.5781 28.0234 54.5781 C 28.5859 54.5781 30.0859 51.5781 30.0859 48.0156 L 30.0859 35.9688 L 42.5781 35.9688 C 44.1953 35.9688 45.3672 34.9375 45.3672 33.3672 C 45.3672 32.3828 45.0625 31.6797 44.3828 30.9532 L 37.2109 23.1719 C 36.7188 22.6563 36.4141 22.2813 36.5312 21.3203 L 37.7266 12.7657 C 37.7969 12.2735 37.8437 11.9922 38.2890 11.6875 L 44.0312 7.5157 C 45.3203 6.5781 45.8828 5.4297 45.8828 4.3750 C 45.8828 2.8047 44.6172 1.4219 42.8125 1.4219 L 13.1875 1.4219 C 11.3828 1.4219 10.1172 2.8047 10.1172 4.3750 C 10.1172 5.4297 10.6797 6.5781 11.9453 7.5157 L 17.7109 11.6875 C 18.1562 11.9922 18.2031 12.2735 18.2734 12.7657 L 19.4688 21.3203 C 19.6094 22.2813 19.2812 22.6563 18.7890 23.1719 L 11.6172 30.9532 C 10.9375 31.6797 10.6328 32.3828 10.6328 33.3672 C 10.6328 34.9375 11.8047 35.9688 13.4219 35.9688 Z M 16.4688 32.1953 C 16.2578 32.1953 16.1172 32.0547 16.1172 31.8437 C 16.1172 31.7032 16.2109 31.5625 16.3281 31.4453 L 22.3281 25.1641 C 23.1015 24.3906 23.4062 23.5469 23.3125 22.6797 L 21.8594 11.3828 C 21.7422 10.4688 21.4375 9.7891 20.7578 9.3203 L 15.6719 5.9453 C 15.5078 5.8281 15.4610 5.7110 15.4610 5.5469 C 15.4610 5.3359 15.6250 5.1953 15.8359 5.1953 L 40.1641 5.1953 C 40.3750 5.1953 40.5390 5.3359 40.5390 5.5469 C 40.5390 5.7110 40.4922 5.8281 40.3281 5.9453 L 35.2422 9.3203 C 34.5625 9.7891 34.2578 10.4688 34.1406 11.3828 L 32.6875 22.6797 C 32.5937 23.5469 32.8984 24.3906 33.6484 25.1641 L 39.6719 31.4453 C 39.7890 31.5625 39.8594 31.7032 39.8594 31.8437 C 39.8594 32.0547 39.7422 32.1953 39.5312 32.1953 Z"/></svg>'),
  pin: raw('<svg class="fi i-pin" viewBox="0 0 56 56" aria-hidden="true"><path d="M17,0 C26.3888407,0 34,7 34,19 C34,23.7636386 31.3210535,29.6303728 28.0900827,34.9737328 L27.5468409,35.8591678 C27.3642996,36.1525115 27.1804193,36.443961 26.9955646,36.7332374 L26.4384421,37.5942683 C26.3452227,37.7365939 26.2518509,37.8783065 26.1583723,38.0193712 L25.5965831,38.8577064 L25.5965831,38.8577064 L25.0344182,39.6788196 L25.0344182,39.6788196 L24.4740656,40.4810374 L24.4740656,40.4810374 L23.9177137,41.2626864 L23.9177137,41.2626864 L23.3675504,42.0220934 L23.3675504,42.0220934 L22.8257642,42.7575851 L22.8257642,42.7575851 L22.294543,43.467488 L22.294543,43.467488 L21.7760753,44.150129 L21.7760753,44.150129 L21.0270728,45.1193138 L21.0270728,45.1193138 L20.3190739,46.0177466 L20.3190739,46.0177466 L19.6594637,46.83978 C19.5891355,46.9266634 19.5198401,47.0120275 19.4516231,47.0958374 C18.0976291,48.6997621 15.8248694,48.6368741 14.5492719,47.0969369 L13.9074696,46.3016903 L13.9074696,46.3016903 L13.2148001,45.428144 L13.2148001,45.428144 L12.7284086,44.8050693 L12.7284086,44.8050693 L12.2248809,44.1513789 L12.2248809,44.1513789 L11.4422468,43.1170998 L11.4422468,43.1170998 L10.905454,42.3941921 L10.905454,42.3941921 L10.3591852,41.6465264 L10.3591852,41.6465264 L9.80562897,40.8757763 L9.80562897,40.8757763 L9.24697399,40.0836155 L9.24697399,40.0836155 L8.68540884,39.2717176 L8.68540884,39.2717176 L8.12312212,38.4417562 C7.93581614,38.1622778 7.74875466,37.8800677 7.56230245,37.595405 L7.00513842,36.7343376 L7.00513842,36.7343376 L6.45381865,35.8602277 L6.45381865,35.8602277 L5.91053175,34.9747489 C2.67928613,29.6311166 0,23.7639406 0,19 C0,7 7.61115925,0 17,0 Z M17,4 C9.37835395,4 4,9.68186168 4,19 C4,22.3449314 5.74603693,26.8117412 8.61078113,31.7466705 L9.11272185,32.5971221 L9.11272185,32.5971221 L9.63587778,33.4560131 L9.63587778,33.4560131 L10.1795466,34.3226116 C10.2718285,34.4676463 10.3649358,34.6129717 10.4588539,34.7585724 L11.0319752,35.6353599 L11.0319752,35.6353599 L11.6238536,36.5180251 L11.6238536,36.5180251 L12.2337869,37.4058361 L12.2337869,37.4058361 L12.8610726,38.2980611 L12.8610726,38.2980611 L13.5050084,39.1939681 C13.6136796,39.3435521 13.7230152,39.4932591 13.8330007,39.6430737 L14.5005949,40.5431314 L14.5005949,40.5431314 L15.1059617,41.3428411 L15.1059617,41.3428411 L15.4180754,41.7478049 L15.4180754,41.7478049 C16.0942573,42.6212153 17.3504494,42.7811062 18.2238628,42.1049282 C18.3575964,42.0013945 18.4776574,41.8813157 18.5811712,41.7475668 L19.1488503,41.0070743 L19.1488503,41.0070743 L19.8253026,40.104316 L19.8253026,40.104316 L20.4864022,39.203912 L20.4864022,39.203912 L21.1314511,38.3065888 L21.1314511,38.3065888 L21.7597515,37.4130729 L21.7597515,37.4130729 L22.3706056,36.5240911 C22.5712384,36.2286002 22.7688471,35.9339861 22.9633155,35.6403698 L23.5371834,34.7626356 C24.0073619,34.033887 24.4571863,33.3121317 24.8848394,32.599262 L25.3872645,31.7482045 C28.2546409,26.8099946 30,22.3442615 30,19 C30,9.68186168 24.6216461,4 17,4 Z M17,9 C21.418278,9 25,12.581722 25,17 C25,21.418278 21.418278,25 17,25 C12.581722,25 9,21.418278 9,17 C9,12.581722 12.581722,9 17,9 Z M17,13 C14.790861,13 13,14.790861 13,17 C13,19.209139 14.790861,21 17,21 C19.209139,21 21,19.209139 21,17 C21,14.790861 19.209139,13 17,13 Z" transform="translate(11 4)"/></svg>'),
  archive: raw('<svg class="fi i-archive" viewBox="0 0 56 56" aria-hidden="true"><path d="M 15.1444 49.5742 L 40.8788 49.5742 C 45.4725 49.5742 47.9334 47.1836 47.9334 42.5899 L 47.9334 19.2461 C 50.2072 18.8711 51.4259 17.1602 51.4259 14.6523 L 51.4259 11.0898 C 51.4259 8.2305 49.8553 6.4258 46.9724 6.4258 L 9.0272 6.4258 C 6.2850 6.4258 4.5741 8.2305 4.5741 11.0898 L 4.5741 14.6523 C 4.5741 17.1602 5.8163 18.8711 8.0663 19.2461 L 8.0663 42.5899 C 8.0663 47.2070 10.5507 49.5742 15.1444 49.5742 Z M 9.9882 15.7774 C 8.8163 15.7774 8.3476 15.2852 8.3476 14.1133 L 8.3476 11.6289 C 8.3476 10.4571 8.8163 9.9649 9.9882 9.9649 L 46.0350 9.9649 C 47.2302 9.9649 47.6521 10.4571 47.6521 11.6289 L 47.6521 14.1133 C 47.6521 15.2852 47.2302 15.7774 46.0350 15.7774 Z M 15.1210 46.0352 C 13.0116 46.0352 11.8397 44.8867 11.8397 42.7774 L 11.8397 19.3164 L 44.1601 19.3164 L 44.1601 42.7774 C 44.1601 44.8867 42.9882 46.0352 40.9023 46.0352 Z M 20.2772 28.7617 L 35.7694 28.7617 C 36.7304 28.7617 37.4335 28.0820 37.4335 27.0508 L 37.4335 26.3008 C 37.4335 25.2696 36.7304 24.6133 35.7694 24.6133 L 20.2772 24.6133 C 19.2928 24.6133 18.6132 25.2696 18.6132 26.3008 L 18.6132 27.0508 C 18.6132 28.0820 19.2928 28.7617 20.2772 28.7617 Z"/></svg>'),
  camera: raw('<svg class="fi i-camera" viewBox="0 0 56 56" aria-hidden="true"><path d="M 7.8086 50.3477 L 48.1914 50.3477 C 53.0663 50.3477 55.5508 47.9102 55.5508 43.0820 L 55.5508 18.5430 C 55.5508 13.7149 53.0663 11.3008 48.1914 11.3008 L 42.7069 11.3008 C 40.8789 11.3008 40.3164 10.9258 39.2617 9.7539 L 37.3633 7.6445 C 36.2149 6.3555 35.0196 5.6523 32.5820 5.6523 L 23.2539 5.6523 C 20.8398 5.6523 19.6445 6.3555 18.4727 7.6445 L 16.5742 9.7539 C 15.5430 10.9023 14.9571 11.3008 13.1289 11.3008 L 7.8086 11.3008 C 2.9336 11.3008 .4492 13.7149 .4492 18.5430 L .4492 43.0820 C .4492 47.9102 2.9336 50.3477 7.8086 50.3477 Z M 7.8789 46.5742 C 5.5586 46.5742 4.2227 45.3320 4.2227 42.8945 L 4.2227 18.7539 C 4.2227 16.3164 5.5586 15.0742 7.8789 15.0742 L 14.0664 15.0742 C 16.1758 15.0742 17.3008 14.6758 18.4727 13.3633 L 20.3242 11.3008 C 21.6602 9.8008 22.3398 9.4258 24.4258 9.4258 L 31.4102 9.4258 C 33.4961 9.4258 34.1758 9.8008 35.5117 11.3008 L 37.3633 13.3633 C 38.5352 14.6758 39.6602 15.0742 41.7696 15.0742 L 48.1213 15.0742 C 50.4416 15.0742 51.7775 16.3164 51.7775 18.7539 L 51.7775 42.8945 C 51.7775 45.3320 50.4416 46.5742 48.1213 46.5742 Z M 27.9883 42.8477 C 35.0898 42.8477 40.7852 37.1523 40.7852 30.0273 C 40.7852 22.9023 35.1133 17.2071 27.9883 17.2071 C 20.9102 17.2071 15.2149 22.9023 15.2149 30.0273 C 15.2149 37.1523 20.9102 42.8477 27.9883 42.8477 Z M 44.8400 24.3086 C 46.4336 24.3086 47.7460 23.0195 47.7460 21.4258 C 47.7460 19.8086 46.4336 18.5195 44.8400 18.5195 C 43.2460 18.5195 41.9336 19.8086 41.9336 21.4258 C 41.9336 23.0195 43.2460 24.3086 44.8400 24.3086 Z M 27.9883 39.2852 C 22.9024 39.2852 18.7539 35.1602 18.7539 30.0273 C 18.7539 24.8945 22.8789 20.7695 27.9883 20.7695 C 33.0977 20.7695 37.2461 24.8945 37.2461 30.0273 C 37.2461 35.1602 33.0977 39.2852 27.9883 39.2852 Z"/></svg>'),
  warning: raw('<svg class="fi i-warning" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.9999 51.9063 C 41.0546 51.9063 51.9063 41.0781 51.9063 28 C 51.9063 14.9453 41.0312 4.0937 27.9765 4.0937 C 14.8983 4.0937 4.0937 14.9453 4.0937 28 C 4.0937 41.0781 14.9218 51.9063 27.9999 51.9063 Z M 27.9999 47.9219 C 16.9374 47.9219 8.1014 39.0625 8.1014 28 C 8.1014 16.9609 16.9140 8.0781 27.9765 8.0781 C 39.0155 8.0781 47.8983 16.9609 47.9219 28 C 47.9454 39.0625 39.0390 47.9219 27.9999 47.9219 Z M 27.9765 32.2422 C 29.1014 32.2422 29.7343 31.6094 29.7577 30.3906 L 30.1093 18.0156 C 30.1327 16.8203 29.1952 15.9297 27.9530 15.9297 C 26.6874 15.9297 25.7968 16.7968 25.8202 17.9922 L 26.1249 30.3906 C 26.1483 31.5859 26.8046 32.2422 27.9765 32.2422 Z M 27.9765 39.8594 C 29.3124 39.8594 30.5077 38.7812 30.5077 37.4219 C 30.5077 36.0390 29.3358 34.9844 27.9765 34.9844 C 26.5936 34.9844 25.4452 36.0625 25.4452 37.4219 C 25.4452 38.7578 26.6171 39.8594 27.9765 39.8594 Z"/></svg>'),
  hourglass: raw('<svg class="fi i-hourglass" viewBox="0 0 56 56" aria-hidden="true"><path d="M 16.5156 49.5742 L 39.2734 49.5742 C 41.6640 49.5742 43.0937 48.2617 43.0937 45.7305 L 43.0937 45.1211 C 43.1172 38.6523 36.2266 33.4023 33.2031 30.5430 C 32.3593 29.7461 31.9140 29.0196 31.9140 27.9649 C 31.9140 26.9102 32.3593 26.2071 33.2031 25.3867 C 36.2031 22.4805 43.0937 17.5586 43.0937 10.8320 L 43.0937 10.2696 C 43.0937 7.7383 41.6640 6.4258 39.2734 6.4258 L 16.5156 6.4258 C 14.1718 6.4258 12.8828 7.7383 12.8828 10.0586 L 12.8828 10.8320 C 12.8828 17.5586 19.7734 22.4805 22.7969 25.3867 C 23.6406 26.2071 24.0859 26.9102 24.0859 27.9649 C 24.0859 29.0196 23.6406 29.7461 22.7969 30.5430 C 19.7734 33.4023 12.8828 38.6523 12.8828 45.1211 L 12.8828 45.9414 C 12.8828 48.2617 14.1718 49.5742 16.5156 49.5742 Z M 18.9531 46.3633 C 17.8281 46.3633 17.4766 45.1211 18.5781 44.3008 L 26.5937 38.3242 C 26.8515 38.1133 26.9922 37.9727 26.9922 37.6211 L 26.9922 26.3477 C 26.9922 25.0820 26.7344 24.4492 25.8437 23.6992 C 24.5078 22.5742 21.9766 20.7930 20.8281 19.1758 C 20.3593 18.5196 20.4062 17.9805 20.9922 17.9805 L 34.9844 17.9805 C 35.5703 17.9805 35.6172 18.5196 35.1484 19.1758 C 34.0000 20.7930 31.4922 22.5742 30.1328 23.6992 C 29.2422 24.4492 28.9844 25.0820 28.9844 26.3477 L 28.9844 37.6211 C 28.9844 37.9727 29.125 38.1133 29.3828 38.3242 L 37.4218 44.3008 C 38.5234 45.1211 38.1484 46.3633 37.0469 46.3633 Z"/></svg>'),
  ties: raw('<svg class="fi i-ties" viewBox="0 0 56 56" aria-hidden="true"><path d="M 28.0001 27.6594 C 31.4854 27.6594 34.3263 24.5548 34.3263 20.7766 C 34.3263 17.0423 31.4998 14.0841 28.0001 14.0841 C 24.5293 14.0841 21.6736 17.0862 21.6736 20.8058 C 21.6883 24.5695 24.5293 27.6594 28.0001 27.6594 Z M 11.1297 27.9816 C 14.1464 27.9816 16.6213 25.2724 16.6213 21.9481 C 16.6213 18.6971 14.1757 16.0757 11.1297 16.0757 C 8.1130 16.0757 5.6234 18.7410 5.6381 21.9774 C 5.6527 25.2870 8.1130 27.9816 11.1297 27.9816 Z M 44.8848 27.9816 C 47.8870 27.9816 50.3619 25.2870 50.3619 21.9774 C 50.3766 18.7410 47.8870 16.0757 44.8848 16.0757 C 41.8242 16.0757 39.3786 18.6971 39.3786 21.9481 C 39.3786 25.2724 41.8536 27.9816 44.8848 27.9816 Z M 28.0001 25.4481 C 25.8619 25.4481 24.0314 23.3979 24.0314 20.8058 C 24.0314 18.2578 25.8326 16.2954 28.0001 16.2954 C 30.1820 16.2954 31.9686 18.2285 31.9686 20.7766 C 31.9686 23.3686 30.1673 25.4481 28.0001 25.4481 Z M 11.1297 25.7996 C 9.3431 25.7996 7.8201 24.0862 7.8201 21.9774 C 7.8201 19.9125 9.3284 18.2578 11.1297 18.2578 C 12.9749 18.2578 14.4540 19.8833 14.4540 21.9481 C 14.4540 24.0862 12.9309 25.7996 11.1297 25.7996 Z M 44.8848 25.7996 C 43.0691 25.7996 41.5461 24.0862 41.5461 21.9481 C 41.5461 19.8833 43.0250 18.2578 44.8848 18.2578 C 46.6861 18.2578 48.1800 19.9125 48.1800 21.9774 C 48.1800 24.0862 46.6714 25.7996 44.8848 25.7996 Z M 2.9874 41.4104 L 14.4833 41.4104 C 13.7803 41.0151 13.2385 40.1364 13.3410 39.2431 L 2.6213 39.2431 C 2.3284 39.2431 2.1820 39.1259 2.1820 38.8477 C 2.1820 35.2159 6.3263 31.8184 11.1150 31.8184 C 12.9603 31.8184 14.6150 32.2577 16.0356 33.0924 C 16.5042 32.5067 17.0314 31.9941 17.6903 31.5402 C 15.8012 30.2954 13.5314 29.6510 11.1150 29.6510 C 4.9791 29.6510 0 34.1029 0 38.9795 C 0 40.6050 .9958 41.4104 2.9874 41.4104 Z M 53.0272 41.4104 C 55.0043 41.4104 56.0000 40.6050 56.0000 38.9795 C 56.0000 34.1029 51.0208 29.6510 44.8848 29.6510 C 42.4687 29.6510 40.2133 30.2954 38.3097 31.5402 C 38.9687 31.9941 39.5103 32.5067 39.9791 33.0924 C 41.3848 32.2577 43.0544 31.8184 44.8848 31.8184 C 49.6736 31.8184 53.8181 35.2159 53.8181 38.8477 C 53.8181 39.1259 53.6861 39.2431 53.3934 39.2431 L 42.6735 39.2431 C 42.7614 40.1364 42.2341 41.0151 41.5314 41.4104 Z M 18.8033 41.4104 L 37.1968 41.4104 C 39.6276 41.4104 40.7846 40.6782 40.7846 39.0674 C 40.7846 35.2305 35.9371 29.6803 28.0001 29.6803 C 20.0481 29.6803 15.2008 35.2305 15.2008 39.0674 C 15.2008 40.6782 16.3577 41.4104 18.8033 41.4104 Z M 18.1004 39.1992 C 17.7197 39.1992 17.5586 39.0966 17.5586 38.7891 C 17.5586 36.3874 21.2782 31.8916 28.0001 31.8916 C 34.7071 31.8916 38.4267 36.3874 38.4267 38.7891 C 38.4267 39.0966 38.2803 39.1992 37.8995 39.1992 Z"/></svg>'),
  timeline: raw('<svg class="fi i-timeline" viewBox="0 0 56 56" aria-hidden="true"><path d="M 27.9999 51.9063 C 41.0546 51.9063 51.9063 41.0781 51.9063 28 C 51.9063 14.9453 41.0312 4.0937 27.9765 4.0937 C 14.8983 4.0937 4.0937 14.9453 4.0937 28 C 4.0937 41.0781 14.9218 51.9063 27.9999 51.9063 Z M 27.9999 47.9219 C 16.9374 47.9219 8.1014 39.0625 8.1014 28 C 8.1014 16.9609 16.9140 8.0781 27.9765 8.0781 C 39.0155 8.0781 47.8983 16.9609 47.9219 28 C 47.9454 39.0625 39.0390 47.9219 27.9999 47.9219 Z M 15.7187 30.5312 L 27.9765 30.5312 C 28.8905 30.5312 29.6171 29.8281 29.6171 28.8906 L 29.6171 13.0937 C 29.6171 12.1797 28.8905 11.4766 27.9765 11.4766 C 27.0624 11.4766 26.3593 12.1797 26.3593 13.0937 L 26.3593 27.2734 L 15.7187 27.2734 C 14.8046 27.2734 14.1014 27.9766 14.1014 28.8906 C 14.1014 29.8281 14.8046 30.5312 15.7187 30.5312 Z"/></svg>'),
  poll: raw('<svg class="fi i-poll" viewBox="0 0 56 56" aria-hidden="true"><path d="M 44.8485 49.4564 L 50.7991 49.4564 C 54.2370 49.4564 56.0000 47.8035 56.0000 44.5418 L 56.0000 13.0706 C 56.0000 9.8089 54.2370 8.1339 50.7991 8.1339 L 44.8485 8.1339 C 41.4105 8.1339 39.6475 9.8089 39.6475 13.0706 L 39.6475 44.5418 C 39.6475 47.8035 41.4105 49.4564 44.8485 49.4564 Z M 45.4438 46.1285 C 43.7467 46.1285 43.1518 45.5555 43.1518 43.9026 L 43.1518 13.7097 C 43.1518 12.0347 43.7467 11.4618 45.4438 11.4618 L 50.2259 11.4618 C 51.9008 11.4618 52.4962 12.0347 52.4962 13.7097 L 52.4962 43.9026 C 52.4962 45.5555 51.9008 46.1285 50.2259 46.1285 Z M 25.0139 49.4564 L 30.9643 49.4564 C 34.4023 49.4564 36.1875 47.8035 36.1875 44.5418 L 36.1875 19.5058 C 36.1875 16.2441 34.4023 14.5692 30.9643 14.5692 L 25.0139 14.5692 C 21.5758 14.5692 19.8348 16.2441 19.8348 19.5058 L 19.8348 44.5418 C 19.8348 47.8035 21.5758 49.4564 25.0139 49.4564 Z M 25.6089 46.1285 C 23.9340 46.1285 23.3389 45.5555 23.3389 43.9026 L 23.3389 20.1450 C 23.3389 18.4700 23.9340 17.8970 25.6089 17.8970 L 30.3913 17.8970 C 32.0883 17.8970 32.6833 18.4700 32.6833 20.1450 L 32.6833 43.9026 C 32.6833 45.5555 32.0883 46.1285 30.3913 46.1285 Z M 5.2011 49.4564 L 11.1515 49.4564 C 14.5896 49.4564 16.3526 47.8035 16.3526 44.5418 L 16.3526 25.9191 C 16.3526 22.6574 14.5896 20.9824 11.1515 20.9824 L 5.2011 20.9824 C 1.7631 20.9824 0 22.6574 0 25.9191 L 0 44.5418 C 0 47.8035 1.7631 49.4564 5.2011 49.4564 Z M 5.7962 46.1285 C 4.0992 46.1285 3.5041 45.5555 3.5041 43.9026 L 3.5041 26.5582 C 3.5041 24.8833 4.0992 24.3103 5.7962 24.3103 L 10.5786 24.3103 C 12.2535 24.3103 12.8485 24.8833 12.8485 26.5582 L 12.8485 43.9026 C 12.8485 45.5555 12.2535 46.1285 10.5786 46.1285 Z"/></svg>'),
  trash: raw('<svg class="fi i-trash" viewBox="0 0 56 56" aria-hidden="true"><path d="M 44.5235 48.6602 L 46.1407 14.3945 L 48.4844 14.3945 C 49.4454 14.3945 50.2187 13.5976 50.2187 12.6367 C 50.2187 11.6758 49.4454 10.8555 48.4844 10.8555 L 38.2422 10.8555 L 38.2422 7.3398 C 38.2422 3.9883 35.9688 1.8086 32.3595 1.8086 L 23.5938 1.8086 C 19.9844 1.8086 17.7344 3.9883 17.7344 7.3398 L 17.7344 10.8555 L 7.5391 10.8555 C 6.6016 10.8555 5.7813 11.6758 5.7813 12.6367 C 5.7813 13.5976 6.6016 14.3945 7.5391 14.3945 L 9.8829 14.3945 L 11.5000 48.6836 C 11.6641 52.0586 13.8907 54.1914 17.2657 54.1914 L 38.7579 54.1914 C 42.1095 54.1914 44.3595 52.0351 44.5235 48.6602 Z M 21.4844 7.5742 C 21.4844 6.2383 22.4688 5.3008 23.8751 5.3008 L 32.1016 5.3008 C 33.5313 5.3008 34.5157 6.2383 34.5157 7.5742 L 34.5157 10.8555 L 21.4844 10.8555 Z M 17.6173 50.6758 C 16.2579 50.6758 15.2500 49.6445 15.1797 48.2852 L 13.5391 14.3945 L 42.3907 14.3945 L 40.8438 48.2852 C 40.7735 49.6680 39.7891 50.6758 38.4063 50.6758 Z M 34.9610 46.5508 C 35.7344 46.5508 36.3204 45.9180 36.3438 45.0273 L 37.0469 20.2773 C 37.0704 19.3867 36.4610 18.7305 35.6641 18.7305 C 34.9376 18.7305 34.3282 19.4102 34.3048 20.2539 L 33.6016 45.0273 C 33.5782 45.8711 34.1641 46.5508 34.9610 46.5508 Z M 21.0626 46.5508 C 21.8595 46.5508 22.4454 45.8711 22.4219 45.0273 L 21.7188 20.2539 C 21.6954 19.4102 21.0626 18.7305 20.3360 18.7305 C 19.5391 18.7305 18.9532 19.3867 18.9766 20.2773 L 19.7032 45.0273 C 19.7266 45.9180 20.2891 46.5508 21.0626 46.5508 Z M 29.4298 45.0273 L 29.4298 20.2539 C 29.4298 19.4102 28.7969 18.7305 28.0235 18.7305 C 27.2500 18.7305 26.5938 19.4102 26.5938 20.2539 L 26.5938 45.0273 C 26.5938 45.8711 27.2500 46.5508 28.0235 46.5508 C 28.7735 46.5508 29.4298 45.8711 29.4298 45.0273 Z"/></svg>'),
  pencil: raw('<svg class="fi i-pencil" viewBox="0 0 56 56" aria-hidden="true"><path d="M 43.2930 16.9258 L 45.6601 14.6055 C 46.8555 13.4101 46.9023 12.1211 45.8477 11.0430 L 45.0508 10.2461 C 43.9961 9.1914 42.7070 9.3086 41.5117 10.4570 L 39.1445 12.8008 Z M 15.6601 44.4883 L 41.2305 18.9414 L 37.1289 14.8164 L 11.5352 40.3867 L 9.3086 45.5898 C 9.0977 46.1523 9.6836 46.8086 10.2461 46.5742 Z"/></svg>'),
  expand: raw('<svg class="fi i-expand" viewBox="0 0 56 56" aria-hidden="true"><path d="M 7.8436 24.6016 C 9.0624 24.6016 9.9764 23.6641 9.9764 22.4219 L 9.9764 20.4531 L 9.4843 12.2734 L 15.6718 18.7656 L 22.8671 26.0312 C 23.2655 26.4531 23.7811 26.6406 24.3671 26.6406 C 25.6796 26.6406 26.6874 25.7734 26.6874 24.4609 C 26.6874 23.8281 26.4530 23.2656 26.0311 22.8437 L 18.8124 15.6250 L 12.2968 9.4609 L 20.4999 9.9297 L 22.4686 9.9297 C 23.7108 9.9297 24.6718 9.0625 24.6718 7.7968 C 24.6718 6.5312 23.7108 5.6406 22.4686 5.6406 L 9.4374 5.6406 C 7.0468 5.6406 5.6640 7.0234 5.6640 9.4141 L 5.6640 22.4219 C 5.6640 23.6406 6.5780 24.6016 7.8436 24.6016 Z M 33.5311 50.3594 L 46.5624 50.3594 C 48.9532 50.3594 50.3360 48.9766 50.3360 46.5859 L 50.3360 33.5781 C 50.3360 32.3594 49.4216 31.3984 48.1564 31.3984 C 46.9374 31.3984 46.0468 32.3359 46.0468 33.5781 L 46.0468 35.5469 L 46.5155 43.7266 L 40.3280 37.2344 L 33.1327 29.9688 C 32.7343 29.5469 32.2186 29.3594 31.6327 29.3594 C 30.3202 29.3594 29.3358 30.2266 29.3358 31.5390 C 29.3358 32.1719 29.5468 32.7344 29.9686 33.1563 L 37.2108 40.3750 L 43.7030 46.5391 L 35.4999 46.0703 L 33.5311 46.0703 C 32.2889 46.0703 31.3515 46.9375 31.3280 48.2031 C 31.3280 49.4687 32.2889 50.3594 33.5311 50.3594 Z"/></svg>'),
  edit: raw('<svg class="fi i-edit" viewBox="0 0 56 56" aria-hidden="true"><path d="M 48.7772 9.9766 L 50.4649 8.2422 C 51.2852 7.4219 51.2852 6.2734 50.4880 5.5000 L 49.9489 4.9375 C 49.2227 4.2109 48.0740 4.3047 47.3008 5.0547 L 45.5897 6.7422 Z M 21.8007 34.3516 L 26.3710 32.3594 L 47.0665 11.6875 L 43.8554 8.5234 L 23.1835 29.1953 L 21.0741 33.6016 C 20.8866 34.0000 21.3554 34.5391 21.8007 34.3516 Z M 12.0741 51.7891 L 39.5897 51.7891 C 43.8085 51.7891 46.2460 49.3516 46.2460 44.5234 L 46.2460 18.4375 L 42.4726 22.2109 L 42.4726 44.3360 C 42.4726 46.7734 41.1601 48.0156 39.5429 48.0156 L 12.1444 48.0156 C 9.8007 48.0156 8.4882 46.7734 8.4882 44.3360 L 8.4882 17.7344 C 8.4882 15.2969 9.8007 14.0312 12.1444 14.0312 L 32.4179 14.0312 L 36.1913 10.2578 L 12.0741 10.2578 C 7.1992 10.2578 4.7148 12.6953 4.7148 17.5234 L 4.7148 44.5234 C 4.7148 49.3750 7.1992 51.7891 12.0741 51.7891 Z"/></svg>'),
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
