// #31 AC15 #31.a271090e: a temporary checkout is gone once no run on it is running or queued; and after a hub killed mid-run restarts,
// no checkout it left remains. The service's side on real folders; the crash through the real hub and deep-hook, as #29's
// hub tests go (a hub that can't start is BLOCKED, never a pass).
import { existsSync, readdirSync, writeFileSync, mkdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git as gitIn, makeRepo, mustFail, openWorld, presenceKind, SEEDED, spec, type World } from './helpers.ts';
import { BEHAVIOR, CHECK_FILE, cleanup, CLI, DEEP_HOOK, draftFor, lockedFor, askNamed, makeWorld, req, Session, settle, sleep, startHub, stopHub, taskOf } from '../29/h-d.ts';

afterEach(cleanup);
async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}

describe('AC15 #31.a271090e a temporary checkout is gone once no run on it is running or queued', () => {
  const checkoutFor = async (service: Awaited<ReturnType<World['service']>>, repo: string, runs: string[]) => {
    const { commit } = await service.snapshot(repo);
    return service.checkout({ worktree: repo, commit, runs });
  };

  it('AC15 with two runs on it, it stays while one is queued or running and goes when the last ends', async () => {
    await withWorld(async (w) => {
      const repo = makeRepo(SEEDED);
      const service = await w.service();
      const c = await checkoutFor(service, repo, ['run:a', 'run:b']);
      expect(existsSync(join(c.dir, 'src/cart.ts')), 'a real checkout').toBe(true);
      await service.ended(c, 'run:a');
      expect(existsSync(c.dir), 'run:b is still queued').toBe(true);
      await service.ended(c, 'run:b');
      expect(existsSync(c.dir), `checkout ${c.dir}`).toBe(false);
    });
  }, 120_000);

  it('AC15 a claim\'s checkouts are all gone when its runs have ended, the session still open', async () => {
    await withWorld(async (w) => {
      const repo = makeRepo(SEEDED);
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      await service.runClaim({ claim: 'claim:ac15', worktree: repo, onto: 'main', checks: [{ check: 'presence', spec: spec('presence', 'src/cart.ts'), deadline: 60_000, on_base: 'passes' as const, own: [] }] });
      expect(kind.calls.length, 'it ran').toBe(1);
      expect(existsSync(kind.calls[0]!.checkout), `checkout ${kind.calls[0]!.checkout}`).toBe(false);
      expect(readdirSync(w.root), 'nothing is left in the service\'s folder').toEqual([]);
    });
  }, 120_000);

  it('AC15 (wrong program) a service that removes checkouts only when the session ends keeps the first and fails this test, naming the checkout', async () => {
    await withWorld(async (w) => {
      const repo = makeRepo(SEEDED);
      const service = await w.service({ plant: 'removes-at-session-end' });
      const c = await checkoutFor(service, repo, ['run:a']);
      await service.ended(c, 'run:a');
      const left = existsSync(c.dir);
      await mustFail('removes-at-session-end', () => expect(left, `checkout ${c.dir} is gone`).toBe(false), [c.dir]);
    });
  }, 120_000);
});

/** Every copy of `name` under `root`: a marker the check writes in the folder it runs in, wherever the hub put that folder. */
function findMarker(root: string, name: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.git' || e === 'evidence') continue;
      const path = join(d, e);
      if (e === name) found.push(d);
      try { if (lstatSync(path).isDirectory()) walk(path); } catch { /* gone */ }
    }
  };
  walk(root);
  return found;
}

describe('AC15 #31.a271090e after a hub killed mid-run restarts, no checkout it left remains', () => {
  it('AC15 a hub killed with SIGKILL during a run leaves its checkout, and its next start removes it', async () => {
    for (const [what, path] of [['the deep CLI (npm run build)', CLI], ['deep-hook (cargo build -p deep-hook)', DEEP_HOOK]] as const) {
      if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
    }
    const w = makeWorld({ drafts: [draftFor(BEHAVIOR, { requirements: [req('R1', 'An expired token is rejected', { check: CHECK_FILE, asserts: [`${CHECK_FILE}:3`] })] })] });
    // The drafted check marks the folder it runs in and stays running: the hub is killed under it.
    const MARK = '.dh31-running';
    writeFileSync(join(w.repo, CHECK_FILE), `#!/bin/sh\ntouch ${MARK}\nexec sleep 300\n`, { mode: 0o755 });
    gitIn(w.repo, ['add', '-A']);
    gitIn(w.repo, ['commit', '-q', '-m', 'the drafted check']);
    // The hub's temp folder is the world's, so a checkout anywhere it may put one is under this root.
    const tmp = join(w.tmp, 't');
    mkdirSync(tmp);
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmp;
    try {
      const hub = await startHub(w);
      const s = new Session(w);
      await s.start();
      await s.typed(BEHAVIOR);
      await settle(hub, (e) => {
        const ref = taskOf(askNamed(e, s, BEHAVIOR));
        return ref !== undefined && lockedFor(e, ref).length > 0;
      });
      await s.read(CHECK_FILE);
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
      // The stop holds on its fast lane; it's never awaited, since the hub dies under it.
      const stop = s.stop('Done.').catch(() => undefined);
      let left: string[] = [];
      for (const until = Date.now() + 60_000; Date.now() < until && !left.length;) {
        left = findMarker(w.tmp, MARK);
        if (!left.length) await sleep(100);
      }
      if (!left.length) throw Error(`BLOCKED: the drafted check never started in a checkout (hub stderr: ${hub.stderr().slice(-800)})`);
      expect(left, 'the check runs in a temporary checkout, never your worktree').not.toContain(w.repo);

      process.kill(hub.pid, 'SIGKILL');
      await hub.exit;
      await stop;
      expect(findMarker(w.tmp, MARK), 'a crash leaves the checkout there').toEqual(left);

      const next = await startHub(w);
      try {
        for (const until = Date.now() + 20_000; Date.now() < until && findMarker(w.tmp, MARK).length;) await sleep(100);
        const remains = findMarker(w.tmp, MARK);
        expect(remains, `the checkouts the killed hub left: ${left.join(', ')}`).toEqual([]);
      } finally {
        await stopHub(next);
      }
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
    }
  }, 300_000);
});
