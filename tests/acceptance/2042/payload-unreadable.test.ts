// Issue #2042, written first and blind: on a PreToolUse, with a fail_closed entry installed, a hook payload deep-hook
// can't read is denied by deep-hook itself, naming the payload and why, with the hub stopped and with it running; a
// lone surrogate escape reads as U+FFFD so the call is matched like any other; and with no fail_closed entry, or on a
// PostToolUse, an unreadable payload exits 0 as today. Every decision below is the real deep-hook's
// (`deep-hook claude-code <event>`, the payload's bytes on stdin) against the real hub (`deep hub run`) in a temp HOME
// whose rules.json is the shipped first-party entries. The criteria are decided by the `expect`s here; controls and
// setup throw plain BLOCKED or INCONCLUSIVE errors (helpers.ts). README.md has the readings.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC4, AC5, CUT, DEPTH, EMPTY, PAYLOAD, PUSH, answered, bash, buildDeepHook, cleanup, clearFailClosed, cut40, decision, empty, failClosedIn,
  hook, makeHome, nested, notJson, notUtf8, oversized, oversizedCut, payloadLines, pushEntries, shown, sleep, startHub,
  stopHub, surrogate, words, type Event, type Home, type Hub, type Payload, type Ran,
} from './helpers.ts';

const T = 900_000;
type Make = (h: Home, event?: Event) => Payload;

beforeAll(buildDeepHook, 1_900_000);
afterEach(cleanup);

/**
 * A home after setup with the hub running, once the control passes: a readable PreToolUse for `ls` is allowed on a
 * try the hub answered in time (helpers.ts, answered). A hub just started is slow at first; it gets 60 tries.
 */
async function running(o: { failClosed?: boolean } = {}): Promise<{ h: Home; hub: Hub }> {
  const h = makeHome(o);
  const hub = await startHub(h);
  for (let tries = 0; tries < 60; tries++) {
    const p = bash(h, 'PreToolUse', 'ls');
    const r = await hook(h, 'PreToolUse', p);
    if (decision(r) !== 'allow') throw Error(`BLOCKED: control: with the hub running, a readable \`ls\` must be allowed: ${shown(r)}`);
    if (await answered(hub, p.call)) return { h, hub };
    await sleep(250);
  }
  throw Error('INCONCLUSIVE: the hub answered none of 60 control calls within the hook\'s 50 ms (the machine may be loaded); rerun alone');
}
/** A home whose hub ran, passed the control and was stopped by its PID: nothing answers at its address. */
async function stopped(o: { failClosed?: boolean } = {}): Promise<Home> {
  const { h, hub } = await running(o);
  await stopHub(hub);
  return h;
}
/** Whether the hub answers right now: a readable `ls` it answered in time. */
async function answering(h: Home, hub: Hub): Promise<boolean> {
  const p = bash(h, 'PreToolUse', 'ls');
  const r = await hook(h, 'PreToolUse', p);
  return decision(r) === 'allow' && (await answered(hub, p.call));
}
/**
 * An unreadable payload with the hub running, on a try that reads "with the hub running". The hub can't name an
 * unreadable call in its record, so a try counts when the hub answered a readable control in time just before and
 * just after it; otherwise it is made again, 10 times, then INCONCLUSIVE. `check`, when given, runs just before the
 * payload is fed (a control that throws BLOCKED).
 */
async function withHubAnswering(h: Home, hub: Hub, event: Event, make: Make, check?: () => void): Promise<{ r: Ran; p: Payload }> {
  for (let tries = 0; tries < 10; tries++) {
    if (!(await answering(h, hub))) continue;
    check?.();
    const p = make(h, event);
    const r = await hook(h, event, p);
    if (await answering(h, hub)) return { r, p };
  }
  throw Error(`INCONCLUSIVE: the hub didn't answer the controls around any of 10 tries of the ${event} payload (the machine may be loaded); rerun alone`);
}
/**
 * A readable call with the hub running, as 2204 reads it: an allowed call is judged as it stands, and a denial counts
 * only when the hub answered that call in time (its tool.before isn't late); else it is made again, 10 times.
 */
async function readableWithHubAnswering(h: Home, hub: Hub, make: () => Payload): Promise<{ r: Ran; p: Payload }> {
  for (let tries = 0; tries < 10; tries++) {
    const p = make();
    const r = await hook(h, 'PreToolUse', p);
    if (decision(r) !== 'deny' || (await answered(hub, p.call))) return { r, p };
  }
  throw Error('INCONCLUSIVE: the hub was late for all 10 tries, so none reads "with the hub running" (the machine may be loaded); rerun alone');
}

const pushNamed = (r: Ran) => pushEntries().filter((name) => words(r).includes(name));

describe(`${AC1} hub stopped, first-party entries installed: the push payload with a member nested inside 300 arrays`, () => {
  it(`${AC1} the PreToolUse for \`${PUSH}\` with a member nested inside 300 arrays is denied, naming the payload and the depth`, async () => {
    const h = await stopped();
    const p = nested(h);
    const r = await hook(h, 'PreToolUse', p);
    expect(decision(r), `with the hub stopped, ${p.name} must be denied: ${shown(r)}`).toBe('deny');
    expect(words(r), `the denial must name the payload: ${shown(r)}`).toMatch(PAYLOAD);
    expect(words(r), `the denial must name the depth the payload nests past: ${shown(r)}`).toMatch(DEPTH);
  }, T);

  // Scope coverage (Scope bullet 1, "a payload deep-hook can't read is denied"), asked for by the session that started
  // this job: other payloads deep-hook can't read, with the hub stopped.
  for (const [make, why] of [[notJson, undefined], [notUtf8, undefined], [oversizedCut, CUT]] as const) {
    it(`${AC1} scope: with the hub stopped, ${make.name === 'notJson' ? 'a payload that isn\'t JSON' : make.name === 'notUtf8' ? 'a push payload whose bytes aren\'t UTF-8' : 'a 2 MiB push payload cut short'} is denied, naming the payload`, async () => {
      const h = await stopped();
      const p = make(h);
      const r = await hook(h, 'PreToolUse', p);
      expect(decision(r), `with the hub stopped, ${p.name} must be denied: ${shown(r)}`).toBe('deny');
      expect(words(r), `the denial must name the payload: ${shown(r)}`).toMatch(PAYLOAD);
      if (why) expect(words(r), `the denial must say the payload was cut short: ${shown(r)}`).toMatch(why);
    }, T);
  }
});

// Scope coverage: the 2 MiB push payload read whole is a readable call, so the fix must not deny it as unreadable. With
// the hub stopped no shipped fail_closed entry holds a plain push, so "still denied by the push entry" reads as
// "decided as the plain push is" (README, Readings). It passes on the base; its wrong program is a twin (twins.json).
describe(`${AC1} scope: hub stopped, a 2 MiB push payload read whole`, () => {
  it(`${AC1} scope: with the hub stopped, the 2 MiB push payload read whole is decided as the plain push is, not as unreadable`, async () => {
    const h = await stopped();
    const plain = await hook(h, 'PreToolUse', bash(h, 'PreToolUse', PUSH));
    const p = oversized(h);
    const r = await hook(h, 'PreToolUse', p);
    expect(decision(r), `with the hub stopped, ${p.name} must be decided as the plain push is (${shown(plain)}): ${shown(r)}`).toBe(decision(plain));
    expect(words(r), `${p.name} is readable, so no denial may call it unreadable: ${shown(r)}`).not.toMatch(PAYLOAD);
  }, T);
});

describe(`${AC2} hub stopped: the same payload cut off after its first 40 bytes, and an empty stdin`, () => {
  for (const [make, why, what] of [[cut40, CUT, 'cut short'], [empty, EMPTY, 'empty']] as const) {
    it(`${AC2} ${make === cut40 ? 'the payload cut off after its first 40 bytes' : 'an empty stdin'} is denied, naming the payload as ${what}`, async () => {
      const h = await stopped();
      const p = make(h);
      const r = await hook(h, 'PreToolUse', p);
      expect(decision(r), `with the hub stopped, ${p.name} must be denied: ${shown(r)}`).toBe('deny');
      expect(words(r), `the denial must name the payload: ${shown(r)}`).toMatch(PAYLOAD);
      expect(words(r), `the denial must name the payload as ${what}: ${shown(r)}`).toMatch(why);
    }, T);
  }
});

describe(`${AC3} hub running: each of those three payloads is denied in the same words`, () => {
  const cases: [string, Make, RegExp | undefined, boolean][] = [
    ['the push payload with a member nested inside 300 arrays', nested, DEPTH, false],
    ['the payload cut off after its first 40 bytes', cut40, CUT, false],
    ['an empty stdin', empty, EMPTY, false],
    // Scope coverage, asked for by the session that started this job: the same, hub running.
    ['scope: a payload that isn\'t JSON', notJson, undefined, true],
    ['scope: a push payload whose bytes aren\'t UTF-8', notUtf8, undefined, true],
    ['scope: a 2 MiB push payload cut short', oversizedCut, CUT, true],
  ];
  for (const [what, make, why] of cases) {
    it(`${AC3} ${what}: denied with the hub running, in the words deep-hook uses with it stopped`, async () => {
      const { h, hub } = await running();
      const { r, p } = await withHubAnswering(h, hub, 'PreToolUse', make);
      await stopHub(hub);
      const down = await hook(h, 'PreToolUse', make(h));
      expect(decision(r), `with the hub running, ${p.name} must be denied: ${shown(r)}`).toBe('deny');
      expect(words(r), `the denial must name the payload: ${shown(r)}`).toMatch(PAYLOAD);
      if (why) expect(words(r), `the denial must say why the payload can't be read (${why}): ${shown(r)}`).toMatch(why);
      expect(payloadLines(r), `the denial with the hub running must be in the same words as with it stopped; stopped: ${shown(down)}`).toEqual(payloadLines(down));
    }, T);
  }
});

describe(`${AC4} a lone \\ud800 escape reads as U+FFFD: the push is denied by the push entry, \`ls\` runs`, () => {
  it(`${AC4} with the hub running, \`${PUSH}\` holding "\\ud800" is denied naming the push entry, and \`ls\` holding it runs`, async () => {
    const { h, hub } = await running();
    // Control: the same push written plainly is denied by a push entry in this home, so "the push entry" is one here.
    const plain = await readableWithHubAnswering(h, hub, () => bash(h, 'PreToolUse', PUSH));
    if (decision(plain.r) !== 'deny' || !pushNamed(plain.r).length) throw Error(`BLOCKED: control: with the hub running, a plain \`${PUSH}\` must be denied naming a push entry (${pushEntries().join(', ')}): ${shown(plain.r)}`);
    const push = await readableWithHubAnswering(h, hub, () => surrogate(h, PUSH));
    expect(decision(push.r), `${push.p.name} must be denied: ${shown(push.r)}`).toBe('deny');
    expect(pushNamed(push.r), `the denial must name the push entry, as the plain push's names ${JSON.stringify(pushNamed(plain.r))}: ${shown(push.r)}`).toEqual(pushNamed(plain.r));
    const ls = await readableWithHubAnswering(h, hub, () => surrogate(h, 'ls'));
    expect(decision(ls.r), `${ls.p.name} must run: ${shown(ls.r)}`).toBe('allow');
  }, T);
});

describe(`${AC5} no fail_closed entry, or a PostToolUse: each unreadable payload exits 0 as today`, () => {
  const unreadable: Make[] = [nested, cut40, empty, notJson, notUtf8, oversizedCut];
  // Control for the no-fail_closed homes: rules.json, read just before each payload is fed, holds no fail_closed entry.
  const noneInstalled = (h: Home) => () => {
    const on = failClosedIn(h);
    if (on === undefined || on.length) throw Error(`BLOCKED: control: rules.json must hold no fail_closed entry when the payload is fed; it holds ${on === undefined ? 'no readable entries' : on.join(', ')}`);
  };
  const exits = async (h: Home, event: Event, hub?: Hub, check?: () => void) => {
    const wrong: string[] = [];
    for (const make of unreadable) {
      const { r, p } = hub ? await withHubAnswering(h, hub, event, make, check) : await (async () => { check?.(); const p = make(h, event); return { r: await hook(h, event, p), p }; })();
      if (r.code !== 0) wrong.push(`${event}: ${p.name} exited ${r.code}, stderr ${JSON.stringify(r.stderr.slice(0, 200))}`);
    }
    return wrong;
  };
  for (const up of [false, true]) {
    const where = up ? 'the hub running' : 'the hub stopped';
    it(`${AC5} with no fail_closed entry installed and ${where}, each unreadable PreToolUse payload exits 0`, async () => {
      // The hub installs a fail_closed entry of its own when it starts, so the file is cleared again once it has.
      const at = up ? await running({ failClosed: false }) : { h: await stopped({ failClosed: false }), hub: undefined };
      clearFailClosed(at.h);
      const wrong = await exits(at.h, 'PreToolUse', at.hub, noneInstalled(at.h));
      expect(wrong, `with no fail_closed entry installed and ${where}, each unreadable PreToolUse payload must exit 0; these didn't: ${wrong.join('; ')}`).toEqual([]);
    }, T);
    it(`${AC5} with the first-party entries installed and ${where}, each unreadable PostToolUse payload exits 0`, async () => {
      const at = up ? await running() : { h: await stopped(), hub: undefined };
      const wrong = await exits(at.h, 'PostToolUse', at.hub);
      expect(wrong, `with the fail_closed entries installed and ${where}, each unreadable PostToolUse payload must exit 0; these didn't: ${wrong.join('; ')}`).toEqual([]);
    }, T);
  }
});
