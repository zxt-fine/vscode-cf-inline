import { createHash } from 'crypto';
import { AiTranslationProvider } from './ai-translation';

export type AiService = 'deepseek' | 'openai' | 'ollama' | 'custom';

export interface AiSavedProfile {
  id: string;
  service: AiService;
  provider: AiTranslationProvider;
  endpoint: string;
  model: string;
  updatedAt: number;
  verifiedAt: number;
}

export const AI_PROFILES_STATE = 'cfInline.aiProfiles.v1';
export const ACTIVE_AI_PROFILE_STATE = 'cfInline.activeAiProfile.v1';
export const AI_PROFILE_SECRET_PREFIX = 'cfInline.aiProfileKey.';

export function detectAiService(
  provider: AiTranslationProvider,
  endpoint: string,
  model: string
): AiService {
  if (provider === 'ollama') return 'ollama';
  let hostname = '';
  try { hostname = new URL(endpoint).hostname.toLowerCase(); } catch { /* custom malformed endpoint */ }
  if ((hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) && /^deepseek-/i.test(model)) {
    return 'deepseek';
  }
  if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) return 'openai';
  return 'custom';
}

export function aiServiceLabel(service: AiService): string {
  return service === 'deepseek'
    ? 'DeepSeek'
    : service === 'openai'
      ? 'OpenAI'
      : service === 'ollama'
        ? '本地 Ollama'
        : '自定义 API';
}

export function createAiProfile(
  service: AiService,
  provider: AiTranslationProvider,
  endpoint: string,
  model: string,
  updatedAt = Date.now(),
  verifiedAt = updatedAt
): AiSavedProfile {
  const normalizedEndpoint = endpoint.trim().replace(/\/+$/, '');
  const normalizedModel = model.trim();
  const identity = `${provider}\n${normalizedEndpoint.toLowerCase()}\n${normalizedModel}`;
  const id = createHash('sha256').update(identity).digest('hex').slice(0, 20);
  return { id, service, provider, endpoint: normalizedEndpoint, model: normalizedModel, updatedAt, verifiedAt };
}

export function normalizeAiProfiles(value: unknown): AiSavedProfile[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, AiSavedProfile>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<AiSavedProfile>;
    if (
      !['deepseek', 'openai', 'ollama', 'custom'].includes(String(candidate.service))
      || !['openaiCompatible', 'ollama'].includes(String(candidate.provider))
      || typeof candidate.endpoint !== 'string'
      || typeof candidate.model !== 'string'
      || !candidate.endpoint.trim()
      || !candidate.model.trim()
    ) continue;
    const profile = createAiProfile(
      candidate.service as AiService,
      candidate.provider as AiTranslationProvider,
      candidate.endpoint,
      candidate.model,
      typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
      typeof candidate.verifiedAt === 'number' ? candidate.verifiedAt : 0
    );
    const previous = unique.get(profile.id);
    if (!previous || profile.updatedAt >= previous.updatedAt) unique.set(profile.id, profile);
  }
  return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
}

export function upsertAiProfile(profiles: AiSavedProfile[], profile: AiSavedProfile): AiSavedProfile[] {
  return normalizeAiProfiles([profile, ...profiles.filter((item) => item.id !== profile.id)]);
}
