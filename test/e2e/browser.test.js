import test from 'node:test';
import assert from 'node:assert/strict';
import { _electron } from 'playwright-core';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const executablePath = process.env.DREAM_PACKAGED_EXE || require('electron');
const wait = async (fn, message, timeout = 12000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 80)); } throw new Error(message); };

test('DREAM real desktop milestone', { timeout: 180000 }, async t => {
  fs.mkdirSync('test-results', { recursive: true });
  const profile = fs.mkdtempSync(path.resolve('test-results/profile-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<html><head><title>${req.url === '/second' ? 'Second page' : 'DREAM fixture'}</title></head><body><h1>Real browser content</h1><a href="/second">Next page</a><a href="/popup" target="_blank">Open popup</a><script>localStorage.setItem('visited','yes');document.cookie='normal=stored;path=/'</script></body></html>`); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const launch = async () => {
    const env = { ...process.env, DREAM_TEST: '1', DREAM_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
    const electron = await _electron.launch({ executablePath, args: process.env.DREAM_PACKAGED_EXE ? [] : ['.'], env, timeout: 25000 });
    const errors = []; electron.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
    await wait(() => electron.evaluate(() => !!globalThis.__dream), 'Application never became ready');
    const chrome = electron.windows().find(p => p.url() === 'dream://ui/renderer/index.html');
    assert.ok(chrome, 'Trusted toolbar loaded');
    return { electron, chrome, errors };
  };
  let run;
  try {
    run = await launch(); const { electron, chrome } = run;
    assert.equal(await chrome.locator('#mode-label').innerText(), 'CHROMIUM');
    assert.equal(await chrome.locator('#engines').count(), 0);
    await t.test('new-tab page loads and navigation history works', async () => {
      await wait(() => electron.evaluate(() => globalThis.__dream.tabs.active.wc.getTitle() === 'New Tab'), 'New tab failed');
      await chrome.locator('#url').fill(url); await chrome.locator('#url').press('Enter');
      await wait(() => electron.evaluate(() => globalThis.__dream.tabs.active.wc.getTitle() === 'DREAM fixture'), 'Navigation failed');
      assert.deepEqual(await electron.evaluate(() => globalThis.__dream.tabs.active.wc.executeJavaScript('({node:typeof require,bridge:typeof window.dream,internal:typeof window.dreamNewTab})')), { node: 'undefined', bridge: 'undefined', internal: 'undefined' });
      await electron.evaluate((_e, target) => globalThis.__dream.go(target), url + 'second');
      await wait(() => electron.evaluate(() => globalThis.__dream.tabs.active.wc.getTitle() === 'Second page'), 'Second navigation failed');
      await chrome.getByRole('button', { name: 'Back', exact: true }).click();
      await wait(() => electron.evaluate(() => globalThis.__dream.tabs.active.wc.getURL().endsWith('/')), 'Back failed');
      await chrome.getByRole('button', { name: 'Forward', exact: true }).click();
      await wait(() => electron.evaluate(() => globalThis.__dream.tabs.active.wc.getURL().endsWith('/second')), 'Forward failed');
    });
    await t.test('tabs, reorder, close/reopen and bookmarks operate', async () => {
      await electron.evaluate(() => { const dw = globalThis.__dream; dw.overlay.finish(dw.overlay.current?.token); dw.toggleBookmark(); });
      await wait(() => electron.evaluate(() => globalThis.__dream.bookmarks.items.length === 1), 'Bookmark missing');
      await electron.evaluate(() => { const dw = globalThis.__dream; dw.overlay.finish(dw.overlay.current?.token); dw.newTab('https://example.com'); dw.tabs.move(dw.tabs.activeId, 0); dw.tabs.close(dw.tabs.activeId); dw.tabs.reopenClosed(); });
      assert.equal(await electron.evaluate(() => globalThis.__dream.tabs.list().length), 2);
      await electron.evaluate(() => { const dw = globalThis.__dream; dw.tabs.activate(dw.tabs.list().find(t => t.url.includes('127.0.0.1')).id); dw.settings.update({ theme: 'light', tabPosition: 'left', saveHistory: false }); dw.newTab('http://127.0.0.1:1/not-remembered'); });
      await wait(() => electron.evaluate(() => globalThis.__dream.tabs.active.wc.getURL().startsWith('dream://newtab/error')), 'Failure page missing');
      assert.equal(await electron.evaluate(() => globalThis.__dream.history.entries.some(e => e.url.includes('not-remembered'))), false);
    });
    await t.test('Ghost has separate cookies and rejects AI/extensions at IPC boundary', async () => {
      await chrome.evaluate(() => window.dream.call('ghost:new'));
      await wait(() => electron.evaluate(() => [...globalThis.__dreamWindows.values()].some(w => w.ghost)), 'Ghost did not open');
      const isolation = await electron.evaluate(async () => {
        const ghost = [...globalThis.__dreamWindows.values()].find(w => w.ghost); const normal = globalThis.__dream;
        return { ghostCookieCount: (await ghost.tabs.session.cookies.get({})).length, normalCookieCount: (await normal.tabs.session.cookies.get({})).length, history: ghost.history.entries.length, bookmarks: ghost.bookmarks.items.length, sameSession: ghost.tabs.session === normal.tabs.session };
      });
      assert.equal(isolation.ghostCookieCount, 0); assert.ok(isolation.normalCookieCount > 0); assert.equal(isolation.sameSession, false); assert.equal(isolation.history, 0); assert.equal(isolation.bookmarks, 0);
      await wait(() => electron.windows().filter(p => p.url() === 'dream://ui/renderer/index.html').length === 2, 'Ghost toolbar did not load');
      const ghostPage = electron.windows().find(p => p.url() === 'dream://ui/renderer/index.html' && p !== chrome);
      await assert.rejects(ghostPage.evaluate(() => window.dream.call('assistant:ask', { text: 'secret' })), /disabled in Ghost/);
      await assert.rejects(ghostPage.evaluate(() => window.dream.call('extensions:install')), /disabled in Ghost/);
      await electron.evaluate(() => [...globalThis.__dreamWindows.values()].find(w => w.ghost).win.close());
    });
    await t.test('AI routes locally, fails closed and sends only an explicit bounded cloud request', async () => {
      const result = await electron.evaluate(async () => {
        const a = globalThis.__dreamAssistant; const original = globalThis.fetch; const requests = [];
        globalThis.fetch = async (url, options) => { requests.push({ url, body: options?.body });
          if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'local-test' }] }));
          if (url.endsWith('/api/chat')) return new Response(JSON.stringify({ message: { content: 'Local answer' } }), { headers: { 'content-type': 'application/json' } });
          if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'test/cheap', context_length: 32000, pricing: { prompt: '0.0000001', completion: '0.0000002' } }] }));
          return new Response(JSON.stringify({ model: 'test/cheap', choices: [{ message: { content: 'Cloud answer' } }] }), { headers: { 'content-type': 'application/json' } });
        };
        try {
          const local = await a.ask(991, 'explicit local question');
          a.configure({ strategy: 'cloud', allowCloud: false }); let blocked = false; try { await a.ask(991, 'blocked'); } catch { blocked = true; }
          a.configure({ apiKey: 'test-key-not-real', allowCloud: true }); const cloud = await a.ask(991, 'explicit cloud question');
          const status = a.status(); a.configure({ clearKey: true, strategy: 'auto', allowCloud: false });
          return { local, cloud, blocked, requests, status };
        } finally { globalThis.fetch = original; }
      });
      assert.equal(result.local.text, 'Local answer'); assert.equal(result.cloud.text, 'Cloud answer'); assert.equal(result.blocked, true);
      assert.equal(result.status.apiKey, undefined); assert.ok(result.status.reservedUSD > 0);
      const request = JSON.parse(result.requests.at(-1).body); assert.equal(request.provider.data_collection, 'deny'); assert.equal(request.max_tokens, 768); assert.equal(request.messages.at(-1).content, 'explicit cloud question'); assert.deepEqual(request.messages.map(message => message.role), ['user', 'assistant', 'user']);
    });
    await t.test('a real unpacked Chromium extension executes', async () => {
      const folder = path.join(profile, 'fixture-extension'); fs.mkdirSync(folder);
      fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'DREAM integration fixture', version: '1.0', content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'] }] }));
      fs.writeFileSync(path.join(folder, 'content.js'), "document.documentElement.dataset.dreamExtension = 'working';");
      await electron.evaluate(({ dialog }, folder) => { const open = dialog.showOpenDialog, message = dialog.showMessageBox; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); dialog.showMessageBox = async () => ({ response: 1 }); globalThis.__restoreDialogs = () => { dialog.showOpenDialog = open; dialog.showMessageBox = message; }; }, folder);
      let installed;
      try { installed = await chrome.evaluate(() => window.dream.call('extensions:install')); } finally { await electron.evaluate(() => globalThis.__restoreDialogs()); }
      assert.equal(installed.extensions.length, 1);
      await electron.evaluate((_e, url) => globalThis.__dream.newTab(url), url);
      await electron.evaluate((_e, url) => globalThis.__dream.go(url), url);
      await wait(() => electron.evaluate(() => globalThis.__dream.tabs.active.wc.executeJavaScript('document.documentElement.dataset.dreamExtension === "working"')), 'Extension did not execute');
    });
    await t.test('rapid tab changes remain responsive with reduced motion', async () => {
      await chrome.emulateMedia({ reducedMotion: 'reduce' });
      const result = await electron.evaluate(() => {
        const tabs = globalThis.__dream.tabs; const before = tabs.list().length;
        const created = Array.from({ length: 25 }, () => tabs.create({ url: 'about:blank', active: false }));
        for (const tab of created) tabs.close(tab.id);
        return { before, after: tabs.list().length };
      });
      assert.equal(result.after, result.before);
      await chrome.emulateMedia({ reducedMotion: 'no-preference' });
    });
    await t.test('internal settings and assistant panels render without errors', async () => {
      await electron.evaluate(() => { const dw = globalThis.__dream; dw.newTab(); dw.showCustomize(); });
      const overlay = electron.windows().find(p => p.url().includes('overlay.html'));
      await overlay.getByRole('heading', { name: 'Make it yours' }).waitFor();
      await overlay.getByRole('button', { name: 'Close', exact: true }).click();
      await wait(() => electron.evaluate(() => !globalThis.__dream.overlay.view.getVisible()), 'Settings did not close');
      await chrome.getByRole('button', { name: 'Assistant', exact: true }).click();
      await overlay.getByRole('heading', { name: 'Ask DREAM' }).waitFor();
      await overlay.getByText('Connections & cost limits').click();
      assert.equal(await overlay.locator('input[type=password]').count(), 1);
      await electron.evaluate(() => {
        const original = globalThis.fetch; globalThis.__restoreAiFetch = () => { globalThis.fetch = original; };
        globalThis.fetch = async url => {
          if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'test' }] }));
          const encoder = new TextEncoder();
          return new Response(new ReadableStream({ start(controller) {
            controller.enqueue(encoder.encode('{"message":{"content":"First"},"done":false}\n'));
            setTimeout(() => { controller.enqueue(encoder.encode('{"message":{"content":" second"},"done":true}\n')); controller.close(); }, 3000);
          } }), { headers: { 'content-type': 'application/x-ndjson' } });
        };
      });
      try {
        await overlay.evaluate(() => { window.__streamChunks = []; window.dream.on('assistant:chunk', data => window.__streamChunks.push(data)); });
        await overlay.getByLabel('Ask DREAM Assistant').fill('Say hello');
        await overlay.getByRole('button', { name: 'Send ↗' }).click();
        try { await wait(async () => await overlay.locator('.streaming').count() && (await overlay.locator('.streaming').textContent()).includes('First'), 'Streaming text did not appear'); }
        catch (error) { throw new Error(`${error.message}; route: ${await overlay.locator('.route-note').innerText()}; chunks: ${JSON.stringify(await overlay.evaluate(() => window.__streamChunks))}; conversation: ${await overlay.locator('.chat-log').innerText()}`); }
        assert.match(await overlay.locator('.route-note').innerText(), /Ollama · test/);
        await overlay.getByText('First second').waitFor();
      } finally { await electron.evaluate(() => globalThis.__restoreAiFetch()); }
      await overlay.getByRole('button', { name: 'Close', exact: true }).click();
      await wait(() => electron.evaluate(() => !globalThis.__dream.overlay.view.getVisible()), 'Assistant did not close');
      const image = await electron.evaluate(async () => (await globalThis.__dream.win.capturePage()).toPNG().toString('base64'));
      fs.writeFileSync('test-results/browser.png', Buffer.from(image, 'base64'));
      const content = await electron.evaluate(async () => ({ image: (await globalThis.__dream.tabs.active.wc.capturePage()).toPNG().toString('base64'), bounds: globalThis.__dream.tabs.active.view.getBounds() }));
      fs.writeFileSync('test-results/newtab.png', Buffer.from(content.image, 'base64'));
      fs.writeFileSync('test-results/content-bounds.json', JSON.stringify(content.bounds));
    });
    await electron.close(); run = null;
    await t.test('bookmarks, settings and extension registrations survive restart', async () => {
      run = await launch();
      await wait(() => run.electron.evaluate(() => globalThis.__dream.integrations.status().extensions.length === 1), 'Extension did not restore');
      const restored = await run.electron.evaluate(() => ({ bookmarks: globalThis.__dream.bookmarks.items.length, theme: globalThis.__dream.settings.all.theme, extensions: globalThis.__dream.integrations.status().extensions.length }));
      assert.equal(restored.bookmarks, 1); assert.equal(restored.theme, 'light'); assert.equal(restored.extensions, 1);
    });
  } finally {
    if (run) await run.electron.close();
    await new Promise(r => server.close(r));
    // Profiles remain only on failure to aid diagnosis; all profiles here contain test fixtures only.
    if (profile.startsWith(path.resolve('test-results') + path.sep)) { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { console.warn('Test profile retained for diagnosis.'); } }
  }
});
