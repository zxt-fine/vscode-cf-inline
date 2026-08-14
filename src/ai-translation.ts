import { request } from './net';

export type AiTranslationProvider = 'openaiCompatible' | 'ollama';

export interface AiTranslationOptions {
  enabled: boolean;
  provider: AiTranslationProvider;
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

interface TranslationPair {
  source: string;
  draft: string;
}

const reviewCache = new Map<string, string>();

export function normalizedEndpoint(options: AiTranslationOptions): string {
  const configured = options.endpoint.trim();
  const fallback = options.provider === 'ollama'
    ? 'http://127.0.0.1:11434'
    : 'https://api.openai.com/v1';
  const url = new URL(configured || fallback);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) {
    throw new Error('AI 接口必须使用 HTTPS；本机 Ollama 可以使用 localhost HTTP');
  }
  if (options.provider === 'openaiCompatible' && ['deepseek.com', 'www.deepseek.com'].includes(url.hostname.toLowerCase())) {
    // The public website is not an API endpoint. Correct this common setup
    // mistake before it can redirect a POST request to the website root.
    url.hostname = 'api.deepseek.com';
    url.pathname = '/v1';
    url.search = '';
    url.hash = '';
  } else if (options.provider === 'openaiCompatible' && url.hostname.toLowerCase() === 'api.deepseek.com' && /^\/?$/.test(url.pathname)) {
    url.pathname = '/v1';
  }
  if (options.provider === 'ollama') {
    if (!/\/api\/chat\/?$/i.test(url.pathname)) {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/chat`.replace(/\/+/g, '/');
    }
  } else if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`.replace(/\/+/g, '/');
  }
  return url.toString();
}

export async function isOllamaModelAvailable(
  endpoint: string,
  model: string,
  timeoutMs = 2_000
): Promise<boolean> {
  try {
    const url = new URL(endpoint.trim() || 'http://127.0.0.1:11434');
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return false;
    url.pathname = '/api/tags';
    url.search = '';
    url.hash = '';
    const response = await request({ url: url.toString(), timeoutMs, maxRedirects: 0 });
    if (response.statusCode < 200 || response.statusCode >= 300) return false;
    const payload = JSON.parse(response.body.toString('utf8')) as {
      models?: Array<{ name?: unknown; model?: unknown }>;
    };
    const wanted = model.trim();
    const wantedWithTag = wanted.includes(':') ? wanted : `${wanted}:latest`;
    return Array.isArray(payload.models) && payload.models.some((item) => {
      const installed = String(item?.name ?? item?.model ?? '').trim();
      return installed === wanted || installed === wantedWithTag;
    });
  } catch {
    return false;
  }
}

function systemPrompt(): string {
  return [
    '你是算法竞赛题目的专业中译审校员。',
    '不要进行或输出深度思考、推理过程、分析步骤或解释；直接快速完成校对并返回结果。',
    '请结合标题、相邻段落和完整算法语境，根据英文原文重新组织自然、准确、流畅的简体中文；初稿只供参考，不要拘泥于初稿语序，遇到生硬直译时应重写整句或整段。',
    '数学公式和变量占位符都是句内成分，不要在其前后强行断句；可在不改变语义的前提下调整正文占位符的位置以符合中文语序。段落末尾的最后一个占位符是结束标记，必须仍是最后一个占位符。',
    '使用算法竞赛常用表述，例如“长度为 n 的字符串 s”“对于每个 1≤i<n”“方案数对 998244353 取模”，避免“一个字符串表示 s，长度为 n”一类英文式语序。',
    '例如回合制游戏中的 pass 应译为“跳过本回合”，player to move 应译为“当前回合行动的玩家”；但 passes all tests 仍是“通过所有测试”。',
    '不得修改、删除、增加或重复形如 [[数字]] 的公式/代码占位符，不得翻译变量名、代码或专有名称。',
    '只返回 JSON 对象；items 数组长度及顺序必须与输入一致，每项只包含 revised 字符串：{"items":[{"revised":"..."}]}。',
  ].join('\n');
}

interface AiChatMessage {
  role: 'system' | 'user';
  content: string;
}

export function buildAiChatRequestBody(
  options: Pick<AiTranslationOptions, 'provider' | 'endpoint' | 'model'>,
  messages: AiChatMessage[]
): Record<string, unknown> {
  const model = options.model.trim();
  if (options.provider === 'ollama') {
    return {
      model,
      stream: false,
      format: 'json',
      think: false,
      options: { temperature: 0.1 },
      messages,
    };
  }

  const body: Record<string, unknown> = { model, temperature: 0.1, messages };
  let hostname = '';
  try { hostname = new URL(options.endpoint).hostname.toLowerCase(); } catch { /* validated elsewhere */ }
  if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
    body.thinking = { type: 'disabled' };
  } else if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
    if (/^gpt-5(?:[.-]|$)/i.test(model)) {
      delete body.temperature;
      body.reasoning_effort = 'minimal';
    } else if (/^(?:o1|o3|o4)(?:[.-]|$)/i.test(model)) {
      delete body.temperature;
      body.reasoning_effort = 'low';
    }
  }
  return body;
}

function userPrompt(pairs: TranslationPair[]): string {
  return JSON.stringify({
    instruction: '这些段落按题面顺序相邻。逐段返回通顺完整的中文，保持段落数量和对应关系。',
    paragraphs: pairs.map((pair, index) => ({
      index,
      english: pair.source,
      chineseDraft: pair.draft,
    })),
  });
}

function parseJsonPayload(text: string): unknown {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error('AI 没有返回可识别的 JSON 译文');
  }
}

function placeholderSignature(value: string): string[] {
  return [...String(value).matchAll(/[\[［【]+\s*(\d[\d\s]*)\s*[\]］】]+/g)].map((match) => match[1].replace(/\s/g, ''));
}

export function parseAiTranslationResponse(
  raw: string,
  pairs: TranslationPair[],
  provider: AiTranslationProvider,
  fallbackInvalidSegments = false
): string[] {
  const payload = JSON.parse(raw) as Record<string, unknown>;
  const content = provider === 'ollama'
    ? (payload.message as { content?: unknown } | undefined)?.content
    : ((payload.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0]?.message?.content);
  if (typeof content !== 'string') throw new Error('AI 接口没有返回消息内容');
  const parsed = parseJsonPayload(content);
  const reviewed = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' ? (parsed as { items?: unknown }).items : undefined;
  if (!Array.isArray(reviewed) || reviewed.length !== pairs.length) {
    throw new Error('AI 返回的段落数量与题面不一致');
  }
  return reviewed.map((item, index) => {
    const revised = item && typeof item === 'object' ? (item as { revised?: unknown }).revised : undefined;
    if (typeof revised !== 'string' || !revised.trim()) {
      if (fallbackInvalidSegments) return pairs[index].draft;
      throw new Error(`AI 返回的第 ${index + 1} 段为空`);
    }
    const expected = placeholderSignature(pairs[index].source);
    const actual = placeholderSignature(revised);
    const expectedSorted = [...expected].sort();
    const actualSorted = [...actual].sort();
    const movedEndMarker = expected.length > 1 && actual[actual.length - 1] !== expected[expected.length - 1];
    if (expected.length !== actual.length || movedEndMarker || expectedSorted.some((token, tokenIndex) => actualSorted[tokenIndex] !== token)) {
      if (fallbackInvalidSegments) return pairs[index].draft;
      throw new Error(`AI 修改了第 ${index + 1} 段中的公式或代码占位符`);
    }
    return revised;
  });
}

export async function enhanceTranslationsWithAi(
  sources: string[],
  drafts: string[],
  options: AiTranslationOptions
): Promise<string[]> {
  if (!options.enabled) return drafts;
  if (!options.model.trim()) throw new Error('请先设置 AI 模型名称');
  if (sources.length !== drafts.length) throw new Error('AI 审校输入段落数量不一致');
  const endpoint = normalizedEndpoint(options);
  const pairs = sources.map((source, index) => ({ source, draft: drafts[index] }));
  const providerIdentity = `${options.provider}\n${endpoint}\n${options.model}`;
  const output = new Array<string>(pairs.length);
  const missing: TranslationPair[] = [];
  const missingIndexes: number[] = [];
  pairs.forEach((pair, index) => {
    const key = `${providerIdentity}\n${pair.source}\n${pair.draft}`;
    const cached = reviewCache.get(key);
    if (cached !== undefined) output[index] = cached;
    else { missing.push(pair); missingIndexes.push(index); }
  });
  if (!missing.length) return output;

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (options.provider === 'openaiCompatible' && options.apiKey?.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`;
  }
  let offset = 0;
  while (offset < missing.length) {
    let end = offset;
    let characters = 0;
    while (end < missing.length && end - offset < 8) {
      const nextCharacters = missing[end].source.length + missing[end].draft.length;
      if (end > offset && characters + nextCharacters > 16_000) break;
      characters += nextCharacters;
      end += 1;
    }
    const batch = missing.slice(offset, end);
    const batchMessages: AiChatMessage[] = [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userPrompt(batch) },
    ];
    const batchBody = buildAiChatRequestBody(options, batchMessages);
    const response = await request({
      url: endpoint,
      method: 'POST',
      headers,
      body: Buffer.from(JSON.stringify(batchBody), 'utf8'),
      timeoutMs: Math.max(5_000, options.timeoutMs),
      maxRedirects: 2,
    });
    const requestedUrl = new URL(endpoint);
    const finalUrl = new URL(response.finalUrl);
    if (
      options.provider === 'openaiCompatible'
      && /\/chat\/completions\/?$/i.test(requestedUrl.pathname)
      && !/\/chat\/completions\/?$/i.test(finalUrl.pathname)
    ) {
      throw new Error('AI 接口地址被重定向到了非 API 页面。请填写服务商的 API 地址，而不是官网首页；DeepSeek 请使用 https://api.deepseek.com/v1');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const detail = response.body.toString('utf8').replace(/\s+/g, ' ').slice(0, 500);
      if (response.statusCode === 405 && /MethodNotAllowed|Method Not Allowed/i.test(detail)) {
        throw new Error('AI 接口不接受 Chat Completions 请求，请检查接口地址和模型 ID。DeepSeek 请使用 https://api.deepseek.com/v1');
      }
      throw new Error(`AI 接口返回 HTTP ${response.statusCode}${detail ? `：${detail}` : ''}`);
    }
    // An AI may occasionally omit or damage one formula token. Keep every
    // valid reviewed paragraph and fall back only the damaged paragraph to
    // its already valid ordinary translation. One bad formula must not turn
    // off AI enhancement for the entire statement.
    const reviewed = parseAiTranslationResponse(response.body.toString('utf8'), batch, options.provider, true);
    reviewed.forEach((value, batchIndex) => {
      const resultIndex = offset + batchIndex;
      const originalIndex = missingIndexes[resultIndex];
      output[originalIndex] = value;
      const pair = pairs[originalIndex];
      const key = `${providerIdentity}\n${pair.source}\n${pair.draft}`;
      if (reviewCache.size >= 1_000) reviewCache.delete(reviewCache.keys().next().value as string);
      reviewCache.set(key, value);
    });
    offset = end;
  }
  return output;
}

export function resetAiTranslationCacheForTests(): void {
  reviewCache.clear();
}
