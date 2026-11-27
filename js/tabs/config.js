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

const STORAGE_KEY_LMS = 'mindx_lms_config';
const STORAGE_KEY_GEMINI = 'mindx_gemini_config';
const STORAGE_KEY_GEMINI_MODELS = 'mindx_gemini_models_cache';

let currentCommentStyleConfig = { ...DEFAULT_COMMENT_STYLE_CONFIG };
let isCommentStyleBound = false;

function populateGeminiModelOptions(models = [], preferredValue = null) {
  const modelSel = document.getElementById('cfg-gemini-model');
  if (!modelSel) return;

  const currentVal = preferredValue || modelSel.value || 'auto';
  modelSel.innerHTML = '';

  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = 'Tự động (Khuyên dùng — Chọn Flash mới nhất)';
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
  loadSavedConfigs();
  bindConfigEvents();
  currentCommentStyleConfig = await loadCommentStyleConfig();
  renderCommentStyleUI();
  bindCommentStyleEvents();
}

function loadSavedConfigs() {
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

    const cachedModelsRaw = localStorage.getItem(STORAGE_KEY_GEMINI_MODELS);
    if (cachedModelsRaw) {
      const cachedModels = JSON.parse(cachedModelsRaw);
      if (Array.isArray(cachedModels) && cachedModels.length > 0) {
        populateGeminiModelOptions(cachedModels);
      }
    }

    const geminiRaw = localStorage.getItem(STORAGE_KEY_GEMINI);
    if (geminiRaw) {
      const gemini = JSON.parse(geminiRaw);
      const keyInp = document.getElementById('cfg-gemini-key');
      const modelSel = document.getElementById('cfg-gemini-model');

      if (keyInp && gemini.key) keyInp.value = gemini.key;
      if (modelSel && gemini.model) {
        const hasOption = Array.from(modelSel.options).some(opt => opt.value === gemini.model);
        modelSel.value = hasOption ? gemini.model : 'auto';
      }
    }
  } catch (err) {
    console.warn('[Config] Lỗi đọc cấu hình localStorage:', err);
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
  const keyInp = document.getElementById('cfg-gemini-key');
  const modelSel = document.getElementById('cfg-gemini-model');

  let key = keyInp ? keyInp.value.trim() : '';
  let model = modelSel ? modelSel.value : 'auto';

  if (!key) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_GEMINI) || '{}');
      if (saved && typeof saved.key === 'string' && saved.key.trim()) {
        key = saved.key.trim();
        if (keyInp) keyInp.value = key;
      }
      if ((!model || model === 'auto') && saved && saved.model) {
        model = saved.model;
      }
    } catch (_) {}
  }

  return {
    key,
    model: model || 'auto'
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

  const geminiInputs = ['cfg-gemini-key', 'cfg-gemini-model'];
  geminiInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        localStorage.setItem(STORAGE_KEY_GEMINI, JSON.stringify(getGeminiConfig()));
      });
    }
  });

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

  // Nút Tải danh sách model mới nhất từ Gemini API
  const btnRefreshModels = document.getElementById('btn-cfg-refresh-models');
  if (btnRefreshModels) {
    btnRefreshModels.onclick = async () => {
      const config = getGeminiConfig();
      if (!config.key) {
        toast.warning('Vui lòng nhập Gemini API Key trước khi tải danh sách model.');
        return;
      }

      btnRefreshModels.disabled = true;
      const oldText = btnRefreshModels.textContent;
      btnRefreshModels.textContent = '⏳ Đang tải...';
      try {
        const data = await apiRequest('/api/gemini/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: config.key, forceRefresh: true })
        });
        if (data.success && Array.isArray(data.models) && data.models.length > 0) {
          localStorage.setItem(STORAGE_KEY_GEMINI_MODELS, JSON.stringify(data.models));
          populateGeminiModelOptions(data.models, config.model);
          localStorage.setItem(STORAGE_KEY_GEMINI, JSON.stringify(getGeminiConfig()));
          toast.success(`Đã tải ${data.models.length} model Gemini mới nhất (Khuyên dùng: ${data.recommendedModel}).`);
        } else {
          toast.error(`Không thể tải danh sách model: ${data.error || 'Vui lòng kiểm tra lại API Key.'}`);
        }
      } catch (err) {
        toast.error(`Lỗi tải model: ${err.message}`);
      } finally {
        btnRefreshModels.disabled = false;
        btnRefreshModels.textContent = oldText;
      }
    };
  }

  // Nút Kiểm tra kết nối AI
  const btnTestAi = document.getElementById('btn-cfg-test-ai');
  const statusAi = document.getElementById('cfg-ai-status');
  if (btnTestAi) {
    btnTestAi.onclick = async () => {
      const config = getGeminiConfig();
      if (!config.key) {
        toast.warning('Vui lòng nhập Gemini API Key.');
        return;
      }

      btnTestAi.disabled = true;
      if (statusAi) {
        statusAi.style.display = 'inline-block';
        statusAi.textContent = '⏳ Đang kiểm tra kết nối Google Gemini API...';
        statusAi.className = 'tag tag-blue';
      }

      try {
        const data = await apiRequest('/api/gemini/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: config.key, model: config.model })
        });

        if (data.success) {
          if (statusAi) {
            statusAi.textContent = data.resolvedModel
              ? `Kết nối thành công (${data.resolvedModel})! ✓`
              : 'Kết nối Gemini API thành công! ✓';
            statusAi.className = 'tag tag-green';
          }
          // Tự động cập nhật danh sách model mới nhất nếu đang kết nối thành công
          const modelsRes = await apiRequest('/api/gemini/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: config.key, forceRefresh: false })
          }).catch(() => null);
          if (modelsRes && modelsRes.success && Array.isArray(modelsRes.models) && modelsRes.models.length > 0) {
            localStorage.setItem(STORAGE_KEY_GEMINI_MODELS, JSON.stringify(modelsRes.models));
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
    };
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
