// Address-bar input resolution. Pure functions, no Electron imports, so they are unit-testable.

export const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
};

export const NEW_TAB_URL = 'dream://newtab/';

// Schemes a user may reach by typing. Anything else (javascript:, data:, vbscript: ...) is treated as a search.
const TYPED_SCHEMES = new Set(['http:', 'https:']);

const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function looksLikeHost(hostPort) {
  // hostPort may include :port, but nothing else
  const m = /^(\[[0-9a-f:]+\]|[^:/\s]+)(?::(\d{1,5}))?$/i.exec(hostPort);
  if (!m) return false;
  const host = m[1];
  const hasPort = m[2] !== undefined;
  if (host.startsWith('[')) return true; // IPv6 literal
  if (host.toLowerCase() === 'localhost') return true;
  if (IPV4_RE.test(host)) return host.split('.').every((n) => Number(n) <= 255);
  if (HOSTNAME_RE.test(host)) return true;
  // single-label intranet names are only accepted with an explicit port, e.g. "devbox:8080"
  return hasPort && /^[a-z0-9-]+$/i.test(host);
}

export function searchUrl(query, engine = 'duckduckgo') {
  const tpl = (SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.duckduckgo).url;
  return tpl.replace('%s', encodeURIComponent(query));
}

/**
 * Turn whatever the user typed into { kind: 'url' | 'search', url }.
 */
export function resolveInput(raw, engine = 'duckduckgo') {
  const text = String(raw ?? '').trim();
  if (!text) return { kind: 'url', url: NEW_TAB_URL };
  if (text === NEW_TAB_URL || text === 'dream://newtab' || text === 'about:blank') return { kind: 'url', url: text === 'about:blank' ? text : NEW_TAB_URL };

  // Explicit scheme
  const schemeMatch = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(text);
  if (schemeMatch && !/^\d+$/.test(schemeMatch[2].split('/')[0])) {
    const scheme = `${schemeMatch[1].toLowerCase()}:`;
    // "localhost:3000" and "host:80" look like schemes; they are handled below because the rest is a port
    if (TYPED_SCHEMES.has(scheme)) {
      try {
        const u = new URL(text);
        return { kind: 'url', url: u.href };
      } catch {
        return { kind: 'search', url: searchUrl(text, engine) };
      }
    }
    if (!looksLikeHost(text)) return { kind: 'search', url: searchUrl(text, engine) };
  }

  if (/\s/.test(text)) return { kind: 'search', url: searchUrl(text, engine) };

  const hostPort = text.split(/[/?#]/)[0];
  if (looksLikeHost(hostPort)) {
    const bare = hostPort.split(':')[0].toLowerCase();
    const local = bare === 'localhost' || IPV4_RE.test(bare) || hostPort.startsWith('[');
    try {
      return { kind: 'url', url: new URL(`${local ? 'http' : 'https'}://${text}`).href };
    } catch {
      /* fall through */
    }
  }
  return { kind: 'search', url: searchUrl(text, engine) };
}

/** Can a page (not the user) navigate to this URL? */
export function isWebNavigable(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' || url === 'about:blank';
  } catch {
    return false;
  }
}

/** What the address bar shows for a URL. Internal new-tab page shows nothing. */
export function displayUrl(url) {
  if (!url || url === NEW_TAB_URL) return '';
  return url;
}

/** Address-bar text when the field is not being edited: no scheme for https, no trailing slash on bare hosts. */
export function prettyUrl(url) {
  if (!url || url === NEW_TAB_URL) return '';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return (u.host + u.pathname + u.search + u.hash).replace(/^([^/]+)\/$/, '$1');
  } catch {
    /* fall through */
  }
  return url;
}

/** 'secure' | 'insecure' | 'internal' — drives the lock icon. */
export function securityLevel(url) {
  if (!url || url.startsWith('dream:')) return 'internal';
  if (url.startsWith('https:')) return 'secure';
  if (url.startsWith('file:')) return 'internal';
  return 'insecure';
}

/** Short, human host label for tab titles/fallbacks. */
export function hostLabel(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'dream:') return u.hostname === 'newtab' ? 'New Tab' : `dream://${u.hostname}`;
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}
