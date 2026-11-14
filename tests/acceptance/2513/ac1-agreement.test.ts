// #2513.50c62d71: "On a revision whose kept subject is framed to fill a 1936 × 1584 frame's height (`fit` with `fill` 1
// and `pad` 0), `deep_show`'s snapshot readings and `deep_run`'s render.exposure results on the same revision agree
// within 1e-6; render.exposure's px is the subject's area in the frame within its edge px, and its key EV is the
// subject's grey at the camera's exposure within 0.002 EV. A planted reduction that leaves out the frame's last rows
// counts fewer px and fails, naming the snapshot"
//
// Fixture (helpers.ts `fillDoc`, README: Fixtures): a thin middle grey card, unlit, kept by an orthographic camera's
// `fit` with `fill` 1 and `pad` 0 in a 1936 × 1584 document, so it spans the frame's height, 1584 × 1584 px, with black
// sky on its left and right; exposed a stop under, so its key is −1 EV. In one `deep-show run`: alpha's deep_show of it
// as a whole revision, rendered back with pixels at 1936 × 1584 (the document's own size, the frame render.exposure
// draws); `verdict` on alpha's claim whose one requirement is render.exposure at its defaults (its subject the kept
// card); `revisions` of the document.
//
// asserts:
//   - the verdict judged the revision the snapshot is of: its key names the deep_show reply's `rev` with the hash
//     `revisions` gives that rev;
//   - the judge `judge` finds nothing: each snapshot is 1936 × 1584 px and carries `light` whose clipped, crushed and
//     key_ev are each within 1e-6 of render.exposure's `results` on that revision; render.exposure's `px` is
//     1584 × 1584 within the square's 6336 edge px; its `key_ev` is −1 within 0.002 EV;
//   - planted: under `reduction_leaves_out_last_rows` (the one reduction leaves out the frame's last 16 rows, for the
//     check and the readings alike) render.exposure counts fewer px than the card's area less its edge px, and the
//     same judge fails, every failure naming the snapshot's SHA-256.
// Wrong programs: readings and check measured on two paths that disagree; a reduction that drops rows, columns or
// tiles of the frame (`reduction_leaves_out_last_rows`), counts the whole frame or another item's px, or reads the
// key at another exposure; readings or a check of another revision.
import { describe, expect, it } from 'vitest';
import {
  AREA, EDGE, EXPOSURE, FRAME, SUBJECT, TIMEOUT, brief, claimId, claimOf, docId, exposureOf, fillDoc, hashOf, judge, judgedRevision, none,
  proof, reqId, requireMetal, revisions, run, scenarioOf, show, snapshotsOf, useBuild, useFolders, verdict, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#2513.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#2513.50c62d71';
/** The wrong program the criterion names (README: The planted program). */
const LAST_ROWS = 'reduction_leaves_out_last_rows';
const bin = useBuild();
const folder = useFolders();

const DOC = docId(1);
const cardDoc = fillDoc(SUBJECT, false);
const claims = { [claimId(1)]: claimOf(DOC, reqId(1), EXPOSURE) };
const calls: JsonObject[] = [show(DOC, cardDoc, FRAME), verdict(claimId(1)), revisions(DOC)];
/** The frame-filling revision rendered back and judged by render.exposure in one run, under `planted` if named. */
const judged = (planted?: string) => {
  const [shown, v, revs] = run(bin(), scenarioOf(folder(), [DOC], claims, calls, planted));
  const { row, check } = exposureOf(v!, reqId(1), DOC);
  return { shown: shown!, v: v!, revs: revs!, row, check };
};

describe(`${ID} render.exposure and the snapshot readings share one reduction on a frame-filling subject`, () => {
  it(`${ID} on the revision whose kept card fills the 1936 × 1584 frame's height, the snapshot readings agree with render.exposure within 1e-6, its px is the card's area within its edge px and its key EV the card's grey at the camera's exposure within 0.002 EV`, () => {
    requireMetal('render-back of the frame-filling card');
    const honest = judged();
    // The same revision: the verdict is keyed by the revision the snapshot is of.
    const key = judgedRevision(honest.v, DOC);
    expect(key.rev, `render.exposure judged the revision deep_show minted and rendered back (rev ${brief(honest.shown['rev'])})`).toBe(honest.shown['rev']);
    expect(key.hash, `render.exposure judged revision ${key.rev} by the hash revisions gives it`).toBe(hashOf(honest.revs, key.rev));
    proof('the frame-filling card: snapshot readings beside render.exposure on the same revision', {
      rev: key.rev, hash: key.hash, area: AREA, edge: EDGE,
      snapshots: snapshotsOf(honest.shown, 'deep_show of the frame-filling card'), render_exposure: honest.row,
    });
    none(judge(honest.shown, honest.check, 'deep_show of the frame-filling card'),
      'the snapshot readings agree with render.exposure on the same revision, whose px is the card\'s area and whose key is the card\'s grey at the camera\'s exposure');
  }, TIMEOUT);

  it(`${ID} a planted reduction that leaves out the frame's last rows counts fewer px and fails, naming the snapshot`, () => {
    requireMetal('render-back of the frame-filling card');
    const planted = judged(LAST_ROWS);
    const what = `deep_show of the frame-filling card under ${LAST_ROWS}`;
    const shas = snapshotsOf(planted.shown, what).map((s) => String(s['sha256']));
    const failures = judge(planted.shown, planted.check, what);
    proof(`under ${LAST_ROWS}: render.exposure's numbers and the judge's failures`, { render_exposure: planted.check, failures });
    expect(planted.check.px, `under ${LAST_ROWS} render.exposure counts fewer px than the card's area less its edge px (${AREA} − ${EDGE})`).toBeLessThan(AREA - EDGE);
    expect(failures.length, `under ${LAST_ROWS} the judge fails: ${brief(planted.shown['snapshots'])} against ${brief(planted.check)}`).toBeGreaterThan(0);
    expect(failures.filter((f) => !shas.some((sha) => f.includes(sha))), `under ${LAST_ROWS} every failure names the snapshot (${shas.join(', ')})`).toEqual([]);
  }, TIMEOUT);
});
