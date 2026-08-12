const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const calls = [];
let availableCommands = ['workbench.action.browser.open'];
let viewer = 'integratedBrowser';
let fastMode = true;
const closedTabs = [];
const activeTabGroup = { tabs: [], activeTab: undefined };
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
  window: {
    tabGroups: {
      all: [activeTabGroup],
      activeTabGroup,
      close: async (tabs) => { closedTabs.push(...tabs); return true; },
    },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const {
  integratedBrowserUrl,
  integratedBrowserReuseFilter,
  isCodeforcesBrowserTabLabel,
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
  assert.equal(
    integratedBrowserReuseFilter(proxy),
    'http://127.0.0.1:45678/__cf_inline/*'
  );

  await openInIntegratedBrowser(proxy);
  assert.deepEqual(calls, [[
    'workbench.action.browser.open',
    {
      url: 'http://127.0.0.1:45678/__cf_inline/fast',
      reuseUrlFilter: 'http://127.0.0.1:45678/__cf_inline/*',
    },
  ]]);
});

test('reuses the existing Codeforces browser editor on repeated opens', async () => {
  calls.length = 0;
  availableCommands = ['workbench.action.browser.open'];
  const proxy = connectedProxy('/groups/my');

  await openInIntegratedBrowser(proxy);
  await openInIntegratedBrowser(proxy);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call[0], 'workbench.action.browser.open');
    assert.equal(call[1].reuseUrlFilter, `${proxy.origin}/__cf_inline/*`);
  }
});

test('keeps the active Codeforces browser tab and closes existing duplicates', async () => {
  calls.length = 0;
  closedTabs.length = 0;
  availableCommands = ['workbench.action.browser.open'];
  const first = { label: 'Codeforces 极速模式', isActive: false, isDirty: false };
  const active = { label: 'Codeforces 极速模式', isActive: true, isDirty: false };
  const normal = { label: 'Codeforces 正常模式', isActive: false, isDirty: false };
  const source = { label: 'main.cpp', isActive: false, isDirty: false };
  activeTabGroup.tabs = [source, first, active, normal];
  activeTabGroup.activeTab = active;
  try {
    await openInIntegratedBrowser(connectedProxy());
    assert.deepEqual(closedTabs, [first, normal]);
    assert.equal(isCodeforcesBrowserTabLabel(source.label), false);
    assert.equal(isCodeforcesBrowserTabLabel(active.label), true);
  } finally {
    activeTabGroup.tabs = [];
    activeTabGroup.activeTab = undefined;
  }
});

test('coalesces rapid repeated clicks while the browser editor is opening', async () => {
  calls.length = 0;
  availableCommands = ['workbench.action.browser.open'];
  const originalExecute = vscodeStub.commands.executeCommand;
  let release;
  vscodeStub.commands.executeCommand = (...args) => {
    calls.push(args);
    return new Promise((resolve) => { release = resolve; });
  };
  try {
    const proxy = connectedProxy('/groups/my');
    const first = openInIntegratedBrowser(proxy);
    const second = openInIntegratedBrowser(proxy);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    release();
    await Promise.all([first, second]);
  } finally {
    vscodeStub.commands.executeCommand = originalExecute;
  }
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
