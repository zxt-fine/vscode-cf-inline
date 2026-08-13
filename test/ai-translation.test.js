const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  buildAiChatRequestBody,
  enhanceTranslationsWithAi,
  isOllamaModelAvailable,
  normalizedEndpoint,
  parseAiTranslationResponse,
  resetAiTranslationCacheForTests,
} = require('../out/ai-translation.js');

test('disables deep thinking with provider-compatible request fields', () => {
  const messages = [{ role: 'user', content: 'translate' }];
  const deepseek = buildAiChatRequestBody({
    provider: 'openaiCompatible', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro',
  }, messages);
  assert.deepEqual(deepseek.thinking, { type: 'disabled' });

  const gpt5 = buildAiChatRequestBody({
    provider: 'openaiCompatible', endpoint: 'https://api.openai.com/v1', model: 'gpt-5',
  }, messages);
  assert.equal(gpt5.reasoning_effort, 'minimal');
  assert.equal(gpt5.temperature, undefined);

  const o3 = buildAiChatRequestBody({
    provider: 'openaiCompatible', endpoint: 'https://api.openai.com/v1', model: 'o3-mini',
  }, messages);
  assert.equal(o3.reasoning_effort, 'low');
  assert.equal(o3.temperature, undefined);

  const custom = buildAiChatRequestBody({
    provider: 'openaiCompatible', endpoint: 'https://example.com/v1', model: 'reasoning-model',
  }, messages);
  assert.equal(custom.thinking, undefined);
  assert.equal(custom.reasoning_effort, undefined);

  const ollama = buildAiChatRequestBody({
    provider: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen3:8b',
  }, messages);
  assert.equal(ollama.think, false);
});

test('recognizes an Ollama profile only when the local model is actually installed', async (t) => {
  const local = await startServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }] }));
      return;
    }
    res.writeHead(404).end();
  });
  t.after(local.close);

  assert.equal(await isOllamaModelAvailable(local.url, 'qwen2.5:7b'), true);
  assert.equal(await isOllamaModelAvailable(local.url, 'qwen3:8b'), false);
  assert.equal(await isOllamaModelAvailable('http://127.0.0.1:1', 'qwen3:8b', 100), false);
});

test('normalizes DeepSeek website and API roots to the official chat endpoint', () => {
  const base = { enabled: true, provider: 'openaiCompatible', model: 'deepseek-chat', timeoutMs: 5000 };
  assert.equal(
    normalizedEndpoint({ ...base, endpoint: 'https://www.deepseek.com/' }),
    'https://api.deepseek.com/v1/chat/completions'
  );
  assert.equal(
    normalizedEndpoint({ ...base, endpoint: 'https://deepseek.com/' }),
    'https://api.deepseek.com/v1/chat/completions'
  );
  assert.equal(
    normalizedEndpoint({ ...base, endpoint: 'https://api.deepseek.com' }),
    'https://api.deepseek.com/v1/chat/completions'
  );
  assert.equal(
    normalizedEndpoint({ ...base, endpoint: 'https://api.deepseek.com/v1' }),
    'https://api.deepseek.com/v1/chat/completions'
  );
});

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

test('reviews translations through an OpenAI-compatible model and caches the result', async (t) => {
  resetAiTranslationCacheForTests();
  let calls = 0;
  const server = await startServer(async (req, res) => {
    calls += 1;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer secret-value');
    const body = await readJson(req);
    assert.equal(body.model, 'context-reviewer');
    assert.equal(body.response_format, undefined);
    assert.match(body.messages[0].content, /pass 应译为“跳过本回合”/);
    assert.match(body.messages[1].content, /or pass/);
    const content = JSON.stringify({ items: [{ revised: '玩家可以交换 [[9307039]]，或者跳过本回合。' }] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  t.after(() => server.close());
  const options = {
    enabled: true,
    provider: 'openaiCompatible',
    endpoint: `${server.url}/v1`,
    model: 'context-reviewer',
    apiKey: 'secret-value',
    timeoutMs: 5000,
  };
  const source = 'The player may swap [[9307039]], or pass.';
  const draft = '玩家可以交换 [[9307039]]，或者通过。';
  assert.deepEqual(await enhanceTranslationsWithAi([source], [draft], options), ['玩家可以交换 [[9307039]]，或者跳过本回合。']);
  assert.deepEqual(await enhanceTranslationsWithAi([source], [draft], options), ['玩家可以交换 [[9307039]]，或者跳过本回合。']);
  assert.equal(calls, 1);
});

test('supports the local Ollama chat protocol without an API key', async (t) => {
  resetAiTranslationCacheForTests();
  const server = await startServer(async (req, res) => {
    assert.equal(req.url, '/api/chat');
    assert.equal(req.headers.authorization, undefined);
    const body = await readJson(req);
    assert.equal(body.model, 'qwen3:8b');
    assert.equal(body.stream, false);
    assert.equal(body.format, 'json');
    assert.equal(body.think, false);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { content: JSON.stringify({ items: [{ revised: '轮到 Alice 行动。' }] }) } }));
  });
  t.after(() => server.close());
  const result = await enhanceTranslationsWithAi(
    ['Alice is the player to move.'],
    ['Alice 是要移动的玩家。'],
    { enabled: true, provider: 'ollama', endpoint: server.url, model: 'qwen3:8b', timeoutMs: 5000 }
  );
  assert.deepEqual(result, ['轮到 Alice 行动。']);
});

test('rejects AI responses that damage protected placeholders or use insecure remote HTTP', async () => {
  const pair = [{ source: 'Value [[9307039]].', draft: '值为 [[9307039]]。' }];
  const damaged = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ revised: '值为 42。' }] }) } }] });
  assert.throws(
    () => parseAiTranslationResponse(damaged, pair, 'openaiCompatible'),
    /修改了.*公式或代码占位符/
  );
  await assert.rejects(
    () => enhanceTranslationsWithAi(
      ['English paragraph.'],
      ['中文初稿。'],
      { enabled: true, provider: 'openaiCompatible', endpoint: 'http://example.com/v1', model: 'model', timeoutMs: 5000 }
    ),
    /必须使用 HTTPS/
  );
});

test('falls back only the AI paragraph that damages a protected placeholder', () => {
  const pairs = [
    { source: 'First [[9307039]].', draft: '第一段 [[9307039]]。' },
    { source: 'Second [[9307139]].', draft: '第二段 [[9307139]]。' },
  ];
  const response = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [
    { revised: '正确的第一段 [[9307039]]。' },
    { revised: '损坏的第二段。' },
  ] }) } }] });
  assert.deepEqual(
    parseAiTranslationResponse(response, pairs, 'openaiCompatible', true),
    ['正确的第一段 [[9307039]]。', '第二段 [[9307139]]。']
  );
});
