// What #3114's blind suite doesn't reach: the third read of what a claim changed, the tracked files, from which the
// gate finds the runner configs a claim's tree holds. A tracked config under a non-ASCII folder must be read by its
// plain path, or the setup file it names isn't the check's own and an edited one leaves the check approved.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordedRun } from '@deepbuild/gate';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey } from '../src/gate-runner.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const git = (dir: string, args: string[], env: Record<string, string> = {}): string => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], {
  cwd: dir, stdio: 'pipe', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...env },
}).toString();
const write = (dir: string, files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
};
const check: ClaimCheck = { check: 'unit-tests', approved: 'approved', command: 'npx vitest run', covers: ['R1'], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition' };

/** One claim's verdict: the base holds `base`, the worktree then gets `claim`, and the check's one passed run read `read`. */
async function judge(base: Record<string, string>, claim: Record<string, string>, read: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'quoted-config-'));
  dirs.push(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, base);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const head = git(dir, ['rev-parse', 'HEAD']).trim();
  write(dir, claim);
  const index = { GIT_INDEX_FILE: join(dir, '.git', 'snapshot-index') };
  const checkouts = {
    budget: () => ({ since: Date.now() }),
    snapshot: async () => { git(dir, ['add', '-A'], index); return { commit: 'snap', wrote: true, tree: git(dir, ['write-tree'], index).trim() }; },
    checkout: async () => ({ dir, commit: 'snap' }),
    ended: async () => undefined,
  } as unknown as ReturnType<GateOptions['checkouts']>;
  const keys = new Map<string, RunKey | undefined>();
  let ran = false;
  const gate: GateRunner = new GateRunner({
    raw: async () => [], now: () => Date.now(), core: {} as GateOptions['core'], append: async () => undefined,
    start: async (r) => { keys.set('run1', r.key); return 'run1'; },
    ended: async (run) => {
      const record = gate.recorded(run, { run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read, mask: null, exit: { code: 0, signal: null, cause: 'exit' }, output: { stdout: 'ok\n', stderr: '', sha256: { stdout: 'a'.repeat(64), stderr: 'a'.repeat(64) } }, attempts: [], seeded: [], contract: null } as unknown as RecordedRun);
      if (keys.get(run)) await gate.keyed(keys.get(run)!, run, record);
      ran = true;
      return record.outcome;
    },
    slots: () => ({ free: 1 }), budget_ms: 60_000, hold_ms: 60_000, checkouts: () => checkouts,
    invalid: async (_c, _commit, reason) => { throw Error(`the gate refused the claim: ${reason}`); },
    stopping: () => false, stoodIn: async () => undefined, kept: async () => true,
  });
  await gate.stop({ session: 'S', claim: 'claim:A', task: 'task:1', cwd: dir, base: head, requirements: [], checks: [check], stopAt: Date.now() });
  for (let i = 0; i < 100 && !ran; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  expect(ran, 'the check ran on the claim').toBe(true);
  return gate.verdictOf('claim:A');
}

describe('a tracked runner config under a non-ASCII folder (#3114)', () => {
  it('makes the setup file it names the check\'s own, so editing that file keeps the claim from passing', async () => {
    const config = "export default { test: { setupFiles: ['./setup.js'] } };\n";
    const v = await judge({ 'pkg-é/vitest.config.ts': config, 'pkg-é/setup.js': 'globalThis.ok = true;\n', 'src/a.js': 'exports.a = 1;\n' }, { 'pkg-é/setup.js': 'globalThis.ok = false;\n' }, ['src/a.js', 'pkg-é/setup.js']);
    expect(v?.outcome, JSON.stringify(v?.reasons)).not.toBe('PASS');
    expect(v?.reasons.find((r) => r.includes("unit-tests counts as the agent's own")), JSON.stringify(v?.reasons)).toContain('pkg-é/setup.js');
  }, 30_000);
});
