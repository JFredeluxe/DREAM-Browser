import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { JsonStore } from './store.js';
import { AI_DEFAULTS, cleanAiSettings, chooseCloudModel } from './ai-policy.js';

export class Assistant {
  constructor(dir) {
    this.store = new JsonStore(path.join(dir, 'assistant.json'), { settings: AI_DEFAULTS, day: '', reserved: 0 });
    this.store.data.settings = { ...AI_DEFAULTS, ...cleanAiSettings(this.store.data.settings) };
    this.secretFile = path.join(dir, 'openrouter.key');
    this.key = '';
    this.pending = new Map();
    this.conversations = new Map();
    try { if (safeStorage.isEncryptionAvailable()) this.key = safeStorage.decryptString(fs.readFileSync(this.secretFile)); } catch {}
  }
  status() {
    this.rollDay();
    return { ...this.store.data.settings, hasKey: !!this.key, reservedUSD: this.store.data.reserved, encryptedStorage: safeStorage.isEncryptionAvailable() };
  }
  rollDay() {
    const day = new Date().toISOString().slice(0, 10);
    if (this.store.data.day !== day) { this.store.data.day = day; this.store.data.reserved = 0; this.store.touch(); }
  }
  configure(patch) {
    this.store.data.settings = { ...this.store.data.settings, ...cleanAiSettings(patch) };
    if (typeof patch?.apiKey === 'string' && patch.apiKey.trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS key encryption is unavailable. The API key was not saved.');
      const key = patch.apiKey.trim();
      if (key.length > 512 || /[\r\n]/.test(key)) throw new Error('Invalid API key.');
      fs.mkdirSync(path.dirname(this.secretFile), { recursive: true });
      fs.writeFileSync(this.secretFile, safeStorage.encryptString(key));
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
  async ask(windowId, text) {
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
        try {
          const localSignal = AbortSignal.any([signal, AbortSignal.timeout(2000)]);
          const tags = await this.json('http://127.0.0.1:11434/api/tags', { signal: localSignal });
          const model = settings.ollamaModel || tags.models?.[0]?.name;
          if (!model) throw new Error('No local model is installed in Ollama.');
          const data = await this.json('http://127.0.0.1:11434/api/chat', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false, options: { num_predict: settings.maxTokens } }) });
          if (typeof data.message?.content !== 'string') throw new Error('Ollama returned no answer.');
          return complete({ text: data.message.content, route: `Ollama · ${model}`, reservedUSD: 0 });
        } catch (error) {
          if (signal.aborted) throw error;
          if (settings.strategy === 'local' || !settings.allowCloud) throw new Error('Local AI is unavailable. Start Ollama with a downloaded model, or explicitly enable cloud fallback.');
        }
      }
      if (!settings.allowCloud) throw new Error('Cloud requests are off. Enable them explicitly in Assistant settings.');
      if (!this.key) throw new Error('Add your OpenRouter API key in Assistant settings.');
      const catalog = await this.json('https://openrouter.ai/api/v1/models', { signal });
      this.rollDay();
      const choice = chooseCloudModel(catalog.data ?? [], JSON.stringify(messages), settings, this.store.data.reserved);
      // Reserve before awaiting: parallel windows cannot spend the same budget.
      this.store.data.reserved += choice.reserve; this.store.touch(); this.store.flush();
      const response = await this.json('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'X-Title': 'DREAM Browser' },
        body: JSON.stringify({ model: choice.id, messages, max_tokens: choice.output,
          provider: { sort: 'price', allow_fallbacks: false, require_parameters: true, data_collection: 'deny', max_price: { prompt: choice.prompt * 1e6, completion: choice.completion * 1e6 } } }),
      });
      const answer = response.choices?.[0]?.message?.content;
      if (typeof answer !== 'string') throw new Error('The provider returned no text.');
      return complete({ text: answer, route: `OpenRouter · ${response.model ?? choice.id}`, reservedUSD: choice.reserve });
    } finally { clearTimeout(timeout); this.pending.delete(windowId); }
  }
  async json(url, options) {
    const response = await fetch(url, { redirect: 'error', ...options });
    if (!response.ok) throw new Error(`AI service returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 12_000_000) throw new Error('AI service response was too large.');
    return JSON.parse(text);
  }
  flush() { this.store.flush(); }
}
