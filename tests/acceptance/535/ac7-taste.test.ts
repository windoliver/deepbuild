// AC7 #535.d39cd14c: Shown to you: screenshots of the 96 x 96 atlas layer before and after a step, the 64-row unit pool
// and the door tile changing, taken by the check run from the canvas's own frames, with a recording of the door changing,
// are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without
// it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it
//
// The check run (README: The taste call): this test draws the criteria's own fixtures through `deep-show run` (each
// picture a canonical render the canvas stored as a PNG), re-encodes each so the same pixels always give the same bytes,
// writes them to docs/evidence/535/ and prints their SHA-256s. Then it reads tests/acceptance/535/TASTE.json: none, or a
// call on other pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly these
// pictures passes. It judges no picture. The canvas's renders are deterministic, so a call stands on the hashes alone.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOOR_STEP, ONE_CELL_STEP, doorProgram, layerProgram, poolProgram } from './programs.ts';
import { doorAtlas, doorDoc, layerAtlas, layerDoc, poolAtlas, poolDoc } from './fixtures.ts';
import {
  AC, DOC, REPO, at, binOf, encodeApng, evalCall, framesCall, framesOf, pngBytes, pngOf, prebuild, presented, putEvidence, runShow, scenario,
  showCall, snapshotOf, str, useTemp, type Image, type JsonValue,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '535');
const TASTE = join(REPO, 'tests', 'acceptance', '535', 'TASTE.json');
const CRITERION = '#535.d39cd14c';
const NAMES = ['layer-before-step.png', 'layer-after-step.png', 'unit-pool.png', 'door-before.png', 'door-after.png', 'door-changing.apng'] as const;
const hash = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const inconclusive = (reason: string): never => expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
/** The recording's frames: steps 90 to 110, the door changing at step 100. */
const REC_FROM = DOOR_STEP - 10;
const REC_FRAMES = 21;

describe(`${AC[7]} the check run's pictures of the layer, the pool and the door, and the one taste call on them`, () => {
  it(`${AC[7]} the check run takes the screenshots and the recording from the canvas's own frames, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const ev = temp();
    const [L, P, Dd] = [DOC(1), DOC(2), DOC(3)];
    const layerP = layerProgram(); putEvidence(ev, layerP.bytes);
    const poolP = poolProgram(); putEvidence(ev, poolP.bytes);
    const doorP = doorProgram(); putEvidence(ev, doorP.bytes);
    const r = runShow(binOf(), scenario(ev, [L, P, Dd], [
      showCall(L, layerDoc(layerP, putEvidence(ev, layerAtlas()))), evalCall(L, at(ONE_CELL_STEP - 1)), evalCall(L, at(ONE_CELL_STEP)),
      showCall(P, poolDoc(poolP, putEvidence(ev, poolAtlas()))), evalCall(P, 0),
      showCall(Dd, doorDoc(doorP, putEvidence(ev, doorAtlas()))), framesCall(Dd, REC_FRAMES, { from: `${REC_FROM}f`, pixels: true }),
    ]), 'AC7 the check run');
    presented(r[0]!, 'the 96 × 96 layer');
    presented(r[3]!, 'the pool');
    presented(r[5]!, 'the door');
    const shot = (i: number, what: string): Image => pngOf(ev, snapshotOf(r[i]!, what), what);
    const door = framesOf(r[6]!, REC_FRAMES, 'the door from step 90 to 110').map((f, n) => pngOf(ev, str(f['pixel_hash'], `the door's frame ${n}: pixel_hash`), `the door's frame ${n}`));
    const files: Record<string, Buffer> = {
      'layer-before-step.png': pngBytes(shot(1, 'the layer at step 29')),
      'layer-after-step.png': pngBytes(shot(2, 'the layer at step 30')),
      'unit-pool.png': pngBytes(shot(4, 'the pool')),
      'door-before.png': pngBytes(door[DOOR_STEP - 1 - REC_FROM]!),
      'door-after.png': pngBytes(door[DOOR_STEP - REC_FROM]!),
      'door-changing.apng': encodeApng(door, 60),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, hash(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || hash(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/535/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[7]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/535/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(535);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the six files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[7]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, 1_800_000);
});
