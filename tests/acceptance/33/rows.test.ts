// #33 AC10: the corpus holds one seeded false done per row of the verdict rules table, each with its expected verdict
// and a clean twin that PASSes; a corpus missing a row fails its completeness check, naming the row.
//
// The rows are the table's as the Lean model states it: each constructor of `Row` in
// packages/verdicts/model/Verdicts/Model.lean whose `Row.result` isn't PASS (a PASS row is no false done). Three tests:
// the shipped corpus covers each such row with a case whose claim expects that row's outcome and whose twin expects
// PASS, and its completeness check (`deep-conformance gate check`) passes; a copy of the corpus with the cases of one
// row taken out fails the check, naming `row:<that row>`; and the kit plays every row case on the shipped gate as
// expected.
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { AC10, CORPUS, cleanup, covering, expectedOf, kit, kitPassed, kitShown, must, readManifest, tableRows, tempDir } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The row the planted corpus leaves out. */
const DROPPED = 'ran_nothing';

describe(`${AC10} one seeded false done per row of the verdict rules table, each with its expected verdict and a clean twin`, () => {
  it(`${AC10} each non-PASS row of the Lean model's Row has a case expecting its outcome, with a PASS twin; the completeness check passes`, async () => {
    const m = readManifest();
    const rows = tableRows().filter((r) => r.result !== 'PASS');
    must(rows.length > 0 && rows.every((r) => r.result !== 'unknown'), `${AC10} the Lean model's rows each set an outcome: ${JSON.stringify(rows)}`);
    for (const { row, result } of rows) {
      const cases = covering(m, `row:${row}`);
      must(cases.length > 0, `${AC10} the corpus holds a seeded false done for the row ${row}: no case covers row:${row}`);
      must(cases.some((c) => expectedOf(c.claim).includes(result as never)), `${AC10} a case covering row:${row} expects its outcome, ${result}: ${cases.map((c) => `${c.id} expects ${JSON.stringify(c.claim.expected)}`).join('; ')}`);
    }
    for (const c of m.cases) {
      must(!expectedOf(c.claim).includes('PASS'), `${AC10} ${c.id} is a false done, so its claim never expects PASS: ${JSON.stringify(c.claim.expected)}`);
      must(expectedOf(c.twin).join() === 'PASS', `${AC10} ${c.id}'s clean twin expects PASS: ${JSON.stringify(c.twin.expected)}`);
      for (const folder of ['base', ...c.claim.commits, ...c.twin.commits]) must(existsSync(join(CORPUS, c.dir, folder)), `${AC10} ${c.id}'s folder ${join(c.dir, folder)} exists`);
    }
    const k = await kit(['check'], { timeoutMs: 300_000 });
    must(k.ran.code === 0 && /^PASS gate@1\b/.test(k.last), `${AC10} the shipped corpus passes its completeness check: ${kitShown(k)}`);
  }, 600_000);

  it(`${AC10} a corpus missing the row ${DROPPED} fails its completeness check, naming row:${DROPPED}`, async () => {
    const copy = join(tempDir(), 'gate');
    cpSync(CORPUS, copy, { recursive: true });
    const m = readManifest(copy);
    m.cases = m.cases.filter((c) => !c.covers.includes(`row:${DROPPED}`));
    writeFileSync(join(copy, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
    const k = await kit(['check', '--corpus', copy], { timeoutMs: 300_000 });
    must(k.ran.code === 1, `${AC10} the completeness check fails on a corpus missing row:${DROPPED}, exit 1: ${kitShown(k)}`);
    must(k.ran.stdout.split('\n').some((l) => l.startsWith('FAIL') && l.includes(`row:${DROPPED}`)), `${AC10} a FAIL line names row:${DROPPED}: ${kitShown(k)}`);
  }, 600_000);

  it(`${AC10} the kit plays every row case on the shipped gate: each claim as expected, each twin PASS`, async () => {
    const m = readManifest();
    const ids = [...new Set(m.cases.filter((c) => c.covers.some((t) => t.startsWith('row:'))).map((c) => c.id))];
    must(ids.length > 0, `${AC10} the corpus holds row cases`);
    kitPassed(AC10, await kit(['run', ...ids.flatMap((id) => ['--case', id])], { timeoutMs: 4 * 3_600_000 }), ids);
  }, 4 * 3_600_000 + 600_000);
});
