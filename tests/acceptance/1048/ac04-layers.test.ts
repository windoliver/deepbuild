// AC4 #1048.657a36a7: "On a 2-layer 16 × 16 fixture whose only route to the exit goes down a gate to the lower layer
// and back up a one-way teleporter, the explorer reaches the exit in 20 of 20 runs and never goes back through the
// teleporter; a planted explorer that ignores links never reaches the exit and fails playtest.band, naming the bot and
// the share"
//
// The map (programs.ts) is one logic item with 2 layers of 16 × 16 cells under the interface's grid.layers 2 and
// grid.links {rows, count} (README: The surface). The hero starts in room A on the surface; room B, which holds the
// exit, is walled off from it; a two-way gate joins A's corner to the cave below, whose corridor ends at a one-way
// teleporter up into B. Played at the base by this suite's own breadth-first route: 30 moves through both links, and no
// route at all without them.
// - The explorer, 20 runs, banded {exit: [1, 1]}, the goal exit (won >= 1): the playtest passes, every run counted and
//   reached; each run's track, played again here, puts the hero on the exit, down the gate (G0 then G1) and up the
//   teleporter (T1 then T0), and once up never on the cave layer again.
// - The same playtest on replicas planted with explorer-ignores-links (the explorer reads no links): it fails
//   playtest.band on bot 0, naming the explorer, the goal, share 0 and the band [1, 1], and no run's track, played again
//   here, ever puts the hero on the exit.
// The wrong programs: the base (one layer: the 512-cell grid fails play.missing), an explorer that ignores links, one
// that takes the one-way teleporter back, a band that never fails.
import { describe, expect, it } from 'vitest';
import { AC, DOC, Pool, TIMEOUT, failuresOf, lockPlay, macOnly, openHub, ownPlay, playtestSpec, putPiece, runCheck, runSeed, runsIn, shown, valuesOf, word, type Obj } from './helpers.ts';
import { MAP, MAP_PATH, idx, mapPiece, mapPlay, mapProgram } from './programs.ts';

const RUNS = 20;
const SPAN = 600;
const EXPLORER: Obj = { explorer: { every: 1 }, share: { exit: [1, 1] } };
const input = (piece: string, play: Obj): Obj => ({
  piece, play, bots: [EXPLORER], runs: RUNS, seed: 1048, span: { steps: SPAN }, goals: [{ name: 'exit', when: 'won >= 1' }], piece_seed: 'own', frames: { every: 0 },
});

/** Each run's explorer play in `pool`'s log, played again here: the hero's cell (x, Y) and won at each step. */
async function replays(pool: Pool, piece: string): Promise<{ cells: number[][]; won: number[] }[]> {
  const out: { cells: number[][]; won: number[] }[] = [];
  for (let i = 0; i < RUNS; i++) {
    const seed = runSeed(1048, i);
    const p = pool.log.find((x) => x.piece === piece && x.call['bot']?.['explorer'] && x.call['seed'] === seed && x.reply['ok'] === true && Number(x.reply['steps']) > 0);
    expect(p, `run ${i} (seed ${seed}) was played in a replica with the explorer`).toBeDefined();
    const again = await ownPlay(pool, piece, { seed, span: { steps: SPAN }, track: p!.reply['entries'], values: [MAP_PATH.cell, MAP_PATH.won], frames: [] });
    out.push({ cells: valuesOf(again, MAP_PATH.cell) as number[][], won: valuesOf(again, MAP_PATH.won).map((v) => Number((v as number[])[0])) });
  }
  return out;
}
const isAt = (c: number[] | undefined, cell: readonly number[]): boolean => !!c && c[0] === cell[0] && c[1] === cell[1];
/** The first step at which the hero stands on `to` right after standing on `from`, or -1. */
const crossed = (cells: number[][], from: readonly number[], to: readonly number[]): number => cells.findIndex((c, k) => k > 0 && isAt(cells[k - 1], from) && isAt(c, to));

describe(`${AC[4]} a 2-layer map with a gate and a one-way teleporter`, () => {
  it(`${AC[4]} the explorer reaches the exit in 20 of 20 runs, down the gate and up the teleporter, never back through it`, async () => {
    macOnly();
    const pool = await Pool.open(2, { entries: true, keep: [] });
    const hub = await openHub(pool);
    const play = await lockPlay(mapPlay());
    const piece = putPiece(DOC.map, mapPiece(mapProgram()));
    expect(idx(MAP.g1) - idx(MAP.g0), 'the gate\'s ends are one layer (256 cells) apart').toBe(256);
    const r = await runCheck(hub, playtestSpec(input(piece, play)));
    expect(r.outcome, `the playtest passes: ${shown(r)}`).toBe('passed');
    const runs = runsIn(r);
    expect(runs.filter((x) => x['counted'] === true && String(x['outcome']?.['kind'] ?? x['outcome']) === 'reached').length, 'every run is counted and reached the exit').toBe(RUNS);
    const all = await replays(pool, piece);
    all.forEach(({ cells, won }, i) => {
      expect(won.some((w) => w >= 1), `run ${i} reaches the exit`).toBe(true);
      const down = crossed(cells, MAP.g0, MAP.g1);
      const up = crossed(cells, MAP.t1, MAP.t0);
      expect(down, `run ${i} goes down the gate`).toBeGreaterThan(0);
      expect(up, `run ${i} comes up the teleporter after the gate`).toBeGreaterThan(down);
      const back = cells.slice(up).findIndex((c) => (c[1] ?? 0) >= MAP.size);
      expect(back, `run ${i} never stands on the cave layer once up the teleporter (step ${up + back})`).toBe(-1);
    });
  }, TIMEOUT);

  it(`${AC[4]} a planted explorer that ignores links never reaches the exit and fails playtest.band, naming the bot and the share`, async () => {
    macOnly();
    const pool = await Pool.open(2, { plant: 'explorer-ignores-links', entries: true, keep: [] });
    const hub = await openHub(pool);
    const play = await lockPlay(mapPlay());
    const piece = putPiece(DOC.map, mapPiece(mapProgram()));
    const r = await runCheck(hub, playtestSpec(input(piece, play)));
    expect(r.outcome, `the playtest fails: ${shown(r)}`).toBe('failed');
    const band = failuresOf(r, 'playtest.band', 'bot 0');
    expect(band.length, `playtest.band on bot 0: ${shown(r)}`).toBe(1);
    const m = band[0]!.message;
    for (const w of ['explorer', 'exit', 'share 0']) expect(word(w).test(m), `it names ${w}: ${m}`).toBe(true);
    expect(m.includes('[1, 1]'), `it names the band [1, 1]: ${m}`).toBe(true);
    const all = await replays(pool, piece);
    all.forEach(({ won }, i) => expect(won.some((w) => w >= 1), `run ${i} of the planted explorer never reaches the exit`).toBe(false));
  }, TIMEOUT);
});
