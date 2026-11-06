// #1175 AC3: "Shown to you: screenshots of `elements.svg` drawn by the canvas beside Chrome's render, and a MathJax
// formula with a clip, taken by the check run from the renderer's own output, are attached to the PR and shown to you
// in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it."
//
// The run draws elements.svg (240 × 160) and fixtures/mathjax-clip.svg (940 × 180) through `deep-canvas-render raster`
// and through the pinned Chrome at the same sizes, and writes four screenshots of those pixels to
// `target/acceptance/1175/` (README: The taste call), printing each one's SHA-256. It then reads the owner's recorded
// call, `tests/acceptance/1175/TASTE.json`: none, or one made on other pictures (another SHA-256), is INCONCLUSIVE;
// "looks wrong" fails; "looks right" on exactly these pictures passes. No other test reads these pictures or the call.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ELEMENTS_SVG, MATHJAX_SVG, REPO, chromeRender, drawn, elementsDoc, encodePng, inconclusive, inked, mathjaxDoc, scratch,
  sha256, sideBySide, useRenderBinary, type Image, type JsonValue,
} from './helpers.ts';

useRenderBinary();
const dir = scratch('taste');

/** Where the run writes the screenshots (under the checkout's ignored `target/`). */
const SHOTS = join(REPO, 'target', 'acceptance', '1175');
/** Where the owner's taste call is recorded (README: The taste call). */
const TASTE = join(REPO, 'tests', 'acceptance', '1175', 'TASTE.json');
const NAMES = ['elements-canvas.png', 'elements-canvas-chrome-x3.png', 'mathjax-clip-canvas.png', 'mathjax-clip-canvas-chrome-x2.png'] as const;

/** The four screenshots, written from this run's pixels; their SHA-256 by name. */
function screenshots(): Record<string, string> {
  const elements = drawn(dir, elementsDoc(dir), 'elements.svg at 240 × 160');
  const formula = drawn(dir, mathjaxDoc(dir), 'the MathJax formula with a clip at 940 × 180');
  // The pictures show something: a blank render is not put in front of the owner.
  expect(inked(elements), 'the canvas draws elements.svg').toBeGreaterThan(1000);
  expect(inked(formula), 'the canvas draws the formula').toBeGreaterThan(5000);
  const elementsChrome = chromeRender(dir, ELEMENTS_SVG, [240, 160], 'elements');
  const formulaChrome = chromeRender(dir, MATHJAX_SVG, [940, 180], 'mathjax-clip');
  const shots: Record<(typeof NAMES)[number], Image> = {
    'elements-canvas.png': elements,
    'elements-canvas-chrome-x3.png': sideBySide([elements, elementsChrome], 3),
    'mathjax-clip-canvas.png': formula,
    'mathjax-clip-canvas-chrome-x2.png': sideBySide([formula, formulaChrome], 2),
  };
  mkdirSync(SHOTS, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const name of NAMES) {
    const png = encodePng(shots[name]);
    writeFileSync(join(SHOTS, name), png);
    hashes[name] = sha256(png);
  }
  return hashes;
}

describe('#1175 AC3 the screenshots and the one taste call on them', () => {
  it('AC3 the run writes elements.svg by the canvas beside Chrome\'s render and the MathJax formula with a clip, and the owner\'s recorded call on exactly those says they look right', () => {
    const hashes = screenshots();
    const listed = NAMES.map((n) => `  ${join('target', 'acceptance', '1175', n)}  ${hashes[n]}`).join('\n');
    console.log(`#1175 AC3: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner the screenshots\n${listed}\nand record the answer in tests/acceptance/1175/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof call === 'object' && call !== null && !Array.isArray(call), 'TASTE.json is an object').toBe(true);
    const c = call as Record<string, JsonValue>;
    expect(c['issue'], 'TASTE.json: issue').toBe(1175);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('AC3');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(c['when']) && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = c['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json names the four screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says the pictures don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`#1175 AC3: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  }, 1_800_000);
});
