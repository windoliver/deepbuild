// #1426 AC3's judge: the rebase trial's record in vendor/gpui-pre-apple/upstream/README.md. The record's words are an
// agent's, so what the tree can answer is checked against the tree: a moved pin against the manifests and the lock, a
// left pin's conflicts against a fresh `merge` of the real releases, a moved pin's suites by running them.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanEnv, clip, linesOf, README, RECORD_HEADING, RELEASES, remove, tempRoot } from './common.mjs';
import { fetchReleases, pinOf } from './tree-judge.mjs';

export const SUITES = ['#377', '#390', '#391', '#140', '#358'];
const OLD = { 'gpui-pre': '0.3.9', 'gpui-kit': '0.8.0' };
/** The newest releases when the issue was filed; a later trial may go further. */
const NEWEST = { 'gpui-pre': '0.3.11', 'gpui-kit': '0.9.0' };

const parts = (version) => version.split('.').map(Number);
const atLeast = (version, floor) => {
  const [a, b] = [parts(version), parts(floor)];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
  return true;
};

/** The trial's record in the file's text, parsed; null when it has no section. */
export function readRecord(text) {
  const lines = text.split('\n');
  const start = lines.indexOf(RECORD_HEADING);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##? /.test(line));
  const section = lines.slice(start + 1, end < 0 ? lines.length : end);
  const tried = Object.fromEntries([...(section.find((line) => line.startsWith('Tried:')) ?? '').matchAll(/(gpui-pre|gpui-kit) (\d+\.\d+\.\d+) (?:->|→) (\d+\.\d+\.\d+)/g)].map(([, name, from, to]) => [name, { from, to }]));
  const outcome = /^Outcome: (.+)$/.exec(section.find((line) => line.startsWith('Outcome:')) ?? '')?.[1]?.trim();
  const suites = Object.fromEntries(section.flatMap((line) => {
    const [, suite, result] = /^\|\s*(#\d+)\s*\|\s*(.*?)\s*\|$/.exec(line) ?? [];
    return suite ? [[suite, result]] : [];
  }));
  const conflicts = section.map((line) => line.trim()).filter((line) => line.startsWith('CONFLICT '));
  return { tried, outcome, suites, conflicts };
}

/** The pins the tree holds: `{ 'gpui-pre', 'gpui-pre-apple', 'gpui-kit' }`. */
export function pinsAt(root) {
  const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
  return {
    'gpui-pre': pinOf(root, 'gpui-pre'), 'gpui-pre-apple': pinOf(root, 'gpui-pre-apple'),
    'gpui-kit': /name = "gpui-kit"\nversion = "(.+)"/.exec(lock)?.[1],
  };
}

/** AC3, the record's words against the pins: what a record must say whichever way the trial ended. */
export function judgeRecord(text, pins) {
  const record = readRecord(text);
  if (!record) return [`${README} has no "${RECORD_HEADING}" section, so the trial has no record; the issue stays open`];
  const failures = [];
  for (const name of ['gpui-pre', 'gpui-kit']) {
    const tried = record.tried[name];
    if (!tried) failures.push(`the record's Tried line names no ${name} versions`);
    else {
      if (tried.from !== OLD[name]) failures.push(`the record tries ${name} from ${tried.from}, not the pin ${OLD[name]}`);
      if (!atLeast(tried.to, NEWEST[name])) failures.push(`the record tries ${name} ${tried.to}, older than the newest ${NEWEST[name]}`);
    }
  }
  for (const suite of SUITES) if (!record.suites[suite]) failures.push(`the record has no result for the suite ${suite}`);
  const failing = SUITES.filter((suite) => /^fail\b/.test(record.suites[suite] ?? ''));
  if (record.outcome === 'pin moved') {
    for (const suite of SUITES) if (record.suites[suite] && record.suites[suite] !== 'pass') failures.push(`the pin moved but ${suite} reads "${record.suites[suite]}", not pass`);
    if (record.conflicts.length) failures.push('the pin moved but the record lists conflicts');
    for (const [name, pin] of [['gpui-pre', pins['gpui-pre']], ['gpui-pre', pins['gpui-pre-apple']], ['gpui-kit', pins['gpui-kit']]]) {
      if (record.tried[name] && pin !== record.tried[name].to) failures.push(`the record says the pin moved to ${name} ${record.tried[name].to}, and the tree holds ${pin}`);
    }
  } else if (record.outcome === 'pin left') {
    if (!record.conflicts.length && !failing.length) failures.push('the pin stayed and the record lists no conflicting hunk and no failing suite');
    for (const suite of SUITES) if (record.suites[suite] && !/^(?:pass|fail\b.*\S|not run)/.test(record.suites[suite])) failures.push(`${suite} reads "${record.suites[suite]}", not pass, fail: ... or not run`);
    if (!record.conflicts.length) for (const suite of SUITES) if (/^not run/.test(record.suites[suite] ?? '')) failures.push(`${suite} wasn't run though no conflict stopped it`);
    if (record.tried['gpui-pre'] && pins['gpui-pre'] !== OLD['gpui-pre']) failures.push(`the record says the pin stayed, and the tree holds gpui-pre ${pins['gpui-pre']}`);
    if (record.tried['gpui-kit'] && pins['gpui-kit'] !== OLD['gpui-kit']) failures.push(`the record says the pin stayed, and the tree holds gpui-kit ${pins['gpui-kit']}`);
  } else failures.push(`the record ends with "Outcome: ${record.outcome}", neither "pin moved" nor "pin left"`);
  return failures;
}

const perFile = (lines) => {
  const counts = new Map();
  for (const line of lines) {
    const path = line.replace(/^CONFLICT /, '').replace(/:\d*$/, '');
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
};

/** "Every conflicting hunk": the record lists as many conflicts per file as a fresh merge finds. */
export function judgeConflicts(recorded, merged) {
  const [ours, theirs] = [perFile(recorded), perFile(merged)];
  const failures = [];
  for (const [path, count] of theirs) if ((ours.get(path) ?? 0) !== count) failures.push(`${path}: a fresh merge finds ${count} conflict(s), the record lists ${ours.get(path) ?? 0}`);
  for (const [path] of ours) if (!theirs.has(path)) failures.push(`${path}: the record lists a conflict a fresh merge doesn't find`);
  return failures;
}

/** Re-runs a left pin's merge on a copy of vendor/, against the real releases. */
export function judgeLeftPin(script, root, record) {
  const to = record.tried['gpui-pre']?.to;
  const { dir, inconclusive } = fetchReleases(root, [to]);
  const copy = tempRoot('rebase');
  try {
    if (inconclusive) return [inconclusive];
    cpSync(join(root, 'vendor'), join(copy, 'vendor'), { recursive: true });
    const merged = [];
    for (const crate of ['gpui-pre', 'gpui-pre-apple']) {
      const run = spawnSync(process.execPath, [script, 'merge', crate, to], { cwd: copy, encoding: 'utf8', timeout: 600_000, maxBuffer: 1 << 28, env: cleanEnv({ [RELEASES]: dir }) });
      if (run.error || ![0, 1].includes(run.status)) return [`merge ${crate} ${to} ended with exit ${run.status}: ${clip(`${run.stdout ?? ''}${run.stderr ?? ''}`)}`];
      merged.push(...linesOf(run.stdout, 'CONFLICT'));
    }
    return judgeConflicts(record.conflicts, merged);
  } finally {
    remove(copy);
    remove(dir);
  }
}

/** Runs a suite's folder: `null` on a pass, else what went wrong. */
function runSuite(root, suite) {
  const folder = `tests/acceptance/${suite.slice(1)}`;
  const files = readdirSync(join(root, folder), { recursive: true });
  const env = cleanEnv();
  const runs = [];
  if (files.some((file) => file.endsWith('.test.ts'))) runs.push(spawnSync(join(root, 'node_modules/.bin/vitest'), ['run', folder], { cwd: root, encoding: 'utf8', env, timeout: 7_200_000, maxBuffer: 1 << 28 }));
  for (const file of files.filter((name) => name.endsWith('.test.mjs') && !name.includes('.live.'))) runs.push(spawnSync(process.execPath, ['--test', join(folder, file)], { cwd: root, encoding: 'utf8', env, timeout: 7_200_000, maxBuffer: 1 << 28 }));
  const bad = runs.find((run) => run.status !== 0);
  return !runs.length ? `${suite} has no test files` : bad ? `${suite} fails: ${clip(`${bad.stdout ?? ''}${bad.stderr ?? ''}`.slice(-900))}` : null;
}

/** A moved pin's suites run here, since the record's "pass" is no evidence. */
export function judgeMovedPin(root, problem) {
  return problem ? [problem] : SUITES.map((suite) => runSuite(root, suite)).filter(Boolean);
}

/** The whole of AC3 on the tree at `root`. `problem` is what keeps the heavy suites from this machine. */
export function judgeTrial(script, root, problem) {
  if (!existsSync(join(root, README))) return [`no ${README}`];
  const text = readFileSync(join(root, README), 'utf8');
  const failures = judgeRecord(text, pinsAt(root));
  if (failures.length) return failures;
  const record = readRecord(text);
  return record.outcome === 'pin moved' ? judgeMovedPin(root, problem) : judgeLeftPin(script, root, record);
}
