// AC2 #832.c07dc2c3: "A row whose difference sits on the limit with 200 pairs reads INCONCLUSIVE, naming the pairs
// needed; a planted plug-in that reads PASS there fails"
//
// The card duel (duel.ts) with the edge catalog: four normal cards and edge (twice their damage, 3 hp of recoil),
// catalog.dominance over `cards` with 200 pairs and the limit 0.22, chosen (README: How the numbers were chosen) where
// edge's difference sits, 0.225 at the base. From the replicas' own plays: edge's b, c, shares and difference, and
// this suite's exact interval of its difference, which holds the limit; every normal card's lies wholly below it.
// - The plug-in, through the hub: edge reads INCONCLUSIVE, its failure `cards.edge` starting `INCONCLUSIVE:` and naming
//   the pairs it would need: the least count up to 65,535 at which the interval, with b/n and c/n held and b and m
//   scaled, lies clear of the limit (this suite checks the count it names lies clear and the one before doesn't), or
//   "more than 65535"; every other row reads PASS; nothing is found; the outcome is uncounted, never passed.
// - The planted runner `dominance_straddle_passes` (dominance.ts's `runDominance`), on the same input and plays: the
//   same judge fails it, naming edge, which it reads PASS.
// The wrong programs: the base (no catalog.dominance); the planted runner; a plug-in that reads a straddling row as
// FAIL or PASS, names no count, or names a count at which the interval still holds the limit.
import { describe, expect, it } from 'vitest';
import { AC, DOC, PAIRS, Pool, TIMEOUT, dominanceSpec, judge, macOnly, none, openHub, packCards, putPiece, readRuns, runChecked, runPlanted, shown, verdictsOf, word, type Hub, type Played, type Result } from './helpers.ts';
import { EDGE, GOAL, NORMAL, TABLE, duelPiece, duelPlay, duelPlaytest, duelProgram, edgeCards } from './duel.ts';

/** The brief's limit for the edge catalog: where edge's difference sits, inside its interval over 200 pairs (README). */
const LIMIT = 0.22;

let opened: Promise<{ pool: Pool; hub: Hub }> | undefined;
const hubOnce = (): Promise<{ pool: Pool; hub: Hub }> => (opened ??= (async () => { const pool = await Pool.open(4); return { pool, hub: await openHub(pool) }; })());
let setup: ReturnType<typeof prepare> | undefined;
async function prepare() {
  macOnly();
  const [catalog] = packCards([edgeCards()], 'the edge catalog');
  const piece = putPiece(DOC.edge, duelPiece(duelProgram(), catalog!));
  const play = duelPlaytest(piece, duelPlay());
  const input = { playtest: 'R1', catalog: catalog!.sha256, table: TABLE, offered: 'offered', taken: 'taken', goal: GOAL, limit: LIMIT, pairs: PAIRS };
  return { catalog: catalog!, piece, spec: dominanceSpec(input, catalog!, play) };
}
/** The rows from a run's plays, and the verdict each should read; edge's must hold the limit and every other row's lie below it. */
async function judged(result: Result, plays: Played[], what: string) {
  const { catalog, piece } = await (setup ??= prepare());
  const { rows, problems } = readRuns(plays, piece, catalog, PAIRS);
  none(problems, `${what}: every pair's with-run and every row's without-run were played (${shown(result)})`);
  const want = verdictsOf(rows, LIMIT);
  const edge = rows.find((r) => r.id === EDGE)!;
  expect(want, `from the plays, edge's interval holds ${LIMIT} (with ${edge.with}, without ${edge.without}, b ${edge.b}, c ${edge.c}) and every normal card's lies below it`)
    .toEqual({ ...Object.fromEntries(NORMAL.map((id) => [id, 'PASS'])), [EDGE]: 'INCONCLUSIVE' });
  return judge(result, rows, LIMIT, PAIRS, catalog, want);
}

describe(`${AC[2]} a row whose difference sits on the limit reads INCONCLUSIVE, naming the pairs needed`, () => {
  it(`${AC[2]} edge, whose interval over 200 pairs holds the limit, reads INCONCLUSIVE, naming the pairs it would need`, async () => {
    const { spec } = await (setup ??= prepare());
    const { pool, hub } = await hubOnce();
    const { result, plays } = await runChecked(hub, pool, spec);
    expect(result.outcome, `a straddling row never passes: ${shown(result)}`).not.toBe('passed');
    none(await judged(result, plays, 'the plug-in'), `catalog.dominance on the edge catalog (${shown(result)})`);
  }, TIMEOUT);

  it(`${AC[2]} a planted plug-in that reads PASS there (dominance_straddle_passes) fails`, async () => {
    const { spec } = await (setup ??= prepare());
    const { pool } = await hubOnce();
    const { result, plays } = await runPlanted(pool, spec, 'dominance_straddle_passes');
    const problems = await judged(result, plays, 'the planted runner');
    expect(problems.length, `this criterion's judge fails the planted runner (${shown(result)})`).toBeGreaterThan(0);
    expect(problems.some((p) => word(EDGE).test(p) && word('PASS').test(p)), `a problem names edge reading PASS:\n  ${problems.slice(0, 12).join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
