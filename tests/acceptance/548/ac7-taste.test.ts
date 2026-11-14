// #548.7c091366: Shown to you: screenshots of the hex board's previewed route while hovering and after the AI move,
// taken by the check run from the app at the reference window, with a recording of the hover, are attached to the PR
// and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it
//
// The check run (README: The taste call). Criterion 1's board in deep-show, its page filling the reference window
// (1512 × 982 points). The run first plays the scenario through `deep-show run` and checks by replies that the AI moves
// the unit at step 120 (deep_query's logic read of `game.unit` at steps 119 and 121); it reads no picture. Then
// `deep-show screen` (#1162) draws the app's window after the pointer has moved over eight hexes 11 from the unit, at
// 1.2 s (the route while hovering, at 2×) and, the pointer still, at 2.6 s (after the AI move, at 2×), and once after
// each move and at 2.6 s at 1× for the recording. The pictures go to docs/evidence/548/ with their SHA-256s printed;
// then tests/acceptance/548/TASTE.json is read: none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass;
// `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOVERS, MOVE_STEP, U0, U1, game, probe } from './programs.ts';
import { gamePiece, hexCentre, hexDoc, putAtlas } from './fixtures.ts';
import {
  AC, DOC, MS, REPO, TIMEOUT, admitted, camOf, checkCall, encodeApng, inconclusive, logic, logicBin, logicReadOf, offsetIn, pngBytes, prebuild,
  presented, putEvidence, queryLogic, runScreen, runShow, scenario, sha256, showBin, showCall, toPanel, useTemp, type Image, type JsonObject, type JsonValue,
  type Rect,
} from './helpers.ts';

prebuild(() => { logicBin(); showBin(); });
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '548');
const TASTE = join(REPO, 'tests', 'acceptance', '548', 'TASTE.json');
const NAMES = ['route-hover.png', 'route-after-move.png', 'route-hover.apng'] as const;
/** The reference window (technical design: the reference window), 1512 × 982 points, drawn at 2× for the screenshots. */
const WINDOW: [number, number] = [1512, 982];
const RECT: Rect = [0, 0, 1512, 982];
/** The camera's view width: the 520 u page's height fits the window's (520 × 1512 ÷ 982 ≈ 801), with a margin. */
const CAM_WIDTH = 820;
const HOVERED = HOVERS.slice(0, 8);

describe(`${AC[7]} the check run's pictures of the previewed route, and the one taste call on them`, () => {
  it(`${AC[7]} the check run takes the screenshots and the recording from the app at the reference window, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const [c] = logic([checkCall(gamePiece(probe()))]);
    const l = admitted(c!, 'check of the hex board\'s item')['game']!;
    const program = game({ unit: offsetIn(l, 'writes', 'unit'), here: offsetIn(l, 'writes', 'here') });
    const ev = temp();
    const out = temp();
    const atlas = putAtlas(ev);
    putEvidence(ev, program.bytes);
    const D = DOC(9);
    const doc = hexDoc('taste', atlas, program, CAM_WIDTH);
    const o = { rect: RECT, window: WINDOW };
    const first = runShow(scenario(ev, [D], [showCall(D, doc, 1), { call: 'scope', panel: 'p1', at: 100 * MS }], o), 'the board in the reference window, its scope read');
    presented(first[0]!, 'the hex board in the reference window');
    const cam = camOf(first[1]!, 'the scope');

    // The scenario: shown, the pointer over eight hexes 100 ms apart from 0.3 s, then still.
    const calls: JsonObject[] = [showCall(D, doc, 1)];
    const moves = HOVERED.map((h, i) => { calls.push({ call: 'input', panel: 'p1', event: { type: 'move', pos: toPanel(cam, hexCentre(h)) }, at: (300 + 100 * i) * MS }); return calls.length - 1; });
    // What the pictures show is checked first by the replies, not by a picture: the AI moves the unit at step 120.
    const r = runShow(scenario(ev, [D], [...calls, queryLogic(D, ['game'], [MOVE_STEP - 1, MOVE_STEP + 1], [], 1_200 * MS)], o), 'the check run\'s scenario');
    presented(r[0]!, 'the hex board');
    const unit = logicReadOf(r[calls.length]!, 'game', 'deep_query of the board').steps.map((s) => s.arrays['game.unit']);
    expect(unit, 'the unit stands at U0 at step 119 and at U1 at step 121').toEqual([[U0[0], U0[1]], [U1[0], U1[1]]]);

    const screen = (last: number, t: number, scale: number, name: string): Image => runScreen(scenario(ev, [D], calls.slice(0, last + 1), o), join(out, name), t, scale, `the window: ${name}`);
    const hover = screen(moves[moves.length - 1]!, 1_200 * MS, 2, 'hover.png');
    const after = screen(moves[moves.length - 1]!, 2_600 * MS, 2, 'after.png');
    for (const [k, im] of Object.entries({ hover, after })) expect([im.width, im.height], `the ${k} screenshot is the reference window at 2×`).toEqual([WINDOW[0] * 2, WINDOW[1] * 2]);
    const frames = [...moves.map((m, i) => screen(m, (400 + 100 * i) * MS, 1, `frame-${i}.png`)), screen(moves[moves.length - 1]!, 2_600 * MS, 1, 'frame-after.png')];
    const files: Record<string, Buffer> = { 'route-hover.png': pngBytes(hover), 'route-after-move.png': pngBytes(after), 'route-hover.apng': encodeApng(frames, 2) };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/548/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[7]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/548/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(548);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(AC[7]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the three files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[7]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});

