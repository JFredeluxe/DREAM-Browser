import test from 'node:test';
import assert from 'node:assert/strict';
import { browserIntent, browserSearch } from '../../src/main/assistant-browser.js';
import { commandForInput } from '../../src/main/shortcuts.js';

test('explicit browser commands find matching data locally', () => {
  const intent = browserIntent('Find tabs about apples');
  assert.deepEqual(intent, { type: 'find', source: 'tab', query: 'apples' });
  assert.deepEqual(browserSearch(intent, { tabs: [{ title: 'Apples', url: 'https://example.com' }, { title: 'Other', url: 'https://example.org' }], bookmarks: [], history: [] }), [{ title: 'Apples', url: 'https://example.com' }]);
  assert.deepEqual(browserIntent('unpin this tab'), { type: 'pin', pinned: false });
  assert.equal(browserIntent('how do I pin this tab?'), null);
  assert.equal(commandForInput({ type: 'keyDown', key: 'J', control: true, shift: true }, 'win32'), 'assistant-show');
});
