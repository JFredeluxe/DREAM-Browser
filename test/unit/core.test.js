import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInput, isWebNavigable } from '../../src/shared/url.js';
import { sanitizeSettings, Settings } from '../../src/main/settings.js';
import { Bookmarks } from '../../src/main/bookmarks.js';
import { History } from '../../src/main/history.js';
import { JsonStore } from '../../src/main/store.js';
import { commandForInput } from '../../src/main/shortcuts.js';
import { ghostStores } from '../../src/main/memory.js';
import { AI_DEFAULTS, chooseCloudModel, cleanAiSettings } from '../../src/main/ai-policy.js';
import { buildSuggestions } from '../../src/main/omnibox.js';

test('address resolution distinguishes hosts, searches, local servers and unsafe schemes', () => {
  for (const [input, expected] of [['example.com', 'https://example.com/'], ['localhost:8080/a', 'http://localhost:8080/a'], ['127.0.0.1:8080', 'http://127.0.0.1:8080/'], ['', 'dream://newtab/'], ['about:blank', 'about:blank']]) assert.equal(resolveInput(input).url, expected);
  for (const input of ['hello world', 'javascript:alert(1)', 'file:///C:/Windows', 'dream://ui/renderer/index.html', 'data:text/html,test']) assert.equal(resolveInput(input).kind, 'search');
  for (const input of ['file:///x', 'dream://ui/', 'javascript:alert(1)']) assert.equal(isWebNavigable(input), false);
});
test('settings reject inherited properties and invalid values', () => {
  assert.deepEqual(sanitizeSettings({ theme: 'wrong', searchEngine: 'toString', accent: '__proto__', saveHistory: 'yes', density: 'compact' }), { density: 'compact' });
  assert.deepEqual(cleanAiSettings({ strategy: 'evil', allowCloud: 'yes', maxRequestUSD: -1 }), { maxRequestUSD: .001 });
});
test('profile data survives restart and corrupt files are preserved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-unit-'));
  try {
    const settings = new Settings(dir); settings.update({ theme: 'dark' }); settings.flush(); assert.equal(new Settings(dir).all.theme, 'dark');
    const b = new Bookmarks(dir); const item = b.add('https://example.com/', '<b>Literal title</b>'); b.add(item.url, 'duplicate'); b.flush();
    assert.equal(new Bookmarks(dir).items.length, 1); assert.equal(b.add('file:///secret', 'bad'), null);
    b.rename(item.id, 'Renamed'); b.flush(); assert.equal(new Bookmarks(dir).items[0].title, 'Renamed');
    const history = new History(dir); history.visit('https://example.com/', 'Example'); history.visit('https://example.com/', 'New'); history.flush(); assert.equal(new History(dir).entries[0].visits, 2);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{broken'); const store = new JsonStore(path.join(dir, 'bad.json'), { ok: true }); assert.equal(store.data.ok, true); assert.ok(fs.readdirSync(dir).some(f => f.startsWith('bad.json.corrupt-')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Ghost has no inherited bookmarks, history, persistence or enabled session restore', () => {
  const ghost = ghostStores({ restoreSession: true, saveHistory: true }); ghost.settings.update({ saveHistory: true, theme: 'invalid' });
  assert.equal(ghost.settings.all.saveHistory, false); assert.equal(ghost.settings.all.restoreSession, false); assert.equal(ghost.settings.all.theme, 'system');
  ghost.bookmarks.add('https://example.com', 'secret'); ghost.history.visit('https://example.com'); assert.deepEqual(ghost.bookmarks.items, []); assert.deepEqual(ghost.history.entries, []);
});
test('AI chooses a price-bounded model and fails closed at budget or unsupported charges', () => {
  const model = (id, prompt, completion) => ({ id, pricing: { prompt, completion }, context_length: 32000, architecture: { input_modalities: ['text'] } });
  const models = [model('expensive', .01, .01), model('low', .0000001, .0000002), model('free', 0, 0)];
  assert.equal(chooseCloudModel(models, 'hello', AI_DEFAULTS).id, 'free');
  assert.equal(chooseCloudModel(models, 'hello', { ...AI_DEFAULTS, model: 'low' }).id, 'low');
  assert.throws(() => chooseCloudModel(models, 'hello', { ...AI_DEFAULTS, model: 'expensive' }));
  assert.throws(() => chooseCloudModel([models[1]], 'hello', AI_DEFAULTS, 1));
  assert.throws(() => chooseCloudModel([{ ...models[1], pricing: { ...models[1].pricing, request: 1 } }], 'hello', AI_DEFAULTS));
});
test('shortcuts and suggestions use browser actions and locally stored data', () => {
  assert.equal(commandForInput({ type: 'keyDown', key: 'N', control: true, shift: true }, 'win32'), 'ghost-new');
  const list = buildSuggestions('example', { bookmarks: [{ url: 'https://example.com/', title: 'Example' }], history: [], searchEngine: 'duckduckgo' }); assert.equal(list[1].type, 'bookmark');
});
