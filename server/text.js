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
