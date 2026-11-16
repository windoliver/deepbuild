// #2084 AC1 and AC3, read from one real run of the two original #1015 files, unchanged.
//
// AC1: `tests/acceptance/1015/claude.test.ts` and `tests/acceptance/1015/focused.test.ts` pass, unchanged. This file runs
// those two files with the repo's own vitest as a child (nothing mocked, nothing copied from their assertions), reads the
// child's JSON report, and fails when either file is not byte for byte the one on the base, or any of their tests did
// not pass. Each failed test's own assertion message is carried into the failure.
//
// AC3: "Until then the two cases are listed in scripts/known-failures.json with this issue". The two cases are the two
// tagged tests the issue names, `claude.test.ts` AC1 and `focused.test.ts` AC3. Read with its temporal wording: a case
// that fails in the run must be listed, by its exact id, with #2084; a case that passes must not be listed, and no
// #2084 entry may stand for a case that no longer fails. So the base (both fail, neither listed) fails this test at the
// listing, and a fix that makes both pass must also have taken the entries out.
//
// Safety: the child is this test's own process, stopped by its PID; its folders are /tmp/dh1015-* as #1015's helpers make
// them; no network, no secrets, no real home (the #1015 World sets HOME to a temp folder).
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// Tags: `#2084.<first 8 hex of SHA-256 of the criterion text, trimmed, whitespace collapsed>`, as scripts/proof-change.mjs reads them.
const AC1 = 'AC1 #2084.2c4c3709';
const AC3 = 'AC3 #2084.76e6811e';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CLAUDE = 'tests/acceptance/1015/claude.test.ts';
const FOCUSED = 'tests/acceptance/1015/focused.test.ts';
// The #1015 files as the base b9131dbd holds them (SHA-256): the two files the criterion names, "unchanged", and the
// helpers and stand-ins they run on, so the pass can't come from a weakened file.
const BASE_SHA256: Record<string, string> = {
  [CLAUDE]: '1d7b1aae683eaa1a372ec8e64681d6a94a3db4f2b3af959e5e23636b0f44edf3',
  [FOCUSED]: '62856728966f0552e1444a13eb3eb9f2c9ec65dcc6a2c4df746d5804f2826b54',
  'tests/acceptance/1015/helpers.ts': '7363d8f3d8e0cf8807c5fe7248abc9c19e6347516f9b12fd5fe6893bb011587c',
  'tests/acceptance/1015/fixtures/agent.mjs': '23e95e8a3a4043d37fa4e1e3ca56bce5d49f4db1ba21709c477be14f8cce2594',
  'tests/acceptance/1015/fixtures/standin.pl': '189b4a2a2c819bf2038ca27d43de33409cf01c0d4ba36f9b1059b4cf4879a7e9',
};
/** The two cases #2084 names: each file's tagged proof (not its wrong-program twin). */
const TARGETS = [
  { file: CLAUDE, tag: 'AC1 #1015.081f8373' },
  { file: FOCUSED, tag: 'AC3 #1015.0ceaf8cf' },
];
const LISTED = /\(#2084, added \d{4}-\d{2}-\d{2}\)$/;

interface Case { file: string; id: string; title: string; status: string; message: string }
interface Run { cases: Case[]; problem?: string }

const folder = mkdtempSync(join(tmpdir(), 'dh2084-'));
let child: ChildProcess | undefined;
afterAll(() => {
  if (child?.pid && child.exitCode === null && child.signalCode === null) try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ }
  rmSync(folder, { recursive: true, force: true });
}, 60_000);

let once: Promise<Run> | undefined;
/** Both #1015 files, run once, in one vitest child with its own reporter; the two tests of this file read the same run. */
function theRun(): Promise<Run> {
  once ??= new Promise<Run>((resolve) => {
    const vitest = join(REPO, 'node_modules/vitest/vitest.mjs');
    if (!existsSync(vitest)) return resolve({ cases: [], problem: `BLOCKED: no vitest at ${vitest}` });
    const out = join(folder, 'report.json');
    // The child is a run of its own: none of this run's runner or proof-lane settings reach it.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|DEEP_PROOF)/.test(k)));
    child = spawn(process.execPath, [vitest, 'run', CLAUDE, FOCUSED, '--reporter=json', `--outputFile=${out}`, '--no-file-parallelism'], { cwd: REPO, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-3000); });
    const timer = setTimeout(() => { try { process.kill(child!.pid!, 'SIGTERM'); } catch { /* gone */ } }, 4_200_000);
    child.on('exit', () => {
      clearTimeout(timer);
      if (!existsSync(out)) return resolve({ cases: [], problem: `the #1015 run wrote no report: ${err.slice(-800)}` });
      const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { name: string; message?: string; assertionResults: { ancestorTitles: string[]; title: string; status: string; failureMessages: string[] }[] }[] };
      const cases: Case[] = [];
      for (const f of report.testResults) {
        const file = [CLAUDE, FOCUSED].find((p) => f.name.endsWith(`/${p}`));
        if (!file) continue;
        if (!f.assertionResults.length) cases.push({ file, id: `${file} › (file)`, title: '(file)', status: 'failed', message: String(f.message ?? 'reported no test') });
        for (const t of f.assertionResults) cases.push({ file, id: [file, ...t.ancestorTitles, t.title].join(' › '), title: t.title, status: t.status, message: t.failureMessages.join('\n') });
      }
      resolve({ cases });
    });
  });
  return once;
}

const target = (run: Run, t: (typeof TARGETS)[number]): Case | undefined => run.cases.find((c) => c.file === t.file && c.title.startsWith(t.tag) && !c.title.includes('(wrong program)'));
const sha = (path: string): string => createHash('sha256').update(readFileSync(join(REPO, path))).digest('hex');

describe(`${AC1} the two #1015 files pass, unchanged`, () => {
  it(`${AC1} \`tests/acceptance/1015/claude.test.ts\` and \`tests/acceptance/1015/focused.test.ts\`, unchanged from the base, run and pass every test`, async () => {
    for (const [path, want] of Object.entries(BASE_SHA256)) expect(sha(path), `${path} must be the file the base holds, unchanged`).toBe(want);
    const run = await theRun();
    expect(run.problem, 'the #1015 files must run').toBeUndefined();
    for (const t of TARGETS) {
      const c = target(run, t);
      expect(c, `${t.file}: its \`${t.tag}\` test must be reported`).toBeDefined();
    }
    const notPassed = run.cases.filter((c) => c.status !== 'passed');
    expect(notPassed.map((c) => `${c.id} [${c.status}]: ${c.message.slice(0, 700)}`), 'every test of the two #1015 files must pass').toEqual([]);
    expect(run.cases.length, 'both files report their tests').toBeGreaterThanOrEqual(4);
  }, 4_500_000);
});

describe(`${AC3} the two failing cases are listed with #2084 while they fail, and gone once they pass`, () => {
  it(`${AC3} each of the two #1015 cases that fails is listed in scripts/known-failures.json with #2084, and no entry of #2084 stands for a case that passes`, async () => {
    const run = await theRun();
    expect(run.problem, 'the #1015 files must run').toBeUndefined();
    const known = (JSON.parse(readFileSync(join(REPO, 'scripts/known-failures.json'), 'utf8')) as { failures: Record<string, string> }).failures;
    const failing = new Set<string>();
    for (const t of TARGETS) {
      const c = target(run, t);
      expect(c, `${t.file}: its \`${t.tag}\` test must be reported`).toBeDefined();
      if (c!.status !== 'passed') {
        failing.add(c!.id);
        expect(known[c!.id] ?? '', `\`${c!.id}\` fails (${c!.message.slice(0, 300)}), so scripts/known-failures.json must list it by that id with (#2084, added <date>); it holds ${JSON.stringify(known[c!.id] ?? null)}`).toMatch(LISTED);
      } else {
        expect(known[c!.id], `\`${c!.id}\` passes, so no known-failure entry may stay for it`).toBeUndefined();
      }
    }
    const stale = Object.entries(known).filter(([id, note]) => LISTED.test(note) && !failing.has(id)).map(([id]) => id);
    expect(stale, 'an entry of #2084 whose case no longer fails is stale and must be removed').toEqual([]);
  }, 4_500_000);
});
