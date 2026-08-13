const assert = require('node:assert/strict');
const test = require('node:test');
const { parseOfficialSolvedAllTime, PracticeStore, summarizeDashboard, translateCodeforcesTag } = require('../out/practice.js');

class MemoryMemento {
  constructor() { this.values = new Map(); }
  get(key) { return this.values.get(key); }
  update(key, value) { this.values.set(key, value); return Promise.resolve(); }
  keys() { return [...this.values.keys()]; }
}

test('persists problem favorite, status and notes using a stable Codeforces problem key', async () => {
  const memory = new MemoryMemento();
  const store = new PracticeStore(memory);
  await store.saveProblem({
    contestId: 4, index: 'A', name: 'Watermelon', url: '/problemset/problem/4/A',
    rating: 800, tags: ['math', 'brute force', 'math'], favorite: true,
    status: 'review', note: '注意偶数边界',
  });
  const restored = new PracticeStore(memory).getProblem(4, 'a');
  assert.equal(restored.favorite, true);
  assert.equal(restored.status, 'review');
  assert.equal(restored.note, '注意偶数边界');
  assert.deepEqual(restored.tags, ['math', 'brute force']);
  assert.equal(restored.key, '4:A');
  assert.equal(await store.deleteProblem(4, 'a'), true);
  assert.equal(store.getProblem(4, 'A'), undefined);
  assert.equal(await store.deleteProblem(4, 'A'), false);
});

test('imports submissions idempotently and summarizes AC, WA, rating and weak tags', async () => {
  const store = new PracticeStore(new MemoryMemento());
  const submissions = [
    { id: 12, creationTimeSeconds: 1700000200, verdict: 'OK', problem: { contestId: 4, index: 'A', name: 'Watermelon', rating: 800, tags: ['math'] } },
    { id: 11, creationTimeSeconds: 1700000100, verdict: 'WRONG_ANSWER', problem: { contestId: 4, index: 'A', name: 'Watermelon', rating: 800, tags: ['math'] } },
    { id: 10, creationTimeSeconds: 1700000000, verdict: 'WRONG_ANSWER', problem: { contestId: 1, index: 'B', name: 'Spreadsheet', rating: 1600, tags: ['implementation'] } },
  ];
  assert.equal(await store.importSubmissions('tester', submissions), 3);
  assert.equal(await store.importSubmissions('tester', submissions), 0);
  const data = store.snapshot(), summary = summarizeDashboard(data, 1);
  assert.equal(data.submissions.length, 3);
  assert.equal(data.lastSyncedHandle, 'tester');
  assert.equal(summary.solved, 1);
  assert.equal(summary.solvedFromDetails, 1);
  assert.equal(summary.attempted, 2);
  assert.equal(summary.wa, 2);
  assert.equal(summary.ratings.find((item) => item.label === '<1200').count, 1);
  assert.equal(summary.ratings.reduce((sum, item) => sum + item.count, 0), summary.solvedFromDetails);
  assert.equal(summary.ratings.find((item) => item.label === '未定级').count, 0);
  assert.deepEqual(summary.weakTags.map((item) => item.tag), ['数学']);
});

test('uses the official profile all-time total without inflating submission detail analytics', async () => {
  const store = new PracticeStore(new MemoryMemento());
  await store.importSubmissions('tester', [
    { id: 20, creationTimeSeconds: 1700000000, verdict: 'OK', problem: { contestId: 4, index: 'A', tags: ['math'] } },
  ], 366);
  const data = store.snapshot();
  const summary = summarizeDashboard(data, 1);
  assert.equal(data.officialSolvedAllTime, 366);
  assert.equal(summary.solved, 366);
  assert.equal(summary.solvedFromDetails, 1);
  assert.equal(summary.tags.find((item) => item.tag === '数学').solved, 1);
  assert.equal(summary.ratings.find((item) => item.label === '未定级').count, 1);
});

test('translates standard Codeforces tags while preserving unknown tags', () => {
  assert.equal(translateCodeforcesTag('greedy'), '贪心');
  assert.equal(translateCodeforcesTag('DFS and similar'), '深度优先搜索及类似算法');
  assert.equal(translateCodeforcesTag('future-tag'), 'future-tag');
});

test('parses the all-time solved count from the Codeforces profile activity frame', () => {
  const html = '<div class="_UserActivityFrame_counter"><div class="_UserActivityFrame_counterValue">1,234 problems</div><div class="_UserActivityFrame_counterDescription">solved for all time</div></div>';
  assert.equal(parseOfficialSolvedAllTime(html), 1234);
  assert.equal(parseOfficialSolvedAllTime('<div>293 problems solved for the last year</div>'), undefined);
});
