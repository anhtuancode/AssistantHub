/**
 * Page 3: Học viên & Ghi chú (Students Tab Controller)
 * Quản lý thông tin lớp, tạo Summary bằng AI, danh sách học viên và sinh nhận xét.
 */

import { switchTab } from '../main.js';
import { setReviewData, runReviewAiStreaming } from './review.js';
import { getGeminiConfig } from './config.js';
import { curriculumService } from '../services/curriculum.js';
import { toast } from '../services/toast.js';
import { handleSessionExpiredIfAny } from '../services/sessionGuard.js';
import { setTeacherPointContext } from './teacherPoint.js';
import { ICONS } from '../services/icons.js';
import { apiRequest } from '../services/apiBridge.js';
import {
  COMMENT_PRESETS,
  CUSTOM_CRITERIA_TEMPLATES,
  DEFAULT_COMMENT_STYLE_CONFIG,
  loadCommentStyleConfig,
  saveCommentStyleConfig,
  formatStyleSummaryLabel,
  getStyleSignature
} from '../config/commentStyles.js';

let currentClass = null;
let currentSession = null;
let currentStudents = [];
let currentSummary = '';
let isRestoredDraft = false;
let currentDraftStatus = null; // 'draft' | 'saved' | null
let currentSavedAt = null;
let currentStyleConfig = { ...DEFAULT_COMMENT_STYLE_CONFIG };
let isQuickStyleBound = false;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function getDraftKey(cls = currentClass, sess = currentSession) {
  if (!cls || !sess) return null;
  const code = cls.classCode || cls.code || cls.classId || cls.id || 'unknown';
  return `mindx_session_draft_${code}_${sess.sessionNumber}`;
}

function getStudentStatusKey(student, idx) {
  return String((student && (student.id || student.studentId || student.name)) || idx);
}

function buildStudentStatusesMap(students = currentStudents) {
  const map = {};
  (students || []).forEach((s, idx) => {
    const k = getStudentStatusKey(s, idx);
    if (s.saveStatus === 'saved') map[k] = 'saved';
    else if (s.saveStatus === 'error') map[k] = 'error';
    else map[k] = 'pending';
  });
  return map;
}

function formatSavedAtLabel(ts) {
  if (!ts) return '✓ Đã lưu lên LMS';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const isSameDay = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (isSameDay) {
    return `✓ Đã lưu lên LMS lúc ${timeStr}`;
  }
  return `✓ Đã lưu lên LMS lúc ${timeStr} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function saveCurrentDraft(options = {}) {
  const key = getDraftKey();
  if (!key) return;
  try {
    const summaryBox = document.getElementById('students-summary-editor');
    const summaryVal = summaryBox ? summaryBox.value : currentSummary;
    const nextStatus = options.status || 'draft';
    if (nextStatus === 'saved') {
      currentDraftStatus = 'saved';
      currentSavedAt = options.savedAt || Date.now();
    } else {
      currentDraftStatus = 'draft';
    }
    const payload = {
      status: currentDraftStatus,
      savedAt: currentDraftStatus === 'saved' ? currentSavedAt : (currentSavedAt || null),
      updatedAt: Date.now(),
      studentStatuses: buildStudentStatusesMap(currentStudents),
      summary: summaryVal,
      students: currentStudents
    };
    localStorage.setItem(key, JSON.stringify(payload));
    localStorage.setItem('mindx_last_active_workspace', JSON.stringify({ cls: currentClass, session: currentSession }));
    updateDraftBannerUI(true, currentDraftStatus === 'draft' && !options.isRestored ? 'Có thay đổi chưa lưu' : null);
  } catch (_) {}
}

export function markSessionSavedToLms(studentsList = null) {
  if (Array.isArray(studentsList) && studentsList.length > 0) {
    currentStudents = studentsList;
  }
  saveCurrentDraft({ status: 'saved', savedAt: Date.now() });
}

export function syncStudentStatusesToDraft(studentsList = null) {
  if (Array.isArray(studentsList) && studentsList.length > 0) {
    currentStudents = studentsList;
  }
  const key = getDraftKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    const existing = raw ? JSON.parse(raw) : {};
    const statusToKeep = existing.status || currentDraftStatus || 'draft';
    const payload = {
      ...existing,
      status: statusToKeep,
      savedAt: existing.savedAt || currentSavedAt || null,
      updatedAt: Date.now(),
      studentStatuses: buildStudentStatusesMap(currentStudents),
      summary: currentSummary,
      students: currentStudents
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (_) {}
}

export function cleanupExpiredSessionDrafts() {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const now = Date.now();
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || (!k.startsWith('mindx_session_draft_') && !k.startsWith('draft_'))) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const ts = Number((parsed && (parsed.savedAt || parsed.updatedAt)) || 0);
        if (ts > 0 && (now - ts) > SEVEN_DAYS_MS) {
          keysToRemove.push(k);
        }
      } catch (_) {}
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    return keysToRemove.length;
  } catch (_) {
    return 0;
  }
}

function updateDraftBannerUI(visible, customDraftLabel = null) {
  isRestoredDraft = Boolean(visible);
  const badge = document.getElementById('students-draft-badge');
  const resetBtn = document.getElementById('btn-reset-draft-from-lms');
  if (badge) {
    if (!visible) {
      badge.style.display = 'none';
    } else if (currentDraftStatus === 'saved') {
      badge.className = 'tag tag-green';
      badge.textContent = formatSavedAtLabel(currentSavedAt);
      badge.style.display = 'inline-block';
    } else {
      badge.className = 'tag tag-amber';
      badge.textContent = customDraftLabel || 'Đã khôi phục bản nháp';
      badge.style.display = 'inline-block';
    }
  }
  if (resetBtn) resetBtn.style.display = visible ? 'inline-flex' : 'none';
}

function tryRestoreDraftIfExists() {
  const key = getDraftKey();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.students)) return false;

    const summaryBox = document.getElementById('students-summary-editor');
    if (typeof draft.summary === 'string') {
      currentSummary = draft.summary;
      if (summaryBox) summaryBox.value = draft.summary;
    }
    if (draft.students.length > 0) {
      const statusMap = draft.studentStatuses && typeof draft.studentStatuses === 'object' ? draft.studentStatuses : {};
      currentStudents = draft.students.map((s, idx) => {
        const stKey = getStudentStatusKey(s, idx);
        const mappedStatus = statusMap[stKey];
        if (!s.saveStatus && mappedStatus && mappedStatus !== 'pending') {
          return { ...s, saveStatus: mappedStatus };
        }
        return s;
      });
    }
    currentDraftStatus = draft.status === 'saved' ? 'saved' : 'draft';
    currentSavedAt = draft.savedAt || null;
    updateDraftBannerUI(true);
    renderStudentsTable();
    return true;
  } catch (_) {
    return false;
  }
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

export function resetStudentsWorkspace() {
  currentClass = null;
  currentSession = null;
  currentStudents = [];
  currentSummary = '';
  const summaryBox = document.getElementById('students-summary-editor');
  if (summaryBox) summaryBox.value = '';
  updateHeaderInfo();
  renderStudentsTable();
}

export function setSelectedClassAndSession(cls, session) {
  currentClass = cls;
  currentSession = session;
  currentStudents = [];
  currentSummary = '';
  const summaryBox = document.getElementById('students-summary-editor');
  if (summaryBox) summaryBox.value = '';
  setTeacherPointContext(cls, session, []);
  updateHeaderInfo();
  loadSessionDataFromLms();
}

async function loadSessionDataFromLms() {
  const tbody = document.getElementById('students-table-body');
  const countBadge = document.getElementById('students-count-header');
  const summaryBox = document.getElementById('students-summary-editor');

  // Reset sạch state của buổi cũ trước khi tải buổi mới
  currentSummary = '';
  currentStudents = [];
  currentDraftStatus = null;
  currentSavedAt = null;
  if (summaryBox) summaryBox.value = '';
  updateDraftBannerUI(false);

  if (currentSession && currentSession.isAvailable === false) {
    const msg = 'Buổi học này chưa diễn ra nên chưa có dữ liệu điểm danh và danh sách học viên.';
    currentStudents = [];
    if (countBadge) countBadge.textContent = '0';
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 30px; color: #B45309; background: #FFFBEB;">
            <span style="display: inline-flex; align-items: center; gap: 6px;">${ICONS.alertTriangle(16)} ${escapeHtml(msg)}</span>
          </td>
        </tr>
      `;
    }
    return;
  }

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 30px; color: #64748B;">
          <span style="display: inline-flex; align-items: center; gap: 8px;">${ICONS.loader(16)} Đang chọn Buổi ${currentSession ? currentSession.sessionNumber : ''} trên LMS và tải dữ liệu...</span>
        </td>
      </tr>
    `;
  }

  try {
    // 1. BẮT BUỘC chạy SELECT_SESSION & VERIFY_SESSION_ACTIVE trước khi LOAD_SUMMARY và LOAD_STUDENTS
    if (currentSession && currentSession.sessionNumber) {
      const selData = await apiRequest('/api/automation/sessions/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionNumber: currentSession.sessionNumber })
      });
      if (!selData.success) {
        if (await handleSessionExpiredIfAny(selData)) return;
        const errMsg = selData.message || selData.error || 'Không thể chọn buổi học trên LMS.';
        currentStudents = [];
        if (countBadge) countBadge.textContent = '0';
        if (tbody) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" style="text-align: center; padding: 30px; color: #B91C1C; background: #FEF2F2;">
                <span style="display: inline-flex; align-items: center; gap: 6px;">${ICONS.alertTriangle(16)} ${escapeHtml(errMsg)}</span>
              </td>
            </tr>
          `;
        }
        return;
      }
    }

    // 2. LOAD_SUMMARY từ LMS
    try {
      const sumData = await apiRequest('/api/automation/summary');
      if (sumData.success && sumData.summary && summaryBox) {
        summaryBox.value = sumData.summary;
        currentSummary = sumData.summary;
      } else {
        await loadDefaultSummaryForSession();
      }
    } catch (_) {
      await loadDefaultSummaryForSession();
    }

    // 3. LOAD_STUDENTS từ LMS
    await loadStudentsForSession();

    // 4. Kiểm tra và khôi phục bản nháp nếu có (chống mất dữ liệu khi F5)
    tryRestoreDraftIfExists();
  } catch (err) {
    console.warn('[Students] Lỗi quy trình SELECT_SESSION -> LOAD_STUDENTS:', err);
  }
}

export async function initStudentsTab() {
  bindStudentsEvents();
  currentStyleConfig = await loadCommentStyleConfig();
  renderStudentsQuickStyleUI();
  bindStudentsQuickStyleEvents();
  if (!currentClass || !currentSession) {
    try {
      const lastRaw = localStorage.getItem('mindx_last_active_workspace');
      if (lastRaw) {
        const parsed = JSON.parse(lastRaw);
        if (parsed && parsed.cls && parsed.session) {
          currentClass = parsed.cls;
          currentSession = parsed.session;
          tryRestoreDraftIfExists();
        }
      }
    } catch (_) {}
  }
  updateHeaderInfo();
}

function updateHeaderInfo() {
  const pill = document.getElementById('students-selected-pill');
  const desc = document.getElementById('students-selected-desc');

  if (currentClass && currentSession) {
    if (pill) {
      pill.textContent = `${currentClass.title.split('—')[0].trim()} — ${currentSession.title || `Buổi ${currentSession.sessionNumber}`}`;
      pill.className = 'tag tag-blue';
    }
    if (desc) {
      desc.textContent = `Lớp: ${currentClass.title} | ${currentSession.subtext || 'Đang thực hiện tự động hóa'}`;
    }
  } else {
    if (pill) {
      pill.textContent = 'Chưa chọn buổi học';
      pill.className = 'tag tag-gray';
    }
    if (desc) {
      desc.textContent = 'Chọn lớp và buổi học ở bước trước để tải danh sách học viên.';
    }
  }
}

async function loadDefaultSummaryForSession() {
  if (!currentClass || !currentSession) return;
  const summaryBox = document.getElementById('students-summary-editor');
  if (!summaryBox || summaryBox.value.trim()) return;

  const classCode = currentClass.classCode || currentClass.code || currentClass.title || '';
  const sessionParam = currentSession.sessionNumber || currentSession.title || '';
  if (!classCode || !sessionParam) return;

  try {
    const params = new URLSearchParams({
      classCode,
      session: String(sessionParam)
    });
    const result = await apiRequest(`/api/curriculum/session-summary?${params.toString()}`);

    if (result.success && result.data && result.data.formattedSummary && !summaryBox.value.trim()) {
      summaryBox.value = result.data.formattedSummary;
      currentSummary = result.data.formattedSummary;
    }
  } catch (err) {
    console.warn('[Students] Lỗi tải tóm tắt giáo trình từ API:', err.message);
  }
}

async function loadStudentsForSession() {
  const tbody = document.getElementById('students-table-body');
  const countBadge = document.getElementById('students-count-header');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 30px; color: #64748B;">
          ⏳ Đang quét danh sách học viên từ LMS...
        </td>
      </tr>
    `;
  }

  try {
    const data = await apiRequest('/api/automation/students');

    if (data.success && Array.isArray(data.students) && data.students.length > 0) {
      currentStudents = data.students.map((s, idx) => {
        const rawAtt = (s.attendanceStatus || s.attendance || 'ATTENDED').toUpperCase();
        const normalizedAtt = rawAtt === 'ABSENT' ? 'ABSENT' : 'PRESENT';
        return {
          id: s.id || `st-${idx}`,
          name: s.studentName || s.name,
          attendance: normalizedAtt,
          attendanceLabel: s.attendanceLabel || '',
          canComment: s.canComment !== false && normalizedAtt !== 'ABSENT',
          rating: 'Khá',
          note: '',
          comment: ''
        };
      });
    } else if (data.success && Array.isArray(data.students)) {
      currentStudents = [];
    } else {
      currentStudents = generateMockStudents();
    }
  } catch (err) {
    console.warn('[Students] Lỗi nạp học viên, dùng danh sách dự phòng:', err);
    currentStudents = generateMockStudents();
  }

  if (countBadge) countBadge.textContent = currentStudents.length;
  setTeacherPointContext(currentClass, currentSession, currentStudents);
  renderStudentsTable();
}

function generateMockStudents() {
  const names = ['Nguyễn Hoàng Nam', 'Trần Bảo Anh', 'Lê Minh Khôi', 'Phạm Gia Huy', 'Đặng Tuấn Kiệt', 'Vũ Thảo Nguyên'];
  return names.map((name, idx) => ({
    id: `mock-${idx + 1}`,
    name,
    attendance: idx === 4 ? 'ABSENT' : 'PRESENT',
    rating: idx === 0 ? 'Giỏi' : (idx === 3 ? 'Trung bình khá' : 'Khá'),
    note: idx === 0 ? 'Hoàn thành bài tập rất nhanh' : '',
    comment: ''
  }));
}

const QUICK_NOTE_TAGS = [
  { label: 'Tập trung tốt', type: 'strength' },
  { label: 'Chủ động phát biểu', type: 'strength' },
  { label: 'Hoàn thành bài nhanh', type: 'strength' },
  { label: 'Tư duy logic tốt', type: 'strength' },
  { label: 'Hỗ trợ bạn tốt', type: 'strength' },
  { label: 'Sáng tạo', type: 'strength' },
  { label: 'Cần tập trung hơn', type: 'improve' },
  { label: 'Cần cẩn thận hơn', type: 'improve' },
  { label: 'Còn hơi rụt rè', type: 'improve' },
  { label: 'Cần luyện thêm ở nhà', type: 'improve' },
  { label: 'Cần đọc kỹ đề', type: 'improve' }
];

function parseNoteTokens(noteStr) {
  return String(noteStr || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function toggleQuickTagInNote(currentNote, tagLabel) {
  const tokens = parseNoteTokens(currentNote);
  const idx = tokens.findIndex(t => t.toLowerCase() === tagLabel.toLowerCase());
  if (idx >= 0) {
    tokens.splice(idx, 1);
  } else {
    tokens.push(tagLabel);
  }
  return tokens.join(', ');
}

function renderStudentsTable() {
  const tbody = document.getElementById('students-table-body');
  const countBadge = document.getElementById('students-count-header');
  if (!tbody) return;

  if (countBadge) countBadge.textContent = currentStudents.length;

  if (currentStudents.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 40px; color: #64748B;">
          <div style="color: #94A3B8; margin-bottom: 8px; display: flex; justify-content: center;">${ICONS.users(28)}</div>
          <div>Chưa có học viên. Hãy chọn lớp và buổi học để tải dữ liệu.</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = currentStudents.map((st, idx) => {
    const isPresent = st.attendance === 'PRESENT';
    const isAbsent = !isPresent;
    const noteTokens = parseNoteTokens(st.note).map(t => t.toLowerCase());
    const disabledAttr = isAbsent ? 'disabled' : '';
    const disabledStyle = isAbsent ? 'opacity: 0.5; cursor: not-allowed; background-color: #F1F5F9;' : '';

    const chipsHtml = isAbsent ? '' : `
      <div class="quick-note-chips" data-idx="${idx}">
        ${QUICK_NOTE_TAGS.map(tag => {
          const isActive = noteTokens.includes(tag.label.toLowerCase());
          const typeCls = tag.type === 'improve' ? 'chip-improve' : '';
          return `<button type="button" class="quick-note-chip ${typeCls} ${isActive ? 'active' : ''}" data-idx="${idx}" data-tag="${escapeHtml(tag.label)}">${escapeHtml(tag.label)}</button>`;
        }).join('')}
      </div>
    `;

    return `
      <tr data-student-idx="${idx}" class="${isAbsent ? 'student-row-absent' : ''}">
        <td style="font-weight: 600; color: #64748B;">${idx + 1}</td>
        <td style="font-weight: 700; color: ${isAbsent ? '#94A3B8' : '#0F172A'};">
          ${escapeHtml(st.name)}
          ${isAbsent ? '<span class="tag tag-red" style="font-size: 10px; padding: 1px 6px; margin-left: 6px;">Vắng</span>' : ''}
        </td>
        <td>
          <select class="form-control st-attendance-select" data-idx="${idx}" style="font-size: 12px; padding: 5px 8px; width: 110px; ${isAbsent ? 'border-color: #FCA5A5; color: #DC2626; background: #FEF2F2; font-weight: 600;' : ''}">
            <option value="PRESENT" ${isPresent ? 'selected' : ''}>Có mặt</option>
            <option value="ABSENT" ${isAbsent ? 'selected' : ''}>Vắng mặt</option>
          </select>
        </td>
        <td>
          <select class="form-control st-rating-select" data-idx="${idx}" ${disabledAttr} style="font-size: 12px; padding: 5px 8px; width: 135px; ${disabledStyle}">
            <option value="Giỏi" ${st.rating === 'Giỏi' ? 'selected' : ''}>Giỏi</option>
            <option value="Khá" ${!st.rating || st.rating === 'Khá' ? 'selected' : ''}>Khá</option>
            <option value="Trung bình khá" ${st.rating === 'Trung bình khá' ? 'selected' : ''}>Trung bình khá</option>
            <option value="Trung bình" ${st.rating === 'Trung bình' ? 'selected' : ''}>Trung bình</option>
            <option value="Yếu" ${st.rating === 'Yếu' ? 'selected' : ''}>Yếu</option>
          </select>
        </td>
        <td>
          <input type="text" class="form-control st-note-input" data-idx="${idx}" value="${escapeHtml(st.note || '')}" ${disabledAttr} placeholder="${isAbsent ? 'Học viên vắng mặt' : 'Điểm mạnh / điểm cần sửa...'}" style="font-size: 12.5px; padding: 5px 10px; ${disabledStyle}">
          ${chipsHtml}
        </td>
        <td style="white-space: nowrap;">
          <button type="button" class="btn btn-secondary btn-xs btn-gen-single-comment" data-idx="${idx}" ${disabledAttr} style="${isAbsent ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
            ${ICONS.sparkles(13)} Tạo nhận xét
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Gắn sự kiện thay đổi điểm danh -> re-render ngay để khóa/mở khóa hàng + lưu nháp
  tbody.querySelectorAll('.st-attendance-select').forEach(sel => {
    sel.onchange = () => {
      const idx = parseInt(sel.getAttribute('data-idx'), 10);
      currentStudents[idx].attendance = sel.value;
      saveCurrentDraft();
      renderStudentsTable();
    };
  });

  tbody.querySelectorAll('.st-rating-select').forEach(sel => {
    sel.onchange = () => {
      const idx = parseInt(sel.getAttribute('data-idx'), 10);
      currentStudents[idx].rating = sel.value;
      saveCurrentDraft();
    };
  });

  tbody.querySelectorAll('.st-note-input').forEach(inp => {
    inp.oninput = () => {
      const idx = parseInt(inp.getAttribute('data-idx'), 10);
      currentStudents[idx].note = inp.value;
      saveCurrentDraft();
      const tokens = parseNoteTokens(inp.value).map(t => t.toLowerCase());
      const chipContainer = tbody.querySelector(`.quick-note-chips[data-idx="${idx}"]`);
      if (chipContainer) {
        chipContainer.querySelectorAll('.quick-note-chip').forEach(chip => {
          const tag = (chip.getAttribute('data-tag') || '').toLowerCase();
          chip.classList.toggle('active', tokens.includes(tag));
        });
      }
    };
  });

  // Quick note chips click handler
  tbody.querySelectorAll('.quick-note-chip').forEach(chip => {
    chip.onclick = () => {
      const idx = parseInt(chip.getAttribute('data-idx'), 10);
      const tagLabel = chip.getAttribute('data-tag');
      if (!currentStudents[idx] || currentStudents[idx].attendance === 'ABSENT') return;

      const updatedNote = toggleQuickTagInNote(currentStudents[idx].note, tagLabel);
      currentStudents[idx].note = updatedNote;
      saveCurrentDraft();

      const inp = tbody.querySelector(`.st-note-input[data-idx="${idx}"]`);
      if (inp) inp.value = updatedNote;

      const tokens = parseNoteTokens(updatedNote).map(t => t.toLowerCase());
      const chipContainer = tbody.querySelector(`.quick-note-chips[data-idx="${idx}"]`);
      if (chipContainer) {
        chipContainer.querySelectorAll('.quick-note-chip').forEach(c => {
          const t = (c.getAttribute('data-tag') || '').toLowerCase();
          c.classList.toggle('active', tokens.includes(t));
        });
      }
    };
  });

  // Tạo nhận xét cho từng bạn
  tbody.querySelectorAll('.btn-gen-single-comment').forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.getAttribute('data-idx'), 10);
      const student = currentStudents[idx];

      if (student.attendance === 'ABSENT') {
        toast.warning(`Học viên "${student.name}" vắng mặt, không thể tạo nhận xét.`);
        return;
      }

      const geminiConfig = getGeminiConfig();
      if (!geminiConfig.key) {
        toast.error('Chưa cấu hình API Key AI. Vui lòng vào tab Cấu hình để nhập API Key.');
        return;
      }

      btn.disabled = true;
      btn.textContent = '⏳ Đang tạo...';

      currentStyleConfig = await loadCommentStyleConfig();
      const styleSig = getStyleSignature(currentStyleConfig);
      const summaryBox = document.getElementById('students-summary-editor');
      const classCode = currentClass ? (currentClass.classCode || currentClass.code || (currentClass.title ? currentClass.title.split('—')[0].trim() : '')) : '';
      const summaryText = summaryBox ? summaryBox.value.trim() : currentSummary;
      try {
        const data = await apiRequest('/api/gemini/comment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student: { ...student, studentIndex: idx },
            lessonData: {
              classCode,
              title: currentSession ? currentSession.title : 'Buổi học',
              sessionNumber: currentSession ? currentSession.sessionNumber : 1,
              summary: summaryText
            },
            provider: geminiConfig.provider,
            apiKey: geminiConfig.key,
            model: geminiConfig.model,
            styleConfig: currentStyleConfig
          })
        });
        if (data.success && data.comment) {
          student.comment = data.comment;
          student.generatedStyleSignature = styleSig;
          student._lastCommentSignature = `${student.rating}|${student.note || ''}|${styleSig}`;
          saveCurrentDraft();
          toast.success(`Đã tạo nhận xét AI cho ${student.name}.`);
        } else {
          toast.error(`Không thể tạo nhận xét AI: ${data.error || 'Gemini API không trả về kết quả.'}`, 6000);
        }
      } catch (err) {
        toast.error(`Lỗi tạo nhận xét: ${err.message}`, 6000);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${ICONS.sparkles(13)} Tạo nhận xét`;
      }
    };
  });
}

function bindStudentsEvents() {
  // Nút Đặt lại dữ liệu gốc từ LMS (xóa bản nháp)
  const btnResetDraft = document.getElementById('btn-reset-draft-from-lms');
  if (btnResetDraft) {
    btnResetDraft.onclick = async () => {
      const key = getDraftKey();
      if (key) localStorage.removeItem(key);
      updateDraftBannerUI(false);
      await loadSessionDataFromLms();
      toast.info('Đã khôi phục dữ liệu gốc từ MindX LMS.');
    };
  }

  // Tự động lưu nháp khi chỉnh sửa ô Summary
  const summaryEditorEl = document.getElementById('students-summary-editor');
  if (summaryEditorEl) {
    summaryEditorEl.addEventListener('input', () => {
      currentSummary = summaryEditorEl.value;
      saveCurrentDraft();
    });
  }

  // Nút Chọn lại lớp học
  const btnReselect = document.getElementById('btn-reselect-class');
  if (btnReselect) {
    btnReselect.onclick = () => switchTab('tab-classes');
  }

  // Nút Tạo Summary bằng AI
  const btnGenSummary = document.getElementById('btn-ai-generate-summary');
  const summaryBox = document.getElementById('students-summary-editor');
  if (btnGenSummary && summaryBox) {
    btnGenSummary.onclick = async () => {
      btnGenSummary.disabled = true;
      btnGenSummary.innerHTML = '⏳ AI đang soạn tóm tắt...';

      const geminiConfig = getGeminiConfig();
      try {
        const data = await apiRequest('/api/gemini/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lessonData: {
              title: currentSession ? currentSession.title : 'Bài học',
              sessionNumber: currentSession ? currentSession.sessionNumber : 1,
              summary: summaryBox.value
            },
            provider: geminiConfig.provider,
            apiKey: geminiConfig.key,
            model: geminiConfig.model
          })
        });
        if (data.success && data.summary) {
          summaryBox.value = data.summary;
          currentSummary = data.summary;
          toast.success('Đã tạo nội dung tóm tắt buổi học bằng AI.');
        }
      } catch (err) {
        toast.error(`Lỗi tạo Summary: ${err.message}`);
      } finally {
        btnGenSummary.disabled = false;
        btnGenSummary.innerHTML = `${ICONS.sparkles(14)} Tạo nội dung bằng AI`;
      }
    };
  }

  // Quick rating pills (Đặt nhanh: Tốt, Khá, Xuất sắc)
  document.querySelectorAll('.btn-quick-rate').forEach(btn => {
    btn.onclick = () => {
      const rate = btn.getAttribute('data-rate');
      currentStudents.forEach(st => {
        if (st.attendance === 'PRESENT') st.rating = rate;
      });
      renderStudentsTable();
    };
  });

  // Nút "Chuyển sang Duyệt & Lưu": Chuyển sang tab Duyệt & Lưu và stream 1 lượt gọi Gemini AI đánh chữ trực tiếp
  const btnProceedReview = document.getElementById('btn-proceed-to-review');
  if (btnProceedReview) {
    btnProceedReview.onclick = async () => {
      const summaryText = summaryBox ? summaryBox.value : currentSummary;
      const presentStudents = currentStudents.filter(st => st.attendance !== 'ABSENT');
      if (presentStudents.length === 0) {
        setReviewData(currentClass, currentSession, summaryText, currentStudents);
        switchTab('tab-review');
        return;
      }

      const geminiConfig = getGeminiConfig();
      if (!geminiConfig.key) {
        toast.error('Chưa cấu hình Gemini API Key. Vui lòng vào tab Cấu hình để nhập API Key trước khi tạo nhận xét.', 6000);
        return;
      }

      switchTab('tab-review');
      await runReviewAiStreaming({
        cls: currentClass,
        session: currentSession,
        summary: summaryText,
        students: currentStudents
      });
    };
  }
}

function renderStudentsQuickStyleUI() {
  const summaryEl = document.getElementById('students-style-summary');
  const presetsEl = document.getElementById('students-quick-presets');
  const templatesEl = document.getElementById('students-quick-templates');
  const fmtRow = document.getElementById('students-quick-format-row');
  const btnPara = document.getElementById('btn-students-fmt-paragraph');
  const btnBullets = document.getElementById('btn-students-fmt-bullets');

  if (summaryEl) {
    summaryEl.textContent = formatStyleSummaryLabel(currentStyleConfig);
  }

  if (presetsEl) {
    presetsEl.innerHTML = '';
    COMMENT_PRESETS.forEach((preset) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const isActive = currentStyleConfig.mode === 'preset' && currentStyleConfig.presetId === preset.id;
      chip.className = `style-chip-btn${isActive ? ' active' : ''}`;
      chip.textContent = preset.name;
      chip.addEventListener('click', async () => {
        currentStyleConfig = await saveCommentStyleConfig({
          ...currentStyleConfig,
          mode: 'preset',
          presetId: preset.id
        });
        renderStudentsQuickStyleUI();
        toast.success(`Đã đổi nhanh phong cách: ${preset.name}`);
      });
      presetsEl.appendChild(chip);
    });
  }

  if (templatesEl) {
    templatesEl.innerHTML = '';
    CUSTOM_CRITERIA_TEMPLATES.forEach((tpl) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      const isActive = currentStyleConfig.mode === 'custom' && (currentStyleConfig.customCriteria || '').trim() === tpl.criteria;
      chip.className = `style-chip-btn${isActive ? ' active' : ''}`;
      chip.textContent = tpl.label;
      chip.addEventListener('click', async () => {
        currentStyleConfig = await saveCommentStyleConfig({
          ...currentStyleConfig,
          mode: 'custom',
          customCriteria: tpl.criteria
        });
        renderStudentsQuickStyleUI();
        toast.success(`Đã chọn bộ tiêu chí: ${tpl.label}`);
      });
      templatesEl.appendChild(chip);
    });
  }

  if (fmtRow) {
    fmtRow.style.display = currentStyleConfig.mode === 'custom' ? 'flex' : 'none';
  }
  if (btnPara) {
    btnPara.classList.toggle('active', currentStyleConfig.outputFormat !== 'bullets');
  }
  if (btnBullets) {
    btnBullets.classList.toggle('active', currentStyleConfig.outputFormat === 'bullets');
  }
}

function bindStudentsQuickStyleEvents() {
  if (isQuickStyleBound) return;
  isQuickStyleBound = true;

  const btnToggle = document.getElementById('btn-students-quick-style');
  const popover = document.getElementById('students-style-popover');
  const btnPara = document.getElementById('btn-students-fmt-paragraph');
  const btnBullets = document.getElementById('btn-students-fmt-bullets');

  if (btnToggle && popover) {
    btnToggle.addEventListener('click', () => {
      const isOpen = popover.style.display === 'flex';
      popover.style.display = isOpen ? 'none' : 'flex';
      btnToggle.textContent = isOpen ? 'Đổi nhanh' : 'Thu gọn';
    });
  }

  if (btnPara) {
    btnPara.addEventListener('click', async () => {
      currentStyleConfig = await saveCommentStyleConfig({
        ...currentStyleConfig,
        outputFormat: 'paragraph'
      });
      renderStudentsQuickStyleUI();
    });
  }

  if (btnBullets) {
    btnBullets.addEventListener('click', async () => {
      currentStyleConfig = await saveCommentStyleConfig({
        ...currentStyleConfig,
        outputFormat: 'bullets'
      });
      renderStudentsQuickStyleUI();
    });
  }
}
