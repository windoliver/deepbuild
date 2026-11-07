// #1407 AC1 and AC2: a panic while deep-hook rules on a call. The panic is planted in the matcher by the Cargo
// feature plant-matcher-panic (README, The plant): `Call::matches` panics when it matches a call. Every hook runs
// with a temp HOME that has no hub, so this is the hub-away path, where only a fail_closed entry denies.
//
// AC1: with a fail_closed entry that applies to the call (`run:gh pr merge`, the call `gh pr merge 12`), the planted
// build must exit 2 and print a denial in the watchdog's words, with no Rust panic text. On the base the plant's
// build fails (the feature doesn't exist); a base deep-hook with the same panic hand-planted exits 101 with the
// panic message and no denial (BASE-FAILURE.txt).
//
// AC2: with rules.json holding only entries that aren't fail_closed (one of them matching the call), the planted
// build must allow the call exactly as the unplanted build allows it with the hub down: same exit code, stdout and
// stderr for the same input on the same paths.
import { afterEach, beforeAll, describe, it } from 'vitest';
import { AC1, AC2, PLANT, buildDeepHook, cleanup, decided, entry, hook, makeHome, must, shown, steady, type Ran } from './helpers.ts';

let PLAIN: string;
beforeAll(async () => { PLAIN = await buildDeepHook(); }, 1_900_000);
afterEach(cleanup, 60_000);

const CALL = 'gh pr merge 12';
/** The watchdog's line for a call it couldn't read and match in time (main.rs, `watchdog`); the issue asks for its wording. */
const WATCHDOG_WORDS = "couldn't read this call and check it against the guards";
const allowsInStdout = (r: Ran) => /"permissionDecision"\s*:\s*"allow"/.test(r.stdout);

describe(`AC1 ${AC1} a panic in the matcher with a fail_closed entry that applies denies the call: exit 2 and a denial, not exit 101`, () => {
  it('AC1 plant-matcher-panic, a fail_closed entry for gh pr merge, hub away: gh pr merge 12 exits 2 with the watchdog\'s denial and no panic text', async () => {
    const rules = { 't-closed': entry('t-closed', 'run:gh pr merge', true) };

    // The entry applies: the unplanted build denies the same call with the hub away, in the entry's own words.
    const control = makeHome(rules);
    const normal = await hook(PLAIN, control.home, control.work, CALL);
    decided(normal, 'the unplanted hook');
    must(normal.code === 2 && normal.stderr.includes(rules['t-closed'].reason), `control: the unplanted build must deny ${CALL} with the hub away, naming t-closed's reason, so the entry applies: ${shown(normal)}`);

    const planted = await buildDeepHook(PLANT);
    const { home, work } = makeHome(rules);
    const r = await hook(planted, home, work, CALL);
    decided(r, 'the planted hook');
    must(r.code === 2, `with a panic in the matcher and a fail_closed entry that applies, deep-hook must exit 2 (only exit 2 blocks the call; the base exits 101): ${shown(r)}`);
    must(steady(r.stderr).startsWith('DeepBuild blocked this:'), `the denial must be printed on stderr, starting "DeepBuild blocked this:" (past the spool's timing line, if any): ${shown(r)}`);
    must(r.stderr.includes(WATCHDOG_WORDS), `the denial must use the watchdog's wording ("${WATCHDOG_WORDS}"): ${shown(r)}`);
    must(!r.stderr.includes('panicked at'), `stderr must hold the denial, not Rust's panic message: ${shown(r)}`);
    must(!allowsInStdout(r), `stdout must not allow the call: ${shown(r)}`);
  }, 1_900_000);
});

describe(`AC2 ${AC2} a panic in the matcher with no fail_closed entry that applies allows the call as the hub-away path does`, () => {
  // Only entries that aren't fail_closed: one matches gh pr merge 12, one matches ls. With the hub away neither may
  // deny, so the unplanted build allows both calls; the planted build must give the same bytes.
  const rules = {
    't-open': entry('t-open', 'run:gh pr merge', false),
    't-other': entry('t-other', 'run:ls', false),
  };
  for (const call of [CALL, 'echo hello']) {
    it(`AC2 plant-matcher-panic, no fail_closed entry, hub away: \`${call}\` is allowed byte for byte as the unplanted build allows it`, async () => {
      const planted = await buildDeepHook(PLANT);
      const { home, work } = makeHome(rules);
      const normal = await hook(PLAIN, home, work, call);
      decided(normal, 'the unplanted hook');
      must(normal.code === 0 && !normal.stderr.includes('DeepBuild blocked this'), `control: the unplanted build must allow \`${call}\` with the hub away: ${shown(normal)}`);

      makeHome(rules, home); // the same paths, emptied, so both runs see the same bytes
      const r = await hook(planted, home, work, call);
      decided(r, 'the planted hook');
      must(!r.stderr.includes('panicked at'), `stderr must not hold Rust's panic message: ${shown(r)}`);
      must(r.code === normal.code, `the planted build must exit as the hub-away allow does (${normal.code}): ${shown(r)}`);
      must(r.stdout === normal.stdout, `stdout must equal the hub-away allow's ${JSON.stringify(normal.stdout)}: ${shown(r)}`);
      must(steady(r.stderr) === steady(normal.stderr), `stderr must equal the hub-away allow's ${JSON.stringify(normal.stderr)}, past the spool's timing line (helpers.ts, steady): ${shown(r)}`);
    }, 1_900_000);
  }
});
