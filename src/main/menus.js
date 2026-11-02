import { SEARCH_ENGINES } from '../shared/url.js';
import { accel } from './shortcuts.js';

/**
 * Menu definitions. Each entry: { label, hint?, run?, disabled?, checked?, danger? } or { separator: true }.
 * `toSpec` turns them into plain data for the overlay renderer plus an action handler keyed by index.
 */
export function toSpec(defs) {
  const items = defs.map((d, i) =>
    d.separator
      ? { separator: true }
      : { id: String(i), label: d.label, hint: d.hint, disabled: !!d.disabled, checked: d.checked, danger: !!d.danger },
  );
  const handler = (id) => {
    const d = defs[Number(id)];
    if (d && !d.disabled && !d.separator) d.run?.();
  };
  return { items, handler };
}

const SEP = { separator: true };

export function tabMenu(dw, tab) {
  const tabs = dw.tabs.list();
  const i = tabs.indexOf(tab);
  return [
    { label: 'New Tab', hint: accel('T'), run: () => dw.newTab() },
    SEP,
    { label: 'Reload', hint: accel('R'), run: () => tab.wc.reload() },
    { label: 'Duplicate', run: () => dw.tabs.create({ url: tab.url, index: i + 1 }) },
    { label: tab.pinned ? 'Unpin Tab' : 'Pin Tab', run: () => dw.tabs.setPinned(tab.id, !tab.pinned) },
    SEP,
    { label: 'Close Tab', hint: accel('W'), run: () => dw.tabs.close(tab.id) },
    { label: 'Close Other Tabs', disabled: tabs.length < 2, run: () => tabs.filter((t) => t !== tab && !t.pinned).forEach((t) => dw.tabs.close(t.id)) },
    { label: 'Close Tabs Below', disabled: i === tabs.length - 1, run: () => tabs.slice(i + 1).filter((t) => !t.pinned).forEach((t) => dw.tabs.close(t.id)) },
    { label: 'Reopen Closed Tab', hint: accel('Shift+T'),disabled: dw.tabs.closed.length === 0, run: () => dw.tabs.reopenClosed() },
  ];
}

export function appMenu(dw) {
  return [
    { label: 'New Tab', hint: accel('T'), run: () => dw.newTab() },
    { label: 'Reopen Closed Tab', disabled: dw.tabs.closed.length === 0, run: () => dw.tabs.reopenClosed() },
    { label: 'New Ghost Window', hint: accel('Shift+N'), run: () => dw.openGhost() },
    { label: 'Assistant', disabled: dw.ghost, run: () => dw.showAssistant() },
    { label: 'Extensions', disabled: dw.ghost, run: () => dw.showIntegrations() },
    SEP,
    { label: 'Bookmarks', hint: accel('Shift+O'), run: () => dw.showBookmarks() },
    { label: 'Customize DREAM…', hint: accel(','), run: () => dw.showCustomize() },
    SEP,
    { label: 'Zoom In', hint: accel('+'), run: () => dw.tabs.zoom(1) },
    { label: 'Zoom Out', hint: accel('−'), run: () => dw.tabs.zoom(-1) },
    { label: 'Actual Size', hint: accel('0'), run: () => dw.tabs.zoom(0) },
    SEP,
    { label: 'Developer Tools', hint: 'F12', run: () => dw.devtools() },
    { label: 'Clear Browsing History', run: () => dw.history.clear() },
  ];
}

export function pageMenu(dw, tab, p) {
  const wc = tab.wc;
  const defs = [];
  const engine = dw.settings.all.searchEngine;
  const push = (...d) => defs.push(...d);

  if (p.linkURL) {
    push(
      { label: 'Open Link in New Tab', run: () => dw.tabs.create({ url: p.linkURL, opener: tab, active: false }) },
      { label: 'Copy Link Address', run: () => dw.copyText(p.linkURL) },
      SEP,
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    push(
      { label: 'Open Image in New Tab', run: () => dw.tabs.create({ url: p.srcURL, opener: tab, active: false }) },
      { label: 'Copy Image', run: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Copy Image Address', run: () => dw.copyText(p.srcURL) },
      SEP,
    );
  }
  if (p.isEditable) {
    const f = p.editFlags;
    push(
      { label: 'Cut', hint: accel('X'), disabled: !f.canCut, run: () => wc.cut() },
      { label: 'Copy', hint: accel('C'), disabled: !f.canCopy, run: () => wc.copy() },
      { label: 'Paste', hint: accel('V'), disabled: !f.canPaste, run: () => wc.paste() },
      { label: 'Select All', hint: accel('A'), run: () => wc.selectAll() },
      SEP,
    );
  } else if (p.selectionText) {
    const short = p.selectionText.trim().slice(0, 28) + (p.selectionText.trim().length > 28 ? '…' : '');
    push(
      { label: 'Copy', hint: accel('C'), run: () => wc.copy() },
      { label: `Search ${SEARCH_ENGINES[engine].name} for “${short}”`, run: () => dw.openSearch(p.selectionText, tab) },
      SEP,
    );
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText) {
    const nav = wc.navigationHistory;
    push(
      { label: 'Back', hint: 'Alt+←', disabled: !nav.canGoBack(), run: () => nav.goBack() },
      { label: 'Forward', hint: 'Alt+→', disabled: !nav.canGoForward(), run: () => nav.goForward() },
      { label: 'Reload', hint: accel('R'), run: () => wc.reload() },
      SEP,
    );
  }
  push({ label: 'Inspect', hint: 'F12', run: () => dw.devtools(p.x, p.y) });
  return defs;
}
