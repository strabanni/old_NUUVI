// Validation for the free-form roleplay profile fields (users) and details (characters).
import { fail, str, oneOf } from './http.js';

export const STYLE_KEYS = ['communication', 'oneLiners', 'rapidFire', 'longThreads', 'development', 'plottingFirst'];

export function parseProfile(json) {
  try {
    return { styles: {}, ...JSON.parse(json || '{}') };
  } catch {
    return { styles: {} };
  }
}

// Merges allowed fields from input into the existing profile.
export function profileInput(input, existing = {}) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Profile must be an object');
  const out = { ...existing };
  const text = (key, label, max) => {
    const v = str(input[key], label, { max });
    if (v !== undefined) out[key] = v;
  };
  text('pronouns', 'Pronouns', 30);
  text('age', 'Age', 20);
  text('timezone', 'Time zone', 40);
  text('status', 'Status', 80);
  text('lookingFor', 'Looking for', 4000);
  text('limits', 'Limits', 4000);
  const activity = oneOf(input.activity, 'Activity', ['', 'active', 'moderate', 'low', 'hiatus']);
  if (activity !== undefined) out.activity = activity;
  const plots = oneOf(input.plots, 'Plots', ['', 'open', 'selective', 'closed']);
  if (plots !== undefined) out.plots = plots;
  if (input.styles !== undefined) {
    if (!input.styles || typeof input.styles !== 'object') fail(400, 'Styles must be an object');
    out.styles = {};
    for (const k of STYLE_KEYS) {
      const n = Number(input.styles[k]);
      if (input.styles[k] !== undefined && input.styles[k] !== '' && Number.isFinite(n))
        out.styles[k] = Math.max(0, Math.min(100, Math.round(n)));
    }
  }
  return out;
}

export function detailsInput(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 16) fail(400, 'Use at most 16 details');
  return input
    .map((d) => ({ label: str(d?.label, 'Detail name', { max: 30 }) ?? '', value: str(d?.value, 'Detail', { max: 200 }) ?? '' }))
    .filter((d) => d.label && d.value);
}
