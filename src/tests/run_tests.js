const assert = require('assert');
const browserManager = require('../automation/browserManager');
const authService = require('../automation/authService');
const editorService = require('../automation/editorService');
const automationService = require('../services/automationService');
const geminiService = require('../services/geminiService');
const app = require('../server');

async function runTestSuite() {
  console.log('====================================================');
  console.log(' RUNNING MINDX LMS AUTOMATION TEST SUITE           ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`[TEST] ${name} ... `);
    try {
      await fn();
      console.log('PASSED ✅');
      passed++;
    } catch (err) {
      console.log('FAILED ❌');
      console.error('       Error:', err.message);
      failed++;
    }
  }

  // TEST 1: BrowserManager Initialization
  await test('BrowserManager launches and gets page', async () => {
    const page = await browserManager.getPage({ headless: true });
    assert(page, 'Page should be initialized');
    assert(!page.isClosed(), 'Page should be open');
    const title = await page.title();
    assert(typeof title === 'string', 'Title should be string');
  });

  // TEST 2: AuthService validates empty credentials
  await test('AuthService rejects empty credentials', async () => {
    let errorThrown = false;
    try {
      await authService.loginWithCredentials('', '');
    } catch (err) {
      errorThrown = true;
      assert(err.message.includes('không được để trống'), 'Should reject empty email');
    }
    assert(errorThrown, 'Should throw AuthError on empty credentials');
  });

  // TEST 3: AuthService session check without session file
  await test('AuthService checks missing session safely', async () => {
    const res = await authService.checkSessionValid();
    assert(res, 'Result should be returned');
    assert(typeof res.valid === 'boolean', 'res.valid must be boolean');
  });

  // TEST 4: EditorService detection on Contenteditable DOM
  await test('EditorService detects and fills Contenteditable element', async () => {
    const page = await browserManager.getPage();
    await page.setContent(`
      <div id="container">
        <label>Nhận xét học viên:</label>
        <div id="my-editor" class="ql-editor" contenteditable="true"></div>
      </div>
    `);

    const container = page.locator('#container');
    const sampleComment = 'Học viên Nguyễn Văn A nắm vững kiến thức buổi học, thao tác nhanh nhẹn và hoàn thành tốt sản phẩm.';
    
    const fillRes = await editorService.fillContent(container, sampleComment);
    assert(fillRes.success, 'Fill should succeed');
    assert(fillRes.fillVerified, 'Fill should be verified');

    const readBack = await editorService.readContent(container);
    assert(readBack.includes('Nguyễn Văn A'), 'Read back should contain student name');
  });

  // TEST 5: EditorService detection on Textarea
  await test('EditorService detects and fills Textarea element', async () => {
    const page = await browserManager.getPage();
    await page.setContent(`
      <div id="container-ta">
        <label>Tóm tắt buổi học:</label>
        <textarea class="ant-input" rows="3"></textarea>
      </div>
    `);

    const container = page.locator('#container-ta');
    const sampleSummary = 'Buổi 1: Lắp ráp cánh tay robot và lập trình động cơ.';
    
    const fillRes = await editorService.fillContent(container, sampleSummary);
    assert(fillRes.success, 'Fill should succeed');
    assert(fillRes.fillVerified, 'Fill should be verified');

    const readBack = await editorService.readContent(container);
    assert(readBack.includes('cánh tay robot'), 'Read back should contain expected keywords');
  });

  // TEST 6: AutomationService State Machine transitions
  await test('AutomationService State Machine transitions correctly', async () => {
    const initial = automationService.getState();
    assert(initial.state, 'Should have initial state');

    automationService.setState('LOAD_CLASSES', 'Test task');
    assert.strictEqual(automationService.state, 'LOAD_CLASSES');
    assert.strictEqual(automationService.currentTask, 'Test task');

    automationService.setState('IDLE');
    assert.strictEqual(automationService.state, 'IDLE');
  });

  // TEST 7: Gemini Service Fallback generation (pedagogical standards)
  await test('GeminiService generates fallback summary and personalized student comment', async () => {
    const summary = await geminiService.generateSummary({
      title: 'Lập trình Game Nhảy',
      sessionNumber: 3,
      hardwareAndCommands: 'Lệnh nhảy, tọa độ y',
      summary: 'Hoàn thiện game nhảy né chướng ngại vật'
    }, '');
    assert(summary.includes('Buổi 3'), 'Summary should include session number');

    const comment = await geminiService.generateStudentComment(
      { name: 'Nguyễn Văn An', rating: 'Xuất sắc', note: 'Sáng tạo phông nền đẹp' },
      { title: 'Lập trình Game Nhảy', sessionNumber: 3 },
      ''
    );
    assert(comment.includes('Nguyễn Văn An'), 'Comment should include student name');
    assert(comment.includes('Xuất sắc') || comment.includes('xuất sắc'), 'Comment should reflect rating');
  });

  // TEST 8: Express API Server Integration
  await test('Express API Server responds to health, status, and gemini endpoints', async () => {
    const server = app.listen(3004);
    try {
      const hRes = await fetch('http://localhost:3004/api/health');
      const hJson = await hRes.json();
      assert.strictEqual(hJson.status, 'OK');

      const sRes = await fetch('http://localhost:3004/api/automation/status');
      const sJson = await sRes.json();
      assert.strictEqual(sJson.success, true);

      const gRes = await fetch('http://localhost:3004/api/gemini/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonData: { title: 'Test Lesson', sessionNumber: 1 } })
      });
      const gJson = await gRes.json();
      assert.strictEqual(gJson.success, true);
    } finally {
      server.close();
    }
  });

  // Cleanup
  await browserManager.closeBrowser();

  console.log('\n====================================================');
  console.log(` SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runTestSuite();
