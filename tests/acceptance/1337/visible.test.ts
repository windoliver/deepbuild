// AC4 #1337.092487e3, its second half: "against the merge base the one-person e2e runs show no visible change" (the
// first half is one-person.test.ts).
//
// The one-person e2e runs are the early end-to-end checkpoints, each one person (you) and what you see of a session
// (README, AC4): #666 (a session's hooks reach the record through deep-hook and the hub), #667 (an ask from raised to
// answered in the terminal), #668 (deep setup, a watched session in deep status, undo) and #669 (a false done held and
// sent back with its verdict line). Their fast tests run, unchanged, in a built checkout of the merge base and in this
// one, one after the other; every test must end the same way in both. A test that passed at the base and fails here, or
// the reverse, or one that only one side ran, is a visible change and fails this test, naming it. A difference where
// one side was skipped or read INCONCLUSIVE (load, their own timing judges) reads INCONCLUSIVE, never PASS.
//
// The merge base's build is the implementer's to make (README, AC4): DEEPBUILD_1337_BASE names its checkout. Without
// it this test reads BLOCKED. Before any of that, the hub here must be the one with people in it: until a second person
// can be added, there is no change to compare and the test reads BLOCKED.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { addPerson, cleanup, NODE, REPO, tempDir, world } from './helpers.ts';

afterAll(cleanup);

const SUITES: { root: string; files: string[]; args: string[] }[] = [
  { root: 'tests/acceptance/666', files: ['fast.test.ts'], args: [] },
  { root: 'tests/acceptance/667', files: [], args: [] },
  { root: 'tests/acceptance/668', files: ['fast.test.ts'], args: [] },
  { root: 'tests/acceptance/669', files: ['fast.test.ts'], args: ['--testTimeout=600000'] },
];
const SUITE_TIMEOUT_MS = 45 * 60_000;

/** The environment each suite runs in: this one, without what would steer it (a plant, a login, this run's Vitest). */
function suiteEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|DEEPBUILD_|CLAUDE|CODEX|ANTHROPIC|OPENAI|OTEL_|GIT_|VITEST|TEST_)/.test(key)) continue;
    if (['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'NODE_ENV', 'FORCE_COLOR'].includes(key)) continue;
    env[key] = value;
  }
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.NO_COLOR = '1';
  return env;
}

interface Outcome { status: string; message: string }
interface Run { outcomes: Map<string, Outcome> | undefined; code: number | null; tail: string }
/** One suite's run in a checkout, read from Vitest's JSON report: each test's status, keyed by its file and full name. */
function runSuite(checkout: string, suite: (typeof SUITES)[number], out: string): Promise<Run> {
  const args = [join(checkout, 'node_modules/vitest/vitest.mjs'), 'run', '--root', suite.root, '--no-file-parallelism', ...suite.args, '--reporter=json', `--outputFile=${out}`, ...suite.files];
  return new Promise((resolve) => {
    const child = spawn(NODE, args, { cwd: checkout, env: suiteEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (text = (text + d).slice(-4000)));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (text = (text + d).slice(-4000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), SUITE_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      let outcomes: Map<string, Outcome> | undefined;
      if (existsSync(out)) {
        const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { name: string; assertionResults: { fullName: string; status: string; failureMessages?: string[] }[] }[] };
        outcomes = new Map();
        for (const file of report.testResults) {
          for (const t of file.assertionResults) outcomes.set(`${relative(join(checkout, suite.root), file.name)} › ${t.fullName}`, { status: t.status, message: (t.failureMessages ?? []).join('\n').split('\n')[0]!.slice(0, 300) });
        }
      }
      resolve({ outcomes, code, tail: text.slice(-1500) });
    });
  });
}

const looseEnd = (o: Outcome | undefined) => !o || ['skipped', 'pending', 'todo'].includes(o.status) || /INCONCLUSIVE/.test(o.message);

describe('AC4 #1337.092487e3 against the merge base the one-person e2e runs show no visible change', () => {
  it('AC4 #1337.092487e3 the fast tests of #666, #667, #668 and #669 end the same way at the merge base and here', async () => {
    const w = await world();
    const added = await addPerson(w, 'bob', w.repos.shop);
    if (!added.ok) throw Error(`BLOCKED: the hub here adds no second person (person.add answered ${added.refused}): it is not yet the hub with people, so there is no change to compare with the merge base`);
    await cleanup();

    const base = process.env.DEEPBUILD_1337_BASE;
    if (!base) throw Error('BLOCKED: DEEPBUILD_1337_BASE names no built checkout of the merge base (README, AC4: how to make one)');
    for (const built of ['packages/cli/dist/main.js', 'target/debug/deep-hook', 'node_modules/vitest/vitest.mjs']) {
      if (!existsSync(join(base, built))) throw Error(`BLOCKED: ${base} has no ${built}; build it as README, AC4 says`);
    }
    const ref = process.env.DEEPBUILD_1337_MAIN ?? 'origin/main';
    let mergeBase: string;
    let at: string;
    try {
      mergeBase = execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: REPO, encoding: 'utf8' }).trim();
      at = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim();
    } catch (error) {
      throw Error(`BLOCKED: can't read the merge base of HEAD and ${ref}, or ${base}'s commit: ${(error as Error).message}`);
    }
    if (at !== mergeBase) throw Error(`BLOCKED: ${base} is at ${at}, not the merge base ${mergeBase} of HEAD and ${ref}`);
    if (realpathSync(base) === realpathSync(REPO)) throw Error(`BLOCKED: DEEPBUILD_1337_BASE is this checkout; the merge base needs a checkout of its own`);

    const out = tempDir();
    const changes: string[] = [];
    const loose: string[] = [];
    for (const suite of SUITES) {
      const name = suite.root.split('/').pop()!;
      const before = await runSuite(base, suite, join(out, `base-${name}.json`));
      if (!before.outcomes?.size) throw Error(`BLOCKED: the merge base's run of ${suite.root} left no report (exit ${before.code}): ${before.tail}`);
      const after = await runSuite(REPO, suite, join(out, `here-${name}.json`));
      if (!after.outcomes?.size) {
        changes.push(`${suite.root}: ran at the merge base (${before.outcomes.size} tests) and left no report here (exit ${after.code}): ${after.tail}`);
        continue;
      }
      const ended = (o: Outcome | undefined) => (o ? `${o.status}${o.message ? ` (${o.message})` : ''}` : 'not run');
      for (const key of new Set([...before.outcomes.keys(), ...after.outcomes.keys()])) {
        const b = before.outcomes.get(key);
        const h = after.outcomes.get(key);
        if (b?.status === h?.status) continue;
        const line = `${suite.root}/${key}: at the merge base ${ended(b)}; here ${ended(h)}`;
        (looseEnd(b) || looseEnd(h) ? loose : changes).push(line);
      }
      console.log(`${suite.root}: ${before.outcomes.size} tests at the merge base ${mergeBase.slice(0, 8)}, ${after.outcomes.size} here`);
    }
    expect(changes, `the one-person e2e runs changed against the merge base ${mergeBase}:\n${changes.join('\n')}`).toEqual([]);
    if (loose.length) throw Error(`INCONCLUSIVE: no test changed from pass to fail or back, but these ended loosely on one side:\n${loose.join('\n')}`);
  }, SUITES.length * 2 * SUITE_TIMEOUT_MS);
});
