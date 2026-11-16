// #1941.2a9a26f0: "A fix whose base revision moved on rebases when no ID it touches changed, and otherwise is refused
// as a conflict naming both writers, leaving the document byte-identical; the rerun names a fresh fix"
//
// Fixture (helpers.ts): the floating vase, a stored document in alpha's layer: a 0.3 × 0.6 × 0.3 m vase centred
// 0.5 m up, its base 0.2 m above the floor. It is the one deliverable of a claim of alpha's whose one requirement is
// the scene audit (the floor may float). Run 1's verdict at revision 0 names the vase's fix F (it lowers the vase onto
// the floor). In each later run the loop first asks again (the verdict at revision 0 names F), then you change the
// document from your own shell (`deep show`, writer `you:you`) on revision 0, making revision 1, and only then does
// alpha send F as a patch on revision 0, whose base has now moved on.
//
// asserts:
//   - rebase: you recolour the floor's material, an ID F doesn't touch. F is applied on top as revision 2, your
//     colour and the vase's new place are both in the document, and the scene audit passes;
//   - conflict: you make the vase 0.8 m tall (its size, a path F doesn't write, on the ID F touches). F is refused
//     with outcome `conflict`, the reply names both writers (alpha and you) and the vase; `read` before and after
//     gives the same revision, the same revision hash (the hash of the canonical bytes) and the same document; the
//     rerun, `verdict` again, judges revision 1 and names a fresh fix: patch ops on the vase that put the taller vase's
//     base on the floor, centre (0, 0.4, 0), where F would put it at (0, 0.3, 0), 0.1 m into the floor; that fix,
//     sent on revision 1 by the vase's writer (you: your patch took the vase into your layer), is applied and the
//     audit passes.
// Wrong programs: `stale_fix_never_rebases` (a stale fix refused even when no ID it touches changed); `rebase_by_path`
// (#138's, already at the base: a stale patch rebases when no path it writes changed, so F lands and sinks the taller
// vase into the floor); `loop_checks_cached_by_doc` (the rerun names the stale F again); a conflict that writes, or
// names one writer.
import { describe, expect, it } from 'vitest';
import {
  AS_ALPHA, AS_YOU, AUDIT, FLOATING, TIMEOUT, VASE, VASE_AT, WRITER, appliedFailures, brief, claimId, claimOf, docId, fixBase, fixOf, holds, isObject,
  judgedRev, namedFix, none, outcome, passFailures, patch, patchId, placed, proof, read, reqId, requireMetal, rowOf, run, same, scenarioOf, shown,
  useBuild, useFolders, verdict, writerKey, type Extra, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#1941.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1941.2a9a26f0';
const bin = useBuild();
const folder = useFolders();

const [DOC, CLAIM, REQ] = [docId(1), claimId(1), reqId(1)];
const CLAIMS = { [CLAIM]: claimOf(DOC, [[REQ, AUDIT]]) };
/** Your change on revision 0 to an ID the vase's fix doesn't touch: the floor's material, a cooler grey. */
const RECOLOUR = [{ op: 'set', id: 'floor-mat', path: 'items/floor-mat/params/base_color', value: [0.3, 0.32, 0.36, 1] }];
/** Your change on revision 0 to the ID the vase's fix touches: the vase made 0.8 m tall, its centre where it was. */
const TALLER = [{ op: 'set', id: VASE, path: `items/${VASE}/params/size`, value: [0.3, 0.8, 0.3] }];

/** Run 1: the scene audit at revision 0 names the vase's fix F, and the revision it judged. */
function staleFix(evidence: string): { ops: JsonObject[]; base: number } {
  const [v] = run(bin(), scenarioOf(evidence, { [DOC]: FLOATING.doc() }, CLAIMS, [verdict(CLAIM)]));
  const { issue, ops } = namedFix(rowOf(v!, REQ, 'the floating vase at revision 0'), FLOATING.fault, 'the scene audit of the floating vase at revision 0');
  return { ops, base: fixBase(issue, judgedRev(v!, DOC) ?? 0) };
}
/** Why the loop's own verdict at revision 0 doesn't name F again. */
function renamedFailures(v: JsonObject, ops: JsonObject[]): string[] {
  const again = fixOf(rowOf(v, REQ, 'the floating vase at revision 0, again'), FLOATING.fault, 'the scene audit at revision 0, again');
  return typeof again !== 'string' && same(again.ops, ops) ? [] : [`the loop's own verdict at revision 0 names another fix than run 1's ${brief(ops)}: ${typeof again === 'string' ? again : brief(again.ops)}`];
}

/** Why `reply` isn't F refused as a conflict naming both writers and the vase. */
function conflictFailures(reply: JsonObject): string[] {
  const out: string[] = [];
  if (outcome(reply) !== 'conflict') out.push(`alpha's fix on revision 0, after you changed the vase, is ${outcome(reply)}, not conflict: ${brief(reply, 1200)}`);
  for (const w of [WRITER.alpha, WRITER.you]) {
    if (!holds(reply, w) && !JSON.stringify(reply).includes(writerKey(w))) out.push(`the conflict doesn't name the writer ${writerKey(w)}: ${brief(reply, 1200)}`);
  }
  if (!holds(reply, VASE)) out.push(`the conflict doesn't name ${VASE}: ${brief(reply, 1200)}`);
  return out;
}

describe(`${ID} a fix whose base revision moved on rebases or is refused as a conflict, and the rerun names a fresh fix`, () => {
  it(`${ID} a fix whose base moved on, where no ID it touches changed, rebases: it applies on top and the check passes`, () => {
    requireMetal('the floating vase');
    const evidence = folder();
    const f = staleFix(evidence);
    const calls = [verdict(CLAIM), patch(AS_YOU, DOC, patchId(1), f.base, RECOLOUR, 'a cooler floor'), patch(AS_ALPHA, DOC, patchId(2), f.base, f.ops), read(DOC), verdict(CLAIM)];
    const [v0, yours, fix, after, v2] = run(bin(), scenarioOf(evidence, { [DOC]: FLOATING.doc() }, CLAIMS, calls));
    proof('the fix rebased', { fix: f.ops, yours: yours!, reply: fix!, verdict: v2! });
    const failures = [...renamedFailures(v0!, f.ops), ...appliedFailures(yours!, 'your recolour of the floor on revision 0'), ...appliedFailures(fix!, "alpha's fix on revision 0 after your recolour")];
    const doc = shown(after!, 'read after the fix').document;
    const items = isObject(doc['items']) ? doc['items'] : {};
    const floor = isObject(items['floor-mat']) && isObject(items['floor-mat']['params']) ? items['floor-mat']['params']['base_color'] : undefined;
    if (!same(floor, RECOLOUR[0]!.value)) failures.push(`your recolour of the floor is gone after the fix rebased: ${brief(items['floor-mat'])}`);
    const vase = isObject(items[VASE]) && isObject(items[VASE]['at']) ? items[VASE]['at']['pos'] : undefined;
    const { at } = placed(f.ops, VASE, VASE_AT.planted);
    if (!same(vase, at)) failures.push(`the vase isn't where the fix put it: ${brief(vase)}, not ${brief(at)}`);
    failures.push(...passFailures(rowOf(v2!, REQ, 'the vase after the rebased fix'), 'the scene audit after the rebased fix'));
    none(failures, 'a fix whose base moved on, where no ID it touches changed, rebases and passes');

    // Wrong program: a stale fix refused even where no ID it touches changed.
    const [, , refused] = run(bin(), scenarioOf(folder(), { [DOC]: FLOATING.doc() }, CLAIMS, calls, { planted: 'stale_fix_never_rebases' }));
    expect(outcome(refused!), 'under stale_fix_never_rebases the fix that touches nothing you changed is not applied').not.toBe('applied');
  }, TIMEOUT);

  it(`${ID} a fix whose base moved on, where an ID it touches changed, is refused as a conflict naming both writers, the document byte-identical, and the rerun names a fresh fix`, () => {
    requireMetal('the floating vase');
    const evidence = folder();
    const f = staleFix(evidence);
    const loop = (extra: Extra = {}): JsonObject[] => run(bin(), scenarioOf(folder(), { [DOC]: FLOATING.doc() }, CLAIMS, [
      verdict(CLAIM), patch(AS_YOU, DOC, patchId(1), f.base, TALLER, 'a taller vase'), read(DOC), patch(AS_ALPHA, DOC, patchId(2), f.base, f.ops), read(DOC), verdict(CLAIM),
    ], extra));
    const [v0, yours, before, fix, after, rerun] = loop();
    proof('the stale fix refused', { fix: f.ops, reply: fix!, rerun: rerun! });
    const failures = [...renamedFailures(v0!, f.ops), ...appliedFailures(yours!, 'your taller vase on revision 0'), ...conflictFailures(fix!)];
    const [b, a] = [shown(before!, 'read before the stale fix'), shown(after!, 'read after the stale fix')];
    if (a.rev !== b.rev || a.hash !== b.hash || !same(a.document, b.document)) failures.push(`the document changed under the refused fix: revision ${b.rev} → ${a.rev}, hash ${b.hash} → ${a.hash}`);
    none(failures, 'the stale fix is refused as a conflict naming both writers and the document is byte-identical');

    // The rerun: the check on revision 1 names a fresh fix, worked out on the taller vase.
    expect(judgedRev(rerun!, DOC), 'the rerun judges the current revision, 1').toBe(b.rev);
    const fresh = namedFix(rowOf(rerun!, REQ, 'the taller vase'), FLOATING.fault, 'the scene audit of the taller floating vase');
    expect(fixBase(fresh.issue, b.rev), 'the fresh fix is on the current revision').toBe(b.rev);
    const { at, failures: moves } = placed(fresh.ops, VASE, VASE_AT.planted);
    none(moves, "the fresh fix sets the vase's place and nothing else");
    expect(Math.abs(at[0]!) <= 1e-9 && Math.abs(at[2]!) <= 1e-9 && Math.abs(at[1]! - 0.4) <= 1e-6,
      `the fresh fix puts the 0.8 m vase's base on the floor, centre (0, 0.4, 0), not the stale (0, 0.3, 0): ${brief(fresh.ops)}`).toBe(true);
    const [, applied, judged] = run(bin(), scenarioOf(folder(), { [DOC]: FLOATING.doc() }, CLAIMS, [
      patch(AS_YOU, DOC, patchId(1), f.base, TALLER, 'a taller vase'), patch(AS_YOU, DOC, patchId(3), b.rev, fresh.ops, 'the fresh fix'), verdict(CLAIM),
    ]));
    none([...appliedFailures(applied!, 'the fresh fix on revision 1'), ...passFailures(rowOf(judged!, REQ, 'the taller vase after the fresh fix'), 'the scene audit after the fresh fix')], 'the fresh fix applies on the current revision and passes');

    // Wrong program: a rebase by path lands the stale fix, which sinks the taller vase into the floor.
    const [, , , byPath] = loop({ planted: 'rebase_by_path' });
    expect(conflictFailures(byPath!).length, `under rebase_by_path the stale fix is not refused as a conflict: ${brief(byPath, 600)}`).toBeGreaterThan(0);
    // Wrong program: a check that keeps its first result names no fresh fix on the rerun.
    const cached = loop({ planted: 'loop_checks_cached_by_doc' });
    const again = fixOf(rowOf(cached[5]!, REQ, 'the rerun under loop_checks_cached_by_doc'), FLOATING.fault, 'the rerun under loop_checks_cached_by_doc');
    const named = typeof again === 'string' ? again : brief(again.ops);
    expect(typeof again !== 'string' && !same(again.ops, f.ops), `under loop_checks_cached_by_doc the rerun names no fresh fix: ${named}`).toBe(false);
  }, TIMEOUT);
});
