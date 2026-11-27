// For #3334's redraft under #3549: the machine's build limit, the one `scripts/throttle.mjs` states for this platform
// on its `LIMITS` line, and the original's `stillLine` (3334/helpers.mjs) counting by it. LIMITS isn't exported, so its
// source text is read; anything but one LIMITS line with one `build` key in this platform's branch throws, never a
// default.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THROTTLE, start, within } from '../3334/helpers.mjs';

export function buildLimit() {
  const source = readFileSync(THROTTLE, 'utf8'), platform = process.platform;
  const lines = source.split('\n').filter((line) => /^\s*const\s+LIMITS\s*=/.test(line));
  if (lines.length !== 1) throw Error(`expected exactly one LIMITS line in scripts/throttle.mjs, found ${lines.length}`);
  const shape = /^\s*const\s+LIMITS\s*=\s*process\.platform\s*===\s*'darwin'\s*\?\s*(\{[^{}]*\})\s*:\s*(\{[^{}]*\})\s*;?\s*$/.exec(lines[0]);
  if (!shape) throw Error(`the LIMITS line isn't "process.platform === 'darwin' ? {...} : {...}": ${lines[0]}`);
  const branch = platform === 'darwin' ? shape[1] : shape[2];
  const keys = [...branch.matchAll(/(?:^|[{,])\s*(?:build|'build'|"build")\s*:\s*([^,}]*)/g)];
  if (keys.length !== 1) throw Error(`expected exactly one build key in LIMITS's ${platform === 'darwin' ? 'darwin' : 'non-darwin'} branch, found ${keys.length}: ${branch}`);
  const value = keys[0][1].trim();
  if (!/^[1-9]\d*$/.test(value)) throw Error(`LIMITS's build value isn't a positive integer literal: ${value}`);
  return Number(value);
}

/**
 * Holds every build slot of the table folder `table` still: a holder for each slot of that limit, `throttle.mjs build
 * --wait 10`, each running a command named `hold-3334-<k>` that prints `GRANTED <token>` and sleeps ten minutes.
 * Resolves with each holder's pid, grant id and name once all hold, or with null for one that never got its grant.
 */
export async function stillLine(box, { table, home }) {
  const env = { ...box.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), DEEP_THROTTLE_TABLE: table };
  const holders = Array.from({ length: buildLimit() }, (_, k) => {
    const name = `hold-3334-${k + 1}`;
    const child = start(box, [process.execPath, THROTTLE, 'build', '--wait', '10', '--', '/bin/sh', '-c', 'echo "GRANTED $DEEP_THROTTLE"; exec /bin/sleep 600', name], { env });
    return { child, name };
  });
  return Promise.all(holders.map(async ({ child, name }) => {
    const line = await within(child.line(/^GRANTED build:\S+$/), 2);
    return line ? { pid: child.pid, id: line.slice('GRANTED build:'.length), name, child } : null;
  }));
}
