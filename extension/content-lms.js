/**
 * Content Script (extension/content-lms.js)
 * Port toàn bộ logic tự động hóa từ src/automation/*.js sang DOM API chạy trực tiếp trên tab MindX LMS.
 */
(() => {
  if (window.__mindxContentLmsInjected) return;
  window.__mindxContentLmsInjected = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function log(level, message) {
    try {
      chrome.runtime.sendMessage({ type: 'BG_LOG', payload: { level, message } }).catch(() => {});
    } catch (_) {}
  }

  function callMainWorld(action, payload = {}) {
    return new Promise((resolve) => {
      const reqId = `mw_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        window.removeEventListener('MINDX_MAIN_WORLD_RES', handler);
        resolve(null);
      }, 3000);

      function handler(e) {
        if (!e.detail || e.detail.reqId !== reqId) return;
        clearTimeout(timer);
        window.removeEventListener('MINDX_MAIN_WORLD_RES', handler);
        resolve(e.detail.result);
      }

      window.addEventListener('MINDX_MAIN_WORLD_RES', handler);
      window.dispatchEvent(new CustomEvent('MINDX_MAIN_WORLD_REQ', {
        detail: { reqId, action, payload }
      }));
    });
  }

  function waitForCondition(fn, { timeout = 12000 } = {}) {
    return new Promise((resolve) => {
      try {
        const initial = fn();
        if (initial) {
          resolve(initial);
          return;
        }
      } catch (_) {}

      let settled = false;
      let observer = null;
      let timer = null;

      const cleanup = () => {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const check = () => {
        if (settled) return;
        try {
          const res = fn();
          if (res) {
            settled = true;
            cleanup();
            resolve(res);
          }
        } catch (_) {}
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, timeout);

      const target = document.body || document.documentElement;
      if (typeof MutationObserver !== 'undefined' && target) {
        observer = new MutationObserver(check);
        observer.observe(target, { childList: true, subtree: true, attributes: true });
      }
    });
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function compareContent(actual, expected) {
    if (!actual || !expected) return false;
    const normActual = actual.replace(/\s+/g, ' ').trim();
    const normExpected = expected.replace(/\s+/g, ' ').trim();
    return normActual === normExpected || normActual.includes(normExpected) || normExpected.includes(normActual);
  }

  // =========================================================================
  // 1. AUTH (base.mindx.edu.vn/login)
  // =========================================================================
  async function handleLogin(email, password) {
    const emailInput = await waitForCondition(
      () => document.querySelector('input[name="email"], input[placeholder*="email" i]'),
      { timeout: 15000 }
    );
    const passwordInput = await waitForCondition(
      () => document.querySelector('input[name="password"], input[type="password"]'),
      { timeout: 15000 }
    );

    if (!emailInput || !passwordInput) {
      return { success: false, error: 'Không tìm thấy ô nhập Email / Mật khẩu trên trang đăng nhập.' };
    }

    emailInput.focus();
    setNativeValue(emailInput, email);
    await sleep(100);

    passwordInput.focus();
    setNativeValue(passwordInput, password);
    await sleep(150);

    const submitBtns = Array.from(document.querySelectorAll('button[type="submit"], button'));
    const submitBtn =
      submitBtns.find(b => b.type === 'submit' && /đăng nhập/i.test(b.innerText || '')) ||
      submitBtns.find(b => /^đăng nhập$/i.test((b.innerText || '').trim())) ||
      document.querySelector('button[type="submit"]');

    if (!submitBtn) {
      return { success: false, error: 'Không tìm thấy nút Đăng nhập.' };
    }

    submitBtn.click();
    return { success: true };
  }

  function handleCheckLoginError() {
    const errEls = Array.from(document.querySelectorAll(
      '.ant-message-notice-error, .ant-message-custom-content.ant-message-error, .ant-form-item-explain-error, .ant-notification-notice-error, [role="alert"]'
    ));
    const msg = errEls.map(e => (e.innerText || '').trim()).filter(Boolean).join('; ');
    if (msg) {
      if (msg.includes('wrongLoginCredentials') || msg.toLowerCase().includes('sai')) {
        return { error: 'Tài khoản hoặc mật khẩu không chính xác.' };
      }
      return { error: `LMS báo lỗi: ${msg}` };
    }
    const otpInput = document.querySelector('input[name*="otp" i], input[placeholder*="otp" i], input[name*="code" i]');
    if (otpInput && isVisible(otpInput)) {
      return { error: 'Hệ thống yêu cầu mã xác thực OTP / 2FA. Vui lòng đăng nhập trực tiếp trên tab MindX LMS.' };
    }
    return { error: null };
  }

  // =========================================================================
  // 2. CLASSES (lms.mindx.edu.vn/admin/classes)
  // =========================================================================
  async function closeDrawerIfOpen() {
    const drawer = document.querySelector('.MuiDrawer-modal');
    if (drawer && isVisible(drawer)) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(600);
      const stillOpen = document.querySelector('.MuiDrawer-modal');
      if (stillOpen && isVisible(stillOpen)) {
        const backdrop = document.querySelector('.MuiBackdrop-root');
        if (backdrop) backdrop.click();
        await sleep(500);
      }
    }
  }

  async function handleGetClasses(filterStatus = 'running', searchKeyword = '') {
    if (window.location.href.includes('base.mindx.edu.vn/login')) {
      return { success: false, errorCode: 'SESSION_EXPIRED', error: 'Phiên đăng nhập đã hết hạn.' };
    }

    await closeDrawerIfOpen();

    await waitForCondition(() => {
      const rows = document.querySelectorAll('tbody tr, .MuiTableRow-root.MuiTableRow-hover');
      return rows.length > 0;
    }, { timeout: 15000 });

    await sleep(250);

    if (searchKeyword) {
      const searchInput = document.querySelector('input[placeholder*="tìm kiếm" i], input[placeholder*="search" i]');
      if (searchInput && isVisible(searchInput)) {
        setNativeValue(searchInput, searchKeyword);
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await sleep(1500);
      }
    }

    const headerCells = Array.from(document.querySelectorAll('table thead th, table thead td, .MuiTableHead-root th, .MuiTableHead-root td'));
    let statusColIdx = headerCells.findIndex(th => /^(status|trạng\s*thái)$/i.test((th.innerText || '').trim()));
    if (statusColIdx < 0) {
      statusColIdx = headerCells.findIndex(th => /status|trạng\s*thái/i.test((th.innerText || '').trim()));
    }

    let rows = Array.from(document.querySelectorAll('tbody tr, .MuiTableRow-root.MuiTableRow-hover, tr.ant-table-row'));
    rows = rows.filter(r => !r.classList.contains('MuiTableRow-head') && !r.closest('thead'));

    rows.forEach((r, idx) => r.setAttribute('data-mindx-row', String(idx)));
    const fiberRows = await callMainWorld('GET_CLASSES_FIBER');
    const fiberMap = new Map();
    if (Array.isArray(fiberRows)) {
      fiberRows.forEach(item => fiberMap.set(item.idx, item));
    }

    const classes = rows.map((row, index) => {
      const fiberInfo = fiberMap.get(index) || {};
      const cells = Array.from(row.querySelectorAll('td'));
      const textParts = cells.map(c => (c.innerText || '').trim());

      const realId = fiberInfo.found ? fiberInfo.realId : null;
      const classCode = (fiberInfo.found && fiberInfo.classCode) ? fiberInfo.classCode : (textParts[1] || textParts[0] || '');
      const courseName = (fiberInfo.found && fiberInfo.courseName) ? fiberInfo.courseName : (textParts[2] || '');
      const teacherName = (fiberInfo.found && fiberInfo.teacherName) ? fiberInfo.teacherName : (textParts[12] || '');

      const domStatus = statusColIdx >= 0 && cells[statusColIdx] ? (cells[statusColIdx].innerText || '').trim() : '';
      const fiberStatus = fiberInfo.found ? (fiberInfo.fiberStatus || '') : '';
      const statusText = (domStatus || fiberStatus || '').replace(/\n+/g, ' ').trim();
      const schedule = textParts[8] || textParts[7] || '';

      const cleanCode = (classCode || '').replace(/\n+/g, ' ').trim();
      const cleanCourse = (courseName || '').replace(/\n+/g, ' ').trim();
      const cleanSchedule = (schedule || '').replace(/\n+/g, ' ').trim();
      const cleanTeacher = (teacherName || '').replace(/\n+/g, ' ').trim();

      return {
        id: realId || cleanCode || `class-row-${index}`,
        classId: realId,
        code: cleanCode,
        classCode: cleanCode,
        courseName: cleanCourse,
        teacherName: cleanTeacher,
        title: cleanCourse ? `${cleanCode} — ${cleanCourse}` : cleanCode,
        className: cleanCourse ? `${cleanCode} — ${cleanCourse}` : cleanCode,
        scheduleText: cleanSchedule ? `Mã: ${cleanCode} | ${cleanSchedule}` : `Mã: ${cleanCode}`,
        statusText,
        numberOfSessions: fiberInfo.slotsCount || 14,
        fullRowText: (row.innerText || '').trim()
      };
    });

    const filteredClasses = classes.filter(c => {
      if (!filterStatus || filterStatus === 'all') return true;
      const s = (c.statusText || '').trim().toLowerCase();
      if (filterStatus === 'running') {
        return s === 'running' || s === 'đang diễn ra';
      }
      return true;
    });

    log('INFO', `[ClassService] Quét được ${classes.length} lớp, lọc còn ${filteredClasses.length} lớp (${filterStatus}).`);
    return { success: true, classes: filteredClasses };
  }

  function dispatchFullClick(el) {
    if (!el) return;
    const eventInit = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    el.dispatchEvent(new MouseEvent('click', eventInit));
  }

  function findDrawerElement() {
    const d = document.querySelector('.MuiDrawer-modal');
    return (d && isVisible(d)) ? d : null;
  }

  async function handleVerifyClassDrawer(classId, classCode = '', { timeout = 15000 } = {}) {
    const readyState = await waitForCondition(() => {
      if (window.location.href.includes('base.mindx.edu.vn/login')) return 'LOGIN_REDIRECT';
      const d = findDrawerElement();
      if (!d) return false;
      const txt = (d.innerText || '').trim();
      const hasDetailTabs = /thông tin chung|nhận xét|điểm danh|lịch học|general\s*info|comments?|attendance|schedule|students?/i.test(txt);
      const hasForbidden = /\bforbidden\b|403|không có quyền|access denied/i.test(txt);
      if (hasDetailTabs || hasForbidden) return 'DRAWER_READY';
      return false;
    }, { timeout });

    if (readyState === 'LOGIN_REDIRECT' || window.location.href.includes('base.mindx.edu.vn/login')) {
      console.log('[ContentLMS] SELECT_CLASS failed: Bị redirect về trang login.');
      return { success: false, errorCode: 'SESSION_EXPIRED', error: 'Phiên đăng nhập đã hết hạn.' };
    }

    const drawer = findDrawerElement();
    if (!drawer) {
      console.log('[ContentLMS] SELECT_CLASS failed: .MuiDrawer-modal không xuất hiện hoặc chưa tải xong tab chi tiết sau 15s.', { classId, classCode });
      return { success: false, error: `Không thể tải chi tiết lớp học "${classCode || classId}" (Drawer .MuiDrawer-modal không xuất hiện).` };
    }

    await sleep(200);
    const drawerText = drawer.innerText || '';
    if (/\bforbidden\b|access denied|không có quyền truy cập/i.test(drawerText)) {
      console.log('[ContentLMS] SELECT_CLASS failed: Drawer hiển thị thông báo Forbidden.', { classId, classCode });
      return { success: false, error: 'Không có quyền truy cập lớp học (Forbidden).' };
    }

    const hasDetailTabs = /thông tin chung|nhận xét|điểm danh|lịch học|general\s*info|comments?|attendance|schedule|students?/i.test(drawerText);
    if (!hasDetailTabs) {
      console.log('[ContentLMS] SELECT_CLASS failed: .MuiDrawer-modal đã mở nhưng không thấy các tab chi tiết (Thông tin chung / Nhận xét / Điểm danh).', {
        classId,
        classCode,
        drawerSnippet: drawerText.slice(0, 200)
      });
      return { success: false, error: `Không tải được các tab chi tiết lớp học cho "${classCode || classId}".` };
    }

    const h6 = drawer.querySelector('h6, h5, h4');
    const displayedClassCode = (h6 && h6.innerText.trim())
      ? h6.innerText.trim()
      : ((drawerText.split('\n').map(s => s.trim()).find(Boolean)) || classCode || classId);

    log('INFO', `[ClassService] Đã mở Drawer lớp: ${displayedClassCode} (${classId})`);
    return {
      success: true,
      context: {
        classId,
        classCode: displayedClassCode,
        className: displayedClassCode,
        isDrawerOpen: true,
        url: window.location.href
      }
    };
  }

  // =========================================================================
  // 3. SESSIONS (Tab Nhận xét trong .MuiDrawer-modal)
  // =========================================================================
  function getDrawer() {
    return findDrawerElement();
  }

  async function openCommentsTab() {
    const drawer = getDrawer();
    if (!drawer) throw new Error('Drawer chi tiết lớp học (.MuiDrawer-modal) chưa mở.');

    const activeTab = drawer.querySelector('.MuiTab-root.Mui-selected, [role="tab"][aria-selected="true"]');
    const isAlreadyActive = activeTab ? /^nhận xét$|^comments$/i.test((activeTab.innerText || '').trim()) : false;

    if (!isAlreadyActive) {
      const tabs = Array.from(drawer.querySelectorAll('.MuiTab-root, [role="tab"]'));
      const target = tabs.find(t => /^nhận xét$|^comments$/i.test((t.innerText || '').trim()));
      if (!target) throw new Error('Không tìm thấy tab "Nhận xét" / "Comments" bên trong Drawer.');
      target.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
      target.click();
    }

    const ok = await waitForCondition(() => {
      const d = getDrawer();
      if (!d) return false;
      const active = d.querySelector('.MuiTab-root.Mui-selected, [role="tab"][aria-selected="true"]');
      const tabOk = active ? /^nhận xét$|^comments$/i.test((active.innerText || '').trim()) : false;
      const hasSessionBar = Array.from(d.querySelectorAll('.info-container, div')).some(n => /^#\s*1\b/.test((n.innerText || '').trim()));
      return tabOk && hasSessionBar;
    }, { timeout: 10000 });

    if (!ok) throw new Error('Timeout chờ tab Nhận xét và danh sách buổi học hiển thị.');
  }

  function findCardWrapper(infoEl, drawerEl) {
    let cur = infoEl;
    for (let i = 0; i < 3 && cur && cur !== drawerEl; i++) {
      if (cur.classList && (
        cur.classList.contains('active') ||
        cur.classList.contains('inactive') ||
        cur.classList.contains('disabled')
      )) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return (infoEl.parentElement && infoEl.parentElement.parentElement && infoEl.parentElement.parentElement !== drawerEl)
      ? infoEl.parentElement.parentElement
      : (infoEl.parentElement || infoEl);
  }

  function checkNodeDisabled(nodes) {
    return nodes.some(node => {
      if (node.classList && node.classList.contains('disabled')) return true;
      if (node.hasAttribute && (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true')) return true;
      const style = window.getComputedStyle(node);
      const opacity = parseFloat(style.opacity || '1');
      if (!Number.isNaN(opacity) && opacity < 0.8) return true;
      if (style.pointerEvents === 'none') return true;
      return false;
    });
  }

  async function handleGetSessions() {
    await openCommentsTab();
    const drawer = getDrawer();
    if (!drawer) throw new Error('Drawer chưa mở.');

    const infoContainers = Array.from(drawer.querySelectorAll('.info-container'));
    const candidates = infoContainers.length > 0
      ? infoContainers
      : Array.from(drawer.querySelectorAll('div')).filter(d => {
          const text = (d.innerText || '').trim();
          return d.children.length > 0 && /^#\s*\d+/i.test(text) && text.length < 60 && !d.querySelector('input[type="checkbox"]');
        });

    const cardWrappers = [];
    const seen = new Set();
    const rawItems = [];

    candidates.forEach((infoEl) => {
      const text = (infoEl.innerText || '').trim();
      const match = text.match(/^#\s*(\d+)/);
      if (!match) return;
      const num = parseInt(match[1], 10);
      if (seen.has(num)) return;
      seen.add(num);

      const cardWrapper = findCardWrapper(infoEl, drawer);
      const idx = cardWrappers.length;
      cardWrapper.setAttribute('data-mindx-sess', String(idx));
      cardWrappers.push(cardWrapper);

      rawItems.push({ idx, num, text, infoEl, cardWrapper });
    });

    const fiberSessions = await callMainWorld('GET_SESSIONS_FIBER');
    const slotMap = new Map();
    if (Array.isArray(fiberSessions)) {
      fiberSessions.forEach(item => slotMap.set(item.idx, item.slotId));
    }

    const sessions = rawItems.map(({ idx, num, text, infoEl, cardWrapper }) => {
      const outerCard = infoEl.parentElement || infoEl;
      const dateMatch = text.match(/\d{2}\/\d{2}/);
      const dateStr = dateMatch ? dateMatch[0] : '';
      const isCompleted = cardWrapper.querySelector('input[type="checkbox"]:checked') !== null || text.includes('Đã nhận xét');
      const isActive = cardWrapper.classList.contains('active') || outerCard.classList.contains('active') || infoEl.classList.contains('active');
      const isDisabled = checkNodeDisabled([infoEl, infoEl.parentElement, cardWrapper].filter(Boolean));
      const isAvailable = !isDisabled;
      const slotId = slotMap.get(idx) || `session-slot-${num}`;

      return {
        sessionNumber: num,
        sessionDate: dateStr,
        sessionId: slotId,
        title: `Buổi ${num}${dateStr ? ` (${dateStr})` : ''}`,
        sessionName: `Buổi ${num}`,
        rawText: text.replace(/\n+/g, ' ').trim(),
        isActive,
        isCompleted: Boolean(isCompleted),
        isAvailable,
        isPastOrToday: isAvailable,
        type: 'CARD'
      };
    }).sort((a, b) => a.sessionNumber - b.sessionNumber);

    log('INFO', `[SessionService] Tìm thấy ${sessions.length} buổi học trong Drawer.`);
    return { success: true, sessions };
  }

  async function handleSelectSession(sessionNumber) {
    const sNum = parseInt(sessionNumber, 10);
    await openCommentsTab();
    const drawer = getDrawer();
    if (!drawer) throw new Error('Drawer chưa mở.');

    const re = new RegExp('^#\\s*' + sNum + '\\b');
    const infoContainers = Array.from(drawer.querySelectorAll('.info-container'));
    let target = infoContainers.find(d => re.test((d.innerText || '').trim()));

    if (!target) {
      const candidates = Array.from(drawer.querySelectorAll('div')).filter(d => {
        const t = (d.innerText || '').trim();
        return re.test(t) && t.length < 45 && !d.querySelector('input[type="checkbox"]');
      });
      target = candidates[candidates.length - 1] || null;
    }

    if (!target) {
      return {
        success: false,
        sessionNumber: sNum,
        warning: 'NOT_FOUND_ON_UI',
        message: `Không tìm thấy Buổi ${sNum} trong Drawer.`
      };
    }

    const cardWrapper = findCardWrapper(target, drawer);
    const isDisabled = checkNodeDisabled([target, target.parentElement, cardWrapper].filter(Boolean));
    const text = (target.innerText || '').trim().replace(/\n+/g, ' ');
    const dateMatch = text.match(/\d{2}\/\d{2}/);
    const sessionDate = dateMatch ? dateMatch[0] : '';

    if (isDisabled) {
      return {
        success: false,
        sessionNumber: sNum,
        sessionDate,
        isAvailable: false,
        isPastOrToday: false,
        warning: 'SESSION_NOT_AVAILABLE',
        message: 'Buổi học này chưa diễn ra nên chưa có dữ liệu điểm danh và danh sách học viên.'
      };
    }

    for (let i = 0; i < 6; i++) {
      const rect = target.getBoundingClientRect();
      const drawerRect = drawer.getBoundingClientRect();
      if (rect.left >= drawerRect.left && rect.right <= drawerRect.right - 20) break;
      const nextArrow = drawer.querySelector('svg[data-testid="KeyboardArrowRightIcon"], svg[data-testid="ChevronRightIcon"]');
      if (nextArrow) {
        const btn = nextArrow.closest('button, div[role="button"]');
        if (btn) btn.click();
      }
      target.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
      await sleep(100);
    }

    target.click();

    const verified = await waitForCondition(() => {
      const d = getDrawer();
      if (!d) return false;
      const activeCard = Array.from(d.querySelectorAll('.active')).some(c => re.test((c.innerText || '').trim()));
      const hasSummary = Array.from(d.querySelectorAll('div')).some(n => !n.closest('.MuiTabs-root') && /tổng\s*k[eéêế]t|summary/i.test(n.innerText || ''));
      const drawerTxt = d.innerText || '';
      const hasTableHeader = Boolean(d.querySelector('table thead')) && /học viên|student/i.test(drawerTxt);
      const hasStudentRows = d.querySelectorAll('tbody tr').length > 0;
      const hasNoData = /không có dữ liệu|no data/i.test(drawerTxt);
      return activeCard && (hasSummary || hasTableHeader || hasStudentRows || hasNoData);
    }, { timeout: 12000 });

    if (!verified) {
      throw new Error(`Đã click Buổi ${sNum} nhưng không xác minh được trạng thái active trong Drawer.`);
    }

    log('INFO', `[SessionService] Đã chọn và xác minh Buổi ${sNum}`);
    return {
      success: true,
      verified: true,
      sessionNumber: sNum,
      sessionDate,
      isAvailable: true,
      isPastOrToday: true,
      rawText: text
    };
  }

  // =========================================================================
  // 4. SUMMARY (Đọc & Điền Quill Editor trong .MuiDrawer-modal)
  // =========================================================================
  function readCurrentSummaryText() {
    const drawer = getDrawer();
    if (!drawer) return '';

    const containers = Array.from(drawer.querySelectorAll('div, section')).filter(
      node => !node.closest('.MuiTabs-root') && node.children.length >= 1
    );

    const summaryContainer = containers.find(node => {
      const t = (node.innerText || '').trim();
      return /tổng\s*k[eéêế]t|summary/i.test(t) && t.length < 800 && node.children.length <= 4;
    });

    if (!summaryContainer) return '';
    const lines = (summaryContainer.innerText || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(line => !/^(tổng\s*k[eéêế]t|summary)$/i.test(line));
    const joined = lines.join('\n').trim();
    if (joined && joined.toLowerCase() !== 'điền nội dung buổi học') {
      return joined;
    }
    return '';
  }

  async function handleGetSummary(sessionNumber = null) {
    if (sessionNumber !== null && sessionNumber !== undefined && !Number.isNaN(Number(sessionNumber))) {
      const selRes = await handleSelectSession(Number(sessionNumber));
      if (!selRes.success) return selRes;
    }
    const summary = readCurrentSummaryText();
    return { success: true, summary };
  }

  async function fillContentEditable(el, text) {
    el.focus();
    await sleep(60);

    // Chọn toàn bộ và ghi đè trực tiếp bằng execCommand để Quill tự nhận sự kiện & auto-save
    document.execCommand('selectAll', false, null);
    await sleep(40);
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted || !compareContent(el.innerText || '', text)) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('delete', false, null);
      const retryInserted = document.execCommand('insertText', false, text);
      if (!retryInserted || !compareContent(el.innerText || '', text)) {
        const lines = text.split(/\r?\n/);
        if (lines.length <= 1) {
          el.innerText = text;
        } else {
          el.innerHTML = lines.map(line => line.trim() ? `<p>${line}</p>` : '<p><br></p>').join('');
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await sleep(150);
  }

  async function handleFillSummary(content, forceOverwrite = true) {
    if (!content || !content.trim()) {
      throw new Error('Nội dung Summary không được để trống.');
    }
    const cleanTargetText = content.trim();
    const drawer = getDrawer();
    if (!drawer) throw new Error('Drawer lớp học chưa mở, không thể nhập Summary.');

    const existingSummary = readCurrentSummaryText();
    if (existingSummary && existingSummary.length > 0 && !forceOverwrite) {
      return {
        success: false,
        status: 'ALREADY_EXISTS',
        existingSummary,
        message: 'Summary đã tồn tại nội dung.'
      };
    }

    const findSummarySection = () => {
      const labelSpan = Array.from(drawer.querySelectorAll('span, div')).find(n => {
        if (n.closest('.MuiTabs-root') || n.closest('table')) return false;
        return /^(tổng\s*k[eéêế]t|summary)$/i.test((n.innerText || '').trim());
      });
      if (!labelSpan) return { labelSpan: null, section: null };

      let section = labelSpan.parentElement;
      for (let i = 0; i < 4 && section && section !== drawer; i++) {
        if (section.className && (String(section.className).includes('jss565') || String(section.className).includes('jss557'))) break;
        if (section.querySelector('svg[data-testid="CloudDoneIcon"]') || section.children.length >= 2) {
          const parentText = (section.innerText || '').trim();
          if (!/bài\s*(tập)?\s*về\s*nhà|homework/i.test(parentText)) break;
        }
        section = section.parentElement;
      }
      return { labelSpan, section };
    };

    const { labelSpan, section } = findSummarySection();
    if (!section) throw new Error('Không tìm thấy tiêu đề Tổng kết / Summary trong Drawer.');

    const existingEditor = section.querySelector('.ql-editor[contenteditable="true"], [contenteditable="true"], textarea');
    if (!existingEditor || !isVisible(existingEditor)) {
      const hasBody = section.querySelector('[class*="jss574"], [class*="jss566"], .ql-editor, p');
      if (!hasBody) {
        const headerRow = labelSpan.closest('[class*="jss564"]') || labelSpan;
        dispatchFullClick(headerRow);
        await sleep(400);
      }

      const { section: refreshedSection } = findSummarySection();
      const contentTarget = refreshedSection && (
        refreshedSection.querySelector('[class*="jss574"]') ||
        refreshedSection.querySelector('p') ||
        refreshedSection.querySelector('[class*="jss566"] > div') ||
        refreshedSection.querySelector('[class*="jss566"]') ||
        Array.from(refreshedSection.querySelectorAll('div')).find(d => {
          const t = (d.innerText || '').trim();
          return t.length > 0 && !/^(tổng\s*k[eéêế]t|summary)$/i.test(t) && d.children.length <= 2;
        })
      );

      if (contentTarget) {
        contentTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
        dispatchFullClick(contentTarget);
      }
    }

    const editorEl = await waitForCondition(() => {
      const d = getDrawer();
      if (!d) return null;
      const label = Array.from(d.querySelectorAll('span, div')).find(n => /^(tổng\s*k[eéêế]t|summary)$/i.test((n.innerText || '').trim()));
      if (!label) return null;
      let sec = label.parentElement;
      for (let i = 0; i < 4 && sec && sec !== d; i++) {
        const ed = sec.querySelector('.ql-editor[contenteditable="true"], [contenteditable="true"], textarea');
        if (ed && isVisible(ed)) return ed;
        sec = sec.parentElement;
      }
      return null;
    }, { timeout: 5000 });

    if (!editorEl) {
      throw new Error('Đã click vùng Summary nhưng Rich Text Editor (.ql-editor) không mở ra.');
    }

    if (editorEl.tagName === 'TEXTAREA') {
      editorEl.focus();
      setNativeValue(editorEl, cleanTargetText);
    } else {
      await fillContentEditable(editorEl, cleanTargetText);
    }

    await sleep(300);
    if (typeof editorEl.blur === 'function') editorEl.blur();
    editorEl.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    editorEl.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    // Web tự lưu khi blur / click nhẹ ra vùng tiêu đề bảng học viên (nếu có)
    const outsideTarget = drawer.querySelector('table thead');
    if (outsideTarget) dispatchFullClick(outsideTarget);

    await waitForCondition(() => {
      const d = getDrawer();
      return d && Boolean(d.querySelector('svg[data-testid="CloudDoneIcon"]'));
    }, { timeout: 8000 });

    await sleep(1000);
    const readAfterSave = readCurrentSummaryText();
    const isSaveVerified = compareContent(readAfterSave, cleanTargetText);

    if (!isSaveVerified) {
      return {
        success: false,
        status: 'VERIFY_FAILED',
        message: 'Đã nhập Summary nhưng nội dung đọc lại không khớp.',
        savedContent: readAfterSave
      };
    }

    log('INFO', '[SummaryService] Đã lưu và xác minh Summary thành công trên MindX LMS!');
    return {
      success: true,
      status: 'VERIFIED',
      message: 'Đã lưu và xác minh Summary thành công trên MindX LMS.',
      savedContent: readAfterSave
    };
  }

  // =========================================================================
  // 5. STUDENTS & COMMENTS
  // =========================================================================
  async function handleGetStudents(sessionNumber = null) {
    if (sessionNumber !== null && sessionNumber !== undefined && !Number.isNaN(Number(sessionNumber))) {
      const selRes = await handleSelectSession(Number(sessionNumber));
      if (!selRes.success) return selRes;
    }

    const drawer = getDrawer();
    if (!drawer) throw new Error('LOAD_STUDENTS_FAILED: Drawer lớp học chưa mở.');

    const state = await waitForCondition(() => {
      const d = getDrawer();
      if (!d) return false;
      const rows = Array.from(d.querySelectorAll('table tbody tr, tbody tr.MuiTableRow-root'));
      const hasStudents = rows.some(r => /nhận xét học sinh|có mặt|vắng|nghỉ có phép|nghỉ không phép|chưa điểm danh|attended|absent|cannot comment on absent student/i.test(r.innerText || ''));
      if (hasStudents) return 'HAS_STUDENTS';
      const drawerTxt = (d.innerText || '').toLowerCase();
      const hasTableHeader = Boolean(d.querySelector('table thead')) && /học viên|student/i.test(drawerTxt);
      if (drawerTxt.includes('không có dữ liệu') || drawerTxt.includes('no data') || (hasTableHeader && rows.length === 0)) {
        return 'EMPTY_VALID';
      }
      return false;
    }, { timeout: 10000 });

    if (!state) {
      throw new Error('LOAD_STUDENTS_FAILED: Timeout chờ danh sách học viên render trong Drawer.');
    }

    const rows = Array.from(drawer.querySelectorAll('table tbody tr, tbody tr.MuiTableRow-root'));
    const validRows = [];

    rows.forEach((row, idx) => {
      const textContent = (row.innerText || '').trim();
      const isStudentRow = /nhận xét học sinh|nhận xét|comment|vắng|nghỉ có phép|nghỉ không phép|có mặt|chưa điểm danh|attended|absent|cannot comment on absent student/i.test(textContent);
      if (!isStudentRow) return;
      row.setAttribute('data-mindx-st', String(idx));
      validRows.push({ row, idx, textContent });
    });

    const fiberStudents = await callMainWorld('GET_STUDENTS_FIBER');
    const stIdMap = new Map();
    if (Array.isArray(fiberStudents)) {
      fiberStudents.forEach(item => stIdMap.set(item.idx, item.realStudentId));
    }

    const students = [];
    validRows.forEach(({ row, idx, textContent }) => {
      const cells = Array.from(row.querySelectorAll('td'));
      const firstColText = cells[0] ? cells[0].innerText.trim() : textContent;
      const firstColLines = firstColText.split('\n').map(s => s.trim()).filter(Boolean);
      const studentName = firstColLines[0] || '';
      const attendanceLabel = firstColLines.slice(1).join(' ').replace(/^✓\s*/, '').trim() || 'Có mặt';

      if (!studentName || studentName.toLowerCase() === 'học viên' || studentName.toLowerCase() === 'student') return;

      let attendanceStatus = 'ATTENDED';
      const lowerAtt = attendanceLabel.toLowerCase();
      const lowerText = textContent.toLowerCase();
      if (
        lowerAtt.includes('vắng') ||
        lowerAtt.includes('absent') ||
        lowerAtt.includes('nghỉ') ||
        lowerText.includes('cannot comment on absent student') ||
        lowerText.includes('không thể viết nhận xét')
      ) {
        attendanceStatus = 'ABSENT';
      } else if (lowerAtt.includes('chưa điểm danh') || lowerAtt.includes('unmarked')) {
        attendanceStatus = 'UNMARKED';
      }

      const buttons = Array.from(row.querySelectorAll('button'));
      const commentBtn = buttons.find(b => /nhận xét học sinh|nhận xét|comment/i.test(b.innerText || ''));
      const isCommentBtnDisabled = commentBtn ? (commentBtn.disabled || commentBtn.classList.contains('Mui-disabled')) : false;

      const canComment =
        attendanceStatus !== 'ABSENT' &&
        !lowerText.includes('không thể viết nhận xét') &&
        !lowerText.includes('cannot comment on absent student') &&
        Boolean(commentBtn) &&
        !isCommentBtnDisabled;

      let commentStatus = 'PENDING';
      if (lowerText.includes('phê duyệt tự động')) {
        commentStatus = 'APPROVED';
      } else if (lowerText.includes('đã nhận xét')) {
        commentStatus = 'COMMENTED';
      }

      const realStudentId = stIdMap.get(idx) || null;
      students.push({
        rowIndex: idx,
        id: realStudentId || `student-row-${idx}`,
        studentId: realStudentId,
        name: studentName,
        studentName,
        attendance: attendanceStatus,
        attendanceStatus,
        attendanceLabel,
        hasComment: commentStatus !== 'PENDING',
        commentStatus,
        canComment,
        studentProduct: cells.length >= 3 ? cells[2].innerText.trim() : ''
      });
    });

    log('INFO', `[CommentService] Đã quét được ${students.length} học viên.`);
    return { success: true, students };
  }

  function getLastDialog() {
    const dialogs = Array.from(document.querySelectorAll('.MuiDialog-root, [role="dialog"], .ant-modal'))
      .filter(el => !el.classList.contains('MuiDrawer-modal') && isVisible(el));
    return dialogs[dialogs.length - 1] || null;
  }

  function detectEditorInModal(modal) {
    if (!modal) return null;
    const selectors = [
      { type: 'QUILL', sel: '.ql-editor[contenteditable="true"]' },
      { type: 'CKEDITOR', sel: '.ck-editor__editable[contenteditable="true"]' },
      { type: 'CONTENTEDITABLE', sel: '[contenteditable="true"]' },
      { type: 'TEXTAREA', sel: 'textarea.ant-input, textarea' }
    ];
    for (const { type, sel } of selectors) {
      const el = modal.querySelector(sel);
      if (el && isVisible(el)) return { type, element: el };
    }
    return null;
  }

  function readModalContent(modal) {
    const ed = detectEditorInModal(modal);
    if (ed) {
      if (ed.type === 'TEXTAREA') {
        const val = ed.element.value || '';
        if (val.trim()) return val.trim();
      } else {
        const txt = ed.element.innerText || ed.element.textContent || '';
        if (txt.trim()) return txt.trim();
      }
    }
    const rubricP = modal.querySelector('.jss613 p, table.jss661 p, .actionContainer + div p, td p');
    if (rubricP && rubricP.innerText.trim()) return rubricP.innerText.trim();
    const generalDiv = modal.querySelector('.jss613, .actionContainer + div');
    if (generalDiv && generalDiv.innerText.trim()) return generalDiv.innerText.trim();
    const table = modal.querySelector('table.jss661, table');
    if (table && table.innerText.trim()) return table.innerText.trim();
    return '';
  }

  async function closeCommentModal() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const modal = getLastDialog();
      if (!modal) return;

      const closeBtn = Array.from(modal.querySelectorAll('button')).find(b =>
        b.getAttribute('aria-label')?.toLowerCase() === 'close' ||
        b.classList.contains('ant-modal-close') ||
        /^(đóng|hủy|cancel|no|không)$/i.test((b.innerText || '').trim())
      );

      if (closeBtn) {
        dispatchFullClick(closeBtn);
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        const backdrop = modal.querySelector('.MuiBackdrop-root');
        if (backdrop) dispatchFullClick(backdrop);
      }

      const closed = await waitForCondition(() => !getLastDialog(), { timeout: 1500 });
      if (closed) return;
    }
  }

  async function handleCommentSingle(studentName, commentText, forceOverwrite = true) {
    if (!studentName || !commentText || !commentText.trim()) {
      throw new Error('Tên học viên hoặc nội dung nhận xét không được để trống.');
    }

    const drawer = getDrawer();
    const scope = drawer || document;
    const rows = Array.from(scope.querySelectorAll('tr, .MuiTableRow-root, .ant-table-row, .student-card'));
    const studentRow = rows.find(r => (r.innerText || '').includes(studentName));
    if (!studentRow) {
      throw new Error(`Không tìm thấy hàng thông tin của học viên "${studentName}" trên giao diện.`);
    }

    const commentBtn = Array.from(studentRow.querySelectorAll('button')).find(b =>
      /nhận xét học sinh|nhận xét|comment/i.test(b.innerText || '')
    );
    if (!commentBtn) {
      throw new Error(`Không tìm thấy nút "Nhận xét" cho học viên "${studentName}".`);
    }

    commentBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
    dispatchFullClick(commentBtn);

    const modal = await waitForCondition(() => {
      const d = getLastDialog();
      if (!d) return null;
      return (d.innerText || '').includes(studentName) ? d : null;
    }, { timeout: 10000 }) || await waitForCondition(() => getLastDialog(), { timeout: 3000 });
    if (!modal) {
      throw new Error(`Không mở được modal nhận xét cho "${studentName}".`);
    }
    await sleep(600);

    try {
      const existingText = readModalContent(modal);
      if (existingText && existingText.length > 15 && !forceOverwrite) {
        await closeCommentModal();
        return {
          success: true,
          status: 'SKIPPED_ALREADY_EXISTS',
          studentName,
          existingComment: existingText,
          message: 'Đã bỏ qua vì học viên đã có nhận xét từ trước.'
        };
      }

      const checkEditMode = (m) => {
        const hasEd = Boolean(detectEditorInModal(m));
        const hasSave = Array.from(m.querySelectorAll('button')).some(b => /^(lưu|save|hoàn thành)$/i.test((b.innerText || '').trim()));
        return hasEd && hasSave;
      };

      let activeModal = modal;
      if (!checkEditMode(modal)) {
        const editBtn = Array.from(modal.querySelectorAll('button')).find(b =>
          /chỉnh sửa|^sửa$|^edit$/i.test((b.innerText || '').trim())
        ) || modal.querySelector('.anticon-edit');

        if (editBtn && isVisible(editBtn)) {
          dispatchFullClick(editBtn);
        } else {
          const nodes = Array.from(modal.querySelectorAll('div, p, span')).filter(n => {
            if (n.closest('.MuiSwitch-root') || n.querySelector('.MuiSwitch-root, input[type="checkbox"], button')) return false;
            const t = (n.innerText || '').trim();
            return /đánh giá chung|general/i.test(t) && t.length < 1500;
          });
          const reversed = [...nodes].reverse();
          const target =
            reversed.find(n => /-\s*đánh giá chung/i.test((n.innerText || '').trim())) ||
            modal.querySelector('.jss613, .actionContainer + div') ||
            nodes[0];
          if (target) {
            target.scrollIntoView({ behavior: 'instant', block: 'center' });
            dispatchFullClick(target);
          }
        }

        const enteredEdit = await waitForCondition(() => {
          if (checkEditMode(modal)) return modal;
          const m = getLastDialog();
          return (m && checkEditMode(m)) ? m : null;
        }, { timeout: 6000 });

        if (!enteredEdit) {
          throw new Error(`Không thể chuyển modal nhận xét của "${studentName}" sang chế độ Sửa (Edit Mode).`);
        }
        activeModal = enteredEdit;
      }

      let ed = detectEditorInModal(activeModal);
      if (!ed) {
        const switchInput = activeModal.querySelector('.MuiSwitch-input');
        if (switchInput && !switchInput.checked) {
          switchInput.click();
          await sleep(500);
          const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => /^có$/i.test((b.innerText || '').trim()));
          if (confirmBtn) {
            confirmBtn.click();
            await sleep(800);
          }
          ed = detectEditorInModal(activeModal);
        }
      }

      if (!ed) {
        throw new Error(`Không tìm thấy vùng nhập nhận xét cho "${studentName}".`);
      }

      if (ed.type === 'TEXTAREA') {
        ed.element.focus();
        setNativeValue(ed.element, commentText.trim());
      } else {
        await fillContentEditable(ed.element, commentText.trim());
      }

      await sleep(250);

      const saveBtn = Array.from(activeModal.querySelectorAll('button')).find(b =>
        /^(lưu|save|hoàn thành)$/i.test((b.innerText || '').trim())
      ) || activeModal.querySelector('.ant-btn-primary');

      if (!saveBtn || !isVisible(saveBtn)) {
        throw new Error(`Không tìm thấy nút Lưu/Save trong modal của "${studentName}".`);
      }

      saveBtn.click();

      await waitForCondition(() => {
        const m = getLastDialog();
        if (!m) return true;
        const hasSave = Array.from(m.querySelectorAll('button')).some(b => /^(lưu|save|hoàn thành)$/i.test((b.innerText || '').trim()));
        return !hasSave;
      }, { timeout: 8000 });

      await sleep(800);
      const afterModal = getLastDialog();
      const readAfterSave = afterModal ? readModalContent(afterModal) : '';
      const isSaveVerified = afterModal ? compareContent(readAfterSave, commentText) : true;

      await closeCommentModal();

      if (!isSaveVerified) {
        return {
          success: true,
          status: 'SAVED_UNVERIFIED',
          studentName,
          message: 'Đã nhập nhận xét nhưng dữ liệu đọc lại có thể cần thời gian đồng bộ.',
          savedContent: readAfterSave
        };
      }

      log('INFO', `[CommentService] Đã lưu và xác minh nhận xét cho "${studentName}".`);
      return {
        success: true,
        status: 'VERIFIED',
        studentName,
        message: `Đã nhập và xác minh nhận xét thành công cho ${studentName}.`,
        savedContent: readAfterSave
      };
    } catch (err) {
      await closeCommentModal().catch(() => {});
      throw err;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        const { action } = message || {};
        if (action === 'LMS_LOGIN') {
          sendResponse(await handleLogin(message.email, message.password));
        } else if (action === 'LMS_CHECK_LOGIN_ERROR') {
          sendResponse(handleCheckLoginError());
        } else if (action === 'LMS_GET_CLASSES') {
          sendResponse(await handleGetClasses(message.filterStatus, message.searchKeyword));
        } else if (action === 'LMS_SELECT_CLASS') {
          sendResponse(await handleSelectClass(message.classId, message.classCode));
        } else if (action === 'LMS_SPA_SELECT_CLASS') {
          await callMainWorld('SPA_NAVIGATE_CLASS', { classId: message.classId });
          sendResponse(await handleVerifyClassDrawer(message.classId, message.classCode, { timeout: 3500 }));
        } else if (action === 'LMS_VERIFY_CLASS_DRAWER') {
          sendResponse(await handleVerifyClassDrawer(message.classId, message.classCode));
        } else if (action === 'LMS_GET_SESSIONS') {
          sendResponse(await handleGetSessions());
        } else if (action === 'LMS_SELECT_SESSION') {
          sendResponse(await handleSelectSession(message.sessionNumber));
        } else if (action === 'LMS_GET_SUMMARY') {
          sendResponse(await handleGetSummary(message.sessionNumber));
        } else if (action === 'LMS_FILL_SUMMARY') {
          sendResponse(await handleFillSummary(message.content, message.forceOverwrite));
        } else if (action === 'LMS_GET_STUDENTS') {
          sendResponse(await handleGetStudents(message.sessionNumber));
        } else if (action === 'LMS_COMMENT_SINGLE') {
          sendResponse(await handleCommentSingle(message.studentName, message.commentText, message.forceOverwrite));
        } else {
          sendResponse({ success: false, error: `Unknown LMS action: ${action}` });
        }
      } catch (err) {
        log('ERROR', `[ContentLMS] ${err.message}`);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  });
})();
