// AC7 #552.84746f1a: Shown to you: screenshots of copy 1's fog and copy 2's fog over the 128 x 128 grid, and the Join
// prompt with the courtesy line, taken by the check run from the app at the reference window, are attached to the PR
// and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it
//
// The check run (README: The taste call), as #548's: `deep-show screen` (#1162) draws the app's window, its panel filling
// the reference window (1,512 × 982 points), at 2×. First, by replies and no picture, `deep-show run` checks the state
// the pictures show: the war piece (criterion 6's, framed for the window) is presented, its match plays 140 steps with
// both copies, and the fog piece's Join prompt says the courtesy line. Then three windows: the war piece's match of 140
// steps with copy 1 on the panel (`match`'s `on_panel`, README), the same with copy 2, and the fog piece presented with
// its Join prompt open. The pictures go to docs/evidence/552/ with their SHA-256s printed; then
// tests/acceptance/552/TASTE.json is read: none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass;
// `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture. "Attached to the PR and
// shown to you in the session" is the implementing agent's; no test can see it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, GRID, STEP, fogDoc, sightProgram, toneWav, warDoc, warProgram, type JsonValue } from './fixtures.ts';
import {
  AC, FULL, REPO, Script, TIMEOUT, WINDOW, inconclusive, macOnly, matchCall, pairOf, pngBytes, presented, promptOf, putEvidence, run, scenario, screen,
  sha256, useBuilds, useChildren, useTemp, type Image,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '552');
const TASTE = join(REPO, 'tests', 'acceptance', '552', 'TASTE.json');
const CRITERION = '#552.84746f1a';
const NAMES = ['copy-1-fog.png', 'copy-2-fog.png', 'join-prompt.png'] as const;
const COURTESY = 'Fog in this piece is a courtesy. Every copy can see everything.';
/** The match the fog pictures show: the whole grid stands from step 127; no grenade yet. */
const STEPS = 140;
/** The war piece framed for the window: the 128 m plate fills its height. */
const WAR_WIDTH = (GRID * WINDOW[0]) / WINDOW[1];

describe(`${AC[7]} the check run's pictures of each copy's fog and of the Join prompt, and the one taste call on them`, () => {
  it(`${AC[7]} the check run takes the screenshots from the app at the reference window, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, async () => {
    macOnly();
    const ev = temp();
    const out = temp();
    const war = warProgram();
    const sight = sightProgram();
    putEvidence(ev, war.bytes);
    putEvidence(ev, sight.bytes);
    const tone = putEvidence(ev, toneWav());
    const warShown = [{ id: DOC.war, size: WINDOW }];
    const fogShown = [{ id: DOC.fog, size: WINDOW }];
    const warCalls = (player: number): Script => {
      const s = new Script();
      s.present(DOC.war, warDoc(war, tone, { size: WINDOW, width: WAR_WIDTH }));
      s.add(matchCall(DOC.war, STEPS, { relay: { seed: 552 }, onPanel: player }));
      return s;
    };
    const fogCalls = new Script();
    fogCalls.present(DOC.fog, fogDoc(sight, { size: WINDOW }));

    // What the pictures show is checked first by the replies, not by a picture.
    const check = warCalls(1);
    const checkFog = new Script();
    const f = checkFog.present(DOC.fog, fogDoc(sight, { size: WINDOW }));
    const sc = checkFog.scope();
    const r = await run(builds.show(), scenario(ev, warShown, check.calls, { window: true }), 'AC7 the war piece in the window');
    presented(r[0], 'AC7 the war piece');
    pairOf(r[1], 'AC7 the war piece\'s match');
    const rf = await run(builds.show(), scenario(ev, fogShown, checkFog.calls, { window: true }), 'AC7 the fog piece in the window');
    presented(rf[f], 'AC7 the fog piece');
    expect(promptOf(rf[sc], 'AC7 the fog piece\'s scope')?.text ?? '', 'AC7: the fog piece\'s Join prompt says the courtesy line').toContain(COURTESY);

    const shots: Record<(typeof NAMES)[number], Image> = {
      'copy-1-fog.png': screen(builds.show(), scenario(ev, warShown, warCalls(1).calls, { window: true }), join(out, 'one.png'), STEPS * STEP, 2, 'AC7 copy 1\'s fog'),
      'copy-2-fog.png': screen(builds.show(), scenario(ev, warShown, warCalls(2).calls, { window: true }), join(out, 'two.png'), STEPS * STEP, 2, 'AC7 copy 2\'s fog'),
      'join-prompt.png': screen(builds.show(), scenario(ev, fogShown, fogCalls.calls, { window: true }), join(out, 'join.png'), STEP * 10, 2, 'AC7 the Join prompt'),
    };
    for (const [n, im] of Object.entries(shots)) expect([im.width, im.height], `AC7: ${n} is the reference window at 2×`).toEqual([WINDOW[0] * 2, WINDOW[1] * 2]);
    const files = Object.fromEntries(NAMES.map((n) => [n, pngBytes(shots[n])])) as Record<string, Buffer>;
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/552/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[7]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/552/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(552);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
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
