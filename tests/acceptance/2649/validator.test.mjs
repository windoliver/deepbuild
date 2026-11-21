// The validator must pass a well-formed spike and fail each planted fault (a mutant per rule), or the
// acceptance tests prove nothing. Uses a synthetic spike in a temp folder.
// Run: node --test tests/acceptance/2649/validator.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cutProblems, latencyProblems, loadRecord, percentile, recommendationProblems, sha256, SPIKE, tableProblems, TASKS } from './validate.mjs';

const H = 'a'.repeat(40), B = 'b'.repeat(40);
const checkLog = ['start 1 2 /usr/bin/sandbox-exec', 'start 1 3 /bin/ps', 'start 2 4 /opt/h/helper', 'reap 1 2 100 5 0 0 0 0 0 0 0 0', 'reap 1 3 40 5 0 0 0 0 0 0 0 0', 'unread 2 4 7', ''].join('\n');
const idleLog = ['start 9 10 /bin/ps', 'start 9 11 /opt/h/helper', 'reap 9 10 30 1 0 0 0 0 0 0 0 0', 'reap 9 11 70 1 0 0 0 0 0 0 0 0', ''].join('\n');
const samples = [3, 1, 2, 5, 4, 9, 8, 7, 6, 10].map((d, i) => JSON.stringify({ pid: i, forkedAtMs: 100 * i, trackedAtMs: 100 * i + d })).join('\n') + '\n';
const rounds = () => Array.from({ length: 15 }, (_, i) => ({ base: 100 + i, change: 90 + i, first: i % 2 ? 'change' : 'base' }));
const good = () => ({
  main: H, counter: { command: 'node scripts/benchmark.mjs' },
  subjects: {
    'command-check': { log: 'evidence/command-check.log', sha256: sha256(checkLog), totalStarts: 3 },
    'idle-hour': { log: 'evidence/idle-hour.log', sha256: sha256(idleLog), totalStarts: 2, durationSeconds: 3600 },
  },
  rows: [
    { subject: 'command-check', caller: '<root>', program: 'sandbox-exec', count: 1, instructions: 100, unread: 0, use: 'wraps', verdict: 'needed' },
    { subject: 'command-check', caller: '<root>', program: 'ps', count: 1, instructions: 40, unread: 0, use: 'liveness', verdict: 'repeated', heldBy: 'the earlier scan' },
    { subject: 'command-check', caller: 'sandbox-exec', program: 'helper', count: 1, instructions: 0, unread: 1, use: 'x', verdict: 'replaceable', replacement: 'kept answer', change: 'one start fewer' },
    { subject: 'idle-hour', caller: '<root>', program: 'ps', count: 1, instructions: 30, unread: 0, use: 'scan', verdict: 'needed' },
    { subject: 'idle-hour', caller: '<root>', program: 'helper', count: 1, instructions: 70, unread: 0, use: 'scan', verdict: 'needed' },
  ],
  cuts: [{ id: 'c1', description: 'd', mergeBase: B, change: H, measurements: Object.fromEntries(TASKS.map((t) => [t, { command: `bench ${t}`, rounds: rounds() }])) }],
  latency: { main: H, command: 'measure', unit: 'ms', samplesFile: 'evidence/latency.jsonl', samplesSha256: sha256(samples), samples: 10, p50: 5, p95: 10 },
  recommendation: { cuts: [{ cut: 'c1', criterion: '- [ ] x' }] },
});
function spike(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'v2649-'));
  mkdirSync(join(dir, SPIKE, 'evidence'), { recursive: true });
  const record = good();
  const files = { 'evidence/command-check.log': checkLog, 'evidence/idle-hour.log': idleLog, 'evidence/latency.jsonl': samples, 'README.md': 'sandbox-exec ps helper <root>' };
  mutate(record, files);
  for (const [name, text] of Object.entries(files)) if (text !== null) writeFileSync(join(dir, SPIKE, name), text);
  writeFileSync(join(dir, SPIKE, 'record.json'), JSON.stringify(record));
  return { dir, record };
}
const run = (check, mutate) => { const { dir, record } = spike(mutate); try { return check(record, dir); } finally { rmSync(dir, { recursive: true }); } };
const table = (m) => run(tableProblems, m), cuts = (m) => run(cutProblems, m), lat = (m) => run(latencyProblems, m), rec = (m) => run(recommendationProblems, m);

test('a well-formed spike passes every check', () => {
  for (const check of [tableProblems, cutProblems, latencyProblems, recommendationProblems]) assert.deepEqual(run(check), []);
});
test('a missing record fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2649-'));
  try { assert.notDeepEqual(loadRecord(dir).problems, []); } finally { rmSync(dir, { recursive: true }); }
});
test('nearest-rank percentile', () => { assert.equal(percentile([1, 2, 3, 4], 0.5), 2); assert.equal(percentile([1, 2, 3, 4], 0.95), 4); });

const tableMutants = {
  'a missing counter output': (r, f) => { f['evidence/command-check.log'] = null; },
  'a changed counter output': (r, f) => { f['evidence/command-check.log'] += 'start 1 99 /bin/ps\n'; },
  'a count the log does not bear': (r) => { r.rows[1].count = 2; },
  'instructions the log does not sum to': (r) => { r.rows[0].instructions = 101; },
  'a start no row lists': (r) => { r.rows.pop(); },
  'a row with no count': (r) => { delete r.rows[0].count; },
  'a row with no verdict': (r) => { delete r.rows[0].verdict; },
  'a repeated row not saying what holds it': (r) => { delete r.rows[1].heldBy; },
  'a replaceable row with no replacement': (r) => { delete r.rows[2].replacement; },
  'a replaceable row with no visible change': (r) => { r.rows[2].change = ' '; },
  'an idle run under an hour': (r) => { r.subjects['idle-hour'].durationSeconds = 3599; },
  'no human-readable table': (r, f) => { f['README.md'] = null; },
  'a table not naming a program': (r, f) => { f['README.md'] = '<root> ps'; },
  'a row with no use': (r) => { delete r.rows[3].use; },
};
for (const [name, mutate] of Object.entries(tableMutants)) test(`table: ${name} fails`, () => assert.notDeepEqual(table(mutate), []));

const cutMutants = {
  'a task not measured': (r) => { delete r.cuts[0].measurements['runner-job']; },
  '14 rounds': (r) => { r.cuts[0].measurements['sandbox-setup'].rounds.pop(); },
  'sides not alternated': (r) => { r.cuts[0].measurements['sandbox-setup'].rounds[1].first = 'base'; },
  'a round with no reading': (r) => { r.cuts[0].measurements['command-check-count'].rounds[4].change = null; },
  'no command': (r) => { r.cuts[0].measurements['runner-job'].command = ''; },
  'no merge base': (r) => { r.cuts[0].mergeBase = 'main'; },
};
for (const [name, mutate] of Object.entries(cutMutants)) test(`cuts: ${name} fails`, () => assert.notDeepEqual(cuts(mutate), []));

const latencyMutants = {
  'a missing samples file': (r, f) => { f['evidence/latency.jsonl'] = null; },
  'a p50 the samples do not give': (r) => { r.latency.p50 = 4; },
  'a p95 the samples do not give': (r) => { r.latency.p95 = 9; },
  'a changed samples file': (r, f) => { f['evidence/latency.jsonl'] += '{"pid":99,"forkedAtMs":0,"trackedAtMs":50}\n'; },
  'no command': (r) => { delete r.latency.command; },
};
for (const [name, mutate] of Object.entries(latencyMutants)) test(`latency: ${name} fails`, () => assert.notDeepEqual(lat(mutate), []));

const recMutants = {
  'no recommendation': (r) => { delete r.recommendation; },
  'a cut with no criterion': (r) => { r.recommendation.cuts[0].criterion = ''; },
  'none without a reason': (r) => { r.recommendation = { none: true }; },
  'cuts and none together': (r) => { r.recommendation.none = true; r.recommendation.reason = 'x'; },
};
for (const [name, mutate] of Object.entries(recMutants)) test(`recommendation: ${name} fails`, () => assert.notDeepEqual(rec(mutate), []));
test('recommendation: none with a reason passes', () => assert.deepEqual(rec((r) => { r.recommendation = { none: true, reason: 'no cut pays' }; }), []));
test('cuts: an empty list of cuts tried passes (none was tried)', () => assert.deepEqual(cuts((r) => { r.cuts = []; }), []));
