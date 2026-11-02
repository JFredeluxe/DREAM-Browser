// Consume Ollama NDJSON or OpenRouter SSE incrementally, including UTF-8 split
// across network chunks. The caller owns cancellation and budget accounting.
export async function readAiStream(response, kind, onText = () => {}) {
  if (!response.ok) throw new Error(`AI service returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('The AI service returned no response stream.');
  const decoder = new TextDecoder();
  let buffer = '', text = '', done = false;
  const consume = line => {
    if (kind === 'openrouter') {
      if (!line.startsWith('data:')) return;
      line = line.slice(5).trim();
      if (line === '[DONE]') { done = true; return; }
    }
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch { throw new Error('The AI service sent an invalid streaming response.'); }
    if (event.error) throw new Error(typeof event.error === 'string' ? event.error : event.error.message || 'The AI service returned an error.');
    const part = kind === 'openrouter' ? event.choices?.[0]?.delta?.content : event.message?.content;
    if (typeof part === 'string' && part) {
      text += part;
      if (text.length > 1_000_000) throw new Error('The AI response was too large.');
      onText(part);
    }
    if (kind === 'ollama' && event.done) done = true;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 1_000_000) throw new Error('The AI response was too large.');
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      consume(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer.replace(/\r$/, ''));
  if (!done) throw new Error('The AI response ended before it was complete. Please retry.');
  if (!text) throw new Error('The AI service returned no answer.');
  return text;
}
