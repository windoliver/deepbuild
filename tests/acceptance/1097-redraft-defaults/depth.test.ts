// #1097 AC2, blind redraft of tests/acceptance/1097/depth.test.ts, run in its place (REDRAFT.md). The right-program
// test is the original's, copied exactly: the checkout's deep-hook on the checkout's defaults denies `pkill node`
// nested 13 deep in `sh -c`, and the 12-deep control, by no-kill-by-name, hub up and stopped. In the wrong-program
// test, deep-hook built from the pinned merge base, a reader that stops at its depth and allows the call, fails the
// criterion, naming the depth. One change from the original: that test's home starts from the merge base's own
// shipped default-rules.json (`seedBaseDefaults`), not the checkout's, which that reader can't read. The scenario,
// the criterion's judge and every assertion and message are the original's. No call here is ever executed.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC2, bashCall, buildBase, buildDeepHook, cleanup, decision, failureOf, hook, makeHome, must, nested, newSession,
  preToolUse, seedDefaults, shown, startHub, stopHub, told, type Ran,
} from '../1097/helpers.ts';
import { seedBaseDefaults } from './base-defaults.ts';

// Copied exactly from the original: the right program, the checkout's deep-hook.
let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

// Copied exactly from tests/acceptance/1097/depth.test.ts.
const ENTRY = 'no-kill-by-name';
const DEEP = nested('pkill node', 13);
const READ = nested('pkill node', 12);
/** How the denial says the line nests past what the reader reads: it nests past, or it names the depth. */
const NESTS_PAST = /nest(s|ed|ing)? past|depth/i;
const PHASES = ['up', 'stopped'] as const;
type Phase = (typeof PHASES)[number];

type Seen = Record<Phase, { deep: Ran; read: Ran }>;

/**
 * The original's `observe`, the first rules.json written by `seed`: the checkout's defaults (`seedDefaults`, as the
 * original) for the right program, the merge base's own (`seedBaseDefaults`) for the merge base's deep-hook.
 */
async function observe(binary: string, seed: (home: string) => void): Promise<Seen> {
  const home = makeHome();
  seed(home);
  const s = newSession(home);
  const pass = async () => ({ deep: await hook(home, preToolUse(s, bashCall(DEEP)), binary), read: await hook(home, preToolUse(s, bashCall(READ)), binary) });
  const hub = await startHub(home);
  const seen = {} as Seen;
  try {
    seen.up = await pass();
  } finally {
    await stopHub(hub);
  }
  seen.stopped = await pass();
  return seen;
}

// Copied exactly from tests/acceptance/1097/depth.test.ts.
function judgeAC2(o: Seen): void {
  for (const phase of PHASES) {
    const { deep, read } = o[phase];
    must(decision(read) === 'deny' && told(read).includes(ENTRY), `the line nesting sh -c 12 deep around pkill node, within the reader's depth, must be denied by ${ENTRY} with the hub ${phase}: ${shown(read)}`);
    must(decision(deep) === 'deny', `the line nesting sh -c 13 deep around pkill node, past the reader's depth of 12, must be denied with the hub ${phase}: ${shown(deep)}`);
    must(told(deep).includes(ENTRY), `the line nesting sh -c 13 deep, past the reader's depth of 12, must be denied by the kill-by-name entry ${ENTRY} with the hub ${phase}: ${shown(deep)}`);
    must(NESTS_PAST.test(told(deep)), `the denial of the line nesting sh -c 13 deep must say it nests past what the reader reads (its depth of 12), with the hub ${phase}: ${shown(deep)}`);
  }
}

describe(`AC2 ${AC2} a line nesting sh -c 13 deep around pkill node is denied by the kill-by-name entry, saying it nests past the reader`, () => {
  // Copied exactly from the original, its seeding passed to `observe` as the original's does it: the right-program
  // test, run here in the original's place (REDRAFT.md).
  it(`AC2 sh -c 13 deep around pkill node (${DEEP.length} characters) is denied by ${ENTRY}, saying it nests past what the reader reads, hub up and stopped`, async () => {
    judgeAC2(await observe(BIN, seedDefaults));
  }, 900_000);

  it('AC2 (wrong program) a reader that stops at its depth and allows the call (deep-hook on the merge base) fails this test, naming the depth (redraft defaults)', async () => {
    const seen = await observe(await buildBase(), seedBaseDefaults);
    const failure = await failureOf(() => judgeAC2(seen));
    expect(failure, 'the reader that stops at its depth must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the depth').toMatch(/depth of 12/);
    for (const phase of PHASES) expect(decision(seen[phase].deep), `the merge base allows the 13-deep line with the hub ${phase}: ${shown(seen[phase].deep)}`).toBe('allow');
  }, 900_000);
});
