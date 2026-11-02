import path from 'node:path';
import { JsonStore } from './store.js';

const MAX_ENTRIES = 5000;

export class History {
  constructor(dir) {
    this.store = new JsonStore(path.join(dir, 'history.json'), { entries: [] });
    this.store.data.entries = Array.isArray(this.store.data.entries) ? this.store.data.entries.filter(e => e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url)).slice(0, MAX_ENTRIES) : [];
  }

  get entries() {
    return this.store.data.entries;
  }

  /** Record a visit. Only http(s) pages are remembered. */
  visit(url, title) {
    if (!/^https?:\/\//i.test(url)) return;
    const now = Date.now();
    let e = this.entries.find((x) => x.url === url);
    if (e) {
      e.visits += 1;
      e.last = now;
      if (title) e.title = title;
    } else {
      this.entries.push({ url, title: title || url, visits: 1, last: now });
      if (this.entries.length > MAX_ENTRIES) {
        this.entries.sort((a, b) => b.last - a.last);
        this.entries.length = MAX_ENTRIES;
      }
    }
    this.store.touch();
  }

  setTitle(url, title) {
    const e = this.entries.find((x) => x.url === url);
    if (e && title) {
      e.title = title;
      this.store.touch();
    }
  }

  clear() {
    this.store.data.entries = [];
    this.store.touch();
  }

  flush() {
    this.store.flush();
  }
}
