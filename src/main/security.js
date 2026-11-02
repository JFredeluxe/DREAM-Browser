import { cleanUserAgent } from '../shared/ua.js';

// Everything not listed here is denied until a real permission-prompt UI exists (see docs/ROADMAP.md).
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

/** Locks down a session used for web content. */
export function hardenWebSession(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
}

/** webPreferences for every tab. No Node, sandboxed, isolated; only the new-tab preload is attached. */
export function tabWebPreferences(ses, preload) {
  return {
    session: ses,
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: true,
  };
}

/** webPreferences for DREAM's own UI surfaces (toolbar window and overlay). */
export function uiWebPreferences(preload) {
  return {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    devTools: !!process.env.DREAM_DEVTOOLS || process.defaultApp === true,
  };
}
