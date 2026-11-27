/**
 * Page 1: Cấu hình & Bảo mật (Config Tab Controller)
 * Quản lý thông tin tài khoản MindX LMS và cấu hình Google Gemini API Key.
 */

import { toast } from '../services/toast.js';
import { ICONS } from '../services/icons.js';
import { apiRequest } from '../services/apiBridge.js';
import {
  COMMENT_PRESETS,
  CUSTOM_CRITERIA_TEMPLATES,
  DEFAULT_COMMENT_STYLE_CONFIG,
  loadCommentStyleConfig,
  saveCommentStyleConfig
} from '../config/commentStyles.js';
import {
  getProviderConfig,
  detectProviderFromKey,
  pickBestEconomicalModel
} from '../config/aiProviders.js';

const STORAGE_KEY_LMS = 'mindx_lms_config';
const STORAGE_KEY_GEMINI = 'mindx_gemini_config';
const STORAGE_KEY_GEMINI_MODELS = 'mindx_gemini_models_cache';
const STORAGE_KEY_AI_MODELS_BY_PROVIDER = 'mindx_ai_models_by_provider';

const DEFAULT_API_KEYS = { gemini: '', openai: '', groq: '', deepseek: '', openrouter: '' };
const DEFAULT_PROVIDER_MODELS = { gemini: 'auto', openai: 'auto', groq: 'auto', deepseek: 'auto', openrouter: 'auto' };

let currentCommentStyleConfig = { ...DEFAULT_COMMENT_STYLE_CONFIG };
let isCommentStyleBound = false;
let manualProviderSelected = false;
let autoFetchTimer = null;
let aiState = {
  provider: 'gemini',
  apiKeys: { ...DEFAULT_API_KEYS },
  models: { ...DEFAULT_PROVIDER_MODELS }
};
let modelsByProvider = {};

function readChromeStorage(key) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(key, (res) => resolve(res ? res[key] : undefined));
        return;
      }
    } catch (_) {}
    resolve(undefined);
  });
}

function writeChromeStorage(key, value) {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [key]: value });
    }
  } catch (_) {}
}

function persistAiConfig() {
  const activeProvider = aiState.provider || 'gemini';
  const payload = {
    provider: activeProvider,
    key: aiState.apiKeys[activeProvider] || '',
    model: aiState.models[activeProvider] || 'auto',
    apiKeys: { ...DEFAULT_API_KEYS, ...aiState.apiKeys },
    models: { ...DEFAULT_PROVIDER_MODELS, ...aiState.models }
  };
  try {
    localStorage.setItem(STORAGE_KEY_GEMINI, JSON.stringify(payload));
  } catch (_) {}
  writeChromeStorage(STORAGE_KEY_GEMINI, payload);
}

function persistModelsCache(providerId, models) {
  modelsByProvider[providerId] = models;
  try {
    localStorage.setItem(STORAGE_KEY_AI_MODELS_BY_PROVIDER, JSON.stringify(modelsByProvider));
    if (providerId === 'gemini') {
      localStorage.setItem(STORAGE_KEY_GEMINI_MODELS, JSON.stringify(models));
    }
  } catch (_) {}
  writeChromeStorage(STORAGE_KEY_AI_MODELS_BY_PROVIDER, modelsByProvider);
}

function updateProviderUI(providerId) {
  const cfg = getProviderConfig(providerId);
  const badge = document.getElementById('cfg-ai-provider-badge');
  const keyInp = document.getElementById('cfg-gemini-key');
  const providerSel = document.getElementById('cfg-ai-provider');
  if (providerSel && providerSel.value !== cfg.id) providerSel.value = cfg.id;
  if (badge) badge.textContent = cfg.badge || cfg.name;
  if (keyInp) keyInp.placeholder = cfg.placeholder || 'Nhập API Key...';
}

function setAutoModelNote(modelName = '') {
  const noteEl = document.getElementById('cfg-ai-auto-model-note');
  if (!noteEl) return;
  if (!modelName) {
    noteEl.style.display = 'none';
    noteEl.textContent = '';
    return;
  }
  noteEl.style.display = 'block';
  noteEl.textContent = `✨ Tự động chọn: ${modelName} (Tối ưu tốc độ & tiết kiệm token)`;
}

function populateGeminiModelOptions(models = [], preferredValue = null) {
  const modelSel = document.getElementById('cfg-gemini-model');
  if (!modelSel) return;

  const currentVal = preferredValue || modelSel.value || 'auto';
  modelSel.innerHTML = '';

  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = 'Tự động (Khuyên dùng — Tối ưu tốc độ & token)';
  modelSel.appendChild(autoOpt);

  models.forEach((m) => {
    if (!m || !m.id) return;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id;
    modelSel.appendChild(opt);
  });

  const hasOption = Array.from(modelSel.options).some(opt => opt.value === currentVal);
  modelSel.value = hasOption ? currentVal : 'auto';
}

export async function initConfigTab() {
  await loadSavedConfigs();
  bindConfigEvents();
  currentCommentStyleConfig = await loadCommentStyleConfig();
  renderCommentStyleUI();
  bindCommentStyleEvents();
}

async function loadSavedConfigs() {
  try {
    const lmsRaw = localStorage.getItem(STORAGE_KEY_LMS);
    if (lmsRaw) {
      const lms = JSON.parse(lmsRaw);
      const urlSel = document.getElementById('cfg-lms-url');
      const emailInp = document.getElementById('cfg-lms-email');
      const nameInp = document.getElementById('cfg-lms-name');
      const passInp = document.getElementById('cfg-lms-pass');

      if (urlSel && lms.url) urlSel.value = lms.url;
      if (emailInp && lms.email) emailInp.value = lms.email;
      if (nameInp && lms.name) nameInp.value = lms.name;
      if (passInp && lms.pass) passInp.value = lms.pass;
    }

    const chromeModels = await readChromeStorage(STORAGE_KEY_AI_MODELS_BY_PROVIDER);
    if (chromeModels && typeof chromeModels === 'object') {
      modelsByProvider = chromeModels;
    } else {
      const localModelsRaw = localStorage.getItem(STORAGE_KEY_AI_MODELS_BY_PROVIDER);
      if (localModelsRaw) {
        modelsByProvider = JSON.parse(localModelsRaw) || {};
      } else {
        const legacyRaw = localStorage.getItem(STORAGE_KEY_GEMINI_MODELS);
        if (legacyRaw) {
          const legacyModels = JSON.parse(legacyRaw);
          if (Array.isArray(legacyModels) && legacyModels.length > 0) {
            modelsByProvider.gemini = legacyModels;
          }
        }
      }
    }

    const chromeCfg = await readChromeStorage(STORAGE_KEY_GEMINI);
    const localCfgRaw = localStorage.getItem(STORAGE_KEY_GEMINI);
    const saved = chromeCfg || (localCfgRaw ? JSON.parse(localCfgRaw) : null);

    if (saved && typeof saved === 'object') {
      const provider = saved.provider || 'gemini';
      aiState.provider = provider;
      aiState.apiKeys = { ...DEFAULT_API_KEYS, ...(saved.apiKeys || {}) };
      aiState.models = { ...DEFAULT_PROVIDER_MODELS, ...(saved.models || {}) };
      if (saved.key && !aiState.apiKeys[provider]) {
        aiState.apiKeys[provider] = saved.key;
      }
      if (saved.model && !saved.models?.[provider]) {
        aiState.models[provider] = saved.model;
      }
    }

    const activeProvider = aiState.provider || 'gemini';
    updateProviderUI(activeProvider);

    const keyInp = document.getElementById('cfg-gemini-key');
    if (keyInp) keyInp.value = aiState.apiKeys[activeProvider] || '';

    const cachedList = modelsByProvider[activeProvider] || [];
    populateGeminiModelOptions(cachedList, aiState.models[activeProvider] || 'auto');
  } catch (err) {
    console.warn('[Config] Lỗi đọc cấu hình:', err);
  }
}

export function getLmsConfig() {
  const urlSel = document.getElementById('cfg-lms-url');
  const emailInp = document.getElementById('cfg-lms-email');
  const nameInp = document.getElementById('cfg-lms-name');
  const passInp = document.getElementById('cfg-lms-pass');

  return {
    url: urlSel ? urlSel.value : 'https://lms.mindx.edu.vn',
    email: emailInp ? emailInp.value.trim() : '',
    name: nameInp ? nameInp.value.trim() : '',
    pass: passInp ? passInp.value : ''
  };
}

export function getGeminiConfig() {
  const providerSel = document.getElementById('cfg-ai-provider');
  const keyInp = document.getElementById('cfg-gemini-key');
  const modelSel = document.getElementById('cfg-gemini-model');

  const provider = (providerSel ? providerSel.value : aiState.provider) || 'gemini';
  let key = keyInp ? keyInp.value.trim() : (aiState.apiKeys[provider] || '');
  let model = modelSel ? modelSel.value : (aiState.models[provider] || 'auto');

  if (!key) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_GEMINI) || '{}');
      const savedKey = (saved.apiKeys && saved.apiKeys[provider]) || (saved.provider === provider ? saved.key : '') || '';
      if (typeof savedKey === 'string' && savedKey.trim()) {
        key = savedKey.trim();
        if (keyInp) keyInp.value = key;
      }
      const savedModel = (saved.models && saved.models[provider]) || saved.model;
      if ((!model || model === 'auto') && savedModel) {
        model = savedModel;
      }
    } catch (_) {}
  }

  return {
    provider,
    key,
    model: model || 'auto',
    apiKeys: { ...DEFAULT_API_KEYS, ...aiState.apiKeys, [provider]: key }
  };
}

function bindConfigEvents() {
  // Toggle password eye icons
  const toggleLmsPass = document.getElementById('btn-toggle-lms-pass');
  const lmsPassInp = document.getElementById('cfg-lms-pass');
  if (toggleLmsPass && lmsPassInp) {
    toggleLmsPass.onclick = () => {
      const isPass = lmsPassInp.type === 'password';
      lmsPassInp.type = isPass ? 'text' : 'password';
      toggleLmsPass.innerHTML = isPass ? ICONS.eyeOff(16) : ICONS.eye(16);
    };
  }

  const toggleGeminiKey = document.getElementById('btn-toggle-gemini-key');
  const geminiKeyInp = document.getElementById('cfg-gemini-key');
  if (toggleGeminiKey && geminiKeyInp) {
    toggleGeminiKey.onclick = () => {
      const isPass = geminiKeyInp.type === 'password';
      geminiKeyInp.type = isPass ? 'text' : 'password';
      toggleGeminiKey.innerHTML = isPass ? ICONS.eyeOff(16) : ICONS.eye(16);
    };
  }

  // Tự động lưu khi gõ phím
  const lmsInputs = ['cfg-lms-url', 'cfg-lms-email', 'cfg-lms-name', 'cfg-lms-pass'];
  lmsInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        localStorage.setItem(STORAGE_KEY_LMS, JSON.stringify(getLmsConfig()));
      });
    }
  });

  const providerSel = document.getElementById('cfg-ai-provider');
  const modelSel = document.getElementById('cfg-gemini-model');

  async function fetchAndSelectOptimalModels(providerId, apiKey, { silent = false } = {}) {
    const cleanKey = String(apiKey || '').trim();
    if (!cleanKey) return;

    const btnRefresh = document.getElementById('btn-cfg-refresh-models');
    const oldText = btnRefresh ? btnRefresh.textContent : '↻ Tải model';
    if (btnRefresh) {
      btnRefresh.disabled = true;
      btnRefresh.textContent = '⏳ Đang tải...';
    }

    try {
      const data = await apiRequest('/api/gemini/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey: cleanKey, forceRefresh: true })
      });

      if (data.success && Array.isArray(data.models) && data.models.length > 0) {
        const bestModel = pickBestEconomicalModel(providerId, data.models) || data.recommendedModel;
        persistModelsCache(providerId, data.models);
        populateGeminiModelOptions(data.models, bestModel);
        aiState.models[providerId] = bestModel;
        persistAiConfig();

        const matchedObj = data.models.find((m) => m.id === bestModel);
        const displayLabel = matchedObj && matchedObj.displayName && matchedObj.displayName !== matchedObj.id
          ? `${matchedObj.displayName} (${matchedObj.id})`
          : bestModel;
        setAutoModelNote(displayLabel);
        if (!silent) {
          toast.success(`Đã tải ${data.models.length} model (Tự động chọn: ${bestModel}).`);
        }
      } else if (!silent) {
        toast.error(`Không thể tải danh sách model: ${data.error || 'Vui lòng kiểm tra lại API Key.'}`);
      }
    } catch (err) {
      if (!silent) toast.error(`Lỗi tải model: ${err.message}`);
    } finally {
      if (btnRefresh) {
        btnRefresh.disabled = false;
        btnRefresh.textContent = oldText;
      }
    }
  }

  function scheduleAutoDetectAndFetch(rawKey) {
    const cleanKey = String(rawKey || '').trim();
    if (!cleanKey) return;

    if (!manualProviderSelected) {
      const detected = detectProviderFromKey(cleanKey);
      if (detected && detected !== aiState.provider) {
        aiState.provider = detected;
        updateProviderUI(detected);
      }
    }

    const activeProvider = aiState.provider || 'gemini';
    aiState.apiKeys[activeProvider] = cleanKey;
    persistAiConfig();

    if (autoFetchTimer) clearTimeout(autoFetchTimer);
    autoFetchTimer = setTimeout(() => {
      fetchAndSelectOptimalModels(aiState.provider, cleanKey, { silent: true });
    }, 600);
  }

  if (providerSel) {
    providerSel.addEventListener('change', () => {
      manualProviderSelected = true;
      const nextProvider = providerSel.value || 'gemini';
      aiState.provider = nextProvider;
      updateProviderUI(nextProvider);

      const savedKey = aiState.apiKeys[nextProvider] || '';
      if (geminiKeyInp) geminiKeyInp.value = savedKey;

      const cachedList = modelsByProvider[nextProvider] || [];
      populateGeminiModelOptions(cachedList, aiState.models[nextProvider] || 'auto');
      setAutoModelNote('');
      persistAiConfig();

      if (savedKey && cachedList.length === 0) {
        scheduleAutoDetectAndFetch(savedKey);
      }
    });
  }

  if (geminiKeyInp) {
    geminiKeyInp.addEventListener('input', () => {
      const activeProvider = aiState.provider || 'gemini';
      aiState.apiKeys[activeProvider] = geminiKeyInp.value.trim();
      persistAiConfig();
    });

    geminiKeyInp.addEventListener('paste', () => {
      setTimeout(() => scheduleAutoDetectAndFetch(geminiKeyInp.value), 0);
    });

    ['blur', 'change'].forEach((evtName) => {
      geminiKeyInp.addEventListener(evtName, () => {
        scheduleAutoDetectAndFetch(geminiKeyInp.value);
      });
    });
  }

  if (modelSel) {
    modelSel.addEventListener('change', () => {
      const activeProvider = aiState.provider || 'gemini';
      aiState.models[activeProvider] = modelSel.value || 'auto';
      persistAiConfig();
      if (modelSel.value !== 'auto') {
        setAutoModelNote('');
      }
    });
  }

  // Nút Mở trình duyệt & Đăng nhập LMS
  const btnLoginLms = document.getElementById('btn-cfg-login-lms');
  const statusLms = document.getElementById('cfg-lms-status');
  if (btnLoginLms) {
    btnLoginLms.onclick = async () => {
      const config = getLmsConfig();
      if (!config.email || !config.pass) {
        toast.warning('Vui lòng nhập Email và Mật khẩu LMS.');
        return;
      }

      btnLoginLms.disabled = true;
      if (statusLms) {
        statusLms.style.display = 'inline-block';
        statusLms.textContent = '⏳ Đang đăng nhập MindX LMS...';
        statusLms.className = 'tag tag-blue';
      }

      try {
        const data = await apiRequest('/api/automation/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: config.email, password: config.pass, headless: true })
        });

        if (data.success) {
          if (statusLms) {
            statusLms.textContent = 'Đăng nhập LMS thành công! ✓';
            statusLms.className = 'tag tag-green';
          }
        } else {
          if (statusLms) {
            statusLms.textContent = `Thất bại: ${data.error || 'Sai thông tin đăng nhập'}`;
            statusLms.className = 'tag tag-red';
          }
        }
      } catch (err) {
        if (statusLms) {
          statusLms.textContent = `Lỗi kết nối: ${err.message}`;
          statusLms.className = 'tag tag-red';
        }
      } finally {
        btnLoginLms.disabled = false;
      }
    };
  }

  // Nút Tải danh sách model mới nhất từ nhà cung cấp AI
  const btnRefreshModels = document.getElementById('btn-cfg-refresh-models');
  if (btnRefreshModels) {
    btnRefreshModels.addEventListener('click', async () => {
      const config = getGeminiConfig();
      if (!config.key) {
        toast.warning('Vui lòng nhập API Key trước khi tải danh sách model.');
        return;
      }
      await fetchAndSelectOptimalModels(config.provider, config.key, { silent: false });
    });
  }

  // Nút Kiểm tra kết nối AI
  const btnTestAi = document.getElementById('btn-cfg-test-ai');
  const statusAi = document.getElementById('cfg-ai-status');
  if (btnTestAi) {
    btnTestAi.addEventListener('click', async () => {
      const config = getGeminiConfig();
      if (!config.key) {
        toast.warning('Vui lòng nhập API Key AI.');
        return;
      }

      const providerCfg = getProviderConfig(config.provider);
      btnTestAi.disabled = true;
      if (statusAi) {
        statusAi.style.display = 'inline-block';
        statusAi.textContent = `⏳ Đang kiểm tra kết nối ${providerCfg.name}...`;
        statusAi.className = 'tag tag-blue';
      }

      try {
        const data = await apiRequest('/api/gemini/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: config.provider, apiKey: config.key, model: config.model })
        });

        if (data.success) {
          if (statusAi) {
            statusAi.textContent = data.resolvedModel
              ? `Kết nối ${providerCfg.badge} thành công (${data.resolvedModel})! ✓`
              : `Kết nối ${providerCfg.badge} thành công! ✓`;
            statusAi.className = 'tag tag-green';
          }
          const modelsRes = await apiRequest('/api/gemini/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: config.provider, apiKey: config.key, forceRefresh: false })
          }).catch(() => null);
          if (modelsRes && modelsRes.success && Array.isArray(modelsRes.models) && modelsRes.models.length > 0) {
            persistModelsCache(config.provider, modelsRes.models);
            populateGeminiModelOptions(modelsRes.models, config.model);
          }
        } else {
          if (statusAi) {
            statusAi.textContent = `Thất bại: ${data.error || 'API Key không hợp lệ'}`;
            statusAi.className = 'tag tag-red';
          }
        }
      } catch (err) {
        if (statusAi) {
          statusAi.textContent = `Lỗi mạng: ${err.message}`;
          statusAi.className = 'tag tag-red';
        }
      } finally {
        btnTestAi.disabled = false;
      }
    });
  }
}

function renderCommentStyleUI() {
  const btnPreset = document.getElementById('btn-style-mode-preset');
  const btnCustom = document.getElementById('btn-style-mode-custom');
  const presetPanel = document.getElementById('style-preset-panel');
  const customPanel = document.getElementById('style-custom-panel');
  const presetGrid = document.getElementById('style-preset-cards');
  const templatesBox = document.getElementById('style-custom-templates');
  const criteriaArea = document.getElementById('cfg-style-custom-criteria');
  const radioPara = document.getElementById('cfg-style-output-paragraph');
  const radioBullets = document.getElementById('cfg-style-output-bullets');

  const isCustom = currentCommentStyleConfig.mode === 'custom';
  if (btnPreset) {
    btnPreset.classList.toggle('active', !isCustom);
    btnPreset.setAttribute('aria-selected', String(!isCustom));
  }
  if (btnCustom) {
    btnCustom.classList.toggle('active', isCustom);
    btnCustom.setAttribute('aria-selected', String(isCustom));
  }
  if (presetPanel) presetPanel.style.display = isCustom ? 'none' : 'block';
  if (customPanel) customPanel.style.display = isCustom ? 'block' : 'none';

  if (presetGrid) {
    presetGrid.innerHTML = '';
    COMMENT_PRESETS.forEach((preset) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `style-preset-card${currentCommentStyleConfig.presetId === preset.id ? ' active' : ''}`;
      card.setAttribute('data-preset-id', preset.id);

      const titleDiv = document.createElement('div');
      titleDiv.className = 'style-preset-title';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = preset.name;
      titleDiv.appendChild(nameSpan);

      if (preset.badge) {
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'tag tag-red';
        badgeSpan.style.fontSize = '10px';
        badgeSpan.style.padding = '1px 6px';
        badgeSpan.textContent = preset.badge;
        titleDiv.appendChild(badgeSpan);
      }

      const descDiv = document.createElement('div');
      descDiv.className = 'style-preset-desc';
      descDiv.textContent = preset.description;

      card.appendChild(titleDiv);
      card.appendChild(descDiv);
      card.addEventListener('click', async () => {
        currentCommentStyleConfig = await saveCommentStyleConfig({
          ...currentCommentStyleConfig,
          mode: 'preset',
          presetId: preset.id
        });
        renderCommentStyleUI();
        toast.success(`Đã chọn phong cách: ${preset.name}`);
      });

      presetGrid.appendChild(card);
    });
  }

  if (templatesBox) {
    templatesBox.innerHTML = '';
    CUSTOM_CRITERIA_TEMPLATES.forEach((tpl) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const isSame = (currentCommentStyleConfig.customCriteria || '').trim() === tpl.criteria;
      chip.className = `style-chip-btn${isSame ? ' active' : ''}`;
      chip.textContent = tpl.label;
      chip.addEventListener('click', async () => {
        currentCommentStyleConfig = await saveCommentStyleConfig({
          ...currentCommentStyleConfig,
          mode: 'custom',
          customCriteria: tpl.criteria
        });
        renderCommentStyleUI();
        toast.success(`Đã áp dụng mẫu tiêu chí: ${tpl.label}`);
      });
      templatesBox.appendChild(chip);
    });
  }

  if (criteriaArea && criteriaArea.value !== currentCommentStyleConfig.customCriteria) {
    criteriaArea.value = currentCommentStyleConfig.customCriteria || '';
  }
  if (radioPara) radioPara.checked = currentCommentStyleConfig.outputFormat !== 'bullets';
  if (radioBullets) radioBullets.checked = currentCommentStyleConfig.outputFormat === 'bullets';
}

function showStyleSavedBadge() {
  const badge = document.getElementById('cfg-style-save-status');
  if (!badge) return;
  badge.style.display = 'inline-block';
  badge.textContent = '✓ Đã lưu';
}

function bindCommentStyleEvents() {
  if (isCommentStyleBound) return;
  isCommentStyleBound = true;

  const btnPreset = document.getElementById('btn-style-mode-preset');
  const btnCustom = document.getElementById('btn-style-mode-custom');
  const criteriaArea = document.getElementById('cfg-style-custom-criteria');
  const radioPara = document.getElementById('cfg-style-output-paragraph');
  const radioBullets = document.getElementById('cfg-style-output-bullets');
  const btnSaveStyle = document.getElementById('btn-save-comment-style');

  if (btnPreset) {
    btnPreset.addEventListener('click', async () => {
      currentCommentStyleConfig = await saveCommentStyleConfig({
        ...currentCommentStyleConfig,
        mode: 'preset'
      });
      renderCommentStyleUI();
      showStyleSavedBadge();
    });
  }

  if (btnCustom) {
    btnCustom.addEventListener('click', async () => {
      currentCommentStyleConfig = await saveCommentStyleConfig({
        ...currentCommentStyleConfig,
        mode: 'custom'
      });
      renderCommentStyleUI();
      showStyleSavedBadge();
    });
  }

  if (criteriaArea) {
    const handleCriteriaSave = async () => {
      currentCommentStyleConfig = await saveCommentStyleConfig({
        ...currentCommentStyleConfig,
        mode: 'custom',
        customCriteria: criteriaArea.value
      });
      const templatesBox = document.getElementById('style-custom-templates');
      if (templatesBox) {
        templatesBox.querySelectorAll('.style-chip-btn').forEach(btn => {
          const tpl = CUSTOM_CRITERIA_TEMPLATES.find(t => t.label === btn.textContent);
          btn.classList.toggle('active', Boolean(tpl && tpl.criteria === criteriaArea.value.trim()));
        });
      }
      showStyleSavedBadge();
    };
    criteriaArea.addEventListener('input', handleCriteriaSave);
    criteriaArea.addEventListener('change', handleCriteriaSave);
  }

  [radioPara, radioBullets].forEach((radio) => {
    if (!radio) return;
    radio.addEventListener('change', async () => {
      if (!radio.checked) return;
      currentCommentStyleConfig = await saveCommentStyleConfig({
        ...currentCommentStyleConfig,
        outputFormat: radio.value === 'bullets' ? 'bullets' : 'paragraph'
      });
      showStyleSavedBadge();
      toast.info(`Kiểu xuất: ${radio.value === 'bullets' ? 'Gạch đầu dòng' : 'Đoạn văn liền mạch'}`);
    });
  });

  if (btnSaveStyle) {
    btnSaveStyle.addEventListener('click', async () => {
      const latestCriteria = criteriaArea ? criteriaArea.value : currentCommentStyleConfig.customCriteria;
      const selectedFormat = (radioBullets && radioBullets.checked) ? 'bullets' : 'paragraph';
      currentCommentStyleConfig = await saveCommentStyleConfig({
        ...currentCommentStyleConfig,
        customCriteria: latestCriteria,
        outputFormat: selectedFormat
      });
      renderCommentStyleUI();
      showStyleSavedBadge();
      toast.success('Đã lưu cấu hình phong cách nhận xét AI!');
    });
  }
}
