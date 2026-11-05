// AC5 #443.aea1cba1: "Shown to you: screenshots of the extruded "OB", the vector ring, and the kerned "AV", taken by
// the check run from the renderer's own output, are attached to the PR and shown to you in the session. Whether they
// look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above
// reads a picture to judge it"
//
// One run builds AC1's "OB" and ring and AC3's "AV" (the same outlines) through `deep-show`'s `geometry` only to aim
// a camera at each one's bounds, then draws each, lit, with `deep-gpu`'s `view3d`, and copies each final target, the
// renderer's own PNG byte for byte, to `target/acceptance/443/` (README: The taste call), printing each SHA-256. It
// then reads `tests/acceptance/443/TASTE.json`: none, or one made on other pictures (another SHA-256), is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test reads these
// pictures or the call.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, GPU, REPO, RING_SVG, SLOW, admitted, extrude, finalPng, geometryCall, geometryOf, inconclusive, putBytes, requireMetal, runGpu,
  runShow, scenario, sceneDoc, sessionDoc, sha256, show, textOutline, useBuilds, useDir, vectorItem, view3dCall, writeJson,
  type JsonObject, type JsonValue, type V3,
} from './helpers.ts';

const ID = AC[5];
const bin = useBuilds([FULL, GPU]);
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '443');
const TASTE = join(REPO, 'tests', 'acceptance', '443', 'TASTE.json');
const SIZE: [number, number] = [960, 540];

const LIGHTS: Record<string, JsonObject> = {
  sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-35, 30, 0] } },
  sky: { kind: 'sky@1', params: { top: [0.05, 0.06, 0.08, 1], low: [0.02, 0.02, 0.03, 1], ambient_top: [0.25, 0.25, 0.28], ambient_low: [0.08, 0.08, 0.08] } },
  gold: { kind: 'material@1', params: { base_color: [0.85, 0.62, 0.25, 1], metallic: 0, roughness: 0.45 } },
};
/** Each picture's items: the title or logo (made of the gold material) and the modules beyond scene3d it needs. */
function pictures(ring: string): { name: string; id: string; items: Record<string, JsonObject>; modules: string[] }[] {
  return [
    { name: 'ob.png', id: 'title', items: { title: { ...extrude(textOutline('OB')), material: 'gold' } }, modules: [] },
    { name: 'ring.png', id: 'ring3d', items: { logo: vectorItem(ring, 'A ring'), ring3d: { ...extrude({ vector: 'logo', size: 1 }), material: 'gold' } }, modules: ['vector'] },
    { name: 'av.png', id: 'av', items: { av: { ...extrude(textOutline('AV', { align: 'start' })), material: 'gold' } }, modules: [] },
  ];
}
/** A camera a little above and to the right of the bounds' front, far enough to hold them. */
function aimed(lo: V3, hi: V3): JsonObject {
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const d = 1.9 * Math.max(hi[0] - lo[0], hi[1] - lo[1], 0.2);
  return { kind: 'camera@1', params: { projection: 'perspective', position: [c[0] + 0.3 * d, c[1] + 0.35 * d, hi[2] + d], target: c, fov: 35, near: 0.05, far: 100 } };
}

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the extruded "OB", the vector ring and the kerned "AV" from the renderer's own output, and the owner's recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    const shots = pictures(putBytes(out, RING_SVG()));
    const docs = [DOC.a, DOC.b, DOC.c];
    const replies = runShow(bin(FULL), scenario(out, docs, shots.flatMap((p, i) => [show(docs[i]!, sceneDoc(p.name, p.items, p.modules)), geometryCall(docs[i]!, [p.id])])));
    const calls = shots.map((p, i) => {
      admitted(replies[2 * i]!, p.name);
      const g = geometryOf(replies[2 * i + 1]!, p.id, p.name);
      const lo = [0, 1, 2].map((k) => Math.min(...g.positions.map((q) => q[k]!))) as V3;
      const hi = [0, 1, 2].map((k) => Math.max(...g.positions.map((q) => q[k]!))) as V3;
      const doc = sessionDoc(`shot-443-${i + 1}`, SIZE, { cam: aimed(lo, hi), ...LIGHTS, ...p.items }, p.modules);
      return view3dCall(writeJson(out, `${p.name}.json`, doc), SIZE, out);
    });
    const drawn = runGpu(bin(GPU), out, calls);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    shots.forEach((p, i) => {
      const bytes = finalPng(out, drawn[i]!, p.name);
      writeFileSync(join(SHOTS, p.name), bytes); hashes[p.name] = sha256(bytes);
    });
    const names = shots.map((p) => p.name);
    const listed = names.map((n) => `  ${join('target', 'acceptance', '443', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/443/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(443);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#443.aea1cba1');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recordedShots = c['screenshots'];
    expect(typeof recordedShots === 'object' && recordedShots !== null && !Array.isArray(recordedShots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = recordedShots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots').toEqual([...names].sort());
    const other = names.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, SLOW);
});
