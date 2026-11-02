import { ipcMain } from 'electron';
import { browserIntent, browserSearch } from './assistant-browser.js';

const str = (v, max = 2048) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(v) ? v : 0);
const rect = (r) => ({
  x: Math.round(num(r?.x)),
  y: Math.round(num(r?.y)),
  width: Math.max(0, Math.round(num(r?.width))),
  height: Math.max(0, Math.round(num(r?.height))),
});

/** Methods the toolbar/overlay renderers may call. Every argument is validated here, never trusted. */
const METHODS = {
  'state:get': (dw) => dw.snapshot(),

  'tab:new': (dw) => void dw.newTab(),
  'tab:close': (dw, p) => dw.tabs.close(str(p.id, 16)),
  'tab:activate': (dw, p) => dw.tabs.activate(str(p.id, 16)),
  'tab:move': (dw, p) => dw.tabs.move(str(p.id, 16), Math.trunc(num(p.index))),
  'tab:menu': (dw, p) => dw.showTabMenu(str(p.id, 16), Math.round(num(p.x)), Math.round(num(p.y))),

  'nav:back': (dw) => dw.run('back'),
  'nav:forward': (dw) => dw.run('forward'),
  'nav:reload': (dw) => dw.run('reload'),
  'nav:stop': (dw) => dw.tabs.active?.wc.stop(),

  'layout:content': (dw, p) => dw.tabs.setContentRect(rect(p)),
  'layout:anchors': (dw, p) => {
    const out = {};
    for (const [k, v] of Object.entries(p ?? {}).slice(0, 12)) out[str(k, 24)] = rect(v);
    dw.setAnchors(out);
  },

  'omnibox:query': (dw, p) => dw.omniboxQuery(str(p.text, 1000)),
  'omnibox:move': (dw, p) => dw.omniboxMove(p.delta < 0 ? -1 : 1),
  'omnibox:submit': (dw, p) => dw.omniboxSubmit(str(p.text, 1000)),
  'omnibox:dismiss': (dw) => dw.omniboxDismiss(),

  'bookmark:toggle': (dw) => dw.toggleBookmark(),
  'bookmarks:show': (dw) => dw.showBookmarks(),
  'customize:show': (dw) => dw.showCustomize(),
  'menu:show': (dw) => dw.showMenu(),

  'settings:update': (dw, p) => void dw.settings.update(p),
  'ghost:new': dw => void dw.openGhost(),
  'assistant:show': dw => dw.showAssistant(),
  'assistant:status': dw => { if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.'); return dw.assistant.status(); },
  'assistant:models': dw => { if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.'); return dw.assistant.localModels(); },
  'assistant:local': (dw, p) => {
    if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.');
    if (dw.overlay.kind !== 'assistant' || dw.overlay.current?.token !== p?.token) throw new Error('Assistant closed.');
    const intent = browserIntent(str(p.text, 1000));
    if (!intent) return null;
    if (intent.type === 'sort') {
      const tabs = [...dw.tabs.list()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.title || a.url).localeCompare(b.title || b.url));
      tabs.forEach((tab, index) => dw.tabs.move(tab.id, index));
      return { text: 'Sorted tabs alphabetically, keeping pinned tabs together.' };
    }
    if (intent.type === 'pin') {
      const tab = dw.tabs.active;
      if (!tab) return { text: 'There is no active tab.' };
      dw.tabs.setPinned(tab.id, intent.pinned);
      return { text: intent.pinned ? 'Pinned the current tab.' : 'Unpinned the current tab.' };
    }
    const matches = browserSearch(intent, { tabs: dw.tabs.list(), bookmarks: dw.bookmarks.items, history: dw.history.entries });
    return { text: matches.length ? `Found ${matches.length} matching ${intent.source}${matches.length === 1 ? '' : 's'}.` : `No ${intent.source} matches found.`, source: intent.source, results: matches };
  },
  'assistant:open': (dw, p) => {
    if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.');
    if (dw.overlay.kind !== 'assistant' || dw.overlay.current?.token !== p?.token) throw new Error('Assistant closed.');
    if (p.source === 'tab') { const tab = dw.tabs.get(str(p.id, 32)); if (!tab) throw new Error('That tab is no longer open.'); dw.tabs.activate(tab.id); }
    else if (p.source === 'bookmark') { const item = dw.bookmarks.items.find(item => item.id === str(p.id, 64)); if (!item) throw new Error('That bookmark no longer exists.'); dw.newTab(item.url); }
    else if (p.source === 'history') { const item = dw.history.entries.find(item => item.url === str(p.url, 500)); if (!item) throw new Error('That history entry no longer exists.'); dw.newTab(item.url); }
    else throw new Error('Unknown browser result.');
    dw.overlay.hide();
  },
  'assistant:configure': (dw, p) => { if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.'); return dw.assistant.configure(p); },
  'assistant:ask': (dw, p) => {
    if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.');
    if (dw.overlay.kind !== 'assistant' || dw.overlay.current?.token !== p?.token) throw new Error('Assistant closed.');
    const token = dw.overlay.current?.token;
    return dw.assistant.ask(dw.win.webContents.id, str(p.text, 24001), chunk => {
      if (dw.overlay.kind === 'assistant' && dw.overlay.current?.token === token && !dw.overlay.webContents.isDestroyed()) dw.overlay.webContents.send('assistant:chunk', { token, chunk });
    }, route => {
      if (dw.overlay.kind === 'assistant' && dw.overlay.current?.token === token && !dw.overlay.webContents.isDestroyed()) dw.overlay.webContents.send('assistant:route', { token, ...route });
    });
  },
  'assistant:cancel': dw => { if (!dw.ghost) dw.assistant.cancel(dw.win.webContents.id); },
  'assistant:page': async dw => { if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.'); const tab = dw.tabs.active; if (!tab || !/^https?:/.test(tab.url)) return ''; return tab.wc.executeJavaScript('document.body.innerText.slice(0, 16000)'); },
  'assistant:tabs': async dw => {
    if (dw.ghost) throw new Error('AI is disabled in Ghost Mode.');
    const tabs = dw.tabs.list().filter(tab => /^https?:/.test(tab.wc.getURL())).slice(0, 4);
    return Promise.all(tabs.map(async tab => ({ title: tab.title, url: tab.url, text: await tab.wc.executeJavaScript('(document.body?.innerText || "").slice(0, 3200)').catch(() => '') })));
  },
  'integrations:show': dw => dw.showIntegrations(),
  'extensions:install': dw => { if (dw.ghost) throw new Error('Extensions are disabled in Ghost Mode.'); return dw.integrations.installExtension(dw.win); },
  'extensions:remove': (dw, p) => { if (dw.ghost) throw new Error('Extensions are disabled in Ghost Mode.'); return dw.integrations.removeExtension(str(p.id, 100)); },
  'extensions:update': dw => { if (dw.ghost) throw new Error('Extensions are disabled in Ghost Mode.'); return dw.integrations.update(); },
  'extensions:options': (dw, p) => { if (dw.ghost) throw new Error('Extensions are disabled in Ghost Mode.'); dw.overlay.hide(); dw.newTab(dw.integrations.optionsPage(str(p.id, 100))); },
  'extensions:search': (dw, p) => { if (dw.ghost) throw new Error('Extensions are disabled in Ghost Mode.'); dw.overlay.hide(); dw.newTab('https://chromewebstore.google.com/search/' + encodeURIComponent(str(p.text, 200))); },
  'assistant:clear': dw => { if (dw.ghost) return; dw.assistant.clear(dw.win.webContents.id); },
  'clipboard:write': (dw, p) => { if (dw.ghost) throw new Error('Copy is unavailable in Ghost Mode.'); dw.copyText(str(p.text, 100000)); },
  'chrome:open': dw => { if (dw.ghost) throw new Error('Extensions are disabled in Ghost Mode.'); dw.overlay.hide(); dw.newTab('https://chromewebstore.google.com/'); return { opened: true }; },
  'history:clear': dw => { dw.history.clear(); dw.history.flush(); },
  'privacy:clear': async dw => { if (dw.ghost) return; await dw.tabs.session.clearStorageData(); await dw.tabs.session.clearCache(); dw.history.clear(); dw.history.flush(); },

  'overlay:action': (dw, p) => dw.overlay.action(Number(p.token), str(p.id, 64), p.value),
  'overlay:dismiss': (dw) => dw.overlay.hide(),
  'overlay:hidden': (dw, p) => dw.overlay.finish(Number(p.token)),
};

/**
 * @param {() => import('./window.js').DreamWindow | null} getWindow
 */
export function registerIpc(getWindow) {
  ipcMain.handle('rpc', (event, method, payload) => {
    const dw = getWindow(event.sender);
    const frame = event.senderFrame;
    const trusted =
      dw &&
      frame &&
      frame.parent === null &&
      ['dream://ui/renderer/index.html', 'dream://ui/renderer/overlay.html'].includes(frame.url) &&
      (event.sender === dw.win.webContents || event.sender === dw.overlay.webContents);
    if (!trusted) throw new Error('untrusted sender');
    const fn = Object.hasOwn(METHODS, method) ? METHODS[method] : null;
    if (!fn) throw new Error(`unknown method ${String(method).slice(0, 40)}`);
    return fn(dw, payload && typeof payload === 'object' ? payload : {});
  });

  // The new-tab page may only ask to navigate its own tab and read bookmarks.
  ipcMain.handle('newtab', (event, method, payload) => {
    const dw = getWindow(event.sender);
    const url = event.senderFrame?.url ?? '';
    const tab = dw?.tabs.list().find((t) => t.wc === event.sender);
    if (!tab || event.senderFrame.parent !== null || !/^dream:\/\/newtab\/(index\.html|error\.html)?($|[?#])/.test(url))
      throw new Error('untrusted sender');
    if (method === 'info')
      return {
        ghost: dw.ghost,
        effectiveTheme: dw.snapshot().effectiveTheme,
        bookmarks: dw.bookmarks.items.slice(0, 12).map(({ title, url }) => ({ title, url })),
        accent: dw.snapshot().accents[dw.settings.all.accent] ?? dw.settings.all.accent,
      };
    if (method === 'go') return void dw.goInTab(tab, str(payload, 1000));
    throw new Error('unknown method');
  });
}
