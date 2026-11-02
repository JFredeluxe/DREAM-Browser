'use strict';
// Attached to every tab, but only does anything on DREAM's own new-tab page.
// Regular websites get no API at all.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'dream:' && location.hostname === 'newtab') {
  contextBridge.exposeInMainWorld('dreamNewTab', {
    info: () => ipcRenderer.invoke('newtab', 'info'),
    go: (text) => ipcRenderer.invoke('newtab', 'go', String(text)),
  });
}
