// AC3 (#1820): an asset whose license file reads CC BY-SA, NC or GPL is refused before use, naming its license.
import { beforeAll, describe, expect, it } from 'vitest';
import { A, sha256, PACK_A, PACK_A_VERSION, type Asset } from './pack.ts';
import { asks, doc, fetchA, kinds, newAsks, readyWorld, show, stored, until, yes, type Outcome, type PackWorld } from './helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);

/** The fetch, answering yes if it holds on an ask; its final outcome. */
async function fetched(a: Asset): Promise<Outcome> {
  const before = (await asks(w)).length;
  let o = await kinds(w, fetchA(a));
  if (o.value.status === 'held') {
    const raised = await newAsks(w, before, 'authority');
    if (raised[0]) await yes(w, raised[0]);
    o = await until(w, fetchA(a));
  }
  return o;
}
const refusedNaming = async (a: Asset, naming: RegExp) => {
  const o = await fetched(a);
  expect(o.isError || o.value.status === 'refused', `${a.path}: ${o.text}`).toBe(true);
  expect(o.value.status).not.toBe('fetched');
  expect(o.text, `the refusal of ${a.path} names its license`).toMatch(naming);
  expect(await stored(w, sha256(a.listed)), `${a.path} was kept`).toBeUndefined();
  const used = await show(w, doc('item', sha256(a.listed), `${PACK_A}@${PACK_A_VERSION}`));
  expect(used.reply?.outcome === 'refused' || JSON.stringify(used.reply).includes('BLOCKED') || used.ran.code !== 0, `${a.path} is usable: ${JSON.stringify(used.reply).slice(0, 400)}`).toBe(true);
};

describe('#1820.a489b5cd an asset whose license file reads CC BY-SA, NC or GPL is refused before use, naming its license', () => {
  it('refuses a CC BY-SA asset, naming CC BY-SA', () => refusedNaming(A.sa, /CC[- ]BY[- ]SA/i), 300_000);
  it('refuses a CC BY-NC asset, naming NC', () => refusedNaming(A.nc, /CC[- ]BY[- ]NC|\bNC\b|NonCommercial/i), 300_000);
  it('refuses a GPL asset, naming GPL', () => refusedNaming(A.gpl, /GPL/i), 300_000);
  it('control: a CC0 asset is not refused for its license, so the refusals above are not refuse-everything', async () => {
    const o = await fetched(A.kick);
    expect(o.value.status, o.text).toBe('fetched');
    expect(await stored(w, sha256(A.kick.listed))).toBeDefined();
  }, 300_000);
});
