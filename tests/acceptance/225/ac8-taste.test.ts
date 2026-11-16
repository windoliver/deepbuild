// AC8 #225.b55d3896: "Shown to you: screenshots of the arrow field of F = (-y, x)/2 with its colour ramp, the stream from
// (1, 0) and the Lorenz attractor, taken by the check run from the canvas's own frames, with a recording of the
// follow_stream dot, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// This test judges no picture. It takes them from deep-show's own frames (`eval` with `pixels` at 640 × 480, each the
// canvas's PNG byte for byte, #142's way) and writes them to `docs/evidence/225/`, printing each one's SHA-256:
// - `arrow-field.png`: F = (−y, x)/2, arrows on a grid of step 0.5 over [−2, 2]², colored by magnitude through the
//   four-role ramp over [0, 2], on linear x and y scales of 80 u a unit (README: Fixtures);
// - `stream-from-1-0.png`: F = (−y, x), the stream from (1, 0) for time 2π at step 0.05, on the same scales;
// - `lorenz.png`: criterion 5's trajectory on x and y scales over [−25, 25] and [−30, 30] (README: Readings, a 3D fn on
//   2D scales);
// - `follow-stream-dot.apng`: F = (−y, x) with its arrows, the stream from (2, 0) and a follow_stream dot riding it,
//   every frame at 30 fps from 0 to 2 s, put into one animated PNG unchanged.
// It then reads the recorded call, `tests/acceptance/225/TASTE.json` (#226's form): none, or one made on other
// pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. This job records no
// call. Attaching the files to the PR and showing them in the session is the implementer's, outside any test.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, HALF_SWIRL, LORENZ, RAMP, REPO, SWIRL, TIMEOUT, apng, decodePng, dot, evalAt, field, film, followStream, frameTimes, idOf, inconclusive, isObject,
  pngOf, present, presented, run, scale, scenario, sha256, snapshotOf, useBins, useFolders, type JsonObject, type JsonValue,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const ID = idOf(8);
const SHOTS = join(REPO, 'docs', 'evidence', '225');
const TASTE = join(REPO, 'tests', 'acceptance', '225', 'TASTE.json');
const NAMES = ['arrow-field.png', 'stream-from-1-0.png', 'lorenz.png', 'follow-stream-dot.apng'] as const;
const SIZE: [number, number] = [640, 480];
const REC_FPS = 30;

/** Linear x and y scales: 80 u a unit over [−2.5, 2.5]², y up. */
const unitScales = (): JsonObject[] => [scale('xs', 'a0', [-2.5, 2.5], [120, 520]), scale('ys', 'a1', [-2.5, 2.5], [440, 40])];
const ARROWS: JsonObject = { grid: { x: [-2, 2, 0.5], y: [-2, 2, 0.5] }, color: { by: 'magnitude', ramp: RAMP, domain: [0, 2] } };
const DOCS: Record<'arrows' | 'stream' | 'lorenz' | 'dot', JsonObject> = {
  arrows: film('the arrow field', SIZE, [...unitScales(), field('half', 'a2', { fn: HALF_SWIRL, scales: { x: 'xs', y: 'ys' }, arrows: ARROWS })]),
  stream: film('the stream from (1, 0)', SIZE, [...unitScales(), field('swirl', 'a2', { fn: SWIRL, scales: { x: 'xs', y: 'ys' }, streams: { starts: { points: [[1, 0, 0]] }, step: 0.05, time: 2 * Math.PI } })]),
  lorenz: film('the Lorenz attractor', SIZE, [
    scale('xs', 'a0', [-25, 25], [120, 520]), scale('ys', 'a1', [-30, 30], [440, 40]),
    field('lorenz', 'a2', { fn: LORENZ, scales: { x: 'xs', y: 'ys' }, streams: { starts: { points: [[1, 1, 1]] }, step: 0.005, time: 40, pad: 60, max_points: 16384 } }),
  ]),
  dot: film('a dot riding the stream', SIZE, [
    ...unitScales(),
    field('swirl', 'a2', { fn: SWIRL, scales: { x: 'xs', y: 'ys' }, arrows: ARROWS, streams: { starts: { points: [[2, 0, 0]] }, step: 0.05, time: 3 } }),
    dot('dot', 'a3', 6),
  ], { transport: { span: '2s' }, constraints: { ride: followStream('dot', 'swirl', [2, 0, 0]) } }),
};

/** `doc` drawn at each of `times` by one process: each frame's PNG, byte for byte. */
function frames(doc: JsonObject, times: number[], what: string): Buffer[] {
  const evidence = folder();
  const replies = run(bin('show'), scenario(evidence, [present(doc), ...times.map((t) => evalAt(t, { pixels: SIZE }))]));
  presented(replies[0]!, what);
  return times.map((t, k) => pngOf(evidence, snapshotOf(replies[1 + k]!, `${what} at ${t} flicks`), `${what} at ${t} flicks`));
}

describe(`${AC[8]} the screenshots, the recording and the one taste call on them`, () => {
  it(`${AC[8]} the run writes the arrow field, the stream from (1, 0), the Lorenz attractor and the follow_stream dot's recording, and the recorded call on exactly those says they look right`, () => {
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    keep('arrow-field.png', frames(DOCS.arrows, [0], 'the arrow field')[0]!);
    keep('stream-from-1-0.png', frames(DOCS.stream, [0], 'the stream from (1, 0)')[0]!);
    keep('lorenz.png', frames(DOCS.lorenz, [0], 'the Lorenz attractor')[0]!);
    keep('follow-stream-dot.apng', apng(frames(DOCS.dot, frameTimes(REC_FPS, 2), 'the follow_stream dot').map((b) => decodePng(b)), REC_FPS));
    expect(Object.keys(hashes).sort(), 'three screenshots and one recording').toEqual([...NAMES].sort());

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '225', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recording written from this run's frames:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/225/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as JsonObject;
    expect(c['issue'], 'TASTE.json: issue').toBe(225);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = isObject(c['screenshots']) ? c['screenshots'] : {};
    const other = [...new Set([...Object.keys(recorded), ...NAMES])].filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n] ?? 'nothing')}, drawn ${hashes[n] ?? 'nothing'}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 2 * TIMEOUT);
});
