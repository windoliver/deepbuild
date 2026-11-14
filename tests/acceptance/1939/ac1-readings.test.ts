// #1939.398baf58: "On the planted under-exposure fixture, `deep_show` with pixels returns, for its snapshot, the clipped
// share, crushed share and key EV that `deep_run`'s `render.exposure` returns on the same revision, each within 1e-6;
// on the clean twin key EV lies in [−0.5, 0.5]. A planted reply that measures the whole frame instead of the kept
// subject differs from the check and fails, naming the snapshot"
//
// Fixtures (helpers.ts `lightDoc`, README: Fixtures): the kept grey cube beside a pale prop under a black sky, its
// camera three stops under (the planted under-exposure fixture) or at scale 1 (the clean twin); they differ only by the
// camera's exposure. In one `deep-show run`: alpha's deep_show of each as a whole revision, rendered back with pixels
// at the document's own size; `verdict` on alpha's claim whose one requirement is render.exposure at its defaults (its
// subject the kept items) on the under-exposed document; `revisions` of that document.
//
// asserts:
//   - the verdict judged the revision the snapshot is of: its key names the deep_show reply's `rev` with the hash
//     `revisions` gives that rev; render.exposure reads the fixture under-exposed (key_ev under −0.5, row FAIL);
//   - each snapshot of the under-exposed revision carries `light` {clipped, crushed, key_ev}, each within 1e-6 of
//     render.exposure's `results` on that revision (the judge `readingFailures`, whose failures name the snapshot);
//   - the clean twin's snapshot carries readings, its key_ev in [−0.5, 0.5];
//   - planted: under `light_from_whole_frame` (readings measured over every px of the frame, everything else as
//     shipped) the same calls give readings the judge fails, every failure naming the snapshot's SHA-256.
// Wrong programs: the base (no readings on a snapshot); readings from another measure, another draw, the whole frame
// or every drawn item instead of the kept subject (`light_from_whole_frame`); readings from another revision.
import { describe, expect, it } from 'vitest';
import {
  DOC_SIZE, EXPOSURE, SUBJECT, TIMEOUT, UNDER_EV100, UNIT_EV100, brief, claimId, claimOf, docId, exposureOf, hashOf, judgedRevision, lightDoc,
  lightOf, none, proof, readingFailures, reqId, requireMetal, revisions, run, scenarioOf, show, snapshotsOf, useBuild, useFolders, verdict,
  type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#1939.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1939.398baf58';
/** The wrong program the criterion names (README: Assumed surfaces 3). */
const WHOLE_FRAME = 'light_from_whole_frame';
const bin = useBuild();
const folder = useFolders();

describe(`${ID} each snapshot deep_show returns with pixels carries render.exposure's numbers for the kept subject`, () => {
  it(`${ID} the under-exposure fixture's snapshot reads render.exposure's clipped share, crushed share and key EV on the same revision within 1e-6, the clean twin's key EV lies in [−0.5, 0.5], and a reply measured over the whole frame fails, naming its snapshot`, () => {
    requireMetal('render-back of the kept cube');
    const [under, twin] = [docId(1), docId(2)];
    const docs = { [under]: lightDoc({ ev100: UNDER_EV100, keep: SUBJECT, size: DOC_SIZE, standIn: false }), [twin]: lightDoc({ ev100: UNIT_EV100, keep: SUBJECT, size: DOC_SIZE, standIn: false }) };
    const claims = { [claimId(1)]: claimOf(under, reqId(1), EXPOSURE) };
    const calls: JsonObject[] = [show(under, docs[under]!, DOC_SIZE), show(twin, docs[twin]!, DOC_SIZE), verdict(claimId(1)), revisions(under)];
    const judged = (planted?: string) => {
      const [shown, twinShown, v, revs] = run(bin(), scenarioOf(folder(), [under, twin], claims, calls, planted));
      const { row, check } = exposureOf(v!, reqId(1), under);
      return { shown: shown!, twinShown: twinShown!, v: v!, revs: revs!, row, check };
    };

    const honest = judged();
    // The same revision: the verdict is keyed by the revision the snapshot is of.
    const rev = honest.shown['rev'];
    const key = judgedRevision(honest.v, under);
    expect(key.rev, `render.exposure judged the revision deep_show minted and rendered back (rev ${brief(rev)})`).toBe(rev);
    expect(key.hash, `render.exposure judged revision ${key.rev} by the hash revisions gives it`).toBe(hashOf(honest.revs, key.rev));
    // The planted fixture is under-exposed by the check's own measure.
    expect(honest.check.key_ev, `render.exposure reads the planted fixture's key under −0.5 EV: ${brief(honest.row, 1500)}`).toBeLessThan(-0.5);
    expect(honest.row['result'], `render.exposure fails the planted under-exposure fixture: ${brief(honest.row, 1500)}`).toBe('FAIL');
    proof('the under-exposure fixture: snapshot readings beside render.exposure on the same revision', {
      rev: key.rev, hash: key.hash,
      snapshots: snapshotsOf(honest.shown, 'deep_show of the under-exposed cube'), render_exposure: honest.row,
    });
    none(readingFailures(honest.shown, honest.check, 'deep_show of the under-exposed cube'),
      'each snapshot of the under-exposed revision reads render.exposure\'s clipped share, crushed share and key EV on that revision, within 1e-6');

    // The clean twin: its key EV lies in [−0.5, 0.5].
    const twinSnaps = snapshotsOf(honest.twinShown, 'deep_show of the cube at middle grey');
    expect(twinSnaps.length, 'the clean twin is rendered back with pixels').toBeGreaterThan(0);
    proof('the clean twin: snapshot readings', twinSnaps);
    for (const s of twinSnaps) {
      const l = lightOf(s);
      expect(l, `the clean twin's snapshot ${String(s['sha256'])} carries readings: ${brief(s, 600)}`).not.toBeNull();
      expect(l!.key_ev >= -0.5 && l!.key_ev <= 0.5, `the clean twin's snapshot ${String(s['sha256'])} reads key EV ${l!.key_ev}, in [−0.5, 0.5]`).toBe(true);
    }

    // Wrong program: readings over the whole frame differ from the check, and the judge fails, naming the snapshot.
    const planted = judged(WHOLE_FRAME);
    const shas = snapshotsOf(planted.shown, `deep_show of the under-exposed cube under ${WHOLE_FRAME}`).map((s) => String(s['sha256']));
    const failures = readingFailures(planted.shown, planted.check, `deep_show of the under-exposed cube under ${WHOLE_FRAME}`);
    proof(`under ${WHOLE_FRAME}: the judge's failures`, failures);
    expect(failures.length, `under ${WHOLE_FRAME} the snapshot's readings differ from render.exposure's: ${brief(planted.shown['snapshots'])} against ${brief(planted.check)}`).toBeGreaterThan(0);
    expect(failures.filter((f) => !shas.some((sha) => f.includes(sha))), `under ${WHOLE_FRAME} every failure names the snapshot (${shas.join(', ')})`).toEqual([]);
  }, TIMEOUT);
});
