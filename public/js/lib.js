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
export const userGrad = (u) => raw(` data-grad="${esc((u?.gradient?.length ? u.gradient : BRAND_GRADIENT).join(','))}"`);
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
  // Uicons by Flaticon (flaticon.com/uicons): user, menu-burger, apps, user-add, power, fingerprint, music-alt, play, sparkles, layout-fluid, crown.
  menu: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.5 10.5H1.5Q0.9 10.5 0.4 10.9Q0 11.4 0 12Q0 12.6 0.4 13.1Q0.9 13.5 1.5 13.5H22.5Q23.1 13.5 23.6 13.1Q24 12.6 24 12Q24 11.4 23.6 10.9Q23.1 10.5 22.5 10.5ZM1.5 6.5H22.5Q23.1 6.5 23.6 6Q24 5.6 24 5Q24 4.4 23.6 4Q23.1 3.5 22.5 3.5H1.5Q0.9 3.5 0.4 4Q0 4.4 0 5Q0 5.6 0.4 6Q0.9 6.5 1.5 6.5ZM22.5 17.5H1.5Q0.9 17.5 0.4 18Q0 18.4 0 19Q0 19.6 0.4 20Q0.9 20.5 1.5 20.5H22.5Q23.1 20.5 23.6 20Q24 19.6 24 19Q24 18.4 23.6 18Q23.1 17.5 22.5 17.5Z"/></svg>'),
  apps: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 0H7Q8.6 0 9.8 1.2Q11 2.3 11 4V7Q11 8.6 9.8 9.8Q8.6 11 7 11H4Q2.3 11 1.2 9.8Q0 8.6 0 7V4Q0 2.3 1.2 1.2Q2.3 0 4 0ZM17 0H20Q21.7 0 22.8 1.2Q24 2.3 24 4V7Q24 8.6 22.8 9.8Q21.7 11 20 11H17Q15.4 11 14.2 9.8Q13 8.6 13 7V4Q13 2.3 14.2 1.2Q15.4 0 17 0ZM4 13H7Q8.6 13 9.8 14.2Q11 15.4 11 17V20Q11 21.7 9.8 22.8Q8.6 24 7 24H4Q2.3 24 1.2 22.8Q0 21.7 0 20V17Q0 15.4 1.2 14.2Q2.3 13 4 13ZM17 13H20Q21.7 13 22.8 14.2Q24 15.4 24 17V20Q24 21.7 22.8 22.8Q21.7 24 20 24H17Q15.4 24 14.2 22.8Q13 21.7 13 20V17Q13 15.4 14.2 14.2Q15.4 13 17 13Z"/></svg>'),
  user: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6Q6 7.6 6.8 9Q7.6 10.4 9 11.2Q10.4 12 12 12Q13.6 12 15 11.2Q16.4 10.4 17.2 9Q18 7.6 18 6Q18 4.4 17.2 3Q16.4 1.6 15 0.8Q13.6 0 12 0Q10.4 0 9 0.8Q7.6 1.6 6.8 3Q6 4.4 6 6ZM12 14Q9.5 14 7.5 15.2Q5.4 16.4 4.2 18.5Q3 20.6 3 23Q3 23.4 3.3 23.7Q3.6 24 4 24H20Q20.4 24 20.7 23.7Q21 23.4 21 23Q21 20.6 19.8 18.5Q18.6 16.4 16.5 15.2Q14.5 14 12 14Z"/></svg>'),
  userAdd: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M23 11H21V9Q21 8.6 20.7 8.3Q20.4 8 20 8Q19.6 8 19.3 8.3Q19 8.6 19 9V11H17Q16.6 11 16.3 11.3Q16 11.6 16 12Q16 12.4 16.3 12.7Q16.6 13 17 13H19V15Q19 15.4 19.3 15.7Q19.6 16 20 16Q20.4 16 20.7 15.7Q21 15.4 21 15V13H23Q23.4 13 23.7 12.7Q24 12.4 24 12Q24 11.6 23.7 11.3Q23.4 11 23 11ZM3 6Q3 7.6 3.8 9Q4.6 10.4 6 11.2Q7.4 12 9 12Q10.6 12 12 11.2Q13.4 10.4 14.2 9Q15 7.6 15 6Q15 4.4 14.2 3Q13.4 1.6 12 0.8Q10.6 0 9 0Q7.4 0 6 0.8Q4.6 1.6 3.8 3Q3 4.4 3 6ZM9 14Q6.6 14 4.5 15.2Q2.4 16.4 1.2 18.5Q0 20.6 0 23Q0 23.4 0.3 23.7Q0.6 24 1 24H17Q17.4 24 17.7 23.7Q18 23.4 18 23Q18 20.6 16.8 18.5Q15.6 16.4 13.5 15.2Q11.4 14 9 14Z"/></svg>'),
  power: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0Q12.6 0 13.1 0.4Q13.5 0.9 13.5 1.5V6.5Q13.5 7.1 13.1 7.6Q12.6 8 12 8Q11.4 8 10.9 7.6Q10.5 7.1 10.5 6.5V1.5Q10.5 0.9 10.9 0.4Q11.4 0 12 0ZM15.5 5Q15.5 5.8 16.2 6.2Q18 7.3 19 9.2Q20 11 20 13.2Q19.9 15.4 18.8 17.2Q17.7 19 15.8 20Q13.9 21 11.8 21Q9.7 21 7.8 19.8Q6 18.7 5 16.8Q4 15 4 12.8Q4.1 10.7 5.2 8.8Q6.2 7.2 7.8 6.2Q8.5 5.8 8.5 5Q8.5 4.3 8 3.9Q7.6 3.4 7 3.4Q6.6 3.4 6.2 3.7Q3.7 5.3 2.3 7.8Q1 10.4 1 13.3Q1.1 16.2 2.7 18.8Q4.2 21.4 6.8 22.7Q9.4 24.1 12.4 24Q15.3 23.9 17.8 22.4Q20.3 20.8 21.7 18.2Q23 15.6 23 12.7Q22.9 9.8 21.4 7.2Q20 5 17.8 3.7Q17.3 3.4 16.7 3.5Q16.1 3.6 15.8 4.2Q15.5 4.5 15.5 5Z"/></svg>'),
  fingerprint: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 22.3Q5.6 22.3 5.4 22.1Q5.1 21.8 5 21.5Q4.9 21.2 5 20.9Q5.2 20.6 5.4 20.4Q7.1 19.4 7.9 17.7Q8.6 16.2 8.9 14.2Q9 13 9 11Q9 9.8 9.9 8.9Q10.7 8 12 8Q13.3 8 14.2 8.9Q15 9.8 15 11Q15 11.4 14.7 11.7Q14.4 12 14 12Q13.6 12 13.3 11.7Q13 11.4 13 11Q13 10.6 12.7 10.3Q12.4 10 12 10Q11.6 10 11.3 10.3Q11 10.6 11 11Q11 13.3 10.8 14.6Q10.6 17 9.7 18.7Q8.6 20.9 6.5 22.2Q6.2 22.3 6 22.3ZM11 23.7Q14.4 20.2 14.9 14.1Q15 13.7 14.7 13.4Q14.4 13 14 13Q13.6 13 13.3 13.2Q13 13.5 12.9 13.9Q12.5 19.4 9.5 22.3Q9.2 22.6 9.2 23Q9.2 23.4 9.5 23.7Q9.8 24 10.2 24Q10.6 24 11 23.7ZM16.2 23.5Q17 22 17.7 20.3Q17.8 19.9 17.6 19.6Q17.4 19.2 17 19.1Q16.6 19 16.3 19.1Q15.9 19.3 15.8 19.7Q15.2 21.1 14.4 22.5Q14.2 22.8 14.3 23.2Q14.4 23.7 14.8 23.9Q15.1 24.1 15.5 24Q15.9 23.8 16.2 23.5ZM18.5 17.2Q19 14.2 19 11Q19 8.8 17.8 7Q16.6 5.3 14.5 4.5Q12.5 3.7 10.4 4.2Q8.2 4.7 6.8 6.3Q6.4 6.8 6.6 7.4Q6.7 7.9 7.3 8Q7.9 8.1 8.2 7.7Q9.3 6.5 10.8 6.1Q12.3 5.8 13.8 6.3Q15.2 6.9 16.1 8.2Q17 9.4 17 11Q17 13.9 16.6 16.8Q16.5 17.2 16.7 17.6Q17 17.9 17.4 18H17.5Q17.8 18 18.1 17.8Q18.4 17.5 18.5 17.2ZM7 11Q7 10.6 7 10.2Q7.2 9.6 6.8 9.2Q6.3 8.8 5.8 9Q5.2 9.2 5.1 9.8Q5 10.4 5 11Q5 18 1 18Q0.6 18 0.3 18.3Q0 18.6 0 19Q0 19.4 0.3 19.7Q0.6 20 1 20Q3.9 20 5.5 17.7Q7 15.4 7 11ZM20.7 23.4Q23.2 17.4 23 11Q23 8.5 21.9 6.2Q21.7 5.8 21.3 5.7Q21 5.6 20.6 5.8Q20.2 5.9 20 6.3Q19.9 6.7 20.1 7.1Q21 9 21 11Q21.2 17 18.9 22.6Q18.7 23 18.9 23.4Q19 23.8 19.4 23.9Q19.6 24 19.8 24Q20.1 24 20.3 23.8Q20.6 23.7 20.7 23.4ZM3 14V11Q3 8.6 4.2 6.5Q5.4 4.4 7.5 3.2Q9.5 2 12 2Q15 2 17.4 3.8Q17.8 4.1 18.2 4Q18.6 3.9 18.8 3.6Q19 3.3 19 2.9Q19 2.5 18.6 2.2Q17.2 1.1 15.5 0.6Q13.8 0 12 0Q9 0 6.5 1.5Q4 3 2.5 5.5Q1 8 1 11V14Q1 14.4 1.3 14.7Q1.6 15 2 15Q2.4 15 2.7 14.7Q3 14.4 3 14Z"/></svg>'),
  music: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.9 0.7Q22.4 0.2 21.8 0.1Q21.1 -0.1 20.5 0.1L8.5 2.3Q7.4 2.5 6.7 3.3Q6 4.2 6 5.3V16.6Q5 16 4 16Q2.3 16 1.2 17.2Q0 18.3 0 20Q0 21.7 1.2 22.8Q2.3 24 4 24Q5.7 24 6.8 22.8Q8 21.7 8 20V9.4L22 6.8V13.6Q21 13 20 13Q18.3 13 17.2 14.2Q16 15.4 16 17Q16 18.6 17.2 19.8Q18.3 21 20 21Q21.7 21 22.8 19.8Q24 18.6 24 17V3Q24 2.3 23.7 1.7Q23.4 1.1 22.9 0.7Z"/></svg>'),
  // Drawn a little inside its box so it sits level with the text beside it.
  episode: raw('<svg class="fi i-episode" viewBox="-3.5 -3.5 31 31" aria-hidden="true"><path d="M20.5 8 11 1Q9.8 0.2 8.4 0Q7 -0.1 5.7 0.6Q4.5 1.2 3.8 2.4Q3 3.6 3 5V19Q3 20.4 3.8 21.6Q4.5 22.8 5.8 23.4Q7 24.1 8.4 24Q9.8 23.8 11 23L20.5 16Q21.4 15.4 22 14.3Q22.6 13.2 22.6 12Q22.6 10.8 22 9.7Q21.4 8.6 20.5 8ZM19.3 14.4 9.8 21.4Q9.1 21.9 8.2 22Q7.4 22.1 6.6 21.7Q5.9 21.3 5.5 20.6Q5 19.8 5 19V5Q5 4.2 5.4 3.4Q5.9 2.7 6.6 2.4Q7.3 2 8 2Q9 2 9.8 2.6L19.3 9.6Q19.9 10 20.2 10.6Q20.6 11.3 20.6 12Q20.6 12.7 20.2 13.4Q19.9 14 19.3 14.4Z"/></svg>'),
  sparkle: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.5 5.2 2 6.9 8 7.6-6 .7-7.5 2.4-8 7.6-.5-5.2-2-6.9-8-7.6 6-.7 7.5-2.4 8-7.6zM19 15.5c.2 2 .8 2.6 3 2.9-2.2.3-2.8.9-3 2.9-.2-2-.8-2.6-3-2.9 2.2-.3 2.8-.9 3-2.9z"/></svg>'),
  users: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.1 4.6 1.8 5.3 4.9"/></svg>'),
  home: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/></svg>'),
  bell: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>'),
  compass: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>'),
  refresh: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>'),
  plus: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'),
  sparkles: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 24Q19.2 24 19 23.8Q18.7 23.7 18.6 23.4L17.8 21.3L15.6 20.4Q15.4 20.2 15.2 20Q15 19.8 15 19.4Q15 19.1 15.2 18.9Q15.4 18.6 15.7 18.5L17.8 17.7L18.6 15.6Q18.7 15.4 19 15.2Q19.2 15 19.5 15Q19.8 15 20.1 15.2Q20.3 15.4 20.4 15.6L21.3 17.8L23.4 18.6Q23.7 18.7 23.8 19Q24 19.2 24 19.5Q24 19.8 23.8 20.1Q23.7 20.3 23.4 20.4L21.3 21.3L20.4 23.4Q20.3 23.7 20.1 23.8Q19.8 24 19.5 24ZM10 21Q9.4 21 8.8 20.6Q8.2 20.2 8.1 19.6L6.5 14.6L1.4 12.9Q0.7 12.6 0.4 12.1Q0 11.5 0 10.9Q0 10.2 0.4 9.7Q0.8 9.2 1.4 9L6.5 7.4L8.2 2.4Q8.3 1.8 8.9 1.4Q9.4 1 10.1 1Q10.8 1 11.3 1.4Q11.8 1.8 12 2.4L13.5 7.4L18.6 9Q19.2 9.3 19.6 9.8Q20 10.3 20 11Q20 11.7 19.6 12.2Q19.2 12.7 18.6 13L13.5 14.6L11.9 19.6Q11.8 20.2 11.2 20.6Q10.6 21 10 21ZM10.1 3 8.2 8.6Q8 9 7.5 9.2L2 10.9L7.6 12.8Q8.1 13 8.2 13.4L10 19L11.8 13.4Q11.9 13 12.5 12.8L18 11L12.5 9.2Q11.9 9 11.8 8.6ZM20.5 7Q20.2 7 19.9 6.8Q19.6 6.6 19.5 6.2L19.2 4.8L17.8 4.4Q17.4 4.3 17.2 4Q17 3.8 17 3.4Q17 3.1 17.2 2.8Q17.4 2.6 17.8 2.5L19.2 2.2L19.5 0.7Q19.6 0.4 19.9 0.2Q20.2 0 20.5 0Q20.9 0 21.1 0.2Q21.4 0.4 21.4 0.7L21.8 2.2L23.3 2.6Q23.6 2.6 23.8 2.9Q24 3.1 24 3.5Q24 3.8 23.8 4.1Q23.6 4.4 23.3 4.5L21.8 4.8L21.4 6.2Q21.4 6.6 21.1 6.8Q20.9 7 20.5 7Z"/></svg>'),
  layout: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 11H13Q13.8 11 14.4 10.4Q15 9.8 15 9V2Q15 1.2 14.4 0.6Q13.8 0 13 0H2Q1.2 0 0.6 0.6Q0 1.2 0 2V9Q0 9.8 0.6 10.4Q1.2 11 2 11ZM2 2H13V9H2ZM22 0H19Q18.2 0 17.6 0.6Q17 1.2 17 2V9Q17 9.8 17.6 10.4Q18.2 11 19 11H22Q22.8 11 23.4 10.4Q24 9.8 24 9V2Q24 1.2 23.4 0.6Q22.8 0 22 0ZM22 9H19V2H22ZM5 13H2Q1.2 13 0.6 13.6Q0 14.2 0 15V22Q0 22.8 0.6 23.4Q1.2 24 2 24H5Q5.8 24 6.4 23.4Q7 22.8 7 22V15Q7 14.2 6.4 13.6Q5.8 13 5 13ZM5 22H2V15H5ZM22 13H11Q10.2 13 9.6 13.6Q9 14.2 9 15V22Q9 22.8 9.6 23.4Q10.2 24 11 24H22Q22.8 24 23.4 23.4Q24 22.8 24 22V15Q24 14.2 23.4 13.6Q22.8 13 22 13ZM22 22H11V15H22Z"/></svg>'),
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
  crown: raw('<svg class="fi" viewBox="0 0 24 24" aria-hidden="true"><path d="M22.8 4.6Q22.2 4.3 21.6 4.4Q21 4.6 20.6 5L18 7.6L13.4 3Q12.8 2.4 12 2.4Q11.2 2.4 10.6 3L6 7.6L3.4 5Q3 4.6 2.4 4.4Q1.8 4.3 1.2 4.6Q0.6 4.8 0.3 5.3Q0 5.8 0 6.4V17Q0 18.3 0.7 19.5Q1.4 20.6 2.5 21.3Q3.7 22 5 22H19Q20.3 22 21.5 21.3Q22.6 20.6 23.3 19.5Q24 18.3 24 17V6.4Q24 5.8 23.7 5.3Q23.4 4.8 22.8 4.6Z"/></svg>'),
  link: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.2 1.2"/><path d="M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.2-1.2"/></svg>'),
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
  book: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 7.5h8M8 11h5"/></svg>'),
  mute: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>'),
  sound: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>'),
  pushpin: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/></svg>'),
  pin: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.2A6.5 6.5 0 0 1 18.5 9.8C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/></svg>'),
  archive: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/></svg>'),
  camera: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.6"/></svg>'),
  warning: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/></svg>'),
  hourglass: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/></svg>'),
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
