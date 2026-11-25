/**
 * Page 4: Duyệt & Lưu nhận xét LMS (Review Tab Controller)
 * Hiển thị 2 cột rà soát nhận xét, thanh tiến trình trực quan và lưu lên MindX LMS.
 */

import { switchTab } from '../main.js';
import { toast, showConfirm } from '../services/toast.js';
import { handleSessionExpiredIfAny } from '../services/sessionGuard.js';
import { saveCurrentDraft } from './students.js';

let reviewClass = null;
let reviewSession = null;
let reviewSummary = '';
let reviewStudents = [];
let selectedStudentIndex = 0;
let isBatchCancelled = false;

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

export function initReviewTab() {
  bindReviewEvents();
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

  const hasComments = reviewStudents.some(s => s.comment && s.comment.trim());

  if (!hasComments) {
    if (leftList) {
      leftList.innerHTML = `
        <div style="text-align: center; padding: 40px 16px; color: #64748B;">
          <div style="font-size: 24px; margin-bottom: 6px;">👥</div>
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
    const res = await fetch('/api/automation/comment/single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentName: student.name,
        commentText: student.comment,
        forceOverwrite: true
      })
    });
    const data = await res.json();
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

      isBatchCancelled = false;
      btnFillAll.disabled = true;
      btnFillAll.innerHTML = '⏳ Đang lưu lên LMS...';

      const totalSteps = presentIndices.length + (reviewSummary && reviewSummary.trim() ? 1 : 0);
      let completedSteps = 0;
      let savedCount = 0;
      let failedCount = 0;

      try {
        // 1. Lưu Summary trước nếu có
        if (reviewSummary && reviewSummary.trim()) {
          updateProgressUI(true, 'Đang lưu Tóm tắt buổi học (Summary)...', Math.round((0.3 / totalSteps) * 100));
          const sumRes = await fetch('/api/automation/summary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: reviewSummary, forceOverwrite: true })
          });
          const sumData = await sumRes.json();
          if (await handleSessionExpiredIfAny(sumData)) {
            updateProgressUI(false);
            return;
          }
          completedSteps++;
        }

        // 2. Lưu từng học viên có mặt và cập nhật icon trạng thái trực tiếp
        for (let k = 0; k < presentIndices.length; k++) {
          if (isBatchCancelled) {
            toast.warning('Đã dừng tiến trình lưu nhận xét.');
            break;
          }
          const { s, i } = presentIndices[k];
          s.saveStatus = 'saving';
          selectedStudentIndex = i;
          renderReviewUI();

          const pct = Math.min(99, Math.round((completedSteps / totalSteps) * 100));
          updateProgressUI(true, `Đang lưu học viên ${k + 1}/${presentIndices.length}: ${s.name}...`, pct);

          try {
            const res = await fetch('/api/automation/comment/single', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                studentName: s.name,
                commentText: s.comment,
                forceOverwrite: true
              })
            });
            const data = await res.json();
            if (await handleSessionExpiredIfAny(data)) {
              s.saveStatus = 'error';
              renderReviewUI();
              updateProgressUI(false);
              return;
            }
            if (data.success && (data.status === 'VERIFIED' || data.status === 'SAVED_UNVERIFIED')) {
              s.saveStatus = 'saved';
              savedCount++;
            } else {
              s.saveStatus = 'error';
              failedCount++;
            }
          } catch (_) {
            s.saveStatus = 'error';
            failedCount++;
          }

          completedSteps++;
          renderReviewUI();
        }

        if (!isBatchCancelled) {
          updateProgressUI(true, `Hoàn tất ${savedCount}/${presentIndices.length} học viên!`, 100);
          if (failedCount === 0) {
            toast.success(`Đã lưu thành công Summary và ${savedCount}/${presentIndices.length} nhận xét lên LMS.`, 5000);
          } else {
            toast.warning(`Hoàn tất: ${savedCount} thành công, ${failedCount} lỗi (bấm "Thử lại" tại học viên bị lỗi).`, 5000);
          }
        }
      } finally {
        btnFillAll.disabled = false;
        btnFillAll.innerHTML = '🚀 Lưu tất cả lên LMS';
      }
    };
  }

  // Nút Dừng / Hủy
  const btnCancelAuto = document.getElementById('btn-review-cancel-auto');
  if (btnCancelAuto) {
    btnCancelAuto.onclick = async () => {
      isBatchCancelled = true;
      await fetch('/api/automation/cancel', { method: 'POST' });
      toast.info('Đã gửi lệnh dừng tiến trình.');
    };
  }
}
