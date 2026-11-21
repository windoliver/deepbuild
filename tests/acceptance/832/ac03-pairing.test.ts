// AC3 #832.d550c82e: "Each pair's two runs share a seed and differ only in the row's offers, and both replay from their
// tracks; a planted pairing on different seeds fails, naming the pair"
//
// The card duel (duel.ts) with the edge catalog, catalog.dominance over `cards` with 40 pairs (a count the input gives,
// so the check is short) and the limit 0.2, on four debug replicas.
// - The plug-in, through the hub. From the replicas' own plays, for every row and pair i: the with-run is a play of the
//   playtest's first bot at hash(832, i) with no `off`; the without-run is a play of that bot at the same seed with
//   `off: {catalog, table: cards, row: <the row's index in the record's ids>}`, and the replica answers as `off.sha256`
//   the SHA-256 of the catalog's bytes with that row's offers cell set to 0 and no other byte changed (this suite's own
//   copy); their offered, taken and won values agree at every step before the with-run first offers the row, and at
//   that step in each slot not holding it, and the without-run never offers or takes the row; each run has a replay,
//   a play of its recorded entries at its seed with no bot (the without-run's with its off), reaching the same hash at
//   every checkpoint and at the end; the evidence holds the catalog's asset ID, every row's copy by hash and every
//   run's track. The result finds no catalog.unpaired and counts 5 × 40.
// - The planted runner `dominance_unpaired_seeds` (dominance.ts's `runDominance`), which plays pair i's without-run on
//   pair i + 1's seed, the last pair's on the first's: for every row and pair whose two runs so taken break the
//   pairing by the rule above, the result holds a catalog.unpaired finding naming the table, the row, the pair, its
//   seed hash(832, i) and the first step that breaks it, and a failure `cards.<row>` whose message starts
//   catalog.unpaired and names the row, the pair and its seed; the outcome is failed.
// The wrong programs: the base (no catalog.dominance); the planted runner; a plug-in that plays a without-run on another
// seed, with another catalog or with more than the row's offers changed, or skips a run's replay, or never checks a pair.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, breaks, canon, dominanceSpec, macOnly, none, openHub, packCards, putPiece, readRuns, runChecked, runPlanted, runSeed, shown, word,
  type Catalog, type Hub, type Played, type Result, type RowRead,
} from './helpers.ts';
import { GOAL, GREEDY, SEED, TABLE, duelPiece, duelPlay, duelPlaytest, duelProgram, edgeCards } from './duel.ts';

const PAIRS = 40;
const LIMIT = 0.2;

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
/** A bot as a play runs it, without the authorship, bands and expectations an input may add. */
const lowered = (bot: unknown): string => canon(Object.fromEntries(Object.entries((bot ?? {}) as Record<string, unknown>).filter(([k]) => !['by', 'share', 'expect'].includes(k))));
/** What the plays show of each pair against the rule (As built (#832)); one line a breach. */
function pairing(rows: RowRead[], catalog: Catalog, result: Result): string[] {
  const out: string[] = [];
  const replayed = (run: Played, replays: Played[], what: string): void => {
    const same = replays.find((p) => canon(p.reply['checkpoints']) === canon(run.reply['checkpoints']) && p.reply['final'] === run.reply['final']);
    if (!replays.length) out.push(`${what} has no replay: no play of its entries at its seed without a bot${run.call['off'] ? ' with its off' : ''}`);
    else if (!same) out.push(`${what}'s replay reaches other hashes: checkpoints ${JSON.stringify(replays[0]!.reply['checkpoints']).slice(0, 300)} final ${String(replays[0]!.reply['final'])}, not ${JSON.stringify(run.reply['checkpoints']).slice(0, 300)} final ${String(run.reply['final'])}`);
  };
  const evidence = new Set(result.evidence);
  if (!evidence.has(catalog.sha256)) out.push('the catalog\'s asset ID isn\'t among the evidence');
  for (const row of rows) {
    if (!evidence.has(row.copy.sha256)) out.push(`${row.id}: its copy ${row.copy.sha256} isn't among the evidence`);
    for (const p of row.pairs) {
      const what = `${row.id} pair ${p.i} (seed ${p.seed})`;
      const [a, z] = [p.with.play, p.without.play];
      if (a.call['seed'] !== z.call['seed']) out.push(`${what}: its runs play seeds ${String(a.call['seed'])} and ${String(z.call['seed'])}`);
      if (lowered(a.call['bot']) !== lowered(GREEDY) || lowered(z.call['bot']) !== lowered(GREEDY)) out.push(`${what}: its runs play ${lowered(a.call['bot'])} and ${lowered(z.call['bot'])}, not the playtest's first bot`);
      if (canon(a.call['span']) !== canon(z.call['span']) || a.call['piece_seed'] !== z.call['piece_seed']) out.push(`${what}: its runs play other spans or piece seeds`);
      const broken = breaks(p, row.hash);
      if (broken) out.push(`${what}: at step ${broken.step}, ${broken.why}`);
      replayed(a, p.with.replays, `${what}'s with-run`);
      replayed(z, p.without.replays, `${what}'s without-run`);
      for (const run of [a, z]) if (!evidence.has(String(run.reply['track']))) out.push(`${what}: the track ${String(run.reply['track'])} of its ${run === a ? 'with' : 'without'}-run isn't among the evidence`);
    }
  }
  const unpaired = (result.catalog?.found ?? []).filter((f) => f.code === 'catalog.unpaired');
  if (unpaired.length) out.push(`the result finds ${unpaired.length} pairs unpaired, first ${JSON.stringify(unpaired[0]).slice(0, 300)}`);
  if (result.testsRun !== rows.length * PAIRS) out.push(`testsRun ${result.testsRun}, not ${rows.length} rows × ${PAIRS} pairs`);
  return out;
}

describe(`${AC[3]} each pair's two runs share a seed, differ only in the row's offers and replay; a planted pairing on different seeds fails`, () => {
  it(`${AC[3]} each pair's two runs share a seed and differ only in the row's offers, and both replay from their tracks`, async () => {
    const { catalog, piece, spec } = await (setup ??= prepare());
    const { pool, hub } = await hubOnce();
    const { result, plays } = await runChecked(hub, pool, spec);
    const { rows, problems } = readRuns(plays, piece, catalog, PAIRS);
    none(problems, `every pair's with-run and every row's without-run were played, each without-run on its row's copy (${shown(result)})`);
    none(pairing(rows, catalog, result), `the pairs as the replicas played them (${shown(result)})`);
  }, TIMEOUT);

  it(`${AC[3]} a planted pairing on different seeds (dominance_unpaired_seeds) fails catalog.unpaired, naming the pair`, async () => {
    const { catalog, piece, spec } = await (setup ??= prepare());
    const { pool } = await hubOnce();
    const { result, plays } = await runPlanted(pool, spec, 'dominance_unpaired_seeds');
    // The planted runner's plays are the right program's, paired otherwise: pair i's with-run at hash(832, i), its
    // without-run at hash(832, i + 1), the last pair's at hash(832, 0). Read each run by its seed, then pair them so.
    const { rows, problems } = readRuns(plays, piece, catalog, PAIRS);
    none(problems, `the planted runner played a with-run at each pair's seed and a without-run of each row at each seed (${shown(result)})`);
    const found = (result.catalog?.found ?? []).filter((f) => f.code === 'catalog.unpaired');
    const out: string[] = [];
    let broken = 0;
    for (const row of rows) {
      for (const p of row.pairs) {
        const next = row.pairs.find((x) => x.i === (p.i + 1) % PAIRS);
        if (!next) continue;
        const planted = { ...p, without: next.without };
        const b = breaks(planted, row.hash);
        if (!b) continue;
        broken++;
        const seed = runSeed(SEED, p.i);
        const f = found.find((x) => x['row'] === row.id && x['pair'] === p.i);
        if (!f) { out.push(`${row.id} pair ${p.i}: no catalog.unpaired finding names it (its runs break at step ${b.step}: ${b.why})`); continue; }
        if (f['table'] !== TABLE || f['seed'] !== seed || f['step'] !== b.step) out.push(`${row.id} pair ${p.i}: its finding ${JSON.stringify(f).slice(0, 300)} doesn't name table ${TABLE}, seed ${seed} and step ${b.step}`);
        const failure = result.failures.find((x) => x.test === `${TABLE}.${row.id}` && x.message.startsWith('catalog.unpaired') && word(String(seed)).test(x.message));
        if (!failure) out.push(`${row.id} pair ${p.i}: no failure ${TABLE}.${row.id} starts catalog.unpaired and names its seed ${seed}`);
        else for (const w of [row.id, String(p.i)]) if (!word(w).test(failure.message.slice('catalog.unpaired'.length))) out.push(`${row.id} pair ${p.i}: its failure doesn't name ${w}: ${failure.message}`);
      }
    }
    expect(broken, 'the planted pairing breaks the rule in some pair (its two runs on different seeds)').toBeGreaterThan(0);
    expect(result.outcome, `the planted pairing fails: ${shown(result)}`).toBe('failed');
    none(out, `each of the ${broken} pairs the planted pairing breaks is named (${shown(result)})`);
  }, TIMEOUT);
});
