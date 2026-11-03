// #399.93b00910: Shown to you: screenshots of the 40-node layered graph before and after a node is added, the placed
// labels and the six cards in two groups, taken by the check run from the canvas's own frames, are attached to the PR
// and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// The run draws the four documents with `deep-canvas-render raster` (the canvas's own frames, Vello CPU) and copies the
// PNGs it wrote to `target/acceptance/399/`, printing each one's SHA-256. It then reads the owner's recorded call,
// `tests/acceptance/399/TASTE.json`: none, or one made on other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right`
// on exactly these pictures passes. No other test reads these pictures or the call.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, accepted, cardsDoc, cleanLook, crowdDoc, graph40Doc, inconclusive, inked, readPng, sha256, useBins, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = '#399.93b00910';
const SHOTS = join(REPO, 'target', 'acceptance', '399');
const TASTE = join(REPO, 'tests', 'acceptance', '399', 'TASTE.json');
const render = useBins(['deep-canvas-render']);
const temp = useTemp('taste');

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the 40-node graph before and after, the placed labels and the six cards in two groups, and the owner's recorded call on exactly those says they look right`, () => {
    const look = cleanLook(render('deep-canvas-render'));
    const docs: Record<string, JsonObject> = {
      'graph-before.png': graph40Doc(false), 'graph-after.png': graph40Doc(true), 'labels.png': crowdDoc(), 'cards-groups.png': cardsDoc(),
    };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const [name, doc] of Object.entries(docs)) {
      const out = join(temp(), name);
      accepted(render('deep-canvas-render'), ['raster'], { out, doc, look, t: 0 }, `raster ${name}`);
      expect(inked(readPng(out)), `${name} shows something`).toBeGreaterThan(1000);
      copyFileSync(out, join(SHOTS, name));
      hashes[name] = sha256(readFileSync(out));
    }
    const names = Object.keys(docs);
    const listed = names.map((n) => `  ${join('target', 'acceptance', '399', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's frames:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner the screenshots\n${listed}\nand record the answer in tests/acceptance/399/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect([c['issue'], c['criterion']], 'TASTE.json: issue and criterion').toEqual([399, ID]);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four screenshots').toEqual([...names].sort());
    const other = names.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the pictures don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  });
});
