// Ghost stores never open a file or subscribe to persistent profile stores.
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings.js';
export function ghostStores(normalSettings) {
  const listeners = new Set();
  const settings = {
    all: { ...DEFAULT_SETTINGS, ...normalSettings, saveHistory: false, restoreSession: false },
    update(patch) { Object.assign(this.all, sanitizeSettings(patch), { saveHistory: false, restoreSession: false }); for (const fn of listeners) fn(); },
    reset() { this.update(DEFAULT_SETTINGS); }, onChange(fn) { listeners.add(fn); }, flush() {},
  };
  return {
    settings,
    bookmarks: { items: [], find() {}, add() {}, remove() {}, rename() {}, onChange() {}, flush() {} },
    history: { entries: [], visit() {}, setTitle() {}, clear() {}, flush() {} },
    sessionStore: { data: { tabs: [], active: 0 }, touch() {}, flush() {} },
  };
}
