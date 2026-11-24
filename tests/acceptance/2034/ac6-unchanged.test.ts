// AC6 #2034.7732697b: "Every fixture already in the repo that names `spots` or `points`, or declares at most 2
// shadowed spots and no shadowed point, draws a frame byte-identical to the merge base. The hall with `shadowed.local:
// fixed` shadows 2 spots and reports the other 16 lights once each by ID, as today"
//
// 1. On macOS's Metal device: the merge base (`git merge-base HEAD origin/main`) exported with `git archive` and its
//    `deep-gpu` built there (helpers: `mergeBaseGpu`, git run with no GIT_* variables). The fixtures (README: AC6's
//    fixtures): every scene document in the merge base's JSON files outside `docs/evidence/`, the local-shadow
//    fixtures other suites build in code that name counts (#446's plank, night house and engine under a spot, #432's
//    shadow casters, #1937's over-class showpiece), and the trio (helpers: `trioDoc`: 3 shadowed spots,
//    `local_map: 1024`, no counts: the issue's Scope keeps the fixed rule for it). Each the criterion holds
//    (helpers: `heldByAc6`) is drawn at frame 0 at its own size by both binaries, each document in a process of its
//    own, with the final and linear targets: the pixel hash and the linear target's SHA-256 must be the merge base's.
//    A document the merge base doesn't draw (it refuses it or stops) has no frame to compare and is listed, as are
//    the documents the criterion leaves out; the trio must draw at the merge base.
// 2. On the noop lane, anywhere: the hall (helpers: `hallDoc`) at `inside` with `light_policy: {soft: {method: pcss},
//    shadowed: {local: fixed}}`, three frames with `shadows: true`: every frame's maps are the two spots first in the
//    policy's order at the pose (score bucket, then ID: #1634's `ordered`), and over the three frames
//    `lights_over_budget` names each of the other 16 lights' shadows once, in frame 0, and no other.
// The merge base passes both by construction; they hold the change to the base's picture. Wrong programs: tiles for a
// document that names counts or `local_map`, or that declares at most 2 shadowed spots; any change to the shaders or
// passes such documents run; `fixed` read as tiles; a notice each frame, or one that leaves a light out.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, REPO, TIMEOUT, framesOf, isObject, none, requireMetal, shown, useDir, useGpu, view3dCall, writeJson, type JsonObject } from '../1634/helpers.ts';
import { ordered } from '../1634/reference.ts';
import { sessionDoc as overClassDoc } from '../1937/helpers.ts';
import { shadowDoc } from '../432/helpers.ts';
import { engineDoc, houseDoc, plankDoc } from '../446/helpers.ts';
import { AC, HALL, HALL_LAMPS, HALL_POSES, droppedShadows, hallDoc, heldByAc6, mapsOf, mergeBaseGpu, runGpu, sceneFixtures, trioDoc, type Fixture } from './helpers.ts';

const ID = AC[6];
/** The hall's third pose, the eye inside spot_01's and spot_09's ranges. */
const INSIDE = HALL_POSES[2]!.cam;
const bin = useGpu();
const dir = useDir();

type Drawn = { final: string; linear: string | null } | { refused: string };
/** One document's frame 0 at its size, in a process of its own started in `tree` (its checkout), its outputs in a
 * folder deleted after; what it drew, or why it didn't. A run that hangs is stopped by spawnSync's own timeout. */
function draw(binary: string, tree: string, scratch: string, doc: JsonObject): Drawn {
  const size = doc['size'];
  if (!Array.isArray(size) || size.length !== 2 || !size.every((v) => typeof v === 'number')) return { refused: `no size ${shown(size)}` };
  const out = mkdtempSync(join(scratch, 'draw-'));
  const call = { call: 'view3d', doc: writeJson(out, 'doc', doc), look: PLAIN_LOOK, size, frames: 1, capture: [0], targets: ['final', 'linear'] };
  const run = spawnSync(binary, ['run'], { cwd: tree, input: `${JSON.stringify({ out, calls: [call] })}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 1_200_000, killSignal: 'SIGKILL' });
  rmSync(out, { recursive: true, force: true });
  const line = (run.stdout ?? '').split('\n').find((l) => l !== '');
  if (run.status !== 0 || !line) return { refused: `exit ${String(run.status)}${run.signal ? ` (${run.signal})` : ''}: ${(run.stderr ?? '').slice(-300)}` };
  const answer = JSON.parse(line) as JsonObject;
  const reply = Array.isArray(answer['replies']) ? answer['replies'][0] : undefined;
  if (answer['ok'] !== true || !isObject(reply) || reply['code'] !== undefined) return { refused: shown(reply ?? answer).slice(0, 300) };
  const frame = Array.isArray(reply['frames']) ? reply['frames'][0] : undefined;
  if (!isObject(frame) || typeof frame['pixel_hash'] !== 'string') return { refused: `no frame 0 with a pixel hash: ${shown(frame).slice(0, 300)}` };
  return { final: frame['pixel_hash'], linear: typeof frame['linear'] === 'string' ? frame['linear'] : null };
}

/** The fixtures other suites build in code that name counts, and the trio. */
function generated(): Fixture[] {
  const docs: [string, JsonObject][] = [
    ['tests/acceptance/446 plankDoc(0.1)', plankDoc(0.1)], ['tests/acceptance/446 houseDoc(night)', houseDoc('night')], ['tests/acceptance/446 engineDoc(spot, cut)', engineDoc('spot', 'cut')],
    ['tests/acceptance/432 shadowDoc', shadowDoc('shadows-2034')], ['tests/acceptance/1937 sessionDoc', overClassDoc()],
    ['the trio (3 shadowed spots, local_map: 1024, no counts)', trioDoc()],
  ];
  return docs.map(([name, doc]) => ({ name, doc, ...heldByAc6(doc), ...(name.startsWith('the trio') ? { held: true, why: 'names local_map' } : {}) }));
}

describe(`${ID} documents the change leaves alone`, () => {
  it(`${ID} every fixture that names spots or points, or declares at most 2 shadowed spots and no shadowed point, draws a frame byte-identical to the merge base, the trio with local_map among them`, () => {
    requireMetal();
    const out = dir();
    const base = mergeBaseGpu(out);
    expect(typeof base === 'string' ? base : '', 'the merge base exports and its deep-gpu builds').toBe('');
    if (typeof base === 'string') return;
    const made = generated();
    const fixtures = [...sceneFixtures(base), ...made];
    const left = fixtures.filter((f) => !f.held);
    console.log(`${ID}: ${fixtures.length} scene documents; the criterion leaves out ${left.length}: ${left.map((f) => `${f.name} (${f.why})`).join('; ')}`);
    const failures: string[] = []; const undrawn: string[] = []; let compared = 0;
    for (const f of fixtures.filter((x) => x.held)) {
      const then = draw(base.bin, base.src, out, f.doc);
      if ('refused' in then) {
        undrawn.push(`${f.name}: ${then.refused}`);
        if (f === made.at(-1)) failures.push(`${f.name} doesn't draw at the merge base: ${then.refused}`);
        continue;
      }
      const now = draw(bin(), REPO, out, f.doc);
      compared++;
      if ('refused' in now) failures.push(`${f.name} (${f.why}) draws at the merge base but not now: ${now.refused}`);
      else if (now.final !== then.final || now.linear !== then.linear) {
        failures.push(`${f.name} (${f.why}) draws a different frame: pixel hash ${now.final.slice(0, 12)}… where the merge base has ${then.final.slice(0, 12)}…, linear ${String(now.linear).slice(0, 12)}… where it has ${String(then.linear).slice(0, 12)}…`);
      }
    }
    console.log(`${ID}: compared ${compared} documents with the merge base ${base.rev.slice(0, 12)}; it draws no frame of ${undrawn.length}: ${undrawn.join('; ').slice(0, 3000)}`);
    expect(compared, 'more fixtures are compared than the code-built ones').toBeGreaterThan(made.length);
    none(failures, `${ID}: the frames the change must leave as they were`);
  }, 4 * TIMEOUT);

  it(`${ID} the hall with shadowed.local: fixed shadows 2 spots and reports the other 16 lights once each by ID, as today`, () => {
    // Today's rule fades a kept spot's shadow out as its score nears the first spot left out (Light and the light
    // policy: "blended across a score margin"), so the pose is one where both kept spots score 10% or more above it.
    const scored = ordered(INSIDE, HALL_LAMPS).filter((s) => s.id.startsWith('spot_'));
    expect(scored[1]!.score, 'at the inside pose the 2nd spot scores 10% or more above the 3rd').toBeGreaterThanOrEqual(1.1 * scored[2]!.score);
    const out = dir();
    const doc = hallDoc('hall-fixed', INSIDE, { soft: { method: 'pcss' }, shadowed: { local: 'fixed' } });
    const call = { ...view3dCall({ doc: writeJson(out, 'hall-fixed', doc), look: PLAIN_LOOK, size: HALL.size, frames: 3, targets: [] }), shadows: true };
    const [reply] = runGpu(bin(), out, [call], { lane: 'noop' });
    const kept = scored.slice(0, 2).map((s) => s.id).sort();
    const others = HALL_LAMPS.map((l) => l.id).filter((id) => !kept.includes(id)).sort();
    const failures: string[] = [];
    const told = new Map<string, number[]>();
    for (const f of framesOf(out, reply!, HALL.size, 'the hall under fixed')) {
      const maps = mapsOf(f, `the hall under fixed, frame ${f.frame}`).map((m) => m.light).sort();
      if (maps.join(' ') !== kept.join(' ')) failures.push(`frame ${f.frame} shadows ${maps.join(', ') || 'nothing'}, where today's rule shadows ${kept.join(' and ')}`);
      for (const id of droppedShadows(f, `the hall under fixed, frame ${f.frame}`)) told.set(id, [...(told.get(id) ?? []), f.frame]);
    }
    for (const id of others) {
      const frames = told.get(id) ?? [];
      if (frames.length !== 1 || frames[0] !== 0) failures.push(`${id}'s dropped shadow is reported in frames [${frames.join(', ')}], not once in frame 0`);
    }
    for (const id of kept) if (told.has(id)) failures.push(`${id} keeps its shadow but is reported dropped in frames [${told.get(id)!.join(', ')}]`);
    none(failures, `${ID}: the hall under shadowed.local: fixed`);
  }, TIMEOUT);
});
