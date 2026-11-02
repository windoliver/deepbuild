// #31 AC16 #31.2ec94f1d and AC17 #31.73577be6: the snapshot's budget. On a worktree with 300,000 small untracked files a stop's
// claim is INCONCLUSIVE within 11 s (8 s of git work and 3 s to stop git and remove what it left), naming "snapshot over
// budget" and the count, with no git the snapshot started still running and no check run in the live worktree instead;
// and a stop in a second, small repo while that snapshot runs gets its verdict within its own budget. Real git, real
// folders, the time measured by the test; the 300,000 files are a fixture this file builds once.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeRepo, mustFail, openWorld, presenceKind, SEEDED, sleep, spec, write, type World } from './helpers.ts';

async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}

/** The issue's budget: 8 s of git work, plus 3 s to stop git and remove what it left; no stage restarts the clock. */
const BUDGET_MS = 11_000;
const UNTRACKED = 300_000;
/** The count as the issue writes it: "snapshot over budget: 214,031 untracked files". */
const COUNT = UNTRACKED.toLocaleString('en-US');
const FILES_PER_FOLDER = 1000;

/** The sample repo at main with 300,000 small untracked files under u/<folder>/<n>.txt, each with its own bytes. */
function bigRepo(): string {
  const repo = makeRepo(SEEDED);
  for (let d = 0; d < UNTRACKED / FILES_PER_FOLDER; d++) {
    const folder = join(repo, 'u', String(d));
    mkdirSync(folder, { recursive: true });
    for (let i = 0; i < FILES_PER_FOLDER; i++) writeFileSync(join(folder, `${i}.txt`), `${d}-${i}\n`);
  }
  return repo;
}
/** The sample repo at main with one small uncommitted edit, so its stop needs a snapshot of its own. */
function smallRepo(): string {
  const repo = makeRepo(SEEDED);
  write(repo, { 'src/new.ts': 'export const added = true;\n' });
  return repo;
}
/** Every git process descended from this test process and not yet ended: `<pid> <args>`. Read only, never signalled. */
function gitDescendants(): string[] {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,stat=,args='], { encoding: 'utf8' }).split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), stat: m[3]!, args: m[4]! }));
  const mine = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) { mine.add(r.pid); grew = true; }
  }
  return rows.filter((r) => r.pid !== process.pid && mine.has(r.pid) && !r.stat.includes('Z') && /(^|\/)git(\s|$)/.test(r.args)).map((r) => `${r.pid} ${r.args}`);
}

const CHECK = { check: 'presence', spec: spec('presence', 'src/cart.ts'), deadline: 60_000, on_base: 'passes' as const, own: [] };
interface Stop { verdict: string; reasons: string[]; ms: number; gitLeft: string[] }
/** A stop's claim on `repo`: its verdict, its reasons, how long it took, and the git processes still running when it resolved. */
async function stopOn(service: Awaited<ReturnType<World['service']>>, repo: string, claim: string): Promise<Stop> {
  const t0 = performance.now();
  const r = await service.runClaim({ claim, worktree: repo, onto: 'main', checks: [CHECK] });
  const ms = performance.now() - t0;
  return { verdict: r.verdict, reasons: r.reasons, ms, gitLeft: gitDescendants() };
}

let big: string;
beforeAll(() => { big = bigRepo(); }, 600_000);

describe('AC16 #31.2ec94f1d on a worktree with 300,000 small untracked files a stop\'s claim is INCONCLUSIVE within 11 s', () => {
  it('AC16 the claim reads INCONCLUSIVE within 11 s, naming "snapshot over budget" and the count, no git of the snapshot still runs, and no check ran', async () => {
    await withWorld(async (w) => {
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind] });
      const s = await stopOn(service, big, 'claim:ac16');
      expect(s.ms, `the stop's claim resolves within 11 s (took ${s.ms.toFixed(0)} ms)`).toBeLessThanOrEqual(BUDGET_MS);
      expect(s.verdict, `INCONCLUSIVE, never a pass: ${JSON.stringify(s.reasons)}`).toBe('INCONCLUSIVE');
      const reason = s.reasons.find((r) => r.includes('snapshot over budget'));
      expect(reason, `a reason naming "snapshot over budget": ${JSON.stringify(s.reasons)}`).toBeDefined();
      expect(reason, `the reason names the count of untracked files, ${COUNT}`).toContain(COUNT);
      expect(s.gitLeft, 'no git process the snapshot started is still running').toEqual([]);
      expect(kind.calls.map((c) => c.checkout), 'its checks never run, in the live worktree or anywhere').toEqual([]);
    });
  }, 600_000);

  it('AC16 (wrong program) a gate that waits on the snapshot with no bound holds the stop past 11 s and fails this test', async () => {
    await withWorld(async (w) => {
      const kind = presenceKind();
      const service = await w.service({ kinds: [kind], plant: 'snapshot-unbounded' });
      const s = await stopOn(service, big, 'claim:ac16-unbounded');
      await mustFail('snapshot-unbounded', () => expect(s.ms, `the stop's claim resolves within 11 s (took ${s.ms.toFixed(0)} ms)`).toBeLessThanOrEqual(BUDGET_MS), ['11 s']);
    });
  }, 900_000);
});

describe('AC17 #31.73577be6 while that snapshot runs, a stop in a second, small repo gets its verdict within its own budget', () => {
  /**
   * Two stops at once on one service: the big repo's first, the small repo's 200 ms later while the big snapshot's git
   * runs. Returns the small stop (its time from its own start) and whether git of the big snapshot was still running
   * when the small one resolved.
   */
  async function both(service: Awaited<ReturnType<World['service']>>, small: string): Promise<{ small: Stop; bigGitRan: boolean; big: Stop }> {
    const bigStop = stopOn(service, big, 'claim:ac17-big');
    await sleep(200);
    const smallStop = await stopOn(service, small, 'claim:ac17-small');
    const bigGitRan = smallStop.gitLeft.length > 0;
    return { small: smallStop, bigGitRan, big: await bigStop };
  }
  const judge = (small: string, r: Awaited<ReturnType<typeof both>>): void => {
    expect(r.small.ms, `the small repo ${small} gets its verdict within its own 11 s (took ${r.small.ms.toFixed(0)} ms; the big repo's took ${r.big.ms.toFixed(0)} ms)`).toBeLessThanOrEqual(BUDGET_MS);
    expect(r.bigGitRan, `the small repo ${small} gets its verdict while the big snapshot's git still runs, never queued behind it`).toBe(true);
    expect(r.small.verdict, `the small repo ${small}: its check passes on its own snapshot: ${JSON.stringify(r.small.reasons)}`).toBe('PASS');
  };

  it('AC17 the small repo\'s stop resolves within 11 s, while the big snapshot\'s git is still running', async () => {
    await withWorld(async (w) => {
      const small = smallRepo();
      const service = await w.service({ kinds: [presenceKind()] });
      judge(small, await both(service, small));
    });
  }, 600_000);

  it('AC17 (wrong program) a runner that queues the second snapshot behind the first fails this test, naming the small repo', async () => {
    await withWorld(async (w) => {
      const small = smallRepo();
      const service = await w.service({ kinds: [presenceKind()], plant: 'snapshots-one-at-a-time' });
      const r = await both(service, small);
      await mustFail('snapshots-one-at-a-time', () => judge(small, r), [small]);
    });
  }, 600_000);
});
