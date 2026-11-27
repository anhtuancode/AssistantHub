/**
 * Tab Báo bài Zalo (Zalo Tab ES Module)
 * Sinh mẫu tin nhắn Zalo gửi phụ huynh (Rich Text & Plain Text) kèm bài tập về nhà cho khối Coding.
 */

import { curriculumService } from '../services/curriculum.js';
import { toast } from '../services/toast.js';

let allCurriculaData = null;
let saveHwTimer = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTeacherNameFromConfig() {
  try {
    const lmsCfg = JSON.parse(localStorage.getItem('mindx_lms_config') || '{}');
    if (lmsCfg && typeof lmsCfg.name === 'string' && lmsCfg.name.trim()) {
      return lmsCfg.name.trim();
    }
  } catch (_) {}
  const cfgNameInp = document.getElementById('cfg-lms-name');
  if (cfgNameInp && cfgNameInp.value && cfgNameInp.value.trim()) {
    return cfgNameInp.value.trim();
  }
  return '';
}

export async function initZaloTab(defaultCourse = null, defaultSession = null) {
  allCurriculaData = await curriculumService.getAllCourses();

  // Khôi phục tên GV & mã lớp đã lưu trong localStorage (ưu tiên tên GV từ tab Cấu hình)
  const teacherInp = document.getElementById('input-zalo-teacher-name');
  if (teacherInp) {
    const savedTeacher = localStorage.getItem('mindx_teacher_name') || getTeacherNameFromConfig() || 'Giáo viên';
    teacherInp.value = savedTeacher;
    teacherInp.addEventListener('input', () => {
      localStorage.setItem('mindx_teacher_name', teacherInp.value.trim());
      renderZaloReportPreview();
    });
  }

  const classCodeInp = document.getElementById('input-zalo-class-code');
  if (classCodeInp) {
    const savedClass = localStorage.getItem('mindx_zalo_class_code') || 'PVT-ROB-ARMA26';
    classCodeInp.value = savedClass;
    classCodeInp.addEventListener('input', () => {
      const val = classCodeInp.value.trim();
      localStorage.setItem('mindx_zalo_class_code', val);
      const detected = curriculumService.extractCourseCode(val);
      const courseSelEl = document.getElementById('select-zalo-course');
      if (detected && allCurriculaData && allCurriculaData.courses && allCurriculaData.courses[detected] && courseSelEl && courseSelEl.value !== detected) {
        courseSelEl.value = detected;
        populateZaloSessionDropdown();
      }
      renderZaloReportPreview();
    });
  }

  // Khởi tạo dropdown khóa học
  populateZaloCourseDropdown(defaultCourse);

  // Khởi tạo dropdown buổi học
  populateZaloSessionDropdown(defaultSession);

  // Lắng nghe sự kiện thay đổi
  const courseSel = document.getElementById('select-zalo-course');
  if (courseSel) {
    courseSel.onchange = () => {
      populateZaloSessionDropdown();
      renderZaloReportPreview();
    };
  }

  const sessionSel = document.getElementById('select-zalo-session');
  if (sessionSel) {
    sessionSel.onchange = () => {
      renderZaloReportPreview();
    };
  }

  // Sự kiện nút Báo bài & BTVN
  setupZaloActionButtons();

  // Sinh nội dung báo bài xem trước
  renderZaloReportPreview();
}

function setupZaloActionButtons() {
  const refreshBtn = document.getElementById('btn-refresh-zalo');
  if (refreshBtn) {
    refreshBtn.onclick = () => renderZaloReportPreview();
  }

  const copyReportBtn = document.getElementById('btn-copy-zalo-bottom');
  if (copyReportBtn) {
    copyReportBtn.onclick = copyZaloReportHandler;
  }

  const copyHwBtn = document.getElementById('btn-copy-zalo-homework');
  if (copyHwBtn) {
    copyHwBtn.onclick = copyZaloHomeworkHandler;
  }

  const copyAllBtn = document.getElementById('btn-copy-zalo-all');
  if (copyAllBtn) {
    copyAllBtn.onclick = copyZaloAllHandler;
  }

  // BTVN inputs
  const deniseInp = document.getElementById('input-zalo-homework-denise');
  const pageFromInp = document.getElementById('input-zalo-homework-page-from');
  const pageToInp = document.getElementById('input-zalo-homework-page-to');

  [deniseInp, pageFromInp, pageToInp].forEach(inp => {
    if (inp) {
      inp.addEventListener('input', handleHomeworkPagesInput);
    }
  });
}

function populateZaloCourseDropdown(preferredCourse = null) {
  const sel = document.getElementById('select-zalo-course');
  if (!sel || !allCurriculaData || !allCurriculaData.courses) return;

  const currentVal = preferredCourse || sel.value || 'ARMA';
  sel.innerHTML = '';

  const courses = Object.values(allCurriculaData.courses);
  const robCourses = courses.filter(c => (c.category || '').toUpperCase().startsWith('ROB'));
  const codCourses = courses.filter(c => {
    const cat = (c.category || '').toUpperCase();
    return cat.startsWith('COD') || cat === 'C4K';
  });

  const robGroup = document.createElement('optgroup');
  robGroup.label = 'Robotics (9 khóa)';
  robCourses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = `${c.code} - ${c.name}`;
    robGroup.appendChild(opt);
  });
  sel.appendChild(robGroup);

  const codGroup = document.createElement('optgroup');
  codGroup.label = 'Coding - C4K (15 khóa)';
  codCourses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = `${c.code} - ${c.name}`;
    codGroup.appendChild(opt);
  });
  sel.appendChild(codGroup);

  if (currentVal && allCurriculaData.courses[currentVal]) {
    sel.value = currentVal;
  } else {
    sel.value = 'ARMA';
  }
}

function populateZaloSessionDropdown(preferredSession = null) {
  const courseSel = document.getElementById('select-zalo-course');
  const sessionSel = document.getElementById('select-zalo-session');
  if (!courseSel || !sessionSel) return;

  const currentVal = preferredSession || sessionSel.value;
  const courseCode = courseSel.value || 'ARMA';
  const course = allCurriculaData && allCurriculaData.courses ? allCurriculaData.courses[courseCode] : null;

  sessionSel.innerHTML = '';
  const sessions = (course && course.sessions) ? course.sessions : [];

  if (sessions.length > 0) {
    sessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.sessionNumber;
      opt.textContent = `Buổi ${s.sessionNumber}: ${s.title || '(Chưa cập nhật)'}`;
      sessionSel.appendChild(opt);
    });
  } else {
    for (let i = 1; i <= 14; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `Buổi ${i}`;
      sessionSel.appendChild(opt);
    }
  }

  if (currentVal && Array.from(sessionSel.options).some(o => String(o.value) === String(currentVal))) {
    sessionSel.value = String(currentVal);
  } else {
    sessionSel.value = '1';
  }
}

function isCodingCourse(courseCode, course) {
  if (course && course.category) {
    const cat = String(course.category).toUpperCase();
    if (cat === 'CODING' || cat === 'C4K') return true;
    if (cat === 'ROB' || cat === 'ROBOTICS') return false;
  }
  const codingCodes = ['SB', 'SA', 'SI', 'GB', 'GA', 'GI', 'PTB', 'PTA', 'PTI', 'JSB', 'JSA', 'JSI', 'CSB', 'CSA', 'CSI'];
  const code = (courseCode || '').toUpperCase();
  return codingCodes.includes(code);
}

export function buildZaloReportContent({
  courseCode = 'ARMA',
  sessionNum = 1,
  teacherName = 'Giáo viên',
  classCode = '',
  course = null,
  sessionData = null
} = {}) {
  const resolvedClassCode = (classCode && classCode.trim()) ? classCode.trim() : courseCode;
  const resolvedTeacher = (teacherName && teacherName.trim()) ? teacherName.trim() : (getTeacherNameFromConfig() || 'Giáo viên');
  const studentBookUrl = (course && course.studentBookUrl) ? course.studentBookUrl.trim() : '';

  let nextLessonTitle = 'Tổng kết cuối khóa';
  if (sessionData && typeof sessionData.nextLesson === 'string' && sessionData.nextLesson.trim()) {
    nextLessonTitle = sessionData.nextLesson.trim();
  } else if (course && course.sessions) {
    const totalSessions = course.sessions.length;
    if (sessionNum < totalSessions) {
      const nextSession = course.sessions.find(s => s.sessionNumber === sessionNum + 1);
      if (nextSession && nextSession.title && nextSession.title.trim()) {
        nextLessonTitle = nextSession.title.trim();
      } else {
        nextLessonTitle = `Buổi ${sessionNum + 1}`;
      }
    }
  }

  const title = (sessionData && sessionData.title && sessionData.title.trim()) ? sessionData.title.trim() : `Bài học Buổi ${sessionNum}`;
  const summary = (sessionData && sessionData.summary && sessionData.summary.trim()) ? sessionData.summary.trim() : 'Nắm vững và thực hành toàn diện các kiến thức trọng tâm buổi học.';
  const hardware = (sessionData && sessionData.hardwareAndCommands && sessionData.hardwareAndCommands.trim()) ? sessionData.hardwareAndCommands.trim() : 'Linh kiện và câu lệnh lập trình theo bài học.';

  let objectivesList = ['Hoàn thiện sản phẩm bài học và phát triển tư duy sáng tạo.'];
  if (sessionData && sessionData.objectives && sessionData.objectives.length > 0) {
    objectivesList = sessionData.objectives;
  }

  const slideUrl = (sessionData && sessionData.slideUrl && sessionData.slideUrl.trim()) ? sessionData.slideUrl.trim() : '';
  const reviewDocUrl = (sessionData && sessionData.reviewDocUrl && sessionData.reviewDocUrl.trim()) ? sessionData.reviewDocUrl.trim() : '';
  const reviewDocLabel = (sessionData && sessionData.reviewDocLabel && sessionData.reviewDocLabel.trim()) ? sessionData.reviewDocLabel.trim() : 'Tài liệu ôn tập / Bài tập';
  const extraLinks = (sessionData && Array.isArray(sessionData.extraLinks))
    ? sessionData.extraLinks.filter(item => item && item.url && String(item.url).trim())
    : [];
  const parentQuestions = (sessionData && Array.isArray(sessionData.parentQuestions))
    ? sessionData.parentQuestions.map(q => String(q || '').trim()).filter(Boolean)
    : [];

  const ZALO_P = 'margin: 0px; line-height: 1.4;';
  const ZALO_ORANGE = 'color: rgb(242, 120, 6); font-weight: 700; font-size: 12pt; background-color: rgb(255, 255, 255);';
  const ZALO_RED = 'color: rgb(219, 52, 46); font-weight: 700; font-size: 12pt; background-color: rgb(255, 255, 255);';
  const ZALO_GREEN = 'color: rgb(21, 168, 95); font-weight: 700; font-size: 12pt; background-color: rgb(255, 255, 255);';
  const ZALO_TEXT = 'color: rgb(8, 28, 54); font-weight: 400; font-size: 12pt; background-color: rgb(255, 255, 255);';

  // Link tài liệu buổi học (Whitelist RGB chuẩn Zalo PC)
  const linkHtmlParts = [];
  if (slideUrl) {
    linkHtmlParts.push(`<p style="${ZALO_P}"><span style="${ZALO_GREEN}">Slide bài học: </span><a href="${escapeHtml(slideUrl)}" target="_blank" style="color: rgb(21, 168, 95); text-decoration: underline;"><span style="${ZALO_GREEN}">${escapeHtml(slideUrl)}</span></a></p>`);
  }
  if (reviewDocUrl) {
    linkHtmlParts.push(`<p style="${ZALO_P}"><span style="${ZALO_GREEN}">${escapeHtml(reviewDocLabel)}: </span><a href="${escapeHtml(reviewDocUrl)}" target="_blank" style="color: rgb(21, 168, 95); text-decoration: underline;"><span style="${ZALO_GREEN}">${escapeHtml(reviewDocUrl)}</span></a></p>`);
  }
  extraLinks.forEach(item => {
    const lbl = (item.label && String(item.label).trim()) ? String(item.label).trim() : 'Tài liệu bổ sung';
    const url = String(item.url).trim();
    linkHtmlParts.push(`<p style="${ZALO_P}"><span style="${ZALO_GREEN}">${escapeHtml(lbl)}: </span><a href="${escapeHtml(url)}" target="_blank" style="color: rgb(21, 168, 95); text-decoration: underline;"><span style="${ZALO_GREEN}">${escapeHtml(url)}</span></a></p>`);
  });
  if (studentBookUrl) {
    linkHtmlParts.push(`<p style="${ZALO_P}"><span style="${ZALO_GREEN}">Tài liệu StudentBook: </span><a href="${escapeHtml(studentBookUrl)}" target="_blank" style="color: rgb(21, 168, 95); text-decoration: underline;"><span style="${ZALO_GREEN}">${escapeHtml(studentBookUrl)}</span></a></p>`);
  }

  // 1. Rich Text HTML theo đúng chuẩn Whitelist RGB của Zalo PC
  const richLines = [
    `<p style="${ZALO_P}"><span style="${ZALO_ORANGE}">Xin chào quý phụ huynh! Em là ${escapeHtml(resolvedTeacher)} giáo viên chủ nhiệm của lớp ${escapeHtml(resolvedClassCode)}, xin phép gửi nội dung buổi học ${sessionNum} như sau:</span></p>`,
    `<p style="${ZALO_P}"><br></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_RED}">Tóm tắt buổi học: ${escapeHtml(title)}.</span></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_TEXT}">- ${escapeHtml(summary)}</span></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_TEXT}">- Linh kiện &amp; Kiến thức lập trình: ${escapeHtml(hardware)}</span></p>`,
    `<p style="${ZALO_P}"><br></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_RED}">Mục tiêu buổi học:</span></p>`,
    ...objectivesList.map(o => `<p style="${ZALO_P}"><span style="${ZALO_TEXT}">- ${escapeHtml(o)}</span></p>`),
    ...(parentQuestions.length > 0 ? [
      `<p style="${ZALO_P}"><br></p>`,
      `<p style="${ZALO_P}"><span style="${ZALO_RED}">Gợi ý ba mẹ trò chuyện cùng con:</span></p>`,
      ...parentQuestions.map((q, idx) => `<p style="${ZALO_P}"><span style="${ZALO_TEXT}">${idx + 1}. ${escapeHtml(q)}</span></p>`)
    ] : []),
    ...(linkHtmlParts.length > 0 ? [
      `<p style="${ZALO_P}"><br></p>`,
      `<p style="${ZALO_P}"><span style="${ZALO_RED}">Tài liệu buổi học:</span></p>`,
      ...linkHtmlParts
    ] : []),
    `<p style="${ZALO_P}"><br></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_GREEN}">Bài học tiếp theo: ${escapeHtml(nextLessonTitle)}.</span></p>`,
    `<p style="${ZALO_P}"><br></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_ORANGE}">Em xin chân thành cảm ơn quý phụ huynh đã dành chút thời gian để xem thông tin này! Trong quá trình học tập các bạn học viên có thắc mắc về kiến thức bài học phụ huynh có thể liên hệ trực tiếp với giáo viên để được hỗ trợ ạ!</span></p>`
  ];
  const richHtml = richLines.join('');

  // 2. Plain Text
  const plainLinkParts = [];
  if (slideUrl) plainLinkParts.push(`Slide bài học: ${slideUrl}`);
  if (reviewDocUrl) plainLinkParts.push(`${reviewDocLabel}: ${reviewDocUrl}`);
  extraLinks.forEach(item => {
    const lbl = (item.label && String(item.label).trim()) ? String(item.label).trim() : 'Tài liệu bổ sung';
    plainLinkParts.push(`${lbl}: ${String(item.url).trim()}`);
  });
  if (studentBookUrl) plainLinkParts.push(`Tài liệu StudentBook: ${studentBookUrl}`);

  const plainLines = [
    `Xin chào quý phụ huynh! Em là ${resolvedTeacher} giáo viên chủ nhiệm của lớp ${resolvedClassCode}, xin phép gửi nội dung buổi học ${sessionNum} như sau:`,
    ``,
    `📌 TÓM TẮT BUỔI HỌC: ${title}.`,
    `- ${summary}`,
    `- Linh kiện & Kiến thức lập trình: ${hardware}`,
    ``,
    `🎯 MỤC TIÊU BUỔI HỌC:`,
    ...objectivesList.map(o => `- ${o}`)
  ];

  if (parentQuestions.length > 0) {
    plainLines.push(``);
    plainLines.push(`💬 GỢI Ý BA MẸ TRÒ CHUYỆN CÙNG CON:`);
    parentQuestions.forEach((q, idx) => plainLines.push(`${idx + 1}. ${q}`));
  }

  if (plainLinkParts.length > 0) {
    plainLines.push(``);
    plainLines.push(`📚 TÀI LIỆU BUỔI HỌC:`);
    plainLines.push(...plainLinkParts);
  }

  plainLines.push(``);
  plainLines.push(`⏭️ BÀI HỌC TIẾP THEO: ${nextLessonTitle}.`);
  plainLines.push(``);
  plainLines.push(`Em xin chân thành cảm ơn quý phụ huynh đã dành chút thời gian để xem thông tin này! Trong quá trình học tập các bạn học viên có thắc mắc về kiến thức bài học phụ huynh có thể liên hệ trực tiếp với giáo viên để được hỗ trợ ạ!`);

  const plainText = plainLines.join('\n').replace(/\n{3,}/g, '\n\n');

  return { richHtml, plainText };
}

export function renderZaloReportPreview() {
  const courseSel = document.getElementById('select-zalo-course');
  const sessionSel = document.getElementById('select-zalo-session');
  const teacherInp = document.getElementById('input-zalo-teacher-name');
  const classCodeInp = document.getElementById('input-zalo-class-code');
  const editor = document.getElementById('zalo-message-editor');
  const textarea = document.getElementById('textarea-zalo-message');
  if ((!editor && !textarea) || !courseSel || !sessionSel) return;

  const courseCode = courseSel.value || 'ARMA';
  const sessionNum = parseInt(sessionSel.value, 10) || 1;
  const teacherName = (teacherInp && teacherInp.value.trim()) ? teacherInp.value.trim() : (getTeacherNameFromConfig() || 'Giáo viên');
  const classCode = (classCodeInp && classCodeInp.value.trim()) ? classCodeInp.value.trim() : courseCode;

  const course = allCurriculaData && allCurriculaData.courses ? allCurriculaData.courses[courseCode] : null;
  const sessionData = (course && course.sessions) ? course.sessions.find(s => s.sessionNumber === sessionNum) : null;

  const { richHtml, plainText } = buildZaloReportContent({
    courseCode,
    sessionNum,
    teacherName,
    classCode,
    course,
    sessionData
  });

  if (editor) editor.innerHTML = richHtml;
  if (textarea) textarea.value = plainText;

  // 3. Khối BTVN (Denise + StudentBook) cho khối Coding
  const hwCard = document.getElementById('zalo-homework-card');
  const isCoding = isCodingCourse(courseCode, course);

  if (hwCard) {
    if (isCoding) {
      hwCard.style.display = 'block';
      const deniseInp = document.getElementById('input-zalo-homework-denise');
      const pageFromInp = document.getElementById('input-zalo-homework-page-from');
      const pageToInp = document.getElementById('input-zalo-homework-page-to');

      if (deniseInp && !deniseInp.value) deniseInp.value = `Buổi ${sessionNum}`;
      if (pageFromInp) pageFromInp.value = (sessionData && sessionData.studentBookPageFrom) ? sessionData.studentBookPageFrom : '';
      if (pageToInp) pageToInp.value = (sessionData && sessionData.studentBookPageTo) ? sessionData.studentBookPageTo : '';

      renderZaloHomeworkPreview();
    } else {
      hwCard.style.display = 'none';
    }
  }
}

function renderZaloHomeworkPreview() {
  const courseSel = document.getElementById('select-zalo-course');
  const sessionSel = document.getElementById('select-zalo-session');
  const classCodeInp = document.getElementById('input-zalo-class-code');
  const hwEditor = document.getElementById('zalo-homework-editor');
  const hwTextarea = document.getElementById('textarea-zalo-homework');
  if (!hwEditor && !hwTextarea) return;

  const courseCode = courseSel ? (courseSel.value || 'PTB') : 'PTB';
  const sessionNum = sessionSel ? (parseInt(sessionSel.value, 10) || 1) : 1;
  const classCode = classCodeInp ? (classCodeInp.value.trim() || courseCode) : courseCode;

  const course = allCurriculaData && allCurriculaData.courses ? allCurriculaData.courses[courseCode] : null;
  const studentBookUrl = (course && course.studentBookUrl) ? course.studentBookUrl.trim() : '';

  const deniseInp = document.getElementById('input-zalo-homework-denise');
  const pageFromInp = document.getElementById('input-zalo-homework-page-from');
  const pageToInp = document.getElementById('input-zalo-homework-page-to');

  const deniseVal = (deniseInp && deniseInp.value.trim()) ? deniseInp.value.trim() : `Buổi ${sessionNum}`;
  const pageFrom = pageFromInp ? pageFromInp.value.trim() : '';
  const pageTo = pageToInp ? pageToInp.value.trim() : '';

  let pagesText = '';
  if (pageFrom && pageTo) {
    pagesText = `Các con xem lại kiến thức và làm thêm bài tập từ trang ${pageFrom} đến trang ${pageTo}.`;
  } else if (pageFrom) {
    pagesText = `Các con xem lại kiến thức và làm thêm bài tập từ trang ${pageFrom}.`;
  } else {
    pagesText = `Các con xem lại nội dung bài học Buổi ${sessionNum} trong StudentBook.`;
  }

  const ZALO_P = 'margin: 0px; line-height: 1.4;';
  const ZALO_RED = 'color: rgb(219, 52, 46); font-weight: 700; font-size: 12pt; background-color: rgb(255, 255, 255);';
  const ZALO_GREEN = 'color: rgb(21, 168, 95); font-weight: 700; font-size: 12pt; background-color: rgb(255, 255, 255);';
  const ZALO_TEXT = 'color: rgb(8, 28, 54); font-weight: 400; font-size: 12pt; background-color: rgb(255, 255, 255);';

  const hwRichLines = [
    `<p style="${ZALO_P}"><span style="${ZALO_RED}">📌 BÀI TẬP VỀ NHÀ BUỔI ${sessionNum} (${escapeHtml(classCode)}):</span></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_TEXT}">- </span><span style="${ZALO_GREEN}">Bài tập trên hệ thống Denise:</span> <span style="${ZALO_TEXT}">Các con hoàn thành đầy đủ bài tập của ${escapeHtml(deniseVal)} trên Denise trước buổi học tới.</span></p>`,
    `<p style="${ZALO_P}"><span style="${ZALO_TEXT}">- </span><span style="${ZALO_GREEN}">Tài liệu StudentBook (${escapeHtml(courseCode)}):</span> <span style="${ZALO_TEXT}">${escapeHtml(pagesText)}</span></p>`,
    ...(studentBookUrl ? [
      `<p style="${ZALO_P}"><span style="${ZALO_TEXT}">- </span><span style="${ZALO_GREEN}">Link StudentBook:</span> <a href="${escapeHtml(studentBookUrl)}" target="_blank" style="color: rgb(21, 168, 95); text-decoration: underline;"><span style="${ZALO_GREEN}">${escapeHtml(studentBookUrl)}</span></a></p>`
    ] : [])
  ];
  const hwRichHtml = hwRichLines.join('');

  const hwPlainLines = [
    `📌 BÀI TẬP VỀ NHÀ BUỔI ${sessionNum} (${classCode}):`,
    `- Bài tập trên hệ thống Denise: Các con hoàn thành đầy đủ bài tập của ${deniseVal} trên Denise trước buổi học tới.`,
    `- Tài liệu StudentBook (${courseCode}): ${pagesText}`
  ];
  if (studentBookUrl) {
    hwPlainLines.push(`- Link StudentBook: ${studentBookUrl}`);
  }
  const hwPlainText = hwPlainLines.join('\n').replace(/\n{3,}/g, '\n\n');

  if (hwEditor) hwEditor.innerHTML = hwRichHtml;
  if (hwTextarea) hwTextarea.value = hwPlainText;
}

function handleHomeworkPagesInput() {
  renderZaloHomeworkPreview();

  const courseSel = document.getElementById('select-zalo-course');
  const sessionSel = document.getElementById('select-zalo-session');
  if (!courseSel || !sessionSel) return;
  const courseCode = courseSel.value;
  const sessionNum = parseInt(sessionSel.value, 10);
  const pageFromInp = document.getElementById('input-zalo-homework-page-from');
  const pageToInp = document.getElementById('input-zalo-homework-page-to');
  const pageFrom = pageFromInp ? pageFromInp.value.trim() : '';
  const pageTo = pageToInp ? pageToInp.value.trim() : '';

  clearTimeout(saveHwTimer);
  saveHwTimer = setTimeout(async () => {
    const studentBookPages = (pageFrom && pageTo) ? `${pageFrom}-${pageTo}` : (pageFrom || '');
    await curriculumService.saveSessionChanges(courseCode, sessionNum, {
      studentBookPageFrom: pageFrom,
      studentBookPageTo: pageTo,
      studentBookPages
    });
    const saveStatus = document.getElementById('zalo-homework-save-status');
    if (saveStatus) {
      saveStatus.textContent = 'Đã lưu số trang ✓';
      saveStatus.style.display = 'inline-block';
      setTimeout(() => { saveStatus.style.display = 'none'; }, 2000);
    }
  }, 400);
}

async function copyToClipboard(htmlContent, textContent) {
  const zaloHtml = `<html><body><!--StartFragment-->${htmlContent}<!--EndFragment--></body></html>`;
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const htmlBlob = new Blob([zaloHtml], { type: 'text/html' });
      const textBlob = new Blob([textContent], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob
        })
      ]);
      return true;
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textContent);
      return true;
    }
  } catch (err) {
    console.warn('[Clipboard] Thử sao chép fallback qua textarea:', err.message);
  }

  // Fallback qua textarea
  try {
    const ta = document.createElement('textarea');
    ta.value = textContent;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.error('[Clipboard] Lỗi sao chép:', e);
    return false;
  }
}

async function copyZaloReportHandler() {
  const editor = document.getElementById('zalo-message-editor');
  const textarea = document.getElementById('textarea-zalo-message');
  if (!editor && !textarea) return;

  const htmlContent = editor ? editor.innerHTML : '';
  const textContent = ((textarea && textarea.value) ? textarea.value : (editor ? editor.innerText : '')).replace(/\n{3,}/g, '\n\n');

  const ok = await copyToClipboard(htmlContent, textContent);
  if (ok) {
    toast.success('Đã sao chép nội dung báo bài.');
    const feedback = document.getElementById('zalo-copy-feedback');
    if (feedback) {
      feedback.textContent = 'Đã sao chép nội dung báo bài!';
      feedback.style.display = 'inline-block';
      setTimeout(() => { feedback.style.display = 'none'; }, 2500);
    }
  } else {
    toast.warning('Không thể tự động sao chép. Vui lòng chọn và copy nội dung bằng Ctrl+C.');
  }
}

async function copyZaloHomeworkHandler() {
  const editor = document.getElementById('zalo-homework-editor');
  const textarea = document.getElementById('textarea-zalo-homework');
  if (!editor && !textarea) return;

  const htmlContent = editor ? editor.innerHTML : '';
  const textContent = ((textarea && textarea.value) ? textarea.value : (editor ? editor.innerText : '')).replace(/\n{3,}/g, '\n\n');

  const ok = await copyToClipboard(htmlContent, textContent);
  if (ok) {
    toast.success('Đã sao chép BTVN.');
    const feedback = document.getElementById('zalo-copy-hw-feedback');
    if (feedback) {
      feedback.textContent = 'Đã sao chép BTVN!';
      feedback.style.display = 'inline-block';
      setTimeout(() => { feedback.style.display = 'none'; }, 2500);
    }
  } else {
    toast.warning('Không thể tự động sao chép. Vui lòng chọn và copy nội dung bằng Ctrl+C.');
  }
}

async function copyZaloAllHandler() {
  const sessEditor = document.getElementById('zalo-message-editor');
  const sessTextarea = document.getElementById('textarea-zalo-message');
  const hwEditor = document.getElementById('zalo-homework-editor');
  const hwTextarea = document.getElementById('textarea-zalo-homework');

  const sessHtml = sessEditor ? sessEditor.innerHTML : '';
  const sessText = (sessTextarea && sessTextarea.value) ? sessTextarea.value : (sessEditor ? sessEditor.innerText : '');

  const hwHtml = hwEditor ? hwEditor.innerHTML : '';
  const hwText = (hwTextarea && hwTextarea.value) ? hwTextarea.value : (hwEditor ? hwEditor.innerText : '');

  const mergedHtml = hwHtml
    ? `${sessHtml}<p style="margin: 0px; line-height: 1.4;"><br></p>${hwHtml}`
    : sessHtml;

  const mergedText = (hwText
    ? `${sessText}\n\n${hwText}`
    : sessText).replace(/\n{3,}/g, '\n\n');

  const ok = await copyToClipboard(mergedHtml, mergedText);
  if (ok) {
    toast.success('Đã sao chép tất cả (Nội dung + BTVN).');
    const feedback = document.getElementById('zalo-copy-all-feedback');
    if (feedback) {
      feedback.textContent = 'Đã sao chép tất cả (Nội dung + BTVN)!';
      feedback.style.display = 'inline-block';
      setTimeout(() => { feedback.style.display = 'none'; }, 2500);
    }
  } else {
    toast.warning('Không thể tự động sao chép. Vui lòng chọn và copy nội dung bằng Ctrl+C.');
  }
}
