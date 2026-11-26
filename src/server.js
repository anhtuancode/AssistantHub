const express = require('express');
const cors = require('cors');
const path = require('path');
const automationController = require('./controllers/automationController');
const curriculumController = require('./controllers/curriculumController');
const browserManager = require('./automation/browserManager');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..')));

// Automation API Routes
app.get('/api/automation/status', (req, res) => automationController.getStatus(req, res));
app.get('/api/automation/check-session', (req, res) => automationController.checkSession(req, res));
app.post('/api/automation/login', (req, res) => automationController.login(req, res));
app.post('/api/automation/login-interactive', (req, res) => automationController.loginInteractive(req, res));
app.post('/api/automation/logout', (req, res) => automationController.logout(req, res));

app.get('/api/automation/classes', (req, res) => automationController.getClasses(req, res));
app.post('/api/automation/classes/select', (req, res) => automationController.selectClass(req, res));

app.get('/api/automation/sessions', (req, res) => automationController.getSessions(req, res));
app.post('/api/automation/sessions/select', (req, res) => automationController.selectSession(req, res));

app.get('/api/automation/summary', (req, res) => automationController.getSummary(req, res));
app.post('/api/automation/summary', (req, res) => automationController.fillSummary(req, res));

app.get('/api/automation/students', (req, res) => automationController.getStudents(req, res));
app.post('/api/automation/comment/single', (req, res) => automationController.commentSingle(req, res));
app.post('/api/automation/comment/batch', (req, res) => automationController.commentBatch(req, res));

app.post('/api/automation/cancel', (req, res) => automationController.cancel(req, res));
app.get('/api/automation/logs', (req, res) => automationController.getLogs(req, res));

// Gemini API Routes
app.post('/api/gemini/test', (req, res) => automationController.testGemini(req, res));
app.post('/api/gemini/summary', (req, res) => automationController.generateSummaryAi(req, res));
app.post('/api/gemini/comment', (req, res) => automationController.generateCommentAi(req, res));
app.post('/api/gemini/batch-comments', (req, res) => automationController.generateBatchCommentsAi(req, res));

// Curriculum API Routes
app.get('/api/curriculum/session-summary', (req, res) => curriculumController.getSessionSummary(req, res));

// Teacher Point Routes (HTTP POST Google Form)
app.get('/api/teacher-point/form', (req, res) => automationController.getTeacherPointForm(req, res));
app.post('/api/teacher-point/submit-single', (req, res) => automationController.submitTeacherPointSingle(req, res));

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime(), time: new Date().toISOString() });
});

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`========================================================`);
    logger.info(` MindX Teacher Assistant & LMS Automation Server Ready! `);
    logger.info(` Local URL: http://localhost:${PORT}                  `);
    logger.info(`========================================================`);

    // Pre-warm trình duyệt ngầm (headless: true) ngay sau khi server khởi động
    browserManager.warmup().catch(() => {});
  });
}

module.exports = app;
