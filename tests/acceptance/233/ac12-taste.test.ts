// AC12 #233.d8298507: "Shown to you: screenshots of the math.axes parabola, the number line, the polar plane and the
// Riemann bars, taken by the check run from the renderer's own output, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and
// no criterion above reads a picture to judge it"
//
// A review-and-evidence criterion: the machine part is here, the call is a person's. One `deep-show run` presents the
// four figures the criteria above check (criterion 1's parabola on axes, criterion 8's number line, criterion 9's polar
// plane, criterion 3's Riemann bars) and takes each one's picture with `eval` and `pixels` at 1920 × 1080 px, the
// canvas's own PNG from the evidence store, byte for byte. Each is copied into the shots folder ($TMPDIR/deep-233-shots)
// as axes-parabola.png, number-line.png, polar-plane.png and riemann-bars.png, and its SHA-256 printed. Attaching them
// to the PR and showing them in the session is the implementer's, outside any test.
// It then reads tests/acceptance/233/TASTE.json, `{issue: 233, criterion: "#233.d8298507", verdict: "looks_right" |
// "looks_wrong", who, when, screenshots: {name → sha256}, note?}` (#505's form): none, or one made on other pictures, is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test reads these pictures or the
// call, which this test also checks of the folder's other files. This job records no call.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, HERE, TIMEOUT, arr, docId, evalAt, idOf, inconclusive, isObject, mathDoc, notPresented, obj, present, run, scenario, sha256, useBins, useFolders,
  type JsonObject, type JsonValue, type P2,
} from './helpers.ts';

const bin = useBins(['deep-show']);
const folder = useFolders();
const ID = idOf(12);
const SIZE: P2 = [1920, 1080];
const SHOTS = join(tmpdir(), 'deep-233-shots');
const TASTE = join(HERE, 'TASTE.json');
const FIGURES: Record<string, JsonObject> = {
  'axes-parabola.png': mathDoc('A parabola on axes', SIZE, {
    ax: { kind: 'math.axes@1', params: { x_range: [-3, 3, 1], y_range: [0, 9, 3], x_length: 8, y_length: 5 } },
    curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2' } },
  }),
  'number-line.png': mathDoc('A number line', SIZE, {
    nl: { kind: 'math.number_line@1', params: { x_range: [-3, 3, 1], include_tip: true, include_numbers: true, numbers_to_exclude: [0] } },
  }),
  'polar-plane.png': mathDoc('A polar plane', SIZE, { pp: { kind: 'math.polar_plane@1', params: { azimuth_units: 'degrees', azimuth_step: 12 } } }),
  'riemann-bars.png': mathDoc('Riemann bars under x squared', SIZE, {
    ax: { kind: 'math.axes@1', params: { x_range: [0, 1, 0.25], y_range: [0, 1, 0.25], x_length: 8, y_length: 6 } },
    curve: { kind: 'math.plot@1', params: { axes: 'ax', f: 'x^2', x_range: [0, 1] } },
    bars: { kind: 'math.riemann@1', params: { plot: 'curve', dx: 0.25, input_sample_type: 'center' } },
  }),
};

describe(`${AC[12]} the screenshots and the one taste call on them`, () => {
  it(`${AC[12]} the run writes the four pictures from the renderer's own output, no other test reads them, and the recorded call on exactly those says they look right`, () => {
    const others = readdirSync(HERE).filter((f) => f.endsWith('.ts') && f !== 'ac12-taste.test.ts');
    const readers = others.filter((f) => { const s = readFileSync(join(HERE, f), 'utf8'); return s.includes('TASTE.json') || s.includes('deep-233-shots'); });
    expect(readers, 'no other test file reads the taste call or its pictures').toEqual([]);

    const evidence = folder();
    const names = Object.keys(FIGURES);
    const calls = names.flatMap((n, i) => [present(docId(i + 1), FIGURES[n]!), evalAt(docId(i + 1), 0, { pixels: true, size: SIZE })]);
    const a = run(bin('deep-show'), scenario(evidence, calls));
    expect(a.ok, `deep-show run accepts the scenario: ${a.why}`).toBe(true);
    const files: Record<string, Buffer> = {};
    names.forEach((n, i) => {
      expect(notPresented(a.replies[2 * i]), `${n}'s figure is presented with no error`).toBe('');
      const reply = a.replies[2 * i + 1]!;
      expect(reply['outcome'], `${n}'s frame is evaluated`).toBe('evaluated');
      const snaps = arr(reply['snapshots'], `${n}: snapshots`);
      expect(snaps.length, `${n}: one snapshot`).toBe(1);
      const sha = String(obj(snaps[0], `${n}: snapshots[0]`)['sha256']);
      const path = join(evidence, sha.slice(0, 2), sha.slice(2));
      expect(existsSync(path), `${n}: the snapshot ${sha} is in the evidence store`).toBe(true);
      const bytes = readFileSync(path);
      expect(sha256(bytes), `${n}: the stored file hashes to its name`).toBe(sha);
      files[n] = bytes;
    });
    rmSync(SHOTS, { recursive: true, force: true });
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [n, bytes] of Object.entries(files)) { writeFileSync(join(SHOTS, n), bytes); hashes[n] = sha256(bytes); }
    const listed = names.map((n) => `  ${join(SHOTS, n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/233/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as JsonObject;
    expect(c['issue'], 'TASTE.json: issue').toBe(233);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    expect(isObject(c['screenshots']), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = c['screenshots'] as JsonObject;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four screenshots').toEqual([...names].sort());
    const other = names.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
