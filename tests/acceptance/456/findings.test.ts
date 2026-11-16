// #456.a599239f: "With a stub model that returns eight findings, render.review's reading keeps five, worst first, each
// with an ID tied to the revision, its snapshot and crop, a fix and an acceptance condition; on the next revision,
// rendered at the same cameras, a fixed finding reads resolved, an untouched one remaining and one that came back
// regressed; with its images unreadable, the reading is empty and says why"
//
// Fixture (helpers.ts): five crates, each 1 m and cut by an edge of the frame at revision 0, seen by the document's one
// camera; the claim's one requirement is render.review. One `deep-show run`:
//   1. reviews revision 0, the stub model returning eight findings, each with a severity (higher is worse), a symptom,
//      a fix, an acceptance condition (camera.framing keeping one crate, which fails while that crate is cut) and a
//      crop of snapshot 0. The five worst name crate-a (8), crate-b (7), crate-c (6), crate-d (5) and crate-e (4);
//   2. alpha's patch brings crate-a and crate-c whole into the frame (revision 1), and the review runs again, its model
//      finding nothing;
//   3. alpha's patch puts crate-c back where it was cut (revision 2), and the review runs again, finding nothing.
// A second run reviews revision 0 with a model that answers that it can't read its images.
// asserts:
//   - revision 0's reading keeps five findings, severities 8, 7, 6, 5, 4 in that order, each with a distinct ID, the
//     revision it was found on (`rev: 0`), its symptom, fix and acceptance condition as the model gave them, its
//     snapshot (a hash among the reading's snapshots) and its crop (`{box, sha256}`: the model's box, and a PNG whose
//     pixels are the snapshot's pixels in that box);
//   - each later reading renders the same cameras (as many snapshots, each the same size and camera) and marks every
//     earlier finding by its ID (`earlier: [{id, status}]`): at revision 1, crate-a's and crate-c's resolved, the
//     others remaining; at revision 2, crate-a's resolved, crate-b's remaining and crate-c's regressed;
//   - the unreadable review's reading has no finding and no observation, and says why (`why`, words); no row is PASS.
// Wrong programs: the base (no reading); `keeps_all_findings` (the reading keeps all eight).
import { describe, expect, it } from 'vitest';
import {
  CRATES, CRATE_AT, QUIET, TIMEOUT, brief, caught, claimId, claimOf, docId, evidencePng, fiveCrates, framingOf, isObject, listOf, moveTo, none, patch,
  patchId, proof, readingOf, reqId, requireMetal, review, rowOf, run, same, scenarioOf, useBuild, useFolders, verdict, type JsonObject, type Reply,
} from './helpers.ts';

/** The criterion's ID: `#456.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#456.a599239f';
const bin = useBuild();
const folder = useFolders();

const [DOC, CLAIM, REQ] = [docId(6), claimId(6), reqId(6)];
const CLAIMS = { [CLAIM]: claimOf(DOC, [[REQ, review(undefined, CRATES)]]) };
/** The eight findings, in the order the model gives them: severity, the crate its acceptance condition keeps, its crop. */
const EIGHT: readonly (readonly [number, string, [number, number, number, number]])[] = [
  [3, 'crate-a', [10, 10, 40, 30]], [8, 'crate-a', [0, 40, 64, 64]], [1, 'crate-b', [200, 20, 50, 40]], [6, 'crate-c', [120, 0, 80, 48]],
  [5, 'crate-d', [0, 150, 70, 60]], [2, 'crate-c', [100, 100, 30, 30]], [7, 'crate-b', [250, 40, 70, 64]], [4, 'crate-e', [250, 150, 70, 60]],
];
const finding = ([severity, crate, crop]: (typeof EIGHT)[number]): JsonObject => ({
  severity, symptom: `S${severity}: ${crate} is cut by the edge of the frame`, fix: `move ${crate} whole into the frame`,
  accept: framingOf(crate), snapshot: 0, crop: [...crop],
});
const FOUND: Reply = { ...QUIET, answers: { matches_brief: 'no', reads_as_modeled: 'yes', mood: 'yes' }, findings: EIGHT.map(finding) };
const UNREADABLE: Reply = { unreadable: 'The images could not be read: each one arrived empty.' };
/** The five a reading keeps, worst first. */
const KEPT = [...EIGHT].sort((a, b) => b[0] - a[0]).slice(0, 5);
const CALLS = [
  verdict(CLAIM),
  patch(DOC, patchId(1), 0, [moveTo('crate-a', CRATE_AT['crate-a'].whole), moveTo('crate-c', CRATE_AT['crate-c'].whole)], 'bring crate-a and crate-c whole into the frame'),
  verdict(CLAIM),
  patch(DOC, patchId(2), 1, [moveTo('crate-c', CRATE_AT['crate-c'].cut)], 'put crate-c back at the edge'),
  verdict(CLAIM),
];

/** Why revision 0's reading breaks the criterion's five findings; empty when it holds. Its findings' IDs by crate. */
function found(evidence: string, reading: JsonObject, what: string): { failures: string[]; ids: Map<string, string> } {
  const failures: string[] = [];
  const ids = new Map<string, string>();
  const findings = listOf(reading, 'findings', what);
  const snapshots = listOf(reading, 'snapshots', what);
  if (findings.length !== 5) failures.push(`${what}: the reading keeps ${findings.length} findings of the model's eight, not five: ${brief(findings.map((f) => f['severity'] ?? null))}`);
  const order = findings.map((f) => f['severity'] ?? null);
  if (!same(order, KEPT.map((k) => k[0]))) failures.push(`${what}: the findings' severities read ${brief(order)}, not the five worst first, ${brief(KEPT.map((k) => k[0]))}`);
  findings.slice(0, 5).forEach((f, k) => {
    const want = finding(KEPT[k] ?? KEPT[0]!);
    const label = `${what}: finding ${k + 1} (${brief(f['symptom'])})`;
    if (typeof f['id'] !== 'string' || f['id'] === '' || [...ids.values()].includes(f['id'])) failures.push(`${label} has no ID of its own: ${brief(f['id'])}`);
    else ids.set(KEPT[k]![1], f['id']);
    if (f['rev'] !== 0) failures.push(`${label} isn't tied to revision 0: rev ${brief(f['rev'])}`);
    for (const field of ['symptom', 'fix', 'accept'] as const) if (!same(f[field], want[field])) failures.push(`${label}: its ${field} is ${brief(f[field])}, not the model's ${brief(want[field])}`);
    const snap = snapshots.find((s) => s['sha256'] === f['snapshot']);
    if (!snap) { failures.push(`${label}: its snapshot ${brief(f['snapshot'])} isn't one of the reading's ${brief(snapshots)}`); return; }
    const crop = f['crop'];
    const box = (want['crop'] as number[]);
    if (!isObject(crop) || !same(crop['box'], box)) { failures.push(`${label}: its crop is ${brief(crop)}, not {box: ${brief(box)}, sha256}`); return; }
    const whole = evidencePng(evidence, String(snap['sha256']));
    const part = evidencePng(evidence, String(crop['sha256']));
    if (typeof whole === 'string' || typeof part === 'string') { failures.push(`${label}: its snapshot or crop isn't a PNG in the evidence store: ${String(whole)}; ${String(part)}`); return; }
    const [x, y, w, h] = box as [number, number, number, number];
    if (part.w !== w || part.h !== h) { failures.push(`${label}: its crop is ${part.w} × ${part.h}, not ${w} × ${h}`); return; }
    let differ = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < 4; c++) if (part.rgba[(j * w + i) * 4 + c] !== whole.rgba[((y + j) * whole.w + x + i) * 4 + c]) differ++;
    if (differ) failures.push(`${label}: its crop differs from the snapshot's pixels in ${brief(box)} in ${differ} channel values`);
  });
  return { failures, ids };
}
/** Why a later reading's marks break the criterion; empty when they hold. */
function marked(first: JsonObject, later: JsonObject, ids: Map<string, string>, want: Record<string, string>, what: string): string[] {
  const failures: string[] = [];
  const cams = (r: JsonObject, w: string) => listOf(r, 'snapshots', w).map((s) => [s['w'] ?? null, s['h'] ?? null, s['camera'] ?? null]);
  if (!same(cams(later, what), cams(first, 'revision 0'))) failures.push(`${what} doesn't render revision 0's cameras: ${brief(cams(later, what))} against ${brief(cams(first, 'revision 0'))}`);
  const earlier = listOf(later, 'earlier', what);
  for (const [crate, id] of ids) {
    const mark = earlier.find((e) => e['id'] === id);
    if (!mark) failures.push(`${what} doesn't mark ${crate}'s finding ${id}: ${brief(earlier)}`);
    else if (mark['status'] !== want[crate]) failures.push(`${what} marks ${crate}'s finding ${id} ${brief(mark['status'])}, not ${want[crate]}`);
  }
  return failures;
}

describe(`${ID} render.review keeps five findings, worst first, marks them on the next revision, and gives no reading it can't see`, () => {
  it(`${ID} eight findings keep five worst first with their evidence, a fixed one reads resolved, an untouched one remaining and one that came back regressed, and unreadable images give an empty reading that says why`, () => {
    requireMetal('the five crates');
    const evidence = folder();
    const out = run(bin(), scenarioOf(evidence, { [DOC]: fiveCrates() }, CLAIMS, CALLS, { replies: [FOUND, QUIET, QUIET] }));
    const readings = [out[0]!, out[2]!, out[4]!].map((v, k) => {
      const row = rowOf(v, REQ, `render.review of revision ${k}`);
      expect(row.result, `render.review of revision ${k} passes nothing: ${brief(row.raw, 600)}`).not.toBe('PASS');
      return readingOf(row, `render.review of revision ${k}`);
    });
    const failures: string[] = [];
    for (const k of [1, 3]) if (out[k]!['outcome'] !== 'applied') failures.push(`alpha's patch ${k === 1 ? 'bringing the crates in' : 'putting crate-c back'} is ${brief(out[k], 600)}, not applied`);
    const first = found(evidence, readings[0]!, 'revision 0');
    failures.push(...first.failures);
    const rest = { 'crate-b': 'remaining', 'crate-d': 'remaining', 'crate-e': 'remaining' };
    failures.push(...marked(readings[0]!, readings[1]!, first.ids, { 'crate-a': 'resolved', 'crate-c': 'resolved', ...rest }, 'revision 1'));
    failures.push(...marked(readings[0]!, readings[2]!, first.ids, { 'crate-a': 'resolved', 'crate-c': 'regressed', ...rest }, 'revision 2'));
    none(failures, 'five findings kept worst first with their evidence, each marked on the later revisions');
    proof('the five findings', readings[0]!['findings']!);
    proof('marked on revisions 1 and 2', [readings[1]!['earlier']!, readings[2]!['earlier']!]);

    const [blind] = run(bin(), scenarioOf(folder(), { [DOC]: fiveCrates() }, CLAIMS, [verdict(CLAIM)], { replies: [UNREADABLE] }));
    const row = rowOf(blind!, REQ, 'render.review whose images are unreadable');
    const empty = readingOf(row, 'render.review whose images are unreadable');
    const why: string[] = [];
    if (row.result === 'PASS') why.push(`it PASSes: ${brief(row.raw, 600)}`);
    for (const field of ['findings', 'observations']) if (!Array.isArray(empty[field]) || (empty[field] as unknown[]).length) why.push(`its ${field} are ${brief(empty[field])}, not empty`);
    if (typeof empty['why'] !== 'string' || !/\w/.test(empty['why'])) why.push(`it doesn't say why: why is ${brief(empty['why'])}`);
    none(why, 'a review whose images are unreadable gives an empty reading that says why');
    proof('the unreadable review', empty);

    const plantedEvidence = folder();
    const [p] = run(bin(), scenarioOf(plantedEvidence, { [DOC]: fiveCrates() }, CLAIMS, [verdict(CLAIM)], { replies: [FOUND], planted: 'keeps_all_findings' }));
    caught(found(plantedEvidence, readingOf(rowOf(p!, REQ, 'under keeps_all_findings'), 'under keeps_all_findings'), 'under keeps_all_findings').failures, 'keeps_all_findings', 'the findings kept');
  }, TIMEOUT);
});
