import { app, BrowserWindow, nativeTheme, session, Menu, dialog } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Settings } from './settings.js';
import { Bookmarks } from './bookmarks.js';
import { History } from './history.js';
import { JsonStore } from './store.js';
import { DreamWindow } from './window.js';
import { registerIpc } from './ipc.js';
import { registerPrivilegedSchemes, serveInternalPages } from './protocol.js';
import { hardenWebSession } from './security.js';
import { ghostStores } from './memory.js';
import { Assistant } from './ai.js';
import { Integrations } from './extensions.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const TEST = process.env.DREAM_TEST === '1';
registerPrivilegedSchemes();
app.setName('DREAM Browser');
if (process.platform === 'win32') app.setAppUserModelId('app.dream.browser');
if (process.env.DREAM_USER_DATA) app.setPath('userData', process.env.DREAM_USER_DATA);
const primary = TEST || app.requestSingleInstanceLock();
if (!primary) app.quit();
const windows = new Map();
let stores, normalSession, assistant, integrations;

async function openWindow({ ghost = false, urls = [] } = {}) {
  if (!ghost && !integrations.api) await integrations.initialize();
  if (TEST) console.info('[DREAM test] opening window', ghost);
  const tabSession = ghost ? session.fromPartition(`ghost-${randomUUID()}`, { cache: false }) : normalSession;
  const profile = ghost ? ghostStores(stores.settings.all) : stores;
  if (ghost) {
    hardenWebSession(tabSession);
    serveInternalPages(tabSession, { newtab: path.join(root, 'src/pages/newtab') });
  }
  const dw = new DreamWindow({ ...profile, tabSession, ghost, assistant, integrations, openGhost: () => openWindow({ ghost: true }),
    preloads: { chrome: path.join(root, 'src/preload/chrome.bundle.cjs'), newtab: path.join(root, 'src/preload/newtab.cjs') } });
  if (TEST) console.info('[DREAM test] window constructed');
  windows.set(dw.win.webContents.id, dw);
  const uiId = dw.win.webContents.id;
  dw.win.on('closed', () => {
    windows.delete(uiId); assistant.clear(uiId);
    for (const tab of dw.tabs.list()) if (!tab.wc.isDestroyed()) tab.wc.close({ waitForBeforeUnload: false });
    if (!dw.overlay.webContents.isDestroyed()) dw.overlay.webContents.close();
    if (ghost) { tabSession.clearStorageData().catch(() => {}); tabSession.clearCache().catch(() => {}); }
  });
  await dw.start();
  if (TEST) console.info('[DREAM test] window started');
  for (const url of urls) dw.newTab(url);
  if (TEST) { globalThis.__dream = [...windows.values()].find(w => !w.ghost); globalThis.__dreamWindows = windows; globalThis.__dreamAssistant = assistant; }
  return dw;
}

if (primary) app.whenReady().then(async () => {
  const dir = app.getPath('userData');
  stores = { settings: new Settings(dir), bookmarks: new Bookmarks(dir), history: new History(dir), sessionStore: new JsonStore(path.join(dir, 'session.json'), { tabs: [], active: 0 }) };
  nativeTheme.themeSource = stores.settings.all.theme;
  normalSession = session.fromPartition('persist:dream-main');
  hardenWebSession(normalSession);
  serveInternalPages(normalSession, { newtab: path.join(root, 'src/pages/newtab') });
  serveInternalPages(session.defaultSession, { ui: path.join(root, 'src') });
  assistant = new Assistant(dir);
  integrations = new Integrations(dir, normalSession);
  integrations.options = { windows: () => [...windows.values()], openWindow };
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  registerIpc(sender => [...windows.values()].find(dw => sender === dw.win.webContents || sender === dw.overlay.webContents || dw.tabs.list().some(t => t.wc === sender)));
  await openWindow({ ghost: process.argv.includes('--ghost'), urls: process.argv.filter(a => /^https?:\/\//i.test(a)) });
}).catch(error => { dialog.showErrorBox('DREAM could not start', error.message); app.quit(); });
app.on('second-instance', async (_event, argv) => {
  if (argv.includes('--ghost')) { await openWindow({ ghost: true }); return; }
  const dw = [...windows.values()].find(w => !w.ghost) ?? await openWindow();
  if (dw.win.isMinimized()) dw.win.restore(); dw.win.focus();
  for (const url of argv.filter(a => /^https?:\/\//i.test(a))) dw.newTab(url);
});
app.on('activate', () => { if (stores && BrowserWindow.getAllWindows().length === 0) openWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  if (stores) { for (const store of [...Object.values(stores), assistant, integrations]) store.flush(); }
});
