// AC8 #3257.389c0d78: "Shown to you: the fence square and a leaf card at the four distances, before and after, taken by
// the check run from the renderer's own frames, are attached to the PR and shown to you in the session. Whether they
// look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above
// reads a picture to judge it"
//
// This test judges no picture. One run a binary draws two frames (helpers: `cardsDoc`): the fence, and a leaf card
// (./chains.ts `leaf`), each four times side by side at AC3's distances, 256, 128, 64 and 32 px across. The merge base's
// frames are `fence-before.png` and `leaf-before.png`, this checkout's `fence-after.png` and `leaf-after.png`, each the
// renderer's own final target copied byte for byte to `target/acceptance/3257/`, its SHA-256 printed. The pairs must
// differ (else they don't show the change). It then reads the record (README: The taste call),
// `tests/acceptance/3257/TASTE.json`: none, or a call made on other pictures (another SHA-256), is INCONCLUSIVE;
// `looks_wrong` fails; `looks_right` on exactly these passes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TIMEOUT, inconclusive, runGpu, sha256, useDir, useGpu, type JsonValue } from '../1634/helpers.ts';
import { fence, leaf } from './chains.ts';
import { AC, PICTURE, cardsDoc, drawCall, frameOf, onReferenceMac, useBase, writeMap } from './helpers.ts';

const bin = useGpu();
const base = useBase();
const dir = useDir();
const SHOTS = join(REPO, 'target', 'acceptance', '3257');
const TASTE = join(REPO, 'tests', 'acceptance', '3257', 'TASTE.json');
const CARDS = ['fence', 'leaf'] as const;
const NAMES = CARDS.flatMap((c) => [`${c}-before.png`, `${c}-after.png`]);

/** Both cards drawn by one binary: the final target's PNG by card. */
function draw(binary: string, when: 'before' | 'after'): Buffer[] {
  const out = dir();
  const maps = [writeMap(out, 'fence-map', fence()), writeMap(out, 'leaf-map', leaf())];
  const replies = runGpu(binary, out, CARDS.map((c, i) => drawCall(out, `${c}-${when}`, cardsDoc(`${c}-cards`, maps[i]!.sha), [maps[i]!], ['final'])));
  return replies.map((r, i) => frameOf(out, r, PICTURE, `the ${CARDS[i]!} cards, ${when}`).final!);
}

describe(`${AC[8]} the pictures and the one taste call on them`, () => {
  it(`${AC[8]} the run draws the fence and the leaf card at the four distances before and after, and the recorded call on exactly those says they look right`, () => {
    onReferenceMac();
    const [before, after] = [draw(base(), 'before'), draw(bin(), 'after')];
    const pictures = new Map(CARDS.flatMap((c, i) => [[`${c}-before.png`, before[i]!], [`${c}-after.png`, after[i]!]] as [string, Buffer][]));
    mkdirSync(SHOTS, { recursive: true });
    for (const [name, png] of pictures) writeFileSync(join(SHOTS, name), png);
    const hashes = Object.fromEntries([...pictures].map(([n, png]) => [n, sha256(png)]));
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '3257', n)}  ${hashes[n]}`).join('\n');
    console.log(`${AC[8]}: pictures copied from the two runs' final targets:\n${listed}`);
    expect(CARDS.filter((c) => hashes[`${c}-before.png`] === hashes[`${c}-after.png`]), 'the cards this checkout draws exactly as the merge base does').toEqual([]);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner the pictures\n${listed}\nand record the answer in tests/acceptance/3257/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(3257);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#3257.389c0d78');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four pictures').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the pictures don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${AC[8]}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, TIMEOUT);
});
