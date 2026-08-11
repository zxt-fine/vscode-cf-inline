const Module = require('node:module');

// captureCodeforcesSession does not use VS Code APIs; this lightweight shim lets
// the real compiled login/transport implementation run outside Extension Host.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { captureCodeforcesSession } = require('../out/browser-login.js');

async function main() {
  const session = await captureCodeforcesSession({
    isCancelled: () => false,
    onStatus: (message) => process.stdout.write(`[status] ${message}\n`),
  });
  try {
    const checks = [];
    for (const pathname of ['/groups/my', '/contests', '/gyms', '/problemset']) {
      const result = await session.transport.request({
        url: new URL(pathname, 'https://codeforces.com').toString(),
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        body: Buffer.alloc(0),
      });
      const html = result.body.toString('utf8');
      checks.push({
        pathname,
        status: result.statusCode,
        finalUrl: result.finalUrl,
        bytes: result.body.length,
        challenge: /Just a moment|cdn-cgi\/challenge-platform|cf-chl-/i.test(html),
        loginForm: /id=["']enterForm["']/i.test(html),
      });
    }

    const submitPage = await session.transport.request({
      url: 'https://codeforces.com/contest/1/submit/A',
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      body: Buffer.alloc(0),
    });
    const submitHtml = submitPage.body.toString('utf8');
    checks.push({
      pathname: '/contest/1/submit/A (GET only)',
      status: submitPage.statusCode,
      finalUrl: submitPage.finalUrl,
      bytes: submitPage.body.length,
      hasCsrf: /csrf_token|X-Csrf-Token/i.test(submitHtml),
      hasLanguages: /name=["']programTypeId["']/i.test(submitHtml),
      challenge: /Just a moment|cdn-cgi\/challenge-platform|cf-chl-/i.test(submitHtml),
      loginForm: /id=["']enterForm["']/i.test(submitHtml),
    });

    process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
    const failed = checks.some((check) =>
      check.status < 200 || check.status >= 400 || check.challenge || check.loginForm
    );
    if (failed) throw new Error('One or more authenticated Edge checks failed');
  } finally {
    await session.transport.dispose();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
