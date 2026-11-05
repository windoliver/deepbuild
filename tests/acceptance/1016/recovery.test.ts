// #1016 AC3: recovery after a kill. Two leased stand-in builds (README: the `holder` entry, `jobs: jobserver`) join the
// pool from MAKEFLAGS and CARGO_MAKEFLAGS: A holds 6 tokens, B holds 2. A's process group is killed with SIGKILL, so
// its tokens never go back into the pipe. While B still runs, the pipe is read every 250 ms for 3 s: no token may be
// added, and the tokens in the pipe plus B's 2 may never be more than 11 jobs in flight. Then B gives its tokens back
// and ends; once no leased command runs, the pipe must hold all 11 tokens again within 2 s. The pipe is read by
// draining it without waiting and writing every byte back (README, Surfaces). Its wrong program tops the pipe up while
// B runs and must fail naming the sample.
import { describe, expect, it } from 'vitest';
import { AC3, CORES, entriesRepo, joined, mustFail, sleep, TOKENS, tokensIn, until, World, groups } from './helpers.ts';

const A_TAKES = 6;
const B_TAKES = 2;
const REFILL_MS = 2000;

interface Read { ms: number; pipe: number }
interface Recovery { before: number; whileRunning: Read[]; refill: Read[]; refilledMs?: number; aExit?: number | null; bExit?: number | null }

async function killAndRefill(plant?: string): Promise<Recovery> {
  const w = new World({ cores: CORES, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    const repo = entriesRepo(w);
    const a = w.lease(['--', 'holder'], repo, { DH1016_LABEL: 'A', DH1016_TAKE: String(A_TAKES) });
    await until(() => Boolean(w.mark('A', 'held')) || a.finished(), 120_000);
    const b = w.lease(['--', 'holder'], repo, { DH1016_LABEL: 'B', DH1016_TAKE: String(B_TAKES) });
    await until(() => Boolean(w.mark('B', 'held')) || b.finished(), 120_000);
    const markA = w.mark('A', 'held');
    const markB = w.mark('B', 'held');
    const fifo = joined(markA, '`deep lease -- holder` (A)');
    expect(joined(markB, '`deep lease -- holder` (B)'), 'one pool per host: both builds must be given the same named pipe').toBe(fifo);
    expect([markA!.held, markB!.held], `A must hold ${A_TAKES} tokens and B ${B_TAKES}, read from the pool's pipe: ${a.output()} ${b.output()}`).toEqual([A_TAKES, B_TAKES]);
    groups.add(Number(markA!.pgid));
    groups.add(Number(markB!.pgid));
    const before = tokensIn(fifo);

    // A is killed while it holds its tokens; its `deep lease` sees its group gone and ends.
    process.kill(-Number(markA!.pgid), 'SIGKILL');
    const aEnd = await Promise.race([a.done, sleep(60_000).then(() => undefined)]);
    const t0 = Date.now();
    const whileRunning: Read[] = [];
    while (Date.now() - t0 <= 3000) {
      whileRunning.push({ ms: Date.now() - t0, pipe: tokensIn(fifo) });
      await sleep(250);
    }

    // B gives its tokens back and ends: no leased command runs.
    w.go('B');
    const bEnd = await Promise.race([b.done, sleep(60_000).then(() => undefined)]);
    const t1 = Date.now();
    const refill: Read[] = [];
    let refilledMs: number | undefined;
    while (Date.now() - t1 <= REFILL_MS + 3000) {
      const pipe = tokensIn(fifo);
      refill.push({ ms: Date.now() - t1, pipe });
      if (pipe === TOKENS) { refilledMs = Date.now() - t1; break; }
      await sleep(200);
    }
    const r: Recovery = { before, whileRunning, refill, ...(refilledMs !== undefined ? { refilledMs } : {}), aExit: aEnd?.code ?? null, bExit: bEnd?.code ?? null };
    // The Proof's reading: the token count before and after the killed build.
    console.log(`AC3 ${plant ?? 'as built'}: pipe ${before} with A (${A_TAKES}) and B (${B_TAKES}) holding; after A's SIGKILL, while B ran: ${whileRunning.map((x) => `+${x.ms} ms ${x.pipe}`).join(', ')}; after B ended: ${refill.map((x) => `+${x.ms} ms ${x.pipe}`).join(', ')}`);
    return r;
  } finally {
    await w.stopHub();
  }
}

/** While B runs after A's kill: no token added, and never more than 11 jobs in flight. */
function noTopUp(r: Recovery): void {
  r.whileRunning.forEach((x, i) => {
    const inFlight = x.pipe + B_TAKES;
    expect(inFlight <= TOKENS, `sample ${i + 1} (+${x.ms} ms after A's kill, B still running): ${x.pipe} tokens in the pipe and ${B_TAKES} held by B put ${inFlight} jobs in flight, more than the pool's ${TOKENS}`).toBe(true);
  });
  const first = r.whileRunning[0]!.pipe;
  r.whileRunning.forEach((x, i) => {
    expect(x.pipe <= first, `sample ${i + 1} (+${x.ms} ms after A's kill, B still running): the pipe went from ${first} to ${x.pipe} tokens; the hub never adds a token while a leased build runs`).toBe(true);
  });
}
/** Once no leased command runs: all 11 tokens within 2 s. */
function refilled(r: Recovery): void {
  expect(r.refilledMs !== undefined && r.refilledMs <= REFILL_MS, `once no leased command runs, the pipe must hold all ${TOKENS} tokens again within ${REFILL_MS} ms: ${r.refill.map((x) => `+${x.ms} ms ${x.pipe}`).join(', ')}`).toBe(true);
}

describe(`${AC3} recovery after a kill`, () => {
  it(`${AC3} a build killed with SIGKILL while it holds tokens: while another leased build runs no token is added; once none runs the pipe holds all 11 tokens again within 2 s`, async () => {
    const r = await killAndRefill();
    noTopUp(r);
    expect(r.bExit, 'B, let end, must exit 0').toBe(0);
    refilled(r);
  }, 600_000);

  it(`${AC3} (wrong program) a refill that tops up the pipe while a build runs (DEEP_HUB_PLANT=refills-while-running) puts more than 11 jobs in flight and fails, naming the sample`, async () => {
    const r = await killAndRefill('refills-while-running');
    await mustFail('refills-while-running', () => noTopUp(r), ['sample', `more than the pool's ${TOKENS}`]);
  }, 600_000);
});
