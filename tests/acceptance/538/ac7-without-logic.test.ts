// AC7 #538.4b946374: A build with the data, scene3d, cells, text and marks2d modules and without the logic module seals;
// in it, a document whose mark set, text, flip or cell grid reads a logic array is refused with module_missing naming
// logic, and the checks that need it are BLOCKED, never PASS; and a planted data module whose operator reads a logic
// array directly, not through the column view, is refused at that build's seal, naming the read
//
// The build without logic is #403's: the full set with `test-leave-out-logic`. It seals when `deep-show run` answers a
// scenario at all, and its `registry` lists the five modules and not logic. Each reader is this suite's own fixture
// (the cell grid of criterion 1, the caption of criterion 2, the labels of criterion 5, the dialogue of criterion 6),
// each with its logic item, sent by `deep_show` with `check: true`: refused, with an error `module_missing` that names
// logic and the reader (its `ids` or `path`), so the reader's own read is refused and not only the logic item; and the
// check's `result` is BLOCKED. The planted data module is this suite's cargo feature `test-data-reads-logic-array`
// (README: Plants), built with `test-leave-out-logic`: its startup is refused by the seal (#200's refusal line, exit
// 2), naming the data module and the logic array its operator reads.
import { describe, expect, it } from 'vitest';
import { gridProgram, lootProgram, storyProgram, unitsProgram } from './programs.ts';
import { copyDoc, dialogueDoc, gridDoc, labelsDoc, pluralTables } from './fixtures.ts';
import {
  AC, DOC, PLANTED_DATA_FEATURE, TIMEOUT, arr, binOf, declared, errorsOf, names, namedIn, namesItem, none, prebuild, putEvidence, runShow, scenario,
  sealRefusalOf, show, showCall, str, useTemp, type JsonObject,
} from './helpers.ts';

prebuild(['no-logic', 'no-logic-reads']);
const temp = useTemp();
const MODULES = ['data', 'scene3d', 'cells', 'text', 'marks2d'];

describe(`${AC[7]} the build without the logic module`, () => {
  it(`${AC[7]} the build with data, scene3d, cells, text and marks2d and without logic seals; a cell grid, a text, a mark set or a flip that reads a logic array is refused with module_missing naming logic, and its check is BLOCKED`, () => {
    const ev = temp();
    const [grid, loot, units, story] = [gridProgram(), lootProgram(), unitsProgram(), storyProgram()];
    for (const p of [grid, loot, units, story]) putEvidence(ev, p.bytes);
    const readers: [string, string, JsonObject][] = [
      ['the cell grid', 'board', gridDoc(grid)],
      ['the keyed copy', 'caption', copyDoc(loot, pluralTables())],
      ['the labels', 'labels', labelsDoc(units)],
      ['the flip', 'dialogue', dialogueDoc(story)],
    ];
    const docs = readers.map((_, i) => DOC(i + 1));
    const r = runShow(binOf('no-logic'), scenario(ev, docs, [{ call: 'registry' }, ...readers.map(([, , d], i) => showCall(docs[i]!, d, { check: true }))]), 'AC7 the build without logic');
    const modules = arr(r[0]!['modules'], 'the registry\'s modules').map((m) => str(m, 'a module'));
    expect(modules, `the build seals with the data, scene3d, cells, text and marks2d modules: ${modules.join(', ')}`).toEqual(expect.arrayContaining(MODULES));
    expect(modules, 'and without the logic module').not.toContain('logic');
    const failures: string[] = [];
    readers.forEach(([what, reader], i) => {
      const reply = r[i + 1]!;
      if (reply['outcome'] !== 'refused') failures.push(`${what} is ${String(reply['outcome'])}, not refused`);
      const missing = errorsOf(reply).filter((x) => x['code'] === 'module_missing' && names(namedIn(x), 'logic') && namesItem(x, reader));
      if (missing.length === 0) failures.push(`${what}: no error module_missing names logic and the reader ${reader}; the errors: ${show(errorsOf(reply), 1200)}`);
      if (reply['result'] !== 'BLOCKED') failures.push(`${what}: the check's result is ${JSON.stringify(reply['result'])}, not BLOCKED`);
    });
    none(failures, 'each reader of a logic array in the build without logic');
  }, TIMEOUT);

  it(`${AC[7]} planted ${PLANTED_DATA_FEATURE}: a data module whose operator reads a logic array directly is refused at that build's seal, naming the read`, () => {
    expect(declared(PLANTED_DATA_FEATURE), `deep-show declares the cargo feature ${PLANTED_DATA_FEATURE} (README: Plants)`).toBe(true);
    const refusal = sealRefusalOf(binOf('no-logic-reads'), scenario(temp(), [], [{ call: 'registry' }]), `deep-show --features test-leave-out-logic,${PLANTED_DATA_FEATURE}`);
    expect(refusal.modules, `the refusal names the data module: ${show(refusal.raw)}`).toContain('data');
    expect(/(^|[^A-Za-z0-9_])logic\.[A-Za-z0-9_.]+/.test(JSON.stringify({ arrays: refusal.arrays, what: refusal.what })), `the refusal names the read, a logic array: ${show(refusal.raw)}`).toBe(true);
  }, TIMEOUT);
});
