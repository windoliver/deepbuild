// #399.93b00910, blind redraft: Shown to you: screenshots of the 40-node layered graph before and after a node is added,
// the placed labels and the six cards in two groups, taken by the check run from the canvas's own frames, are attached
// to the PR and shown to you in the session. Whether they look right is one taste call, recorded; without it the run
// stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it.
//
// Written from the issue, the design (Dogfooding) and the base, with the suite's README and helpers as its surfaces.
// The run draws four documents with `deep-canvas-render raster` (the canvas's own frames, as the README's taste call
// names them): the 40-node layered graph with its memory (before), the same with n41 added (after), the crowd's
// labels around a status mark, and the six cards in groups Build and Ship. It copies the PNGs raster wrote, byte for
// byte, to `target/acceptance/399/` and prints each one's SHA-256. It then reads the owner's call,
// `tests/acceptance/399/TASTE.json`: no file, or a call on other SHA-256s, is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly this run's pictures passes. The only checks on the pictures are that each is the document's
// size, carries ink and that before and after differ, so the call is never made on a blank or unchanged frame; no
// picture is judged here.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO, TIMEOUT, arr, cardsDoc, crowdDoc, graph40Doc, inconclusive, inked, isObject, lines, num, obj, readPng, sha256, show,
  useBins, useTemp, type JsonObject, type JsonValue,
} from '../helpers.ts';

const ID = '#399.93b00910';
const SHOTS = join(REPO, 'target', 'acceptance', '399');
const TASTE = join(REPO, 'tests', 'acceptance', '399', 'TASTE.json');
/** The crowd's status mark source, as `statusMark` in helpers.ts binds it; raster needs its state pinned. */
const CROWD_VERDICT = 'verdict:01JB3990000000000000000001';

const NAMES = ['graph-before.png', 'graph-after.png', 'labels.png', 'cards-groups.png'] as const;
type Name = (typeof NAMES)[number];

const bin = useBins(['deep-canvas-render']);
const temp = useTemp('taste-redraft');

/** Draws the four documents in one raster process, copies its PNGs to target/acceptance/399/, and returns their SHA-256s. */
function screenshots(): Record<Name, string> {
  const render = bin('deep-canvas-render');
  const docs: Record<Name, JsonObject> = {
    'graph-before.png': graph40Doc(false),
    'graph-after.png': graph40Doc(true),
    'labels.png': crowdDoc(),
    'cards-groups.png': cardsDoc(),
  };
  const inputs = NAMES.map((name) => ({
    out: join(temp(), name), doc: docs[name], look: 'clean', t: 0,
    ...(name === 'labels.png' ? { states: { [CROWD_VERDICT]: 'pass' } } : {}),
  }));
  const answers = lines(render, ['raster'], inputs);
  mkdirSync(SHOTS, { recursive: true });
  const hashes = {} as Record<Name, string>;
  NAMES.forEach((name, i) => {
    expect(answers[i]!['ok'], `raster draws ${name}: ${show(answers[i], 2500)}`).toBe(true);
    const size = arr(docs[name]['size'], `${name}: doc.size`).map((v) => num(v, `${name}: doc.size`));
    const image = readPng(inputs[i]!.out);
    expect([image.width, image.height], `${name}: the PNG is the document's size`).toEqual(size);
    expect(inked(image), `${name}: the frame carries ink beside its ground`).toBeGreaterThan(0);
    copyFileSync(inputs[i]!.out, join(SHOTS, name));
    hashes[name] = sha256(readFileSync(join(SHOTS, name)));
  });
  expect(hashes['graph-after.png'], 'the graph after n41 is added is not the same frame as before').not.toBe(hashes['graph-before.png']);
  return hashes;
}

describe(`${ID} the screenshots and the one taste call on them (blind redraft)`, () => {
  it(`${ID} the run draws the 40-node graph before and after n41, the crowd's placed labels and the six grouped cards, and the owner's call recorded on exactly those says they look right`, () => {
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '399', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots raster wrote in this run:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner in the session\n${listed}\nand record the answer in tests/acceptance/399/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const call = obj(parsed, 'TASTE.json');
    expect(call['issue'], 'TASTE.json: issue').toBe(399);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    const who = call['who'];
    expect(typeof who === 'string' && who.trim() !== '', 'TASTE.json: who made the call').toBe(true);
    const when = call['when'];
    expect(typeof when === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(when) && !Number.isNaN(Date.parse(when)), `TASTE.json: when, an ISO 8601 time, got ${show(when)}`).toBe(true);
    expect(isObject(call['screenshots']), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = call['screenshots'] as JsonObject;
    expect(Object.keys(recorded).sort(), 'TASTE.json names exactly the four screenshots').toEqual([...NAMES].sort());

    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(who)}, ${String(when)}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${show(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(who)}, ${String(when)}) says these don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(who)} at ${String(when)} on these pictures: looks right`);
  }, TIMEOUT);
});
