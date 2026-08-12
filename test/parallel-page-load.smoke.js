const Module = require('node:module');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { captureCodeforcesSession } = require('../out/browser-login.js');
const { CfProxy } = require('../out/proxy.js');

async function main() {
  const profileDirectory = process.argv[2];
  const synthetic = profileDirectory === '--synthetic';
  if (!synthetic && (!profileDirectory || !path.isAbsolute(profileDirectory))) {
    throw new Error('Pass the absolute dedicated Edge profile directory');
  }
  const session = synthetic
    ? syntheticSession()
    : await captureCodeforcesSession({
        isCancelled: () => false,
        profileDirectory,
        onStatus: (message) => process.stdout.write(`[status] ${message}\n`),
      });
  const proxy = new CfProxy({
    baseUrl: 'https://codeforces.com',
    defaultPath: '/groups/my',
    port: 0,
    localizeInterface: true,
    autoTranslateStatements: true,
    writeClipboardText: async (text) => { proxy.syntheticClipboardText = text; },
  });
  proxy.attachBrowserSession(session.cookies, session.userAgent, session.transport);
  await proxy.start();
  try {
    const renderedPath = synthetic
      ? '/group/test-group/contest/123/problem/A'
      : '/groups/my';
    const harness = await startCrossOriginHarness(proxy.origin, renderedPath);
    const rendered = await renderInEdge(harness.origin);
    await harness.close();
    process.stdout.write(`${JSON.stringify({ rendered, stateAfterRenderedPage: proxy.state() }, null, 2)}\n`);
    if (synthetic) {
      const mainFrame = rendered.pageState?.inspectedFrames?.find((item) => item.frame.url.endsWith(renderedPath));
      const bodyText = mainFrame?.inspected?.result?.value?.bodyText || '';
      if (!bodyText.includes('Groups content is visible')) {
        throw new Error(`Synthetic embedded page did not render: ${bodyText || 'empty body'}`);
      }
      if (!bodyText.includes('群组') || !bodyText.includes('隐藏中文译文')) {
        throw new Error(`Synthetic localization controls did not render: ${bodyText || 'empty body'}`);
      }
      const translationToggle = rendered.pageState?.translationToggle;
      const translationChecks = {
        originalVisible: translationToggle?.statementText.includes('Hello problem statement.'),
        firstParagraph: translationToggle?.translatedText.includes('你好，题目描述。'),
        formulaParagraph: translationToggle?.translatedText.includes('公式后的补充说明。'),
        hardParagraph: translationToggle?.translatedText.includes('这是该题的困难版本'),
        hardParagraphVariables: translationToggle?.translatedText.includes('初始数组以及操作 1 中 x rendered 的允许取值范围'),
        hardParagraphRange: translationToggle?.translatedText.includes('range rendered 范围内的任意整数'),
        hardParagraphEnd: translationToggle?.translatedText.includes('只有两个版本都已解决后，才可以进行 Hack。'),
        hardParagraphBold: translationToggle?.translatedHardTag === 'STRONG',
        easyParagraph: translationToggle?.translatedText.includes('这是该题的简单版本。与其他版本相比，此版本的约束更小。'),
        originalMathStable: translationToggle?.sameMathNode,
        translatedMathText: translationToggle?.translatedMathText === '2n rendered',
        translatedMathCount: translationToggle?.translatedMathCount === 3,
        previewsRemoved: translationToggle?.translatedMathPreviewCount === 0,
        sourcesRemoved: translationToggle?.translatedMathSourceCount === 0,
        codeStable: translationToggle?.translatedCodeText === 'int x;',
        originalSampleCopyButtons: translationToggle?.originalSampleCopyCount === 2,
        translatedSampleCopyButtons: translationToggle?.translatedSampleCopyCount === 2,
        translatedSampleCopyClickable: translationToggle?.translatedSampleCopyText === '已复制',
        noRetypeset: translationToggle?.typesetCalls === 0,
        noMarkerLeak: !translationToggle?.leakedMarker,
        noBracketArtifact: !translationToggle?.leakedBracketArtifact,
      };
      if (Object.values(translationChecks).some((passed) => !passed)) {
        throw new Error(`Repeated translation toggles damaged the statement: ${JSON.stringify({ translationChecks, translationToggle })}`);
      }
      const wheelHandoff = rendered.pageState?.wheelHandoff;
      if (!wheelHandoff?.horizontalAdvancedPage
        || !wheelHandoff.verticalAdvancedInner
        || wheelHandoff.verticalMovedPageBeforeBoundary
        || !wheelHandoff.verticalBoundaryAdvancedPage
        || wheelHandoff.ctrlWheelMovedPage
        || !wheelHandoff.ctrlWheelChangedZoom) {
        throw new Error(`Wheel scroll handoff failed: ${JSON.stringify(wheelHandoff)}`);
      }
      if (!session.transport.translationPayloads.some((item) => item.includes('[[93')
        && item.includes('Hello problem statement.')
        && item.includes('Additional explanation after the formula.'))) {
        throw new Error(`A formula split one natural paragraph into separate translation requests: ${JSON.stringify(session.transport.translationPayloads)}`);
      }
      const hardRequests = session.transport.translationPayloads.filter((item) => item.includes('This is the hard version of the problem.'));
      if (hardRequests.length !== 0) throw new Error(`The fixed bold version notice should be translated locally: ${JSON.stringify(hardRequests)}`);
      const easyRequests = session.transport.translationPayloads.filter((item) => item.includes('This is the Easy version of the problem.'));
      if (easyRequests.length !== 0) throw new Error(`The fixed easy-version notice should be translated locally: ${JSON.stringify(easyRequests)}`);
      const formulaRequests = session.transport.translationPayloads.filter((item) => item.includes('Hello problem statement.'));
      if (formulaRequests.length !== 1) throw new Error(`A successful natural paragraph should use one request: ${JSON.stringify(formulaRequests)}`);
      const paragraphTranslation = rendered.pageState?.paragraphTranslation;
      if (!paragraphTranslation?.hasControl
        || paragraphTranslation.statementControlCount !== 0
        || paragraphTranslation.nestedControlCount !== 0
        || paragraphTranslation.translatedListItems !== 2
        || !paragraphTranslation.originalText.includes('This is an English announcement')
        || !paragraphTranslation.translatedText.includes('这是一段英文公告')) {
        throw new Error(`Selective paragraph translation failed or leaked into the statement: ${JSON.stringify(paragraphTranslation)}`);
      }
      const linkedTitleTranslation = rendered.pageState?.linkedTitleTranslation;
      if (!linkedTitleTranslation?.hasControl
        || !linkedTitleTranslation.controlOutsideLink
        || !linkedTitleTranslation.urlUnchanged
        || !linkedTitleTranslation.translatedText.includes('ICPC 挑战赛由华为提供支持')) {
        throw new Error(`Linked announcement title translation navigated away or failed: ${JSON.stringify(linkedTitleTranslation)}`);
      }
      const inlineSubmit = rendered.pageState?.inlineSubmit;
      if (!inlineSubmit?.success
        || inlineSubmit.languageCount < 2
        || !inlineSubmit.nativeSuccess) {
        throw new Error(`Synthetic submit UI or native form repair failed: ${JSON.stringify(inlineSubmit)}`);
      }
      const responsive = rendered.pageState?.responsive;
      if (!responsive?.narrowSidebarHidden
        || responsive.narrowContentMarginRight !== '0px'
        || responsive.narrowHasHorizontalOverflow
        || !responsive.wideSidebarVisible
        || responsive.compactMenuClipped
        || responsive.compactSecondLevelPosition !== 'static'
        || responsive.compactActionPosition !== 'static'
        || responsive.compactNavigationOverlap
        || !responsive.ultraNarrowNoticeVisible
        || !responsive.ultraNarrowPageHidden) {
        throw new Error(`Responsive Codeforces layout failed: ${JSON.stringify(responsive)}`);
      }
      const submitted = session.transport.submissions;
      if (submitted.length !== 2
        || !submitted.every((item) => item.url.includes('/group/test-group/contest/123/submit'))
        || submitted[0].index !== 'A'
        || submitted[0].programTypeId !== '89'
        || !submitted[0].source.includes('int main()')
        || submitted[1].source !== 'abc') {
        throw new Error(`Synthetic submit request was incomplete: ${JSON.stringify(submitted)}`);
      }
    }
    const report = [];
    for (const pathname of ['/groups/my', '/contests', '/gyms', '/problemset']) {
      const page = await get(`${proxy.origin}${pathname}`);
      const assets = extractLocalAssets(page.body.toString('utf8'), proxy.origin).slice(0, 80);
      const settled = await Promise.allSettled(assets.map((url) => get(url)));
      const rejected = settled.filter((item) => item.status === 'rejected');
      const badStatus = settled.filter((item) => item.status === 'fulfilled' && item.value.statusCode >= 400);
      report.push({
        pathname,
        pageStatus: page.statusCode,
        assets: assets.length,
        rejected: rejected.length,
        badStatus: badStatus.length,
        state: proxy.state(),
        firstErrors: rejected.slice(0, 3).map((item) => String(item.reason)),
        rawBodyTag: (page.body.toString('utf8').match(/<body\b[^>]*>/i) || [])[0],
        frameGuards: (page.body.toString('utf8').match(
          /.{0,100}(?:window\.top|top\.location|self\s*!==?\s*top|frameElement).{0,160}/gi
        ) || []).slice(0, 8),
      });
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!proxy.isSessionReady() || !proxy.isLoggedIn()) {
      throw new Error('Proxy session was lost during parallel page loading');
    }
  } finally {
    await proxy.stop();
  }
}

function syntheticSession() {
  const visiblePage = `<!doctype html><html data-cf-typeset-calls="0"><head><title>Groups synthetic</title><script>
    window.MathJax = { Hub: { Queue: function () {
      document.documentElement.dataset.cfTypesetCalls = String(Number(document.documentElement.dataset.cfTypesetCalls || '0') + 1);
    } } };
  </script></head><body><div id="body"><nav>Groups</nav><div class="menu-box"><ul class="menu-list"><li>Home</li><li>Contests</li><li>Gym</li><li>Problemset</li><li>Groups</li></ul></div><div id="pageContent" class="content-with-sidebar"><div class="second-level-menu" style="position:absolute;left:7px;top:-12px"><ul class="second-level-menu-list" style="height:29px;overflow:hidden"><li>example_user</li><li>Settings</li><li>Lists</li><li>Blog</li><li>Teams</li><li>Submissions</li><li>Favourites</li><li>Groups</li><li>Contests</li><li>Problemsetting</li><li class="backLava">decoration</li></ul></div><div class="action-link" style="position:relative;height:2em"><div style="position:absolute;right:0"><span>All groups</span> <span>Create group</span></div></div>
    <aside id="sidebar" style="float:right;width:260px"><div class="roundbox">Right sidebar</div></aside><main class="content">
    <div style="font: 24px sans-serif; color: #123">Groups content is visible</div>
    <div id="globalEnglish" class="ttypography"><p>This is an English announcement outside the problem statement.</p><ol><li>First solver: tourist</li><li>Second solver: Benq</li></ol></div>
    <a id="linkedTopic" href="/blog/entry/1"><div id="linkedEnglish" class="ttypography"><h1>ICPC Challenge powered by Huawei</h1><p>By ICPCNews, 9 days ago.</p></div></a>
    <section class="problem-statement"><div class="header"><div>time limit per test</div></div><div><p class="version-note"><span class="tex-font-style-bf">This is the hard version of the problem. The only difference between the two versions is the set of allowed values for the initial array and for </span><span class="MathJax_Preview"></span><span class="MathJax"><span>x rendered</span></span><script type="math/tex">x</script><span class="tex-font-style-bf"> in operations of type 1. In this version, these values can be any integers in </span><span class="MathJax_Preview"></span><span class="MathJax"><span>range rendered</span></span><script type="math/tex">[-10^9,10^9]</script><span class="tex-font-style-bf">. You can make hacks only if both versions of the problem are solved.</span></p><p><strong>This is the Easy version of the problem. The constraints in this version are smaller.</strong></p><p>Hello problem statement. <span class="MathJax_Preview"></span><span class="MathJax"><span>2n rendered</span></span><script type="math/tex">2n</script> Additional explanation after the formula.</p><code>int x;</code></div><div class="sample-tests"><div class="section-title">Examples</div><div class="input"><div class="title">Input</div><pre><div class="test-example-line">1 2</div></pre></div><div class="output"><div class="title">Output</div><pre><div class="test-example-line">3</div></pre></div></div></section>
    <div style="height:600px"></div><div id="wheel-horizontal" style="box-sizing:border-box;width:240px;height:70px;overflow-x:auto;overflow-y:hidden"><div style="width:900px;height:60px">Horizontal-only scroll fixture</div></div><div style="height:120px"></div><div id="wheel-vertical" style="box-sizing:border-box;width:240px;height:100px;overflow-y:auto"><div style="height:600px">Vertical scroll fixture</div></div><div style="height:800px"></div></main></div>
    <script>if (window.parent.frames.length > 0) { window.stop(); }</script>
    <footer>Rendered footer</footer></div>
  </body></html>`;
  const submitPage = `<!doctype html><html><head><meta name="X-Csrf-Token" content="csrf-value"></head><body>
    <form class="submit-form submitFrameForm" method="post" action="?csrf_token=csrf-value" enctype="multipart/form-data">
      <input type="hidden" name="csrf_token" value="csrf-value"><input type="hidden" name="ftaa" value=""><input type="hidden" name="bfaa" value="">
      <input type="hidden" name="action" value="submitSolutionFormSubmitted"><input type="hidden" name="contestId" value="123">
      <select name="programTypeId"><option value="89">GNU G++20 13.2</option><option value="31">Python 3</option></select><textarea name="source"></textarea>
    </form><script>window._ftaa="ftaa-browser-value";window._bfaa="bfaa-browser-value";</script>
  </body></html>`;
  const submissions = [];
  const translationPayloads = [];
  let hardVersionReturnedUnchanged = false;
  let spacedMathMarkerReturned = false;
  const transport = {
      submissions,
      translationPayloads,
      isAlive: () => true,
      dispose: async () => {},
      translateHtmlItems: async (items) => {
        translationPayloads.push(...items);
        return items.map((html) => {
          if (html.includes('This is the hard version of the problem.') && !hardVersionReturnedUnchanged) {
            hardVersionReturnedUnchanged = true;
            return html;
          }
          let translated = html
            .replace('This is the hard version of the problem. The only difference between the two versions is the set of allowed values for ', '这是该题的困难版本，两个版本的唯一区别是操作 1 中 ')
            .replace(' in operations of type 1. You can make hacks only if both versions of the problem are solved.', ' 的允许取值范围。只有解决两个版本后才能进行攻击。')
            .replace('Hello problem statement.', '你好，题目描述。')
            .replace('Additional explanation after the formula.', '公式后的补充说明。')
            .replace('This is an English announcement outside the problem statement.', '这是一段英文公告，位于题目描述之外。')
            .replace('First solver: tourist', '第一位解题者：tourist')
            .replace('Second solver: Benq', '第二位解题者：Benq')
            .replace('ICPC Challenge powered by Huawei', 'ICPC 挑战赛由华为提供支持')
            .replace('By ICPCNews, 9 days ago.', '由 ICPCNews 发布，9 天前。')
            .replace(/ data-cfi-protected="\d+"/g, '');
          if (html.includes('Hello problem statement.') && !spacedMathMarkerReturned) {
            spacedMathMarkerReturned = true;
            translated = translated.replace(/\[\[(\d+)\]\]/g, (_, digits) => `【 ${digits.split('').join(' ')} 】`);
          }
          return translated;
        });
      },
      submitSolution: async (request) => {
        submissions.push(request);
        return { statusCode: 200, headers: { 'content-type': 'text/html; charset=UTF-8' }, body: Buffer.from('<script>Codeforces.showMessage("Solution to the problem A has been submitted successfully")</script>', 'utf8'), finalUrl: 'https://codeforces.com/group/test-group/contest/123/my' };
      },
      request: async (request) => {
        const target = new URL(request.url);
        if (target.pathname === '/group/test-group/contest/123/submit' && request.method === 'GET') {
          return { statusCode: 200, headers: { 'content-type': 'text/html; charset=UTF-8' }, body: Buffer.from(submitPage, 'utf8'), finalUrl: request.url };
        }
        if (target.pathname === '/group/test-group/contest/123/submit' && request.method === 'POST') {
          submissions.push({ url: request.url, body: request.body.toString('utf8') });
          return { statusCode: 200, headers: { 'content-type': 'text/html; charset=UTF-8' }, body: Buffer.from('<html><body><main>Submission received</main></body></html>', 'utf8'), finalUrl: request.url };
        }
        return { statusCode: 200, headers: { 'content-type': 'text/html; charset=UTF-8' }, body: Buffer.from(visiblePage, 'utf8'), finalUrl: request.url };
      },
    };
  return {
    cookies: [{
      name: 'X-User-Sha1',
      value: '0123456789abcdef0123456789abcdef01234567',
      domain: '.codeforces.com',
      path: '/',
      secure: true,
      httpOnly: true,
    }],
    userAgent: 'Synthetic Edge test',
    transport,
  };
}

async function renderInEdge(url) {
  const executable = await findEdge();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-inline-render-smoke-'));
  const debuggerPort = await freePort();
  const child = spawn(executable, [
    '--headless=new',
    '--disable-gpu',
    '--disable-sync',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debuggerPort}`,
    '--remote-debugging-address=127.0.0.1',
    url,
  ], { stdio: 'ignore', windowsHide: true });
  try {
    const deadline = Date.now() + 30000;
    let title = '';
    let pageTarget;
    while (Date.now() < deadline) {
      try {
        const targets = await getJson(`http://127.0.0.1:${debuggerPort}/json/list`);
        pageTarget = targets.find((target) => target.type === 'page' && target.url === url) || pageTarget;
        title = pageTarget?.title || title;
        if (title.startsWith('CF_READY:')) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await new Promise((resolve) => setTimeout(resolve, 8000));
    let pageState;
    let screenshotPath;
    if (pageTarget?.webSocketDebuggerUrl) {
      const cdp = await connectCdp(pageTarget.webSocketDebuggerUrl);
      try {
        pageState = await cdp.send('Runtime.evaluate', {
          expression: `({
            title: document.title,
            bodyText: document.body.innerText,
            mainSrc: document.getElementById('main')?.src,
            mainRect: document.getElementById('main')?.getBoundingClientRect().toJSON()
          })`,
          returnByValue: true,
        });
        const frameTree = await cdp.send('Page.getFrameTree');
        const frames = flattenFrames(frameTree.frameTree);
        const inspectedFrames = [];
        for (const frame of frames) {
          if (!frame.url.includes('/groups/my') && !frame.url.includes('/group/test-group/contest/123/problem/A') && !frame.url.includes('/__cf_inline/bridge')) continue;
          const world = await cdp.send('Page.createIsolatedWorld', {
            frameId: frame.id,
            worldName: 'cf-inline-smoke',
          });
          const inspected = await cdp.send('Runtime.evaluate', {
            contextId: world.executionContextId,
            expression: `({
              url: location.href,
              title: document.title,
              readyState: document.readyState,
              htmlLength: document.documentElement?.outerHTML.length || 0,
              bodyLength: document.body?.innerHTML.length || 0,
              bodyText: document.body?.innerText.slice(0, 500) || '',
              bodyHtml: document.body?.innerHTML.slice(0, 2000) || '',
              bodyDisplay: document.body ? getComputedStyle(document.body).display : '',
              bodyVisibility: document.body ? getComputedStyle(document.body).visibility : '',
              bodyOpacity: document.body ? getComputedStyle(document.body).opacity : '',
              styleSheets: document.styleSheets.length,
              scripts: document.scripts.length
            })`,
            returnByValue: true,
          });
          inspectedFrames.push({ frame, inspected });
          if (frame.url.includes('/groups/my') || frame.url.includes('/group/test-group/contest/123/problem/A')) {
            const toggled = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `(async () => {
                const button = document.querySelector('.cf-inline-translate-bar button');
                const math = document.querySelector('.MathJax');
                if (!button || !math) return null;
                for (let index = 0; index < 4; index += 1) {
                  button.click();
                  await new Promise((resolve) => setTimeout(resolve, 120));
                }
                const translatedCopy = document.querySelector('.cf-inline-translated-statement .input .cf-inline-sample-copy');
                if (translatedCopy) {
                  document.execCommand = (command) => command === 'copy';
                  translatedCopy.click();
                  await new Promise((resolve) => setTimeout(resolve, 80));
                }
                return {
                  sameMathNode: document.querySelector('.MathJax') === math,
                  mathText: math.textContent,
                  codeText: document.querySelector('code')?.textContent,
                  translatedMathText: Array.from(document.querySelectorAll('.cf-inline-translated-statement .MathJax')).at(-1)?.textContent,
                  translatedMathCount: document.querySelectorAll('.cf-inline-translated-statement .MathJax').length,
                  translatedHardTag: document.querySelector('.cf-inline-translated-statement p')?.firstElementChild?.tagName,
                  translatedMathPreviewCount: document.querySelectorAll('.cf-inline-translated-statement .MathJax_Preview').length,
                  translatedMathSourceCount: document.querySelectorAll('.cf-inline-translated-statement script[type^="math/tex"]').length,
                  translatedCodeText: document.querySelector('.cf-inline-translated-statement code')?.textContent,
                  typesetCalls: Number(document.documentElement.dataset.cfTypesetCalls || '0'),
                  leakedMarker: document.querySelector('.cf-inline-translated-statement')?.innerHTML.includes('CFIPROTECTED') || false,
                  leakedBracketArtifact: ['[]','【】','[x rendered]','[2n rendered]'].some((artifact) => (document.querySelector('.cf-inline-translated-statement')?.innerText || '').includes(artifact)),
                  statementText: document.querySelector('.problem-statement')?.innerText,
                  translatedText: document.querySelector('.cf-inline-translated-statement')?.innerText,
                  originalSampleCopyCount: document.querySelectorAll('.problem-statement:not(.cf-inline-translated-statement) .cf-inline-sample-copy').length,
                  translatedSampleCopyCount: document.querySelectorAll('.cf-inline-translated-statement .cf-inline-sample-copy').length,
                  translatedSampleCopyText: translatedCopy?.textContent,
                  buttonText: button.textContent
                };
              })()`,
              awaitPromise: true,
              returnByValue: true,
            });
            pageState.translationToggle = toggled.result?.value;
            const paragraphTranslated = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `(async () => {
                const paragraph = document.getElementById('globalEnglish');
                const toolbar = paragraph?.previousElementSibling;
                const button = toolbar?.querySelector('.cf-inline-paragraph-control');
                if (button) button.click();
                const deadline = Date.now() + 5000;
                while (button?.disabled && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
                return {
                  hasControl: !!button,
                  statementControlCount: document.querySelectorAll('.problem-statement .cf-inline-paragraph-control').length,
                  nestedControlCount: paragraph?.querySelectorAll('.cf-inline-paragraph-control').length || 0,
                  translatedListItems: paragraph?.nextElementSibling?.querySelectorAll('li').length || 0,
                  originalText: paragraph?.textContent || '',
                  translatedText: paragraph?.nextElementSibling?.classList.contains('cf-inline-paragraph-translation') ? paragraph.nextElementSibling.textContent : ''
                };
              })()`,
              awaitPromise: true,
              returnByValue: true,
            });
            pageState.paragraphTranslation = paragraphTranslated.result?.value;
            const linkedTitleTranslated = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `(async () => {
                const originalUrl = location.href;
                const block = document.getElementById('linkedEnglish');
                const link = document.getElementById('linkedTopic');
                const toolbar = link?.previousElementSibling;
                const button = toolbar?.querySelector('.cf-inline-paragraph-control');
                if (button) button.click();
                const deadline = Date.now() + 5000;
                while (button?.disabled && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
                const translation = link?.nextElementSibling;
                return {
                  hasControl: !!button,
                  controlOutsideLink: !!button && !link.contains(button),
                  urlUnchanged: location.href === originalUrl,
                  originalText: block?.textContent || '',
                  translatedText: translation?.classList.contains('cf-inline-paragraph-translation') ? translation.textContent : ''
                };
              })()`,
              awaitPromise: true,
              returnByValue: true,
            });
            pageState.linkedTitleTranslation = linkedTitleTranslated.result?.value;
            const submitted = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `(async () => {
                const deadline = Date.now() + 10000;
                while (!document.querySelector('.cf-inline-submit-form') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
                const inlineForm = document.querySelector('.cf-inline-submit-form');
                if (!inlineForm) return { success: false, error: document.querySelector('.cf-inline-submit-wrap')?.innerText || 'missing inline form' };
                inlineForm.querySelector('textarea[name="source"]').value = 'int main() { return 0; }';
                inlineForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                while (!/Codeforces 已接收代码/.test(document.querySelector('.cf-inline-submit-status')?.textContent || '') && !document.querySelector('.cf-inline-submit-status.is-error') && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
                const native = document.createElement('form'); native.className = 'submit-form'; native.action = '/group/test-group/contest/123/submit';
                native.innerHTML = '<input type="hidden" name="contestId" value="123"><input type="hidden" name="submittedProblemIndex" value="A"><select name="programTypeId"><option value="89" selected>GNU G++20</option></select><textarea name="source">abc</textarea><button type="submit">Submit</button>';
                document.body.appendChild(native);
                native.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                const nativeDeadline = Date.now() + 5000;
                while (!native.querySelector('.cf-inline-native-submit-status.is-success') && !native.querySelector('.cf-inline-native-submit-status.is-error') && Date.now() < nativeDeadline) await new Promise((resolve) => setTimeout(resolve, 100));
                return {
                  success: /Codeforces 已接收代码/.test(document.querySelector('.cf-inline-submit-status')?.textContent || ''),
                  status: document.querySelector('.cf-inline-submit-status')?.textContent,
                  languageCount: inlineForm.querySelectorAll('select[name="programTypeId"] option').length,
                  nativeSuccess: !!native.querySelector('.cf-inline-native-submit-status.is-success'),
                  nativeStatus: native.querySelector('.cf-inline-native-submit-status')?.textContent
                };
              })()`,
              awaitPromise: true,
              returnByValue: true,
            });
            pageState.inlineSubmit = submitted.result?.value;
            const narrowLayout = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `({
                sidebarHidden: getComputedStyle(document.getElementById('sidebar')).display === 'none',
                contentMarginRight: getComputedStyle(document.querySelector('.content-with-sidebar')).marginRight,
                hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
              })`,
              returnByValue: true,
            });
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
            await new Promise((resolve) => setTimeout(resolve, 250));
            const wideLayout = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `({ sidebarVisible: getComputedStyle(document.getElementById('sidebar')).display !== 'none' })`,
              returnByValue: true,
            });
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 500, height: 700, deviceScaleFactor: 1, mobile: false });
            await new Promise((resolve) => setTimeout(resolve, 200));
            const compactLayout = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `(() => {
                const menu = document.querySelector('.second-level-menu');
                const action = document.querySelector('.action-link');
                const actionInner = action.firstElementChild;
                const menuRect = menu.getBoundingClientRect();
                const actionRect = action.getBoundingClientRect();
                return {
                  menuClipped: menu.scrollHeight > menu.clientHeight + 1,
                  secondLevelPosition: getComputedStyle(menu).position,
                  actionPosition: getComputedStyle(actionInner).position,
                  navigationOverlap: menuRect.bottom > actionRect.top + 1
                };
              })()`,
              returnByValue: true,
            });
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 700, deviceScaleFactor: 1, mobile: false });
            await new Promise((resolve) => setTimeout(resolve, 200));
            const ultraNarrowLayout = await cdp.send('Runtime.evaluate', {
              contextId: world.executionContextId,
              expression: `({
                noticeVisible: getComputedStyle(document.querySelector('.cf-inline-too-narrow')).display !== 'none',
                pageHidden: getComputedStyle(document.getElementById('body')).display === 'none'
              })`,
              returnByValue: true,
            });
            pageState.responsive = {
              narrowSidebarHidden: narrowLayout.result?.value?.sidebarHidden,
              narrowContentMarginRight: narrowLayout.result?.value?.contentMarginRight,
              narrowHasHorizontalOverflow: narrowLayout.result?.value?.hasHorizontalOverflow,
              wideSidebarVisible: wideLayout.result?.value?.sidebarVisible,
              compactMenuClipped: compactLayout.result?.value?.menuClipped,
              compactSecondLevelPosition: compactLayout.result?.value?.secondLevelPosition,
              compactActionPosition: compactLayout.result?.value?.actionPosition,
              compactNavigationOverlap: compactLayout.result?.value?.navigationOverlap,
              ultraNarrowNoticeVisible: ultraNarrowLayout.result?.value?.noticeVisible,
              ultraNarrowPageHidden: ultraNarrowLayout.result?.value?.pageHidden,
            };
            await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
            await new Promise((resolve) => setTimeout(resolve, 150));
            const prepareWheelTarget = async (selector, atBottom = false) => {
              const prepared = await cdp.send('Runtime.evaluate', {
                contextId: world.executionContextId,
                expression: `(() => {
                  const target = document.querySelector(${JSON.stringify(selector)});
                  target.scrollIntoView({ block: 'center' });
                  if (${atBottom}) target.scrollTop = target.scrollHeight;
                  const rect = target.getBoundingClientRect();
                  return {
                    x: rect.left + Math.min(rect.width / 2, 80),
                    y: rect.top + Math.min(rect.height / 2, 40),
                    pageTop: document.scrollingElement.scrollTop,
                    targetTop: target.scrollTop,
                    zoom: document.documentElement.style.zoom || '1'
                  };
                })()`,
                returnByValue: true,
              });
              return prepared.result.value;
            };
            const readWheelState = async (selector) => {
              const state = await cdp.send('Runtime.evaluate', {
                contextId: world.executionContextId,
                expression: `(() => {
                  const target = document.querySelector(${JSON.stringify(selector)});
                  return {
                    pageTop: document.scrollingElement.scrollTop,
                    targetTop: target.scrollTop,
                    zoom: document.documentElement.style.zoom || '1'
                  };
                })()`,
                returnByValue: true,
              });
              return state.result.value;
            };
            const dispatchWheel = async (point, modifiers = 0) => {
              await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
              await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: 120, modifiers });
              await new Promise((resolve) => setTimeout(resolve, 120));
            };
            const horizontalBefore = await prepareWheelTarget('#wheel-horizontal');
            await dispatchWheel(horizontalBefore);
            const horizontalAfter = await readWheelState('#wheel-horizontal');
            const verticalBefore = await prepareWheelTarget('#wheel-vertical');
            await dispatchWheel(verticalBefore);
            const verticalAfter = await readWheelState('#wheel-vertical');
            const verticalBoundaryBefore = await prepareWheelTarget('#wheel-vertical', true);
            await dispatchWheel(verticalBoundaryBefore);
            const verticalBoundaryAfter = await readWheelState('#wheel-vertical');
            const ctrlBefore = await prepareWheelTarget('#wheel-horizontal');
            await dispatchWheel(ctrlBefore, 2);
            const ctrlAfter = await readWheelState('#wheel-horizontal');
            pageState.wheelHandoff = {
              horizontalAdvancedPage: horizontalAfter.pageTop > horizontalBefore.pageTop,
              verticalAdvancedInner: verticalAfter.targetTop > verticalBefore.targetTop,
              verticalMovedPageBeforeBoundary: verticalAfter.pageTop !== verticalBefore.pageTop,
              verticalBoundaryAdvancedPage: verticalBoundaryAfter.pageTop > verticalBoundaryBefore.pageTop,
              ctrlWheelMovedPage: ctrlAfter.pageTop !== ctrlBefore.pageTop,
              ctrlWheelChangedZoom: ctrlAfter.zoom !== ctrlBefore.zoom,
              horizontalBefore,
              horizontalAfter,
              verticalBefore,
              verticalAfter,
              verticalBoundaryBefore,
              verticalBoundaryAfter,
              ctrlBefore,
              ctrlAfter,
            };
          }
        }
        pageState.inspectedFrames = inspectedFrames;
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        screenshotPath = path.join(os.tmpdir(), 'cf-inline-cross-origin-debug.png');
        await fs.writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
      } finally {
        cdp.close();
      }
    }
    return { url, title, pageState, screenshotPath, processExited: child.exitCode !== null };
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function flattenFrames(root) {
  const result = [root.frame];
  for (const child of root.childFrames || []) result.push(...flattenFrames(child));
  return result;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  send(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(new CdpClient(socket)));
    socket.once('error', reject);
  });
}

async function startCrossOriginHarness(proxyOrigin, initialPath) {
  const server = http.createServer((_request, response) => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>CF_WAIT</title>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src ${proxyOrigin}">
      <style>html,body{margin:0;width:100%;height:100%}#bridge{display:none}#main{border:0;width:100%;height:100%}</style></head>
      <body><iframe id="bridge" src="${proxyOrigin}/__cf_inline/bridge"></iframe><iframe id="main" name="cfInlineMain"></iframe>
      <script>(function(){
        var bridge=document.getElementById('bridge'), main=document.getElementById('main'), loaded=false;
        window.addEventListener('message',function(event){
          var data=event.data||{};
          if(event.source===bridge.contentWindow && data.__cfInlineBridge && data.type==='state'){
            var ready=!!data.state.sessionReady && !!data.state.loggedIn;
            document.title='CF_READY:'+String(ready);
            if(ready && !loaded){loaded=true;main.src='${proxyOrigin}${initialPath}';}
          }
        });
      })();</script></body></html>`;
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function findEdge() {
  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch {}
  }
  throw new Error('Microsoft Edge was not found');
}

function extractLocalAssets(html, origin) {
  const urls = new Set();
  const re = /(?:src|href)=["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin === origin && !url.pathname.startsWith('/__cf_inline/')) {
        urls.add(url.toString());
      }
    } catch {}
  }
  return [...urls];
}

function get(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        body: Buffer.concat(chunks),
      }));
    });
    request.setTimeout(90000, () => request.destroy(new Error(`timeout: ${url}`)));
    request.on('error', reject);
  });
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
