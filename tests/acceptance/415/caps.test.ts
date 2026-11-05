// #415.701b371a: fn.table@1 refuses x = 0, 2, 1 naming index 2; pages@1 takes 4,096 pages (past a pack layout's
// 64 MiB) and refuses 4,097 naming its cap; a planted pages@1 capped at a pack layout's 64 MiB refuses the
// 4,096-page asset, naming it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LONG, PACK_LAYOUT_CAP, PAGES_CAP, PAGES_MAX_BYTES, fnTable, offsetOf, prebuild, runShow, show, useTemp, validate, verdict, writeAsset,
  writePages, type Asset,
} from './helpers.ts';

const ID = '#415.701b371a';
prebuild();
const temp = useTemp();

// The 4,096-page asset (256 MiB and a header) is written once for this file's two tests that read it and
// deleted after them.
let bigDir = '';
let big: Asset | undefined;
function fourK(): Asset {
  if (!big) {
    bigDir = mkdtempSync(join(tmpdir(), 'deep-415-pages-'));
    big = writePages(bigDir, 'world.pages', Array.from({ length: PAGES_CAP }, (_, i) => i));
  }
  return big;
}
afterAll(() => { if (bigDir) rmSync(bigDir, { recursive: true, force: true }); bigDir = ''; big = undefined; });

describe(`${ID} fn.table@1's increasing x, pages@1's own cap past 64 MiB, and a planted pages@1 capped at 64 MiB`, () => {
  it(`${ID} fn.table@1 admits x 0, 1, 2 and refuses x 0, 2, 1, naming index 2`, () => {
    const good = fnTable([0, 1, 2], [0, 0.5, 1]);
    const bad = fnTable([0, 2, 1], [0, 0.5, 1]);
    const [ok, refused] = runShow(temp(), [
      validate('fn.table@1', writeAsset(temp(), 'good.ftab', good.bytes).path),
      validate('fn.table@1', writeAsset(temp(), 'bad.ftab', bad.bytes).path),
    ]).map(verdict);
    expect([ok!.outcome, ok!.trap], `x strictly increasing is admitted: ${show(ok)}`).toEqual(['admitted', null]);
    expect({ outcome: refused!.outcome, code: refused!.code, layout: refused!.layout, offset: refused!.offset, field: refused!.field, trap: refused!.trap },
      'refused at x[2] (1 after 2)')
      .toEqual({ outcome: 'refused', code: 'layout_refused', layout: 'fn.table@1', offset: offsetOf(bad, 'x[2]'), field: 'x[2]', trap: null });
  }, LONG);

  it(`${ID} pages@1 admits 4,096 pages, past a pack layout's 64 MiB, and refuses 4,097, naming its cap`, () => {
    const ok = fourK();
    expect(ok.size, 'the 4,096-page asset is past a pack layout\'s 64 MiB').toBeGreaterThan(PACK_LAYOUT_CAP);
    const [taken] = runShow(temp(), [validate('pages@1', ok.path)]).map(verdict);
    expect({ outcome: taken!.outcome, asset: taken!.asset, size: taken!.size, max_bytes: taken!.max_bytes, trap: taken!.trap },
      'the 4,096-page asset is admitted under pages@1\'s own cap')
      .toEqual({ outcome: 'admitted', asset: ok.sha, size: ok.size, max_bytes: PAGES_MAX_BYTES, trap: null });
    const over = writePages(temp(), 'over.pages', Array.from({ length: PAGES_CAP + 1 }, (_, i) => i));
    const [refused] = runShow(temp(), [validate('pages@1', over.path)]).map(verdict);
    expect({ outcome: refused!.outcome, code: refused!.code, asset: refused!.asset, size: refused!.size, max_bytes: refused!.max_bytes },
      'the 4,097-page asset is refused, naming pages@1\'s cap of a header and 4,096 pages')
      .toEqual({ outcome: 'refused', code: 'over_cap', asset: over.sha, size: over.size, max_bytes: PAGES_MAX_BYTES });
  }, LONG);

  it(`${ID} a planted pages@1 capped at a pack layout's 64 MiB refuses the 4,096-page asset, naming it`, () => {
    const ok = fourK();
    const [refused] = runShow(temp(), [validate('pages@1', ok.path)], 'pages_capped_at_64mib').map(verdict);
    expect({ outcome: refused!.outcome, code: refused!.code, asset: refused!.asset, max_bytes: refused!.max_bytes },
      'the wrong cap refuses the asset the shipped pages@1 takes, naming the asset')
      .toEqual({ outcome: 'refused', code: 'over_cap', asset: ok.sha, max_bytes: PACK_LAYOUT_CAP });
  }, LONG);
});
