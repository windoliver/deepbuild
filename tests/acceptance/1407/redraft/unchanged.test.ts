// #1407 AC3, redrafted blind: a normal denial and a normal allow are byte-identical to before. "Before" is the base
// commit's deep-hook built from its own sources (helpers.ts, buildBaseDeepHook); "now" is this checkout's plain
// build. Each case runs both on the same HOME path, rules.json and payload bytes, hub away, and compares exit code,
// signal, stdout and stderr exactly, but for the spool's timing lines (helpers.ts, steady). On the base this compares
// the base with itself and passes: it is regression protection, proven on a wrong program twins.json names (README).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC3, buildBaseDeepHook, buildDeepHook, cleanup, decided, entry, hook, makeHome, shown, steady, type Guard, type Ran } from './helpers.ts';

let NOW: string;
let BEFORE: string;
beforeAll(async () => {
  NOW = await buildDeepHook();
  BEFORE = await buildBaseDeepHook();
}, 1_900_000);
afterEach(cleanup);

const WITH_FAIL_CLOSED = {
  't-closed': entry('t-closed', 'run:gh pr merge', true),
  't-open': entry('t-open', 'run:ls', false),
};
const WITHOUT_FAIL_CLOSED = { 't-open': entry('t-open', 'run:gh pr merge', false) };
const CASES: { name: string; rules: Record<string, Guard>; command: string; exit: number }[] = [
  { name: 'a normal denial (fail_closed t-closed matches)', rules: WITH_FAIL_CLOSED, command: 'gh pr merge 12', exit: 2 },
  { name: 'a normal allow (t-open, not fail_closed, matches; t-closed is installed)', rules: WITH_FAIL_CLOSED, command: 'ls -la', exit: 0 },
  { name: 'a normal allow (nothing matches; t-closed is installed)', rules: WITH_FAIL_CLOSED, command: 'echo hello', exit: 0 },
  { name: 'a normal allow (t-open matches; no fail_closed entry is installed)', rules: WITHOUT_FAIL_CLOSED, command: 'gh pr merge 12', exit: 0 },
];
const outcome = (r: Ran) => ({ exit: r.code, signal: r.signal, stdout: r.stdout, stderr: steady(r.stderr) });

describe(`${AC3} a normal denial and a normal allow are byte-identical to the base commit's deep-hook`, () => {
  for (const c of CASES) {
    it(`${AC3} ${c.name}: \`${c.command}\`, hub away, exit, stdout and stderr equal the base's`, async () => {
      const { home, work } = makeHome(c.rules);
      const before = await hook(BEFORE, home, work, c.command);
      decided(before, 'the base hook');
      if (before.code !== c.exit) throw Error(`BLOCKED: control: the base must give ${c.name} exit ${c.exit}: ${shown(before)}`);
      makeHome(c.rules, home); // the same paths, emptied
      const now = await hook(NOW, home, work, c.command);
      decided(now, 'the hook under test');
      expect(outcome(now), `${c.name} must be byte-identical to the base's: ${shown(now)}; base: ${shown(before)}`).toEqual(outcome(before));
    }, 1_900_000);
  }
});
