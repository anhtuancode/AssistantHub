const automationService = require('../services/automationService');
const geminiService = require('../services/geminiService');
const teacherPointService = require('../services/teacherPointService');
const logger = require('../utils/logger');

class AutomationController {
  _sendError(res, err) {
    const msg = (err && err.message) ? err.message : 'Lỗi hệ thống không xác định';
    const isSessionExpired =
      (err && err.code === 'AUTH_ERROR') ||
      /phiên đăng nhập|hết hạn|session_expired|đăng nhập lại|unauthorized|401/i.test(msg);

    if (isSessionExpired) {
      return res.status(401).json({
        success: false,
        errorCode: 'SESSION_EXPIRED',
        error: 'Phiên đăng nhập MindX LMS đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.'
      });
    }
    return res.status(500).json({ success: false, error: msg });
  }

  async getStatus(req, res) {
    try {
      const state = automationService.getState();
      res.json({ success: true, ...state });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async checkSession(req, res) {
    try {
      const result = await automationService.checkSession();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async login(req, res) {
    try {
      const { email, password, headless } = req.body;
      const result = await automationService.login(email, password, { headless });
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async loginInteractive(req, res) {
    try {
      const { timeoutMs } = req.body || {};
      const result = await automationService.loginInteractive(timeoutMs);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async logout(req, res) {
    try {
      const result = await automationService.logout();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getClasses(req, res) {
    try {
      const { status, search } = req.query;
      const classes = await automationService.getClasses({ filterStatus: status, searchKeyword: search });
      res.json({ success: true, classes });
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async selectClass(req, res) {
    try {
      const { classId } = req.body;
      const result = await automationService.selectClass(classId);
      res.json(result);
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async getSessions(req, res) {
    try {
      const sessions = await automationService.getSessions();
      res.json({ success: true, sessions });
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async selectSession(req, res) {
    try {
      const { sessionNumber } = req.body;
      const result = await automationService.selectSession(sessionNumber);
      res.json(result);
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async getSummary(req, res) {
    try {
      const sessionNumber = req.query.sessionNumber ? parseInt(req.query.sessionNumber, 10) : null;
      const summary = await automationService.getSummary(sessionNumber);
      res.json({ success: true, summary });
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async fillSummary(req, res) {
    try {
      const { content, forceOverwrite } = req.body;
      const result = await automationService.fillSummary(content, forceOverwrite);
      res.json(result);
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async getStudents(req, res) {
    try {
      const sessionNumber = req.query.sessionNumber ? parseInt(req.query.sessionNumber, 10) : null;
      const students = await automationService.getStudents(sessionNumber);
      res.json({ success: true, students });
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async commentSingle(req, res) {
    try {
      const { studentName, commentText, forceOverwrite } = req.body;
      const result = await automationService.commentSingleStudent(studentName, commentText, forceOverwrite);
      res.json(result);
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async commentBatch(req, res) {
    try {
      const { students, forceOverwrite } = req.body;
      const result = await automationService.batchProcessComments(students, { forceOverwrite });
      res.json({ success: true, report: result });
    } catch (err) {
      return this._sendError(res, err);
    }
  }

  async cancel(req, res) {
    try {
      const result = automationService.cancel();
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getLogs(req, res) {
    try {
      const limit = parseInt(req.query.limit, 10) || 100;
      const logs = logger.getRecentLogs(limit);
      res.json({ success: true, logs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // --- Gemini Endpoints ---
  async testGemini(req, res) {
    try {
      const { apiKey, model } = req.body;
      const result = await geminiService.testConnection(apiKey, model);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async generateSummaryAi(req, res) {
    try {
      const { lessonData, apiKey, model } = req.body;
      const summary = await geminiService.generateSummary(lessonData, apiKey, model);
      res.json({ success: true, summary });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async generateCommentAi(req, res) {
    try {
      const { student, lessonData, apiKey, model, style } = req.body;
      const comment = await geminiService.generateStudentComment(student, lessonData, apiKey, model, style);
      res.json({ success: true, comment });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async generateBatchCommentsAi(req, res) {
    try {
      const { students = [], lessonData, apiKey, model, style } = req.body;
      const results = [];
      let activeIdx = 0;
      for (const st of students) {
        const att = (st.attendance || st.attendanceStatus || '').toUpperCase();
        if (att === 'ABSENT') {
          results.push({ name: st.name || st.studentName, comment: '', skipped: true });
        } else {
          const idx = typeof st.studentIndex === 'number' ? st.studentIndex : activeIdx;
          activeIdx++;
          const comment = await geminiService.generateStudentComment({ ...st, studentIndex: idx }, lessonData, apiKey, model, style);
          results.push({ name: st.name || st.studentName, comment, skipped: false });
        }
      }
      res.json({ success: true, results });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  // --- Teacher Point Endpoints (HTTP POST Google Form) ---
  async getTeacherPointForm(req, res) {
    try {
      const formUrl = req.query.url || teacherPointService.getDefaultFormUrl();
      const force = req.query.refresh === '1';
      const classCode = req.query.classCode || '';
      const schema = await teacherPointService.parseGoogleForm(formUrl, force);
      const suggestedCampus = teacherPointService.suggestCampus(classCode, schema.campuses);
      res.json({
        success: true,
        formUrl: schema.formUrl,
        defaultUrl: teacherPointService.getDefaultFormUrl(),
        campuses: schema.campuses,
        suggestedCampus,
        fieldsCount: schema.fields.length
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async submitTeacherPointSingle(req, res) {
    try {
      const { formUrl, studentName, classCode, sessionNumber, campus } = req.body || {};
      if (!studentName || !String(studentName).trim()) {
        return res.status(400).json({ success: false, error: 'Tên học viên không được để trống.' });
      }
      const result = await teacherPointService.submitSingleStudent({
        formUrl,
        studentName: String(studentName).trim(),
        classCode,
        sessionNumber,
        campus
      });
      res.json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      res.status(status).json({
        success: false,
        errorCode: err.errorCode || 'TEACHER_POINT_ERROR',
        error: err.message
      });
    }
  }
}

module.exports = new AutomationController();
