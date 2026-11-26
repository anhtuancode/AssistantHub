/**
 * Tab Giáo trình (Curriculum Tab ES Module)
 * Quản lý tra cứu 24 khóa học Robotics & Coding, tìm kiếm nhanh, thao tác nhanh Zalo/Copy,
 * chỉnh sửa StudentBook gọn 1 dòng và gắn/mở Slide trực tiếp trên từng buổi học.
 */

import { curriculumService } from '../services/curriculum.js';
import { switchTab } from '../main.js';
import { toast } from '../services/toast.js';
import { ICONS } from '../services/icons.js';

let currentCategory = 'ROBOTICS';
let selectedCourseCode = null;
let allCurriculaData = null;
let searchQuery = '';
let isEditingStudentBook = false;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function initCurriculumTab(defaultCourse = null) {
  allCurriculaData = await curriculumService.getAllCourses();

  // Khởi tạo các sự kiện nút chuyển nhóm môn học
  const robBtn = document.getElementById('cat-btn-robotics');
  const codBtn = document.getElementById('cat-btn-coding');
  if (robBtn) robBtn.onclick = () => switchCategory('ROBOTICS');
  if (codBtn) codBtn.onclick = () => switchCategory('CODING');

  // Thanh tìm kiếm nhanh (Quick Search)
  const searchInp = document.getElementById('input-curriculum-search');
  if (searchInp) {
    searchInp.value = searchQuery;
    searchInp.oninput = () => {
      searchQuery = searchInp.value.trim();
      renderCourseList(currentCategory);
    };
  }

  // Sự kiện StudentBook: Lưu / Sửa / Hủy
  const saveSbBtn = document.getElementById('btn-save-student-book');
  if (saveSbBtn) saveSbBtn.onclick = handleSaveStudentBook;

  const editSbBtn = document.getElementById('btn-edit-student-book');
  if (editSbBtn) {
    editSbBtn.onclick = () => {
      isEditingStudentBook = true;
      updateStudentBookUI(allCurriculaData.courses[selectedCourseCode]);
    };
  }

  const cancelSbBtn = document.getElementById('btn-cancel-student-book');
  if (cancelSbBtn) {
    cancelSbBtn.onclick = () => {
      isEditingStudentBook = false;
      updateStudentBookUI(allCurriculaData.courses[selectedCourseCode]);
    };
  }

  // Tự động nhận diện khóa học từ lớp đang chọn ở Lớp & Buổi học nếu chưa chỉ định
  let resolvedDefault = defaultCourse;
  if (!resolvedDefault) {
    let activeClassCode = window.__mindxActiveClassCode || '';
    if (!activeClassCode) {
      try { activeClassCode = localStorage.getItem('mindx_active_class_code') || ''; } catch (_) {}
    }
    if (activeClassCode) {
      const extracted = curriculumService.extractCourseCode(activeClassCode);
      if (extracted && allCurriculaData.courses[extracted]) {
        resolvedDefault = extracted;
      }
    }
  }

  if (resolvedDefault && allCurriculaData.courses[resolvedDefault]) {
    selectedCourseCode = resolvedDefault;
    const c = allCurriculaData.courses[resolvedDefault];
    currentCategory = (c.category || '').toUpperCase().startsWith('ROB') ? 'ROBOTICS' : 'CODING';
  } else if (!selectedCourseCode) {
    selectedCourseCode = 'ARMA';
    currentCategory = 'ROBOTICS';
  }

  updateCategoryTabsUI();
  renderCourseList(currentCategory);

  if (selectedCourseCode && allCurriculaData.courses[selectedCourseCode]) {
    selectCourse(selectedCourseCode);
  }
}

function updateCategoryTabsUI() {
  const robBtn = document.getElementById('cat-btn-robotics');
  const codBtn = document.getElementById('cat-btn-coding');
  if (robBtn) robBtn.classList.toggle('active', currentCategory === 'ROBOTICS');
  if (codBtn) codBtn.classList.toggle('active', currentCategory === 'CODING');
}

function switchCategory(category) {
  currentCategory = category;
  updateCategoryTabsUI();
  renderCourseList(category);
}

function renderCourseList(category) {
  const container = document.getElementById('course-list-container');
  if (!container || !allCurriculaData || !allCurriculaData.courses) return;

  container.innerHTML = '';
  const courses = Object.values(allCurriculaData.courses);
  const q = searchQuery.toLowerCase();

  // Nếu có từ khóa tìm kiếm -> tìm trên toàn bộ 24 khóa (theo mã khóa, tên khóa hoặc tên bài học)
  const filteredCourses = courses.filter(c => {
    if (q) {
      const codeMatch = (c.code || '').toLowerCase().includes(q);
      const nameMatch = (c.name || '').toLowerCase().includes(q);
      const lessonMatch = (c.sessions || []).some(s => (s.title || '').toLowerCase().includes(q));
      return codeMatch || nameMatch || lessonMatch;
    }
    const cat = (c.category || '').toUpperCase();
    if (category === 'ROBOTICS') return cat.startsWith('ROB');
    return cat.startsWith('COD') || cat === 'C4K';
  });

  if (filteredCourses.length === 0) {
    container.innerHTML = `<div style="padding: 24px 12px; text-align: center; color: #64748B; font-size: 12.5px;">Không tìm thấy khóa học phù hợp "${escapeHtml(searchQuery)}".</div>`;
    return;
  }

  // Gom nhóm theo cụm khóa học
  const clustersMap = {};
  filteredCourses.forEach(c => {
    const cluster = c.cluster || 'OTHER';
    if (!clustersMap[cluster]) clustersMap[cluster] = [];
    clustersMap[cluster].push(c);
  });

  const clusterDisplayNames = {
    PRE: 'Cụm PRE (VEX GO): PREB - PREA - PREI',
    ARM: 'Cụm ARM (VEX GO): ARMB - ARMA - ARMI',
    SEMI: 'Cụm SEMI (VEX IQ): SEMIB - SEMIA - SEMII',
    SCRATCH: 'Cụm Scratch: SB - SA - SI',
    GAMEMAKER: 'Cụm Game Maker: GB - GA - GI',
    PYTHON: 'Cụm Python: PTB - PTA - PTI',
    WEB_JS: 'Cụm Web / JS: JSB - JSA - JSI',
    COMPUTER_SCIENCE: 'Cụm CS: CSB - CSA - CSI'
  };

  const clusterOrder = ['PRE', 'ARM', 'SEMI', 'SCRATCH', 'GAMEMAKER', 'PYTHON', 'WEB_JS', 'COMPUTER_SCIENCE'];
  const sortedClusters = Object.keys(clustersMap).sort((a, b) => {
    const idxA = clusterOrder.indexOf(a);
    const idxB = clusterOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  sortedClusters.forEach(clusterKey => {
    const clusterCourses = clustersMap[clusterKey];
    const groupDiv = document.createElement('div');
    groupDiv.className = 'cluster-group';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'cluster-title';
    titleDiv.textContent = clusterDisplayNames[clusterKey] || `Cụm ${clusterKey}`;
    groupDiv.appendChild(titleDiv);

    clusterCourses.forEach(c => {
      const item = document.createElement('div');
      item.className = `course-tree-item ${selectedCourseCode === c.code ? 'active' : ''}`;
      item.setAttribute('data-code', c.code);
      item.innerHTML = `
        <div style="display: flex; align-items: center; min-width: 0;">
          <span class="course-code-badge">${escapeHtml(c.code)}</span>
          <span class="course-name-sub" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
        </div>
        <span class="tag ${c.category === 'ROBOTICS' ? 'tag-purple' : 'tag-blue'}" style="font-size: 11px;">
          ${c.sessionsCount || 14}b
        </span>
      `;
      item.addEventListener('click', () => selectCourse(c.code));
      groupDiv.appendChild(item);
    });

    container.appendChild(groupDiv);
  });
}

function updateStudentBookUI(course) {
  const compactView = document.getElementById('student-book-compact-view');
  const editView = document.getElementById('student-book-edit-view');
  const compactUrlEl = document.getElementById('student-book-compact-url');
  const openSbBtn = document.getElementById('btn-open-student-book');
  const sbInput = document.getElementById('input-cluster-student-book');
  const cancelBtn = document.getElementById('btn-cancel-student-book');

  const url = (course && course.studentBookUrl) ? course.studentBookUrl.trim() : '';
  if (sbInput) sbInput.value = url;

  if (url && !isEditingStudentBook) {
    if (compactView) compactView.style.display = 'flex';
    if (editView) editView.style.display = 'none';
    if (compactUrlEl) {
      compactUrlEl.textContent = url;
      compactUrlEl.title = url;
    }
    if (openSbBtn) openSbBtn.href = url;
  } else {
    if (compactView) compactView.style.display = 'none';
    if (editView) editView.style.display = 'block';
    if (cancelBtn) cancelBtn.style.display = url ? 'inline-flex' : 'none';
  }
}

export function selectCourse(courseCode) {
  selectedCourseCode = courseCode;
  isEditingStudentBook = false;
  if (!allCurriculaData || !allCurriculaData.courses) return;

  const course = allCurriculaData.courses[courseCode];
  if (!course) return;

  document.querySelectorAll('.course-tree-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-code') === courseCode);
  });

  const emptyState = document.getElementById('curriculum-detail-empty');
  const detailContent = document.getElementById('curriculum-detail-content');
  if (emptyState) emptyState.style.display = 'none';
  if (detailContent) detailContent.style.display = 'block';

  const titleEl = document.getElementById('detail-course-title');
  if (titleEl) titleEl.textContent = `${course.code} - ${course.name}`;

  const tagEl = document.getElementById('detail-course-category-tag');
  if (tagEl) {
    tagEl.textContent = course.category === 'ROBOTICS'
      ? `Robotics - ${course.platform || 'VEX'}`
      : `Coding - ${course.platform || 'C4K'}`;
    tagEl.className = `tag ${course.category === 'ROBOTICS' ? 'tag-purple' : 'tag-blue'}`;
  }

  const clusterInfo = document.getElementById('detail-course-cluster-info');
  if (clusterInfo) {
    clusterInfo.textContent = `Cụm khóa học: ${course.cluster} (Dùng chung 1 link StudentBook cho cả 3 khóa B-A-I)`;
  }

  updateStudentBookUI(course);
  renderSessionsAccordion(course);
}

function renderSessionsAccordion(course) {
  const container = document.getElementById('sessions-accordion-container');
  if (!container) return;
  container.innerHTML = '';

  const countEl = document.getElementById('detail-sessions-count');
  const sessions = course.sessions || [];
  if (countEl) countEl.textContent = sessions.length;

  sessions.forEach(s => {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.setAttribute('data-session-num', s.sessionNumber);

    const hasSlide = Boolean(s.slideUrl && s.slideUrl.trim().length > 0);
    const slideControlHtml = hasSlide
      ? `<button type="button" class="btn btn-xs btn-slide-open-inline" title="Mở Slide bài giảng">${ICONS.link2(13)} Mở Slide</button>
         <button type="button" class="btn btn-secondary btn-xs btn-slide-edit-inline" title="Sửa link Slide">${ICONS.pencil(13)}</button>`
      : `<button type="button" class="btn btn-xs btn-slide-add-inline">${ICONS.plus(13)} Gắn Slide</button>`;

    item.innerHTML = `
      <div class="session-item-header">
        <div class="session-header-left">
          <span class="session-num-badge">Buổi ${s.sessionNumber}</span>
          <span class="session-title-preview">${escapeHtml(s.title || '(Chưa cập nhật tên bài học)')}</span>
        </div>
        <div class="session-header-right" style="display: flex; align-items: center; gap: 6px;">
          ${slideControlHtml}
          <button type="button" class="btn btn-secondary btn-xs btn-quick-copy-summary" title="Copy Tóm tắt buổi học">${ICONS.copy(13)} Copy Tóm tắt</button>
          <button type="button" class="btn btn-primary btn-xs btn-quick-zalo" title="Mở Báo bài Zalo cho buổi này">${ICONS.send(13)} Báo bài Zalo</button>
          <span class="accordion-chevron">${ICONS.chevronDown(14)}</span>
        </div>
      </div>
      <div class="quick-slide-popover" style="display: none;">
        <input type="text" class="form-control inp-quick-slide" value="${escapeHtml(s.slideUrl || '')}" placeholder="Dán link Slide (Canva / Google Slides)..." style="font-size: 12px; padding: 5px 8px;">
        <button type="button" class="btn btn-primary btn-xs btn-save-quick-slide">Lưu</button>
        <button type="button" class="btn btn-secondary btn-xs btn-cancel-quick-slide">Hủy</button>
      </div>
      <div class="session-item-body" style="display: none;">
        <div class="form-group">
          <label style="font-weight: 600;">Tên bài học:</label>
          <input type="text" class="form-control inp-session-title" value="${escapeHtml(s.title || '')}" placeholder="Ví dụ: Cánh tay Robot hoặc Lập trình Game">
        </div>
        <div class="form-row">
          <div class="form-group flex-2">
            <label style="font-weight: 600;">Link Slide bài giảng:</label>
            <div style="display: flex; gap: 6px;">
              <input type="text" class="form-control inp-session-slide" value="${escapeHtml(s.slideUrl || '')}" placeholder="https://canva.com/... hoặc link slide">
              <button type="button" class="btn btn-secondary btn-xs btn-open-slide" ${!hasSlide ? 'disabled' : ''}>${ICONS.link2(13)} Mở</button>
            </div>
          </div>
          <div class="form-group flex-2">
            <label style="font-weight: 600;">Link Tài liệu ôn tập / Bài tập:</label>
            <div style="display: flex; gap: 6px;">
              <input type="text" class="form-control inp-session-review" value="${escapeHtml(s.reviewDocUrl || '')}" placeholder="https://drive.google.com/... (nếu có)">
              <button type="button" class="btn btn-secondary btn-xs btn-open-review" ${!s.reviewDocUrl ? 'disabled' : ''}>${ICONS.link2(13)} Mở</button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">${ICONS.bookOpen(14)} Tóm tắt nội dung bài học:</label>
          <textarea class="form-control inp-session-summary" rows="2" placeholder="Tóm tắt nội dung thực hành...">${escapeHtml(s.summary || '')}</textarea>
        </div>
        <div class="form-group">
          <label style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">${ICONS.cpu(14)} Linh kiện & Câu lệnh / Kiến thức trọng tâm:</label>
          <textarea class="form-control inp-session-hardware" rows="2" placeholder="Linh kiện cơ khí hoặc câu lệnh lập trình...">${escapeHtml(s.hardwareAndCommands || '')}</textarea>
        </div>
        <div class="form-group">
          <label style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">${ICONS.target(14)} Mục tiêu bài học (mỗi mục tiêu trên 1 dòng):</label>
          <textarea class="form-control inp-session-objectives" rows="2" placeholder="Mục tiêu kiến thức, kỹ năng...">${escapeHtml((s.objectives || []).join('\n'))}</textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 10px;">
          <button type="button" class="btn btn-primary btn-sm btn-save-session" data-session="${s.sessionNumber}">
            ${ICONS.save(14)} Lưu cập nhật buổi học
          </button>
        </div>
      </div>
    `;

    // Đóng/Mở accordion khi nhấp vào header (trừ các nút action nhanh)
    const header = item.querySelector('.session-item-header');
    const body = item.querySelector('.session-item-body');
    header.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const isOpen = item.classList.contains('open');
      item.classList.toggle('open', !isOpen);
      body.style.display = isOpen ? 'none' : 'block';
    });

    // Quick Slide Popover (Mở Slide / + Gắn Slide / Sửa Slide)
    const quickPopover = item.querySelector('.quick-slide-popover');
    const quickSlideInp = item.querySelector('.inp-quick-slide');
    const slideInp = item.querySelector('.inp-session-slide');
    const openSlideBtn = item.querySelector('.btn-open-slide');

    const btnOpenInline = item.querySelector('.btn-slide-open-inline');
    if (btnOpenInline) {
      btnOpenInline.addEventListener('click', (e) => {
        e.stopPropagation();
        if (s.slideUrl && s.slideUrl.trim()) window.open(s.slideUrl.trim(), '_blank');
      });
    }

    const openQuickSlideEditor = (e) => {
      e.stopPropagation();
      quickPopover.style.display = quickPopover.style.display === 'none' ? 'flex' : 'none';
      if (quickPopover.style.display === 'flex') quickSlideInp.focus();
    };

    const btnAddInline = item.querySelector('.btn-slide-add-inline');
    if (btnAddInline) btnAddInline.addEventListener('click', openQuickSlideEditor);

    const btnEditInline = item.querySelector('.btn-slide-edit-inline');
    if (btnEditInline) btnEditInline.addEventListener('click', openQuickSlideEditor);

    item.querySelector('.btn-cancel-quick-slide').addEventListener('click', (e) => {
      e.stopPropagation();
      quickPopover.style.display = 'none';
    });

    item.querySelector('.btn-save-quick-slide').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newSlide = quickSlideInp.value.trim();
      slideInp.value = newSlide;
      s.slideUrl = newSlide;
      const res = await curriculumService.saveSessionChanges(course.code, s.sessionNumber, { slideUrl: newSlide });
      if (res && res.success) {
        toast.success(`Đã cập nhật link Slide Buổi ${s.sessionNumber}.`);
        renderSessionsAccordion(course);
      } else {
        toast.error('Không thể lưu link Slide.');
      }
    });

    // Quick Action: Copy Tóm tắt
    item.querySelector('.btn-quick-copy-summary').addEventListener('click', async (e) => {
      e.stopPropagation();
      const textToCopy = (s.summary || s.title || '').trim();
      if (!textToCopy) {
        toast.warning(`Buổi ${s.sessionNumber} chưa có nội dung tóm tắt.`);
        return;
      }
      try {
        await navigator.clipboard.writeText(textToCopy);
        toast.success(`Đã sao chép tóm tắt Buổi ${s.sessionNumber}.`);
      } catch (_) {
        toast.warning('Không thể tự động sao chép, vui lòng copy thủ công.');
      }
    });

    // Quick Action: Báo bài Zalo
    item.querySelector('.btn-quick-zalo').addEventListener('click', (e) => {
      e.stopPropagation();
      switchTab('tab-zalo', { courseCode: course.code, sessionNumber: s.sessionNumber });
    });

    // Mở liên kết Slide & Review trong form chi tiết
    slideInp.addEventListener('input', () => {
      openSlideBtn.disabled = !slideInp.value.trim();
    });
    openSlideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (slideInp.value.trim()) window.open(slideInp.value.trim(), '_blank');
    });

    const reviewInp = item.querySelector('.inp-session-review');
    const openReviewBtn = item.querySelector('.btn-open-review');
    reviewInp.addEventListener('input', () => {
      openReviewBtn.disabled = !reviewInp.value.trim();
    });
    openReviewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (reviewInp.value.trim()) window.open(reviewInp.value.trim(), '_blank');
    });

    const saveBtn = item.querySelector('.btn-save-session');
    saveBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await handleSaveSession(course.code, s.sessionNumber, item);
    });

    container.appendChild(item);
  });
}

async function handleSaveStudentBook() {
  if (!allCurriculaData || !allCurriculaData.courses || !selectedCourseCode) return;
  const course = allCurriculaData.courses[selectedCourseCode];
  if (!course) return;

  const sbInput = document.getElementById('input-cluster-student-book');
  const newUrl = sbInput.value.trim();
  const cluster = course.cluster;

  const res = await curriculumService.saveStudentBook(cluster, newUrl, course.code);
  if (res && res.success) {
    course.studentBookUrl = newUrl;
    course.hasCustomStudentBook = Boolean(newUrl);

    Object.values(allCurriculaData.courses).forEach(c => {
      if (c.cluster === cluster && !c.hasCustomStudentBook) {
        c.studentBookUrl = newUrl;
      }
    });

    isEditingStudentBook = false;
    updateStudentBookUI(course);
    toast.success('Đã lưu link StudentBook thành công.');
  } else {
    toast.error('Lưu link StudentBook thất bại.');
  }
}

async function handleSaveSession(courseCode, sessionNumber, itemEl) {
  const title = itemEl.querySelector('.inp-session-title').value.trim();
  const slideUrl = itemEl.querySelector('.inp-session-slide').value.trim();
  const reviewDocUrl = itemEl.querySelector('.inp-session-review').value.trim();
  const summary = itemEl.querySelector('.inp-session-summary').value.trim();
  const hardwareAndCommands = itemEl.querySelector('.inp-session-hardware').value.trim();
  const objectivesText = itemEl.querySelector('.inp-session-objectives').value.trim();
  const objectives = objectivesText ? objectivesText.split(/\r?\n|;/).map(o => o.trim()).filter(Boolean) : [];

  const sessionData = { title, slideUrl, reviewDocUrl, summary, hardwareAndCommands, objectives };

  const res = await curriculumService.saveSessionChanges(courseCode, sessionNumber, sessionData);
  if (res && res.success) {
    const course = allCurriculaData.courses[courseCode];
    if (course && course.sessions) {
      const target = course.sessions.find(x => x.sessionNumber === sessionNumber);
      if (target) Object.assign(target, sessionData);
    }
    toast.success(`Đã lưu cập nhật Buổi ${sessionNumber}.`);
    renderSessionsAccordion(allCurriculaData.courses[courseCode]);
  } else {
    toast.error(`Không thể lưu Buổi ${sessionNumber}.`);
  }
}
