// Post text as plain words, for previews, notifications and reply quotes:
// formatting codes and markup symbols removed, pictures dropped, whitespace collapsed.
export function plainText(body = '', max = 140) {
  const text = String(body)
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?(?:center|right|box|h|hr|color|size|caps|b|i|u|s)(?:=[^\]]*)?\]/gi, ' ')
    .replace(/\|\|/g, '')
    .replace(/[*_~`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Character names start every word with a capital ("mina park" → "Mina Park", "mary-jane" →
// "Mary-Jane"). Only first letters change, so "McKay" or "DeLuca" stay as typed.
export function capitalizeName(name = '') {
  return String(name).replace(/(^|[\s\-])(\p{Ll})/gu, (_, gap, ch) => gap + ch.toLocaleUpperCase());
}
