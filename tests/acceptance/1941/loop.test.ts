// #1941.b8b6c42f: "Two fixes for one revision that touch the same item apply one at a time, the second following the
// stale-base rule, and a fix that brings back an issue the loop already fixed stops the loop with one ask"
//
// Fixtures (helpers.ts), stored documents in alpha's layer, each the one deliverable of a claim of alpha's:
//   - `cutAndClipped`: a 1 m cube cut by the frame's right edge that also emits white at strength 4. The claim's
//     requirements are camera.framing (keep the cube) and render.exposure (the cube). Both fail at revision 0, and
//     each names a fix that sets the camera: framing its place, exposure its EV (the design's "pull the camera back"
//     and "raise exposure" pair);
//   - `keptDoor`: the 20 m door in a 4 × 2.7 m wall, kept by a camera 12 m out. The requirements are camera.framing
//     (keep the door, `fill` tightened to [0.3, 0.9]) and scene.scale. At revision 0 the door is cut by the frame and is
//     20 m tall. Framing's fix pulls the camera back until the whole door is in frame; scale's fix then sets the door
//     to a door's height (1.9 to 2.4 m; within the tolerance band at most 4.8 m), which leaves it at most a quarter of
//     the frame it filled, under 0.3: framing's issue the loop fixed comes back.
//
// asserts:
//   - two fixes: alpha sends both fixes on revision 0, one after the other. The first is applied as revision 1. The
//     second, whose base 0 moved on and whose item (the camera) the first changed, follows the stale-base rule: refused
//     with outcome `conflict` naming alpha and the camera, `read` before and after the same revision, hash and
//     document. The rerun on revision 1 passes framing and names exposure's fix again, fresh, on the same item; sent
//     on revision 1 it is applied, and both requirements pass;
//   - one ask: the loop runs in one process: the check at revision 0 names both fixes; framing's fix is applied
//     (revision 1); the check there passes framing and names scale's fix; it is applied (revision 2); the check there
//     finds framing's issue back (by check, code and items, as Revision matches issues). No verdict before that
//     carries an ask. That verdict carries exactly one ask, which names a requirement of the claim, framing's
//     requirement isn't PASS and the verdict isn't PASS: the loop stopped. A second verdict on revision 2 asks nothing
//     new (every ask it carries is that one). Your `answer` on that requirement, from your own shell, is answered, and
//     the verdict after it asks nothing new.
// Wrong programs: `rebase_by_path` (#138's, at the base: the second fix merges, since it writes another path of the
// camera); the base, which raises no ask; `regression_asks_every_verdict` (each verdict that finds the issue back
// raises the ask again); a loop that asks on every failing verdict.
import { describe, expect, it } from 'vitest';
import {
  AS_ALPHA, DOOR, FRAMING_TIGHT, HERO, SUBJECT, TIMEOUT, WRITER, answer, appliedFailures, asksOf, brief, claimId, claimOf, cutAndClipped, distinctAsks, docId,
  fixBase, holds, judgedRev, keptDoor, keyOf, namedFix, none, opTargets, outcome, passFailures, patch, patchId, proof, raised, read, reqId, requireMetal,
  rowOf, run, same, sameAsk, scenarioOf, shown, useBuild, useFolders, verdict, writerKey, type Extra, type Fault, type JsonObject,
} from './helpers.ts';

/** The criterion's ID: `#1941.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1941.b8b6c42f';
const bin = useBuild();
const folder = useFolders();

const [DOC, CLAIM] = [docId(1), claimId(1)];
const [FRAMING, SECOND] = [reqId(1), reqId(2)];

describe(`${ID} fixes for one revision apply one at a time, and a fix that brings back a fixed issue stops the loop with one ask`, () => {
  it(`${ID} two fixes for one revision that touch the camera apply one at a time: the second follows the stale-base rule, and its fresh fix applies on the new revision`, () => {
    requireMetal('the clipped cube');
    const claims = { [CLAIM]: claimOf(DOC, [[FRAMING, { kind: 'camera.framing', keep: [SUBJECT] }], [SECOND, { kind: 'render.exposure', subject: HERO }]]) };
    const framed: Fault = { kind: 'camera.framing', ids: [SUBJECT] };
    const exposed: Fault = { kind: 'render.exposure', ids: [SUBJECT] };
    const evidence = folder();
    const [v0] = run(bin(), scenarioOf(evidence, { [DOC]: cutAndClipped() }, claims, [verdict(CLAIM)]));
    const first = namedFix(rowOf(v0!, FRAMING, 'framing at revision 0'), framed, 'camera.framing on the cut cube at revision 0');
    const second = namedFix(rowOf(v0!, SECOND, 'exposure at revision 0'), exposed, 'render.exposure on the clipped cube at revision 0');
    const shared = opTargets(first.ops).filter((id) => opTargets(second.ops).includes(id));
    expect(shared, `both fixes touch one item: ${brief(first.ops)} and ${brief(second.ops)}`).not.toEqual([]);
    const base = fixBase(first.issue, judgedRev(v0!, DOC) ?? 0);
    expect(fixBase(second.issue, base), 'both fixes are for one revision').toBe(base);

    const loop = (extra: Extra = {}): JsonObject[] => run(bin(), scenarioOf(evidence, { [DOC]: cutAndClipped() }, claims, [
      patch(AS_ALPHA, DOC, patchId(1), base, first.ops), read(DOC), patch(AS_ALPHA, DOC, patchId(2), base, second.ops, 'the second fix'), read(DOC), verdict(CLAIM),
    ], extra));
    const [one, before, two, after, rerun] = loop();
    proof('two fixes for one revision', { first: one!, second: two!, rerun: rerun! });
    const failures = appliedFailures(one!, 'the first fix');
    if (outcome(two!) !== 'conflict') failures.push(`the second fix, on revision ${base} after the first changed ${shared.join(', ')}, is ${outcome(two!)}, not conflict: ${brief(two, 1200)}`);
    if (!holds(two!, WRITER.alpha) && !JSON.stringify(two).includes(writerKey(WRITER.alpha))) failures.push(`the conflict doesn't name alpha, both fixes' writer: ${brief(two, 1200)}`);
    if (!shared.some((id) => holds(two!, id))) failures.push(`the conflict doesn't name ${shared.join(', ')}: ${brief(two, 1200)}`);
    const [b, a] = [shown(before!, 'read after the first fix'), shown(after!, 'read after the second')];
    if (a.rev !== b.rev || a.hash !== b.hash || !same(a.document, b.document)) failures.push(`the refused second fix changed the document: revision ${b.rev} → ${a.rev}, hash ${b.hash} → ${a.hash}`);
    none(failures, 'the first fix applies and the second, on the same stale base and item, is refused as a conflict, the document unchanged');

    // One at a time: the rerun on the new revision names the second fix afresh, and it applies there.
    expect(judgedRev(rerun!, DOC), 'the rerun judges the revision the first fix made').toBe(b.rev);
    none(passFailures(rowOf(rerun!, FRAMING, 'framing after the first fix'), 'camera.framing after the first fix'), 'the first fix passes its check');
    const fresh = namedFix(rowOf(rerun!, SECOND, 'exposure after the first fix'), exposed, 'render.exposure after the first fix');
    expect(opTargets(fresh.ops).filter((id) => shared.includes(id)), 'the fresh second fix touches the same item').not.toEqual([]);
    const [, applied, done] = run(bin(), scenarioOf(evidence, { [DOC]: cutAndClipped() }, claims, [
      patch(AS_ALPHA, DOC, patchId(1), base, first.ops), patch(AS_ALPHA, DOC, patchId(3), fixBase(fresh.issue, b.rev), fresh.ops, 'the second fix, fresh'), verdict(CLAIM),
    ]));
    none([
      ...appliedFailures(applied!, 'the fresh second fix on the new revision'),
      ...passFailures(rowOf(done!, FRAMING, 'framing after both fixes'), 'camera.framing after both fixes'),
      ...passFailures(rowOf(done!, SECOND, 'exposure after both fixes'), 'render.exposure after both fixes'),
    ], 'the fresh second fix applies on the new revision and both checks pass');

    // Wrong program: a rebase by path merges the second fix, which writes another path of the same camera.
    const [, , merged] = loop({ planted: 'rebase_by_path' });
    expect(outcome(merged!), 'under rebase_by_path the second fix on the stale base is not a conflict').not.toBe('conflict');
  }, TIMEOUT);

  it(`${ID} a fix that brings back an issue the loop already fixed stops the loop with one ask, asked once and answerable`, () => {
    const claims = { [CLAIM]: claimOf(DOC, [[FRAMING, FRAMING_TIGHT([DOOR])], [SECOND, { kind: 'scene.scale' }]]) };
    const framed: Fault = { kind: 'camera.framing', ids: [DOOR] };
    const scaled: Fault = { kind: 'scene.scale', ids: [DOOR] };
    const evidence = folder();
    const world = (calls: JsonObject[], extra: Extra = {}): JsonObject[] => run(bin(), scenarioOf(evidence, { [DOC]: keptDoor() }, claims, calls, extra));

    // The loop's first steps, learnt one run at a time: each fix as the check names it.
    const [v0] = world([verdict(CLAIM)]);
    const frameFix = namedFix(rowOf(v0!, FRAMING, 'framing at revision 0'), framed, 'camera.framing on the 20 m door at revision 0');
    const base0 = fixBase(frameFix.issue, judgedRev(v0!, DOC) ?? 0);
    const [, , v1] = world([verdict(CLAIM), patch(AS_ALPHA, DOC, patchId(1), base0, frameFix.ops), verdict(CLAIM)]);
    none(passFailures(rowOf(v1!, FRAMING, 'framing after its fix'), 'camera.framing after its fix'), "framing's fix passes framing: the loop fixed its issue");
    const scaleFix = namedFix(rowOf(v1!, SECOND, 'scale after the framing fix'), scaled, 'scene.scale on the 20 m door after the framing fix');
    const base1 = fixBase(scaleFix.issue, judgedRev(v1!, DOC) ?? base0 + 1);

    // The whole loop in one process: check, fix, check, fix, check, and the check again.
    const steps = [verdict(CLAIM), patch(AS_ALPHA, DOC, patchId(1), base0, frameFix.ops), verdict(CLAIM), patch(AS_ALPHA, DOC, patchId(2), base1, scaleFix.ops), verdict(CLAIM), verdict(CLAIM)];
    const [r0, p1, r1, p2, r2, again] = world(steps);
    proof('a fix that brings back a fixed issue', { revision2: r2!, again: again! });
    const failures = [...appliedFailures(p1!, "framing's fix"), ...appliedFailures(p2!, "scale's fix")];
    for (const [v, at] of [[r0!, 0], [r1!, 1]] as const) {
      if (asksOf(v).length > 0) failures.push(`the verdict at revision ${at}, before any fixed issue came back, asks: ${brief(asksOf(v), 800)}`);
    }
    const back = raised(rowOf(r0!, FRAMING, 'framing at revision 0')).map(keyOf);
    const now = raised(rowOf(r2!, FRAMING, 'framing after the scale fix')).map(keyOf);
    if (!back.some((k) => now.includes(k))) failures.push(`the scale fix doesn't bring back framing's issue: at revision 0 ${back.join('; ')}, now ${now.join('; ') || 'nothing'}`);
    none(failures, "the loop fixes framing, then scale's fix brings framing's issue back");

    const asked = asksOf(r2!);
    expect(asked.length, `the verdict that finds the fixed issue back carries exactly one ask: ${brief(asked, 1500)}`).toBe(1);
    expect(rowOf(r2!, FRAMING, 'framing after the scale fix').result, 'the requirement whose fixed issue came back does not pass').not.toBe('PASS');
    expect(r2!['result'], 'the loop stopped: the verdict does not pass').not.toBe('PASS');
    const ask = asked[0]!;
    const on = ask['requirement'];
    expect([FRAMING, SECOND], `the ask names the claim's requirement it is on: ${brief(ask)}`).toContain(on);
    const fresh = (v: JsonObject): JsonObject[] => asksOf(v).filter((x) => !sameAsk(x, ask));
    expect(fresh(again!), 'a second verdict on the same revision asks nothing new').toEqual([]);

    // Answerable: your answer on that requirement, from your own shell; the loop never asks it again.
    const answered = world([...steps, answer(CLAIM, String(on), true), verdict(CLAIM)]);
    const [reply, after] = [answered[6]!, answered[7]!];
    expect(reply['outcome'], `your answer to the ask is answered: ${brief(reply, 800)}`).toBe('answered');
    expect(fresh(after), 'the verdict after your answer asks nothing new').toEqual([]);

    // Wrong program: the ask raised again by every verdict that finds the issue back.
    const twice = world(steps, { planted: 'regression_asks_every_verdict' });
    const distinct = distinctAsks(asksOf(twice[4]!), asksOf(twice[5]!));
    expect(distinct.length, `under regression_asks_every_verdict the two verdicts ask more than once: ${brief(distinct, 800)}`).toBeGreaterThan(1);
  }, TIMEOUT);
});
