// #456.58ad7293: "With grounding: ids, the ID view numbers each item in render-back's ID table at its visible centre and
// lists a kept item hidden behind a wall under a number with no mark; a stub model's observation naming that number as
// missing_item reaches the reading with the hidden item's ID, kind and material, and an observation with no number,
// number 99 in a view of 12, or a category outside observe is dropped, and dropped reads 3"
//
// Fixture (helpers.ts): the review room: ten items that show, each whole and alone in a cell of a 4 × 3 grid, a wall in
// the last cell, and the lantern, a kept item (render.review's `keep`), 1.2 m behind the wall, so no pixel shows it.
// Render-back's ID table holds these twelve and nothing else; the claim's one requirement is render.review with
// `grounding: ids`.
// The first run learns the ID view's numbers (its model finds nothing). The second run reviews again, its model
// answering four observations: missing_item on the lantern's number; missing_item with no number; extra_item on number
// 99; and `glare`, a category outside observe, on the wall's number. In the same run render-back probes the revision
// on a 16 px grid (300 probes) and at each mark, and each item's visible centre is taken as the mean of the grid
// probes whose nearest hit is that item.
// asserts:
//   - the ID view, beside the snapshot at its size, numbers exactly the twelve items, 99 not among them, each number
//     resolving to the item's ID, kind and material; the lantern's number has no mark (`at: null`); every other item's
//     mark is on that item (the probe there hits it first) and within one grid step (16 px) of its visible centre;
//   - the reading's observations are exactly one: missing_item, the lantern's number, with the lantern's ID, kind
//     (mark.sphere@1) and material (lantern-mat); `dropped` is 3.
// Fixture check: no grid probe hits the lantern first (it is hidden), and the second run numbers the lantern and the
// wall as the first did.
// Wrong programs: the base (no reading); `keeps_bad_observation` (an observation with no number, or a number the ID
// view doesn't list, is kept, not dropped).
import { describe, expect, it } from 'vitest';
import {
  HIDDEN, ROOM, ROOM_CLAIM, ROOM_DOC, ROOM_REVIEW, SIZE, TIMEOUT, WALL, brief, caught, doubts, idViewOf, isObject, listOf, none, numberOf, proof,
  readingOf, renderBack, requireMetal, reviewRoom, roomClaim, roomView, rowOf, run, scenarioOf, useBuild, useFolders, verdict,
  type IdView, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#456.58ad7293';
const bin = useBuild();
const folder = useFolders();

const STEP = 16;
const GRID: [number, number][] = [];
for (let y = STEP / 2; y < SIZE[1]; y += STEP) for (let x = STEP / 2; x < SIZE[0]; x += STEP) GRID.push([x, y]);
/** render-back takes at most 64 probes a call. */
const chunks = <T>(list: readonly T[], n = 60): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, k) => list.slice(k * n, (k + 1) * n));

/** The four observations of the second run, naming the lantern and the wall by the numbers the first run learned. */
const observations = (view: IdView): JsonObject[] => [
  { category: 'missing_item', item: numberOf(view, HIDDEN, 'the first run'), words: 'The lantern the brief keeps is nowhere in the frame.' },
  { category: 'missing_item', words: 'Something seems to be missing.' },
  { category: 'extra_item', item: 99, words: 'There is an extra thing at the edge.' },
  { category: 'glare', item: numberOf(view, WALL, 'the first run'), words: 'The wall glares.' },
];

/** Why an ID view breaks the criterion's numbering; empty when it holds. */
function numbering(view: IdView): string[] {
  const failures: string[] = [];
  if (view.w !== SIZE[0] || view.h !== SIZE[1]) failures.push(`the ID view is ${view.w} × ${view.h}, not the snapshot's ${SIZE[0]} × ${SIZE[1]}`);
  const ns = view.numbers.map((x) => x.n);
  if (!ns.every((n) => Number.isInteger(n) && n >= 0) || new Set(ns).size !== ns.length) failures.push(`the ID view's numbers aren't distinct whole numbers: ${ns.join(', ')}`);
  if (ns.includes(99)) failures.push('the ID view lists number 99');
  const ids = view.numbers.map((x) => x.id).sort();
  const want = ROOM.map((t) => t.id).sort();
  if (ids.join() !== want.join()) failures.push(`the ID view numbers ${ids.join(', ')}, not the twelve items of render-back's ID table ${want.join(', ')}`);
  for (const t of ROOM) {
    const x = view.numbers.find((y) => y.id === t.id);
    if (x && (x.kind !== t.kind || x.material !== t.material)) failures.push(`number ${x.n} resolves to ${t.id}, ${x.kind}, ${x.material}, not ${t.kind}, ${t.material}`);
    if (x && t.id !== HIDDEN && (x.at === null || x.at[0] < 0 || x.at[1] < 0 || x.at[0] >= SIZE[0] || x.at[1] >= SIZE[1])) failures.push(`number ${x.n} (${t.id}), which shows, has no mark in the frame: ${brief(x.at)}`);
  }
  const hidden = view.numbers.find((x) => x.id === HIDDEN);
  if (hidden && hidden.at !== null) failures.push(`the hidden lantern's number ${hidden.n} has a mark at ${brief(hidden.at)}, not none`);
  return failures;
}
/** Why a reading's observations break the criterion; empty when it holds. */
function dropping(reading: JsonObject, lantern: number, what: string): string[] {
  const failures: string[] = [];
  const kept = listOf(reading, 'observations', what);
  const want = { category: 'missing_item', item: lantern, id: HIDDEN, kind: 'mark.sphere@1', material: 'lantern-mat' };
  const ok = kept.length === 1 && Object.entries(want).every(([k, v]) => kept[0]![k] === v);
  if (!ok) failures.push(`${what}: the reading keeps ${brief(kept)}, not exactly ${brief(want)}`);
  if (reading['dropped'] !== 3) failures.push(`${what}: dropped reads ${brief(reading['dropped'])}, not 3`);
  return failures;
}

describe(`${ID} the ID view numbers every item at its visible centre and a hidden kept item with no mark, and observations outside it are dropped`, () => {
  it(`${ID} the hidden lantern's number reaches the reading as its ID, kind and material, and the observations with no number, number 99 and a category outside observe are dropped, three of them`, () => {
    requireMetal('the review room');
    const first = roomView(bin(), folder());
    none(numbering(first), "the ID view numbers render-back's ID table and the hidden lantern");
    const lantern = numberOf(first, HIDDEN, 'the first run');
    const replies = [doubts(observations(first))];

    const grid = chunks(GRID);
    const marks = first.numbers.filter((x) => x.at !== null).map((x) => [x, [Math.min(SIZE[0] - 1, Math.floor(x.at![0])), Math.min(SIZE[1] - 1, Math.floor(x.at![1]))] as [number, number]] as const);
    const calls = [verdict(ROOM_CLAIM), ...grid.map((c) => renderBack(ROOM_DOC, 0, c)), renderBack(ROOM_DOC, 0, marks.map(([, p]) => p))];
    const out = run(bin(), scenarioOf(folder(), { [ROOM_DOC]: reviewRoom() }, roomClaim('ids'), calls, { replies }));
    const what = 'render.review of the review room, the model naming four observations';
    const reading = readingOf(rowOf(out[0]!, ROOM_REVIEW, what), what);
    const second = idViewOf(reading, what);
    expect([numberOf(second, HIDDEN, what), numberOf(second, WALL, what)], 'the second run numbers the lantern and the wall as the first did').toEqual([lantern, numberOf(first, WALL, 'the first run')]);

    // Each item's visible centre: the mean of the grid probes whose nearest hit is that item.
    const firstHit = (reply: JsonObject, k: number): string | null => {
      const list = Array.isArray(reply['hits']) ? reply['hits'][k] : undefined;
      const hit = Array.isArray(list) ? list[0] : undefined;
      return isObject(hit) && typeof hit['item'] === 'string' ? hit['item'] : null;
    };
    const seen = new Map<string, [number, number][]>();
    grid.forEach((c, j) => {
      const reply = out[1 + j]!;
      expect(Array.isArray(reply['hits']), `render-back answers its probes with hits: ${brief(reply, 600)}`).toBe(true);
      c.forEach((p, k) => { const id = firstHit(reply, k); if (id) seen.set(id.split('#')[0]!, [...(seen.get(id.split('#')[0]!) ?? []), p]); });
    });
    expect(seen.has(HIDDEN), `the fixture hides the lantern: no grid probe hits it first (${seen.get(HIDDEN)?.length ?? 0} do)`).toBe(false);
    const failures: string[] = [];
    const atMarks = out[1 + grid.length]!;
    marks.forEach(([x], k) => {
      const hit = firstHit(atMarks, k);
      if (hit?.split('#')[0] !== x.id) failures.push(`number ${x.n} (${x.id}) is marked at ${brief(x.at)}, where the nearest hit is ${hit ?? 'nothing'}, not ${x.id}`);
      const ps = seen.get(x.id) ?? [];
      if (ps.length === 0) { failures.push(`number ${x.n} (${x.id}): no grid probe hits ${x.id}`); return; }
      const c = [ps.reduce((s, q) => s + q[0], 0) / ps.length, ps.reduce((s, q) => s + q[1], 0) / ps.length];
      const d = Math.hypot(x.at![0] - c[0]!, x.at![1] - c[1]!);
      if (d > STEP) failures.push(`number ${x.n} (${x.id}) is marked at ${brief(x.at)}, ${d.toFixed(1)} px from its visible centre (${c[0]!.toFixed(1)}, ${c[1]!.toFixed(1)}), more than ${STEP} px`);
    });
    none(failures, "each number's mark is at its item's visible centre");
    none(dropping(reading, lantern, what), 'the lantern reaches the reading, and the three bad observations are dropped');
    proof('the ID view', second as unknown as JsonObject);
    proof('the observations and dropped', { observations: reading['observations']!, dropped: reading['dropped']! });

    const planted = run(bin(), scenarioOf(folder(), { [ROOM_DOC]: reviewRoom() }, roomClaim('ids'), [verdict(ROOM_CLAIM)], { replies, planted: 'keeps_bad_observation' }));
    const p = 'render.review under keeps_bad_observation';
    caught(dropping(readingOf(rowOf(planted[0]!, ROOM_REVIEW, p), p), lantern, p), 'keeps_bad_observation', 'the dropped observations');
  }, TIMEOUT);
});
