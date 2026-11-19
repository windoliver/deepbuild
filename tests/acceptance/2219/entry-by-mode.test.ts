// Issue #2219, written first and blind: an entry deep-hook can't read whole (a `match` it doesn't know, or a field it
// doesn't) stops only what its mode would, with the hub up and with it down, and an entry whose mode it can't read
// still makes the whole rules.json unreadable. Every decision below is the real deep-hook's (`deep-hook claude-code
// PreToolUse`, a Bash payload on stdin) against the real hub (`deep hub run`) in a temp HOME whose rules.json starts as
// the shipped first-party entries and then gains one entry. The criteria are decided by the `expect`s here; controls
// and setup throw plain BLOCKED or INCONCLUSIVE errors (helpers.ts). README.md has the readings.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC1, AC2, AC3, AC4, CLASS_ENTRY, OLDER, STOP_ENTRY, UNTIL_ENTRY, answered, buildDeepHook, cleanup, decision, entry, gain, hook, makeHome, shown, sleep, startHub, stopHub, words, type Home, type Hub, type Ran } from './helpers.ts';

const KILL = 'pkill -f node';
const LS = 'ls';
/** A `match` deep-hook knows that neither call here meets. */
const KNOWN = 'run:terraform apply';
/** The seventh field: a time far ahead, so a reader that took it for an end date would still hold the entry. */
const UNTIL = { until: '2099-01-01T00:00:00Z' };
const T = 900_000;

beforeAll(buildDeepHook, 1_900_000);
afterEach(cleanup);

/**
 * A home after setup with its hub up, once the control passes: with the shipped rules.json readable, `pkill -f node`
 * is denied naming no-kill-by-name on a try the hub answered (helpers.ts, answered), so the hub answers and has read
 * the readable file before it gains an entry. A hub just started is slow at first; it gets 60 tries.
 */
async function running(): Promise<{ h: Home; hub: Hub }> {
  const h = makeHome();
  const hub = await startHub(h);
  for (let tries = 0; tries < 60; tries++) {
    const r = await hook(h, KILL);
    if (decision(r) !== 'deny' || !words(r).includes('no-kill-by-name')) throw Error(`BLOCKED: control: with the shipped rules.json readable and the hub up, \`${KILL}\` must be denied naming no-kill-by-name: ${shown(r)}`);
    if ((await answered(h, hub, r)).yes) return { h, hub };
    await sleep(250);
  }
  throw Error('INCONCLUSIVE: the hub answered none of 60 control calls in time (the machine may be loaded); rerun alone');
}
/** A home whose hub ran, passed the control and was stopped by its PID: nothing answers at its address. */
async function stopped(): Promise<Home> {
  const { h, hub } = await running();
  await stopHub(hub);
  return h;
}
/**
 * A PreToolUse with the hub up, on a try the hub answered: the call is made again until one is, up to 20 tries or 5
 * minutes. A try the hub was late for is what deep-hook does with the hub away, so it decides nothing here, whatever
 * deep-hook did on it.
 */
async function up(h: Home, hub: Hub, command: string): Promise<Ran> {
  const missed = new Set<string>();
  for (let tries = 0, deadline = Date.now() + 300_000; tries < 20 && Date.now() < deadline; tries++) {
    const r = await hook(h, command);
    const took = await answered(h, hub, r);
    if (took.yes) return r;
    missed.add(took.why);
    await sleep(250);
  }
  throw Error(`INCONCLUSIVE: the hub answered no try of \`${command}\` in time (${[...missed].join('; ')}), so none reads "with the hub up" (the machine may be loaded); rerun alone`);
}
/** A PreToolUse with the hub down: one try, since nothing answers. */
const down = (h: Home, command: string): Promise<Ran> => hook(h, command);

describe(`${AC1} a readable rules.json gains an entry in watch mode, not fail_closed, whose match is effect:not-a-class`, () => {
  const watch = entry('effect:not-a-class', 'watch', false);
  it(`${AC1} with the hub up: \`ls\` runs and \`${KILL}\` is denied naming no-kill-by-name`, async () => {
    const { h, hub } = await running();
    gain(h, CLASS_ENTRY, watch);
    const ls = await up(h, hub, LS);
    expect(decision(ls), `with the hub up and the watch entry ${CLASS_ENTRY} (effect:not-a-class) in rules.json, \`ls\` must run: ${shown(ls)}`).toBe('allow');
    const kill = await up(h, hub, KILL);
    expect(decision(kill), `with the hub up and the watch entry in rules.json, \`${KILL}\` must be denied: ${shown(kill)}`).toBe('deny');
    expect(words(kill), `the denial of \`${KILL}\` must name no-kill-by-name: ${shown(kill)}`).toContain('no-kill-by-name');
  }, T);
  it(`${AC1} with the hub down: \`ls\` runs and \`${KILL}\` is denied naming no-kill-by-name`, async () => {
    const h = await stopped();
    gain(h, CLASS_ENTRY, watch);
    const ls = await down(h, LS);
    expect(decision(ls), `with the hub down and the watch entry ${CLASS_ENTRY} (effect:not-a-class) in rules.json, \`ls\` must run: ${shown(ls)}`).toBe('allow');
    const kill = await down(h, KILL);
    expect(decision(kill), `with the hub down and the watch entry in rules.json, \`${KILL}\` must be denied: ${shown(kill)}`).toBe('deny');
    expect(words(kill), `the denial of \`${KILL}\` must name no-kill-by-name: ${shown(kill)}`).toContain('no-kill-by-name');
  }, T);
});

describe(`${AC2} the same entry in block mode and fail_closed`, () => {
  const block = entry('effect:not-a-class', 'block', true);
  it(`${AC2} with the hub up: \`ls\` is denied, naming the entry and that deep-hook is older than it`, async () => {
    const { h, hub } = await running();
    gain(h, CLASS_ENTRY, block);
    const ls = await up(h, hub, LS);
    expect(decision(ls), `with the hub up and the block, fail_closed entry ${CLASS_ENTRY} (effect:not-a-class) in rules.json, \`ls\` must be denied: ${shown(ls)}`).toBe('deny');
    expect(words(ls), `the denial of \`ls\` must name the entry ${CLASS_ENTRY}: ${shown(ls)}`).toContain(CLASS_ENTRY);
    expect(words(ls), `the denial of \`ls\` must say this deep-hook is older than the entry: ${shown(ls)}`).toMatch(OLDER);
  }, T);
  it(`${AC2} with the hub down: \`ls\` is denied, naming the entry and that deep-hook is older than it`, async () => {
    const h = await stopped();
    gain(h, CLASS_ENTRY, block);
    const ls = await down(h, LS);
    expect(decision(ls), `with the hub down and the block, fail_closed entry ${CLASS_ENTRY} (effect:not-a-class) in rules.json, \`ls\` must be denied: ${shown(ls)}`).toBe('deny');
    expect(words(ls), `the denial of \`ls\` must name the entry ${CLASS_ENTRY}: ${shown(ls)}`).toContain(CLASS_ENTRY);
    expect(words(ls), `the denial of \`ls\` must say this deep-hook is older than the entry: ${shown(ls)}`).toMatch(OLDER);
  }, T);
});

describe(`${AC3} an entry with a seventh field until and a match deep-hook knows (${KNOWN}), read the same two ways, by its mode`, () => {
  it(`${AC3} in watch mode, not fail_closed: \`ls\` runs and \`${KILL}\` is denied naming no-kill-by-name, with the hub up and then down`, async () => {
    const { h, hub } = await running();
    gain(h, UNTIL_ENTRY, entry(KNOWN, 'watch', false, UNTIL));
    for (const state of ['up', 'down'] as const) {
      if (state === 'down') await stopHub(hub);
      const ls = state === 'up' ? await up(h, hub, LS) : await down(h, LS);
      expect.soft(decision(ls), `with the hub ${state} and the watch entry ${UNTIL_ENTRY} (a seventh field until) in rules.json, \`ls\` must run: ${shown(ls)}`).toBe('allow');
      const kill = state === 'up' ? await up(h, hub, KILL) : await down(h, KILL);
      expect.soft(decision(kill), `with the hub ${state} and the watch entry in rules.json, \`${KILL}\` must be denied: ${shown(kill)}`).toBe('deny');
      expect.soft(words(kill), `with the hub ${state}, the denial of \`${KILL}\` must name no-kill-by-name: ${shown(kill)}`).toContain('no-kill-by-name');
    }
  }, T);
  it(`${AC3} in block mode and fail_closed: \`ls\` is denied, naming the entry and that deep-hook is older than it, with the hub up and then down`, async () => {
    const { h, hub } = await running();
    gain(h, UNTIL_ENTRY, entry(KNOWN, 'block', true, UNTIL));
    for (const state of ['up', 'down'] as const) {
      if (state === 'down') await stopHub(hub);
      const ls = state === 'up' ? await up(h, hub, LS) : await down(h, LS);
      expect.soft(decision(ls), `with the hub ${state} and the block, fail_closed entry ${UNTIL_ENTRY} (a seventh field until) in rules.json, \`ls\` must be denied: ${shown(ls)}`).toBe('deny');
      expect.soft(words(ls), `with the hub ${state}, the denial of \`ls\` must name the entry ${UNTIL_ENTRY}: ${shown(ls)}`).toContain(UNTIL_ENTRY);
      expect.soft(words(ls), `with the hub ${state}, the denial of \`ls\` must say this deep-hook is older than the entry: ${shown(ls)}`).toMatch(OLDER);
    }
  }, T);
});

describe(`${AC4} an entry whose mode is stop`, () => {
  it(`${AC4} every PreToolUse (\`ls\`, \`${KILL}\`) is denied, naming rules.json, with the hub up and then down, as today`, async () => {
    const { h, hub } = await running();
    gain(h, STOP_ENTRY, entry(KNOWN, 'stop', false));
    for (const state of ['up', 'down'] as const) {
      if (state === 'down') await stopHub(hub);
      for (const command of [LS, KILL]) {
        const r = state === 'up' ? await up(h, hub, command) : await down(h, command);
        expect.soft(decision(r), `with the hub ${state} and the entry ${STOP_ENTRY} (mode stop) in rules.json, \`${command}\` must be denied: ${shown(r)}`).toBe('deny');
        expect.soft(words(r), `with the hub ${state}, the denial of \`${command}\` must name rules.json: ${shown(r)}`).toContain('rules.json');
      }
    }
  }, T);
});
