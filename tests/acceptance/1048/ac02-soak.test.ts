// AC2 #1048.3109851b: "A soak of the explorer for 100,000 steps with limits {memory: 8 MiB, save: 256 KiB, step: 2 ms}
// passes on the clean fixture, and a planted twin that grows its logic memory by one 64 KiB page every 1,000 steps fails
// playtest.soak, naming memory and the first window past 8 MiB"
//
// The playtest's input gains the issue's soak: {bot: the explorer, steps: 100,000, every: 3,600, limits: {memory: 8,
// save: 256, step: 2}}, beside one short run of the explorer (the criterion names no run count) under a goal it reaches
// at its first move (turn >= 1), so that run's play reads values as #184's host requires of a pass. The sandbox lets no
// memory grow, so a logic memory's size is read as a save keeps it: its 64 KiB pages that hold a nonzero byte
// (README: The surface).
// - On #555's clean crawler (128 KiB of memory, 2 pages written) the playtest passes, with no playtest.soak failure.
// - The leak twin keeps 64 pages written from its start and writes one more page at every step k with
//   k % 1,000 == 0: after step k it holds 65 + floor(k / 1,000) pages. Window n holds steps (n − 1) × 3,600 to
//   n × 3,600 − 1 and is read at its last step: window 17 (step 61,199) reads 126 pages, 7.875 MiB; window 18 (step
//   64,799) reads 129 pages, 8.0625 MiB, the first past 8 MiB. The playtest fails playtest.soak naming memory,
//   window 18 and 8.0625 MiB, and no soak failure names an earlier window.
// No save action is named by the crawler's interface, so no save is read; the step limit is a reading off the
// reference Mac (the design), and on this Mac the crawler's window p99 read 0.1 to 0.5 ms in a debug replica.
// The wrong programs: the base (no soak), a soak that reads the declared memory (the twin declares 10 MiB, over the
// limit from window 1), one that reads at each window's first step or names another window or value, and one that
// never fails.
import { describe, expect, it } from 'vitest';
import { crawlerPiece, crawlerPlay, crawlerProgram } from '../555/programs.ts';
import { AC, DOC, Pool, TIMEOUT, failuresOf, lockPlay, macOnly, named, openHub, playtestSpec, putPiece, runCheck, shown, word, type Hub, type Obj } from './helpers.ts';
import { LEAK, twinPiece, twinProgram } from './programs.ts';

const EXPLORER: Obj = { explorer: { every: 1 } };
const SOAK = { bot: EXPLORER, steps: 100_000, every: 3_600, limits: { memory: 8, save: 256, step: 2 } };
/** One short run of the explorer beside the soak, with a goal it reaches at its first move, so its play reads values (#184's host rule). */
const input = (piece: string, play: Obj): Obj => ({
  piece, play, bots: [EXPLORER], runs: 1, seed: 1048, span: { steps: 600 }, goals: [{ name: 'moved', when: 'turn >= 1' }], piece_seed: 'run', frames: { every: 0 }, soak: SOAK,
});
/** The leak twin's pages with a nonzero byte after step k, and the first window whose reading passes 8 MiB. */
const pagesAfter = (k: number): number => LEAK.start + 1 + Math.floor(k / LEAK.every);
const FIRST = (() => {
  for (let n = 1; n * SOAK.every <= SOAK.steps; n++) if ((pagesAfter(n * SOAK.every - 1) * 64) / 1024 > SOAK.limits.memory) return { window: n, mib: (pagesAfter(n * SOAK.every - 1) * 64) / 1024 };
  throw Error('the leak twin never passes 8 MiB in the soak');
})();

let opened: Promise<{ pool: Pool; hub: Hub }> | undefined;
const hubOnce = (): Promise<{ pool: Pool; hub: Hub }> => (opened ??= (async () => {
  const pool = await Pool.open(2, { entries: false, keep: [] });
  return { pool, hub: await openHub(pool) };
})());

describe(`${AC[2]} a soak of the explorer: 100,000 steps against {memory: 8 MiB, save: 256 KiB, step: 2 ms}`, () => {
  it(`${AC[2]} passes on the clean crawler; the leak twin fails playtest.soak naming memory and window ${FIRST.window}, the first past 8 MiB`, async () => {
    macOnly();
    expect([FIRST.window, FIRST.mib], 'the leak twin first reads past 8 MiB in window 18, at 8.0625 MiB (129 pages)').toEqual([18, 8.0625]);
    const { hub } = await hubOnce();
    const play = await lockPlay(crawlerPlay());

    const clean = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const ok = await runCheck(hub, playtestSpec(input(clean, play)));
    expect(failuresOf(ok, 'playtest.soak'), `no soak failure on the clean crawler: ${shown(ok)}`).toEqual([]);
    expect(ok.outcome, `the soak passes on the clean crawler: ${shown(ok)}`).toBe('passed');

    const leak = putPiece(DOC.leak, twinPiece(twinProgram('leak'), 'leak'));
    const r = await runCheck(hub, playtestSpec(input(leak, play)));
    expect(r.outcome, `the soak fails on the leak twin: ${shown(r)}`).toBe('failed');
    const soak = failuresOf(r, 'playtest.soak');
    expect(soak.length, `a failure starts playtest.soak: ${shown(r)}`).toBeGreaterThan(0);
    const earlier = soak.filter((f) => (named(f.message, 'window') ?? Infinity) < FIRST.window);
    expect(earlier.map((f) => f.message), 'no soak failure names a window before the first past 8 MiB').toEqual([]);
    const f = soak.find((x) => word('memory').test(x.message));
    expect(f, `a soak failure names memory: ${shown(r)}`).toBeDefined();
    expect(f!.test, `the failure's test is the soak: ${f!.message}`).toBe('soak');
    expect(named(f!.message, 'window'), `it names the first window past 8 MiB as "window ${FIRST.window}": ${f!.message}`).toBe(FIRST.window);
    expect(f!.message.includes(`${FIRST.mib} MiB`), `it names the value, ${FIRST.mib} MiB: ${f!.message}`).toBe(true);
  }, TIMEOUT);
});
