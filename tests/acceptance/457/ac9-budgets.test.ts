// #457.5b7ca30a: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the cheap loop
// checks of a 1,000-item scene run in under 100 ms off the UI thread, the scene audit within 500 ms per 1,000 parts, a
// pixel check adds under 0.2 ms of GPU and a few kilobytes of readback per checked time, the occluded share of 10 kept
// items at 64 samples each takes under 5 ms, geometry.shading counts 100,000 triangles in under 50 ms, and the ID view
// adds under 2 ms to a render-back; the camera path measures of a 60 s film take under 50 ms"
//
// Fixtures (helpers.ts), each the one deliverable of a claim of alpha's, all judged in one `deep-show run` per reading:
//   - `bigScene`: a still 1,000-part scene (a plate and 999 0.3 m boxes standing on it), ten of the boxes kept (the
//     collection `hero`). Its claim's requirements: `scene.scale`; `camera.framing` keeping the ten (occluded share at
//     its default 64 samples); the scene audit `{kind: geometry.audit, scope: scene, support: {floating: [plate]}}`;
//     `render.exposure` on `hero`, the pixel check;
//   - `torusDoc`: a closed torus of exactly 100,000 triangles (`mesh.asset@1`), `geometry.shading`;
//   - `longFilm`: a 60 s keyed shot circling a kept fountain, `camera.framing` keeping it;
//   - #456's review room with its `render.review` claim and its stub model answering QUIET.
// Readings, each from its requirement's row `timing` (README: Surfaces this suite assumes), in ms unless said:
//   cheap loop checks = scene.scale's `check_ms` + camera.framing's `check_ms` on the 1,000-part scene (< 100);
//   scene audit = geometry.audit's `check_ms` (< 500 for its 1,000 parts);
//   pixel check = render.exposure's `gpu_ms` ÷ `times` (< 0.2), and `readback_bytes` ÷ `times` (a few kilobytes: at most
//   8,192 bytes, a count judged on every machine and every run);
//   occluded share = camera.framing's `occluded_ms` ÷ its checked times (< 5);
//   geometry.shading = its `check_ms` on the torus (< 50);
//   ID view = render.review's `id_view_ms`, what drawing its ID view added to the render-back of its snapshot (< 2);
//   camera paths = the film's camera.framing `paths_ms` (< 50).
//
// The test first runs the readings once on the debug build, on any Mac: every row decided (render.review's a reading),
// every reading present, the ten kept boxes each with an occluded share, the film with clearance readings, the readback
// within its count. Then scripts/lanes.mjs must list this file in `timed` (the local preflight's perf step). Then the
// perf lane's own judgeLimit (scripts/benchmark.mjs) says whether this machine can judge a timing now (a reference Mac
// on mains power, Low Power Mode off, thermal state nominal, the load under the core count); if not, INCONCLUSIVE before
// a release build. If so, `full` is built in release, one warm-up process runs, then five fresh processes, each held to
// the debug run's checks, and judgeLimit judges each reading over the five with each run's load at its start and end:
// a FAIL fails, anything but PASS is INCONCLUSIVE, never a pass. "Off the UI thread": `deep-show run` is headless and
// runs every check off any UI thread. "Compared with the merge base": the preflight's edit guard runs this file on the
// merge base too, where its debug run fails (BASE-FAILURE.txt), as #405's redraft reads it; no budgets.json task is
// added. Wrong programs: the base (no such timings); any reading over its limit on the reference Mac (judgeLimit's
// FAIL); a readback over 8 KiB per checked time; a timing taken where the work doesn't run (the debug run's checks).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL, QUIET, ROOM_CLAIM, ROOM_DOC, ROOM_REVIEW, reviewRoom, roomClaim } from '../456/helpers.ts';
import {
  KEPT_TEN, REPO, TIMEOUT, bigScene, brief, canJudge, claimId, claimOn, decided, docId, gpuGate, inconclusive, isObject, judgeLimit, load, longFilm,
  none, occludedOf, pathsOf, putEvidence, reqId, requireMetal, rowOf, run, scenarioOf, torus, torusDoc, useBuilds, useFolders, verdict,
  type JsonObject, type Load, type Row,
} from './helpers.ts';

const ID = '#457.5b7ca30a';
const builds = useBuilds();
const folder = useFolders();
const [BIG_DOC, TORUS_DOC, FILM_DOC] = [docId(1), docId(2), docId(3)];
const [BIG_CLAIM, TORUS_CLAIM, FILM_CLAIM] = [claimId(1), claimId(2), claimId(3)];
const REQ = { scale: reqId(1), framing: reqId(2), audit: reqId(3), exposure: reqId(4), shading: reqId(5), paths: reqId(6) } as const;
const PARTS = 1000;
const READBACK_BYTES = 8192;
const LIMITS = { cheap: 100, audit: (500 * PARTS) / 1000, pixel: 0.2, occluded: 5, shading: 50, idView: 2, paths: 50 } as const;
type Name = keyof typeof LIMITS;
const LABEL: Record<Name, string> = {
  cheap: 'the cheap loop checks of the 1,000-part scene, ms', audit: 'the scene audit of 1,000 parts, ms', pixel: 'render.exposure, GPU ms per checked time',
  occluded: 'the occluded share of 10 kept items at 64 samples, ms per checked time', shading: 'geometry.shading of 100,000 triangles, ms',
  idView: 'the ID view added to a render-back, ms', paths: 'the camera path measures of a 60 s film, ms',
};

const timing = (row: Row, key: string): number | null => {
  const t = row.raw['timing'];
  const v = isObject(t) ? t[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
};

interface Reading { values: Partial<Record<Name, number>>; failures: string[] }
/** One fresh process: every fixture judged, every reading taken, and why any can't be. */
function reading(bin: string): Reading {
  const evidence = folder();
  const ring = torus(250, 200);
  const docs: Record<string, JsonObject> = { [BIG_DOC]: bigScene(), [TORUS_DOC]: torusDoc(putEvidence(evidence, ring.glb)), [FILM_DOC]: longFilm(), [ROOM_DOC]: reviewRoom() };
  const claims: JsonObject = {
    [BIG_CLAIM]: claimOn(BIG_DOC, [
      [REQ.scale, { kind: 'scene.scale' }], [REQ.framing, { kind: 'camera.framing', keep: [...KEPT_TEN] }],
      [REQ.audit, { kind: 'geometry.audit', scope: 'scene', support: { floating: ['plate'] } }], [REQ.exposure, { kind: 'render.exposure', subject: 'hero' }],
    ]),
    [TORUS_CLAIM]: claimOn(TORUS_DOC, [[REQ.shading, { kind: 'geometry.shading' }]]),
    [FILM_CLAIM]: claimOn(FILM_DOC, [[REQ.paths, { kind: 'camera.framing', keep: ['fountain'] }]]),
    ...roomClaim(),
  };
  const scenario = { ...scenarioOf(evidence, docs, claims, [verdict(BIG_CLAIM), verdict(TORUS_CLAIM), verdict(FILM_CLAIM), verdict(ROOM_CLAIM)]), review_model: { name: MODEL, replies: [QUIET] } };
  const [onBig, onTorus, onFilm, onRoom] = run(bin, scenario);
  const rows = {
    scale: rowOf(onBig!, REQ.scale, 'scene.scale on the 1,000-part scene'), framing: rowOf(onBig!, REQ.framing, 'camera.framing on the 1,000-part scene'),
    audit: rowOf(onBig!, REQ.audit, 'the scene audit of the 1,000-part scene'), exposure: rowOf(onBig!, REQ.exposure, 'render.exposure on the 1,000-part scene'),
    shading: rowOf(onTorus!, REQ.shading, 'geometry.shading on the torus'), paths: rowOf(onFilm!, REQ.paths, 'camera.framing on the 60 s film'),
    review: rowOf(onRoom!, ROOM_REVIEW, "render.review on #456's review room"),
  };
  gpuGate(rows.exposure, 'render.exposure on the 1,000-part scene');
  gpuGate(rows.review, "render.review on #456's review room");
  const failures: string[] = [];
  for (const [name, row] of Object.entries(rows)) if (name !== 'review' && !decided(row)) failures.push(`${name}: the row is ${row.result}, not decided: ${brief(row.raw, 800)}`);
  const need = (row: Row, key: string, what: string): number | null => {
    const v = timing(row, key);
    if (v === null) failures.push(`${what}: its row reports no timing.${key}: ${brief(row.raw['timing'] ?? null)}`);
    return v;
  };
  const values: Partial<Record<Name, number>> = {};
  const scale = need(rows.scale, 'check_ms', 'scene.scale');
  const framing = need(rows.framing, 'check_ms', 'camera.framing on the 1,000-part scene');
  if (scale !== null && framing !== null) values.cheap = scale + framing;
  const audit = need(rows.audit, 'check_ms', 'the scene audit');
  if (audit !== null) values.audit = audit;
  const gpu = need(rows.exposure, 'gpu_ms', 'render.exposure');
  const bytes = need(rows.exposure, 'readback_bytes', 'render.exposure');
  const times = need(rows.exposure, 'times', 'render.exposure');
  if (times !== null && !(times >= 1)) failures.push(`render.exposure reports ${times} checked times`);
  if (gpu !== null && times !== null && times >= 1) values.pixel = gpu / times;
  if (bytes !== null && times !== null && times >= 1 && !(bytes / times <= READBACK_BYTES)) failures.push(`render.exposure reads back ${bytes / times} bytes per checked time, more than a few kilobytes (${READBACK_BYTES})`);
  const occluded = occludedOf(rows.framing);
  for (const id of KEPT_TEN) if (!occluded.some((o) => o.item === id && o.share !== null)) failures.push(`camera.framing on the 1,000-part scene lists no occluded share for the kept ${id}`);
  const checked = new Set(occluded.map((o) => o.t)).size;
  const occludedMs = need(rows.framing, 'occluded_ms', 'camera.framing on the 1,000-part scene');
  if (occludedMs !== null && checked > 0) values.occluded = occludedMs / checked;
  const shading = need(rows.shading, 'check_ms', 'geometry.shading');
  if (shading !== null) values.shading = shading;
  const idView = need(rows.review, 'id_view_ms', 'render.review');
  if (idView !== null) values.idView = idView;
  if (pathsOf(rows.paths, 'clearance').length === 0) failures.push(`camera.framing on the 60 s film lists no clearance readings in its paths: ${brief(rows.paths.raw['results'] ?? null, 600)}`);
  const paths = need(rows.paths, 'paths_ms', 'camera.framing on the 60 s film');
  if (paths !== null) values.paths = paths;
  return { values, failures };
}

describe(`${ID} the loop's budgets on the reference Mac`, () => {
  it(`${ID} the cheap loop checks, the scene audit, a pixel check, the occluded share, geometry.shading, the ID view and the camera path measures each within budget on the reference Mac, five runs after warm-up`, async () => {
    requireMetal('render.exposure and the ID view');
    expect(torus(250, 200).triangles, 'the fixture: the torus has 100,000 triangles').toBe(100_000);
    none(reading(builds.debug()).failures, 'every reading is taken, on the debug build');
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, 'scripts/lanes.mjs times this file in the local preflight').toContain('tests/acceptance/457/ac9-budgets.test.ts');
    const here = await canJudge();
    if (here['status'] !== 'PASS') inconclusive(`every reading is taken, but this machine can't judge a timing now: ${String(here['reason'])}`);

    const bin = builds.release();
    none(reading(bin).failures, 'the release build\'s warm-up run');
    const runs: Partial<Record<Name, number>>[] = [];
    const loads: Load[] = [];
    for (let k = 1; k <= 5; k++) {
      const start = load();
      const r = reading(bin);
      loads.push({ start, end: load() });
      none(r.failures, `release run ${k}`);
      runs.push(r.values);
    }
    const judged: [Name, JsonObject][] = [];
    for (const name of Object.keys(LIMITS) as Name[]) judged.push([name, await judgeLimit(LIMITS[name], runs.map((r) => r[name] ?? NaN), loads)]);
    for (const [name, v] of judged) console.log(`${ID} ${LABEL[name]} (limit ${LIMITS[name]}): ${String(v['status'])} ${brief(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
    expect(judged.filter(([, v]) => v['status'] === 'FAIL').map(([n, v]) => `${LABEL[n]}: ${brief(v)}`), 'no budget fails').toEqual([]);
    const open = judged.filter(([, v]) => v['status'] !== 'PASS');
    if (open.length) inconclusive(open.map(([n, v]) => `${LABEL[n]}: ${String(v['status'])} ${String(v['reason'] ?? '')}`).join('; '));
  }, 4 * TIMEOUT);
});
