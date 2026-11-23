// AC7 #269.40ff86cd: Shown to you: screenshots of the grid fixture drawn nearest and smooth beside its cells, and the
// three-role corner, taken by the check run from the canvas's own frames, are attached to the PR and shown to you in the
// session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no
// criterion above reads a picture to judge it
//
// The check run (README: The taste call): this test draws the criteria's own fixtures through `deep-show run` and takes
// each picture from the canvas's canonical render of the hub session's frame (`eval`'s snapshot, a PNG the canvas
// stored in the evidence store), re-encodes it so the same pixels always give the same bytes, writes it to
// docs/evidence/269/ and prints its SHA-256: `grid-beside.png`, the grid fixture at step 20 drawn nearest (its cells) with
// the same grid drawn smooth beside it, and `corner.png`, the three-role corner at 32 px a cell. Then it reads
// tests/acceptance/269/TASTE.json: none, or a call on other pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong`
// fails; `looks_right` on exactly these pictures passes. It judges no picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { frontProgram, teamsProgram } from './programs.ts';
import { cornerDoc, gridDoc } from './fixtures.ts';
import {
  AC, DOC, REPO, TIMEOUT, at, binOf, evalCall, inconclusive, pngBytes, pngOf, prebuild, presented, putEvidence, runShow, scenario, sha256, showCall,
  snapshotOf, useTemp, type JsonValue,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '269');
const TASTE = join(REPO, 'tests', 'acceptance', '269', 'TASTE.json');
const CRITERION = '#269.40ff86cd';
const NAMES = ['grid-beside.png', 'corner.png'] as const;
const D = { grid: DOC(7), corner: DOC(8) };

describe(`${AC[7]} the check run's pictures of the grid fixture nearest and smooth and of the three-role corner, and the one taste call on them`, () => {
  it(`${AC[7]} the check run takes the screenshots from the canvas's own frames, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, () => {
    const ev = temp();
    const [teams, front] = [teamsProgram(), frontProgram()];
    for (const p of [teams, front]) putEvidence(ev, p.bytes);
    const r = runShow(binOf(), scenario(ev, Object.values(D), [
      showCall(D.grid, gridDoc(teams, ['nearest', 'smooth'])), evalCall(D.grid, at(20)),
      showCall(D.corner, cornerDoc(front)), evalCall(D.corner, at(2)),
    ]), 'AC7 the check run');
    presented(r[0]!, 'the grid fixture, nearest beside smooth');
    presented(r[2]!, 'the three-role corner');
    const shot = (k: number, what: string): Buffer => pngBytes(pngOf(ev, snapshotOf(r[k]!, what), what));
    const files: Record<(typeof NAMES)[number], Buffer> = {
      'grid-beside.png': shot(1, 'the grid fixture at step 20, nearest beside smooth'),
      'corner.png': shot(3, 'the three-role corner at 32 px a cell'),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/269/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[7]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/269/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(269);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the two files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[7]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});
