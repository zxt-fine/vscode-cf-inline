const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

let createdPanel;
let createdViewColumn;
const vscodeStub = {
  ViewColumn: { One: 1, Active: -1 },
  window: {
    createWebviewPanel(_type, _title, viewColumn) {
      createdViewColumn = viewColumn;
      let disposeHandler;
      createdPanel = {
        webview: {
          html: '',
          onDidReceiveMessage() {},
          postMessage() { return Promise.resolve(true); },
        },
        onDidDispose(handler) { disposeHandler = handler; },
        reveal() {},
        dispose() { disposeHandler = undefined; },
      };
      return createdPanel;
    },
  },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const { CfPanel } = require('../out/panel.js');

test('webview reports connected only for a verified account and acquires VS Code API once', () => {
  const context = { secrets: {} };
  const proxy = {
    origin: 'http://127.0.0.1:45678',
    currentUrlPath: '/groups/my',
    isLoggedIn() { return false; },
    isSessionReady() { return false; },
    on() {},
    off() {},
  };
  CfPanel.createOrShow(context, proxy, { connected: false });
  const html = createdPanel.webview.html;

  assert.equal(createdViewColumn, vscodeStub.ViewColumn.Active);
  assert.equal((html.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
  assert.match(html, /id="bridge" src="http:\/\/127\.0\.0\.1:45678\/__cf_inline\/bridge"/);
  assert.match(html, /event\.source === bridge\.contentWindow && data\.__cfInlineBridge/);
  assert.doesNotMatch(html, /fetch\(origin \+ '\/__cf_inline\/state'/);
  assert.match(html, /const connected = !!state\.sessionReady && !!state\.loggedIn/);
  assert.match(html, /已登录 · Edge 已连接/);
  assert.match(html, /保持 Edge 登录会话/);
  assert.match(html, /首次安装配套扩展/);
  assert.doesNotMatch(html, /id="installEdgeExtension"/);
  assert.doesNotMatch(html, /保存登录|saveLogin/);
  for (const pathname of ['/groups/my', '/contests', '/gyms', '/problemset']) {
    assert.match(html, new RegExp(`data-path="${pathname}"`));
  }
  assert.match(html, /id="loadProgress"/);
  assert.match(html, /id="loginProgress"/);
  assert.match(html, /id="loginStage"/);
  assert.match(html, /id="loginProgressBar"/);
  assert.match(html, /function updateLoginProgress\(text\)/);
  assert.match(html, /let currentLoginStage = '正在连接 Edge…'/);
  assert.match(html, /正在验证 我的群组/);
  assert.match(html, /正在验证 比赛/);
  assert.match(html, /正在验证 训练营/);
  assert.match(html, /正在验证 题库/);
  assert.match(html, /正在限流预检/);
  assert.match(html, /预处理进度 4\/4/);
  assert.match(html, /常用页面预处理完成/);
  assert.match(html, /data\.type === 'loginProgress'/);
  assert.match(html, /验证完成，正在加载 Codeforces 页面/);
  assert.match(html, /function startLoading\(\)/);
  assert.match(html, /加载时间较长，仍在等待 Edge 返回页面/);
  assert.match(html, /页面可能已卡住/);
  assert.match(html, /data\.__cfInlinePageReady/);
  assert.match(html, /data\.__cfInlinePageLoading/);
  assert.match(html, /data\.__cfInlinePageError/);
  assert.match(html, /frame\.src = 'about:blank'/);
  assert.doesNotMatch(html, /id="submit"|type: 'submit'/);
});

test('activity login panel switches to the integrated browser after a restored Edge session', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'panel.ts'), 'utf8');
  assert.match(source, /proxy\.on\('sessionChange', this\.handleSessionChange\)/);
  assert.match(source, /private async maybeOpenIntegratedBrowser/);
  assert.match(source, /await openInIntegratedBrowser\(this\.proxy\)/);
  assert.match(source, /this\.panel\.dispose\(\)/);
  assert.match(source, /proxy\.off\('sessionChange', this\.handleSessionChange\)/);
});
