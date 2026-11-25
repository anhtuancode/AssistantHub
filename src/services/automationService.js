const browserManager = require('../automation/browserManager');
const authService = require('../automation/authService');
const classService = require('../automation/classService');
const sessionService = require('../automation/sessionService');
const summaryService = require('../automation/summaryService');
const commentService = require('../automation/commentService');
const logger = require('../utils/logger');

class AutomationService {
  constructor() {
    this.state = 'IDLE';
    this.currentTask = null;
    this.isCancelled = false;
    this.isBusy = false;
    this._activeTaskKey = null;
    this._activeTaskPromise = null;
    this._lockChain = Promise.resolve();
    this.progress = {
      current: 0,
      total: 0,
      percent: 0,
      currentStudent: ''
    };
    this.lastReport = null;
  }

  /**
   * Khóa chống gọi trùng (Request Lock / Deduplication):
   * - Nếu cùng taskKey đang chạy, trả về đúng promise đang chạy (không kích hoạt Playwright lần 2).
   * - Nếu khác taskKey, xếp hàng tuần tự để tại một thời điểm chỉ 1 tác vụ Playwright thao tác trên page.
   */
  async _withTaskLock(taskKey, fn) {
    if (this._activeTaskKey === taskKey && this._activeTaskPromise) {
      logger.warn(`[AutomationService] Bỏ qua request trùng lặp đang xử lý: ${taskKey}`);
      return await this._activeTaskPromise;
    }

    const run = async () => {
      this.isBusy = true;
      try {
        return await fn();
      } finally {
        this.isBusy = false;
        if (this._activeTaskKey === taskKey) {
          this._activeTaskKey = null;
          this._activeTaskPromise = null;
        }
      }
    };

    this._activeTaskKey = taskKey;
    const next = this._lockChain.then(run, run);
    this._lockChain = next.catch(() => {});
    this._activeTaskPromise = next;
    return await next;
  }

  setState(newState, taskName = null) {
    this.state = newState;
    this.currentTask = taskName;
    logger.info(`[State Machine] Trạng thái: ${newState} ${taskName ? `(${taskName})` : ''}`);
  }

  getState() {
    return {
      state: this.state,
      currentTask: this.currentTask,
      progress: this.progress,
      isCancelled: this.isCancelled,
      hasSavedSession: browserManager.hasSavedSession(),
      lastReport: this.lastReport
    };
  }

  cancel() {
    logger.warn('[AutomationService] Nhận tín hiệu hủy tiến trình (Cancel)...');
    this.isCancelled = true;
    this.setState('CANCELLED', 'Người dùng đã bấm hủy tiến trình');
    return { success: true, message: 'Đã gửi lệnh hủy tiến trình.' };
  }

  // --- Auth & Session ---
  async checkSession() {
    this.setState('CHECKING_SESSION');
    const result = await authService.checkSessionValid();
    this.setState(result.valid ? 'IDLE' : 'SESSION_EXPIRED');
    return result;
  }

  async login(email, password, options = {}) {
    this.setState('LOGIN', 'Đang đăng nhập vào MindX LMS');
    try {
      const result = await authService.loginWithCredentials(email, password, options);
      this.setState('IDLE', 'Đăng nhập thành công');
      return result;
    } catch (err) {
      this.setState('LOGIN_FAILED', err.message);
      throw err;
    }
  }

  async loginInteractive(timeoutMs = 180000) {
    this.setState('LOGIN', 'Đang mở trình duyệt để đăng nhập trực quan');
    try {
      const result = await authService.loginInteractive(timeoutMs);
      this.setState('IDLE', 'Đăng nhập trực quan thành công');
      return result;
    } catch (err) {
      this.setState('LOGIN_FAILED', err.message);
      throw err;
    }
  }

  async logout() {
    const res = await authService.logout();
    this.setState('IDLE');
    return res;
  }

  // --- Class Management ---
  async getClasses(options = {}) {
    return await this._withTaskLock(`LOAD_CLASSES:${options.filterStatus || 'running'}:${options.searchKeyword || ''}`, async () => {
      this.setState('LOAD_CLASSES', 'Đang tải danh sách lớp học');
      try {
        const classes = await classService.getClassesList(options);
        this.setState('IDLE');
        return classes;
      } catch (err) {
        this.setState('CLASS_NOT_FOUND', err.message);
        throw err;
      }
    });
  }

  async selectClass(classIdOrLink) {
    return await this._withTaskLock(`SELECT_CLASS:${classIdOrLink}`, async () => {
      this.setState('SELECT_CLASS', `Đang vào lớp: ${classIdOrLink}`);
      try {
        const res = await classService.navigateToClass(classIdOrLink);
        this.setState('IDLE');
        return res;
      } catch (err) {
        this.setState('CLASS_NOT_FOUND', err.message);
        throw err;
      }
    });
  }

  // --- Sessions Management ---
  async getSessions() {
    return await this._withTaskLock('LOAD_SESSIONS', async () => {
      const classCtx = classService.getCurrentContext();
      if (!classCtx || !classCtx.classId || !classCtx.isDrawerOpen) {
        const msg = 'Chưa xác minh được lớp học hợp lệ, không thể tiếp tục LOAD_SESSIONS.';
        this.setState('CLASS_NOT_FOUND', msg);
        throw new Error(msg);
      }
      this.setState('LOAD_SESSIONS', 'Đang tải danh sách buổi học');
      try {
        const sessions = await sessionService.getSessionsList();
        this.setState('IDLE');
        return sessions;
      } catch (err) {
        this.setState('SESSION_NOT_FOUND', err.message);
        throw err;
      }
    });
  }

  async selectSession(sessionNumber) {
    return await this._withTaskLock(`SELECT_SESSION:${sessionNumber}`, async () => {
      this.setState('SELECT_SESSION', `Đang chọn Buổi ${sessionNumber}`);
      try {
        const res = await sessionService.selectSession(sessionNumber);
        if (!res || !res.success) {
          if (res && res.warning === 'SESSION_NOT_AVAILABLE') {
            this.setState('SESSION_NOT_AVAILABLE', res.message);
          } else {
            this.setState('SESSION_NOT_FOUND', (res && res.message) || `Không chọn được Buổi ${sessionNumber}`);
          }
          return res;
        }
        this.setState('VERIFY_SESSION_ACTIVE', `Đã kích hoạt Buổi ${sessionNumber}`);
        this.setState('IDLE');
        return res;
      } catch (err) {
        this.setState('SESSION_NOT_FOUND', err.message);
        throw err;
      }
    });
  }

  /**
   * Đảm bảo đã chạy SELECT_SESSION & VERIFY_SESSION_ACTIVE và buổi học đã diễn ra
   * trước khi gọi LOAD_SUMMARY hoặc LOAD_STUDENTS.
   */
  async ensureActiveAvailableSession(sessionNumber = null) {
    if (sessionNumber !== null && sessionNumber !== undefined && !Number.isNaN(Number(sessionNumber))) {
      const selRes = await this.selectSession(Number(sessionNumber));
      if (!selRes || !selRes.success) {
        throw new Error((selRes && selRes.message) || `Không thể chọn Buổi ${sessionNumber}.`);
      }
      return selRes;
    }

    const currentSession = sessionService.getCurrentSession();
    if (currentSession && currentSession.isAvailable === false) {
      const msg = 'Buổi học này chưa diễn ra nên chưa có dữ liệu điểm danh và danh sách học viên.';
      this.setState('SESSION_NOT_AVAILABLE', msg);
      throw new Error(msg);
    }

    if (!currentSession || !currentSession.verified) {
      // Kiểm tra xem trên LMS Drawer có buổi học nào đang active sẵn không
      const page = await browserManager.getPage();
      const activeNum = await page.evaluate(() => {
        const d = document.querySelector('.MuiDrawer-modal');
        if (!d) return null;
        const activeCard = d.querySelector('.active');
        if (!activeCard) return null;
        const m = (activeCard.innerText || '').trim().match(/^#\s*(\d+)/);
        return m ? parseInt(m[1], 10) : null;
      }).catch(() => null);

      if (!activeNum) {
        const msg = 'Chưa thực hiện SELECT_SESSION. Vui lòng chọn buổi học đã diễn ra trước khi tải dữ liệu.';
        this.setState('SESSION_NOT_FOUND', msg);
        throw new Error(msg);
      }
    }

    return currentSession;
  }

  // --- Summary ---
  async getSummary(sessionNumber = null) {
    await this.ensureActiveAvailableSession(sessionNumber);
    this.setState('LOAD_SUMMARY', 'Đang đọc Summary buổi học');
    try {
      const summary = await summaryService.readCurrentSummary();
      this.setState('IDLE');
      return summary;
    } catch (err) {
      this.setState('SUMMARY_NOT_FOUND', err.message);
      throw err;
    }
  }

  async fillSummary(content, forceOverwrite = true) {
    this.setState('FILL_SUMMARY', 'Đang nhập nội dung Summary');
    try {
      const res = await summaryService.fillAndSaveSummary(content, { forceOverwrite });
      this.setState('IDLE', res.message);
      return res;
    } catch (err) {
      this.setState('FILL_FAILED', err.message);
      throw err;
    }
  }

  // --- Students & Comments ---
  async getStudents(sessionNumber = null) {
    await this.ensureActiveAvailableSession(sessionNumber);
    this.setState('LOAD_STUDENTS', 'Đang quét danh sách học viên');
    try {
      const students = await commentService.getStudentsList();
      this.setState('IDLE');
      return students;
    } catch (err) {
      this.setState('STUDENT_NOT_FOUND', err.message);
      throw err;
    }
  }

  // Thử nghiệm nhận xét cho 1 học viên (Phase 4 POC)
  async commentSingleStudent(studentName, commentText, forceOverwrite = false) {
    this.setState('PROCESS_STUDENTS', `Thử nghiệm nhận xét cho: ${studentName}`);
    try {
      const res = await commentService.fillCommentForStudent(studentName, commentText, { forceOverwrite });
      this.setState('IDLE');
      return res;
    } catch (err) {
      this.setState('FILL_FAILED', err.message);
      throw err;
    }
  }

  // Tự động nhận xét hàng loạt (Phase 7 Batch Processing)
  async batchProcessComments(studentsToProcess = [], options = {}) {
    const { forceOverwrite = true } = options;
    this.isCancelled = false;
    this.setState('PROCESS_STUDENTS', `Bắt đầu xử lý hàng loạt ${studentsToProcess.length} học viên`);

    const report = {
      startTime: new Date().toISOString(),
      total: studentsToProcess.length,
      verifiedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      details: []
    };

    this.progress = {
      current: 0,
      total: studentsToProcess.length,
      percent: 0,
      currentStudent: ''
    };

    for (let i = 0; i < studentsToProcess.length; i++) {
      if (this.isCancelled) {
        logger.warn('[AutomationService] Tiến trình hàng loạt bị ngắt bởi người dùng.');
        break;
      }

      const item = studentsToProcess[i];
      const studentName = item.name;
      const commentText = item.comment;
      const attendance = (item.attendance || 'PRESENT').toUpperCase();

      this.progress.current = i + 1;
      this.progress.percent = Math.round(((i + 1) / studentsToProcess.length) * 100);
      this.progress.currentStudent = studentName;

      // 1. Kiểm tra học sinh vắng mặt -> Bỏ qua
      if (attendance === 'ABSENT') {
        logger.info(`[AutomationService] Học viên "${studentName}" vắng mặt. Tự động bỏ qua.`);
        report.skippedCount++;
        report.details.push({
          studentName,
          status: 'SKIPPED_ABSENT',
          message: 'Bỏ qua do học viên vắng mặt'
        });
        continue;
      }

      // 2. Thực hiện nhập nhận xét và xác minh
      try {
        const result = await commentService.fillCommentForStudent(studentName, commentText, { forceOverwrite });
        if (result.status === 'VERIFIED') {
          report.verifiedCount++;
        } else if (result.status.startsWith('SKIPPED')) {
          report.skippedCount++;
        } else {
          report.failedCount++;
        }
        report.details.push(result);
      } catch (err) {
        report.failedCount++;
        report.details.push({
          studentName,
          status: 'FAILED',
          error: err.message
        });
      }

      // Giãn cách an toàn giữa 2 học viên liên tiếp
      await new Promise(r => setTimeout(r, 2000));
    }

    report.endTime = new Date().toISOString();
    this.lastReport = report;
    this.setState('COMPLETED', `Hoàn tất: ${report.verifiedCount} thành công, ${report.skippedCount} bỏ qua, ${report.failedCount} thất bại.`);
    return report;
  }
}

module.exports = new AutomationService();
