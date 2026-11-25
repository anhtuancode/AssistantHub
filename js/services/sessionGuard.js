/**
 * Session Guard Service
 * Phát hiện sớm lỗi SESSION_EXPIRED từ Backend và hướng dẫn giáo viên đăng nhập lại LMS.
 */

import { toast, showConfirm } from './toast.js';
import { switchTab } from '../main.js';

export async function handleSessionExpiredIfAny(data) {
  if (!data) return false;
  const errStr = String(data.error || data.message || '');
  const isExpired =
    data.errorCode === 'SESSION_EXPIRED' ||
    /session_expired|phiên đăng nhập.*hết hạn|đăng nhập lại/i.test(errStr);

  if (!isExpired) return false;

  toast.error('Phiên đăng nhập MindX LMS đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.');
  const goLogin = await showConfirm(
    'Phiên đăng nhập MindX LMS của bạn đã hết hạn.\n\nBấm "Đăng nhập lại" để chuyển sang trang Cấu hình và kết nối lại tài khoản LMS.',
    {
      title: 'Phiên đăng nhập đã hết hạn',
      confirmText: 'Đăng nhập lại',
      cancelText: 'Để sau'
    }
  );
  if (goLogin) {
    switchTab('tab-config');
  }
  return true;
}
