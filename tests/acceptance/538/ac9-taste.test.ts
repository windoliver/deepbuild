// AC9 #538.304491be: Shown to you: screenshots of the 40 x 12 cell grid, the keyed copy in en and de, and the dialogue
// flip, taken by the check run from the canvas's own frames, are attached to the PR and shown to you in the session.
// Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it
//
// The check run (README: The taste call): this test draws the criteria's own fixtures through `deep-show run` and takes
// each picture from the canvas's own canonical render of the hub session's frame (`eval`'s snapshot, a PNG the canvas
// stored in the evidence store), re-encodes each so the same pixels always give the same bytes, writes them to
// docs/evidence/538/ and prints their SHA-256s. Then it reads tests/acceptance/538/TASTE.json: none, or a call on other
// pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly these pictures passes. It
// judges no picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAD, LOOT, gridProgram, lootProgram, storyProgram } from './programs.ts';
import { KEY17, copyDoc, dialogueDoc, gridDoc } from './fixtures.ts';
import {
  AC, DOC, REPO, TIMEOUT, at, binOf, evalCall, inconclusive, pngBytes, pngOf, prebuild, presented, putEvidence, runShow, scenario, sha256, showCall,
  snapshotOf, useTemp, type JsonValue,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '538');
const TASTE = join(REPO, 'tests', 'acceptance', '538', 'TASTE.json');
const CRITERION = '#538.304491be';
const NAMES = ['cell-grid.png', 'copy-en.png', 'copy-de.png', 'dialogue-flip.png'] as const;
const D = { grid: DOC(1), copy: DOC(2), dialogue: DOC(3) };
const DIALOGUE_SHOT = 45;

describe(`${AC[9]} the check run's pictures of the cell grid, the keyed copy in en and de and the dialogue flip, and the one taste call on them`, () => {
  it(`${AC[9]} the check run takes the screenshots from the canvas's own frames, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const ev = temp();
    const [grid, loot, story] = [gridProgram(), lootProgram(), storyProgram()];
    for (const p of [grid, loot, story]) putEvidence(ev, p.bytes);
    const tables = { en: { 17: { ...KEY17.en } }, fr: { 17: { ...KEY17.fr } }, de: { 17: { ...KEY17.de } } };
    const r = runShow(binOf(), scenario(ev, Object.values(D), [
      showCall(D.grid, gridDoc(grid, { key: false })), evalCall(D.grid, at(BAD.from)),
      showCall(D.copy, copyDoc(loot, tables)), evalCall(D.copy, at(LOOT.twelve), { locale: 'en' }), evalCall(D.copy, at(LOOT.twelve), { locale: 'de' }),
      showCall(D.dialogue, dialogueDoc(story)), evalCall(D.dialogue, at(DIALOGUE_SHOT)),
    ]), 'AC9 the check run');
    presented(r[0]!, 'the 40 × 12 cell grid');
    presented(r[2]!, 'the keyed copy in en, fr and de');
    presented(r[5]!, 'the dialogue');
    const shot = (k: number, what: string): Buffer => pngBytes(pngOf(ev, snapshotOf(r[k]!, what), what));
    const files: Record<(typeof NAMES)[number], Buffer> = {
      'cell-grid.png': shot(1, 'the cell grid at step 30'),
      'copy-en.png': shot(3, 'the keyed copy in en, count 12'),
      'copy-de.png': shot(4, 'the keyed copy in de, count 12'),
      'dialogue-flip.png': shot(6, 'the dialogue at step 45, story.line 37'),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/538/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[9]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/538/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(538);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the four files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[9]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
