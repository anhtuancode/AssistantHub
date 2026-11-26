/**
 * Main World Script (runs in world: "MAIN" on lms.mindx.edu.vn)
 * Đọc __reactFiber$ trên DOM elements để trích xuất classId, slotId, studentId thực tế.
 */
(() => {
  if (window.__mindxMainWorldInjected) return;
  window.__mindxMainWorldInjected = true;

  function findFiber(el) {
    if (!el) return null;
    try {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      return key ? el[key] : null;
    } catch (_) {
      return null;
    }
  }

  function extractClassesFiber() {
    const rows = Array.from(document.querySelectorAll('[data-mindx-row]'));
    return rows.map(row => {
      const idx = parseInt(row.getAttribute('data-mindx-row'), 10);
      let realRowData = null;
      try {
        let fiber = findFiber(row);
        while (fiber) {
          if (fiber.memoizedProps && fiber.memoizedProps.row) {
            realRowData = fiber.memoizedProps.row;
            break;
          }
          fiber = fiber.return;
        }
      } catch (_) {}

      if (!realRowData) return { idx, found: false };

      let teacherName = '';
      if (realRowData.teachers && realRowData.teachers.length > 0 && realRowData.teachers[0].teacher) {
        teacherName = realRowData.teachers[0].teacher.fullName || realRowData.teachers[0].teacher.username || '';
      }

      return {
        idx,
        found: true,
        realId: realRowData.id || realRowData._id || null,
        classCode: realRowData.name || '',
        courseName: realRowData.course ? (realRowData.course.name || '') : '',
        teacherName,
        fiberStatus: realRowData.status ? String(realRowData.status).trim() : '',
        slotsCount: realRowData.slots ? realRowData.slots.length : (realRowData.numberOfSessions || 14)
      };
    });
  }

  function extractSessionsFiber() {
    const cards = Array.from(document.querySelectorAll('[data-mindx-sess]'));
    return cards.map(card => {
      const idx = parseInt(card.getAttribute('data-mindx-sess'), 10);
      let slotId = null;
      try {
        let fiber = findFiber(card);
        while (fiber) {
          if (fiber.memoizedProps && (fiber.memoizedProps.slot || fiber.memoizedProps.session)) {
            const s = fiber.memoizedProps.slot || fiber.memoizedProps.session;
            slotId = s.id || s._id || null;
            break;
          }
          fiber = fiber.return;
        }
      } catch (_) {}
      return { idx, slotId };
    });
  }

  function extractStudentsFiber() {
    const rows = Array.from(document.querySelectorAll('[data-mindx-st]'));
    return rows.map(row => {
      const idx = parseInt(row.getAttribute('data-mindx-st'), 10);
      let realStudentId = null;
      try {
        let fiber = findFiber(row);
        while (fiber) {
          if (fiber.memoizedProps && fiber.memoizedProps.row) {
            const r = fiber.memoizedProps.row;
            realStudentId = r.id || r._id || (r.student && (r.student.id || r.student._id)) || null;
            break;
          }
          fiber = fiber.return;
        }
      } catch (_) {}
      return { idx, realStudentId };
    });
  }

  function clickClassRowInMainWorld() {
    const row = document.querySelector('[data-mindx-select-row="true"]');
    if (!row) return { clicked: false, reason: 'ROW_NOT_FOUND' };

    const candidates = [
      ...Array.from(row.querySelectorAll('a, button, [role="button"]')),
      ...Array.from(row.querySelectorAll('td')),
      row
    ];

    let reactTarget = null;
    for (const el of candidates) {
      let fiber = findFiber(el);
      let depth = 0;
      while (fiber && depth < 6) {
        if (fiber.memoizedProps && typeof fiber.memoizedProps.onClick === 'function') {
          reactTarget = el;
          break;
        }
        fiber = fiber.return;
        depth++;
      }
      if (reactTarget) break;
    }

    const target = reactTarget || row.querySelector('td:nth-child(2)') || row.querySelector('td') || row;
    target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });

    const eventInit = { bubbles: true, cancelable: true, view: window };
    target.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    target.dispatchEvent(new MouseEvent('mousedown', eventInit));
    target.dispatchEvent(new MouseEvent('mouseup', eventInit));
    target.dispatchEvent(new MouseEvent('click', eventInit));

    return { clicked: true, foundReactOnClick: Boolean(reactTarget), tag: target.tagName };
  }

  function navigateClassViaSpa(classId) {
    const encodedId = encodeURIComponent(`"${classId}"`);
    const targetPath = `/admin/classes?tab=0&id=${encodedId}`;
    window.history.pushState({}, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return { navigated: true, targetPath };
  }

  window.addEventListener('MINDX_MAIN_WORLD_REQ', (event) => {
    const { reqId, action, payload } = event.detail || {};
    let result = null;
    try {
      if (action === 'GET_CLASSES_FIBER') {
        result = extractClassesFiber();
      } else if (action === 'GET_SESSIONS_FIBER') {
        result = extractSessionsFiber();
      } else if (action === 'GET_STUDENTS_FIBER') {
        result = extractStudentsFiber();
      } else if (action === 'CLICK_CLASS_ROW') {
        result = clickClassRowInMainWorld();
      } else if (action === 'SPA_NAVIGATE_CLASS') {
        result = navigateClassViaSpa(payload && payload.classId);
      }
    } catch (err) {
      result = { error: err.message };
    }
    window.dispatchEvent(new CustomEvent('MINDX_MAIN_WORLD_RES', {
      detail: { reqId, result }
    }));
  });
})();
