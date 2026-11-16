// AC7 #468.af788480: A level camera at 1.6 m with `shift: [0, 0.3]` framing the top of a 30 m tower projects every
// vertical edge within 0.05° of vertical; a planted twin that pitches the camera 12° fails `verticals_max: 0.5`, naming
// the item and the angle. A planted exporter that drops the shift silently fails.
//
// The fixture (README: Documents): a 1500 × 1000 frame (3:2), a camera at (0, 1.6, 50) looking level at (0, 1.6, 0)
// through `lens: {focal_length: 20, sensor: [36, 24], fit: wider, shift: [0, 0.3]}` (833.33 px of focal length; the shift
// a fraction of the sensor's width and height, positive y raising the view, so the optical axis lands 0.3 of the frame
// below its centre, at row 800), and `tower`, a 10 × 30 × 10 m box standing on the ground at the origin. Its top corners
// land at rows 274.1 (front) and 369.7 (back); without the shift its front top would be cut at row −25.9. The twin
// drops the shift and pitches the camera 12° up (its target 50 m along the pitched view), so the tower's vertical edges
// lean 1.08° (back) and 1.32° (front).
//
// 1. Through `deep-gpu run`'s `view3d` with `project` (Assumed surface 3): the tower's eight corners. Each vertical edge
//    (bottom corner to top corner) within 0.05° of the frame's vertical, and every corner within 0.5 px of where #378's
//    pinhole with the shift puts it, inside the frame.
// 2. Through `deep-show run` (#1938's stored documents, claims and `verdict`): each document the deliverable of a claim
//    whose requirement is `{kind: "camera.framing", keep: ["tower"], verticals_max: 0.5}`. The shifted camera PASSes with
//    nothing raised; the pitched twin FAILs with an error or warning by camera.framing whose `ids` hold `tower` and which
//    names the angle: an angle in the issue (a number followed by ° in its text, or under a key naming an angle, lean,
//    vertical or pitch) within 0.05 of an edge's lean (1.08° or 1.32°) or of the 12° pitch. Then,
//    in #493's scenario, the shifted document presented by `deep show` and `export`ed with `video: {codec: "gltf"}`
//    (Export: glTF, the target scene3d fills) and `range: {still: {t: 0}}` is `exported` and its receipt's `warnings`
//    hold `{item: "cam", what}` with `what` naming the shift; under the scenario's planted `gltf_drops_shift` it is
//    exported with no such warning, and that check fails, naming `cam`.
//
// Wrong programs: the base (no lens, no `project`, no `verticals_max`, no gltf target); a shift done by pitching the
// camera (its verticals lean), or by moving the frame the wrong way (the top cut); a verticals check that never
// fires, or fires without naming the item or the angle; an exporter that drops the shift without a word.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claimId, claimOf, docId, raised, reqId, rowOf, run as runShow, scenarioOf, useBuild, useFolders, verdict, passFailures,
} from '../1938/helpers.ts';
import {
  AC, DARK_SKY, box, deg, frameAt, framesOf, isObject, lensCamera, none, project, projectedOf, rad, requireMetal, runGpu, shown, unlit, useGpu, useOut,
  view3d, writeJson, sceneDoc, type JsonObject, type JsonValue, type Lens, type Pinhole, type V3,
} from './helpers.ts';

const ID = AC[7];
const gpu = useGpu();
const show = useBuild();
const out = useOut();
const folder = useFolders();
const SIZE: [number, number] = [1500, 1000];
const FOCAL = (SIZE[0] * 20) / 36;
const EYE: V3 = [0, 1.6, 50];
const SHIFTED: Lens = { focal_length: 20, sensor: [36, 24], fit: 'wider', shift: [0, 0.3] };
const PITCH = 12;
const PITCHED_TARGET: V3 = [0, 1.6 + 50 * Math.sin(rad(PITCH)), 50 - 50 * Math.cos(rad(PITCH))];
const CORNERS: V3[] = [];
for (const x of [-5, 5]) for (const z of [-5, 5]) CORNERS.push([x, 0, z], [x, 30, z]);
/** The tower's four vertical edges: bottom and top corner indices in CORNERS. */
const EDGES: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7]];

const items = (cam: JsonObject): Record<string, JsonObject> => ({ cam, sky: DARK_SKY, stone: unlit([0.6, 0.58, 0.55]), tower: box([10, 30, 10], [0, 15, 0], 'stone') });
const shiftedCam = (): JsonObject => lensCamera(EYE, [0, 1.6, 0], SHIFTED);
const pitchedCam = (): JsonObject => lensCamera(EYE, PITCHED_TARGET, { focal_length: 20, sensor: [36, 24], fit: 'wider' });
const reference: Pinhole = { position: EYE, target: [0, 1.6, 0], focal: FOCAL, size: SIZE, shift: [0, 0.3] };
const pitchedRef: Pinhole = { position: EYE, target: PITCHED_TARGET, focal: FOCAL, size: SIZE };
const lean = (a: readonly number[], b: readonly number[]): number => deg(Math.atan2(Math.abs(b[0]! - a[0]!), Math.abs(b[1]! - a[1]!)));
const LEANS = EDGES.map(([a, b]) => lean(project(pitchedRef, CORNERS[a]!)!, project(pitchedRef, CORNERS[b]!)!));

// deep-show's stored documents, as #1938's suite writes them: alpha's layer, every item given its ID, name and order.
function stored(title: string, its: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(its)) withIds[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, layer: 'alpha-main', ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #468 acceptance fixture.`, size: [...SIZE], camera: 'cam', safe: 24,
    requires: { modules: { scene3d: '^1' } }, layers: { 'alpha-main': { writer: 'agent:thread-alpha', title: 'Claude Code: the loop', order: 'a0' } }, items: withIds,
  };
}
/** The angles an issue names: a number in its text followed by a degree sign, or a number under a key that says it is
 * an angle (holding `angle`, `lean`, `vertical` or `pitch`), at any depth. */
function anglesIn(v: JsonValue | undefined, key = ''): number[] {
  const angled = /angle|lean|vertical|pitch/i.test(key);
  if (typeof v === 'number') return angled ? [v] : [];
  if (typeof v === 'string') return [...v.matchAll(/(-?\d+(?:\.\d+)?)\s*°/g)].map((m) => Number(m[1]));
  if (Array.isArray(v)) return v.flatMap((x) => anglesIn(x, key));
  if (isObject(v)) return Object.entries(v).flatMap(([k, x]) => anglesIn(x, angled ? key : k));
  return [];
}
// The export runs on a revision the hub holds: #493's scenario, the document presented by `deep show` from your shell
// (as you), then `export` of it.
const EXPORT_DOC = '01JB0468D00000000000000001';
const YOU = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
function exportScenario(evidence: string, document: JsonObject, planted?: string): JsonObject {
  const payload = JSON.parse(JSON.stringify(document)) as JsonObject;
  delete payload['layers'];
  for (const item of Object.values(payload['items'] as JsonObject)) if (isObject(item)) delete item['layer'];
  return {
    evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs: { [EXPORT_DOC]: { panel: 'main' } }, ...(planted ? { planted } : {}),
    calls: [
      { call: 'deep show', peer: YOU, doc: EXPORT_DOC, document: { ...payload, id: 'tower-shifted' }, include: ['issues'] },
      { call: 'export', doc: EXPORT_DOC, out: join(evidence, 'tower.glb'), video: { codec: 'gltf' }, range: { still: { t: 0 } } },
    ],
  };
}
/** The export's reply held to the criterion: exported, its receipt's warnings listing cam's shift. */
function exportFailures(reply: JsonObject, what: string): string[] {
  if (reply['outcome'] !== 'exported') return [`${what}: the glTF export of the shifted camera is not exported: ${shown(reply)}`];
  const receipt = isObject(reply['receipt']) ? reply['receipt'] : {};
  const warnings = Array.isArray(receipt['warnings']) ? receipt['warnings'].filter(isObject) : [];
  const named = warnings.some((w) => w['item'] === 'cam' && /shift/i.test(JSON.stringify(w['what'] ?? '')));
  return named ? [] : [`${what}: cam: the receipt's warnings don't list its shift [0, 0.3], which glTF can't carry: ${shown(receipt['warnings'] ?? null)}`];
}

describe(`${ID} a shifted lens keeps verticals vertical; pitching fails verticals_max; a glTF export lists the shift`, () => {
  it(`${ID} the level camera with shift [0, 0.3] projects every vertical edge of the 30 m tower within 0.05° of vertical, with its top framed where the shifted pinhole puts it`, () => {
    requireMetal();
    const dir = out();
    const [reply] = runGpu(gpu(), dir, [view3d({ doc: writeJson(dir, 'tower', sceneDoc('tower-shifted', SIZE, items(shiftedCam()), { transport: { span: '1s' } })), size: SIZE, project: CORNERS })]);
    const got = projectedOf(frameAt(framesOf(reply!, 'the shifted tower'), 0, 'the shifted tower'), CORNERS.length, 'the shifted tower');
    const failures: string[] = [];
    EDGES.forEach(([a, b], k) => {
      const p = got[a]; const q = got[b];
      if (!p || !q) { failures.push(`tower: vertical edge ${k} has no projection (${shown(p)} to ${shown(q)})`); return; }
      const l = lean(p, q);
      console.log(`${ID} shifted: tower's vertical edge at (${CORNERS[a]![0]}, ${CORNERS[a]![2]}) runs from (${p.map((v) => v.toFixed(2))}) to (${q.map((v) => v.toFixed(2))}), ${l.toFixed(5)}° off vertical`);
      if (!(l <= 0.05)) failures.push(`tower: vertical edge at (${CORNERS[a]![0]}, ${CORNERS[a]![2]}) leans ${l.toFixed(4)}° (within 0.05° wanted)`);
    });
    CORNERS.forEach((c, i) => {
      const want = project(reference, c)!; const p = got[i];
      const off = p ? Math.hypot(p[0] - want[0], p[1] - want[1]) : Infinity;
      if (!(off <= 0.5)) failures.push(`tower: corner (${c.join(', ')}) at ${shown(p)}, ${off.toFixed(3)} px from where the shifted lens puts it (${want[0].toFixed(2)}, ${want[1].toFixed(2)})`);
      if (p && !(p[0] >= 0 && p[0] <= SIZE[0] && p[1] >= 0 && p[1] <= SIZE[1])) failures.push(`tower: corner (${c.join(', ')}) at (${p.join(', ')}) is outside the frame`);
    });
    none(failures, `${ID}: the shifted lens's verticals`);
  });

  it(`${ID} verticals_max 0.5 passes the shifted camera and fails the twin pitched 12°, naming tower and the angle; the glTF export lists cam's shift in its receipt's warnings, and the planted gltf_drops_shift fails`, () => {
    const check: JsonObject = { kind: 'camera.framing', keep: ['tower'], verticals_max: 0.5 };
    const docs = { [docId(1)]: stored('A tower through a shifted lens', items(shiftedCam())), [docId(2)]: stored('A tower through a pitched camera', items(pitchedCam())) };
    const claims = { [claimId(1)]: claimOf(docId(1), reqId(1), check), [claimId(2)]: claimOf(docId(2), reqId(2), check) };
    const replies = runShow(show(), scenarioOf(folder(), docs, claims, [verdict(claimId(1)), verdict(claimId(2))]));
    const exporting = (planted?: string): JsonObject => {
      const [shownDoc, exported] = runShow(show(), exportScenario(folder(), docs[docId(1)]!, planted));
      expect(shownDoc!['outcome'], `the shifted tower is presented for its export: ${shown(shownDoc)}`).toBe('presented');
      return exported!;
    };
    const failures: string[] = [];
    failures.push(...passFailures(rowOf(replies[0]!, reqId(1), 'the shifted camera'), 'the shifted camera under verticals_max 0.5'));
    const twin = rowOf(replies[1]!, reqId(2), 'the pitched twin');
    console.log(`${ID} pitched twin: ${twin.result}; its edges lean ${LEANS.map((l) => l.toFixed(3)).join(', ')}°; raised: ${raised(twin).map((i) => shown(i.raw, 400)).join(' | ')}`);
    if (twin.result !== 'FAIL') failures.push(`the twin pitched 12° is ${twin.result} under verticals_max 0.5, not FAIL`);
    const angles = [...new Set(LEANS.filter((l) => l > 0.5).map((l) => Number(l.toFixed(9)))), PITCH];
    const naming = raised(twin).filter((i) => i.check === 'camera.framing' && i.ids.includes('tower') && anglesIn(i.raw).some((n) => angles.some((a) => Math.abs(Math.abs(n) - a) <= 0.05)));
    if (naming.length === 0) failures.push(`the pitched twin raises no camera.framing issue naming tower and the angle (${angles.map((a) => a.toFixed(2)).join('°, ')}°)`);
    failures.push(...exportFailures(exporting(), 'the shipped exporter'));
    none(failures, `${ID}: verticals_max and the export`);

    const planted = exporting('gltf_drops_shift');
    const plantedFailures = exportFailures(planted, 'the planted gltf_drops_shift');
    console.log(`${ID} planted gltf_drops_shift: ${plantedFailures.join('; ') || 'nothing found'}`);
    expect(planted['outcome'], `the planted exporter drops the shift silently: it still exports (${shown(planted)})`).toBe('exported');
    expect(plantedFailures.some((f) => f.includes('cam') && f.includes('shift')), `the planted gltf_drops_shift fails the check, naming cam's shift: ${plantedFailures.join('; ')}`).toBe(true);
  });
});
