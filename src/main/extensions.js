import { dialog, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';
import { installChromeWebStore, uninstallExtension, updateExtensions } from 'electron-chrome-web-store';
import { JsonStore } from './store.js';
import { NEW_TAB_URL } from '../shared/url.js';

export class Integrations {
  constructor(dir, ses) {
    this.dir = dir; this.session = ses;
    this.store = new JsonStore(path.join(dir, 'integrations.json'), { extensionPaths: [] });
    this.errors = []; this.ready = null;
  }
  initialize(options) {
    this.options = options ?? this.options;
    return this.ready ??= this.setup();
  }
  async setup() {
    const windows = () => this.options.windows().filter(dw => !dw.ghost && !dw.win.isDestroyed());
    const owner = wc => windows().find(dw => dw.tabs.list().some(tab => tab.wc === wc));
    this.api = new ElectronChromeExtensions({
      session: this.session,
      createTab: async details => {
        const dw = windows().find(dw => dw.win.id === details.windowId) ?? windows()[0] ?? await this.options.openWindow();
        const tab = dw.tabs.create({ url: details.url || NEW_TAB_URL, active: details.active !== false, pinned: details.pinned === true, index: details.index });
        return [tab.wc, dw.win];
      },
      selectTab: wc => { const dw = owner(wc); const tab = dw?.tabs.list().find(tab => tab.wc === wc); if (tab) dw.tabs.activate(tab.id); },
      removeTab: wc => { const dw = owner(wc); const tab = dw?.tabs.list().find(tab => tab.wc === wc); if (tab) dw.tabs.close(tab.id); },
      createWindow: async details => {
        if (details.incognito) throw new Error('Extensions cannot open Ghost Mode.');
        const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : [];
        return (await this.options.openWindow({ urls })).win;
      },
      removeWindow: win => win.close(),
      assignTabDetails: (details, wc) => { const dw = owner(wc), tab = dw?.tabs.list().find(tab => tab.wc === wc); if (tab) { details.pinned = tab.pinned; details.index = dw.tabs.list().indexOf(tab); } },
      requestPermissions: async (extension, permissions) => this.confirm(windows()[0]?.win, extension.name, permissions),
    });
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
    await installChromeWebStore({ session: this.session, extensionsPath: path.join(this.dir, 'Extensions'), autoUpdate: process.env.DREAM_TEST !== '1', beforeInstall: async details => {
      if (new URL(details.frame.url).origin !== 'https://chromewebstore.google.com') return { action: 'deny' };
      const allowed = await this.confirm(details.browserWindow ?? windows()[0]?.win, details.localizedName, details.manifest);
      return { action: allowed ? 'allow' : 'deny' };
    } });
    for (const folder of Array.isArray(this.store.data.extensionPaths) ? this.store.data.extensionPaths : []) {
      try { await this.session.extensions.loadExtension(folder); } catch { this.errors.push('An installed extension could not be restored. Remove it and install it again.'); }
    }
  }
  async confirm(win, name, manifest) {
    const permissions = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? manifest.origins ?? [])].slice(0, 40);
    const result = await dialog.showMessageBox(win, { type: 'question', title: 'Add to DREAM', message: `Add ${String(name).slice(0, 150)}?`, detail: `This extension requests:\n\n${permissions.join('\n') || 'No additional permissions.'}\n\nOnly add extensions you trust.`, buttons: ['Cancel', 'Add extension'], defaultId: 0, cancelId: 0 });
    return result.response === 1;
  }
  track(dw, tab) { if (!dw.ghost && this.api) this.api.addTab(tab.wc, dw.win); }
  select(dw, tab) { if (!dw.ghost && this.api) this.api.selectTab(tab.wc); }
  untrack(dw, tab) { if (!dw.ghost && this.api) this.api.removeTab(tab.wc); }
  status() {
    return { webStore: true, extensions: this.session.extensions.getAllExtensions().map(extension => {
      const manifest = extension.manifest;
      return { id: extension.id, name: extension.name, version: extension.version, description: manifest.description ?? '', options: !!(manifest.options_page || manifest.options_ui?.page), permissions: [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])], fromStore: extension.path.startsWith(path.join(this.dir, 'Extensions') + path.sep) };
    }), errors: this.errors };
  }
  async installExtension(win) {
    const selected = await dialog.showOpenDialog(win, { title: 'Select an unpacked extension folder', properties: ['openDirectory'] });
    if (selected.canceled) return this.status();
    const folder = selected.filePaths[0], manifestFile = path.join(folder, 'manifest.json');
    if (!fs.existsSync(manifestFile) || fs.statSync(manifestFile).size > 1_000_000) throw new Error('Select a folder containing a valid manifest.json.');
    let manifest; try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { throw new Error('The extension manifest is invalid.'); }
    if (!await this.confirm(win, manifest.name, manifest)) return this.status();
    await this.session.extensions.loadExtension(folder);
    this.store.data.extensionPaths = [...new Set([...this.store.data.extensionPaths, folder])]; this.store.touch(); this.store.flush();
    return this.status();
  }
  async removeExtension(id) {
    const extension = this.session.extensions.getExtension(id);
    if (extension) {
      if (extension.path.startsWith(path.join(this.dir, 'Extensions') + path.sep)) await uninstallExtension(id, { session: this.session, extensionsPath: path.join(this.dir, 'Extensions') });
      else this.session.extensions.removeExtension(id);
      this.store.data.extensionPaths = this.store.data.extensionPaths.filter(folder => folder !== extension.path); this.store.touch(); this.store.flush();
    }
    return this.status();
  }
  optionsPage(id) {
    const extension = this.session.extensions.getExtension(id);
    const page = extension?.manifest.options_ui?.page ?? extension?.manifest.options_page;
    if (!page) throw new Error('This extension has no settings page.');
    const url = new URL(page, `chrome-extension://${id}/`);
    if (url.protocol !== 'chrome-extension:' || url.hostname !== id) throw new Error('The extension settings address is invalid.');
    return url.href;
  }
  async update() { await updateExtensions(this.session); return this.status(); }
  flush() { this.store.flush(); }
}
