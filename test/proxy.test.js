const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const test = require('node:test');
const { CfProxy } = require('../out/proxy.js');

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

  const groups = await localRequest(`${proxy.origin}/groups`);
  const groupsHtml = groups.body.toString('utf8');
  assert.equal(groups.statusCode, 200);
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
  const documentRequest = transport.requests.find((item) => item.url === 'https://codeforces.com/');
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
  assert.match(html, /__cf_inline\/full/);
  assert.match(html, /正在切换到正常模式/);
  assert.match(html, /requestAnimationFrame/);
  assert.match(html, /contextmenu/);
  assert.match(html, /preventDefault/);
  assert.match(html, /id="relogin"/);
  assert.match(html, /__cf_inline\/relogin/);
  assert.match(html, /loginInProgress/);
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
  assert.match(html, /切换到极速模式/);
  assert.match(html, /正在切换到极速模式/);
  assert.match(html, /正在加载完整 Codeforces 页面/);
  assert.match(html, /class="loading-text"/);
  assert.match(html, /__cf_inline\/fast/);
  assert.match(html, /problemset\/problem\/1\/A/);
  assert.match(html, /name="cfInlineMain"/);
  assert.match(html, /id="relogin"/);
  assert.match(html, /__cf_inline\/relogin/);
  assert.match(html, /loginInProgress/);
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

test('marks a live session unavailable when Cloudflare challenge returns', async (t) => {
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
  assert.equal(proxy.state().sessionReady, false);
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
  proxy.attachBrowserSession([sessionCookie()], 'Edge test', transport);
  await proxy.start();
  t.after(() => proxy.stop());

  const page = await localRequest(`${proxy.origin}/groups/my`);
  assert.equal(page.statusCode, 200);
  assert.equal(proxy.state().loggedIn, true);
  assert.equal(proxy.state().sessionReady, false);
  assert.match(page.body.toString('utf8'), /__cfInlinePageReady/);
  assert.match(page.body.toString('utf8'), /__cfInlinePageLoading/);
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
  assert.match(page.body.toString('utf8'), /state\.sessionReady&&state\.loggedIn/);
  assert.match(page.body.toString('utf8'), /location\.reload\(\)/);
  assert.match(page.body.toString('utf8'), /id="relogin"/);
  assert.match(page.body.toString('utf8'), /重新登录/);
  assert.match(page.body.toString('utf8'), /__cf_inline\/relogin/);
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
