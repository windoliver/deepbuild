// AC12 #173.7c84d072: Shown to you: screenshots of the castle flythrough moving, the 1 px wire fence turning, and the
// first frame after a seek, taken by the check run from the canvas's own frames, with a recording of the flythrough
// with frame history on and off, are attached to the PR and shown to you in the session. Whether they look right is one
// taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to
// judge it.
//
// One run draws, with the fixtures and looks the criteria use: the castle's moving frame at 2.5 s played from 0 with
// frame history on (AC1's), the wire fence's frame 60 turning with history on (AC4's), the castle's first frame after a
// seek from 10 s to 4 s (AC5's), and the flythrough's first second (frames 0–29 at 30 fps) at 640 × 400 with history
// on and with history off. It writes to `docs/evidence/173/` (README: The taste call) `castle-moving.png`,
// `fence-turning.png` and `castle-after-seek.png` (the renderer's own final-target PNGs, byte for byte) and
// `flythrough-history-on.apng` and `flythrough-history-off.apng` (the final targets as animated PNGs), printing each
// one's SHA-256. It then reads the recorded call, `tests/acceptance/173/TASTE.json`: none, or one made on other pictures
// (another SHA-256), is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these pictures passes. No other test
// reads these pictures or the call.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, FENCE, HISTORY_OFF, HISTORY_ON, REPO, castle, castleLook, encodeApng, fenceDoc, frameAt, framesOf, inconclusive, look, readNamed, readPng,
  requireMetal, runGpu, sha256, useDir, useGpu, view3dCall, writeJson, type JsonValue,
} from './helpers.ts';

const ID = AC[12];
const bin = useGpu();
const dir = useDir();
/** Where the run writes the screenshots and the recordings. */
const SHOTS = join(REPO, 'docs', 'evidence', '173');
/** Where the taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '173', 'TASTE.json');
const NAMES = ['castle-moving.png', 'fence-turning.png', 'castle-after-seek.png', 'flythrough-history-on.apng', 'flythrough-history-off.apng'] as const;
const REC_SIZE: [number, number] = [640, 400];
const REC_FRAMES = 30;

function screenshots(): Record<string, string> {
  const out = dir();
  const c = castle();
  const on = castleLook(c, HISTORY_ON);
  const castleCall = { doc: c.doc, size: c.size, packs: c.packs, fps: CASTLE_FPS, targets: ['final' as const] };
  const rec = (history: typeof on) => view3dCall({ doc: c.doc, look: castleLook(c, history), size: REC_SIZE, packs: c.packs, fps: CASTLE_FPS, frames: REC_FRAMES, capture: 'every', targets: ['final'] });
  const replies = runGpu(bin(), out, [
    view3dCall({ ...castleCall, look: on, frames: 76, capture: [75] }),
    view3dCall({ doc: writeJson(out, 'fence', fenceDoc()), look: look({ history: HISTORY_ON }), size: FENCE.size, fps: FENCE.fps, frames: 61, capture: [60], targets: ['final'] }),
    view3dCall({ ...castleCall, look: on, from: 300, frames: 2, seeks: [{ after: 300, to: 120 }], capture: [120] }),
    rec(HISTORY_ON),
    rec(HISTORY_OFF),
  ]);
  const names = ['the castle moving', 'the fence turning', 'the castle after a seek', 'the flythrough with history', 'the flythrough without history'];
  const frames = replies.map((r, i) => framesOf(r, names[i]!));
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  const keep = (name: string, bytes: Buffer): void => { writeFileSync(join(SHOTS, name), bytes); hashes[name] = sha256(bytes); };
  keep(NAMES[0], readNamed(out, frameAt(frames[0]!, 75, names[0]!).final, 'png', names[0]!));
  keep(NAMES[1], readNamed(out, frameAt(frames[1]!, 60, names[1]!).final, 'png', names[1]!));
  keep(NAMES[2], readNamed(out, frameAt(frames[2]!, 120, names[2]!).final, 'png', names[2]!));
  for (const k of [3, 4]) {
    expect(frames[k]!.length, `${names[k]} holds ${REC_FRAMES} frames`).toBe(REC_FRAMES);
    keep(NAMES[k]!, encodeApng(frames[k]!.map((f) => readPng(out, f.final, `${names[k]}: frame ${f.frame}`)), CASTLE_FPS));
  }
  return hashes;
}

describe(`${ID} the screenshots, the recordings and the one taste call on them`, () => {
  it(`${ID} the run writes the castle moving, the fence turning, the first frame after a seek and the flythrough with history on and off from the canvas's own frames, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '173', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots and recordings written from this run's frames:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/173/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(173);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#173.7c84d072');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the three screenshots and the two recordings').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 3_600_000);
});
