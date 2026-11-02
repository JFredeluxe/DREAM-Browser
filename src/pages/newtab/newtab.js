const api = window.dreamNewTab;
document.querySelector('#date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
document.querySelector('#search').addEventListener('submit', e => { e.preventDefault(); api.go(document.querySelector('#query').value); });
api.info().then(info => {
  document.documentElement.dataset.theme = info.effectiveTheme ?? 'system';
  const items = info.bookmarks.length ? info.bookmarks.slice(0, 8) : [{ title: 'Wikipedia', url: 'https://wikipedia.org' }, { title: 'GitHub', url: 'https://github.com' }, { title: 'YouTube', url: 'https://youtube.com' }, { title: 'DuckDuckGo', url: 'https://duckduckgo.com' }];
  document.querySelector('#count').textContent = String(items.length).padStart(2, '0');
  if (info.ghost) { document.querySelector('#eyebrow').textContent = 'GHOST MODE · A TEMPORARY SPACE'; document.querySelector('#privacy').textContent = 'Temporary session. DREAM AI, extensions, bookmarks and downloads are disabled. This does not make you anonymous.'; }
  for (const item of items) {
    const button = document.createElement('button'); button.className = 'shortcut';
    const mark = document.createElement('b'); mark.textContent = item.title[0].toUpperCase();
    const title = document.createElement('span'); title.textContent = item.title;
    const host = document.createElement('small'); host.textContent = new URL(item.url).hostname.replace(/^www\./, '');
    button.append(mark, title, host); button.addEventListener('click', () => api.go(item.url)); document.querySelector('#shortcuts').append(button);
  }
});
