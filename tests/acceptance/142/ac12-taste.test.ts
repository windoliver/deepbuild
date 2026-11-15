// AC12 #142.0815c532: "Shown to you: screenshots of each film recipe's example in 2D and 3D, the kinetic-type slam and the
// explain.linear_map shear, taken by the check run from the canvas's own frames, with a recording of one example film
// and the linear_map shear, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it"
//
// This test judges no picture. It takes the pictures from `deep-show`'s own frames (`eval` with `pixels`, 640 px wide,
// each the canvas's PNG byte for byte) and keeps them in DEEPBUILD_EVIDENCE_DIR (else a folder under the temporary
// folder), named by kind and SHA-256, printing each path for the PR and the session:
//   - `<recipe>-2d.png` for the ten examples and `<recipe>-3d.png` for the nine with a 3D stage, each at the end of its
//     middle cue (its `cues.<id>` marker; the span's middle if it has none);
//   - `kinetic-slam.png`: the kinetic-type example 0.1 s into its first explain.slam cue;
//   - `linear-map-shear.png`: criterion 7's film at 0.5 s, the shear's middle;
//   - `kinetic-type.apng`: the kinetic-type example on the 2D stage, every frame at 30 fps over its span;
//   - `linear-map-shear.apng`: criterion 7's film over the shear, 0 to 1 s at 30 fps.
// Then it reads the record: the one call, in the file DEEPBUILD_TASTE_142 names (README: The taste call), `{issue: 142,
// criterion: "#142.0815c532", verdict: "looks_right" | "looks_wrong", who, when, files: {name → sha256}, note}`. No
// record, or one made on other files (another name or SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on
// exactly these files passes. This job records no call. Attaching the files to the PR and showing them in the session
// is the implementer's, outside any test.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, RECIPES, STAGED_3D, TIMEOUT, apng, apply, decodePng, docId, evalAt, evidenceDir, exampleOf, expansionOf, inconclusive,
  isObject, linearFilm, none, onStage, pngOf, present, run, scenario, sha256, sizeFor, snapshotOf, spanOf, useFolders, useShow,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const ID = AC[12].split(' ')[1]!;
const REC_FPS = 30;
const shear = linearFilm('A shear, then a stretch', [apply('shear', [[1, 1], [0, 1]]), apply('stretch', [[2, 0], [0, 1]])]);

/** Draws `doc` at each of `times` in one process: each frame's PNG, byte for byte. */
function frames(doc: JsonObject, times: number[], evidence: string, what: string): Buffer[] {
  const size = sizeFor(doc);
  const replies = run(show(), scenario(evidence, [present(docId(1), doc), ...times.map((t) => evalAt(docId(1), t, { pixels: true, size }))]));
  expect(replies[0]!['outcome'], `${what} is presented`).toBe('presented');
  return times.map((t, k) => pngOf(evidence, snapshotOf(replies[1 + k]!, `${what} at ${t} flicks`), `${what} at ${t} flicks`));
}

describe(`${AC[12]} one taste call on the canvas's own screenshots and recordings`, () => {
  it(`${AC[12]} the examples in 2D and 3D, the slam, the shear and two recordings, and the recorded taste call says they look right`, () => {
    const keep = evidenceDir();
    mkdirSync(keep, { recursive: true });
    const files: Record<string, string> = {};
    const kept = (name: string, bytes: Buffer): void => {
      const sha = sha256(bytes);
      const dot = name.lastIndexOf('.');
      const path = join(keep, `${name.slice(0, dot)}-${sha}${name.slice(dot)}`);
      writeFileSync(path, bytes);
      files[name] = sha;
      console.log(`for the taste call: ${path}`);
    };
    const missing: string[] = [];
    for (const recipe of RECIPES) {
      const ex = exampleOf(recipe);
      if (Array.isArray(ex)) { missing.push(...ex); continue; }
      const evidence = folder();
      const [shown] = run(show(), scenario(evidence, [present(docId(1), ex.doc)]));
      const mid = ex.cues[Math.floor(ex.cues.length / 2)];
      const marker = shown!['outcome'] === 'presented' && mid ? expansionOf(shown!, ex.instance, recipe).markers[`cues.${String(mid['id'])}`] : undefined;
      const at = marker ? Math.min(marker.t + marker.span, spanOf(ex.doc, recipe) - 1) : Math.floor(spanOf(ex.doc, recipe) / 2);
      for (const stage of (STAGED_3D as readonly string[]).includes(recipe) ? (['2d', '3d'] as const) : (['2d'] as const)) {
        kept(`${recipe}-${stage}.png`, frames(onStage(ex.doc, stage), [at], evidence, `${recipe} on the ${stage} stage`)[0]!);
      }
      if (recipe === 'kinetic_type') {
        const slam = ex.cues.find((c) => c['kind'] === 'explain.slam');
        const m = slam && shown!['outcome'] === 'presented' ? expansionOf(shown!, ex.instance, recipe).markers[`cues.${String(slam['id'])}`] : undefined;
        if (!m) missing.push('the kinetic-type example has no explain.slam cue with a marker to screenshot');
        else kept('kinetic-slam.png', frames(ex.doc, [m.t + Math.round(0.1 * FLICKS)], evidence, 'the kinetic-type slam')[0]!);
        const span = spanOf(ex.doc, recipe);
        const times = Array.from({ length: Math.floor((span * REC_FPS) / FLICKS) }, (_, k) => Math.round((k * FLICKS) / REC_FPS));
        kept('kinetic-type.apng', apng(frames(ex.doc, times, evidence, 'the kinetic-type film').map((b) => decodePng(b)), REC_FPS));
      }
    }
    none(missing, 'every example is there to show');
    const evidence = folder();
    kept('linear-map-shear.png', frames(shear, [FLICKS / 2], evidence, 'the linear_map shear')[0]!);
    const shearTimes = Array.from({ length: REC_FPS + 1 }, (_, k) => Math.round((k * FLICKS) / REC_FPS));
    kept('linear-map-shear.apng', apng(frames(shear, shearTimes, evidence, 'the linear_map shear').map((b) => decodePng(b)), REC_FPS));
    expect(Object.keys(files).length, '19 example screenshots, the slam, the shear and two recordings').toBe(23);

    const path = process.env['DEEPBUILD_TASTE_142'];
    const listed = Object.entries(files).map(([n, s]) => `${n} ${s}`).join('; ');
    if (!path || !existsSync(path)) inconclusive(`no taste call is recorded on these files (${listed}); record yours in a file named by DEEPBUILD_TASTE_142 (README: The taste call)`);
    let record: JsonValue;
    try { record = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`the taste record at ${path} is not JSON: ${(e as Error).message}`); }
    expect(isObject(record), 'the taste record is an object').toBe(true);
    const c = record as JsonObject;
    expect(c['issue'], 'the taste record: issue').toBe(142);
    expect(c['criterion'], 'the taste record: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'the taste record: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'the taste record: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'the taste record: when, an ISO 8601 time').toBe(true);
    const recorded = isObject(c['files']) ? c['files'] : {};
    const other = [...new Set([...Object.keys(recorded), ...Object.keys(files)])].filter((n) => recorded[n] !== files[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other files: ${other.map((n) => `${n} recorded ${String(recorded[n] ?? 'nothing')}, this run ${files[n] ?? 'nothing'}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, 4 * TIMEOUT);
});
