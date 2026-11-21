// AC1 #832.d6fbcd45: "In a fixture card duel whose catalog holds a planted card that deals ten times a normal card's
// damage, catalog.dominance fails, naming the card and its shares with and without it; with the card at normal damage
// it passes"
//
// The card duel (duel.ts) under its greedy legal bot, catalog.dominance over its table `cards` with the limit 0.2 and
// the default 200 pairs, run through the hub with the catalog plug-in on four debug replicas.
// - The planted catalog: four normal cards (damage 3) and brute (damage 30). From the replicas' own plays, each row's
//   200 pairs (the with-run at hash(832, i) and the without-run at that seed with the row's offers off), its b, c,
//   shares, difference and taken count, and this suite's exact interval of the difference: brute's lies wholly above
//   0.2, every other row's wholly below. The result fails: brute reads FAIL with a catalog.dominant finding naming its
//   table, both shares, the difference, the interval, the limit and the pairs, and the failure `cards.brute` whose
//   message starts catalog.dominant and names brute and both shares as written; every other row reads PASS; testsRun
//   counts 5 × 200.
// - The clean twin: the same catalog with brute at damage 3: every row reads PASS, the outcome is passed.
// The wrong programs: the base (no catalog.dominance); a plug-in that never fails a row, fails every row, reads its
// shares from anything but the paired runs' goal values, plays the without-run with the whole catalog, or names other
// shares than the runs played.
import { describe, expect, it } from 'vitest';
import { AC, DOC, PAIRS, Pool, TIMEOUT, dominanceSpec, judge, macOnly, none, openHub, packCards, putPiece, readRuns, runChecked, shown, verdictsOf, type Hub } from './helpers.ts';
import { GOAL, NORMAL, PLANTED, TABLE, duelPiece, duelPlay, duelPlaytest, duelProgram, normalCards, plantedCards } from './duel.ts';
import type { Tables } from '../194/fixtures.ts';

/** The brief's limit: a row may raise the share of won duels by at most 0.2. */
const LIMIT = 0.2;

let opened: Promise<{ pool: Pool; hub: Hub }> | undefined;
const hubOnce = (): Promise<{ pool: Pool; hub: Hub }> => (opened ??= (async () => { const pool = await Pool.open(4); return { pool, hub: await openHub(pool) }; })());

async function dominance(doc: string, tables: Tables, what: string) {
  macOnly();
  const [catalog] = packCards([tables], what);
  const piece = putPiece(doc, duelPiece(duelProgram(), catalog!));
  const play = duelPlaytest(piece, duelPlay());
  const input = { playtest: 'R1', catalog: catalog!.sha256, table: TABLE, offered: 'offered', taken: 'taken', goal: GOAL, limit: LIMIT };
  const { pool, hub } = await hubOnce();
  const { result, plays } = await runChecked(hub, pool, dominanceSpec(input, catalog!, play));
  const { rows, problems } = readRuns(plays, piece, catalog!, PAIRS);
  none(problems, `${what}: every pair's with-run and every row's without-run were played (${shown(result)})`);
  return { catalog: catalog!, result, rows };
}

describe(`${AC[1]} a card that deals ten times a normal card's damage fails catalog.dominance; at normal damage it passes`, () => {
  it(`${AC[1]} the planted card fails catalog.dominant, naming the card and its shares with and without it`, async () => {
    const { catalog, result, rows } = await dominance(DOC.planted, plantedCards(), 'the planted catalog');
    const want = verdictsOf(rows, LIMIT);
    const brute = rows.find((r) => r.id === PLANTED)!;
    expect(want, `from the plays, brute's interval lies wholly above ${LIMIT} and every normal card's wholly below (brute: with ${brute.with}, without ${brute.without}, b ${brute.b}, c ${brute.c})`)
      .toEqual({ ...Object.fromEntries(NORMAL.map((id) => [id, 'PASS'])), [PLANTED]: 'FAIL' });
    none(judge(result, rows, LIMIT, PAIRS, catalog, want), `catalog.dominance on the planted catalog (${shown(result)})`);
  }, TIMEOUT);

  it(`${AC[1]} with the card at normal damage catalog.dominance passes`, async () => {
    const { catalog, result, rows } = await dominance(DOC.normal, normalCards(), 'the clean catalog');
    const want = verdictsOf(rows, LIMIT);
    expect(Object.values(want), 'from the plays, every row\'s interval lies wholly below the limit').toEqual(rows.map(() => 'PASS'));
    none(judge(result, rows, LIMIT, PAIRS, catalog, want), `catalog.dominance on the clean catalog (${shown(result)})`);
  }, TIMEOUT);
});
