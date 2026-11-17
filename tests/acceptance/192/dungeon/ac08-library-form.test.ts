// AC8 #192.b641f8a3: "A dungeon generator with a library form makes floor 40 in play, inside a logic item sliced across
// steps, with the same bytes the provider writes for floor 40 at check; and a planted library form that seeds from
// the step instead of the given seed fails the pack's equality fixture, naming the provider and the first byte that
// differs"
//
// test/dungeon@1.0.0's provider dungeon.floor ships `library`: the same source built as a logic library (programs.ts:
// the dungeon generator's library form, one share of a floor's work per call), with the equality fixture {seed A,
// params floor 40, height 40, width 40, expect: the sha256 of the bytes the provider program writes for them}. The
// planted pack test/dungeonplant@1.0.0 is the same but for its library form, which seeds each share from its step (the
// share's number) instead of the seed it is given. In one deep-show process:
//   - dungeonplant is refused at install, an issue naming the provider dungeonplant.floor and the offset of the first
//     byte where its library form's output differs from the provider's (worked out here by running both programs in
//     Node's WebAssembly); dungeon installs.
//   - A board of seed A holds `atcheck`, a logic item naming {gen: dungeon.floor, params: floor 40} among its data
//     assets, so the provider writes floor 40 at check, and `maker`, a logic item linking the library form as
//     dungeon.floor@1.0.0 that calls gen(seed A, its params: floor 40, its output) once a step and writes `floor`: the
//     shares left, then its output region. deep_query's logic read of steps 0 to 23: no trap; floor 40 isn't whole at
//     step 0 (shares left), and at the first step where none is left (a later step: the floor was made across steps,
//     each under the item's step budget, which the whole floor's work passes) its bytes are the asset `provided` holds
//     for atcheck, which are the provider program's bytes.
//
// Wrong programs it fails on: an equality fixture that doesn't run the library form, or doesn't compare its bytes
// (dungeonplant installs), a refusal that names no provider or another byte, a library form that can't be linked or
// run across steps in a logic item, and a library form whose floor isn't the provider's.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC, dataOf, firstDiff, holds, installPack, intParams, issuesOf, libraryInNode, logicRead, onMacOS, presented, provided, providedInNode,
  providedRow, putEvidence, queryLogic, runShow, scenario, sha256, show, showDoc, useTemp, wordsToBytes,
} from './helpers.ts';
import { FLOOR_40, SEED_A, board, dungeonPack, logicItem, program, readerItem } from './fixtures.ts';
import { MAKER } from './programs.ts';

const ID = '#192.b641f8a3';
const TIMEOUT = 90 * 60_000;
const STEPS = Array.from({ length: 24 }, (_, k) => k);
const dir = useTemp();

describe(`${ID} the library form: floor 40 in play equals floor 40 at check`, () => {
  it(`${ID} floor 40 made in play by a logic item sliced across steps has the provider's bytes; a library form seeding from the step fails the pack's equality fixture, naming the provider and the first byte that differs`, () => {
    onMacOS();
    const root = dir();
    const evidence = join(root, 'evidence');
    mkdirSync(evidence, { recursive: true });
    // What each program itself gives for seed A and floor 40, in Node's WebAssembly.
    const params = intParams(FLOOR_40);
    const atCheck = providedInNode(program.dungeon(), BigInt(SEED_A), params);
    expect(libraryInNode(program.libraryModule(), BigInt(SEED_A), params).equals(atCheck), 'this suite\'s library form gives its provider\'s bytes (a fixture fault, not the implementation\'s)').toBe(true);
    const offset = firstDiff(atCheck, libraryInNode(program.plantedModule(), BigInt(SEED_A), params));
    expect(offset, 'this suite\'s planted library form gives other bytes (a fixture fault, not the implementation\'s)').toBeGreaterThanOrEqual(0);

    const fixture = { seed: SEED_A, params: FLOOR_40, expect: sha256(atCheck) };
    const pack = dungeonPack(root, 'dungeon', { asset: program.library(), fixture });
    const plant = dungeonPack(root, 'dungeonplant', { asset: program.planted(), fixture });
    const maker = program.maker('dungeon.floor', SEED_A, FLOOR_40);
    putEvidence(evidence, program.reader().bytes);
    putEvidence(evidence, maker.bytes);
    const doc = DOC(1);
    const r = runShow(scenario(evidence, [doc], [
      installPack(pack), installPack(plant),
      showDoc(doc, board('Floor 40', SEED_A, [pack], {
        atcheck: readerItem('dungeon', FLOOR_40),
        maker: logicItem(maker, { floor: { type: 'i32', count: MAKER.floor } }, { links: [{ name: 'dungeon.floor@1.0.0', asset: program.library().sha }] }),
      }, ['logic'])),
      provided(doc), queryLogic(doc, ['maker'], STEPS),
    ]));

    // The planted library form: refused at install by the equality fixture, naming the provider and the byte.
    expect(r[1]!['outcome'], `test/dungeonplant@1.0.0, whose library form seeds from the step, fails its equality fixture: ${show(r[1], 3000)}`).toBe('refused');
    const naming = issuesOf(r[1]!, 'test/dungeonplant@1.0.0').filter((i) => holds(i.raw, 'provider', 'dungeonplant.floor') && holds(i.raw, 'offset', offset));
    expect(naming.length, `test/dungeonplant@1.0.0's refusal names the provider dungeonplant.floor and the first byte that differs, ${offset}: ${show(r[1], 3000)}`).toBeGreaterThan(0);

    // The honest library form: installed, linked, and floor 40 made across steps with the provider's bytes.
    expect(r[0]!['outcome'], `test/dungeon@1.0.0 installs, its library form passing its equality fixture: ${show(r[0], 3000)}`).toBe('installed');
    presented(r[2]!, 'the floor 40 board');
    const asset = dataOf(providedRow(r[3]!, 'atcheck', 'provided'), 'atcheck\'s floor 40');
    expect(asset.asset, 'the provider writes floor 40 at check: the provider program\'s bytes').toBe(sha256(atCheck));
    const read = logicRead(r[4]!, 'maker', 'deep_query\'s logic read of maker');
    expect(read.trap, `maker runs the library form in play without a trap: ${show(read.trap)}`).toBeNull();
    const floorAt = (k: number): number[] => read.steps.get(k)?.arrays['maker.floor'] ?? [];
    expect(floorAt(0)[0], `floor 40 isn't whole after step 0: shares are left (maker.floor at step 0: ${JSON.stringify(floorAt(0).slice(0, 4))})`).toBeGreaterThan(0);
    const whole = STEPS.find((k) => floorAt(k).length === MAKER.floor && floorAt(k)[0] === 0);
    expect(whole, `floor 40 is whole by step ${STEPS.length - 1} (shares left by step: ${STEPS.map((k) => floorAt(k)[0]).join(', ')})`).toBeDefined();
    const out = wordsToBytes(floorAt(whole!).slice(1));
    const made = out.subarray(4, 4 + out.readUInt32LE(0));
    expect(sha256(made), `floor 40 made in play (whole at step ${whole}) has the bytes the provider wrote at check (first byte that differs: ${firstDiff(made, atCheck)})`).toBe(asset.asset);
  }, TIMEOUT);
});
