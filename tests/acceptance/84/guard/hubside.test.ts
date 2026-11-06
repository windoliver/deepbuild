// #84 AC12: with the hub up, the push, PR and merge defaults deny `gh pr merge 12` in a thread whose ask names no merge
// and allow its twin `echo 'gh pr merge 12'`. The entry that denies it is matched by the guard engine: deep-hook's check
// mode matches it on the call and not on the twin. With the hub stopped the twin is still allowed, since a call is
// matched the same way either way. A hub-side evaluator that matches the command line as plain text
// (DEEP_HUB_PLANT=defaults-match-text) denies the twin with the hub up and fails this test, naming the entry.
import { afterEach, describe, it } from 'vitest';
import {
  AC12, MERGE, bash, cleanup, decision, expectDenied, failureOf, makeWorld, matches, must, shipped, shown, startHub, stopHub, unasked, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const TWIN = "echo 'gh pr merge 12'";
interface Seen { rules: string[]; twin?: string }

async function scenario(seen: Seen, plant?: string): Promise<void> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  let stopped = false;
  try {
    const s = await unasked(hub, w);
    const denied = await expectDenied(hub, s, bash(MERGE), AC12);
    seen.rules = denied.rules;
    const twin = await s.call(bash(TWIN));
    seen.twin = decision(twin.before);
    must(twin.allowed, `${AC12} ${denied.rules.join(', ')}: with the hub up, its twin \`${TWIN}\` must be allowed: ${shown(twin.before)}`);
    const { entries } = shipped();
    const engine = [];
    for (const rule of denied.rules) if (await matches(w, entries[rule]!, bash(MERGE)) && !await matches(w, entries[rule]!, bash(TWIN))) engine.push(rule);
    must(engine.length > 0, `${AC12} the entry that denies \`${MERGE}\` must be matched by the guard engine: deep-hook's check mode must match ${denied.rules.join(', ')} on \`${MERGE}\` and not on \`${TWIN}\``);
    await stopHub(hub);
    stopped = true;
    s.hub = undefined;
    const down = await s.call(bash(TWIN));
    must(down.allowed, `${AC12} ${denied.rules.join(', ')}: with the hub stopped, the twin \`${TWIN}\` must still be allowed: ${shown(down.before)}`);
  } finally {
    if (!stopped) await stopHub(hub);
  }
}

describe(`${AC12} the defaults deny gh pr merge 12 and allow its twin, by the guard engine's match`, () => {
  it(`${AC12} with the hub up ${MERGE} is denied and ${TWIN} allowed, deep-hook's check mode agrees, and with the hub stopped the twin is allowed`, async (ctx) => verdict(ctx, () => scenario({ rules: [] })), 600_000);

  it(`${AC12} (wrong program) a hub-side evaluator that matches the command line as plain text (DEEP_HUB_PLANT=defaults-match-text) denies the twin with the hub up and fails this test, naming the entry`, async (ctx) => verdict(ctx, async () => {
    const seen: Seen = { rules: [] };
    const why = await failureOf(() => scenario(seen, 'defaults-match-text'));
    must(why !== null, `${AC12} the planted evaluator defaults-match-text must fail this test; it passed`);
    must(seen.twin === 'deny', `${AC12} the planted evaluator must deny the twin with the hub up; the twin was ${seen.twin ?? 'never called'}: ${why}`);
    must(seen.rules.some((r) => why.includes(r)), `${AC12} the failure must name the entry (${seen.rules.join(', ')}): ${why}`);
  }), 600_000);
});
