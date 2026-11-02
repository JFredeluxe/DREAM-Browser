import { protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Must run before app 'ready'. */
export function registerPrivilegedSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'dream', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
  ]);
}

/**
 * Serve dream://<host>/... from local directories.
 * Each session gets its own allowlist of hosts, so web pages (tab session) can never load
 * the privileged browser UI (host "ui"), and the UI session never serves page content.
 * @param {Electron.Session} ses
 * @param {Record<string, string>} routes host -> absolute directory
 */
export function serveInternalPages(ses, routes) {
  const roots = Object.fromEntries(Object.entries(routes).map(([h, d]) => [h, path.resolve(d)]));
  ses.protocol.handle('dream', (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const root = roots[url.hostname];
    if (!root) return new Response('Not found', { status: 404 });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, '.' + rel);
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
}
