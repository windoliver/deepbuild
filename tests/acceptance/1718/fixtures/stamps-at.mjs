// The planted canvas core of #1718's criterion 3: a `deep-show` that stamps `at` again. It runs the real binary with
// the same arguments; on `deep-show canvas` it puts an arrival time `at` on every call line the hub sends, except
// deep_query, geometry and fn, as the merge base's CanvasSide::scenario does (crates/deep-show/src/main.rs: the
// call's index from 1 times ten frames at 120 Hz, in flicks), and appends one line per stamp to <log>. World lines
// and replies pass through unchanged. Only tests/acceptance/1718 installs it, in place of an installed tree's
// canvas core (helpers.ts, plantStampsAt).
//   node stamps-at.mjs <real deep-show> <log> <deep-show's arguments...>
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [real, log, ...args] = process.argv.slice(2);
const SPACING = 10 * (705_600_000 / 120);
const UNSTAMPED = new Set(['deep_query', 'geometry', 'fn']);
const canvas = args[0] === 'canvas';
const child = spawn(real, args, { stdio: [canvas ? 'pipe' : 'inherit', 'inherit', 'inherit'] });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));

if (canvas) {
  let calls = 0;
  createInterface({ input: process.stdin })
    .on('line', (line) => {
      let out = line;
      try {
        const value = JSON.parse(line);
        const call = value?.call;
        if (call && typeof call === 'object' && !Array.isArray(call)) {
          calls += 1;
          if (!UNSTAMPED.has(call.call)) {
            call.at = calls * SPACING;
            appendFileSync(log, `${JSON.stringify({ call: call.call, op: call.op ?? null, at: call.at })}\n`);
            out = JSON.stringify(value);
          }
        }
      } catch { /* not JSON: passed on as it came */ }
      child.stdin.write(`${out}\n`);
    })
    .on('close', () => child.stdin.end());
}
