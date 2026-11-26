const fs = require('fs');
const path = require('path');

const CURRICULUM_DIR = path.join(__dirname, '../../data/curriculum');
const COURSE_CODE_REGEX = /(?:^|[^A-Z])(SEMIB|SEMIA|SEMII|PREB|PREA|PREI|ARMB|ARMA|ARMI|PTB|PTA|PTI|JSB|JSA|JSI|CSB|CSA|CSI|GB|GA|GI|SB|SA|SI)(?![A-Z])/i;

class CurriculumService {
  /**
   * Bóc tách mã khóa học (VD: ARMA, SB, PTB...) từ mã lớp hoặc tên lớp.
   * Đặt mã dài trước mã ngắn để tránh match nhầm.
   */
  extractCourseCode(classCode = '') {
    if (!classCode) return null;
    const normalized = String(classCode).trim().toUpperCase();
    const match = normalized.match(COURSE_CODE_REGEX);
    return match ? match[1].toUpperCase() : null;
  }

  /**
   * Bóc tách số buổi học (số nguyên đầu tiên) từ tham số session.
   * VD: "Buổi 11 (18/11)" -> 11, "11" -> 11, 11 -> 11.
   */
  extractSessionNumber(session) {
    if (session === undefined || session === null || session === '') return null;
    const match = String(session).match(/\d+/);
    if (!match) return null;
    const num = parseInt(match[0], 10);
    return Number.isNaN(num) ? null : num;
  }

  /**
   * Đọc file JSON giáo trình của khóa học.
   */
  loadCourseData(courseCode) {
    const safeCode = String(courseCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(safeCode)) {
      const err = new Error(`Mã khóa học không hợp lệ: "${courseCode}"`);
      err.statusCode = 400;
      throw err;
    }

    const filePath = path.join(CURRICULUM_DIR, `${safeCode}.json`);
    if (!fs.existsSync(filePath)) {
      const err = new Error(`Không tìm thấy giáo trình cho mã khóa học "${safeCode}".`);
      err.statusCode = 404;
      throw err;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  /**
   * Tìm dữ liệu buổi học trong sessions (hỗ trợ cả Array và Object).
   */
  findSessionInCourse(courseData, sessionNumber) {
    if (!courseData || !courseData.sessions) return null;
    const { sessions } = courseData;

    if (Array.isArray(sessions)) {
      return sessions.find(s => Number(s && s.sessionNumber) === sessionNumber) || null;
    }

    if (typeof sessions === 'object') {
      const byKey = sessions[String(sessionNumber)];
      if (byKey) return byKey;
      return Object.values(sessions).find(s => Number(s && s.sessionNumber) === sessionNumber) || null;
    }

    return null;
  }

  /**
   * Sinh chuỗi formattedSummary đầy đủ, chuẩn sư phạm MindX.
   * Bỏ qua các trường rỗng, không lặp chữ "Buổi X: Buổi X".
   */
  formatSessionSummary(sessionNumber, sessionObj = {}) {
    const rawTitle = typeof sessionObj.title === 'string' ? sessionObj.title.trim() : '';
    const cleanTitle = rawTitle.replace(/^Buổi\s*\d+\s*[:.\-–]?\s*/i, '').trim();

    const lines = [];
    if (cleanTitle) {
      lines.push(`Buổi ${sessionNumber}: ${cleanTitle}.`);
    } else {
      lines.push(`Buổi ${sessionNumber}.`);
    }

    const summary = typeof sessionObj.summary === 'string' ? sessionObj.summary.trim() : '';
    if (summary) {
      lines.push(`- Nội dung trọng tâm: ${summary}`);
    }

    const hardwareAndCommands = typeof sessionObj.hardwareAndCommands === 'string'
      ? sessionObj.hardwareAndCommands.trim()
      : '';
    if (hardwareAndCommands) {
      lines.push(`- Kiến thức & Câu lệnh / Linh kiện: ${hardwareAndCommands}`);
    }

    const objectives = Array.isArray(sessionObj.objectives)
      ? sessionObj.objectives.map(o => String(o || '').trim()).filter(Boolean)
      : [];
    if (objectives.length > 0) {
      lines.push('- Mục tiêu buổi học:');
      objectives.forEach(obj => {
        lines.push(`  + ${obj}`);
      });
    }

    lines.push('- Đánh giá chung: Cả lớp tham gia học tập tích cực, hoàn thành tốt các yêu cầu thực hành và đạt mục tiêu bài giảng đề ra.');

    return lines.join('\n');
  }

  /**
   * Lấy tóm tắt buổi học theo classCode / courseCode và session.
   */
  getSessionSummary({ classCode, courseCode, session }) {
    const resolvedCourseCode = (courseCode && String(courseCode).trim())
      ? String(courseCode).trim().toUpperCase()
      : this.extractCourseCode(classCode);

    if (!resolvedCourseCode) {
      const err = new Error('Thiếu hoặc không nhận diện được mã khóa học từ classCode/courseCode.');
      err.statusCode = 400;
      throw err;
    }

    const sessionNumber = this.extractSessionNumber(session);
    if (!sessionNumber || sessionNumber < 1) {
      const err = new Error('Tham số session không hợp lệ hoặc bị thiếu.');
      err.statusCode = 400;
      throw err;
    }

    const courseData = this.loadCourseData(resolvedCourseCode);
    const sessionObj = this.findSessionInCourse(courseData, sessionNumber);
    if (!sessionObj) {
      const err = new Error(`Không tìm thấy Buổi ${sessionNumber} trong giáo trình ${resolvedCourseCode}.`);
      err.statusCode = 404;
      throw err;
    }

    const normalizedSession = {
      title: typeof sessionObj.title === 'string' ? sessionObj.title.trim() : '',
      summary: typeof sessionObj.summary === 'string' ? sessionObj.summary.trim() : '',
      hardwareAndCommands: typeof sessionObj.hardwareAndCommands === 'string' ? sessionObj.hardwareAndCommands.trim() : '',
      objectives: Array.isArray(sessionObj.objectives)
        ? sessionObj.objectives.map(o => String(o || '').trim()).filter(Boolean)
        : []
    };

    const formattedSummary = this.formatSessionSummary(sessionNumber, normalizedSession);

    return {
      courseCode: courseData.courseCode || resolvedCourseCode,
      courseName: courseData.courseName || '',
      category: courseData.category || '',
      sessionNumber,
      session: normalizedSession,
      formattedSummary
    };
  }
}

module.exports = new CurriculumService();
