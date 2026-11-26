/**
 * Tab Tự động hóa MindX LMS (Automation Tab ES Module)
 * Điều khiển quy trình Playwright: Login, Chọn lớp, Chọn buổi, Nhập Summary & Nhận xét học viên.
 */

import { toast, showConfirm } from '../services/toast.js';
import { ICONS } from '../services/icons.js';
import { apiRequest } from '../services/apiBridge.js';

let pollTimer = null;
let currentLmsClasses = [];
let currentLmsStudents = [];

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function initAutomationTab() {
  setupAutomationEventHandlers();
  startStatusPolling();
  await refreshLmsStatus();
}

function stopStatusPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startStatusPolling() {
  stopStatusPolling();
  pollTimer = setInterval(async () => {
    // Chỉ poll khi tab automation đang hiển thị
    const pane = document.getElementById('tab-automation');
    if (pane && pane.classList.contains('active')) {
      await refreshLmsStatus();
      await fetchRecentLogs();
    }
  }, 2000);
}

async function refreshLmsStatus() {
  const data = await apiRequest('/api/automation/status');
  const serverAlert = document.getElementById('lms-server-alert');
  const sessionBadge = document.getElementById('lms-session-status-badge');
  const stateBadge = document.getElementById('lms-state-machine-badge');
  const progressBar = document.getElementById('lms-progress-bar-fill');
  const progressText = document.getElementById('lms-progress-text');

  if (!data || data.success === false && data.error && data.error.includes('Không thể kết nối')) {
    if (serverAlert) serverAlert.style.display = 'block';
    if (sessionBadge) {
      sessionBadge.textContent = 'Chưa bật Server';
      sessionBadge.className = 'tag tag-red';
    }
    return;
  }

  if (serverAlert) serverAlert.style.display = 'none';

  // Cập nhật Session badge
  if (sessionBadge) {
    if (data.hasSavedSession) {
      sessionBadge.textContent = 'Session: Đã đăng nhập ✓';
      sessionBadge.className = 'tag tag-green';
    } else {
      sessionBadge.textContent = 'Session: Chưa đăng nhập';
      sessionBadge.className = 'tag tag-gray';
    }
  }

  // Cập nhật State machine badge
  if (stateBadge) {
    stateBadge.textContent = `Trạng thái: ${data.state} ${data.currentTask ? `(${data.currentTask})` : ''}`;
    if (data.state === 'IDLE' || data.state === 'COMPLETED') {
      stateBadge.className = 'tag tag-green';
    } else if (data.state.includes('FAILED') || data.state === 'CANCELLED') {
      stateBadge.className = 'tag tag-red';
    } else {
      stateBadge.className = 'tag tag-blue';
    }
  }

  // Cập nhật Progress bar
  if (data.progress && data.progress.total > 0) {
    const p = data.progress;
    if (progressBar) progressBar.style.width = `${p.percent}%`;
    if (progressText) {
      progressText.textContent = `Tiến độ: ${p.current}/${p.total} (${p.percent}%) — Đang xử lý: ${p.currentStudent || '...'}`;
    }
  }
}

async function fetchRecentLogs() {
  const logBox = document.getElementById('lms-terminal-logs');
  if (!logBox) return;

  const res = await apiRequest('/api/automation/logs?limit=40');
  if (res && res.success && res.logs) {
    const isScrolledToBottom = logBox.scrollHeight - logBox.clientHeight <= logBox.scrollTop + 30;
    
    logBox.innerHTML = res.logs.map(log => {
      let color = '#94A3B8';
      if (log.level === 'INFO') color = '#38BDF8';
      if (log.level === 'WARN') color = '#FBBF24';
      if (log.level === 'ERROR') color = '#F87171';
      return `<div style="margin-bottom: 3px; line-height: 1.4;"><span style="color: #64748B;">[${escapeHtml(log.time)}]</span> <strong style="color: ${color};">[${log.level}]</strong> ${escapeHtml(log.message)}</div>`;
    }).join('');

    if (isScrolledToBottom) {
      logBox.scrollTop = logBox.scrollHeight;
    }
  }
}

function setupAutomationEventHandlers() {
  // Nút Đăng nhập mở modal
  const btnOpenLogin = document.getElementById('btn-open-lms-login');
  const modalLogin = document.getElementById('modal-lms-login');
  const btnCloseLogin = document.getElementById('btn-close-lms-login');

  if (btnOpenLogin && modalLogin) {
    btnOpenLogin.onclick = () => { modalLogin.style.display = 'flex'; };
  }
  if (btnCloseLogin && modalLogin) {
    btnCloseLogin.onclick = () => { modalLogin.style.display = 'none'; };
  }

  // Nút Xác nhận đăng nhập Headless
  const btnSubmitLogin = document.getElementById('btn-submit-lms-login');
  if (btnSubmitLogin) {
    btnSubmitLogin.onclick = handleHeadlessLogin;
  }

  // Nút Đăng nhập trực quan (Mở trình duyệt)
  const btnInteractiveLogin = document.getElementById('btn-interactive-lms-login');
  if (btnInteractiveLogin) {
    btnInteractiveLogin.onclick = handleInteractiveLogin;
  }

  // Nút Đăng xuất
  const btnLogout = document.getElementById('btn-lms-logout');
  if (btnLogout) {
    btnLogout.onclick = handleLogout;
  }

  // Nút Tải danh sách lớp
  const btnLoadClasses = document.getElementById('btn-load-lms-classes');
  if (btnLoadClasses) {
    btnLoadClasses.onclick = handleLoadClasses;
  }

  // Dropdown chọn lớp
  const selClass = document.getElementById('select-lms-class');
  if (selClass) {
    selClass.onchange = handleSelectClass;
  }

  // Dropdown chọn buổi
  const selSession = document.getElementById('select-lms-session');
  if (selSession) {
    selSession.onchange = handleSelectSession;
  }

  // Nút Đọc Summary hiện tại
  const btnReadSummary = document.getElementById('btn-read-lms-summary');
  if (btnReadSummary) {
    btnReadSummary.onclick = handleReadSummary;
  }

  // Nút Lưu Summary
  const btnSaveSummary = document.getElementById('btn-save-lms-summary');
  if (btnSaveSummary) {
    btnSaveSummary.onclick = handleSaveSummary;
  }

  // Nút Tải danh sách học viên
  const btnLoadStudents = document.getElementById('btn-load-lms-students');
  if (btnLoadStudents) {
    btnLoadStudents.onclick = handleLoadStudents;
  }

  // Nút Chạy tự động hàng loạt
  const btnRunBatch = document.getElementById('btn-run-batch-comments');
  if (btnRunBatch) {
    btnRunBatch.onclick = handleRunBatchComments;
  }

  // Nút Hủy tiến trình
  const btnCancel = document.getElementById('btn-cancel-automation');
  if (btnCancel) {
    btnCancel.onclick = async () => {
      await apiRequest('/api/automation/cancel', { method: 'POST' });
      await refreshLmsStatus();
    };
  }
}

async function handleHeadlessLogin() {
  const emailInp = document.getElementById('inp-lms-email');
  const passInp = document.getElementById('inp-lms-password');
  const statusMsg = document.getElementById('lms-login-modal-status');

  const email = emailInp ? emailInp.value.trim() : '';
  const password = passInp ? passInp.value : '';

  if (!email || !password) {
    toast.warning('Vui lòng nhập đầy đủ Email và Mật khẩu.');
    return;
  }

  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.textContent = '⏳ Đang đăng nhập qua Playwright Chromium...';
    statusMsg.className = 'tag tag-blue';
  }

  const res = await apiRequest('/api/automation/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, headless: true })
  });

  if (res && res.success) {
    if (statusMsg) {
      statusMsg.textContent = 'Đăng nhập thành công! ✓';
      statusMsg.className = 'tag tag-green';
    }
    setTimeout(() => {
      const modal = document.getElementById('modal-lms-login');
      if (modal) modal.style.display = 'none';
      refreshLmsStatus();
    }, 1500);
  } else {
    if (statusMsg) {
      statusMsg.textContent = `Thất bại: ${res.error || 'Sai thông tin đăng nhập'}`;
      statusMsg.className = 'tag tag-red';
    }
  }
}

async function handleInteractiveLogin() {
  const statusMsg = document.getElementById('lms-login-modal-status');
  if (statusMsg) {
    statusMsg.style.display = 'block';
    statusMsg.textContent = 'Đang mở cửa sổ trình duyệt... Hãy hoàn tất đăng nhập trên cửa sổ đó.';
    statusMsg.className = 'tag tag-blue';
  }

  const res = await apiRequest('/api/automation/login-interactive', {
    method: 'POST',
    body: JSON.stringify({ timeoutMs: 180000 })
  });

  if (res && res.success) {
    if (statusMsg) {
      statusMsg.textContent = 'Đăng nhập trực quan thành công! ✓';
      statusMsg.className = 'tag tag-green';
    }
    setTimeout(() => {
      const modal = document.getElementById('modal-lms-login');
      if (modal) modal.style.display = 'none';
      refreshLmsStatus();
    }, 1500);
  } else {
    if (statusMsg) {
      statusMsg.textContent = `Thất bại: ${res.error || 'Quá thời gian chờ'}`;
      statusMsg.className = 'tag tag-red';
    }
  }
}

async function handleLogout() {
  if (await showConfirm('Bạn có chắc chắn muốn đăng xuất khỏi MindX LMS?', { title: 'Đăng xuất', confirmText: 'Đăng xuất' })) {
    await apiRequest('/api/automation/logout', { method: 'POST' });
    await refreshLmsStatus();
    toast.info('Đã đăng xuất khỏi MindX LMS.');
  }
}

async function handleLoadClasses() {
  const btn = document.getElementById('btn-load-lms-classes');
  const sel = document.getElementById('select-lms-class');
  if (btn) btn.disabled = true;

  try {
    const res = await apiRequest('/api/automation/classes?status=running');
    if (res && res.success && res.classes) {
      currentLmsClasses = res.classes;
      if (sel) {
        sel.innerHTML = '<option value="">-- Chọn lớp học từ LMS --</option>';
        res.classes.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.link || c.id;
          opt.textContent = `${c.title} (${c.statusText || 'Running'})`;
          sel.appendChild(opt);
        });
      }
    } else {
      toast.error(`Không thể lấy danh sách lớp: ${res.error || 'Chưa đăng nhập'}`);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleSelectClass() {
  const sel = document.getElementById('select-lms-class');
  if (!sel || !sel.value) return;

  const classTarget = sel.value;
  const res = await apiRequest('/api/automation/classes/select', {
    method: 'POST',
    body: JSON.stringify({ classId: classTarget })
  });

  if (res && res.success) {
    // Tự động tải danh sách buổi học
    await handleLoadSessions();
  } else {
    toast.error(`Không thể truy cập lớp: ${res.error || 'Lỗi mạng'}`);
  }
}

async function handleLoadSessions() {
  const sel = document.getElementById('select-lms-session');
  const res = await apiRequest('/api/automation/sessions');

  if (res && res.success && res.sessions) {
    if (sel) {
      sel.innerHTML = '';
      res.sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.sessionNumber;
        const suffix = s.isAvailable === false ? ' (Chưa diễn ra)' : '';
        opt.textContent = (s.title || `Buổi ${s.sessionNumber}`) + suffix;
        if (s.isAvailable === false) opt.disabled = true;
        if (s.isActive) opt.selected = true;
        sel.appendChild(opt);
      });
      // Gọi chọn buổi đầu tiên khả dụng
      const firstAvailable = res.sessions.find(s => s.isActive && s.isAvailable !== false) || res.sessions.find(s => s.isAvailable !== false);
      if (firstAvailable) {
        sel.value = firstAvailable.sessionNumber;
        await handleSelectSession();
      }
    }
  }
}

async function handleSelectSession() {
  const sel = document.getElementById('select-lms-session');
  if (!sel || !sel.value) return;

  const sNum = parseInt(sel.value, 10);
  const res = await apiRequest('/api/automation/sessions/select', {
    method: 'POST',
    body: JSON.stringify({ sessionNumber: sNum })
  });

  if (!res || !res.success) {
    toast.warning((res && (res.message || res.error)) || 'Không thể chọn buổi học này.');
    return;
  }

  // Tự động điền Summary gợi ý từ Tab 1 & Tab 2 nếu có
  const summaryInp = document.getElementById('lms-summary-input');
  const editorZalo = document.getElementById('textarea-zalo-message');
  if (summaryInp && editorZalo && editorZalo.value && (!summaryInp.value || summaryInp.value.length < 10)) {
    summaryInp.value = editorZalo.value;
  }
}

async function handleReadSummary() {
  const summaryInp = document.getElementById('lms-summary-input');
  const res = await apiRequest('/api/automation/summary');
  if (res && res.success) {
    if (summaryInp) summaryInp.value = res.summary || '';
    if (res.summary) {
      toast.success('Đã đọc thành công Summary từ LMS.');
    } else {
      toast.info('Summary hiện tại trên LMS đang rỗng.');
    }
  }
}

async function handleSaveSummary() {
  const summaryInp = document.getElementById('lms-summary-input');
  const chkForce = document.getElementById('chk-lms-force-summary');
  const content = summaryInp ? summaryInp.value.trim() : '';

  if (!content) {
    toast.warning('Vui lòng nhập nội dung Summary trước khi lưu.');
    return;
  }

  const res = await apiRequest('/api/automation/summary', {
    method: 'POST',
    body: JSON.stringify({
      content,
      forceOverwrite: chkForce ? chkForce.checked : true
    })
  });

  if (res && res.success) {
    toast.success(`${res.message} (${res.status})`);
  } else {
    toast.error(`Lưu Summary thất bại: ${res.message || res.error}`);
  }
}

async function handleLoadStudents() {
  const btn = document.getElementById('btn-load-lms-students');
  const tbody = document.getElementById('lms-students-table-body');
  if (btn) btn.disabled = true;

  try {
    const res = await apiRequest('/api/automation/students');
    if (res && res.success && res.students) {
      currentLmsStudents = res.students;
      renderStudentsTable(res.students);
      toast.success(`Đã quét ${res.students.length} học viên từ LMS.`);
    } else {
      toast.error(`Không thể quét danh sách học viên: ${res.error || 'Lỗi LMS'}`);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderStudentsTable(students) {
  const tbody = document.getElementById('lms-students-table-body');
  if (!tbody) return;

  if (students.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #64748B; padding: 20px;">Không tìm thấy học viên nào.</td></tr>';
    return;
  }

  tbody.innerHTML = students.map((s, idx) => {
    const isPresent = s.attendance === 'PRESENT' || s.attendance === 'ATTENDED';
    const isAbsent = s.attendance === 'ABSENT';
    const attTagClass = isPresent ? 'tag-green' : (isAbsent ? 'tag-red' : 'tag-gray');
    const attTagText = isPresent ? 'Có mặt' : (isAbsent ? 'Vắng mặt' : 'Chưa rõ');

    const defaultComment = `Con ${s.name} hôm nay tham gia học tập tích cực, tiếp thu kiến thức bài học tốt và hoàn thành bài tập thực hành theo yêu cầu của thầy cô.`;

    return `
      <tr data-student-idx="${idx}" style="border-bottom: 1px solid #E2E8F0;">
        <td style="padding: 10px 14px; font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 14px; font-weight: 700; color: #0F172A;">${escapeHtml(s.name)}</td>
        <td style="padding: 10px 14px;">
          <span class="tag ${attTagClass}">${attTagText}</span>
        </td>
        <td style="padding: 10px 14px;">
          <textarea class="form-control student-comment-text" rows="2" style="font-size: 12.5px; width: 100%; min-width: 260px;">${escapeHtml(defaultComment)}</textarea>
        </td>
        <td style="padding: 10px 14px; white-space: nowrap;">
          <button type="button" class="btn btn-secondary btn-xs btn-test-single-student" data-name="${escapeHtml(s.name)}" ${isAbsent ? 'disabled title="Học viên vắng mặt"' : ''}>
            ${ICONS.flask(12)} Thử nghiệm 1 bạn
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Gắn sự kiện nút thử nghiệm 1 học viên
  tbody.querySelectorAll('.btn-test-single-student').forEach(btn => {
    btn.onclick = async (e) => {
      const studentName = btn.getAttribute('data-name');
      const row = btn.closest('tr');
      const commentInp = row ? row.querySelector('.student-comment-text') : null;
      const commentText = commentInp ? commentInp.value.trim() : '';

      if (!commentText) {
        toast.warning('Nội dung nhận xét không được để trống.');
        return;
      }

      if (await showConfirm(`Xác nhận nhập và lưu nhận xét cho học viên: "${studentName}" lên LMS?`, { title: 'Nhập nhận xét', confirmText: 'Nhập lên LMS' })) {
        btn.disabled = true;
        btn.textContent = '⏳ Đang lưu...';
        const res = await apiRequest('/api/automation/comment/single', {
          method: 'POST',
          body: JSON.stringify({
            studentName,
            commentText,
            forceOverwrite: true
          })
        });
        btn.disabled = false;
        btn.innerHTML = `${ICONS.flask(12)} Thử nghiệm 1 bạn`;

        if (res && res.success && res.status === 'VERIFIED') {
          toast.success(`Đã lưu và xác minh nhận xét cho "${studentName}".`);
        } else {
          toast.warning(`Kết quả: ${res.message || res.error || JSON.stringify(res)}`);
        }
      }
    };
  });
}

async function handleRunBatchComments() {
  if (currentLmsStudents.length === 0) {
    toast.warning('Vui lòng tải danh sách học viên trước.');
    return;
  }

  const tbody = document.getElementById('lms-students-table-body');
  const studentsToProcess = [];

  const rows = tbody.querySelectorAll('tr[data-student-idx]');
  rows.forEach((row, idx) => {
    const student = currentLmsStudents[idx];
    if (student) {
      const commentInp = row.querySelector('.student-comment-text');
      const commentText = commentInp ? commentInp.value.trim() : '';
      studentsToProcess.push({
        name: student.name,
        attendance: student.attendance,
        comment: commentText
      });
    }
  });

  const presentCount = studentsToProcess.filter(s => s.attendance === 'PRESENT' || s.attendance === 'ATTENDED' || s.attendance === 'UNKNOWN').length;

  const ok = await showConfirm(
    `Bắt đầu tự động nhập nhận xét cho ${presentCount} học viên có mặt trong buổi học này.`,
    { title: 'Nhập nhận xét hàng loạt', confirmText: 'Bắt đầu' }
  );
  if (!ok) return;

  const btn = document.getElementById('btn-run-batch-comments');
  if (btn) btn.disabled = true;

  try {
    const res = await apiRequest('/api/automation/comment/batch', {
      method: 'POST',
      body: JSON.stringify({
        students: studentsToProcess,
        forceOverwrite: true
      })
    });

    if (res && res.success && res.report) {
      const r = res.report;
      toast.success(`Hoàn thành: ${r.verifiedCount} thành công, ${r.skippedCount} bỏ qua, ${r.failedCount} thất bại.`, 5000);
    } else {
      toast.error(`Tiến trình kết thúc với lỗi: ${res.error || 'Lỗi không xác định'}`);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
