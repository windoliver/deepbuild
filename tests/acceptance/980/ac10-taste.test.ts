// Criterion 10: "Shown to you: screenshots of a warehouse model with queues, a resource and a conveyor and its throughput
// readout, taken by the check run from the canvas's own frames, with a recording of the model running, are attached to
// the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// The check run (README: The taste call), as #535's criterion 7 takes its pictures: this test presents the warehouse
// document (warehouse.ts: an inbound queue, a conveyor, a dock queue of six, two forklifts as one resource of capacity 2,
// and the readout of cases shipped in the last hour) through `deep-show run` (../535/helpers.ts, imported unchanged),
// takes three screenshots by `eval` at 30, 60 and 90 minutes of the model (steps 9,000, 18,000 and 27,000), each the PNG
// the canvas stored, and a recording by `frames` of 180 frames (three seconds of the piece, 36 s of the model) from step
// 18,000, each frame's PNG, encoded as one APNG at 60 frames a second. Each picture is re-encoded so the same pixels give
// the same bytes, written to docs/evidence/980/ and listed with its SHA-256. Then it reads
// tests/acceptance/980/TASTE.json: none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass;
// `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture, and no other test reads one.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIMEOUT, logicBin, prebuild as prebuildLogic, type JsonValue } from '../190/helpers.ts';
import {
  REPO, at, binOf, encodeApng, framesCall, framesOf, pngBytes, pngOf, prebuild, presented, putEvidence, runShow, scenario, showCall, snapshotOf, str, useTemp,
  type Image,
} from '../535/helpers.ts';
import { AC, INTERFACE, layout, processLib } from './helpers.ts';
import { warehouseProgram, warehouseWrites } from './programs.ts';
import { WAREHOUSE } from './scenes.ts';
import { DOC, warehouseAtlas, warehouseDoc } from './warehouse.ts';

prebuildLogic(() => { logicBin(); });
prebuild(['full']);
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '980');
const TASTE = join(REPO, 'tests', 'acceptance', '980', 'TASTE.json');
const SHOTS = [['warehouse-30min.png', 9_000], ['warehouse-60min.png', 18_000], ['warehouse-90min.png', 27_000]] as const;
const RECORDING = 'warehouse-running.apng';
const REC_FROM = 18_000, REC_FRAMES = 180;
const NAMES = [...SHOTS.map(([n]) => n), RECORDING];
const hash = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const inconclusive = (reason: string): never => expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);

describe(`${AC[10]} the check run's pictures of the warehouse, and the one taste call on them`, () => {
  it(`${AC[10]} the check run takes screenshots of the warehouse and a recording of it running from the canvas's own frames, and the recorded call on exactly those says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const L = processLib();
    const writes = warehouseWrites(WAREHOUSE);
    const program = warehouseProgram(WAREHOUSE, INTERFACE, layout(writes));
    const ev = temp();
    putEvidence(ev, program.bytes);
    putEvidence(ev, Buffer.from(L.assets[L.ref.asset]!, 'base64'));
    const atlas = putEvidence(ev, warehouseAtlas());
    const id = DOC(10);
    const r = runShow(binOf(), scenario(ev, [id], [
      showCall(id, warehouseDoc({ id, program, atlas, ref: L.ref, writes })),
      ...SHOTS.map(([, k]) => ({ call: 'eval', doc: id, t: at(k), pixels: true })),
      framesCall(id, REC_FRAMES, { from: `${REC_FROM}f`, pixels: true }),
    ]), `${AC[10]} the check run`);
    presented(r[0]!, 'the warehouse');
    const shots: Image[] = SHOTS.map(([n], i) => pngOf(ev, snapshotOf(r[1 + i]!, n), n));
    const frames = framesOf(r[1 + SHOTS.length]!, REC_FRAMES, 'the recording').map((f, n) => pngOf(ev, str(f['pixel_hash'], `frame ${n}: pixel_hash`), `frame ${n}`));
    const files: Record<string, Buffer> = { ...Object.fromEntries(SHOTS.map(([n], i) => [n, pngBytes(shots[i]!)])), [RECORDING]: encodeApng(frames, 60) };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, hash(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || hash(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/980/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[10]}: the check run's pictures:\n${listed}`);
    expect(new Set(SHOTS.map(([n]) => hashes[n])).size, 'the three screenshots differ: the model moves').toBe(SHOTS.length);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/980/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(980);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(AC[10]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the four files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[10]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
