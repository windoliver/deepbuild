// #246 acceptance: a seeded property test of the secrets scan, through `node scripts/repo-rules.mjs`.
// 1,000 random texts that hold none of the patterns each get one value planted at a random line
// and column. All planted files sit in one scratch repository and their clean twins in another,
// so each side is one run of the script.
import assert from 'node:assert/strict';
import test from 'node:test';
import { KINDS, assertNotLeaked, findings, repo, rules, show } from './helpers.mjs';

const SEED = 0x246;
const CASES = 1000;

// mulberry32: a small seeded PRNG, so every run draws the same cases.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(SEED);
const int = (low, high) => low + Math.floor(random() * (high - low + 1));
const pick = (items) => items[int(0, items.length - 1)];
const draw = (alphabet, length) => Array.from({ length }, () => pick(alphabet)).join('');

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', LOWER = 'abcdefghijklmnopqrstuvwxyz', DIGITS = '0123456789';
const ALNUM = UPPER + LOWER + DIGITS;
const TEXT = `${ALNUM}      .,;:!?()[]=+*#%&@'"/_-\\~<>|^\`{}$`;
// Wider than the patterns, so text that passes holds none of them.
const NEAR = [/[\\/](?:users|home)[\\/]/i, /[a-z]:\\/i, /begin|private/i, /gh[pousr]_/i, /github_pat/i, /sk-/i, /a[ks]ia/i];
const near = (text) => NEAR.some((pattern) => pattern.test(text));

function textLine() {
  for (;;) {
    const line = draw(TEXT, int(0, 70));
    if (!near(line)) return line;
  }
}
function body(alphabet, length) {
  for (;;) {
    const text = draw(alphabet, length);
    if (!/A[KS]IA/.test(text)) return text;
  }
}
function homeName() {
  for (;;) {
    const name = draw(LOWER, int(3, 10));
    if (!['shared', 'public'].includes(name)) return name;
  }
}
const dash5 = '-'.repeat(5);
const values = {
  'home path': () => {
    const name = homeName();
    return pick([
      () => ['', 'Users', name, ''].join('/'),
      () => ['', 'home', name, ''].join('/'),
      () => ['C:', 'Users', name, ''].join('\\'),
      () => ['C:', 'Users', name, ''].join('\\\\'),
    ])();
  },
  'private key': () => pick([
    () => `${dash5}BEGIN ${pick(['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED '])}PRIVATE KEY${dash5}`,
    () => `${dash5}BEGIN PGP PRIVATE KEY BLOCK${dash5}`,
  ])(),
  'GitHub token': () => pick([
    () => `gh${pick(['p', 'o', 'u', 's', 'r'])}_${body(ALNUM, 36)}`,
    () => `github${'_pat_'}${body(ALNUM, int(22, 60))}`,
  ])(),
  'API key': () => `s${'k-'}${body(ALNUM, int(20, 50))}`,
  'AWS access key': () => `A${pick(['KIA', 'SIA'])}${body(UPPER + DIGITS, 16)}`,
};

// Each case: a clean text, and the same text with one value at a known line and column.
const cases = Array.from({ length: CASES }, (_, index) => {
  const kind = KINDS[index % KINDS.length];
  const lines = Array.from({ length: int(1, 12) }, textLine);
  const value = values[kind]();
  const row = int(0, lines.length - 1);
  const at = int(0, lines[row].length);
  const before = lines[row].slice(0, at), after = lines[row].slice(at);
  const prefix = before ? `${before} ` : '';
  const planted = [...lines];
  planted[row] = `${prefix}${value}${after ? ` ${after}` : ''}`;
  const ending = random() < 0.5 ? '\n' : '';
  return {
    path: `cases/c${String(index).padStart(4, '0')}.txt`, kind, value, line: row + 1, column: prefix.length + 1,
    clean: lines.join('\n') + ending, planted: planted.join('\n') + ending,
  };
});

test(`property (seed ${SEED}): each of ${CASES} planted values is reported at exactly its line and column, with its kind`, (t) => {
  const result = rules(repo(t, { files: Object.fromEntries(cases.map(({ path, planted }) => [path, planted])) }));
  assert.equal(result.status, 1, show(result).slice(0, 4000));
  const reported = new Map();
  for (const finding of findings(result.stdout)) {
    const path = finding.slice(0, finding.indexOf(':'));
    reported.set(path, [...(reported.get(path) ?? []), finding]);
  }
  const wrong = cases
    .filter(({ path, line, column, kind }) => JSON.stringify(reported.get(path)) !== JSON.stringify([`${path}:${line}:${column}: ${kind}`]))
    .map(({ path, line, column, kind }) => ({ expected: `${path}:${line}:${column}: ${kind}`, reported: reported.get(path) ?? [] }));
  assert.deepEqual(wrong.slice(0, 5), [], `${wrong.length} of ${CASES} cases were not reported exactly`);
  const strays = [...reported.keys()].filter((path) => !path.startsWith('cases/'));
  assert.deepEqual(strays, []);
  assertNotLeaked(result, cases.map(({ value }) => value));
});

test(`property (seed ${SEED}): the same ${CASES} texts without the planted values report nothing`, (t) => {
  const result = rules(repo(t, { files: Object.fromEntries(cases.map(({ path, clean }) => [path, clean])) }));
  assert.equal(result.status, 0, show(result).slice(0, 4000));
  assert.deepEqual(findings(result.stdout), []);
  const scanned = result.stdout.match(/^PASS secrets: (\d+) files? scanned/m);
  assert.ok(scanned, show(result).slice(0, 4000));
  assert.ok(Number(scanned[1]) >= CASES, `only ${scanned[1]} files scanned`);
});
