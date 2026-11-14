// #2078, Scope: a claim reuses the last claim's snapshot only when the tree and HEAD read at the claim prove it
// unchanged. Regression protection for that read when another claim of the same session lands while it is in flight:
// after a claim whose check passed, a stop with only reads makes the task's next claim, and the same stop's early claim
// for another task, whose definition is still to come and which has no check, reaches the gate while the first one's
// tree read is still in git. The claim with the check must still be judged on the right snapshot: PASS there, by the
// last claim's run carried or by a real run in a checkout of it, never left with a run that had no checkout to start in.
//
// Real components: the gate runner (this package's own module), the base-commit service, the record, the lease table,
// the supervisor and the command check kind, each through its package's public entry. The few lines between them are
// what the hub's Runs does for a claim's check: start it through the command check kind on the supervisor and hand its
// closed record and key to the gate. The verdict is the engine's, read through the gate.
//
// The interleaving is set outside the process, with no timer: the fixture repo's own clean filter for the one untracked
// file the worktree holds. Git runs it whenever it must hash that file, which a tree read must and the gate's own
// `git diff` and `ls-files` never do. Once armed, the filter says it was entered and waits for a release file, so the
// sibling claim is handed to the gate, and has landed, while the read is held.
//
// Safety: every folder is under /tmp/dh2078-sib-*, HOME is a folder there while the test runs; no network, no model;
// no process is stopped by this file (the filter ends on its release, or by itself after 30 s).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { runCommandCheck } from '@deepbuild/checks-command';
import { leaseKinds, portKind } from '@deepbuild/env-local';
import { openCheckouts } from '@deepbuild/gate';
import { openLeases } from '@deepbuild/leases';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { GateRunner } from '../src/gate-runner.js';
import { ulid } from '../src/wire.js';

const CHECK = '.deepbuild/checks/value.sh';
const SUITE = '.deepbuild/checks/value.test.mjs';
/** The session's uncommitted work: untracked, so only a tree read hashes it. The check passes only where it holds FIXED. */
const FILE = 'src/value.txt';
const FIXED = 'fixed by the session\n';
const REQ = 'req:t1#R1';
const DAY = 86_400_000;
/** The one commit: the drafted check and its node:test suite. FILE is not in it. */
const BASE: Record<string, string> = {
  'README.md': 'a fixture\n',
  [CHECK]: `#!/bin/sh\nnode --test ${SUITE}\n`,
  [SUITE]: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\ntest('the value is the session\\'s', () => {\n  assert.equal(readFileSync('${FILE}', 'utf8'), ${JSON.stringify(FIXED)});\n});\n`,
};
/** The clean filter: the file's bytes through unchanged; once armed, it says it was entered and waits for the release, 30 s at most. */
const HOLD = `import { appendFileSync, existsSync, readFileSync, writeSync } from 'node:fs';
const dir = process.argv[2];
const bytes = readFileSync(0);
if (existsSync(dir + '/armed')) {
  appendFileSync(dir + '/entered', process.pid + '\\n');
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (const end = Date.now() + 30000; !existsSync(dir + '/release') && Date.now() < end;) Atomics.wait(wait, 0, 0, 5);
}
writeSync(1, bytes);
`;
/** One start the gate asked for: where, on which commit, what FILE held there, how it ended, and its output's digest. */
interface Started { run: string; claim: string; commit: string; cwd: unknown; held: string | null; outcome: string; stdout: string | null }

it('#2078 a read-only stop\'s claim whose tree read overlaps the same session\'s checkless early claim for another task is PASS on the last snapshot, by a carried run or a real run in a checkout of it, never a run with no checkout', async (ctx) => {
  const dir = realpathSync(mkdtempSync('/tmp/dh2078-sib-'));
  const home = process.env.HOME;
  process.env.HOME = join(dir, 'h');
  mkdirSync(process.env.HOME);
  const repo = join(dir, 'repo');
  const seam = join(dir, 'seam');
  const store = join(dir, 'store');
  mkdirSync(repo);
  mkdirSync(seam);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@example.test', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  /** FILE's bytes at a commit, read from DeepBuild's store; or why they can't be read. */
  const fileAt = (commit: string): string => { try { return git(dir, `--git-dir=${store}`, 'show', `${commit}:${FILE}`); } catch (error) { return `(${commit}:${FILE} can't be read from the store: ${String(error).split('\n')[0]})`; } };
  git(repo, 'init', '-q', '-b', 'main');
  for (const [path, bytes] of Object.entries(BASE)) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), bytes); }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const head = git(repo, 'rev-parse', 'HEAD').trim();
  // The seam is the repo's own: its filter in .git/config, its attribute in .git/info, neither in any tree.
  writeFileSync(join(seam, 'hold.mjs'), HOLD);
  mkdirSync(join(repo, '.git/info'), { recursive: true });
  writeFileSync(join(repo, '.git/info/attributes'), `${FILE} filter=sibling\n`);
  git(repo, 'config', 'filter.sibling.clean', `'${process.execPath}' '${join(seam, 'hold.mjs')}' '${seam}'`);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, FILE), FIXED);

  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  const port = portKind();
  for (const kind of leaseKinds) await leases.declare('env-local', kind, kind.name === port.kind ? port.free : undefined);
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, resources: [port], leases });
  const checkouts = await openCheckouts({ store, root: join(dir, 'checkouts'), kinds: [], host: sup, leases, now: Date.now });
  const started: Started[] = [];
  const ends = new Map<string, Promise<string>>();
  /** Each claim the gate refused a snapshot for, with its reason. */
  const refused: string[] = [];
  const gate: GateRunner = new GateRunner({
    raw: (query, params) => record.raw(query, params), now: Date.now, append: async (connection, input) => { await record.append(connection, input); }, core: { writer: 'core', actor: 'you', scope: 'you' },
    // A claim's check, as the hub's Runs starts it: the command check kind on the supervisor, in the folder the gate names.
    // With no folder there, nothing can start, which the gate records as a missing run.
    start: async (r) => {
      const run = `run:${ulid(Date.now())}`;
      const folder = typeof r.cwd === 'string' && existsSync(r.cwd);
      const mine: Started = { run, claim: r.claim, commit: r.commit, cwd: r.cwd, held: folder && existsSync(join(r.cwd, FILE)) ? readFileSync(join(r.cwd, FILE), 'utf8') : null, outcome: folder ? 'running' : 'no checkout', stdout: null };
      started.push(mine);
      if (!folder) throw Error(`no checkout to run in: ${String(r.cwd)}`);
      ends.set(run, runCommandCheck({ host: sup, run, spec: { kind: 'command', runner: r.command, inputs: [r.check], depth: 'unit', oracle: 'code', contract: null }, checkout: r.cwd, deadline: 120_000 }).then(async (ran) => {
        await sup.cleanup(run).catch(() => undefined);
        const kept = gate.recorded(run, ran);
        if (r.key) await gate.keyed(r.key, run, kept);
        mine.stdout = kept.output.sha256.stdout;
        return (mine.outcome = kept.outcome);
      }));
      return run;
    },
    // A budget and a hold wide enough that the check runs in the fast lane and each stop resolves when it has ended.
    ended: (run) => ends.get(run)!, slots: () => ({ free: 2 }), budget_ms: 120_000, hold_ms: 120_000,
    checkouts: () => checkouts, invalid: async (claim, _commit, reason) => { refused.push(`${claim}: ${reason}`); }, stopping: () => false, stoodIn: async () => undefined,
  });
  try {
    // Behavior that must hold, proven with no run on the merge base: one requirement, one drafted check.
    const check = { check: CHECK, approved: null, command: `sh ${CHECK}`, covers: [REQ], depth: 'unit' as const, on_base: 'passes' as const, asserts: [] };
    const stop = (claim: string, same: boolean) => gate.stop({ session: 'sib', claim, task: 'task:t1', cwd: repo, base: head, requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes' }], checks: [check], stopAt: Date.now(), definition: 'locked', same });

    // 1. The preceding claim, after work the hooks saw: its check really runs in a checkout of its snapshot and passes.
    const a = await stop('claim:A', false);
    const ranA = started.filter((s) => s.claim === 'claim:A');
    if (gate.verdictOf('claim:A')?.outcome !== 'PASS' || a.snapshot === head || ranA.length !== 1 || ranA[0]!.outcome !== 'passed' || fileAt(a.snapshot) !== FIXED || existsSync(join(seam, 'entered'))) {
      throw Error(`BLOCKED: the first claim must pass on one real run in a checkout of a snapshot holding ${FILE}, with the seam not yet armed: its stop ${JSON.stringify(a)} on HEAD ${head}; its verdict ${JSON.stringify(gate.verdictOf('claim:A')?.reasons)}; runs ${JSON.stringify(started)}; ${FILE} there ${JSON.stringify(fileAt(a.snapshot))}`);
    }

    // 2. The next stop, with only reads in its turn (`same`), and nothing changed. Its claim for the task is handed to
    // the gate first; the test goes on at whichever comes first: its tree read entering git, or the claim settling
    // with no read through git, as a hub that reuses on the hooks' word does.
    writeFileSync(join(seam, 'armed'), '');
    let settled = false;
    const second = stop('claim:B', true).finally(() => { settled = true; });
    second.catch(() => undefined);
    while (!settled && !existsSync(join(seam, 'entered'))) await new Promise((done) => setTimeout(done, 5));
    const reading = !settled && existsSync(join(seam, 'entered'));
    if (!reading) writeFileSync(join(seam, 'release'), '');

    // 3. The same stop's early claim for another task: no check, its definition still to come. It is awaited, so it has
    // landed in the gate before the read is released.
    const sibling = await gate.stop({ session: 'sib', claim: 'claim:C', task: 'task:t2', cwd: repo, base: head, requirements: [], checks: [], stopAt: Date.now(), definition: 'pending', same: true });
    const landed = { known: gate.verdictOf('claim:C')?.outcome, during: reading && !settled };
    writeFileSync(join(seam, 'release'), '');
    const b = await second;

    const verdict = gate.verdictOf('claim:B');
    const ranB = started.filter((s) => s.claim === 'claim:B');
    const shown = `claim:B's stop ${JSON.stringify(b)}; its verdict ${JSON.stringify(verdict && { outcome: verdict.outcome, commit: verdict.commit, reasons: verdict.reasons })}; the runs started ${JSON.stringify(started)}; refused ${JSON.stringify(refused)}`;
    expect([sibling.fast, sibling.slow, landed.known], 'the checkless early claim for the other task landed in the gate with nothing to run, its definition pending').toEqual([[], [], 'pending']);
    if (reading) expect(landed.during, 'the sibling claim landed while claim:B\'s tree read was still held in git').toBe(true);
    expect(refused, `no claim's snapshot went over its budget: ${shown}`).toEqual([]);
    // A claim that needs to run its check runs it in a real checkout of the right snapshot; a start with no checkout is the missing run.
    expect(ranB.filter((s) => s.outcome !== 'passed' || s.held !== FIXED || s.commit !== a.snapshot), `every run claim:B started ran in a real checkout of ${a.snapshot} holding ${FILE} and passed there: ${shown}`).toEqual([]);
    // The same tree on the same HEAD is the same commit (design: Pinned to a commit), reused or taken again.
    expect([b.snapshot, verdict?.commit], `nothing changed since claim:A, so claim:B covers its snapshot ${a.snapshot}: ${shown}`).toEqual([a.snapshot, a.snapshot]);
    expect(fileAt(b.snapshot), `${FILE} at claim:B's snapshot`).toBe(FIXED);
    expect(verdict?.outcome, `claim:B is judged on that snapshot, where its check passes: ${shown}`).toBe('PASS');
    const proof = verdict!.requirements.find((q) => q.req === REQ);
    const real = new Map(started.filter((s) => s.outcome === 'passed').map((s) => [s.run, s]));
    expect(proof?.runs.counted.length, `${REQ} counts a run: ${shown}`).toBeGreaterThan(0);
    expect(proof!.runs.counted.filter((run) => !real.has(run)), `every run ${REQ} counts really ran and passed: ${shown}`).toEqual([]);
    expect(proof!.runs.counted.filter((run) => !proof!.evidence.includes(real.get(run)!.stdout!)), `each counted run's output is among ${REQ}'s evidence: ${shown}`).toEqual([]);
    // Unreached is never a pass (invariant 2): with no tree read through git at claim:B, the interleaving did not happen.
    if (!reading) ctx.skip(`INCONCLUSIVE: claim:B settled with no tree read through git (the seam was never entered), as a hub that reuses the last snapshot on the hooks' word does, so no read overlapped the sibling claim. What held without the overlap: ${shown}`);
  } finally {
    writeFileSync(join(seam, 'release'), '');
    await checkouts.close();
    await sup.close();
    await record.close();
    process.env.HOME = home;
    rmSync(dir, { recursive: true, force: true });
  }
}, 300_000);
