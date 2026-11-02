export const AI_DEFAULTS = { strategy: 'auto', quality: 'balanced', allowCloud: false, model: '', ollamaModel: '', maxRequestUSD: 0.02, dailyBudgetUSD: 0.25, monthlyBudgetUSD: 5, maxTokens: 768 };
export function cleanAiSettings(patch) {
  const out = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (key === 'strategy' && ['auto', 'local', 'cloud'].includes(value)) out[key] = value;
    if (key === 'quality' && ['economy', 'balanced', 'quality'].includes(value)) out[key] = value;
    if (key === 'allowCloud' && typeof value === 'boolean') out[key] = value;
    if (['model', 'ollamaModel'].includes(key) && typeof value === 'string' && value.length <= 160) out[key] = value.trim();
    const bounds = { maxRequestUSD: [0.001, 1], dailyBudgetUSD: [0.01, 10], monthlyBudgetUSD: [0.01, 300], maxTokens: [128, 4096] }[key];
    if (bounds && typeof value === 'number' && Number.isFinite(value)) out[key] = Math.max(bounds[0], Math.min(bounds[1], value));
  }
  return out;
}
export function chooseCloudModel(models, text, settings, spent = 0, monthlySpent = 0, exclude = []) {
  // UTF-8 bytes deliberately overestimate ordinary text token counts; reserve for framing too.
  const inputTokens = Buffer.byteLength(text, 'utf8') + 512;
  const available = Math.min(settings.maxRequestUSD, settings.dailyBudgetUSD - spent, settings.monthlyBudgetUSD - monthlySpent);
  const price = value => {
    if (value == null || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return NaN;
    return Number(value);
  };
  const candidates = models.filter(m => (!settings.model || m.id === settings.model) && !exclude.includes(m.id)).flatMap(m => {
    const prompt = price(m.pricing?.prompt), completion = price(m.pricing?.completion);
    if (!m.pricing || !Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return [];
    // Exclude models with extra per-request/image/reasoning charges that this estimator cannot bound.
    if (Object.entries(m.pricing).some(([k, v]) => !['prompt', 'completion'].includes(k) && (!Number.isFinite(price(v)) || price(v) !== 0))) return [];
    if (!(m.architecture?.input_modalities ?? ['text']).includes('text') || !(m.architecture?.output_modalities ?? ['text']).includes('text')) return [];
    const output = Math.min(settings.maxTokens, m.top_provider?.max_completion_tokens ?? settings.maxTokens);
    if ((m.context_length ?? 0) < inputTokens + output) return [];
    const reserve = inputTokens * prompt + output * completion;
    const name = String(m.id).toLowerCase();
    // Catalog metadata does not prove quality. These names are hints, not a
    // guarantee; users can pin a specific model when reliability matters.
    const capability = /(?:\b|[-_/])(large|pro|opus|ultra|70b|72b|120b|405b)(?:\b|[-_:])/.test(name) ? 2 : /(?:\b|[-_/])(mini|nano|small|1b|3b|7b|8b)(?:\b|[-_:])/.test(name) ? 0 : 1;
    return reserve <= available ? [{ id: m.id, reserve, prompt, completion, output, capability }] : [];
  });
  const complex = text.length > 5000 || /\b(compare|analy[sz]e|debug|reason|research|multi-step)\b/i.test(text);
  const desired = settings.quality === 'quality' ? 2 : settings.quality === 'balanced' && complex ? 1 : 0;
  const qualified = candidates.filter(candidate => candidate.capability >= desired);
  const ranked = qualified.length ? qualified : candidates;
  ranked.sort((a, b) => a.reserve - b.reserve || a.id.localeCompare(b.id));
  if (!ranked.length) throw new Error('No text model fits your cost limits. Change the model or budget in Assistant settings.');
  return ranked[0];
}
