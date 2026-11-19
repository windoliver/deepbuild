// Helpers for the blind redraft of #2574's AC2b and AC2d under #2833 (README: REDRAFT.md). Everything but the test
// limit is tests/acceptance/2574/helpers.mjs, unchanged. #2833's surface: the machine's test limit is the one
// scripts/throttle.mjs states for the platform on its LIMITS line. It isn't exported, so it is read from the source
// text; a line that can't be read fails the test loudly, and no number is ever assumed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hold, started, THROTTLE, until } from '../1115/helpers.mjs';

/** The `test` limit for `platform` in the source of a throttle.mjs; throws when its LIMITS line can't be read. */
export function testLimit(source, platform = process.platform) {
  const line = source.match(/^\s*(?:const|let|var)\s+LIMITS\s*=\s*([^\n]*)$/m);
  assert.ok(line, 'scripts/throttle.mjs has no `const LIMITS = ...` line, so the machine\'s test limit can\'t be read');
  const text = line[1];
  const objects = [...text.matchAll(/\{[^{}]*\}/g)].map(([object]) => object);
  const branch = text.match(/^process\.platform\s*===\s*(['"])(\w+)\1\s*\?\s*\{[^{}]*\}\s*:\s*\{[^{}]*\}\s*;?\s*$/);
  let object;
  if (branch && objects.length === 2) object = platform === branch[2] ? objects[0] : objects[1];
  else if (objects.length === 1 && /^\{[^{}]*\}\s*;?\s*$/.test(text)) object = objects[0];
  assert.ok(object, `scripts/throttle.mjs's LIMITS line is of a shape this helper can't read for ${platform}: ${line[0].trim()}`);
  const test = object.match(/(?:^|[{,\s])(['"]?)test\1\s*:\s*(\d+)\s*(?:[,}])/);
  assert.ok(test, `scripts/throttle.mjs's LIMITS for ${platform} names no numeric test limit: ${object}`);
  const limit = Number(test[2]);
  assert.ok(Number.isInteger(limit) && limit > 0, `scripts/throttle.mjs's test limit for ${platform} reads ${test[2]}`);
  return limit;
}

/** This checkout's test limit for this platform, from the scripts/throttle.mjs the tests run (THROTTLE, under CHECKOUT). */
export const LIMIT = testLimit(readFileSync(THROTTLE, 'utf8'));

/** Fills every test slot of the sandbox's table with other sessions' holders; resolves with them once all hold. */
export async function fill(box, ms) {
  const holders = Array.from({ length: LIMIT }, (_, index) => hold(box, 'test', `neighbour-${index}`, ms));
  assert.ok(await until(() => started(box) === LIMIT, 60_000), `the neighbours did not take all ${LIMIT} test grants`);
  return holders;
}
