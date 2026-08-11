const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const calls = [];
let availableCommands = ['workbench.action.browser.open'];
let viewer = 'integratedBrowser';
let fastMode = true;
const vscodeStub = {
  commands: {
    getCommands: async () => availableCommands,
    executeCommand: async (...args) => { calls.push(args); },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => {
        if (key === 'viewer') return viewer ?? fallback;
        if (key === 'fastMode') return fastMode;
        return fallback;
      },
    }),
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const {
  integratedBrowserUrl,
  openInIntegratedBrowser,
  prefersIntegratedBrowser,
} = require('../out/integrated-browser.js');

function connectedProxy(path = '/groups/my') {
  return {
    origin: 'http://127.0.0.1:45678',
    currentUrlPath: path,
    isLoggedIn: () => true,
    isSessionReady: () => true,
  };
}

test('opens the lightweight fast-mode shell in the native VS Code browser', async () => {
  calls.length = 0;
  availableCommands = ['workbench.action.browser.open', 'simpleBrowser.show'];
  const proxy = connectedProxy('/problemset/problem/1/A');
  assert.equal(integratedBrowserUrl(proxy), 'http://127.0.0.1:45678/__cf_inline/fast');
  assert.equal(
    integratedBrowserUrl(proxy, false),
    'http://127.0.0.1:45678/__cf_inline/full'
  );

  await openInIntegratedBrowser(proxy);
  assert.deepEqual(calls, [[
    'workbench.action.browser.open',
    'http://127.0.0.1:45678/__cf_inline/fast',
  ]]);
});

test('falls back to Simple Browser on VS Code versions without the native browser command', async () => {
  calls.length = 0;
  availableCommands = ['simpleBrowser.show'];
  await openInIntegratedBrowser(connectedProxy());
  assert.equal(calls[0][0], 'simpleBrowser.show');
});

test('requires a verified session and respects the viewer setting', async () => {
  viewer = 'embeddedPanel';
  assert.equal(prefersIntegratedBrowser(), false);
  viewer = 'integratedBrowser';
  assert.equal(prefersIntegratedBrowser(), true);
  await assert.rejects(
    openInIntegratedBrowser({
      ...connectedProxy(),
      isSessionReady: () => false,
    }),
    /请先连接并验证/
  );
});

test('can disable fast mode without changing the integrated browser viewer', () => {
  fastMode = false;
  assert.equal(
    integratedBrowserUrl(connectedProxy('/contests')),
    'http://127.0.0.1:45678/__cf_inline/full'
  );
  fastMode = true;
});
