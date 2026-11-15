// Issue #2204, written first and blind: a rules.json deep-hook can't read denies a PreToolUse with the hub running as
// it does with it away, and the running hub writes the file again and records it. Every decision below is the real
// deep-hook's (`deep-hook claude-code <event>`, a Bash payload on stdin) against the real hub (`deep hub run`) in a
// temp HOME whose rules.json starts as the shipped first-party entries. The criteria are decided by the `expect`s
// here; controls and setup throw plain BLOCKED or INCONCLUSIVE errors (helpers.ts). README.md has the readings.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC1, AC2, AC3, AC4, AC5, NEWER, NOT_JSON, allEvents, answered, buildDeepHook, cleanup, cutShort, decision, entriesOf, gainUnknownEntry, hook, makeHome, shipped, shown, sleep, startHub, stopHub, words, type Ev, type Home, type Hub, type Ran } from './helpers.ts';

const CALL = 'pkill -f node';
const T = 900_000;

beforeAll(buildDeepHook, 1_900_000);
afterEach(cleanup);

/**
 * A home after setup with the hub running, once the control passes: with the file readable, `pkill -f node` is denied
 * naming no-kill-by-name on a try the hub answered in time (helpers.ts, answered), so the hub answers and has read
 * the readable file. A hub just started is slow at first; it gets 60 tries.
 */
async function running(): Promise<{ h: Home; hub: Hub }> {
  const h = makeHome();
  const hub = await startHub(h);
  for (let tries = 0; tries < 60; tries++) {
    const r = await hook(h, 'PreToolUse', CALL);
    if (decision(r) !== 'deny' || !words(r).includes('no-kill-by-name')) throw Error(`BLOCKED: control: with the shipped rules.json readable and the hub running, \`${CALL}\` must be denied naming no-kill-by-name: ${shown(r)}`);
    if (await answered(hub, r.call)) return { h, hub };
    await sleep(250);
  }
  throw Error('INCONCLUSIVE: the hub answered none of 60 control calls within the hook\'s 50 ms (the machine may be loaded); rerun alone');
}
/** A home whose hub ran and was stopped: nothing answers at its address. */
async function stopped(): Promise<Home> {
  const { h, hub } = await running();
  await stopHub(hub);
  return h;
}
/**
 * The call with the hub running and rules.json just spoiled, on a try that reads "with the hub running": the call
 * was allowed, or it was denied and the hub answered it in time. A denial the hub was late for is what deep-hook
 * does with the hub away, so that try decides nothing; the file is spoiled again and the call made again, 10 times.
 */
async function withHubAnswering(h: Home, hub: Hub, spoil: (h: Home) => void): Promise<Ran> {
  for (let tries = 0; tries < 10; tries++) {
    spoil(h);
    const r = await hook(h, 'PreToolUse', CALL);
    if (decision(r) !== 'deny' || (await answered(hub, r.call))) return r;
  }
  throw Error(`INCONCLUSIVE: the hub was late for all 10 tries of \`${CALL}\`, so none reads "with the hub running" (the machine may be loaded); rerun alone`);
}

describe(`${AC1} hub running, rules.json cut to its first 40 bytes`, () => {
  it(`${AC1} a PreToolUse for \`${CALL}\` is denied, naming rules.json and that it isn't JSON`, async () => {
    const { h, hub } = await running();
    const r = await withHubAnswering(h, hub, cutShort);
    expect(decision(r), `the PreToolUse for \`${CALL}\` with the hub running and rules.json cut to 40 bytes must be denied: ${shown(r)}`).toBe('deny');
    expect(words(r), `the denial of \`${CALL}\` must name rules.json: ${shown(r)}`).toContain('rules.json');
    expect(words(r), `the denial of \`${CALL}\` must say rules.json isn't JSON: ${shown(r)}`).toMatch(NOT_JSON);
  }, T);
});

describe(`${AC2} hub running, a readable rules.json gains one entry whose match is effect:not-a-class`, () => {
  it(`${AC2} a PreToolUse for \`${CALL}\` is denied, naming rules.json and the entry`, async () => {
    const { h, hub } = await running();
    const r = await withHubAnswering(h, hub, gainUnknownEntry);
    expect(decision(r), `the PreToolUse for \`${CALL}\` with the hub running and the entry ${NEWER} (effect:not-a-class) in rules.json must be denied: ${shown(r)}`).toBe('deny');
    expect(words(r), `the denial of \`${CALL}\` must name rules.json: ${shown(r)}`).toContain('rules.json');
    expect(words(r), `the denial of \`${CALL}\` must name the entry ${NEWER}: ${shown(r)}`).toContain(NEWER);
  }, T);
});

describe(`${AC3} hub stopped, each of the two files denies the call, as today`, () => {
  for (const [name, spoil] of [['cut to its first 40 bytes', cutShort], [`with the entry ${NEWER} (effect:not-a-class)`, gainUnknownEntry]] as const) {
    it(`${AC3} rules.json ${name}: a PreToolUse for \`${CALL}\` is denied, naming rules.json`, async () => {
      const h = await stopped();
      spoil(h);
      const r = await hook(h, 'PreToolUse', CALL);
      expect(decision(r), `the PreToolUse for \`${CALL}\` with the hub stopped and rules.json ${name} must be denied: ${shown(r)}`).toBe('deny');
      expect(words(r), `the denial of \`${CALL}\` must name rules.json: ${shown(r)}`).toContain('rules.json');
    }, T);
  }
});

describe(`${AC4} a PostToolUse never waits on rules.json, and a readable file lets ls run`, () => {
  for (const up of [true, false]) {
    const where = up ? 'the hub up' : 'the hub down';
    it(`${AC4} with ${where}: a PostToolUse with the cut file exits 0, and with a readable file \`ls\` runs`, async () => {
      const h = up ? (await running()).h : await stopped();
      const ls = await hook(h, 'PreToolUse', 'ls');
      expect(decision(ls), `with a readable rules.json and ${where}, the PreToolUse for \`ls\` must be allowed: ${shown(ls)}`).toBe('allow');
      cutShort(h);
      const post = await hook(h, 'PostToolUse', 'ls');
      expect(post.code, `the PostToolUse event with rules.json cut to 40 bytes and ${where} must exit 0, not be denied: ${shown(post)}`).toBe(0);
    }, T);
  }
});

describe(`${AC5} hub running, first-party entries installed, the file is cut short`, () => {
  it(`${AC5} the first call is denied naming rules.json, the hub writes every installed entry back and records it once, then \`${CALL}\` is denied by no-kill-by-name and \`ls\` runs`, async () => {
    const installed = shipped().entries;
    // The first call after the cut can't be made twice, so a try the hub was late for is made again on a fresh home.
    let at: { h: Home; hub: Hub; before: number; first: Ran } | undefined;
    for (let tries = 0; tries < 5 && !at; tries++) {
      const { h, hub } = await running();
      const before = (await allEvents(hub)).length;
      cutShort(h);
      const first = await hook(h, 'PreToolUse', CALL);
      if (decision(first) !== 'deny' || (await answered(hub, first.call))) at = { h, hub, before, first };
      else await stopHub(hub);
    }
    if (!at) throw Error(`INCONCLUSIVE: the hub was late for the first call after the cut on 5 fresh homes, so none reads "with the hub running" (the machine may be loaded); rerun alone`);
    const { h, hub, before, first } = at;

    expect.soft(decision(first), `the first call (\`${CALL}\`) after rules.json is cut short must be denied: ${shown(first)}`).toBe('deny');
    expect.soft(words(first), `the first call's denial must name rules.json: ${shown(first)}`).toContain('rules.json');

    // The hub writes the file before it answers; a hook that denied on its own may have exited first, so wait a little.
    const whole = () => { const now = entriesOf(h); return now !== undefined && Object.keys(installed).every((n) => JSON.stringify(now[n]) === JSON.stringify(installed[n])); };
    for (const deadline = Date.now() + 10_000; !whole() && Date.now() < deadline;) await sleep(100);
    const now = entriesOf(h);
    expect.soft(now === undefined ? 'rules.json is still not JSON with an entries object: the hub left the file as it is' : Object.keys(installed).filter((n) => JSON.stringify(now[n]) !== JSON.stringify(installed[n])), 'rules.json must again hold every installed entry, each as it was installed (the entries missing or changed)').toEqual([]);

    const next = await hook(h, 'PreToolUse', CALL);
    expect.soft(decision(next), `the next \`${CALL}\` must be denied: ${shown(next)}`).toBe('deny');
    expect.soft(words(next), `the next \`${CALL}\` must be denied naming no-kill-by-name: ${shown(next)}`).toContain('no-kill-by-name');
    const ls = await hook(h, 'PreToolUse', 'ls');
    expect.soft(decision(ls), `\`ls\` must run once the file is back: ${shown(ls)}`).toBe('allow');

    // One event naming the file, beside the calls' own tool events; counted after all three calls, so a second shows.
    const naming = (events: Ev[]) => events.slice(before).filter((e) => !e.kind.startsWith('tool.') && JSON.stringify(e).includes('rules.json'));
    let events = await allEvents(hub);
    for (const deadline = Date.now() + 10_000; !naming(events).length && Date.now() < deadline;) { await sleep(250); events = await allEvents(hub); }
    await sleep(500);
    events = await allEvents(hub);
    expect.soft(naming(events).map((e) => e.kind), `the record must hold one event naming rules.json after the cut; the kinds recorded since: ${JSON.stringify(events.slice(before).map((e) => e.kind))}`).toHaveLength(1);
  }, T);
});
