// AC5: "Shown to you: screenshots of a shot split into two looks along a drawn edge, strokes on a 3D surface and the
// status legend, taken by the check run from the renderer's own output, with a recording of an orbit and of the motifs,
// are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without
// it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// One run draws, keeping each frame's final PNG byte for byte (`view3d`'s and `film2d`'s `final`): the split edge film
// at 1 s, its slab across a torn edge between looks a and b (helpers.ts: edgeDoc('split')); the brush look's strokes on
// the three boxes at frame 22 of the orbit (orbitDoc); and the status film at 1 s, its two marks and the legend
// (edgeDoc('fade', {status: true})), each 640 × 360; and two recordings that put the canvas's own PNG frames into
// animated PNGs unchanged (#449's apng): the brush look's orbit, frames 0 to 45 at 15 fps, 320 × 180, and the motif
// film, frames 0 to 59 at 15 fps (4 s), 480 × 270. All five go to `target/acceptance/462/`, each with its SHA-256
// printed. The test then reads `tests/acceptance/462/TASTE.json`: with none, or one made on other bytes, it is
// INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these passes. No other test reads these pictures.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_LOOKS, ORBIT, REPO, SHA, STATUS_LOOKS, TIMEOUT, VERDICTS, ac, apng, documentLook, edgeDoc, film2d, filmFrames,
  framesOf, inconclusive, motifFilm, motifLook, orbitDoc, requireGpu, run, sha256, show, strokeLook, useBins, useDir, view3d,
  writeJson, type JsonValue, type Shot,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '462');
const TASTE = join(REPO, 'tests', 'acceptance', '462', 'TASTE.json');
const SCREENSHOTS = ['region-edge.png', 'strokes.png', 'status-legend.png'] as const;
const RECORDINGS = ['orbit.apng', 'motifs.apng'] as const;
const SHOT: [number, number] = [640, 360];
const REC: [number, number] = [320, 180];

describe(`${ac(5)} the screenshots and recordings, and the one taste call on them`, () => {
  it(`${ac(5)} the run writes a shot split into two looks along a drawn edge, strokes on 3D boxes, the status legend, an orbit recording and a motifs recording from the renderer's own frames, and the recorded call on exactly those says they look right`, () => {
    requireGpu();
    const d = dir();
    const coverage = COVERAGE_LOOKS();
    const status = STATUS_LOOKS();
    const docs = {
      split: writeJson(d, 'split.json', edgeDoc('split', { edge: 'torn' })),
      orbit: writeJson(d, 'orbit.json', orbitDoc()),
      status: writeJson(d, 'status.json', edgeDoc('fade', { status: true })),
    };
    const one = (frame: number) => ({ size: SHOT, fps: 30, from: frame, frames: 1, capture: [frame], targets: ['final'] });
    const calls = [
      view3d({ doc: docs.split, look: coverage['a']!, looks: coverage, ...one(30) }),
      view3d({ doc: docs.orbit, look: strokeLook('brush'), ...one(22), fps: ORBIT.fps }),
      view3d({ doc: docs.status, look: documentLook(), looks: status, ...one(30), states: { [VERDICTS.left]: 'fail', [VERDICTS.right]: 'running' } }),
      view3d({ doc: docs.orbit, look: strokeLook('brush'), size: REC, fps: ORBIT.fps, from: 0, frames: ORBIT.frames, capture: 'every', targets: ['final'] }),
      film2d({ doc: motifFilm('all'), look: motifLook(true), fps: 15, frames: 60, capture: Array.from({ length: 60 }, (_, n) => n) }),
    ];
    const replies = run(bins.bin('deep-gpu'), d, calls);
    const png = (f: Shot | undefined, what: string): Buffer => {
      expect(f?.final, `${what}: the renderer's final PNG, named by its SHA-256`).toMatch(SHA);
      const bytes = readFileSync(join(d, `${f!.final!}.png`));
      expect(sha256(bytes), `${what}: the PNG hashes to its name`).toBe(f!.final);
      return bytes;
    };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
    SCREENSHOTS.forEach((name, i) => keep(name, png(framesOf(replies[i]!, name)[0], name)));
    keep('orbit.apng', apng(framesOf(replies[3]!, 'orbit.apng').map((f) => png(f, `orbit.apng: frame ${f.frame}`)), ORBIT.fps, 'orbit.apng'));
    keep('motifs.apng', apng(filmFrames(replies[4]!, 'motifs.apng').map((f) => png(f, `motifs.apng: frame ${f.frame}`)), 15, 'motifs.apng'));
    const listed = [...SCREENSHOTS, ...RECORDINGS].map((n) => `  ${join('target', 'acceptance', '462', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ac(5)}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/462/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(462);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#462.28d871fe');
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
