import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Assistant } from '../../src/main/ai-core.js';

const secure = { isEncryptionAvailable: () => false };
const model = id => ({ id, pricing: { prompt: .000001, completion: .000001 }, context_length: 32000, architecture: { input_modalities: ['text'], output_modalities: ['text'] } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const stream = content => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-assistant-'));
  const original = globalThis.fetch;
  const ai = new Assistant(dir, secure);
  ai.store.data.settings = { ...ai.store.data.settings, strategy: 'cloud', allowCloud: true };
  ai.key = 'test';
  t.after(() => { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); });
  return ai;
}
test('fallback streams from the next model and reserves both attempts', async t => {
  const ai = setup(t); const called = []; const chunks = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/models')) return json({ data: [model('a'), model('b')] });
    called.push(JSON.parse(options.body).model);
    return called.length === 1 ? new Response('', { status: 503 }) : stream('hello');
  };
  const result = await ai.ask(1, 'hello', chunk => chunks.push(chunk));
  assert.deepEqual(called, ['a', 'b']); assert.deepEqual(chunks, ['hello']);
  assert.equal(result.text, 'hello'); assert.equal(ai.status().monthlyReservedUSD, result.reservedUSD);
  assert.ok(result.reservedUSD > 0);
});
test('cancellation stops the active request without falling back', async t => {
  const ai = setup(t); let calls = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/models')) return json({ data: [model('a'), model('b')] });
    calls++; started();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const pending = ai.ask(1, 'hello'); await ready; ai.cancel(1);
  await assert.rejects(pending, /abort/i); assert.equal(calls, 1);
});
test('cancellation interrupts a response after streaming begins', async t => {
  const ai = setup(t); let started; const ready = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/models')) return json({ data: [model('a')] });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      options.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  const pending = ai.ask(1, 'hello', () => started()); await ready; ai.cancel(1);
  await assert.rejects(pending, /abort/i);
});
test('simultaneous windows cannot reserve the same monthly budget', async t => {
  const ai = setup(t); ai.store.data.settings.monthlyBudgetUSD = .002;
  let started, release; const ready = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (url) => {
    if (url.endsWith('/models')) return json({ data: [model('a')] });
    started(); return new Promise(resolve => { release = () => resolve(stream('done')); });
  };
  const first = ai.ask(1, 'hello'); await ready;
  await assert.rejects(ai.ask(2, 'hello'), /cost limits/);
  release(); assert.equal((await first).text, 'done');
});
