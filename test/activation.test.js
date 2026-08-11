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
});

test('shows the login panel first and leaves Edge launch to its button', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
  assert.match(source, /The first visible step is always the extension login page/);
  assert.match(source, /CfPanel\.createOrShow\(context, proxy!\)/);
  assert.doesNotMatch(source, /registerCommand\('cfInline\.openLogin',[\s\S]{0,200}loginWithOfficialBrowser/);
});
