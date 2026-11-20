// AC10 #194.bdc9544a: "The fixture's items table has a name column of type copy over the copy table items, and cudgel's
// row holds the i32 key 1042; a text item that shows that column through keyed copy, the logic reading the key into an
// array, shows 'Cudgel' in en and 'Gourdin' in fr, as data.copy's items table holds them; a planted packer that writes
// the FNV-1a hash of the key's text in place of 1042 raises copy.missing for that row and fails, naming the row and the
// table"
//
// The fixture packed by `deep-catalog pack`: the record's items.name column is `type: copy`, `copy: items`, and the
// packed row of cudgel holds 1042 there (helpers.ts reads the bytes by the layout's doc). In deep-show (#538's scenario
// and calls), a film whose logic item `shop` names the catalog and reads cudgel's name key into its array `shop.key`
// (programs.ts `keyReader`, by hashes), and whose caption shows `items[shop.key]` over data.copy's items in en and fr:
// `eval` in each locale draws exactly what a caption reading 'Cudgel', and one reading 'Gourdin', draws written out with
// no logic (#538's `captionRef`), with no copy.missing. The planted packer `catalog_copy_key_hashed` writes FNV-1a("1042")
// as cudgel's key: the same film over those bytes raises copy.missing naming items and that key, and this criterion's
// judge fails, naming cudgel and items.
// The wrong programs: the base (no deep-catalog), a packer that hashes a copy key's text, keys a copy column by row
// position, or a lookup that reads the key from the wrong row.
import { describe, expect, it } from 'vitest';
import { captionRef } from '../538/fixtures.ts';
import { at, binOf, evalCall, field, issuesOf, prebuild, presented, putEvidence, runShow, scenario, showCall, snapshotOf } from '../538/helpers.ts';
import {
  AC, DOC, TIMEOUT, failsNaming, fnv32a, i32, layoutOf, names, none, packAll, packCall, prebuildCatalog, rowValues, scratch, show, type Obj,
} from './helpers.ts';
import { CUDGEL, SCHEMA, catalog } from './fixtures.ts';
import { keyReader, shopDoc } from './programs.ts';

prebuildCatalog();
prebuild(['full']);

const K = 2;
interface Shown { en: string; fr: string; issues: Obj[] }
/** This criterion's judge: cudgel's name, shown through keyed copy, is Cudgel in en and Gourdin in fr, with no copy.missing. */
function copyFailures(s: Shown, ref: { cudgel: string; gourdin: string }): string[] {
  const out: string[] = [];
  const said = (h: string): string => (h === ref.cudgel ? '\'Cudgel\'' : h === ref.gourdin ? '\'Gourdin\'' : 'neither \'Cudgel\' nor \'Gourdin\'');
  if (s.en !== ref.cudgel) out.push(`items.cudgel: its name, shown through keyed copy from the items table in en, draws ${said(s.en)}, not 'Cudgel'`);
  if (s.fr !== ref.gourdin) out.push(`items.cudgel: its name, shown through keyed copy from the items table in fr, draws ${said(s.fr)}, not 'Gourdin'`);
  for (const i of s.issues.filter((x) => x['code'] === 'copy.missing')) out.push(`items.cudgel: copy.missing ${show(i, 300)} for the key its row holds`);
  return out;
}

describe(`${AC[10]} a copy column packs its keys as i32 values, and a text item shows them through keyed copy`, () => {
  it(`${AC[10]} cudgel's name key is 1042 in a copy column over items; shown through keyed copy it reads Cudgel in en and Gourdin in fr; the planted hashed key raises copy.missing and fails naming the row and the table`, () => {
    const dir = scratch('ac10');
    const [clean, hashed] = packAll([packCall(dir, catalog(), SCHEMA), packCall(dir, catalog(), SCHEMA, 'csv', 'catalog_copy_key_hashed')], 'the fixture, clean and with hashed keys');
    const items = (clean!.record['tables'] as Obj[]).find((x) => x['name'] === 'items');
    const name = (items?.['columns'] as Obj[] | undefined)?.find((x) => x['name'] === 'name');
    expect([name?.['type'], name?.['copy']], `the record's items.name is a copy column over the copy table items: ${show(name)}`).toEqual(['copy', 'items']);
    expect(rowValues(clean!.bytes, layoutOf(clean!.bytes, 'clean'), 'items', SCHEMA, CUDGEL.id)['name'], 'cudgel\'s row holds the i32 key 1042').toBe(CUDGEL.key);
    const wrongKey = i32(fnv32a(String(CUDGEL.key)));
    expect(rowValues(hashed!.bytes, layoutOf(hashed!.bytes, 'hashed'), 'items', SCHEMA, CUDGEL.id)['name'], 'the planted packer writes FNV-1a("1042") in its place').toBe(wrongKey);

    const program = keyReader('items', 'name', CUDGEL.id);
    const ev = scratch('ev');
    for (const b of [program.bytes, clean!.bytes, hashed!.bytes]) putEvidence(ev, b);
    const D = { cudgel: DOC(11), gourdin: DOC(12), shop: DOC(13), hashed: DOC(14) };
    const r = runShow(binOf('full'), scenario(ev, Object.values(D), [
      showCall(D.cudgel, captionRef('ref-cudgel', CUDGEL.en)), showCall(D.gourdin, captionRef('ref-gourdin', CUDGEL.fr)), evalCall(D.cudgel, 0), evalCall(D.gourdin, 0),
      showCall(D.shop, shopDoc(program, clean!.sha256) as never), evalCall(D.shop, at(K), { locale: 'en' }), evalCall(D.shop, at(K), { locale: 'fr' }),
      showCall(D.hashed, shopDoc(program, hashed!.sha256) as never), evalCall(D.hashed, at(K), { locale: 'en' }), evalCall(D.hashed, at(K), { locale: 'fr' }),
    ]), 'AC10 keyed copy');
    for (const [i, what] of [[0, 'the caption reading Cudgel'], [1, 'the caption reading Gourdin'], [4, 'the shop over the clean catalog'], [7, 'the shop over the hashed keys']] as const) presented(r[i]!, what);
    const ref = { cudgel: snapshotOf(r[2]!, 'Cudgel written out'), gourdin: snapshotOf(r[3]!, 'Gourdin written out') };
    expect(ref.cudgel, 'the two references draw differently').not.toBe(ref.gourdin);
    const clean2: Shown = { en: snapshotOf(r[5]!, 'the shop in en'), fr: snapshotOf(r[6]!, 'the shop in fr'), issues: [...issuesOf(r[5]!), ...issuesOf(r[6]!)] as Obj[] };
    none(copyFailures(clean2, ref), 'cudgel\'s name through keyed copy');

    const planted: Shown = { en: snapshotOf(r[8]!, 'the hashed shop in en'), fr: snapshotOf(r[9]!, 'the hashed shop in fr'), issues: [...issuesOf(r[8]!), ...issuesOf(r[9]!)] as Obj[] };
    const missing = planted.issues.filter((i) => i['code'] === 'copy.missing' && names(String(field(i as never, 'table')), 'items') && field(i as never, 'key') === wrongKey);
    expect(missing.length, `the planted key raises copy.missing naming the items table and the key its row holds: ${show(planted.issues, 2000)}`).toBeGreaterThan(0);
    failsNaming(copyFailures(planted, ref), ['cudgel', 'items'], 'the shop over catalog_copy_key_hashed');
  }, TIMEOUT);
});
