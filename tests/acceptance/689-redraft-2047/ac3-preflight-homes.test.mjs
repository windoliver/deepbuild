// #689 AC3 #689.4283cde6: the preflight's check workload runs with `RUSTUP_HOME` and `CARGO_HOME` set to the user's
// `~/.rustup` and `~/.cargo` when the caller left them unset, and with the caller's own values when set.
// Run: node --test tests/acceptance/689-redraft-2047/ac3-preflight-homes.test.mjs   (README.md beside this file)
//
// The real `scripts/preflight` of this checkout, in a fixture (helpers.mjs, fixturePreflight): the preflight, its timer,
// its check workload (scripts/checks.mjs) and the lane runner of scripts/lanes.mjs with its throttle and lease all run as
// they are; only each check lane's commands are swapped for one probe that writes down the environment it was given and
// fails, so the preflight goes on to no perf and no agent. Every check lane must see the homes: the user's own (from the
// password database, which is also the HOME the preflight is given here) when the caller set neither, and the caller's
// values, untouched, when it set both.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { AC3, MINUTE, NODE, ROOT, USER_HOME, childEnv, fixturePreflight, makeBox, records, shown, withPath } from './helpers.mjs';

const PROBE = (log) => `// #689's probe for one check lane: the homes the check workload gave it, then a failure.
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ lane: process.argv[2], RUSTUP_HOME: process.env.RUSTUP_HOME ?? null, CARGO_HOME: process.env.CARGO_HOME ?? null, HOME: process.env.HOME ?? null }) + '\\n');
console.log('fixture: the probe for ' + process.argv[2] + ' wrote down its environment and fails');
process.exitCode = 1;
`;
const seen = (value) => (value === null ? null : resolve(value));

test(`${AC3} the preflight's check workload runs with RUSTUP_HOME and CARGO_HOME at the user's ~/.rustup and ~/.cargo when the caller left them unset, and at the caller's own values when set`, { timeout: 40 * MINUTE }, async (t) => {
  const box = makeBox(t, 'ac3');
  const { checks } = await import(pathToFileURL(join(ROOT, 'scripts/lanes.mjs')).href);
  const lanes = checks.map(({ name }) => name);
  assert.ok(lanes.length > 0, 'scripts/lanes.mjs exports no check lanes');

  const runOnce = (name, homes) => {
    const log = join(box, `${name}.jsonl`), probe = join(box, `${name}-probe.mjs`);
    writeFileSync(probe, PROBE(log));
    const select = `(all) => all.map(({ paths, ...lane }) => ({ ...lane, commands: [[process.execPath, ${JSON.stringify(probe)}, lane.name]] }))`;
    const env = childEnv({ HOME: USER_HOME, PATH: withPath(dirname(NODE)), ...homes });
    const ran = fixturePreflight(box, name, { select, env, timeout: 30 * MINUTE });
    const got = records(log);
    // The check workload ran: one probe per check lane, as RUN lines and the probes' records both show.
    assert.deepEqual(got.map(({ lane }) => lane), lanes, `the preflight's check workload didn't run each check lane once (${name}). ${shown(ran)}`);
    return { ran, got };
  };

  // The caller left both unset.
  const unset = runOnce('unset', { RUSTUP_HOME: undefined, CARGO_HOME: undefined });
  const user = [resolve(USER_HOME, '.rustup'), resolve(USER_HOME, '.cargo')];
  assert.deepEqual(unset.got.map(({ lane, RUSTUP_HOME, CARGO_HOME }) => [lane, seen(RUSTUP_HOME), seen(CARGO_HOME)]), lanes.map((lane) => [lane, ...user]),
    `with RUSTUP_HOME and CARGO_HOME unset by the caller, each check lane gets [lane, RUSTUP_HOME, CARGO_HOME] other than the user's ${user.join(' and ')}. ${shown(unset.ran)}`);

  // The caller set both, to folders of its own.
  const own = [join(box, 'caller-rustup'), join(box, 'caller-cargo')];
  for (const folder of own) mkdirSync(folder);
  const set = runOnce('set', { RUSTUP_HOME: own[0], CARGO_HOME: own[1] });
  assert.deepEqual(set.got.map(({ lane, RUSTUP_HOME, CARGO_HOME }) => [lane, seen(RUSTUP_HOME), seen(CARGO_HOME)]), lanes.map((lane) => [lane, ...own]),
    `with RUSTUP_HOME and CARGO_HOME set by the caller, each check lane gets [lane, RUSTUP_HOME, CARGO_HOME] other than the caller's ${own.join(' and ')}. ${shown(set.ran)}`);
});
