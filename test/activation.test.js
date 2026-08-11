const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('does not launch Edge while VS Code is merely activating the extension', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  assert.doesNotMatch(source, /restoreSavedBrowserSession/);
  const loginCalls = [...source.matchAll(/loginWithOfficialBrowser\(/g)];
  assert.equal(loginCalls.length, 1);
  assert.ok(loginCalls[0].index > source.indexOf('const handleReloginRequest'));
  assert.match(source, /proxy\.on\('reloginRequest', handleReloginRequest\)/);
  assert.match(source, /Do not start Edge during VS Code activation/);
});

test('relies on VS Code generated activation events for contributed commands', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'activationEvents'), false);
  assert.deepEqual(manifest.contributes.commands.map((entry) => entry.command), [
    'cfInline.open',
    'cfInline.openIntegratedBrowser',
    'cfInline.openPanel',
    'cfInline.submit',
    'cfInline.openLogin',
  ]);
  const containerId = manifest.contributes.viewsContainers.activitybar[0].id;
  assert.equal(containerId, 'cfInline-activity');
  assert.match(containerId, /^[A-Za-z0-9_-]+$/);
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].icon, 'assets/codeforces.svg');
  assert.equal(manifest.contributes.views[containerId][0].id, 'cfInline.activityView');
});

test('registers a native Codeforces activity-bar sidebar without launching Edge', () => {
  const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'sidebar.ts'), 'utf8');
  assert.match(extensionSource, /registerCfSidebar\(proxy\)/);
  assert.match(sidebarSource, /registerTreeDataProvider\(SIDEBAR_VIEW_ID, provider\)/);
  assert.match(sidebarSource, /'打开 Codeforces'/);
  assert.match(sidebarSource, /'登录并连接'/);
  assert.match(sidebarSource, /'提交当前代码文件'/);
  assert.doesNotMatch(sidebarSource, /loginWithOfficialBrowser|captureCodeforcesSession/);
});

test('shows the login panel first and leaves Edge launch to its button', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  assert.match(source, /The first visible step is always the extension login page/);
  assert.match(source, /CfPanel\.createOrShow\(context, proxy!\)/);
  assert.doesNotMatch(source, /registerCommand\('cfInline\.openLogin',[\s\S]{0,200}loginWithOfficialBrowser/);
});
