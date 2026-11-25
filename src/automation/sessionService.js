const browserManager = require('./browserManager');
const logger = require('../utils/logger');
const { NavigationError } = require('../utils/errorHandler');

class SessionService {
  constructor() {
    this.currentSession = null;
  }

  /**
   * Trả về scoped Locator của Drawer chi tiết lớp học trên MindX LMS.
   * Mọi thao tác từ Bước 2 trở đi bắt buộc chỉ tìm kiếm bên trong drawer này.
   */
  async getDrawerLocator() {
    const page = await browserManager.getPage();
    const drawer = page.locator('.MuiDrawer-modal');
    const isVisible = await drawer.isVisible().catch(() => false);
    if (!isVisible) {
      throw new NavigationError('Drawer chi tiết lớp học (.MuiDrawer-modal) chưa mở.');
    }
    return { page, drawer };
  }

  /**
   * Mở tab Nhận xét / Comments bên trong Drawer (scoped 100% trong .MuiDrawer-modal)
   */
  async openCommentsTab(expectedClassCode = null) {
    const { page, drawer } = await this.getDrawerLocator();
    logger.info('[SessionService] Đang tìm và mở tab Nhận xét bên trong Drawer...');

    // Xác minh classCode bên trong drawer nếu được cung cấp
    if (expectedClassCode) {
      const drawerText = await drawer.innerText().catch(() => '');
      if (!drawerText.includes(expectedClassCode)) {
        throw new NavigationError(`Ngữ cảnh Drawer không khớp lớp "${expectedClassCode}".`);
      }
    }

    // Kiểm tra xem tab Nhận xét bên trong drawer đã active chưa
    const isAlreadyActive = await drawer.evaluate(el => {
      const active = el.querySelector('.MuiTab-root.Mui-selected, [role="tab"][aria-selected="true"]');
      return active ? /^nhận xét$|^comments$/i.test((active.innerText || '').trim()) : false;
    }).catch(() => false);

    if (!isAlreadyActive) {
      // Cuộn tới tab Nhận xét bên trong drawer và click
      const clicked = await drawer.evaluate(el => {
        const tabs = Array.from(el.querySelectorAll('.MuiTab-root, [role="tab"]'));
        const target = tabs.find(t => /^nhận xét$|^comments$/i.test((t.innerText || '').trim()));
        if (target) {
          target.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
          target.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        throw new NavigationError('Không tìm thấy tab "Nhận xét" / "Comments" bên trong Drawer.');
      }

      logger.info('[SessionService] Đã nhấp tab Nhận xét bên trong Drawer.');
    }

    // Chờ tab Nhận xét chuyển sang trạng thái active VÀ thanh buổi học xuất hiện trong drawer
    await page.waitForFunction(() => {
      const d = document.querySelector('.MuiDrawer-modal');
      if (!d) return false;
      const active = d.querySelector('.MuiTab-root.Mui-selected, [role="tab"][aria-selected="true"]');
      const tabOk = active ? /^nhận xét$|^comments$/i.test((active.innerText || '').trim()) : false;
      const hasSessionBar = Array.from(d.querySelectorAll('.info-container, div')).some(n => /^#\s*1\b/.test((n.innerText || '').trim()));
      return tabOk && hasSessionBar;
    }, { timeout: 10000 });

    await browserManager.captureScreenshot('comments_tab_opened');
  }

  /**
   * Alias chuẩn hóa theo đặc tả nghiệp vụ: SessionService.loadSessions()
   */
  async loadSessions(expectedClassCode = null) {
    return await this.getSessionsList(expectedClassCode);
  }

  /**
   * Lấy danh sách các buổi học trong tab Nhận xét (scoped 100% trong .MuiDrawer-modal)
   * Phân loại rõ buổi đã diễn ra (isAvailable/isPastOrToday: true) vs buổi tương lai bị làm mờ (false).
   */
  async getSessionsList(expectedClassCode = null) {
    await this.openCommentsTab(expectedClassCode);
    const { drawer } = await this.getDrawerLocator();

    logger.info('[SessionService] Đang đọc danh sách các buổi học bên trong Drawer...');

    const sessions = await drawer.evaluate(el => {
      const result = [];
      const seen = new Set();

      // Tìm các session card bên trong drawer (ưu tiên .info-container hoặc card chứa #N)
      const infoContainers = Array.from(el.querySelectorAll('.info-container'));
      const candidates = infoContainers.length > 0
        ? infoContainers
        : Array.from(el.querySelectorAll('div')).filter(d => {
            const text = (d.innerText || '').trim();
            return d.children.length > 0 && /^#\s*\d+/i.test(text) && text.length < 60 && !d.querySelector('input[type="checkbox"]');
          });

      const findCardWrapper = (infoEl) => {
        let cur = infoEl;
        for (let i = 0; i < 3 && cur && cur !== el; i++) {
          if (cur.classList && (
            cur.classList.contains('active') ||
            cur.classList.contains('inactive') ||
            cur.classList.contains('disabled')
          )) {
            return cur;
          }
          cur = cur.parentElement;
        }
        return (infoEl.parentElement && infoEl.parentElement.parentElement && infoEl.parentElement.parentElement !== el)
          ? infoEl.parentElement.parentElement
          : (infoEl.parentElement || infoEl);
      };

      const checkIsDisabled = (infoEl, cardWrapper) => {
        const nodes = [infoEl, infoEl.parentElement, cardWrapper].filter(Boolean);
        return nodes.some(node => {
          if (node.classList && node.classList.contains('disabled')) return true;
          if (node.hasAttribute && (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true')) return true;
          const style = window.getComputedStyle(node);
          const opacity = parseFloat(style.opacity || '1');
          if (!Number.isNaN(opacity) && opacity < 0.8) return true;
          if (style.pointerEvents === 'none') return true;
          return false;
        });
      };

      candidates.forEach(infoEl => {
        const text = (infoEl.innerText || '').trim();
        const match = text.match(/^#\s*(\d+)/);
        if (!match) return;

        const num = parseInt(match[1], 10);
        if (seen.has(num)) return;
        seen.add(num);

        const cardWrapper = findCardWrapper(infoEl);
        const outerCard = infoEl.parentElement || infoEl;
        const dateMatch = text.match(/\d{2}\/\d{2}/);
        const dateStr = dateMatch ? dateMatch[0] : '';
        const isCompleted = cardWrapper.querySelector('input[type="checkbox"]:checked') !== null || text.includes('Đã nhận xét');
        const isActive = cardWrapper.classList.contains('active') || outerCard.classList.contains('active') || infoEl.classList.contains('active');
        const isDisabled = checkIsDisabled(infoEl, cardWrapper);
        const isAvailable = !isDisabled;

        // Trích xuất slotId từ React Fiber nếu có
        let slotId = null;
        try {
          const fiberKey = Object.keys(cardWrapper).find(k => k.startsWith('__reactFiber$'))
            || Object.keys(outerCard).find(k => k.startsWith('__reactFiber$'))
            || Object.keys(infoEl).find(k => k.startsWith('__reactFiber$'));
          const fiberTarget = Object.keys(cardWrapper).find(k => k.startsWith('__reactFiber$'))
            ? cardWrapper
            : (Object.keys(outerCard).find(k => k.startsWith('__reactFiber$')) ? outerCard : infoEl);
          if (fiberKey) {
            let fiber = fiberTarget[fiberKey];
            while (fiber) {
              if (fiber.memoizedProps && (fiber.memoizedProps.slot || fiber.memoizedProps.session)) {
                const s = fiber.memoizedProps.slot || fiber.memoizedProps.session;
                slotId = s.id || s._id;
                break;
              }
              fiber = fiber.return;
            }
          }
        } catch (_) {}

        result.push({
          sessionNumber: num,
          sessionDate: dateStr,
          sessionId: slotId || `session-slot-${num}`,
          title: `Buổi ${num}${dateStr ? ` (${dateStr})` : ''}`,
          sessionName: `Buổi ${num}`,
          rawText: text.replace(/\n+/g, ' ').trim(),
          isActive,
          isCompleted: Boolean(isCompleted),
          isAvailable,
          isPastOrToday: isAvailable,
          type: 'CARD'
        });
      });

      return result.sort((a, b) => a.sessionNumber - b.sessionNumber);
    });

    if (sessions.length === 0) {
      logger.warn('[SessionService] CẢNH BÁO: Quét được 0 buổi học trong Drawer! Tiến hành chụp ảnh điều tra.');
      await browserManager.captureScreenshot('zero_sessions_detected');
    }

    const availableCount = sessions.filter(s => s.isAvailable).length;
    const futureCount = sessions.length - availableCount;
    logger.info(`[SessionService] Tìm thấy ${sessions.length} buổi học trong Drawer (${availableCount} đã diễn ra, ${futureCount} chưa diễn ra).`);
    return sessions;
  }

  /**
   * Chuyển sang buổi học cụ thể bên trong Drawer (click đúng .info-container, tránh checkbox)
   * Tự động cuộn / click nút mũi tên '>' nếu buổi học nằm khuất bên phải.
   * Kiểm tra buổi đã diễn ra (isAvailable === true) trước khi click và xác minh VERIFY_SESSION_ACTIVE.
   */
  async selectSession(sessionNumber, expectedDate = null) {
    const sNum = parseInt(sessionNumber, 10);
    logger.info(`[SessionService] SELECT_SESSION: Bắt đầu chọn Buổi ${sNum} bên trong Drawer...`);

    // Đảm bảo đang ở tab Nhận xét trong Drawer
    await this.openCommentsTab();
    const { page, drawer } = await this.getDrawerLocator();

    // Tìm thẻ buổi học và kiểm tra trạng thái khả dụng (isAvailable)
    const selectResult = await drawer.evaluate((el, { num, dateFilter }) => {
      const re = new RegExp('^#\\s*' + num + '\\b');
      const infoContainers = Array.from(el.querySelectorAll('.info-container'));
      let target = infoContainers.find(d => {
        const t = (d.innerText || '').trim();
        if (!re.test(t)) return false;
        if (dateFilter && !t.includes(dateFilter)) return false;
        return true;
      });

      // Fallback nếu không có class .info-container
      if (!target) {
        const candidates = Array.from(el.querySelectorAll('div')).filter(d => {
          const t = (d.innerText || '').trim();
          return re.test(t) && t.length < 45 && !d.querySelector('input[type="checkbox"]');
        });
        target = candidates[candidates.length - 1] || null;
      }

      if (!target) return { found: false };

      // Tìm card wrapper để kiểm tra class disabled / opacity
      let cardWrapper = target;
      for (let i = 0; i < 3 && cardWrapper && cardWrapper !== el; i++) {
        if (cardWrapper.classList && (
          cardWrapper.classList.contains('active') ||
          cardWrapper.classList.contains('inactive') ||
          cardWrapper.classList.contains('disabled')
        )) {
          break;
        }
        cardWrapper = cardWrapper.parentElement;
      }

      const nodes = [target, target.parentElement, cardWrapper].filter(Boolean);
      const isDisabled = nodes.some(node => {
        if (node.classList && node.classList.contains('disabled')) return true;
        if (node.hasAttribute && (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true')) return true;
        const style = window.getComputedStyle(node);
        const opacity = parseFloat(style.opacity || '1');
        if (!Number.isNaN(opacity) && opacity < 0.8) return true;
        if (style.pointerEvents === 'none') return true;
        return false;
      });

      const text = (target.innerText || '').trim().replace(/\n+/g, ' ');
      const dateMatch = text.match(/\d{2}\/\d{2}/);

      // Cuộn ngang cho tới khi thẻ buổi học hiển thị trong viewport của thanh buổi học
      target.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
      const rect = target.getBoundingClientRect();
      return {
        found: true,
        isAvailable: !isDisabled,
        sessionDate: dateMatch ? dateMatch[0] : '',
        text,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
      };
    }, { num: sNum, dateFilter: expectedDate });

    if (!selectResult.found) {
      logger.warn(`[SessionService] Không tìm thấy thẻ Buổi ${sNum} bên trong Drawer.`);
      return {
        success: false,
        sessionNumber: sNum,
        warning: 'NOT_FOUND_ON_UI',
        message: `Không tìm thấy Buổi ${sNum} trong Drawer.`
      };
    }

    // Quy tắc nghiệp vụ: Buổi chưa diễn ra (disabled/mờ) -> Dừng ngay, không click và không chạy LOAD_STUDENTS
    if (!selectResult.isAvailable) {
      const msg = 'Buổi học này chưa diễn ra nên chưa có dữ liệu điểm danh và danh sách học viên.';
      logger.warn(`[SessionService] Buổi ${sNum} (${selectResult.text}) chưa diễn ra (disabled/mờ). Dừng ngay, không chạy LOAD_STUDENTS.`);
      this.currentSession = {
        sessionNumber: sNum,
        sessionDate: selectResult.sessionDate,
        title: `Buổi ${sNum}`,
        rawText: selectResult.text,
        isAvailable: false,
        isPastOrToday: false,
        verified: false
      };
      return {
        success: false,
        sessionNumber: sNum,
        sessionDate: selectResult.sessionDate,
        isAvailable: false,
        isPastOrToday: false,
        warning: 'SESSION_NOT_AVAILABLE',
        message: msg
      };
    }

    // Nếu thẻ nằm ngoài vùng nhìn thấy (hoặc bị che), cuộn / click nút '>' của thanh buổi học rồi click .info-container
    await drawer.evaluate((el, num) => {
      const re = new RegExp('^#\\s*' + num + '\\b');
      const target = Array.from(el.querySelectorAll('.info-container')).find(d => re.test((d.innerText || '').trim()));
      if (!target) return;
      for (let i = 0; i < 6; i++) {
        const rect = target.getBoundingClientRect();
        const drawerRect = el.getBoundingClientRect();
        if (rect.left >= drawerRect.left && rect.right <= drawerRect.right - 20) break;
        const nextArrow = el.querySelector('svg[data-testid="KeyboardArrowRightIcon"], svg[data-testid="ChevronRightIcon"]');
        if (nextArrow) {
          const btn = nextArrow.closest('button, div[role="button"]');
          if (btn) btn.click();
        }
        target.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
      }
      target.click();
    }, sNum);

    logger.info(`[SessionService] VERIFY_SESSION_ACTIVE: Đang xác minh Buổi ${sNum} chuyển sang active và render Summary / bảng học viên...`);

    // Xác minh (Verify): Chờ thẻ buổi học active VÀ vùng Summary hoặc tiêu đề cột bảng học viên render xong
    const verified = await page.waitForFunction((num) => {
      const d = document.querySelector('.MuiDrawer-modal');
      if (!d) return false;
      const re = new RegExp('^#\\s*' + num + '\\b');
      const activeCard = Array.from(d.querySelectorAll('.active')).some(c => re.test((c.innerText || '').trim()));
      const hasSummary = Array.from(d.querySelectorAll('div')).some(n => !n.closest('.MuiTabs-root') && /tổng\s*k[eéêế]t|summary/i.test(n.innerText || ''));
      const drawerTxt = d.innerText || '';
      const hasTableHeader = Boolean(d.querySelector('table thead')) && /học viên|student/i.test(drawerTxt);
      const hasStudentRows = d.querySelectorAll('tbody tr').length > 0;
      const hasNoData = /không có dữ liệu|no data/i.test(drawerTxt);
      return activeCard && (hasSummary || hasTableHeader || hasStudentRows || hasNoData);
    }, sNum, { timeout: 12000 }).then(() => true).catch(() => false);

    if (!verified) {
      await browserManager.captureScreenshot(`session_${sNum}_verify_failed`);
      throw new NavigationError(`VERIFY_SESSION_ACTIVE_FAILED: Đã click Buổi ${sNum} nhưng không xác minh được trạng thái active và vùng Summary/học viên trong Drawer.`);
    }

    const activeText = await drawer.evaluate((el, num) => {
      const re = new RegExp('^#\\s*' + num + '\\b');
      const activeCard = Array.from(el.querySelectorAll('.active')).find(c => re.test((c.innerText || '').trim()));
      return activeCard ? (activeCard.innerText || '').trim().replace(/\n+/g, ' ') : '';
    }, sNum).catch(() => selectResult.text);

    await browserManager.captureScreenshot(`session_${sNum}_selected`);
    this.currentSession = {
      sessionNumber: sNum,
      sessionDate: selectResult.sessionDate,
      title: `Buổi ${sNum}`,
      rawText: activeText || selectResult.text,
      isAvailable: true,
      isPastOrToday: true,
      verified: true
    };
    logger.info(`[SessionService] VERIFY_SESSION_ACTIVE thành công — Buổi ${sNum}: "${this.currentSession.rawText}"`);
    return {
      success: true,
      verified: true,
      sessionNumber: sNum,
      sessionDate: selectResult.sessionDate,
      isAvailable: true,
      isPastOrToday: true,
      rawText: this.currentSession.rawText
    };
  }

  getCurrentSession() {
    return this.currentSession;
  }
}

module.exports = new SessionService();
