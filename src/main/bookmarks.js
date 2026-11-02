import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from './store.js';

const MAX_TITLE = 300;

function isStorable(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol);
  } catch {
    return false;
  }
}

export class Bookmarks {
  constructor(dir) {
    this.store = new JsonStore(path.join(dir, 'bookmarks.json'), { items: [] });
    this.store.data.items = Array.isArray(this.store.data.items) ? this.store.data.items.filter(b => b && typeof b.id === 'string' && isStorable(b.url)).slice(0, 5000) : [];
    this.listeners = new Set();
  }

  get items() {
    return this.store.data.items;
  }

  find(url) {
    return this.items.find((b) => b.url === url);
  }

  add(url, title) {
    if (!isStorable(url)) return null;
    const existing = this.find(url);
    if (existing) return existing;
    const item = {
      id: randomUUID(),
      url,
      title: String(title || url).slice(0, MAX_TITLE),
      added: Date.now(),
    };
    this.items.unshift(item);
    this.#changed();
    return item;
  }

  rename(id, title) {
    const b = this.items.find((x) => x.id === id);
    if (!b) return false;
    b.title = String(title || b.url).slice(0, MAX_TITLE);
    this.#changed();
    return true;
  }

  remove(id) {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.#changed();
    return true;
  }

  toggle(url, title) {
    const existing = this.find(url);
    if (existing) {
      this.remove(existing.id);
      return null;
    }
    return this.add(url, title);
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  flush() {
    this.store.flush();
  }

  #changed() {
    this.store.touch();
    for (const fn of this.listeners) fn();
  }
}
