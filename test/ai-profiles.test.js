const assert = require('node:assert/strict');
const test = require('node:test');

const {
  aiServiceLabel,
  createAiProfile,
  detectAiService,
  normalizeAiProfiles,
  upsertAiProfile,
} = require('../out/ai-profiles.js');

test('detects provider presets and creates stable non-secret profile identities', () => {
  assert.equal(detectAiService('openaiCompatible', 'https://api.deepseek.com/v1', 'deepseek-chat'), 'deepseek');
  assert.equal(detectAiService('openaiCompatible', 'https://api.openai.com/v1', 'gpt-4.1-mini'), 'openai');
  assert.equal(detectAiService('ollama', 'http://127.0.0.1:11434', 'qwen3:8b'), 'ollama');
  assert.equal(detectAiService('openaiCompatible', 'https://example.com/v1', 'model'), 'custom');
  assert.equal(aiServiceLabel('deepseek'), 'DeepSeek');
  const first = createAiProfile('deepseek', 'openaiCompatible', 'https://api.deepseek.com/v1/', 'deepseek-chat', 1);
  const second = createAiProfile('deepseek', 'openaiCompatible', 'https://api.deepseek.com/v1', 'deepseek-chat', 2);
  assert.equal(first.id, second.id);
  assert.ok(first.verifiedAt > 0);
  assert.doesNotMatch(JSON.stringify(first), /api.?key|secret/i);
});

test('normalizes, deduplicates and orders saved AI profiles', () => {
  const oldProfile = createAiProfile('deepseek', 'openaiCompatible', 'https://api.deepseek.com/v1', 'deepseek-chat', 1);
  const newestProfile = createAiProfile('deepseek', 'openaiCompatible', 'https://api.deepseek.com/v1', 'deepseek-chat', 3);
  const other = createAiProfile('ollama', 'ollama', 'http://127.0.0.1:11434', 'qwen3:8b', 2);
  assert.deepEqual(normalizeAiProfiles([oldProfile, {}, newestProfile, other]), [newestProfile, other]);
  assert.deepEqual(upsertAiProfile([newestProfile, other], { ...other, updatedAt: 4 }), [{ ...other, updatedAt: 4 }, newestProfile]);
  const legacy = { ...other };
  delete legacy.verifiedAt;
  assert.equal(normalizeAiProfiles([legacy])[0].verifiedAt, 0);
});
