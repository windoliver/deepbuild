// AC7 #265.34736230: "Shown to you: screenshots of a particle trail, a mark.line trail and a swimmer's wake behind
// logic-moved items, taken by the check run from the canvas's own frames, with a recording of the moving items and their
// trails, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
// without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// One run draws, with `view3d` and each frame's final PNG kept byte for byte (#378's `final` target), at 640 × 360: the
// walker's world-space dust at 3 s (helpers.ts: walkerDoc), the runner's `mark.line` trail at 1.5 s (runnerDoc) and the
// swimmer's wake at 20 s (swimmerDoc); and a recording that puts the canvas's own PNG frames into an animated PNG
// unchanged (#449's apng): the eight movers (crowdDoc) with their dust, trails and wakes from 0 to 4 s at 30 fps,
// 320 × 180. All four go to `target/acceptance/265/`, each with its SHA-256 printed. The test then reads
// `tests/acceptance/265/TASTE.json`: with none, or one made on other bytes, it is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly these passes. No other test reads these pictures.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, SHA, TIMEOUT, ac, apng, crowdDoc, framesOf, inconclusive, putPrograms, requireGpu, run, runnerDoc, sha256, show, swimmerDoc,
  useBins, useDir, view3d, walkerDoc, writeJson, type Fixture, type JsonObject, type JsonValue,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '265');
const TASTE = join(REPO, 'tests', 'acceptance', '265', 'TASTE.json');
const SCREENSHOTS = ['particle-trail.png', 'line-trail.png', 'wake.png'] as const;
const RECORDINGS = ['movers.apng'] as const;
const SHOT: [number, number] = [640, 360];
const REC: [number, number] = [320, 180];

describe(`${ac(7)} the screenshots and the recording, and the one taste call on them`, () => {
  it(`${ac(7)} the run writes a particle trail, a mark.line trail and a swimmer's wake behind logic-moved items and a recording of the movers, from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const d = dir();
    const place = (name: string, f: Fixture): { doc: string; assets: Record<string, string> } => ({ doc: writeJson(d, `${name}.json`, f.doc), assets: putPrograms(d, f.programs) });
    const shot = (f: { doc: string; assets: Record<string, string> }, fps: number, frame: number): JsonObject => view3d({ ...f, size: SHOT, fps, from: frame, frames: 1, capture: [frame], targets: ['final'] });
    const calls = [
      shot(place('walker', walkerDoc('logic')), 60, 180), shot(place('runner', runnerDoc()), 60, 90), shot(place('swimmer', swimmerDoc('logic')), 30, 600),
      view3d({ ...place('movers', crowdDoc()), size: REC, fps: 30, from: 0, frames: 121, capture: 'every', targets: ['final'] }),
    ];
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
    const frames = framesOf(replies[3]!, RECORDINGS[0]);
    keep(RECORDINGS[0], apng(frames.map((f) => png(f.final, `${RECORDINGS[0]}: frame ${f.frame}`)), 30, RECORDINGS[0]));
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('target', 'acceptance', '265', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(7)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/265/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(265);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#265.34736230');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = { ...(c['screenshots'] as Record<string, JsonValue> | undefined ?? {}), ...(c['recordings'] as Record<string, JsonValue> | undefined ?? {}) };
    expect(Object.keys(recorded).sort(), `TASTE.json names the three screenshots and the recording: ${show(recorded)}`).toEqual([...SCREENSHOTS, ...RECORDINGS].sort());
    const other = Object.keys(hashes).filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, TIMEOUT);
});
