import { BrowserWindow, nativeTheme, clipboard } from 'electron';
import path from 'node:path';
import { NEW_TAB_URL, resolveInput } from '../shared/url.js';
import { THEME_COLORS, layoutMetrics } from '../shared/theme.js';
import { ACCENTS } from './settings.js';
import { TabManager } from './tabs.js';
import { Overlay } from './overlay.js';
import { uiWebPreferences } from './security.js';
import { commandForInput } from './shortcuts.js';
import { buildSuggestions } from './omnibox.js';
import { toSpec, tabMenu, appMenu, pageMenu } from './menus.js';

const isMac = process.platform === 'darwin';
const SUGGESTION_ROW = 38;
const SUGGESTION_PAD = 8;

const palette = () => THEME_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];

/** One browser window: the toolbar renderer, the page views, and the overlay, plus the commands that tie them together. */
export class DreamWindow {
  constructor({ settings, bookmarks, history, sessionStore, tabSession, preloads, ghost = false, assistant, integrations, openGhost }) {
    Object.assign(this, { ghost, assistant, integrations, openGhost });
    this.settings = settings;
    this.bookmarks = bookmarks;
    this.history = history;
    this.sessionStore = sessionStore;
    this.anchors = {};
    this.omni = { text: '', suggestions: [], selected: 0 };
    this.broadcastQueued = false;

    const metrics = layoutMetrics(settings.all);
    const colors = palette();
    this.win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: 'DREAM',
      backgroundColor: colors.chrome,
      titleBarStyle: 'hidden',
      ...(isMac
        ? { trafficLightPosition: { x: 16, y: Math.round((metrics.titleBarHeight - 14) / 2) } }
        : { titleBarOverlay: { color: colors.chrome, symbolColor: colors.symbol, height: metrics.titleBarHeight } }),
      webPreferences: uiWebPreferences(preloads.chrome),
    });
    this.win.setMenuBarVisibility(false);

    this.overlay = new Overlay(this.win, {
      preload: preloads.chrome,
      onClosed: (hadFocus) => {
        if (hadFocus) this.focusPage();
      },
    });

    this.tabs = new TabManager({
      win: this.win,
      session: tabSession,
      ghost,
      preload: preloads.newtab,
      history: { visit: (url, title) => settings.all.saveHistory && history.visit(url, title), setTitle: (url, title) => settings.all.saveHistory && history.setTitle(url, title) },
      onChange: () => this.#tabsChanged(),
      onInput: (e, input) => this.onInput(e, input),
      onPageFocus: () => this.onPageFocus(),
      onPageContextMenu: (tab, p) => this.#pageContextMenu(tab, p),
    });
    this.tabs.onViewAdded = tab => { this.overlay.raise(); integrations.track(this, tab); };
    this.tabs.onTabActivated = tab => integrations.select(this, tab);
    this.tabs.onTabRemoved = tab => integrations.untrack(this, tab);
    this.tabs.setRadius(metrics.pageRadius);

    this.win.webContents.on('before-input-event', (e, input) => this.onInput(e, input));
    this.overlay.webContents.on('before-input-event', (e, input) => this.onInput(e, input));
    this.win.on('resize', () => this.overlay.hide());
    this.win.on('blur', () => this.#windowBlurred());
    for (const ev of ['focus', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'])
      this.win.on(ev, () => this.broadcast());

    settings.onChange(() => this.#settingsChanged());
    bookmarks.onChange(() => this.broadcast());
    nativeTheme.on('updated', () => this.#applyChromeColors());
    for (const wc of [this.win.webContents, this.overlay.webContents]) {
      wc.on('will-navigate', e => e.preventDefault());
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    tabSession.on('will-download', (event, item) => {
      if (this.ghost) { event.preventDefault(); return; }
      item.once('done', (_e, status) => {
        if (!this.win.isDestroyed()) this.win.webContents.send('ui:notice', status === 'completed' ? 'Download saved.' : `Download ${status}.`);
      });
    });
  }

  /** Load the UI and restore (or start) the session. Resolves when the window is shown. */
  async start() {
    const ready = new Promise((resolve) => this.win.once('ready-to-show', resolve));
    this.win.loadURL('dream://ui/renderer/index.html');
    this.#restoreSession();
    if (process.env.DREAM_TEST === '1') console.info('[DREAM test] session restored');
    await ready;
    if (process.env.DREAM_TEST !== '1') this.win.show();
    if (this.tabs.active?.url === NEW_TAB_URL) this.focusOmnibox();
  }

  #restoreSession() {
    const saved = this.settings.all.restoreSession ? this.sessionStore.data : null;
    const entries = saved?.tabs?.length ? saved.tabs : null;
    if (!entries) return void this.tabs.create();
    entries.forEach((t, i) => {
      const active = i === saved.active;
      this.tabs.create({ url: t.url, title: t.title, pinned: t.pinned, active, lazy: !active, index: i });
    });
  }

  // ---- state -------------------------------------------------------------------------------

  snapshot() {
    const active = this.tabs.active;
    const s = this.settings.all;
    return {
      platform: process.platform,
      ghost: this.ghost,
      effectiveTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      settings: s,
      accents: ACCENTS,
      metrics: layoutMetrics(s),
      tabs: this.tabs.list().map((t) => t.info()),
      activeId: this.tabs.activeId,
      activeWebContentsId: active?.wc.id,
      bookmarks: this.bookmarks.items,
      activeBookmarked: !!(active && this.bookmarks.find(active.url)),
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      focused: this.win.isFocused(),
    };
  }

  /** Coalesce bursts of changes into one snapshot per tick. */
  broadcast() {
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.broadcastQueued = false;
      if (this.win.isDestroyed()) return;
      const s = this.snapshot();
      this.win.webContents.send('state', s);
      this.overlay.webContents.send('state', s);
    });
  }

  #tabsChanged() {
    const a = this.tabs.active;
    if (a && !this.win.isDestroyed()) this.win.setTitle(a.title ? `${a.title} — DREAM` : 'DREAM');
    this.sessionStore.data = this.tabs.sessionData();
    this.sessionStore.touch();
    this.broadcast();
  }

  #settingsChanged() {
    const m = layoutMetrics(this.settings.all);
    nativeTheme.themeSource = this.settings.all.theme;
    this.tabs.setRadius(m.pageRadius);
    this.#applyChromeColors();
    this.broadcast();
  }

  #applyChromeColors() {
    if (this.win.isDestroyed()) return;
    const m = layoutMetrics(this.settings.all);
    const c = palette();
    this.win.setBackgroundColor(c.chrome);
    if (isMac) this.win.setWindowButtonPosition({ x: 16, y: Math.round((m.titleBarHeight - 14) / 2) });
    else this.win.setTitleBarOverlay({ color: c.chrome, symbolColor: c.symbol, height: m.titleBarHeight });
  }

  // ---- commands ----------------------------------------------------------------------------

  onInput(event, input) {
    const cmd = commandForInput(input);
    if (!cmd) return;
    event.preventDefault();
    this.run(cmd);
  }

  run(cmd) {
    const t = this.tabs;
    switch (cmd) {
      case 'tab-new': return this.newTab();
      case 'tab-close': return t.active && t.close(t.activeId);
      case 'tab-reopen': return t.reopenClosed();
      case 'tab-next': return t.cycle(1);
      case 'tab-prev': return t.cycle(-1);
      case 'focus-omnibox': return this.focusOmnibox();
      case 'reload': return t.active?.wc.reload();
      case 'reload-hard': return t.active?.wc.reloadIgnoringCache();
      case 'back': return t.active?.wc.navigationHistory.canGoBack() && t.active.wc.navigationHistory.goBack();
      case 'forward': return t.active?.wc.navigationHistory.canGoForward() && t.active.wc.navigationHistory.goForward();
      case 'ghost-new': return this.openGhost();
      case 'bookmark-toggle': return this.toggleBookmark();
      case 'bookmarks-show': return this.showBookmarks();
      case 'customize-show': return this.showCustomize();
      case 'sidebar-toggle': return this.settings.update({ sidebarVisible: !this.settings.all.sidebarVisible });
      case 'zoom-in': return t.zoom(1);
      case 'zoom-out': return t.zoom(-1);
      case 'zoom-reset': return t.zoom(0);
      case 'devtools': return this.devtools();
      case 'fullscreen': return this.win.setFullScreen(!this.win.isFullScreen());
      case 'quit': return this.win.close();
      default: {
        const m = /^tab-select-(\d)$/.exec(cmd);
        if (m) t.selectNumber(Number(m[1]));
      }
    }
  }

  newTab(url = NEW_TAB_URL) {
    const tab = this.tabs.create({ url });
    if (url === NEW_TAB_URL) this.focusOmnibox();
    return tab;
  }

  focusOmnibox() {
    this.overlay.hide();
    this.win.webContents.focus();
    this.win.webContents.send('ui:focus-omnibox');
  }

  focusPage() {
    this.tabs.active?.wc.focus();
  }

  /** Navigate the active tab from typed text. */
  go(text) {
    const url = resolveInput(text, this.settings.all.searchEngine).url;
    this.#closeOmnibox();
    this.tabs.navigate(url);
    this.focusPage();
  }

  /** Navigate a specific tab (used by the new-tab page's own search box). */
  goInTab(tab, text) {
    tab.load(resolveInput(text, this.settings.all.searchEngine).url);
  }

  openSearch(text, opener) {
    const { url } = resolveInput(String(text).trim().slice(0, 500) + ' ', this.settings.all.searchEngine);
    this.tabs.create({ url, opener, active: true });
  }

  copyText(text) {
    clipboard.writeText(String(text));
  }

  devtools(x, y) {
    const wc = this.tabs.active?.wc;
    if (!wc) return;
    if (x !== undefined) wc.inspectElement(x, y);
    else wc.toggleDevTools();
  }

  toggleBookmark() {
    const tab = this.tabs.active;
    if (!tab) return;
    let item = this.bookmarks.find(tab.url);
    if (!item) item = this.bookmarks.add(tab.url, tab.title);
    if (!item) return; // internal pages can't be bookmarked
    this.#showBookmarkPopover(item.id);
  }

  #showBookmarkPopover(id) {
    const item = this.bookmarks.items.find((b) => b.id === id);
    if (!item) return;
    this.overlay.show({
      kind: 'bookmark',
      focus: true,
      data: { id: item.id, title: item.title, url: item.url, anchor: this.anchors.star },
      handler: (action, value) => {
        if (action === 'rename') this.bookmarks.rename(id, String(value ?? '').slice(0, 300));
        if (action === 'remove') this.bookmarks.remove(id);
        if (action === 'done' || action === 'remove') this.overlay.hide();
      },
    });
  }

  showBookmarks() {
    this.overlay.show({
      kind: 'bookmarks',
      focus: true,
      data: { anchor: this.anchors.bookmarks ?? this.anchors.menu },
      handler: (action, value) => {
        if (action === 'open') {
          const b = this.bookmarks.items.find((x) => x.id === value?.id);
          if (!b) return;
          this.overlay.hide();
          if (value.newTab) this.tabs.create({ url: b.url });
          else this.tabs.navigate(b.url);
        } else if (action === 'remove') this.bookmarks.remove(String(value?.id));
      },
    });
  }

  showCustomize() {
    this.overlay.show({
      kind: 'customize',
      focus: true,
      data: { anchor: this.anchors.customize },
      handler: (action, value) => {
        if (action === 'set') this.settings.update(value);
        else if (action === 'reset') this.settings.reset();
      },
    });
  }

  showMenu() {
    this.#showMenu(appMenu(this), this.anchors.menu, 'bottom-end');
  }

  showAssistant() {
    if (this.ghost) throw new Error('DREAM AI is disabled in Ghost Mode.');
    this.overlay.show({ kind: 'assistant', focus: true, data: { status: this.assistant.status() } });
  }

  showIntegrations() {
    if (this.ghost) throw new Error('Extensions are disabled in Ghost Mode.');
    this.overlay.show({ kind: 'integrations', focus: true, data: this.integrations.status() });
  }

  showTabMenu(tabId, x, y) {
    const tab = this.tabs.get(tabId);
    if (tab) this.#showMenu(tabMenu(this, tab), { x, y, width: 0, height: 0 }, 'cursor');
  }

  #pageContextMenu(tab, params) {
    if (tab !== this.tabs.active) return;
    const b = tab.view.getBounds();
    this.#showMenu(pageMenu(this, tab, params), { x: b.x + params.x, y: b.y + params.y, width: 0, height: 0 }, 'cursor');
  }

  #showMenu(defs, anchor, placement) {
    const { items, handler } = toSpec(defs);
    this.overlay.show({
      kind: 'menu',
      focus: true,
      data: { items, anchor, placement },
      handler: (_id, value) => {
        this.overlay.hide();
        // run after the overlay starts closing so focus handoff is not fought over
        setTimeout(() => handler(value), 0);
      },
    });
  }

  // ---- omnibox -----------------------------------------------------------------------------

  omniboxQuery(text) {
    const anchor = this.anchors.omnibox;
    const suggestions = anchor
      ? buildSuggestions(text, {
          bookmarks: this.bookmarks.items,
          history: this.history.entries,
          searchEngine: this.settings.all.searchEngine,
        })
      : [];
    this.omni = { text, suggestions, selected: 0 };
    if (suggestions.length === 0) return this.#closeOmnibox();
    const bounds = {
      x: Math.round(anchor.x),
      y: Math.round(anchor.y + anchor.height + 6),
      width: Math.round(anchor.width),
      height: suggestions.length * SUGGESTION_ROW + SUGGESTION_PAD * 2,
    };
    const data = { suggestions, selected: 0 };
    if (this.overlay.kind === 'omnibox') this.overlay.update(data, bounds);
    else
      this.overlay.show({
        kind: 'omnibox',
        bounds,
        data,
        handler: (_id, value) => {
          const s = this.omni.suggestions[Number(value)];
          if (s) this.go(s.url);
        },
      });
  }

  omniboxMove(delta) {
    const n = this.omni.suggestions.length;
    if (!n || this.overlay.kind !== 'omnibox') return;
    this.omni.selected = (this.omni.selected + delta + n) % n;
    this.overlay.update({ suggestions: this.omni.suggestions, selected: this.omni.selected });
  }

  omniboxSubmit(text) {
    const picked = this.overlay.kind === 'omnibox' ? this.omni.suggestions[this.omni.selected] : null;
    this.go(picked && this.omni.selected > 0 ? picked.url : text);
  }

  #closeOmnibox() {
    this.omni = { text: '', suggestions: [], selected: 0 };
    if (this.overlay.kind === 'omnibox') this.overlay.hide();
  }

  omniboxDismiss() {
    this.#closeOmnibox();
  }

  onPageFocus() {
    if (this.overlay.kind === 'omnibox') this.#closeOmnibox();
  }

  #windowBlurred() {
    if (this.overlay.current) this.overlay.hide();
    this.broadcast();
  }

  setAnchors(map) {
    this.anchors = map;
  }
}
