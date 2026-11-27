// The machine's build limit for #3240's redraft under #3549: the one `scripts/throttle.mjs` states for this platform
// on its `LIMITS` line. LIMITS isn't exported, so its source text is read; anything but one LIMITS line with one
// `build` key in this platform's branch throws, never a default.
import { readFileSync } from 'node:fs';
import { THROTTLE } from '../3240/helpers.mjs';

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
