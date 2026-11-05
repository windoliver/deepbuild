// #1097 AC3: a warn-mode test entry `run:npm publish`, installed through `deep guard add` beside the shipped defaults,
// meets `"$NPM" publish` with the hub up (warn is the hub's: with it away deep-hook applies only fail_closed entries).
// The call is allowed, and the agent is told the entry's reason with "couldn't be read" (Claude Code's
// hookSpecificOutput.additionalContext, as #304's warn shows it). A hub that treats the unknown as block
// (DEEP_HUB_PLANT=unknown-as-block) denies it and fails this test, naming the entry. No call is ever executed.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC3, bashCall, buildDeepHook, cleanup, contextFor, COULDNT_BE_READ, decision, failureOf, guardAdd, guardFile, hook,
  makeHome, must, newSession, preToolUse, seedDefaults, shown, startHub, stopHub, testEntry, type Guard, type Ran,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const NAME = 't-npm-publish';
const LINE = '"$NPM" publish';

interface Seen { guard: Guard; added: Ran; call: Ran }

async function observe(plant?: string): Promise<Seen> {
  const home = makeHome();
  seedDefaults(home);
  const s = newSession(home);
  const guard = testEntry(NAME, { match: 'run:npm publish', mode: 'warn', fail_closed: false });
  const hub = await startHub(home, plant ? { plant } : {});
  try {
    const added = await guardAdd(home, guardFile({ [NAME]: { guard, planted: bashCall('npm publish'), twin: bashCall("echo 'npm publish'") } }));
    must(added.code === 0, `BLOCKED: \`deep guard add\` must install ${NAME} (run:npm publish, warn) before the call: ${shown(added)}`);
    return { guard, added, call: await hook(home, preToolUse(s, bashCall(LINE)), BIN) };
  } finally {
    await stopHub(hub);
  }
}

function judgeAC3(o: Seen): void {
  must(decision(o.call) === 'allow', `${NAME} in warn mode meeting \`${LINE}\` must allow it: ${shown(o.call)}`);
  must(contextFor(o.call).includes(o.guard.reason), `${NAME}: the agent must be told the entry's reason with \`${LINE}\`: ${shown(o.call)}`);
  must(COULDNT_BE_READ.test(contextFor(o.call)), `${NAME}: the reason the agent is told must say "couldn't be read": ${shown(o.call)}`);
}

describe(`AC3 ${AC3} a warn entry meeting an unreadable program allows the call and says it couldn't be read`, () => {
  it(`AC3 ${NAME} (run:npm publish, warn) meeting ${LINE} allows it and tells the agent the reason with "couldn't be read"`, async () => {
    judgeAC3(await observe());
  }, 900_000);

  it('AC3 (wrong program) an engine that treats the unknown as block (DEEP_HUB_PLANT=unknown-as-block) denies it and fails this test, naming the entry', async () => {
    const seen = await observe('unknown-as-block');
    const failure = await failureOf(() => judgeAC3(seen));
    expect(failure, 'the engine that treats the unknown as block must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the entry').toContain(NAME);
    expect(decision(seen.call), `the planted engine denies ${LINE}: ${shown(seen.call)}`).toBe('deny');
  }, 900_000);
});
