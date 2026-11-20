// What #2744's helpers (imported unchanged) hard-code and #2833 changes: the machine's test limit. Per #2833, it is
// the one `scripts/throttle.mjs` states for the platform on its `LIMITS` line. That constant isn't exported, and no
// test imports the code under test, so it is read from the source text. A line that can't be read fails the test
// that asks; there is no default.
import { readFileSync } from 'node:fs';
import { THROTTLE } from '../2744/helpers.mjs';

/** The `test` limit throttle.mjs's `LIMITS` line gives `platform` (darwin, or any other for the Linux branch). */
export function testLimit(platform = process.platform) {
  const source = readFileSync(THROTTLE, 'utf8');
  const lines = source.split('\n').filter((line) => /^\s*(?:const|let|var)\s+LIMITS\s*=/.test(line));
  const fail = (why) => { throw Error(`can't read the machine's test limit from ${THROTTLE}: ${why}`); };
  if (lines.length !== 1) fail(`expected one \`const LIMITS = ...\` line, found ${lines.length}`);
  const branches = lines[0].match(/=\s*process\.platform\s*===\s*(['"])darwin\1\s*\?\s*(\{[^{}]*\})\s*:\s*(\{[^{}]*\})\s*;?\s*(?:\/\/.*)?$/);
  if (!branches) fail(`its LIMITS line isn't \`process.platform === 'darwin' ? {...} : {...}\`: ${lines[0].trim()}`);
  const branch = platform === 'darwin' ? branches[2] : branches[3];
  const values = [...branch.matchAll(/(?:^|[{,])\s*(['"]?)test\1\s*:\s*([^,}]*)/g)];
  if (values.length !== 1) fail(`the ${platform === 'darwin' ? 'darwin' : 'non-darwin'} branch ${branch} names test ${values.length} times`);
  const text = values[0][2].trim();
  if (!/^[1-9]\d*$/.test(text)) fail(`the ${platform === 'darwin' ? 'darwin' : 'non-darwin'} branch's test limit is \`${text}\`, not a positive integer`);
  return Number(text);
}
