// What a claim changed is read with as much output as the snapshot's own git reads allow (#1869): a `git diff` listing
// past the old 64 MB cap still shows that the claim edited an approved check's test file, so that check counts as the
// agent's own; the cap read the listing as no change, and the check passed the claim.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordedRun } from '@deepbuild/gate';
import type { Connection } from '@deepbuild/record';
import { GateRunner, type GateOptions } from '../src/gate-runner.js';

/** The digest of no bytes. */
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const dirs: string[] = [];
const path = process.env.PATH;
afterEach(() => { process.env.PATH = path; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'changes-read-')); dirs.push(d); return d; };

describe('the read of what a claim changed (#1869)', () => {
  it('takes a git diff listing past 64 MB: the edited test file makes its approved check the agent\'s own', async () => {
    const dir = temp();
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' }).toString().trim();
    git('init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'test'));
    writeFileSync(join(dir, 'test', 'price.test.js'), 'one\n');
    git('add', '-A');
    git('commit', '-qm', 'one');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'test', 'price.test.js'), 'two\n');
    // A git first on PATH whose `diff --name-only` lists 75 MB of other paths before the real ones: a very large repo's diff.
    const bin = temp();
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\ncase " $* " in *" diff --name-only "*) yes other/path.txt | head -n 5000000 ;; esac\nexec '${real}' "$@"\n`);
    chmodSync(join(bin, 'git'), 0o755);
    process.env.PATH = `${bin}:${path}`;
    let gate: GateRunner;
    const read = ['test/price.test.js'];
    const options: GateOptions = {
      raw: async () => [], now: () => Date.now(), append: async () => undefined, core: {} as Connection,
      start: async () => 'run1',
      ended: async (run) => {
        const record = { run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read, mask: null, exit: { code: 0, signal: null, cause: 'exit' }, output: { stdout: '', stderr: '', sha256: { stdout: EMPTY, stderr: EMPTY } }, attempts: [], seeded: [], contract: null } as unknown as RecordedRun;
        gate.recorded(run, record);
        return 'passed';
      },
      slots: () => ({ free: 1 }), budget_ms: 10_000, hold_ms: 60_000,
      checkouts: () => ({ budget: () => ({ since: Date.now() }), snapshot: async () => ({ commit: 'snap', wrote: true, tree: 't1' }), checkout: async () => ({ dir, commit: 'snap' }), ended: async () => undefined }) as unknown as ReturnType<GateOptions['checkouts']>,
      invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
    };
    gate = new GateRunner(options);
    const check = { check: 'price-approved', approved: 'sha256:x', command: 'node test/price.test.js', covers: [], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], expected_ms: 1, source: 'definition' as const };
    await gate.stop({ session: 'S', claim: 'claim:big', task: 'task:1', cwd: dir, base, requirements: [], checks: [check], stopAt: Date.now() });
    const v = gate.verdictOf('claim:big');
    expect(v?.outcome, `the claim edited price-approved's test file, yet reads ${JSON.stringify(v)}`).not.toBe('PASS');
    expect(v?.reasons, 'price-approved counts as the agent\'s own for the file it edited, read whole').toContainEqual(expect.stringMatching(/price-approved counts as the agent's own: the claim changed test\/price\.test\.js/));
  }, 60_000);
});
