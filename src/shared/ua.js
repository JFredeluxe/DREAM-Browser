/** Present as a regular Chromium browser: drop the Electron and app tokens that make sites misbehave. */
export function cleanUserAgent(ua) {
  return ua
    .replace(/\sElectron\/\S+/i, '')
    .replace(/\s(?:dream-browser|DREAM)\/\S+/i, '')
    .trim();
}
