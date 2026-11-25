/**
 * Page 1: Cấu hình & Bảo mật (Config Tab Controller)
 * Quản lý thông tin tài khoản MindX LMS và cấu hình Google Gemini API Key.
 */

import { toast } from '../services/toast.js';

const STORAGE_KEY_LMS = 'mindx_lms_config';
const STORAGE_KEY_GEMINI = 'mindx_gemini_config';

export function initConfigTab() {
  loadSavedConfigs();
  bindConfigEvents();
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

    const geminiRaw = localStorage.getItem(STORAGE_KEY_GEMINI);
    if (geminiRaw) {
      const gemini = JSON.parse(geminiRaw);
      const keyInp = document.getElementById('cfg-gemini-key');
      const modelSel = document.getElementById('cfg-gemini-model');
      const styleSel = document.getElementById('cfg-gemini-style');

      if (keyInp && gemini.key) keyInp.value = gemini.key;
      if (modelSel && gemini.model) modelSel.value = gemini.model;
      if (styleSel && gemini.style) styleSel.value = gemini.style;
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
  const styleSel = document.getElementById('cfg-gemini-style');

  return {
    key: keyInp ? keyInp.value.trim() : '',
    model: modelSel ? modelSel.value : 'gemini-1.5-flash',
    style: styleSel ? styleSel.value : 'standard'
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
      toggleLmsPass.textContent = isPass ? '🙈' : '👁️';
    };
  }

  const toggleGeminiKey = document.getElementById('btn-toggle-gemini-key');
  const geminiKeyInp = document.getElementById('cfg-gemini-key');
  if (toggleGeminiKey && geminiKeyInp) {
    toggleGeminiKey.onclick = () => {
      const isPass = geminiKeyInp.type === 'password';
      geminiKeyInp.type = isPass ? 'text' : 'password';
      toggleGeminiKey.textContent = isPass ? '🙈' : '👁️';
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

  const geminiInputs = ['cfg-gemini-key', 'cfg-gemini-model', 'cfg-gemini-style'];
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
        statusLms.textContent = '⏳ Đang khởi chạy Playwright Chromium...';
        statusLms.className = 'tag tag-blue';
      }

      try {
        const res = await fetch('/api/automation/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: config.email, password: config.pass, headless: true })
        });
        const data = await res.json();

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
        const res = await fetch('/api/gemini/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: config.key, model: config.model })
        });
        const data = await res.json();

        if (data.success) {
          if (statusAi) {
            statusAi.textContent = 'Kết nối Gemini API thành công! ✓';
            statusAi.className = 'tag tag-green';
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
