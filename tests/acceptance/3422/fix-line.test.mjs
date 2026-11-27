// #3422's first criterion, in scratch repositories: a file over its ceiling fails the ratchet, and the Fix line under
// its FAIL line says how to split it: move one named concept to a file of its own, which imports what it needs by name
// (README: The wording rule). Scope gives the same line to a file over the limit, and the issue's account cites the
// raised ceiling's line beside them. The Fix lines that ask for no split keep to their own remedy. On the merge base
// the three lines say only to split or shrink, so each test fails there at its assertion on the Fix line.
import test from 'node:test';
import { CEILINGS, FIX, assertNoAdvice, assertPasses, assertSaysHow, failOf, json, put, ratchet, rust, scratch } from './helpers.mjs';

const BIG = 'crates/fixture/src/big.rs'; // 1,600 lines at its ceiling of 1,600
const SHRUNK = 'crates/fixture/src/shrunk.rs'; // 1,600 lines at its ceiling, shrunk to 1,550: lower its ceiling
const SMALL = 'crates/fixture/src/small.rs'; // 1,600 lines at its ceiling, shrunk to 1,400: remove its entry
const NEW = 'packages/fixture/src/new.ts'; // a new file of 1,501 lines, with no ceiling
const typescript = (count) => Array.from({ length: count }, (_, i) => `export const c${String(i + 1).padStart(4, '0')} = ${i + 1};\n`).join('');

test(`${FIX} a file a line over its ceiling fails the ratchet, and its Fix line says to move one named concept to a file of its own that imports by name; the Fix lines to lower a ceiling and to remove an entry say none of it`, (t) => {
  const cwd = scratch(t, { [BIG]: rust(1600), [SHRUNK]: rust(1600), [SMALL]: rust(1600), [CEILINGS]: json({ [BIG]: 1600, [SHRUNK]: 1600, [SMALL]: 1600 }) });
  assertPasses(ratchet(cwd), '(each file at its ceiling)');

  put(cwd, BIG, rust(1601));
  put(cwd, SHRUNK, rust(1550));
  put(cwd, SMALL, rust(1400));
  const result = ratchet(cwd);
  const over = failOf(result, BIG, [1601, 1600], `${BIG} runs 1,601 lines over its ceiling of 1,600`);
  assertSaysHow(over, 'a file over its ceiling');

  assertNoAdvice(failOf(result, SHRUNK, [1550, 1600], `${SHRUNK} runs 1,550 lines under its ceiling of 1,600`), 'a file under its ceiling, whose ceiling is lowered');
  assertNoAdvice(failOf(result, SMALL, [1400, 1600], `${SMALL} runs 1,400 lines with a ceiling of 1,600`), 'a file at most 1,500 lines, whose entry is removed');
});

test(`${FIX} a new file over 1,500 lines with no ceiling fails the ratchet, and its Fix line says to move one named concept to a file of its own that imports by name`, (t) => {
  const cwd = scratch(t, { [BIG]: rust(1600), [CEILINGS]: json({ [BIG]: 1600 }) });
  assertPasses(ratchet(cwd), `(${BIG} at its ceiling)`);

  put(cwd, NEW, typescript(1501));
  const over = failOf(ratchet(cwd), NEW, [1501, 1500], `${NEW} is new at 1,501 lines, over 1,500 with no ceiling`);
  assertSaysHow(over, 'a file over 1,500 lines with no ceiling');
});

test(`${FIX} a file grown with its ceiling raised to match fails the ratchet, and its Fix line says to move one named concept to a file of its own that imports by name`, (t) => {
  const cwd = scratch(t, { [BIG]: rust(1600), [CEILINGS]: json({ [BIG]: 1600 }) });
  assertPasses(ratchet(cwd), `(${BIG} at its ceiling)`);

  put(cwd, BIG, rust(1610));
  put(cwd, CEILINGS, json({ [BIG]: 1610 }));
  const over = failOf(ratchet(cwd), BIG, [1610, 1600], `${BIG} runs 1,610 lines with its ceiling raised to 1,610, above the merge base's 1,600`);
  assertSaysHow(over, "a file over the merge base's ceiling, with its own raised");
});
