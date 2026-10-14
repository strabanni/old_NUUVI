// NPCs: everyone's non-player characters, now a category in the Directory.
import { replaceHash } from '../main.js';

// NPCs are a category in the Directory now; the old NPCs page leads there.
export function viewNpcs() {
  try { sessionStorage.setItem('nuuvi:dir-view', 'npcs'); } catch { /* ignore */ }
  replaceHash('#/directory');
}
