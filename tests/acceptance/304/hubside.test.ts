// #304 AC3: a test entry in block mode, not fail_closed, is written into rules.json with its mode at install. With the
// hub up it denies its planted call `gh pr merge 12` and allows its twin `echo 'gh pr merge 12'`; with the hub stopped
// it allows both; a fail_closed test entry denies its planted call either way. The hub decides from the entries
// deep-hook says matched and never reads `match` itself: a hub-side evaluator that matches the command line as plain
// text (DEEP_HUB_PLANT=matches-text) denies the twin, and a hub that writes only the fail_closed entries into
// rules.json (DEEP_HUB_PLANT=fail-closed-only-rules) leaves the block entry unmatched; each fails this test.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC3, bashCall, buildDeepHook, cleanup, decision, failureOf, guardAdd, guardFile, holds, hook, makeHome, must,
  newSession, preToolUse, readRules, seedDefaults, shown, startHub, stopHub, testEntry, type Ran, type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const BLOCK = 't-block';
const CLOSED = 't-closed';
const MERGE = 'gh pr merge 12';
const MERGE_TWIN = "echo 'gh pr merge 12'";
const CLOSE = 'gh pr close 12';
const CLOSE_TWIN = "echo 'gh pr close 12'";

interface Calls { blockPlanted: Ran; blockTwin: Ran; closedPlanted: Ran }
interface Seen { block: ReturnType<typeof testEntry>; closed: ReturnType<typeof testEntry>; added: Ran; rules: Rules | undefined; up: Calls; stopped: Calls }

async function observe(plant?: string): Promise<Seen> {
  const home = makeHome();
  seedDefaults(home);
  const s = newSession(home);
  const block = testEntry(BLOCK, { match: 'run:gh pr merge', mode: 'block', fail_closed: false });
  const closed = testEntry(CLOSED, { match: 'run:gh pr close', mode: 'block', fail_closed: true });
  const calls = async (): Promise<Calls> => ({
    blockPlanted: await hook(home, preToolUse(s, bashCall(MERGE)), { binary: BIN }),
    blockTwin: await hook(home, preToolUse(s, bashCall(MERGE_TWIN)), { binary: BIN }),
    closedPlanted: await hook(home, preToolUse(s, bashCall(CLOSE)), { binary: BIN }),
  });
  const hub = await startHub(home, plant ? { plant } : {});
  let added: Ran;
  let up: Calls;
  try {
    added = await guardAdd(home, guardFile({
      [BLOCK]: { guard: block, planted: bashCall(MERGE), twin: bashCall(MERGE_TWIN) },
      [CLOSED]: { guard: closed, planted: bashCall(CLOSE), twin: bashCall(CLOSE_TWIN) },
    }));
    up = await calls();
  } finally {
    await stopHub(hub);
  }
  const rules = readRules(home);
  return { block, closed, added, rules, up, stopped: await calls() };
}

function judgeAC3(o: Seen): void {
  must(o.added.code === 0, `\`deep guard add\` must install ${BLOCK} and ${CLOSED}, exit 0: ${shown(o.added)}`);
  must(holds(o.rules, BLOCK, o.block), `${BLOCK}: the block entry, not fail_closed, must be written into rules.json with its mode: ${JSON.stringify(o.rules?.entries[BLOCK])}`);
  must(holds(o.rules, CLOSED, o.closed), `${CLOSED}: the fail_closed entry must be written into rules.json: ${JSON.stringify(o.rules?.entries[CLOSED])}`);
  must(decision(o.up.blockPlanted) === 'deny', `${BLOCK}: with the hub up, its planted call \`${MERGE}\` must be denied: ${shown(o.up.blockPlanted)}`);
  must(decision(o.up.blockTwin) === 'allow', `${BLOCK}: with the hub up, its twin \`${MERGE_TWIN}\` must be allowed: ${shown(o.up.blockTwin)}`);
  must(decision(o.up.closedPlanted) === 'deny', `${CLOSED}: with the hub up, its planted call \`${CLOSE}\` must be denied: ${shown(o.up.closedPlanted)}`);
  must(decision(o.stopped.blockPlanted) === 'allow', `${BLOCK}: with the hub stopped, its planted call \`${MERGE}\` must be allowed (it isn't fail_closed): ${shown(o.stopped.blockPlanted)}`);
  must(decision(o.stopped.blockTwin) === 'allow', `${BLOCK}: with the hub stopped, its twin \`${MERGE_TWIN}\` must be allowed: ${shown(o.stopped.blockTwin)}`);
  must(decision(o.stopped.closedPlanted) === 'deny', `${CLOSED}: with the hub stopped, its planted call \`${CLOSE}\` must still be denied: ${shown(o.stopped.closedPlanted)}`);
}

describe(`AC3 ${AC3} a block entry is decided by the hub from deep-hook's match, and a fail_closed one holds either way`, () => {
  it(`AC3 ${BLOCK} is written into rules.json with its mode, denies ${MERGE} and allows its twin with the hub up, allows both with it stopped; ${CLOSED} denies its planted call either way`, async () => {
    judgeAC3(await observe());
  }, 900_000);

  it('AC3 (wrong program) a hub-side evaluator that matches the command line as plain text (DEEP_HUB_PLANT=matches-text) denies the twin with the hub up and fails this test, naming the entry', async () => {
    const seen = await observe('matches-text');
    const failure = await failureOf(() => judgeAC3(seen));
    expect(failure, 'the text-matching hub must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the entry').toContain(BLOCK);
    expect(decision(seen.up.blockTwin), `the text-matching hub denies the twin with the hub up: ${shown(seen.up.blockTwin)}`).toBe('deny');
  }, 900_000);

  it('AC3 (wrong program) a rules.json holding only the fail_closed entries (DEEP_HUB_PLANT=fail-closed-only-rules) leaves the block entry unmatched with the hub up and fails this test, naming the entry', async () => {
    const seen = await observe('fail-closed-only-rules');
    const failure = await failureOf(() => judgeAC3(seen));
    expect(failure, 'the hub that writes only fail_closed entries must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the entry').toContain(BLOCK);
    expect(seen.rules?.entries[BLOCK], 'the planted hub leaves the block entry out of rules.json').toBeUndefined();
    expect(decision(seen.up.blockPlanted), `with the block entry missing from rules.json, its planted call goes through with the hub up: ${shown(seen.up.blockPlanted)}`).toBe('allow');
  }, 900_000);
});
