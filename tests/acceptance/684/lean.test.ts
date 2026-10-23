// #684 AC1, AC2, AC3, AC4 and AC7 (the model's side): the proof lane on the model and on planted wrong models, and
// the agreement test between the engine and the model's generated vectors. Everything here needs the pinned Lean
// toolchain: where the lane reports it isn't installed (`BLOCKED toolchain: …`), each test skips with that line,
// as BLOCKED, and never passes. On the merge base the lane doesn't exist, so every test fails.
// One file, so its Lean builds run one at a time: the scratch copies reuse the checkout's build.
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, type TestContext } from 'vitest';
import { verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimInput, Result } from '../../../packages/verdicts/src/index.ts';
import * as h from './helpers.ts';

/** The agreement's seed: drawn in each run and printed; AC684_SEED=<n> replays one. */
const SEED = (() => {
  const given = process.env.AC684_SEED;
  if (given === undefined) return randomInt(0, 2 ** 31);
  const n = Number(given);
  if (!Number.isInteger(n) || n < 0 || n >= 2 ** 31) throw new Error(`AC684_SEED must be a whole number in [0, 2^31); got ${given}`);
  return n;
})();
const COUNT = 10_000;
console.log(`#684 agreement seed ${SEED} (replay with AC684_SEED=${SEED})`);

let lane: h.Ran;
let generated: h.Ran;
let vectors: h.Vectors | Error;
beforeAll(() => {
  // In the checkout itself: this builds the model, so the scratch copies below start from its build.
  lane = h.runNode([h.LANE_SCRIPT], h.ROOT);
  generated = h.generate(h.ROOT, SEED, COUNT);
  try {
    vectors = h.readVectors(generated, SEED, COUNT);
  } catch (e) {
    vectors = e as Error;
  }
}, 120 * 60_000);
afterAll(() => h.removeScratches());

const LONG = 60 * 60_000;
/** Skips the test as BLOCKED when the lane says the pinned toolchain isn't installed; never a pass. */
function needToolchain(ctx: TestContext, r: h.Ran): void {
  const blocked = h.toolchainBlocked(r);
  if (blocked) ctx.skip(`${blocked} (nothing was proved or compared; this is not a pass)`);
}
function needVectors(ctx: TestContext): h.Vectors {
  needToolchain(ctx, generated);
  if (vectors instanceof Error) throw vectors;
  return vectors;
}
function expectStandardAxioms(r: h.Ran, theorem: string): void {
  const axioms = h.axiomsOf(r, theorem);
  expect(axioms, `the lane prints one line "AXIOMS ${theorem}: …"\n${h.shown(r)}`).not.toBeNull();
  expect(axioms!.filter((a) => !h.STANDARD_AXIOMS.includes(a)), `${theorem} rests only on propext, Quot.sound and Classical.choice`).toEqual([]);
}

describe('AC1 the lane builds the model and prints each property theorem\'s axioms', () => {
  it('AC1 on the model, the lane passes and prints the axioms of each of the five property theorems, each only propext, Quot.sound or Classical.choice', (ctx) => {
    needToolchain(ctx, lane);
    expect(lane.status, h.shown(lane)).toBe(0);
    expect(h.problemLines(lane), h.shown(lane)).toEqual([]);
    for (const theorem of h.PROPERTY_THEOREMS) expectStandardAxioms(lane, theorem);
  });
});

describe('AC1 and AC2 planted wrong models fail the lane', () => {
  let control: h.Ran;
  beforeAll(() => {
    control = h.runNode([h.LANE_SCRIPT], h.scratchCopy('control', { toolchain: true }));
  }, LONG);
  /** Plants one wrong model in a fresh scratch copy and runs the lane there. */
  function planted(ctx: TestContext, label: string, keyword: 'def' | 'theorem', name: string, text: (a: h.Anchor) => string): { r: h.Ran; dir: string } {
    needToolchain(ctx, control);
    expect(control.status, `the unplanted scratch copy passes the lane, so a failure below comes from the plant\n${h.shown(control)}`).toBe(0);
    const dir = h.scratchCopy(label, { toolchain: true });
    h.plant(dir, keyword, name, text);
    const r = h.runNode([h.LANE_SCRIPT], dir);
    needToolchain(ctx, r);
    return { r, dir };
  }

  it('AC1 a planted sorry in verdict_closed\'s proof fails the lane, naming the theorem and sorryAx, though Lean builds it with only a warning', (ctx) => {
    const { r } = planted(ctx, 'sorry', 'theorem', 'verdict_closed', (a) => `theorem ${a.declared} : type_of% @${a.orig} := sorry`);
    expect(r.status, h.shown(r)).not.toBe(0);
    expect(h.axiomsOf(r, 'Verdicts.verdict_closed') ?? [], `the model built and its axioms were read\n${h.shown(r)}`).toContain('sorryAx');
    expect(h.failLines(r).some((l) => h.mentions(l, 'verdict_closed') && l.includes('sorryAx')), `a FAIL line names verdict_closed and sorryAx\n${h.shown(r)}`).toBe(true);
  }, LONG);

  it('AC1 a planted axiom used by verdict_rises fails the lane, naming the theorem and the axiom', (ctx) => {
    const { r } = planted(ctx, 'axiom', 'theorem', 'verdict_rises', (a) =>
      `axiom ${a.prefix}planted_axiom_684 : False\n\ntheorem ${a.declared} : type_of% @${a.orig} := Verdicts.planted_axiom_684.elim`);
    expect(r.status, h.shown(r)).not.toBe(0);
    expect(h.failLines(r).some((l) => h.mentions(l, 'verdict_rises') && l.includes('planted_axiom_684')), `a FAIL line names verdict_rises and planted_axiom_684\n${h.shown(r)}`).toBe(true);
  }, LONG);

  const WRONG: readonly (readonly [string, string, 'def', string, (a: h.Anchor) => string])[] = [
    ['pending ranked below PASS', 'rank', 'def', 'rank', (a) =>
      `def ${a.declared} : type_of% @${a.orig} := fun r => match r with\n  | .pending => 0\n  | .PASS => 1\n  | r => ${a.orig} r`],
    ['"ran nothing" raising a PASS row', 'ran-nothing', 'def', 'Row.result', (a) =>
      `def ${a.declared} : type_of% @${a.orig} := fun w => match w with\n  | .ran_nothing => .PASS\n  | w => ${a.orig} w`],
    ['a count that reads only the first run record', 'first-record', 'def', 'verdict', (a) => [
      `def ${a.prefix}firstRecords684 (rs : List Verdicts.Run) : List Verdicts.Run :=`,
      '  rs.foldl (fun (acc : List Verdicts.Run) (r : Verdicts.Run) => if acc.any (fun s => s.id == r.id) then acc else acc ++ [r]) ([] : List Verdicts.Run)',
      '',
      `def ${a.declared} : type_of% @${a.orig} := fun cl => ${a.orig} { cl with runs := Verdicts.firstRecords684 cl.runs }`,
    ].join('\n')],
  ];
  for (const [title, label, keyword, name, text] of WRONG) {
    it(`AC2 a planted wrong model, ${title}, fails the lane at a named theorem or lemma`, (ctx) => {
      const { r, dir } = planted(ctx, label, keyword, name, text);
      expect(r.status, h.shown(r)).not.toBe(0);
      const named = h.failLines(r).filter((l) => h.namesTheorem(l, dir));
      expect(named.length, `a FAIL line names a theorem or lemma of the model\n${h.shown(r)}`).toBeGreaterThan(0);
    }, LONG);
  }
});

describe('AC3 the engine equals the model on the generated vectors', () => {
  it(`AC3 on ${COUNT.toLocaleString('en-US')} vectors from a seed drawn in this run, the engine equals the model, and every one of the model's rows applies in some vector`, (ctx) => {
    const { header, vectors: all } = needVectors(ctx);
    expect(all.length).toBeGreaterThanOrEqual(10_000);
    const rows = h.modelRows(h.ROOT);
    expect([...header.rows].sort(), 'the header lists the rows of the model\'s inductive Row').toEqual([...rows].sort());
    expect([...new Set(all.flatMap((v) => v.rows))].filter((r) => !rows.includes(r)), 'every row a vector names is a row of the model').toEqual([]);
    const counts = h.rowCounts(rows, all);
    console.log(`AC3 seed ${SEED}: ${all.length} vectors; rows applied: ${[...counts].map(([r, n]) => `${r} ${n}`).join(', ')}`);
    expect(h.rowGaps(SEED, rows, all)).toEqual([]);
    const missing = h.SHAPES.filter(([, holds]) => !all.some((v) => holds(v.claim))).map(([what]) => what);
    expect(missing, 'the vectors hold each row the reference of #28 misses, and the two the engine fixes').toEqual([]);
    expect(h.agreement(SEED, all, verdict)).toBeNull();
  }, LONG);

  it('AC3 the agreement test fails, naming the row and the seed, when one of the model\'s rows applies in no vector', (ctx) => {
    const { vectors: all } = needVectors(ctx);
    const rows = h.modelRows(h.ROOT);
    const counts = h.rowCounts(rows, all);
    const rarest = [...counts].filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1])[0];
    expect(rarest, 'some row applies').toBeDefined();
    const without = all.filter((v) => !v.rows.includes(rarest![0]));
    expect(h.rowGaps(SEED, rows, without)).toEqual([`row ${rarest![0]} applies in no vector of seed ${SEED}`]);
  }, LONG);

  it('AC3 the vectors are seeded and come from the model: a seed prints the same vectors each time, another seed others, and a copy with no engine source prints the same', (ctx) => {
    const once = h.generate(h.ROOT, SEED, 200);
    needToolchain(ctx, once);
    expect(once.status, h.shown(once)).toBe(0);
    expect(h.readVectors(once, SEED, 200).vectors).toHaveLength(200);
    expect(h.generate(h.ROOT, SEED, 200).stdout, `seed ${SEED} replays`).toBe(once.stdout);
    const other = (SEED + 1) % 2 ** 31;
    expect(h.readVectors(h.generate(h.ROOT, other, 200), other, 200).vectors.map((v) => JSON.stringify(v)), `seed ${other} differs`)
      .not.toEqual(h.readVectors(once, SEED, 200).vectors.map((v) => JSON.stringify(v)));
    const alone = h.generate(h.scratchCopy('no-engine', { toolchain: true, engine: false }), SEED, 200);
    expect(alone.stdout, `the generator reads nothing under ${h.ENGINE_SRC}\n${h.shown(alone)}`).toBe(once.stdout);
  }, LONG);

  for (let low = 0; low < h.PRECEDENCE.length - 1; low++) {
    const [a, b] = [h.PRECEDENCE[low]!, h.PRECEDENCE[low + 1]!];
    it(`AC3 a copy of the engine that swaps the ranks of ${a} and ${b} disagrees with the model on at least one vector, and the failure names its seed`, async (ctx) => {
      const { vectors: all } = needVectors(ctx);
      expect(h.agreement(SEED, all, verdict), 'the engine itself agrees').toBeNull();
      const twin = await h.engineWithSwap(low);
      const diff = h.agreement(SEED, all, twin);
      console.log(`AC3 ${a}<->${b} twin: ${diff ?? 'agrees on every vector'}`);
      expect(diff, `the ${a}<->${b} twin agrees with the model on all ${all.length} vectors of seed ${SEED}`).not.toBeNull();
      expect(diff).toContain(`seed ${SEED}`);
    }, LONG);
  }
});

describe('AC4 a planted engine row the model doesn\'t have', () => {
  it('AC4 an engine with one more row, and no model edit, fails the agreement test, naming a vector where the two differ', (ctx) => {
    const { vectors: all } = needVectors(ctx);
    // The planted row: a check whose counted runs hold exactly one passed run is INVALID ("one clean run is too few").
    const INVALID: Result = 'INVALID';
    const raise = (r: Result): Result => (h.rankOf(r) < h.rankOf(INVALID) ? INVALID : r);
    const plantedEngine = (c: ClaimInput) => {
      const v = verdict(c);
      const hit = new Set(v.checks.filter((k) => k.counted.filter((id) => c.runs.some((r) => r.run === id && r.outcome === 'passed')).length === 1).map((k) => k.check));
      if (!hit.size) return v;
      return { ...v, outcome: raise(v.outcome), checks: v.checks.map((k) => (hit.has(k.check) ? { ...k, outcome: raise(k.outcome) } : k)) };
    };
    expect(h.agreement(SEED, all, verdict), 'the engine itself agrees').toBeNull();
    const diff = h.agreement(SEED, all, plantedEngine);
    console.log(`AC4 planted row: ${diff ?? 'agrees on every vector'}`);
    expect(diff, 'the agreement test fails').not.toBeNull();
    expect(diff).toMatch(new RegExp(`^seed ${SEED}, vector \\d+ \\(`));
  }, LONG);
});

describe('AC7 the model\'s side of a late run that withdraws a carry', () => {
  it('AC7 the lane proves verdict_rises (inputs fixed) and late_read_stale (a late run whose reads withdraw a carry marks that check stale with no counted run), each on the standard axioms only', (ctx) => {
    needToolchain(ctx, lane);
    expect(lane.status, h.shown(lane)).toBe(0);
    expectStandardAxioms(lane, 'Verdicts.verdict_rises');
    expectStandardAxioms(lane, h.STALE_THEOREM);
  });
});
