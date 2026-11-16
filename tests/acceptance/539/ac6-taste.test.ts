// AC6 #539.95971461: Shown to you: screenshots of the 12 x 12 atlas grid with a pick, its keyboard focus on cell (3, 2)
// and the hover ghost, taken by the check run from the app at the reference window, with a recording of the pick, Tab
// focus and hover, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it
//
// The check run (README: The taste call). The fixture is criterion 1's grid with `rules` reading `place`, `picked` (the
// picked cell lit from `rules.lit`, in the atlas's gold), criterion 4's ghost, and `place`'s rows as one Tab stop, in
// the reference window (1512 × 982 points, the panel filling it, the camera wide enough to show the whole page). The run
// first plays the scenario through `deep-show run` and checks it did what the pictures show (the focus on (3, 2), one
// pick entry for (7, 3)); this reads no picture. Then `deep-show screen` (#1162) draws the app's window after a prefix
// of the same calls: the focus walk (Tab, Right three times, Down twice), the click on (7, 3), the pointer over (2, 3)
// and then (9, 6). Each picture is re-encoded so the same pixels give the same bytes and written to docs/evidence/539/;
// their SHA-256s are printed. Then tests/acceptance/539/TASTE.json is read: none, or a call on other pictures, fails
// `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no
// picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SQUARE, rulesProgram, worldProgram, type Cell } from './programs.ts';
import { cellCentre, pickControl, putAtlas, rowId, squareDoc } from './fixtures.ts';
import {
  AC, DOC, MS, REPO, Script, TIMEOUT, appendedOf, binOf, encodeApng, entriesText, focusOf, inconclusive, pickOf, pickText, pngBytes,
  prebuild, presented, putEvidence, runScreen, runShow, scenario, scopeView, sha256, toPanel, useTemp, type Image, type JsonValue,
  type Rect,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(6);
const EVIDENCE = join(REPO, 'docs', 'evidence', '539');
const TASTE = join(REPO, 'tests', 'acceptance', '539', 'TASTE.json');
const CRITERION = '#539.95971461';
const NAMES = ['grid-pick.png', 'grid-focus.png', 'grid-hover.png', 'pick-focus-hover.apng'] as const;
/** The reference window (technical design: the reference window), 1512 × 982 points, drawn at 2× for the screenshots. */
const WINDOW: [number, number] = [1512, 982];
const RECT: Rect = [0, 0, 1512, 982];
/** The camera's view width: the 224 u page's height fits the window's (224 × 1512 ÷ 982 ≈ 345). */
const CAM_WIDTH = 345;
const PICK: Cell = [7, 3];
const HOVERS: Cell[] = [[2, 3], [9, 6]];

describe(`${AC[6]} the check run's pictures of the pick, the focus and the ghost, and the one taste call on them`, () => {
  it(`${AC[6]} the check run takes the screenshots and the recording from the app at the reference window, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const ev = temp();
    const out = temp();
    const atlas = putAtlas(ev);
    const world = worldProgram(SQUARE);
    const rules = rulesProgram();
    for (const p of [world, rules]) putEvidence(ev, p.bytes);
    const doc = squareDoc('taste', atlas, { world, rules: { program: rules }, picked: true, ghost: true, controls: { place: pickControl('Place', ['board'], {}) }, camWidth: CAM_WIDTH });
    const o = { rect: RECT, window: WINDOW };
    const view = scopeView(binOf(), ev, D, doc, o, 'AC6 the grid in the reference window');

    // The scenario, and after which call each picture is drawn.
    const s = new Script();
    s.present(D, doc);
    const shown = s.scope();
    const walk = [s.key('Tab'), s.key('ArrowRight'), s.key('ArrowRight'), s.key('ArrowRight'), s.key('ArrowDown'), s.key('ArrowDown')];
    const [down, up] = s.click(toPanel(view, cellCentre(PICK)));
    const hovers = HOVERS.map((c) => s.move(toPanel(view, cellCentre(c))));
    // What the pictures show is first checked by the replies, not by a picture.
    const r = runShow(binOf(), scenario(ev, [D], s.calls, o), 'AC6 the check run\'s scenario');
    presented(r[0]!, 'the grid in the reference window');
    expect(focusOf(r[walk[walk.length - 1]!]!, 'after the walk'), 'the walk puts the keyboard focus on (3, 2)').toBe(rowId('board', [3, 2]));
    const entries = [...appendedOf(r[down]!, 'the press'), ...appendedOf(r[up]!, 'the release')];
    expect(entries.length === 1 ? pickText(pickOf(entries[0]!)) : entriesText(entries), 'the click writes one pick entry for (7, 3)').toBe(pickText({ set: 0, key: PICK }));

    // The window after a prefix of the calls, at `scale`, 300 ms after the prefix's last call.
    const screen = (last: number, scale: number, name: string): Image => {
      const prefix = s.calls.slice(0, last + 1);
      const t = Number(prefix[prefix.length - 1]!['at']) + 300 * MS;
      return runScreen(binOf(), scenario(ev, [D], prefix, o), join(out, name), t, scale, `AC6 the window: ${name}`);
    };
    const shots = { focus: screen(walk[walk.length - 1]!, 2, 'focus.png'), pick: screen(up, 2, 'pick.png'), hover: screen(hovers[hovers.length - 1]!, 2, 'hover.png') };
    for (const [k, im] of Object.entries(shots)) expect([im.width, im.height], `the ${k} screenshot is the reference window at 2×`).toEqual([WINDOW[0] * 2, WINDOW[1] * 2]);
    const frames = [shown, ...walk, up, ...hovers].map((i, k) => screen(i, 1, `frame-${k}.png`));
    const files: Record<string, Buffer> = {
      'grid-pick.png': pngBytes(shots.pick),
      'grid-focus.png': pngBytes(shots.focus),
      'grid-hover.png': pngBytes(shots.hover),
      'pick-focus-hover.apng': encodeApng(frames, 2),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/539/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[6]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/539/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(539);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the four files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[6]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
