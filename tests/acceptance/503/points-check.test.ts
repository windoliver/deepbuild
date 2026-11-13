// AC2 #503.c6bbfb83 (the check and the evaluated data): "… a 1,920 × 1,080 video at step 1, 2,073,600 points, is
// refused at check in a showpiece, naming the item, while step 2 (518,400) checks; the set's evaluated data holds its
// bounds from near, far and fov, x within ±2.887 m, y within ±2.071 m and z from −5 to −1 m, and none of its points …"
// (the whole criterion is quoted in points.test.ts).
//
// The check is `deep show`'s (deep-show run); the evaluated data is the canvas core's, read by `spatial` (scene3d's
// spatial index: each item's world bounds) and `eval`; step 2's points are counted by `view3d`'s read-back.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AC, DEPTH, DOC, FLICKS, FULL, LICENSE, POINTS, TIMEOUT, arr, depthDocument, depthFrame, framesOf, frameAt, grayVideo, isObject, num, obj, pointsOf,
  present, putEvidence, requireMac, runGpu, runShowPid, scenario, sha256, show, str, useFileTemp, useGpu, useShow, useTemp, view3d, writeJson,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const gpu = useGpu();
const show_ = useShow([FULL]);
const fileTemp = useFileTemp('depth-check');
const temp = useTemp();
const HD: [number, number] = [1920, 1080];

const videos = { small: { path: '', sha: '' }, hd: { path: '', sha: '' } };
beforeAll(() => {
  if (process.platform !== 'darwin') return;
  const dir = fileTemp();
  videos.small.path = join(dir, 'depth-640.mp4');
  grayVideo(videos.small.path, [DEPTH.w, DEPTH.h], 30, (k) => depthFrame(k));
  videos.hd.path = join(dir, 'depth-1080.mp4');
  grayVideo(videos.hd.path, HD, 10, (k) => depthFrame(k, HD));
  for (const v of [videos.small, videos.hd]) v.sha = sha256(readFileSync(v.path));
}, TIMEOUT);

/** Whether an issue names the point set `depth`: in its `ids`, or in its `path` under items/depth. */
const namesDepth = (i: JsonObject): boolean =>
  (Array.isArray(i['ids']) && i['ids'].includes('depth')) || (typeof i['path'] === 'string' && /(^|\/)items\/depth(\/|$)/.test(i['path'])) || i['item'] === 'depth';

describe(`${AC[2]} the depth point set at check and in evaluated data`, () => {
  it(`${AC[2]} a 1,920 × 1,080 video at step 1 (2,073,600 points) is refused at check in a showpiece, naming the item, while step 2 checks and places 518,400 points`, () => {
    requireMac('the depth showpiece');
    const evidence = temp();
    for (const v of [videos.hd]) expect(putEvidence(evidence, readFileSync(v.path)), 'the video is in the store by its hash').toBe(v.sha);
    const { replies } = runShowPid(show_.bin(FULL), scenario(evidence, [
      present(DOC.a, depthDocument(videos.hd.sha)),
      present(DOC.b, depthDocument(videos.hd.sha, { step: 2 })),
    ]), 'the 1,920 × 1,080 depth showpiece at check');
    const refused = replies[0]!;
    expect(refused['outcome'], `the showpiece at step 1 (2,073,600 points, over the class's compute elements) is refused at check: ${show(refused)}`).toBe('refused');
    const issues = arr(refused['issues'], 'the refusal: issues').map((v, i) => obj(v, `the refusal: issues[${i}]`));
    expect(issues.some((i) => i['severity'] === 'error' && namesDepth(i)), `an error issue names the item depth: ${show(issues, 1500)}`).toBe(true);
    expect(replies[1]!['outcome'], `the same showpiece at step 2 (518,400 points) checks: ${show(replies[1])}`).toBe('presented');

    const out = temp();
    const doc = writeJson(out, 'depth-hd', depthDocument(videos.hd.sha, { step: 2 }));
    const [reply] = runGpu(gpu(), out, [view3d({ doc, size: [320, 180], frames: 1, capture: [0], read: [POINTS], targets: ['final'], assets: { [videos.hd.sha]: videos.hd.path }, licenses: { [videos.hd.sha]: LICENSE } })], 'the showpiece at step 2');
    frameAt(framesOf(reply!, 'the showpiece at step 2'), 0, 'the showpiece at step 2');
    const f = arr(reply!['frames'], 'frames').map((v, i) => obj(v, `frames[${i}]`)).find((x) => x['frame'] === 0)!;
    expect(pointsOf(out, f, 'the showpiece at step 2: frame 0').count, 'step 2 places (1,920 ÷ 2) × (1,080 ÷ 2) = 518,400 points').toBe(518_400);
  }, TIMEOUT);

  it(`${AC[2]} the set's evaluated data holds its bounds from near, far and fov (x within ±2.887 m, y within ±2.071 m, z from −5 to −1 m) and none of its points`, () => {
    requireMac('the depth showpiece');
    const evidence = temp();
    expect(putEvidence(evidence, readFileSync(videos.small.path)), 'the video is in the store by its hash').toBe(videos.small.sha);
    const { replies } = runShowPid(show_.bin(FULL), scenario(evidence, [
      present(DOC.a, depthDocument(videos.small.sha)),
      { call: 'spatial', doc: DOC.a, t: FLICKS, queries: [{ box: { min: [-10, -10, -10], max: [10, 10, 10] } }] },
      { call: 'eval', doc: DOC.a, t: FLICKS },
    ]), 'the depth showpiece\'s evaluated data');
    expect(replies[0]!['outcome'], `the 640 × 480 showpiece is presented: ${show(replies[0])}`).toBe('presented');
    const spatial = replies[1]!;
    const items = obj(spatial['items'], `spatial: items (${show(spatial, 800)})`);
    const b = obj(obj(items['depth'], 'spatial: items.depth')['bounds'], 'spatial: items.depth.bounds');
    const v3 = (v: JsonValue | undefined, what: string): number[] => arr(v, what).map((x, i) => num(x, `${what}[${i}]`));
    const min = v3(b['min'], 'bounds.min'); const max = v3(b['max'], 'bounds.max');
    const want = { min: [-5 * Math.tan(Math.PI / 6), -5 * Math.tan(Math.PI / 8), -5], max: [5 * Math.tan(Math.PI / 6), 5 * Math.tan(Math.PI / 8), -1] };
    const off = [...min.map((x, i) => Math.abs(x - want.min[i]!)), ...max.map((x, i) => Math.abs(x - want.max[i]!))];
    expect(Math.max(...off) <= 1e-3, `the set's bounds are x ±2.887, y ±2.071, z −5 to −1 m from near, far and fov (got min [${min.join(', ')}], max [${max.join(', ')}])`).toBe(true);
    // None of its points: the index holds the set as one item, no row of it, and neither answer carries 307,200
    // positions (they would take megabytes of JSON).
    const rows = Object.keys(items).filter((k) => k.startsWith('depth#'));
    expect(rows, 'the spatial index holds no point of the set').toEqual([]);
    const hits = arr(arr(spatial['results'], 'spatial: results')[0], 'spatial: results[0]').map((x, i) => str(x, `results[0][${i}]`));
    expect(hits.filter((h) => h.startsWith('depth#')), 'a box over the whole set returns the set, not its points').toEqual([]);
    expect(hits, 'a box over the whole set returns the set').toContain('depth');
    expect(JSON.stringify(spatial).length, 'the spatial answer is small: no point positions').toBeLessThan(65_536);
    const ev = replies[2]!;
    expect(isObject(ev) && ev['outcome'], `eval at 1 s: ${show(ev, 600)}`).toBe('evaluated');
    expect(JSON.stringify(ev).length, 'the evaluated frame is small: no point positions').toBeLessThan(262_144);
  }, TIMEOUT);
});
