'use strict';
// Preload for DREAM's own UI (toolbar window + overlay). Exposes a minimal RPC surface;
// the main process validates the sender and every argument.
const { contextBridge, ipcRenderer } = require('electron');
require('electron-chrome-extensions/browser-action').injectBrowserAction();

const EVENTS = new Set(['state', 'ui:notice', 'ui:focus-omnibox', 'overlay:show', 'overlay:update', 'overlay:hide', 'assistant:chunk', 'assistant:route']);

contextBridge.exposeInMainWorld('dream', {
  call: (method, payload) => ipcRenderer.invoke('rpc', String(method), payload),
  on: (event, callback) => {
    if (!EVENTS.has(event)) throw new Error(`unknown event ${event}`);
    const listener = (_e, data) => callback(data);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
