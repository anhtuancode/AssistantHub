/**
 * Page 2: Lớp & Buổi học (Classes Tab Controller)
 * Quản lý danh sách lớp và buổi học dạng 2 cột theo đúng hình tham khảo số 2.
 */

import { switchTab } from '../main.js';
import { setSelectedClassAndSession, resetStudentsWorkspace } from './students.js';
import { toast } from '../services/toast.js';
import { handleSessionExpiredIfAny } from '../services/sessionGuard.js';
import { ICONS } from '../services/icons.js';

let loadedClasses = [];
let selectedClass = null;
let selectedSessions = [];
let isLoadingSessions = false;
let latestClassRequestId = 0;

function getClassUniqueId(cls) {
  if (!cls) return '';
  return String(cls.classId || cls.id || cls.classCode || cls.code || cls.title || '').trim();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initClassesTab() {
  bindClassesEvents();
  renderClassesList();
  renderSessionsList();
}

function bindClassesEvents() {
  const btnSync = document.getElementById('btn-sync-classes');
  if (btnSync) {
    btnSync.onclick = handleSyncClasses;
  }
}

async function handleSyncClasses() {
  const btnSync = document.getElementById('btn-sync-classes');
  if (btnSync) {
    btnSync.disabled = true;
    btnSync.innerHTML = '⏳ Đang quét danh sách lớp...';
  }

  try {
    const res = await fetch('/api/automation/classes?status=running');
    const data = await res.json();

    if (data.success && Array.isArray(data.classes)) {
      loadedClasses = data.classes;
      renderClassesList();
      toast.success(`Đã đồng bộ ${data.classes.length} lớp học từ MindX LMS.`);
    } else {
      if (await handleSessionExpiredIfAny(data)) return;
      toast.error(`Không thể quét danh sách lớp từ LMS: ${data.error || 'Vui lòng kiểm tra đăng nhập LMS ở trang Cấu hình.'}`);
    }
  } catch (err) {
    toast.error(`Lỗi kết nối máy chủ: ${err.message}`);
  } finally {
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.innerHTML = `${ICONS.refresh(16)} Quét danh sách lớp từ LMS`;
    }
  }
}

function renderClassesList() {
  const container = document.getElementById('classes-list-cards');
  const countEl = document.getElementById('classes-count-badge');
  if (!container) return;

  if (countEl) {
    countEl.textContent = loadedClasses.length;
  }

  if (loadedClasses.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #64748B; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px;">
        <div style="color: #94A3B8; margin-bottom: 10px; display: flex; justify-content: center;">${ICONS.folderOpen(30)}</div>
        <div style="font-weight: 600; margin-bottom: 4px; color: #0F172A;">Chưa có danh sách lớp học</div>
        <div style="font-size: 12.5px;">Bấm nút <strong>"Quét danh sách lớp từ LMS"</strong> ở trên để nạp dữ liệu.</div>
      </div>
    `;
    return;
  }

  const selectedId = getClassUniqueId(selectedClass);

  container.innerHTML = loadedClasses.map((cls, idx) => {
    const currentId = getClassUniqueId(cls);
    const isSelected = Boolean(selectedId) && selectedId === currentId;
    const code = cls.classCode || cls.code || (cls.title ? cls.title.split('—')[0].trim() : (cls.id || `Lớp ${idx + 1}`));

    return `
      <div class="class-card-item ${isSelected ? 'selected' : ''}" data-class-idx="${idx}">
        <div style="min-width: 0; flex: 1;">
          <div class="class-card-title">${escapeHtml(cls.title)}</div>
          <div class="class-card-sub">Mã: ${escapeHtml(code)} ${cls.cells && cls.cells[2] ? `| ${escapeHtml(cls.cells[2])}` : ''}</div>
        </div>
        <div>
          <button type="button" class="btn ${isSelected ? 'btn-primary' : 'btn-secondary'} btn-sm btn-select-class" data-class-idx="${idx}" ${isLoadingSessions ? 'disabled' : ''} style="white-space: nowrap;">
            ${isSelected ? (isLoadingSessions ? '⏳ Đang tải...' : 'Đang chọn') : 'Chọn lớp'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Gắn sự kiện Chọn lớp
  container.querySelectorAll('.btn-select-class').forEach(btn => {
    btn.onclick = (e) => {
      const idx = parseInt(btn.getAttribute('data-class-idx'), 10);
      handleSelectClass(loadedClasses[idx]);
    };
  });
}

async function handleSelectClass(cls) {
  // Chống double-click / gọi trùng khi đang loading
  if (isLoadingSessions) return;
  const reqId = ++latestClassRequestId;

  // 1. Reset ngay state buổi học, học viên, summary và bật trạng thái loading
  selectedClass = cls;
  selectedSessions = [];
  isLoadingSessions = true;
  resetStudentsWorkspace();
  renderClassesList();
  renderSessionsList();

  const activeClassCode = cls.classCode || cls.code || (cls.title ? cls.title.split('—')[0].trim() : '');
  if (activeClassCode) {
    window.__mindxActiveClassCode = activeClassCode;
    try { localStorage.setItem('mindx_active_class_code', activeClassCode); } catch (_) {}
  }

  const sessionHeaderBadge = document.getElementById('selected-class-code-badge');
  if (sessionHeaderBadge) {
    sessionHeaderBadge.textContent = cls.classCode || cls.code || (cls.title ? cls.title.split('—')[0].trim() : cls.id);
    sessionHeaderBadge.style.display = 'inline-block';
  }

  try {
    // 2. Gọi backend Playwright vào lớp mới
    const classTarget = cls.classId || cls.id || cls.link || cls.classCode || cls.code;
    const selRes = await fetch('/api/automation/classes/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId: classTarget })
    });
    const selData = await selRes.json();

    if (reqId !== latestClassRequestId) return;

    if (!selData.success) {
      selectedSessions = [];
      isLoadingSessions = false;
      renderClassesList();
      renderSessionsList();
      if (await handleSessionExpiredIfAny(selData)) return;
      toast.error(`Không thể truy cập lớp "${cls.title}": ${selData.error || 'Lỗi điều hướng LMS'}`);
      return;
    }

    // 3. Lấy danh sách buổi học mới từ tab Comments trên LMS
    const sessRes = await fetch('/api/automation/sessions');
    const sessData = await sessRes.json();

    if (reqId !== latestClassRequestId) return;

    if (sessData.success && Array.isArray(sessData.sessions)) {
      selectedSessions = sessData.sessions;
    } else {
      selectedSessions = [];
    }
  } catch (err) {
    if (reqId !== latestClassRequestId) return;
    console.warn('[Classes] Lỗi nạp buổi học từ LMS:', err);
    selectedSessions = [];
  } finally {
    if (reqId === latestClassRequestId) {
      isLoadingSessions = false;
      renderClassesList();
      renderSessionsList();
    }
  }
}

function generateDefaultSessions() {
  const list = [];
  for (let i = 1; i <= 14; i++) {
    list.push({
      sessionNumber: i,
      title: `Buổi ${i}`,
      subtext: `Buổi ${i} | Diễn ra theo lịch học`
    });
  }
  return list;
}

function renderSessionsList() {
  const container = document.getElementById('sessions-list-cards');
  if (!container) return;

  if (!selectedClass) {
    container.innerHTML = `
      <div style="text-align: center; padding: 50px 20px; color: #64748B; background: #FFFFFF; border: 1px dashed #CBD5E1; border-radius: 12px;">
        <div style="color: #94A3B8; margin-bottom: 10px; display: flex; justify-content: center;">${ICONS.clipboardList(30)}</div>
        <div style="font-weight: 600; margin-bottom: 4px; color: #0F172A;">Chưa chọn lớp học</div>
        <div style="font-size: 12.5px;">Vui lòng chọn lớp học ở danh sách bên trái để xem danh sách buổi học.</div>
      </div>
    `;
    return;
  }

  if (isLoadingSessions) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #64748B;">
        <div style="color: #DC2626; margin-bottom: 10px; display: flex; justify-content: center;">${ICONS.loader(24)}</div>
        <div>Đang truy cập lớp học trên LMS và tải danh sách buổi học...</div>
      </div>
    `;
    return;
  }

  if (selectedSessions.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #64748B;">
        Không tìm thấy buổi học nào cho lớp này.
      </div>
    `;
    return;
  }

  container.innerHTML = selectedSessions.map((sess, idx) => {
    const isAvailable = sess.isAvailable !== false;
    const statusBadge = isAvailable
      ? '<span class="tag tag-green" style="font-size: 11px; margin-left: 6px;">Đã diễn ra</span>'
      : `<span class="tag tag-gray" style="font-size: 11px; margin-left: 6px;">${ICONS.lock(11)} Chưa diễn ra</span>`;

    return `
      <div class="session-card-item ${isAvailable ? '' : 'session-disabled'}" data-session-idx="${idx}">
        <div>
          <div class="session-card-title">${escapeHtml(sess.title || `Buổi ${sess.sessionNumber}`)} ${statusBadge}</div>
          <div class="session-card-sub">${escapeHtml(sess.subtext || (isAvailable ? `Buổi ${sess.sessionNumber} | Sẵn sàng điểm danh & nhận xét` : `Buổi ${sess.sessionNumber} | Chưa diễn ra`))}</div>
        </div>
        <div>
          <button type="button" class="btn btn-secondary btn-sm btn-view-session" data-session-idx="${idx}" ${isAvailable ? '' : 'disabled title="Buổi học chưa diễn ra"'}>
            ${isAvailable ? 'Xem' : 'Khóa'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Chỉ gắn sự kiện click cho các buổi đã diễn ra (isAvailable !== false)
  container.querySelectorAll('.btn-view-session:not([disabled])').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.getAttribute('data-session-idx'), 10);
      const session = selectedSessions[idx];
      if (!session || session.isAvailable === false) return;

      // Chuyển dữ liệu sang Page 3
      setSelectedClassAndSession(selectedClass, session);

      // Chuyển tab sang tab-students
      switchTab('tab-students');
    };
  });
}
