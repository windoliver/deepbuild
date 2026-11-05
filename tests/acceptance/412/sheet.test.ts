// AC15: "On the full build the sheet is at most 32,768 bytes and lists every available entry, checked by the include
// fixture against the listing, and two builds of one module-set digest give byte-identical sheets; a planted entry
// whose one-liner pushes the sheet past 32,768 bytes fails the build, naming the entry and the overrun in bytes; and
// a planted sheet that drops pack entries fails the include fixture, naming testpack.ring"
//
// asserts: in `full`, deep_kinds `sheet` gives a text of at most 32,768 UTF-8 bytes naming every entry the listing
// (every page) holds as available, for the listing's module-set digest, and a second sealed process of the same build
// gives the same bytes. In `core,test-mark` with test/testpack the sheet names testpack.ring, and `--planted
// sheet_without_pack_entries` fails that include check, naming testpack.ring. `core,test-sheet-wordy` (a test module
// whose kind test.wordy.long@1 carries a 33,000-byte one-liner) is refused at startup: the seal's refusal line names
// test.wordy.long@1 and the overrun in bytes (`overrun_bytes`, a positive whole number its text also holds).

import { describe, expect, it } from 'vitest';
import {
  FULL, SHEET_CAP, TESTPACK, WORDY, answer, failsNaming, kinds, listAll, none, run, scenario, sheetIncludeFailures, startup, str, useBuilds,
  useEvidence, REFUSED_EXIT, isObject, show, type Build,
} from './helpers.ts';

const MARKS: Build = { set: 'core', with: ['test-mark'] };
const WORDY_BUILD: Build = { set: 'core', with: ['test-sheet-wordy'] };
const builds = useBuilds([FULL, MARKS, WORDY_BUILD]);
const evidence = useEvidence();

function sheet(bin: string, world: Parameters<typeof scenario>[2] = {}, planted?: string): { text: string; module_set: string } {
  const [reply] = run(bin, scenario(evidence(), [kinds('sheet')], world), planted);
  const a = answer(reply!, 'deep_kinds sheet');
  return { text: str(a['text'], 'the sheet\'s text'), module_set: str(a['module_set'], 'the sheet\'s module-set digest') };
}

describe('AC15 the one-page sheet: at most 32 KB, every available entry, the same bytes for one digest', () => {
  it('AC15 on the full build the sheet is at most 32,768 bytes, names every available entry of the listing, and two sealed processes give byte-identical sheets', () => {
    const bin = builds.bin(FULL);
    const l = listAll(bin, evidence());
    const first = sheet(bin);
    expect(Buffer.byteLength(first.text, 'utf8'), 'the sheet is at most 32,768 bytes').toBeLessThanOrEqual(SHEET_CAP);
    expect(first.module_set, 'the sheet is the listing\'s, by its module-set digest').toBe(l.module_set);
    none(sheetIncludeFailures(first.text, l), 'the include check of the sheet against the listing');
    const second = sheet(bin);
    expect(Buffer.from(second.text, 'utf8').equals(Buffer.from(first.text, 'utf8')), 'a second build of the same digest gives the same bytes').toBe(true);
  }, 1_800_000);

  it('AC15 the sheet names testpack.ring, and a planted sheet that drops pack entries fails the include fixture, naming testpack.ring', () => {
    const bin = builds.bin(MARKS);
    const world = { packs: [TESTPACK] };
    const l = listAll(bin, evidence(), world);
    none(sheetIncludeFailures(sheet(bin, world).text, l), 'the sheet with test/testpack installed');
    failsNaming(sheetIncludeFailures(sheet(bin, world, 'sheet_without_pack_entries').text, l), ['testpack.ring'], 'the sheet without pack entries');
  }, 1_800_000);

  it('AC15 a planted entry whose one-liner pushes the sheet past 32,768 bytes fails the build, naming the entry and the overrun in bytes', () => {
    const s = startup(builds.bin(WORDY_BUILD));
    expect(s.status, `the seal refuses the build: exit ${s.status}; ${s.stdout.slice(0, 800)}`).toBe(REFUSED_EXIT);
    const line = s.lines[0];
    expect(isObject(line) && line['code'] === 'seal_refused', `one seal_refused line: ${show(line)}`).toBe(true);
    const refusal = line as Record<string, unknown>;
    expect(JSON.stringify(refusal['entries'] ?? null), 'the refusal names the entry').toContain(WORDY);
    const overrun = refusal['overrun_bytes'];
    expect(typeof overrun === 'number' && Number.isSafeInteger(overrun) && overrun > 0, `the refusal names the overrun in bytes: ${show(line)}`).toBe(true);
    expect(String(refusal['what'] ?? ''), 'and says it in its text').toContain(String(overrun));
  }, 1_800_000);
});
