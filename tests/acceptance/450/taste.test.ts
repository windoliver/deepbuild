// AC5: "Shown to you: screenshots of a thrown item's three traces and a rolling wheel's trail, taken by the check run
// from the canvas's own frames, with a recording of the traces at 24 and 60 fps, are attached to the PR and shown to
// you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE,
// never PASS, and no criterion above reads a picture to judge it"
//
// One run draws, with `view3d` and each frame's final PNG kept byte for byte (#378's `final` target): the thrown
// ball's three traces at 6 s (helpers.ts: throwDoc, three cues) and the rolling wheel's whole trail at 3.75 s
// (wheelDoc('whole')), 640 × 360 each; and two recordings that put the canvas's own PNG frames into animated PNGs
// unchanged (#449's apng): the thrown ball's traces from 0 to 6 s at 24 fps and at 60 fps, 320 × 180. All four go to
// `target/acceptance/450/`, each with its SHA-256 printed. The test then reads `tests/acceptance/450/TASTE.json`: with
// none, or one made on other bytes, it is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No
// other test reads these pictures.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, SHA, THREE_CUES, TIMEOUT, ac, apng, framesOf, inconclusive, requireGpu, run, sha256, show, throwDoc, useBins, useDir,
  view3d, wheelDoc, writeJson, type JsonObject, type JsonValue,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '450');
const TASTE = join(REPO, 'tests', 'acceptance', '450', 'TASTE.json');
const SCREENSHOTS = ['three-traces.png', 'wheel-trail.png'] as const;
const RECORDINGS = ['traces-24fps.apng', 'traces-60fps.apng'] as const;
const SHOT: [number, number] = [640, 360];
const REC: [number, number] = [320, 180];

describe(`${ac(5)} the screenshots and recordings, and the one taste call on them`, () => {
  it(`${ac(5)} the run writes the thrown item's three traces, the rolling wheel's trail, and recordings of the traces at 24 and 60 fps, from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const d = dir();
    const docs = { throws: writeJson(d, 'throws.json', throwDoc(THREE_CUES)), wheel: writeJson(d, 'wheel.json', wheelDoc('whole')) };
    const shot = (doc: string, fps: number, frame: number): JsonObject => view3d({ doc, size: SHOT, fps, from: frame, frames: 1, capture: [frame], targets: ['final'] });
    const record = (doc: string, fps: number, frames: number): JsonObject => view3d({ doc, size: REC, fps, from: 0, frames, capture: 'every', targets: ['final'] });
    const calls = [shot(docs.throws, 24, 144), shot(docs.wheel, 60, 225), record(docs.throws, 24, 145), record(docs.throws, 60, 361)];
    const replies = run(bins.bin('deep-gpu'), d, calls);
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
      const frames = framesOf(replies[2 + i]!, name);
      keep(name, apng(frames.map((f) => png(f.final, `${name}: frame ${f.frame}`)), i === 0 ? 24 : 60, name));
    });
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('target', 'acceptance', '450', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(5)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/450/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(450);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#450.1ac5b5e5');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = { ...(c['screenshots'] as Record<string, JsonValue> | undefined ?? {}), ...(c['recordings'] as Record<string, JsonValue> | undefined ?? {}) };
    expect(Object.keys(recorded).sort(), `TASTE.json names the two screenshots and two recordings: ${show(recorded)}`).toEqual([...SCREENSHOTS, ...RECORDINGS].sort());
    const other = Object.keys(hashes).filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, TIMEOUT);
});
