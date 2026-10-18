// Small HTTP helpers shared by the route modules: errors, input validation, routing.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (status, message) => {
  throw new HttpError(status, message);
};

export function str(value, field, { min = 0, max = 200, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') fail(400, `${field} must be text`);
  const v = value.trim();
  if (v.length < min) fail(400, min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (v.length > max) fail(400, `${field} must be at most ${max} characters`);
  return v;
}

export function oneOf(value, field, options) {
  if (value === undefined) return undefined;
  if (!options.includes(value)) fail(400, `${field} must be one of: ${options.join(', ')}`);
  return value;
}

export function color(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(400, 'Color must be a hex value like #7c5cff');
  return value.toLowerCase();
}

export function id(value, field) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail(400, `${field} is invalid`);
  return n;
}

export const countWords = (text) => (text.match(/\S+/g) || []).length;

export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, options = {}) => {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return '(\\d+)';
        }) +
        '$',
    );
    routes.push({ method, regex, keys, handler, options });
  };
  const match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.regex);
      if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])])) };
    }
    return null;
  };
  return {
    match,
    get: (p, h, o) => add('GET', p, h, o),
    post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o),
    delete: (p, h, o) => add('DELETE', p, h, o),
  };
}
