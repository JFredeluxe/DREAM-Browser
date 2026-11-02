import { h, $ } from './dom.js';
import { icon } from './icons.js';
import { renderAnswer } from './answer.js';
import { SEARCH_ENGINES } from '../../shared/url.js';

const root = $('#root');
let current = null, state = null, transcript = [], streamSink = null;
window.dream.on('assistant:chunk', data => { if (current?.kind === 'assistant' && current.token === data.token) streamSink?.(data.chunk); });
const rpc = (method, data) => window.dream.call(method, data);
const action = (id, value) => rpc('overlay:action', { token: current?.token, id, value });
const close = () => { rpc('assistant:cancel').catch(() => {}); return rpc('overlay:dismiss'); };
const button = (label, handler, cls = 'btn') => h('button', { class: cls, onclick: handler }, label);
const note = text => h('p', { class: 'note' }, text);
function showError(error, parent = root.querySelector('.panel') ?? root) {
  let el = parent.querySelector('.error-message');
  if (!el) { el = h('p', { class: 'error-message', role: 'alert' }); parent.append(el); }
  el.textContent = error?.message ?? String(error);
}
function safe(fn) { return async (...args) => { try { await fn(...args); } catch (e) { showError(e); } }; }
function heading(panel, title) {
  panel.append(h('div', { class: 'panel-heading' }, h('h2', {}, title), button('Close', close, 'link-btn')));
}
function surface(cls = 'panel', width = 340) {
  const scrim = h('div', { class: 'scrim', onpointerdown: e => { if (e.target === scrim) close(); } });
  const panel = h('section', { class: `pop ${cls}`, role: 'dialog', 'aria-modal': 'true' });
  panel.style.width = `${Math.min(width, innerWidth - 24)}px`;
  scrim.append(panel); root.replaceChildren(scrim);
  const a = current.data?.anchor;
  panel.style.top = `${Math.max(12, Math.min(a ? a.y + a.height + 8 : 70, innerHeight - 440))}px`;
  panel.style.right = '16px';
  return panel;
}
function field(parent, label, input) { const id = `field-${label.replace(/\W/g, '')}`; input.id = id; parent.append(h('div', { class: 'field' }, h('label', { htmlFor: id }, label), input)); return input; }
function select(parent, label, value, options, changed) {
  const el = h('select', { onchange: e => changed(e.target.value) }, options.map(([key, name]) => h('option', { value: key }, name)));
  el.value = value; return field(parent, label, el);
}
function toggle(parent, label, checked, changed, disabled = false) {
  const el = h('button', { class: 'switch', role: 'switch', 'aria-label': label, 'aria-checked': String(checked), disabled,
    onclick: () => { const next = el.getAttribute('aria-checked') !== 'true'; el.setAttribute('aria-checked', String(next)); changed(next); } });
  parent.append(h('div', { class: 'row field' }, h('span', {}, label), el)); return el;
}

function menu() {
  const panel = surface('menu', 270);
  for (const item of current.data.items) {
    if (item.separator) { panel.append(h('div', { class: 'sep' })); continue; }
    panel.append(h('button', { class: 'item', disabled: item.disabled, onclick: () => action('choose', item.id) }, h('span', {}, `${item.checked ? '✓ ' : ''}${item.label}`), h('span', { class: 'hint' }, item.hint ?? '')));
  }
}
function omnibox() {
  const panel = h('div', { class: 'pop omni-panel', role: 'listbox', 'aria-label': 'Suggestions' });
  for (const [index, s] of current.data.suggestions.entries()) panel.append(h('div', { class: 'suggestion', role: 'option', 'aria-selected': String(index === current.data.selected), onpointerdown: e => { e.preventDefault(); action('choose', index); } }, h('span', { class: 's-icon' }, icon(s.type === 'search' ? 'search' : s.type === 'bookmark' ? 'star' : 'globe')), h('span', { class: 's-title' }, s.title), h('span', { class: 's-url' }, s.url)));
  root.replaceChildren(panel);
}
function bookmark() {
  const panel = surface(); heading(panel, 'Bookmark saved');
  const input = field(panel, 'Name', h('input', { class: 'text-input', value: current.data.title, maxLength: 300, oninput: e => action('rename', e.target.value) }));
  panel.append(note(current.data.url), h('div', { class: 'actions' }, button('Remove', () => action('remove'), 'link-btn danger'), button('Done', () => action('done'), 'btn primary')));
  input.focus(); input.select();
}
function bookmarks() {
  const panel = surface('bm-panel', 400); heading(panel, 'Your bookmarks');
  const list = h('div', { class: 'bm-list' });
  for (const b of state?.bookmarks ?? []) list.append(h('div', { class: 'bm-item' }, icon('bookmark'), button('', () => action('open', { id: b.id }), 'bm-text'), button('×', () => action('remove', { id: b.id }), 'bm-remove')));
  [...list.children].forEach((row, i) => { const b = state.bookmarks[i]; row.querySelector('.bm-text').append(h('span', { class: 'bm-title' }, b.title), h('span', { class: 'bm-sub' }, b.url)); row.querySelector('.bm-remove').setAttribute('aria-label', `Remove ${b.title}`); });
  if (!list.children.length) list.append(h('div', { class: 'empty' }, state?.ghost ? 'Bookmarks are unavailable in Ghost Mode.' : 'Save a page with the star in the address bar.'));
  panel.append(list);
}
function customize() {
  const panel = surface('panel settings-panel', 380); heading(panel, 'Make it yours');
  const s = state.settings;
  const set = patch => action('set', patch);
  select(panel, 'Appearance', s.theme, [['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']], value => set({ theme: value }));
  select(panel, 'Tab layout', s.tabPosition, [['left', 'Sidebar'], ['top', 'Across the top']], value => set({ tabPosition: value }));
  select(panel, 'Density', s.density, [['comfortable', 'Comfortable'], ['compact', 'Compact']], value => set({ density: value }));
  select(panel, 'Accent', s.accent, Object.keys(state.accents).map(k => [k, k[0].toUpperCase() + k.slice(1)]), value => set({ accent: value }));
  select(panel, 'Search engine', s.searchEngine, Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, v.name]), value => set({ searchEngine: value }));
  toggle(panel, 'Remember browsing history', s.saveHistory, value => set({ saveHistory: value }), state.ghost);
  toggle(panel, 'Restore tabs on startup', s.restoreSession, value => set({ restoreSession: value }), state.ghost);
  panel.append(note(state.ghost ? 'Ghost uses temporary storage. AI, extensions, bookmarks and downloads are disabled.' : 'Camera, microphone, location and notifications are blocked in this release.'));
  panel.append(h('div', { class: 'actions' }, button('Clear history', safe(async () => { await rpc('history:clear'); panel.append(note('History cleared.')); }), 'link-btn danger'), button('Reset appearance', () => action('reset'), 'link-btn')));
  if (!state.ghost) panel.append(button('Clear cookies, cache and history…', safe(async () => { if (!confirm('Clear browsing data? Sites will sign you out. Open tabs remain.')) return; await rpc('privacy:clear'); panel.append(note('Browsing data cleared.')); }), 'link-btn danger'));
}
function assistant() {
  const panel = surface('panel assistant-panel', 540); heading(panel, 'Ask DREAM');
  const status = current.data.status;
  panel.append(h('div', { class: 'ai-intro' }, h('span', { class: 'ai-mark' }, '✧'), h('div', {}, h('strong', {}, 'A little clarity. A fresh perspective.'), note('Your conversation stays in this window. Nothing runs in the background.'))));
  const routeName = status.strategy === 'local' ? 'Ollama only' : status.strategy === 'cloud' ? 'OpenRouter' : 'Local first';
  const chips = h('div', { class: 'ai-chips' }, h('span', { class: 'status-chip' }, h('i', {}), routeName), h('span', { class: 'status-chip quiet-chip' }, status.allowCloud ? 'Cloud allowed' : 'Cloud off'), h('span', { class: 'status-chip quiet-chip' }, `$${status.maxRequestUSD.toFixed(3)} / request`));
  panel.append(chips);
  const details = h('details', { class: 'ai-settings' }, h('summary', {}, 'Connections & cost limits'));
  const draft = { ...status };
  select(details, 'Choose a route', status.strategy, [['auto', 'Smart · try Ollama, then approved cloud'], ['local', 'Local · Ollama only'], ['cloud', 'Cloud · OpenRouter only']], value => draft.strategy = value);
  select(details, 'Cloud routing', status.quality, [['economy', 'Economy'], ['balanced', 'Balanced'], ['quality', 'Quality']], value => draft.quality = value);
  toggle(details, 'Allow cloud requests', status.allowCloud, value => draft.allowCloud = value);
  details.append(note('When cloud is used, your recent conversation is sent to OpenRouter. Model quality is estimated; pin a model below for a specific choice.'));
  const localStatus = h('span', { class: 'note', role: 'status' }, 'Use a model installed in Ollama.');
  const localModel = field(details, 'Ollama model', h('input', { class: 'text-input', value: status.ollamaModel, placeholder: 'Automatic · first installed model', oninput: e => draft.ollamaModel = e.target.value }));
  details.append(h('div', { class: 'connection-check' }, button('Check Ollama', safe(async () => {
    localStatus.textContent = 'Checking your connection…';
    const result = await rpc('assistant:models');
    localStatus.textContent = result.available ? result.models.length ? `${result.models.length} local model${result.models.length === 1 ? '' : 's'} available.` : 'Ollama is running. Download a model to get started.' : 'Ollama is not running. Open Ollama and try again.';
    if (result.models.length) { const list = h('datalist', { id: 'ollama-models' }, result.models.map(name => h('option', { value: name }))); localModel.setAttribute('list', 'ollama-models'); details.querySelector('#ollama-models')?.remove(); details.append(list); }
  }), 'link-btn'), localStatus));
  const key = field(details, 'OpenRouter key', h('input', { type: 'password', class: 'text-input', autocomplete: 'off', placeholder: status.hasKey ? 'Saved securely · leave blank to keep' : 'Paste your API key' }));
  field(details, 'Cloud model', h('input', { class: 'text-input', value: status.model, placeholder: 'Automatic · lowest eligible cost', oninput: e => draft.model = e.target.value }));
  const limits = h('div', { class: 'cost-grid' });
  for (const [name, label, min, max, step] of [['maxRequestUSD', 'Per request · USD', 0, 1, .001], ['dailyBudgetUSD', 'Per day · USD', 0, 10, .01], ['monthlyBudgetUSD', 'Per month · USD', 0, 300, .01], ['maxTokens', 'Answer length · tokens', 128, 4096, 1]]) field(limits, label, h('input', { type: 'number', class: 'text-input', value: status[name], min, max, step, oninput: e => draft[name] = Number(e.target.value) }));
  details.append(limits);
  const saved = h('span', { class: 'note', role: 'status' });
  details.append(h('div', { class: 'actions' }, button('Forget key', safe(async () => { await rpc('assistant:configure', { clearKey: true }); saved.textContent = 'Key removed.'; }), 'link-btn danger'), button('Save connections', safe(async () => { const result = await rpc('assistant:configure', { ...draft, apiKey: key.value }); key.value = ''; Object.assign(status, result); saved.textContent = 'Saved. You’re ready to ask.'; chips.children[1].textContent = result.allowCloud ? 'Cloud allowed' : 'Cloud off'; }), 'btn primary')), saved,
    note(`Reserved today: $${status.reservedUSD.toFixed(4)} · this month: $${status.monthlyReservedUSD.toFixed(4)}. Estimates reset in UTC. Provider-side spending limits are separate.`));
  panel.append(details);
  const log = h('div', { class: 'chat-log', 'aria-live': 'polite', role: 'log', 'aria-label': 'Conversation' });
  const prompt = h('textarea', { class: 'prompt', rows: 3, maxLength: 24000, placeholder: 'What’s on your mind?', 'aria-label': 'Ask DREAM Assistant' });
  if (current.data.draft) prompt.value = current.data.draft;
  let busy = false, preparing = false, stopRequested = false;
  const draw = () => {
    log.replaceChildren();
    if (!transcript.length) {
      const empty = h('div', { class: 'ai-empty' }, h('span', { class: 'empty-spark' }, '✧'), h('h3', {}, 'Make room for a good question.'), note('Explain an idea, shape a draft, or bring a little order to your thoughts.'));
      const suggestions = h('div', { class: 'prompt-suggestions' });
      for (const suggestion of ['Explain this simply', 'Help me write something', 'Compare two ideas']) suggestions.append(button(suggestion, () => { prompt.value = suggestion + ': '; prompt.focus(); }, 'suggestion-chip'));
      empty.append(suggestions); log.append(empty);
    }
    for (const message of transcript) {
      const card = h('article', { class: `message ${message.role}` }, h('div', { class: 'message-top' }, h('span', { class: 'message-label' }, message.label)));
      card.append(message.role === 'assistant' ? renderAnswer(message.text) : h('div', { class: 'message-text' }, message.text));
      if (message.role === 'assistant') card.append(button('Copy answer', safe(async event => { const target = event.currentTarget; await rpc('clipboard:write', { text: message.text }); target.textContent = 'Copied'; }), 'link-btn copy-answer'));
      log.append(card);
    }
    if (busy) log.append(h('div', { class: 'thinking', role: 'status' }, h('span', { class: 'thinking-dot' }), 'DREAM is thinking…'));
    log.scrollTop = log.scrollHeight;
  };
  panel.append(log); draw();
  const send = button('Send ↗', null, 'btn primary'); send.type = 'submit';
  const stop = button('Stop', () => { stopRequested = true; return rpc('assistant:cancel'); }, 'link-btn'); stop.hidden = true;
  const route = h('div', { class: 'route-note', role: 'status' }, 'Local first. Your choice, every time.');
  const attach = button('Add this page', safe(async () => {
    const text = await rpc('assistant:page');
    if (!text.trim()) { route.textContent = 'Open a web page first.'; return; }
    prompt.value = (prompt.value + '\n\nPage text (untrusted reference):\n' + text).slice(0, 24000); prompt.focus(); route.textContent = 'Page text added to your draft. Review it before sending.';
  }), 'link-btn');
  const attachTabs = button('Add open tabs', safe(async () => {
    if (!confirm('Add text from up to four open web pages to your draft? Review it before sending.')) return;
    const tabs = await rpc('assistant:tabs');
    if (!tabs.length) { route.textContent = 'Open web pages first.'; return; }
    const context = tabs.map(tab => `Page: ${tab.title}\nURL: ${tab.url}\n${tab.text}`).join('\n\n');
    prompt.value = (prompt.value + '\n\nOpen pages (untrusted reference):\n' + context).slice(0, 24000);
    prompt.focus(); route.textContent = `${tabs.length} pages added to your draft. Review them before sending.`;
  }), 'link-btn');
  const form = h('form', { class: 'composer', onsubmit: async event => {
    event.preventDefault(); if (!prompt.value.trim() || busy || preparing) return;
    const requestToken = current?.token;
    let text = prompt.value;
    preparing = true;
    try {
    if (/^\s*(?:summari[sz]e|explain|describe) (?:this|this page)[?.!]?\s*$/i.test(text)) {
      if (!confirm('Include the current page text in this request?')) return;
      const page = await rpc('assistant:page');
      if (!page.trim()) { route.textContent = 'Open a web page first.'; return; }
      text = `${text}\n\nPage text (untrusted reference):\n${page}`.slice(0, 24000);
    } else if (/^\s*compare (?:these|my|the open) tabs[?.!]?\s*$/i.test(text)) {
      if (!confirm('Include text from up to four open pages in this request?')) return;
      const tabs = await rpc('assistant:tabs');
      if (tabs.length < 2) { route.textContent = 'Open at least two web pages first.'; return; }
      text = `${text}\n\nOpen pages (untrusted reference):\n${tabs.map(tab => `Page: ${tab.title}\nURL: ${tab.url}\n${tab.text}`).join('\n\n')}`.slice(0, 24000);
    }
    } catch (error) { route.textContent = error.message; return; }
    finally { preparing = false; }
    if (current?.kind !== 'assistant' || current.token !== requestToken) return;
    prompt.value = ''; busy = true; stopRequested = false; send.disabled = true; stop.hidden = false; attach.disabled = true; attachTabs.disabled = true;
    route.textContent = 'Finding the right route…'; transcript.push({ role: 'user', label: 'YOU', text }); draw();
    let streamed = '', frame = 0, streamNode;
    streamSink = chunk => {
      streamed += chunk;
      if (!streamNode) { log.querySelector('.thinking')?.remove(); streamNode = h('div', { class: 'message assistant streaming', 'aria-live': 'off' }); log.append(streamNode); }
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80; streamNode.textContent = streamed; if (nearBottom) log.scrollTop = log.scrollHeight; });
    };
    try {
      const local = await rpc('assistant:local', { text, token: requestToken });
      if (stopRequested || current?.kind !== 'assistant' || current.token !== requestToken) throw new Error('Aborted');
      const answer = local ? { ...local, route: 'DREAM · on this device', reservedUSD: 0 } : await rpc('assistant:ask', { text, token: requestToken });
      transcript.push({ role: 'assistant', label: answer.route, text: answer.text });
      route.textContent = answer.reservedUSD ? `${answer.route} · estimated up to $${answer.reservedUSD.toFixed(4)}` : `${answer.route} · no OpenRouter charge`;
    }
    catch (error) { transcript.push({ role: 'error', label: 'LET’S TRY AGAIN', text: /abort/i.test(error.message) ? 'Stopped. Your draft is ready when you are.' : error.message }); prompt.value = text; route.textContent = 'Your message has been kept in the draft.'; }
    finally { streamSink = null; if (frame) cancelAnimationFrame(frame); busy = false; send.disabled = false; stop.hidden = true; attach.disabled = false; attachTabs.disabled = false; draw(); prompt.focus(); }
  } }, prompt, h('div', { class: 'composer-actions' }, attach, attachTabs, h('span', { class: 'keyboard-hint' }, 'Ctrl + Enter to send'), stop, send));
  prompt.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); } });
  panel.append(form, route, h('div', { class: 'assistant-foot' }, note('Only the messages you send are used. Check important answers.'), button('New conversation', safe(async () => { await rpc('assistant:clear'); transcript = []; draw(); prompt.focus(); }), 'link-btn')));
}

function integrations() {
  const panel = surface('panel extensions-panel', 540); heading(panel, 'Your extensions');
  const store = h('div', { class: 'store-hero' }, h('span', { class: 'store-symbol' }, icon('puzzle')), h('div', {}, h('h3', {}, 'A little more capability.'), note('Find your favorites in the Chrome Web Store. Add them directly to DREAM.')), button('Browse Web Store ↗', safe(() => rpc('chrome:open')), 'btn primary'));
  const search = h('input', { class: 'text-input', placeholder: 'Search the Chrome Web Store', 'aria-label': 'Search extensions', maxLength: 200 });
  const searchForm = h('form', { class: 'store-search', onsubmit: safe(async event => { event.preventDefault(); if (search.value.trim()) await rpc('extensions:search', { text: search.value.trim() }); }) }, icon('search'), search, Object.assign(button('Search', null, 'link-btn'), { type: 'submit' }));
  panel.append(store, searchForm, h('div', { class: 'section-heading' }, h('h3', {}, 'Installed'), h('span', { class: 'count-pill' }, String(current.data.extensions?.length ?? 0))));
  if (!current.data.extensions?.length) panel.append(h('div', { class: 'extensions-empty' }, icon('puzzle'), h('strong', {}, 'Your space, your tools.'), note('Extensions you add will appear here and in the toolbar.')));
  for (const extension of current.data.extensions ?? []) {
    const row = h('article', { class: 'extension-card' }, h('div', { class: 'extension-initial' }, extension.name[0].toUpperCase()), h('div', { class: 'extension-copy' }, h('strong', {}, extension.name), note(extension.description || `Version ${extension.version}`), h('span', { class: 'extension-source' }, extension.fromStore ? 'CHROME WEB STORE' : 'UNPACKED EXTENSION')));
    const actions = h('div', { class: 'extension-actions' });
    if (extension.options) actions.append(button('Settings', safe(() => rpc('extensions:options', { id: extension.id })), 'link-btn'));
    actions.append(button('Permissions', () => { row.querySelector('.permission-list')?.remove(); row.append(h('div', { class: 'permission-list' }, h('strong', {}, 'Requested permissions'), ...(extension.permissions.length ? extension.permissions : ['No additional permissions']).map(permission => h('code', {}, permission)))); }, 'link-btn'), button('Remove', safe(async () => { if (!confirm(`Remove ${extension.name} from DREAM?`)) return; current.data = await rpc('extensions:remove', { id: extension.id }); integrations(); }), 'link-btn danger'));
    row.append(actions); panel.append(row);
  }
  const updateStatus = h('span', { class: 'note', role: 'status' });
  panel.append(h('div', { class: 'extension-footer' }, button('Check for updates', safe(async event => { const target = event.currentTarget; target.disabled = true; updateStatus.textContent = 'Checking…'; try { current.data = await rpc('extensions:update'); updateStatus.textContent = 'Extensions are up to date.'; } finally { target.disabled = false; } }), 'link-btn'), button('Load unpacked…', safe(async () => { current.data = await rpc('extensions:install'); integrations(); }), 'link-btn')), updateStatus, note('Extensions stay out of Ghost Mode. Some extensions may need Chrome features that DREAM does not support yet.'));
  for (const error of current.data.errors ?? []) panel.append(h('p', { class: 'error-message' }, error));
}

function render() {
  root.classList.remove('leaving');
  ({ menu, omnibox, bookmark, bookmarks, customize, assistant, integrations }[current?.kind] ?? (() => root.replaceChildren()))();
}
window.dream.on('overlay:show', data => { current = data; render(); });
window.dream.on('overlay:update', data => { if (current?.token !== data.token) return; current.data = { ...current.data, ...data.data }; render(); });
window.dream.on('overlay:hide', data => { if (current?.token !== data.token) return; root.classList.add('leaving'); if (current?.kind === 'assistant') rpc('assistant:cancel').catch(() => {}); current = null; streamSink = null; setTimeout(() => rpc('overlay:hidden', { token: data.token }), 110); });
window.dream.on('state', data => { state = data; document.documentElement.dataset.theme = data.effectiveTheme ?? data.settings.theme; document.documentElement.style.setProperty('--accent', data.accents[data.settings.accent] ?? data.settings.accent); if (current?.kind === 'bookmarks') render(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
state = await rpc('state:get');
document.documentElement.dataset.theme = state.effectiveTheme ?? state.settings.theme;
