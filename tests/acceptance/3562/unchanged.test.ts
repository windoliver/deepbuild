// #3562 AC5: #907's and #965's suites pass unchanged.
//
// Not a copy of either suite: both are run as they stand, every `*.test.ts` file of tests/acceptance/907 and
// tests/acceptance/965, listed when this runs, by a child Vitest from the checkout's root, one file at a time, as
// their READMEs give each file's command. "Unchanged" is read from git: no file of either folder differs from the
// merge base with origin/main, in a commit or in the working tree, and none is added. "Pass" is read from the child's
// report: every file ran, each reported its tests, and every test passed, none skipped. A test of theirs that ends
// BLOCKED or INCONCLUSIVE, as theirs do on a machine too loaded for a hub's fast lane, didn't run to a verdict: this
// test is then INCONCLUSIVE, by a skip the lanes count as no test, never a pass.
//
// At the merge base this test passes: it is the criterion that keeps what works (README, AC5).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const AC5 = 'AC5 #3562.ff6e2a6d';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VITEST = join(REPO, 'node_modules/vitest/vitest.mjs');
const SUITES = ['tests/acceptance/907', 'tests/acceptance/965'];
/** What both suites need built, as their READMEs name it. */
const BUILT = [['the deep CLI (npm run build --workspaces)', 'packages/cli/dist/main.js'], ['deep-hook (cargo build --locked -p deep-hook)', 'target/debug/deep-hook']] as const;
/** How long the two suites may run before this test gives up on them: far past any run that ends, so it only turns a hang into a failure. */
const RUN_MS = 3 * 3_600_000;

interface Result { name: string; status: string; failure: string }

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw Error(`BLOCKED: git ${args.join(' ')} failed, so "unchanged" can't be read: ${(r.stderr ?? '').trim().slice(0, 600)}`);
  return r.stdout;
}

/** Runs the files in one child Vitest from the checkout's root, one file at a time; each test's name, status and first failure lines. */
async function runFiles(files: readonly string[]): Promise<{ results: Result[]; unrun: string[]; log: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'dh3562-'));
  const report = join(dir, 'report.json');
  // The child is a run of its own: it reports to no parent runner and takes no plant from this one.
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const [k, v] of Object.entries(process.env)) if (!/^(VITEST|TINYPOOL|DEEP_HUB_PLANT$)/.test(k)) env[k] = v;
  try {
    let bound: NodeJS.Timeout | undefined;
    const log = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [VITEST, 'run', '--no-file-parallelism', ...files, '--reporter=json', `--outputFile=${report}`], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => { out = (out + d).slice(-20_000); });
      child.stderr.setEncoding('utf8').on('data', (d: string) => { out = (out + d).slice(-20_000); });
      child.on('error', (error) => resolve(`${out}\n(the child Vitest did not start: ${error.message})`));
      child.on('close', (code, signal) => resolve(`${out}\n(exit ${code}${signal ? `, ${signal}` : ''})`));
      // deadline: a run of the two suites that never ends is given up on; the processes it left end with this file, by PID (tests/vitest-setup.ts)
      bound = setTimeout(() => resolve(`${out}\n(still running after ${RUN_MS / 60_000} minutes: given up on)`), RUN_MS);
    });
    clearTimeout(bound);
    // No report is no run of either suite: BLOCKED, never a failure of a test of theirs.
    if (!existsSync(report)) throw Error(`BLOCKED: the child Vitest over ${SUITES.join(' and ')} wrote no report, so neither suite ran: ${log.slice(-1500)}`);
    const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string; message?: string; assertionResults: { fullName: string; status: string; failureMessages?: string[] }[] }[] };
    const results: Result[] = [];
    const unrun: string[] = [];
    for (const file of files) {
      const ran = json.testResults.find((r) => r.name.endsWith(`/${file}`));
      if (!ran) unrun.push(`${file}: didn't run`);
      else if (!ran.assertionResults.length) unrun.push(`${file}: reported no test${ran.message ? ` (${ran.message.slice(0, 600)})` : ''}`);
      else results.push(...ran.assertionResults.map((a) => ({ name: `${file}: ${a.fullName}`, status: a.status, failure: (a.failureMessages ?? []).join('\n').split('\n').slice(0, 3).join(' | ').slice(0, 800) })));
    }
    return { results, unrun, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe(`${AC5} the slot kept for a held stop's quick checks (#907) and the loop's holds (#965) stay as they are`, () => {
  it(`${AC5} tests/acceptance/907 and tests/acceptance/965 hold the merge base's bytes, and every test of both suites passes`, async (ctx) => {
    // Both suites start `deep hub run` and play sessions through deep-hook (their READMEs, Run them): unbuilt, neither runs.
    for (const [what, path] of BUILT) if (!existsSync(join(REPO, path))) throw Error(`BLOCKED: ${what} is not built at ${path}, so #907's and #965's suites can't run`);
    // Unchanged: against the merge base, in a commit or in the working tree, and nothing added.
    const base = git(['merge-base', 'HEAD', 'origin/main']).trim();
    const differs = git(['diff', '--name-only', base, '--', ...SUITES]).split('\n').filter(Boolean);
    const added = git(['ls-files', '--others', '--exclude-standard', '--', ...SUITES]).split('\n').filter(Boolean);
    expect([...differs, ...added.map((f) => `${f} (added)`)], `#907's and #965's suites are unchanged from the merge base ${base.slice(0, 9)}: no file under ${SUITES.join(' or ')} may differ, go or be added`).toEqual([]);

    // Pass: every test file of the two folders, as it stands.
    const files = SUITES.flatMap((suite) => readdirSync(join(REPO, suite)).filter((f) => f.endsWith('.test.ts')).sort().map((f) => `${suite}/${f}`));
    for (const suite of SUITES) expect(files.some((f) => f.startsWith(`${suite}/`)), `${suite} holds test files to run`).toBe(true);
    const { results, unrun, log } = await runFiles(files);
    const show = (list: readonly Result[]): string => list.map((r) => `${r.status}: ${r.name}${r.failure ? ` -- ${r.failure}` : ''}`).join('\n  ');
    console.log(`AC5 ${files.length} files, ${results.length} tests: ${results.filter((r) => r.status === 'passed').length} passed, ${results.filter((r) => r.status === 'failed').length} failed, ${results.filter((r) => r.status !== 'passed' && r.status !== 'failed').length} not run; files with no result: ${unrun.join('; ') || 'none'}`);
    // A test that stopped BLOCKED or INCONCLUSIVE, or was skipped, didn't run to a verdict; any other failure is one.
    const noVerdict = (r: Result): boolean => r.status !== 'passed' && (r.status !== 'failed' || /\b(BLOCKED|INCONCLUSIVE)\b/.test(r.failure.split(' | ')[0] ?? ''));
    const failed = results.filter((r) => r.status === 'failed' && !noVerdict(r));
    expect(failed.map((r) => r.name), `#907's and #965's suites pass: these tests failed.\n  ${show(failed)}`).toEqual([]);
    expect(unrun, `#907's and #965's suites pass: every test file of both must run and report its tests; the child Vitest ended:\n${log.slice(-3000)}`).toEqual([]);
    const open = results.filter(noVerdict);
    if (open.length) ctx.skip(`INCONCLUSIVE #907's and #965's suites didn't run to a verdict, so this run says nothing:\n  ${show(open)}`);
    expect(results.every((r) => r.status === 'passed'), `every test of #907's and #965's suites passed:\n  ${show(results.filter((r) => r.status !== 'passed'))}`).toBe(true);
  }, RUN_MS + 600_000);
});
