/**
 * ApiBridge (ES Module)
 * Lớp định tuyến thay thế toàn bộ REST API Express (/api/...) bằng Chrome Extension Messaging & Client Services.
 */

import { geminiClient } from './geminiClient.js';
import { teacherPointClient } from './teacherPointClient.js';
import { curriculumService } from './curriculum.js';

export const CACHE_TTL_MS = 30 * 60 * 1000; // 30 phút
export const CLASSES_CACHE_KEY = 'mindx_classes_cache';
export const SESSIONS_CACHE_KEY = 'mindx_sessions_cache';

async function storageGet(key) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const res = await chrome.storage.local.get(key);
    return res ? res[key] : undefined;
  }
  return undefined;
}

async function storageSet(key, value) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ [key]: value });
  }
}

export async function getCachedClasses(ttlMs = CACHE_TTL_MS) {
  try {
    const entry = await storageGet(CLASSES_CACHE_KEY);
    if (!entry || !Array.isArray(entry.classes) || !entry.updatedAt) return null;
    if (Date.now() - entry.updatedAt >= ttlMs) return null;
    return { classes: entry.classes, updatedAt: entry.updatedAt };
  } catch (_) {
    return null;
  }
}

export async function setCachedClasses(classes, updatedAt = Date.now()) {
  try {
    await storageSet(CLASSES_CACHE_KEY, { classes, updatedAt });
  } catch (_) {}
}

export async function getCachedSessions(classId, ttlMs = CACHE_TTL_MS) {
  if (!classId) return null;
  try {
    const map = await storageGet(SESSIONS_CACHE_KEY);
    const entry = map && map[classId];
    if (!entry || !Array.isArray(entry.sessions) || !entry.updatedAt) return null;
    if (Date.now() - entry.updatedAt >= ttlMs) return null;
    if (entry.sessions.some(s => Number(s.sessionNumber) < 1)) return null;
    return { sessions: entry.sessions, updatedAt: entry.updatedAt };
  } catch (_) {
    return null;
  }
}

export async function setCachedSessions(classId, sessions, updatedAt = Date.now()) {
  if (!classId) return;
  try {
    const existing = (await storageGet(SESSIONS_CACHE_KEY)) || {};
    existing[classId] = { sessions, updatedAt };
    await storageSet(SESSIONS_CACHE_KEY, existing);
  } catch (_) {}
}

function sendToBackground(type, payload = {}) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ success: false, error: 'Môi trường không hỗ trợ Chrome Extension runtime.' });
      return;
    }
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { success: false, error: 'Không nhận được phản hồi từ Background Service Worker.' });
    });
  });
}

function parseBody(options = {}) {
  if (!options || !options.body) return {};
  if (typeof options.body === 'string') {
    try { return JSON.parse(options.body); } catch { return {}; }
  }
  return options.body;
}

export async function apiRequest(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = parseBody(options);
  const url = new URL(endpoint, 'http://extension.local');
  const path = url.pathname;

  try {
    // --- Automation Routes ---
    if (path === '/api/automation/status') {
      return await sendToBackground('API_STATUS');
    }
    if (path === '/api/automation/check-session') {
      return await sendToBackground('API_CHECK_SESSION');
    }
    if (path === '/api/automation/login' && method === 'POST') {
      return await sendToBackground('API_LOGIN', body);
    }
    if (path === '/api/automation/login-interactive' && method === 'POST') {
      return await sendToBackground('API_LOGIN_INTERACTIVE', body);
    }
    if (path === '/api/automation/logout' && method === 'POST') {
      return await sendToBackground('API_LOGOUT');
    }
    if (path === '/api/automation/classes' && method === 'GET') {
      const forceRefresh =
        url.searchParams.get('forceRefresh') === '1' ||
        url.searchParams.get('forceRefresh') === 'true' ||
        options.forceRefresh === true;

      if (!forceRefresh) {
        const cached = await getCachedClasses();
        if (cached) {
          return {
            success: true,
            classes: cached.classes,
            fromCache: true,
            updatedAt: cached.updatedAt
          };
        }
      }

      const res = await sendToBackground('API_GET_CLASSES', {
        status: url.searchParams.get('status') || 'running',
        search: url.searchParams.get('search') || ''
      });
      if (res && res.success && Array.isArray(res.classes)) {
        const updatedAt = Date.now();
        await setCachedClasses(res.classes, updatedAt);
        return { ...res, fromCache: false, updatedAt };
      }
      return res;
    }
    if (path === '/api/automation/classes/select' && method === 'POST') {
      return await sendToBackground('API_SELECT_CLASS', body);
    }
    if (path === '/api/automation/sessions' && method === 'GET') {
      const classId = url.searchParams.get('classId') || '';
      const forceRefresh =
        url.searchParams.get('forceRefresh') === '1' ||
        url.searchParams.get('forceRefresh') === 'true' ||
        options.forceRefresh === true;

      if (classId && !forceRefresh) {
        const cached = await getCachedSessions(classId);
        if (cached) {
          return {
            success: true,
            sessions: cached.sessions,
            fromCache: true,
            updatedAt: cached.updatedAt
          };
        }
      }

      const res = await sendToBackground('API_GET_SESSIONS');
      if (classId && res && res.success && Array.isArray(res.sessions)) {
        const updatedAt = Date.now();
        await setCachedSessions(classId, res.sessions, updatedAt);
        return { ...res, fromCache: false, updatedAt };
      }
      return res;
    }
    if (path === '/api/automation/sessions/select' && method === 'POST') {
      return await sendToBackground('API_SELECT_SESSION', body);
    }
    if (path === '/api/automation/summary' && method === 'GET') {
      const sNum = url.searchParams.get('sessionNumber');
      return await sendToBackground('API_GET_SUMMARY', { sessionNumber: sNum ? parseInt(sNum, 10) : null });
    }
    if (path === '/api/automation/summary' && method === 'POST') {
      return await sendToBackground('API_FILL_SUMMARY', body);
    }
    if (path === '/api/automation/students' && method === 'GET') {
      const sNum = url.searchParams.get('sessionNumber');
      return await sendToBackground('API_GET_STUDENTS', { sessionNumber: sNum ? parseInt(sNum, 10) : null });
    }
    if (path === '/api/automation/comment/single' && method === 'POST') {
      return await sendToBackground('API_COMMENT_SINGLE', body);
    }
    if (path === '/api/automation/comment/batch' && method === 'POST') {
      return await sendToBackground('API_COMMENT_BATCH', body);
    }
    if (path === '/api/automation/cancel' && method === 'POST') {
      return await sendToBackground('API_CANCEL');
    }
    if (path === '/api/automation/logs' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit'), 10) || 100;
      return await sendToBackground('API_LOGS', { limit });
    }

    // --- AI Multi-Provider Routes ---
    if (path === '/api/gemini/models' && method === 'POST') {
      if (body.provider) {
        return await geminiClient.fetchModels(body.provider, body.apiKey, { forceRefresh: body.forceRefresh !== false });
      }
      return await geminiClient.listModels(body.apiKey, { forceRefresh: body.forceRefresh !== false });
    }
    if (path === '/api/gemini/test' && method === 'POST') {
      return await geminiClient.testConnection(body.apiKey, body.model, body.provider || 'gemini');
    }
    if (path === '/api/gemini/summary' && method === 'POST') {
      const summary = await geminiClient.generateSummary(body.lessonData, body.apiKey, body.model, body.provider || 'gemini');
      return { success: true, summary };
    }
    if (path === '/api/gemini/comment' && method === 'POST') {
      const comment = await geminiClient.generateStudentComment(
        body.student,
        body.lessonData,
        body.apiKey,
        body.model,
        body.styleConfig || body.style,
        body.provider || 'gemini'
      );
      return { success: true, comment, usedFallback: Boolean(geminiClient._lastUsedFallback) };
    }
    if (path === '/api/gemini/batch-comments' && method === 'POST') {
      const results = await geminiClient.generateBatchComments(
        body.students || [],
        body.lessonData,
        body.apiKey,
        body.model,
        body.styleConfig || body.style,
        typeof options.onProgress === 'function' ? options.onProgress : null,
        typeof options.onStream === 'function' ? options.onStream : null,
        body.provider || 'gemini'
      );
      return { success: true, results, usedFallback: Boolean(geminiClient._lastUsedFallback) };
    }

    // --- Curriculum Routes ---
    if (path === '/api/curriculum/session-summary' && method === 'GET') {
      const data = await curriculumService.getSessionSummary({
        classCode: url.searchParams.get('classCode') || '',
        courseCode: url.searchParams.get('courseCode') || '',
        session: url.searchParams.get('session') || ''
      });
      return { success: true, data };
    }

    // --- Teacher Point Routes ---
    if (path === '/api/teacher-point/form' && method === 'GET') {
      const formUrl = url.searchParams.get('url') || teacherPointClient.getDefaultFormUrl();
      const force = url.searchParams.get('refresh') === '1';
      const classCode = url.searchParams.get('classCode') || '';
      const schema = await teacherPointClient.parseGoogleForm(formUrl, force);
      const suggestedCampus = teacherPointClient.suggestCampus(classCode, schema.campuses);
      return {
        success: true,
        formUrl: schema.formUrl,
        defaultUrl: teacherPointClient.getDefaultFormUrl(),
        campuses: schema.campuses,
        suggestedCampus,
        fieldsCount: schema.fields.length
      };
    }
    if (path === '/api/teacher-point/submit-single' && method === 'POST') {
      if (!body.studentName || !String(body.studentName).trim()) {
        return { success: false, error: 'Tên học viên không được để trống.' };
      }
      return await teacherPointClient.submitSingleStudent({
        formUrl: body.formUrl,
        studentName: String(body.studentName).trim(),
        classCode: body.classCode,
        sessionNumber: body.sessionNumber,
        campus: body.campus
      });
    }

    if (path === '/api/health') {
      return { status: 'OK', mode: 'chrome-extension', time: new Date().toISOString() };
    }

    return { success: false, error: `Endpoint không được hỗ trợ: ${path}` };
  } catch (err) {
    return {
      success: false,
      errorCode: err.errorCode || undefined,
      error: err.message || 'Lỗi hệ thống'
    };
  }
}
