// #2833's surface: the machine's test limit is the one scripts/throttle.mjs states for this platform on its LIMITS
// line. It isn't exported, so its source is read. Anything unreadable throws; no number is ever assumed.
import { readFileSync } from 'node:fs';
import { THROTTLE } from '../1115/helpers.mjs';

/** The `test` limit of a LIMITS line's object literal, or a thrown Error naming what couldn't be read. */
function testOf(literal, which) {
  const found = [...literal.matchAll(/(?:^|[{,\s])['"]?test['"]?\s*:\s*(\d+)\s*(?=[,}])/g)];
  if (found.length !== 1) throw Error(`scripts/throttle.mjs: the ${which} LIMITS object states ${found.length} test limits, not one: ${literal}`);
  const limit = Number(found[0][1]);
  if (!Number.isInteger(limit) || limit < 1) throw Error(`scripts/throttle.mjs: the ${which} test limit ${found[0][1]} isn't a positive whole number`);
  return limit;
}

/** The test-class limit scripts/throttle.mjs states for `platform`, read from `file` (the checkout's throttle). */
export function testLimit(file = THROTTLE, platform = process.platform) {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n').filter((line) => /^\s*const\s+LIMITS\s*=/.test(line));
  if (lines.length !== 1) throw Error(`${file}: ${lines.length} LIMITS lines, not one; can't read the test limit`);
  const match = lines[0].match(/^\s*const\s+LIMITS\s*=\s*process\.platform\s*===\s*(['"])(\w+)\1\s*\?\s*(\{[^{}]*\})\s*:\s*(\{[^{}]*\})\s*;?\s*$/);
  if (!match) throw Error(`${file}: its LIMITS line isn't \`process.platform === '<name>' ? {…} : {…}\`; can't read the test limit: ${lines[0]}`);
  const [, , named, chosen, other] = match;
  return platform === named ? testOf(chosen, named) : testOf(other, `non-${named}`);
}
