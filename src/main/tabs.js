import { WebContentsView } from 'electron';
import { NEW_TAB_URL, isWebNavigable, hostLabel, displayUrl } from '../shared/url.js';
import { tabWebPreferences } from './security.js';

export const ERROR_PAGE = 'dream://newtab/error.html';
const MAX_CLOSED = 25;
const ZOOM_STEP = 0.5;

let nextId = 1;

export class Tab {
  constructor(mgr, { view, url, pinned = false, lazy = false, title = '' }) {
    this.mgr = mgr;
    this.id = `t${nextId++}`;
    this.view = view;
    this.wc = view.webContents;
    this.url = url;
    this.title = title;
    this.favicon = null;
    this.loading = false;
    this.pinned = pinned;
    this.crashed = false;
    this.errorFor = null;
    this.pendingUrl = lazy ? url : null; // restored tabs load on first activation
    this.#wire();
  }

  info() {
    const nav = this.wc.navigationHistory;
    return {
      id: this.id,
      title: this.title || (this.url === NEW_TAB_URL ? 'New Tab' : hostLabel(this.url)),
      url: this.url,
      displayUrl: displayUrl(this.url),
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: !this.pendingUrl && nav.canGoBack(),
      canGoForward: !this.pendingUrl && nav.canGoForward(),
      pinned: this.pinned,
      crashed: this.crashed,
    };
  }

  load(url) {
    if (!this.mgr.allowed(url)) return;
    this.pendingUrl = null;
    this.url = url;
    this.errorFor = null;
    this.wc.loadURL(url).catch(() => {
      /* failures are reported through did-fail-load */
    });
    this.mgr.changed();
  }

  ensureLoaded() {
    if (this.pendingUrl) this.load(this.pendingUrl);
  }

  #wire() {
    const wc = this.wc;
    const mgr = this.mgr;

    wc.on('page-title-updated', (_e, title) => {
      if (this.pendingUrl) return;
      this.title = title;
      mgr.history.setTitle(this.url, title);
      mgr.changed();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicon = favicons.find((f) => /^https?:|^data:image/.test(f)) ?? null;
      mgr.changed();
    });
    wc.on('did-start-loading', () => {
      this.loading = true;
      mgr.changed();
    });
    wc.on('did-stop-loading', () => {
      this.loading = false;
      mgr.changed();
    });
    wc.on('did-navigate', (_e, url) => this.#navigated(url));
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && this.#navigated(url));
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED */ || failedUrl.startsWith(ERROR_PAGE)) return;
      this.errorFor = failedUrl;
      this.url = failedUrl;
      const q = new URLSearchParams({ url: failedUrl, code: String(code), desc });
      wc.loadURL(`${ERROR_PAGE}?${q}`).catch(() => {});
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      this.crashed = true;
      this.loading = false;
      mgr.changed();
    });
    wc.on('focus', () => mgr.onPageFocus(this));
    wc.on('before-input-event', (event, input) => mgr.onInput(event, input));
    wc.on('enter-html-full-screen', () => mgr.setHtmlFullscreen(true));
    wc.on('leave-html-full-screen', () => mgr.setHtmlFullscreen(false));
    wc.on('context-menu', (_e, params) => mgr.onPageContextMenu(this, params));

    // Navigation guards: pages can only navigate to the web; internal pages are reachable only from internal pages.
    const guard = (event, url) => {
      if (mgr.allowed(url)) return;
      event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler((details) => {
      if (!mgr.allowed(details.url)) return { action: 'deny' };
      return {
        action: 'allow',
        // Keep the opener relationship (window.opener, OAuth popups) while presenting the popup as a tab.
        createWindow: (options) => mgr.createFromOpener(this, details, options),
      };
    });
  }

  #navigated(url) {
    if (this.pendingUrl) return;
    if (url.startsWith(ERROR_PAGE)) return; // keep showing the URL that failed
    this.url = url;
    this.errorFor = null;
    this.crashed = false;
    this.mgr.history.visit(url, this.title);
    this.mgr.changed();
  }
}

export class TabManager {
  /**
   * @param {object} deps { win, session, preload, history, onChange, onInput, onPageFocus, onPageContextMenu }
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.tabs = [];
    this.activeId = null;
    this.closed = [];
    this.contentRect = { x: 0, y: 0, width: 800, height: 600 };
    this.radius = 0;
    this.htmlFullscreen = false;
    this.win.on('resize', () => this.layout());
  }

  list() {
    return this.tabs;
  }
  get(id) {
    return this.tabs.find((t) => t.id === id);
  }
  get active() {
    return this.get(this.activeId);
  }

  changed() {
    this.onChange?.();
  }

  allowed(url) {
    if (isWebNavigable(url) || url === NEW_TAB_URL) return true;
    try { const parsed = new URL(url); return !this.ghost && parsed.protocol === 'chrome-extension:' && !!this.session.extensions.getExtension(parsed.hostname); } catch { return false; }
  }

  create({ url = NEW_TAB_URL, active = true, index, pinned = false, lazy = false, opener = null, title = '' } = {}) {
    if (!this.allowed(url)) url = NEW_TAB_URL;
    const view = new WebContentsView({ webPreferences: tabWebPreferences(this.session, this.preload) });
    const tab = this.#adopt(view, { url, active, index, pinned, lazy, opener, title, load: !lazy });
    if (lazy && !active) view.webContents.loadURL('about:blank').catch(() => {});
    return tab;
  }

  /** window.open / target=_blank: the new tab owns the webContents Electron asked us to create. */
  createFromOpener(opener, details, options) {
    const view = new WebContentsView({
      webPreferences: { ...options.webPreferences, ...tabWebPreferences(this.session, this.preload) },
    });
    const background = details.disposition === 'background-tab';
    this.#adopt(view, { url: details.url, active: !background, opener, load: false });
    return view.webContents;
  }

  #adopt(view, { url, active, index, pinned, lazy, opener, title, load }) {
    const tab = new Tab(this, { view, url, pinned, lazy, title });
    view.setVisible(false);
    view.setBorderRadius(this.radius);
    this.win.contentView.addChildView(view);
    let at = index;
    if (at === undefined) {
      const o = opener ? this.tabs.indexOf(opener) : -1;
      at = o >= 0 ? o + 1 : this.tabs.length;
    }
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    at = pinned ? Math.min(at, pinnedCount) : Math.max(at, pinnedCount);
    this.tabs.splice(at, 0, tab);
    this.onViewAdded?.(tab);
    if (load) tab.load(url);
    if (active) this.activate(tab.id);
    this.changed();
    return tab;
  }

  activate(id, { focus = true } = {}) {
    const tab = this.get(id);
    if (!tab) return;
    const prev = this.active;
    if (prev && prev !== tab) prev.view.setVisible(false);
    this.activeId = id;
    this.onTabActivated?.(tab);
    tab.ensureLoaded();
    tab.view.setVisible(true);
    this.layout();
    if (focus) tab.wc.focus();
    this.changed();
  }

  close(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tab = this.tabs[i];
    if (tab.url !== NEW_TAB_URL && !tab.errorFor) {
      this.closed.push({ url: tab.url, title: tab.title, pinned: tab.pinned, index: i });
      if (this.closed.length > MAX_CLOSED) this.closed.shift();
    }
    this.tabs.splice(i, 1);
    this.onTabRemoved?.(tab);
    this.win.contentView.removeChildView(tab.view);
    tab.wc.close();
    if (this.activeId === id) {
      this.activeId = null;
      const next = this.tabs[i] ?? this.tabs[i - 1];
      if (next) this.activate(next.id);
    }
    this.changed();
    if (this.tabs.length === 0) this.win.close();
  }

  reopenClosed() {
    const c = this.closed.pop();
    if (c) this.create({ url: c.url, title: c.title, pinned: c.pinned, index: c.index });
  }

  move(id, toIndex) {
    const from = this.tabs.findIndex((t) => t.id === id);
    if (from < 0) return;
    const tab = this.tabs[from];
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    const lo = tab.pinned ? 0 : pinnedCount;
    const hi = tab.pinned ? pinnedCount - 1 : this.tabs.length - 1;
    const to = Math.max(lo, Math.min(hi, toIndex));
    if (to === from) return;
    this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, tab);
    this.changed();
  }

  setPinned(id, pinned) {
    const tab = this.get(id);
    if (!tab || tab.pinned === pinned) return;
    tab.pinned = pinned;
    const from = this.tabs.indexOf(tab);
    this.tabs.splice(from, 1);
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    this.tabs.splice(pinnedCount, 0, tab); // end of the pinned group, or start of the unpinned one
    this.changed();
  }

  /** delta +1/-1 cycles; wraps. */
  cycle(delta) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length].id);
  }

  /** Cmd/Ctrl+1..8 select by position, 9 selects the last tab. */
  selectNumber(n) {
    const tab = n === 9 ? this.tabs.at(-1) : this.tabs[n - 1];
    if (tab) this.activate(tab.id);
  }

  navigate(url) {
    this.active?.load(url);
  }

  zoom(delta) {
    const wc = this.active?.wc;
    if (!wc) return;
    wc.setZoomLevel(delta === 0 ? 0 : Math.max(-3, Math.min(5, wc.getZoomLevel() + delta * ZOOM_STEP)));
  }

  setContentRect(rect) {
    this.contentRect = rect;
    this.layout();
  }

  setRadius(radius) {
    this.radius = radius;
    for (const t of this.tabs) t.view.setBorderRadius(this.htmlFullscreen ? 0 : radius);
  }

  setHtmlFullscreen(on) {
    this.htmlFullscreen = on;
    this.win.setFullScreen(on);
    this.setRadius(this.radius);
    this.layout();
    this.changed();
  }

  layout() {
    const tab = this.active;
    if (!tab) return;
    if (this.htmlFullscreen) {
      const [width, height] = this.win.getContentSize();
      tab.view.setBounds({ x: 0, y: 0, width, height });
    } else {
      tab.view.setBounds(this.contentRect);
    }
  }

  sessionData() {
    return {
      tabs: this.tabs
        .filter((t) => isWebNavigable(t.url) || t.url === NEW_TAB_URL)
        .map((t) => ({ url: t.url, title: t.title, pinned: t.pinned })),
      active: Math.max(0, this.tabs.findIndex((t) => t.id === this.activeId)),
    };
  }
}
