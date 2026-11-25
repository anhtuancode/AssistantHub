const fs = require('fs');
const path = require('path');
const browserManager = require('./browserManager');
const editorService = require('./editorService');
const logger = require('../utils/logger');
const { AutomationError, VerificationError } = require('../utils/errorHandler');

class CommentService {
  /**
   * Lấy danh sách học viên trong buổi học hiện tại trên LMS (scoped 100% trong .MuiDrawer-modal)
   * Trả về danh sách chuẩn StudentCommentData:
   * rowIndex, studentId, studentName, attendanceStatus, attendanceLabel, commentStatus,
   * canComment, commentButtonLocator, studentWorkButtonLocator.
   */
  async getStudentsList() {
    const page = await browserManager.getPage();
    const drawer = page.locator('.MuiDrawer-modal');
    if (!await drawer.isVisible().catch(() => false)) {
      throw new AutomationError('LOAD_STUDENTS_FAILED: Drawer lớp học (.MuiDrawer-modal) chưa mở.');
    }

    logger.info('[CommentService] Bắt đầu quét danh sách học viên bên trong Drawer...');

    // Chờ bảng học viên hoặc trạng thái không có dữ liệu render xong bên trong Drawer
    const containerState = await page.waitForFunction(() => {
      const d = document.querySelector('.MuiDrawer-modal');
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
    }, { timeout: 10000 }).then(h => h.jsonValue()).catch(() => 'TIMEOUT');

    if (containerState === 'TIMEOUT') {
      await browserManager.captureScreenshot('load_students_failed');
      const drawerHtml = await drawer.evaluate(el => el.outerHTML).catch(() => '');
      const diagDir = browserManager.screenshotsDir || path.join(__dirname, 'screenshots');
      const htmlPath = path.join(diagDir, `drawer_students_failed_${Date.now()}.html`);
      try { fs.writeFileSync(htmlPath, drawerHtml, 'utf-8'); } catch (_) {}
      logger.error(`[CommentService] LOAD_STUDENTS_FAILED: Không tìm thấy vùng danh sách học viên trong Drawer. Đã lưu HTML: ${htmlPath}`);
      throw new AutomationError('LOAD_STUDENTS_FAILED: Timeout chờ danh sách học viên render trong Drawer.');
    }

    const students = await drawer.evaluate((el) => {
      const results = [];
      const rows = Array.from(el.querySelectorAll('table tbody tr, tbody tr.MuiTableRow-root'));

      rows.forEach((row, idx) => {
        const textContent = (row.innerText || '').trim();
        const isStudentRow = /nhận xét học sinh|nhận xét|comment|vắng|nghỉ có phép|nghỉ không phép|có mặt|chưa điểm danh|attended|absent|cannot comment on absent student/i.test(textContent);
        if (!isStudentRow) return;

        // Trích xuất real studentId từ React Fiber nếu có
        let realStudentId = null;
        try {
          const fiberKey = Object.keys(row).find(k => k.startsWith('__reactFiber$'));
          if (fiberKey) {
            let fiber = row[fiberKey];
            while (fiber) {
              if (fiber.memoizedProps && fiber.memoizedProps.row) {
                const r = fiber.memoizedProps.row;
                realStudentId = r.id || r._id || (r.student && (r.student.id || r.student._id));
                break;
              }
              fiber = fiber.return;
            }
          }
        } catch (_) {}

        const cells = Array.from(row.querySelectorAll('td'));
        const firstColText = cells[0] ? cells[0].innerText.trim() : textContent;
        const firstColLines = firstColText.split('\n').map(s => s.trim()).filter(Boolean);
        const studentName = firstColLines[0] || '';
        const attendanceLabel = firstColLines.slice(1).join(' ').replace(/^✓\s*/, '').trim() || 'Có mặt';

        if (!studentName || studentName.toLowerCase() === 'học viên' || studentName.toLowerCase() === 'student') return;

        // Trạng thái điểm danh
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

        // Trạng thái nhận xét & nút Nhận xét
        const buttons = Array.from(row.querySelectorAll('button'));
        const commentBtn = buttons.find(b => /nhận xét học sinh|nhận xét|comment/i.test(b.innerText || ''));
        const workBtn = buttons.find(b => /sản phẩm của học sinh|sản phẩm|student work/i.test(b.innerText || ''));
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

        const studentProduct = cells.length >= 3 ? cells[2].innerText.trim() : '';
        const rowSelector = `.MuiDrawer-modal table tbody tr:nth-child(${idx + 1})`;

        results.push({
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
          studentProduct,
          commentButtonLocator: commentBtn ? `${rowSelector} button:has-text("Nhận xét học sinh")` : null,
          studentWorkButtonLocator: workBtn ? `${rowSelector} button:has-text("Sản phẩm của học sinh")` : null,
          rawRowText: textContent
        });
      });

      return results;
    });

    logger.info(`[CommentService] Đã quét được ${students.length} học viên bên trong Drawer.`);
    await browserManager.captureScreenshot('students_list');

    if (students.length === 0) {
      logger.info('[CommentService] Buổi học xác nhận không có dữ liệu học viên (0 học viên hợp lệ).');
    }

    return students;
  }

  /**
   * Xác minh dữ liệu trước khi cho phép nhập nhận xét (Pre-fill Verification)
   */
  async verifyPreFillConditions(classContext, sessionContext, studentsList) {
    const page = await browserManager.getPage();
    logger.info('[CommentService] Đang thực hiện Pre-fill Automation Verification...');

    const isDrawerVisible = await page.locator('.MuiDrawer-modal').isVisible().catch(() => false);
    const isCommentsTabSelected = await page.evaluate(() => {
      const drawer = document.querySelector('.MuiDrawer-modal');
      if (!drawer) return false;
      const activeTab = drawer.querySelector('.MuiTab-root.Mui-selected, [role="tab"][aria-selected="true"]');
      return activeTab ? /nhận xét|comments/i.test(activeTab.innerText.trim()) : false;
    });

    const studentCount = (studentsList || []).length;
    const classIdValid = Boolean(classContext && classContext.classId && classContext.classId.length === 24);
    const classCodeValid = Boolean(classContext && classContext.classCode);
    const sessionIdValid = Boolean(sessionContext && sessionContext.sessionNumber >= 1 && sessionContext.sessionNumber <= 14);

    const verificationResult = {
      classIdValid,
      classCodeValid,
      commentsTabActive: isDrawerVisible && isCommentsTabSelected,
      sessionIdValid,
      summaryLoaded: true,
      studentsLoaded: studentCount > 0,
      studentCount,
      contextConsistent: classCodeValid && isCommentsTabSelected && studentCount > 0,
      canProceed: isDrawerVisible && isCommentsTabSelected && studentCount > 0
    };

    logger.info(`[CommentService] Pre-fill Verification Result: ${verificationResult.canProceed ? 'READY TO FILL ✅' : 'NOT READY ⚠️'}`);
    return verificationResult;
  }

  /**
   * Mở modal nhận xét cho một học viên xác định
   */
  async openCommentModal(studentName) {
    const page = await browserManager.getPage();
    logger.info(`[CommentService] Tìm và mở modal nhận xét cho học viên: "${studentName}"...`);

    // 1. Tìm hàng / container chứa đúng tên học viên đó
    const studentContainer = page.locator('tr, .MuiTableRow-root, .ant-table-row, .student-card').filter({
      hasText: studentName
    }).first();

    if (!await studentContainer.isVisible({ timeout: 5000 })) {
      throw new AutomationError(`Không tìm thấy hàng thông tin của học viên "${studentName}" trên giao diện.`);
    }

    // 2. Tìm nút "Nhận xét học sinh"
    const commentBtn = studentContainer.locator('button').filter({
      hasText: /nhận xét học sinh|nhận xét|comment/i
    }).first();

    if (!await commentBtn.isVisible({ timeout: 4000 })) {
      throw new AutomationError(`Không tìm thấy nút "Nhận xét" cho học viên "${studentName}".`);
    }

    logger.info(`[CommentService] Nhấp nút Nhận xét của học viên: "${studentName}"...`);
    try {
      await commentBtn.scrollIntoViewIfNeeded();
      await commentBtn.click({ timeout: 2500 });
    } catch (_) {
      logger.info('[CommentService] Nhấp qua evaluate click để vượt qua thanh cuộn bảng (.jss141)...');
      await commentBtn.evaluate(b => b.click());
    }

    // 3. Chờ Modal xuất hiện
    const modal = page.locator('.MuiDialog-root, [role="dialog"], [role="presentation"], .ant-modal').last();
    await modal.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);
    return modal;
  }

  /**
   * Đóng modal nhận xét hiện tại
   */
  async closeCommentModal() {
    const page = await browserManager.getPage();
    logger.info('[CommentService] Đóng modal nhận xét...');

    const modal = page.locator('.MuiDialog-root, [role="dialog"], [role="presentation"], .ant-modal').last();

    try {
      if (await modal.isVisible().catch(() => false)) {
        const closeBtn = modal.locator('button[aria-label="close" i], .ant-modal-close, button:has-text("Đóng"), button:has-text("Hủy"), button:has-text("Cancel")').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }
        await page.waitForTimeout(1000);

        if (await modal.isVisible().catch(() => false)) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }
      }
    } catch (err) {
      logger.warn(`[CommentService] Lỗi khi đóng modal: ${err.message}`);
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(500);
  }

  /**
   * Xử lý nhập nhận xét hoàn chỉnh cho một học viên với đầy đủ xác minh
   */
  async fillCommentForStudent(student, commentText, options = {}) {
    const { forceOverwrite = true } = options;
    const studentName = typeof student === 'string' ? student : student.name;
    const attendance = typeof student === 'object' ? (student.attendanceStatus || student.attendance) : null;

    if (attendance === 'ABSENT') {
      logger.info(`[CommentService] Học viên "${studentName}" vắng mặt. Bỏ qua nhận xét.`);
      return {
        success: true,
        status: 'SKIPPED_ABSENT',
        studentName,
        message: 'Học viên vắng mặt, không thể viết nhận xét.'
      };
    }

    logger.info(`[CommentService] === BẮT ĐẦU XỬ LÝ NHẬN XÉT: ${studentName} ===`);

    const page = await browserManager.getPage();

    // Bước 1: Mở modal
    const modal = await this.openCommentModal(studentName);
    await browserManager.captureScreenshot(`modal_${studentName}_opened`);

    try {
      // Bước 2: Kiểm tra nhận xét cũ trong modal (nếu có)
      const existingText = await editorService.readContent(modal);
      if (existingText && existingText.length > 15 && !forceOverwrite) {
        logger.warn(`[CommentService] Học viên "${studentName}" đã có nhận xét từ trước (${existingText.length} ký tự). Bỏ qua do chưa có lệnh ghi đè.`);
        await this.closeCommentModal();
        return {
          success: true,
          status: 'SKIPPED_ALREADY_EXISTS',
          studentName,
          existingComment: existingText,
          message: 'Đã bỏ qua vì học viên đã có nhận xét từ trước.'
        };
      }

      // Bước 3: Kiểm tra Edit Mode -> Nếu đang ở View Mode, click vào khối "- Đánh giá chung:" để mở Rich Text Editor
      const isAlreadyEditMode = await modal.evaluate(el => {
        const hasEditor = Boolean(el.querySelector('.ql-editor[contenteditable="true"], [contenteditable="true"], textarea'));
        const hasSave = Array.from(el.querySelectorAll('button')).some(b => /^(lưu|save|hoàn thành)$/i.test((b.innerText || '').trim()));
        return hasEditor && hasSave;
      }).catch(() => false);

      if (!isAlreadyEditMode) {
        const editBtn = modal.locator('button:has-text("Chỉnh sửa"), button:has-text("Sửa"), button:has-text("Edit"), .anticon-edit').first();
        if (await editBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          logger.info('[CommentService] Nhấp nút chuyển sang Edit Mode...');
          await editBtn.click();
        } else {
          logger.info('[CommentService] Modal đang ở chế độ Xem (View Mode). Click vào khối "- Đánh giá chung:" để chuyển sang Edit Mode...');
          const clickedViewBlock = await modal.evaluate(el => {
            const nodes = Array.from(el.querySelectorAll('div, p, span')).filter(n => {
              const t = (n.innerText || '').trim();
              return /đánh giá chung|general/i.test(t) && t.length < 1500;
            });
            const target = nodes.reverse().find(n => /-\s*đánh giá chung/i.test((n.innerText || '').trim())) || nodes[0];
            if (target) {
              target.click();
              return true;
            }
            return false;
          });
          if (!clickedViewBlock) {
            logger.warn('[CommentService] Không tìm thấy khối "- Đánh giá chung:" trong modal để click.');
          }
        }

        // Xác minh đã vào chế độ Sửa: chờ Rich Text Editor (.ql-editor / [contenteditable="true"]) VÀ nút Lưu/Save xuất hiện
        const enteredEditMode = await page.waitForFunction(() => {
          const dialogs = Array.from(document.querySelectorAll('.MuiDialog-root, [role="dialog"], [role="presentation"], .ant-modal'));
          const m = dialogs[dialogs.length - 1];
          if (!m) return false;
          const hasEditor = Boolean(m.querySelector('.ql-editor[contenteditable="true"], [contenteditable="true"], textarea'));
          const hasSave = Array.from(m.querySelectorAll('button')).some(b => /^(lưu|save|hoàn thành)$/i.test((b.innerText || '').trim()));
          return hasEditor && hasSave;
        }, { timeout: 6000 }).then(() => true).catch(() => false);

        if (!enteredEditMode) {
          throw new AutomationError(`Không thể chuyển modal nhận xét của "${studentName}" sang chế độ Sửa (Edit Mode).`);
        }
        logger.info('[CommentService] Đã vào Edit Mode (Rich Text Editor + nút Lưu/Save sẵn sàng).');
      }

      // Bước 4: Ghi đè nội dung mới vào Rich Text Editor (Control+A -> Backspace -> nhập nội dung mới)
      logger.info(`[CommentService] Giai đoạn 1: Nhập nhận xét mới cho ${studentName}...`);
      await editorService.fillContent(modal, commentText, { clearFirst: true });
      await browserManager.captureScreenshot(`comment_filled_${studentName}`);

      // Bước 5: Click nút Lưu / Save và chờ lưu hoàn tất
      const saveBtn = modal.locator('button:has-text("Lưu"), button:has-text("Save"), button:has-text("Hoàn thành"), .ant-btn-primary').first();
      if (!await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        throw new AutomationError(`Không tìm thấy nút Lưu/Save trong modal của "${studentName}".`);
      }

      logger.info('[CommentService] Nhấp nút Lưu/Save nhận xét...');
      await saveBtn.click();

      // Chờ request lưu hoàn tất (nút Lưu ẩn đi / quay về View Mode hoặc đợi ổn định)
      await page.waitForFunction(() => {
        const dialogs = Array.from(document.querySelectorAll('.MuiDialog-root, [role="dialog"], [role="presentation"], .ant-modal'));
        const m = dialogs[dialogs.length - 1];
        if (!m) return true;
        const hasSave = Array.from(m.querySelectorAll('button')).some(b => /^(lưu|save|hoàn thành)$/i.test((b.innerText || '').trim()));
        return !hasSave;
      }, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // Bước 6: Giai đoạn 2 - Save Verification
      logger.info('[CommentService] Giai đoạn 2: Save Verification cho học viên...');
      const readAfterSave = await editorService.readContent(modal);
      const isSaveVerified = editorService.compareContent(readAfterSave, commentText);

      await browserManager.captureScreenshot(`comment_saved_${studentName}`);

      // Đóng modal
      await this.closeCommentModal();

      if (!isSaveVerified) {
        logger.warn(`[CommentService] CẢNH BÁO: Nhận xét đọc lại của ${studentName} chưa khớp 100%.`);
        return {
          success: true,
          status: 'SAVED_UNVERIFIED',
          studentName,
          message: 'Đã nhập nhận xét nhưng dữ liệu đọc lại có thể cần thời gian đồng bộ.',
          savedContent: readAfterSave
        };
      }

      logger.info(`[CommentService] XÁC MINH THÀNH CÔNG: Nhận xét của ${studentName} đã được lưu 100%!`);
      return {
        success: true,
        status: 'VERIFIED',
        studentName,
        message: `Đã nhập và xác minh nhận xét thành công cho ${studentName}.`,
        savedContent: readAfterSave
      };

    } catch (err) {
      logger.error(`[CommentService] Lỗi khi nhận xét cho ${studentName}: ${err.message}`);
      await browserManager.captureScreenshot(`comment_error_${studentName}`);
      await this.closeCommentModal().catch(() => {});
      throw err;
    }
  }

  /**
   * Nhập nhận xét hàng loạt cho toàn bộ học viên trong danh sách
   */
  async fillBatchComments(studentsWithComments, options = {}) {
    const results = [];
    logger.info(`[CommentService] Bắt đầu nhập nhận xét hàng loạt cho ${studentsWithComments.length} học viên...`);

    for (let i = 0; i < studentsWithComments.length; i++) {
      const item = studentsWithComments[i];
      const studentName = item.name || item.studentName;
      const commentText = item.comment || item.text;

      logger.info(`[CommentService] Tiến độ: [${i + 1}/${studentsWithComments.length}] - ${studentName}`);

      try {
        const result = await this.fillCommentForStudent(item, commentText, options);
        results.push(result);
      } catch (err) {
        logger.error(`[CommentService] Thất bại tại học viên: ${studentName} (${err.message})`);
        results.push({
          success: false,
          studentName,
          error: err.message
        });
      }
    }

    return results;
  }
}

module.exports = new CommentService();
