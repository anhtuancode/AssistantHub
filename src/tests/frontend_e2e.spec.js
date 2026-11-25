const assert = require('assert');
const { chromium } = require('playwright');
const app = require('../server');

async function testFrontendE2E() {
  console.log('--- TEST FRONTEND E2E (ALL 6 TABS) ---');
  const server = app.listen(3005);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // 1. Load application
    await page.goto('http://localhost:3005', { waitUntil: 'networkidle' });
    const title = await page.title();
    assert(title.includes('MindX Assistant'), 'Title should contain MindX Assistant');
    console.log('✓ App loaded successfully:', title);

    // 2. Verify Tab 1: Cấu hình
    const cfgTab = page.locator('#tab-config');
    assert(await cfgTab.isVisible(), 'Tab Cấu hình should be active initially');
    console.log('✓ Tab 1 (Cấu hình): Visible');

    // 3. Switch to Tab 2: Lớp & Buổi học
    await page.click('button[data-tab="tab-classes"]');
    await page.waitForTimeout(500);
    const classesTab = page.locator('#tab-classes');
    assert(await classesTab.isVisible(), 'Tab Lớp & Buổi học should be visible');
    const syncBtn = page.locator('#btn-sync-classes');
    assert(await syncBtn.isVisible(), 'Sync classes button should be visible');
    console.log('✓ Tab 2 (Lớp & Buổi học): Switched and rendered cleanly');

    // 4. Switch to Tab 3: Học viên
    await page.click('button[data-tab="tab-students"]');
    await page.waitForTimeout(500);
    const studentsTab = page.locator('#tab-students');
    assert(await studentsTab.isVisible(), 'Tab Học viên should be visible');
    console.log('✓ Tab 3 (Học viên & Ghi chú): Switched and rendered cleanly');

    // 5. Switch to Tab 4: Duyệt & Lưu
    await page.click('button[data-tab="tab-review"]');
    await page.waitForTimeout(500);
    const reviewTab = page.locator('#tab-review');
    assert(await reviewTab.isVisible(), 'Tab Duyệt & Lưu should be visible');
    console.log('✓ Tab 4 (Duyệt & Lưu): Switched and rendered cleanly');

    // 6. Switch to Tab 5: Giáo trình
    await page.click('button[data-tab="tab-curriculum"]');
    await page.waitForTimeout(500);
    const currTab = page.locator('#tab-curriculum');
    assert(await currTab.isVisible(), 'Tab Giáo trình should be visible');
    console.log('✓ Tab 5 (Giáo trình): Switched and preserved');

    // 7. Switch to Tab 6: Báo bài Zalo
    await page.click('button[data-tab="tab-zalo"]');
    await page.waitForTimeout(500);
    const zaloTab = page.locator('#tab-zalo');
    assert(await zaloTab.isVisible(), 'Tab Báo bài Zalo should be visible');
    console.log('✓ Tab 6 (Báo bài Zalo): Switched and preserved');

    // 8. Open & Close Log Drawer
    await page.click('#btn-open-log-drawer');
    await page.waitForTimeout(500);
    const drawer = page.locator('#log-drawer-panel');
    assert(await drawer.evaluate(el => el.classList.contains('open')), 'Drawer should open');
    console.log('✓ Log Drawer: Opens smoothly');

    await page.click('#btn-close-log-drawer');
    await page.waitForTimeout(500);
    assert(!await drawer.evaluate(el => el.classList.contains('open')), 'Drawer should close');
    console.log('✓ Log Drawer: Closes smoothly');

    // Check for any JavaScript runtime errors
    if (consoleErrors.length > 0) {
      console.warn('Console errors detected:', consoleErrors);
    }
    assert.strictEqual(consoleErrors.length, 0, 'There should be zero console errors');
    console.log('✓ Zero console errors detected across all 6 tabs');

    console.log('\n--- ALL FRONTEND E2E TESTS PASSED 100% ✅ ---');
  } finally {
    await browser.close();
    server.close();
  }
}

testFrontendE2E();
