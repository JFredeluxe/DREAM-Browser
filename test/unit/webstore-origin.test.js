import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

test('the Web Store bridge requires its exact origin', () => {
  // Both sides are checked: the preload must not expose the API to a lookalike
  // site, and the main process must reject requests from one independently.
  const preload = readFileSync(require.resolve('electron-chrome-web-store/preload'), 'utf8');
  const browser = readFileSync(require.resolve('electron-chrome-web-store'), 'utf8');
  const browserModule = readFileSync(new URL(import.meta.resolve('electron-chrome-web-store')), 'utf8');
  assert.match(preload, /location\.origin === "https:\/\/chromewebstore\.google\.com"/);
  assert.match(browser, /senderOrigin !== WEBSTORE_URL/);
  assert.match(browserModule, /senderOrigin !== WEBSTORE_URL/);
  assert.doesNotMatch(preload, /location\.href\.startsWith\("https:\/\/chromewebstore\.google\.com"\)/);
  assert.doesNotMatch(browser, /senderOrigin\.startsWith\(WEBSTORE_URL\)/);
  assert.doesNotMatch(browserModule, /senderOrigin\.startsWith\(WEBSTORE_URL\)/);
});
