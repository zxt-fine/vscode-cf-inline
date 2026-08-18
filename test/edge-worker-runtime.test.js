const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('reuses one inactive owned Edge tab for repeated submissions and returns the exact ids', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'edge-extension', 'service-worker.js'), 'utf8');
  const updatedListeners = new Set();
  const removedListeners = new Set();
  const sessionStore = {};
  const updates = [];
  const socketUrls = [];
  let createCount = 0;
  let executeCount = 0;
  let currentUrl = '';
  const tab = { id: 71, windowId: 9, status: 'complete', active: false, url: currentUrl };

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url) {
      this.readyState = FakeWebSocket.CONNECTING;
      socketUrls.push(url);
    }
  }

  const event = () => ({ addListener() {}, removeListener() {} });
  const chrome = {
    action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    alarms: { create() {}, onAlarm: event() },
    cookies: {
      getAll: async () => [],
      onChanged: event(),
    },
    runtime: {
      getManifest: () => ({ version: 'test' }),
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
    },
    storage: {
      session: {
        async get(key) { return { [key]: sessionStore[key] }; },
        async set(value) { Object.assign(sessionStore, value); },
        async remove(key) { delete sessionStore[key]; },
      },
    },
    windows: {
      async getAll() { return [{ id: 9 }]; },
      async create() { throw new Error('an existing Edge window should be reused'); },
      async update() {},
    },
    tabs: {
      async create(options) {
        createCount += 1;
        currentUrl = options.url;
        tab.url = currentUrl;
        tab.active = options.active;
        return { ...tab };
      },
      async get() { return { ...tab, url: currentUrl, status: 'complete' }; },
      async query() { return []; },
      async remove(id) { for (const listener of removedListeners) listener(id); },
      async update(id, options) {
        assert.equal(id, tab.id);
        updates.push({ ...options });
        if (options.url) currentUrl = options.url;
        if (typeof options.active === 'boolean') tab.active = options.active;
        tab.url = currentUrl;
        return { ...tab };
      },
      onUpdated: {
        addListener(listener) { updatedListeners.add(listener); },
        removeListener(listener) { updatedListeners.delete(listener); },
      },
      onRemoved: {
        addListener(listener) { removedListeners.add(listener); },
        removeListener(listener) { removedListeners.delete(listener); },
      },
    },
    scripting: {
      async executeScript() {
        executeCount += 1;
        if (executeCount % 2 === 1) {
          setTimeout(() => {
            currentUrl = 'https://codeforces.com/contest/1/my';
            for (const listener of [...updatedListeners]) listener(tab.id, { status: 'loading', url: currentUrl }, { ...tab, url: currentUrl });
            for (const listener of [...updatedListeners]) listener(tab.id, { status: 'complete' }, { ...tab, url: currentUrl });
          }, 0);
          return [{ result: { scheduled: true } }];
        }
        const id = executeCount === 2 ? '101' : '102';
        return [{ result: { html: '<html><body>accepted</body></html>', url: currentUrl, submissionId: id } }];
      },
    },
  };

  const context = {
    URL,
    TextEncoder,
    Uint8Array,
    atob,
    btoa,
    chrome,
    console,
    navigator: { userAgent: 'Edge test' },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout,
    clearTimeout,
    WebSocket: FakeWebSocket,
  };
  context.globalThis = context;
  vm.runInNewContext(`${source}\n;globalThis.__workerTest = { performSubmission, connect };`, context);

  assert.equal(socketUrls.length, 10);
  assert.equal(new Set(socketUrls).size, 10);
  assert.match(socketUrls[0], /127\.0\.0\.1:27121/);
  assert.match(socketUrls[9], /127\.0\.0\.1:27130/);
  context.__workerTest.connect();
  assert.equal(socketUrls.length, 10, 'an alarm must not duplicate connecting sockets');

  const first = await context.__workerTest.performSubmission({
    url: 'https://codeforces.com/contest/1/submit', contestId: '1', index: 'A',
    programTypeId: '89', previousSubmissionId: '100', source: 'int main(){}',
  }, () => undefined);
  const second = await context.__workerTest.performSubmission({
    url: 'https://codeforces.com/contest/1/submit', contestId: '1', index: 'A',
    programTypeId: '89', previousSubmissionId: '101', source: 'int main(){return 0;}',
  }, () => undefined);

  assert.equal(createCount, 1);
  assert.equal(tab.active, false);
  assert.equal(first.headers['x-cf-inline-submission-id'], '101');
  assert.equal(second.headers['x-cf-inline-submission-id'], '102');
  assert.equal(updates.filter((item) => item.url === 'https://codeforces.com/contest/1/submit').length, 2);
  assert.equal(updates.filter((item) => item.url === 'https://codeforces.com/#__cf_inline_bridge').length, 2);
  assert.equal(updates.some((item) => item.active === true), false);
});
