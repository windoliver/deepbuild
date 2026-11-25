// The read of what a claim changed (#1869): it takes as much output as the snapshot's own git reads allow, it ends by
// its deadline even when git leaves a process holding its output open, a hung `git show` of the base's package.json
// never reads as no change, and a base with no package.json is no failed read.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordedRun } from '@deepbuild/gate';
import type { Connection } from '@deepbuild/record';
import { GateRunner, type GateOptions } from '../src/gate-runner.js';

/** The digest of no bytes. */
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const dirs: string[] = [];
const pids: string[] = [];
const path = process.env.PATH;
afterEach(() => {
  process.env.PATH = path;
  // The stub's sleeps end by their PIDs: each is one this file's stub started.
  for (const file of pids.splice(0)) for (const pid of readFileSync(file, 'utf8').split('\n').filter(Boolean)) { try { process.kill(Number(pid), 'SIGKILL'); } catch { /* ended */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'changes-read-')); dirs.push(d); return d; };

/**
 * A claim on a repo whose base holds `base` and whose worktree then holds `head`, staged, stopped with a git first on PATH
 * that runs `stub` (shell, `$PIDS` the file to log its sleeps' PIDs in, `$GIT` the real git) before the real git. Its one approved check
 * read `read` and passed; returns the verdict and how long the stop took.
 */
async function claimed(o: { base: Record<string, string>; head: Record<string, string>; stub: string; read: string[]; hold_ms?: number }) {
  const dir = temp();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
  const put = (files: Record<string, string>) => { for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text); } };
  git('init', '-q', '-b', 'main');
  put(o.base);
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  // Added to the index, so `git diff` lists a new file as well as an edited one.
  put(o.head);
  git('add', '-A');
  const bin = temp();
  const log = join(bin, 'pids');
  writeFileSync(log, '');
  pids.push(log);
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nPIDS='${log}'\nGIT='${real}'\n${o.stub}\nexec '${real}' "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  process.env.PATH = `${bin}:${path}`;
  let gate: GateRunner;
  const options: GateOptions = {
    raw: async () => [], now: () => Date.now(), append: async () => undefined, core: {} as Connection,
    start: async () => 'run1',
    ended: async (run) => {
      const record = { run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: o.read, mask: null, exit: { code: 0, signal: null, cause: 'exit' }, output: { stdout: '', stderr: '', sha256: { stdout: EMPTY, stderr: EMPTY } }, attempts: [], seeded: [], contract: null } as unknown as RecordedRun;
      gate.recorded(run, record);
      return 'passed';
    },
    slots: () => ({ free: 1 }), budget_ms: 10_000, hold_ms: o.hold_ms ?? 60_000,
    checkouts: () => ({ budget: () => ({ since: Date.now() }), snapshot: async () => ({ commit: 'snap', wrote: true, tree: 't1' }), checkout: async () => ({ dir, commit: 'snap' }), ended: async () => undefined }) as unknown as ReturnType<GateOptions['checkouts']>,
    invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
  };
  gate = new GateRunner(options);
  const check = { check: 'price-approved', approved: 'sha256:x', command: 'node test/price.test.js', covers: [], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], expected_ms: 1, source: 'definition' as const };
  const stopAt = Date.now();
  await gate.stop({ session: 'S', claim: 'claim:c', task: 'task:1', cwd: dir, base, requirements: [], checks: [check], stopAt });
  return { v: gate.verdictOf('claim:c'), ms: Date.now() - stopAt };
}
const TEST = { 'test/price.test.js': 'one\n' };

describe('the read of what a claim changed (#1869)', () => {
  it('takes a git diff listing past 64 MB: the edited test file makes its approved check the agent\'s own', async () => {
    // The diff of names lists 75 MB of other paths after the real ones, with or without -z: a very large repo's diff.
    const stub = 'case " $* " in *" diff "*"--name-only "*) "$GIT" "$@"; yes other/path.txt | head -n 5000000; exit 0 ;; esac';
    const { v } = await claimed({ base: TEST, head: { 'test/price.test.js': 'two\n' }, read: ['test/price.test.js'], stub });
    expect(v?.outcome, `the claim edited price-approved's test file, yet reads ${JSON.stringify(v)}`).not.toBe('PASS');
    expect(v?.reasons, 'price-approved counts as the agent\'s own for the file it edited, read whole').toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed test\/price\.test\.js/));
  }, 60_000);

  it('takes an untracked listing past 512 MB, more than one string holds, as the snapshot\'s own untracked read does (1 GB): a claim no check reads passes', async () => {
    // `ls-files --others` lists 600 MB of untracked paths after the real ones; the snapshot lists them with -o, unstubbed.
    const name = `other/${'u'.repeat(244)}.txt`;
    // Under -z, as git does, each path ends in NUL.
    const stub = `case " $* " in *" ls-files "*"--others "*) "$GIT" "$@"; case " $* " in *" -z "*) yes '${name}' | head -n 2400000 | tr '\\n' '\\0' ;; *) yes '${name}' | head -n 2400000 ;; esac; exit 0 ;; esac`;
    const { v } = await claimed({ base: TEST, head: { 'src/a.js': 'x\n' }, read: ['test/price.test.js'], stub });
    expect(v?.outcome, `the claim changed no file a check reads, yet reads ${JSON.stringify(v?.reasons)}`).toBe('PASS');
  }, 120_000);

  it('ends a read by its deadline though git leaves a process holding its output open', async () => {
    // `ls-files` starts a process that keeps git's output open, then hangs itself.
    const stub = 'case " $* " in *" ls-files "*) sleep 600 & echo $! >> "$PIDS"; echo $$ >> "$PIDS"; exec sleep 600 ;; esac';
    const { v, ms } = await claimed({ base: TEST, head: { 'src/a.js': 'x\n' }, read: ['test/price.test.js'], stub, hold_ms: 10_000 });
    expect(ms, 'the stop came back within its 10 s hold').toBeLessThan(10_000);
    expect(v?.outcome).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(git ls-files.* timed out/));
  }, 60_000);

  it('a hung git show of the base\'s package.json never reads as no change', async () => {
    const stub = 'case " $* " in *" show "*) echo $$ >> "$PIDS"; exec sleep 600 ;; esac';
    const pkg = (test: string) => ({ 'package.json': JSON.stringify({ scripts: { test } }) });
    const { v } = await claimed({ base: { ...TEST, ...pkg('node a') }, head: pkg('node b'), read: ['test/price.test.js'], stub, hold_ms: 10_000 });
    expect(v?.outcome).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(git show .*package\.json timed out/));
  }, 60_000);

  it('a git show of the base\'s package.json failing for another reason is a failed read, though neither side parses', async () => {
    const stub = 'case " $* " in *" show "*) echo "fatal: bad object" >&2; exit 128 ;; esac';
    const { v } = await claimed({ base: { ...TEST, 'package.json': '{"scripts":{"test":"node a"}}' }, head: { 'package.json': '{' }, read: ['test/price.test.js'], stub });
    expect(v?.outcome).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(git show .*package\.json failed: fatal: bad object/));
  }, 60_000);

  it('a base with no package.json is no failed read: a claim that adds one, which no check reads, passes', async () => {
    const { v } = await claimed({ base: TEST, head: { 'package.json': '{"scripts":{"test":"node a"}}' }, read: ['test/price.test.js'], stub: '' });
    expect(v?.outcome, JSON.stringify(v?.reasons)).toBe('PASS');
  }, 60_000);
});
