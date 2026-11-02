export const AI_DEFAULTS = { strategy: 'auto', allowCloud: false, model: '', ollamaModel: '', maxRequestUSD: 0.02, dailyBudgetUSD: 0.25, maxTokens: 768 };
export function cleanAiSettings(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === 'strategy' && ['auto', 'local', 'cloud'].includes(value)) out[key] = value;
    if (key === 'allowCloud' && typeof value === 'boolean') out[key] = value;
    if (['model', 'ollamaModel'].includes(key) && typeof value === 'string' && value.length <= 160) out[key] = value.trim();
    const bounds = { maxRequestUSD: [0.001, 1], dailyBudgetUSD: [0.01, 10], maxTokens: [128, 4096] }[key];
    if (bounds && typeof value === 'number' && Number.isFinite(value)) out[key] = Math.max(bounds[0], Math.min(bounds[1], value));
  }
  return out;
}
export function chooseCloudModel(models, text, settings, spent = 0) {
  // UTF-8 bytes deliberately overestimate ordinary text token counts; reserve for framing too.
  const inputTokens = Buffer.byteLength(text, 'utf8') + 512;
  const available = Math.min(settings.maxRequestUSD, settings.dailyBudgetUSD - spent);
  const candidates = models.filter(m => !settings.model || m.id === settings.model).flatMap(m => {
    const prompt = Number(m.pricing?.prompt), completion = Number(m.pricing?.completion);
    if (!m.pricing || !Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return [];
    // Exclude models with extra per-request/image/reasoning charges that this estimator cannot bound.
    if (Object.entries(m.pricing).some(([k, v]) => !['prompt', 'completion'].includes(k) && Number(v) > 0)) return [];
    if (!(m.architecture?.input_modalities ?? ['text']).includes('text')) return [];
    const output = Math.min(settings.maxTokens, m.top_provider?.max_completion_tokens ?? settings.maxTokens);
    if ((m.context_length ?? 0) < inputTokens + output) return [];
    const reserve = inputTokens * prompt + output * completion;
    return reserve <= available ? [{ id: m.id, reserve, prompt, completion, output }] : [];
  });
  candidates.sort((a, b) => a.reserve - b.reserve || a.id.localeCompare(b.id));
  if (!candidates.length) throw new Error('No text model fits your cost limits. Change the model or budget in Assistant settings.');
  return candidates[0];
}
