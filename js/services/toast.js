/**
 * Toast Notification & Confirm Modal Service
 * Thay thế 100% window.alert() và window.confirm() mặc định của trình duyệt.
 */

const TOAST_ICONS = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ'
};

function ensureToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = null) {
  const container = ensureToastContainer();
  const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
  const autoHideMs = duration !== null ? duration : (safeType === 'error' ? 5000 : 3800);

  const el = document.createElement('div');
  el.className = `toast-item toast-${safeType}`;
  el.setAttribute('role', 'alert');

  const iconSpan = document.createElement('span');
  iconSpan.className = 'toast-icon';
  iconSpan.textContent = TOAST_ICONS[safeType];

  const msgDiv = document.createElement('div');
  msgDiv.className = 'toast-message';
  msgDiv.textContent = String(message || '');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Đóng thông báo');
  closeBtn.textContent = '×';

  el.appendChild(iconSpan);
  el.appendChild(msgDiv);
  el.appendChild(closeBtn);
  container.appendChild(el);

  // Trigger slide-in
  requestAnimationFrame(() => el.classList.add('toast-show'));

  let timer = null;
  let remaining = autoHideMs;
  let startTime = Date.now();

  const dismiss = () => {
    if (timer) clearTimeout(timer);
    el.classList.remove('toast-show');
    el.classList.add('toast-hide');
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 220);
  };

  const startTimer = () => {
    if (remaining <= 0) return;
    startTime = Date.now();
    timer = setTimeout(dismiss, remaining);
  };

  const pauseTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      remaining -= (Date.now() - startTime);
    }
  };

  closeBtn.onclick = dismiss;
  el.addEventListener('mouseenter', pauseTimer);
  el.addEventListener('mouseleave', startTimer);
  startTimer();

  return { dismiss };
}

export const toast = {
  success: (msg, duration) => showToast(msg, 'success', duration),
  error: (msg, duration) => showToast(msg, 'error', duration),
  warning: (msg, duration) => showToast(msg, 'warning', duration),
  info: (msg, duration) => showToast(msg, 'info', duration)
};

export function showConfirm(message, options = {}) {
  const {
    title = 'Xác nhận thao tác',
    confirmText = 'Xác nhận',
    cancelText = 'Hủy'
  } = options;

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';

    const box = document.createElement('div');
    box.className = 'confirm-modal-box';

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-modal-title';
    titleEl.textContent = title;

    const bodyEl = document.createElement('div');
    bodyEl.className = 'confirm-modal-body';
    bodyEl.textContent = String(message || '');

    const actionsEl = document.createElement('div');
    actionsEl.className = 'confirm-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn btn-primary btn-sm';
    confirmBtn.textContent = confirmText;

    actionsEl.appendChild(cancelBtn);
    actionsEl.appendChild(confirmBtn);
    box.appendChild(titleEl);
    box.appendChild(bodyEl);
    box.appendChild(actionsEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    };

    cancelBtn.onclick = () => cleanup(false);
    confirmBtn.onclick = () => cleanup(true);
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup(false);
    };
  });
}
