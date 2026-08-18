const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const test = require('node:test');
const { CfProxy, classifyCodeforcesSubmissionResponse, formatSubmissionVerdict } = require('../out/proxy.js');

const VALID_USER = '0123456789abcdef0123456789abcdef01234567';

class FakeTransport {
  constructor(handler) {
    this.handler = handler;
    this.requests = [];
    this.submissions = [];
    this.disposed = false;
    this.alive = true;
  }

  async request(request) {
    this.requests.push(request);
    return this.handler(request);
  }

  async submitSolution(request) {
    this.submissions.push(request);
    return this.handler({ ...request, method: 'BROWSER_SUBMIT' });
  }

  async dispose() {
    this.disposed = true;
    this.alive = false;
  }

  isAlive() { return this.alive; }
}

function sessionCookie() {
  return {
    name: 'X-User-Sha1',
    value: VALID_USER,
    domain: '.codeforces.com',
    path: '/',
    secure: true,
    httpOnly: true,
  };
}

function response(body, finalUrl = 'https://codeforces.com/groups', statusCode = 200) {
  const bytes = Buffer.from(body, 'utf8');
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
    body: bytes,
    finalUrl,
  };
}

function localRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

test('falls back to a free port when the preferred restart-stable port is occupied', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const occupiedPort = blocker.address().port;
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    defaultPath: '/groups/my',
    port: occupiedPort,
  });
  await proxy.start();
  t.after(() => proxy.stop());
  assert.notEqual(new URL(proxy.origin).port, String(occupiedPort));
});

test('publishes login and live transport atomically, then clears both on detach', async () => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  const transport = new FakeTransport(() => response('<!doctype html><html><body>ok</body></html>'));

  assert.deepEqual(proxy.state().loggedIn, false);
  assert.deepEqual(proxy.state().sessionReady, false);
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  assert.deepEqual(proxy.state().loggedIn, true);
  assert.deepEqual(proxy.state().sessionReady, true);

  await proxy.detachTransport();
  assert.deepEqual(proxy.state().loggedIn, false);
  assert.deepEqual(proxy.state().sessionReady, false);
  assert.deepEqual(transport.disposed, true);
});

test('detects a closed Edge transport without waiting for another page request', async () => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0 });
  const transport = new FakeTransport(() => response('<html><body>ok</body></html>'));
  let changes = 0;
  proxy.on('sessionChange', () => { changes += 1; });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  transport.alive = false;
  proxy.refreshSessionHealth();
  const state = proxy.state();
  assert.equal(state.loggedIn, false);
  assert.equal(state.sessionReady, false);
  assert.match(state.loginMessage, /Edge.*已关闭/);
  assert.equal(transport.disposed, true);
  assert.ok(changes >= 2);
});

test('forwards GET and POST through the attached Edge transport and rewrites HTML', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  const transport = new FakeTransport((request) => request.method === 'POST'
    ? response(
        '<!doctype html><html><body><a href="/profile/tester">tester</a><a href="/logout">Logout</a><main>Submission received</main></body></html>',
        'https://codeforces.com/contest/1/my'
      )
    : response(
        '<!doctype html><html><body><a href="https://codeforces.com/gyms">Gym</a></body></html>',
        request.url
      ));
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const groups = await localRequest(`${proxy.origin}/groups`, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  const groupsHtml = groups.body.toString('utf8');
  assert.equal(groups.statusCode, 200);
  assert.match(transport.requests[0].url, /[?&]mobile=false(?:&|$)/);
  assert.match(groupsHtml, new RegExp(`${proxy.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/gyms`));
  assert.match(groupsHtml, /"Groups":"群组"/);
  assert.match(groupsHtml, /autoTranslateStatements=true/);
  assert.match(groupsHtml, /window\.top === window\.self/);
  assert.match(groupsHtml, /simplifyFastNavigation/);
  assert.match(groupsHtml, /data-cf-inline-fast-hidden/);
  assert.match(groupsHtml, /parent\.location\.pathname === '\/__cf_inline\/fast'/);
  assert.match(groupsHtml, /installReliableCountdowns/);
  assert.match(groupsHtml, /data-cf-inline-live-countdown/);
  assert.match(groupsHtml, /1000 - \(elapsed % 1000\)/);
  assert.match(groupsHtml, /cf-inline-direct-progress/);
  assert.match(groupsHtml, /showDirectNavigationProgress/);
  assert.match(groupsHtml, /delayDirectNavigation/);
  assert.match(groupsHtml, /completeRememberedNavigationProgress/);
  assert.match(groupsHtml, /cfInline\.navigationStarted/);
  assert.match(groupsHtml, /bar\.style\.width = '100%'/);
  assert.match(groupsHtml, /height:6px/);
  assert.match(groupsHtml, /<em>正在加载…<\/em>/);
  assert.match(groupsHtml, /event\.preventDefault\(\)/);
  assert.match(groupsHtml, /location\.assign\(target\.href\)/);
  assert.match(groupsHtml, /正在加载 Codeforces 页面/);
  assert.match(groupsHtml, /\[6000,'94%'\]/);
  for (const script of [...groupsHtml.matchAll(/<script>([\s\S]*?)<\/script>/gi)]) {
    assert.doesNotThrow(() => new Function(script[1]));
  }

  const boundary = '----cfInlineBrowserForm';
  const postBody = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="csrf_token"\r\n\r\nx\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="programTypeId"\r\n\r\n54\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nint main(){}\r\n`
      + `--${boundary}--\r\n`,
    'utf8'
  );
  const submission = await localRequest(`${proxy.origin}/contest/1/submit/A`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Origin: proxy.origin,
      Referer: `${proxy.origin}/contest/1/submit/A`,
    },
    body: postBody,
  });
  assert.equal(submission.statusCode, 200);
  assert.match(submission.body.toString('utf8'), /Submission received/);
  assert.equal(transport.requests[1].method, 'POST');
  assert.deepEqual(transport.requests[1].body, postBody);
  assert.equal(transport.requests[1].url, 'https://codeforces.com/contest/1/submit/A');
  assert.match(transport.requests[1].headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.equal(transport.requests[1].headers.origin, undefined);
  assert.equal(transport.requests[1].headers.referer, undefined);
});

test('forces desktop Codeforces documents and removes a stale mobile toolbar', async (t) => {
  const mobile = '<!doctype html><html><head><link rel="stylesheet" href="https://codeforces.org/s/1/css/mobile.css"></head><body><div class="mobile-toolbar"><div class="mobile-toolbar-internals"><img class="mobile-toolbar-menu"><img class="mobile-toolbar-sidebar"></div></div><div id="body"><div class="menu-box">Desktop navigation</div><main>Problem</main></div></body></html>';
  const transport = new FakeTransport((request) => response(mobile, request.url));
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/problemset', port: 0 });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  const page = await localRequest(`${proxy.origin}/problemset`, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  const html = page.body.toString('utf8');
  assert.match(transport.requests[0].url, /[?&]mobile=false(?:&|$)/);
  assert.doesNotMatch(html.slice(0, html.indexOf('<script>')), /mobile-toolbar|\/mobile\.css/);
  assert.match(html, /Desktop navigation/);
});

test('stores problem practice data and serves the personal dashboard locally', async (t) => {
  let saved;
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com', defaultPath: '/problemset/problem/4/A', port: 0,
    practice: {
      getProblem: (contestId, index) => saved && saved.contestId === contestId && saved.index === index ? saved : undefined,
      saveProblem: async (value) => (saved = { ...value, key: '4:A', updatedAt: Date.now() }),
      deleteProblem: async (contestId, index) => {
        const deleted = !!saved && saved.contestId === contestId && saved.index === index;
        if (deleted) saved = undefined;
        return deleted;
      },
      dashboard: () => ({ data: { problems: saved ? [saved] : [], submissions: [] }, summary: { solved: 0, solvedFromDetails: 0, attempted: 0, wa: 0, favorite: saved?.favorite ? 1 : 0, statusCounts: { todo: 0, doing: 0, review: 1, mastered: 0 }, daily: [], ratings: [], tags: [], weakTags: [] } }),
      sync: async () => { throw new Error('not used'); },
    },
  });
  await proxy.start();
  t.after(() => proxy.stop());
  const body = Buffer.from(JSON.stringify({ name: 'Watermelon', url: '/problemset/problem/4/A', favorite: true, status: 'review', note: '边界', tags: ['math'] }));
  const stored = await localRequest(`${proxy.origin}/__cf_inline/practice/problem?contestId=4&index=A`, { method: 'POST', headers: { 'X-CF-Inline': 'practice', 'Content-Type': 'application/json', 'Content-Length': String(body.length) }, body });
  assert.equal(stored.statusCode, 200);
  assert.equal(JSON.parse(stored.body).problem.note, '边界');
  const restored = await localRequest(`${proxy.origin}/__cf_inline/practice/problem?contestId=4&index=A`);
  assert.equal(JSON.parse(restored.body).problem.favorite, true);
  const dashboard = await localRequest(`${proxy.origin}/__cf_inline/dashboard`);
  assert.equal(dashboard.statusCode, 200);
  assert.match(dashboard.body.toString('utf8'), /个人刷题仪表盘/);
  assert.doesNotMatch(dashboard.body.toString('utf8'), /全部题量采用 Codeforces 主页官方统计/);
  assert.match(dashboard.body.toString('utf8'), /load\(true\)/);
  assert.match(dashboard.body.toString('utf8'), /autoSync&&d\.handle/);
  assert.match(dashboard.body.toString('utf8'), /删除记录/);
  assert.match(dashboard.body.toString('utf8'), /confirm-layer/);
  assert.match(dashboard.body.toString('utf8'), /确认删除/);
  assert.doesNotMatch(dashboard.body.toString('utf8'), /\bconfirm\(/);
  assert.match(dashboard.body.toString('utf8'), /未定级/);
  assert.match(dashboard.body.toString('utf8'), /动态规划/);
  assert.match(dashboard.body.toString('utf8'), /data-filter="doing"/);
  assert.match(dashboard.body.toString('utf8'), /--type:#e07a16/);
  assert.match(dashboard.body.toString('utf8'), /status-label/);
  const fullDashboard = await localRequest(`${proxy.origin}/__cf_inline/dashboard?return=full&path=${encodeURIComponent('/contests?mobile=false')}`);
  assert.match(fullDashboard.body.toString('utf8'), /\/__cf_inline\/full\?path=%2Fcontests%3Fmobile%3Dfalse/);
  const fastDashboard = await localRequest(`${proxy.origin}/__cf_inline/dashboard?return=fast&path=${encodeURIComponent('/groups/my?mobile=false')}`);
  assert.match(fastDashboard.body.toString('utf8'), /\/__cf_inline\/fast\?path=%2Fgroups%2Fmy%3Fmobile%3Dfalse/);
  const removed = await localRequest(`${proxy.origin}/__cf_inline/practice/problem?contestId=4&index=A`, { method: 'DELETE', headers: { 'X-CF-Inline': 'practice' } });
  assert.equal(removed.statusCode, 200);
  assert.equal(JSON.parse(removed.body).deleted, true);
  const afterDelete = await localRequest(`${proxy.origin}/__cf_inline/practice/problem?contestId=4&index=A`);
  assert.equal(JSON.parse(afterDelete.body).problem, null);
});

test('deduplicates and caches static assets while prioritizing page documents', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0 });
  const transport = new FakeTransport(async (request) => {
    if (request.url.endsWith('/assets/site.css')) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/css; charset=UTF-8',
          'cache-control': 'public, max-age=3600',
        },
        body: Buffer.from('body{color:#222}', 'utf8'),
        finalUrl: request.url,
      };
    }
    return response('<!doctype html><html><body>Home</body></html>', request.url);
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const assetUrl = `${proxy.origin}/assets/site.css`;
  const [first, simultaneous] = await Promise.all([
    localRequest(assetUrl),
    localRequest(assetUrl),
  ]);
  const cached = await localRequest(assetUrl);
  assert.equal(first.body.toString('utf8'), 'body{color:#222}');
  assert.equal(simultaneous.body.toString('utf8'), 'body{color:#222}');
  assert.equal(cached.body.toString('utf8'), 'body{color:#222}');
  assert.equal(transport.requests.filter((item) => item.url.endsWith('/assets/site.css')).length, 1);
  assert.equal(transport.requests[0].priority, 10);

  await localRequest(`${proxy.origin}/`, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  const documentRequest = transport.requests.find((item) => item.url.startsWith('https://codeforces.com/?'));
  assert.equal(documentRequest.priority, 100);
});

test('serves a lightweight fast-mode shell with only the four primary entries', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0 });
  await proxy.start();
  t.after(() => proxy.stop());

  const result = await localRequest(`${proxy.origin}/__cf_inline/fast`);
  const html = result.body.toString('utf8');
  assert.equal(result.statusCode, 200);
  assert.match(html, /Codeforces 极速模式/);
  assert.match(html, /我的群组/);
  assert.match(html, /比赛/);
  assert.match(html, /训练营/);
  assert.match(html, /题库/);
  assert.match(html, /name="cfInlineMain"/);
  assert.match(html, /正在加载 Codeforces/);
  assert.match(html, /正常模式/);
  assert.match(html, /<\/nav><div class="tools"><button id="normalMode"[^>]*>正常模式<\/button><button id="dashboard"[^>]*>仪表盘<\/button>/);
  assert.match(html, /__cf_inline\/dashboard\?return=fast/);
  assert.match(html, /id="translationMode"/);
  assert.match(html, /翻译模式/);
  assert.match(html, /__cf_inline\/translation-mode/);
  assert.match(html, /__cf_inline\/full/);
  assert.match(html, /正在切换到正常模式/);
  assert.match(html, /requestAnimationFrame/);
  assert.match(html, /contextmenu/);
  assert.match(html, /preventDefault/);
  assert.match(html, /id="relogin"/);
  assert.match(html, /__cf_inline\/relogin/);
  assert.match(html, /loginInProgress/);
  assert.match(html, /var wasConnected=true/);
  assert.doesNotMatch(html, /var wasConnected=false/);
  assert.doesNotMatch(html, /pathText\.textContent=current/);
  assert.doesNotMatch(html, /正在加载 '\+current/);
  assert.match(html, /pathText\.textContent=''/);
  assert.match(html, /function prefix\(value,root\)/);
  assert.match(html, /split\(\/\[\?\#\]\//);
  assert.match(html, /@media\(max-width:900px\)/);
  assert.match(html, /header\{flex-wrap:wrap;align-items:stretch/);
  assert.match(html, /nav\{flex:1 1 100%;width:100%;flex-wrap:wrap\}/);
  assert.match(html, /\.tools\{flex:1 1 100%;width:100%;margin-left:0;justify-content:flex-end\}/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});

test('serves the complete-site interface and lets users return to fast mode', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0 });
  await proxy.start();
  t.after(() => proxy.stop());

  const result = await localRequest(
    `${proxy.origin}/__cf_inline/full?path=${encodeURIComponent('/problemset/problem/1/A')}`
  );
  const html = result.body.toString('utf8');
  assert.equal(result.statusCode, 200);
  assert.match(html, /Codeforces 正常模式/);
  assert.match(html, />极速模式<\/button>/);
  assert.doesNotMatch(html, />切换到极速模式<\/button>/);
  assert.match(html, /id="translationMode"/);
  assert.match(html, /id="dashboard"/);
  assert.match(html, /__cf_inline\/dashboard\?return=full/);
  assert.doesNotMatch(html, /class="path" id="path"/);
  assert.match(html, /翻译模式/);
  assert.match(html, /__cf_inline\/translation-mode/);
  assert.match(html, /正在切换到极速模式/);
  assert.match(html, /正在加载完整 Codeforces 页面/);
  assert.match(html, /class="loading-text"/);
  assert.match(html, /__cf_inline\/fast/);
  assert.match(html, /problemset\/problem\/1\/A/);
  assert.match(html, /name="cfInlineMain"/);
  assert.match(html, /id="relogin"/);
  assert.match(html, /__cf_inline\/relogin/);
  assert.match(html, /loginInProgress/);
  assert.match(html, /@media\(max-width:760px\)/);
  assert.match(html, /header\{flex-wrap:wrap;gap:6px;padding:6px\}/);
  assert.match(html, /\.tools\{flex:1 1 100%;width:100%;margin-left:0;justify-content:flex-end;flex-wrap:wrap\}/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }

  const unsafe = await localRequest(`${proxy.origin}/__cf_inline/full?path=%2F%2Fevil.example`);
  assert.doesNotMatch(unsafe.body.toString('utf8'), /evil\.example/);
});

test('keeps a group problem path when fast or full mode is refreshed', async (t) => {
  const problemPath = '/group/demo/contest/123/problem/A';
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  await proxy.start();
  t.after(() => proxy.stop());

  await localRequest(`${proxy.origin}/__cf_inline/visited?path=${encodeURIComponent(problemPath)}`);
  const fast = await localRequest(`${proxy.origin}/__cf_inline/fast`);
  const fastFromUrl = await localRequest(
    `${proxy.origin}/__cf_inline/fast?path=${encodeURIComponent(problemPath)}`
  );
  const full = await localRequest(`${proxy.origin}/__cf_inline/full`);
  for (const result of [fast, fastFromUrl, full]) {
    assert.match(result.body.toString('utf8'), /\/group\/demo\/contest\/123\/problem\/A/);
  }
  assert.match(fast.body.toString('utf8'), /__cf_inline\/fast\?path=/);
  assert.match(full.body.toString('utf8'), /__cf_inline\/full\?path=/);
});

test('deduplicates and reuses authenticated fast-mode page snapshots', async (t) => {
  let calls = 0;
  const authenticated = '<!doctype html><html><body><a href="/profile/tester">tester</a><a href="/logout">Logout</a><main>My groups</main></body></html>';
  const transport = new FakeTransport(async (request) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return response(authenticated, request.url);
  });
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    defaultPath: '/groups/my',
    port: 0,
    fastMode: true,
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  const requestUrl = `${proxy.origin}/groups/my`;
  const options = { headers: { Accept: 'text/html,application/xhtml+xml' } };

  const [first, simultaneous] = await Promise.all([
    localRequest(requestUrl, options),
    localRequest(requestUrl, options),
  ]);
  const cached = await localRequest(requestUrl, options);
  assert.match(first.body.toString('utf8'), /My groups/);
  assert.match(simultaneous.body.toString('utf8'), /My groups/);
  assert.match(cached.body.toString('utf8'), /My groups/);
  assert.equal(calls, 1);
});

test('caches problem and group-contest documents and injects hover prefetch', async (t) => {
  let calls = 0;
  const authenticated = '<!doctype html><html><body><a href="/profile/tester">tester</a><a href="/logout">Logout</a><main class="problem-statement">Problem</main></body></html>';
  const transport = new FakeTransport(async (request) => {
    calls += 1;
    return response(authenticated, request.url);
  });
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    defaultPath: '/groups/my',
    port: 0,
    fastMode: true,
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  const options = { headers: { Accept: 'text/html,application/xhtml+xml' } };
  const paths = [
    '/problemset/problem/1/A',
    '/contest/123/problem/B',
    '/gym/456/problem/C',
    '/group/demo/contest/789/problem/D',
  ];

  for (const pathname of paths) {
    await localRequest(`${proxy.origin}${pathname}`, options);
    const cached = await localRequest(`${proxy.origin}${pathname}`, options);
    assert.match(cached.body.toString('utf8'), /Problem/);
  }

  assert.equal(calls, paths.length);
  const injected = (await localRequest(`${proxy.origin}${paths[0]}`, options)).body.toString('utf8');
  assert.match(injected, /scheduleFastPrefetch/);
  assert.match(injected, /pointerover/);
  assert.match(injected, /headers:\s*\{ Accept: 'text\/html' \}/);
  assert.match(injected, /contextmenu/);
});

test('always refreshes pages with contest countdowns while keeping problem snapshots', async (t) => {
  const calls = new Map();
  const transport = new FakeTransport((request) => {
    const pathname = new URL(request.url).pathname;
    const count = (calls.get(pathname) ?? 0) + 1;
    calls.set(pathname, count);
    return response(
      `<!doctype html><html><body><a href="/profile/tester">tester</a><a href="/logout">Logout</a><main>${pathname}:${count}</main></body></html>`,
      request.url
    );
  });
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    defaultPath: '/contests',
    port: 0,
    fastMode: true,
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  const options = { headers: { Accept: 'text/html,application/xhtml+xml' } };
  const countdownPaths = [
    '/contests',
    '/contests/',
    '/gyms',
    '/contest/123',
    '/contest/123/',
    '/gym/456',
    '/group/demo/contest/789',
  ];

  for (const pathname of countdownPaths) {
    const first = await localRequest(`${proxy.origin}${pathname}`, options);
    const second = await localRequest(`${proxy.origin}${pathname}`, options);
    assert.match(first.body.toString('utf8'), /:1<\/main>/);
    assert.match(second.body.toString('utf8'), /:2<\/main>/);
  }

  const problemPaths = [
    '/contest/123/problem/A',
    '/gym/456/problem/B',
    '/group/demo/contest/789/problem/C',
  ];
  for (const pathname of problemPaths) {
    const first = await localRequest(`${proxy.origin}${pathname}`, options);
    const second = await localRequest(`${proxy.origin}${pathname}`, options);
    assert.match(first.body.toString('utf8'), /:1<\/main>/);
    assert.match(second.body.toString('utf8'), /:1<\/main>/);
    assert.equal(calls.get(pathname), 1);
  }
});

test('keeps a stale fast snapshot when a background refresh hits Cloudflare', async (t) => {
  const authenticated = '<!doctype html><html><body><a href="/profile/tester">tester</a><a href="/logout">Logout</a><main>Cached problem</main></body></html>';
  let challenge = false;
  const transport = new FakeTransport((request) => challenge
    ? response('<!doctype html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>', request.url, 403)
    : response(authenticated, request.url));
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/problemset/problem/1/A', port: 0, fastMode: true });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  const options = { headers: { Accept: 'text/html,application/xhtml+xml' } };

  await localRequest(`${proxy.origin}/problemset/problem/1/A`, options);
  const snapshot = proxy.pageSnapshots.get('https://codeforces.com/problemset/problem/1/A');
  assert.ok(snapshot);
  snapshot.freshUntil = Date.now() - 1;
  challenge = true;
  const stale = await localRequest(`${proxy.origin}/problemset/problem/1/A`, options);
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(stale.body.toString('utf8'), /Cached problem/);
  assert.equal(transport.requests.length, 2);
  assert.equal(proxy.pageSnapshots.get('https://codeforces.com/problemset/problem/1/A').response.statusCode, 200);
});

test('never caches POST requests in fast mode', async (t) => {
  const transport = new FakeTransport((request) => response(
    '<!doctype html><html><body><a href="/profile/tester">tester</a><a href="/logout">Logout</a><main>posted</main></body></html>',
    request.url
  ));
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/problemset', port: 0, fastMode: true });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  await localRequest(`${proxy.origin}/problemset`, { method: 'POST', body: Buffer.from('x=1') });
  await localRequest(`${proxy.origin}/problemset`, { method: 'POST', body: Buffer.from('x=1') });
  assert.equal(transport.requests.length, 2);
});

test('protects the local translation endpoint from unrelated browser requests', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  await proxy.start();
  t.after(() => proxy.stop());

  const getResult = await localRequest(`${proxy.origin}/__cf_inline/translate`);
  assert.equal(getResult.statusCode, 405);
  const foreignPost = await localRequest(`${proxy.origin}/__cf_inline/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from('{"items":["Hello"]}', 'utf8'),
  });
  assert.equal(foreignPost.statusCode, 403);
});

test('keeps AI credentials server-side while enhancing protected translation requests', async (t) => {
  const secret = 'server-side-secret-never-returned';
  const transport = new FakeTransport(() => response('<html></html>'));
  transport.translateHtmlItems = async (items) => items.map(() => '玩家可以交换，或者通过。');
  let received;
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    defaultPath: '/problemset/problem/1/A',
    port: 0,
    enhanceTranslations: async (sources, drafts) => {
      received = { sources, drafts, secretUsedInternally: secret };
      return ['玩家可以交换，或者跳过本回合。'];
    },
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const body = JSON.stringify({ items: ['On each turn, the player may swap, or pass.'] });
  const translated = await localRequest(`${proxy.origin}/__cf_inline/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CF-Inline': 'translate' },
    body: Buffer.from(body),
  });
  assert.equal(translated.statusCode, 200);
  assert.deepEqual(JSON.parse(translated.body.toString('utf8')).items, ['玩家可以交换，或者跳过本回合。']);
  assert.deepEqual(received.sources, ['On each turn, the player may swap, or pass.']);
  assert.deepEqual(received.drafts, ['玩家可以交换，或者通过。']);
  assert.doesNotMatch(body, new RegExp(secret));
  assert.doesNotMatch(translated.body.toString('utf8'), new RegExp(secret));
});

test('writes sample text through the protected VS Code clipboard bridge', async (t) => {
  let copied = '';
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    defaultPath: '/problemset/problem/1/A',
    port: 0,
    writeClipboardText: async (text) => { copied = text; },
  });
  await proxy.start();
  t.after(() => proxy.stop());

  const rejected = await localRequest(`${proxy.origin}/__cf_inline/clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ text: '1 2\n3' })),
  });
  assert.equal(rejected.statusCode, 403);
  const accepted = await localRequest(`${proxy.origin}/__cf_inline/clipboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CF-Inline': 'clipboard' },
    body: Buffer.from(JSON.stringify({ text: '1 2\n3' })),
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(copied, '1 2\n3');
});

test('routes protected submissions through the official Edge page transport', async (t) => {
  const transport = new FakeTransport((request) => request.method === 'BROWSER_SUBMIT'
    ? response('<script>Codeforces.showMessage("Solution to the problem A has been submitted successfully")</script>', 'https://codeforces.com/contest/1/my')
    : response('<html></html>', request.url));
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/contest/1/problem/A', port: 0 });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  const payload = Buffer.from(JSON.stringify({
    submitPath: '/contest/1/submit',
    contestId: '1',
    index: 'A',
    programTypeId: '89',
    source: 'int main() { return 0; }',
  }));

  const rejected = await localRequest(`${proxy.origin}/__cf_inline/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  assert.equal(rejected.statusCode, 403);

  const accepted = await localRequest(`${proxy.origin}/__cf_inline/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CF-Inline': 'submit' },
    body: payload,
  });
  assert.equal(accepted.statusCode, 200);
  const result = JSON.parse(accepted.body.toString('utf8'));
  assert.equal(result.status, 200);
  assert.equal(transport.submissions.length, 1);
  assert.equal(transport.submissions[0].url, 'https://codeforces.com/contest/1/submit');
  assert.equal(transport.submissions[0].source, 'int main() { return 0; }');
});

test('classifies official submission responses without turning success into an error', () => {
  const success = classifyCodeforcesSubmissionResponse(response(
    '<script>Codeforces.showMessage("Solution to the problem A has been submitted successfully")</script>',
    'https://codeforces.com/contest/1/my'
  ));
  assert.equal(success.status, 'judging');
  assert.match(success.message, /Codeforces 已接收/);
  const russian = classifyCodeforcesSubmissionResponse(response(
    '<script>Codeforces.showMessage("Решение задачи A успешно отправлено на проверку")</script>',
    'https://codeforces.com/contest/1/my'
  ));
  assert.equal(russian.status, 'judging');
  const failed = classifyCodeforcesSubmissionResponse(response(
    '<div class="genericError">Source should differ from previously submitted</div>',
    'https://codeforces.com/contest/1/submit'
  ));
  assert.equal(failed.status, 'failed');
  assert.match(failed.message, /Source should differ/);
  const unrelatedPageError = classifyCodeforcesSubmissionResponse(response(
    '<script>Codeforces.showError("Failed to save collapsed state.")</script><form class="submit-form"></form>',
    'https://codeforces.com/contest/1/submit'
  ));
  assert.equal(unrelatedPageError.status, 'unknown');
  assert.doesNotMatch(unrelatedPageError.message, /collapsed state/i);
  assert.equal(formatSubmissionVerdict('WRONG_ANSWER'), '答案错误');
  assert.equal(formatSubmissionVerdict('OK'), '通过');
});

test('persists protected submission history and updates it from verdict polling', async (t) => {
  const records = [];
  const history = {
    get(id) { return records.find((record) => record.id === id); },
    list(contestId, index, limit = 20) { return records.filter((record) => record.contestId === contestId && record.index === index).slice(0, limit); },
    async create(input) { const record = { ...input, createdAt: Date.now(), updatedAt: Date.now() }; records.unshift(record); return record; },
    async update(id, patch) { const record = records.find((item) => item.id === id); if (!record) return undefined; Object.assign(record, patch, { updatedAt: Date.now() }); return { ...record }; },
  };
  const transport = new FakeTransport((request) => {
    if (request.method === 'BROWSER_SUBMIT') {
      const accepted = response('<script>Codeforces.showError("Failed to save collapsed state.")</script>', 'https://codeforces.com/contest/1/my');
      accepted.headers['x-cf-inline-submission-id'] = '101';
      return accepted;
    }
    if (request.url.includes('/api/user.status')) return response(JSON.stringify({ status: 'OK', result: [
      { id: 102, creationTimeSeconds: Math.floor(Date.now() / 1000), verdict: 'WRONG_ANSWER', problem: { contestId: 1, index: 'A' } },
      { id: 101, creationTimeSeconds: Math.floor(Date.now() / 1000), verdict: 'OK', timeConsumedMillis: 31, memoryConsumedBytes: 4096, problem: { contestId: 1, index: 'A' } },
    ] }), request.url);
    return response('<nav><a href="/profile/tester">tester</a><a href="/logout">Logout</a></nav>', request.url);
  });
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/contest/1/problem/A', port: 0, submissionHistory: history });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  await localRequest(`${proxy.origin}/contest/1/problem/A`);
  const submitted = await localRequest(`${proxy.origin}/__cf_inline/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CF-Inline': 'submit' },
    body: Buffer.from(JSON.stringify({ requestId: 'submit-history-101', submitPath: '/contest/1/submit', contestId: '1', index: 'A', programTypeId: '89', language: 'GNU C++20', previousSubmissionId: '100', source: 'int main(){}' })),
  });
  const submittedResult = JSON.parse(submitted.body.toString('utf8'));
  assert.equal(submittedResult.history.status, 'judging');
  assert.equal(submittedResult.history.submissionId, '101');
  assert.doesNotMatch(submittedResult.history.message, /collapsed state/i);
  assert.equal(transport.submissions[0].previousSubmissionId, '100');
  assert.equal(records[0].source, undefined);

  const rejectedHistory = await localRequest(`${proxy.origin}/__cf_inline/submission-history?contestId=1&index=A`);
  assert.equal(rejectedHistory.statusCode, 403);
  const listed = await localRequest(`${proxy.origin}/__cf_inline/submission-history?contestId=1&index=A`, { headers: { 'X-CF-Inline': 'submission-history' } });
  assert.equal(JSON.parse(listed.body.toString('utf8')).records.length, 1);
  const polled = await localRequest(`${proxy.origin}/__cf_inline/submission-status?contestId=1&index=A&historyId=submit-history-101`, { headers: { 'X-CF-Inline': 'submission-status' } });
  const pollResult = JSON.parse(polled.body.toString('utf8'));
  assert.equal(pollResult.history.status, 'verdict');
  assert.equal(pollResult.history.submissionId, '101');
  assert.equal(pollResult.history.verdict, 'OK');
  assert.match(pollResult.history.message, /通过/);
});

test('keeps an interrupted submission as unknown instead of reporting a false failure', async (t) => {
  const records = [];
  const history = {
    get(id) { return records.find((record) => record.id === id); },
    list() { return records; },
    async create(input) { const record = { ...input, createdAt: Date.now(), updatedAt: Date.now() }; records.unshift(record); return record; },
    async update(id, patch) { const record = records.find((item) => item.id === id); Object.assign(record, patch); return { ...record }; },
  };
  const transport = new FakeTransport((request) => {
    if (request.method === 'BROWSER_SUBMIT') throw new Error('Client network socket disconnected');
    return response('<nav><a href="/profile/tester">tester</a><a href="/logout">Logout</a></nav>', request.url);
  });
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0, submissionHistory: history });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  const result = await localRequest(`${proxy.origin}/__cf_inline/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CF-Inline': 'submit' },
    body: Buffer.from(JSON.stringify({ requestId: 'submit-interrupted-1', submitPath: '/contest/1/submit', contestId: '1', index: 'A', programTypeId: '89', language: 'GNU C++20', previousSubmissionId: '100', source: 'int main(){}' })),
  });
  assert.equal(result.statusCode, 502);
  const body = JSON.parse(result.body.toString('utf8'));
  assert.equal(body.history.status, 'unknown');
  assert.match(body.history.message, /是否已接收暂时无法确认/);
});

test('maps rapid consecutive attempts to different Codeforces submission ids', async (t) => {
  const now = Date.now();
  const records = [
    { id: 'attempt-newer-102', contestId: 1, index: 'A', programTypeId: '89', language: 'GNU C++20', status: 'judging', message: '等待', previousSubmissionId: '100', createdAt: now - 1_000, updatedAt: now - 1_000 },
    { id: 'attempt-older-101', contestId: 1, index: 'A', programTypeId: '89', language: 'GNU C++20', status: 'judging', message: '等待', previousSubmissionId: '100', createdAt: now - 2_000, updatedAt: now - 2_000 },
  ];
  const history = {
    get(id) { const record = records.find((item) => item.id === id); return record && { ...record }; },
    list(contestId, index) { return records.filter((record) => record.contestId === contestId && record.index === index).map((record) => ({ ...record })); },
    async create(input) { const record = { ...input, createdAt: Date.now(), updatedAt: Date.now() }; records.unshift(record); return record; },
    async update(id, patch) { const record = records.find((item) => item.id === id); Object.assign(record, patch); return { ...record }; },
  };
  const transport = new FakeTransport((request) => {
    if (request.url.includes('/api/user.status')) return response(JSON.stringify({ status: 'OK', result: [
      { id: 102, creationTimeSeconds: Math.floor((now - 500) / 1000), verdict: 'TESTING', problem: { contestId: 1, index: 'A' } },
      { id: 101, creationTimeSeconds: Math.floor((now - 1_500) / 1000), verdict: 'OK', problem: { contestId: 1, index: 'A' } },
      { id: 100, creationTimeSeconds: Math.floor((now - 60_000) / 1000), verdict: 'OK', problem: { contestId: 1, index: 'A' } },
    ] }), request.url);
    return response('<nav><a href="/profile/tester">tester</a><a href="/logout">Logout</a></nav>', request.url);
  });
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0, submissionHistory: history });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  await localRequest(`${proxy.origin}/`);
  const older = await localRequest(`${proxy.origin}/__cf_inline/submission-status?contestId=1&index=A&historyId=attempt-older-101`, { headers: { 'X-CF-Inline': 'submission-status' } });
  const newer = await localRequest(`${proxy.origin}/__cf_inline/submission-status?contestId=1&index=A&historyId=attempt-newer-102`, { headers: { 'X-CF-Inline': 'submission-status' } });
  assert.equal(JSON.parse(older.body.toString('utf8')).history.submissionId, '101');
  assert.equal(JSON.parse(newer.body.toString('utf8')).history.submissionId, '102');
  assert.notEqual(records[0].submissionId, records[1].submissionId);
});

test('protects the submission status fallback endpoint', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0 });
  await proxy.start();
  t.after(() => proxy.stop());
  const rejected = await localRequest(`${proxy.origin}/__cf_inline/submission-status?contestId=1&index=A`);
  assert.equal(rejected.statusCode, 403);
});

test('finds the latest matching submission through the account status fallback', async (t) => {
  const transport = new FakeTransport((request) => {
    if (request.url.includes('/api/user.status')) {
      return response(JSON.stringify({ status: 'OK', result: [
        { id: 103, verdict: 'TESTING', problem: { contestId: 1, index: 'A' } },
        { id: 102, verdict: 'OK', problem: { contestId: 1, index: 'B' } },
      ] }), request.url);
    }
    return response('<nav><a href="/profile/tester">tester</a><a href="/logout">Logout</a></nav>', request.url);
  });
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/contest/1/problem/A', port: 0 });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());
  await localRequest(`${proxy.origin}/contest/1/problem/A`);

  const result = await localRequest(`${proxy.origin}/__cf_inline/submission-status?contestId=1&index=A`, {
    headers: { 'X-CF-Inline': 'submission-status' },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body.toString('utf8')).submission.id, 103);
});

test('keeps the Edge session connected when one visible page hits Cloudflare', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  const transport = new FakeTransport(() => response(
    '<!doctype html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>',
    'https://codeforces.com/groups',
    403
  ));
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const result = await localRequest(`${proxy.origin}/groups`);
  assert.equal(result.statusCode, 403);
  assert.equal(proxy.state().loggedIn, true);
  assert.equal(proxy.state().sessionReady, true);
});

test('keeps the session connected when a background verdict poll hits Cloudflare', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/contest/1/problem/A', port: 0 });
  const transport = new FakeTransport((request) => {
    assert.equal(request.timeoutMs, 12_000);
    return response(
      '<!doctype html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x"></script></body></html>',
      request.url,
      403
    );
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const poll = await localRequest(`${proxy.origin}/contest/1/my?cf_inline_poll=${Date.now()}`);
  assert.equal(poll.statusCode, 403);
  assert.equal(proxy.state().sessionReady, true);
  assert.equal(proxy.state().loggedIn, true);
});

test('does not let a background verdict poll alone invalidate authentication', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/contest/1/problem/A', port: 0 });
  const transport = new FakeTransport(() => response(
    '<!doctype html><html><body><form id="enterForm"></form></body></html>',
    'https://codeforces.com/enter?back=%2Fcontest%2F1%2Fmy'
  ));
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  await localRequest(`${proxy.origin}/contest/1/my?cf_inline_poll=${Date.now()}`);
  assert.equal(proxy.state().sessionReady, true);
  assert.equal(proxy.state().loggedIn, true);
});

test('rejects an imported session without a valid Codeforces account cookie', () => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  const transport = new FakeTransport(() => response('<html></html>'));
  assert.throws(
    () => proxy.attachBrowserSession([], 'Edge test', transport),
    /没有检测到有效的 Codeforces 登录状态/
  );
  assert.equal(proxy.state().sessionReady, false);
});

test('keeps a live session after a transient resource failure but drops a closed transport', async (t) => {
  let fail = true;
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  const transport = new FakeTransport(() => {
    if (fail) throw new Error('temporary fetch failure');
    return response('<html><body>ok</body></html>');
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const transient = await localRequest(`${proxy.origin}/style.css`);
  assert.equal(transient.statusCode, 502);
  assert.equal(proxy.state().sessionReady, true);

  transport.alive = false;
  const closed = await localRequest(`${proxy.origin}/groups`);
  assert.equal(closed.statusCode, 502);
  assert.equal(proxy.state().sessionReady, false);
});

test('serves a same-origin state bridge and records only explicit main-frame visits', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  const transport = new FakeTransport((request) => response(
    '<!doctype html><html><body>page</body></html>',
    request.url
  ));
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const bridge = await localRequest(`${proxy.origin}/__cf_inline/bridge`);
  assert.equal(bridge.statusCode, 200);
  assert.match(bridge.body.toString('utf8'), /fetch\('\/__cf_inline\/state'/);
  assert.equal(bridge.headers['access-control-allow-origin'], undefined);

  await localRequest(`${proxy.origin}/iframe/22.html`);
  assert.equal(proxy.state().currentPath, '/groups');
  await localRequest(`${proxy.origin}/__cf_inline/visited?path=${encodeURIComponent('/gyms')}`);
  assert.equal(proxy.state().currentPath, '/gyms');
});

test('removes the Codeforces anti-iframe stop script without removing page content', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups', port: 0 });
  const transport = new FakeTransport(() => response(`<!doctype html><html><body>
    <main>Groups content</main>
    <script type="text/javascript">
      if (window.parent.frames.length > 0) {
        window.stop();
      }
    </script>
    <footer>Page footer</footer>
  </body></html>`));
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups`);
  const html = page.body.toString('utf8');
  assert.match(html, /Groups content/);
  assert.match(html, /Page footer/);
  assert.doesNotMatch(html, /window\.parent\.frames\.length/);
  assert.doesNotMatch(html, /window\.stop\s*\(/);

  const worker = await localRequest(`${proxy.origin}/service-worker-92220.js`);
  assert.equal(worker.statusCode, 404);
  assert.match(worker.body.toString('utf8'), /Service workers are disabled/);
});

test('marks a stale-cookie session disconnected when Codeforces renders anonymous navigation', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  const transport = new FakeTransport(() => response(`<!doctype html><html><body>
    <nav><a href="/enter?back=%2Fgroups%2Fmy">Enter</a><a href="/register">Register</a></nav>
    <main>Public groups remain visible</main>
  </body></html>`, 'https://codeforces.com/groups'));
  transport.hasValidLoginCookie = async () => false;
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups/my`);
  assert.equal(page.statusCode, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(proxy.state().loggedIn, false);
  assert.equal(proxy.state().sessionReady, false);
  assert.match(page.body.toString('utf8'), /__cfInlinePageReady/);
  assert.match(page.body.toString('utf8'), /__cfInlinePageLoading/);
  assert.match(page.body.toString('utf8'), /authentication: "anonymous"/);
});

test('keeps the Edge session connected when one anonymous page still has a valid browser login cookie', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  const transport = new FakeTransport(() => response(`<!doctype html><html><body>
    <nav><a href="/enter?back=%2Fgroups%2Fmy">Enter</a><a href="/register">Register</a></nav>
    <main>Temporarily anonymous page</main>
  </body></html>`, 'https://codeforces.com/groups'));
  transport.hasValidLoginCookie = async () => true;
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups/my`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.statusCode, 200);
  assert.equal(proxy.state().loggedIn, true);
  assert.equal(proxy.state().sessionReady, true);
  assert.match(page.body.toString('utf8'), /authentication: "anonymous"/);
});

test('reports transport failures to the main frame instead of leaving loading indefinite', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  const transport = new FakeTransport(() => { throw new Error('Edge window closed'); });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups/my`);
  assert.equal(page.statusCode, 502);
  assert.match(page.body.toString('utf8'), /__cfInlinePageError/);
  assert.match(page.body.toString('utf8'), /Edge window closed/);
  assert.match(page.body.toString('utf8'), /requestedLogin&&connected/);
  assert.match(page.body.toString('utf8'), /location\.reload\(\)/);
  assert.match(page.body.toString('utf8'), /id="relogin"/);
  assert.match(page.body.toString('utf8'), /重新连接 Edge/);
  assert.match(page.body.toString('utf8'), /id="retry"/);
  assert.match(page.body.toString('utf8'), /本次网页请求没有成功/);
  assert.match(page.body.toString('utf8'), /__cf_inline\/relogin/);
});

test('offers a real Edge reconnect when script permission fails while the session still looks connected', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  const transport = new FakeTransport(() => {
    throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups/my`);
  const html = page.body.toString('utf8');
  assert.equal(page.statusCode, 502);
  assert.equal(proxy.state().sessionReady, true);
  assert.match(html, /var reconnectRequired=true/);
  assert.match(html, /Edge 扩展的执行页或权限状态异常/);
  assert.match(html, /id="relogin"/);
  assert.match(html, /重新连接 Edge/);
  assert.match(html, /if\(!reconnectRequired&&!requestedLogin\)return/);
});

test('offers Edge reconnect when the bridge extension temporarily stops answering', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  const transport = new FakeTransport(() => {
    throw new Error('未检测到配套 Edge 扩展，请确认已经安装并启用');
  });
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups/my`);
  const html = page.body.toString('utf8');
  assert.equal(page.statusCode, 502);
  assert.equal(proxy.state().sessionReady, true);
  assert.match(html, /var reconnectRequired=true/);
  assert.match(html, /重新连接 Edge/);
  assert.match(html, /Edge 扩展的执行页或权限状态异常/);
});

test('accepts a protected local relogin request and publishes progress state', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  await proxy.start();
  t.after(() => proxy.stop());
  let requested = 0;
  proxy.on('reloginRequest', () => { requested += 1; });

  const rejected = await localRequest(`${proxy.origin}/__cf_inline/relogin`, {
    method: 'POST',
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(requested, 0);

  const accepted = await localRequest(`${proxy.origin}/__cf_inline/relogin`, {
    method: 'POST',
    headers: { 'X-CF-Inline': 'relogin' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accepted.statusCode, 202);
  assert.equal(requested, 1);
  assert.equal(proxy.state().loginInProgress, true);
  assert.match(proxy.state().loginMessage, /正在打开 Edge/);

  await localRequest(`${proxy.origin}/__cf_inline/relogin`, {
    method: 'POST',
    headers: { 'X-CF-Inline': 'relogin' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requested, 1);
});

test('accepts only a protected local translation-mode request', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/', port: 0 });
  await proxy.start();
  t.after(() => proxy.stop());
  let requested = 0;
  proxy.on('translationModeRequest', () => { requested += 1; });

  const rejected = await localRequest(`${proxy.origin}/__cf_inline/translation-mode`, { method: 'POST' });
  assert.equal(rejected.statusCode, 403);
  assert.equal(requested, 0);

  const accepted = await localRequest(`${proxy.origin}/__cf_inline/translation-mode`, {
    method: 'POST',
    headers: { 'X-CF-Inline': 'translation-mode' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accepted.statusCode, 202);
  assert.equal(requested, 1);
});

test('keeps a verified account connected and publishes a main-frame ready signal', async (t) => {
  const proxy = new CfProxy({ baseUrl: 'https://codeforces.com', defaultPath: '/groups/my', port: 0 });
  const transport = new FakeTransport(() => response(`<!doctype html><html><body>
    <nav><a href="/profile/tourist">tourist</a><a href="/logout">Logout</a></nav>
    <main>My groups</main>
  </body></html>`, 'https://codeforces.com/groups/my'));
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups/my`);
  assert.equal(page.statusCode, 200);
  assert.equal(proxy.state().sessionReady, true);
  assert.match(page.body.toString('utf8'), /authentication: "authenticated"/);
});
