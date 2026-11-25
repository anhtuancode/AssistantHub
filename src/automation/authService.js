const browserManager = require('./browserManager');
const logger = require('../utils/logger');
const { AuthError } = require('../utils/errorHandler');

class AuthService {
  constructor() {
    this.loginUrl = 'https://base.mindx.edu.vn/login?callbackUrl=https://lms.mindx.edu.vn/admin/classes';
    this.classesUrl = 'https://lms.mindx.edu.vn/admin/classes';
  }

  /**
   * Kiểm tra xem session hiện tại có hợp lệ và truy cập được LMS không.
   */
  async checkSessionValid() {
    try {
      if (!browserManager.hasSavedSession()) {
        return { valid: false, reason: 'NO_SAVED_SESSION' };
      }

      logger.info('[AuthService] Đang kiểm tra session hiện có...');
      const page = await browserManager.getPage({ headless: true });
      await page.goto(this.classesUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });

      // Chờ xem có bị redirect về trang login không
      await page.waitForTimeout(2500);

      const currentUrl = page.url();
      const parsedUrl = new URL(currentUrl);

      if (parsedUrl.hostname === 'lms.mindx.edu.vn' && !parsedUrl.pathname.includes('/login')) {
        logger.info('[AuthService] Session hợp lệ! Đang ở trang LMS.');
        return { valid: true, url: currentUrl };
      }

      logger.warn(`[AuthService] Session đã hết hạn hoặc bị redirect: ${currentUrl}`);
      return { valid: false, reason: 'SESSION_EXPIRED', redirectUrl: currentUrl };
    } catch (err) {
      logger.warn(`[AuthService] Lỗi kiểm tra session: ${err.message}`);
      return { valid: false, reason: 'CHECK_ERROR', error: err.message };
    }
  }

  /**
   * Đăng nhập tự động bằng Email & Mật khẩu (Headless hoặc Headed)
   */
  async loginWithCredentials(email, password, options = {}) {
    if (!email || !password) {
      throw new AuthError('Email và mật khẩu không được để trống.');
    }

    const { headless = true } = options;
    logger.info(`[AuthService] Bắt đầu đăng nhập tài khoản: ${email} (headless: ${headless})...`);

    // Khởi động page mới
    const page = await browserManager.getPage({ headless, forceNew: true });

    try {
      logger.info(`[AuthService] Điều hướng đến trang đăng nhập: ${this.loginUrl}`);
      await page.goto(this.loginUrl, { waitUntil: 'networkidle', timeout: 35000 });

      // Xác minh form đăng nhập xuất hiện
      const emailInput = page.locator('input[name="email"], input[placeholder*="email" i]');
      const passwordInput = page.locator('input[name="password"], input[type="password"]');

      await emailInput.waitFor({ state: 'visible', timeout: 20000 });
      await passwordInput.waitFor({ state: 'visible', timeout: 20000 });

      logger.info('[AuthService] Nhập thông tin đăng nhập...');
      await emailInput.fill(email.trim());
      await passwordInput.fill(password);

      // Xác định nút submit "Đăng nhập" chính xác (tránh nút phụ "Đăng nhập bằng email/SMS")
      let submitBtn = page.locator('button[type="submit"]').filter({ hasText: /đăng nhập/i });
      if (await submitBtn.count() === 0) {
        submitBtn = page.getByRole('button', { name: 'Đăng nhập', exact: true });
      }
      if (await submitBtn.count() === 0) {
        submitBtn = page.locator('button[type="submit"]');
      }
      await submitBtn.first().waitFor({ state: 'visible', timeout: 10000 });

      logger.info('[AuthService] Nhấp nút Đăng nhập...');
      await submitBtn.first().click();

      // Chờ phản hồi từ hệ thống
      logger.info('[AuthService] Đang chờ LMS xử lý đăng nhập...');
      
      // Quan sát song song cả URL thay đổi và thông báo lỗi xuất hiện
      let loginSuccess = false;
      let errorReason = null;

      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(1000);
        const currentUrl = page.url();
        const parsedUrl = new URL(currentUrl);

        // Kiểm tra nếu đã chuyển sang LMS
        if (parsedUrl.hostname === 'lms.mindx.edu.vn' && !parsedUrl.pathname.includes('/login')) {
          loginSuccess = true;
          break;
        }

        // Kiểm tra lỗi hiển thị trên UI
        const errorMsg = await page.$$eval(
          '.ant-message-notice-error, .ant-message-custom-content.ant-message-error, .ant-form-item-explain-error, .ant-notification-notice-error, [role="alert"]',
          els => els.map(e => e.innerText.trim()).filter(Boolean).join('; ')
        ).catch(() => '');

        if (errorMsg) {
          if (errorMsg.includes('wrongLoginCredentials') || errorMsg.toLowerCase().includes('sai')) {
            errorReason = 'Tài khoản hoặc mật khẩu không chính xác.';
          } else {
            errorReason = `LMS báo lỗi: ${errorMsg}`;
          }
          break;
        }

        // Kiểm tra nếu xuất hiện trường OTP hoặc xác minh 2 bước
        const otpInput = await page.$('input[name*="otp" i], input[placeholder*="otp" i], input[name*="code" i]');
        if (otpInput && await otpInput.isVisible()) {
          errorReason = 'Hệ thống yêu cầu mã xác thực OTP / 2FA. Vui lòng sử dụng chế độ Đăng nhập trực quan.';
          break;
        }
      }

      if (loginSuccess) {
        logger.info('[AuthService] Đăng nhập thành công! Đang lưu session...');
        await browserManager.captureScreenshot('login_success');
        await browserManager.saveSession();
        return {
          success: true,
          message: 'Đăng nhập MindX LMS thành công.',
          currentUrl: page.url()
        };
      }

      await browserManager.captureScreenshot('login_failed');
      const failMessage = errorReason || 'Đăng nhập không thành công (Hết thời gian chờ phản hồi từ LMS).';
      logger.error(`[AuthService] ${failMessage}`);
      throw new AuthError(failMessage);

    } catch (err) {
      if (err instanceof AuthError) throw err;
      logger.error(`[AuthService] Ngoại lệ đăng nhập: ${err.message}`);
      await browserManager.captureScreenshot('login_exception');
      throw new AuthError(`Lỗi quá trình đăng nhập: ${err.message}`);
    }
  }

  /**
   * Đăng nhập trực quan qua cửa sổ trình duyệt (Headed Mode)
   * Cho phép giáo viên trực tiếp nhìn màn hình, đăng nhập tài khoản Google Workspace hoặc nhập OTP.
   */
  async loginInteractive(timeoutMs = 180000) {
    logger.info('[AuthService] Khởi động chế độ Đăng nhập trực quan (Mở trình duyệt)...');
    const page = await browserManager.getPage({ headless: false, forceNew: true });

    try {
      await page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      logger.info(`[AuthService] Vui lòng thao tác đăng nhập trên cửa sổ trình duyệt vừa mở (Thời gian chờ tối đa ${timeoutMs / 1000}s)...`);

      // Chờ cho đến khi URL chuyển sang lms.mindx.edu.vn
      const startTime = Date.now();
      let loggedIn = false;

      while (Date.now() - startTime < timeoutMs) {
        if (page.isClosed()) {
          throw new AuthError('Người dùng đã đóng cửa sổ trình duyệt trước khi hoàn tất đăng nhập.');
        }

        const currentUrl = page.url();
        try {
          const parsedUrl = new URL(currentUrl);
          if (parsedUrl.hostname === 'lms.mindx.edu.vn' && !parsedUrl.pathname.includes('/login')) {
            loggedIn = true;
            break;
          }
        } catch (_) {}

        await page.waitForTimeout(1000);
      }

      if (loggedIn) {
        logger.info('[AuthService] Đã nhận diện phiên đăng nhập thành công từ trình duyệt!');
        await page.waitForTimeout(2000); // Chờ cookie set đầy đủ
        await browserManager.saveSession();
        await browserManager.captureScreenshot('interactive_login_success');
        return {
          success: true,
          message: 'Đăng nhập trực quan thành công. Session đã được lưu trữ an toàn.'
        };
      }

      throw new AuthError('Quá thời gian chờ đăng nhập (Timeout). Vui lòng thử lại.');
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(`Lỗi trong phiên đăng nhập trực quan: ${err.message}`);
    }
  }

  /**
   * Đăng xuất và dọn dẹp session
   */
  async logout() {
    await browserManager.clearSession();
    logger.info('[AuthService] Đã đăng xuất và xóa toàn bộ session.');
    return { success: true, message: 'Đã đăng xuất.' };
  }
}

module.exports = new AuthService();
