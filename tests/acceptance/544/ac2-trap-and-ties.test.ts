// Criterion 2 (no upstream test): "A step that writes 5 shot rows with max_per_step 4 traps with kind occurrences,
// naming shot, the count 5 and the step, while the item's arrays and occurrences keep the last good step's and the
// rest of the piece plays on; a planted module that keeps four rows and drops the fifth reports no trap and fails,
// naming the step; and two rows of one kind with the same a and b, written with payload 2.0 and then 1.0, read in that
// order on macOS, on Linux and after a seek, so a planted list that sorts ties by payload fails, naming the step"
//
// Through `deep-logic` (README: deep-logic): `overfull` (programs.ts) writes 3 shot rows at step 30, 4 at step 60 and 5
// at step 90 under max_per_step 4, and k into `last` every step; `ticker`, a second item, writes k into `n` every
// step. `ties` writes, at step 75, (a 7, b 1, 3.0), (a 2, b 9, 2.0), (a 2, b 9, 1.0), and one row at step 30; it is
// baked on this Mac with a seek to step 80 (from checkpoint 60, so step 75 runs again), and in a linux/amd64 container.
import { describe, expect, it } from 'vitest';
import { AC, STEP_60, TIMEOUT, bakeCall, bakeOf, failsNaming, none, onLinux, onMac, piece, prebuild, rowText, show, type Bake, type JsonObject, type Row } from './helpers.ts';
import { OVERFULL, TIES_WRITTEN, TIE_STEP, TRAP_STEP, overfull, ticker, ties } from './programs.ts';

prebuild(['deep-logic']);

const LAB = 'lab';
const TICKER = 'ticker';
const STEPS = 150;
const overfullPiece = (): JsonObject => piece({
  seed: 544_02,
  items: {
    [LAB]: { program: overfull(), writes: { last: { type: 'i32' } }, emits: { shot: { fields: { power: 'f64' }, max_per_step: 4 } } },
    [TICKER]: { program: ticker(), writes: { n: { type: 'i32' } } },
  },
});
const tiesPiece = (): JsonObject => piece({ seed: 544_02, items: { [LAB]: { program: ties(), emits: { shot: { fields: { power: 'f64' } } } } } });

/**
 * The trap's judgement on a bake of `overfull` and `ticker`: one trap, of kind occurrences, at step 90, naming shot and
 * the count 5; the lab's list holds the rows of steps 30 and 60 and none from step 90 on; its `last` stays 89 from
 * step 90; the ticker steps on to the end. Each failure names the step it is about.
 */
function trapFailures(b: Bake): string[] {
  const failures: string[] = [];
  const at = `step ${TRAP_STEP}, which writes 5 shot rows under max_per_step 4`;
  const traps = b.traps.filter((t) => t['item'] === LAB);
  const trap = traps.find((t) => t['step'] === TRAP_STEP);
  if (!trap) failures.push(`${at}: no trap names step ${TRAP_STEP}; the bake's traps: ${show(b.traps)}`);
  else {
    if (trap['kind'] !== 'occurrences') failures.push(`${at}: the trap's kind is ${show(trap['kind'])}, not occurrences: ${show(trap)}`);
    if (trap['occurrence'] !== 'shot') failures.push(`${at}: the trap doesn't name the kind shot (occurrence: ${show(trap['occurrence'] ?? null)}): ${show(trap)}`);
    if (trap['count'] !== 5) failures.push(`${at}: the trap doesn't name the count 5 (count: ${show(trap['count'] ?? null)}): ${show(trap)}`);
  }
  if (traps.length !== 1) failures.push(`${at}: the lab has ${traps.length} traps, not 1: ${show(traps)}`);
  if (b.traps.some((t) => t['item'] === TICKER)) failures.push(`the ticker trapped too: ${show(b.traps)}`);
  const want: Row[] = Object.entries(OVERFULL).filter(([k]) => Number(k) < TRAP_STEP).flatMap(([k, n]) =>
    Array.from({ length: n }, (_, i) => ({ step: Number(k), t: Number(k) * STEP_60, kind: 'shot', a: Number(k), b: i, fields: { power: Number(k) } })));
  const rows = b.occurrences[LAB];
  if (!rows) failures.push(`${at}: the bake has no occurrence list for ${LAB}`);
  else {
    const got = rows.map(rowText);
    const at90 = rows.filter((r) => r.step >= TRAP_STEP);
    if (at90.length) failures.push(`${at}: the list holds ${at90.length} rows from step ${TRAP_STEP} on (it keeps the last good step's): ${at90.map(rowText).join('; ')}`);
    if (JSON.stringify(got) !== JSON.stringify(want.map(rowText))) failures.push(`${at}: the list is not the 7 rows of steps 30 and 60: ${got.join('; ')}`);
  }
  for (const s of b.steps) {
    const last = s.arrays[`${LAB}.last`]?.[0];
    const want = Math.min(s.step, TRAP_STEP - 1);
    if (last !== want) failures.push(`step ${s.step}: ${LAB}.last is ${show(last ?? null)}, not ${want}${s.step >= TRAP_STEP ? ` (the last good step's, step ${TRAP_STEP - 1})` : ''}`);
    if (s.step >= TRAP_STEP && s.items[LAB]?.failed !== true) failures.push(`step ${s.step}: ${LAB} isn't marked failed after the trap at step ${TRAP_STEP}`);
    const n = s.arrays[`${TICKER}.n`]?.[0];
    if (n !== s.step || s.items[TICKER]?.failed || !s.items[TICKER]?.hash) failures.push(`step ${s.step}: the rest of the piece doesn't play on: ${TICKER}.n is ${show(n ?? null)}, its step ${show(s.items[TICKER] as unknown as JsonObject)}`);
  }
  if (b.steps.length !== STEPS) failures.push(`the bake reports ${b.steps.length} steps, not ${STEPS}: the piece stops`);
  return failures;
}

/** The tie order's judgement on a list: step 75's rows read (2, 9, 2.0), (2, 9, 1.0), (7, 1, 3.0). Each failure names the step. */
const TIES_SORTED: [number, number, number, number][] = [TIES_WRITTEN[0]!, TIES_WRITTEN[2]!, TIES_WRITTEN[3]!, TIES_WRITTEN[1]!];
function tieFailures(rows: Row[] | undefined, where: string): string[] {
  if (!rows) return [`${where}: no occurrence list for ${LAB}, so step ${TIE_STEP}'s tied rows can't be read`];
  const want = TIES_SORTED.map(([k, a, b, p]) => rowText({ step: k, t: k * STEP_60, kind: 'shot', a, b, fields: { power: p } }));
  const got = rows.map(rowText);
  if (JSON.stringify(got) === JSON.stringify(want)) return [];
  const tied = rows.filter((r) => r.step === TIE_STEP && r.a === 2 && r.b === 9).map((r) => r.fields['power'] ?? null);
  return [`${where}: at step ${TIE_STEP} the rows don't read sorted by (step, kind, a, b) with the tie (a 2, b 9) in the order written, 2.0 then 1.0 (the tie reads ${show(tied)}): ${got.join('; ')}`];
}

describe(`${AC[2]} a step over its cap traps rather than dropping a row, and tied rows keep the order they were written in`, () => {
  it(`${AC[2]} a step that writes 5 shot rows with max_per_step 4 traps with kind occurrences, naming shot, 5 and step ${TRAP_STEP}; the item keeps its last good step's arrays and rows, and the rest of the piece plays on`, () => {
    const [reply] = onMac([bakeCall(overfullPiece(), { steps: STEPS })]);
    none(trapFailures(bakeOf(reply!, 'the bake of overfull and ticker, overfull declaring emits {shot: {fields: {power: f64}, max_per_step: 4}}')), 'the fifth row traps');
  }, TIMEOUT);

  it(`${AC[2]} a planted module that keeps four rows and drops the fifth (occurrences_keep_cap) reports no trap and fails, naming step ${TRAP_STEP}`, () => {
    const [clean] = onMac([bakeCall(overfullPiece(), { steps: STEPS })]);
    none(trapFailures(bakeOf(clean!, 'the bake of overfull and ticker')), 'the fifth row traps');
    const [planted] = onMac([bakeCall(overfullPiece(), { steps: STEPS })], 'occurrences_keep_cap');
    const b = bakeOf(planted!, 'the bake with occurrences_keep_cap');
    expect(b.traps.filter((t) => t['item'] === LAB), 'the planted module reports no trap').toEqual([]);
    failsNaming(trapFailures(b), new RegExp(`\\bstep ${TRAP_STEP}\\b`), 'occurrences_keep_cap');
  }, TIMEOUT);

  it(`${AC[2]} two shot rows with the same a and b, written 2.0 then 1.0, read in that order on macOS and after a seek; a planted list that sorts ties by payload (occurrences_sort_ties_by_payload) fails, naming step ${TIE_STEP}`, () => {
    const spec = { steps: STEPS, seeks: [{ to: 80 }] };
    const [reply] = onMac([bakeCall(tiesPiece(), spec)]);
    const b = bakeOf(reply!, 'the bake of ties on this Mac, ties declaring emits {shot: {fields: {power: f64}}}');
    none(tieFailures(b.occurrences[LAB], 'on macOS'), 'the tie reads 2.0 then 1.0 on macOS');
    const seek = b.seeks.find((s) => s.to === 80);
    expect(seek, 'the bake answers the seek to step 80').toBeDefined();
    expect(seek!.from, 'the seek restores checkpoint 60, so step 75 runs again').toBe(60);
    none(tieFailures(seek!.occurrences[LAB], 'after a seek to step 80'), 'the tie reads 2.0 then 1.0 after a seek');
    const [planted] = onMac([bakeCall(tiesPiece(), spec)], 'occurrences_sort_ties_by_payload');
    failsNaming(tieFailures(bakeOf(planted!, 'the bake with occurrences_sort_ties_by_payload').occurrences[LAB], 'with ties sorted by payload'), new RegExp(`\\bstep ${TIE_STEP}\\b`), 'occurrences_sort_ties_by_payload');
  }, TIMEOUT);

  it(`${AC[2]} the same tie reads 2.0 then 1.0 on Linux x86_64, played and after a seek`, () => {
    const spec = { steps: STEPS, seeks: [{ to: 80 }] };
    const [mac] = onMac([bakeCall(tiesPiece(), spec)]);
    none(tieFailures(bakeOf(mac!, 'the bake of ties on this Mac').occurrences[LAB], 'on macOS'), 'the tie reads 2.0 then 1.0 on macOS');
    const [linux] = onLinux([bakeCall(tiesPiece(), spec)]);
    const b = bakeOf(linux!, 'the bake of ties on linux/amd64');
    none(tieFailures(b.occurrences[LAB], 'on Linux x86_64'), 'the tie reads 2.0 then 1.0 on Linux');
    none(tieFailures(b.seeks.find((s) => s.to === 80)?.occurrences[LAB], 'on Linux x86_64 after a seek to step 80'), 'the tie reads 2.0 then 1.0 on Linux after a seek');
  }, TIMEOUT);
});
