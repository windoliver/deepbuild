// The gate runner at a real hub's stop (#29), through deep-hook and a Claude Code stand-in: a claim citing a file the
// session never read goes back naming it before any check runs; a claim's check runs in a temporary checkout of its
// snapshot, never the live worktree, as the fast lane inside the stop's hold, and the hold's reply carries its FAIL;
// each run records where it ran and what it needed, and each stop its held time and split.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, askNamed, BEHAVIOR, cleanup, draftFor, lockedFor, makeWorld, req, Session, settle, startHub, stopHub, taskOf, type Ev, type Hub,
} from '../../../tests/acceptance/29/h-d.ts';

afterEach(cleanup);
const CHECK = '.deepbuild/checks/rejects.sh';

/**
 * A world whose BEHAVIOR ask's R1 is checked by a script that fails until `src/auth.ts` says Date.now, and first
 * writes whether it can read a file of your home folder, outside its checkout, into its output (`home: yes|no`).
 */
async function world(): Promise<{ hub: Hub; s: Session; ref: string; repo: string; home: string }> {
  const w = makeWorld({ drafts: [draftFor(BEHAVIOR, { requirements: [req('R1', 'an expired token is rejected', { check: CHECK })], deliverables: ['src/auth.ts'] })] });
  const { writeFileSync, chmodSync } = await import('node:fs');
  writeFileSync(join(w.home, 'secret.txt'), 'yours\n');
  writeFileSync(join(w.repo, CHECK), `#!/bin/sh\nif cat '${join(w.home, 'secret.txt')}' >/dev/null 2>&1; then echo home: yes; else echo home: no; fi\ngrep -q "Date.now" src/auth.ts\n`);
  chmodSync(join(w.repo, CHECK), 0o755);
  const { execFileSync } = await import('node:child_process');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: w.repo });
  git('add', '-A');
  git('commit', '-qm', 'the check');
  const hub = await startHub(w);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  const events = await settle(hub, (e) => { const r = taskOf(askNamed(e, s, BEHAVIOR)); return r !== undefined && lockedFor(e, r).length > 0; });
  return { hub, s, ref: taskOf(askNamed(events, s, BEHAVIOR))!, repo: w.repo, home: w.home };
}
const claimsOf = (events: readonly Ev[], ref: string) => events.filter((e) => e.kind === 'claim.made' && e.data.task_ref === ref);

/** What a run wrote to its stdout, read back from the evidence store by its hash. */
function stdoutOf(hub: Hub, run: Ev, events: readonly Ev[]): string {
  const finished = events.find((e) => e.kind === 'run.finished' && e.data.run === run.data.run)!;
  const hashes = finished.data.evidence as string[];
  return hashes.map((h) => readFileSync(join(hub.root, 'evidence', h.slice(0, 2), h.slice(2)), 'utf8')).join('\n');
}

describe('the gate runner at a real stop', () => {
  it('a claim citing a file the session never read goes back naming it, and no check runs', async () => {
    const { hub, s, ref } = await world();
    try {
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
      const r = await s.stop('Fixed it; see `src/users.ts:1`.');
      const reply = JSON.parse(r.stdout || '{}') as { decision?: string; reason?: string };
      expect(reply.decision, `the stop is sent back: ${r.stdout}`).toBe('block');
      expect(reply.reason).toContain('src/users.ts:1');
      const events = await allEvents(hub);
      const [claim] = claimsOf(events, ref);
      expect(claim, 'the stop made its claim').toBeDefined();
      expect(events.filter((e) => e.kind === 'run.started' && e.data.claim === `claim:${claim!.id}`), 'no check ran').toEqual([]);
    } finally { await stopHub(hub); }
  }, 240_000);

  it('a claim\'s check runs in a checkout of its snapshot, in the fast lane, and the hold replies with its result', async () => {
    const { hub, s, ref, repo } = await world();
    try {
      await s.read('src/auth.ts');
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
      const r = await s.stop('checkToken now compares `src/auth.ts:2` with the clock.');
      const events = await settle(hub, (e) => e.some((x) => x.kind === 'stop.held'));
      const [claim] = claimsOf(events, ref);
      const started = events.find((e) => e.kind === 'run.started' && e.data.claim === `claim:${claim!.id}`);
      expect(started, 'the claim\'s check ran').toBeDefined();
      expect(started!.v, 'as run.started@2').toBe(2);
      expect(started!.data.host).toBe('local');
      expect(started!.data.needs).toMatchObject({ cores: 1, memory_mb: 0, gpus: 0 });
      expect(started!.data.lane, 'inside the stop\'s hold').toBe('fast');
      const finished = events.find((e) => e.kind === 'run.finished' && e.data.run === started!.data.run);
      expect(finished?.data.outcome, 'the snapshot holds the uncommitted edit: the check passes').toBe('passed');
      expect(started!.data.commit, 'on a snapshot of the uncommitted edit, not HEAD').not.toBe(readFileSync(join(repo, '.git/refs/heads/main'), 'utf8').trim());
      const held = events.find((e) => e.kind === 'stop.held')!;
      expect(held.data.claim).toBe(`claim:${claim!.id}`);
      const d = held.data as Record<string, number>;
      expect(d.question + d.slow + d.fast + d.snapshot_start + d.queue_wait, 'the parts sum to the hold').toBe(d.total);
      expect(d.fast, 'the check ran while the stop was held').toBeGreaterThan(0);
      expect(JSON.parse(r.stdout || '{}').decision, 'a green fast lane is no send-back').toBeUndefined();
      expect(stdoutOf(hub, started!, events), 'a head every commit of which a session recorded runs as you').toContain('home: yes');
    } finally { await stopHub(hub); }
  }, 240_000);

  it('a head with a commit no DeepBuild session recorded runs its checks only in the sandbox: none of your files', async () => {
    const { hub, s, ref, repo } = await world();
    try {
      // A stranger's commit, authored as you, made in a clone of their own and brought in by a fetch and a fast-forward
      // the hub never saw from any session's tool call: as a PR from a fork arrives.
      const { execFileSync } = await import('node:child_process');
      const { mkdtempSync, writeFileSync } = await import('node:fs');
      const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=you', '-c', 'user.email=you@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });
      const fork = join(mkdtempSync('/tmp/dh29-fork-'), 'fork');
      g('/tmp', 'clone', '-q', repo, fork);
      writeFileSync(join(fork, 'src/users.ts'), 'export function getUser(id: string) {\n  return { id, name: "x" };\n}\n');
      g(fork, 'commit', '-qam', 'not from a session');
      g(repo, 'pull', '-q', '--ff-only', fork, 'main');
      await s.read('src/auth.ts');
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
      await s.stop('Done with `src/auth.ts:2`.');
      const events = await settle(hub, (e) => e.some((x) => x.kind === 'stop.held'));
      const [claim] = claimsOf(events, ref);
      const started = events.find((e) => e.kind === 'run.started' && e.data.claim === `claim:${claim!.id}`);
      expect(started, 'the check still runs, in the sandbox').toBeDefined();
      expect(stdoutOf(hub, started!, events), 'an untrusted head\'s run reads none of your files').toContain('home: no');
    } finally { await stopHub(hub); }
  }, 240_000);

  it('a fast-lane check that fails sends the stop back in the same reply, naming the check', async () => {
    const { hub, s, ref } = await world();
    try {
      await s.read('src/auth.ts');
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > 1');
      const r = await s.stop('Done with `src/auth.ts`.');
      const reply = JSON.parse(r.stdout || '{}') as { decision?: string; reason?: string };
      expect(reply.decision, `sent back: ${r.stdout}`).toBe('block');
      expect(reply.reason).toContain(CHECK);
      const events = await allEvents(hub);
      expect(claimsOf(events, ref).length).toBe(1);
    } finally { await stopHub(hub); }
  }, 240_000);
});
