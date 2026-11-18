// AC7 #556.cd2aad65: "A twin of #555's fixture that publishes no turn array fails grid.reach with play.missing, naming
// turn, before any run, as #555's playtest does (moved here from #555's criterion on missing arrays, since this issue
// builds grid.reach)"
//
// #555's noturn twin (its programs.ts: the crawler, declaring and writing no `turn` array) under #555's locked
// interface, which declares turn. grid.reach names a playtest of it (the descender, 3 runs, each run's own seed) and
// fails before any run: a failure whose message starts play.missing: and names turn, no run counted (testsRun 0), and
// every replica call it made an error or a play of no step (the owner's ruling on #184's "before any run"). #555's
// playtest of the same input, through the same hub, fails the same way, which is what "as #555's playtest does" reads.
// The wrong programs: the base (no grid.reach: `missing`, naming no name), a grid.reach that plays the runs before it
// reads the interface, and one that records the floors of a piece that doesn't publish what its interface declares.
import { describe, expect, it } from 'vitest';
import { AC, DOC, Pool, TIMEOUT, lockPlay, macOnly, openHub, playtestSpec, putPiece, ranNoStep, reachSpec, runCheck, shown, word, type Played, type Result } from './helpers.ts';
import { DESCENDER, crawlerPiece, crawlerPlay, crawlerProgram } from '../555/programs.ts';

const input = (piece: string, play: Record<string, unknown>): Record<string, unknown> => ({
  piece, play, bots: [DESCENDER], runs: 3, seed: 556, span: { steps: 150 }, goals: [], piece_seed: 'run', frames: { every: 0 },
});
const REACH = { playtest: 'R-noturn', goals: ['exit'], every: ['open'], depths: [1, 2] };

function refusedBeforeAnyRun(what: string, r: Result, calls: Played[]): void {
  expect(r.outcome, `${what} doesn't pass: ${shown(r)}`).not.toBe('passed');
  const f = r.failures.find((x) => x.message.startsWith('play.missing:'));
  expect(f, `${what}: a failure starts play.missing: ${shown(r)}`).toBeDefined();
  expect(word('turn').test(f!.message.slice('play.missing:'.length)), `${what}: it names turn: ${f!.message}`).toBe(true);
  expect(r.testsRun, `${what} counts no run: ${shown(r)}`).toBe(0);
  expect(calls.filter((c) => !ranNoStep(c)).map((c) => `a play of ${String(c.reply['steps'])} steps`), `${what}: every replica call it made ran no step`).toEqual([]);
}

describe(`${AC[7]} the twin that publishes no turn array fails grid.reach with play.missing before any run`, () => {
  it(`${AC[7]} grid.reach fails play.missing, naming turn, counting no run and playing no step, as #555's playtest does`, async () => {
    macOnly();
    const pool = await Pool.open(2);
    const hub = await openHub(pool);
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.noturn, crawlerPiece(crawlerProgram('noturn'), 'noturn'));

    let before = pool.log.length;
    const reach = await runCheck(hub, reachSpec(REACH, input(piece, play)));
    refusedBeforeAnyRun('grid.reach on the noturn twin', reach, pool.log.slice(before));

    before = pool.log.length;
    const playtest = await runCheck(hub, playtestSpec(input(piece, play)));
    refusedBeforeAnyRun('#555\'s playtest of the same input', playtest, pool.log.slice(before));
  }, TIMEOUT);
});
