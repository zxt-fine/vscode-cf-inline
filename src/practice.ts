import * as vscode from 'vscode';

export type PracticeStatus = 'todo' | 'doing' | 'review' | 'mastered';
export type LocalSubmissionStatus = 'submitting' | 'judging' | 'verdict' | 'failed' | 'unknown';

export interface LocalSubmissionHistoryRecord {
  id: string;
  contestId: number;
  index: string;
  programTypeId: string;
  language: string;
  status: LocalSubmissionStatus;
  message: string;
  previousSubmissionId?: string;
  submissionId?: string;
  verdict?: string;
  time?: string;
  memory?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProblemRecord {
  key: string;
  contestId: number;
  index: string;
  name: string;
  url: string;
  rating?: number;
  tags: string[];
  favorite: boolean;
  status: PracticeStatus;
  note: string;
  updatedAt: number;
}

export interface SubmissionRecord {
  id: number;
  contestId: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
  verdict: string;
  creationTimeSeconds: number;
}

interface PracticeData {
  problems: Record<string, ProblemRecord>;
  submissions: Record<string, SubmissionRecord>;
  lastSyncedHandle?: string;
  lastSyncedAt?: number;
  officialSolvedAllTime?: number;
  officialSolvedUpdatedAt?: number;
}

export interface DashboardData {
  problems: ProblemRecord[];
  submissions: SubmissionRecord[];
  lastSyncedHandle?: string;
  lastSyncedAt?: number;
  officialSolvedAllTime?: number;
  officialSolvedUpdatedAt?: number;
}

export interface DashboardSummary {
  solved: number;
  solvedFromDetails: number;
  attempted: number;
  wa: number;
  favorite: number;
  statusCounts: Record<PracticeStatus, number>;
  daily: Array<{ date: string; count: number }>;
  ratings: Array<{ label: string; count: number }>;
  tags: Array<{ tag: string; solved: number; attempts: number; wa: number }>;
  weakTags: Array<{ tag: string; attempts: number; wa: number; solved: number }>;
}

export const PRACTICE_STATE_KEY = 'cfInline.practiceData.v1';
export const SUBMISSION_HISTORY_STATE_KEY = 'cfInline.submissionHistory.v1';
export const PRACTICE_STATUSES = new Set<PracticeStatus>(['todo', 'doing', 'review', 'mastered']);
export const LOCAL_SUBMISSION_STATUSES = new Set<LocalSubmissionStatus>(['submitting', 'judging', 'verdict', 'failed', 'unknown']);

export const CODEFORCES_TAG_ZH: Readonly<Record<string, string>> = {
  '2-sat': '2-SAT',
  'binary search': '二分查找',
  bitmasks: '位掩码',
  'brute force': '暴力枚举',
  'chinese remainder theorem': '中国剩余定理',
  combinatorics: '组合数学',
  'constructive algorithms': '构造算法',
  'data structures': '数据结构',
  'dfs and similar': '深度优先搜索及类似算法',
  'divide and conquer': '分治',
  dp: '动态规划',
  dsu: '并查集',
  'expression parsing': '表达式解析',
  fft: '快速傅里叶变换',
  flows: '网络流',
  games: '博弈论',
  geometry: '计算几何',
  'graph matchings': '图匹配',
  graphs: '图论',
  greedy: '贪心',
  hashing: '哈希',
  implementation: '实现',
  interactive: '交互题',
  math: '数学',
  matrices: '矩阵',
  'meet-in-the-middle': '折半搜索',
  'number theory': '数论',
  probabilities: '概率',
  schedules: '调度',
  'shortest paths': '最短路',
  sortings: '排序',
  'string suffix structures': '字符串后缀结构',
  strings: '字符串',
  'ternary search': '三分查找',
  trees: '树',
  'two pointers': '双指针',
};

export function translateCodeforcesTag(tag: string): string {
  return CODEFORCES_TAG_ZH[tag.trim().toLowerCase()] ?? tag;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))];
}

function normalizeProblem(value: unknown): ProblemRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<ProblemRecord>;
  const contestId = Number(item.contestId);
  const index = typeof item.index === 'string' ? item.index.trim() : '';
  if (!Number.isInteger(contestId) || contestId <= 0 || !/^[A-Za-z0-9]+$/.test(index)) return undefined;
  const status = PRACTICE_STATUSES.has(item.status as PracticeStatus) ? item.status as PracticeStatus : 'todo';
  return {
    key: `${contestId}:${index.toUpperCase()}`,
    contestId,
    index,
    name: typeof item.name === 'string' ? item.name.trim().slice(0, 300) : '',
    url: typeof item.url === 'string' && item.url.startsWith('/') ? item.url.slice(0, 1000) : `/problemset/problem/${contestId}/${index}`,
    rating: Number.isInteger(Number(item.rating)) && Number(item.rating) > 0 ? Number(item.rating) : undefined,
    tags: cleanTags(item.tags),
    favorite: !!item.favorite,
    status,
    note: typeof item.note === 'string' ? item.note.slice(0, 10_000) : '',
    updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now(),
  };
}

function normalizeSubmission(value: unknown): SubmissionRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<SubmissionRecord>;
  const id = Number(item.id);
  const contestId = Number(item.contestId);
  const index = typeof item.index === 'string' ? item.index.trim() : '';
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(contestId) || contestId <= 0 || !index) return undefined;
  return {
    id,
    contestId,
    index,
    name: typeof item.name === 'string' ? item.name.trim().slice(0, 300) : '',
    rating: Number.isInteger(Number(item.rating)) && Number(item.rating) > 0 ? Number(item.rating) : undefined,
    tags: cleanTags(item.tags),
    verdict: typeof item.verdict === 'string' ? item.verdict.trim().toUpperCase().slice(0, 100) : '',
    creationTimeSeconds: Number.isFinite(Number(item.creationTimeSeconds)) ? Number(item.creationTimeSeconds) : 0,
  };
}

function normalizeData(value: unknown): PracticeData {
  const raw = value && typeof value === 'object' ? value as Partial<PracticeData> : {};
  const problems: Record<string, ProblemRecord> = {};
  for (const value of Object.values(raw.problems ?? {})) {
    const item = normalizeProblem(value);
    if (item) problems[item.key] = item;
  }
  const submissions: Record<string, SubmissionRecord> = {};
  for (const value of Object.values(raw.submissions ?? {})) {
    const item = normalizeSubmission(value);
    if (item) submissions[String(item.id)] = item;
  }
  return {
    problems,
    submissions,
    lastSyncedHandle: typeof raw.lastSyncedHandle === 'string' ? raw.lastSyncedHandle : undefined,
    lastSyncedAt: Number.isFinite(Number(raw.lastSyncedAt)) ? Number(raw.lastSyncedAt) : undefined,
    officialSolvedAllTime: Number.isInteger(Number(raw.officialSolvedAllTime)) && Number(raw.officialSolvedAllTime) >= 0
      ? Number(raw.officialSolvedAllTime)
      : undefined,
    officialSolvedUpdatedAt: Number.isFinite(Number(raw.officialSolvedUpdatedAt))
      ? Number(raw.officialSolvedUpdatedAt)
      : undefined,
  };
}

export class PracticeStore {
  constructor(private readonly state: vscode.Memento) {}

  snapshot(): DashboardData {
    const data = normalizeData(this.state.get<unknown>(PRACTICE_STATE_KEY));
    return {
      problems: Object.values(data.problems).sort((a, b) => b.updatedAt - a.updatedAt),
      submissions: Object.values(data.submissions).sort((a, b) => b.creationTimeSeconds - a.creationTimeSeconds),
      lastSyncedHandle: data.lastSyncedHandle,
      lastSyncedAt: data.lastSyncedAt,
      officialSolvedAllTime: data.officialSolvedAllTime,
      officialSolvedUpdatedAt: data.officialSolvedUpdatedAt,
    };
  }

  getProblem(contestId: number, index: string): ProblemRecord | undefined {
    const key = `${contestId}:${index.toUpperCase()}`;
    return this.snapshot().problems.find((item) => item.key === key);
  }

  async saveProblem(input: Partial<ProblemRecord>): Promise<ProblemRecord> {
    const contestId = Number(input.contestId);
    const index = String(input.index ?? '').trim();
    const key = `${contestId}:${index.toUpperCase()}`;
    const data = normalizeData(this.state.get<unknown>(PRACTICE_STATE_KEY));
    const existing = data.problems[key];
    const normalized = normalizeProblem({
      ...existing,
      ...input,
      key,
      tags: input.tags ?? existing?.tags ?? [],
      updatedAt: Date.now(),
    });
    if (!normalized) throw new Error('题目信息无效');
    data.problems[key] = normalized;
    await this.state.update(PRACTICE_STATE_KEY, data);
    return normalized;
  }

  async deleteProblem(contestId: number, index: string): Promise<boolean> {
    const key = `${Number(contestId)}:${String(index).trim().toUpperCase()}`;
    const data = normalizeData(this.state.get<unknown>(PRACTICE_STATE_KEY));
    if (!data.problems[key]) return false;
    delete data.problems[key];
    await this.state.update(PRACTICE_STATE_KEY, data);
    return true;
  }

  async importSubmissions(handle: string, values: unknown[], officialSolvedAllTime?: number): Promise<number> {
    const data = normalizeData(this.state.get<unknown>(PRACTICE_STATE_KEY));
    let imported = 0;
    for (const value of values) {
      const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const problem = raw.problem && typeof raw.problem === 'object' ? raw.problem as Record<string, unknown> : {};
      const normalized = normalizeSubmission({
        id: raw.id,
        contestId: problem.contestId,
        index: problem.index,
        name: problem.name,
        rating: problem.rating,
        tags: problem.tags,
        verdict: raw.verdict,
        creationTimeSeconds: raw.creationTimeSeconds,
      });
      if (!normalized) continue;
      if (!data.submissions[String(normalized.id)]) imported += 1;
      data.submissions[String(normalized.id)] = normalized;
    }
    data.lastSyncedHandle = handle;
    data.lastSyncedAt = Date.now();
    if (Number.isInteger(officialSolvedAllTime) && Number(officialSolvedAllTime) >= 0) {
      data.officialSolvedAllTime = Number(officialSolvedAllTime);
      data.officialSolvedUpdatedAt = Date.now();
    }
    await this.state.update(PRACTICE_STATE_KEY, data);
    return imported;
  }
}

export function parseOfficialSolvedAllTime(html: string): number | undefined {
  const match = String(html).match(/_UserActivityFrame_counterValue[^>]*>\s*([\d,\s]+)\s+problems?[\s\S]{0,500}?solved\s+for\s+all\s+time/i);
  return match ? Number(match[1].replace(/[^\d]/g, '')) : undefined;
}

function localDateKey(timestampSeconds: number): string {
  const value = new Date(timestampSeconds * 1000);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function summarizeDashboard(data: DashboardData, days = 14): DashboardSummary {
  const accepted = data.submissions.filter((item) => item.verdict === 'OK');
  const solvedKeys = new Set(accepted.map((item) => `${item.contestId}:${item.index.toUpperCase()}`));
  const attemptedKeys = new Set(data.submissions.map((item) => `${item.contestId}:${item.index.toUpperCase()}`));
  const wa = data.submissions.filter((item) => item.verdict === 'WRONG_ANSWER').length;
  const statusCounts: Record<PracticeStatus, number> = { todo: 0, doing: 0, review: 0, mastered: 0 };
  data.problems.forEach((item) => { statusCounts[item.status] += 1; });

  const dayMap = new Map<string, Set<string>>();
  accepted.forEach((item) => {
    const date = localDateKey(item.creationTimeSeconds);
    const set = dayMap.get(date) ?? new Set<string>();
    set.add(`${item.contestId}:${item.index.toUpperCase()}`);
    dayMap.set(date, set);
  });
  const daily: Array<{ date: string; count: number }> = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let offset = Math.max(1, days) - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = localDateKey(date.getTime() / 1000);
    daily.push({ date: key, count: dayMap.get(key)?.size ?? 0 });
  }

  const ratingRanges = [
    { label: '<1200', min: 0, max: 1199 },
    { label: '1200–1399', min: 1200, max: 1399 },
    { label: '1400–1599', min: 1400, max: 1599 },
    { label: '1600–1899', min: 1600, max: 1899 },
    { label: '1900–2199', min: 1900, max: 2199 },
    { label: '≥2200', min: 2200, max: Number.MAX_SAFE_INTEGER },
  ];
  const uniqueAccepted = new Map<string, SubmissionRecord>();
  accepted.forEach((item) => uniqueAccepted.set(`${item.contestId}:${item.index.toUpperCase()}`, item));
  const ratings = ratingRanges.map((range) => ({
    label: range.label,
    count: [...uniqueAccepted.values()].filter((item) => item.rating !== undefined && item.rating >= range.min && item.rating <= range.max).length,
  }));
  ratings.push({
    label: '未定级',
    count: [...uniqueAccepted.values()].filter((item) => item.rating === undefined).length,
  });

  const tagMap = new Map<string, { solved: Set<string>; attempts: number; wa: number }>();
  data.submissions.forEach((item) => {
    const key = `${item.contestId}:${item.index.toUpperCase()}`;
    item.tags.forEach((tag) => {
      const stats = tagMap.get(tag) ?? { solved: new Set<string>(), attempts: 0, wa: 0 };
      stats.attempts += 1;
      if (item.verdict === 'OK') stats.solved.add(key);
      if (item.verdict === 'WRONG_ANSWER') stats.wa += 1;
      tagMap.set(tag, stats);
    });
  });
  const tags = [...tagMap.entries()].map(([tag, stats]) => ({ tag: translateCodeforcesTag(tag), solved: stats.solved.size, attempts: stats.attempts, wa: stats.wa }))
    .sort((a, b) => b.solved - a.solved || b.attempts - a.attempts || a.tag.localeCompare(b.tag));
  const weakTags = tags.filter((item) => item.attempts >= 2 && item.wa > 0)
    .sort((a, b) => (b.wa / b.attempts) - (a.wa / a.attempts) || b.wa - a.wa)
    .slice(0, 8);

  return {
    solved: data.officialSolvedAllTime ?? solvedKeys.size,
    solvedFromDetails: solvedKeys.size,
    attempted: attemptedKeys.size,
    wa,
    favorite: data.problems.filter((item) => item.favorite).length,
    statusCounts,
    daily,
    ratings,
    tags: tags.slice(0, 16),
    weakTags,
  };
}

function cleanHistoryText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function normalizeLocalSubmission(value: unknown): LocalSubmissionHistoryRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<LocalSubmissionHistoryRecord>;
  const id = cleanHistoryText(item.id, 100);
  const contestId = Number(item.contestId);
  const index = cleanHistoryText(item.index, 20).toUpperCase();
  let status = LOCAL_SUBMISSION_STATUSES.has(item.status as LocalSubmissionStatus)
    ? item.status as LocalSubmissionStatus
    : 'unknown';
  let message = cleanHistoryText(item.message, 2000);
  // Versions through 0.11.34 could mistake this unrelated Codeforces UI
  // persistence warning for a submission rejection. Re-open those records for
  // official status recovery instead of permanently displaying a false error.
  if (status === 'failed' && /Failed to save collapsed state\.?/i.test(message)) {
    status = 'unknown';
    message = '提交结果待确认：已忽略与提交无关的页面折叠状态提示，正在重新查询 Codeforces 记录。';
  }
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(id) || !Number.isInteger(contestId) || contestId <= 0 || !/^[A-Z0-9]+$/.test(index)) return undefined;
  const createdAt = Number(item.createdAt);
  const updatedAt = Number(item.updatedAt);
  return {
    id,
    contestId,
    index,
    programTypeId: cleanHistoryText(item.programTypeId, 30),
    language: cleanHistoryText(item.language, 120),
    status,
    message,
    previousSubmissionId: /^\d+$/.test(String(item.previousSubmissionId ?? '')) ? String(item.previousSubmissionId) : undefined,
    submissionId: /^\d+$/.test(String(item.submissionId ?? '')) ? String(item.submissionId) : undefined,
    verdict: cleanHistoryText(item.verdict, 100) || undefined,
    time: cleanHistoryText(item.time, 100) || undefined,
    memory: cleanHistoryText(item.memory, 100) || undefined,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  };
}

export class SubmissionHistoryStore {
  private records: LocalSubmissionHistoryRecord[];
  private persistence = Promise.resolve();

  constructor(private readonly state: vscode.Memento) {
    const raw = state.get<unknown>(SUBMISSION_HISTORY_STATE_KEY);
    const values = Array.isArray(raw) ? raw : [];
    this.records = values.map(normalizeLocalSubmission).filter((item): item is LocalSubmissionHistoryRecord => !!item)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
  }

  get(id: string): LocalSubmissionHistoryRecord | undefined {
    const item = this.records.find((record) => record.id === id);
    return item ? { ...item } : undefined;
  }

  list(contestId?: number, index?: string, limit = 20): LocalSubmissionHistoryRecord[] {
    const normalizedIndex = index?.trim().toUpperCase();
    return this.records
      .filter((record) => (!contestId || record.contestId === contestId) && (!normalizedIndex || record.index === normalizedIndex))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((record) => ({ ...record }));
  }

  async create(input: Omit<LocalSubmissionHistoryRecord, 'createdAt' | 'updatedAt'>): Promise<LocalSubmissionHistoryRecord> {
    const now = Date.now();
    const record = normalizeLocalSubmission({ ...input, createdAt: now, updatedAt: now });
    if (!record) throw new Error('提交历史参数无效');
    const existing = this.records.findIndex((item) => item.id === record.id);
    if (existing >= 0) this.records.splice(existing, 1);
    this.records.unshift(record);
    this.records = this.records.slice(0, 100);
    await this.persist();
    return { ...record };
  }

  async update(id: string, patch: Partial<LocalSubmissionHistoryRecord>): Promise<LocalSubmissionHistoryRecord | undefined> {
    const index = this.records.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const next = normalizeLocalSubmission({ ...this.records[index], ...patch, id, updatedAt: Date.now() });
    if (!next) throw new Error('提交历史更新参数无效');
    this.records[index] = next;
    await this.persist();
    return { ...next };
  }

  private persist(): Promise<void> {
    const snapshot = this.records.map((record) => ({ ...record }));
    this.persistence = this.persistence.then(() => this.state.update(SUBMISSION_HISTORY_STATE_KEY, snapshot));
    return this.persistence;
  }
}
