import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, inconclusive, obj, pngOf, requireMetal, rows, runGpu, sha256, useDir, useGpu, type JsonValue } from '../149/helpers.ts';
import { AC, assetsOf, film2dOf, putPng, toothLook, toothPng, view3dOf } from './scene.ts';

const ID = AC[4];
const bin = useGpu();
const dir = useDir();
const SHOTS = join(REPO, 'docs', 'evidence', '1871');
const TASTE = join(REPO, 'tests', 'acceptance', '1871', 'TASTE.json');
const NAMES = ['tooth-3d.png', 'tooth-2d.png'];

describe(`${ID} the screenshots and the one taste call on them`, () => {
  it(`${ID} the run writes the 3D scene on the image tooth beside #149's 2D page, and the recorded call on exactly those says they look right`, () => {
    requireMetal();
    const out = dir();
    const tooth = putPng(out, 'tooth.png', toothPng());
    const lk = toothLook(tooth.hash);
    const assets = assetsOf(tooth);
    const [scene, page] = runGpu(bin(), out, [view3dOf(out, lk, assets), film2dOf(lk, assets)]);
    const shots: Record<string, Buffer> = {
      'tooth-3d.png': pngOf(out, rows(scene!, 'the 3D scene on the image tooth')[0]!, 'the 3D scene on the image tooth'),
      'tooth-2d.png': pngOf(out, rows(page!, '#149\'s 2D page on the image tooth')[0]!, '#149\'s 2D page on the image tooth'),
    };
    mkdirSync(SHOTS, { recursive: true });
    const hashes: Record<string, string> = {};
    for (const name of NAMES) { writeFileSync(join(SHOTS, name), shots[name]!); hashes[name] = sha256(shots[name]!); }

    const listed = NAMES.map((n) => `  ${join('docs', 'evidence', '1871', n)}  ${hashes[n]}`).join('\n');
    console.log(`${ID}: screenshots written from this run's pixels:\n${listed}`);
    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: show the owner\n${listed}\nand record the answer in tests/acceptance/1871/TASTE.json (README: The taste call)`);
    let call: JsonValue;
    try { call = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    const c = obj(call, 'TASTE.json');
    expect(c['issue'], 'TASTE.json: issue').toBe(1871);
    expect(c['criterion'], 'TASTE.json: criterion').toBe('#1871.f656387e');
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(c['verdict']);
    expect(typeof c['who'] === 'string' && c['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof c['when'] === 'string' && !Number.isNaN(Date.parse(c['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = obj(c['screenshots'], 'TASTE.json: screenshots, by name');
    expect(Object.keys(recorded).sort(), 'TASTE.json names both screenshots').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(c['who'])}, ${String(c['when'])}) was made on other pictures than this run's: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}`);
    if (c['verdict'] === 'looks_wrong') expect.fail(`the owner's taste call (${String(c['who'])}, ${String(c['when'])}) says they don't look right${typeof c['note'] === 'string' ? `: ${c['note']}` : ''}`);
    console.log(`${ID}: taste call recorded by ${String(c['who'])} at ${String(c['when'])}: looks right`);
  });
});
