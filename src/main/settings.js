import path from 'node:path';
import { JsonStore } from './store.js';
import { SEARCH_ENGINES } from '../shared/url.js';

export const ACCENTS = {
  blue: '#3a6df0',
  violet: '#7a5af5',
  rose: '#e0457b',
  orange: '#e8751a',
  green: '#2f9e60',
  graphite: '#5f6672',
};

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark
  accent: 'graphite', // key of ACCENTS or #rrggbb
  tabPosition: 'left', // top | left
  density: 'comfortable', // comfortable | compact
  sidebarVisible: true, // vertical-tab sidebar expanded
  searchEngine: 'duckduckgo',
  saveHistory: true,
  restoreSession: true,
};

// One validator per key: returns the cleaned value or undefined to reject.
const VALIDATORS = {
  theme: (v) => (['system', 'light', 'dark'].includes(v) ? v : undefined),
  accent: (v) => (typeof v === 'string' && (Object.hasOwn(ACCENTS, v) || /^#[0-9a-f]{6}$/i.test(v)) ? v : undefined),
  tabPosition: (v) => (['top', 'left'].includes(v) ? v : undefined),
  density: (v) => (['comfortable', 'compact'].includes(v) ? v : undefined),
  sidebarVisible: (v) => (typeof v === 'boolean' ? v : undefined),
  searchEngine: (v) => (typeof v === 'string' && Object.hasOwn(SEARCH_ENGINES, v) ? v : undefined),
  saveHistory: (v) => (typeof v === 'boolean' ? v : undefined),
  restoreSession: (v) => (typeof v === 'boolean' ? v : undefined),
};

export function sanitizeSettings(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    const fn = Object.hasOwn(VALIDATORS, k) ? VALIDATORS[k] : null;
    if (!fn) continue;
    const clean = fn(v);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

export class Settings {
  constructor(dir) {
    this.store = new JsonStore(path.join(dir, 'settings.json'), DEFAULT_SETTINGS);
    // drop unknown/invalid persisted values
    this.store.data = { ...DEFAULT_SETTINGS, ...sanitizeSettings(this.store.data) };
    this.listeners = new Set();
  }

  get all() {
    return this.store.data;
  }

  update(patch) {
    const clean = sanitizeSettings(patch);
    let changed = false;
    for (const [k, v] of Object.entries(clean)) {
      if (this.store.data[k] !== v) {
        this.store.data[k] = v;
        changed = true;
      }
    }
    if (changed) {
      this.store.touch();
      for (const fn of this.listeners) fn(this.store.data);
    }
    return changed;
  }

  reset() {
    this.update(DEFAULT_SETTINGS);
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  flush() {
    this.store.flush();
  }
}
