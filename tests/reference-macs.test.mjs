// #1831: deep-show compiles in crates/deep-show/reference-macs.json, since a Rust crate can't import the list
// scripts/benchmark.mjs keeps. The file is that list's models, in its order, or this fails, naming the file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { references } from '../scripts/benchmark.mjs';

const FILE = 'crates/deep-show/reference-macs.json';

test("deep-show's reference Macs are the ones scripts/benchmark.mjs judges by", () => {
  const compiled = JSON.parse(readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8'));
  assert.deepEqual(compiled, references.map(({ model }) => model), `${FILE} keeps its own list of reference Macs: it must hold the models of scripts/benchmark.mjs's list`);
});
