// AC17: "Shown to you: screenshots of sparks on impact, a particle bouncing in the six-plane box and the landing fixture,
// taken by the check run from the canvas's own frames, with a recording of the sparks and the landing, are attached to
// the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// One run draws, with `view3d` and each frame's final PNG kept byte for byte (#378's `final` target): sparks on impact,
// the lab's three balls (an instancer its world's `balls#*` output moves, #1921) bursting sparks from each hit of
// `lab.occurrences`, at 0.5 s, just after the first ball lands; the bead in the six-plane box (helpers.ts: boxDoc, then:
// rest) at 0.8 s; and the landing fixture (landingDoc) at 1.5 s. Two recordings put the canvas's own PNG frames, 30 fps,
// into animated PNGs unchanged (helpers.ts: apng): the sparks over 2 s and the landing over 2.5 s. All five go to
// `target/acceptance/449/`, each with its SHA-256 printed. The test then reads `tests/acceptance/449/TASTE.json`: with
// none, or one made on other bytes, it is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No
// other test reads these pictures.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, SHA, SPARK_LOOK, TIMEOUT, ac, apng, boxDoc, camera, framesOf, inconclusive, landingDoc, markBox, particlesItem, requireGpu,
  runGpu, sessionDoc, sha256, show, useBins, useDir, view3d, writeJson, type JsonObject, type JsonValue,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '449');
const TASTE = join(REPO, 'tests', 'acceptance', '449', 'TASTE.json');
const SCREENSHOTS = ['sparks-on-impact.png', 'six-plane-box.png', 'landing.png'] as const;
const RECORDINGS = ['sparks.apng', 'landing.apng'] as const;
const SHOT: [number, number] = [640, 360];
const REC: [number, number] = [320, 180];

/** Sparks on impact: three balls of an instancer, moved by the world's `balls#*` output, bursting sparks at each hit. */
function impactDoc(): JsonObject {
  const pos = [[-0.6, 1.0, 0], [0, 1.6, 0], [0.6, 2.2, 0]];
  const lab: JsonObject = {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: 449, mode: 'dynamic',
    capacity: { bodies: 4, shapes: 4, joints: 0, contacts: 256, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { ground: { friction: 0.5, restitution: 0.6 }, rubber: { friction: 0.5, restitution: 0.7, density: 500 } },
    shapes: { plane: { kind: 'plane', normal: [0, 1, 0] }, ball: { kind: 'sphere', radius: 0.1 } },
    bodies: {
      ground: { kind: 'static', shapes: [{ shape: 'plane', contact_material: 'ground' }] },
      balls: { kind: 'dynamic', each: 'balls', shapes: [{ shape: 'ball', contact_material: 'rubber' }] },
    },
    outputs: { balls: { from: 'balls#*', read: 'pose', to: 'items/balls' } },
  };
  return sessionDoc('Sparks on impact', {
    cam: camera([0.4, 1.4, 3.6], [0, 0.5, 0], 50),
    plate: markBox([3, 0.02, 1.5], [0, -0.01, 0], 'floor'),
    bead: { kind: 'mark.sphere@1', params: { size: [0.2, 0.2, 0.2], paint: { fill: { role: 'lamp' } } }, visible: false },
    balls: { kind: 'instance@1', params: { of: ['bead'], ids: [1, 2, 3], pos, rot: pos.map(() => [0, 0, 0, 1]) } },
    sparks: particlesItem({
      count: 4096, emit: { shape: 'point', on: { list: 'lab.occurrences', kinds: ['hit'], where: 'speed > 1', count: 48 } }, life: [0.3, 0.7],
      motion: {
        ballistic: { v0: [1.5, 3.5], gravity: [0, -9.81, 0], drag: 1 },
        bounce: { planes: [{ normal: [0, 1, 0], offset: 0 }], restitution: 0.3, friction: 0, max: 2, then: 'die' },
      },
      draw: 'spark', ...SPARK_LOOK,
    }),
  }, { transport: { span: '2s', frame_rate: [60, 1] }, worlds: { lab } });
}

describe(`${ac(17)} the screenshots and recordings, and the one taste call on them`, () => {
  it(`${ac(17)} the run writes sparks on impact, the bead in the six-plane box and the landing, and recordings of the sparks and the landing, from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const d = dir();
    const docs = { impact: writeJson(d, 'impact.json', impactDoc()), box: writeJson(d, 'box.json', boxDoc('rest')), landing: writeJson(d, 'landing.json', landingDoc('rest')) };
    const shot = (doc: string, fps: number, frame: number): JsonObject => view3d({ doc, size: SHOT, fps, from: frame, frames: 1, capture: [frame], targets: ['final'] });
    const record = (doc: string, frames: number): JsonObject => view3d({ doc, size: REC, fps: 30, from: 0, frames, capture: 'every', targets: ['final'] });
    const calls = [shot(docs.impact, 60, 30), shot(docs.box, 60, 48), shot(docs.landing, 30, 45), record(docs.impact, 60), record(docs.landing, 75)];
    const replies = runGpu(bins.bin('deep-gpu'), d, calls);
    const png = (hash: string | null, what: string): Buffer => {
      expect(hash, `${what}: the canvas's final PNG, named by its SHA-256`).toMatch(SHA);
      const bytes = readFileSync(join(d, `${hash!}.png`));
      expect(sha256(bytes), `${what}: the PNG hashes to its name`).toBe(hash);
      return bytes;
    };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    SCREENSHOTS.forEach((name, i) => {
      const [f] = framesOf(replies[i]!, name);
      keep(name, png(f?.final ?? null, name));
    });
    RECORDINGS.forEach((name, i) => {
      const frames = framesOf(replies[3 + i]!, name);
      keep(name, apng(frames.map((f) => png(f.final, `${name}: frame ${f.frame}`)), 30, name));
    });
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('target', 'acceptance', '449', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(17)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/449/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(449);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#449.3f28ed99');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = { ...(c['screenshots'] as Record<string, JsonValue> | undefined ?? {}), ...(c['recordings'] as Record<string, JsonValue> | undefined ?? {}) };
    expect(Object.keys(recorded).sort(), `TASTE.json names the three screenshots and two recordings: ${show(recorded)}`).toEqual([...SCREENSHOTS, ...RECORDINGS].sort());
    const other = Object.keys(hashes).filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, TIMEOUT);
});
