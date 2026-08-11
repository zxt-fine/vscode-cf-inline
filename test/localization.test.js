const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLocalizationClientScript,
  buildPageZoomClientScript,
  CONTROLLED_CODEFORCES_DESKTOP_CSS,
  parseGoogleTranslationResponse,
  parseBingTranslationResponse,
  translateHtmlItems,
} = require('../out/localization.js');

test('supports persistent Ctrl+wheel page zoom and Ctrl+0 reset', () => {
  const script = buildPageZoomClientScript();
  assert.match(script, /cf-inline-page-zoom/);
  assert.match(script, /event\.ctrlKey/);
  assert.match(script, /event\.key!==['"]0['"]/);
  assert.match(script, /passive:false/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /root\.style\.removeProperty\('width'\)/);
  assert.match(script, /cfInlineZoomedIn/);
  assert.match(script, /cfInlineEffectiveCompact/);
  assert.match(script, /cfInlineEffectiveNarrow/);
  assert.match(script, /window\.innerWidth\*inverse/);
  assert.match(script, /window\.addEventListener\('resize'/);
  assert.match(script, /页面缩放/);
  assert.match(script, /__cfInlinePageZoomControl/);
  assert.doesNotThrow(() => new Function(script));
});

test('builds independent Chinese UI localization and protected statement translation controls', () => {
  const script = buildLocalizationClientScript({
    localizeInterface: true,
    autoTranslateStatements: false,
  });
  assert.match(script, /"Groups":"群组"/);
  assert.match(script, /"Accepted":"通过"/);
  assert.match(script, /var autoTranslateStatements=false/);
  assert.doesNotMatch(script, /data-cfi-protected|CFIPROTECTED/);
  assert.match(script, /pre,code,script,style/);
  assert.doesNotMatch(script, /statement\.innerHTML=/);
  assert.match(script, /cf-inline-translated-wrap/);
  assert.match(script, /英文原题保持不变/);
  assert.match(script, /installGlobalParagraphTranslators/);
  assert.match(script, /cf-inline-paragraph-control/);
  assert.match(script, /cf-inline-paragraph-translation/);
  assert.match(script, /翻译整段/);
  assert.match(script, /合并翻译这组连续内容，英文原文保持不变/);
  assert.match(script, /block\.closest\('a\[href\]'\)\|\|block/);
  assert.match(script, /event\.preventDefault\(\);event\.stopPropagation\(\)/);
  assert.match(script, /placement\.parentNode\.insertBefore\(toolbar,placement\)/);
  assert.match(script, /\.ttypography,p,blockquote,ul,ol/);
  assert.doesNotMatch(script, /p,li,blockquote/);
  assert.match(script, /closest\('\.problem-statement/);
  assert.match(script, /installSubmitFormRepair/);
  assert.match(script, /installInlineSubmitter/);
  assert.match(script, /installSampleCopyButtons/);
  assert.match(script, /cf-inline-sample-copy/);
  assert.match(script, /复制这个样例/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /document\.execCommand\('copy'\)/);
  assert.match(script, /test-example-line/);
  assert.match(script, /cf-inline-submit-wrap/);
  assert.match(script, /group.*contest.*problem/);
  assert.match(script, /submitThroughOfficialEdge/);
  assert.match(script, /__cf_inline\/submit/);
  assert.match(script, /X-CF-Inline':'submit/);
  assert.doesNotMatch(script, /caf4f|adcd1e/);
  assert.match(script, /translateTextNodesSafely/);
  assert.doesNotMatch(script, /prepared\.html\.length<=4200/);
  assert.match(script, /return translateTextNodesSafely\(block\)/);
  assert.ok(script.includes("raw.match(/^\\s*/)") && script.includes("raw.match(/\\s*$/)"));
  assert.ok(script.includes("core.match(/[\\s\\S]{1,2200}/g)"));
  assert.doesNotMatch(script, /core\.match\(\/\[sS\]/);
  assert.match(script, /'⟦CFI'\+piece\.id\+'⟧'/);
  assert.match(script, /if\(fallback\.length\)/);
  assert.match(script, /Promise\.all\(\[worker\(\),worker\(\),worker\(\),worker\(\),worker\(\),worker\(\)\]\)/);
  assert.match(script, /提交到 Codeforces/);
  assert.match(script, /cleanSubmitMessage/);
  assert.match(script, /isSubmitSuccessMessage/);
  assert.match(script, /has\\s\+been\\s\+submitted/);
  assert.match(script, /script,style,noscript,template/);
  assert.match(script, /cf-inline-page-zoom/);
  assert.match(script, /form\.submit-form \[class\*="error"\]/);
  assert.match(script, /showMessage\|showError/);
  assert.match(script, /请求失败（HTTP/);
  assert.match(script, /parseSubmissionRows/);
  assert.match(script, /status-verdict-cell/);
  assert.match(script, /cf_inline_poll/);
  assert.match(script, /正在等待评测结果/);
  assert.doesNotMatch(script, /查看提交详情/);
  assert.doesNotMatch(script, /is-verdict-failed/);
  assert.match(script, /3\*60\*1000/);
  assert.match(script, /cf-inline-controlled-desktop-style/);
  assert.match(script, /html\{min-width:0!important/);
  assert.match(script, /overflow-x:hidden!important/);
  assert.match(script, /overflow-x:clip!important/);
  assert.match(script, /mobile-navigation/);
  assert.match(script, /data-cf-inline-effective-compact/);
  assert.match(script, /data-cf-inline-effective-narrow/);
  assert.ok(script.includes(JSON.stringify(CONTROLLED_CODEFORCES_DESKTOP_CSS)));
  assert.match(script, /@media \(max-width:1200px\)/);
  assert.match(script, /#sidebar\{display:none!important\}/);
  assert.match(script, /\.content-with-sidebar\{margin-right:0!important\}/);
  assert.match(script, /installViewportGuard/);
  assert.match(script, /当前显示区域过窄/);
  assert.match(script, /@media \(max-width:380px\)/);
  assert.match(script, /\.second-level-menu\{box-sizing:border-box;position:static!important/);
  assert.match(script, /\.action-link>div\{position:static!important/);
  assert.doesNotMatch(script, /typesetTranslatedStatement|MathJax\.Hub\.Queue|typesetPromise/);
});

test('parses all translated segments returned by the translation service', () => {
  const raw = JSON.stringify([
    [
      ['你好，', 'Hello,'],
      ['世界！', 'world!'],
    ],
    null,
    'en',
  ]);
  assert.equal(parseGoogleTranslationResponse(raw), '你好，世界！');
  assert.throws(() => parseGoogleTranslationResponse('{}'), /无法识别/);
  assert.equal(
    parseBingTranslationResponse(JSON.stringify([{ translations: [{ text: '你好，世界！' }] }])),
    '你好，世界！'
  );
  assert.throws(() => parseBingTranslationResponse('{}'), /无法识别/);
});

test('uses the directly reachable Bing translation path before Google', async () => {
  const requests = [];
  const translated = await translateHtmlItems(['<p>Fallback provider test</p>'], async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    if (url.hostname === 'cn.bing.com' && url.pathname === '/translator') {
      return {
        statusCode: 200,
        body: Buffer.from('IG:"ABCDEF123456" data-iid="translator.5023"; params_AbusePreventionHelper = [1786421491982,"bing-token-value",3600000];')
      };
    }
    if (url.hostname === 'cn.bing.com' && url.pathname === '/ttranslatev3') {
      return {
        statusCode: 200,
        body: Buffer.from(JSON.stringify([{ translations: [{ text: '<p>备用翻译成功</p>' }] }]))
      };
    }
    throw new Error(`unexpected host ${url.hostname}`);
  });

  assert.deepEqual(translated, ['<p>备用翻译成功</p>']);
  assert.deepEqual(
    requests.map((request) => new URL(request.url).hostname),
    [
      'cn.bing.com',
      'cn.bing.com',
    ]
  );
  assert.equal(requests[0].timeoutMs, 15000);
  assert.equal(requests[1].timeoutMs, 20000);
  assert.match(requests[1].body.toString('utf8'), /token=bing-token-value/);
});

test('re-establishes the Bing session once after a transient network timeout', async () => {
  const paths = [];
  let failedOnce = false;
  const translated = await translateHtmlItems(['<p>Transient Bing retry test</p>'], async (request) => {
    const url = new URL(request.url);
    paths.push(url.pathname);
    if (url.hostname === 'cn.bing.com' && url.pathname === '/ttranslatev3' && !failedOnce) {
      failedOnce = true;
      throw new Error('Request timed out after 20000 ms');
    }
    if (url.hostname === 'cn.bing.com' && url.pathname === '/translator') {
      return {
        statusCode: 200,
        body: Buffer.from('IG:"RETRY123" data-iid="translator.5023"; params_AbusePreventionHelper = [12345,"retry-token",3600000];')
      };
    }
    if (url.hostname === 'cn.bing.com' && url.pathname === '/ttranslatev3') {
      return {
        statusCode: 200,
        body: Buffer.from(JSON.stringify([{ translations: [{ text: '<p>重试成功</p>' }] }]))
      };
    }
    throw new Error(`unexpected host ${url.hostname}`);
  });
  assert.deepEqual(translated, ['<p>重试成功</p>']);
  assert.equal(paths.filter((path) => path === '/ttranslatev3').length, 2);
  assert.ok(paths.includes('/translator'));
});

test('falls back to Google only when Bing is unavailable', async () => {
  const hosts = [];
  const translated = await translateHtmlItems(['<p>Google fallback test</p>'], async (request) => {
    const url = new URL(request.url);
    hosts.push(url.hostname);
    if (url.hostname === 'cn.bing.com') {
      return { statusCode: 503, body: Buffer.from('unavailable') };
    }
    if (url.hostname === 'translate.googleapis.com') {
      return {
        statusCode: 200,
        body: Buffer.from(JSON.stringify([[['<p>Google 备用成功</p>', '<p>Google fallback test</p>']]]))
      };
    }
    throw new Error(`unexpected host ${url.hostname}`);
  });
  assert.deepEqual(translated, ['<p>Google 备用成功</p>']);
  assert.equal(hosts.at(-1), 'translate.googleapis.com');
});
