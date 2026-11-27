/**
 * Cấu hình AI Đa nhà cung cấp (Multi-Provider AI) & Quy tắc Tự động chọn Model tối ưu token.
 */

export const AI_PROVIDER_LIST = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Google Gemini',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    placeholder: 'AIzaSy••••••••••••••••••••••••••••••••',
    defaultModel: 'gemini-3.5-flash-lite',
    priorityModels: [
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash'
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI / ChatGPT',
    badge: 'OpenAI',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelsEndpoint: 'https://api.openai.com/v1/models',
    placeholder: 'sk-proj-••••••••••••••••••••••••••••••',
    defaultModel: 'gpt-4.1-mini',
    priorityModels: [
      'gpt-4.1-mini',
      'gpt-4o-mini',
      'gpt-4.1-nano',
      'gpt-3.5-turbo'
    ]
  },
  {
    id: 'groq',
    name: 'Groq (Khuyên dùng miễn phí)',
    badge: 'Groq Free',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsEndpoint: 'https://api.groq.com/openai/v1/models',
    placeholder: 'gsk_••••••••••••••••••••••••••••••••',
    defaultModel: 'llama-3.3-70b-versatile',
    priorityModels: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'qwen-qwq-32b'
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: 'DeepSeek',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    modelsEndpoint: 'https://api.deepseek.com/v1/models',
    placeholder: 'sk-••••••••••••••••••••••••••••••••',
    defaultModel: 'deepseek-chat',
    priorityModels: [
      'deepseek-chat'
    ]
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badge: 'OpenRouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsEndpoint: 'https://openrouter.ai/api/v1/models',
    placeholder: 'sk-or-v1-••••••••••••••••••••••••••••',
    defaultModel: 'google/gemini-2.5-flash-lite:free',
    priorityModels: [
      'google/gemini-2.5-flash-lite:free',
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'qwen/qwen-2.5-72b-instruct:free',
      'deepseek/deepseek-chat-v3-0324:free',
      'google/gemini-2.5-flash-lite',
      'openai/gpt-4o-mini'
    ]
  }
];

export const AI_PROVIDERS = AI_PROVIDER_LIST.reduce((acc, p) => {
  acc[p.id] = p;
  return acc;
}, {});

export function getProviderConfig(providerId = 'gemini') {
  return AI_PROVIDERS[providerId] || AI_PROVIDERS.gemini;
}

/**
 * Tự động nhận diện nhà cung cấp dựa trên prefix của API Key.
 * Trả về null nếu không nhận diện được (ví dụ key DeepSeek cũng bắt đầu bằng sk-).
 */
export function detectProviderFromKey(apiKey = '') {
  const clean = String(apiKey || '').trim();
  if (!clean) return null;
  if (clean.startsWith('AIza')) return 'gemini';
  if (clean.startsWith('gsk_')) return 'groq';
  if (clean.startsWith('sk-or-')) return 'openrouter';
  if (clean.startsWith('sk-')) return 'openai';
  return null;
}

const EXCLUDED_NON_TEXT_RE = /(image|audio|tts|whisper|dall-e|embedding|moderation|realtime|transcribe|robotics|aqa|omni|speech|sora|veo|imagen|thinking-exp|computer-use)/i;
const EXCLUDED_EXPENSIVE_REASONING_RE = /(^|[-_/.:])(pro|o1|o3|o4|reasoner|r1|opus)($|[-_/.:])/i;

/**
 * Kiểm tra model có bị loại bỏ (tạo ảnh/audio, đắt tiền, hoặc reasoning đốt nhiều token) hay không.
 */
export function isExcludedModel(providerId, modelId = '') {
  const id = String(modelId || '').trim();
  if (!id) return true;
  if (EXCLUDED_NON_TEXT_RE.test(id)) return true;
  if (EXCLUDED_EXPENSIVE_REASONING_RE.test(id)) return true;

  const lower = id.toLowerCase();
  if (providerId === 'deepseek' && lower.includes('reasoner')) return true;
  if (providerId === 'openai' && (/^gpt-4(?!\.1-mini|\.1-nano|o-mini)/.test(lower) || /^gpt-5(?!-mini|-nano)/.test(lower))) {
    return true;
  }
  return false;
}

/**
 * Lọc danh sách model thô thành danh sách model văn bản tối ưu cho nhà cung cấp.
 */
export function filterEconomicalModels(providerId, rawModels = []) {
  const list = Array.isArray(rawModels) ? rawModels : [];
  return list
    .map((m) => (typeof m === 'string' ? { id: m, displayName: m } : m))
    .filter((m) => m && m.id && !isExcludedModel(providerId, m.id));
}

/**
 * Chọn model có chi phí thấp nhất / miễn phí, tốn ít token nhất nhưng vẫn viết tiếng Việt mượt mà.
 */
export function pickBestEconomicalModel(providerId = 'gemini', availableModels = []) {
  const cfg = getProviderConfig(providerId);
  const candidates = filterEconomicalModels(providerId, availableModels);
  if (candidates.length === 0) return cfg.defaultModel;

  const findMatch = (target) => {
    const exact = candidates.find((m) => m.id.toLowerCase() === target.toLowerCase());
    if (exact) return exact;
    return candidates.find((m) => m.id.toLowerCase().startsWith(target.toLowerCase()));
  };

  if (providerId === 'openrouter') {
    for (const target of cfg.priorityModels) {
      if (target.endsWith(':free')) {
        const match = findMatch(target);
        if (match) return match.id;
      }
    }
    const anyGoodFree = candidates.find((m) => {
      const lower = m.id.toLowerCase();
      return lower.endsWith(':free') && /(gemini|llama|qwen|deepseek|gpt|mistral|gemma)/i.test(lower);
    });
    if (anyGoodFree) return anyGoodFree.id;

    const anyFree = candidates.find((m) => m.id.toLowerCase().endsWith(':free'));
    if (anyFree) return anyFree.id;
  }

  for (const target of cfg.priorityModels) {
    const match = findMatch(target);
    if (match) return match.id;
  }

  if (providerId === 'gemini') {
    const anyFlash = candidates.find((m) => m.id.toLowerCase().includes('flash'));
    if (anyFlash) return anyFlash.id;
  }

  if (providerId === 'openai') {
    const anyMini = candidates.find((m) => /mini|nano/i.test(m.id));
    if (anyMini) return anyMini.id;
  }

  if (providerId === 'groq') {
    const anyFast = candidates.find((m) => /llama|qwen|gemma/i.test(m.id));
    if (anyFast) return anyFast.id;
  }

  return candidates[0].id;
}
