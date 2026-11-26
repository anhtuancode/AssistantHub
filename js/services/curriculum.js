/**
 * CurriculumService (Web ES Module)
 * Quản lý tra cứu dữ liệu 24 khóa học MindX và lưu trữ tùy chỉnh qua localStorage.
 */

const STORAGE_KEY_STUDENTBOOK = 'mindx_studentbook_overrides';
const STORAGE_KEY_SESSIONS = 'mindx_curriculum_overrides';

export class CurriculumService {
  constructor(basePath = './data/curriculum') {
    this.basePath = basePath;
    this.indexData = null;
    this.coursesCache = {};
    this.allCoursesData = null;
  }

  /**
   * Đọc cấu hình index.json
   */
  async getIndexData() {
    if (this.indexData) return this.indexData;
    try {
      const res = await fetch(`${this.basePath}/index.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status} tải index.json`);
      this.indexData = await res.json();
      return this.indexData;
    } catch (err) {
      console.error('[CurriculumService] Lỗi tải index.json:', err);
      return null;
    }
  }

  /**
   * Đọc dữ liệu ghi đè StudentBook từ localStorage
   */
  getStudentBookOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STUDENTBOOK);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  /**
   * Lưu dữ liệu ghi đè StudentBook vào localStorage
   */
  setStudentBookOverrides(data) {
    try {
      localStorage.setItem(STORAGE_KEY_STUDENTBOOK, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[CurriculumService] Lỗi ghi localStorage StudentBook:', err);
      return false;
    }
  }

  /**
   * Đọc dữ liệu ghi đè buổi học từ localStorage
   */
  getSessionOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  /**
   * Lưu dữ liệu ghi đè buổi học vào localStorage
   */
  setSessionOverrides(data) {
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('[CurriculumService] Lỗi ghi localStorage Sessions:', err);
      return false;
    }
  }

  /**
   * Tải và gộp dữ liệu 1 khóa học từ file JSON + Overrides trong localStorage
   */
  async getMergedCourseData(courseCode) {
    if (!courseCode) return null;
    const code = courseCode.toUpperCase();

    let baseData = this.coursesCache[code] || null;
    if (!baseData) {
      try {
        const res = await fetch(`${this.basePath}/${code}.json`);
        if (res.ok) {
          baseData = await res.json();
          this.coursesCache[code] = JSON.parse(JSON.stringify(baseData));
        }
      } catch (err) {
        console.warn(`[CurriculumService] Không thể tải ${code}.json:`, err.message);
      }
    }

    if (!baseData) return null;

    // Clone để không làm biến dạng cache gốc
    const courseData = JSON.parse(JSON.stringify(baseData));

    // 1. Gộp StudentBook Override
    const sbOverrides = this.getStudentBookOverrides();
    const cluster = courseData.cluster || '';
    if (sbOverrides[code]) {
      courseData.studentBookUrl = sbOverrides[code];
    } else if (cluster && sbOverrides[cluster]) {
      courseData.studentBookUrl = sbOverrides[cluster];
    }

    // 2. Gộp Session Overrides (nếu có chỉnh sửa slide, tóm tắt, số trang BTVN)
    const sessionOverrides = this.getSessionOverrides();
    const courseSessionOverrides = sessionOverrides[code];
    if (courseSessionOverrides && courseData.sessions) {
      let sessionsArray = Array.isArray(courseData.sessions)
        ? courseData.sessions
        : Object.values(courseData.sessions);

      sessionsArray.forEach(s => {
        const sNum = String(s.sessionNumber);
        if (courseSessionOverrides[sNum]) {
          Object.assign(s, courseSessionOverrides[sNum]);
        }
      });
      courseData.sessions = sessionsArray;
    } else if (courseData.sessions && !Array.isArray(courseData.sessions)) {
      courseData.sessions = Object.values(courseData.sessions);
    }

    // Sắp xếp các buổi học theo sessionNumber tăng dần
    if (Array.isArray(courseData.sessions)) {
      courseData.sessions.sort((a, b) => (parseInt(a.sessionNumber, 10) || 0) - (parseInt(b.sessionNumber, 10) || 0));
    }

    return courseData;
  }

  /**
   * Tải toàn bộ 24 khóa học và trả về cấu trúc sẵn sàng cho giao diện
   */
  async getAllCourses() {
    const indexData = await this.getIndexData();
    if (!indexData) return { courses: {}, categories: {} };

    const aliases = indexData.courseAliases || {};
    const codes = Object.keys(aliases);

    // Tải song song tất cả 24 file giáo trình
    await Promise.all(
      codes.map(async (code) => {
        if (!this.coursesCache[code]) {
          try {
            const res = await fetch(`${this.basePath}/${code}.json`);
            if (res.ok) {
              this.coursesCache[code] = await res.json();
            }
          } catch (_) {}
        }
      })
    );

    const sbOverrides = this.getStudentBookOverrides();
    const result = {};

    const findStudentBook = (cluster) => {
      if (!cluster || !indexData.categories) return '';
      for (const cat of Object.values(indexData.categories)) {
        if (cat.clusters && cat.clusters[cluster] && cat.clusters[cluster].studentBookUrl) {
          return cat.clusters[cluster].studentBookUrl;
        }
      }
      return '';
    };

    for (const [code, info] of Object.entries(aliases)) {
      const courseData = await this.getMergedCourseData(code);
      let sessionsList = [];
      let specificStudentBookUrl = '';

      if (courseData) {
        if (courseData.studentBookUrl && courseData.studentBookUrl.trim()) {
          specificStudentBookUrl = courseData.studentBookUrl.trim();
        }
        if (courseData.sessions) {
          sessionsList = Array.isArray(courseData.sessions) ? courseData.sessions : Object.values(courseData.sessions);
        }
      }

      let normalizedCategory = (courseData && courseData.category) || info.category || 'CODING';
      if (normalizedCategory.toUpperCase().startsWith('ROB')) {
        normalizedCategory = 'ROBOTICS';
      } else {
        normalizedCategory = 'CODING';
      }

      let clusterCode = (courseData && courseData.cluster) || info.cluster || '';
      if (!clusterCode) {
        if (code.startsWith('PRE')) clusterCode = 'PRE';
        else if (code.startsWith('ARM')) clusterCode = 'ARM';
        else if (code.startsWith('SEMI')) clusterCode = 'SEMI';
        else if (['SB', 'SA', 'SI'].includes(code)) clusterCode = 'SCRATCH';
        else if (['GB', 'GA', 'GI'].includes(code)) clusterCode = 'GAMEMAKER';
        else if (['PTB', 'PTA', 'PTI'].includes(code)) clusterCode = 'PYTHON';
        else if (['JSB', 'JSA', 'JSI'].includes(code)) clusterCode = 'WEB_JS';
        else if (['CSB', 'CSA', 'CSI'].includes(code)) clusterCode = 'COMPUTER_SCIENCE';
      }

      // Kiểm tra xem có override riêng của khóa hay cụm không
      const hasCustom = Boolean(sbOverrides[code] || (clusterCode && sbOverrides[clusterCode]));
      const defaultSb = findStudentBook(clusterCode);

      result[code] = {
        code,
        name: (courseData && courseData.courseName) || info.name || code,
        category: normalizedCategory,
        platform: (courseData && courseData.platform) || info.platform || '',
        cluster: clusterCode,
        studentBookUrl: specificStudentBookUrl || defaultSb,
        hasCustomStudentBook: hasCustom,
        sessionsCount: sessionsList.length,
        sessions: sessionsList
      };
    }

    this.allCoursesData = {
      courses: result,
      categories: indexData.categories || {},
      courseAliases: aliases
    };

    return this.allCoursesData;
  }

  /**
   * Lưu link StudentBook (cho cụm hoặc riêng từng khóa học)
   */
  async saveStudentBook(clusterOrCode, studentBookUrl = '', courseCode = null) {
    const overrides = this.getStudentBookOverrides();
    const targetKey = courseCode || clusterOrCode;

    if (studentBookUrl && studentBookUrl.trim()) {
      overrides[targetKey] = studentBookUrl.trim();
      // Nếu là cụm, gán cho cụm để các môn cùng cụm hưởng chung
      if (clusterOrCode && clusterOrCode !== targetKey) {
        overrides[clusterOrCode] = studentBookUrl.trim();
      }
    } else {
      delete overrides[targetKey];
      if (clusterOrCode) delete overrides[clusterOrCode];
    }

    this.setStudentBookOverrides(overrides);

    // Cập nhật bộ nhớ đệm
    if (this.allCoursesData && this.allCoursesData.courses) {
      if (courseCode && this.allCoursesData.courses[courseCode]) {
        this.allCoursesData.courses[courseCode].studentBookUrl = studentBookUrl.trim();
        this.allCoursesData.courses[courseCode].hasCustomStudentBook = Boolean(studentBookUrl.trim());
      }
      if (clusterOrCode) {
        Object.values(this.allCoursesData.courses).forEach(c => {
          if (c.cluster === clusterOrCode && (!courseCode || c.code === courseCode)) {
            c.studentBookUrl = studentBookUrl.trim();
            c.hasCustomStudentBook = Boolean(studentBookUrl.trim());
          }
        });
      }
    }

    return {
      success: true,
      cluster: clusterOrCode,
      courseCode,
      studentBookUrl: studentBookUrl.trim()
    };
  }

  /**
   * Lưu chỉnh sửa 1 buổi học (slide, review, tóm tắt, số trang BTVN)
   */
  async saveSessionChanges(courseCode, sessionNumber, sessionData = {}) {
    const code = (courseCode || '').toUpperCase();
    const sNum = String(sessionNumber);
    const overrides = this.getSessionOverrides();

    if (!overrides[code]) overrides[code] = {};
    if (!overrides[code][sNum]) overrides[code][sNum] = {};

    Object.assign(overrides[code][sNum], sessionData);
    this.setSessionOverrides(overrides);

    // Cập nhật bộ nhớ đệm
    if (this.allCoursesData && this.allCoursesData.courses && this.allCoursesData.courses[code]) {
      const course = this.allCoursesData.courses[code];
      if (course.sessions) {
        const s = course.sessions.find(x => String(x.sessionNumber) === sNum);
        if (s) {
          Object.assign(s, sessionData);
        }
      }
    }

    return { success: true, courseCode: code, sessionNumber: parseInt(sNum, 10) };
  }

  /**
   * Nhận diện mã khóa học từ chuỗi (mã lớp / tên lớp)
   */
  extractCourseCode(text = '') {
    if (!text) return null;
    const combined = String(text).toUpperCase();
    const match = combined.match(/(?:^|[^A-Z])(SEMIB|SEMIA|SEMII|PREB|PREA|PREI|ARMB|ARMA|ARMI|PTB|PTA|PTI|JSB|JSA|JSI|CSB|CSA|CSI|GB|GA|GI|SB|SA|SI)(?![A-Z])/i);
    return match ? match[1].toUpperCase() : null;
  }

  /**
   * Bóc tách số buổi học (số nguyên đầu tiên) từ tham số session.
   */
  extractSessionNumber(session) {
    if (session === undefined || session === null || session === '') return null;
    const match = String(session).match(/\d+/);
    if (!match) return null;
    const num = parseInt(match[0], 10);
    return Number.isNaN(num) ? null : num;
  }

  /**
   * Sinh chuỗi formattedSummary đầy đủ, chuẩn sư phạm MindX.
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
   * Lấy tóm tắt buổi học chuẩn giáo trình theo classCode / courseCode và session.
   */
  async getSessionSummary({ classCode = '', courseCode = '', session = '' } = {}) {
    const resolvedCourseCode = (courseCode && String(courseCode).trim())
      ? String(courseCode).trim().toUpperCase()
      : this.extractCourseCode(classCode);

    if (!resolvedCourseCode) {
      throw new Error('Thiếu hoặc không nhận diện được mã khóa học từ classCode/courseCode.');
    }

    const sessionNumber = this.extractSessionNumber(session);
    if (!sessionNumber || sessionNumber < 1) {
      throw new Error('Tham số session không hợp lệ hoặc bị thiếu.');
    }

    const courseData = await this.getMergedCourseData(resolvedCourseCode);
    if (!courseData) {
      throw new Error(`Không tìm thấy giáo trình cho mã khóa học "${resolvedCourseCode}".`);
    }

    const sessions = Array.isArray(courseData.sessions) ? courseData.sessions : [];
    const sessionObj = sessions.find(s => Number(s && s.sessionNumber) === sessionNumber);
    if (!sessionObj) {
      throw new Error(`Không tìm thấy Buổi ${sessionNumber} trong giáo trình ${resolvedCourseCode}.`);
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

export const curriculumService = new CurriculumService();
