// Small, explicit local commands. No browser data is sent to an AI provider.
export function browserIntent(text) {
  const input = String(text).trim();
  const pin = /^(unpin|pin) (?:this|the current|the active) tab[.!]?$/i.exec(input);
  if (pin) return { type: 'pin', pinned: pin[1].toLowerCase() === 'pin' };
  const find = /^(?:find|search|show) (?:my )?(tabs?|bookmarks?|history)(?: (?:matching|for|about|containing))?\s+(.+?)[?.!]?$/i.exec(input);
  if (!find) return null;
  return { type: 'find', source: find[1].toLowerCase().replace(/s$/, ''), query: find[2].trim().toLowerCase().slice(0, 200) };
}

export function browserSearch(intent, { tabs, bookmarks, history }) {
  const list = intent.source === 'tab' ? tabs : intent.source === 'bookmark' ? bookmarks : history;
  return list.filter(item => `${item.title || ''} ${item.url || ''}`.toLowerCase().includes(intent.query))
    .slice(0, 8).map(item => ({ title: String(item.title || item.url || '').slice(0, 200), url: String(item.url || '').slice(0, 500) }));
}
