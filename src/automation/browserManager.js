const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { AutomationError } = require('../utils/errorHandler');

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this._initPromise = null;
    this._warmupPromise = null;
    this.stateDir = path.join(__dirname, 'state');
    this.storageStatePath = path.join(this.stateDir, 'auth_state.json');
    this.screenshotsDir = path.join(__dirname, 'screenshots');

    if (!fs.existsSync(this.stateDir)) fs.mkdirSync(this.stateDir, { recursive: true });
    if (!fs.existsSync(this.screenshotsDir)) fs.mkdirSync(this.screenshotsDir, { recursive: true });
  }

  hasSavedSession() {
    return fs.existsSync(this.storageStatePath) && fs.statSync(this.storageStatePath).size > 10;
  }

  async getContext(options = {}) {
    const { headless = true, forceNew = false } = options;

    if (this._warmupPromise && !forceNew) {
      await this._warmupPromise.catch(() => {});
    }

    if (this._initPromise && !forceNew) {
      return await this._initPromise;
    }

    // Check if browser is alive
    if (this.browser && !this.browser.isConnected()) {
      logger.warn('[BrowserManager] Trình duyệt đã bị đóng hoặc mất kết nối, khởi tạo lại...');
      this.browser = null;
      this.context = null;
      this.page = null;
    }

    if (!this.browser || forceNew) {
      this._initPromise = (async () => {
        if (this.browser) {
          try { await this.browser.close(); } catch (_) {}
        }

        logger.info(`[BrowserManager] Khởi động Chromium (headless: ${headless})...`);
        this.browser = await chromium.launch({
          headless,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled'
          ]
        });

        const contextOptions = {
          viewport: { width: 1366, height: 860 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          locale: 'vi-VN',
          timezoneId: 'Asia/Ho_Chi_Minh'
        };

        if (this.hasSavedSession() && !forceNew) {
          logger.info(`[BrowserManager] Sử dụng session đã lưu: ${this.storageStatePath}`);
          contextOptions.storageState = this.storageStatePath;
        }

        this.context = await this.browser.newContext(contextOptions);

        // Listen for page crash
        this.context.on('page', p => {
          p.on('crash', () => {
            logger.error('[BrowserManager] Tab trang web đã bị crash!');
          });
        });

        return this.context;
      })();

      try {
        return await this._initPromise;
      } finally {
        this._initPromise = null;
      }
    }

    return this.context;
  }

  async _configurePageRoutes(page) {
    if (page.__mindxRoutesConfigured) return;
    page.__mindxRoutesConfigured = true;

    await page.route('**/*', route => {
      const req = route.request();
      const type = req.resourceType();
      const url = req.url().toLowerCase();

      if (type === 'image' || type === 'font' || type === 'media') {
        return route.abort();
      }
      if (
        url.includes('fcm.googleapis.com') ||
        url.includes('firebasemessaging') ||
        url.includes('firebaseinstallations') ||
        url.includes('google-analytics') ||
        url.includes('gtag') ||
        url.includes('base-beta-api/graphql')
      ) {
        return route.abort();
      }
      return route.continue();
    });
  }

  async getPage(options = {}) {
    const context = await this.getContext(options);
    if (!this.page || this.page.isClosed()) {
      const pages = context.pages();
      this.page = pages.length > 0 ? pages[0] : await context.newPage();

      // Set default timeouts
      this.page.setDefaultTimeout(30000);
      this.page.setDefaultNavigationTimeout(45000);

      // Chặn tài nguyên nặng & request lỗi CORS/Firebase
      await this._configurePageRoutes(this.page);

      // Catch console errors (bỏ qua lỗi abort do route chủ động chặn)
      this.page.on('console', msg => {
        if (msg.type() === 'error') {
          const txt = msg.text() || '';
          if (txt.includes('ERR_FAILED') || txt.includes('firebase') || txt.includes('base-beta-api')) return;
          logger.debug(`[Browser Console Error] ${txt}`);
        }
      });
    }
    return this.page;
  }

  /**
   * Pre-warm Chromium ngầm (headless: true) ngay khi server khởi động
   */
  async warmup() {
    if (this._warmupPromise) return this._warmupPromise;
    if (!this.hasSavedSession()) {
      logger.info('[BrowserManager] Chưa có session đăng nhập, bỏ qua warmup.');
      return false;
    }

    this._warmupPromise = (async () => {
      const t0 = Date.now();
      try {
        logger.info('[BrowserManager] Đang pre-warm trình duyệt ngầm (headless: true)...');
        // Gọi trực tiếp logic tạo context/page mà không tự await _warmupPromise
        const ctx = await (async () => {
          if (!this.browser) {
            this.browser = await chromium.launch({
              headless: true,
              args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled'
              ]
            });
            this.context = await this.browser.newContext({
              viewport: { width: 1366, height: 860 },
              userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              locale: 'vi-VN',
              timezoneId: 'Asia/Ho_Chi_Minh',
              storageState: this.storageStatePath
            });
          }
          return this.context;
        })();

        if (!this.page || this.page.isClosed()) {
          const pages = ctx.pages();
          this.page = pages.length > 0 ? pages[0] : await ctx.newPage();
          this.page.setDefaultTimeout(30000);
          this.page.setDefaultNavigationTimeout(45000);
          await this._configurePageRoutes(this.page);
        }

        await this.page.goto('https://lms.mindx.edu.vn/admin/classes', {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        logger.info(`[BrowserManager] Pre-warm hoàn tất sau ${Date.now() - t0}ms.`);
        return true;
      } catch (err) {
        logger.warn(`[BrowserManager] Pre-warm gặp lỗi (không ảnh hưởng server): ${err.message}`);
        return false;
      } finally {
        this._warmupPromise = null;
      }
    })();

    return this._warmupPromise;
  }

  async saveSession() {
    if (!this.context) return false;
    try {
      await this.context.storageState({ path: this.storageStatePath });
      logger.info(`[BrowserManager] Đã lưu session vào: ${this.storageStatePath}`);
      return true;
    } catch (err) {
      logger.error(`[BrowserManager] Không thể lưu session: ${err.message}`);
      return false;
    }
  }

  async clearSession() {
    if (fs.existsSync(this.storageStatePath)) {
      try {
        fs.unlinkSync(this.storageStatePath);
        logger.info('[BrowserManager] Đã xóa session cũ.');
      } catch (e) {
        logger.warn('[BrowserManager] Lỗi xóa file session:', e.message);
      }
    }
    await this.closeBrowser();
  }

  async captureScreenshot(namePrefix = 'step', options = {}) {
    const { force = false } = options;
    const debugEnabled = process.env.DEBUG_SCREENSHOT === 'true';
    const isErrorShot = /fail|error|zero/i.test(namePrefix);

    if (!force && !debugEnabled && !isErrorShot) {
      return null;
    }
    if (!this.page || this.page.isClosed()) return null;
    try {
      const fileName = `${namePrefix}_${Date.now()}.png`;
      const filePath = path.join(this.screenshotsDir, fileName);
      await this.page.screenshot({ path: filePath, fullPage: false });
      logger.info(`[BrowserManager] Đã chụp ảnh màn hình: ${filePath}`);
      return filePath;
    } catch (err) {
      logger.warn(`[BrowserManager] Lỗi chụp screenshot: ${err.message}`);
      return null;
    }
  }

  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
        logger.info('[BrowserManager] Đã đóng trình duyệt.');
      } catch (err) {
        logger.warn(`[BrowserManager] Lỗi đóng trình duyệt: ${err.message}`);
      } finally {
        this.browser = null;
        this.context = null;
        this.page = null;
      }
    }
  }
}

module.exports = new BrowserManager();
