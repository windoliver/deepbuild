// #23.2395159c 'Use tabs or spaces here?' and 'Should this file indent with tabs?', pinned to one requirement,
// share one key and the second is decided for you; the same wording pinned to another requirement reaches you.
// The design's key fixture file: for each kind, pairs that must share a key and near-misses that must not; the
// resolver runs on it. These tests run it on the design's own examples (BLIND_PAIRS, written here from the design
// alone) and on the fixture file the package ships, packages/resolver-decisions/fixtures/keys.json.

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { inWorld } from './helpers.ts';
import { BLIND_PAIRS, runPair, tabsPair, type KeyPair, type PairKind } from './scenarios.ts';

test('#23.2395159c \'Use tabs or spaces here?\' and \'Should this file indent with tabs?\', pinned to one requirement, share one key and the second is decided for you; the same wording pinned to another requirement reaches you', async () => {
  await inWorld(tabsPair);
});

for (const pair of BLIND_PAIRS) {
  test(`#23.2395159c key pairs: ${pair.kind}, ${pair.why}: ${pair.same ? 'share a key and the second is decided for you' : 'a near-miss with a key of its own, which reaches you'}`, async () => {
    await inWorld((w) => runPair(w, pair));
  });
}

const FIXTURE = new URL('../../../../packages/resolver-decisions/fixtures/keys.json', import.meta.url);
const KINDS: PairKind[] = ['authority', 'taste', 'choice', 'definition'];

test('#23.2395159c the key fixture file holds, for each kind, pairs that must share a key and near-misses that must not, and the resolver passes every one', async () => {
  const pairs = JSON.parse(readFileSync(FIXTURE, 'utf8')) as KeyPair[];
  expect(Array.isArray(pairs), 'packages/resolver-decisions/fixtures/keys.json is a list of pairs').toBe(true);
  for (const kind of KINDS) {
    expect(pairs.filter((p) => p.kind === kind).map((p) => p.same).sort(), `the fixture file holds ${kind} pairs that share a key and near-misses that don't`)
      .toEqual(expect.arrayContaining([false, true]));
  }
  for (const pair of pairs) await inWorld((w) => runPair(w, pair));
}, 300_000);
