import { resolveInput, hostLabel } from '../shared/url.js';

const MAX_SUGGESTIONS = 7;

function scoreMatch(q, entry) {
  const url = entry.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
  const title = (entry.title || '').toLowerCase();
  let s = 0;
  for (const term of q.split(/\s+/)) {
    if (!term) continue;
    if (url.startsWith(term)) s += 6;
    else if (url.includes(term)) s += 3;
    else if (title.includes(term)) s += 2;
    else return 0; // every term must match somewhere
  }
  return s;
}

/**
 * Build suggestions for the typed text. Pure; takes the data it needs.
 * Row 0 is always "what you typed" (navigate or search).
 */
export function buildSuggestions(text, { bookmarks, history, searchEngine, now = Date.now() }) {
  const typed = String(text ?? '').trim();
  if (!typed) return [];
  const resolved = resolveInput(typed, searchEngine);
  const top =
    resolved.kind === 'url'
      ? { type: 'url', title: typed, url: resolved.url }
      : { type: 'search', title: typed, url: resolved.url };

  const q = typed.toLowerCase();
  const seen = new Set([resolved.url]);
  const scored = [];

  for (const b of bookmarks) {
    const s = scoreMatch(q, b);
    if (s) scored.push({ type: 'bookmark', title: b.title, url: b.url, score: s + 4 });
  }
  for (const h of history) {
    const s = scoreMatch(q, h);
    if (!s) continue;
    const ageDays = (now - h.last) / 86_400_000;
    const frecency = Math.log2(1 + h.visits) + Math.max(0, 3 - ageDays / 7);
    scored.push({ type: 'history', title: h.title, url: h.url, score: s + frecency });
  }
  scored.sort((a, b) => b.score - a.score);

  const out = [top];
  for (const s of scored) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ type: s.type, title: s.title || hostLabel(s.url), url: s.url });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
