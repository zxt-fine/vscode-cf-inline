const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildBrowserArguments,
  buildControlledEdgeAppearanceScript,
  buildOfficialSubmissionExpression,
  detectCodeforcesAuthentication,
  isPersonalGroupsUrl,
} = require('../out/browser-login.js');
const { CONTROLLED_CODEFORCES_DESKTOP_CSS } = require('../out/localization.js');

test('injects a restricted desktop Chinese appearance without browser extensions', () => {
  const script = buildControlledEdgeAppearanceScript();
  assert.match(script, /html\{min-width:0!important/);
  assert.match(script, /--cf-inline-page-gap,40px/);
  assert.match(script, /"Contests":"比赛"/);
  assert.match(script, /"Groups":"群组"/);
  assert.match(script, /"СОРЕВНОВАНИЯ":"比赛"/);
  assert.match(script, /locale=en/);
  assert.match(script, /switchRussianPageToEnglish/);
  assert.match(script, /cf-inline-page-zoom/);
  assert.match(script, /MutationObserver/);
  assert.ok(script.includes(JSON.stringify(CONTROLLED_CODEFORCES_DESKTOP_CSS)));
  assert.doesNotMatch(script, /Codeforces Better/);
  assert.doesNotThrow(() => new Function(script));
});

test('does not accept an anonymous page merely because a stale account cookie may exist', () => {
  const html = `<!doctype html><html><body>
    <a href="/enter?back=%2Fgroups%2Fmy">Enter</a>
    <a href="/register">Register</a>
    <section>Groups are publicly readable</section>
  </body></html>`;
  assert.equal(
    detectCodeforcesAuthentication(html, 'https://codeforces.com/groups/my'),
    'anonymous'
  );
});

test('requires both the account profile and logout controls to confirm authentication', () => {
  const html = `<!doctype html><html><body>
    <a href="https://codeforces.com/profile/tourist">tourist</a>
    <a href="/logout">Logout</a>
  </body></html>`;
  assert.equal(
    detectCodeforcesAuthentication(html, 'https://codeforces.com/groups/my'),
    'authenticated'
  );
  assert.equal(
    detectCodeforcesAuthentication('<html><body>ordinary page</body></html>'),
    'unknown'
  );
});

test('accepts only the account-specific groups endpoint as My Groups', () => {
  assert.equal(isPersonalGroupsUrl('https://codeforces.com/groups/my'), true);
  assert.equal(isPersonalGroupsUrl('https://codeforces.com/groups/my/'), true);
  assert.equal(isPersonalGroupsUrl('https://codeforces.com/groups'), false);
  assert.equal(isPersonalGroupsUrl('https://codeforces.com/groups/withMe'), false);
});

test('treats the login form and login redirect as anonymous', () => {
  assert.equal(
    detectCodeforcesAuthentication('<form id="enterForm"></form>', 'https://codeforces.com/enter'),
    'anonymous'
  );
});

test('starts a reusable restricted Edge profile with the correct window state', () => {
  const visible = buildBrowserArguments('C:\\profile', 12345, false);
  const background = buildBrowserArguments('C:\\profile', 12345, true);
  assert.equal(visible.includes('--start-minimized'), false);
  assert.equal(visible.includes('--start-maximized'), false);
  assert.equal(visible.includes('--window-size=1200,800'), true);
  assert.equal(visible.includes('--window-position=80,50'), true);
  assert.equal(background.includes('--start-minimized'), true);
  assert.equal(background.includes('--start-maximized'), false);
  assert.equal(background.some((item) => item.startsWith('--window-size=')), false);
  assert.ok(background.includes('--user-data-dir=C:\\profile'));
  assert.equal(background.includes('--disable-extensions'), true);
  assert.equal(background.includes('--disable-sync'), true);
  assert.ok(background.some((item) => item.startsWith('https://codeforces.com/enter?back=')));
});

test('keeps login progress visible in the global VS Code status bar', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'out', 'browser-login.js'), 'utf8');
  assert.match(source, /createStatusBarItem/);
  assert.match(source, /Codeforces 登录进度/);
  assert.match(source, /sync~spin/);
  assert.match(source, /登录验证完成，会话已经连接/);
  assert.match(source, /登录失败/);
  assert.match(source, /已确认 Microsoft Edge/);
  assert.match(source, /插件专用受控配置/);
  assert.match(source, /扩展和同步保持关闭/);
  assert.doesNotMatch(source, /Google[\\',\s]+Chrome[\\',\s]+Application/);
});

test('uses a larger priority queue and browser cache for Codeforces assets', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'out', 'browser-login.js'), 'utf8');
  assert.match(source, /MAX_CONCURRENT_BROWSER_REQUESTS = 12/);
  assert.match(source, /queued\.priority < waiter\.priority/);
  assert.match(source, /force-cache/);
  assert.match(source, /request\.cacheMode/);
});

test('labels translation failures separately from Codeforces transport failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'out', 'browser-login.js'), 'utf8');
  assert.match(source, /Google 翻译/);
  assert.match(source, /请求超时（/);
  assert.match(source, /upstreamLabel/);
});

test('prechecks common pages with two workers and reuses the first document response', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'out', 'browser-login.js'), 'utf8');
  assert.match(source, /Promise\.all\(\[worker\(\), worker\(\)\]\)/);
  assert.match(source, /限流预检/);
  assert.doesNotMatch(source, /\['\/', '主页'\]/);
  assert.match(source, /prefetchedDocuments/);
  assert.match(source, /45_000|45000/);
  assert.match(source, /常用页面预处理完成/);
});

test('submits through a live official Edge page instead of forging anti-bot parameters', () => {
  const expression = buildOfficialSubmissionExpression({
    url: 'https://codeforces.com/contest/1/submit',
    contestId: '1',
    index: 'A',
    programTypeId: '89',
    source: 'int main() { return 0; }',
  });
  assert.match(expression, /window\._ftaa/);
  assert.match(expression, /window\._bfaa/);
  assert.match(expression, /new FormData\(form\)/);
  assert.match(expression, /form\.getAttribute\('action'\)/);
  assert.match(expression, /credentials: 'include'/);
  assert.doesNotMatch(expression, /caf4f|adcd1e/);
  assert.doesNotThrow(() => new Function(expression));
});
