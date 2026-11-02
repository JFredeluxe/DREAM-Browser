import { WebContentsView } from 'electron';
import { uiWebPreferences } from './security.js';

const HIDE_FALLBACK_MS = 220;

/**
 * A transparent view stacked above the page views. Menus, popovers and the omnibox dropdown
 * render here, because native page views would otherwise draw over any HTML in the toolbar window.
 *
 * "modal" overlays cover the whole window (a click outside dismisses them);
 * "panel" overlays are sized to just their content so the toolbar and page stay interactive.
 */
export class Overlay {
  constructor(win, { preload, onClosed }) {
    this.win = win;
    this.onClosed = onClosed;
    this.view = new WebContentsView({ webPreferences: uiWebPreferences(preload) });
    this.view.setBackgroundColor('#00000000');
    this.view.setVisible(false);
    win.contentView.addChildView(this.view);
    this.view.webContents.loadURL('dream://ui/renderer/overlay.html');
    this.current = null;
    this.token = 0;
    this.hideTimer = null;
  }

  get webContents() {
    return this.view.webContents;
  }

  get kind() {
    return this.current?.kind ?? null;
  }

  /** @param {{kind:string, data?:object, bounds?:Electron.Rectangle, focus?:boolean, handler?:(id:string,value:any)=>void}} spec */
  show({ kind, data = {}, bounds, focus = false, handler }) {
    clearTimeout(this.hideTimer);
    const [width, height] = this.win.getContentSize();
    this.current = { kind, handler, token: ++this.token, panel: !!bounds };
    this.view.setBounds(bounds ?? { x: 0, y: 0, width, height });
    this.view.setVisible(true);
    this.raise();
    this.#send('overlay:show', { token: this.current.token, kind, data, origin: bounds ? { x: bounds.x, y: bounds.y } : { x: 0, y: 0 } });
    if (focus) this.webContents.focus();
  }

  /** Same overlay, new content (e.g. new omnibox suggestions). */
  update(data, bounds) {
    if (!this.current) return;
    if (bounds) this.view.setBounds(bounds);
    this.#send('overlay:update', { token: this.current.token, data });
  }

  raise() {
    this.win.contentView.addChildView(this.view); // re-adding moves it to the top
  }

  hide() {
    if (!this.current) return;
    const { token } = this.current;
    this.#send('overlay:hide', { token });
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.finish(token), HIDE_FALLBACK_MS);
  }

  /** Called when the renderer finished its exit animation (or the fallback timer fires). */
  finish(token) {
    if (!this.current || this.current.token !== token) return;
    clearTimeout(this.hideTimer);
    const hadFocus = this.webContents.isFocused();
    this.current = null;
    this.view.setVisible(false);
    this.onClosed?.(hadFocus);
  }

  action(token, id, value) {
    if (this.current?.token !== token) return;
    this.current.handler?.(id, value);
  }

  #send(channel, payload) {
    if (!this.webContents.isDestroyed()) this.webContents.send(channel, payload);
  }
}
