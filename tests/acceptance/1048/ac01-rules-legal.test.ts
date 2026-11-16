// AC1 #1048.e36b203c: "rules.legal over the clean fixture's descender runs tests 50 samples a run and passes; a planted
// twin that takes a move into a wall cell fails rules.unlisted_taken, naming the run, the step and the entry; and a
// planted twin that lists descend on every cell but takes it only on the exit fails rules.listed_refused, naming the
// row; and over #555's twin that publishes no turn array, rules.legal fails with play.missing, naming turn, before any
// run"
//
// The clean fixture is #555's crawler. rules.legal names a playtest of the descender (3 runs; the criterion names no
// run count), carried in its spec's `play` (README: The surface), with 50 samples a run, 8 unlisted entries a sample
// and seed 1048:
// - On the clean crawler it passes; its result lists 50 samples for each of the 3 runs, each at a step at which the
//   run (played again here from its track) listed a row; it tested at least 9 entries a sample; nothing failed.
// - On the wall twin (a press on any wall cell moves the hero into it), it fails rules.unlisted_taken, naming the run,
//   the step and the entry [action, x, y]; here the entry is a move to a cell the run's grid holds a wall at that
//   step, which the run listed no row for, and which the twin takes from that state (played here: the hero stands in
//   the wall and accepted rises).
// - On the descend twin (descend listed on every cell, taken only on the exit), it fails rules.listed_refused, naming
//   the run, the step and the row [2, 0, 0], at a step whose hero stands on no exit.
// - On #555's noturn twin it fails, a failure starting play.missing and naming turn, counting no run, every replica
//   call it made running no step.
// The wrong programs: the base (no rules.legal), a check that passes without testing, one that tests from states no run
// reached, one that compares an entry with the state before the step (the crawler's wraith moves on its own), one that
// never draws unlisted cells, one that names another step or entry.
import { describe, expect, it } from 'vitest';
import { crawlerPiece, crawlerPlay, crawlerProgram } from '../555/programs.ts';
import {
  AC, DOC, Pool, STEP_60, TIMEOUT, failuresOf, legalSpec, lockPlay, macOnly, named, openHub, ownPlay, putPiece, ranNoStep, runCheck, runSeed, shown, show, stepOf,
  triple, valuesOf, word, type Hub, type Obj, type Result,
} from './helpers.ts';
import { CLASS, SIZE, twinPiece, twinProgram } from './programs.ts';

const SEED = 1048;
const RUNS = 3;
const SAMPLES = 50;
const UNLISTED = 8;
const DESCENDER: Obj = { descender: { action: 'descend', every: 1 } };
const P = { cell: 'crawler.cell', grid: 'crawler.grid', legal: 'crawler.legal', nlegal: 'crawler.nlegal', accepted: 'crawler.accepted' } as const;
/** The playtest rules.legal names: the descender's runs of `piece`, each from its own seed's floors, under the goal deep (which it reaches). */
const named1048 = (piece: string, play: Obj): Obj => ({ piece, play, bots: [DESCENDER], runs: RUNS, seed: SEED, span: { steps: 600 }, goals: [{ name: 'deep', when: 'depth >= 3' }], piece_seed: 'run', frames: { every: 0 } });
const LEGAL = { playtest: 'REQ-1048-descender', samples: SAMPLES, unlisted: UNLISTED, seed: SEED };

let opened: Promise<{ pool: Pool; hub: Hub }> | undefined;
// The log keeps the recorded entries of the runs' own plays (those with a bot), which this suite plays again.
const hubOnce = (): Promise<{ pool: Pool; hub: Hub }> => (opened ??= (async () => {
  const pool = await Pool.open(2, { entries: true, keep: [] });
  return { pool, hub: await openHub(pool) };
})());

/** Run i of the named playtest on `piece`, as the replica played it with the descender: its recorded entries. */
function runEntries(pool: Pool, piece: string, i: number): Obj[] {
  const seed = runSeed(SEED, i);
  const p = pool.log.find((x) => x.piece === piece && x.call['bot']?.['descender'] && x.call['seed'] === seed && x.reply['ok'] === true && Number(x.reply['steps']) > 0);
  expect(p, `run ${i} (seed ${seed}) of the named playtest on ${piece} was played in a replica with the descender`).toBeDefined();
  return p!.reply['entries'] as Obj[];
}
/** The run played again here from its track, with the values this test reads at each step. */
async function replayRun(pool: Pool, piece: string, i: number): Promise<Obj> {
  return ownPlay(pool, piece, { seed: runSeed(SEED, i), piece_seed: 'run', span: { steps: 600 }, track: runEntries(pool, piece, i), values: Object.values(P), frames: [] });
}
const runIndex = (run: unknown): number => {
  const m = String(run).match(/^bot 0 run (\d+)$/);
  expect(m, `a run is named "bot <b> run <i>": ${String(run)}`).not.toBeNull();
  return Number(m![1]);
};
const at = (grid: number[], x: number, y: number): number => grid[y * SIZE + x]!;
const rowsAt = (reply: Obj, k: number): number[][] => {
  const flat = valuesOf(reply, P.legal)[k] as number[];
  const n = Number((valuesOf(reply, P.nlegal)[k] as number[])[0]);
  return Array.from({ length: n }, (_, r) => flat.slice(3 * r, 3 * r + 3));
};

describe(`${AC[1]} rules.legal over the descender's runs: the clean crawler passes; the wall and descend twins fail; the noturn twin fails play.missing`, () => {
  it(`${AC[1]} the clean crawler: 50 samples a run, each from a state the run reached, and it passes`, async () => {
    macOnly();
    // The twins differ from the clean fixture only by their planted change: the copy's clean text is #555's crawler.
    expect(twinProgram('clean').sha, 'this suite\'s copy of the crawler, unchanged, assembles to #555\'s clean crawler').toBe(crawlerProgram('clean').sha);
    const { pool, hub } = await hubOnce();
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const r = await runCheck(hub, legalSpec(LEGAL, named1048(piece, play)));
    expect(r.outcome, `rules.legal passes on the clean crawler: ${shown(r)}`).toBe('passed');
    expect(r.failures, shown(r)).toEqual([]);
    const legal = r.legal as Obj | undefined;
    expect(legal, `the result carries legal: {samples, tested, listed_refused, unlisted_taken}: ${show(r as never, 800)}`).toBeDefined();
    expect(legal!['listed_refused'], 'no listed row refused').toEqual([]);
    expect(legal!['unlisted_taken'], 'no unlisted entry taken').toEqual([]);
    const samples = legal!['samples'] as Obj[];
    expect(Array.isArray(samples), `legal.samples lists each sampled state: ${show(legal as never, 600)}`).toBe(true);
    for (let i = 0; i < RUNS; i++) {
      const mine = samples.filter((s) => s['run'] === `bot 0 run ${i}`);
      expect(mine.length, `run ${i}: ${SAMPLES} samples`).toBe(SAMPLES);
      const replay = await replayRun(pool, piece, i);
      const n = valuesOf(replay, P.nlegal).map((v) => Number((v as number[])[0]));
      const bad = mine.filter((s) => !(Number.isInteger(s['step']) && n[s['step'] as number]! > 0)).map((s) => s['step']);
      expect(bad, `run ${i}: every sampled step is one the run reached with a row listed`).toEqual([]);
    }
    expect(samples.length, `${RUNS} runs × ${SAMPLES} samples`).toBe(RUNS * SAMPLES);
    expect(Number(legal!['tested']), `it tested each sample's listed rows and ${UNLISTED} unlisted entries: at least ${(1 + UNLISTED) * RUNS * SAMPLES}`).toBeGreaterThanOrEqual((1 + UNLISTED) * RUNS * SAMPLES);
  }, TIMEOUT);

  it(`${AC[1]} the wall twin fails rules.unlisted_taken, naming the run, the step and the entry`, async () => {
    macOnly();
    const { pool, hub } = await hubOnce();
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.wall, twinPiece(twinProgram('wall'), 'wall'));
    const r: Result = await runCheck(hub, legalSpec(LEGAL, named1048(piece, play)));
    expect(r.outcome, `rules.legal fails on the wall twin: ${shown(r)}`).toBe('failed');
    const taken = failuresOf(r, 'rules.unlisted_taken');
    expect(taken.length, `a failure starts rules.unlisted_taken: ${shown(r)}`).toBeGreaterThan(0);
    const f = taken[0]!;
    const i = runIndex(f.test);
    expect(f.message.includes(`bot 0 run ${i}`), `it names the run: ${f.message}`).toBe(true);
    const step = named(f.message, 'step');
    const entry = triple(f.message, 'entry');
    expect([step, entry], `it names the step as "step <k>" and the entry as "entry [action, a, b]": ${f.message}`).not.toContain(undefined);
    const [action, x, y] = entry!;
    expect(action, `the entry is a move (action 0, args cell): ${f.message}`).toBe(0);
    expect((r.legal?.['unlisted_taken'] as Obj[] | undefined)?.some((u) => u['run'] === `bot 0 run ${i}` && u['step'] === step && show(u['entry']) === show(entry)), `legal.unlisted_taken holds it: ${show(r.legal as never, 600)}`).toBe(true);
    // From the run's own state at that step: a wall, and no row listed for it; and the twin takes it there.
    const replay = await replayRun(pool, piece, i);
    const grid = valuesOf(replay, P.grid)[step!] as number[];
    expect(at(grid, x, y), `cell (${x}, ${y}) is a wall in run ${i}'s grid at step ${step}`).toBe(CLASS.blocked);
    expect(rowsAt(replay, step!).some((row) => show(row) === show(entry)), `run ${i} listed no row ${show(entry)} at step ${step}`).toBe(false);
    const prefix = runEntries(pool, piece, i).filter((e) => stepOf(e) <= step!);
    const seq = prefix.filter((e) => e['control'] === 'aim').length;
    const t = (step! + 1) * STEP_60;
    const probe = await ownPlay(pool, piece, {
      seed: runSeed(SEED, i), piece_seed: 'run', span: { steps: step! + 2 }, frames: [], values: Object.values(P),
      track: [...prefix, { t, seq, control: 'aim', value: { phase: 'press', button: 'primary', cell: [x, y] }, writer: 'bot', player: 1 }, { t, seq: seq + 1, control: 'aim', value: { phase: 'release', button: 'primary', cell: [x, y] }, writer: 'bot', player: 1 }],
    });
    expect((valuesOf(probe, P.cell)[step! + 1] as number[]).slice(0, 2), 'the twin takes the press: the hero stands in the wall').toEqual([x, y]);
    expect(Number((valuesOf(probe, P.accepted)[step! + 1] as number[])[0]), 'and accepted rises').toBe(Number((valuesOf(probe, P.accepted)[step!] as number[])[0]) + 1);
  }, TIMEOUT);

  it(`${AC[1]} the descend twin fails rules.listed_refused, naming the row`, async () => {
    macOnly();
    const { pool, hub } = await hubOnce();
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.descend, twinPiece(twinProgram('descend'), 'descend'));
    const r = await runCheck(hub, legalSpec(LEGAL, named1048(piece, play)));
    expect(r.outcome, `rules.legal fails on the descend twin: ${shown(r)}`).toBe('failed');
    const refused = failuresOf(r, 'rules.listed_refused');
    expect(refused.length, `a failure starts rules.listed_refused: ${shown(r)}`).toBeGreaterThan(0);
    const f = refused[0]!;
    const i = runIndex(f.test);
    expect(f.message.includes(`bot 0 run ${i}`), `it names the run: ${f.message}`).toBe(true);
    const step = named(f.message, 'step');
    expect(step, `it names the step: ${f.message}`).toBeDefined();
    expect(triple(f.message, 'row'), `it names the row: descend, [2, 0, 0]: ${f.message}`).toEqual([2, 0, 0]);
    expect((r.legal?.['listed_refused'] as Obj[] | undefined)?.some((u) => u['run'] === `bot 0 run ${i}` && u['step'] === step && show(u['row']) === show([2, 0, 0])), `legal.listed_refused holds it: ${show(r.legal as never, 600)}`).toBe(true);
    const replay = await replayRun(pool, piece, i);
    const [hx, hy] = valuesOf(replay, P.cell)[step!] as number[];
    expect(at(valuesOf(replay, P.grid)[step!] as number[], hx!, hy!), `at step ${step} run ${i}'s hero stands on no exit`).not.toBe(CLASS.exit);
    expect(rowsAt(replay, step!).some((row) => show(row) === show([2, 0, 0])), `the twin listed descend at step ${step}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[1]} over #555's noturn twin, rules.legal fails with play.missing, naming turn, before any run`, async () => {
    macOnly();
    const { pool, hub } = await hubOnce();
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.noturn, crawlerPiece(crawlerProgram('noturn'), 'noturn'));
    const before = pool.log.length;
    const r = await runCheck(hub, legalSpec(LEGAL, named1048(piece, play)));
    const calls = pool.log.slice(before);
    expect(r.outcome, `rules.legal doesn't pass on the noturn twin: ${shown(r)}`).not.toBe('passed');
    const f = r.failures.find((x) => x.message.startsWith('play.missing'));
    expect(f, `a failure starts play.missing: ${shown(r)}`).toBeDefined();
    expect(word('turn').test(f!.message.slice('play.missing'.length)), `it names turn: ${f!.message}`).toBe(true);
    expect(r.testsRun, `it counts no run: ${shown(r)}`).toBe(0);
    expect(calls.filter((c) => !ranNoStep(c)).map((c) => `a play of ${String(c.reply['steps'])} steps`), 'every replica call it made ran no step').toEqual([]);
  }, TIMEOUT);
});
