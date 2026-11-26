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
  });

  // 5. CSP Manifest V3 check (no inline onclick="..." attributes in HTML or template strings)
  await runTest('CSP Manifest V3: no inline onclick attributes in HTML/JS files', async () => {
    const files = ['index.html', 'js/tabs/classes.js', 'js/tabs/review.js', 'extension/content-lms.js'];
    for (const f of files) {
      const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.strictEqual(/\bonclick\s*=\s*["']/i.test(content), false, `Found inline onclick= in ${f}`);
    }
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
