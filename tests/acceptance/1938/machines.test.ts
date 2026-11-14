// #1938.636cd049: "Scale, framing, shading and the scene audit give the same results on every machine; exposure,
// contrast and noise hold on one machine and report INCONCLUSIVE on another"
//
// Fixtures (helpers.ts): one planted fault per named check, each the one deliverable of its own claim of alpha's: the
// 20 m door (scene.scale), the subject cut by the frame (camera.framing), a unit cube wound and facing inward
// (geometry.shading, as #453 judges it), the vase floating 0.2 m above the floor (the scene audit), clipped highlights
// (render.exposure), text under 4.5:1 (render.contrast) and a fill that reseeds each frame (render.noise). The machine
// is #138's scenario `environment`, `{os, driver}`, which every backend reports for the run and which enters its
// fingerprint: machine A is ENV_A, machine B is ENV_B (README: Another machine).
//
// asserts:
//   - on A, every row is FAIL (each fault caught, so "the same" is never two BLOCKED rows alike); scale, framing,
//     shading and the scene audit say `machines: any`, exposure, contrast and noise `machines: same`, and each of
//     those three carries the `fingerprint` it was measured under;
//   - on A again, a new process, each claim judged `against` A's verdict: every row has A's result and issues (for the
//     pixel checks, A's codes and items, and A's fingerprint): they hold on one machine;
//   - on B, each claim judged `against` A's verdict: scale, framing, shading and the scene audit give A's result and
//     A's issues exactly; exposure, contrast and noise are INCONCLUSIVE, never PASS or FAIL, under a fingerprint that
//     isn't A's, and each names A's fingerprint as well as its own;
//   - planted: under `pixel_checks_hold_anywhere` the same calls on B decide exposure, contrast and noise (FAIL), so
//     the INCONCLUSIVE assertion fails on that program.
// Wrong programs: the base (scale and framing unregistered, every pixel check BLOCKED `module_missing`); pixel checks
// that hold on any machine (`pixel_checks_hold_anywhere`); a framing or scale that reads pixels, and so is
// INCONCLUSIVE or differs on B; a fingerprint that ignores the environment.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, brief, claimId, claimOf, docId, exposurePair, floatingPair, framingPair, gpuGate, holds, inwardCube, noisePair, none, proof,
  putEvidence, reqId, requireMetal, rowOf, run, same, scalePair, scenarioOf, shadingDoc, useBuild, useFolders, verdict, contrastPair,
  type JsonObject, type JsonValue, type Row,
} from './helpers.ts';

/** The criterion's ID: `#1938.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1938.636cd049';
const bin = useBuild();
const folder = useFolders();

const ENV_A = { os: 'deep-test-os-a', driver: 'deep-test-driver-a' };
const ENV_B = { os: 'deep-test-os-b', driver: 'deep-test-driver-b' };
/** The wrong program the criterion's test names (README: Planted programs). */
const HOLD_ANYWHERE = 'pixel_checks_hold_anywhere';

interface Case { name: string; machines: 'any' | 'same'; doc: JsonObject; check: JsonObject }

/** A row's issues as the comparison reads them: each issue whole, in order. */
const issuesOf = (row: Row): JsonValue => row.issues.map((i) => i.raw);
/** A row's issues by code and items, sorted: what a same-machine row keeps on one machine. */
const faultsOf = (row: Row): string[] => row.issues.map((i) => `${i.code} [${i.ids.join(', ')}]`).sort();

describe(`${ID} evaluated-data checks agree on every machine; pixel checks hold on one machine and are INCONCLUSIVE on another`, () => {
  it(`${ID} scale, framing, shading and the scene audit give A's results on B; exposure, contrast and noise hold on A and report INCONCLUSIVE on B, naming both fingerprints`, () => {
    requireMetal('render.exposure on clipped highlights');
    const evidence = folder();
    const cube = putEvidence(evidence, inwardCube());
    const cases: Case[] = [
      { name: 'scene.scale on the 20 m door', machines: 'any', doc: scalePair().planted, check: scalePair().check },
      { name: 'camera.framing on the subject cut by the frame', machines: 'any', doc: framingPair().planted, check: framingPair().check },
      { name: 'geometry.shading on the inward cube', machines: 'any', doc: shadingDoc(cube), check: { kind: 'geometry.shading' } },
      { name: 'the scene audit on the floating vase', machines: 'any', doc: floatingPair().planted, check: floatingPair().check },
      { name: 'render.exposure on clipped highlights', machines: 'same', doc: exposurePair().planted, check: exposurePair().check },
      { name: 'render.contrast on text under 4.5:1', machines: 'same', doc: contrastPair().planted, check: contrastPair().check },
      { name: 'render.noise on a fill that reseeds each frame', machines: 'same', doc: noisePair().planted, check: noisePair().check },
    ];
    const docs = Object.fromEntries(cases.map((c, i) => [docId(i + 1), c.doc]));
    const claims = Object.fromEntries(cases.map((c, i) => [claimId(i + 1), claimOf(docId(i + 1), reqId(i + 1), c.check)]));
    const rows = (replies: JsonObject[], on: string): Row[] => cases.map((c, i) => rowOf(replies[i]!, reqId(i + 1), `${c.name} on ${on}`));

    // Machine A: each claim judged.
    const onA = run(bin(), scenarioOf(evidence, docs, claims, cases.map((_, i) => verdict(claimId(i + 1))), { environment: ENV_A }));
    const a = rows(onA, 'machine A');
    gpuGate(a[4]!, `${cases[4]!.name} on machine A`);
    proof('rows on machine A', a.map((r) => r.raw));
    const decided: string[] = [];
    cases.forEach((c, i) => {
      const r = a[i]!;
      if (r.result !== 'FAIL') decided.push(`${c.name} on machine A is ${r.result}, not FAIL: ${brief(r.raw, 800)}`);
      if (r.machines !== c.machines) decided.push(`${c.name} says machines: ${r.machines}, not ${c.machines}`);
      if (c.machines === 'same' && (r.raw['fingerprint'] === undefined || r.raw['fingerprint'] === null)) decided.push(`${c.name} on machine A carries no fingerprint: ${brief(r.raw, 800)}`);
    });
    none(decided, 'on machine A each planted fault is caught, each row says the machines its result holds on, and each pixel check names its fingerprint');
    const fingerprint = (i: number): JsonValue => a[i]!.raw['fingerprint']!;

    // Machine A again, a new process: each claim judged against A's verdict. Every result holds.
    const again = rows(run(bin(), scenarioOf(evidence, docs, claims, cases.map((_, i) => verdict(claimId(i + 1), onA[i])), { environment: ENV_A })), 'machine A again');
    proof('rows on machine A again, against A', again.map((r) => r.raw));
    const held: string[] = [];
    cases.forEach((c, i) => {
      const [r, was] = [again[i]!, a[i]!];
      if (r.result !== was.result) held.push(`${c.name} on machine A again is ${r.result}, where A's own verdict was ${was.result}: ${brief(r.raw, 800)}`);
      if (c.machines === 'any' && !same(issuesOf(r), issuesOf(was))) held.push(`${c.name} on machine A again raises ${brief(issuesOf(r), 800)}, where A raised ${brief(issuesOf(was), 800)}`);
      if (c.machines === 'same') {
        if (!same(faultsOf(r) as JsonValue, faultsOf(was) as JsonValue)) held.push(`${c.name} on machine A again raises ${faultsOf(r).join('; ')}, where A raised ${faultsOf(was).join('; ')}`);
        if (!same(r.raw['fingerprint'], fingerprint(i))) held.push(`${c.name} on machine A again names the fingerprint ${brief(r.raw['fingerprint'])}, not A's ${brief(fingerprint(i))}`);
      }
    });
    none(held, 'on machine A, judged against its own verdict, every check holds');

    // Machine B: each claim judged against A's verdict.
    const callsB = cases.map((_, i) => verdict(claimId(i + 1), onA[i]));
    const b = rows(run(bin(), scenarioOf(evidence, docs, claims, callsB, { environment: ENV_B })), 'machine B');
    proof('rows on machine B, against A', b.map((r) => r.raw));
    const across: string[] = [];
    cases.forEach((c, i) => {
      const [r, was] = [b[i]!, a[i]!];
      if (r.machines !== c.machines) across.push(`${c.name} on machine B says machines: ${r.machines}, not ${c.machines}`);
      if (c.machines === 'any') {
        if (r.result !== was.result) across.push(`${c.name} on machine B is ${r.result}, where A's was ${was.result}: ${brief(r.raw, 800)}`);
        if (!same(issuesOf(r), issuesOf(was))) across.push(`${c.name} on machine B raises ${brief(issuesOf(r), 800)}, where A raised ${brief(issuesOf(was), 800)}`);
        return;
      }
      if (r.result !== 'INCONCLUSIVE') across.push(`${c.name} on machine B is ${r.result}, not INCONCLUSIVE: ${brief(r.raw, 800)}`);
      const own = r.raw['fingerprint'];
      if (own === undefined || own === null || same(own, fingerprint(i))) across.push(`${c.name} on machine B names the fingerprint ${brief(own)}, which isn't another than A's ${brief(fingerprint(i))}`);
      if (!holds(r.raw, fingerprint(i))) across.push(`${c.name} on machine B doesn't name A's fingerprint ${brief(fingerprint(i))}: ${brief(r.raw, 800)}`);
    });
    none(across, "on machine B scale, framing, shading and the scene audit give A's results, and exposure, contrast and noise are INCONCLUSIVE, naming both fingerprints");

    // Wrong program: pixel checks that hold on any machine decide the same claims on B, so the assertion above fails on it.
    const plantedB = rows(run(bin(), scenarioOf(evidence, docs, claims, callsB, { environment: ENV_B, planted: HOLD_ANYWHERE })), `machine B under ${HOLD_ANYWHERE}`);
    expect(cases.flatMap((c, i) => (c.machines === 'same' ? [`${c.name}: ${plantedB[i]!.result}`] : [])),
      `under ${HOLD_ANYWHERE} exposure, contrast and noise are decided on machine B as on A`).toEqual(cases.flatMap((c) => (c.machines === 'same' ? [`${c.name}: FAIL`] : [])));
  }, TIMEOUT);
});
