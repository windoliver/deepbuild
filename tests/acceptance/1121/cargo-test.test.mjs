// AC2 (#1121.b915783e): the workspace's cargo test on the Spark has no FAIL and no BLOCKED. The command is the one
// the proof lanes run, read from lanes.mjs, and its output is read by lanes.mjs's own reader of cargo's results.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { cargoLane, CHECKOUT, elsewhere, HOURS, PLATFORM, run, sandbox, SPARK } from './helpers.mjs';

// cargoResults and crates are what the lane itself reads a cargo test run with.
const READER = `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [checkout, log, status] = process.argv.slice(2);
const { cargoResults, crates } = await import(pathToFileURL(join(checkout, 'scripts/lanes.mjs')).href);
console.log(JSON.stringify(cargoResults(readFileSync(log, 'utf8').trim(), Number(status), crates(checkout))));
`;

test('#1121.b915783e the workspace\'s cargo test on the Spark has no FAIL and no BLOCKED', HOURS, async (t) => {
  if (PLATFORM !== SPARK) return t.skip(elsewhere('the Spark, Linux on aarch64'));
  const box = sandbox(t);
  const { command } = await cargoLane(box);
  const ran = await run(command, { merge: true });
  const log = join(box.dir, 'cargo-test.log'), reader = join(box.dir, 'reader.mjs');
  writeFileSync(log, ran.stdout);
  writeFileSync(reader, READER);
  const read = await run([process.execPath, reader, CHECKOUT, log, String(ran.status ?? 1)]);
  assert.equal(read.status, 0, `lanes.mjs reads the run:\n${read.stderr}`);
  const { failures, passed } = JSON.parse(read.stdout.trim().split('\n').at(-1));
  assert.ok(passed.length > 0, `${command.join(' ')} ran tests on ${PLATFORM} (exit ${ran.status}):\n${ran.stdout.slice(-3000)}`);
  // A failure main already lists is main's, as the lane reads it (scripts/known-failures.json); every other FAIL, and
  // every BLOCKED, is the Spark's.
  const known = join(CHECKOUT, 'scripts/known-failures.json');
  const listed = existsSync(known) ? JSON.parse(readFileSync(known, 'utf8')).failures ?? {} : {};
  const wrong = failures.filter(({ id, state }) => state === 'BLOCKED' || (state === 'FAIL' && !Object.hasOwn(listed, id)));
  assert.deepEqual(wrong.map(({ id, state, message }) => `${state} ${id}${message ? `: ${message}` : ''}`), [], `cargo test on ${PLATFORM} has ${wrong.length} FAIL or BLOCKED among ${passed.length + failures.length} results`);
});
