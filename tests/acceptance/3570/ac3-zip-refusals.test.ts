// AC3 (#3570.090eb211): "Each refused with nothing written, naming what it refuses: an encrypted zip, a member inside a
// second zip, a member at `../x.csv`, and a 3 MB member that inflates to 3 GiB, stopped when the stream passes
// `max_bytes`"
// Each zip is `fixtures.ts`'s, fetched through the Source block. Every member but the bomb's is a valid small table the
// import's params read, so a reader that overlooks the defect writes a table. The bomb's member is a header row and
// line ends to 3 GiB, deflated to about 3 MB, its headers stating the deflated size as its unpacked one: only a count on
// the inflating stream finds it past `max_bytes` (2 GiB, the default). The Scope's fifth refusal, a path the archive
// holds twice, is a test of its own.
import { beforeAll, describe, expect, it } from 'vitest';
import { bombZip, dotdotZip, encryptedZip, nestedZip, twiceZip } from './fixtures.ts';
import { AC, TIMEOUT, fetchAll, kept, openWorld, refusalOf, runTable, show, smallParams, type Fetched, type World } from './helpers.ts';

let w: World | string;
beforeAll(async () => { w = await openWorld(); }, TIMEOUT);
const must = <T>(v: T | string, what: string): T => { expect(typeof v === 'string' ? v : '', what).toBe(''); return v as T; };

/** One import of a member that must be refused with nothing written, its reason holding every name in `names`: what is wrong, in words. */
async function refusedNaming(world: World, file: Fetched, member: string, names: RegExp[], what: string): Promise<string[]> {
  const before = kept(world);
  const ran = await runTable(world, smallParams({}, { member }), file.sha256);
  if (typeof ran === 'string') return [`${what}: ${ran}`];
  const r = refusalOf(ran.outcome);
  const out: string[] = [];
  if (!r.refused) out.push(`${what}: the import of ${member} isn't refused: ${ran.outcome.text.slice(0, 500)}`);
  if (r.outputs) out.push(`${what}: the refusal returns outputs: ${show(ran.outcome.value['outputs'], 300)}`);
  for (const n of names) if (!n.test(r.reason)) out.push(`${what}: the reason doesn't name ${String(n)}: ${JSON.stringify(r.reason.slice(0, 500))}`);
  const after = kept(world);
  const added = after.filter((f) => !before.includes(f));
  if (added.length) out.push(`${what}: the refused import wrote ${added.join(', ')} to the evidence store`);
  return out;
}

describe(`${AC[3]} an encrypted zip, a member in a second zip, ../x.csv and a member past max_bytes as it inflates: each refused by name with nothing written`, () => {
  it('refuses each, naming it, and writes nothing', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const bomb = bombZip();
    expect(bomb.deflated, 'the member is about 3 MB in the archive').toBeLessThan(4e6);
    const fetched = must(await fetchAll(world, { 'encrypted.zip': encryptedZip(), 'nested.zip': nestedZip(), 'dotdot.zip': dotdotZip(), 'bomb.zip': bomb.bytes }), 'the zips fetched once through the Source block');
    const failures = [
      ...await refusedNaming(world, fetched['encrypted.zip']!, 'county.csv', [/encrypt/i], 'the encrypted zip'),
      ...await refusedNaming(world, fetched['nested.zip']!, 'inner.zip/county.csv', [/inner\.zip/], 'the member inside a second zip'),
      ...await refusedNaming(world, fetched['dotdot.zip']!, '../x.csv', [/\.\.\/x\.csv/], 'the member at ../x.csv'),
      ...await refusedNaming(world, fetched['bomb.zip']!, bomb.member, [/big\.csv/, /max_bytes|2147483648|2 ?GiB/i], 'the 3 MB member that inflates to 3 GiB'),
    ];
    expect(failures, 'each refusal').toEqual([]);
  }, TIMEOUT);

  it('Scope: a path the archive holds twice is refused by name with nothing written', async () => {
    const world = must(w, 'a hub with the import kind\'s table tool');
    const fetched = must(await fetchAll(world, { 'twice.zip': twiceZip() }), 'the zip fetched once through the Source block');
    expect(await refusedNaming(world, fetched['twice.zip']!, 'county.csv', [/county\.csv/], 'the path held twice')).toEqual([]);
  }, TIMEOUT);
});
