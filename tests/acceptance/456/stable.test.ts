// #456.b4b19f96: "The ID view of one revision, view, size and t has the same pixel hash on every run on one machine, and
// no requirement passes on render.review with or without its observations, checked by a fixture that tries"
//
// Fixture (helpers.ts): the review room, its one revision, drawn through its own camera at 320 × 240 px and t = 0. The
// claim has two render.review requirements: `grounded` (`grounding: ids`, so the model gets the ID view and its
// observations count) and `ungrounded` (`grounding: none`, no ID view, no observations). Two `deep-show run`
// processes review it, the stub model answering, in requirement order:
//   - run A: `TRIES_TO_PASS` for both (every ask yes, nothing found, a claimed PASS);
//   - run B: for `grounded`, every ask yes with two observations naming items by run A's numbers (missing_item on the
//     lantern, exposure_tone on the globe), and a claimed PASS; for `ungrounded`, `TRIES_TO_PASS`.
// asserts:
//   - the grounded reading's ID view is a PNG in the evidence store at the snapshot's size, and runs A and B give it
//     the same SHA-256 and the same pixel hash (its RGBA bytes), whatever the model answered;
//   - run B's grounded reading keeps its observations, so "with its observations" is tried;
//   - no row and no verdict is PASS, in either run.
// Wrong programs: the base (no reading, no ID view); `id_view_varies_by_run` (the ID view's colours come from each
// item's ID hash salted by a value each process draws afresh); `review_passes_on_yes` (a model that answers yes to
// every ask and finds nothing passes the requirement).
import { describe, it } from 'vitest';
import {
  HIDDEN, ROOM_DOC, SIZE, TIMEOUT, TRIES_TO_PASS, brief, caught, claimId, claimOf, evidencePng, idViewOf, listOf, none, numberOf, pixelHash, proof,
  readingOf, requireMetal, reqId, review, reviewRoom, rowOf, run, scenarioOf, useBuild, useFolders, verdict, type IdView, type JsonObject, type Reply,
} from './helpers.ts';

/** The criterion's ID: `#456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#456.b4b19f96';
const bin = useBuild();
const folder = useFolders();

const CLAIM = claimId(4);
const [GROUNDED, UNGROUNDED] = [reqId(41), reqId(42)];
const CLAIMS = { [CLAIM]: claimOf(ROOM_DOC, [[GROUNDED, review('ids')], [UNGROUNDED, review('none')]]) };
const withObservations = (view: IdView): Reply => ({
  ...TRIES_TO_PASS,
  observations: [
    { category: 'missing_item', item: numberOf(view, HIDDEN, 'run A'), words: 'The kept lantern is missing.' },
    { category: 'exposure_tone', item: numberOf(view, 'globe', 'run A'), words: 'The globe reads a little dark.' },
  ],
});

/** One run: the grounded reading and its ID view (decoded from the store), and why any row or the verdict passes. */
function review2(replies: Reply[], planted?: string): { reading: JsonObject; view: IdView; pixels: string; passes: string[] } {
  const evidence = folder();
  const [v] = run(bin(), scenarioOf(evidence, { [ROOM_DOC]: reviewRoom() }, CLAIMS, [verdict(CLAIM)], { replies, ...(planted ? { planted } : {}) }));
  const passes: string[] = [];
  for (const req of [GROUNDED, UNGROUNDED]) {
    const row = rowOf(v!, req, `render.review (${req === GROUNDED ? 'grounding: ids' : 'grounding: none'})`);
    if (row.result === 'PASS') passes.push(`render.review with grounding ${req === GROUNDED ? 'ids' : 'none'} PASSes: ${brief(row.raw, 800)}`);
  }
  if (v!['result'] === 'PASS') passes.push(`the claim's verdict PASSes on render.review alone: ${brief(v, 800)}`);
  const what = `render.review with grounding: ids${planted ? `, under ${planted}` : ''}`;
  const reading = readingOf(rowOf(v!, GROUNDED, what), what);
  const view = idViewOf(reading, what);
  const png = evidencePng(evidence, view.sha256);
  if (typeof png === 'string') return { reading, view, pixels: `(no picture: ${png})`, passes };
  if (png.w !== SIZE[0] || png.h !== SIZE[1]) passes.push(`${what}: the ID view's PNG is ${png.w} × ${png.h}, not the snapshot's ${SIZE[0]} × ${SIZE[1]}`);
  return { reading, view, pixels: pixelHash(png), passes };
}
/** Why two runs' ID views differ; empty when they are the same picture. */
const differ = (a: ReturnType<typeof review2>, b: ReturnType<typeof review2>): string[] =>
  a.view.sha256 === b.view.sha256 && a.pixels === b.pixels && !a.pixels.startsWith('(')
    ? []
    : [`the ID view of one revision, view, size and t differs between runs: SHA-256 ${a.view.sha256} then ${b.view.sha256}, pixels ${a.pixels} then ${b.pixels}`];

describe(`${ID} the ID view is the same picture on every run, and render.review passes nothing with or without its observations`, () => {
  it(`${ID} two runs of one revision, view, size and t draw one ID view by pixel hash, and neither a model that finds nothing nor one whose observations count passes a requirement`, () => {
    requireMetal('the review room');
    const a = review2([TRIES_TO_PASS, TRIES_TO_PASS]);
    const b = review2([withObservations(a.view), TRIES_TO_PASS]);
    const failures = [...a.passes, ...b.passes, ...differ(a, b)];
    if (listOf(b.reading, 'observations', 'run B').length === 0) failures.push(`run B's grounded reading keeps no observation of the two its model made: ${brief(b.reading, 1500)}`);
    none(failures, 'one ID view by pixel hash, and no requirement passes on render.review');
    proof('the ID view on two runs', { sha256: a.view.sha256, pixels: a.pixels, again: b.view.sha256 });

    const c = review2([TRIES_TO_PASS, TRIES_TO_PASS], 'id_view_varies_by_run');
    const d = review2([TRIES_TO_PASS, TRIES_TO_PASS], 'id_view_varies_by_run');
    caught(differ(c, d), 'id_view_varies_by_run', 'the ID view across two runs');
    caught(review2([TRIES_TO_PASS, TRIES_TO_PASS], 'review_passes_on_yes').passes, 'review_passes_on_yes', 'render.review that tries to pass');
  }, TIMEOUT);
});
