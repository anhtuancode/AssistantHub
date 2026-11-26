const curriculumService = require('../services/curriculumService');
const logger = require('../utils/logger');

class CurriculumController {
  getSessionSummary(req, res) {
    try {
      const { classCode, courseCode, session } = req.query;
      const data = curriculumService.getSessionSummary({ classCode, courseCode, session });
      return res.status(200).json({
        success: true,
        data
      });
    } catch (err) {
      const status = err.statusCode || 500;
      if (status >= 500) {
        logger.error('[CurriculumController] Lỗi lấy tóm tắt buổi học:', err);
      }
      return res.status(status).json({
        success: false,
        error: err.message || 'Lỗi hệ thống khi lấy nội dung giáo trình.'
      });
    }
  }
}

module.exports = new CurriculumController();
