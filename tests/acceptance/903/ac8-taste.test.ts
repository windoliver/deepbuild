// AC8 #903.1034b873: "Shown to you: screenshots of the pointer at a press, a slider and a toggle key, and the exported
// frame at 1920 × 1080, taken by the check run from the app at the reference window, with a recording of the tour
// pointer, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
// without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// The check run (README: The taste call). The fixture is the tour board, shown in one panel that fills the reference
// window (1512 × 982 points), with no input from anyone, so its tour plays from the moment it is shown. The run first
// checks by replies, not by a picture, that a pointer draws at the three times the screenshots are taken (`eval` with
// `tour_pointer: true`). Then `deep-show screen` (#1162) draws the app's window at 2× at 2.1 s (0.1 s into the press's
// ring), 5 s (the pointer riding the slider's thumb) and 8.1 s (0.1 s into the toggle's ring), and at 1× at 73 times
// from 1.4 s to 8.6 s, ten a second, for the recording; and #501's `export` writes the film's frame 25 (2.083 s, the
// press's ring under way) as a still at the film's own size. Each picture is encoded again here, so the same pixels
// give the same bytes, and written to docs/evidence/903/ with its SHA-256 printed. Then
// tests/acceptance/903/TASTE.json is read: none, or a call made on other bytes, fails `INCONCLUSIVE:`, never a pass;
// `looks_wrong` fails; `looks_right` on exactly these bytes passes. It judges no picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, REPO, WINDOW, decodePng, encodeApng, encodePng, fl, gate, inconclusive, peek, pngFrames, prebuild, present, presented, receiptOf, runScreen, runShow,
  scenario, sha256, show, tourBoard, useTemp, type JsonValue,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(8);
const EVIDENCE = join(REPO, 'docs', 'evidence', '903');
const TASTE = join(REPO, 'tests', 'acceptance', '903', 'TASTE.json');
const CRITERION = '#903.1034b873';
const SHOTS = [
  { name: 'pointer-press.png', s: 2.1, what: 'the pointer at the press key' },
  { name: 'pointer-slider.png', s: 5, what: 'the pointer at the slider key' },
  { name: 'pointer-toggle.png', s: 8.1, what: 'the pointer at the toggle key' },
] as const;
const EXPORTED = 'export-1920x1080.png';
const RECORDING = 'tour-pointer.apng';
/** The recording: the window at 1×, ten frames a second from 1.4 s to 8.6 s. */
const RECORDED = Array.from({ length: 73 }, (_, i) => Math.round((14 + i) * (FLICKS / 10)));

describe(`${AC[8]} the check run's pictures of the tour pointer, and the one taste call on them`, () => {
  it(`${AC[8]} the check run takes the three screenshots, the exported frame at 1920 × 1080 and the recording from the app's own frames, and the recorded call on exactly those bytes says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const doc = tourBoard('tour-board');
    const out = temp();

    // What the pictures show is first checked by replies, and the exported frame is written.
    const calls = [
      present(D, doc),
      ...SHOTS.map((s) => ({ call: 'eval', doc: D, t: fl(s.s), tour_pointer: true })),
      { call: 'export', doc: D, out: join(out, 'still'), range: { still: { t: 25 * (FLICKS / 12) } }, video: { codec: 'png_seq' } },
    ];
    const replies = runShow(scenario(temp(), [D], calls), "the check run's readings and its exported frame");
    presented(replies[0], 'the tour board');
    SHOTS.forEach((s, i) => {
      const reply = replies[1 + i]!;
      gate(reply, `eval at ${s.s} s`);
      expect((peek(reply['tour_pointer'])?.opacity ?? 0) > 0, `${s.what}: at ${s.s} s the tour pointer draws: ${show(reply['tour_pointer'] ?? reply, 400)}`).toBe(true);
    });
    const receipt = receiptOf(replies[replies.length - 1], 'the exported frame');
    expect(receipt.size, 'the exported frame records 1920 × 1080').toEqual([1920, 1080]);
    const stills = pngFrames(join(out, 'still'), 'the exported frame');
    expect(stills.length, 'the still wrote one PNG').toBe(1);
    const exported = decodePng(stills[0]!);
    expect([exported.width, exported.height], 'the exported frame is 1920 × 1080').toEqual([1920, 1080]);

    // The app's window at the reference size: the board shown at the clock's start, drawn at `t`.
    const window = scenario(temp(), [D], [present(D, doc, 0)], WINDOW);
    const screen = (t: number, scale: number, name: string) => runScreen(window, join(out, name), t, scale, `the window at ${t / FLICKS} s`);
    const files: Record<string, Buffer> = {};
    for (const s of SHOTS) {
      const im = screen(fl(s.s), 2, s.name);
      expect([im.width, im.height], `${s.name} is the reference window at 2×`).toEqual([WINDOW[0] * 2, WINDOW[1] * 2]);
      files[s.name] = encodePng(im);
    }
    files[EXPORTED] = encodePng(exported);
    const frames = RECORDED.map((t, i) => screen(t, 1, `frame-${String(i).padStart(2, '0')}.png`));
    for (const f of frames) expect([f.width, f.height], 'each frame of the recording is the reference window at 1×').toEqual([...WINDOW]);
    files[RECORDING] = encodeApng(frames, 10);

    mkdirSync(EVIDENCE, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(files)) { writeFileSync(join(EVIDENCE, name), bytes); hashes[name] = sha256(bytes); }
    const names = Object.keys(files).sort();
    const listed = names.map((n) => `  ${join('docs', 'evidence', '903', n)}  ${hashes[n]}`).join('\n');
    console.log(`${AC[8]}: written from this run's frames:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach to the PR and show the owner\n${listed}\nand record the one answer in tests/acceptance/903/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(903);
    expect(c['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const part = (k: string): Record<string, JsonValue> => (typeof c[k] === 'object' && c[k] !== null && !Array.isArray(c[k]) ? (c[k] as Record<string, JsonValue>) : {});
    const recorded = { ...part('screenshots'), ...part('recordings') };
    expect(Object.keys(recorded).sort(), `TASTE.json names the four screenshots and the recording: ${show(recorded)}`).toEqual(names);
    const other = names.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other bytes than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
  }, 3_600_000);
});
