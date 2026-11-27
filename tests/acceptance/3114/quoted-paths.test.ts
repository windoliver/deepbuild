// #3114: an approved check whose own file the claim changed counts as the agent's own whatever bytes the file's name
// holds; nothing missing or unrun passes. The gate runner reads what a claim changed from git; with git's default
// core.quotePath a name holding a non-ASCII byte, a `"` or a tab comes back quoted ("test/\303\251.test.js") and never
// matches the plain path in the run's `read` list, so the edited check stays approved and the claim can PASS.
//
// Each test stops one claim on the approved check `unit-tests` (bench.ts), whose one run passed reading the named files,
// and reads the claim's verdict through GateRunner.verdictOf: its outcome, and its reason lines.
import { afterEach, describe, expect, it } from 'vitest';
import { CHECK, cleanup, judge, ownLine, type Judged } from './bench.ts';

afterEach(cleanup);

const AC1 = '#3114.1c2cb3dd';
const AC2 = '#3114.e80ac3c7';
const AC3 = '#3114.86767b02';

const SRC = 'src/a.js';
const CODE = 'exports.a = () => 1;\n';
const TEST = (name: string) => `const assert = require('node:assert'); assert.equal(require('../${SRC}').a(), 1); // ${name}\n`;
const EDITED = (name: string) => `const assert = require('node:assert'); assert.ok(true); // ${name}, its assertion gone\n`;

/** The run started and passed: otherwise the claim says nothing of whose check it is. */
function ran(j: Judged, read: string[]): void {
  if (j.runs.length < 1) throw Error(`BLOCKED: the check never ran on the claim (verdict ${j.outcome}: ${j.reasons.join(' | ')})`);
  if (JSON.stringify(j.runs[0]) !== JSON.stringify(read)) throw Error(`BLOCKED: the run read ${JSON.stringify(j.runs[0])}, not ${JSON.stringify(read)}`);
}
/** The claim isn't PASS, and a reason line says the check counts as the agent's own, naming `path`. */
function countsAsOwn(ac: string, j: Judged, path: string): void {
  const shown = `verdict ${j.outcome}, check ${j.check}; reasons: ${JSON.stringify(j.reasons)}`;
  expect(j.outcome, `${ac} the claim edited ${JSON.stringify(path)}, the approved check's own file, and must not pass on it: ${shown}`).not.toBe('PASS');
  expect(j.outcome, `${ac} the claim has a verdict: ${shown}`).toBeDefined();
  const line = ownLine(j);
  expect(line, `${ac} a reason line says ${CHECK.check} counts as the agent's own: ${shown}`).toBeDefined();
  expect(line, `${ac} that line names the file the claim changed, as its plain path ${JSON.stringify(path)}: ${shown}`).toContain(path);
}

describe(`${AC1} a claim that edits an approved check's tracked test file test/é.test.js, which its run read and passed`, () => {
  it(`${AC1} does not read PASS, and the check's line says it counts as the agent's own, naming test/é.test.js`, async () => {
    const path = 'test/é.test.js';
    const read = [SRC, path];
    const j = await judge({ base: { [SRC]: CODE, [path]: TEST(path) }, claim: { [path]: EDITED(path) }, read });
    ran(j, read);
    countsAsOwn(AC1, j, path);
  }, 30_000);

  it(`${AC1} (control) the same claim on a plain name, test/e.test.js, reads the same on this bench`, async () => {
    const path = 'test/e.test.js';
    const read = [SRC, path];
    const j = await judge({ base: { [SRC]: CODE, [path]: TEST(path) }, claim: { [path]: EDITED(path) }, read });
    ran(j, read);
    countsAsOwn(AC1, j, path);
  }, 30_000);
});

describe(`${AC2} a new, untracked test file whose name holds a \`"\` or a tab, which the run read`, () => {
  for (const path of ['test/a"b.test.js', 'test/a\tb.test.js']) {
    it(`${AC2} ${JSON.stringify(path)}: the claim does not read PASS, and the check's line says it counts as the agent's own, naming the file`, async () => {
      const read = [SRC, path];
      const j = await judge({ base: { [SRC]: CODE, 'test/e.test.js': TEST('test/e.test.js') }, claim: { [path]: TEST(path) }, read });
      ran(j, read);
      countsAsOwn(AC2, j, path);
    }, 30_000);
  }
});

describe(`${AC3} a claim that changes no file under such a name`, () => {
  it(`${AC3} edits only the code under test while the check's test file is test/é.test.js, and still passes`, async () => {
    const path = 'test/é.test.js';
    const read = [SRC, path];
    const j = await judge({ base: { [SRC]: CODE, [path]: TEST(path), 'test/a"b.test.js': TEST('test/a"b.test.js') }, claim: { [SRC]: 'exports.a = () => 2 - 1;\n' }, read });
    ran(j, read);
    expect(ownLine(j), `${AC3} no line says ${CHECK.check} counts as the agent's own: ${JSON.stringify(j.reasons)}`).toBeUndefined();
    expect(j.outcome, `${AC3} the claim passes as before: reasons ${JSON.stringify(j.reasons)}`).toBe('PASS');
  }, 30_000);
});
