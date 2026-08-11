const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildResolvedSubmitUrl,
  buildSubmitUrl,
  extractSubmitError,
  isSubmitSuccessMessage,
  parseProblemFromPath,
  parseProblemInput,
  parseSubmitPage,
} = require('../out/submit.js');

const submitPage = `<!doctype html><html><head>
  <meta name="X-Csrf-Token" content="csrf-value">
</head><body>
  <form class="submit-form submitFrameForm" method="post"
        action="?csrf_token=csrf-value&amp;from=browser" enctype="multipart/form-data">
    <input type="hidden" name="csrf_token" value="csrf-value">
    <input type="hidden" name="ftaa" value="">
    <input type="hidden" name="bfaa" value="">
    <input type="hidden" name="action" value="submitSolutionFormSubmitted">
    <input type="hidden" name="contestId" value="1">
    <select name="programTypeId">
      <option value="54">GNU G++17 7.3.0</option>
      <option value="89">GNU G++20 13.2</option>
    </select>
    <textarea name="source"></textarea>
  </form>
  <script>$(function(){ window._ftaa = "ftaa-browser-value"; });</script>
  <script>$(function(){ window._bfaa = "bfaa-browser-value"; });</script>
  <script>
    $(function(){ $(".submitFrameForm").each(function(){
      const value = 'caf4f' + Math.random().toString(36).substr(2, 9);
      const formAction = $(this).attr("action");
      $(this).attr("action", appendParameterToUrl(formAction, "adcd1e", value));
    }); });
  </script>
</body></html>`;

test('reconstructs Codeforces browser-generated submit fields and action parameters', () => {
  const parsed = parseSubmitPage(submitPage);
  assert.equal(parsed.csrfToken, 'csrf-value');
  assert.equal(parsed.hiddenFields.ftaa, 'ftaa-browser-value');
  assert.equal(parsed.hiddenFields.bfaa, 'bfaa-browser-value');
  assert.deepEqual(parsed.languages.map((item) => item.value), ['54', '89']);

  const target = new URL(buildResolvedSubmitUrl(
    'http://127.0.0.1:45678/contest/1/submit/A',
    parsed
  ));
  assert.equal(target.pathname, '/contest/1/submit/A');
  assert.equal(target.searchParams.get('csrf_token'), 'csrf-value');
  assert.equal(target.searchParams.get('from'), 'browser');
  assert.match(target.searchParams.get('adcd1e'), /^caf4f[a-z0-9]{1,9}$/);
});

test('does not report success when Codeforces returns the submit form with an error', () => {
  assert.equal(
    extractSubmitError(200, '<div class="error for__source">Source should be non-empty</div>'),
    '提交被拒绝：Source should be non-empty'
  );
  assert.match(
    extractSubmitError(200, '<form class="submit-form"></form>'),
    /未确认提交成功/
  );
  assert.equal(extractSubmitError(200, '<main>Submission accepted</main>'), undefined);
});

test('recognizes Codeforces showMessage success even when the submit form remains in the response', () => {
  const success = `<!doctype html><html><body>
    <form class="submit-form"></form>
    <script>Codeforces.showMessage("Solution to the problem A has been submitted successfully")</script>
  </body></html>`;
  assert.equal(isSubmitSuccessMessage('Solution to the problem A has been submitted successfully'), true);
  assert.equal(isSubmitSuccessMessage('Решение задачи A успешно отправлено на проверку'), true);
  assert.equal(extractSubmitError(200, success), undefined);
  assert.equal(
    extractSubmitError(200, '<script>Codeforces.showError("Source should be non-empty")</script>'),
    '提交被拒绝：Source should be non-empty'
  );
});

test('recognizes the official Russian Codeforces success notification', () => {
  const success = `<!doctype html><html><body>
    <form class="submit-form"></form>
    <script>Codeforces.showMessage("Решение задачи A успешно отправлено на проверку")</script>
  </body></html>`;
  assert.equal(extractSubmitError(200, success), undefined);
});

test('never mistakes the injected submit-error matcher source for a Codeforces error', () => {
  const injected = `<!doctype html><html><body>
    <main>Ordinary submissions page</main>
    <script>
      var knownError = pageText.match(/(?:Source should differ from previously submitted|You have submitted (?:exactly )?the same code before|Duplicate submission)/i);
    </script>
  </body></html>`;
  assert.equal(extractSubmitError(200, injected), undefined);
});

test('reports the exact duplicate-source error and preserves proxy failure details', () => {
  const duplicate = `<!doctype html><html><body>
    <div class="error"></div>
    <form class="submit-form">
      <span class="error for__source">Source should differ from previously submitted</span>
    </form>
  </body></html>`;
  assert.equal(
    extractSubmitError(200, duplicate),
    '提交被拒绝：Source should differ from previously submitted'
  );
  assert.equal(
    extractSubmitError(200, '<script>Codeforces.showMessage("You have submitted exactly the same code before.")</script>'),
    '提交被拒绝：You have submitted exactly the same code before.'
  );
  assert.equal(
    extractSubmitError(502, '<h2>Edge 会话已断开</h2><code>Edge 请求 Codeforces 失败：Failed to fetch</code>'),
    '提交请求失败（HTTP 502）：Edge 请求 Codeforces 失败：Failed to fetch'
  );
});

test('parses every supported problem route and builds its canonical submit page', () => {
  const origin = 'http://127.0.0.1:45678';
  const cases = [
    ['/contest/2050/problem/A', '/contest/2050/submit', 'contest'],
    ['/gym/105001/problem/B2', '/gym/105001/submit', 'gym'],
    ['/problemset/problem/2050/C', '/problemset/submit', 'problemset'],
    ['/group/private-team/contest/123456/problem/D', '/group/private-team/contest/123456/submit', 'group'],
  ];
  for (const [problemPath, submitPath, kind] of cases) {
    const problem = parseProblemFromPath(problemPath);
    assert.ok(problem, problemPath);
    assert.equal(problem.kind, kind);
    assert.equal(buildSubmitUrl(origin, problem), origin + submitPath);
    assert.deepEqual(parseProblemInput('https://codeforces.com' + problemPath), problem);
  }
});
