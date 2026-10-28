// #304 AC7: one test entry, installed in watch, warn and block mode in turn (each in a home and hub of its own), with
// the hub up. Watch records its planted call (the call's tool.before names the entry in data.matched) and allows it;
// warn allows it and shows the agent the entry's reason (Claude Code's hookSpecificOutput.additionalContext); block
// denies it. Its twin passes in all three: allowed, not recorded as a match, and shown no reason. A hub that treats
// warn as block (DEEP_HUB_PLANT=warn-as-block) denies the warned call and fails this test.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC7, bashCall, befores, buildDeepHook, cleanup, contextFor, decision, failureOf, guardAdd, guardFile, holds, hook,
  makeHome, must, newSession, preToolUse, readRules, seedDefaults, shown, startHub, stopHub, testEntry, type Ev,
  type Ran, type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const NAME = 't-mode';
const PLANTED = 'gh pr merge 12';
const TWIN = "echo 'gh pr merge 12'";
const MODES = ['watch', 'warn', 'block'] as const;
type Mode = (typeof MODES)[number];

interface Seen { mode: Mode; guard: ReturnType<typeof testEntry>; added: Ran; rules: Rules | undefined; planted: Ran; twin: Ran; plantedBefore?: Ev; twinBefore?: Ev }

async function observeMode(mode: Mode, plant?: string): Promise<Seen> {
  const home = makeHome();
  seedDefaults(home);
  const s = newSession(home);
  const guard = testEntry(NAME, { match: 'run:gh pr merge', mode, fail_closed: false });
  const hub = await startHub(home, plant ? { plant } : {});
  try {
    const added = await guardAdd(home, guardFile({ [NAME]: { guard, planted: bashCall(PLANTED), twin: bashCall(TWIN) } }));
    const rules = readRules(home);
    const p = preToolUse(s, bashCall(PLANTED));
    const t = preToolUse(s, bashCall(TWIN));
    const planted = await hook(home, p, { binary: BIN });
    const twin = await hook(home, t, { binary: BIN });
    const found = await befores(hub, [p.tool_use_id, t.tool_use_id]);
    const pb = found.get(p.tool_use_id);
    const tb = found.get(t.tool_use_id);
    return { mode, guard, added, rules, planted, twin, ...(pb ? { plantedBefore: pb } : {}), ...(tb ? { twinBefore: tb } : {}) };
  } finally {
    await stopHub(hub);
  }
}
const observe = async (plant?: string): Promise<Seen[]> => {
  const out: Seen[] = [];
  for (const mode of MODES) out.push(await observeMode(mode, plant));
  return out;
};

const matchedIn = (e: Ev | undefined) => Array.isArray(e?.data.matched) && (e!.data.matched as unknown[]).includes(NAME);

function judgeAC7(all: Seen[]): void {
  for (const o of all) {
    const who = `${NAME} in ${o.mode} mode`;
    must(o.added.code === 0, `${who}: \`deep guard add\` must install it, exit 0: ${shown(o.added)}`);
    must(holds(o.rules, NAME, o.guard), `${who}: rules.json must hold it with its mode: ${JSON.stringify(o.rules?.entries[NAME])}`);
    must(decision(o.twin) === 'allow', `${who}: its twin \`${TWIN}\` must pass, allowed: ${shown(o.twin)}`);
    must(!matchedIn(o.twinBefore), `${who}: its twin must not be recorded as a match: ${JSON.stringify(o.twinBefore?.data)}`);
    must(!contextFor(o.twin).includes(o.guard.reason), `${who}: its twin must be shown no reason: ${shown(o.twin)}`);
    switch (o.mode) {
      case 'watch':
        must(decision(o.planted) === 'allow', `${who}: its planted call \`${PLANTED}\` must be allowed: ${shown(o.planted)}`);
        must(matchedIn(o.plantedBefore), `${who}: its planted call must be recorded, its tool.before naming ${NAME} in matched: ${JSON.stringify(o.plantedBefore?.data)}`);
        break;
      case 'warn':
        must(decision(o.planted) === 'allow', `${who}: its planted call \`${PLANTED}\` must be allowed: ${shown(o.planted)}`);
        must(contextFor(o.planted).includes(o.guard.reason), `${who}: the agent must be shown the entry's reason with its planted call: ${shown(o.planted)}`);
        break;
      case 'block':
        must(decision(o.planted) === 'deny', `${who}: its planted call \`${PLANTED}\` must be denied: ${shown(o.planted)}`);
        break;
    }
  }
}

describe(`AC7 ${AC7} watch records and allows, warn allows and shows the reason, block denies; the twin passes in all three`, () => {
  it(`AC7 ${NAME} in watch, warn and block mode in turn, with the hub up: its planted call ${PLANTED} recorded and allowed, allowed with the reason shown, denied; its twin passes each time`, async () => {
    judgeAC7(await observe());
  }, 900_000);

  it('AC7 (wrong program) a hub that treats warn as block (DEEP_HUB_PLANT=warn-as-block) denies the warned call and fails this test', async () => {
    const seen = await observe('warn-as-block');
    const failure = await failureOf(() => judgeAC7(seen));
    expect(failure, 'the hub that treats warn as block must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the entry in warn mode').toContain(`${NAME} in warn mode`);
    expect(decision(seen.find((o) => o.mode === 'warn')!.planted), 'the planted hub denies the warned call').toBe('deny');
  }, 900_000);
});
