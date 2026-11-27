/**
 * Page 4: Duyệt & Lưu nhận xét LMS (Review Tab Controller)
 * Hiển thị 2 cột rà soát nhận xét, thanh tiến trình trực quan và lưu lên MindX LMS.
 */

import { switchTab } from '../main.js';
import { toast, showConfirm } from '../services/toast.js';
import { handleSessionExpiredIfAny } from '../services/sessionGuard.js';
import { saveCurrentDraft } from './students.js';
import { getGeminiConfig } from './config.js';
import { loadCommentStyleConfig, getStyleSignature } from '../config/commentStyles.js';
import { checkTeacherPointEligibility } from './teacherPoint.js';
import { ICONS } from '../services/icons.js';
import { apiRequest } from '../services/apiBridge.js';

let reviewClass = null;
let reviewSession = null;
let reviewSummary = '';
let reviewStudents = [];
let selectedStudentIndex = 0;
let isBatchCancelled = false;
let isBatchRunning = false;
let isAiStreaming = false;
let userPickedStudentDuringStream = false;
let isResultModalBound = false;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function setReviewData(cls, session, summary, students) {
  reviewClass = cls;
  reviewSession = session;
  reviewSummary = summary || '';
  const all = Array.isArray(students) ? students : [];
  // Lọc bỏ hoàn toàn học viên Vắng mặt khỏi trang Duyệt & Lưu
  reviewStudents = all.filter(s => (s.attendance || s.attendanceStatus || 'PRESENT').toUpperCase() !== 'ABSENT');
  selectedStudentIndex = 0;
  renderReviewUI();
}

function getReviewClassCode() {
  if (!reviewClass) return '';
  return String(
    reviewClass.classCode ||
    reviewClass.code ||
    (reviewClass.title ? reviewClass.title.split('—')[0].trim() : '') ||
    reviewClass.id ||
    ''
  ).trim();
}

function closeResultModal() {
  if (isBatchRunning) return;
  const modal = document.getElementById('review-result-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function bindResultModalEvents() {
  if (isResultModalBound) return;
  isResultModalBound = true;

  const modal = document.getElementById('review-result-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal && !isBatchRunning) {
        closeResultModal();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || isBatchRunning) return;
    const currentModal = document.getElementById('review-result-modal');
    if (currentModal && currentModal.style.display === 'flex') {
      closeResultModal();
    }
  });
}

function createModalButton(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function showResultModal({ totalCount, savedCount, failedStudents }) {
  const modal = document.getElementById('review-result-modal');
  const iconEl = document.getElementById('review-result-icon');
  const titleEl = document.getElementById('review-result-title');
  const descEl = document.getElementById('review-result-desc');
  const statsEl = document.getElementById('review-result-stats');
  const errorsEl = document.getElementById('review-result-errors');
  const tpNoteEl = document.getElementById('review-result-tp-note');
  const actionsEl = document.getElementById('review-result-actions');

  if (!modal || !iconEl || !titleEl || !descEl || !statsEl || !errorsEl || !tpNoteEl || !actionsEl) {
    return;
  }

  const classCode = getReviewClassCode();
  const sessionNumber = reviewSession && reviewSession.sessionNumber ? reviewSession.sessionNumber : null;
  const failedCount = failedStudents.length;
  const isFullSuccess = failedCount === 0 && savedCount > 0;

  actionsEl.innerHTML = '';
  errorsEl.innerHTML = '';

  if (isFullSuccess) {
    iconEl.className = 'result-modal-icon success';
    iconEl.innerHTML = ICONS.check(22);
    titleEl.textContent = 'Lưu nhận xét thành công!';

    const classPart = classCode
      ? ` của lớp ${classCode}${sessionNumber ? ` — Buổi ${sessionNumber}` : ''}`
      : (sessionNumber ? ` — Buổi ${sessionNumber}` : '');
    descEl.textContent = `Đã lưu hoàn tất ${savedCount}/${totalCount} học viên${classPart} lên MindX LMS.`;

    statsEl.style.display = 'none';
    errorsEl.style.display = 'none';

    const tpEligibility = checkTeacherPointEligibility(reviewClass, reviewSession);
    if (tpEligibility.eligible) {
      tpNoteEl.style.display = 'block';
      tpNoteEl.textContent = `Nhắc nhỏ: Lớp ${tpEligibility.classCode} — Buổi ${tpEligibility.sessionNumber} đủ điều kiện gửi khảo sát Teacher Point.`;
      actionsEl.appendChild(
        createModalButton('⭐ Đi tới Teacher Point', 'btn btn-secondary btn-sm', () => {
          closeResultModal();
          switchTab('tab-teacher-point');
        })
      );
    } else {
      tpNoteEl.style.display = 'none';
    }

    actionsEl.appendChild(
      createModalButton('Ở lại trang này', 'btn btn-secondary btn-sm', () => {
        closeResultModal();
      })
    );
    actionsEl.appendChild(
      createModalButton('📚 Quay lại danh sách lớp', 'btn btn-primary-red btn-sm', () => {
        closeResultModal();
        switchTab('tab-classes');
      })
    );
  } else {
    const isAllFailed = savedCount === 0;
    iconEl.className = `result-modal-icon ${isAllFailed ? 'error' : 'warning'}`;
    iconEl.innerHTML = ICONS.alertTriangle(22);
    titleEl.textContent = isAllFailed ? 'Lưu nhận xét thất bại' : 'Lưu nhận xét chưa hoàn tất';
    descEl.textContent = 'Một số học viên chưa được lưu lên MindX LMS. Vui lòng kiểm tra và thử lại.';

    statsEl.style.display = 'flex';
    statsEl.innerHTML = `
      <span class="result-stat-ok">Thành công: ${savedCount}</span>
      <span class="result-stat-sep">|</span>
      <span class="result-stat-fail">Thất bại: ${failedCount}</span>
    `;

    tpNoteEl.style.display = 'none';

    if (failedStudents.length > 0) {
      errorsEl.style.display = 'flex';
      failedStudents.forEach(({ name, reason }) => {
        const item = document.createElement('div');
        item.className = 'result-error-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'result-error-name';
        nameSpan.textContent = name;
        item.appendChild(nameSpan);

        if (reason) {
          item.appendChild(document.createTextNode(` — ${reason}`));
        }
        errorsEl.appendChild(item);
      });
    } else {
      errorsEl.style.display = 'none';
    }

    actionsEl.appendChild(
      createModalButton('Quay lại danh sách lớp', 'btn btn-secondary btn-sm', () => {
        closeResultModal();
        switchTab('tab-classes');
      })
    );
    actionsEl.appendChild(
      createModalButton('Kiểm tra lại', 'btn btn-secondary btn-sm', () => {
        closeResultModal();
      })
    );
    actionsEl.appendChild(
      createModalButton('🔄 Thử lại các học viên lỗi', 'btn btn-primary-red btn-sm', async () => {
        closeResultModal();
        const retryIndices = reviewStudents
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => (s.attendance || '').toUpperCase() !== 'ABSENT' && s.comment && s.comment.trim() && s.saveStatus !== 'saved');
        if (retryIndices.length > 0) {
          await runBatchSave(retryIndices, { skipSummary: true });
        }
      })
    );
  }

  modal.style.display = 'flex';
}

async function runBatchSave(targetIndices, { skipSummary = false } = {}) {
  const btnFillAll = document.getElementById('btn-review-fill-all');
  if (!targetIndices || targetIndices.length === 0) {
    toast.warning('Không có học viên có mặt nào có nội dung nhận xét.');
    return;
  }

  isBatchCancelled = false;
  isBatchRunning = true;
  if (btnFillAll) {
    btnFillAll.disabled = true;
    btnFillAll.innerHTML = '⏳ Đang lưu lên LMS...';
  }

  const shouldSaveSummary = !skipSummary && Boolean(reviewSummary && reviewSummary.trim());
  const totalSteps = targetIndices.length + (shouldSaveSummary ? 1 : 0);
  let completedSteps = 0;

  try {
    // 1. Lưu Summary trước nếu có
    if (shouldSaveSummary) {
      updateProgressUI(true, 'Đang lưu Tóm tắt buổi học (Summary)...', Math.round((0.3 / totalSteps) * 100));
      const sumData = await apiRequest('/api/automation/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reviewSummary, forceOverwrite: true })
      });
      if (await handleSessionExpiredIfAny(sumData)) {
        updateProgressUI(false);
        return;
      }
      completedSteps++;
    }

    // 2. Lưu từng học viên có mặt và cập nhật icon trạng thái trực tiếp
    for (let k = 0; k < targetIndices.length; k++) {
      if (isBatchCancelled) {
        toast.warning('Đã dừng tiến trình lưu nhận xét.');
        break;
      }
      const { s, i } = targetIndices[k];
      s.saveStatus = 'saving';
      s.saveError = '';
      selectedStudentIndex = i;
      renderReviewUI();

      const pct = Math.min(99, Math.round((completedSteps / totalSteps) * 100));
      updateProgressUI(true, `Đang lưu học viên ${k + 1}/${targetIndices.length}: ${s.name}...`, pct);

      try {
        const data = await apiRequest('/api/automation/comment/single', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentName: s.name,
            commentText: s.comment,
            forceOverwrite: true
          })
        });
        if (await handleSessionExpiredIfAny(data)) {
          s.saveStatus = 'error';
          s.saveError = 'Phiên đăng nhập LMS đã hết hạn';
          renderReviewUI();
          updateProgressUI(false);
          return;
        }
        if (data.success && (data.status === 'VERIFIED' || data.status === 'SAVED_UNVERIFIED')) {
          s.saveStatus = 'saved';
          s.saveError = '';
        } else {
          s.saveStatus = 'error';
          s.saveError = data.message || data.error || 'Chưa lưu được nhận xét';
        }
      } catch (err) {
        s.saveStatus = 'error';
        s.saveError = err && err.message ? err.message : 'Lỗi kết nối';
      }

      completedSteps++;
      renderReviewUI();
    }

    if (!isBatchCancelled) {
      const allPresent = reviewStudents.filter(
        s => (s.attendance || '').toUpperCase() !== 'ABSENT' && s.comment && s.comment.trim()
      );
      const totalSaved = allPresent.filter(s => s.saveStatus === 'saved').length;
      const failedStudents = allPresent
        .filter(s => s.saveStatus !== 'saved')
        .map(s => ({ name: s.name, reason: s.saveError || '' }));

      updateProgressUI(true, `Hoàn tất ${totalSaved}/${allPresent.length} học viên!`, 100);

      if (failedStudents.length === 0) {
        toast.success(`Đã lưu thành công Summary và ${totalSaved}/${allPresent.length} nhận xét lên LMS.`, 5000);
      } else {
        toast.warning(`Hoàn tất: ${totalSaved} thành công, ${failedStudents.length} lỗi (bấm "Thử lại" tại học viên bị lỗi).`, 5000);
      }

      showResultModal({
        totalCount: allPresent.length,
        savedCount: totalSaved,
        failedStudents
      });
    }
  } finally {
    isBatchRunning = false;
    if (btnFillAll) {
      btnFillAll.disabled = false;
      btnFillAll.innerHTML = `${ICONS.send(16)} Lưu tất cả lên LMS`;
    }
  }
}

export function initReviewTab() {
  bindReviewEvents();
  bindResultModalEvents();
  renderReviewUI();
}

function updateProgressUI(visible, label = '', percent = 0) {
  const box = document.getElementById('review-progress-box');
  const labelEl = document.getElementById('review-progress-label');
  const pctEl = document.getElementById('review-progress-percent');
  const fillEl = document.getElementById('review-progress-fill');

  if (box) box.style.display = visible ? 'block' : 'none';
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = `${percent}%`;
  if (fillEl) fillEl.style.width = `${percent}%`;
}

function renderStatusBadge(st, idx) {
  if (st.saveStatus === 'saving') {
    return '<span class="tag tag-blue" style="font-size: 10.5px;">⏳ Đang lưu...</span>';
  }
  if (st.saveStatus === 'saved') {
    return '<span class="tag tag-green" style="font-size: 10.5px;">✓ Đã lưu</span>';
  }
  if (st.saveStatus === 'error') {
    return `<span class="tag tag-red" style="font-size: 10.5px;">✗ Lỗi</span>
      <button type="button" class="btn btn-secondary btn-xs btn-retry-single" data-idx="${idx}" style="padding: 1px 6px; font-size: 10.5px;">↻ Thử lại</button>`;
  }
  return '<span style="color: #94A3B8; font-size: 11px;">❯</span>';
}

function renderReviewUI() {
  const leftList = document.getElementById('review-students-left-list');
  const countBadge = document.getElementById('review-students-count-badge');
  const emptyRight = document.getElementById('review-empty-state-box');
  const contentRight = document.getElementById('review-active-content-box');

  if (countBadge) countBadge.textContent = `${reviewStudents.length} HS có mặt`;

  const hasComments = isAiStreaming || reviewStudents.some(s => s.comment && s.comment.trim());

  if (!hasComments) {
    if (leftList) {
      leftList.innerHTML = `
        <div style="text-align: center; padding: 40px 16px; color: #64748B;">
          <div style="color: #94A3B8; margin-bottom: 8px; display: flex; justify-content: center;">${ICONS.users(26)}</div>
          <div style="font-size: 13px;">Chưa có học viên có mặt nào có nhận xét để duyệt.</div>
        </div>
      `;
    }
    if (emptyRight) emptyRight.style.display = 'block';
    if (contentRight) contentRight.style.display = 'none';
    return;
  }

  if (emptyRight) emptyRight.style.display = 'none';
  if (contentRight) contentRight.style.display = 'block';

  // Render Cột trái: Chỉ hiển thị học viên Có mặt + trạng thái lưu trực tiếp
  if (leftList) {
    leftList.innerHTML = reviewStudents.map((st, idx) => {
      const isActive = idx === selectedStudentIndex;
      const snippet = st.comment ? (st.comment.substring(0, 45) + '...') : '(Chưa có nhận xét)';

      return `
        <div class="review-student-item ${isActive ? 'active' : ''}" data-idx="${idx}">
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 700; font-size: 13.5px; color: #0F172A; display: flex; align-items: center; gap: 6px;">
              <span>${escapeHtml(st.name)}</span>
            </div>
            <div style="font-size: 11.5px; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
              ${escapeHtml(snippet)}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
            ${renderStatusBadge(st, idx)}
          </div>
        </div>
      `;
    }).join('');

    leftList.querySelectorAll('.review-student-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.btn-retry-single')) return;
        if (isAiStreaming) userPickedStudentDuringStream = true;
        selectedStudentIndex = parseInt(item.getAttribute('data-idx'), 10);
        renderReviewUI();
      };
    });

    leftList.querySelectorAll('.btn-retry-single').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        await saveSingleStudentToLms(idx);
      };
    });
  }

  // Render Cột phải: Chi tiết học viên đang chọn
  const student = reviewStudents[selectedStudentIndex];
  if (student) {
    const nameEl = document.getElementById('review-current-student-name');
    const commentEditor = document.getElementById('review-current-student-comment');
    const ratingTag = document.getElementById('review-current-student-rating');

    if (nameEl) nameEl.textContent = `${student.name} (${student.attendance === 'PRESENT' ? 'Có mặt' : 'Vắng mặt'})`;
    if (commentEditor) commentEditor.value = student.comment || '';
    if (ratingTag) {
      const r = student.rating || 'Khá';
      ratingTag.textContent = r;
      if (r === 'Giỏi') ratingTag.className = 'tag tag-green';
      else if (r === 'Khá') ratingTag.className = 'tag tag-blue';
      else if (r === 'Yếu') ratingTag.className = 'tag tag-red';
      else ratingTag.className = 'tag tag-amber';
    }
  }
}

async function saveSingleStudentToLms(idx) {
  const student = reviewStudents[idx];
  if (!student || !student.comment || !student.comment.trim()) {
    toast.warning('Học viên chưa có nội dung nhận xét.');
    return false;
  }

  student.saveStatus = 'saving';
  selectedStudentIndex = idx;
  renderReviewUI();
  updateProgressUI(true, `Đang lưu nhận xét cho học viên: ${student.name}...`, 40);

  try {
    const data = await apiRequest('/api/automation/comment/single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName: student.name,
        commentText: student.comment,
        forceOverwrite: true
      })
    });
    if (await handleSessionExpiredIfAny(data)) {
      student.saveStatus = 'error';
      renderReviewUI();
      updateProgressUI(false);
      return false;
    }
    if (data.success && (data.status === 'VERIFIED' || data.status === 'SAVED_UNVERIFIED')) {
      student.saveStatus = 'saved';
      renderReviewUI();
      updateProgressUI(true, `Đã lưu thành công nhận xét cho ${student.name}!`, 100);
      toast.success(`Đã lưu và xác minh nhận xét cho "${student.name}" lên LMS.`);
      return true;
    }
    student.saveStatus = 'error';
    renderReviewUI();
    toast.warning(`Kết quả: ${data.message || data.error || 'Chưa lưu được'}`);
    return false;
  } catch (err) {
    student.saveStatus = 'error';
    renderReviewUI();
    toast.error(`Lỗi thực thi: ${err.message}`);
    return false;
  }
}

function bindReviewEvents() {
  const btnEmptyAi = document.getElementById('btn-review-empty-trigger-ai');
  if (btnEmptyAi) {
    btnEmptyAi.onclick = () => switchTab('tab-students');
  }

  // Lưu chỉnh sửa nhận xét & đồng bộ bản nháp
  const commentEditor = document.getElementById('review-current-student-comment');
  if (commentEditor) {
    commentEditor.addEventListener('input', () => {
      if (reviewStudents[selectedStudentIndex]) {
        reviewStudents[selectedStudentIndex].comment = commentEditor.value;
        saveCurrentDraft();
      }
    });
  }

  // Nút Nhập nhận xét bạn này
  const btnFillSingle = document.getElementById('btn-review-fill-single');
  if (btnFillSingle) {
    btnFillSingle.onclick = async () => {
      const student = reviewStudents[selectedStudentIndex];
      if (!student || !student.comment || !student.comment.trim()) {
        toast.warning('Học viên chưa có nội dung nhận xét.');
        return;
      }
      if ((student.attendance || '').toUpperCase() === 'ABSENT') {
        toast.warning(`Học viên "${student.name}" vắng mặt, hệ thống sẽ bỏ qua.`);
        return;
      }

      const ok = await showConfirm(`Xác nhận nhập và lưu nhận xét cho "${student.name}" lên MindX LMS?`, {
        title: 'Nhập nhận xét học viên',
        confirmText: 'Nhập lên LMS'
      });
      if (!ok) return;

      btnFillSingle.disabled = true;
      btnFillSingle.textContent = '⏳ Đang lưu lên LMS...';
      await saveSingleStudentToLms(selectedStudentIndex);
      btnFillSingle.disabled = false;
      btnFillSingle.textContent = 'Nhập nhận xét bạn này';
    };
  }

  // Nút Lưu tất cả lên LMS (Progress Bar trực quan + cập nhật icon từng học viên)
  const btnFillAll = document.getElementById('btn-review-fill-all');
  if (btnFillAll) {
    btnFillAll.onclick = async () => {
      const presentIndices = reviewStudents
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => (s.attendance || '').toUpperCase() !== 'ABSENT' && s.comment && s.comment.trim());

      if (presentIndices.length === 0) {
        toast.warning('Không có học viên có mặt nào có nội dung nhận xét.');
        return;
      }

      const ok = await showConfirm(
        `1. Lưu Tóm tắt buổi học (Summary) lên LMS.\n2. Lần lượt lưu và xác minh nhận xét cho ${presentIndices.length} học viên có mặt.`,
        {
          title: 'Xác nhận lưu tất cả lên LMS',
          confirmText: 'Lưu tất cả lên LMS'
        }
      );
      if (!ok) return;

      await runBatchSave(presentIndices, { skipSummary: false });
    };
  }

  // Nút Tạo lại nhận xét AI theo cấu hình phong cách mới nhất
  const btnRegenerateAi = document.getElementById('btn-review-regenerate-ai');
  if (btnRegenerateAi) {
    btnRegenerateAi.onclick = async () => {
      await runReviewAiStreaming();
    };
  }

  // Nút Dừng / Hủy
  const btnCancelAuto = document.getElementById('btn-review-cancel-auto');
  if (btnCancelAuto) {
    btnCancelAuto.onclick = async () => {
      isBatchCancelled = true;
      await apiRequest('/api/automation/cancel', { method: 'POST' });
      toast.info('Đã gửi lệnh dừng tiến trình.');
    };
  }
}

function setStreamingButtonsState(streaming) {
  const btnRegenerateAi = document.getElementById('btn-review-regenerate-ai');
  const btnFillAll = document.getElementById('btn-review-fill-all');
  const btnFillSingle = document.getElementById('btn-review-fill-single');

  if (btnFillAll) btnFillAll.disabled = streaming;
  if (btnFillSingle) btnFillSingle.disabled = streaming;
  if (btnRegenerateAi) {
    btnRegenerateAi.disabled = streaming;
    if (!streaming) {
      btnRegenerateAi.innerHTML = `${ICONS.sparkles(14)} ✨ Tạo lại nhận xét AI`;
    }
  }
}

export async function runReviewAiStreaming({ cls = reviewClass, session = reviewSession, summary = reviewSummary, students = null } = {}) {
  if (isBatchRunning) {
    toast.warning('Đang có tiến trình lưu nhận xét chạy, vui lòng chờ hoàn tất.');
    return false;
  }
  if (isAiStreaming) {
    toast.warning('AI đang tạo nhận xét, vui lòng chờ giây lát.');
    return false;
  }

  if (students !== null) {
    reviewClass = cls;
    reviewSession = session;
    reviewSummary = summary || '';
    const all = Array.isArray(students) ? students : [];
    reviewStudents = all.filter(s => (s.attendance || s.attendanceStatus || 'PRESENT').toUpperCase() !== 'ABSENT');
    selectedStudentIndex = 0;
  }

  if (reviewStudents.length === 0) {
    renderReviewUI();
    return true;
  }

  const geminiConfig = getGeminiConfig();
  if (!geminiConfig.key) {
    toast.error('Chưa cấu hình Gemini API Key. Vui lòng vào tab Cấu hình để nhập API Key.', 6000);
    return false;
  }

  const styleConfig = await loadCommentStyleConfig();
  const styleSig = getStyleSignature(styleConfig);
  const classCode = getReviewClassCode();

  isAiStreaming = true;
  userPickedStudentDuringStream = false;
  reviewStudents.forEach((st) => {
    st.comment = '';
    if (st.saveStatus === 'saved' || st.saveStatus === 'error') {
      st.saveStatus = '';
      st.saveError = '';
    }
  });

  renderReviewUI();
  setStreamingButtonsState(true);

  const btnRegenerateAi = document.getElementById('btn-review-regenerate-ai');
  if (btnRegenerateAi) {
    btnRegenerateAi.innerHTML = `${ICONS.loader(14)} AI đang viết (1/${reviewStudents.length})...`;
  }

  try {
    const data = await apiRequest('/api/gemini/batch-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      onProgress: ({ current, total }) => {
        if (btnRegenerateAi) {
          btnRegenerateAi.innerHTML = `${ICONS.loader(14)} AI đang viết (${current}/${total})...`;
        }
      },
      onStream: ({ batchId, comment }) => {
        const targetIdx = typeof batchId === 'number' && reviewStudents[batchId] ? batchId : -1;
        if (targetIdx < 0) return;

        reviewStudents[targetIdx].comment = comment;
        if (!userPickedStudentDuringStream && selectedStudentIndex !== targetIdx) {
          selectedStudentIndex = targetIdx;
        }

        // Update active textarea & left list snippet smoothly
        if (selectedStudentIndex === targetIdx) {
          const nameEl = document.getElementById('review-current-student-name');
          const commentEditor = document.getElementById('review-current-student-comment');
          if (nameEl) nameEl.textContent = `${reviewStudents[targetIdx].name} (Có mặt)`;
          if (commentEditor) {
            commentEditor.value = comment;
            commentEditor.scrollTop = commentEditor.scrollHeight;
          }
        }

        const leftItem = document.querySelector(`.review-student-item[data-idx="${targetIdx}"]`);
        if (leftItem) {
          const snippetEl = leftItem.querySelector('div > div:nth-child(2)');
          if (snippetEl) {
            snippetEl.textContent = comment ? `${comment.substring(0, 45)}...` : '⏳ AI đang viết...';
          }
          if (!userPickedStudentDuringStream) {
            document.querySelectorAll('.review-student-item').forEach((el, idx) => {
              el.classList.toggle('active', idx === selectedStudentIndex);
            });
          }
        }
      },
      body: JSON.stringify({
        students: reviewStudents.map((st, i) => ({
          ...st,
          studentIndex: i
        })),
        lessonData: {
          classCode,
          title: reviewSession ? reviewSession.title : 'Buổi học',
          sessionNumber: reviewSession ? reviewSession.sessionNumber : 1,
          summary: reviewSummary
        },
        apiKey: geminiConfig.key,
        model: geminiConfig.model,
        styleConfig
      })
    });

    if (!data.success || !Array.isArray(data.results)) {
      toast.error(`Không thể gọi Gemini AI: ${data.error || 'Lỗi không xác định khi tạo nhận xét.'}`, 7000);
      return false;
    }

    data.results.forEach((item, idx) => {
      const st = reviewStudents[idx] || reviewStudents.find(x => x.name === item.name);
      if (st && item.comment) {
        st.comment = item.comment;
        st.generatedStyleSignature = styleSig;
        st._lastCommentSignature = `${st.rating || 'Khá'}|${st.note || ''}|${styleSig}`;
      }
    });
    saveCurrentDraft();
    toast.success(`Đã tạo xong nhận xét AI cho ${reviewStudents.length} học viên.`);
    return true;
  } catch (err) {
    toast.error(`Lỗi gọi Gemini AI: ${err.message}`, 7000);
    return false;
  } finally {
    isAiStreaming = false;
    setStreamingButtonsState(false);
    renderReviewUI();
  }
}
