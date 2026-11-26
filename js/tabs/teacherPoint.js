/**
 * Page 7: Teacher Point (Chỉ áp dụng lớp ROB Buổi 4 & Buổi 8)
 * Gửi Google Form siêu tốc bằng HTTP POST trực tiếp.
 */

import { switchTab } from '../main.js';
import { toast, showConfirm } from '../services/toast.js';
import { ICONS } from '../services/icons.js';
import { apiRequest } from '../services/apiBridge.js';

const DEFAULT_TP_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfyK41x_vyFztgjU1sTgJGLiHE1yvf7mmHuUQe5gUQDLQcO_Q/viewform';

let tpClass = null;
let tpSession = null;
let tpStudents = [];
let tpFormLoaded = false;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getClassCode(cls) {
  if (!cls) return '';
  return String(cls.classCode || cls.code || (cls.title ? cls.title.split('—')[0].trim() : '') || '').trim();
}

export function checkTeacherPointEligibility(cls, session) {
  const classCode = getClassCode(cls);
  const sessionNumber = session ? parseInt(session.sessionNumber, 10) : null;
  const isRob = classCode.toUpperCase().includes('ROB');
  const isTargetSession = sessionNumber === 4 || sessionNumber === 8;
  return {
    eligible: isRob && isTargetSession,
    classCode,
    sessionNumber
  };
}

export function setTeacherPointContext(cls, session, students = []) {
  tpClass = cls;
  tpSession = session;
  tpStudents = Array.isArray(students)
    ? students.map(s => ({
        id: s.id,
        name: s.name || s.studentName,
        attendance: (s.attendance || s.attendanceStatus || 'PRESENT').toUpperCase(),
        selected: (s.attendance || s.attendanceStatus || 'PRESENT').toUpperCase() !== 'ABSENT',
        tpStatus: 'pending'
      }))
    : [];

  updateSidebarReminderBadge();
}

function updateSidebarReminderBadge() {
  const badge = document.getElementById('sidebar-tp-badge');
  if (!badge) return;
  const { eligible, sessionNumber } = checkTeacherPointEligibility(tpClass, tpSession);
  if (eligible) {
    badge.textContent = `Buổi ${sessionNumber}`;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

export async function initTeacherPointTab() {
  bindTeacherPointEvents();
  updateSidebarReminderBadge();

  const lockedBox = document.getElementById('tp-locked-box');
  const activeBox = document.getElementById('tp-active-box');
  const lockedReason = document.getElementById('tp-locked-reason');
  const eligibleBadge = document.getElementById('tp-eligible-badge');

  const { eligible, classCode, sessionNumber } = checkTeacherPointEligibility(tpClass, tpSession);

  if (!eligible) {
    if (lockedBox) lockedBox.style.display = 'block';
    if (activeBox) activeBox.style.display = 'none';
    if (lockedReason) {
      const currentLabel = `${classCode || 'Chưa chọn lớp'} — ${sessionNumber ? `Buổi ${sessionNumber}` : 'Chưa chọn buổi'}`;
      lockedReason.innerHTML = `Phiếu khảo sát Teacher Point chỉ áp dụng cho khối lớp <strong>Robotics (ROB)</strong> tại <strong>Buổi 4</strong> và <strong>Buổi 8</strong>. (Hiện tại: <strong>${escapeHtml(currentLabel)}</strong>).`;
    }
    return;
  }

  if (lockedBox) lockedBox.style.display = 'none';
  if (activeBox) activeBox.style.display = 'block';
  if (eligibleBadge) {
    eligibleBadge.textContent = `Đủ điều kiện — ${classCode} (Buổi ${sessionNumber})`;
  }

  const formUrlInp = document.getElementById('input-tp-form-url');
  if (formUrlInp && !formUrlInp.value.trim()) {
    formUrlInp.value = DEFAULT_TP_FORM_URL;
  }

  if (!tpFormLoaded) {
    await loadGoogleFormMetadata(false);
  }
  renderTpStudentsTable();
}

async function loadGoogleFormMetadata(forceRefresh = false) {
  const formUrlInp = document.getElementById('input-tp-form-url');
  const campusSel = document.getElementById('select-tp-campus');
  const formUrl = formUrlInp ? formUrlInp.value.trim() : DEFAULT_TP_FORM_URL;
  const classCode = getClassCode(tpClass);

  try {
    const data = await apiRequest(`/api/teacher-point/form?url=${encodeURIComponent(formUrl)}&classCode=${encodeURIComponent(classCode)}&refresh=${forceRefresh ? '1' : '0'}`);
    if (data.success && Array.isArray(data.campuses)) {
      tpFormLoaded = true;
      if (campusSel) {
        campusSel.innerHTML = data.campuses
          .map(c => `<option value="${escapeHtml(c)}" ${c === data.suggestedCampus ? 'selected' : ''}>${escapeHtml(c)}</option>`)
          .join('');
      }
      if (forceRefresh) toast.success(`Đã tải lại cấu trúc Form (${data.fieldsCount} câu hỏi).`);
    } else {
      toast.error(data.error || 'Không thể tải cấu trúc Google Form.');
    }
  } catch (err) {
    toast.error(`Lỗi tải Google Form: ${err.message}`);
  }
}

function renderTpStudentsTable() {
  const tbody = document.getElementById('tp-students-tbody');
  const countBadge = document.getElementById('tp-selected-count-badge');
  const submitBtn = document.getElementById('btn-tp-submit-all');
  if (!tbody) return;

  const selectedCount = tpStudents.filter(s => s.selected).length;
  if (countBadge) countBadge.textContent = `${selectedCount} bạn`;
  if (submitBtn) submitBtn.innerHTML = `${ICONS.send(15)} Gửi nhanh toàn bộ (${selectedCount} bạn)`;

  if (tpStudents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px; color: #64748B;">Chưa có học viên. Hãy chọn buổi học ở mục Lớp &amp; Buổi học.</td></tr>';
    return;
  }

  tbody.innerHTML = tpStudents.map((st, idx) => {
    const isAbsent = st.attendance === 'ABSENT';
    let statusHtml = '<span class="tag tag-gray">Chờ gửi</span>';
    if (st.tpStatus === 'sending') statusHtml = `<span class="tag tag-blue">${ICONS.clock(12)} Đang gửi...</span>`;
    else if (st.tpStatus === 'sent') statusHtml = `<span class="tag tag-green">${ICONS.check(12)} Đã gửi</span>`;
    else if (st.tpStatus === 'error') statusHtml = `<span class="tag tag-red">${ICONS.x(12)} Lỗi</span>`;

    return `
      <tr data-tp-idx="${idx}">
        <td><input type="checkbox" class="chk-tp-student" data-idx="${idx}" ${st.selected ? 'checked' : ''}></td>
        <td style="font-weight: 600; color: #64748B;">${idx + 1}</td>
        <td style="font-weight: 700; color: #0F172A;">${escapeHtml(st.name)}</td>
        <td><span class="tag ${isAbsent ? 'tag-red' : 'tag-green'}">${isAbsent ? 'Vắng mặt' : 'Có mặt'}</span></td>
        <td>${statusHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.chk-tp-student').forEach(chk => {
    chk.onchange = () => {
      const idx = parseInt(chk.getAttribute('data-idx'), 10);
      tpStudents[idx].selected = chk.checked;
      const cnt = tpStudents.filter(s => s.selected).length;
      if (countBadge) countBadge.textContent = `${cnt} bạn`;
      if (submitBtn) submitBtn.innerHTML = `${ICONS.send(15)} Gửi nhanh toàn bộ (${cnt} bạn)`;
    };
  });
}

function updateTpProgress(visible, label = '', percent = 0) {
  const box = document.getElementById('tp-progress-box');
  const labelEl = document.getElementById('tp-progress-label');
  const pctEl = document.getElementById('tp-progress-percent');
  const fillEl = document.getElementById('tp-progress-fill');
  if (box) box.style.display = visible ? 'block' : 'none';
  if (labelEl) labelEl.textContent = label;
  if (pctEl) pctEl.textContent = `${percent}%`;
  if (fillEl) fillEl.style.width = `${percent}%`;
}

function bindTeacherPointEvents() {
  const btnBack = document.getElementById('btn-tp-back-to-classes');
  if (btnBack) {
    btnBack.onclick = () => switchTab('tab-classes');
  }

  const btnReload = document.getElementById('btn-tp-reload-form');
  if (btnReload) {
    btnReload.onclick = () => loadGoogleFormMetadata(true);
  }

  const chkAll = document.getElementById('chk-tp-select-all');
  if (chkAll) {
    chkAll.onchange = () => {
      tpStudents.forEach(s => { s.selected = chkAll.checked; });
      renderTpStudentsTable();
    };
  }

  const btnSubmitAll = document.getElementById('btn-tp-submit-all');
  if (btnSubmitAll) {
    btnSubmitAll.onclick = async () => {
      const { eligible, classCode, sessionNumber } = checkTeacherPointEligibility(tpClass, tpSession);
      if (!eligible) {
        toast.warning('Chỉ áp dụng cho khối lớp Robotics (ROB) tại Buổi 4 và Buổi 8.');
        return;
      }

      const targets = tpStudents.map((s, i) => ({ s, i })).filter(({ s }) => s.selected);
      if (targets.length === 0) {
        toast.warning('Vui lòng chọn ít nhất 1 học viên để gửi.');
        return;
      }

      const campusSel = document.getElementById('select-tp-campus');
      const formUrlInp = document.getElementById('input-tp-form-url');
      const campus = campusSel ? campusSel.value : '';
      const formUrl = formUrlInp ? formUrlInp.value.trim() : DEFAULT_TP_FORM_URL;

      const ok = await showConfirm(
        `Xác nhận gửi phiếu Teacher Point cho ${targets.length} học viên lớp ${classCode} (Buổi ${sessionNumber})?`,
        { title: 'Gửi Teacher Point', confirmText: 'Gửi ngay' }
      );
      if (!ok) return;

      btnSubmitAll.disabled = true;
      let sentCount = 0;
      let errCount = 0;

      for (let k = 0; k < targets.length; k++) {
        const { s } = targets[k];
        s.tpStatus = 'sending';
        renderTpStudentsTable();
        updateTpProgress(true, `Đang gửi ${k + 1}/${targets.length}: ${s.name}...`, Math.round((k / targets.length) * 100));

        try {
          const data = await apiRequest('/api/teacher-point/submit-single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              formUrl,
              studentName: s.name,
              classCode,
              sessionNumber,
              campus
            })
          });
          if (data.success) {
            s.tpStatus = 'sent';
            sentCount++;
          } else {
            s.tpStatus = 'error';
            errCount++;
          }
        } catch (_) {
          s.tpStatus = 'error';
          errCount++;
        }

        renderTpStudentsTable();
        if (k < targets.length - 1) {
          await new Promise(r => setTimeout(r, 180));
        }
      }

      updateTpProgress(true, `Hoàn tất ${sentCount}/${targets.length} học viên!`, 100);
      btnSubmitAll.disabled = false;
      if (errCount === 0) {
        toast.success(`Đã gửi Teacher Point thành công cho ${sentCount}/${targets.length} học viên.`);
      } else {
        toast.warning(`Đã gửi ${sentCount} thành công, ${errCount} lỗi.`);
      }
    };
  }
}
