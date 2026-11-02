import test from 'node:test';
import assert from 'node:assert/strict';
import { readAiStream } from '../../src/main/ai-stream.js';
import { AI_DEFAULTS, chooseCloudModel } from '../../src/main/ai-policy.js';

function response(chunks) {
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }));
}
test('OpenRouter SSE streams split UTF-8 and rejects incomplete responses', async () => {
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hé"}}]}\n\ndata: [DONE]\n\n');
  const parts = [];
  assert.equal(await readAiStream(response([bytes.slice(0, 37), bytes.slice(37, 38), bytes.slice(38)]), 'openrouter', part => parts.push(part)), 'hé');
  assert.deepEqual(parts, ['hé']);
  await assert.rejects(readAiStream(response([new TextEncoder().encode('data: {"choices":[]}\n')]), 'openrouter'), /ended before/);
});
test('Ollama NDJSON streams chunks and reports provider errors', async () => {
  const enc = new TextEncoder();
  const parts = [];
  assert.equal(await readAiStream(response([enc.encode('{"message":{"content":"hello"},"done":false}\n'), enc.encode('{"message":{"content":"!"},"done":true}\n')]), 'ollama', part => parts.push(part)), 'hello!');
  assert.deepEqual(parts, ['hello', '!']);
  await assert.rejects(readAiStream(response([enc.encode('{"error":"model unavailable"}\n')]), 'ollama'), /model unavailable/);
});
test('monthly and per-request reservations both constrain model selection', () => {
  const models = [{ id: 'test', pricing: { prompt: .000001, completion: .000001 }, context_length: 32000, architecture: { input_modalities: ['text'] } }];
  const settings = { ...AI_DEFAULTS, monthlyBudgetUSD: .01, maxRequestUSD: .01 };
  assert.ok(chooseCloudModel(models, 'hello', settings, 0, 0).reserve > 0);
  assert.throws(() => chooseCloudModel(models, 'hello', settings, 0, .01), /cost limits/);
  assert.throws(() => chooseCloudModel(models, 'hello', { ...settings, monthlyBudgetUSD: 0 }), /cost limits/);
  for (const invalid of [null, '', undefined]) {
    assert.throws(() => chooseCloudModel([{ ...models[0], pricing: { prompt: invalid, completion: 0 } }], 'hello', settings), /cost limits/);
  }
  assert.throws(() => chooseCloudModel([{ ...models[0], pricing: { prompt: 0, completion: 0, request: null } }], 'hello', settings), /cost limits/);
  assert.throws(() => chooseCloudModel([{ ...models[0], top_provider: { max_completion_tokens: -100000 } }], 'hello', settings), /cost limits/);
});
test('routing modes prefer eligible model classes while respecting cost limits', () => {
  const make = (id, price) => ({ id, pricing: { prompt: price, completion: price }, context_length: 32000, architecture: { input_modalities: ['text'], output_modalities: ['text'] } });
  const models = [make('test/mini', .0000001), make('test/large', .0000002)];
  assert.equal(chooseCloudModel(models, 'hello', { ...AI_DEFAULTS, quality: 'economy' }).id, 'test/mini');
  assert.equal(chooseCloudModel(models, 'hello', { ...AI_DEFAULTS, quality: 'quality' }).id, 'test/large');
  const specialties = [make('test/coder', 0), make('test/general', .0000001)];
  assert.equal(chooseCloudModel(specialties, 'hello', { ...AI_DEFAULTS, quality: 'economy' }).id, 'test/general');
  assert.equal(chooseCloudModel(specialties, 'debug this code', { ...AI_DEFAULTS, quality: 'economy' }).id, 'test/coder');
});
