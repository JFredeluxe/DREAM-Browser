import fs from 'node:fs';
import path from 'node:path';
import { JsonStore } from './store.js';
import { AI_DEFAULTS, cleanAiSettings, chooseCloudModel } from './ai-policy.js';
import { readAiStream } from './ai-stream.js';

export class Assistant {
  constructor(dir, safeStorage) {
    this.safeStorage = safeStorage;
    this.store = new JsonStore(path.join(dir, 'assistant.json'), { settings: AI_DEFAULTS, day: '', reserved: 0 });
    this.store.data.settings = { ...AI_DEFAULTS, ...cleanAiSettings(this.store.data.settings) };
    this.secretFile = path.join(dir, 'openrouter.key');
    this.key = '';
    this.pending = new Map();
    this.conversations = new Map();
    this.catalog = null;
    try { if (this.safeStorage.isEncryptionAvailable()) this.key = this.safeStorage.decryptString(fs.readFileSync(this.secretFile)); } catch {}
  }
  status() {
    this.rollDay();
    return { ...this.store.data.settings, hasKey: !!this.key, reservedUSD: this.store.data.reserved, monthlyReservedUSD: this.store.data.monthlyReserved, encryptedStorage: this.safeStorage.isEncryptionAvailable() };
  }
  rollDay() {
    const day = new Date().toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    if (!this.store.data.month) { this.store.data.month = month; this.store.data.monthlyReserved = this.store.data.reserved || 0; this.store.touch(); }
    else if (this.store.data.month !== month) { this.store.data.month = month; this.store.data.monthlyReserved = 0; this.store.touch(); }
    if (this.store.data.day !== day) { this.store.data.day = day; this.store.data.reserved = 0; this.store.touch(); }
  }
  configure(patch) {
    this.store.data.settings = { ...this.store.data.settings, ...cleanAiSettings(patch) };
    if (typeof patch?.apiKey === 'string' && patch.apiKey.trim()) {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('OS key encryption is unavailable. The API key was not saved.');
      const key = patch.apiKey.trim();
      if (key.length > 512 || /[\r\n]/.test(key)) throw new Error('Invalid API key.');
      fs.mkdirSync(path.dirname(this.secretFile), { recursive: true });
      fs.writeFileSync(this.secretFile, this.safeStorage.encryptString(key));
      this.key = key;
    }
    if (patch?.clearKey === true) { this.key = ''; fs.rmSync(this.secretFile, { force: true }); }
    this.store.touch(); this.store.flush();
    return this.status();
  }
  cancel(windowId) { this.pending.get(windowId)?.abort(); }
  clear(windowId) { this.cancel(windowId); this.conversations.delete(windowId); }
  async localModels() {
    try {
      const data = await this.json('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
      return { available: true, models: (data.models ?? []).map(model => model.name).filter(name => typeof name === 'string').slice(0, 100) };
    } catch { return { available: false, models: [] }; }
  }
  async ask(windowId, text, onText = () => {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 24000) throw new Error('Enter a prompt up to 24,000 characters.');
    if (this.pending.has(windowId)) throw new Error('A request is already running.');
    const controller = new AbortController(); this.pending.set(windowId, controller);
    const timeout = setTimeout(() => controller.abort(), 90000);
    const signal = controller.signal;
    const settings = { ...this.store.data.settings };
    const conversation = this.conversations.get(windowId) ?? [];
    this.conversations.set(windowId, conversation);
    const messages = [...conversation.slice(-6), { role: 'user', content: text }];
    while (messages.length > 1 && JSON.stringify(messages).length > 32000) messages.splice(0, 2);
    const complete = result => {
      if (this.conversations.get(windowId) === conversation) { conversation.push({ role: 'user', content: text }, { role: 'assistant', content: result.text }); conversation.splice(0, Math.max(0, conversation.length - 12)); }
      return result;
    };
    try {
      if (settings.strategy !== 'cloud') {
        let received = false;
        try {
          const localSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
          const tags = await this.json('http://127.0.0.1:11434/api/tags', { signal: localSignal });
          const model = settings.ollamaModel || tags.models?.[0]?.name;
          if (!model) throw new Error('No local model is installed in Ollama.');
          const answer = await this.stream('http://127.0.0.1:11434/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true, options: { num_predict: settings.maxTokens } }) }, 'ollama', part => { received = true; onText(part); });
          return complete({ text: answer, route: `Ollama · ${model}`, reservedUSD: 0 });
        } catch (error) {
          if (signal.aborted) throw error;
          if (received) throw error;
          if (settings.strategy === 'local' || !settings.allowCloud) throw new Error('Local AI is unavailable. Start Ollama with a downloaded model, or explicitly enable cloud fallback.');
        }
      }
      if (!settings.allowCloud) throw new Error('Cloud requests are off. Enable them explicitly in Assistant settings.');
      if (!this.key) throw new Error('Add your OpenRouter API key in Assistant settings.');
      const catalog = this.catalog && Date.now() - this.catalog.at < 300000 ? this.catalog.data : await this.json('https://openrouter.ai/api/v1/models', { signal });
      this.catalog = { at: Date.now(), data: catalog };
      const excluded = []; let requestReserved = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        this.rollDay();
        const currentSettings = this.store.data.settings;
        if (!currentSettings.allowCloud) throw new Error('Cloud requests were disabled.');
        const boundedSettings = { ...currentSettings, maxRequestUSD: currentSettings.maxRequestUSD - requestReserved };
        const choice = chooseCloudModel(catalog.data ?? [], JSON.stringify(messages), boundedSettings, this.store.data.reserved, this.store.data.monthlyReserved, excluded);
        // Reserve synchronously before awaiting so parallel windows cannot reuse a budget.
        requestReserved += choice.reserve;
        this.store.data.reserved += choice.reserve; this.store.data.monthlyReserved += choice.reserve; this.store.touch(); this.store.flush();
        let received = false;
        try {
          const answer = await this.stream('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST', signal,
            headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'X-Title': 'DREAM Browser' },
            body: JSON.stringify({ model: choice.id, messages, max_tokens: choice.output, stream: true,
              provider: { sort: 'price', allow_fallbacks: false, require_parameters: true, data_collection: 'deny', max_price: { prompt: choice.prompt * 1e6, completion: choice.completion * 1e6 } } }),
          }, 'openrouter', part => { received = true; onText(part); });
          return complete({ text: answer, route: `OpenRouter · ${choice.id}`, reservedUSD: requestReserved });
        } catch (error) {
          if (signal.aborted || received || currentSettings.model || attempt === 2 || !(error.status === 429 || error.status >= 500)) throw error;
          excluded.push(choice.id);
        }
      }
    } finally { clearTimeout(timeout); this.pending.delete(windowId); }
  }
  async json(url, options) {
    const response = await fetch(url, { redirect: 'error', ...options });
    if (!response.ok) throw new Error(`AI service returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 12_000_000) throw new Error('AI service response was too large.');
    return JSON.parse(text);
  }
  async stream(url, options, kind, onText) {
    const response = await fetch(url, { redirect: 'error', ...options });
    if (!response.ok) { const error = new Error(`AI service returned HTTP ${response.status}.`); error.status = response.status; throw error; }
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const data = await response.json();
      const answer = kind === 'ollama' ? data.message?.content : data.choices?.[0]?.message?.content;
      if (typeof answer !== 'string') throw new Error('The AI service returned no answer.');
      onText(answer); return answer;
    }
    return readAiStream(response, kind, onText);
  }
  flush() { this.store.flush(); }
}
