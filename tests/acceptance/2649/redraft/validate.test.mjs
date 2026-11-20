// The AC1 recomputation must pass a well-formed synthetic spike and fail each planted fault, or the AC1 test proves nothing.
// Run: node --test tests/acceptance/2649/redraft/validate.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadRecord, parseCounter, SPIKE, tableProblems } from './validate.mjs';
import { sha256 } from '../validate.mjs';

const Q = '0 0 0 0 0 0 0';
const H = 'a'.repeat(40);
const HOUR_TICKS = 90_000_000_000; // an hour and more at the 125/3 timebase
// Root 1 runs sandbox-exec, which runs helper (reaped) and daemon (nothing waits: its own exit line); root runs ps (unread).
const checkLog = [
  'start 1 2 /usr/bin/sandbox-exec', 'start 2 3 /opt/h/helper', `exit 3 70 0 ${Q}`, `reap 2 3 70 4 0 ${Q}`,
  'start 2 5 /opt/h/daemon', `exit 5 9 0 ${Q}`,
  `exit 2 100 4 ${Q}`, `reap 1 2 100 10 4 ${Q}`, 'start 1 4 /bin/ps', 'unread 1 4 3',
  `reap 0 1 500 100 17 ${Q}`, '',
].join('\n');
// pid 11 is reused: two helpers, 30 then 40 instructions. The root ran an hour and more.
const idleLog = [
  'start 9 10 /bin/ps', 'unread 9 10 2', 'start 9 11 /opt/h/helper', `reap 9 11 30 5 0 ${Q}`,
  'start 9 11 /opt/h/helper', `reap 9 11 40 6 0 ${Q}`, `reap 0 9 500 ${HOUR_TICKS} 13 ${Q}`, '',
].join('\n');
const readmeOf = (rows) => ['| subject | caller | program | count | instructions |', '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.subject} | ${r.caller === '<root>' ? '`<root>`' : r.caller} | ${r.program} | ${r.count} | ${(r.instructions ?? 0).toLocaleString('en-US')} |`)].join('\n');
const good = () => {
  const rows = [
    { subject: 'command-check', caller: '<root>', program: 'sandbox-exec', count: 1, instructions: 100, unread: 0 },
    { subject: 'command-check', caller: '<root>', program: 'ps', count: 1, instructions: 0, unread: 1 },
    { subject: 'command-check', caller: 'sandbox-exec', program: 'helper', count: 1, instructions: 70, unread: 0 },
    { subject: 'command-check', caller: 'sandbox-exec', program: 'daemon', count: 1, instructions: 9, unread: 0 },
    { subject: 'idle-hour', caller: '<root>', program: 'ps', count: 1, instructions: 0, unread: 1 },
    { subject: 'idle-hour', caller: '<root>', program: 'helper', count: 2, instructions: 70, unread: 0 },
  ];
  return {
    main: H, counter: { command: 'node scripts/benchmark.mjs', timebase: { numer: 125, denom: 3 } },
    subjects: {
      'command-check': { log: 'evidence/command-check.log', sha256: sha256(checkLog), totalStarts: 4 },
      'idle-hour': { log: 'evidence/idle-hour.log', sha256: sha256(idleLog), totalStarts: 3 },
    },
    rows,
  };
};
// mutate(record, files); a file set to null is not written; a mutated log gets its sha256 fixed unless keepSha.
function check(mutate = () => {}, keepSha = false) {
  const dir = mkdtempSync(join(tmpdir(), 'r2649-'));
  try {
    mkdirSync(join(dir, SPIKE, 'evidence'), { recursive: true });
    const record = good();
    const files = { 'evidence/command-check.log': checkLog, 'evidence/idle-hour.log': idleLog, 'README.md': null };
    mutate(record, files);
    files['README.md'] ??= readmeOf(record.rows);
    if (!keepSha) for (const [s, f] of [['command-check', 'evidence/command-check.log'], ['idle-hour', 'evidence/idle-hour.log']]) if (files[f] !== null && record.subjects[s]) record.subjects[s].sha256 = sha256(files[f]);
    for (const [name, text] of Object.entries(files)) if (text !== null) writeFileSync(join(dir, SPIKE, name), text);
    writeFileSync(join(dir, SPIKE, 'record.json'), JSON.stringify(record));
    return tableProblems(loadRecord(dir).record, dir);
  } finally { rmSync(dir, { recursive: true }); }
}

test('a well-formed spike passes', () => assert.deepEqual(check(), []));
test('a missing record fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'r2649-'));
  try { assert.notDeepEqual(loadRecord(dir).problems, []); } finally { rmSync(dir, { recursive: true }); }
});
test('the parse follows a reused pid and each kind of end', () => {
  const idle = parseCounter(idleLog);
  assert.deepEqual(idle.starts.map((s) => [s.program, s.instructions]), [['ps', null], ['helper', 30], ['helper', 40]]);
  assert.deepEqual(idle.uncounted, []);
  const c = parseCounter(checkLog);
  assert.deepEqual(c.starts.map((s) => [s.caller, s.program, s.instructions]), [['<root>', 'sandbox-exec', 100], ['sandbox-exec', 'helper', 70], ['sandbox-exec', 'daemon', 9], ['<root>', 'ps', null]]);
});

const mutants = {
  'a missing counter output': (r, f) => { f['evidence/command-check.log'] = null; },
  'a counter output changed after the record pinned it': (r, f) => { f['evidence/command-check.log'] += 'start 1 99 /bin/ps\nunread 1 99 0\n'; },
  'a count the log does not bear': (r) => { r.rows[2].count = 2; },
  'instructions the log does not sum to': (r) => { r.rows[0].instructions = 101; },
  'instructions of a reused pid taken from the last reap only': (r) => { r.rows[5].instructions = 80; },
  'a start counted as read that has no count': (r) => { r.rows[1].unread = 0; },
  'an unread start counted as 0 instructions with no unread': (r) => { r.rows[4].unread = 0; },
  'an exit-only child dropped from the table': (r) => { r.rows.splice(3, 1); },
  'a start no row lists': (r) => { r.rows.pop(); },
  'a row for starts the log does not hold': (r) => { r.rows.push({ subject: 'idle-hour', caller: '<root>', program: 'sh', count: 1, instructions: 5, unread: 0 }); },
  'a start under the wrong caller': (r) => { r.rows[2].caller = '<root>'; },
  'a row listed twice': (r) => { r.rows.push({ ...r.rows[0] }); },
  'a row with no count': (r) => { delete r.rows[0].count; },
  'a row with no instructions': (r) => { delete r.rows[0].instructions; },
  'totalStarts the log does not bear': (r) => { r.subjects['idle-hour'].totalStarts = 2; },
  'a subject missing': (r) => { delete r.subjects['idle-hour']; },
  'no counter command': (r) => { r.counter.command = ' '; },
  'main not a full hash': (r) => { r.main = 'main'; },
  'an idle run under an hour': (r, f) => { f['evidence/idle-hour.log'] = idleLog.replace(String(HOUR_TICKS), String(HOUR_TICKS / 2)); },
  'an unknown timebase that would make a short run an hour': (r) => { r.counter.timebase = { numer: 1000, denom: 1 }; },
  'a start of a parent the log never shows': (r, f) => { f['evidence/command-check.log'] = checkLog.replace('start 1 4 /bin/ps', 'start 77 4 /bin/ps'); },
  'a line the counter does not write': (r, f) => { f['evidence/command-check.log'] += 'started 1 4 /bin/ps\n'; },
  'a reap line cut short': (r, f) => { f['evidence/command-check.log'] = checkLog.replace(`reap 2 3 70 4 0 ${Q}`, 'reap 2 3 70'); },
  'a start the counter never ended or saw end (still running)': (r, f) => { f['evidence/command-check.log'] += 'start 2 6 /opt/h/late\n'; r.rows.push({ subject: 'command-check', caller: 'sandbox-exec', program: 'late', count: 1, instructions: 0, unread: 1 }); r.subjects['command-check'].totalStarts = 5; },
  'a start the library never saw (a parent spent child time the log does not account for)': (r, f) => { f['evidence/command-check.log'] = checkLog.replace(`reap 0 1 500 100 17 ${Q}`, `reap 0 1 500 100 40 ${Q}`); },
  'no README': (r, f) => { f['README.md'] = null; r.__noreadme = true; },
  'a README table missing a program': (r, f) => { f['README.md'] = readmeOf(r.rows.filter((x) => x.program !== 'daemon')); },
  'a README table with other instructions': (r, f) => { f['README.md'] = readmeOf(r.rows).replace('| 100 |', '| 99 |'); },
  'a README table with other counts': (r, f) => { f['README.md'] = readmeOf(r.rows).replace('| helper | 2 |', '| helper | 3 |'); },
  'a README that names them but is not a table': (r, f) => { f['README.md'] = 'sandbox-exec ps helper daemon <root> 100 70 9 1 2'; },
};
for (const [name, mutate] of Object.entries(mutants)) {
  test(`${name} fails`, () => {
    if (name === 'no README') {
      const dir = mkdtempSync(join(tmpdir(), 'r2649-'));
      try {
        mkdirSync(join(dir, SPIKE, 'evidence'), { recursive: true });
        writeFileSync(join(dir, SPIKE, 'evidence/command-check.log'), checkLog);
        writeFileSync(join(dir, SPIKE, 'evidence/idle-hour.log'), idleLog);
        writeFileSync(join(dir, SPIKE, 'record.json'), JSON.stringify(good()));
        assert.ok(tableProblems(loadRecord(dir).record, dir).some((p) => /README\.md/.test(p)));
      } finally { rmSync(dir, { recursive: true }); }
      return;
    }
    const problems = check(mutate, false);
    assert.notDeepEqual(problems, []);
  });
}
test('the changed counter output fails on the sha alone when the record is not re-pinned', () => {
  const problems = check((r, f) => { f['evidence/command-check.log'] += '\n'; }, true);
  assert.ok(problems.some((p) => /sha256/.test(p)), problems.join('\n'));
});
test('a README number written with separators or in backticks still reads', () => {
  assert.deepEqual(check((r, f) => { f['README.md'] = readmeOf(r.rows).replace('| 100 |', '| `100` |'); }), []);
});
