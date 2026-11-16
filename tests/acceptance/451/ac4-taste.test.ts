// AC4 #451.98808b85: "Shown to you: screenshots of packets along a graph's edge, particles along a path and particles on
// a vector field's streams, taken by the check run from the canvas's own frames, with a recording of each flow moving,
// are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without
// it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// This test judges no picture. One `deep-gpu run` process plays each flow with `film2d` in the shipped clean look at
// 30 fps from frame 60 to 119 (2 s to 4 s), capturing every frame's final PNG (the canvas's own frames, byte for byte),
// with this suite's `particles` field so each frame is known to hold live particles. The flows:
// - the graph (helpers.ts: graphDoc('before')): 20 packets on edge `ab`, routed around C;
// - a path: the cubic `wave` from (40, 240) to (440, 120), 48 particles along it at 80 to 120 u/s;
// - a vector field's streams: (240 − y, x − 240), the turn of (−y, x) about (240, 240), with arrows every 50 u and four
//   streams of radius 60 to 180 u, 64 particles along `field#streams` at 40 to 80 u/s.
// Each flow's frame 90 (3 s) is its screenshot and its 60 frames, put into one animated PNG unchanged (#449's apng), its
// recording. All six go to `docs/evidence/451/`, each with its SHA-256 printed. The test then reads
// `tests/acceptance/451/TASTE.json`: with none, or one made on other bytes, it is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly these bytes passes. No other test reads these pictures.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FPS, REPO, SHA, TIMEOUT, ac, apng, doc2d, dots, film2d, frames2d, graphDoc, inconclusive, isObject, requireGpu, run, sha256,
  useBins, useDir, type JsonObject, type JsonValue,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '451');
const TASTE = join(REPO, 'tests', 'acceptance', '451', 'TASTE.json');
const FROM = 60;
const COUNT = 60;
const SHOT = 90;

const pathDoc = (): JsonObject => doc2d('path-flow', 'Particles along a path', [480, 320], {
  wave: { kind: 'path@1', params: { d: 'M 40 240 C 160 40 320 440 440 120', paint: { stroke: { role: 'muted', width: 2 } } } },
  drops: { kind: 'particles@1', params: { dimensions: 2, count: 48, life: 3, emit: { rate: 12 }, motion: { along: { curves: ['wave'], speed: [80, 120] } }, ...dots('accent', 6) } },
});
const fieldDoc = (): JsonObject => doc2d('stream-flow', 'Particles on a vector field\'s streams', [480, 480], {
  field: {
    kind: 'vector_field@1',
    params: {
      fn: { x: '240 - y', y: 'x - 240' },
      arrows: { grid: { x: [40, 440, 50], y: [40, 440, 50] }, color: { by: 'magnitude', ramp: ['term_blue', 'term_cyan'], domain: [0, 200] } },
      streams: { starts: { points: [60, 100, 140, 180].map((r) => [240 + r, 240, 0]) }, step: 0.01, time: 6.2, pad: 300, max_points: 1024 },
    },
  },
  flow: { kind: 'particles@1', params: { dimensions: 2, count: 64, life: 3, emit: { rate: 16 }, motion: { along: { curves: ['field#streams'], speed: [40, 80] } }, ...dots('accent', 6) } },
});
const FLOWS = [
  { name: 'graph-edge-packets', doc: graphDoc('before'), item: 'packets' },
  { name: 'path-particles', doc: pathDoc(), item: 'drops' },
  { name: 'stream-particles', doc: fieldDoc(), item: 'flow' },
] as const;
const SCREENSHOTS = FLOWS.map((f) => `${f.name}.png`);
const RECORDINGS = FLOWS.map((f) => `${f.name}.apng`);

describe(`${ac(4)} the screenshots and recordings, and the one taste call on them`, () => {
  it(`${ac(4)} the run writes packets along a graph's edge, particles along a path and particles on a vector field's streams, with a recording of each flow, from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const frames = Array.from({ length: COUNT }, (_, k) => FROM + k);
    const replies = run(bins.bin('deep-gpu'), dir(), FLOWS.map((f) => film2d({ doc: f.doc, from: FROM, frames: COUNT, capture: frames, particles: [f.item] })));
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    FLOWS.forEach((flow, i) => {
      const fs = frames2d(replies[i]!, flow.name, [flow.item]);
      expect(fs.map((f) => f.frame), `${flow.name}: frames ${FROM} to ${FROM + COUNT - 1} drawn`).toEqual(frames);
      const pngs = fs.map((f) => {
        expect(f.particles.get(flow.item)!.live, `${flow.name}: ${flow.item} is live at frame ${f.frame}`).toBeGreaterThan(0);
        expect(f.final, `${flow.name}: frame ${f.frame}'s final PNG, named by its SHA-256`).toMatch(SHA);
        const bytes = readFileSync(join(dir(), `${f.final!}.png`));
        expect(sha256(bytes), `${flow.name}: frame ${f.frame}'s PNG hashes to its name`).toBe(f.final);
        return bytes;
      });
      keep(`${flow.name}.png`, pngs[SHOT - FROM]!);
      keep(`${flow.name}.apng`, apng(pngs, FPS, `${flow.name}'s recording`));
    });
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('docs', 'evidence', '451', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(4)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/451/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(isObject(call), 'TASTE.json is an object').toBe(true);
    const c = call as JsonObject;
    expect(c['issue'], 'TASTE.json: issue').toBe(451);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#451.98808b85');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded: Record<string, JsonValue> = { ...(isObject(c['screenshots']) ? c['screenshots'] : {}), ...(isObject(c['recordings']) ? c['recordings'] : {}) };
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots and three recordings').toEqual([...SCREENSHOTS, ...RECORDINGS].sort());
    const other = Object.keys(hashes).filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, 2 * TIMEOUT);
});
