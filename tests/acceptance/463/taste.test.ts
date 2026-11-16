// AC3 #463.fee183bf: "Shown to you: screenshots of the shared test scene in every art@1 look in 2D and 3D, taken by the
// check run from the canvas's own frames, are attached to the PR and shown to you in the session. Whether they look
// right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a
// picture to judge it"
//
// One run draws the shared test scene (fixtures/scene.json) at frame 30 in each of the twelve looks, its 2D film through
// `film2d` and its 3D scene through `view3d`, as AC1 does, and keeps each frame's final PNG byte for byte: 24
// screenshots, `<look>-2d.png` and `<look>-3d.png` with the look's ID less `art.` (`flow_brush-2d.png`, …), 1920 × 1080,
// in `target/acceptance/463/`, each SHA-256 printed. The test then reads `tests/acceptance/463/TASTE.json`: with none,
// or one made on other bytes, it is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other
// test reads these pictures.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIMS, FRAME, LOOKS, REPO, SHA, TIMEOUT, ac, drawCall, drawnFrame, inconclusive, obj, requireGpu, run, scene, sha256, show,
  useBins, useDir, writeJson, type JsonValue,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '463');
const TASTE = join(REPO, 'tests', 'acceptance', '463', 'TASTE.json');
const shotName = (look: string, dim: string): string => `${look.replace(/^art\./, '')}-${dim}.png`;

describe(`${ac(3)} the screenshots of the shared test scene in every look, and the one taste call on them`, () => {
  it(`${ac(3)} the run writes the scene in all twelve art@1 looks in 2D and 3D from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const d = dir();
    const s = scene();
    const doc2 = obj(s['2d'], 'the scene: its 2D film');
    const path3 = writeJson(d, 'scene-3d.json', obj(s['3d'], 'the scene: its 3D scene'));
    const calls = DIMS.flatMap((dim) => LOOKS.map((look) => drawCall(dim, dim === '2d' ? doc2 : path3, look)));
    const replies = run(bins.bin('deep-gpu'), d, calls);
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    DIMS.forEach((dim, k) => LOOKS.forEach((look, i) => {
      const name = shotName(look, dim);
      const f = drawnFrame(replies[k * LOOKS.length + i]!, FRAME, name);
      expect(f.final, `${name}: the canvas's final PNG, named by its SHA-256`).toMatch(SHA);
      const bytes = readFileSync(join(d, `${f.final}.png`));
      expect(sha256(bytes), `${name}: the PNG hashes to its name`).toBe(f.final);
      writeFileSync(join(SHOTS, name), bytes);
      hashes[name] = sha256(bytes);
    }));
    const names = Object.keys(hashes).sort();
    const listed = names.map((n) => `  ${join('target', 'acceptance', '463', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(3)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/463/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const c = obj(call, 'TASTE.json');
    expect(c['issue'], 'TASTE.json: issue').toBe(463);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#463.fee183bf');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = obj(c['screenshots'], 'TASTE.json: screenshots');
    expect(Object.keys(recorded).sort(), `TASTE.json names the 24 screenshots: ${show(Object.keys(recorded))}`).toEqual(names);
    const other = names.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, TIMEOUT);
});
