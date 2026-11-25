const fs = require('fs');
const path = require('path');
const browserManager = require('./browserManager');
const logger = require('../utils/logger');
const { NavigationError, AuthError } = require('../utils/errorHandler');
const { retryOperation } = require('../utils/retryHandler');

class ClassService {
  constructor() {
    this.classesUrl = 'https://lms.mindx.edu.vn/admin/classes';
    this.currentContext = null;
    this.classesCache = [];
    this.allClassesCache = [];
  }

  /**
   * Tạo URL chi tiết lớp học chuẩn theo cấu trúc MindX LMS:
   * https://lms.mindx.edu.vn/admin/classes?tab=0&id=%22{CLASS_ID}%22
   */
  buildClassDetailUrl(classId) {
    const url = new URL(this.classesUrl);
    url.searchParams.set('tab', '0');
    url.searchParams.set('id', `"${classId}"`);
    return url.toString();
  }

  /**
   * Ghi nhận đầy đủ thông tin chẩn đoán khi điều hướng lớp học thất bại
   */
  async captureNavigationFailureDiagnostics(page, reason, details = {}) {
    const actualUrl = page ? page.url() : null;
    const isLoginRedirect = Boolean(actualUrl && actualUrl.includes('base.mindx.edu.vn/login'));
    const timestamp = Date.now();

    let screenshotPath = null;
    let snapshotPath = null;
    let domSummary = null;

    try {
      screenshotPath = await browserManager.captureScreenshot('class_nav_failed');
    } catch (_) {}

    try {
      if (page && !page.isClosed()) {
        domSummary = await page.evaluate(() => ({
          url: window.location.href,
          title: document.title,
          drawerVisible: Boolean(document.querySelector('.MuiDrawer-modal')),
          drawerText: document.querySelector('.MuiDrawer-modal')
            ? document.querySelector('.MuiDrawer-modal').innerText.substring(0, 1000)
            : '',
          bodySnippet: document.body ? document.body.innerText.substring(0, 1500) : '',
          htmlSnippet: document.documentElement ? document.documentElement.outerHTML.substring(0, 5000) : ''
        }));

        const diagDir = browserManager.screenshotsDir || path.join(__dirname, 'screenshots');
        snapshotPath = path.join(diagDir, `dom_snapshot_${timestamp}.json`);
        fs.writeFileSync(
          snapshotPath,
          JSON.stringify(
            {
              timestamp: new Date().toISOString(),
              reason,
              httpStatus: details.httpStatus || null,
              isLoginRedirect,
              actualUrl,
              ...domSummary
            },
            null,
            2
          ),
          'utf-8'
        );
      }
    } catch (_) {}

    logger.error(
      `[ClassService] Điều hướng lớp thất bại: ${reason} | URL: ${actualUrl} | HTTP: ${details.httpStatus || 'N/A'} | LoginRedirect: ${isLoginRedirect} | Screenshot: ${screenshotPath} | Snapshot: ${snapshotPath}`
    );

    return {
      actualUrl,
      httpStatus: details.httpStatus || null,
      isLoginRedirect,
      screenshotPath,
      snapshotPath
    };
  }

  /**
   * Đóng Drawer chi tiết lớp học nếu đang mở
   */
  async closeDrawer() {
    const page = await browserManager.getPage();
    const openDrawer = page.locator('.MuiDrawer-modal');
    try {
      if (await openDrawer.isVisible().catch(() => false)) {
        logger.info('[ClassService] Đóng Drawer hiện tại bằng Escape...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        if (await openDrawer.isVisible().catch(() => false)) {
          const backdrop = page.locator('.MuiBackdrop-root').first();
          if (await backdrop.isVisible().catch(() => false)) {
            await backdrop.click({ position: { x: 10, y: 10 }, force: true }).catch(() => {});
            await page.waitForTimeout(800);
          }
        }
      }
    } catch (_) {}
    this.currentContext = null;
  }

  /**
   * Lấy danh sách lớp học từ trang https://lms.mindx.edu.vn/admin/classes
   * Trích xuất đầy đủ: classId (MongoDB ObjectId), classCode, className, courseName, teacherName.
   */
  async getClassesList(options = {}) {
    const { filterStatus = 'running', searchKeyword = '' } = options;
    logger.info(`[ClassService] Bắt đầu tải danh sách lớp học từ LMS (Lọc: ${filterStatus})...`);

    const page = await browserManager.getPage();

    // Đảm bảo đóng Drawer trước khi đọc danh sách
    await this.closeDrawer();

    // Đảm bảo đang ở trang admin/classes (tránh reload thừa nếu warmup vừa mở sẵn trang này)
    await retryOperation(async () => {
      const currentUrl = page.url();
      if (!currentUrl.includes('/admin/classes') || currentUrl.includes('id=')) {
        logger.info(`[ClassService] Điều hướng đến: ${this.classesUrl}`);
        await page.goto(this.classesUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      }
    }, { description: 'Truy cập trang danh sách lớp' });

    // Kiểm tra xem có bị chuyển về trang login không
    if (page.url().includes('base.mindx.edu.vn/login')) {
      throw new AuthError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }

    // Chờ bảng dữ liệu hiển thị (chờ có ít nhất 1 dòng tr trong tbody)
    logger.info('[ClassService] Đang chờ bảng lớp học xuất hiện trên giao diện...');
    try {
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('tbody tr, .MuiTableRow-root.MuiTableRow-hover');
        return rows.length > 0;
      }, { timeout: 15000 });
    } catch (_) {
      logger.warn('[ClassService] Hết thời gian chờ dòng dữ liệu lớp học, tiếp tục quét DOM...');
    }

    await page.waitForTimeout(250);

    // Nếu có ô tìm kiếm và người dùng yêu cầu search
    if (searchKeyword) {
      const searchInput = await page.$('input[placeholder*="tìm kiếm" i], input[placeholder*="search" i]');
      if (searchInput && await searchInput.isVisible()) {
        logger.info(`[ClassService] Tìm kiếm lớp với từ khóa: ${searchKeyword}`);
        await searchInput.fill(searchKeyword);
        await searchInput.press('Enter');
        await page.waitForTimeout(1500);
      }
    }

    // Đọc danh sách các dòng lớp học kèm ID thực tế từ React Fiber / DOM và xác định chính xác cột Status theo header
    const classes = await page.evaluate(() => {
      const headerCells = Array.from(document.querySelectorAll('table thead th, table thead td, .MuiTableHead-root th, .MuiTableHead-root td'));
      let statusColIdx = headerCells.findIndex(th => /^(status|trạng\s*thái)$/i.test((th.innerText || '').trim()));
      if (statusColIdx < 0) {
        statusColIdx = headerCells.findIndex(th => /status|trạng\s*thái/i.test((th.innerText || '').trim()));
      }

      let rows = Array.from(document.querySelectorAll('tbody tr, .MuiTableRow-root.MuiTableRow-hover, tr.ant-table-row'));
      rows = rows.filter(r => !r.classList.contains('MuiTableRow-head') && !r.closest('thead'));

      return rows.map((row, index) => {
        // Trích xuất real object model từ React Fiber props
        let realRowData = null;
        try {
          const fiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber$'));
          if (fiberKey) {
            let fiber = row[fiberKey];
            while (fiber) {
              if (fiber.memoizedProps && fiber.memoizedProps.row) {
                realRowData = fiber.memoizedProps.row;
                break;
              }
              fiber = fiber.return;
            }
          }
        } catch (_) {}

        const cells = Array.from(row.querySelectorAll('td'));
        const textParts = cells.map(c => c.innerText.trim());

        const realId = realRowData ? realRowData.id : null;
        let classCode = realRowData ? realRowData.name : (textParts[1] || textParts[0] || '');
        let courseName = realRowData && realRowData.course ? realRowData.course.name : (textParts[2] || '');
        let teacherName = '';
        if (realRowData && realRowData.teachers && realRowData.teachers.length > 0 && realRowData.teachers[0].teacher) {
          teacherName = realRowData.teachers[0].teacher.fullName || realRowData.teachers[0].teacher.username || '';
        } else if (textParts[12]) {
          teacherName = textParts[12];
        }

        // Xác định Status chính xác từ cột Status (theo header) hoặc React Fiber
        const domStatus = statusColIdx >= 0 && cells[statusColIdx] ? cells[statusColIdx].innerText.trim() : '';
        const fiberStatus = realRowData && realRowData.status ? String(realRowData.status).trim() : '';
        const statusText = (domStatus || fiberStatus || '').replace(/\n+/g, ' ').trim();
        let schedule = textParts[8] || textParts[7] || '';

        const cleanCode = (classCode || '').replace(/\n+/g, ' ').trim();
        const cleanCourse = (courseName || '').replace(/\n+/g, ' ').trim();
        const cleanSchedule = (schedule || '').replace(/\n+/g, ' ').trim();
        const cleanTeacher = (teacherName || '').replace(/\n+/g, ' ').trim();

        // Thu thập thông tin slots/buổi học nếu có trong fiber
        const slotsCount = realRowData && realRowData.slots ? realRowData.slots.length : (realRowData ? realRowData.numberOfSessions : 14);

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
          numberOfSessions: slotsCount || 14,
          fullRowText: row.innerText.trim()
        };
      });
    });

    logger.info(`[ClassService] Đã quét được ${classes.length} dòng dữ liệu lớp học.`);

    // LỌC CỨNG: Chỉ giữ lại các lớp có trạng thái khớp chính xác "Running" hoặc "Đang diễn ra"
    const filteredClasses = classes.filter(c => {
      if (!filterStatus || filterStatus === 'all') return true;
      const s = (c.statusText || '').trim().toLowerCase();
      if (filterStatus === 'running') {
        return s === 'running' || s === 'đang diễn ra';
      }
      return true;
    });

    logger.info(`[ClassService] Số lớp sau khi lọc (${filterStatus}): ${filteredClasses.length}`);
    this.allClassesCache = classes;
    this.classesCache = filteredClasses;
    return filteredClasses;
  }

  /**
   * Điều hướng trực tiếp vào trang chi tiết lớp học bằng Class ID qua URL:
   * https://lms.mindx.edu.vn/admin/classes?tab=0&id=%22{CLASS_ID}%22
   * Không sử dụng phương thức tìm hoặc click dòng lớp trong tbody.
   * Trả về ClassContext gồm: classId, classCode, className, isDrawerOpen.
   */
  async navigateToClass(classInput) {
    if (!classInput) {
      throw new NavigationError('Class ID lớp học không được để trống.');
    }

    let targetClassId = null;
    let expectedClassCode = null;
    let expectedClassName = null;

    if (typeof classInput === 'object' && classInput !== null) {
      targetClassId = (classInput.classId || classInput.id || '').trim();
      expectedClassCode = (classInput.classCode || classInput.code || '').trim() || null;
      expectedClassName = (classInput.className || classInput.title || '').trim() || null;
    } else if (typeof classInput === 'string') {
      const raw = classInput.trim();
      const cached = (this.allClassesCache || []).find(
        c => c.classId === raw || c.id === raw || c.classCode === raw || c.code === raw
      );
      if (cached && cached.classId) {
        targetClassId = cached.classId;
        expectedClassCode = cached.classCode || cached.code;
        expectedClassName = cached.className || cached.title;
      } else {
        targetClassId = raw;
      }
    }

    if (!targetClassId) {
      throw new NavigationError('Không xác định được Class ID hợp lệ để điều hướng.');
    }

    const page = await browserManager.getPage();
    this.currentContext = null;

    // Tạo URL chuẩn bằng URL API / searchParams: ?tab=0&id=%22{CLASS_ID}%22
    const targetUrl = this.buildClassDetailUrl(targetClassId);
    logger.info(`[ClassService] Điều hướng trực tiếp bằng Class ID: ${targetClassId} -> ${targetUrl}`);

    let response = null;
    try {
      response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    } catch (gotoErr) {
      await this.captureNavigationFailureDiagnostics(page, `Lỗi page.goto(): ${gotoErr.message}`, { httpStatus: null });
      throw new NavigationError(`Không thể truy cập URL lớp học (${targetUrl}): ${gotoErr.message}`);
    }

    const httpStatus = response ? response.status() : null;
    const actualUrl = page.url();

    // 1. Kiểm tra chuyển hướng đăng nhập / hết phiên
    if (actualUrl.includes('base.mindx.edu.vn/login')) {
      await this.captureNavigationFailureDiagnostics(page, 'Phiên đăng nhập đã hết hạn (redirect về login)', { httpStatus });
      throw new AuthError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }

    // 2. Kiểm tra HTTP 401/403 hoặc Forbidden
    if (httpStatus === 401 || httpStatus === 403) {
      await this.captureNavigationFailureDiagnostics(page, `HTTP ${httpStatus} Forbidden / Unauthorized`, { httpStatus });
      if (httpStatus === 401) {
        throw new AuthError('Lỗi xác thực (HTTP 401). Vui lòng đăng nhập lại.');
      }
      throw new NavigationError(`Không có quyền truy cập lớp học (HTTP ${httpStatus} Forbidden).`);
    }

    // 3. Chờ Drawer chi tiết lớp tải hoàn tất (hoặc phát hiện redirect login)
    const drawer = page.locator('.MuiDrawer-modal');
    const drawerOrLogin = await page.waitForFunction(() => {
      if (window.location.href.includes('base.mindx.edu.vn/login')) return 'LOGIN_REDIRECT';
      const d = document.querySelector('.MuiDrawer-modal');
      if (!d) return false;
      const style = window.getComputedStyle(d);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const txt = (d.innerText || '').trim();
      const hasTabs = d.querySelectorAll('.MuiTab-root, [role="tab"]').length > 0;
      const hasForbidden = /\bforbidden\b|403|không có quyền|không tìm thấy|not found/i.test(txt);
      const isGenericEmpty = txt === 'Cập nhật Lớp';
      if (hasTabs || hasForbidden || (txt.length > 30 && !isGenericEmpty)) return 'DRAWER_READY';
      return false;
    }, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);

    // Re-check URL sau khi chờ SPA render/redirect
    const postWaitUrl = page.url();
    if (drawerOrLogin === 'LOGIN_REDIRECT' || postWaitUrl.includes('base.mindx.edu.vn/login')) {
      await this.captureNavigationFailureDiagnostics(page, 'Phiên đăng nhập đã hết hạn (redirect về login)', { httpStatus });
      throw new AuthError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }

    const drawerVisible = await drawer.isVisible().catch(() => false);
    if (drawerVisible) {
      await page.waitForTimeout(200);
    }

    const bodyText = await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    const drawerText = drawerVisible ? await drawer.innerText().catch(() => '') : '';

    // 4. Kiểm tra thông báo Forbidden hoặc lỗi xác thực trên giao diện
    const textToInspectForError = drawerVisible ? drawerText : bodyText;
    const forbiddenMatch = textToInspectForError.match(/\bforbidden\b|access denied|không có quyền truy cập/i);
    if (forbiddenMatch) {
      await this.captureNavigationFailureDiagnostics(page, `Phát hiện thông báo Forbidden trên giao diện LMS ("${forbiddenMatch[0]}")`, { httpStatus });
      throw new NavigationError('Không có quyền truy cập lớp học (Forbidden).');
    }

    if (/phiên đăng nhập hết hạn|unauthorized|vui lòng đăng nhập/i.test(textToInspectForError)) {
      await this.captureNavigationFailureDiagnostics(page, 'Phát hiện lỗi xác thực trên giao diện LMS', { httpStatus });
      throw new AuthError('Lỗi xác thực phiên đăng nhập MindX LMS.');
    }

    // 5. Xác minh URL chứa đúng Class ID
    const decodedUrl = decodeURIComponent(postWaitUrl);
    if (!postWaitUrl.includes(targetClassId) && !decodedUrl.includes(targetClassId)) {
      await this.captureNavigationFailureDiagnostics(page, `URL thực tế không chứa Class ID ${targetClassId}`, { httpStatus });
      throw new NavigationError(`URL sau điều hướng không khớp Class ID ${targetClassId}: ${postWaitUrl}`);
    }

    // 6. Xác minh chi tiết lớp đã tải thành công (Drawer mở và không phải trạng thái rỗng/không tồn tại)
    const hasDetailTabs = await page.evaluate(() => {
      const d = document.querySelector('.MuiDrawer-modal');
      if (!d) return false;
      const txt = d.innerText || '';
      return /thông tin chung|nhận xét|điểm danh|lịch học/i.test(txt);
    }).catch(() => false);

    if (!drawerVisible || !hasDetailTabs) {
      await this.captureNavigationFailureDiagnostics(
        page,
        `Không tải được chi tiết lớp học cho ID ${targetClassId} (ID không tồn tại hoặc dữ liệu rỗng)`,
        { httpStatus }
      );
      throw new NavigationError(`Không thể tải chi tiết lớp học với Class ID "${targetClassId}". Lớp có thể không tồn tại.`);
    }

    // 7. Trích xuất Class Code hiển thị thực tế trong Drawer và đối chiếu
    const displayedClassCode = await page.evaluate(() => {
      const d = document.querySelector('.MuiDrawer-modal');
      if (!d) return '';
      const h6 = d.querySelector('h6, h5, h4');
      if (h6 && h6.innerText.trim()) return h6.innerText.trim();
      const firstLine = (d.innerText || '').split('\n').map(s => s.trim()).find(Boolean);
      return firstLine || '';
    }).catch(() => '');

    if (expectedClassCode && !drawerText.includes(expectedClassCode)) {
      await this.captureNavigationFailureDiagnostics(
        page,
        `Mã lớp hiển thị ("${displayedClassCode}") không khớp lớp đã chọn ("${expectedClassCode}")`,
        { httpStatus }
      );
      throw new NavigationError(`Mã lớp hiển thị không khớp: mong đợi "${expectedClassCode}", thực tế "${displayedClassCode}".`);
    }

    const resolvedCode = expectedClassCode || displayedClassCode || targetClassId;
    const resolvedName = expectedClassName || resolvedCode;

    logger.info(`[ClassService] Đã điều hướng & xác minh lớp thành công: ${resolvedCode} (classId: ${targetClassId})`);
    await browserManager.captureScreenshot('class_detail_opened');

    this.currentContext = {
      classId: targetClassId,
      classCode: resolvedCode,
      className: resolvedName,
      isDrawerOpen: true,
      url: actualUrl
    };

    return {
      success: true,
      context: this.currentContext,
      currentUrl: actualUrl,
      httpStatus,
      title: await page.title()
    };
  }

  /**
   * Lấy context của lớp học đang chọn hiện tại
   */
  getCurrentContext() {
    return this.currentContext;
  }
}

module.exports = new ClassService();
