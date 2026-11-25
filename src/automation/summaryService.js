const fs = require('fs');
const path = require('path');
const browserManager = require('./browserManager');
const editorService = require('./editorService');
const sessionService = require('./sessionService');
const logger = require('../utils/logger');
const { AutomationError } = require('../utils/errorHandler');

class SummaryService {
  /**
   * Đọc chi tiết cả 2 trường Summary (Tổng kết) và Homework (Bài về nhà) từ tab Nhận xét
   * Đảm bảo tách biệt 100%, không gộp hai trường dữ liệu
   */
  async getSummaryAndHomework() {
    const page = await browserManager.getPage();
    const drawer = page.locator('.MuiDrawer-modal');
    if (!await drawer.isVisible().catch(() => false)) {
      throw new AutomationError('Drawer lớp học (.MuiDrawer-modal) chưa mở, không thể đọc Summary.');
    }

    logger.info('[SummaryService] Đang đọc nội dung Summary và Homework bên trong Drawer...');

    const data = await drawer.evaluate((el) => {
      let summaryText = '';
      let homeworkText = '';
      let isSummaryFound = false;
      let isHomeworkFound = false;
      let isSummaryExpanded = false;
      let isHomeworkExpanded = false;

      // Chỉ tìm trong Drawer, loại bỏ thanh tab bar
      const containers = Array.from(el.querySelectorAll('div, section')).filter(
        node => !node.closest('.MuiTabs-root') && node.children.length >= 1
      );

      // 1. Tìm container Tổng kết (hỗ trợ cả "Tổng kết" và typo LMS "Tổng két")
      const summaryContainer = containers.find(node => {
        const t = (node.innerText || '').trim();
        return /tổng\s*k[eéêế]t|summary/i.test(t) && t.length < 800 && node.children.length <= 4;
      });

      if (summaryContainer) {
        isSummaryFound = true;
        isSummaryExpanded = true;
        // Lấy toàn bộ text của container, loại bỏ dòng tiêu đề "Tổng kết / Tổng két"
        const lines = (summaryContainer.innerText || '')
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
          .filter(line => !/^(tổng\s*k[eéêế]t|summary)$/i.test(line));
        const joined = lines.join('\n').trim();
        if (joined && joined.toLowerCase() !== 'điền nội dung buổi học') {
          summaryText = joined;
        }
      }

      // 2. Tìm container Bài về nhà (Homework)
      const hwContainer = containers.find(node => {
        const t = (node.innerText || '').trim();
        return /bài\s*(tập)?\s*về\s*nhà|homework/i.test(t) && t.length < 800 && node.children.length <= 4;
      });

      if (hwContainer) {
        isHomeworkFound = true;
        isHomeworkExpanded = true;
        const lines = (hwContainer.innerText || '')
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
          .filter(line => !/^(bài\s*(tập)?\s*về\s*nhà|homework)$/i.test(line));
        const joined = lines.join('\n').trim();
        if (joined && joined.toLowerCase() !== 'điền bài tập về nhà') {
          homeworkText = joined;
        }
      }

      return {
        summaryText,
        homeworkText,
        isSummaryFound,
        isHomeworkFound,
        isSummaryExpanded,
        isHomeworkExpanded
      };
    });

    logger.info(`[SummaryService] Summary (found: ${data.isSummaryFound}): "${data.summaryText.substring(0, 60)}" | Homework (found: ${data.isHomeworkFound}): "${data.homeworkText.substring(0, 60)}"`);
    return data;
  }

  /**
   * Đọc nội dung Summary hiện tại trên LMS
   */
  async readCurrentSummary() {
    const data = await this.getSummaryAndHomework();
    return data.summaryText;
  }

  /**
   * Đọc nội dung Bài về nhà hiện tại trên LMS
   */
  async readCurrentHomework() {
    const data = await this.getSummaryAndHomework();
    return data.homeworkText;
  }

  /**
   * Tìm vùng container Summary để phục vụ nhập liệu
   */
  async findSummaryContainer() {
    const page = await browserManager.getPage();
    const summaryHeader = page.locator('div, h3, h4, span, p').filter({
      hasText: /^(tổng kết|summary)$/i
    }).first();

    if (await summaryHeader.isVisible().catch(() => false)) {
      return summaryHeader;
    }
    return page;
  }

  /**
   * Chụp ảnh minh chứng Summary vào thư mục screenshots/ ở root dự án
   */
  async _captureSummaryProof(prefix) {
    const page = await browserManager.getPage();
    const proofDir = path.join(__dirname, '..', '..', 'screenshots');
    if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });
    const filePath = path.join(proofDir, `${prefix}_${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    logger.info(`[SummaryService] Đã lưu ảnh minh chứng: ${filePath}`);
    return filePath;
  }

  /**
   * Nhập & Ghi đè Summary trực tiếp lên MindX LMS bên trong Drawer (.MuiDrawer-modal)
   * Cơ chế thực tế LMS: Click vào vùng nội dung dưới "Tổng kết / Tổng két / Summary" -> mở Quill Editor ->
   * Control+A -> Backspace -> điền nội dung mới -> blur để auto-save -> chờ CloudDoneIcon (tick xanh) -> Verify.
   */
  async fillAndSaveSummary(content, options = {}) {
    const { forceOverwrite = true } = options;

    if (!content || !content.trim()) {
      throw new AutomationError('Nội dung Summary không được để trống.');
    }

    const cleanTargetText = content.trim();
    const page = await browserManager.getPage();
    const drawer = page.locator('.MuiDrawer-modal');
    if (!await drawer.isVisible().catch(() => false)) {
      throw new AutomationError('Drawer lớp học (.MuiDrawer-modal) chưa mở, không thể nhập Summary.');
    }

    const currentSession = sessionService.getCurrentSession();
    if (currentSession && currentSession.isAvailable === false) {
      throw new AutomationError('Buổi học này chưa diễn ra nên không thể nhập Summary.');
    }

    logger.info(`[SummaryService] Bắt đầu Fill & Ghi đè Summary (${cleanTargetText.length} ký tự) bên trong Drawer...`);

    try {
      // Bước 1: Kiểm tra Summary hiện tại nếu forceOverwrite === false
      const existingSummary = await this.readCurrentSummary();
      if (existingSummary && existingSummary.length > 0 && !forceOverwrite) {
        logger.warn('[SummaryService] Summary đã có dữ liệu từ trước và forceOverwrite=false.');
        return {
          success: false,
          status: 'ALREADY_EXISTS',
          existingSummary,
          message: 'Summary đã tồn tại nội dung.'
        };
      }

      // Bước 2: Đảm bảo khối Tổng kết / Summary đang mở (không bị thu gọn) rồi click vùng nội dung để mở Quill Editor
      const expandAndClickResult = await drawer.evaluate(el => {
        const labelSpan = Array.from(el.querySelectorAll('span, div')).find(n => {
          if (n.closest('.MuiTabs-root') || n.closest('table')) return false;
          return /^(tổng\s*k[eéêế]t|summary)$/i.test((n.innerText || '').trim());
        });
        if (!labelSpan) return { found: false, reason: 'Không tìm thấy tiêu đề Tổng kết / Summary trong Drawer' };

        // Đi lên container của khối Summary
        let section = labelSpan.parentElement;
        for (let i = 0; i < 4 && section && section !== el; i++) {
          if (section.className && (section.className.includes('jss565') || section.className.includes('jss557'))) break;
          if (section.querySelector('svg[data-testid="CloudDoneIcon"]') || section.children.length >= 2) {
            const parentText = (section.innerText || '').trim();
            if (!/bài\s*(tập)?\s*về\s*nhà|homework/i.test(parentText)) break;
          }
          section = section.parentElement;
        }
        if (!section) return { found: false, reason: 'Không xác định được container Summary' };

        // Nếu khối Summary đang bị thu gọn (chưa có vùng nội dung), click tiêu đề để mở rộng
        const hasBody = section.querySelector('[class*="jss574"], [class*="jss566"], .ql-editor, p');
        if (!hasBody) {
          const headerRow = labelSpan.closest('[class*="jss564"]') || labelSpan;
          headerRow.click();
          return { found: true, expandedOnly: true };
        }

        // Tìm vùng nội dung có thể click (p, .jss574, hoặc vùng text không phải tiêu đề)
        const contentTarget =
          section.querySelector('[class*="jss574"], p') ||
          Array.from(section.querySelectorAll('div')).find(d => {
            const t = (d.innerText || '').trim();
            return t.length > 0 && !/^(tổng\s*k[eéêế]t|summary)$/i.test(t) && d.children.length <= 2;
          });

        if (!contentTarget) return { found: false, reason: 'Không tìm thấy vùng nhập Summary để click' };
        contentTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
        contentTarget.click();
        return { found: true, expandedOnly: false };
      });

      if (!expandAndClickResult.found) {
        throw new AutomationError(expandAndClickResult.reason || 'Không tìm thấy vùng Summary trong Drawer.');
      }

      if (expandAndClickResult.expandedOnly) {
        await page.waitForTimeout(400);
        await drawer.evaluate(el => {
          const labelSpan = Array.from(el.querySelectorAll('span, div')).find(n => {
            if (n.closest('.MuiTabs-root') || n.closest('table')) return false;
            return /^(tổng\s*k[eéêế]t|summary)$/i.test((n.innerText || '').trim());
          });
          let section = labelSpan ? labelSpan.parentElement : null;
          for (let i = 0; i < 4 && section && section !== el; i++) {
            if (section.querySelector('[class*="jss574"], p')) break;
            section = section.parentElement;
          }
          const contentTarget = section ? (section.querySelector('[class*="jss574"], p') || section.querySelector('[class*="jss566"]')) : null;
          if (contentTarget) contentTarget.click();
        });
      }

      // Bước 3: Chờ Quill Editor (.ql-editor[contenteditable="true"]) xuất hiện trong khối Summary của Drawer
      const editorAppeared = await page.waitForFunction(() => {
        const d = document.querySelector('.MuiDrawer-modal');
        if (!d) return false;
        const label = Array.from(d.querySelectorAll('span, div')).find(n => /^(tổng\s*k[eéêế]t|summary)$/i.test((n.innerText || '').trim()));
        if (!label) return false;
        let sec = label.parentElement;
        for (let i = 0; i < 4 && sec && sec !== d; i++) {
          const ed = sec.querySelector('.ql-editor[contenteditable="true"], [contenteditable="true"], textarea');
          if (ed) return true;
          sec = sec.parentElement;
        }
        return false;
      }, { timeout: 5000 }).then(() => true).catch(() => false);

      if (!editorAppeared) {
        throw new AutomationError('Đã click vùng Summary nhưng Rich Text Editor (.ql-editor) không mở ra.');
      }

      // Bước 4: Focus vào .ql-editor trong khối Summary, xóa sạch nội dung cũ (Control+A -> Backspace) và điền nội dung mới
      const summaryEditor = drawer.locator('.ql-editor[contenteditable="true"], [contenteditable="true"], textarea').first();
      await summaryEditor.click();
      await summaryEditor.focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(150);
      await page.keyboard.insertText(cleanTargetText);
      await page.waitForTimeout(400);

      // Bước 5: Kích hoạt auto-save bằng cách blur ra ngoài (KHÔNG click vào tiêu đề Tổng kết để tránh thu gọn accordion)
      await summaryEditor.evaluate(el => {
        if (typeof el.blur === 'function') el.blur();
      });
      await drawer.locator('table thead').first().click({ force: true }).catch(() => {});

      // Chờ LMS hiển thị CloudDoneIcon (đám mây tick xanh) xác nhận đã lưu
      await page.waitForFunction(() => {
        const d = document.querySelector('.MuiDrawer-modal');
        if (!d) return false;
        return Boolean(d.querySelector('svg[data-testid="CloudDoneIcon"]'));
      }, { timeout: 8000 }).catch(() => {
        logger.warn('[SummaryService] Chưa thấy CloudDoneIcon trong timeout, tiếp tục đọc lại để xác minh...');
      });
      await page.waitForTimeout(1200);

      // Bước 6: Verify sau khi lưu - đọc lại nội dung Summary thực tế từ Drawer
      const readAfterSave = await this.readCurrentSummary();
      const isSaveVerified = editorService.compareContent(readAfterSave, cleanTargetText);

      if (!isSaveVerified) {
        const failShot = await this._captureSummaryProof('summary_fill_failed');
        logger.error(`[SummaryService] VERIFY FAILED: Nội dung đọc lại ("${readAfterSave}") không khớp với "${cleanTargetText}".`);
        return {
          success: false,
          status: 'VERIFY_FAILED',
          message: 'Đã nhập Summary nhưng nội dung đọc lại không khớp.',
          savedContent: readAfterSave,
          screenshotPath: failShot
        };
      }

      const successShot = await this._captureSummaryProof('summary_fill_success');
      logger.info('[SummaryService] XÁC MINH THÀNH CÔNG: Summary đã được ghi đè và lưu 100% trên MindX LMS!');
      return {
        success: true,
        status: 'VERIFIED',
        message: 'Đã lưu và xác minh Summary thành công trên MindX LMS.',
        savedContent: readAfterSave,
        screenshotPath: successShot
      };
    } catch (err) {
      const failShot = await this._captureSummaryProof('summary_fill_failed').catch(() => null);
      logger.error(`[SummaryService] Lỗi Fill Summary: ${err.message}`);
      err.screenshotPath = failShot;
      throw err;
    }
  }
}

module.exports = new SummaryService();
