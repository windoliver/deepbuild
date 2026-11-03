// #415.cd60aa60: nav.graph@1 refuses a link naming a node past the node count at the link's offset; pages@1
// refuses repeated page numbers naming the second; a validator reading past its memory refuses the asset naming
// the bounds trap; and an asset 1 byte over max_bytes is refused before its validator runs.
import { describe, expect, it } from 'vitest';
import {
  LONG, SANDBOX, installPack, mutate, navGraph, oobValidator, offsetOf, pageOffset, prebuild, runShow, runsOf, sha256, show, useTemp,
  validate, verdict, writeAsset, writePack, writePages,
} from './helpers.ts';

const ID = '#415.cd60aa60';
prebuild();
const temp = useTemp();

/** test/oobpack@1.0.0 (README: Packs): layout oobpack.oob@1, max_bytes 4,096, whose validator always traps bounds. */
function oobPack(root: string) {
  const v = oobValidator();
  const twin = Buffer.from([0]);
  const { pack } = writePack(root, {
    name: 'oobpack', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #415 acceptance suite: a layout whose validator loads past its memory.',
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
    layouts: { 'oobpack.oob@1': { validator: sha256(v.bytes), max_bytes: 4096, twins: [sha256(twin)], doc: 'Any bytes; its validator loads at 0xFFFFFFF0.' } },
  }, { 'oob.wasm': v.bytes, 'twin.bin': twin });
  return { pack, loadAt: v.loadAt };
}

describe(`${ID} validators refuse a bad link, a repeated page, a read past memory, and an asset past max_bytes before running`, () => {
  it(`${ID} nav.graph@1 admits the fixture level and refuses it once a link's b names a node past the node count, at that link's b`, () => {
    const g = navGraph(1);
    const good = writeAsset(temp(), 'level.nav1', g.bytes);
    const bad = writeAsset(temp(), 'bad-link.nav1', mutate(g, 'links[2].b', (b, at) => b.writeUInt32LE(9, at)));
    const [ok, refused] = runShow(temp(), [validate('nav.graph@1', good.path), validate('nav.graph@1', bad.path)]).map(verdict);
    expect([ok!.outcome, ok!.asset, ok!.trap], `the fixture level is admitted: ${show(ok)}`).toEqual(['admitted', good.sha, null]);
    expect({ outcome: refused!.outcome, code: refused!.code, asset: refused!.asset, layout: refused!.layout, offset: refused!.offset, field: refused!.field, trap: refused!.trap },
      'refused at the link\'s b (node 9 of 5), naming the asset, the layout and the offset')
      .toEqual({ outcome: 'refused', code: 'layout_refused', asset: bad.sha, layout: 'nav.graph@1', offset: offsetOf(g, 'links[2].b'), field: 'links[2].b', trap: null });
  }, LONG);

  it(`${ID} pages@1 admits pages 0, 5, 7 and refuses pages 0, 5, 5, naming the second 5`, () => {
    const good = writePages(temp(), 'good.pages', [0, 5, 7]);
    const bad = writePages(temp(), 'repeat.pages', [0, 5, 5]);
    const [ok, refused] = runShow(temp(), [validate('pages@1', good.path), validate('pages@1', bad.path)]).map(verdict);
    expect([ok!.outcome, ok!.trap], `pages in order are admitted: ${show(ok)}`).toEqual(['admitted', null]);
    expect({ outcome: refused!.outcome, code: refused!.code, asset: refused!.asset, offset: refused!.offset, field: refused!.field, trap: refused!.trap },
      'refused at the second 5: page 2\'s number')
      .toEqual({ outcome: 'refused', code: 'layout_refused', asset: bad.sha, offset: pageOffset(2), field: 'pages[2].number', trap: null });
  }, LONG);

  it(`${ID} a validator that loads past its memory refuses the asset, naming the bounds trap`, () => {
    const p = oobPack(temp());
    const asset = writeAsset(temp(), 'four-k.bin', Buffer.alloc(4096, 1));
    const [install, judged] = runShow(temp(), [installPack(p.pack), validate('oobpack.oob@1', asset.path)]);
    expect(install!['outcome'], `test/oobpack@1.0.0 installs (its validator refuses its twin by trapping): ${show(install)}`).toBe('installed');
    const v = verdict(judged!);
    expect({ outcome: v.outcome, code: v.code, asset: v.asset, layout: v.layout, trap: v.trap },
      'refused with the bounds trap at the validator\'s i64.load')
      .toEqual({ outcome: 'refused', code: 'layout_trap', asset: asset.sha, layout: 'oobpack.oob@1', trap: { kind: 'bounds', function: 0, offset: p.loadAt } });
  }, LONG);

  it(`${ID} an asset 1 byte over its layout's max_bytes is refused naming the cap, and its validator never runs`, () => {
    const p = oobPack(temp());
    const over = writeAsset(temp(), 'over.bin', Buffer.alloc(4097, 1));
    const at = writeAsset(temp(), 'at.bin', Buffer.alloc(4096, 2));
    const [install, c0, refused, c1, ran, c2] = runShow(temp(), [
      installPack(p.pack), SANDBOX, validate('oobpack.oob@1', over.path), SANDBOX, validate('oobpack.oob@1', at.path), SANDBOX,
    ]);
    expect(install!['outcome'], `test/oobpack@1.0.0 installs: ${show(install)}`).toBe('installed');
    const v = verdict(refused!);
    expect({ outcome: v.outcome, code: v.code, asset: v.asset, size: v.size, max_bytes: v.max_bytes, trap: v.trap },
      'the 4,097-byte asset is refused for its size, naming the cap, with no trap (nothing ran)')
      .toEqual({ outcome: 'refused', code: 'over_cap', asset: over.sha, size: 4097, max_bytes: 4096, trap: null });
    expect(runsOf(c1!) - runsOf(c0!), 'no validator ran for the asset past max_bytes').toBe(0);
    expect(verdict(ran!).code, `the 4,096-byte asset reaches its validator, which traps: ${show(ran)}`).toBe('layout_trap');
    expect(runsOf(c2!) - runsOf(c1!), 'the asset at max_bytes ran its validator once').toBe(1);
  }, LONG);
});
