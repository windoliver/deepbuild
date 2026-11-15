// AC10 #542.5cccb17f: Shown to you: screenshots of the 200-row list at scroll positions 0, 1 and 3, and the text control
// after a committed program, taken by the check run from the canvas's own frames, with a recording of the scroll steps,
// are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without
// it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it
//
// The check run (README: The taste call), as #539's. The fixture is the list with a document-class `list` and, ahead of
// it in the Tab order, the text control `program` (max_bytes 16,384, lines many), in the reference window (1512 × 982
// points) with the panel across its top 1512 × 756 points, which shows the 480 × 240 u page whole. The run first plays
// the scenario through `deep-show run` and checks by replies what the pictures show (three wheel lines writing 1, 2 and
// 3; Tab focusing `program`; the commit holding the program); it reads no picture. Then `deep-show screen` (#1162) draws
// the app's window, the canvas's own frames, after prefixes of the same calls, 300 ms after each prefix's last call.
// Each picture is re-encoded so the same pixels give the same bytes and written to docs/evidence/542/; their SHA-256s
// are printed. Then tests/acceptance/542/TASTE.json is read: none, or a call on other pictures, fails `INCONCLUSIVE:`,
// never a pass; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It judges no picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tilesProgram } from './programs.ts';
import { OVER, PROGRAM_TEXT, listDoc, putAtlas, textControl } from './fixtures.ts';
import {
  AC, DOC, MS, REPO, Script, TIMEOUT, appendedOf, binOf, encodeApng, entriesText, focusOf, inconclusive, pngBytes, prebuild, presented, putEvidence,
  runScreen, runShow, scenario, scopeView, sha256, toPanel, useTemp, type Image, type JsonValue, type Rect,
} from './helpers.ts';

prebuild('deep-show');
const temp = useTemp();
const D = DOC(10);
const EVIDENCE = join(REPO, 'docs', 'evidence', '542');
const TASTE = join(REPO, 'tests', 'acceptance', '542', 'TASTE.json');
const CRITERION = '#542.5cccb17f';
const NAMES = ['list-0.png', 'list-1.png', 'list-3.png', 'text-program.png', 'scroll-steps.apng'] as const;
/** The reference window, 1512 × 982 points, drawn at 2× for the screenshots; the panel across its top shows the page whole. */
const WINDOW: [number, number] = [1512, 982];
const RECT: Rect = [0, 0, 1512, 756];

describe(`${AC[10]} the check run's pictures of the list and the text control, and the one taste call on them`, () => {
  it(`${AC[10]} the check run takes the screenshots and the recording from the canvas's own frames, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const ev = temp();
    const out = temp();
    const tiles = tilesProgram();
    putEvidence(ev, tiles.bytes);
    const doc = listDoc('taste', {
      atlas: putAtlas(ev), tiles, before: { program: textControl('Program', 16_384, 'many') },
      scroll: { id: 'list', spec: { class: 'document', range: [0, 190] } },
    });
    const o = { rect: RECT, window: WINDOW };
    const view = scopeView(binOf('deep-show'), ev, D, doc, o, 'AC10 the list in the reference window');

    // The scenario, and after which call each picture is drawn.
    const s = new Script();
    s.present(D, doc);
    const shown = s.scope();
    const lines = [0, 1, 2].map(() => s.wheel(toPanel(view, OVER)));
    const tab = s.key('Tab');
    PROGRAM_TEXT.split('\n').forEach((l, i, all) => { s.text(l); if (i < all.length - 1) s.key('Enter'); });
    const commit = s.key('Enter', ['cmd']);
    // What the pictures show is first checked by the replies, not by a picture.
    const r = runShow(binOf('deep-show'), scenario(ev, [D], s.calls, o), 'AC10 the check run\'s scenario');
    presented(r[0]!, 'the list and the text control in the reference window');
    lines.forEach((i, k) => {
      const a = appendedOf(r[i]!, `wheel line ${k + 1}`);
      expect(a.length === 1 && a[0]!['control'] === 'list' ? a[0]!['value'] : entriesText(a), `wheel line ${k + 1} writes position ${k + 1}`).toBe(k + 1);
    });
    expect(focusOf(r[tab]!, 'after Tab'), 'Tab focuses the text control').toBe('program');
    const committed = appendedOf(r[commit]!, 'Cmd+Enter');
    expect(committed.length === 1 && committed[0]!['control'] === 'program' ? committed[0]!['value'] : entriesText(committed), 'Cmd+Enter commits the program').toBe(PROGRAM_TEXT);

    // The window after a prefix of the calls, at `scale`, 300 ms after the prefix's last call.
    const screen = (last: number, scale: number, name: string): Image => {
      const prefix = s.calls.slice(0, last + 1);
      const t = Number(prefix[prefix.length - 1]!['at']) + 300 * MS;
      return runScreen(binOf('deep-show'), scenario(ev, [D], prefix, o), join(out, name), t, scale, `AC10 the window: ${name}`);
    };
    const shots = { list0: screen(shown, 2, 'list-0.png'), list1: screen(lines[0]!, 2, 'list-1.png'), list3: screen(lines[2]!, 2, 'list-3.png'), text: screen(commit, 2, 'text.png') };
    for (const [k, im] of Object.entries(shots)) expect([im.width, im.height], `the ${k} screenshot is the reference window at 2×`).toEqual([WINDOW[0] * 2, WINDOW[1] * 2]);
    const frames = [shown, ...lines].map((i, k) => screen(i, 1, `frame-${k}.png`));
    const files: Record<string, Buffer> = {
      'list-0.png': pngBytes(shots.list0),
      'list-1.png': pngBytes(shots.list1),
      'list-3.png': pngBytes(shots.list3),
      'text-program.png': pngBytes(shots.text),
      'scroll-steps.apng': encodeApng(frames, 2),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n]!)]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]!);
    }
    const listed = NAMES.map((n) => `  docs/evidence/542/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[10]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/542/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(542);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the five files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[10]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
