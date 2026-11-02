import fs from 'node:fs';
import path from 'node:path';

/**
 * A small versioned JSON file store.
 *  - atomic writes (temp file + rename), so a crash never leaves a half-written file
 *  - debounced saves, flushed synchronously on quit
 *  - a corrupt file is moved aside (.corrupt-<ts>) instead of being silently overwritten
 */
export class JsonStore {
  constructor(file, defaults, { version = 1, migrate, delay = 250 } = {}) {
    this.file = file;
    this.version = version;
    this.delay = delay;
    this.timer = null;
    this.data = structuredClone(defaults);
    this.load(defaults, migrate);
  }

  load(defaults, migrate) {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return; // first run
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
      let { v = 0, data } = parsed;
      if (v < this.version && migrate) data = migrate(data, v);
      this.data = Array.isArray(defaults) ? data : { ...structuredClone(defaults), ...data };
    } catch {
      try {
        fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
    }
  }

  save() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: this.version, data: this.data }));
    fs.renameSync(tmp, this.file);
  }

  /** Mark dirty; write after a short debounce. */
  touch() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      try {
        this.save();
      } catch (err) {
        console.error('[store] save failed', this.file, err);
      }
    }, this.delay);
  }

  flush() {
    if (this.timer) this.save();
  }
}
