/**
 * Extension Service Worker (background.js)
 * Mở index.html khi click icon extension và điều phối các lệnh tự động hóa tới MindX LMS (ưu tiên GraphQL API Zero-Tab, fallback DOM).
 */

if (typeof importScripts === 'function') {
  try {
    importScripts('lmsQueries.js', 'lmsApiClient.js');
  } catch (_) {}
}

const LMS_CLASSES_URL = 'https://lms.mindx.edu.vn/admin/classes';
const LMS_LOGIN_URL = 'https://base.mindx.edu.vn/login?callbackUrl=https://lms.mindx.edu.vn/admin/classes';
const LOG_STORAGE_KEY = 'mindx_automation_logs';
const STATE_STORAGE_KEY = 'mindx_automation_state';

function formatLogTime() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function appendLog(level, message) {
  try {
    const data = await chrome.storage.local.get(LOG_STORAGE_KEY);
    const logs = Array.isArray(data[LOG_STORAGE_KEY]) ? data[LOG_STORAGE_KEY] : [];
    logs.push({ time: formatLogTime(), level, message: String(message || '') });
    if (logs.length > 150) logs.splice(0, logs.length - 150);
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
  } catch (_) {}
}

async function getState() {
  const defaults = {
    state: 'IDLE',
    currentTask: null,
    isCancelled: false,
    progress: { current: 0, total: 0, percent: 0, currentStudent: '' },
    hasSavedSession: false,
    lastReport: null
  };
  try {
    const res = await chrome.storage.local.get(STATE_STORAGE_KEY);
    return { ...defaults, ...(res[STATE_STORAGE_KEY] || {}) };
  } catch (_) {
    return defaults;
  }
}

async function setState(patch) {
  try {
    const current = await getState();
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [STATE_STORAGE_KEY]: next });
    if (patch.state) {
      await appendLog('INFO', `[State] ${patch.state}${patch.currentTask ? ` (${patch.currentTask})` : ''}`);
    }
    return next;
  } catch (_) {
    return null;
  }
}

// Mở trang ứng dụng index.html khi click icon extension
chrome.action.onClicked.addListener(async () => {
  const appUrl = chrome.runtime.getURL('index.html');
  const existingTabs = await chrome.tabs.query({ url: appUrl });
  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
  } else {
    await chrome.tabs.create({ url: appUrl, active: true });
  }
});

function waitForTabLoad(tabId, timeoutMs = 30000, { expectReload = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawLoading = !expectReload;
    let spaFallbackTimer = null;

    const cleanup = () => {
      if (spaFallbackTimer) clearTimeout(spaFallbackTimer);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    }, timeoutMs);

    const listener = (id, changeInfo) => {
      if (id !== tabId) return;
      if (changeInfo.status === 'loading') {
        sawLoading = true;
        if (spaFallbackTimer) {
          clearTimeout(spaFallbackTimer);
          spaFallbackTimer = null;
        }
      }
      if (changeInfo.status === 'complete' && sawLoading) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(true);
        }
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    if (expectReload) {
      // Nếu sau 2s tab không chuyển sang 'loading' (do SPA đổi query param không reload trang), tự resolve để kiểm tra Drawer
      spaFallbackTimer = setTimeout(async () => {
        if (settled || sawLoading) return;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!settled && !sawLoading && tab && tab.status === 'complete') {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(true);
        }
      }, 2000);
    } else {
      chrome.tabs.get(tabId).then(tab => {
        if (tab && tab.status === 'complete' && !settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(true);
        }
      }).catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(err);
        }
      });
    }
  });
}

async function findLmsTab() {
  const lmsTabs = await chrome.tabs.query({ url: ['https://lms.mindx.edu.vn/*', 'https://base.mindx.edu.vn/*'] });
  if (lmsTabs.length === 0) return null;
  const activeLms = lmsTabs.find(t => t.url && t.url.includes('lms.mindx.edu.vn'));
  return activeLms || lmsTabs[0];
}

async function ensureLmsTab(targetUrl = LMS_CLASSES_URL, { active = false, forceNavigate = false } = {}) {
  let tab = await findLmsTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: targetUrl, active });
    await waitForTabLoad(tab.id, 30000);
    tab = await chrome.tabs.get(tab.id);
    return tab;
  }

  if (active) {
    await chrome.tabs.update(tab.id, { active: true });
  }

  if (forceNavigate || (targetUrl && tab.url !== targetUrl && !tab.url.startsWith(targetUrl))) {
    await chrome.tabs.update(tab.id, { url: targetUrl, active: Boolean(active) });
    await waitForTabLoad(tab.id, 30000, { expectReload: true });
    tab = await chrome.tabs.get(tab.id);
  } else if (tab.status !== 'complete') {
    await waitForTabLoad(tab.id, 30000);
    tab = await chrome.tabs.get(tab.id);
  }

  return tab;
}

async function ensureScriptsInjected(tabId, url = '') {
  try {
    if (url.includes('lms.mindx.edu.vn')) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['extension/main-world.js'],
        world: 'MAIN'
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['extension/content-lms.js']
    });
    await new Promise(r => setTimeout(r, 200));
  } catch (err) {
    await appendLog('WARN', `[Background] Không thể inject script vào tab ${tabId}: ${err.message}`);
  }
}

async function sendToLmsContent(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (err) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    await ensureScriptsInjected(tabId, tab ? tab.url : '');
    return await chrome.tabs.sendMessage(tabId, payload);
  }
}

function isLoginUrl(url = '') {
  return url.includes('base.mindx.edu.vn/login') || url.includes('/login');
}

function buildClassDetailUrl(classId) {
  const url = new URL(LMS_CLASSES_URL);
  url.searchParams.set('tab', '0');
  url.searchParams.set('id', `"${classId}"`);
  return url.toString();
}

async function handleCheckSession() {
  await setState({ state: 'CHECKING_SESSION', currentTask: 'Kiểm tra phiên MindX LMS' });
  const tab = await ensureLmsTab(LMS_CLASSES_URL, { active: false });
  await new Promise(r => setTimeout(r, 1500));
  const freshTab = await chrome.tabs.get(tab.id);
  const url = freshTab.url || '';

  if (url.includes('lms.mindx.edu.vn') && !isLoginUrl(url)) {
    await setState({ state: 'IDLE', currentTask: null, hasSavedSession: true });
    return { success: true, valid: true, url };
  }
  await setState({ state: 'SESSION_EXPIRED', currentTask: null, hasSavedSession: false });
  return { success: true, valid: false, reason: 'SESSION_EXPIRED', redirectUrl: url };
}

async function handleLogin(email, password) {
  if (!email || !password) {
    return { success: false, error: 'Email và mật khẩu không được để trống.' };
  }
  await setState({ state: 'LOGIN', currentTask: 'Đang đăng nhập MindX LMS' });
  await appendLog('INFO', `[Auth] Bắt đầu đăng nhập tài khoản: ${email}`);

  const tab = await ensureLmsTab(LMS_LOGIN_URL, { active: false, forceNavigate: true });
  await new Promise(r => setTimeout(r, 1000));

  const freshTab = await chrome.tabs.get(tab.id);
  if (freshTab.url && freshTab.url.includes('lms.mindx.edu.vn') && !isLoginUrl(freshTab.url)) {
    await setState({ state: 'IDLE', currentTask: 'Đăng nhập thành công', hasSavedSession: true });
    return { success: true, message: 'Đã đăng nhập sẵn vào MindX LMS.', currentUrl: freshTab.url };
  }

  const fillRes = await sendToLmsContent(tab.id, {
    action: 'LMS_LOGIN',
    email: email.trim(),
    password
  });

  if (!fillRes || !fillRes.success) {
    await setState({ state: 'LOGIN_FAILED', currentTask: fillRes?.error || 'Lỗi đăng nhập' });
    return { success: false, error: fillRes?.error || 'Không thể điền form đăng nhập.' };
  }

  // Chờ chuyển hướng sang lms.mindx.edu.vn (tối đa 25s)
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    if (!t) break;

    if (t.url && t.url.includes('lms.mindx.edu.vn') && !isLoginUrl(t.url)) {
      await setState({ state: 'IDLE', currentTask: 'Đăng nhập thành công', hasSavedSession: true });
      await appendLog('INFO', '[Auth] Đăng nhập MindX LMS thành công! ✓');
      return { success: true, message: 'Đăng nhập MindX LMS thành công.', currentUrl: t.url };
    }

    const errCheck = await sendToLmsContent(tab.id, { action: 'LMS_CHECK_LOGIN_ERROR' }).catch(() => null);
    if (errCheck && errCheck.error) {
      await setState({ state: 'LOGIN_FAILED', currentTask: errCheck.error });
      return { success: false, error: errCheck.error };
    }
  }

  await setState({ state: 'LOGIN_FAILED', currentTask: 'Hết thời gian chờ đăng nhập' });
  return { success: false, error: 'Đăng nhập không thành công (Hết thời gian chờ phản hồi từ LMS).' };
}

async function handleLoginInteractive(timeoutMs = 180000) {
  await setState({ state: 'LOGIN', currentTask: 'Đang mở tab đăng nhập trực quan' });
  const tab = await ensureLmsTab(LMS_LOGIN_URL, { active: true, forceNavigate: true });
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1000));
    const t = await chrome.tabs.get(tab.id).catch(() => null);
    if (!t) {
      return { success: false, error: 'Tab đăng nhập đã bị đóng trước khi hoàn tất.' };
    }
    if (t.url && t.url.includes('lms.mindx.edu.vn') && !isLoginUrl(t.url)) {
      await setState({ state: 'IDLE', currentTask: 'Đăng nhập trực quan thành công', hasSavedSession: true });
      return { success: true, message: 'Đăng nhập trực quan thành công.' };
    }
  }

  return { success: false, error: 'Quá thời gian chờ đăng nhập (Timeout).' };
}

async function handleGetClasses(filterStatus = 'running', searchKeyword = '') {
  await setState({ state: 'LOAD_CLASSES', currentTask: 'Đang tải danh sách lớp học' });
  let tab = await findLmsTab();

  if (!tab || !tab.url || !tab.url.includes('lms.mindx.edu.vn/admin/classes') || tab.url.includes('id=')) {
    tab = await ensureLmsTab(LMS_CLASSES_URL, { active: false, forceNavigate: true });
    await new Promise(r => setTimeout(r, 1200));
  }

  const freshTab = await chrome.tabs.get(tab.id);
  if (isLoginUrl(freshTab.url || '')) {
    await setState({ state: 'SESSION_EXPIRED', hasSavedSession: false });
    return {
      success: false,
      errorCode: 'SESSION_EXPIRED',
      error: 'Phiên đăng nhập MindX LMS đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.'
    };
  }

  const res = await sendToLmsContent(tab.id, {
    action: 'LMS_GET_CLASSES',
    filterStatus,
    searchKeyword
  });

  if (res && res.success) {
    await setState({ state: 'IDLE', currentTask: null, hasSavedSession: true });
  } else if (res && res.errorCode === 'SESSION_EXPIRED') {
    await setState({ state: 'SESSION_EXPIRED', hasSavedSession: false });
  } else {
    await setState({ state: 'CLASS_NOT_FOUND', currentTask: res?.error });
  }
  return res;
}

async function handleSelectClass(classId, classCode = '') {
  if (!classId) return { success: false, error: 'Class ID lớp học không được để trống.' };
  await setState({ state: 'SELECT_CLASS', currentTask: `Đang vào lớp: ${classCode || classId}` });

  let tab = await findLmsTab();
  if (tab && tab.url && tab.url.includes('lms.mindx.edu.vn/admin/classes') && !isLoginUrl(tab.url)) {
    await appendLog('INFO', `[ClassService] Thử chuyển lớp mượt bằng SPA pushState: ${classCode || classId}`);
    const spaRes = await sendToLmsContent(tab.id, {
      action: 'LMS_SPA_SELECT_CLASS',
      classId,
      classCode
    }).catch(() => null);

    if (spaRes && spaRes.success) {
      await setState({ state: 'IDLE', currentTask: null });
      return spaRes;
    }
    if (spaRes && spaRes.errorCode === 'SESSION_EXPIRED') {
      await setState({ state: 'SESSION_EXPIRED', hasSavedSession: false });
      return spaRes;
    }
    await appendLog('WARN', '[ClassService] SPA pushState chưa mở được Drawer sau 3.5s, fallback về điều hướng URL trực tiếp.');
  }

  const targetUrl = buildClassDetailUrl(classId);
  await appendLog('INFO', `[ClassService] Điều hướng trực tiếp bằng URL: ${targetUrl}`);
  tab = await ensureLmsTab(targetUrl, { active: false, forceNavigate: true });
  await new Promise(r => setTimeout(r, 800));

  const freshTab = await chrome.tabs.get(tab.id);
  if (isLoginUrl(freshTab.url || '')) {
    await setState({ state: 'SESSION_EXPIRED', hasSavedSession: false });
    return {
      success: false,
      errorCode: 'SESSION_EXPIRED',
      error: 'Phiên đăng nhập MindX LMS đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.'
    };
  }

  const res = await sendToLmsContent(tab.id, {
    action: 'LMS_VERIFY_CLASS_DRAWER',
    classId,
    classCode
  });

  if (res && res.success) {
    await setState({ state: 'IDLE', currentTask: null });
  } else if (res && res.errorCode === 'SESSION_EXPIRED') {
    await setState({ state: 'SESSION_EXPIRED', hasSavedSession: false });
  } else {
    await setState({ state: 'CLASS_NOT_FOUND', currentTask: res?.error });
  }
  return res;
}

async function forwardToActiveLmsTab(action, payload = {}) {
  const tab = await findLmsTab();
  if (!tab) {
    return {
      success: false,
      errorCode: 'SESSION_EXPIRED',
      error: 'Chưa mở tab MindX LMS. Vui lòng đăng nhập hoặc quét danh sách lớp trước.'
    };
  }
  if (isLoginUrl(tab.url || '')) {
    return {
      success: false,
      errorCode: 'SESSION_EXPIRED',
      error: 'Phiên đăng nhập MindX LMS đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.'
    };
  }
  return await sendToLmsContent(tab.id, { action, ...payload });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { type, payload = {} } = message || {};

      if (type === 'BG_LOG') {
        await appendLog(payload.level || 'INFO', payload.message || '');
        sendResponse({ success: true });
        return;
      }

      if (type === 'API_STATUS') {
        const st = await getState();
        sendResponse({ success: true, ...st });
        return;
      }

      if (type === 'API_LOGS') {
        const limit = Number(payload.limit) || 100;
        const data = await chrome.storage.local.get(LOG_STORAGE_KEY);
        const logs = Array.isArray(data[LOG_STORAGE_KEY]) ? data[LOG_STORAGE_KEY] : [];
        sendResponse({ success: true, logs: logs.slice(-limit) });
        return;
      }

      if (type === 'API_CANCEL') {
        await setState({ isCancelled: true, state: 'CANCELLED', currentTask: 'Người dùng đã bấm hủy tiến trình' });
        sendResponse({ success: true, message: 'Đã gửi lệnh hủy tiến trình.' });
        return;
      }

      if (type === 'API_CHECK_SESSION') {
        sendResponse(await handleCheckSession());
        return;
      }

      if (type === 'API_LOGIN') {
        sendResponse(await handleLogin(payload.email, payload.password));
        return;
      }

      if (type === 'API_LOGIN_INTERACTIVE') {
        sendResponse(await handleLoginInteractive(payload.timeoutMs));
        return;
      }

      if (type === 'API_LOGOUT') {
        await setState({ state: 'IDLE', hasSavedSession: false, currentTask: null });
        sendResponse({ success: true, message: 'Đã đăng xuất.' });
        return;
      }

      if (type === 'API_GET_CLASSES') {
        const api = globalThis.lmsApiClient;
        if (api) {
          try {
            await setState({ state: 'LOAD_CLASSES', currentTask: 'Đang tải danh sách lớp (API)' });
            const res = await api.scanClasses({ status: payload.status || 'running', search: payload.search || '' });
            await setState({ state: 'IDLE', currentTask: null, hasSavedSession: true });
            sendResponse(res);
            return;
          } catch (err) {
            await appendLog('WARN', `[GraphQL] GetClasses fallback DOM: ${err.message}`);
          }
        }
        sendResponse(await handleGetClasses(payload.status || 'running', payload.search || ''));
        return;
      }

      if (type === 'API_SELECT_CLASS') {
        const api = globalThis.lmsApiClient;
        if (api && payload.classId) {
          try {
            await setState({ state: 'SELECT_CLASS', currentTask: `Đang tải lớp: ${payload.classCode || payload.classId}` });
            const res = await api.selectClassAndScanSessions(payload.classId);
            await setState({ state: 'IDLE', currentTask: null });
            sendResponse(res);
            return;
          } catch (err) {
            await appendLog('WARN', `[GraphQL] GetClassById fallback DOM: ${err.message}`);
          }
        }
        sendResponse(await handleSelectClass(payload.classId, payload.classCode || ''));
        return;
      }

      if (type === 'API_GET_SESSIONS') {
        const api = globalThis.lmsApiClient;
        if (api) {
          try {
            const res = await api.getCachedSessionsFromContext();
            await setState({ state: 'IDLE', currentTask: null });
            sendResponse(res);
            return;
          } catch (_) {}
        }
        await setState({ state: 'LOAD_SESSIONS', currentTask: 'Đang tải danh sách buổi học' });
        const res = await forwardToActiveLmsTab('LMS_GET_SESSIONS');
        await setState({ state: res.success ? 'IDLE' : 'SESSION_NOT_FOUND', currentTask: null });
        sendResponse(res);
        return;
      }

      if (type === 'API_SELECT_SESSION') {
        const api = globalThis.lmsApiClient;
        if (api && payload.sessionNumber) {
          try {
            await setState({ state: 'SELECT_SESSION', currentTask: `Đang tải Buổi ${payload.sessionNumber} (API)` });
            const res = await api.selectSessionAndReadData(payload.sessionNumber);
            await setState({ state: 'IDLE', currentTask: null });
            sendResponse(res);
            return;
          } catch (err) {
            await appendLog('WARN', `[GraphQL] SelectSession fallback DOM: ${err.message}`);
          }
        }
        await setState({ state: 'SELECT_SESSION', currentTask: `Đang chọn Buổi ${payload.sessionNumber}` });
        const res = await forwardToActiveLmsTab('LMS_SELECT_SESSION', { sessionNumber: payload.sessionNumber });
        await setState({ state: res.success ? 'IDLE' : 'SESSION_NOT_FOUND', currentTask: null });
        sendResponse(res);
        return;
      }

      if (type === 'API_GET_SUMMARY') {
        const api = globalThis.lmsApiClient;
        if (api) {
          try {
            const res = await api.getCachedSummaryFromContext();
            await setState({ state: 'IDLE', currentTask: null });
            sendResponse(res);
            return;
          } catch (_) {}
        }
        await setState({ state: 'LOAD_SUMMARY', currentTask: 'Đang đọc Summary buổi học' });
        const res = await forwardToActiveLmsTab('LMS_GET_SUMMARY', { sessionNumber: payload.sessionNumber });
        await setState({ state: res.success ? 'IDLE' : 'SUMMARY_NOT_FOUND', currentTask: null });
        sendResponse(res);
        return;
      }

      if (type === 'API_FILL_SUMMARY') {
        const api = globalThis.lmsApiClient;
        if (api) {
          try {
            await setState({ state: 'FILL_SUMMARY', currentTask: 'Đang lưu Summary (API)' });
            const res = await api.saveSummary({ content: payload.content, forceOverwrite: payload.forceOverwrite !== false });
            await setState({ state: 'IDLE', currentTask: null });
            sendResponse(res);
            return;
          } catch (err) {
            await appendLog('WARN', `[GraphQL] SaveSummary fallback DOM: ${err.message}`);
          }
        }
        await setState({ state: 'FILL_SUMMARY', currentTask: 'Đang nhập nội dung Summary' });
        const res = await forwardToActiveLmsTab('LMS_FILL_SUMMARY', {
          content: payload.content,
          forceOverwrite: payload.forceOverwrite !== false
        });
        await setState({ state: res.success ? 'IDLE' : 'FILL_FAILED', currentTask: null });
        sendResponse(res);
        return;
      }

      if (type === 'API_GET_STUDENTS') {
        const api = globalThis.lmsApiClient;
        if (api) {
          try {
            const res = await api.getCachedStudentsFromContext();
            await setState({ state: 'IDLE', currentTask: null });
            sendResponse(res);
            return;
          } catch (_) {}
        }
        await setState({ state: 'LOAD_STUDENTS', currentTask: 'Đang quét danh sách học viên' });
        const res = await forwardToActiveLmsTab('LMS_GET_STUDENTS', { sessionNumber: payload.sessionNumber });
        await setState({ state: res.success ? 'IDLE' : 'STUDENT_NOT_FOUND', currentTask: null });
        sendResponse(res);
        return;
      }

      if (type === 'API_COMMENT_SINGLE') {
        const api = globalThis.lmsApiClient;
        if (api) {
          try {
            await setState({ state: 'PROCESS_STUDENTS', currentTask: `Đang lưu nhận xét: ${payload.studentName} (API)` });
            const res = await api.saveSingleComment({
              studentName: payload.studentName,
              studentId: payload.studentId,
              commentText: payload.commentText,
              forceOverwrite: payload.forceOverwrite !== false
            });
            await setState({ state: 'IDLE', currentTask: null });
            sendResponse(res);
            return;
          } catch (err) {
            await appendLog('WARN', `[GraphQL] SaveSingleComment fallback DOM: ${err.message}`);
          }
        }
        await setState({ state: 'PROCESS_STUDENTS', currentTask: `Đang lưu nhận xét: ${payload.studentName}` });
        const res = await forwardToActiveLmsTab('LMS_COMMENT_SINGLE', {
          studentName: payload.studentName,
          commentText: payload.commentText,
          forceOverwrite: payload.forceOverwrite !== false
        });
        await setState({ state: res.success ? 'IDLE' : 'FILL_FAILED', currentTask: null });
        sendResponse(res);
        return;
      }

      if (type === 'API_COMMENT_BATCH') {
        const students = payload.students || [];
        await setState({
          isCancelled: false,
          state: 'PROCESS_STUDENTS',
          currentTask: `Xử lý hàng loạt ${students.length} học viên`,
          progress: { current: 0, total: students.length, percent: 0, currentStudent: '' }
        });

        const report = {
          startTime: new Date().toISOString(),
          total: students.length,
          verifiedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          details: []
        };

        for (let i = 0; i < students.length; i++) {
          const st = await getState();
          if (st.isCancelled) break;

          const item = students[i];
          const studentName = item.name || item.studentName;
          const commentText = item.comment;
          const attendance = (item.attendance || 'PRESENT').toUpperCase();

          await setState({
            progress: {
              current: i + 1,
              total: students.length,
              percent: Math.round(((i + 1) / students.length) * 100),
              currentStudent: studentName
            }
          });

          if (attendance === 'ABSENT') {
            report.skippedCount++;
            report.details.push({ studentName, status: 'SKIPPED_ABSENT', message: 'Bỏ qua do học viên vắng mặt' });
            continue;
          }

          try {
            let res = null;
            let usedGraphql = false;
            const api = globalThis.lmsApiClient;
            if (api) {
              try {
                res = await api.saveSingleComment({
                  studentName,
                  studentId: item.studentId || item.id,
                  commentText,
                  forceOverwrite: payload.forceOverwrite !== false
                });
                usedGraphql = true;
              } catch (gqlErr) {
                if (gqlErr && gqlErr.errorCode === 'SESSION_EXPIRED') {
                  res = { success: false, errorCode: 'SESSION_EXPIRED', error: gqlErr.message };
                } else {
                  await appendLog('WARN', `[GraphQL] Batch fallback DOM (${studentName}): ${gqlErr.message}`);
                }
              }
            }
            if (!res) {
              res = await forwardToActiveLmsTab('LMS_COMMENT_SINGLE', {
                studentName,
                commentText,
                forceOverwrite: payload.forceOverwrite !== false
              });
            }
            if (res.status === 'VERIFIED' || res.status === 'SAVED_UNVERIFIED') {
              report.verifiedCount++;
            } else if (res.status && res.status.startsWith('SKIPPED')) {
              report.skippedCount++;
            } else {
              report.failedCount++;
            }
            report.details.push(res);
            if (!usedGraphql) {
              await new Promise(r => setTimeout(r, 1500));
            }
          } catch (err) {
            report.failedCount++;
            report.details.push({ studentName, status: 'FAILED', error: err.message });
          }
        }

        report.endTime = new Date().toISOString();
        await setState({
          state: 'COMPLETED',
          currentTask: `Hoàn tất: ${report.verifiedCount} thành công`,
          lastReport: report
        });
        sendResponse({ success: true, report });
        return;
      }

      sendResponse({ success: false, error: `Unknown message type: ${type}` });
    } catch (err) {
      await appendLog('ERROR', `[Background] ${err.message}`);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

// =========================================================================
// LIGHTWEIGHT JWT AUTH CAPTURE (Bắt ngầm Authorization JWT & teacherId)
// =========================================================================
if (typeof chrome !== 'undefined' && chrome.webRequest) {
  const lmsApiFilter = {
    urls: ['https://lms-api.mindx.edu.vn/*'],
    types: ['xmlhttprequest']
  };

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.method !== 'POST' || !details.requestBody?.raw?.length) return;
      try {
        const decoder = new TextDecoder('utf-8');
        const text = details.requestBody.raw.map(p => (p?.bytes ? decoder.decode(p.bytes) : '')).join('');
        const parsed = JSON.parse(text);
        if (parsed && parsed.operationName === 'GetClasses' && parsed.variables?.teacherId) {
          globalThis.lmsApiClient?.saveTeacherId(parsed.variables.teacherId);
        }
      } catch (_) {}
    },
    lmsApiFilter,
    ['requestBody']
  );

  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (details.method === 'OPTIONS') return;
      const headers = Array.isArray(details.requestHeaders) ? details.requestHeaders : [];
      const authHeader = headers.find(h => String(h.name || '').toLowerCase() === 'authorization');
      if (authHeader && authHeader.value) {
        globalThis.lmsApiClient?.saveJwtToken(String(authHeader.value).trim());
      }
    },
    lmsApiFilter,
    ['requestHeaders', 'extraHeaders']
  );
}

// Port listener cho streaming tiến độ thời gian thực khi chạy batch
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onConnect) {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'mindx-batch-progress') return;
    port.onMessage.addListener(async (msg) => {
      if (!msg || msg.type !== 'START_BATCH') return;
      const students = msg.students || [];
      const api = globalThis.lmsApiClient;
      await setState({ isCancelled: false, state: 'PROCESS_STUDENTS' });

      let savedCount = 0;
      let failedCount = 0;
      for (let i = 0; i < students.length; i++) {
        const st = await getState();
        if (st.isCancelled) {
          port.postMessage({ type: 'CANCELLED', current: i, total: students.length });
          return;
        }
        const item = students[i];
        const studentName = item.name || item.studentName;
        port.postMessage({
          type: 'PROGRESS',
          current: i + 1,
          total: students.length,
          percent: Math.round(((i + 1) / students.length) * 100),
          studentName
        });

        try {
          const res = api
            ? await api.saveSingleComment({ studentName, studentId: item.studentId || item.id, commentText: item.comment })
            : await forwardToActiveLmsTab('LMS_COMMENT_SINGLE', { studentName, commentText: item.comment, forceOverwrite: true });
          if (res && res.success) savedCount++;
          else failedCount++;
          port.postMessage({ type: 'ITEM_DONE', studentName, result: res });
        } catch (err) {
          failedCount++;
          port.postMessage({ type: 'ITEM_DONE', studentName, result: { success: false, error: err.message } });
        }
      }
      port.postMessage({ type: 'COMPLETED', savedCount, failedCount });
    });
  });
}
