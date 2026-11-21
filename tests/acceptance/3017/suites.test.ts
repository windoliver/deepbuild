// #3017.d0ed4366 (AC9): "Every acceptance suite that reads a 3D snapshot's table today, `tests/acceptance/427/`, `1729/`
// and `2293/` among them, passes with no edit, or changes only by a blind redraft the PR lists. Render-back's line in the
// design says what a row holds, and the design links and names lane passes"
//
// Two tests, since the criterion holds two things on two kinds of machine (README: Criteria to tests).
// 1. The suites, reused as they are, never copied: the files of 427/, 1729/ and 2293/ that read a 3D render-back's
//    `visible` table (FILES below). "No edit": nothing under those three folders differs from the merge base of this
//    checkout's HEAD with main (`origin/main`, else `main`), working tree included, so the change being judged edits
//    none of them. "Or changes only by a blind redraft the PR lists": a file `scripts/lanes.mjs`'s `redrafted` maps to
//    a blind redraft runs as that redraft folder in its place (the listing is the lane's own). Then the files (or their
//    redrafts) run through vitest in a child process, with the toolchain on PATH and no VITEST* variables, and its
//    JSON report is read: every test in them passed; skipped or missing reads as a failure, and where every test that
//    didn't pass failed INCONCLUSIVE, this reads INCONCLUSIVE. Off macOS they can't draw: INCONCLUSIVE.
// 2. The design: docs/canvas-primitives.md's Render-back section has a sentence on the table that names what a row
//    holds, `px` and `at` among them in code; and `node scripts/design-links.mjs` (the "design links and names" lane in
//    scripts/lanes.mjs) exits 0. Its INCONCLUSIVE (the open issues unread) reads INCONCLUSIVE here.
// Wrong programs: a change that edits one of those suites to pass; one that breaks a suite reading the table (rows
// renamed, `box` changed, 2D rows changed); a design whose Render-back line still says only "IDs with screen boxes"; a
// design link that lands nowhere.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, inconclusive, proof, requireMetal } from './helpers.ts';

/** The criterion's ID: `#3017.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const AC9 = '#3017.d0ed4366';
/** The suites the criterion names, and their files that read a 3D render-back's `visible` table at the base. */
const FOLDERS = ['tests/acceptance/427', 'tests/acceptance/1729', 'tests/acceptance/2293'];
const FILES = [
  'tests/acceptance/427/live-redraft.test.ts',
  'tests/acceptance/1729/models.test.ts', 'tests/acceptance/1729/maps.test.ts', 'tests/acceptance/1729/sequence.test.ts',
  'tests/acceptance/2293/ac1-frame-box.test.ts',
];

const git = (args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
/** The merge base of HEAD with main: the commit the change being judged starts from. */
function mergeBase(): string {
  for (const main of ['origin/main', 'main']) {
    const r = git(['merge-base', 'HEAD', main]);
    if (r.status === 0 && /^[0-9a-f]{40}$/.test(r.stdout.trim())) return r.stdout.trim();
  }
  return expect.fail('BLOCKED: no merge base of HEAD with origin/main or main in this checkout, so "no edit" can\'t be read');
}

type Assertion = { title: string; status: string; failureMessages: string[] };
/** Runs `targets` through vitest in a child process: each file's assertions, by its path, and the run's exit. */
function vitest(targets: string[]): { byFile: Map<string, Assertion[]>; status: number | null; stderr: string } {
  const bin = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');
  expect(existsSync(bin), 'vitest is installed (npm ci)').toBe(true);
  const dir = mkdtempSync(join(tmpdir(), 'deep-3017-suites-'));
  try {
    const report = join(dir, 'report.json');
    const clean: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_ENV' && k !== 'TEST'));
    const toolchain = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
    const env = {
      ...clean, PATH: `${toolchain}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${clean['PATH'] ?? ''}`,
      CARGO_INCREMENTAL: clean['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: clean['CARGO_PROFILE_DEV_DEBUG'] ?? '0', NO_COLOR: '1',
    };
    const r = spawnSync(process.execPath, [bin, 'run', ...targets, '--no-file-parallelism', '--testTimeout=600000', '--reporter=json', '--outputFile', report],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 4 * TIMEOUT - 600_000, killSignal: 'SIGKILL', env });
    expect(existsSync(report), `vitest wrote its report (exit ${r.status}); stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(true);
    const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string; assertionResults: Assertion[] }[] };
    const byFile = new Map<string, Assertion[]>();
    for (const t of json.testResults) byFile.set(t.name.startsWith(REPO) ? t.name.slice(REPO.length + 1) : t.name, t.assertionResults);
    return { byFile, status: r.status, stderr: r.stderr ?? '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The Render-back section of docs/canvas-primitives.md, from its heading to the next. */
function renderBackSection(): string {
  const doc = readFileSync(join(REPO, 'docs', 'canvas-primitives.md'), 'utf8');
  const section = doc.split('\n#### Render-back\n')[1]?.split('\n#### ')[0];
  expect(section, 'docs/canvas-primitives.md has the section Render-back').toBeDefined();
  return section!;
}
/** The words a code span holds, e.g. `{id, box, px, at}` gives id, box, px, at. */
const codeWords = (sentence: string): Set<string> => new Set([...sentence.matchAll(/`([^`]+)`/g)].flatMap((m) => m[1]!.match(/[A-Za-z_]+/g) ?? []));

describe(`${AC9} the suites that read a 3D table pass unedited, and the design says what a row holds`, () => {
  it(`${AC9} the files of 427/, 1729/ and 2293/ that read a 3D snapshot's table pass with no edit, or as a blind redraft scripts/lanes.mjs lists`, async () => {
    requireMetal('the suites that read a 3D render-back\'s table');
    const base = mergeBase();
    const lanes = (await import(pathToFileURL(join(REPO, 'scripts', 'lanes.mjs')).href)) as { redrafted?: Record<string, string> };
    const redrafted = lanes.redrafted ?? {};
    const edited = git(['diff', '--stat', base, '--', ...FOLDERS]);
    expect(edited.status, `git diff against the merge base ${base.slice(0, 12)} runs: ${edited.stderr}`).toBe(0);
    expect(edited.stdout.trim(), `no file under ${FOLDERS.join(', ')} is edited since the merge base ${base.slice(0, 12)}`).toBe('');
    for (const f of FILES) expect(existsSync(join(REPO, f)) || redrafted[f] !== undefined, `${f} is present, or listed as redrafted`).toBe(true);
    const targets = FILES.map((f) => redrafted[f] ?? f);
    const { byFile, status, stderr } = vitest(targets);
    const lines: string[] = [];
    const notPassed: Assertion[] = [];
    for (const target of targets) {
      const found = [...byFile].filter(([name]) => (target.endsWith('/') ? name.startsWith(target) : name === target));
      if (found.length === 0 || found.every(([, a]) => a.length === 0)) { lines.push(`${target}: no test ran`); notPassed.push({ title: target, status: 'missing', failureMessages: [] }); continue; }
      for (const [name, assertions] of found) {
        for (const a of assertions) {
          lines.push(`${a.status}: ${name} › ${a.title}${a.failureMessages.length ? ` — ${a.failureMessages.join(' | ').replace(/\s+/g, ' ').slice(0, 500)}` : ''}`);
          if (a.status !== 'passed') notPassed.push(a);
        }
      }
    }
    proof('the suites that read a 3D table, run unedited', { merge_base: base, targets, results: lines });
    const unjudged = notPassed.filter((a) => a.failureMessages.some((m) => /INCONCLUSIVE/.test(m)));
    if (notPassed.length > 0 && unjudged.length === notPassed.length) inconclusive(`the suites could not be judged here:\n  ${lines.join('\n  ')}`);
    expect(notPassed.map((a) => `${a.status}: ${a.title}`), `every test of the suites that read a 3D table passes:\n  ${lines.join('\n  ')}`).toEqual([]);
    expect(status, `vitest exited 0; stderr: ${stderr.slice(-2000)}`).toBe(0);
  }, 4 * TIMEOUT);

  it(`${AC9} render-back's line in the design says what a row of the table holds, and the design links and names lane passes`, () => {
    const section = renderBackSection();
    const sentences = section.replace(/\n(?!\n)/g, ' ').split(/(?<=\.)\s+(?=[A-Z`])/).filter((s) => /\btable\b/.test(s));
    const told = sentences.filter((s) => { const w = codeWords(s); return w.has('px') && w.has('at'); });
    expect(told, `the Render-back section has a sentence on the table naming what a row holds, px and at among it in code; its sentences on the table:\n  ${sentences.join('\n  ')}`).not.toEqual([]);
    proof('render-back\'s line on the table', told);
    const lane = spawnSync(process.execPath, [join('scripts', 'design-links.mjs')], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
    const out = `${lane.stdout ?? ''}${lane.stderr ?? ''}`;
    proof('the design links and names lane', out.trim().split('\n').slice(0, 40));
    if (lane.status !== 0 && /^INCONCLUSIVE/m.test(lane.stdout ?? '') && !/^FAIL/m.test(lane.stdout ?? '')) inconclusive(`the design links and names lane: ${out.trim().slice(0, 1500)}`);
    expect(lane.status, `the design links and names lane passes (node scripts/design-links.mjs):\n${out.slice(0, 4000)}`).toBe(0);
  }, TIMEOUT);
});
