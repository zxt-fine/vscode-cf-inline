const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLocalizationClientScript,
  buildPageZoomClientScript,
  CONTROLLED_CODEFORCES_DESKTOP_CSS,
  isUsefulChineseTranslation,
  formatCodeforcesLimitLabel,
  parseGoogleTranslationResponse,
  parseBingTranslationResponse,
  parseDeepLTranslationResponse,
  refineCompetitiveProgrammingTranslation,
  resetTranslationStateForTests,
  translateHtmlItems,
} = require('../out/localization.js');

test('corrects ambiguous game terminology using the English source context', () => {
  const gameSource = 'They play for n rounds. Ajisai moves on odd-numbered rounds and Mai moves on even-numbered rounds. On each round, the player who is to move may swap a_i and b_i, or pass.';
  const inaccurate = '他们进行 n 轮游戏。Ajisai 在奇数回合移动，Mai 在偶数回合移动。每一回合，要移动的玩家可以交换 a_i 和 b_i，或者通过。';
  assert.equal(
    refineCompetitiveProgrammingTranslation(gameSource, inaccurate),
    '他们进行 n 轮游戏。Ajisai 在奇数回合行动，Mai 在偶数回合行动。每一回合，当前回合需要行动的玩家可以交换 a_i 和 b_i，或者跳过本回合。'
  );
  assert.equal(
    refineCompetitiveProgrammingTranslation('The solution passes all tests.', '该解法通过所有测试。'),
    '该解法通过所有测试。'
  );
  assert.equal(
    refineCompetitiveProgrammingTranslation('Alice moves to position x on odd rounds.', 'Alice 在奇数回合移动到位置 x。'),
    'Alice 在奇数回合移动到位置 x。'
  );
});

test('rejects unchanged long English text while allowing Chinese and short technical labels', () => {
  const source = 'This is the hard version of the problem. The only difference between the two versions is the allowed range.';
  assert.equal(isUsefulChineseTranslation(source, source), false);
  assert.equal(isUsefulChineseTranslation(source, '这是该问题的困难版本，两个版本之间唯一的区别是允许范围。'), true);
  assert.equal(isUsefulChineseTranslation('Hello problem statement.', 'Hello problem statement.'), false);
  assert.equal(isUsefulChineseTranslation('GNU G++20', 'GNU G++20'), true);
  assert.equal(isUsefulChineseTranslation(
    source,
    '这是困难版本。 The only difference between the two versions is the allowed range.'
  ), false);
});

test('rejects untranslated Russian prose from the Chinese translation area', () => {
  const russian = 'Это сложная версия задачи. Отличие между версиями заключается в ограничениях и требуется вычислить сумму всех подпоследовательностей.';
  assert.equal(isUsefulChineseTranslation(russian, russian), false);
  assert.equal(isUsefulChineseTranslation(russian, '这是困难版本 задачи. Отличие между версиями заключается в ограничениях и требуется вычислить сумму.'), false);
  assert.equal(isUsefulChineseTranslation(russian, '这是该题的困难版本。两个版本的区别在于限制条件，本题需要计算所有子序列的得分之和。'), true);
});

test('formats English and Russian Codeforces time and memory limits completely', () => {
  assert.equal(formatCodeforcesLimitLabel('time', 'time limit per test 2 seconds'), '每个测试点的时间限制：2 秒');
  assert.equal(formatCodeforcesLimitLabel('time', 'ограничение по времени на тест: 3 секунды'), '每个测试点的时间限制：3 秒');
  assert.equal(formatCodeforcesLimitLabel('memory', 'memory limit per test 256 megabytes'), '每个测试点的内存限制：256 兆字节');
  assert.equal(formatCodeforcesLimitLabel('memory', 'ограничение по памяти на тест: 256 мегабайт'), '每个测试点的内存限制：256 兆字节');
});

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
  assert.match(script, /installWheelScrollHandoff/);
  assert.match(script, /document\.scrollingElement/);
  assert.match(script, /canScrollVertically/);
  assert.match(script, /event\.defaultPrevented\|\|event\.ctrlKey/);
  assert.match(script, /textarea,select,option,input\[type=/);
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
  assert.match(script, /"ГЛАВНАЯ":"主页"/);
  assert.match(script, /"ВИРТУАЛЬНОЕ УЧАСТИЕ":"虚拟参赛"/);
  assert.match(script, /"подготовил":"出题人"/);
  assert.match(script, /prefixDictionary/);
  assert.match(script, /normalized\.slice\(prefix\.length\)/);
  assert.match(script, /"Accepted":"通过"/);
  assert.match(script, /var autoTranslateStatements=false/);
  assert.doesNotMatch(script, /data-cfi-protected|CFIPROTECTED/);
  assert.match(script, /pre,code,.MathJax/);
  assert.doesNotMatch(script, /protectedSelector='[^']*tex-font-style/);
  assert.doesNotMatch(script, /statement\.innerHTML=/);
  assert.match(script, /cf-inline-translated-wrap/);
  assert.match(script, /原题保持不变/);
  assert.match(script, /installGlobalParagraphTranslators/);
  assert.match(script, /cf-inline-paragraph-control/);
  assert.match(script, /cf-inline-paragraph-translation/);
  assert.match(script, /翻译整段/);
  assert.match(script, /合并翻译这组连续内容，原文保持不变/);
  assert.match(script, /block\.closest\('a\[href\]'\)\|\|block/);
  assert.match(script, /event\.preventDefault\(\);event\.stopPropagation\(\)/);
  assert.match(script, /placement\.parentNode\.insertBefore\(toolbar,placement\)/);
  assert.match(script, /\.ttypography,p,blockquote,ul,ol/);
  assert.match(script, /closest\('\.problem-statement/);
  assert.match(script, /installSubmitFormRepair/);
  assert.match(script, /installInlineSubmitter/);
  assert.match(script, /cf-inline-title-favorite/);
  assert.match(script, /\.cf-inline-paragraph-translation,.cf-inline-title-favorite/);
  assert.match(script, /function restoreTranslatedHeader/);
  assert.match(script, /originalFavorite\.cloneNode\(true\)/);
  assert.match(script, /originalFavorite\.click\(\)/);
  assert.match(script, /formatLimitLabel/);
  assert.match(script, /restoreTranslatedHeader\(statement,translatedStatement\)/);
  assert.match(script, /recordExists=false;select\.disabled=true/);
  assert.doesNotMatch(script, /select\.onclick=/);
  assert.match(script, /<option value="" selected disabled>请选择状态<\/option>/);
  assert.match(script, /select\.value=recordExists\?\(model\.status\|\|'todo'\):''/);
  assert.match(script, /recordExists=!!result\.problem/);
  assert.match(script, /☆ 收藏题目/);
  assert.match(script, /titleFavorite\.onclick=toggleFavorite/);
  assert.match(script, /function cleanPracticeText/);
  assert.doesNotMatch(script, /title=clean\(/);
  assert.match(script, /installSampleCopyButtons/);
  assert.match(script, /cf-inline-sample-copy/);
  assert.match(script, /cfInlineSampleCopyHandler/);
  assert.match(script, /target\.closest\('\.cf-inline-sample-copy'\)/);
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
  assert.match(script, /refineContestTranslation/);
  assert.match(script, /跳过本回合/);
  assert.match(script, /当前回合需要行动的玩家/);
  assert.doesNotMatch(script, /prepared\.html\.length<=4200/);
  assert.match(script, /return translateTextNodesSafely\(block\)/);
  assert.match(script, /scopeSelector='p,li,blockquote/);
  assert.match(script, /function tokenValue/);
  assert.match(script, /\[\[93/);
  assert.match(script, /function tokenMatch/);
  assert.match(script, /function tokenSignatures/);
  assert.match(script, /function tokenOccurrences/);
  assert.match(script, /［【\]\+/);
  assert.match(script, /］】\]\+/);
  assert.match(script, /validTokens/);
  assert.match(script, /actual\[actual\.length-1\]!==expected\[expected\.length-1\]/);
  assert.match(script, /expected\.slice\(0,-1\)\.sort/);
  assert.match(script, /nodesBySignature\.get\(match\.signature\)/);
  assert.match(script, /function normalizeTerminalPunctuation/);
  assert.match(script, /function normalizeFragmentPunctuation/);
  assert.match(script, /if\(retry\.length\)/);
  assert.match(script, /fragmentFallback/);
  assert.match(script, /fragmentTranslations/);
  assert.match(script, /incompleteFragments/);
  assert.match(script, /在线翻译仍包含大量未翻译的英文或俄文/);
  assert.match(script, /function translatePrepared/);
  assert.match(script, /attempt<3/);
  assert.match(script, /statementTranslationCache/);
  assert.match(script, /rememberStatementTranslation/);
  assert.match(script, /missingUnits/);
  assert.match(script, /missingFragments/);
  assert.match(script, /sourceSegments/);
  assert.match(script, /sourceValid/);
  assert.match(script, /markerIndex<0/);
  assert.match(script, /validTokens\(unit,candidate\)\?candidate:''/);
  assert.match(script, /if\(!validTokens\(unit,translated\)\)throw new Error\('译文中的公式或代码占位符不完整'\)/);
  assert.doesNotMatch(script, /if\(!match\)throw new Error\('译文中的公式或代码占位符不完整'\)/);
  assert.match(script, /translatedStatementLabel/);
  assert.doesNotMatch(script, /source\.slice\(cursor,match\.index\)/);
  assert.match(script, /translatedByIndex\.size!==prepared\.length/);
  assert.doesNotMatch(script, /少数暂未译出的段落保留英文/);
  assert.match(script, /function localVersionNotice/);
  assert.match(script, /function versionNoticeContainer/);
  assert.match(script, /querySelectorAll\('p,div,blockquote,strong,b'\)/);
  assert.match(script, /specialVersionScope/);
  assert.match(script, /replace\(\/\[\\t\\r\\n \]\+\/g/);
  assert.match(script, /starts&&\/\(\?:hack\|both versions\|all versions\)/);
  assert.doesNotMatch(script, /replace\(\/s\+\/g/);
  assert.match(script, /this\[ \]\+is\[ \]\+/);
  assert.match(script, /set of allowed values for/);
  assert.match(script, /integerRange/);
  assert.match(script, /preserveBold/);
  assert.match(script, /strong,b,.tex-font-style-bf/);
  assert.match(script, /sourceCyrillic/);
  assert.match(script, /translatedCyrillic/);
  assert.match(script, /sourceForeignWords/);
  assert.match(script, /isEligibleForeignParagraph/);
  assert.doesNotMatch(script, /if\(\/\[A-Za-z\]\{2\}\/\.test\(block\.textContent/);
  assert.match(script, /这是该题的/);
  assert.match(script, /只有解决本题的所有版本后/);
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
  assert.match(script, /__cf_inline\/submission-status/);
  assert.match(script, /X-CF-Inline':'submission-status/);
  assert.match(script, /readLatestSubmissionApi/);
  assert.match(script, /parseSubmissionRows\(String\(response\.html\|\|''\),route\)/);
  assert.match(script, /new AbortController\(\)/);
  assert.match(script, /controller\.abort\(\)/);
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
  assert.equal(
    parseDeepLTranslationResponse(JSON.stringify({ result: { texts: [{ text: '你好，世界！' }] } })),
    '你好，世界！'
  );
  assert.throws(() => parseDeepLTranslationResponse('{}'), /无法识别/);
});

test('uses DeepL first for ordinary translation and preserves protected HTML', async () => {
  resetTranslationStateForTests();
  const requests = [];
  const source = '<p><strong>Hard version.</strong> Value [[9301237039]].</p>';
  const translated = await translateHtmlItems([source], async (request) => {
    requests.push(request);
    const url = new URL(request.url);
    assert.equal(url.hostname, 'www2.deepl.com');
    const payload = JSON.parse(request.body.toString('utf8'));
    assert.equal(payload.method, 'LMT_handle_texts');
    assert.equal(payload.params.lang.target_lang, 'ZH');
    assert.equal(payload.params.texts[0].text, source);
    return {
      statusCode: 200,
      body: Buffer.from(JSON.stringify({ result: { texts: [{ text: '<p><strong>困难版本。</strong>值为 [[9301237039]]。</p>' }] } }))
    };
  });
  assert.deepEqual(translated, ['<p><strong>困难版本。</strong>值为 [[9301237039]]。</p>']);
  assert.equal(requests.length, 1);
});

test('races Bing and Google on the first request and remembers the winner', async () => {
  resetTranslationStateForTests();
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
    if (url.hostname === 'translate.googleapis.com') {
      throw new Error('Google unavailable in this test');
    }
    throw new Error(`unexpected host ${url.hostname}`);
  });

  assert.deepEqual(translated, ['<p>备用翻译成功</p>']);
  assert.ok(requests.some((request) => new URL(request.url).hostname === 'translate.googleapis.com'));
  const bingSessionRequest = requests.find((request) => new URL(request.url).pathname === '/translator');
  const bingTranslationRequest = requests.find((request) => new URL(request.url).pathname === '/ttranslatev3');
  assert.equal(bingSessionRequest.timeoutMs, 15000);
  assert.equal(bingTranslationRequest.timeoutMs, 20000);
  assert.match(bingTranslationRequest.body.toString('utf8'), /token=bing-token-value/);
});

test('re-establishes the Bing session once after a transient network timeout', async () => {
  resetTranslationStateForTests();
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
  resetTranslationStateForTests();
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
  assert.ok(hosts.includes('translate.googleapis.com'));
});
