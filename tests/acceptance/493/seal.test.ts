// AC2 #493.872906a8: A 2D film with a 2 s push shot, sealed in a build without the scene3d module, hashes the same at
// every cue end, by evaluated data and Vello CPU snapshot, as in the full build, since the camera is the core's (#64);
// and a planted build that registers camera@1 in scene3d refuses that film with module_missing, naming scene3d, and
// fails this.
//
// Through `deep-show run` in three builds (README: Builds): `full`; `r1`, the build set without scene3d (#305); and
// `r1,test-camera-in-scene3d`, the plant. The film is presented, then `eval` at each cue end with `pixels` and `film`:
// the film block (the camera's evaluated pose), every node result of the modules both builds hold, and the snapshot's
// SHA-256 must be equal between `r1` and `full`. The push must move the camera, so a build that ignores shots in both
// fails too.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, TIMEOUT, arr, camera2d, evalCall, failsNaming, film, filmOf, fl, isObject, mentions, none, obj, poseFrom, present, presented,
  rect, runRaw, runShow, scenario, shot, show, snapshotOf, useEvidence, useShow, type JsonObject, type JsonValue,
} from './helpers.ts';

const FULL = 'full';
const R1 = 'r1';
const PLANTED = 'r1,test-camera-in-scene3d';
const shows = useShow([FULL, R1, PLANTED]);
const evidence = useEvidence();

const SIZE: [number, number] = [640, 360];
const FILM = film('push-2d', [
  camera2d(SIZE),
  rect('back', [0, 0, 640, 360], 'ground'),
  rect('block', [200, 120, 240, 120], 'accent'),
  rect('dot', [80, 60, 40, 40], 'ink'),
], {
  shots: { push: shot(0, 2, { move: 'push', frame: { keep: ['block'] } }) },
  markers: { c1: { kind: 'cue', t: '0s', span: '0.5s' }, c2: { kind: 'cue', t: '0.5s', span: '0.7s' }, c3: { kind: 'cue', t: '1.2s', span: '0.8s' } },
}, { span: '3s' }, SIZE);
const CUE_ENDS = [0.5, 1.2, 2];

interface Reading { film: string; widths: number; nodes: Map<string, string>; modules: Set<string>; snapshot: string }
/** The film at each cue end in one build: its film block, its node results by operator and item, and its snapshot. */
function readings(features: string): Reading[] {
  const replies = runShow(shows.bin(features), scenario(evidence(), [present(DOC.a, FILM), ...CUE_ENDS.map((s) => evalCall(DOC.a, fl(s), { pixels: true, film: true }))]));
  presented(replies[0]!, `the 2D film in ${features}`);
  return CUE_ENDS.map((s, i) => {
    const r = replies[i + 1]!; const what = `${features} at the cue end ${s} s`;
    const f = filmOf(r, what);
    const nodes = new Map<string, string>(); const modules = new Set<string>();
    for (const n of arr(r['nodes'], `${what}: nodes`)) {
      const o = obj(n, `${what}: a node`);
      nodes.set(`${String(o['module'])} ${String(o['operator'])} ${String(o['item'])}`, String(o['result']));
      modules.add(String(o['module']));
    }
    return { film: JSON.stringify(f.raw), widths: poseFrom(f.cameras['cam'], `${what}: film.cameras.cam`).view_width, nodes, modules, snapshot: snapshotOf(r, what).sha256 };
  });
}

/** The criterion's comparison: r1's film equals the full build's at every cue end, and its push moves the camera. */
function sameFailures(bare: Reading[], full: Reading[], build: string): string[] {
  const failures: string[] = [];
  CUE_ENDS.forEach((s, i) => {
    const b = bare[i]!; const f = full[i]!;
    if (b.film !== f.film) failures.push(`${build} at ${s} s: the evaluated film block differs from the full build's: ${b.film.slice(0, 300)} vs ${f.film.slice(0, 300)}`);
    for (const [key, result] of b.nodes) {
      if (!f.modules.has(key.split(' ')[0]!)) continue;
      if (f.nodes.get(key) !== result) failures.push(`${build} at ${s} s: node ${key} gives ${result}, the full build ${String(f.nodes.get(key))}`);
    }
    if (b.snapshot !== f.snapshot) failures.push(`${build} at ${s} s: the Vello CPU snapshot is ${b.snapshot}, the full build's ${f.snapshot}`);
  });
  if (!(bare[0]!.widths > bare[2]!.widths * 1.0001)) failures.push(`${build}: the push doesn't move the camera: view width ${bare[0]!.widths} at 0.5 s, ${bare[2]!.widths} at 2 s`);
  return failures;
}

describe(`${AC[2]} a 2D film's push needs no scene3d: the camera is the core's`, () => {
  it(`${AC[2]} the build without scene3d seals without it and holds camera@1 in the core`, () => {
    const [registry] = runShow(shows.bin(R1), scenario(evidence(), [{ call: 'registry' }]));
    const modules = arr(registry!['modules'], 'registry: modules');
    expect(modules, 'r1 holds no scene3d module').not.toContain('scene3d');
    expect(modules, 'r1 holds the motion module').toContain('motion');
    expect(obj(registry!['kinds'], 'registry: kinds')['camera@1'], 'camera@1 is the core\'s').toBe('core');
  }, TIMEOUT);

  it(`${AC[2]} a 2D film with a 2 s push hashes the same at every cue end, by evaluated data and Vello CPU snapshot, sealed without scene3d as in the full build`, () => {
    none(sameFailures(readings(R1), readings(FULL), R1), 'the film without scene3d against the full build');
  }, TIMEOUT);

  it(`${AC[2]} a planted build that registers camera@1 in scene3d refuses that film with module_missing, naming scene3d, and fails the check`, () => {
    const bin = shows.bin(PLANTED);
    const run = runRaw(bin, scenario(evidence(), [present(DOC.a, FILM), ...CUE_ENDS.map((s) => evalCall(DOC.a, fl(s), { pixels: true, film: true }))]));
    const missing: JsonObject[] = [];
    const walk = (v: JsonValue): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (isObject(v)) { if (v['code'] === 'module_missing') missing.push(v); Object.values(v).forEach(walk); }
    };
    walk(run.lines);
    expect(missing.some((m) => mentions(m, 'scene3d')), `a module_missing refusal names scene3d: ${run.stdout.slice(0, 2000)}`).toBe(true);
    let planted: Reading[] | null = null;
    const failures: string[] = [];
    try { planted = readings(PLANTED); } catch (e) { failures.push(`${PLANTED}: the film isn't evaluated: ${(e as Error).message.slice(0, 400)}`); }
    if (planted) failures.push(...sameFailures(planted, readings(FULL), PLANTED));
    failsNaming(failures, [PLANTED], `the comparison in the planted build (${show(missing[0])})`);
  }, TIMEOUT);
});
