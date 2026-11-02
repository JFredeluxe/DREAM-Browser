const isMac = process.platform === 'darwin';

/**
 * Translate a key event into a browser command name, or null. Pure; unit-tested.
 * `mod` is Cmd on macOS and Ctrl elsewhere.
 */
export function commandForInput(input, platform = process.platform) {
  if (input.type !== 'keyDown') return null;
  const mac = platform === 'darwin';
  const mod = mac ? input.meta : input.control;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const { shift, alt } = input;

  if (input.control && !mac && key === 'Tab') return shift ? 'tab-prev' : 'tab-next';
  if (input.control && mac && key === 'Tab') return shift ? 'tab-prev' : 'tab-next';

  if (mod && !alt) {
    if (shift && key === 'j') return 'assistant-show';
    if (key === 'n' && shift) return 'ghost-new';
    if (key === 't') return shift ? 'tab-reopen' : 'tab-new';
    if (key === 'w') return 'tab-close';
    if (key === 'l' || key === 'k') return 'focus-omnibox';
    if (key === 'r') return shift ? 'reload-hard' : 'reload';
    if (key === 'd') return 'bookmark-toggle';
    if (key === 'o' && shift) return 'bookmarks-show';
    if (key === '\\') return 'sidebar-toggle';
    if (key === ',') return 'customize-show';
    if (key === '[') return 'back';
    if (key === ']') return 'forward';
    if (key === '=' || key === '+') return 'zoom-in';
    if (key === '-' || key === '_') return 'zoom-out';
    if (key === '0') return 'zoom-reset';
    if (/^[1-9]$/.test(key) && !shift) return `tab-select-${key}`;
    if (shift && key === 'i') return 'devtools';
    if (mac && key === 'q') return 'quit';
  }
  if (alt && !mod && !shift) {
    if (key === 'ArrowLeft') return 'back';
    if (key === 'ArrowRight') return 'forward';
  }
  if (key === 'F5') return input.control ? 'reload-hard' : 'reload';
  if (key === 'F12') return 'devtools';
  if (key === 'F11') return 'fullscreen';
  return null;
}

export const accel = (text) => (isMac ? `⌘${text}` : `Ctrl+${text}`);
