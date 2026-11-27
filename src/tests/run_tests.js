/**
 * Automated Test Suite for MindX Teacher Assistant
 * Covers: MutationObserver waitForCondition, SPA pushState + fallback,
 * background tab active:false, 30-min Cache (classes & sessions), and CSP compliance.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}\n  -> ${err.stack || err.message}`);
    failed++;
  }
}

async function main() {
  // 1. Test MutationObserver in extension/content-lms.js
  await runTest('MutationObserver waitForCondition resolves on DOM mutation and disconnects', async () => {
    const code = fs.readFileSync(path.join(ROOT, 'extension/content-lms.js'), 'utf8');
    let onMessageListener = null;
    let disconnectCalls = 0;
    let observeCalls = 0;
    let observerCallback = null;
    let drawerVisible = false;

    class MockMutationObserver {
      constructor(cb) {
        observerCallback = cb;
      }
      observe(target, opts) {
        observeCalls++;
        assert.strictEqual(opts.childList, true);
        assert.strictEqual(opts.subtree, true);
        assert.strictEqual(opts.attributes, true);
      }
      disconnect() {
        disconnectCalls++;
      }
    }

    const mockDrawer = {
      innerText: 'Thông tin chung Nhận xét Điểm danh',
      getBoundingClientRect: () => ({ width: 500, height: 600 }),
      querySelector: () => ({ innerText: 'PVT-ROB-ARMA26' })
    };

    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Date,
      Math,
      Map,
      Set,
      Array,
      Object,
      String,
      Number,
      Boolean,
      MutationObserver: MockMutationObserver,
      CustomEvent: class CustomEvent { constructor(t, d) { this.type = t; this.detail = d?.detail; } },
      window: {
        location: { href: 'https://lms.mindx.edu.vn/admin/classes' },
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
      },
      document: {
        body: {},
        documentElement: {},
        querySelector: (sel) => (sel === '.MuiDrawer-modal' && drawerVisible ? mockDrawer : null),
        querySelectorAll: () => []
      },
      chrome: {
        runtime: {
          sendMessage: () => Promise.resolve({}),
          onMessage: {
            addListener: (fn) => { onMessageListener = fn; }
          }
        }
      }
    };
    sandbox.window.window = sandbox.window;

    vm.runInNewContext(code, sandbox);
    assert.strictEqual(typeof onMessageListener, 'function');

    // Trigger LMS_VERIFY_CLASS_DRAWER while drawer is not yet in DOM
    const resultPromise = new Promise((resolve) => {
      onMessageListener({ action: 'LMS_VERIFY_CLASS_DRAWER', classId: 'cls-1', classCode: 'ROB-1' }, {}, resolve);
    });

    // Wait a tick for observer.observe to be called
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(observeCalls, 1);
    assert.strictEqual(disconnectCalls, 0);

    // Simulate DOM mutation adding the drawer
    drawerVisible = true;
    observerCallback([]);

    const res = await resultPromise;
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.context.classId, 'cls-1');
    assert.strictEqual(disconnectCalls, 1);
  });

  await runTest('MutationObserver waitForCondition disconnects on timeout', async () => {
    const code = fs.readFileSync(path.join(ROOT, 'extension/content-lms.js'), 'utf8');
    let onMessageListener = null;
    let disconnectCalls = 0;

    class MockMutationObserver {
      constructor() {}
      observe() {}
      disconnect() { disconnectCalls++; }
    }

    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Date,
      Math,
      Map,
      Set,
      Array,
      Object,
      String,
      Number,
      Boolean,
      MutationObserver: MockMutationObserver,
      CustomEvent: class CustomEvent { constructor(t, d) { this.type = t; this.detail = d?.detail; } },
      window: {
        location: { href: 'https://lms.mindx.edu.vn/admin/classes' },
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
      },
      document: {
        body: {},
        documentElement: {},
        querySelector: () => null,
        querySelectorAll: () => []
      },
      chrome: {
        runtime: {
          sendMessage: () => Promise.resolve({}),
          onMessage: { addListener: (fn) => { onMessageListener = fn; } }
        }
      }
    };

    // Patch waitForCondition timeout test via LMS_SPA_SELECT_CLASS (3.5s) -> use short fake timer or verify disconnect
    // Here we test SPA_NAVIGATE_CLASS + timeout using fast setTimeout override
    const realSetTimeout = setTimeout;
    sandbox.setTimeout = (fn, ms) => realSetTimeout(fn, ms > 50 ? 30 : ms);

    vm.runInNewContext(code, sandbox);
    const res = await new Promise((resolve) => {
      onMessageListener({ action: 'LMS_SPA_SELECT_CLASS', classId: 'cls-timeout', classCode: 'ROB-T' }, {}, resolve);
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(disconnectCalls, 1);
  });

  // 2. Test SPA pushState in extension/main-world.js
  await runTest('main-world.js SPA_NAVIGATE_CLASS executes pushState and dispatches popstate', async () => {
    const code = fs.readFileSync(path.join(ROOT, 'extension/main-world.js'), 'utf8');
    const listeners = {};
    const pushStateCalls = [];
    const dispatchedEvents = [];

    const sandbox = {
      console,
      CustomEvent: class CustomEvent { constructor(t, d) { this.type = t; this.detail = d?.detail; } },
      PopStateEvent: class PopStateEvent { constructor(t) { this.type = t; } },
      document: { querySelectorAll: () => [], querySelector: () => null },
      window: {
        history: {
          pushState: (state, title, url) => pushStateCalls.push({ state, title, url })
        },
        addEventListener: (ev, fn) => {
          listeners[ev] = listeners[ev] || [];
          listeners[ev].push(fn);
        },
        dispatchEvent: (ev) => {
          dispatchedEvents.push(ev);
          (listeners[ev.type] || []).forEach(fn => fn(ev));
        }
      }
    };

    vm.runInNewContext(code, sandbox);

    let response = null;
    listeners['MINDX_MAIN_WORLD_RES'] = [(e) => { response = e.detail.result; }];
    sandbox.window.dispatchEvent(new sandbox.CustomEvent('MINDX_MAIN_WORLD_REQ', {
      detail: { reqId: 'r1', action: 'SPA_NAVIGATE_CLASS', payload: { classId: 'abc123' } }
    }));

    assert.strictEqual(pushStateCalls.length, 1);
    assert.strictEqual(pushStateCalls[0].url, '/admin/classes?tab=0&id=%22abc123%22');
    assert.ok(dispatchedEvents.some(e => e.type === 'popstate'));
    assert.strictEqual(response.navigated, true);
  });

  // 3. Test background.js SPA pushState + fallback + active:false
  await runTest('background.js uses SPA pushState when on /admin/classes and falls back with active:false on failure', async () => {
    const code = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
    let bgMessageListener = null;
    const tabUpdates = [];
    const tabCreates = [];
    let spaShouldSucceed = true;

    const storageData = {};
    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      Promise,
      Date,
      URL,
      chrome: {
        action: { onClicked: { addListener: () => {} } },
        runtime: {
          getURL: (p) => `chrome-extension://id/${p}`,
          onMessage: { addListener: (fn) => { bgMessageListener = fn; } }
        },
        storage: {
          local: {
            get: async (k) => ({ [k]: storageData[k] }),
            set: async (obj) => Object.assign(storageData, obj)
          }
        },
        tabs: {
          query: async () => [{ id: 101, url: 'https://lms.mindx.edu.vn/admin/classes', status: 'complete' }],
          get: async (id) => ({ id, url: 'https://lms.mindx.edu.vn/admin/classes', status: 'complete' }),
          create: async (opts) => { tabCreates.push(opts); return { id: 102, ...opts }; },
          update: async (id, opts) => { tabUpdates.push({ id, opts }); return { id, ...opts }; },
          onUpdated: { addListener: () => {}, removeListener: () => {} },
          sendMessage: async (tabId, payload) => {
            if (payload.action === 'LMS_SPA_SELECT_CLASS') {
              return spaShouldSucceed
                ? { success: true, context: { classId: payload.classId } }
                : { success: false, error: 'Timeout' };
            }
            if (payload.action === 'LMS_VERIFY_CLASS_DRAWER') {
              return { success: true, context: { classId: payload.classId } };
            }
            return { success: true };
          }
        },
        windows: { update: async () => {} },
        scripting: { executeScript: async () => {} }
      }
    };

    vm.runInNewContext(code, sandbox);

    // Case 1: SPA succeeds -> zero tabs.update
    const res1 = await new Promise(resolve => {
      bgMessageListener({ type: 'API_SELECT_CLASS', payload: { classId: 'c1', classCode: 'ROB-1' } }, {}, resolve);
    });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(tabUpdates.length, 0);

    // Case 2: SPA fails -> falls back to tabs.update with active: false
    spaShouldSucceed = false;
    const res2 = await new Promise(resolve => {
      bgMessageListener({ type: 'API_SELECT_CLASS', payload: { classId: 'c2', classCode: 'ROB-2' } }, {}, resolve);
    });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(tabUpdates.length, 1);
    assert.strictEqual(tabUpdates[0].opts.active, false);
    assert.ok(tabUpdates[0].opts.url.includes('id=%22c2%22'));
  });

  // 4. Test Cache in js/services/apiBridge.js
  await runTest('apiBridge.js caches classes and sessions for 30 minutes and respects forceRefresh', async () => {
    const store = {};
    let bgCalls = [];

    global.chrome = {
      storage: {
        local: {
          get: async (k) => ({ [k]: store[k] }),
          set: async (obj) => Object.assign(store, obj)
        }
      },
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          bgCalls.push(msg);
          if (msg.type === 'API_GET_CLASSES') {
            cb({ success: true, classes: [{ id: 'c1', classCode: 'ROB-1' }] });
          } else if (msg.type === 'API_GET_SESSIONS') {
            cb({ success: true, sessions: [{ sessionNumber: 1, title: 'Buổi 1' }] });
          } else {
            cb({ success: true });
          }
        }
      }
    };

    const rawBridge = fs.readFileSync(path.join(ROOT, 'js/services/apiBridge.js'), 'utf8')
      .replace("import { geminiClient } from './geminiClient.js';", 'const geminiClient = {};')
      .replace("import { teacherPointClient } from './teacherPointClient.js';", 'const teacherPointClient = {};')
      .replace("import { curriculumService } from './curriculum.js';", 'const curriculumService = {};');
    const dataUrl = `data:text/javascript;base64,${Buffer.from(rawBridge, 'utf8').toString('base64')}`;
    const {
      apiRequest,
      getCachedClasses,
      setCachedClasses,
      getCachedSessions,
      setCachedSessions,
      CACHE_TTL_MS
    } = await import(dataUrl);

    assert.strictEqual(CACHE_TTL_MS, 30 * 60 * 1000);

    // First call: cache miss -> calls background & writes cache
    const cRes1 = await apiRequest('/api/automation/classes?status=running');
    assert.strictEqual(cRes1.success, true);
    assert.strictEqual(cRes1.fromCache, false);
    assert.strictEqual(bgCalls.length, 1);

    // Second call: cache hit -> 0 background calls
    const cRes2 = await apiRequest('/api/automation/classes?status=running');
    assert.strictEqual(cRes2.success, true);
    assert.strictEqual(cRes2.fromCache, true);
    assert.strictEqual(bgCalls.length, 1);

    // forceRefresh=1 -> calls background again
    const cRes3 = await apiRequest('/api/automation/classes?status=running&forceRefresh=1');
    assert.strictEqual(cRes3.fromCache, false);
    assert.strictEqual(bgCalls.length, 2);

    // Expired cache (> 30 min) -> returns null
    await setCachedClasses([{ id: 'old' }], Date.now() - (31 * 60 * 1000));
    const expired = await getCachedClasses();
    assert.strictEqual(expired, null);

    // Sessions cache per classId
    const sRes1 = await apiRequest('/api/automation/sessions?classId=c1');
    assert.strictEqual(sRes1.success, true);
    assert.strictEqual(sRes1.fromCache, false);
    assert.strictEqual(bgCalls.length, 3);

    const sRes2 = await apiRequest('/api/automation/sessions?classId=c1');
    assert.strictEqual(sRes2.fromCache, true);
    assert.strictEqual(bgCalls.length, 3);

    // Expired session cache
    await setCachedSessions('c1', [{ sessionNumber: 1 }], Date.now() - (31 * 60 * 1000));
    assert.strictEqual(await getCachedSessions('c1'), null);

    // Stale 0-based session cache (Buổi 0) should be invalidated automatically
    await setCachedSessions('c-zero', [{ sessionNumber: 0, title: 'Buổi 0' }], Date.now());
    assert.strictEqual(await getCachedSessions('c-zero'), null);
  });

  // 5. CSP Manifest V3 check (no inline onclick="..." attributes in HTML or template strings)
  await runTest('CSP Manifest V3: no inline onclick attributes in HTML/JS files', async () => {
    const files = ['index.html', 'js/tabs/classes.js', 'js/tabs/review.js', 'extension/content-lms.js'];
    for (const f of files) {
      const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.strictEqual(/\bonclick\s*=\s*["']/i.test(content), false, `Found inline onclick= in ${f}`);
    }
  });

  // 6. Zero-Tab GraphQL Client (extension/lmsQueries.js + extension/lmsApiClient.js)
  await runTest('lmsApiClient.js executes GetClasses, GetClassById, FindAllWithClass, and UpdateSlotComment (summary + studentComment)', async () => {
    const queries = require(path.join(ROOT, 'extension/lmsQueries.js'));
    assert.ok(queries.GET_CLASSES_QUERY.includes('query GetClasses'));
    assert.ok(queries.GET_CLASS_BY_ID_QUERY.includes('query GetClassById'));
    assert.ok(queries.FIND_ALL_WITH_CLASS_QUERY.includes('query FindAllWithClass'));
    assert.ok(queries.UPDATE_SLOT_COMMENT_MUTATION.includes('mutation UpdateSlotComment'));

    const sessionStore = {};
    const graphqlCalls = [];

    global.chrome = {
      storage: {
        session: {
          get: async (k) => ({ [k]: sessionStore[k] }),
          set: async (obj) => Object.assign(sessionStore, obj)
        }
      }
    };

    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      graphqlCalls.push({ url, operationName: body.operationName, variables: body.variables });

      if (body.operationName === 'FindInfoInRoleById') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { users: { findInfoInRoleById: { info: { id: 'teacher-1' }, role: 'TEACHER' } } } })
        };
      }
      if (body.operationName === 'GetClasses') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              classes: {
                data: [
                  {
                    id: 'cls-1',
                    name: 'PVT-ROB-ARMA26',
                    status: 'RUNNING',
                    numberOfSessions: 14,
                    course: { id: 'c1', name: 'Robotics ARM A', shortName: 'ARMA' },
                    teachers: [{ teacher: { fullName: 'Nguyễn Anh Tuấn' } }],
                    slots: []
                  },
                  {
                    id: 'cls-2',
                    name: 'OLD-CLASS',
                    status: 'FINISHED',
                    numberOfSessions: 14,
                    course: { id: 'c2', name: 'Old', shortName: 'OLD' },
                    teachers: [],
                    slots: []
                  }
                ]
              }
            }
          })
        };
      }
      if (body.operationName === 'GetClassById') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              classesById: {
                id: 'cls-1',
                name: 'PVT-ROB-ARMA26',
                classSites: [{ _id: 'site-1', name: 'PVT' }],
                courseProcessId: 'cp-1',
                courseProcess: {
                  id: 'cp-1',
                  defaultCommentAreas: [{ id: 'area-1', type: 'CONTENT', fieldName: 'content' }]
                },
                slots: [
                  {
                    _id: 'slot-3',
                    index: 3,
                    date: '2026-11-20T10:00:00.000Z',
                    summary: '<p>Bài 3: OOP</p>',
                    studentAttendance: [
                      {
                        _id: 'att-1',
                        status: 'ATTENDED',
                        comment: '<p>Học tốt</p>',
                        sendCommentStatus: 'SENT',
                        commentStatus: { status: 'APPROVED' },
                        student: { id: 'st-1', fullName: 'Nguyễn Minh An' }
                      },
                      {
                        _id: 'att-2',
                        status: 'ABSENT',
                        comment: '',
                        student: { id: 'st-2', fullName: 'Trần Bảo Bình' }
                      }
                    ]
                  }
                ],
                students: []
              }
            }
          })
        };
      }
      if (body.operationName === 'FindAllWithClass') {
        return { ok: true, status: 200, json: async () => ({ data: { findAllWithClass: [] } }) };
      }
      if (body.operationName === 'UpdateSlotComment') {
        return { ok: true, status: 200, json: async () => ({ data: { classes: { updateSlotComment: { id: 'cls-1', slots: [] } } } }) };
      }
      throw new Error(`Unexpected op: ${body.operationName}`);
    };

    const client = require(path.join(ROOT, 'extension/lmsApiClient.js'));
    client.resetContexts();

    // Create a valid mock JWT (exp 1h in the future)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const mockJwt = `${header}.${payload}.sig`;
    await client.saveJwtToken(mockJwt);

    // 1. SCAN_CLASSES
    const clsRes = await client.scanClasses({ status: 'running' });
    assert.strictEqual(clsRes.success, true);
    assert.strictEqual(clsRes.classes.length, 1);
    assert.strictEqual(clsRes.classes[0].classCode, 'PVT-ROB-ARMA26');

    // 2. SELECT_CLASS & SCAN_SESSIONS
    const sessRes = await client.selectClassAndScanSessions('cls-1');
    assert.strictEqual(sessRes.success, true);
    assert.strictEqual(sessRes.sessions.length, 1);
    assert.strictEqual(sessRes.sessions[0].sessionNumber, 3);
    assert.strictEqual(sessRes.sessions[0].isAvailable, true);

    // 3. SELECT_SESSION & READ_SUMMARY_AND_STUDENTS
    const readRes = await client.selectSessionAndReadData(3);
    assert.strictEqual(readRes.success, true);
    assert.strictEqual(readRes.summary, 'Bài 3: OOP');
    assert.strictEqual(readRes.students.length, 2);
    assert.strictEqual(readRes.students[0].attendance, 'PRESENT');
    assert.strictEqual(readRes.students[1].attendance, 'ABSENT');

    // 4. SAVE_SUMMARY
    const sumSave = await client.saveSummary({ content: 'Tóm tắt mới' });
    assert.strictEqual(sumSave.success, true);
    const sumCall = graphqlCalls.find(c => c.operationName === 'UpdateSlotComment' && c.variables.payload.summary);
    assert.ok(sumCall);
    assert.strictEqual(sumCall.variables.payload.summary, '<p>Tóm tắt mới</p>');
    assert.strictEqual(sumCall.variables.payload.classSiteId, 'site-1');

    // 5. SAVE_SINGLE_COMMENT
    const stSave = await client.saveSingleComment({ studentName: 'Nguyễn Minh An', commentText: 'Rất tích cực' });
    assert.strictEqual(stSave.success, true);
    assert.strictEqual(stSave.status, 'VERIFIED');
    const stCall = graphqlCalls.find(c => c.operationName === 'UpdateSlotComment' && c.variables.payload.studentComment);
    assert.ok(stCall);
    assert.strictEqual(stCall.variables.payload.studentComment.studentAttendanceId, 'att-1');
    assert.strictEqual(stCall.variables.payload.studentComment.byAreas[0].commentAreaId, 'area-1');
  });

  // 7. Zero-based slot.index mapping (PVT-ROB-ARMI24: 21/11 -> #11, 28/11 -> #12)
  await runTest('lmsApiClient.js maps 0-based slot.index (index 10 on 21/11 -> Buổi 11) and saves to exact slotId & sessionNumber', async () => {
    const updatePayloads = [];
    const zeroBasedSlots = Array.from({ length: 12 }, (_, idx) => {
      if (idx === 10) {
        return {
          _id: 'slot-11-id',
          index: 10,
          date: '2026-11-21T09:00:00.000Z',
          summary: '<p>Buổi 11</p>',
          studentAttendance: [
            { _id: 'att-khang', status: 'ATTENDED', comment: '', student: { id: 'st-khang', fullName: 'Phạm Trần Phúc Khang' } },
            { _id: 'att-phat', status: 'ABSENT', comment: '', student: { id: 'st-phat', fullName: 'Nguyễn Tiến An Phát' } }
          ]
        };
      }
      if (idx === 11) {
        return {
          _id: 'slot-12-id',
          index: 11,
          date: '2026-11-28T09:00:00.000Z',
          summary: '',
          studentAttendance: []
        };
      }
      return {
        _id: `slot-${idx + 1}-id`,
        index: idx,
        date: `2026-09-${String(idx + 1).padStart(2, '0')}T09:00:00.000Z`,
        summary: '',
        studentAttendance: []
      };
    });

    // Reverse order to verify sorting by index
    const shuffledSlots = [...zeroBasedSlots].reverse();

    global.fetch = async (url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.operationName === 'GetClassById') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              classesById: {
                id: 'cls-armi24',
                name: 'PVT-ROB-ARMI24',
                classSites: [{ _id: 'site-armi24', name: 'PVT' }],
                courseProcessId: 'cp-armi24',
                courseProcess: { id: 'cp-armi24', defaultCommentAreas: [{ id: 'area-armi24', type: 'CONTENT' }] },
                slots: shuffledSlots,
                students: []
              }
            }
          })
        };
      }
      if (body.operationName === 'FindAllWithClass') {
        return { ok: true, status: 200, json: async () => ({ data: { findAllWithClass: [] } }) };
      }
      if (body.operationName === 'UpdateSlotComment') {
        updatePayloads.push(body.variables.payload);
        return { ok: true, status: 200, json: async () => ({ data: { classes: { updateSlotComment: { id: 'cls-armi24', slots: [] } } } }) };
      }
      throw new Error(`Unexpected op: ${body.operationName}`);
    };

    const client = require(path.join(ROOT, 'extension/lmsApiClient.js'));
    client.resetContexts();

    const sessRes = await client.selectClassAndScanSessions('cls-armi24');
    assert.strictEqual(sessRes.sessions.length, 12);

    const session11 = sessRes.sessions.find(s => s.slotId === 'slot-11-id');
    const session12 = sessRes.sessions.find(s => s.slotId === 'slot-12-id');
    assert.ok(session11);
    assert.ok(session12);
    assert.strictEqual(session11.sessionNumber, 11);
    assert.strictEqual(session11.title, 'Buổi 11 (21/11)');
    assert.strictEqual(session12.sessionNumber, 12);
    assert.strictEqual(session12.title, 'Buổi 12 (28/11)');

    const read11 = await client.selectSessionAndReadData(11);
    assert.strictEqual(read11.sessionNumber, 11);
    assert.strictEqual(read11.students[0].name, 'Phạm Trần Phúc Khang');

    // Simulate MV3 Service Worker sleep (clear in-memory contexts)
    client.resetContexts();

    await client.saveSummary({ content: 'Tóm tắt buổi 11' });
    await client.saveSingleComment({ studentName: 'Phạm Trần Phúc Khang', commentText: 'Nhận xét buổi 11' });

    assert.strictEqual(updatePayloads.length, 2);
    assert.strictEqual(updatePayloads[0].slotId, 'slot-11-id');
    assert.strictEqual(updatePayloads[0].sessionNumber, 11);
    assert.strictEqual(updatePayloads[1].slotId, 'slot-11-id');
    assert.strictEqual(updatePayloads[1].sessionNumber, 11);
  });

  // 8. Comment Styles Test 1 — Persistence (Lưu & Đọc Custom)
  await runTest('CommentStyles Test 1: saveCommentStyleConfig & loadCommentStyleConfig persist custom mode and bullets format across reload', async () => {
    const localMap = {};
    const chromeMap = {};
    global.localStorage = {
      getItem: (k) => (k in localMap ? localMap[k] : null),
      setItem: (k, v) => { localMap[k] = String(v); }
    };
    global.chrome = {
      storage: {
        local: {
          get: async (k) => ({ [k]: chromeMap[k] }),
          set: async (obj) => Object.assign(chromeMap, obj)
        }
      }
    };

    const rawStyles = fs.readFileSync(path.join(ROOT, 'js/config/commentStyles.js'), 'utf8');
    const url1 = `data:text/javascript;base64,${Buffer.from(rawStyles, 'utf8').toString('base64')}`;
    const mod1 = await import(url1);

    await mod1.saveCommentStyleConfig({
      mode: 'custom',
      customCriteria: 'Thái độ học tập, Kỹ năng lắp ráp, Kỹ năng lập trình',
      outputFormat: 'bullets'
    });

    // Simulate page reload by importing a fresh module instance (bust URL with comment)
    const url2 = `data:text/javascript;base64,${Buffer.from(rawStyles + '\n// reload', 'utf8').toString('base64')}`;
    const mod2 = await import(url2);
    const loaded = await mod2.loadCommentStyleConfig();

    assert.strictEqual(loaded.mode, 'custom');
    assert.strictEqual(loaded.customCriteria, 'Thái độ học tập, Kỹ năng lắp ráp, Kỹ năng lập trình');
    assert.strictEqual(loaded.outputFormat, 'bullets');
    assert.strictEqual(chromeMap.commentStyleConfig.mode, 'custom');
    assert.strictEqual(JSON.parse(localMap.commentStyleConfig).outputFormat, 'bullets');
  });

  // 9. Comment Styles Test 2 — buildStylePrompt() Preset & Concise
  await runTest('CommentStyles Test 2: buildStylePrompt generates distinct prompts for 5 presets and enforces length on concise', async () => {
    const rawStyles = fs.readFileSync(path.join(ROOT, 'js/config/commentStyles.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(rawStyles, 'utf8').toString('base64')}`;
    const { COMMENT_PRESETS, buildStylePrompt } = await import(url);

    assert.strictEqual(COMMENT_PRESETS.length, 5);
    const prompts = new Set();
    for (const preset of COMMENT_PRESETS) {
      const prompt = buildStylePrompt({ mode: 'preset', presetId: preset.id });
      assert.ok(prompt.includes(preset.name));
      assert.ok(prompt.includes('KHÔNG dùng ký tự Markdown'));
      prompts.add(prompt);
    }
    assert.strictEqual(prompts.size, 5);

    const concisePrompt = buildStylePrompt({ mode: 'preset', presetId: 'concise' });
    assert.ok(concisePrompt.includes('2–3 câu'));
    assert.ok(concisePrompt.includes('dưới 50 từ'));
  });

  // 10. Comment Styles Test 3 — buildStylePrompt() Custom Bullets, Paragraph & Empty Fallback
  await runTest('CommentStyles Test 3: buildStylePrompt handles custom bullets, custom paragraph, and empty fallback', async () => {
    const rawStyles = fs.readFileSync(path.join(ROOT, 'js/config/commentStyles.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(rawStyles, 'utf8').toString('base64')}`;
    const { buildStylePrompt } = await import(url);

    const bullets = buildStylePrompt({
      mode: 'custom',
      customCriteria: 'Thái độ học tập, Kỹ năng lắp ráp, Kỹ năng lập trình',
      outputFormat: 'bullets'
    });
    assert.ok(bullets.includes('- Thái độ học tập:'));
    assert.ok(bullets.includes('- Kỹ năng lắp ráp:'));
    assert.ok(bullets.includes('- Kỹ năng lập trình:'));

    const para = buildStylePrompt({
      mode: 'custom',
      customCriteria: 'Thái độ học tập, Kỹ năng lắp ráp, Kỹ năng lập trình',
      outputFormat: 'paragraph'
    });
    assert.ok(para.includes('1. Thái độ học tập'));
    assert.ok(para.includes('1 đoạn văn liền mạch'));

    const fallback = buildStylePrompt({ mode: 'custom', customCriteria: '   ', outputFormat: 'bullets' });
    assert.ok(fallback.includes('Chuẩn sư phạm'));
  });

  // 11. Comment Styles Test 4 — Style Signature & Regeneration Trigger
  await runTest('CommentStyles Test 4: getStyleSignature changes whenever mode, presetId, customCriteria, or outputFormat changes', async () => {
    const rawStyles = fs.readFileSync(path.join(ROOT, 'js/config/commentStyles.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(rawStyles, 'utf8').toString('base64')}`;
    const { getStyleSignature } = await import(url);

    const s1 = getStyleSignature({ mode: 'preset', presetId: 'standard', customCriteria: '', outputFormat: 'paragraph' });
    const s2 = getStyleSignature({ mode: 'preset', presetId: 'concise', customCriteria: '', outputFormat: 'paragraph' });
    const s3 = getStyleSignature({ mode: 'custom', presetId: 'concise', customCriteria: 'A, B', outputFormat: 'paragraph' });
    const s4 = getStyleSignature({ mode: 'custom', presetId: 'concise', customCriteria: 'A, B', outputFormat: 'bullets' });
    const s5 = getStyleSignature({ mode: 'custom', presetId: 'concise', customCriteria: 'A, B, C', outputFormat: 'bullets' });

    const unique = new Set([s1, s2, s3, s4, s5]);
    assert.strictEqual(unique.size, 5);
  });

  // 12. Comment Styles Test 5 — End-to-End Gemini Payload & Strict No-Fallback Error Propagation
  await runTest('CommentStyles Test 5: GeminiClient sends apiKey, systemInstruction stylePrompt, custom criteria bullets, and throws instead of falling back', async () => {
    const rawStyles = fs.readFileSync(path.join(ROOT, 'js/config/commentStyles.js'), 'utf8');
    const stylesUrl = `data:text/javascript;base64,${Buffer.from(rawStyles, 'utf8').toString('base64')}`;

    const rawGemini = fs.readFileSync(path.join(ROOT, 'js/services/geminiClient.js'), 'utf8')
      .replace("from '../config/commentStyles.js'", `from '${stylesUrl}'`);
    const geminiUrl = `data:text/javascript;base64,${Buffer.from(rawGemini, 'utf8').toString('base64')}`;
    const { geminiClient } = await import(geminiUrl);

    let capturedBody = null;
    let capturedHeaders = null;
    global.fetch = async (url, opts) => {
      capturedHeaders = opts && opts.headers ? opts.headers : null;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: '- Thái độ học tập: Con tập trung tốt.\n- Kỹ năng lắp ráp: Con lắp chắc chắn.\n- Kỹ năng lập trình: Con lập trình đúng logic.'
              }]
            }
          }]
        })
      };
    };

    const multiLineSummary = '- Nội dung trọng tâm: Lắp ráp và điều khiển robot.\n- Kiến thức: VEX GO.';
    const result = await geminiClient.generateStudentComment(
      { name: 'Nguyễn Minh An', rating: 'Giỏi', note: 'Tập trung tốt', studentIndex: 0 },
      { classCode: 'PVT-ROB-ARMA26', title: 'Buổi 5', sessionNumber: 5, summary: multiLineSummary },
      'AIzaFakeKey123',
      'gemini-2.0-flash',
      {
        mode: 'custom',
        presetId: 'standard',
        customCriteria: 'Thái độ học tập, Kỹ năng lắp ráp, Kỹ năng lập trình',
        outputFormat: 'bullets'
      }
    );

    assert.strictEqual(capturedHeaders['x-goog-api-key'], 'AIzaFakeKey123');
    assert.ok(capturedBody.generationConfig.maxOutputTokens >= 2048);
    assert.ok(result.includes('- Thái độ học tập:'));
    assert.strictEqual(result.includes('Con có một buổi học thật sự nổi bật'), false);

    // Verify Gemini 3 Flash Preview uses 1-call SSE streaming JSON batch with thinkingLevel = 'MINIMAL' & progressive onStream
    let batchFetchCount = 0;
    let capturedStreamUrl = '';
    let capturedG3Config = null;
    const streamEvents = [];
    const sseChunks = [
      'data: {"candidates":[{"content":{"parts":[{"text":"[{\\"id\\":0,\\"comment\\":\\"- Thái độ: Con rất "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"tập trung.\\"},{\\"id\\":1,\\"comment\\":\\"- Thái độ: "}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"Con chăm chỉ.\\"},{\\"id\\":2,\\"comment\\":\\"- Thái độ: Con chủ động.\\"}]"}]}}]}\n\n'
    ];

    global.fetch = async (url, opts) => {
      batchFetchCount++;
      capturedStreamUrl = url;
      capturedG3Config = JSON.parse(opts.body).generationConfig;
      const encoder = new TextEncoder();
      let chunkIdx = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                if (chunkIdx < sseChunks.length) {
                  return { value: encoder.encode(sseChunks[chunkIdx++]), done: false };
                }
                return { value: undefined, done: true };
              }
            };
          }
        }
      };
    };

    const batchRes = await geminiClient.generateBatchComments(
      [
        { name: 'HS 1', attendance: 'PRESENT', rating: 'Giỏi' },
        { name: 'HS 2', attendance: 'ABSENT', rating: 'Khá' },
        { name: 'HS 3', attendance: 'PRESENT', rating: 'Khá' },
        { name: 'HS 4', attendance: 'PRESENT', rating: 'Giỏi' }
      ],
      { classCode: 'ROB-1', title: 'Buổi 1', sessionNumber: 1, summary: 'Test' },
      'AIzaFakeKey123',
      'gemini-3-flash-preview',
      { mode: 'custom', customCriteria: 'Thái độ', outputFormat: 'bullets' },
      null,
      (ev) => streamEvents.push(ev)
    );
    assert.strictEqual(batchFetchCount, 1, 'Expected exactly 1 Gemini API call for entire batch');
    assert.ok(capturedStreamUrl.includes(':streamGenerateContent?alt=sse'));
    assert.strictEqual(capturedG3Config.thinkingConfig.thinkingLevel, 'MINIMAL');
    assert.strictEqual(capturedG3Config.responseMimeType, 'application/json');
    assert.ok(streamEvents.some(e => e.batchId === 0 && !e.done && e.comment.includes('Con rất ')));
    assert.strictEqual(batchRes.length, 4);
    assert.strictEqual(batchRes[1].skipped, true);
    assert.strictEqual(batchRes[0].comment, '- Thái độ: Con rất tập trung.');
    assert.strictEqual(batchRes[2].comment, '- Thái độ: Con chăm chỉ.');
    assert.strictEqual(batchRes[3].comment, '- Thái độ: Con chủ động.');

    const sysText = capturedBody.systemInstruction.parts[0].text;
    const userText = capturedBody.contents[0].parts[0].text;
    assert.ok(sysText.includes('Thái độ học tập'));
    assert.ok(sysText.includes('Kỹ năng lắp ráp'));
    assert.ok(sysText.includes('Kỹ năng lập trình'));
    assert.ok(sysText.includes('- Thái độ học tập:'));
    assert.ok(userText.includes('- Thái độ học tập:'));
    assert.strictEqual(userText.includes('trong chủ đề "- Nội dung trọng tâm:'), false);

    // Verify missing API key throws an explicit error (no silent hardcoded fallback)
    await assert.rejects(
      () => geminiClient.generateStudentComment(
        { name: 'Trần Hữu Dương', rating: 'Khá', note: 'Tập trung tốt', studentIndex: 1 },
        { classCode: 'PVT-ROB-ARMA24', title: 'Buổi 12', sessionNumber: 12, summary: 'Giải đề cuối khóa' },
        '',
        'gemini-2.0-flash',
        { mode: 'custom', customCriteria: 'Thái độ học tập, Kỹ năng lắp ráp, Kỹ năng lập trình', outputFormat: 'bullets' }
      ),
      /API Key/i
    );

    // Verify API HTTP error throws instead of returning hardcoded template
    global.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'API key not valid' } })
    });
    await assert.rejects(
      () => geminiClient.generateStudentComment(
        { name: 'Trần Hữu Dương', rating: 'Khá', note: '', studentIndex: 1 },
        { classCode: 'PVT-ROB-ARMA24', title: 'Buổi 12', sessionNumber: 12, summary: 'Giải đề' },
        'AIzaInvalidKey',
        'gemini-2.0-flash',
        { mode: 'preset', presetId: 'standard' }
      ),
      /API key not valid/i
    );
  });

  // 14. Dynamic Gemini models.list & Auto model selection
  await runTest('GeminiClient listModels filters non-text models and auto-selects latest Flash model', async () => {
    const rawStyles = fs.readFileSync(path.join(ROOT, 'js/config/commentStyles.js'), 'utf8');
    const stylesUrl = `data:text/javascript;base64,${Buffer.from(rawStyles, 'utf8').toString('base64')}`;

    const rawGemini = fs.readFileSync(path.join(ROOT, 'js/services/geminiClient.js'), 'utf8')
      .replace("from '../config/commentStyles.js'", `from '${stylesUrl}'`);
    const geminiUrl = `data:text/javascript;base64,${Buffer.from(rawGemini, 'utf8').toString('base64')}`;
    const { geminiClient } = await import(geminiUrl);

    let calledGenerateUrl = '';
    let capturedHeaders = null;
    global.fetch = async (url, opts) => {
      capturedHeaders = opts && opts.headers ? opts.headers : null;
      if (url.endsWith('/v1beta/models')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [
              { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-3-pro-image', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        };
      }
      calledGenerateUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
      };
    };

    const listRes = await geminiClient.listModels('AQ.TestAuthKey', { forceRefresh: true });
    assert.strictEqual(listRes.success, true);
    assert.strictEqual(listRes.models.length, 3);
    assert.strictEqual(listRes.recommendedModel, 'gemini-3.8-flash');
    assert.strictEqual(capturedHeaders['x-goog-api-key'], 'AQ.TestAuthKey');

    const testRes = await geminiClient.testConnection('AQ.TestAuthKey', 'auto');
    assert.strictEqual(testRes.success, true);
    assert.strictEqual(testRes.resolvedModel, 'gemini-3.8-flash');
    assert.ok(calledGenerateUrl.includes('/models/gemini-3.8-flash:generateContent'));
    assert.strictEqual(capturedHeaders['x-goog-api-key'], 'AQ.TestAuthKey');
  });

  // 13. Comment Styles Test 6 — UI & CSP Compliance
  await runTest('CommentStyles Test 6: index.html has no conflicting #cfg-gemini-style dropdown and 0 inline events/scripts', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.strictEqual(html.includes('cfg-gemini-style'), false, 'Found conflicting old #cfg-gemini-style dropdown');
    assert.strictEqual(/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html), false, 'Found inline <script> in index.html');

    const files = ['index.html', 'js/tabs/config.js', 'js/tabs/students.js', 'js/tabs/classes.js', 'js/tabs/review.js'];
    for (const f of files) {
      const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.strictEqual(/\bon(click|change|input|submit)\s*=\s*["']/i.test(content), false, `Found inline event in ${f}`);
    }
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
