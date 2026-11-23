// #1826.a4284c92: Shown to you: screenshots of the 7-node tree, the 4-leaf treemap and the 10-node grid, taken by the
// check run from the canvas's own frames, are attached to the PR and shown to you in the session. Whether they look
// right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a
// picture to judge it
//
// The run draws three documents, each one graph@1 item, with `deep-canvas-render raster` (the canvas's own frames, as
// #399's taste call takes them): the 7-node tree (`tree`, with its edges), the 4-leaf treemap (`treemap`, box
// [20, 20, 400, 200]) and the 10-node grid (`grid`). It copies the PNGs raster wrote, byte for byte, to
// `target/acceptance/1826/` and prints each one's SHA-256. It then reads the owner's call,
// `tests/acceptance/1826/TASTE.json`: no file, or a call on other SHA-256s, is INCONCLUSIVE; `looks_wrong` fails;
// `looks_right` on exactly this run's pictures passes. The only checks on the pictures are that each is its document's
// size and carries ink, so the call is never made on a blank frame; no picture is judged here.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRID_LAYOUT, GRID_NODES, REPO, TIMEOUT, TREEMAP_LAYOUT, TREEMAP_NODES, TREE_EDGES, TREE_LAYOUT, TREE_NODES, graphDoc, inconclusive,
  inked, isObject, lines, obj, readPng, sha256, show, useBins, useTemp, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = '#1826.a4284c92';
const SHOTS = join(REPO, 'target', 'acceptance', '1826');
const TASTE = join(REPO, 'tests', 'acceptance', '1826', 'TASTE.json');
const NAMES = ['tree.png', 'treemap.png', 'grid.png'] as const;
type Name = (typeof NAMES)[number];

const bin = useBins(['deep-canvas-render']);
const temp = useTemp('taste');

const DOCS: Record<Name, JsonObject> = {
  'tree.png': graphDoc('tree-7', 'A binary tree of seven steps', 'Seven steps laid out as a tree, each parent over its two children.', [360, 240],
    { nodes: TREE_NODES, edges: TREE_EDGES }, TREE_LAYOUT),
  'treemap.png': graphDoc('treemap-4', 'Four leaves by size', 'Four leaves sized one, one, two and four, tiling one box.', [440, 240],
    { nodes: TREEMAP_NODES, edges: [] }, { ...TREEMAP_LAYOUT, box: [20, 20, 400, 200] }),
  'grid.png': graphDoc('grid-10', 'Ten steps in a grid', 'Ten steps in rows of four, by ID.', [300, 180],
    { nodes: GRID_NODES, edges: [] }, GRID_LAYOUT),
};

/** Draws the three documents in one raster process, copies its PNGs to target/acceptance/1826/, and returns their SHA-256s. */
function screenshots(): Record<Name, string> {
  const inputs = NAMES.map((name) => ({ out: join(temp(), name), doc: DOCS[name], look: 'clean', t: 0 }));
  const answers = lines(bin('deep-canvas-render'), ['raster'], inputs);
  const hashes = {} as Record<Name, string>;
  NAMES.forEach((name, i) => {
    expect(answers[i]!['ok'], `raster draws ${name}: ${show(answers[i], 2500)}`).toBe(true);
    const image = readPng(inputs[i]!.out);
    expect([image.width, image.height], `${name}: the PNG is the document's size`).toEqual(DOCS[name]['size']);
    expect(inked(image), `${name}: the frame carries ink beside its ground`).toBeGreaterThan(0);
  });
  mkdirSync(SHOTS, { recursive: true });
  NAMES.forEach((name, i) => {
    copyFileSync(inputs[i]!.out, join(SHOTS, name));
    hashes[name] = sha256(readFileSync(join(SHOTS, name)));
  });
  return hashes;
}

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run draws the 7-node tree, the 4-leaf treemap and the 10-node grid from the canvas's own frames, and the owner's call recorded on exactly those says they look right`, () => {
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '1826', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots raster wrote in this run:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner in the session\n${listed}\nand record the answer in tests/acceptance/1826/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const call = obj(parsed, 'TASTE.json');
    expect(call['issue'], 'TASTE.json: issue').toBe(1826);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(ID);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    const who = call['who'];
    expect(typeof who === 'string' && who.trim() !== '', 'TASTE.json: who made the call').toBe(true);
    const when = call['when'];
    expect(typeof when === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(when) && !Number.isNaN(Date.parse(when)), `TASTE.json: when, an ISO 8601 time, got ${show(when)}`).toBe(true);
    expect(isObject(call['screenshots']), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = call['screenshots'] as JsonObject;
    expect(Object.keys(recorded).sort(), 'TASTE.json names exactly the three screenshots').toEqual([...NAMES].sort());

    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(who)}, ${String(when)}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${show(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(who)}, ${String(when)}) says these don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(who)} at ${String(when)} on these pictures: looks right`);
  }, TIMEOUT);
});
