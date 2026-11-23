// #416.4afd3a43: "An nn.weights asset in a pack's layout whose validator refuses NaN, with a NaN at byte 4,096, is
// refused wherever it's named, in a logic item's assets and in a provider's out: data, naming the asset, the layout and
// offset 4,096; the same file without the NaN passes; and a planted validator that accepts its own truncated twin makes
// its pack refused, naming the twin"
//
// The pack test/nnweights@1.0.0 declares the layout nnweights.nn.weights@1 (README: The nn.weights layout), whose
// validator refuses a NaN at its first byte, and the provider nnweights.weights, whose out is data in that layout and
// which writes the same 8,200 bytes as the criterion's file, with the NaN at byte 4,096 when its param `nan` is true. In
// one deep-show process: the pack installs; test/nnplanted@1.0.0, the same layout and twins under the validator without
// its count check, is refused naming its truncated twin; a board whose logic item names the file with the NaN by hash
// (its envelope asset naming the layout) is refused at the asset's place, naming the asset, the layout and offset 4,096,
// and so is a board whose logic item names the provider's output; the same two boards with the file without the NaN are
// presented; `validate` refuses the one file at 4,096 and admits the other.
//
// Wrong programs it fails on: a logic item's data asset never validated (the base: its board is presented), a refusal
// that doesn't name the asset, the layout or the offset, a layout that refuses the good file or an envelope that refuses
// a data asset's `layout`, a provider's output not validated, a pack check that doesn't run its validator on its twins,
// and a pack refusal that doesn't name the twin its validator accepted.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC, TIMEOUT, deepShow, errorsOf, holds, installPack, presented, putEvidence, runShow, scenario, sha256, show, showDoc, sub, useTemp, validate,
  type JsonObject,
} from './helpers.ts';
import {
  GOOD, LAYOUT, NAN_AT, PROVIDER, TWIN_NAN, TWIN_TRUNCATED, WITH_NAN, board, checkFixtures, dataAsset, plantedPack, program, readerItem, weightsPack,
} from './fixtures.ts';

const ID = '#416.4afd3a43';
const temp = useTemp();
/** Where a refusal at the logic item's first data asset is (README: A data asset's layout). */
const PLACE = 'items/reader/params/assets/0';

describe(`${ID} an nn.weights asset with a NaN at byte 4,096 is refused wherever it's named`, () => {
  it(`${ID} refused in a logic item's assets and in a provider's out: data, naming the asset, the layout and offset 4,096; the same file without the NaN passes; a validator that accepts its truncated twin gets its pack refused, naming the twin`, () => {
    checkFixtures();
    const root = temp();
    const evidence = sub(root, 'evidence');
    const pack = weightsPack(sub(root, 'packs'));
    const plant = plantedPack(sub(root, 'packs'));
    for (const b of [program.reader().bytes, GOOD, WITH_NAN]) putEvidence(evidence, b);
    const files = sub(root, 'files');
    const path = { good: join(files, 'good.nnw'), nan: join(files, 'nan.nnw') };
    writeFileSync(path.good, GOOD);
    writeFileSync(path.nan, WITH_NAN);
    const sha = { good: sha256(GOOD), nan: sha256(WITH_NAN), truncated: sha256(TWIN_TRUNCATED), nanTwin: sha256(TWIN_NAN) };

    const pinned: JsonObject = { packs: [`${pack.id}@${pack.version}`] };
    /** The logic item names the file by hash; the envelope's data asset names its layout. */
    const byHash = (bytes: Buffer): JsonObject => board('Weights by hash', { reader: readerItem([sha256(bytes)]) }, { ...pinned, assets: { weights: dataAsset(bytes, LAYOUT) } });
    /** The logic item names the provider's output, data in the layout (#192's provider use). */
    const fromProvider = (nan: boolean): JsonObject => board('Weights from a provider', { reader: readerItem([{ gen: PROVIDER, params: { nan } }]) }, pinned);
    const docs = [DOC(1), DOC(2), DOC(3), DOC(4)] as const;
    const [installed, refusedPack, nanByHash, nanFromProvider, goodByHash, goodFromProvider, nanValidated, goodValidated] = runShow(deepShow(), scenario(evidence, [...docs], [
      installPack(pack), installPack(plant),
      showDoc(docs[0], byHash(WITH_NAN)), showDoc(docs[1], fromProvider(true)),
      showDoc(docs[2], byHash(GOOD)), showDoc(docs[3], fromProvider(false)),
      validate(LAYOUT, path.nan), validate(LAYOUT, path.good),
    ]));

    expect(installed!['outcome'], `test/nnweights@1.0.0 installs: its validator refuses both twins: ${show(installed)}`).toBe('installed');
    expect(refusedPack!['outcome'], `test/nnplanted@1.0.0, whose validator accepts its own truncated twin, is refused: ${show(refusedPack)}`).toBe('refused');
    expect(holds(refusedPack!['issues'], 'twin', sha.truncated), `its refusal names the truncated twin ${sha.truncated} (README: Naming): ${show(refusedPack!['issues'])}`).toBe(true);
    expect(holds(refusedPack!['issues'], 'twin', sha.nanTwin), `its refusal doesn't name the NaN twin, which that validator refuses: ${show(refusedPack!['issues'])}`).toBe(false);

    for (const [reply, what] of [[nanByHash!, 'the board whose logic item names the file with the NaN'], [nanFromProvider!, 'the board whose logic item names the provider\'s output with the NaN']] as const) {
      const errors = errorsOf(reply, what);
      const named = errors.filter((e) => e.code === 'layout_refused' && e.path === PLACE && holds(e.raw, 'asset', sha.nan) && holds(e.raw, 'layout', LAYOUT) && holds(e.raw, 'offset', NAN_AT));
      expect(named.length, `${what} is refused at ${PLACE} with layout_refused, naming the asset ${sha.nan}, the layout ${LAYOUT} and offset ${NAN_AT}; its errors: ${show(errors.map((e) => e.raw), 3000)}`).toBeGreaterThan(0);
      expect(reply['outcome'], `${what} is refused: ${show(reply, 2000)}`).toBe('refused');
    }
    presented(goodByHash!, 'the board whose logic item names the file without the NaN');
    presented(goodFromProvider!, 'the board whose logic item names the provider\'s output without the NaN');

    expect({ outcome: nanValidated!['outcome'], code: nanValidated!['code'], asset: nanValidated!['asset'], layout: nanValidated!['layout'], offset: nanValidated!['offset'] },
      `validate refuses the file with the NaN at byte 4,096: ${show(nanValidated)}`)
      .toEqual({ outcome: 'refused', code: 'layout_refused', asset: sha.nan, layout: LAYOUT, offset: NAN_AT });
    expect({ outcome: goodValidated!['outcome'], asset: goodValidated!['asset'] }, `validate admits the same file without the NaN: ${show(goodValidated)}`)
      .toEqual({ outcome: 'admitted', asset: sha.good });
  }, TIMEOUT);
});
