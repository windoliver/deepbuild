// #1407 AC1 and AC2, redrafted blind: a panic while deep-hook rules on a call. The panic is the plant
// plant-matcher-panic, a Cargo feature under which `Call::matches` (matcher.rs) panics whenever called (README, The
// plant). Every hook runs with a temp HOME holding only .deepbuild/rules.json, so the hub is away and only a
// fail_closed entry can deny. Each criterion is decided by the `expect`s below; a setup or control that can't be
// made throws BLOCKED or INCONCLUSIVE instead (helpers.ts), which never reads as a failure at an assertion.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC1, AC2, PLANT, WATCHDOG_WORDS, buildDeepHook, cleanup, decided, entry, hook, makeHome, shown, steady, type Ran } from './helpers.ts';

let PLAIN: string;
beforeAll(async () => { PLAIN = await buildDeepHook(); }, 1_900_000);
afterEach(cleanup);

const CALL = 'gh pr merge 12';
/** Everything a hook's caller reads of its decision, stderr past the spool's timing lines (helpers.ts, steady). */
const outcome = (r: Ran) => ({ exit: r.code, signal: r.signal, stdout: r.stdout, stderr: steady(r.stderr) });

describe(`${AC1} a panic in the matcher with a fail_closed entry that would apply`, () => {
  it(`${AC1} plant-matcher-panic, fail_closed t-closed on run:gh pr merge, hub away: \`${CALL}\` exits 2 with a denial in the watchdog's words, not exit 101`, async () => {
    const rules = { 't-closed': entry('t-closed', 'run:gh pr merge', true) };

    // Control: the entry would apply. The unplanted build denies the same call with the hub away, in t-closed's words.
    const control = makeHome(rules);
    const normal = await hook(PLAIN, control.home, control.work, CALL);
    decided(normal, 'the unplanted hook');
    if (normal.code !== 2 || !normal.stderr.includes(rules['t-closed'].reason)) {
      throw Error(`BLOCKED: control: the unplanted build must deny ${CALL} with the hub away in t-closed's words, so the entry applies: ${shown(normal)}`);
    }

    const planted = await buildDeepHook(PLANT);
    const { home, work } = makeHome(rules);
    const r = await hook(planted, home, work, CALL);
    // Here the watchdog's words are the answer the issue asks for, so a run past 500 ms is judged, not set aside.
    decided(r, 'the planted hook', { watchdogIsLoad: false });
    expect(r.code, `deep-hook must exit 2, the only exit that blocks the call (the base exits 101): ${shown(r)}`).toBe(2);
    expect(steady(r.stderr), `stderr must hold a denial in the watchdog's words: ${shown(r)}`).toMatch(RegExp(`^${WATCHDOG_WORDS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(r.stderr, `stderr must hold the denial, not Rust's panic message: ${shown(r)}`).not.toMatch(/panicked|RUST_BACKTRACE/);
    expect(r.stdout, `stdout must not allow the call: ${shown(r)}`).not.toMatch(/"permissionDecision"\s*:\s*"allow"/);
  }, 1_900_000);
});

describe(`${AC2} a panic in the matcher with no fail_closed entry that applies`, () => {
  // No entry is fail_closed: t-open matches gh pr merge 12, t-other (run:ls) matches neither call. Both entries are
  // matched against each call, so the plant fires. With any fail_closed entry installed, deep-hook can't tell that
  // none applies once its matcher has panicked (README, AC2), so this case installs none.
  const rules = {
    't-open': entry('t-open', 'run:gh pr merge', false),
    't-other': entry('t-other', 'run:ls', false),
  };
  for (const call of [CALL, 'echo hello']) {
    it(`${AC2} plant-matcher-panic, no fail_closed entry, hub away: \`${call}\` is allowed with the exit, stdout and stderr the unplanted build gives it`, async () => {
      const planted = await buildDeepHook(PLANT);
      const { home, work } = makeHome(rules);
      const normal = await hook(PLAIN, home, work, call);
      decided(normal, 'the unplanted hook');
      if (normal.code !== 0) throw Error(`BLOCKED: control: the unplanted build must allow \`${call}\` with the hub away: ${shown(normal)}`);

      makeHome(rules, home); // the same paths, emptied, so both builds see the same bytes
      const r = await hook(planted, home, work, call);
      decided(r, 'the planted hook', { watchdogIsLoad: false });
      expect(outcome(r), `the planted build must allow \`${call}\` as the hub-away path does: ${shown(r)}; unplanted: ${shown(normal)}`).toEqual(outcome(normal));
    }, 1_900_000);
  }
});
