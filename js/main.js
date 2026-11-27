/**
 * MindX Assistant — Teacher Automation v1.0
 * Main Application Orchestrator (ES Module)
 */

import { initConfigTab } from './tabs/config.js';
import { initClassesTab } from './tabs/classes.js';
import { initStudentsTab } from './tabs/students.js';
import { initReviewTab } from './tabs/review.js';
import { initCurriculumTab } from './tabs/curriculum.js';
import { initZaloTab } from './tabs/zalo.js';
import { initTeacherPointTab } from './tabs/teacherPoint.js';
import { apiRequest } from './services/apiBridge.js';

let activeTab = 'tab-config';

const TAB_METADATA = {
  'tab-config': {
    title: 'Cấu hình & Bảo mật',
    subtitle: 'Quản lý thông tin tài khoản LMS MindX và cấu hình Google Gemini API.'
  },
  'tab-classes': {
    title: 'Lớp & Buổi học',
    subtitle: 'Quản lý danh sách lớp học và lựa chọn buổi học cần nhận xét.'
  },
  'tab-students': {
    title: 'Học viên & Ghi chú',
    subtitle: 'Soạn tóm tắt buổi học và cá nhân hóa nhận xét từng học sinh trước khi lưu.'
  },
  'tab-review': {
    title: 'Duyệt & Lưu nhận xét LMS',
    subtitle: 'Rà soát nội dung lần cuối và lưu nhận xét trực tiếp lên MindX LMS.'
  },
  'tab-curriculum': {
    title: 'Kho Giáo trình MindX',
    subtitle: 'Tra cứu 24 khóa học Robotics & Coding, xem chi tiết buổi học và tài liệu StudentBook.'
  },
  'tab-zalo': {
    title: 'Báo bài Zalo Phụ huynh',
    subtitle: 'Soạn mẫu tin nhắn báo bài gửi phụ huynh kèm bài tập về nhà khối Coding.'
  },
  'tab-teacher-point': {
    title: 'Teacher Point (Khảo sát Robotics)',
    subtitle: 'Gửi nhanh phiếu khảo sát Teacher Point cho khối Robotics (ROB) tại Buổi 4 và Buổi 8.'
  }
};

export function switchTab(tabId, params = null) {
  if (!TAB_METADATA[tabId]) return;
  activeTab = tabId;

  // Cập nhật trạng thái sidebar buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Cập nhật hiển thị tab-pane
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  // Cập nhật tiêu đề Topbar
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  const logBtn = document.getElementById('btn-open-log-drawer');
  const currSwitcher = document.getElementById('topbar-curriculum-switcher');
  const isCurrTab = tabId === 'tab-curriculum';

  if (titleEl) titleEl.textContent = TAB_METADATA[tabId].title;
  if (subEl) {
    subEl.textContent = TAB_METADATA[tabId].subtitle;
    subEl.style.display = isCurrTab ? 'none' : 'block';
  }
  if (logBtn) {
    logBtn.style.display = isCurrTab ? 'none' : 'inline-flex';
  }
  if (currSwitcher) {
    currSwitcher.style.display = isCurrTab ? 'inline-flex' : 'none';
  }

  // Khởi chạy controller của tab tương ứng
  if (tabId === 'tab-config') {
    initConfigTab();
  } else if (tabId === 'tab-classes') {
    initClassesTab();
  } else if (tabId === 'tab-students') {
    initStudentsTab();
  } else if (tabId === 'tab-review') {
    initReviewTab();
  } else if (tabId === 'tab-curriculum') {
    initCurriculumTab(params && params.courseCode ? params.courseCode : null);
  } else if (tabId === 'tab-zalo') {
    initZaloTab(
      params && params.courseCode ? params.courseCode : null,
      params && params.sessionNumber ? params.sessionNumber : null
    );
  } else if (tabId === 'tab-teacher-point') {
    initTeacherPointTab();
  }
}

// Log Drawer / Modal Helper
function setupLogDrawer() {
  const btnOpen = document.getElementById('btn-open-log-drawer');
  const btnClose = document.getElementById('btn-close-log-drawer');
  const drawer = document.getElementById('log-drawer-panel');
  const logBox = document.getElementById('log-drawer-content');
  const logCounter = document.getElementById('log-counter-number');

  if (btnOpen && drawer) {
    btnOpen.onclick = () => {
      drawer.classList.add('open');
      fetchLogs();
    };
  }
  if (btnClose && drawer) {
    btnClose.onclick = () => {
      drawer.classList.remove('open');
    };
  }

  async function fetchLogs() {
    try {
      const data = await apiRequest('/api/automation/logs?limit=50');
      if (data.success && data.logs) {
        if (logCounter) logCounter.textContent = data.logs.length;
        if (logBox) {
          logBox.innerHTML = data.logs.map(log => {
            let color = '#94A3B8';
            if (log.level === 'INFO') color = '#38BDF8';
            if (log.level === 'WARN') color = '#FBBF24';
            if (log.level === 'ERROR') color = '#F87171';
            return `<div style="margin-bottom: 4px;"><span style="color: #64748B;">[${log.time}]</span> <strong style="color: ${color};">[${log.level}]</strong> ${log.message}</div>`;
          }).join('') || '<div style="color: #64748B;">Chưa có nhật ký nào.</div>';
          logBox.scrollTop = logBox.scrollHeight;
        }
      }
    } catch (_) {}
  }

  // Poll log counter every 3 seconds
  setInterval(fetchLogs, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  // Gắn sự kiện chuyển tab trên Sidebar
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (targetTab) {
        switchTab(targetTab);
      }
    });
  });

  setupLogDrawer();

  // Khởi chạy mặc định Tab Cấu hình
  switchTab('tab-config');
});
