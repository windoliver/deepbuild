// #1407 AC3: a normal denial and a normal allow are byte-identical to before. "Before" is the base commit's
// deep-hook, built from its own sources (`git archive` of 2bba2a50 into a temp folder, helpers.ts,
// buildBaseDeepHook); "now" is this checkout's plain build. Each case runs both binaries on byte-for-byte the same
// input, the same HOME path and the same rules.json, hub away (nothing at the address), and compares exit code,
// signal, stdout and stderr exactly, past the one spool line whose presence depends on the disk's timing (helpers.ts,
// steady). The cases: a fail_closed entry that matches (a denial), a call an entry that
// isn't fail_closed matches (an allow), and a call nothing matches (an allow).
//
// On the base this compares the base with itself, so it passes there by construction: it is regression protection.
// Its wrong program is the planted build: with a panic in the matcher its denial can't be the base's, so the same
// comparison must fail on it (on the base that build fails, BLOCKED: the plant is the implementer's to add).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC3, PLANT, buildBaseDeepHook, buildDeepHook, cleanup, decided, entry, failureOf, hook, makeHome, must, shown, steady, type Ran } from './helpers.ts';

let PLAIN: string;
let BASE_BIN: string;
beforeAll(async () => {
  PLAIN = await buildDeepHook();
  BASE_BIN = await buildBaseDeepHook();
}, 1_900_000);
afterEach(cleanup, 60_000);

const RULES = {
  't-closed': entry('t-closed', 'run:gh pr merge', true),
  't-open': entry('t-open', 'run:ls', false),
};
const CASES = [
  { name: 'a normal denial (fail_closed t-closed matches)', command: 'gh pr merge 12', exit: 2 },
  { name: 'a normal allow (t-open, not fail_closed, matches)', command: 'ls -la', exit: 0 },
  { name: 'a normal allow (nothing matches)', command: 'echo hello', exit: 0 },
];

/** Runs `before` then `now` on the same paths and the same input. */
async function both(before: string, now: string, command: string): Promise<{ base: Ran; now: Ran }> {
  const { home, work } = makeHome(RULES);
  const base = await hook(before, home, work, command);
  decided(base, 'the base hook');
  makeHome(RULES, home);
  const after = await hook(now, home, work, command);
  decided(after, 'the hook under test');
  return { base, now: after };
}
function judge(c: (typeof CASES)[number], seen: { base: Ran; now: Ran }): void {
  must(seen.base.code === c.exit, `control: the base must give ${c.name} exit ${c.exit}: ${shown(seen.base)}`);
  const same = seen.now.code === seen.base.code && seen.now.signal === seen.base.signal && seen.now.stdout === seen.base.stdout && steady(seen.now.stderr) === steady(seen.base.stderr);
  must(same, `${c.name} for \`${c.command}\` must be byte-identical to the base's.\n  base: ${shown(seen.base)}\n  now:  ${shown(seen.now)}`);
}

describe(`AC3 ${AC3} a normal denial and a normal allow are byte-identical to the base commit's deep-hook`, () => {
  for (const c of CASES) {
    it(`AC3 ${c.name}: \`${c.command}\`, hub away, exit, stdout and stderr equal the base's`, async () => {
      judge(c, await both(BASE_BIN, PLAIN, c.command));
    }, 1_900_000);
  }

  it('AC3 (wrong program) the plant-matcher-panic build\'s denial is not the base\'s, so the comparison can fail', async () => {
    const planted = await buildDeepHook(PLANT);
    const c = CASES[0]!;
    const failure = await failureOf(async () => judge(c, await both(BASE_BIN, planted, c.command)));
    expect(failure, 'the planted build must fail the byte comparison of the denial').not.toBeNull();
    expect(failure, 'it must fail at the comparison, not the control').toContain('byte-identical');
  }, 1_900_000);
});
