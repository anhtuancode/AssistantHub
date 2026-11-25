const fs = require('fs');
const path = require('path');
const browserManager = require('../../automation/browserManager');
const authService = require('../../automation/authService');
const classService = require('../../automation/classService');
const sessionService = require('../../automation/sessionService');
const summaryService = require('../../automation/summaryService');
const commentService = require('../../automation/commentService');
const automationService = require('../../services/automationService');

const REPORT_DIR = path.join(__dirname, '..', '..', '..', 'test-results', 'class-id-navigation');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

async function runTests() {
  const results = [];
  const record = (id, name, pass, details = {}) => {
    results.push({ id, name, status: pass ? 'PASS' : 'FAIL', details });
    console.log(`[${id}] ${name}: ${pass ? 'PASS ✅' : 'FAIL ❌'}`, JSON.stringify(details));
  };

  console.log('========================================================================');
  console.log('   CLASS ID DIRECT NAVIGATION TEST SUITE (TEST 01 - TEST 10)           ');
  console.log('========================================================================\n');

  // Ensure valid authenticated session
  const sessionCheck = await authService.checkSessionValid();
  if (!sessionCheck.valid) {
    await authService.loginWithCredentials(
      process.env.LMS_EMAIL || '',
      process.env.LMS_PASSWORD || '',
      { headless: true }
    );
  }

  const page = await browserManager.getPage({ headless: true });

  // Step 1 & 2: Quét danh sách lớp từ LMS
  const classes = await classService.getClassesList({ filterStatus: 'running' });
  const classSI40 = classes.find(c => c.classCode === 'PVT-C4K-SI40');
  const classARMA26 = classes.find(c => c.classCode === 'PVT-ROB-ARMA26');
  const classThird = classes.find(c => c.classCode !== 'PVT-C4K-SI40' && c.classCode !== 'PVT-ROB-ARMA26' && c.classId);

  // TEST 01: Chọn lớp PVT-C4K-SI40 và điều hướng bằng Class ID
  try {
    if (!classSI40 || !classSI40.classId) throw new Error('Không tìm thấy PVT-C4K-SI40 trong danh sách lớp running.');
    const res1 = await classService.navigateToClass(classSI40.classId);
    const pass1 = res1.success && res1.context.classId === classSI40.classId && res1.context.classCode === 'PVT-C4K-SI40';
    record('TEST 01', 'Chọn lớp PVT-C4K-SI40 và điều hướng bằng Class ID', pass1, {
      classId: classSI40.classId,
      url: res1.currentUrl,
      context: res1.context
    });
  } catch (err) {
    record('TEST 01', 'Chọn lớp PVT-C4K-SI40 và điều hướng bằng Class ID', false, { error: err.message });
  }

  // TEST 02: Chọn lớp PVT-ROB-ARMA26 và điều hướng bằng Class ID
  try {
    if (!classARMA26 || !classARMA26.classId) throw new Error('Không tìm thấy PVT-ROB-ARMA26 trong danh sách lớp running.');
    const res2 = await classService.navigateToClass(classARMA26.classId);
    const pass2 = res2.success && res2.context.classId === classARMA26.classId && res2.context.classCode === 'PVT-ROB-ARMA26';
    record('TEST 02', 'Chọn lớp PVT-ROB-ARMA26 và điều hướng bằng Class ID', pass2, {
      classId: classARMA26.classId,
      url: res2.currentUrl,
      context: res2.context
    });
  } catch (err) {
    record('TEST 02', 'Chọn lớp PVT-ROB-ARMA26 và điều hướng bằng Class ID', false, { error: err.message });
  }

  // TEST 03: Chọn lớp thứ ba bất kỳ và xác minh URL
  let res3 = null;
  try {
    if (!classThird || !classThird.classId) throw new Error('Không tìm thấy lớp thứ ba.');
    res3 = await classService.navigateToClass(classThird.classId);
    const pass3 = res3.success && res3.currentUrl.includes(classThird.classId) && res3.context.classCode === classThird.classCode;
    record('TEST 03', `Chọn lớp thứ ba (${classThird.classCode}) và xác minh URL`, pass3, {
      classCode: classThird.classCode,
      classId: classThird.classId,
      url: res3.currentUrl
    });
  } catch (err) {
    record('TEST 03', 'Chọn lớp thứ ba bất kỳ và xác minh URL', false, { error: err.message });
  }

  // TEST 04: Kiểm tra Class ID có được encode đúng thành %22{ID}%22
  try {
    const builtUrl = classService.buildClassDetailUrl(classSI40.classId);
    const expectedQuery = `tab=0&id=%22${classSI40.classId}%22`;
    const actualHasFormat = res3 && res3.currentUrl.includes(`tab=0&id=%22${classThird.classId}%22`);
    const pass4 = builtUrl.includes(expectedQuery) && actualHasFormat;
    record('TEST 04', 'Kiểm tra Class ID được encode đúng thành %22{ID}%22', pass4, {
      builtUrl,
      actualUrl: res3 ? res3.currentUrl : null
    });
  } catch (err) {
    record('TEST 04', 'Kiểm tra Class ID được encode đúng thành %22{ID}%22', false, { error: err.message });
  }

  // TEST 05: Kiểm tra Class Code hiển thị có khớp với lớp đã chọn
  try {
    const drawerText = await page.locator('.MuiDrawer-modal').innerText();
    const pass5 = drawerText.includes(classThird.classCode);
    record('TEST 05', 'Kiểm tra Class Code hiển thị khớp với lớp đã chọn', pass5, {
      expectedCode: classThird.classCode,
      drawerSnippet: drawerText.slice(0, 100).replace(/\n+/g, ' ')
    });
  } catch (err) {
    record('TEST 05', 'Kiểm tra Class Code hiển thị khớp với lớp đã chọn', false, { error: err.message });
  }

  // TEST 06: Kiểm tra tải được trang chi tiết lớp + Comments data (Sessions, Summary, Students)
  try {
    await sessionService.openCommentsTab();
    const sessions = await sessionService.getSessionsList();
    await sessionService.selectSession(1);
    const sumData = await summaryService.getSummaryAndHomework();
    const students = await commentService.getStudentsList();
    const pass6 = sessions.length === 14 && sumData.isSummaryFound && students.length > 0;
    record('TEST 06', 'Kiểm tra tải chi tiết lớp và đọc Sessions, Summary, Students', pass6, {
      sessionsCount: sessions.length,
      summaryFound: sumData.isSummaryFound,
      studentsCount: students.length
    });
  } catch (err) {
    record('TEST 06', 'Kiểm tra tải chi tiết lớp và đọc Sessions, Summary, Students', false, { error: err.message });
  }

  // TEST 07: Kiểm tra chuyển sang Comments thành công
  try {
    const activeTab = await page.evaluate(() => {
      const drawer = document.querySelector('.MuiDrawer-modal');
      const tab = drawer ? drawer.querySelector('.MuiTab-root.Mui-selected, [role="tab"][aria-selected="true"]') : null;
      return tab ? tab.innerText.trim() : '';
    });
    const pass7 = /nhận xét|comments/i.test(activeTab);
    record('TEST 07', 'Kiểm tra chuyển sang tab Comments thành công', pass7, { activeTab });
  } catch (err) {
    record('TEST 07', 'Kiểm tra chuyển sang tab Comments thành công', false, { error: err.message });
  }

  // TEST 08: Kiểm tra không còn lỗi CLASS_NOT_FOUND do tìm ID trong tbody
  try {
    const classServiceSource = fs.readFileSync(path.join(__dirname, '..', '..', 'automation', 'classService.js'), 'utf-8');
    const navMethodSection = classServiceSource.slice(classServiceSource.indexOf('async navigateToClass'));
    const usesOldTbodyFilter = navMethodSection.includes("locator('tbody tr") || navMethodSection.includes('VisibilityIcon');
    // Điều hướng thẳng từ một URL khác (không cần ở trang bảng tbody) bằng Class ID của PVT-C4K-SI40
    await page.goto('https://lms.mindx.edu.vn/admin/classes?tab=1', { waitUntil: 'networkidle' });
    const directNav = await classService.navigateToClass(classSI40.classId);
    const pass8 = !usesOldTbodyFilter && directNav.success && directNav.context.classCode === 'PVT-C4K-SI40';
    record('TEST 08', 'Kiểm tra loại bỏ tìm tbody tr & không còn lỗi CLASS_NOT_FOUND', pass8, {
      usesOldTbodyFilter,
      directNavSuccess: directNav.success
    });
  } catch (err) {
    record('TEST 08', 'Kiểm tra loại bỏ tìm tbody tr & không còn lỗi CLASS_NOT_FOUND', false, { error: err.message });
  }

  // TEST 09: Kiểm tra xử lý ID không tồn tại & chặn LOAD_SESSIONS
  try {
    let caughtError = null;
    try {
      await classService.navigateToClass('000000000000000000000000');
    } catch (e) {
      caughtError = e;
    }

    let loadSessionsBlocked = false;
    try {
      await automationService.getSessions();
    } catch (e) {
      loadSessionsBlocked = e.message.includes('LOAD_SESSIONS') || e.message.includes('Chưa xác minh');
    }

    const pass9 = Boolean(caughtError) && classService.getCurrentContext() === null && loadSessionsBlocked;
    record('TEST 09', 'Kiểm tra xử lý ID không tồn tại và chặn LOAD_SESSIONS', pass9, {
      errorCaught: caughtError ? caughtError.message : null,
      contextReset: classService.getCurrentContext() === null,
      loadSessionsBlocked
    });
  } catch (err) {
    record('TEST 09', 'Kiểm tra xử lý ID không tồn tại và chặn LOAD_SESSIONS', false, { error: err.message });
  }

  // TEST 10: Kiểm tra session hết hạn và Forbidden
  try {
    // 10a. Giả lập HTTP 403 Forbidden trên route điều hướng
    let forbiddenCaught = null;
    await page.route('**/admin/classes*', route => {
      if (route.request().resourceType() === 'document') {
        return route.fulfill({ status: 403, contentType: 'text/html', body: '<h1>403 Forbidden</h1>' });
      }
      return route.continue();
    });
    try {
      await classService.navigateToClass(classSI40.classId);
    } catch (e) {
      forbiddenCaught = e;
    }
    await page.unroute('**/admin/classes*');

    // 10b. Kiểm tra session hết hạn (xóa cookies trong context để LMS redirect về base.mindx.edu.vn/login)
    let expiredCaught = null;
    const context = page.context();
    await context.clearCookies();
    try {
      await classService.navigateToClass(classSI40.classId);
    } catch (e) {
      expiredCaught = e;
    }

    const pass10 =
      Boolean(forbiddenCaught && /forbidden|403/i.test(forbiddenCaught.message)) &&
      Boolean(expiredCaught && /hết hạn|đăng nhập|login/i.test(expiredCaught.message));

    record('TEST 10', 'Kiểm tra xử lý session hết hạn và HTTP 403 Forbidden', pass10, {
      forbiddenError: forbiddenCaught ? forbiddenCaught.message : null,
      expiredSessionError: expiredCaught ? expiredCaught.message : null
    });
  } catch (err) {
    record('TEST 10', 'Kiểm tra xử lý session hết hạn và HTTP 403 Forbidden', false, { error: err.message });
  }

  await browserManager.closeBrowser();

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  const summary = {
    timestamp: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    results
  };

  fs.writeFileSync(path.join(REPORT_DIR, 'class_id_navigation_report.json'), JSON.stringify(summary, null, 2));
  console.log(`\n========================================================================`);
  console.log(`   TỔNG KẾT CLASS ID NAVIGATION SUITE: ${passed}/${results.length} PASSED | ${failed} FAILED`);
  console.log(`========================================================================`);

  if (failed > 0) process.exitCode = 1;
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
