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
    const rawProviders = fs.readFileSync(path.join(ROOT, 'js/config/aiProviders.js'), 'utf8');
    const providersUrl = `data:text/javascript;base64,${Buffer.from(rawProviders, 'utf8').toString('base64')}`;

    const rawGemini = fs.readFileSync(path.join(ROOT, 'js/services/geminiClient.js'), 'utf8')
      .replace("from '../config/commentStyles.js'", `from '${stylesUrl}'`)
      .replace("from '../config/aiProviders.js'", `from '${providersUrl}'`);
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
    assert.strictEqual(capturedBody.generationConfig.maxOutputTokens, 1536);
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
    const rawProviders = fs.readFileSync(path.join(ROOT, 'js/config/aiProviders.js'), 'utf8');
    const providersUrl = `data:text/javascript;base64,${Buffer.from(rawProviders, 'utf8').toString('base64')}`;

    const rawGemini = fs.readFileSync(path.join(ROOT, 'js/services/geminiClient.js'), 'utf8')
      .replace("from '../config/commentStyles.js'", `from '${stylesUrl}'`)
      .replace("from '../config/aiProviders.js'", `from '${providersUrl}'`);
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

  // 16. Multi-Provider Test 1 — detectProviderFromKey()
  await runTest('Multi-Provider Test 1: detectProviderFromKey() detects Gemini, Groq, OpenRouter, and OpenAI prefixes', async () => {
    const rawProviders = fs.readFileSync(path.join(ROOT, 'js/config/aiProviders.js'), 'utf8');
    const providersUrl = `data:text/javascript;base64,${Buffer.from(rawProviders, 'utf8').toString('base64')}`;
    const { detectProviderFromKey } = await import(providersUrl);

    assert.strictEqual(detectProviderFromKey('AIzaSyD123456789'), 'gemini');
    assert.strictEqual(detectProviderFromKey('gsk_abc123xyz'), 'groq');
    assert.strictEqual(detectProviderFromKey('sk-or-v1-abc123'), 'openrouter');
    assert.strictEqual(detectProviderFromKey('sk-proj-abc123'), 'openai');
    assert.strictEqual(detectProviderFromKey('sk-abc123'), 'openai');
    assert.strictEqual(detectProviderFromKey('unknown-key'), null);
    assert.strictEqual(detectProviderFromKey(''), null);
  });

  // 17. Multi-Provider Test 2 — pickBestEconomicalModel()
  await runTest('Multi-Provider Test 2: pickBestEconomicalModel() picks cheapest/fastest model and filters pro/o1/o3/reasoner', async () => {
    const rawProviders = fs.readFileSync(path.join(ROOT, 'js/config/aiProviders.js'), 'utf8');
    const providersUrl = `data:text/javascript;base64,${Buffer.from(rawProviders, 'utf8').toString('base64')}`;
    const { pickBestEconomicalModel, filterEconomicalModels } = await import(providersUrl);

    const geminiModels = [
      { id: 'gemini-2.5-pro' },
      { id: 'gemini-2.0-flash' },
      { id: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-flash-lite' },
      { id: 'gemini-2.5-flash-image' }
    ];
    assert.strictEqual(pickBestEconomicalModel('gemini', geminiModels), 'gemini-2.5-flash-lite');
    assert.strictEqual(filterEconomicalModels('gemini', geminiModels).some(m => m.id.includes('pro') || m.id.includes('image')), false);

    const openaiModels = [
      { id: 'o1-preview' },
      { id: 'o3-mini' },
      { id: 'gpt-4o' },
      { id: 'gpt-4o-mini' },
      { id: 'gpt-4.1-mini' },
      { id: 'tts-1' }
    ];
    assert.strictEqual(pickBestEconomicalModel('openai', openaiModels), 'gpt-4.1-mini');
    assert.strictEqual(filterEconomicalModels('openai', openaiModels).some(m => m.id.startsWith('o1') || m.id.startsWith('o3') || m.id === 'tts-1'), false);

    const groqModels = [
      { id: 'whisper-large-v3' },
      { id: 'llama-3.1-8b-instant' },
      { id: 'llama-3.3-70b-versatile' }
    ];
    assert.strictEqual(pickBestEconomicalModel('groq', groqModels), 'llama-3.3-70b-versatile');

    const deepseekModels = [
      { id: 'deepseek-reasoner' },
      { id: 'deepseek-chat' }
    ];
    assert.strictEqual(pickBestEconomicalModel('deepseek', deepseekModels), 'deepseek-chat');
    assert.strictEqual(filterEconomicalModels('deepseek', deepseekModels).some(m => m.id.includes('reasoner')), false);

    const openrouterModels = [
      { id: 'openai/gpt-4o-mini' },
      { id: 'google/gemini-2.5-flash-lite' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free' }
    ];
    assert.strictEqual(pickBestEconomicalModel('openrouter', openrouterModels), 'meta-llama/llama-3.3-70b-instruct:free');
  });

  // 18. Multi-Provider Test 3 — Payload & commentStyleConfig for both Gemini and OpenAI-compatible
  await runTest('Multi-Provider Test 3: Gemini and OpenAI-compatible payloads include commentStyleConfig and token limits', async () => {
    const rawStyles = fs.readFileSync(path.join(ROOT, 'js/config/commentStyles.js'), 'utf8');
    const stylesUrl = `data:text/javascript;base64,${Buffer.from(rawStyles, 'utf8').toString('base64')}`;
    const rawProviders = fs.readFileSync(path.join(ROOT, 'js/config/aiProviders.js'), 'utf8');
    const providersUrl = `data:text/javascript;base64,${Buffer.from(rawProviders, 'utf8').toString('base64')}`;

    const rawGemini = fs.readFileSync(path.join(ROOT, 'js/services/geminiClient.js'), 'utf8')
      .replace("from '../config/commentStyles.js'", `from '${stylesUrl}'`)
      .replace("from '../config/aiProviders.js'", `from '${providersUrl}'`);
    const geminiUrl = `data:text/javascript;base64,${Buffer.from(rawGemini, 'utf8').toString('base64')}`;
    const { geminiClient } = await import(geminiUrl);

    const styleConfig = {
      mode: 'custom',
      presetId: 'standard',
      customCriteria: 'Thái độ học tập, Kỹ năng lập trình',
      outputFormat: 'bullets'
    };

    let capturedGroqUrl = '';
    let capturedGroqAuth = '';
    let capturedGroqBody = null;
    global.fetch = async (url, opts) => {
      capturedGroqUrl = url;
      capturedGroqAuth = opts.headers.Authorization;
      capturedGroqBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '- Thái độ học tập: Tốt.\n- Kỹ năng lập trình: Khá.' } }]
        })
      };
    };

    const groqComment = await geminiClient.generateStudentComment(
      { name: 'HS A', rating: 'Giỏi', note: 'Chăm chỉ', studentIndex: 0 },
      { classCode: 'C4K-1', title: 'Buổi 2', sessionNumber: 2, summary: 'Biến và vòng lặp' },
      'gsk_TestGroqKey',
      'llama-3.3-70b-versatile',
      styleConfig,
      'groq'
    );

    assert.strictEqual(capturedGroqUrl, 'https://api.groq.com/openai/v1/chat/completions');
    assert.strictEqual(capturedGroqAuth, 'Bearer gsk_TestGroqKey');
    assert.strictEqual(capturedGroqBody.model, 'llama-3.3-70b-versatile');
    assert.strictEqual(capturedGroqBody.max_tokens, 1536);
    assert.strictEqual(capturedGroqBody.messages[0].role, 'system');
    assert.ok(capturedGroqBody.messages[0].content.includes('Thái độ học tập'));
    assert.ok(capturedGroqBody.messages[0].content.includes('Kỹ năng lập trình'));
    assert.ok(groqComment.includes('- Thái độ học tập:'));

    // Verify testConnection uses max_tokens: 10 and "Trả lời: OK"
    let capturedTestBody = null;
    global.fetch = async (_url, opts) => {
      capturedTestBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'OK' } }] })
      };
    };
    const testRes = await geminiClient.testConnection('gsk_TestGroqKey', 'llama-3.3-70b-versatile', 'groq');
    assert.strictEqual(testRes.success, true);
    assert.strictEqual(capturedTestBody.max_tokens, 10);
    assert.strictEqual(capturedTestBody.messages[0].content, 'Trả lời: OK');
  });

  // 19. PREB Curriculum Test 1 — 14/14 sessions & class code extraction
  await runTest('PREB Curriculum: loads all 14/14 sessions and auto-detects PREB from class codes', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.fetch = async (url) => {
      const cleanPath = url.replace(/^\.\//, '');
      const fullPath = path.join(ROOT, cleanPath);
      if (!fs.existsSync(fullPath)) {
        return { ok: false, status: 404 };
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(content)
      };
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const { CurriculumService } = await import(currUrl);
    const service = new CurriculumService('./data/curriculum');

    // Auto-detect PREB from various class codes
    assert.strictEqual(service.extractCourseCode('PVT-ROB-PREB05'), 'PREB');
    assert.strictEqual(service.extractCourseCode('PVT-ROB-PREB01'), 'PREB');
    assert.strictEqual(service.extractCourseCode('PREB12'), 'PREB');

    const prebData = await service.getMergedCourseData('PREB');
    assert.ok(prebData, 'PREB data should be loaded');
    assert.strictEqual(prebData.sessions.length, 14, 'PREB must have 14 sessions');
    for (let i = 1; i <= 14; i++) {
      const s = prebData.sessions.find(x => x.sessionNumber === i);
      assert.ok(s, `Missing session ${i}`);
      assert.ok(s.title && s.title.trim().length > 0, `Session ${i} missing title`);
      assert.ok(s.summary && s.summary.trim().length > 0, `Session ${i} missing summary`);
      assert.ok(Array.isArray(s.objectives) && s.objectives.length > 0, `Session ${i} missing objectives`);
    }

    // Verify all 12 first sessions of PREB have official docs.google.com/presentation/d/ slide URLs without trailing junk
    const expectedPrebSlides = {
      1: 'https://docs.google.com/presentation/d/1b3ergNl3Cw4H8ZKmppkd6KbNyf8xenzz/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      2: 'https://docs.google.com/presentation/d/1OgbI98eWMS1ckoX0x6wvWabq3IZ6VDfE/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      3: 'https://docs.google.com/presentation/d/1bKb4shzsnx-i2zDBhIqqcf_55FVLxJ5H/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      4: 'https://docs.google.com/presentation/d/17Mt4npZUyqZkGO54k7YjDOZ9IC99n2s1/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      5: 'https://docs.google.com/presentation/d/1q1R6x5_oYDqCyYaLRSI3Xrl72sKu38Uq/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      6: 'https://docs.google.com/presentation/d/1320eKpDvGCrlgZQs_dQvU3WeTVgwjmCy/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      7: 'https://docs.google.com/presentation/d/12lke974DzxV3c0-E0uym7RWrwz0Hx2Kv/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      8: 'https://docs.google.com/presentation/d/1uqR-yDptAWbYmhSp6nNkZIYxDr5AsFZ8/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      9: 'https://docs.google.com/presentation/d/1i1DO99n5_lII_V_4Q4rEqxbYIOdp11Xj/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      10: 'https://docs.google.com/presentation/d/1Irz2firrgClnqsK5SCkRVkoaSJVQ8tca/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      11: 'https://docs.google.com/presentation/d/1gZix23zDFNT4vS8BGdXP64CJ0AAXy-2t/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      12: 'https://docs.google.com/presentation/d/10WdXGrkU4LQLGZOvDZM0nbh5MrVFzH0K/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true'
    };
    assert.strictEqual(prebData.slideFolderUrl, 'https://drive.google.com/drive/folders/1gT_JMi6OGl28QShozGbsW-RrgBBKE2vO');
    for (let i = 1; i <= 12; i++) {
      const s = prebData.sessions.find(x => x.sessionNumber === i);
      assert.strictEqual(s.slideUrl, expectedPrebSlides[i], `PREB Session ${i} slideUrl mismatch`);
      assert.ok(s.slideUrl.startsWith('https://docs.google.com/presentation/d/'));
      assert.ok(s.slideUrl.endsWith('&sd=true'));
    }

    // Verify Tab Học viên summary lookup via classCode
    const summaryRes = await service.getSessionSummary({ classCode: 'PVT-ROB-PREB05', session: 1 });
    assert.strictEqual(summaryRes.courseCode, 'PREB');
    assert.strictEqual(summaryRes.sessionNumber, 1);
    assert.ok(summaryRes.formattedSummary.includes('Buổi 1: Bệ phóng tên lửa.'));
    assert.ok(summaryRes.formattedSummary.includes('VEX GO Kit'));
  });

  // 20. PREB Curriculum Test 2 — Zalo report for sessions 1, 3, 12, 13 & dynamic teacherName
  await runTest('PREB Zalo Report: sessions 1, 3, 12, 13 have all Slide/Doc links and dynamic teacherName (no Quang Thường)', async () => {
    const store = {
      mindx_lms_config: JSON.stringify({ name: 'Trần Minh Khang' })
    };
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.document = {
      getElementById: () => null
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const rawToast = fs.readFileSync(path.join(ROOT, 'js/services/toast.js'), 'utf8');
    const toastUrl = `data:text/javascript;base64,${Buffer.from(rawToast, 'utf8').toString('base64')}`;

    const rawZalo = fs.readFileSync(path.join(ROOT, 'js/tabs/zalo.js'), 'utf8')
      .replace("from '../services/curriculum.js'", `from '${currUrl}'`)
      .replace("from '../services/toast.js'", `from '${toastUrl}'`);
    const zaloUrl = `data:text/javascript;base64,${Buffer.from(rawZalo, 'utf8').toString('base64')}`;
    const { buildZaloReportContent } = await import(zaloUrl);

    const prebJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/curriculum/PREB.json'), 'utf8'));
    const sessionsArr = Object.values(prebJson.sessions);
    const courseObj = { ...prebJson, sessions: sessionsArr };

    const checkSession = (num, expectedLinks, extraAssertions) => {
      const sessionData = sessionsArr.find(s => s.sessionNumber === num);
      const { richHtml, plainText } = buildZaloReportContent({
        courseCode: 'PREB',
        sessionNum: num,
        teacherName: '', // Should dynamically pick up 'Trần Minh Khang' from Cấu hình
        classCode: 'PVT-ROB-PREB05',
        course: courseObj,
        sessionData
      });

      assert.strictEqual(plainText.includes('Quang Thường'), false, `Session ${num} plainText must not hardcode Quang Thường`);
      assert.strictEqual(richHtml.includes('Quang Thường'), false, `Session ${num} richHtml must not hardcode Quang Thường`);
      assert.ok(plainText.includes('Trần Minh Khang'), `Session ${num} must use dynamic teacherName from Cấu hình`);
      assert.ok(plainText.includes('PVT-ROB-PREB05'), `Session ${num} must include classCode`);

      for (const link of expectedLinks) {
        assert.ok(plainText.includes(link), `Session ${num} plainText missing link: ${link}`);
        assert.ok(richHtml.includes(link.replace(/&/g, '&amp;')), `Session ${num} richHtml missing link: ${link}`);
      }
      if (extraAssertions) extraAssertions({ richHtml, plainText });
    };

    // Buổi 1
    checkSession(1, [
      'https://docs.google.com/presentation/d/1b3ergNl3Cw4H8ZKmppkd6KbNyf8xenzz/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      'https://docs.google.com/document/d/128jE81vrOxp9GFllW0UPq_dK3wjyZ12Y/edit'
    ], ({ plainText }) => {
      assert.ok(plainText.includes('Dấu ấn sao Hỏa'));
    });

    // Buổi 3 (including parent conversation prompts)
    checkSession(3, [
      'https://docs.google.com/presentation/d/1bKb4shzsnx-i2zDBhIqqcf_55FVLxJ5H/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      'https://drive.google.com/file/d/1wpc4bWEV84Opk1Vnmk3LAhSRDZ41kdiV/view'
    ], ({ plainText }) => {
      assert.ok(plainText.includes('GỢI Ý BA MẸ TRÒ CHUYỆN CÙNG CON'));
      assert.ok(plainText.includes('bề mặt Sao Hỏa có gì đặc biệt'));
    });

    // Buổi 12
    checkSession(12, [
      'https://docs.google.com/presentation/d/10WdXGrkU4LQLGZOvDZM0nbh5MrVFzH0K/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      'https://docs.google.com/document/d/19XeTiGp4mVjTECy4yYIo0wc9dKmC7GmD/edit?usp=sharing&ouid=111038164751870348560&rtpof=true&sd=true',
      'https://www.canva.com/design/DAG8U-o52U8/HnTOqovtVM1XW44r9bV-XQ/edit?utm_content=DAG8U-o52U8&utm_campaign=designshare&utm_medium=link2&utm_source=sharebutton'
    ]);

    // Buổi 13
    checkSession(13, [
      'https://www.canva.com/design/DAGUoXyaa2s/wMyF14hYbVXqYoRYffe6OQ/edit?utm_content=DAGUoXyaa2s&utm_campaign=designshare&utm_medium=link2&utm_source=sharebutton',
      'https://canva.link/fv8qli46cgresec',
      'https://canva.link/rve6x45weaol44q'
    ]);
  });

  // 21. PREA Curriculum Test 1 — 14/14 sessions & class code extraction
  await runTest('PREA Curriculum: loads all 14/14 sessions and auto-detects PREA from class codes', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.fetch = async (url) => {
      const cleanPath = url.replace(/^\.\//, '');
      const fullPath = path.join(ROOT, cleanPath);
      if (!fs.existsSync(fullPath)) {
        return { ok: false, status: 404 };
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(content)
      };
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const { CurriculumService } = await import(currUrl);
    const service = new CurriculumService('./data/curriculum');

    assert.strictEqual(service.extractCourseCode('PVT-ROB-PREA03'), 'PREA');
    assert.strictEqual(service.extractCourseCode('PVT-ROB-PREA01'), 'PREA');
    assert.strictEqual(service.extractCourseCode('TK-ROB-PREA12'), 'PREA');

    const preaData = await service.getMergedCourseData('PREA');
    assert.ok(preaData, 'PREA data should be loaded');
    assert.strictEqual(preaData.sessions.length, 14, 'PREA must have 14 sessions');
    for (let i = 1; i <= 14; i++) {
      const s = preaData.sessions.find(x => x.sessionNumber === i);
      assert.ok(s, `Missing PREA session ${i}`);
      assert.ok(s.title && s.title.trim().length > 0, `PREA Session ${i} missing title`);
      assert.ok(s.summary && s.summary.trim().length > 0, `PREA Session ${i} missing summary`);
      assert.ok(Array.isArray(s.objectives) && s.objectives.length > 0, `PREA Session ${i} missing objectives`);
    }

    const summaryRes = await service.getSessionSummary({ classCode: 'PVT-ROB-PREA03', session: 2 });
    assert.strictEqual(summaryRes.courseCode, 'PREA');
    assert.strictEqual(summaryRes.sessionNumber, 2);
    assert.ok(summaryRes.formattedSummary.includes('Buổi 2: Cánh cổng thần kỳ.'));
  });

  // 22. PREA Curriculum Test 2 — Zalo report for sessions 2, 3, 5, 13 & dynamic teacherName
  await runTest('PREA Zalo Report: sessions 2, 3, 5, 13 have all Slide/Doc links and dynamic teacherName (no Quang Thường)', async () => {
    const store = {
      mindx_lms_config: JSON.stringify({ name: 'Nguyễn Minh Quân' })
    };
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.document = {
      getElementById: () => null
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const rawToast = fs.readFileSync(path.join(ROOT, 'js/services/toast.js'), 'utf8');
    const toastUrl = `data:text/javascript;base64,${Buffer.from(rawToast, 'utf8').toString('base64')}`;

    const rawZalo = fs.readFileSync(path.join(ROOT, 'js/tabs/zalo.js'), 'utf8')
      .replace("from '../services/curriculum.js'", `from '${currUrl}'`)
      .replace("from '../services/toast.js'", `from '${toastUrl}'`);
    const zaloUrl = `data:text/javascript;base64,${Buffer.from(rawZalo, 'utf8').toString('base64')}`;
    const { buildZaloReportContent } = await import(zaloUrl);

    const preaJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/curriculum/PREA.json'), 'utf8'));
    const sessionsArr = Object.values(preaJson.sessions);
    const courseObj = { ...preaJson, sessions: sessionsArr };

    const checkSession = (num, expectedLinks, extraAssertions) => {
      const sessionData = sessionsArr.find(s => s.sessionNumber === num);
      const { richHtml, plainText } = buildZaloReportContent({
        courseCode: 'PREA',
        sessionNum: num,
        teacherName: '',
        classCode: 'PVT-ROB-PREA03',
        course: courseObj,
        sessionData
      });

      assert.strictEqual(plainText.includes('Quang Thường'), false, `PREA Session ${num} plainText must not hardcode Quang Thường`);
      assert.strictEqual(richHtml.includes('Quang Thường'), false, `PREA Session ${num} richHtml must not hardcode Quang Thường`);
      assert.ok(plainText.includes('Nguyễn Minh Quân'), `PREA Session ${num} must use dynamic teacherName`);
      assert.ok(plainText.includes('PVT-ROB-PREA03'), `PREA Session ${num} must include classCode`);

      for (const link of expectedLinks) {
        assert.ok(plainText.includes(link), `PREA Session ${num} plainText missing link: ${link}`);
        assert.ok(richHtml.includes(link.replace(/&/g, '&amp;')), `PREA Session ${num} richHtml missing link: ${link}`);
      }
      if (extraAssertions) extraAssertions({ richHtml, plainText });
    };

    // Buổi 2 (Slide, Doc, 3 parent questions)
    checkSession(2, [
      'https://drive.google.com/file/d/1sitII8Fh8MlS9RG91vYpcmtgiIcXdYfV/view',
      'https://drive.google.com/file/d/1V8f91Fr5qba2LUE3E4WF7nvdSXtmEcV8/view'
    ], ({ plainText }) => {
      assert.ok(plainText.includes('GỢI Ý BA MẸ TRÒ CHUYỆN CÙNG CON'));
      assert.ok(plainText.includes('Cánh cổng thần kỳ'));
    });

    // Buổi 3 (2 Slide links + 1 Doc link)
    checkSession(3, [
      'https://drive.google.com/file/d/1ZZuw2-e4JM4LJCtsPRlPEKEStnTIyH1n/view',
      'https://drive.google.com/file/d/1wpc4bWEV84Opk1Vnmk3LAhSRDZ41kdiV/view',
      'https://drive.google.com/file/d/1myk5NYwfcJNduvvwR3ESY9xE2Cr48G8V/view'
    ]);

    // Buổi 5 (2 Slide links + 1 Doc link)
    checkSession(5, [
      'https://docs.google.com/presentation/d/1lttcKve_wP-wi3M1YkCbdLUWa4hjWQUo/edit?rtpof=true',
      'https://docs.google.com/presentation/d/1Ih3aj1JJeSk-zQYeOaarE0jrOkZgAd6B/edit?slide=id.p11#slide=id.p11',
      'https://docs.google.com/document/d/106K__J3TmPSmDni4Aj_DfWqns0B1nbAi/edit?usp=sharing&ouid=111038164751870348560&rtpof=true&sd=true'
    ]);

    // Buổi 13 (Doc + Canva thuyết trình)
    checkSession(13, [
      'https://drive.google.com/file/d/1H19wZjiF6W0pKmn3shTempMsjn60NUP4/view?usp=sharing',
      'https://www.canva.com/design/DAGuQ3Red5g/HM7POidOqFBH4kl_tD30PA/edit?utm_content=DAGuQ3Red5g&utm_campaign=designshare&utm_medium=link2&utm_source=sharebutton'
    ]);
  });

  // 23. PREI Curriculum Test 1 — 14/14 sessions & class code extraction
  await runTest('PREI Curriculum: loads all 14/14 sessions and auto-detects PREI from class codes', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.fetch = async (url) => {
      const cleanPath = url.replace(/^\.\//, '');
      const fullPath = path.join(ROOT, cleanPath);
      if (!fs.existsSync(fullPath)) {
        return { ok: false, status: 404 };
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(content)
      };
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const { CurriculumService } = await import(currUrl);
    const service = new CurriculumService('./data/curriculum');

    assert.strictEqual(service.extractCourseCode('PVT-ROB-PREI02'), 'PREI');
    assert.strictEqual(service.extractCourseCode('PVT-ROB-PREI01'), 'PREI');
    assert.strictEqual(service.extractCourseCode('TK-ROB-PREI08'), 'PREI');

    const preiData = await service.getMergedCourseData('PREI');
    assert.ok(preiData, 'PREI data should be loaded');
    assert.strictEqual(preiData.sessions.length, 14, 'PREI must have 14 sessions');
    for (let i = 1; i <= 14; i++) {
      const s = preiData.sessions.find(x => x.sessionNumber === i);
      assert.ok(s, `Missing PREI session ${i}`);
      assert.ok(s.title && s.title.trim().length > 0, `PREI Session ${i} missing title`);
      assert.ok(s.summary && s.summary.trim().length > 0, `PREI Session ${i} missing summary`);
      assert.ok(Array.isArray(s.objectives) && s.objectives.length > 0, `PREI Session ${i} missing objectives`);
    }

    const summaryRes = await service.getSessionSummary({ classCode: 'PVT-ROB-PREI02', session: 1 });
    assert.strictEqual(summaryRes.courseCode, 'PREI');
    assert.strictEqual(summaryRes.sessionNumber, 1);
    assert.ok(summaryRes.formattedSummary.includes('Buổi 1: Hội chợ việc làm dành cho Robot.'));
  });

  // 24. PREI Curriculum Test 2 — Zalo report for sessions 6, 7, 10, 12, 13 & dynamic teacherName
  await runTest('PREI Zalo Report: sessions 6, 7, 10, 12, 13 have all Slide/Doc/Canva links and dynamic teacherName (no Quang Thường)', async () => {
    const store = {
      mindx_lms_config: JSON.stringify({ name: 'Lê Hoàng Nam' })
    };
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.document = {
      getElementById: () => null
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const rawToast = fs.readFileSync(path.join(ROOT, 'js/services/toast.js'), 'utf8');
    const toastUrl = `data:text/javascript;base64,${Buffer.from(rawToast, 'utf8').toString('base64')}`;

    const rawZalo = fs.readFileSync(path.join(ROOT, 'js/tabs/zalo.js'), 'utf8')
      .replace("from '../services/curriculum.js'", `from '${currUrl}'`)
      .replace("from '../services/toast.js'", `from '${toastUrl}'`);
    const zaloUrl = `data:text/javascript;base64,${Buffer.from(rawZalo, 'utf8').toString('base64')}`;
    const { buildZaloReportContent } = await import(zaloUrl);

    const preiJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/curriculum/PREI.json'), 'utf8'));
    const sessionsArr = Object.values(preiJson.sessions);
    const courseObj = { ...preiJson, sessions: sessionsArr };

    const checkSession = (num, expectedLinks) => {
      const sessionData = sessionsArr.find(s => s.sessionNumber === num);
      const { richHtml, plainText } = buildZaloReportContent({
        courseCode: 'PREI',
        sessionNum: num,
        teacherName: '',
        classCode: 'PVT-ROB-PREI02',
        course: courseObj,
        sessionData
      });

      assert.strictEqual(plainText.includes('Quang Thường'), false, `PREI Session ${num} plainText must not hardcode Quang Thường`);
      assert.strictEqual(richHtml.includes('Quang Thường'), false, `PREI Session ${num} richHtml must not hardcode Quang Thường`);
      assert.ok(plainText.includes('Lê Hoàng Nam'), `PREI Session ${num} must use dynamic teacherName`);
      assert.ok(plainText.includes('PVT-ROB-PREI02'), `PREI Session ${num} must include classCode`);

      for (const link of expectedLinks) {
        assert.ok(plainText.includes(link), `PREI Session ${num} plainText missing link: ${link}`);
        assert.ok(richHtml.includes(link.replace(/&/g, '&amp;')), `PREI Session ${num} richHtml missing link: ${link}`);
      }
    };

    // Buổi 6
    checkSession(6, [
      'https://drive.google.com/file/d/1Ubwu-CZbHL7jv270q8uev1XgnncnN6qJ/view',
      'https://docs.google.com/document/d/1KFfaluIJG7LXktgV-7d-QdAPSgRS3J7JQmP0Qv0uwuk/edit?usp=sharing'
    ]);

    // Buổi 7
    checkSession(7, [
      'https://drive.google.com/file/d/1nNktYlYPoISfNr8nvKcQTcuFAYyJGvGb/view',
      'https://docs.google.com/document/d/1uB3D24jLgnTs7QIxNT3R7gxAPJ_4B4-nLcDZKaHSMhU/edit?usp=sharing'
    ]);

    // Buổi 10
    checkSession(10, [
      'https://drive.google.com/file/d/1CpWmXsTNzAYELZr65R14DmwH_QtiQD59/view',
      'https://docs.google.com/document/d/1heRUkdgVKDyg7gqWE7JkS1BpKeUaBjO1eAJnZ2NtqKI/edit?usp=sharing'
    ]);

    // Buổi 12
    checkSession(12, [
      'https://drive.google.com/file/d/1rc7izjuIVl-ZpjLZqMcuTO5Vqt4RQCUZ/view',
      'https://docs.google.com/document/d/1-hDdgUAZFU5iW-R2hts2NE19y2I46JBFUMu8O8nkiUY/edit?usp=sharing'
    ]);

    // Buổi 13 (3 links: Tài liệu ôn tập kiến thức + Đáp án BGK + Tài liệu ôn tập thuyết trình)
    checkSession(13, [
      'https://drive.google.com/file/d/1H19wZjiF6W0pKmn3shTempMsjn60NUP4/view?usp=sharing',
      'https://www.canva.com/design/DAHCxGoi9Q0/IuTN3hKfABxw1ZNRpmW1Ew/edit?utm_content=DAHCxGoi9Q0&utm_campaign=designshare&utm_medium=link2&utm_source=sharebutton',
      'https://www.canva.com/design/DAHCxPkH_7U/4RnptsLX4BH5icFb3up7iQ/edit?utm_content=DAHCxPkH_7U&utm_campaign=designshare&utm_medium=link2&utm_source=sharebutton'
    ]);
  });

  // 25. ARMB Curriculum Test — 14/14 sessions, class code extraction & official slide URLs
  await runTest('ARMB Curriculum: auto-detects ARMB from class code and has all 14 official slide URLs', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.fetch = async (url) => {
      const cleanPath = url.replace(/^\.\//, '');
      const fullPath = path.join(ROOT, cleanPath);
      if (!fs.existsSync(fullPath)) {
        return { ok: false, status: 404 };
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(content)
      };
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const { CurriculumService } = await import(currUrl);
    const service = new CurriculumService('./data/curriculum');

    assert.strictEqual(service.extractCourseCode('PVT-ROB-ARMB02'), 'ARMB');
    assert.strictEqual(service.extractCourseCode('PVT-ROB-ARMB01'), 'ARMB');
    assert.strictEqual(service.extractCourseCode('TK-ROB-ARMB05'), 'ARMB');

    const armbData = await service.getMergedCourseData('ARMB');
    assert.ok(armbData, 'ARMB data should be loaded');
    assert.strictEqual(armbData.sessions.length, 14, 'ARMB must have 14 sessions');

    const expectedArmbSlides = {
      1: 'https://docs.google.com/presentation/d/1jms60ZNpZ0j-NZ1NcwpcKiyN5TvLmlb4/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      2: 'https://docs.google.com/presentation/d/1YfvNy3EAUqM7JRre5AfqakaYbsfpJke7/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      3: 'https://docs.google.com/presentation/d/1gUDhnF--e4xJVsSEeB5_Nuuifn86JqhB/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      4: 'https://docs.google.com/presentation/d/1zsjZ_-Hotr3GNTHqGHosj-GL8InKWzT7/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      5: 'https://docs.google.com/presentation/d/1qT4vxCzH7F09MRh61xVccB_0ja_8QvBQ/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      6: 'https://docs.google.com/presentation/d/1-xlyz_CFh_lSFn9KSdqzNHJM0PzifqYz/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      7: 'https://docs.google.com/presentation/d/1on49snFfJXYYagEnuHFlkw-LamhDaNp6/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      8: 'https://docs.google.com/presentation/d/1X97-qvI7Scdc4yXdfimafXqgw98aX7Vx/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      9: 'https://docs.google.com/presentation/d/16IsRmKpdFHtySQFGo2umbisBT3JpEKJv/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      10: 'https://docs.google.com/presentation/d/13Kat6c2jEqbB33UoGtH_jH7zhrBMhs4q/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      11: 'https://docs.google.com/presentation/d/1_zy-6xb83nxqw6KI5MVhMxXHkbvVWhKv/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      12: 'https://docs.google.com/presentation/d/1sv_l2Q6EmGixp_b1bdHvf1waMQCmLeLt/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      13: 'https://docs.google.com/presentation/d/1NaRzoka0ulFMMiUixdXEC45eW2U76pOk/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      14: 'https://docs.google.com/presentation/d/1PO_rpYDPOljiMq4wpU-VEOFLOfL0lJvn/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true'
    };

    for (let i = 1; i <= 14; i++) {
      const s = armbData.sessions.find(x => x.sessionNumber === i);
      assert.ok(s, `Missing ARMB session ${i}`);
      assert.strictEqual(s.slideUrl, expectedArmbSlides[i], `ARMB Session ${i} slideUrl mismatch`);
      assert.ok(s.slideUrl.startsWith('https://docs.google.com/presentation/d/'));
      assert.ok(s.slideUrl.endsWith('&sd=true'));
    }
  });

  // 26. ARMI Curriculum Test — 14/14 sessions, class code extraction & official slide URLs (1-13)
  await runTest('ARMI Curriculum: auto-detects ARMI from class code and has 14 sessions with official slide URLs (1-13)', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.fetch = async (url) => {
      const cleanPath = url.replace(/^\.\//, '');
      const fullPath = path.join(ROOT, cleanPath);
      if (!fs.existsSync(fullPath)) {
        return { ok: false, status: 404 };
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(content)
      };
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const { CurriculumService } = await import(currUrl);
    const service = new CurriculumService('./data/curriculum');

    assert.strictEqual(service.extractCourseCode('PVT-ROB-ARMI02'), 'ARMI');
    assert.strictEqual(service.extractCourseCode('PVT-ROB-ARMI01'), 'ARMI');
    assert.strictEqual(service.extractCourseCode('TK-ROB-ARMI05'), 'ARMI');

    const armiData = await service.getMergedCourseData('ARMI');
    assert.ok(armiData, 'ARMI data should be loaded');
    assert.strictEqual(armiData.sessions.length, 14, 'ARMI must have 14 sessions');

    const expectedArmiSlides = {
      1: 'https://docs.google.com/presentation/d/1EP5YQJFvAjZEE3u0yxUelZzaLUTLEFCT/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      2: 'https://docs.google.com/presentation/d/1fd49Wsea-msOE-Qzp_OU_dxPV4aLMFGx/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      3: 'https://docs.google.com/presentation/d/15jF3KNorg9XhcODNcivYooO3zAYnJWc7/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      4: 'https://docs.google.com/presentation/d/1iPL08QDkgQcU8EcKSAZuQyOtet8oQ_ty/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      5: 'https://docs.google.com/presentation/d/1WsNzAdPwgeTi0PvknZD82FCP4i_Hl0zh/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      6: 'https://docs.google.com/presentation/d/19d6AE7cFZlkVCKzGrWpcIN02w0sJSXb2/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      7: 'https://docs.google.com/presentation/d/1hW2GFfVk14gRUPhcKt9EVLXG0n9Pq7Zx/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      8: 'https://docs.google.com/presentation/d/1elbGMwwnS0uhNDgwYfiOzhLr8766uDhA/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      9: 'https://docs.google.com/presentation/d/1DCHbOylZkhMjw5jVflKZmZJ5BFTPqPLF/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      10: 'https://docs.google.com/presentation/d/1tInt0dczA7bWpUsfqeDi8YS2S62I9LEI/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      11: 'https://docs.google.com/presentation/d/1iTDo7Lv8QrPSsvE2EGhjeMgZaFOkryZg/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      12: 'https://docs.google.com/presentation/d/1b6E-lhaYXfGIIQ4YIlOsz6E8ooAeGYZh/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      13: 'https://docs.google.com/presentation/d/1snejwFjqijfrLyJ0qG56R6jwYmy2TqzP/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true'
    };

    for (let i = 1; i <= 13; i++) {
      const s = armiData.sessions.find(x => x.sessionNumber === i);
      assert.ok(s, `Missing ARMI session ${i}`);
      assert.strictEqual(s.slideUrl, expectedArmiSlides[i], `ARMI Session ${i} slideUrl mismatch`);
      assert.ok(s.slideUrl.startsWith('https://docs.google.com/presentation/d/'));
      assert.ok(s.slideUrl.endsWith('&sd=true'));
    }

    const s14 = armiData.sessions.find(x => x.sessionNumber === 14);
    assert.ok(s14, 'Missing ARMI session 14');
    assert.strictEqual(s14.slideUrl, '');
  });

  // 27. ARMA Curriculum Test — 14/14 sessions, class code extraction & official slide URLs (1-12)
  await runTest('ARMA Curriculum: auto-detects ARMA from class code and has 14 sessions with official slide URLs (1-12)', async () => {
    const store = {};
    global.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    };
    global.fetch = async (url) => {
      const cleanPath = url.replace(/^\.\//, '');
      const fullPath = path.join(ROOT, cleanPath);
      if (!fs.existsSync(fullPath)) {
        return { ok: false, status: 404 };
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(content)
      };
    };

    const rawCurriculum = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currUrl = `data:text/javascript;base64,${Buffer.from(rawCurriculum, 'utf8').toString('base64')}`;
    const { CurriculumService } = await import(currUrl);
    const service = new CurriculumService('./data/curriculum');

    assert.strictEqual(service.extractCourseCode('PVT-ROB-ARMA02'), 'ARMA');
    assert.strictEqual(service.extractCourseCode('PVT-ROB-ARMA01'), 'ARMA');
    assert.strictEqual(service.extractCourseCode('TK-ROB-ARMA05'), 'ARMA');

    const armaData = await service.getMergedCourseData('ARMA');
    assert.ok(armaData, 'ARMA data should be loaded');
    assert.strictEqual(armaData.sessions.length, 14, 'ARMA must have 14 sessions');

    const expectedArmaSlides = {
      1: 'https://docs.google.com/presentation/d/1h89IOyPCo4FSDIwqbj1UyoTyyyxFy2_T/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      2: 'https://docs.google.com/presentation/d/1qKn--eumiEBH77xBzebXLuiVx37DRRzV/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      3: 'https://docs.google.com/presentation/d/1vcs2-fGzFDqFBHT2ZF10CtdHTmbhdS2g/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      4: 'https://docs.google.com/presentation/d/1VrtLb6XD811RU5xSJsORXpX4ZyR1WbZa/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      5: 'https://docs.google.com/presentation/d/1mC2fS_dxIb5Jl9UHHZP7ITpdvnKUxfW0/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      6: 'https://docs.google.com/presentation/d/1DnThP36PoR03-MWvofV98zCcC3AaZqWv/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      7: 'https://docs.google.com/presentation/d/1G2eQ08jWymFIqEmYE94aEImVDvhQhKJd/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      8: 'https://docs.google.com/presentation/d/1JZz5nYlOXRyGa0Zxfg-oPP0r0IEsoiGi/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      9: 'https://docs.google.com/presentation/d/1o2ObKgq4Ef_MHMiCFqiqYefG6lDI2v0m/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      10: 'https://docs.google.com/presentation/d/16MI7akEzi9Pb-XiQQsEJ8Gj7yKEYuVSy/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      11: 'https://docs.google.com/presentation/d/1cJ9pHNrnevIOF6laT6KwAEsKyTmf3kJv/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true',
      12: 'https://docs.google.com/presentation/d/1HfEwx2myZboErYR_PpB7ZXoTOmOrafBu/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true'
    };

    for (let i = 1; i <= 12; i++) {
      const s = armaData.sessions.find(x => x.sessionNumber === i);
      assert.ok(s, `Missing ARMA session ${i}`);
      assert.strictEqual(s.slideUrl, expectedArmaSlides[i], `ARMA Session ${i} slideUrl mismatch`);
      assert.ok(s.slideUrl.startsWith('https://docs.google.com/presentation/d/'));
      assert.ok(s.slideUrl.endsWith('&sd=true'));
    }

    const s13 = armaData.sessions.find(x => x.sessionNumber === 13);
    const s14 = armaData.sessions.find(x => x.sessionNumber === 14);
    assert.ok(s13 && s14, 'Missing ARMA session 13 or 14');
    assert.strictEqual(s13.slideUrl, '');
    assert.strictEqual(s14.slideUrl, '');
  });

  // 28. Curriculum Bento Grid UI & CSP check
  await runTest('Curriculum Tab Bento Grid: no Zalo/Copy/EditSlide/counts, has 3 actions (Slide, Build, QR), and 0 inline events', async () => {
    const htmlContent = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const currTabJs = fs.readFileSync(path.join(ROOT, 'js/tabs/curriculum.js'), 'utf8');

    // Extract #tab-curriculum section from index.html
    const startIdx = htmlContent.indexOf('<section id="tab-curriculum"');
    const endIdx = htmlContent.indexOf('</section>', startIdx);
    const currHtml = htmlContent.slice(startIdx, endIdx);

    assert.strictEqual(currHtml.includes('(9 khóa)'), false, 'index.html must not contain (9 khóa)');
    assert.strictEqual(currHtml.includes('(15 khóa)'), false, 'index.html must not contain (15 khóa)');
    assert.strictEqual(currTabJs.includes('Báo bài Zalo'), false, 'curriculum.js must not contain Báo bài Zalo');
    assert.strictEqual(currTabJs.includes('Copy Tóm tắt'), false, 'curriculum.js must not contain Copy Tóm tắt');
    assert.strictEqual(currTabJs.includes('btn-slide-edit-inline'), false, 'curriculum.js must not contain slide edit pencil');
    assert.strictEqual(/\bon(click|change)\s*=\s*["']/i.test(currTabJs), false, 'curriculum.js must have 0 inline events');
    assert.strictEqual(/\bon(click|change)\s*=\s*["']/i.test(currHtml), false, 'curriculum HTML must have 0 inline events');

    // Verify 3 actions in curriculum.js card template
    assert.ok(currTabJs.includes('Mở Slide'));
    assert.ok(currTabJs.includes('Link lắp ráp'));
    assert.ok(currTabJs.includes('Mã QR'));
    assert.ok(currHtml.includes('sessions-bento-grid'));
  });

  // 29. QR Code Generator & Modal switching (buildUrl & slideUrl)
  await runTest('Curriculum QR Modal: generates 240x240 SVG offline and switches between buildUrl and slideUrl', async () => {
    const rawQr = fs.readFileSync(path.join(ROOT, 'js/services/qrGenerator.js'), 'utf8');
    const qrUrl = `data:text/javascript;base64,${Buffer.from(rawQr, 'utf8').toString('base64')}`;
    const { generateQrSvg } = await import(qrUrl);

    const sampleSlide = 'https://docs.google.com/presentation/d/1b3ergNl3Cw4H8ZKmppkd6KbNyf8xenzz/edit?usp=drivesdk&ouid=101545815412274045929&rtpof=true&sd=true';
    const sampleBuild = 'https://drive.google.com/file/d/1wpc4bWEV84Opk1Vnmk3LAhSRDZ41kdiV/view';

    const svg1 = generateQrSvg(sampleSlide, 240);
    assert.ok(svg1.startsWith('<svg ') && svg1.includes('width="240"') && svg1.includes('height="240"'));
    assert.ok(svg1.includes('<path d="M'));

    // Mock DOM for openQrModal & switchQrType
    const elements = {};
    const makeEl = (id) => {
      const cls = new Set();
      return {
        id,
        style: {},
        textContent: '',
        innerHTML: '',
        title: '',
        classList: {
          toggle: (c, force) => { if (force) cls.add(c); else cls.delete(c); },
          contains: (c) => cls.has(c)
        },
        addEventListener: () => {}
      };
    };
    [
      'modal-qr', 'qr-modal-title', 'qr-modal-tabs', 'btn-qr-tab-build',
      'btn-qr-tab-slide', 'qr-modal-type-badge', 'qr-modal-canvas', 'qr-modal-url'
    ].forEach(id => { elements[id] = makeEl(id); });

    global.document = {
      getElementById: (id) => elements[id] || null,
      querySelectorAll: () => []
    };

    const rawCurr = fs.readFileSync(path.join(ROOT, 'js/services/curriculum.js'), 'utf8');
    const currSvcUrl = `data:text/javascript;base64,${Buffer.from(rawCurr, 'utf8').toString('base64')}`;
    const rawToast = fs.readFileSync(path.join(ROOT, 'js/services/toast.js'), 'utf8');
    const toastUrl = `data:text/javascript;base64,${Buffer.from(rawToast, 'utf8').toString('base64')}`;
    const rawIcons = fs.readFileSync(path.join(ROOT, 'js/services/icons.js'), 'utf8');
    const iconsUrl = `data:text/javascript;base64,${Buffer.from(rawIcons, 'utf8').toString('base64')}`;

    const rawCurrTab = fs.readFileSync(path.join(ROOT, 'js/tabs/curriculum.js'), 'utf8')
      .replace("from '../services/curriculum.js'", `from '${currSvcUrl}'`)
      .replace("from '../services/toast.js'", `from '${toastUrl}'`)
      .replace("from '../services/icons.js'", `from '${iconsUrl}'`)
      .replace("from '../services/qrGenerator.js'", `from '${qrUrl}'`);
    const currTabUrl = `data:text/javascript;base64,${Buffer.from(rawCurrTab, 'utf8').toString('base64')}`;
    const { openQrModal, switchQrType } = await import(currTabUrl);

    openQrModal({
      sessionNumber: 3,
      title: 'Phương tiện di chuyển trên sao Hỏa',
      buildUrl: sampleBuild,
      slideUrl: sampleSlide
    });

    assert.strictEqual(elements['modal-qr'].style.display, 'flex');
    assert.strictEqual(elements['qr-modal-tabs'].style.display, 'inline-flex');
    assert.strictEqual(elements['qr-modal-type-badge'].textContent, 'QR Link lắp ráp');
    assert.strictEqual(elements['qr-modal-url'].textContent, sampleBuild);
    assert.ok(elements['qr-modal-canvas'].innerHTML.includes('width="240"'));

    switchQrType('slide');
    assert.strictEqual(elements['qr-modal-type-badge'].textContent, 'QR Slide bài giảng');
    assert.strictEqual(elements['qr-modal-url'].textContent, sampleSlide);
    assert.ok(elements['qr-modal-canvas'].innerHTML.includes('width="240"'));
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
