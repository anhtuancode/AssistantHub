/**
 * Tab Giáo trình (Curriculum Tab ES Module)
 * Giao diện Bento Grid 2 cột gọn gàng: Top Control Bar + Thanh khóa học ngang +
 * Thẻ buổi học (Mở Slide, Link lắp ráp, Mã QR) + Modal StudentBook & Modal QR offline.
 */

import { curriculumService } from '../services/curriculum.js';
import { toast } from '../services/toast.js';
import { ICONS } from '../services/icons.js';
import { generateQrSvg } from '../services/qrGenerator.js';

let currentCategory = 'ROBOTICS';
let selectedCourseCode = null;
let allCurriculaData = null;

let activeBuildModalSession = null;
let activeQrState = {
  sessionNumber: null,
  title: '',
  builds: [],
  selectedBuildIdx: 0,
  buildUrl: '',
  slideUrl: '',
  activeType: 'build'
};

function getSessionBuilds(sessionObj) {
  if (!sessionObj) return [];
  if (Array.isArray(sessionObj.builds) && sessionObj.builds.length > 0) {
    return sessionObj.builds
      .filter(b => b && typeof b.url === 'string' && b.url.trim())
      .map((b, idx) => ({
        label: (b.label || `Mô hình ${idx + 1}`).trim(),
        url: b.url.trim()
      }));
  }
  const singleUrl = (sessionObj.buildUrl || '').trim();
  return singleUrl ? [{ label: 'Hướng dẫn lắp ráp', url: singleUrl }] : [];
}

function closeAllBuildDropdowns() {
  document.querySelectorAll('.build-dropdown-menu.open').forEach(el => el.classList.remove('open'));
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

export async function initCurriculumTab(defaultCourse = null) {
  allCurriculaData = await curriculumService.getAllCourses();

  const robBtn = document.getElementById('cat-btn-robotics');
  const codBtn = document.getElementById('cat-btn-coding');
  if (robBtn) robBtn.addEventListener('click', () => switchCategory('ROBOTICS'));
  if (codBtn) codBtn.addEventListener('click', () => switchCategory('CODING'));

  bindModalsEvents();

  let resolvedDefault = defaultCourse;
  if (!resolvedDefault) {
    let activeClassCode = (typeof window !== 'undefined' && window.__mindxActiveClassCode) || '';
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
    selectedCourseCode = 'PREI';
    currentCategory = 'ROBOTICS';
  }

  updateCategoryTabsUI();
  renderCoursePills(currentCategory);

  if (selectedCourseCode && allCurriculaData.courses[selectedCourseCode]) {
    selectCourse(selectedCourseCode);
  }
}

function bindModalsEvents() {
  // StudentBook Modal
  const openSbModalBtn = document.getElementById('btn-open-studentbook-modal');
  const sbModal = document.getElementById('modal-studentbook');
  const closeSbModalBtn = document.getElementById('btn-close-studentbook-modal');
  const saveSbBtn = document.getElementById('btn-save-student-book');

  if (openSbModalBtn) {
    openSbModalBtn.addEventListener('click', openStudentBookModal);
  }
  if (closeSbModalBtn) {
    closeSbModalBtn.addEventListener('click', () => {
      if (sbModal) sbModal.style.display = 'none';
    });
  }
  if (sbModal) {
    sbModal.addEventListener('click', (e) => {
      if (e.target === sbModal) sbModal.style.display = 'none';
    });
  }
  if (saveSbBtn) {
    saveSbBtn.addEventListener('click', handleSaveStudentBook);
  }

  // Build URL Modal
  const buildModal = document.getElementById('modal-build-url');
  const closeBuildBtn = document.getElementById('btn-close-build-modal');
  const cancelBuildBtn = document.getElementById('btn-cancel-build-modal');
  const saveBuildBtn = document.getElementById('btn-save-build-url');
  const closeBuildModal = () => {
    if (buildModal) buildModal.style.display = 'none';
    activeBuildModalSession = null;
  };
  if (closeBuildBtn) closeBuildBtn.addEventListener('click', closeBuildModal);
  if (cancelBuildBtn) cancelBuildBtn.addEventListener('click', closeBuildModal);
  if (buildModal) {
    buildModal.addEventListener('click', (e) => {
      if (e.target === buildModal) closeBuildModal();
    });
  }
  if (saveBuildBtn) saveBuildBtn.addEventListener('click', handleSaveBuildUrl);

  // QR Modal
  const qrModal = document.getElementById('modal-qr');
  const closeQrBtn = document.getElementById('btn-qr-close');
  const closeQrXBtn = document.getElementById('btn-qr-close-x');
  const tabBuildBtn = document.getElementById('btn-qr-tab-build');
  const tabSlideBtn = document.getElementById('btn-qr-tab-slide');
  const openQrLinkBtn = document.getElementById('btn-qr-open-link');
  const copyQrBtn = document.getElementById('btn-qr-copy-link');

  const closeQrModal = () => {
    if (qrModal) qrModal.style.display = 'none';
  };
  if (closeQrBtn) closeQrBtn.addEventListener('click', closeQrModal);
  if (closeQrXBtn) closeQrXBtn.addEventListener('click', closeQrModal);
  if (qrModal) {
    qrModal.addEventListener('click', (e) => {
      if (e.target === qrModal) closeQrModal();
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.session-split-wrap')) {
      closeAllBuildDropdowns();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeAllBuildDropdowns();
    if (qrModal && qrModal.style.display === 'flex') closeQrModal();
    if (buildModal && buildModal.style.display === 'flex') closeBuildModal();
    if (sbModal && sbModal.style.display === 'flex') sbModal.style.display = 'none';
  });
  if (tabBuildBtn) {
    tabBuildBtn.addEventListener('click', () => switchQrType('build'));
  }
  if (tabSlideBtn) {
    tabSlideBtn.addEventListener('click', () => switchQrType('slide'));
  }
  if (openQrLinkBtn) {
    openQrLinkBtn.addEventListener('click', () => {
      const targetUrl = activeQrState.activeType === 'build' ? activeQrState.buildUrl : activeQrState.slideUrl;
      if (targetUrl) window.open(targetUrl, '_blank', 'noopener,noreferrer');
    });
  }
  if (copyQrBtn) {
    copyQrBtn.addEventListener('click', async () => {
      const targetUrl = activeQrState.activeType === 'build' ? activeQrState.buildUrl : activeQrState.slideUrl;
      if (!targetUrl) return;
      try {
        await navigator.clipboard.writeText(targetUrl);
        toast.success('Đã sao chép!');
      } catch (_) {
        toast.warning('Không thể tự động sao chép, vui lòng copy thủ công.');
      }
    });
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
  renderCoursePills(category);

  if (allCurriculaData && allCurriculaData.courses) {
    const firstMatch = getFilteredCourses(category)[0];
    if (firstMatch) {
      selectCourse(firstMatch.code);
    }
  }
}

function getFilteredCourses(category) {
  if (!allCurriculaData || !allCurriculaData.courses) return [];
  const courses = Object.values(allCurriculaData.courses);

  return courses.filter(c => {
    const cat = (c.category || '').toUpperCase();
    if (category === 'ROBOTICS') return cat.startsWith('ROB');
    return cat.startsWith('COD') || cat === 'C4K';
  });
}

function renderCoursePills(category) {
  const container = document.getElementById('course-pills-container');
  const emptyEl = document.getElementById('curriculum-detail-empty');
  const contentEl = document.getElementById('curriculum-detail-content');
  if (!container) return;

  container.innerHTML = '';
  const filteredCourses = getFilteredCourses(category);

  if (filteredCourses.length === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';

  const clustersMap = {};
  filteredCourses.forEach(c => {
    const cluster = c.cluster || 'OTHER';
    if (!clustersMap[cluster]) clustersMap[cluster] = [];
    clustersMap[cluster].push(c);
  });

  const clusterOrder = ['PRE', 'ARM', 'SEMI', 'SCRATCH', 'GAMEMAKER', 'PYTHON', 'WEB_JS', 'COMPUTER_SCIENCE'];
  const sortedClusters = Object.keys(clustersMap).sort((a, b) => {
    const idxA = clusterOrder.indexOf(a);
    const idxB = clusterOrder.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  sortedClusters.forEach((clusterKey, clusterIdx) => {
    if (clusterIdx > 0) {
      const divider = document.createElement('span');
      divider.className = 'curriculum-pill-divider';
      divider.setAttribute('aria-hidden', 'true');
      container.appendChild(divider);
    }

    clustersMap[clusterKey].forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `course-pill-btn ${selectedCourseCode === c.code ? 'active' : ''}`;
      btn.setAttribute('data-code', c.code);
      btn.textContent = c.code;
      btn.title = c.name || c.code;
      btn.addEventListener('click', () => selectCourse(c.code));
      container.appendChild(btn);
    });
  });

  // Nếu khóa đang chọn không nằm trong kết quả lọc, tự động chọn khóa đầu tiên khớp
  if (!filteredCourses.some(c => c.code === selectedCourseCode)) {
    selectCourse(filteredCourses[0].code);
  }
}

export function selectCourse(courseCode) {
  selectedCourseCode = courseCode;
  if (!allCurriculaData || !allCurriculaData.courses) return;
  const course = allCurriculaData.courses[courseCode];
  if (!course) return;

  document.querySelectorAll('.course-pill-btn').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-code') === courseCode);
  });

  renderCourseSessions(courseCode);
}

function renderCourseSessions(courseCode) {
  const course = allCurriculaData && allCurriculaData.courses ? allCurriculaData.courses[courseCode] : null;
  if (!course) return;

  const emptyEl = document.getElementById('curriculum-detail-empty');
  const contentEl = document.getElementById('curriculum-detail-content');
  if (emptyEl) emptyEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';

  const sessions = course.sessions || [];
  const titleEl = document.getElementById('detail-course-title');
  if (titleEl) {
    titleEl.textContent = course.name || course.code;
  }

  const grid = document.getElementById('sessions-bento-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const isRobotics = (course.category || '').toUpperCase().startsWith('ROB');

  sessions.forEach(s => {
    const slideUrl = (s.slideUrl || '').trim();
    const builds = isRobotics ? getSessionBuilds(s) : [];
    const hasSlide = Boolean(slideUrl);
    const hasBuilds = builds.length > 0;
    const isMultiBuild = builds.length >= 2;

    const card = document.createElement('div');
    card.className = 'session-bento-card';
    card.setAttribute('data-session-num', s.sessionNumber);

    let roboticsActionsHtml = '';
    if (hasBuilds) {
      const dropdownItemsHtml = isMultiBuild
        ? `<div class="build-dropdown-menu">${builds.map((b, idx) => `
            <button type="button" class="build-dropdown-item" data-build-idx="${idx}">
              ${ICONS.wrench(13)}
              <span>${escapeHtml(b.label)}</span>
            </button>`).join('')}
          </div>`
        : '';

      const buildLabelHtml = isMultiBuild
        ? `<span>Lắp ráp (${builds.length})</span>${ICONS.chevronDown(13)}`
        : `<span>Lắp ráp</span>`;

      roboticsActionsHtml = `
        <div class="${isMultiBuild ? 'session-split-wrap' : 'session-split-group'}">
          ${isMultiBuild ? '<div class="session-split-group">' : ''}
          <button type="button" class="btn-bento-build">
            ${ICONS.wrench(14)}
            ${buildLabelHtml}
          </button>
          <button type="button" class="btn-bento-qr" title="Hiện mã QR lắp ráp" aria-label="Mã QR">
            ${ICONS.qrCode(16)}
          </button>
          ${isMultiBuild ? '</div>' : ''}
          ${dropdownItemsHtml}
        </div>`;
    }

    card.innerHTML = `
      <div class="session-bento-header">
        <span class="session-bento-badge">Buổi ${s.sessionNumber}</span>
        <span class="session-bento-title">${escapeHtml(s.title || '(Chưa cập nhật tên bài học)')}</span>
      </div>
      <div class="session-bento-actions">
        <button type="button" class="btn-bento-slide" ${!hasSlide ? 'disabled' : ''}>
          ${ICONS.presentation(15)}
          <span>Mở Slide</span>
        </button>${roboticsActionsHtml}
      </div>
    `;

    const slideBtn = card.querySelector('.btn-bento-slide');
    slideBtn.addEventListener('click', () => {
      if (slideUrl) window.open(slideUrl, '_blank', 'noopener,noreferrer');
    });

    if (hasBuilds) {
      const buildBtn = card.querySelector('.btn-bento-build');
      const dropdownMenu = card.querySelector('.build-dropdown-menu');

      if (buildBtn) {
        buildBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isMultiBuild && dropdownMenu) {
            const willOpen = !dropdownMenu.classList.contains('open');
            closeAllBuildDropdowns();
            if (willOpen) dropdownMenu.classList.add('open');
          } else if (builds[0]) {
            window.open(builds[0].url, '_blank', 'noopener,noreferrer');
          }
        });
      }

      if (dropdownMenu) {
        dropdownMenu.querySelectorAll('.build-dropdown-item').forEach(itemBtn => {
          itemBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(itemBtn.getAttribute('data-build-idx'));
            const targetBuild = builds[idx];
            closeAllBuildDropdowns();
            if (targetBuild && targetBuild.url) {
              window.open(targetBuild.url, '_blank', 'noopener,noreferrer');
            }
          });
        });
      }

      const qrBtn = card.querySelector('.btn-bento-qr');
      if (qrBtn) {
        qrBtn.addEventListener('click', () => {
          closeAllBuildDropdowns();
          openQrModal(s);
        });
      }
    }

    grid.appendChild(card);
  });
}

function openStudentBookModal() {
  if (!allCurriculaData || !allCurriculaData.courses || !selectedCourseCode) return;
  const course = allCurriculaData.courses[selectedCourseCode];
  if (!course) return;

  const modal = document.getElementById('modal-studentbook');
  const clusterLabel = document.getElementById('sb-modal-cluster-label');
  const sbInp = document.getElementById('input-cluster-student-book');
  const openLinkBtn = document.getElementById('btn-open-student-book');

  const url = (course.studentBookUrl || '').trim();
  if (clusterLabel) {
    clusterLabel.textContent = `Cụm ${course.cluster} (${course.code} — dùng chung cho cụm):`;
  }
  if (sbInp) sbInp.value = url;
  if (openLinkBtn) {
    if (url) {
      openLinkBtn.href = url;
      openLinkBtn.style.display = 'inline-flex';
    } else {
      openLinkBtn.style.display = 'none';
    }
  }
  if (modal) modal.style.display = 'flex';
}

async function handleSaveStudentBook() {
  if (!allCurriculaData || !allCurriculaData.courses || !selectedCourseCode) return;
  const course = allCurriculaData.courses[selectedCourseCode];
  if (!course) return;

  const sbInput = document.getElementById('input-cluster-student-book');
  const newUrl = sbInput ? sbInput.value.trim() : '';
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

    const modal = document.getElementById('modal-studentbook');
    if (modal) modal.style.display = 'none';
    toast.success('Đã lưu link StudentBook thành công.');
  } else {
    toast.error('Lưu link StudentBook thất bại.');
  }
}

function openBuildUrlModal(courseCode, sessionObj) {
  activeBuildModalSession = { courseCode, sessionNumber: sessionObj.sessionNumber };
  const modal = document.getElementById('modal-build-url');
  const subtitle = document.getElementById('build-modal-subtitle');
  const inp = document.getElementById('input-build-url');

  if (subtitle) {
    subtitle.textContent = `Buổi ${sessionObj.sessionNumber} — ${sessionObj.title || ''}`;
  }
  if (inp) {
    inp.value = (sessionObj.buildUrl || '').trim();
  }
  if (modal) {
    modal.style.display = 'flex';
    if (inp) inp.focus();
  }
}

async function handleSaveBuildUrl() {
  if (!activeBuildModalSession) return;
  const { courseCode, sessionNumber } = activeBuildModalSession;
  const inp = document.getElementById('input-build-url');
  const buildUrl = inp ? inp.value.trim() : '';

  const res = await curriculumService.saveSessionChanges(courseCode, sessionNumber, { buildUrl });
  if (res && res.success) {
    const course = allCurriculaData && allCurriculaData.courses ? allCurriculaData.courses[courseCode] : null;
    if (course && course.sessions) {
      const target = course.sessions.find(x => x.sessionNumber === sessionNumber);
      if (target) target.buildUrl = buildUrl;
    }
    const modal = document.getElementById('modal-build-url');
    if (modal) modal.style.display = 'none';
    activeBuildModalSession = null;
    renderCourseSessions(courseCode);
    toast.success(`Đã lưu Link lắp ráp Buổi ${sessionNumber}.`);
  } else {
    toast.error('Không thể lưu Link lắp ráp.');
  }
}

export function openQrModal(sessionObj) {
  const slideUrl = (sessionObj && sessionObj.slideUrl ? String(sessionObj.slideUrl).trim() : '');
  const builds = getSessionBuilds(sessionObj);
  const buildUrl = builds.length > 0 ? builds[0].url : '';
  if (!slideUrl && !buildUrl) return;

  activeQrState = {
    sessionNumber: sessionObj.sessionNumber,
    title: sessionObj.title || '',
    builds,
    selectedBuildIdx: 0,
    buildUrl,
    slideUrl,
    activeType: buildUrl ? 'build' : 'slide'
  };

  const modal = document.getElementById('modal-qr');
  const titleEl = document.getElementById('qr-modal-title');
  const tabsEl = document.getElementById('qr-modal-tabs');

  if (titleEl) {
    titleEl.textContent = `Buổi ${activeQrState.sessionNumber} — ${activeQrState.title}`;
  }
  if (tabsEl) {
    tabsEl.style.display = (buildUrl && slideUrl) ? 'inline-flex' : 'none';
  }

  renderQrModalContent();
  if (modal) modal.style.display = 'flex';
}

export function switchQrType(type) {
  if (type === 'build' && !activeQrState.buildUrl) return;
  if (type === 'slide' && !activeQrState.slideUrl) return;
  activeQrState.activeType = type;
  renderQrModalContent();
}

function renderQrModalContent() {
  const tabBuildBtn = document.getElementById('btn-qr-tab-build');
  const tabSlideBtn = document.getElementById('btn-qr-tab-slide');
  const buildTabsEl = document.getElementById('qr-modal-build-tabs');
  const badgeEl = document.getElementById('qr-modal-type-badge');
  const canvasEl = document.getElementById('qr-modal-canvas');
  const urlEl = document.getElementById('qr-modal-url');

  const isBuild = activeQrState.activeType === 'build';
  const builds = activeQrState.builds || [];
  if (isBuild && builds.length > 0) {
    const activeBuild = builds[activeQrState.selectedBuildIdx] || builds[0];
    activeQrState.buildUrl = activeBuild.url;
  }
  const currentUrl = isBuild ? activeQrState.buildUrl : activeQrState.slideUrl;

  if (tabBuildBtn) tabBuildBtn.classList.toggle('active', isBuild);
  if (tabSlideBtn) tabSlideBtn.classList.toggle('active', !isBuild);

  if (buildTabsEl) {
    if (isBuild && builds.length >= 2) {
      buildTabsEl.style.display = 'inline-flex';
      buildTabsEl.innerHTML = '';
      builds.forEach((b, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `curriculum-qr-tab ${idx === activeQrState.selectedBuildIdx ? 'active' : ''}`;
        btn.textContent = b.label;
        btn.addEventListener('click', () => {
          activeQrState.selectedBuildIdx = idx;
          activeQrState.buildUrl = b.url;
          renderQrModalContent();
        });
        buildTabsEl.appendChild(btn);
      });
    } else {
      buildTabsEl.style.display = 'none';
    }
  }

  if (badgeEl) {
    badgeEl.textContent = isBuild ? 'QR Link lắp ráp' : 'QR Slide bài giảng';
  }
  if (urlEl) {
    urlEl.textContent = currentUrl;
    urlEl.title = currentUrl;
  }
  if (canvasEl && currentUrl) {
    try {
      canvasEl.innerHTML = generateQrSvg(currentUrl, 240);
    } catch (err) {
      canvasEl.innerHTML = `<span style="color:#DC2626;font-size:12px;">${escapeHtml(err.message)}</span>`;
    }
  }
}
