// AC11 #297.5d8a3e72: Shown to you: screenshots of the name fixtures and the two copies' frames side by side, taken by
// the check run from the canvas's own frames, are attached to the PR and shown to you in the session. Whether they look
// right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a
// picture to judge it
//
// The check run (README: The taste call): this test draws the criteria's own fixtures through `deep-show run` and takes
// each picture from the canvas's own canonical render (`eval`'s snapshot, and each copy's frame `match`'s `render_back`
// draws, PNGs the canvas stored in the evidence store), re-encodes each so the same pixels always give the same bytes,
// writes them to docs/evidence/297/ and prints their SHA-256s. Then it reads tests/acceptance/297/TASTE.json: none, or a
// call on other pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly these
// pictures passes. It judges no picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELAY, NAME, fitDoc, namesDoc, platesDoc, seatsProgram } from './fixtures.ts';
import {
  AC, DOC, RATE, REPO, Script, TIMEOUT, at, commit, inconclusive, pngBytes, pngOf, presented, putEvidence, rendersOf, runShow, scenario, sha256, sideBySide,
  snapshotOf, trackOf, useShow, useTemp, type JsonValue,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '297');
const TASTE = join(REPO, 'tests', 'acceptance', '297', 'TASTE.json');
const CRITERION = '#297.5d8a3e72';
const NAMES = ['names.png', 'look-alike.png', 'marks.png', 'ellipsis.png', 'copies.png'] as const;
const [NAMES_DOC, FIT_DOC, PLATES_DOC] = [DOC(20), DOC(21), DOC(22)];

describe(`${AC[11]} the check run's pictures of the name fixtures and of the two copies side by side, and the one taste call on them`, () => {
  it(`${AC[11]} the check run takes the screenshots from the canvas's own frames, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const ev = temp();
    const seats = seatsProgram();
    putEvidence(ev, seats.bytes);
    const s = new Script();
    const shows = [s.present(NAMES_DOC, namesDoc(seats)), s.present(FIT_DOC, fitDoc(seats, 'WWWWWW')), s.present(PLATES_DOC, platesDoc(seats))];
    // The name fixtures: seat 1's and seat 2's plates on three recorded tracks, and the 16-letter name in its box.
    const names = s.eval(NAMES_DOC, at(100), { pixels: true, track: trackOf([commit(90, 1, 'Kai Ng'), commit(95, 2, 'Ana')]) });
    const lookAlike = s.eval(NAMES_DOC, at(60), { pixels: true, track: trackOf([commit(20, 1, 'Coco'), commit(40, 2, '\u{0421}\u{043e}\u{0441}\u{043e}')]) });
    const marks = s.eval(NAMES_DOC, at(30), { pixels: true, track: trackOf([commit(10, 1, 'e\u{0301}'), commit(20, 2, '\u{1f468}\u{200d}\u{1f466}')]) });
    const ellipsis = s.eval(FIT_DOC, at(20), { pixels: true, track: trackOf([commit(10, 1, 'W'.repeat(16))]) });
    // The two copies of criterion 2's match at step 236, where seat 1 shows "Kai Ng" and seat 2 "Ana Lee".
    const plays = { 1: [{ step: 33 - DELAY, control: NAME, value: 'Kai' }, { step: 145 - DELAY, control: NAME, value: 'Kai Ng' }], 2: [{ step: 75 - DELAY, control: NAME, value: 'Ana' }, { step: 215 - DELAY, control: NAME, value: 'Ana Lee' }] };
    const t = (236 + 0.5) / RATE;
    const m = s.match(PLATES_DOC, 300, plays, [{ player: 1, t }, { player: 2, t }]);
    const r = runShow(show(), scenario(ev, [NAMES_DOC, FIT_DOC, PLATES_DOC], s.calls), 'AC11 the check run');
    presented(r[shows[0]!]!, 'the nameplates piece');
    presented(r[shows[1]!]!, 'the fit piece');
    presented(r[shows[2]!]!, 'the plates piece');
    const shot = (k: number, what: string): Buffer => pngBytes(pngOf(ev, snapshotOf(r[k]!, what), what));
    const [one, two] = rendersOf(r[m]!, 2, 'the match');
    const files: Record<(typeof NAMES)[number], Buffer> = {
      'names.png': shot(names, 'seat 1 "Kai Ng" and seat 2 "Ana" at step 100'),
      'look-alike.png': shot(lookAlike, 'Coco in Latin and in Cyrillic at step 60'),
      'marks.png': shot(marks, 'e with U+0301 and the family emoji at step 30'),
      'ellipsis.png': shot(ellipsis, 'the 16-letter name in its box at step 20'),
      'copies.png': sideBySide(pngOf(ev, one!.sha256, 'copy 1\'s frame'), pngOf(ev, two!.sha256, 'copy 2\'s frame')),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/297/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[11]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/297/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(297);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the five files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[11]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
