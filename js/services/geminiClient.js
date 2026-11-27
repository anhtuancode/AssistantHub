/**
 * GeminiClient (ES Module)
 * Port từ src/services/geminiService.js — gọi trực tiếp Google Gemini API từ Extension (không qua backend).
 */

import { buildStylePrompt, normalizeStyleConfig, parseCustomCriteria } from '../config/commentStyles.js';
import {
  getProviderConfig,
  filterEconomicalModels,
  pickBestEconomicalModel
} from '../config/aiProviders.js';

class GeminiClient {
  constructor() {
    this.defaultModel = 'auto';
    this.fallbackModel = 'gemini-3.5-flash-lite';
    this._modelsCache = new Map();
    this._lastUsedFallback = false;
  }

  _compactText(text = '') {
    return String(text || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  async _fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(new Error(`Hết thời gian chờ phản hồi (${Math.round(timeoutMs / 1000)}s).`)), timeoutMs)
      : null;
    try {
      return await fetch(url, {
        ...options,
        signal: controller ? controller.signal : undefined
      });
    } catch (err) {
      if (err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')))) {
        throw new Error(`Hết thời gian chờ phản hồi từ API (${Math.round(timeoutMs / 1000)}s).`);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  _scoreModelForAuto(id = '') {
    const lower = String(id || '').toLowerCase();
    const verMatch = lower.match(/gemini-(\d+(?:\.\d+)?)/);
    const ver = verMatch ? parseFloat(verMatch[1]) : 0;
    let score = ver * 100;
    if (lower.includes('flash') && !lower.includes('lite')) score += 30;
    else if (lower.includes('flash-lite')) score += 20;
    else if (lower.includes('pro')) score += 10;
    if (lower.includes('preview') || lower.includes('exp')) score -= 5;
    return score;
  }

  pickBestAutoModel(models = []) {
    if (!Array.isArray(models) || models.length === 0) return this.fallbackModel;
    const sorted = [...models].sort((a, b) => this._scoreModelForAuto(b.id) - this._scoreModelForAuto(a.id));
    return sorted[0].id;
  }

  async listModels(apiKey, { forceRefresh = false } = {}) {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
      return { success: false, error: 'API Key không được để trống.', models: [] };
    }

    const cacheKey = `legacy_gemini:${cleanKey}`;
    const cached = this._modelsCache.get(cacheKey);
    const now = Date.now();
    if (!forceRefresh && cached && cached.models.length > 0 && now - cached.fetchedAt < 10 * 60 * 1000) {
      return { success: true, models: cached.models, recommendedModel: this.pickBestAutoModel(cached.models) };
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    try {
      const response = await this._fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': cleanKey }
      }, 12000);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        const errMsg = data?.error?.message || `HTTP ${response.status}`;
        return { success: false, error: errMsg, models: [] };
      }

      const rawModels = Array.isArray(data.models) ? data.models : [];
      const filtered = rawModels
        .filter((m) => {
          const id = String(m.name || '').replace(/^models\//, '');
          const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
          if (!methods.includes('generateContent')) return false;
          if (!id.startsWith('gemini-')) return false;
          if (/image|tts|embedding|omni|robotics|aqa|native-audio|thinking-exp/i.test(id)) return false;
          return true;
        })
        .map((m) => {
          const id = String(m.name || '').replace(/^models\//, '');
          return {
            id,
            displayName: m.displayName || id,
            description: m.description || ''
          };
        })
        .sort((a, b) => this._scoreModelForAuto(b.id) - this._scoreModelForAuto(a.id));

      this._modelsCache.set(cacheKey, { models: filtered, fetchedAt: now });
      return {
        success: true,
        models: filtered,
        recommendedModel: this.pickBestAutoModel(filtered)
      };
    } catch (err) {
      return { success: false, error: err.message, models: [] };
    }
  }

  async fetchModels(provider = 'gemini', apiKey, { forceRefresh = false } = {}) {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
      return { success: false, error: 'API Key không được để trống.', models: [] };
    }

    const cfg = getProviderConfig(provider);
    const cacheKey = `${cfg.id}:${cleanKey}`;
    const cached = this._modelsCache.get(cacheKey);
    const now = Date.now();
    if (!forceRefresh && cached && cached.models.length > 0 && now - cached.fetchedAt < 10 * 60 * 1000) {
      return {
        success: true,
        provider: cfg.id,
        models: cached.models,
        recommendedModel: pickBestEconomicalModel(cfg.id, cached.models)
      };
    }

    try {
      let rawList = [];
      if (cfg.type === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
        const response = await this._fetchWithTimeout(url, { method: 'GET' }, 12000);
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) {
          return { success: false, error: data?.error?.message || `HTTP ${response.status}`, models: [] };
        }
        const rawModels = Array.isArray(data.models) ? data.models : [];
        rawList = rawModels
          .filter((m) => {
            const id = String(m.name || '').replace(/^models\//, '');
            const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
            return methods.includes('generateContent') && id.startsWith('gemini-');
          })
          .map((m) => {
            const id = String(m.name || '').replace(/^models\//, '');
            return { id, displayName: m.displayName || id, description: m.description || '' };
          });
      } else {
        const response = await this._fetchWithTimeout(cfg.modelsEndpoint, {
          method: 'GET',
          headers: { Authorization: `Bearer ${cleanKey}` }
        }, 12000);
        const data = await response.json().catch(() => null);
        if (!response.ok || !data) {
          return { success: false, error: data?.error?.message || `HTTP ${response.status}`, models: [] };
        }
        const arr = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
        rawList = arr
          .map((m) => ({
            id: m.id || String(m.name || ''),
            displayName: m.name || m.id || '',
            description: m.description || ''
          }))
          .filter((m) => m.id);
      }

      const filtered = filterEconomicalModels(cfg.id, rawList);
      const recommendedModel = pickBestEconomicalModel(cfg.id, filtered);
      // Đưa recommendedModel lên đầu nếu có trong danh sách
      filtered.sort((a, b) => {
        if (a.id === recommendedModel) return -1;
        if (b.id === recommendedModel) return 1;
        return a.id.localeCompare(b.id);
      });

      this._modelsCache.set(cacheKey, { models: filtered, fetchedAt: now });
      return {
        success: true,
        provider: cfg.id,
        models: filtered,
        recommendedModel
      };
    } catch (err) {
      return { success: false, error: err.message, models: [] };
    }
  }

  async resolveModel(apiKey, requestedModel, provider = 'gemini') {
    if (requestedModel && requestedModel !== 'auto') {
      return requestedModel;
    }
    if (provider === 'gemini') {
      const listRes = await this.listModels(apiKey);
      if (listRes.success && listRes.recommendedModel) {
        return listRes.recommendedModel;
      }
      return getProviderConfig('gemini').defaultModel;
    }
    const listRes = await this.fetchModels(provider, apiKey);
    if (listRes.success && listRes.recommendedModel) {
      return listRes.recommendedModel;
    }
    return getProviderConfig(provider).defaultModel;
  }

  async _callOpenAICompatible({
    provider = 'openai',
    apiKey,
    model,
    systemPrompt = '',
    userPrompt = '',
    maxTokens = 1536,
    temperature = 0.7,
    stream = false,
    onChunk = null,
    timeoutMs = 25000
  }) {
    const cfg = getProviderConfig(provider);
    const url = `${cfg.baseUrl}/chat/completions`;
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: this._compactText(systemPrompt) });
    messages.push({ role: 'user', content: this._compactText(userPrompt) });

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    };
    if (cfg.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://lms.mindx.edu.vn';
      headers['X-Title'] = 'MindX Teacher Assistant';
    }

    const response = await this._fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: Boolean(stream)
      })
    }, timeoutMs);

    if (!response.ok) {
      const errData = await response.json().catch(() => null);
      const errMsg = errData?.error?.message || `HTTP ${response.status}`;
      throw new Error(`${cfg.name} lỗi (${model}): ${errMsg}`);
    }

    if (stream && response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let sseBuffer = '';
      let fullText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payloadStr = trimmed.slice(5).trim();
          if (!payloadStr || payloadStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(payloadStr);
            const delta = chunk?.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              if (typeof onChunk === 'function') onChunk(delta, fullText);
            }
          } catch (_) {}
        }
      }
      return fullText.trim();
    }

    const data = await response.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) {
      throw new Error(`${cfg.name} không trả về nội dung.`);
    }
    return text.trim();
  }

  async _callGeminiWithRetry({ apiKey, model, payload, timeoutMs = 25000 }) {
    const geminiFallbacks = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
    const candidates = [model, ...geminiFallbacks.filter((m) => m !== model)];
    let lastError = null;

    for (let i = 0; i < candidates.length; i++) {
      const target = candidates[i];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${target}:generateContent`;
      const bodyPayload = {
        ...payload,
        generationConfig: this._buildGenerationConfig(target, payload.generationConfig?.maxOutputTokens || 1536, payload.generationConfig || {})
      };

      let response;
      try {
        response = await this._fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(bodyPayload)
        }, timeoutMs);
      } catch (err) {
        const reason = err && err.name === 'AbortError'
          ? 'Hết thời gian chờ phản hồi từ Gemini API (timeout).'
          : (err && err.message ? err.message : 'Lỗi kết nối mạng.');
        throw new Error(`Không thể kết nối tới Gemini API (${target}): ${reason}`);
      }

      const data = await response.json().catch(() => null);
      if (response.ok) {
        return { data, usedModel: target };
      }

      const apiErrMsg = data?.error?.message || `HTTP ${response.status}`;
      const is503 = response.status === 503 || /high demand|overloaded|unavailable/i.test(apiErrMsg);
      lastError = new Error(`Gemini API lỗi (${target}): ${apiErrMsg}`);

      if (!is503 || i >= candidates.length - 1) {
        throw lastError;
      }
      this._log('WARN', `[GeminiClient] Model ${target} quá tải (503), tự động chuyển sang ${candidates[i + 1]}...`);
    }

    throw lastError || new Error('Gemini API lỗi không xác định.');
  }

  _log(level, message) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'BG_LOG', payload: { level, message } }).catch(() => {});
      }
    } catch (_) {}
  }

  async testConnection(apiKey, model = this.defaultModel, provider = 'gemini') {
    if (!apiKey || !apiKey.trim()) {
      return { success: false, error: 'API Key không được để trống.' };
    }

    const cleanKey = apiKey.trim();
    const cfg = getProviderConfig(provider);
    const targetModel = await this.resolveModel(cleanKey, model || this.defaultModel, cfg.id);

    try {
      this._log('INFO', `[AIClient] Đang kiểm tra kết nối ${cfg.name} (${targetModel})...`);
      if (cfg.type === 'openai-compatible') {
        await this._callOpenAICompatible({
          provider: cfg.id,
          apiKey: cleanKey,
          model: targetModel,
          userPrompt: 'Trả lời: OK',
          maxTokens: 10,
          temperature: 0,
          timeoutMs: 15000
        });
      } else {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;
        const isGemini3 = String(targetModel || '').toLowerCase().startsWith('gemini-3');
        const response = await this._fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Trả lời: OK' }] }],
            generationConfig: this._buildGenerationConfig(
              targetModel,
              isGemini3 ? 64 : 10,
              isGemini3 ? {} : { temperature: 0 }
            )
          })
        }, 25000);

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const errMsg = (data && data.error && data.error.message) ? data.error.message : `HTTP ${response.status}`;
          this._log('ERROR', `[AIClient] Lỗi kết nối API: ${errMsg}`);
          return { success: false, error: errMsg, resolvedModel: targetModel, provider: cfg.id };
        }
      }

      this._log('INFO', `[AIClient] Kết nối ${cfg.name} (${targetModel}) thành công! ✓`);
      return {
        success: true,
        provider: cfg.id,
        resolvedModel: targetModel,
        message: `Kết nối thành công (${targetModel})!`
      };
    } catch (err) {
      this._log('ERROR', `[AIClient] Ngoại lệ kiểm tra kết nối: ${err.message}`);
      return { success: false, error: err.message, resolvedModel: targetModel, provider: cfg.id };
    }
  }

  async generateSummary(lessonData, apiKey, model = this.defaultModel, provider = 'gemini') {
    const { title = '', sessionNumber = 1, objectives = [], hardwareAndCommands = '', summary = '' } = lessonData || {};

    if (!apiKey || !apiKey.trim()) {
      this._log('INFO', '[AIClient] Không có API Key, sử dụng mẫu chuẩn giáo trình MindX.');
      return this._fallbackSummary(lessonData);
    }

    const cleanKey = apiKey.trim();
    const cfg = getProviderConfig(provider);
    const targetModel = await this.resolveModel(cleanKey, model || this.defaultModel, cfg.id);

    const prompt = this._compactText(`Bạn là Giảng viên Công nghệ tại MindX Technology School. Hãy soạn nội dung tóm tắt buổi học (Summary) gửi lên hệ thống LMS MindX theo chuẩn mực sư phạm, ngắn gọn, rõ ràng, truyền cảm hứng.
Thông tin buổi học:
- Buổi số: ${sessionNumber}
- Tên bài học: ${title}
- Tóm tắt gốc: ${summary}
- Kiến thức & Câu lệnh / Linh kiện: ${hardwareAndCommands}
- Mục tiêu bài học: ${Array.isArray(objectives) ? objectives.join('; ') : objectives}
Yêu cầu output:
- Viết bằng tiếng Việt, chia các mục rõ ràng (Nội dung trọng tâm, Kỹ năng đạt được, Hướng dẫn rèn luyện thêm).
- Độ dài khoảng 3 - 5 câu cô đọng, không dùng ký tự Markdown lạ, văn phong sư phạm ấm áp.`);

    try {
      if (cfg.type === 'openai-compatible') {
        return await this._callOpenAICompatible({
          provider: cfg.id,
          apiKey: cleanKey,
          model: targetModel,
          userPrompt: prompt,
          maxTokens: 600,
          temperature: 0.7,
          timeoutMs: 20000
        });
      }

      const { data } = await this._callGeminiWithRetry({
        apiKey: cleanKey,
        model: targetModel,
        payload: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.7 }
        },
        timeoutMs: 20000
      });
      if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text.trim();
      }
      return this._fallbackSummary(lessonData);
    } catch (err) {
      this._log('WARN', `[AIClient] Lỗi gọi AI Summary (${err.message}), dùng fallback.`);
      return this._fallbackSummary(lessonData);
    }
  }

  classifyCourseType(classCode = '') {
    const upper = String(classCode || '').toUpperCase();
    if (upper.includes('ROB')) {
      const kit = upper.includes('SEMI') ? 'VEX IQ' : 'VEX GO';
      return { group: 'ROB', kit };
    }
    if (upper.includes('C4K')) {
      return { group: 'C4K', kit: null };
    }
    return { group: 'GENERAL', kit: null };
  }

  _cleanSummaryTopic(summary = '', title = '') {
    let raw = String(summary || title || 'nội dung bài học')
      .replace(/\s+/g, ' ')
      .trim();
    raw = raw
      .replace(/^(tóm\s*tắt\s*(buổi\s*học)?|summary|chủ\s*đề|nội\s*dung\s*buổi\s*học)\s*[:\-–]\s*/i, '')
      .replace(/^buổi\s*\d+\s*[:\-–]\s*/i, '')
      .replace(/\.+$/, '')
      .trim();
    return raw || 'nội dung bài học';
  }

  _splitNoteTokens(note = '') {
    const improveKeywords = ['cần ', 'hơi ', 'chưa ', 'nhắc', 'rụt rè', 'chậm', 'nhầm', 'thiếu', 'quên'];
    const tokens = String(note || '')
      .split(/[,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);

    const strengths = [];
    const improvements = [];
    tokens.forEach(t => {
      const lower = t.toLowerCase();
      if (improveKeywords.some(k => lower.includes(k))) {
        improvements.push(lower);
      } else {
        strengths.push(lower);
      }
    });
    return { strengths, improvements };
  }

  _buildGenerationConfig(targetModel, maxOutputTokens = 1536, extra = {}) {
    const lowerModel = String(targetModel || '').toLowerCase();
    const generationConfig = {
      maxOutputTokens,
      ...extra
    };
    if (lowerModel.startsWith('gemini-3')) {
      delete generationConfig.temperature;
      delete generationConfig.topP;
      delete generationConfig.topK;
      generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' };
    } else {
      if (generationConfig.temperature === undefined) generationConfig.temperature = 0.8;
      if (lowerModel.startsWith('gemini-2.5-flash')) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
    }
    return generationConfig;
  }

  _extractStreamingBatchItems(rawText = '') {
    const items = new Map();
    const idRegex = /"id"\s*:\s*(\d+)/g;
    let match;
    while ((match = idRegex.exec(rawText)) !== null) {
      const id = parseInt(match[1], 10);
      const afterId = rawText.slice(match.index + match[0].length);
      const commentKeyMatch = /"comment"\s*:\s*"/.exec(afterId);
      if (!commentKeyMatch) continue;

      let i = commentKeyMatch.index + commentKeyMatch[0].length;
      let out = '';
      let done = false;
      while (i < afterId.length) {
        const ch = afterId[i];
        if (ch === '"') {
          done = true;
          break;
        }
        if (ch === '\\') {
          if (i + 1 >= afterId.length) break;
          const next = afterId[i + 1];
          if (next === 'n') { out += '\n'; i += 2; continue; }
          if (next === 'r') { out += '\r'; i += 2; continue; }
          if (next === 't') { out += '\t'; i += 2; continue; }
          if (next === '"' || next === '\\' || next === '/') { out += next; i += 2; continue; }
          if (next === 'u' && i + 5 < afterId.length) {
            const hex = afterId.slice(i + 2, i + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
              out += String.fromCharCode(parseInt(hex, 16));
              i += 6;
              continue;
            }
          }
          out += next;
          i += 2;
          continue;
        }
        out += ch;
        i++;
      }
      items.set(id, { comment: out, done });
    }
    return items;
  }

  async generateStudentComment(student, lessonData, apiKey, model = this.defaultModel, style = 'standard', provider = 'gemini') {
    const rating = student.rating || 'Khá';
    const note = student.note || '';
    const studentIndex = typeof student.studentIndex === 'number'
      ? student.studentIndex
      : Math.floor(Math.random() * 8);
    const {
      classCode = '',
      title = '',
      sessionNumber = 1,
      summary = ''
    } = lessonData || {};

    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
      throw new Error('Chưa cấu hình API Key AI. Vui lòng vào tab Cấu hình để nhập API Key.');
    }

    const cfg = getProviderConfig(provider);
    const lessonTopic = String(title || `Buổi ${sessionNumber}`).trim();
    const lessonContext = String(summary || '').trim();
    const courseType = this.classifyCourseType(classCode || title);
    const normalizedStyle = normalizeStyleConfig(style);
    const customCriteria = normalizedStyle.mode === 'custom' ? parseCustomCriteria(normalizedStyle.customCriteria) : [];
    const stylePrompt = buildStylePrompt(normalizedStyle);

    const targetModel = await this.resolveModel(cleanKey, model || this.defaultModel, cfg.id);

    const openingStyles = [
      'Mở đầu bằng nhận xét trực tiếp về tinh thần hứng thú và sự tập trung trong giờ học.',
      'Mở đầu bằng lời khen về sự chủ động và tác phong học tập nghiêm túc.',
      'Mở đầu bằng cảm nhận chung về quá trình tiếp thu và tương tác trên lớp.',
      'Mở đầu bằng điểm nổi bật trong thái độ hợp tác và sẵn sàng thử thách bản thân.',
      'Mở đầu bằng sự tiến bộ về tác phong học tập và khả năng giữ nhịp độ cùng cả lớp.',
      'Mở đầu bằng việc ghi nhận sự chăm chỉ, lắng nghe và tinh thần ham học hỏi.',
      'Mở đầu bằng năng lượng tích cực và sự tự tin khi tham gia hoạt động thực hành.',
      'Mở đầu bằng cách đánh giá sự chuẩn bị và thái độ cầu tiến trong suốt buổi học.'
    ];
    const styleVariation = openingStyles[studentIndex % openingStyles.length];

    let criteriaInstructions = '';
    if (customCriteria.length > 0) {
      const kitHint = courseType.group === 'ROB' && courseType.kit ? ` (bộ kit ${courseType.kit})` : '';
      criteriaInstructions = `Ngữ cảnh lớp học: ${classCode || 'N/A'}${kitHint}.
Hãy bám sát hoàn toàn cấu trúc và tiêu chí bắt buộc đã nêu trong System Instruction (${customCriteria.join(', ')}).`;
    } else if (courseType.group === 'ROB') {
      criteriaInstructions = `Đây là lớp Robotics (${classCode || 'ROB'}) sử dụng bộ kit ${courseType.kit}.
Bắt buộc nhận xét phải bám sát đủ 4 tiêu chí sau:
1. Thái độ học tập (sự tập trung, chủ động, tích cực trên lớp).
2. Kỹ năng làm việc nhóm (phối hợp, trao đổi, hỗ trợ bạn cùng nhóm).
3. Kỹ năng lắp ráp và lập trình với ${courseType.kit} bám sát nội dung buổi học (lồng ghép tự nhiên ghi chú riêng của giáo viên).
4. Điều cần cải thiện (góp ý cụ thể, mang tính xây dựng dựa trên phân loại "${rating}" và ghi chú riêng).`;
    } else if (courseType.group === 'C4K') {
      criteriaInstructions = `Đây là lớp Coding for Kids (${classCode || 'C4K'}).
Bắt buộc nhận xét phải bám sát đủ 4 tiêu chí sau:
1. Thái độ học tập (tinh thần học tập, lắng nghe, tương tác trong buổi học).
2. Kỹ năng lập trình bám sát nội dung buổi học (đánh giá khả năng hiểu bài, vận dụng kiến thức và thực hành lập trình).
3. Điều cần cải thiện (điểm cần khắc phục hoặc phát huy thêm dựa trên phân loại "${rating}" và ghi chú riêng của giáo viên).
4. Bài tập về nhà ở Denise (nhắc nhở/đánh giá việc hoàn thành bài tập về nhà trên nền tảng Denise).`;
    } else {
      criteriaInstructions = `Yêu cầu:
- Đánh giá thái độ học tập, kỹ năng thực hành bám sát nội dung buổi học và nêu rõ điều cần cải thiện dựa trên phân loại "${rating}" và ghi chú riêng.`;
    }

    const ratingToneMap = {
      'Giỏi': 'Mức Giỏi: Khen ngợi nổi bật về tư duy/thực hành và khuyến khích thử thách ở mức độ nâng cao hơn.',
      'Khá': 'Mức Khá: Ghi nhận hoàn thành tốt yêu cầu buổi học và gợi ý phát huy thêm sự chủ động, chỉn chu.',
      'Trung bình khá': 'Mức Trung bình khá: Động viên sự cố gắng, ghi nhận phần đã làm được và hướng dẫn rèn thêm kỹ năng trọng tâm.',
      'Trung bình': 'Mức Trung bình: Dùng ngôn ngữ nhẹ nhàng, tích cực, ghi nhận nỗ lực theo kịp bài và hướng dẫn cụ thể phần cần ôn luyện thêm (phù hợp để phụ huynh đọc).',
      'Yếu': 'Mức Yếu: Dùng ngôn ngữ ân cần, khích lệ, tuyệt đối không chê trách nặng nề; chỉ ra nội dung nền tảng cần được thầy cô và phụ huynh hỗ trợ kèm thêm ở nhà.'
    };
    const ratingTone = ratingToneMap[rating] || ratingToneMap['Khá'];

    const isCustomBullets = customCriteria.length > 0 && normalizedStyle.outputFormat === 'bullets';
    const formatRule = isCustomBullets
      ? `- BẮT BUỘC xuất ra đúng ${customCriteria.length} dòng gạch đầu dòng theo mẫu:\n${customCriteria.map(c => `  - ${c}: [nội dung nhận xét]`).join('\n')}\n- TUYỆT ĐỐI KHÔNG gộp thành đoạn văn, KHÔNG bỏ sót hoặc thêm bớt mục nào.`
      : '- Viết thành đoạn văn mượt mà, tự nhiên bằng tiếng Việt, không dùng ký tự Markdown.';

    const systemInstructionText = this._compactText(`Bạn là Giảng viên tại MindX Technology School. Viết nhận xét buổi học cá nhân hóa cho học viên, tuân thủ TUYỆT ĐỐI cấu hình phong cách và định dạng dưới đây:
${stylePrompt}`);

    const prompt = this._compactText(`Viết nhận xét cá nhân hóa (Biến thể #${(studentIndex % 8) + 1}) cho học viên Buổi ${sessionNumber} (Lớp: ${classCode || 'N/A'}).
- Chủ đề: ${lessonTopic}
- Ngữ cảnh bài học (chỉ tổng hợp tự nhiên, KHÔNG trích nguyên văn): ${lessonContext || 'Thực hành theo tiến trình buổi học.'}
- Xếp loại: ${rating} (${ratingTone})
- Ghi chú riêng: ${note || 'Học tập chăm chỉ, tích cực thực hành'}
- Mở đầu: ${styleVariation}
${criteriaInstructions}
Quy tắc bắt buộc:
- TUYỆT ĐỐI KHÔNG chèn tên học viên; chỉ xưng "con"/"Con".
- Lồng ghép ghi chú tự nhiên, không liệt kê thô.
${formatRule}`);

    if (cfg.type === 'openai-compatible') {
      const text = await this._callOpenAICompatible({
        provider: cfg.id,
        apiKey: cleanKey,
        model: targetModel,
        systemPrompt: systemInstructionText,
        userPrompt: prompt,
        maxTokens: 1536,
        temperature: 0.8,
        timeoutMs: 25000
      });
      this._lastUsedFallback = false;
      return text;
    }

    const { data } = await this._callGeminiWithRetry({
      apiKey: cleanKey,
      model: targetModel,
      payload: {
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: this._buildGenerationConfig(targetModel, 1536)
      },
      timeoutMs: 25000
    });

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || !text.trim()) {
      const finishReason = data?.candidates?.[0]?.finishReason || 'NO_CANDIDATES';
      this._log('ERROR', `[AIClient] Gemini API không trả về nội dung (${finishReason}).`);
      throw new Error(`Gemini API không trả về nội dung nhận xét (${finishReason}).`);
    }

    this._lastUsedFallback = false;
    return text.trim();
  }

  async generateBatchComments(students = [], lessonData, apiKey, model = this.defaultModel, style = 'standard', onProgress = null, onStream = null, provider = 'gemini') {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) {
      throw new Error('Chưa cấu hình API Key AI. Vui lòng vào tab Cấu hình để nhập API Key.');
    }

    const cfg = getProviderConfig(provider);
    const resolvedModel = await this.resolveModel(cleanKey, model || this.defaultModel, cfg.id);

    const results = new Array(students.length);
    const presentTasks = [];
    let activeIdx = 0;

    students.forEach((st, originalIndex) => {
      const att = (st.attendance || st.attendanceStatus || '').toUpperCase();
      if (att === 'ABSENT') {
        results[originalIndex] = { name: st.name || st.studentName, comment: '', skipped: true };
      } else {
        const idx = typeof st.studentIndex === 'number' ? st.studentIndex : activeIdx;
        activeIdx++;
        presentTasks.push({ st, originalIndex, studentIndex: idx, batchId: activeIdx - 1 });
      }
    });

    const totalPresent = presentTasks.length;
    if (totalPresent === 0) return results;

    const {
      classCode = '',
      title = '',
      sessionNumber = 1,
      summary = ''
    } = lessonData || {};

    const lessonTopic = String(title || `Buổi ${sessionNumber}`).trim();
    const lessonContext = String(summary || '').trim();
    const courseType = this.classifyCourseType(classCode || title);
    const normalizedStyle = normalizeStyleConfig(style);
    const customCriteria = normalizedStyle.mode === 'custom' ? parseCustomCriteria(normalizedStyle.customCriteria) : [];
    const stylePrompt = buildStylePrompt(normalizedStyle);
    const isCustomBullets = customCriteria.length > 0 && normalizedStyle.outputFormat === 'bullets';

    let courseHint = '';
    if (customCriteria.length === 0) {
      if (courseType.group === 'ROB') {
        courseHint = `Lớp Robotics (${courseType.kit}): đủ 4 ý Thái độ, Làm việc nhóm, Lắp ráp & Lập trình ${courseType.kit}, Điều cần cải thiện.`;
      } else if (courseType.group === 'C4K') {
        courseHint = 'Lớp Coding for Kids: đủ 4 ý Thái độ, Kỹ năng lập trình, Điều cần cải thiện, Nhắc BTVN trên Denise.';
      }
    }

    const formatHint = isCustomBullets
      ? `Mỗi comment BẮT BUỘC đúng ${customCriteria.length} dòng gạch đầu dòng (- ${customCriteria.join(', - ')}), KHÔNG gộp đoạn.`
      : 'Mỗi comment là 1 đoạn văn tự nhiên, KHÔNG Markdown.';

    const systemInstructionText = this._compactText(`Bạn là Giảng viên MindX. Viết nhận xét cá nhân hóa cho từng học viên trong danh sách, chỉ trả về JSON array [{"id": số, "comment": chuỗi}].
${stylePrompt}
Quy tắc: Không chèn tên học viên, chỉ xưng "con"/"Con", không sao chép nguyên khối Summary. ${courseHint} ${formatHint}`);

    const compactStudents = presentTasks.map(({ st, studentIndex, batchId }) => ({
      id: batchId,
      rating: st.rating || 'Khá',
      note: st.note || '',
      variant: (studentIndex % 8) + 1
    }));

    const batchPrompt = this._compactText(`Buổi ${sessionNumber} | Lớp: ${classCode || 'N/A'} | Chủ đề: ${lessonTopic}
Ngữ cảnh bài học: ${lessonContext || 'Thực hành theo tiến trình buổi học.'}
Danh sách học viên (giữ đúng id, viết khác nhau theo variant/note/rating):
${JSON.stringify(compactStudents)}`);

    let fullJsonText = '';
    const lastEmittedText = new Map();
    const completedIds = new Set();

    const emitStreamingUpdates = (rawText) => {
      const extracted = this._extractStreamingBatchItems(rawText);
      for (const [id, info] of extracted.entries()) {
        const task = presentTasks[id];
        if (!task) continue;
        const prev = lastEmittedText.get(id);
        if (prev !== info.comment || (info.done && !completedIds.has(id))) {
          lastEmittedText.set(id, info.comment);
          if (info.done) completedIds.add(id);
          if (typeof onStream === 'function') {
            onStream({
              batchId: id,
              name: task.st.name || task.st.studentName,
              comment: info.comment,
              done: info.done
            });
          }
          if (typeof onProgress === 'function') {
            onProgress({
              current: Math.min(totalPresent, Math.max(1, completedIds.size || id + 1)),
              total: totalPresent,
              studentName: task.st.name || task.st.studentName || ''
            });
          }
        }
      }
    };

    if (typeof onProgress === 'function') {
      onProgress({ current: 1, total: totalPresent, studentName: presentTasks[0].st.name || presentTasks[0].st.studentName || '' });
    }

    if (cfg.type === 'openai-compatible') {
      fullJsonText = await this._callOpenAICompatible({
        provider: cfg.id,
        apiKey: cleanKey,
        model: resolvedModel,
        systemPrompt: systemInstructionText,
        userPrompt: batchPrompt,
        maxTokens: Math.min(8192, Math.max(1536, totalPresent * 320)),
        temperature: 0.8,
        stream: true,
        onChunk: (_delta, accumulated) => emitStreamingUpdates(accumulated),
        timeoutMs: 45000
      });
      emitStreamingUpdates(fullJsonText);
    } else {
      const generationConfig = this._buildGenerationConfig(resolvedModel, 8192, {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'INTEGER' },
              comment: { type: 'STRING' }
            },
            required: ['id', 'comment']
          }
        }
      });

      const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:streamGenerateContent?alt=sse`;
      let response;
      try {
        response = await this._fetchWithTimeout(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            contents: [{ parts: [{ text: batchPrompt }] }],
            generationConfig
          })
        }, 45000);
      } catch (err) {
        const reason = err && err.name === 'AbortError'
          ? 'Hết thời gian chờ phản hồi từ Gemini API (timeout).'
          : (err && err.message ? err.message : 'Lỗi kết nối mạng.');
        this._log('ERROR', `[AIClient] Lỗi kết nối Gemini API (${resolvedModel}): ${reason}`);
        throw new Error(`Không thể kết nối tới Gemini API (${resolvedModel}): ${reason}`);
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        const apiErrMsg = errData?.error?.message || `HTTP ${response.status}`;
        this._log('ERROR', `[AIClient] Gemini API lỗi (${resolvedModel}): ${apiErrMsg}`);
        throw new Error(`Gemini API lỗi (${resolvedModel}): ${apiErrMsg}`);
      }

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let sseBuffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          const lines = sseBuffer.split(/\r?\n/);
          sseBuffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payloadStr = trimmed.slice(5).trim();
            if (!payloadStr || payloadStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payloadStr);
              const partText = chunk?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (partText) {
                fullJsonText += partText;
                emitStreamingUpdates(fullJsonText);
              }
            } catch (_) {}
          }
        }
      } else {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data)) {
          fullJsonText = data.map(c => c?.candidates?.[0]?.content?.parts?.[0]?.text || '').join('');
        } else {
          fullJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
        emitStreamingUpdates(fullJsonText);
      }
    }

    let parsedArray = [];
    try {
      const cleaned = fullJsonText.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      const jsonSlice = firstBracket !== -1 && lastBracket > firstBracket
        ? cleaned.slice(firstBracket, lastBracket + 1)
        : cleaned;
      const parsed = JSON.parse(jsonSlice);
      if (Array.isArray(parsed)) parsedArray = parsed;
    } catch (_) {}

    const byId = new Map();
    parsedArray.forEach((item) => {
      if (item && typeof item.id === 'number' && typeof item.comment === 'string' && item.comment.trim()) {
        byId.set(item.id, item.comment.trim());
      }
    });

    // Fallback per-student only for any item missing from the single batch JSON
    const missingTasks = [];
    presentTasks.forEach((task) => {
      const comment = byId.get(task.batchId);
      if (comment) {
        results[task.originalIndex] = {
          name: task.st.name || task.st.studentName,
          comment,
          skipped: false
        };
      } else {
        missingTasks.push(task);
      }
    });

    if (missingTasks.length > 0) {
      await Promise.all(missingTasks.map(async (task) => {
        const comment = await this.generateStudentComment(
          { ...task.st, studentIndex: task.studentIndex },
          lessonData,
          cleanKey,
          resolvedModel,
          style,
          cfg.id
        );
        results[task.originalIndex] = {
          name: task.st.name || task.st.studentName,
          comment,
          skipped: false
        };
        if (typeof onStream === 'function') {
          onStream({
            batchId: task.batchId,
            name: task.st.name || task.st.studentName,
            comment,
            done: true
          });
        }
      }));
    }

    this._lastUsedFallback = false;
    return results;
  }

  _fallbackSummary(lessonData) {
    const { title = 'Nội dung bài học', sessionNumber = 1, hardwareAndCommands = '', summary = '' } = lessonData || {};
    return `Buổi ${sessionNumber}: ${title}.
- Nội dung trọng tâm: ${summary || 'Nắm vững kiến thức và hoàn thiện sản phẩm thực hành theo tiến trình buổi học.'}
- Kiến thức & Câu lệnh / Linh kiện: ${hardwareAndCommands || 'Linh kiện và câu lệnh lập trình theo bài học.'}
- Đánh giá chung: Cả lớp tham gia học tập tích cực, trao đổi sôi nổi và đạt mục tiêu bài giảng đề ra.`;
  }

  _buildCustomCriterionSentence(criterion, { rating, strengths, improvements, topicText, courseType, v }) {
    const lower = String(criterion || '').toLowerCase();
    const isHigh = rating === 'Giỏi';
    const isSupportive = rating === 'Trung bình' || rating === 'Yếu';
    const kit = (courseType && courseType.kit) || 'VEX GO';

    if (/thái độ|chuyên cần|tập trung|tinh thần|ý thức/.test(lower)) {
      const s = strengths.length > 0 ? ` (${strengths.join(', ')})` : '';
      if (isHigh) return `Con giữ thái độ học tập rất nghiêm túc, tập trung cao độ và chủ động tương tác${s}.`;
      if (isSupportive) return `Con ngoan ngoãn lắng nghe hướng dẫn, cần rèn thêm sự tập trung để bắt nhịp nhanh hơn.`;
      return `Con có ý thức học tập tốt, tích cực lắng nghe và tham gia các hoạt động trên lớp${s}.`;
    }
    if (/nhóm|hợp tác|phối hợp|giao tiếp/.test(lower)) {
      if (isHigh) return `Con phối hợp rất ăn ý, chủ động trao đổi và hỗ trợ các bạn cùng nhóm hiệu quả.`;
      if (isSupportive) return `Con bước đầu biết lắng nghe bạn cùng nhóm, cần mạnh dạn trao đổi ý kiến hơn nữa.`;
      return `Con hợp tác tốt với các bạn trong nhóm, biết chia sẻ nhiệm vụ và cùng hoàn thành bài thực hành.`;
    }
    if (/lắp ráp|cơ khí|mô hình|kỹ thuật|kit/.test(lower)) {
      if (isHigh) return `Con thao tác lắp ráp ${kit} rất khéo léo, chắc chắn và chính xác theo yêu cầu bài "${topicText}".`;
      if (isSupportive) return `Con đang làm quen với các bước lắp ráp ${kit} cơ bản, cần rèn thêm sự tỉ mỉ khi ghép nối.`;
      return `Con lắp ráp mô hình ${kit} đúng kỹ thuật, hoàn thành sản phẩm bám sát chủ đề "${topicText}".`;
    }
    if (/lập trình|code|thuật toán|logic|tư duy|sản phẩm|denise/.test(lower)) {
      if (isHigh) return `Con nắm vững tư duy logic, viết chương trình mạch lạc và vận dụng rất linh hoạt trong bài "${topicText}".`;
      if (isSupportive) return `Con bước đầu làm quen với các câu lệnh cơ bản, cần luyện tập thêm để nhớ chắc luồng logic.`;
      return `Con hiểu bài và vận dụng tốt kiến thức lập trình để hoàn thiện yêu cầu của chủ đề "${topicText}".`;
    }
    if (/cải thiện|khắc phục|lưu ý|rèn|nhắn|buổi sau|về nhà/.test(lower)) {
      if (improvements.length > 0) {
        return `Con lưu ý ${improvements.join(', ')} để bài làm ở các buổi tới hoàn chỉnh hơn nữa nhé.`;
      }
      if (isHigh) return `Con có thể thử sức thêm các yêu cầu nâng cao để phát huy tối đa khả năng sáng tạo ở buổi sau.`;
      if (isSupportive) return `Con cần dành thêm thời gian ôn lại kiến thức nền tảng ở nhà để tự tin hơn trong buổi học tới.`;
      return `Con hãy kiểm tra kỹ lại từng bước thực hành trước khi chạy thử để hạn chế sai sót nhỏ nhé.`;
    }
    if (/điểm mạnh|ưu điểm|nổi bật/.test(lower)) {
      const s = strengths.length > 0 ? strengths.join(', ') : 'sự chăm chỉ và tinh thần ham học hỏi';
      return `Con thể hiện rõ ${s} trong suốt quá trình thực hành chủ đề "${topicText}".`;
    }

    return `Con hoàn thành tốt nội dung liên quan đến ${criterion.toLowerCase()} trong chủ đề "${topicText}"${v % 2 === 0 ? ' với tinh thần cầu tiến.' : '.'}`;
  }

  _fallbackStudentComment(studentName, rating, note, title, context = {}) {
    const {
      summary = '',
      courseType = { group: 'GENERAL', kit: null },
      studentIndex = 0,
      styleConfig = null
    } = context;
    const topicText = this._cleanSummaryTopic(summary, title);
    const { strengths, improvements } = this._splitNoteTokens(note);
    const v = Math.abs(Number(studentIndex) || 0) % 8;

    const cfg = normalizeStyleConfig(styleConfig);
    if (cfg.mode === 'custom') {
      const criteria = parseCustomCriteria(cfg.customCriteria);
      if (criteria.length > 0) {
        const lines = criteria.map((criterion) => {
          const sentence = this._buildCustomCriterionSentence(criterion, {
            rating,
            strengths,
            improvements,
            topicText,
            courseType,
            v
          });
          return cfg.outputFormat === 'bullets' ? `- ${criterion}: ${sentence}` : sentence;
        });
        return cfg.outputFormat === 'bullets' ? lines.join('\n') : lines.join(' ');
      }
    }

    if (cfg.mode === 'preset' && cfg.presetId === 'concise') {
      const s = strengths.length > 0 ? ` với điểm mạnh ${strengths.join(', ')}` : '';
      const imp = improvements.length > 0 ? ` Con lưu ý ${improvements.join(', ')} nhé.` : ' Con tiếp tục phát huy ở buổi tới nhé.';
      return `Buổi học hôm nay con tham gia tích cực${s} và hoàn thành nội dung "${topicText}".${imp}`;
    }

    const strengthClause = strengths.length > 0
      ? ` nhờ thế mạnh ${strengths.join(' và ')}`
      : '';
    const improveClause = improvements.length > 0
      ? `Con lưu ý ${improvements.join(', ')} để bài làm hoàn chỉnh hơn nữa nhé.`
      : '';

    const openingsGood = [
      `Trong buổi học hôm nay, con giữ được thái độ học tập tích cực và tinh thần cầu tiến${strengthClause}.`,
      `Con bước vào giờ học với sự tập trung ổn định, luôn lắng nghe và làm theo hướng dẫn của thầy cô${strengthClause}.`,
      `Buổi học hôm nay ghi nhận sự chủ động rất đáng khen của con trong các hoạt động trên lớp${strengthClause}.`,
      `Con duy trì nhịp độ học tập rất tốt, tương tác cởi mở và hoàn thành các nhiệm vụ đúng tiến độ${strengthClause}.`,
      `Thái độ học tập nghiêm túc cùng tinh thần ham học hỏi giúp con tiếp thu bài giảng khá nhẹ nhàng${strengthClause}.`,
      `Hôm nay con thể hiện sự tự tin rõ rệt, chăm chú theo dõi bài giảng và tích cực thực hành${strengthClause}.`,
      `Con có tinh thần học tập rất trách nhiệm, biết cách tự điều chỉnh tốc độ để theo kịp cả lớp${strengthClause}.`,
      `Trong suốt buổi học, con giữ được sự hứng thú và thái độ hợp tác tốt cùng thầy cô${strengthClause}.`
    ];

    const openingsExcellent = [
      `Con có một buổi học thật sự nổi bật với sự tập trung cao độ và năng lượng tích cực${strengthClause}.`,
      `Hôm nay con thể hiện phong độ rất ấn tượng, luôn đi đầu trong các hoạt động thực hành trên lớp${strengthClause}.`,
      `Tinh thần học tập xuất sắc và sự nhanh nhạy giúp con làm chủ kiến thức buổi học rất sớm${strengthClause}.`,
      `Con học tập cực kỳ chủ động, say mê khám phá và luôn sẵn sàng thử thách ở mức độ cao hơn${strengthClause}.`,
      `Buổi học hôm nay con tỏa sáng với thái độ nghiêm túc, tự tin và khả năng tiếp thu vượt trội${strengthClause}.`,
      `Con duy trì sự tập trung tuyệt vời từ đầu đến cuối giờ, tạo động lực tích cực cho cả lớp${strengthClause}.`,
      `Hôm nay con hoàn thành xuất sắc mọi yêu cầu bài học với tư duy rất sắc bén${strengthClause}.`,
      `Con thể hiện niềm đam mê công nghệ rõ nét qua sự chủ động và kết quả thực hành ấn tượng${strengthClause}.`
    ];

    const openingsFair = [
      `Con có tinh thần chăm chỉ và cố gắng hoàn thành các phần thực hành cơ bản trong buổi học${strengthClause}.`,
      `Hôm nay con giữ được thái độ ngoan ngoãn, lắng nghe giảng nhưng cần mạnh dạn tương tác hơn nữa.`,
      `Con đã nỗ lực theo dõi bài học và từng bước hoàn thiện sản phẩm theo hướng dẫn của thầy cô.`,
      `Trong giờ học, con có sự cố gắng nhất định, tuy nhiên cần giữ nhịp tập trung ổn định hơn ở phần thực hành.`,
      `Con tham gia buổi học khá đều đặn, biết lắng nghe góp ý để chỉnh sửa dần bài làm của mình.`,
      `Thái độ học tập của con khá nhẹ nhàng, nếu chủ động đặt câu hỏi hơn con sẽ tiến bộ rất nhanh.`,
      `Con đã hoàn thành được mục tiêu nền tảng của buổi học và đang dần quen với cách tư duy mới.`,
      `Hôm nay con có ý thức làm bài, chỉ cần tăng thêm sự tự tin khi trao đổi trên lớp.`
    ];

    const openingsSupportive = [
      `Trong buổi học hôm nay, con có sự cố gắng theo dõi bài giảng và cần thêm thời gian ôn luyện để nắm chắc kiến thức hơn.`,
      `Con giữ được thái độ ngoan ngoãn, lắng nghe hướng dẫn của thầy cô và đang từng bước làm quen với nội dung mới.`,
      `Hôm nay con đã nỗ lực hoàn thành các bước cơ bản dưới sự hỗ trợ của thầy cô, cần rèn luyện thêm để thao tác tự tin hơn.`,
      `Con tham gia giờ học với tinh thần hợp tác, nếu ôn lại kiến thức nền tảng đều đặn con sẽ tiến bộ rất rõ rệt.`,
      `Trong suốt buổi học, con chú ý lắng nghe nhưng tốc độ thực hành còn hơi chậm, thầy cô sẽ tiếp tục hỗ trợ con ở buổi tới.`,
      `Con có ý thức cố gắng trong giờ học, rất mong phụ huynh cùng nhắc nhở con xem lại bài để con bắt nhịp nhanh hơn.`,
      `Hôm nay con đã làm quen được với các khái niệm mở đầu, cần thực hành thêm ở nhà để nhớ chắc cách vận dụng.`,
      `Con giữ thái độ học tập tích cực, cần rèn thêm tính kiên nhẫn và hỏi thầy cô ngay khi gặp phần chưa rõ.`
    ];

    const isHigh = rating === 'Giỏi';
    const isSupportive = rating === 'Trung bình' || rating === 'Yếu';
    const attitude = isHigh
      ? openingsExcellent[v]
      : (isSupportive ? openingsSupportive[v] : (rating === 'Trung bình khá' ? openingsFair[v] : openingsGood[v]));

    if (courseType.group === 'ROB') {
      const kit = courseType.kit || 'VEX GO';
      const teamBodies = [
        `Khi làm việc nhóm, con phối hợp nhịp nhàng và biết chia sẻ nhiệm vụ với các bạn.`,
        `Về kỹ năng làm việc nhóm, con lắng nghe ý kiến của bạn cùng nhóm và hỗ trợ nhau rất tốt.`,
        `Trong quá trình hoạt động nhóm, con trao đổi cởi mở để cùng bạn tháo gỡ các vấn đề phát sinh.`,
        `Con hợp tác ăn ý với đồng đội, biết phân công công việc hợp lý khi thực hành.`,
        `Kỹ năng làm việc nhóm của con tiến bộ rõ rệt qua việc chủ động trao đổi và hỗ trợ bạn.`,
        `Con giữ được tinh thần đồng đội tốt, luôn cùng bạn kiểm tra lại kết quả chung.`,
        `Ở phần làm việc nhóm, con giao tiếp tích cực và đóng góp nhiều ý tưởng hữu ích.`,
        `Con biết lắng nghe và phối hợp nhịp nhàng cùng các thành viên để hoàn thành thử thách.`
      ];
      const robSkills = [
        `Với bộ kit ${kit} trong chủ đề "${topicText}", con lắp ráp chắc chắn và lập trình chạy đúng kịch bản.`,
        `Khi lắp ráp và lập trình ${kit} ở nội dung "${topicText}", con thao tác đúng kỹ thuật và xử lý logic khá mượt.`,
        `Ở phần thực hành ${kit} theo chủ đề "${topicText}", con biết cách kết nối cơ cấu và viết lệnh điều khiển hợp lý.`,
        `Thông qua chủ đề "${topicText}", con vận dụng thành thạo bộ kit ${kit} từ khâu lắp ráp đến lập trình vận hành.`,
        `Con thể hiện khả năng lắp ráp và lập trình với ${kit} rất ổn định khi thực hiện dự án "${topicText}".`,
        `Trong bài thực hành "${topicText}", con kiểm soát tốt từng bước lắp ráp cũng như câu lệnh trên ${kit}.`,
        `Với nội dung "${topicText}", con thao tác khéo léo trên bộ kit ${kit} và đưa ra giải pháp lập trình phù hợp.`,
        `Con nắm chắc quy trình lắp ráp và lập trình ${kit}, giúp sản phẩm ở chủ đề "${topicText}" hoạt động hiệu quả.`
      ];
      const robImprove = improveClause || (
        rating === 'Giỏi'
          ? `Để bứt phá hơn, con hãy thử tối ưu thêm cấu trúc cơ khí và viết thuật toán linh hoạt hơn trên ${kit} ở buổi tới.`
          : (isSupportive
            ? `Con cần ôn lại các bước lắp ráp cơ bản và luyện tập thêm phần lập trình ${kit} tại nhà để tự tin hơn ở buổi học sau.`
            : (rating === 'Trung bình khá'
              ? `Con cần rèn thêm sự tỉ mỉ khi kiểm tra khớp nối và rà soát từng khối lệnh trên ${kit} trước khi chạy thử.`
              : `Buổi tới con hãy chú ý kiểm tra lại độ chắc của các mối ghép và thử nghiệm thêm nhiều tình huống trên ${kit} nhé.`))
      );
      return `${attitude} ${teamBodies[v]} ${robSkills[v]} ${robImprove}`;
    }

    if (courseType.group === 'C4K') {
      const c4kSkills = [
        `Về kỹ năng lập trình ở chủ đề "${topicText}", con hiểu rõ bản chất và vận dụng câu lệnh khá linh hoạt.`,
        `Trong phần thực hành chủ đề "${topicText}", con nắm chắc kiến thức trọng tâm và tự tay hoàn thiện sản phẩm.`,
        `Với chủ đề "${topicText}", con biết cách phân tích yêu cầu và chuyển hóa thành các bước lập trình hợp lý.`,
        `Ở nội dung "${topicText}", con thao tác lập trình mạch lạc và xử lý tốt các tình huống trong bài.`,
        `Con tiếp cận chủ đề "${topicText}" khá nhanh, biết áp dụng kiến thức mới vào sản phẩm thực hành.`,
        `Khi lập trình bài "${topicText}", con giữ được tư duy logic ổn định và hoàn thành đúng yêu cầu đề ra.`,
        `Thông qua chủ đề "${topicText}", con cho thấy khả năng vận dụng kiến thức lập trình ngày càng chắc tay hơn.`,
        `Con thực hành khá tốt các kỹ thuật lập trình trong chủ đề "${topicText}" và tạo ra sản phẩm hoàn chỉnh.`
      ];
      const c4kImprove = improveClause || (
        rating === 'Giỏi'
          ? `Con có thể sáng tạo thêm các tính năng mở rộng để sản phẩm của mình thêm phần độc đáo.`
          : (isSupportive
            ? `Con cần dành thêm thời gian xem lại các ví dụ mẫu và thực hành lại từng bước cơ bản để vững kiến thức hơn.`
            : (rating === 'Trung bình khá'
              ? `Con cần rà soát kỹ thứ tự các câu lệnh để hạn chế lỗi logic nhỏ khi chạy chương trình.`
              : `Con hãy luyện thêm tốc độ thao tác và kiểm tra kỹ kết quả chạy thử sau mỗi bước lập trình nhé.`))
      );
      const deniseReminders = [
        `Con nhớ hoàn thành đầy đủ bài tập về nhà ở Denise trước buổi học tới nhé!`,
        `Thầy/Cô nhắc con dành thời gian làm bài tập về nhà trên Denise để củng cố kiến thức buổi này.`,
        `Con đừng quên truy cập Denise hoàn thành phần bài tập về nhà đúng hạn nhé!`,
        `Về nhà con nhớ ôn lại bài và làm đầy đủ bài tập trên nền tảng Denise.`,
        `Con hãy hoàn thành sớm bài tập về nhà ở Denise để chuẩn bị thật tốt cho buổi học sau.`,
        `Thầy/Cô mong con duy trì thói quen làm bài tập về nhà đầy đủ trên Denise nhé!`,
        `Con nhớ kiểm tra và hoàn thiện các bài tập thực hành ở Denise trước khi đến lớp buổi tới.`,
        `Con dành chút thời gian hoàn thành bài tập về nhà trên Denise để ghi nhớ bài lâu hơn nhé!`
      ];
      return `${attitude} ${c4kSkills[v]} ${c4kImprove} ${deniseReminders[v]}`;
    }

    const genImprove = improveClause || `Con tiếp tục phát huy điểm mạnh và rèn luyện thêm ở nhà để buổi tới tự tin hơn nữa nhé.`;
    return `${attitude} Trong chủ đề "${topicText}", con hoàn thành tốt phần thực hành theo tiến trình. ${genImprove}`;
  }
}

export const geminiClient = new GeminiClient();
