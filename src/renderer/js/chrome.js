import { $ } from './dom.js';
import { icon } from './icons.js';
import { Spring, SPRINGS } from './spring.js';
import { TabList } from './tabs-ui.js';
import { prettyUrl, securityLevel } from '../../shared/url.js';

const call = (m, p) => window.dream.call(m, p).catch((e) => console.error(m, e));

const app = $('#app');
const urlInput = $('#url');
const omnibox = $('#omnibox');

let state = null;
let sidebarSpring = null;

const tabList = new TabList({
  onActivate: (id) => call('tab:activate', { id }),
  onClose: (id) => call('tab:close', { id }),
  onMove: (id, index) => call('tab:move', { id, index }),
  onMenu: (id, x, y) => call('tab:menu', { id, x, y }),
});

// ---- static icons & buttons ----------------------------------------------------------------

function setIcon(el, name) {
  if (el.dataset.icon === name) return;
  el.dataset.icon = name;
  el.replaceChildren(icon(name));
}
for (const [id, name] of Object.entries({
  back: 'back',
  forward: 'forward',
  customize: 'sliders',
  menu: 'more',
  'sidebar-toggle': 'sidebar',
  'new-tab-h': 'plus',
  extensions: 'puzzle',
})) setIcon($(`#${id}`), name);
$('#new-tab-v').replaceChildren(icon('plus'), Object.assign(document.createElement('span'), { textContent: 'New Tab' }));

$('#back').addEventListener('click', () => call('nav:back'));
$('#forward').addEventListener('click', () => call('nav:forward'));
$('#reload').addEventListener('click', () => call(state?.tabs.find((t) => t.id === state.activeId)?.loading ? 'nav:stop' : 'nav:reload'));
$('#star').addEventListener('click', () => call('bookmark:toggle'));
$('#customize').addEventListener('click', () => call('customize:show'));
$('#menu').addEventListener('click', () => call('menu:show'));
$('#new-tab-h').addEventListener('click', () => call('tab:new'));
$('#new-tab-v').addEventListener('click', () => call('tab:new'));
$('#sidebar-toggle').addEventListener('click', () => call('settings:update', { sidebarVisible: !state.settings.sidebarVisible }));
$('#assistant-shortcut').addEventListener('click', () => call('assistant:show'));
$('#ghost').addEventListener('click', () => call('ghost:new'));
$('#bookmarks').addEventListener('click', () => call('bookmarks:show'));
$('#ai').addEventListener('click', () => call('assistant:show'));
$('#extensions').addEventListener('click', () => call('integrations:show'));
window.dream.on('ui:notice', message => { $('#notice').textContent = message; $('#notice').classList.add('show'); setTimeout(() => $('#notice').classList.remove('show'), 3500); });

// ---- omnibox ---------------------------------------------------------------------------------

const activeTab = () => state?.tabs.find((t) => t.id === state.activeId);

function syncOmnibox() {
  const tab = activeTab();
  const url = tab?.displayUrl ?? '';
  if (document.activeElement !== urlInput) urlInput.value = prettyUrl(url);
  omnibox.classList.toggle('loading', !!tab?.loading);
  omnibox.style.setProperty('--omni-w', `${omnibox.clientWidth}px`);
  const level = securityLevel(url);
  omnibox.dataset.secure = String(level !== 'insecure');
  const iconName = !url ? 'search' : level === 'secure' ? 'lock' : level === 'insecure' ? 'info' : 'globe';
  const holder = $('#omni-icon');
  setIcon(holder, iconName);
  holder.title = level === 'insecure' ? 'Not secure' : '';
}

urlInput.addEventListener('focus', () => {
  urlInput.value = activeTab()?.displayUrl ?? '';
  requestAnimationFrame(() => urlInput.select());
});
urlInput.addEventListener('blur', () => {
  urlInput.setSelectionRange(0, 0);
  syncOmnibox();
});
urlInput.addEventListener('input', () => {
  reportAnchors();
  call('omnibox:query', { text: urlInput.value });
});
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    call('omnibox:move', { delta: e.key === 'ArrowDown' ? 1 : -1 });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    call('omnibox:submit', { text: urlInput.value });
  } else if (e.key === 'Escape') {
    call('omnibox:dismiss');
    urlInput.value = activeTab()?.displayUrl ?? '';
    urlInput.select();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!omnibox.contains(e.target)) call('omnibox:dismiss');
});

window.dream.on('ui:focus-omnibox', () => {
  urlInput.focus();
  urlInput.select();
});

// ---- layout ------------------------------------------------------------------------------------

/** Tell the main process where the page view goes and where popovers should anchor. */
let layoutQueued = false;
function reportAnchors() {
  const anchors = {};
  for (const el of document.querySelectorAll('[data-anchor]')) {
    const r = el.getBoundingClientRect();
    anchors[el.dataset.anchor] = { x: r.left, y: r.top, width: r.width, height: r.height };
  }
  call('layout:anchors', anchors);
}
function reportLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    const r = $('#slot').getBoundingClientRect();
    call('layout:content', { x: r.left, y: r.top, width: r.width, height: r.height });
    reportAnchors();
  });
}
new ResizeObserver(reportLayout).observe($('#slot'));
new ResizeObserver(reportLayout).observe($('#toolbar'));

// ---- state -> DOM --------------------------------------------------------------------------------

function applyState(s, first) {
  const prev = state;
  state = s;
  $('#mode-label').textContent = s.ghost ? 'GHOST' : 'CHROMIUM';
  document.documentElement.dataset.theme = s.effectiveTheme ?? s.settings.theme;
  app.classList.toggle('ghost', s.ghost);
  $('#ai').disabled = s.ghost;
  $('#extensions').disabled = s.ghost;
  $('#assistant-shortcut').disabled = s.ghost;
  $('#bookmarks').disabled = s.ghost;
  const actionHost = $('#extension-actions');
  if (!s.ghost) {
    let list = actionHost.firstElementChild;
    if (!list) { list = document.createElement('browser-action-list'); list.setAttribute('partition', 'persist:dream-main'); actionHost.append(list); }
    list.setAttribute('tab', String(s.activeWebContentsId));
  } else actionHost.replaceChildren();
  const { settings, metrics } = s;

  document.documentElement.classList.toggle('mac', s.platform === 'darwin');
  app.dataset.tabs = settings.tabPosition;
  app.dataset.density = settings.density;
  const root = document.documentElement.style;
  root.setProperty('--tab-h', `${metrics.tabHeight}px`);
  root.setProperty('--toolbar-h', `${metrics.toolbarHeight}px`);
  root.setProperty('--sidebar-w-target', `${metrics.sidebarWidth}px`);
  root.setProperty('--accent', s.accents[settings.accent] ?? settings.accent);
  tabList.rowHeight = metrics.tabHeight - 6;

  const showSidebar = settings.tabPosition === 'left' && settings.sidebarVisible;
  const target = showSidebar ? metrics.sidebarWidth : 0;
  if (!sidebarSpring) sidebarSpring = new Spring(target, (v) => root.setProperty('--sidebar-w', `${Math.max(0, v)}px`), SPRINGS.smooth);
  if (first || prev?.settings.tabPosition !== settings.tabPosition) sidebarSpring.set(target);
  else sidebarSpring.to(target);

  if (settings.tabPosition === 'left') tabList.mount($('#tabs-v'), 'y');
  else tabList.mount($('#tabs-h'), 'x');
  tabList.render(s.tabs, s.activeId);

  const tab = activeTab();
  $('#back').disabled = !tab?.canGoBack;
  $('#forward').disabled = !tab?.canGoForward;
  setIcon($('#reload'), tab?.loading ? 'close' : 'reload');
  $('#reload').title = tab?.loading ? 'Stop' : 'Reload';
  $('#reload').setAttribute('aria-label', tab?.loading ? 'Stop loading' : 'Reload');
  const star = $('#star');
  setIcon(star, s.activeBookmarked ? 'starFilled' : 'star');
  star.classList.toggle('on', s.activeBookmarked);
  star.disabled = !tab || !/^(https?|file):/.test(tab.url);
  $('#sidebar-toggle').classList.toggle('on', showSidebar);

  syncOmnibox();
  reportLayout();
}

const initial = await window.dream.call('state:get');
applyState(initial, true);
window.dream.on('state', (s) => applyState(s, false));
