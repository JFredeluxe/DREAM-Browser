const failed = new URLSearchParams(location.search);
document.querySelector('#reason').textContent = failed.get('desc') || 'The page is unavailable.';
document.querySelector('#retry').addEventListener('submit', e => { e.preventDefault(); const url = failed.get('url'); if (/^https?:\/\//.test(url)) window.dreamNewTab.go(url); });
