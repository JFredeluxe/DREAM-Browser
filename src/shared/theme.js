// Values the main process needs to know about the UI (native title-bar colours, layout metrics).
// The CSS tokens in src/renderer/css/tokens.css must agree; test/unit/theme.test.js enforces it.

export const THEME_COLORS = {
  light: { chrome: '#e9ebef', toolbar: '#f7f8fa', symbol: '#1c1d20' },
  dark: { chrome: '#18191c', toolbar: '#232428', symbol: '#ececee' },
};

export function layoutMetrics(settings) {
  const compact = settings.density === 'compact';
  const tabHeight = compact ? 34 : 40;
  const toolbarHeight = compact ? 38 : 44;
  return {
    tabHeight,
    toolbarHeight,
    sidebarWidth: 248,
    // the row that sits beside the native window controls
    titleBarHeight: settings.tabPosition === 'left' ? toolbarHeight : tabHeight,
    pageRadius: settings.tabPosition === 'left' ? 10 : 0,
  };
}
