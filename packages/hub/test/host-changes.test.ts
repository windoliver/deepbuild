// What a claim on a host changed (#3511), with the SSH link as the boundary: the script host-sessions.ts sends is run
// here by `sh -s` in a real repo, as the host's shell runs it there, and the gate runner judges the claim on its read.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordedRun } from '@deepbuild/gate';
import type { Connection } from '@deepbuild/record';
import { GateRunner, type GateOptions } from '../src/gate-runner.js';
import { HostSessions } from '../src/host-sessions.js';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** The link's one call: the script on a shell's stdin with its arguments, as hosts.ts's sshScript gives it to the host's. */
const exec = (_host: string, args: string[], script: string): Promise<{ code: number | null; stdout: string; stderr: string }> => new Promise((done) => {
  const child = spawn('sh', ['-s', '--', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  child.on('close', (code) => done({ code, stdout, stderr }));
  child.stdin.end(`{\n${script}\n}\n`);
});

/**
 * A claim of a session on the host `gpu-box`: its folder there holds `base` committed, then `head` written over it,
 * `broken` making its index no index. Its one approved check ran there and exited 0, recording no read files, as a
 * run on a host does. Returns the claim's verdict.
 */
async function claimed(o: { base: Record<string, string>; head: Record<string, string>; broken?: boolean; there?: (git: (...args: string[]) => string) => void; link?: typeof exec }) {
  const dir = mkdtempSync(join(tmpdir(), 'host-changes-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
  const put = (files: Record<string, string>) => { for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), text); } };
  git('init', '-q', '-b', 'main');
  put(o.base);
  git('add', '-A');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD');
  put(o.head);
  o.there?.(git);
  if (o.broken) writeFileSync(join(dir, '.git', 'index'), 'not an index\n');
  const sessions = new HostSessions({ root: dir, hosts: { exec: o.link ?? exec, read: o.link ?? exec } } as unknown as ConstructorParameters<typeof HostSessions>[0]);
  let gate: GateRunner;
  const options = {
    raw: async () => [], now: () => Date.now(), append: async () => undefined, core: {} as Connection,
    start: async () => 'run1',
    ended: async (run: string) => {
      gate.recorded(run, { run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null, exit: { code: 0, signal: null, cause: 'exit' }, output: { stdout: '', stderr: '', sha256: { stdout: EMPTY, stderr: EMPTY } }, attempts: [], seeded: [], contract: null } as unknown as RecordedRun);
      return 'passed';
    },
    changesOn: (host: string, cwd: string, b: string, ms: number) => sessions.changes(host, cwd, b, ms),
    slots: () => ({ free: 1 }), budget_ms: 10_000, hold_ms: o.link ? 2_000 : 60_000, invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
  } as unknown as GateOptions;
  gate = new GateRunner(options);
  const check = { check: 'price-approved', approved: null, command: 'npm test', covers: [], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], expected_ms: 1, source: 'spec' as const };
  await gate.stop({ session: 'S', claim: 'claim:c', task: 'task:1', cwd: dir, base, requirements: [], checks: [check], stopAt: Date.now(), host: 'gpu-box' });
  return gate.verdictOf('claim:c');
}
const pkg = (test: string) => JSON.stringify({ scripts: { test } });
const BASE = { 'price.txt': '20.00\n', 'tests/price_test.sh': 'compare\n', 'package.json': pkg('sh tests/price_test.sh') };

describe('what a claim on a host changed (#3511)', () => {
  it('an edited test file makes the approved check the agent\'s own, naming it: a run there records no read files, so each changed test file counts', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n', 'tests/price_test.sh': 'nothing\n' } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/price_test\.sh, which it may load \(its run on gpu-box records no read files\)/));
  }, 60_000);

  it('an untracked file under a test folder counts too, and so does a package.json whose scripts changed', async () => {
    const v = await claimed({ base: BASE, head: { 'tests/setup.sh': 'new\n', 'package.json': pkg('true') } });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed package\.json, tests\/setup\.sh,/));
  }, 60_000);

  it('a claim that changed only the code under test, or package.json outside its scripts, passes', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '17.00\n', 'package.json': JSON.stringify({ name: 'cart', scripts: { test: 'sh tests/price_test.sh' } }) } });
    expect(v?.outcome, JSON.stringify(v?.reasons)).toBe('PASS');
  }, 60_000);

  it('a read that fails there never reads as no change: the check counts as the agent\'s own, naming the read', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '17.00\n' }, broken: true });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(on gpu-box, git ls-files --cached --others --exclude-standard exited \d+/));
  }, 60_000);

  // Each a way the folder's own git could take an edited test file for the base's: the read compares bytes, so none does.
  const GUTTED = '[ "$(cat price.txt)" = 17.00 ] || exit 2\n';
  const hides: [string, (git: (...args: string[]) => string, dir: string) => void][] = [
    ['the index told to assume it unchanged', (git, dir) => { git('update-index', '--assume-unchanged', 'tests/price_test.sh'); writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED); }],
    ['the index told to skip it', (git, dir) => { git('update-index', '--skip-worktree', 'tests/price_test.sh'); writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED); }],
    ['the base replaced by a commit that holds the edit', (git, dir) => {
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
      git('add', '-A');
      const edited = git('commit-tree', git('write-tree'), '-m', 'edited');
      git('reset', '-q');
      git('replace', base, edited);
    }],
    ['a clean filter that gives back the base\'s bytes', (git, dir) => {
      writeFileSync(join(dir, '.git', 'info', 'attributes'), 'tests/price_test.sh filter=x\n');
      git('config', 'filter.x.clean', `git cat-file blob ${git('rev-parse', 'HEAD')}:tests/price_test.sh`);
      writeFileSync(join(dir, 'tests/price_test.sh'), GUTTED);
    }],
    ['a working-tree encoding that reads the edit as the base\'s text', (_git, dir) => {
      writeFileSync(join(dir, '.git', 'info', 'attributes'), 'tests/price_test.sh working-tree-encoding=UTF-7\n');
      writeFileSync(join(dir, 'tests/price_test.sh'), 'c+AG8-mpare\n');
    }],
    ['an edit of the same size with its file times put back, ctime not trusted', (git, dir) => {
      // An hour back, with the index written after it, so git takes the entry's times for the file's and reads no bytes.
      git('config', 'core.trustctime', 'false');
      const file = join(dir, 'tests/price_test.sh');
      const then = new Date(Date.now() - 3_600_000);
      utimesSync(file, then, then);
      git('update-index', '--refresh');
      writeFileSync(file, 'cOmpare\n');
      utimesSync(file, then, then);
    }],
  ];
  it.each(hides)('an edited test file is named though the folder\'s git is set to hide it: %s', async (_how, hide) => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n' }, there: (git) => hide(git, dirs.at(-1)!) });
    expect(v?.outcome, JSON.stringify(v)).not.toBe('PASS');
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/price_test\.sh, which it may load/));
  }, 60_000);

  it('a folder whose git takes another folder for its work tree is no change set: nothing is known of it', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '18.00\n' }, there: (git) => { const decoy = mkdtempSync(join(tmpdir(), 'host-changes-decoy-')); dirs.push(decoy); git('config', 'core.worktree', decoy); } });
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(on gpu-box, git there takes .* for the work tree, not the folder/));
  }, 60_000);

  it('a changed test file whose name git still quotes is no change set: nothing is known of it', async () => {
    const v = await claimed({ base: { ...BASE, 'tests/a"b.sh': 'compare\n' }, head: { 'tests/a"b.sh': 'nothing\n' } });
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: what the claim changed couldn't be read \(on gpu-box, git names a path it can't list plainly/));
  }, 60_000);

  it('an edited test file whose name git would quote is named plainly, and counts', async () => {
    const v = await claimed({ base: { ...BASE, 'tests/prix_é.sh': 'compare\n' }, head: { 'tests/prix_é.sh': 'nothing\n' } });
    expect(v?.reasons).toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed tests\/prix_é\.sh,/));
  }, 60_000);

  it('a link that never answers: the stop returns at its hold with the check still to run, and the claim has no verdict yet, never PASS', async () => {
    const v = await claimed({ base: BASE, head: { 'price.txt': '17.00\n' }, link: () => new Promise(() => undefined) });
    expect(v?.outcome, JSON.stringify(v)).toBe('pending');
    expect(v?.reasons).toEqual(['price-approved: runs still to come']);
  }, 60_000);
});
