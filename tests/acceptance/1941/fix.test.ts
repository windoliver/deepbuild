// #1941.7c623121: "Applying the fix a check names, as a patch, makes that check pass on the next render-back for every
// planted fault, and no other loop check regresses"
//
// Fixtures (helpers.ts, README: Fixtures): the nine planted faults the Proof line names (#1938's list): a subject cut
// by the frame, clipped highlights, text under 4.5:1, two items passing into each other, an item floating 0.2 m above
// the floor, a 20 m door, a missing texture, a fill that reseeds each frame, and a scene over its class. Each is a
// stored document in the working agent alpha's layer, the one deliverable of a claim of alpha's whose requirements are
// every loop check (`loopChecks`: scene.scale, camera.framing, render.exposure, render.contrast, render.noise,
// geometry.shading, the scene audit, document.validate's assets and document.budget), the fault's own among them.
//
// asserts, for each fault:
//   - run 1: `verdict` at revision 0. The fault's own row is FAIL and names the fault (its check kind, a code, its
//     items) with a fix as patch ops;
//   - run 2, on the same stored document, as the loop goes: `verdict` at revision 0 names the same fix; alpha sends
//     it through `deep_show` as a patch on the revision the verdict judged; `render_back` draws the revision the
//     patch made; `verdict` again. The patch is applied as the next revision; render-back presents that revision; the
//     verdict judged it; the fault's own row is PASS with no error or warning; and no other row regressed: none that
//     was PASS at revision 0 is anything else now, and none raises an error or warning, by check, code and items,
//     that it didn't raise at revision 0.
// The floating vase's test also runs the two planted programs below and requires each to fail this assertion.
//
// Wrong programs: the base, whose fix for the missing texture (unset the map) leaves the texture listed in the
// envelope's `assets`, so document.validate still raises asset_missing after it; `loop_checks_cached_by_doc` (a loop
// check reuses the result it first gave for a document in a run, so the check after the fix still fails);
// `floating_fix_deletes_item` (the floating vase's fix deletes it, so framing and exposure, which keep the vase,
// regress); a fix that cures its own check by breaking another; a fix applied on no revision the check judged.
import { describe, expect, it } from 'vitest';
import {
  AS_ALPHA, NINE, TIMEOUT, appliedFailures, brief, claimId, claimOf, docId, fixBase, fixOf, gpuGate, judgedRev, keyOf, loopChecks, none,
  ownCheck, passFailures, patch, patchId, proof, raised, regressions, renderBack, reqId, requireMetal, rowOf, run, same, scenarioOf, useBuild,
  useFolders, verdict, type Extra, type JsonObject, type Planted, type Row,
} from './helpers.ts';

/** The criterion's ID: `#1941.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1941.7c623121';
const bin = useBuild();
const folder = useFolders();

/** What the fix loop did with one planted fault: why it isn't the criterion, the own row after the fix, and the other rows that regressed. */
interface Looped { failures: string[]; own: Row | null; regressed: string[] }

/** One planted fault judged, its named fix applied as a patch, drawn by render-back and judged again (README: The loop). */
function fixLoop(p: Planted, extra: Extra = {}): Looped {
  const evidence = folder();
  const [doc, claim] = [docId(1), claimId(1)];
  const checks = loopChecks(p.keep);
  const claims = { [claim]: claimOf(doc, checks.map((c, i) => [reqId(i + 1), c] as const)) };
  const own = ownCheck(p);
  const what = `${p.fault.kind} on ${p.name}`;
  /** The verdict's row for each loop check, in `checks`' order. */
  const rowsOf = (v: JsonObject, when: string): Row[] => checks.map((c, i) => rowOf(v, reqId(i + 1), `${String(c['kind'])} on ${p.name} ${when}`));

  // Run 1: the check names its fix at revision 0.
  const [first] = run(bin(), scenarioOf(evidence, { [doc]: p.doc() }, claims, [verdict(claim)], extra));
  const before = rowsOf(first!, 'at revision 0');
  if (p.gpu) gpuGate(before[own]!, `${what} at revision 0`);
  const named = fixOf(before[own]!, p.fault, `${what} at revision 0`);
  if (typeof named === 'string') return { failures: [named], own: null, regressed: [] };
  const judged = judgedRev(first!, doc);
  if (judged === null) return { failures: [`the verdict names no revision of ${doc} in its key: ${brief(first!['key'])}`], own: null, regressed: [] };
  const base = fixBase(named.issue, judged);

  // Run 2: the loop on the same stored document: the check, its fix applied as alpha's patch, render-back of the
  // revision the patch made, and the check again.
  const [again, applied, drawn, after] = run(bin(), scenarioOf(evidence, { [doc]: p.doc() }, claims, [
    verdict(claim), patch(AS_ALPHA, doc, patchId(1), base, named.ops), renderBack(doc, base + 1), verdict(claim),
  ], extra));
  const failures: string[] = [];
  const renamed = fixOf(rowsOf(again!, 'at revision 0, again')[own]!, p.fault, `${what} at revision 0, again`);
  if (typeof renamed === 'string' || !same(renamed.ops, named.ops)) failures.push(`the loop's own verdict at revision 0 names another fix than run 1's ${brief(named.ops, 600)}: ${typeof renamed === 'string' ? renamed : brief(renamed.ops, 600)}`);
  failures.push(...appliedFailures(applied!, `alpha's patch of ${what}'s fix on revision ${base}`));
  if (applied!['rev'] !== base + 1) failures.push(`the fix's patch made revision ${brief(applied!['rev'])}, not ${base + 1}`);
  if (drawn!['outcome'] !== 'presented' || drawn!['rev'] !== base + 1 || !Array.isArray(drawn!['snapshots']) || drawn!['snapshots'].length === 0) {
    failures.push(`render-back of revision ${base + 1} isn't presented with a snapshot of it: ${brief(drawn, 800)}`);
  }
  if (judgedRev(after!, doc) !== base + 1) failures.push(`the check after the fix judged revision ${brief(judgedRev(after!, doc))}, not ${base + 1}: ${brief(after!['key'])}`);
  const rows = rowsOf(after!, 'after its fix');
  if (p.gpu) gpuGate(rows[own]!, `${what} after its fix`);
  failures.push(...passFailures(rows[own]!, `${what} after its fix`));
  const regressed = checks.flatMap((c, i) => (i === own ? [] : regressions(before[i]!, rows[i]!, `${String(c['kind'])} on ${p.name} after ${p.fault.kind}'s fix`)));
  failures.push(...regressed);
  proof(`${what}`, { fault: raised(before[own]!).map((i) => i.raw), fix: named.ops, after: rows.map((r) => ({ kind: r.raw['kind'] ?? null, result: r.result, issues: raised(r).map(keyOf) })) });
  return { failures, own: rows[own]!, regressed };
}

/** One planted fault, by its file-name stem, through the fix loop: its named fix applied passes its check and no other regresses. */
function holdsLoop(slug: string): Planted {
  const p = NINE.find((x) => x.slug === slug)!;
  if (p.gpu) requireMetal(p.name);
  none(fixLoop(p).failures, `${p.name}: its named fix applied, ${p.fault.kind} passes and no other loop check regresses`);
  return p;
}

describe(`${ID} each planted fault's named fix, applied as a patch, passes its check on the next render-back, and no other loop check regresses`, () => {
  it(`${ID} a subject cut by the frame: camera.framing's fix, applied as a patch, passes framing on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('framing-cut');
  }, TIMEOUT);

  it(`${ID} clipped highlights: render.exposure's fix, applied as a patch, passes exposure on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('exposure-clipped');
  }, TIMEOUT);

  it(`${ID} text under 4.5:1: render.contrast's fix, applied as a patch, passes contrast on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('contrast-muted');
  }, TIMEOUT);

  it(`${ID} two items passing into each other: the scene audit's fix, applied as a patch, passes the audit on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('overlap-crates');
  }, TIMEOUT);

  it(`${ID} an item floating 0.2 m above the floor: the scene audit's fix, applied as a patch, passes the audit on the next render-back, and no other loop check regresses; a cached check and a fix that deletes the vase fail`, () => {
    const p = holdsLoop('floating-vase');
    // Wrong program: a check that keeps its first result for the document fails the vase again after its fix.
    const cached = fixLoop(p, { planted: 'loop_checks_cached_by_doc' });
    expect(cached.own?.result, `under loop_checks_cached_by_doc the scene audit still fails the vase after its fix: ${cached.failures.join('; ').slice(0, 1500)}`).not.toBe('PASS');
    // Wrong program: a floating fix that deletes the vase passes the audit and regresses the checks that keep it.
    const deletes = fixLoop(p, { planted: 'floating_fix_deletes_item' });
    expect(deletes.regressed.length, `under floating_fix_deletes_item another loop check regresses after the vase's fix: ${deletes.failures.join('; ').slice(0, 1500)}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${ID} a 20 m door: scene.scale's fix, applied as a patch, passes scale on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('scale-door');
  }, TIMEOUT);

  it(`${ID} a missing texture: document.validate's fix, applied as a patch, passes validation of the assets on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('texture-missing');
  }, TIMEOUT);

  it(`${ID} a fill that reseeds each frame: render.noise's fix, applied as a patch, passes noise on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('noise-reseeds');
  }, TIMEOUT);

  it(`${ID} a scene over its class: document.budget's fix, applied as a patch, passes the budget on the next render-back, and no other loop check regresses`, () => {
    holdsLoop('budget-over-class');
  }, TIMEOUT);
});
