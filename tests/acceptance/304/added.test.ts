// #304 AC1: a fail_closed entry you add, no `terraform apply` in the shop repo, is copied into rules.json by the hub
// at install and then denies `terraform apply` there with the hub stopped, with the same deep-hook binary (no new
// build), while its twin `terraform plan` is allowed. `terraform apply` creates a cloud resource, so the shipped
// default no-unnamed-cloud-resource denies it with the hub away too: the decision alone can't show which entry held
// the call. What shows the added entry holds it is its own words in the denial, the reason and next step you wrote,
// which carry a token nothing compiled can know. The wrong program is a deep-hook with the rule compiled in and read
// from no rules.json (cargo feature plant-compiled-rule): its denial can't carry the words you wrote.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, bashCall, buildDeepHook, cleanup, decision, denialText, failureOf, guardAdd, guardFile, holds, hook, makeHome,
  must, newSession, preToolUse, readRules, seedDefaults, sha256, shown, startHub, stopHub, tempDir, testEntry,
  type Ran, type Rules,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const NAME = 'no-terraform-apply-shop';

interface Seen {
  guard: ReturnType<typeof testEntry>;
  added: Ran;
  rules: Rules | undefined;
  apply: Ran;
  plan: Ran;
  binaryBefore: string;
  binaryAfter: string;
}

/** The flow: the shop repo; the entry added with the hub up; then the hub stopped and the planted call and twin run there. */
async function observe(binary: string): Promise<Seen> {
  const home = makeHome();
  seedDefaults(home);
  const shop = join(tempDir(), 'shop');
  mkdirSync(shop);
  const s = newSession(home, shop);
  const binaryBefore = sha256(binary);
  const guard = testEntry(NAME, { match: 'run:terraform apply', fail_closed: true, mode: 'block' });
  const hub = await startHub(home);
  let added: Ran;
  try {
    added = await guardAdd(home, guardFile({ [NAME]: { guard, planted: bashCall('terraform apply'), twin: bashCall('terraform plan') } }));
  } finally {
    await stopHub(hub);
  }
  const rules = readRules(home);
  const apply = await hook(home, preToolUse(s, bashCall('terraform apply', shop)), { binary });
  const plan = await hook(home, preToolUse(s, bashCall('terraform plan', shop)), { binary });
  return { guard, added, rules, apply, plan, binaryBefore, binaryAfter: sha256(binary) };
}

function judgeAC1(o: Seen): void {
  must(o.added.code === 0, `${NAME}: \`deep guard add\` must install the entry, exit 0: ${shown(o.added)}`);
  must(holds(o.rules, NAME, o.guard), `${NAME}: the hub must copy the entry into rules.json as written, its mode and fail_closed included: ${JSON.stringify(o.rules?.entries[NAME])}`);
  must(decision(o.apply) === 'deny', `${NAME}: \`terraform apply\` in the shop repo must be denied with the hub stopped: ${shown(o.apply)}`);
  const text = denialText(o.apply);
  must(text.includes(o.guard.reason) && text.includes(o.guard.next_step), `${NAME}: the denial must carry the added entry's reason and next step, so it is this entry, read from rules.json, that holds the call: ${shown(o.apply)}`);
  must(decision(o.plan) === 'allow', `${NAME}: its twin \`terraform plan\` must be allowed: ${shown(o.plan)}`);
  must(o.binaryBefore === o.binaryAfter, `${NAME}: the denial must come from the same deep-hook binary, with no new build (sha256 ${o.binaryBefore} then ${o.binaryAfter})`);
}

describe(`AC1 ${AC1} a fail_closed entry you add is copied into rules.json and holds with the hub stopped, with no new deep-hook build`, () => {
  it('AC1 no terraform apply in the shop repo: added through the hub, copied into rules.json, denies terraform apply with the hub stopped and allows terraform plan', async () => {
    judgeAC1(await observe(BIN));
  }, 900_000);

  it('AC1 (wrong program) a rule compiled into deep-hook (plant-compiled-rule) fails this test', async () => {
    const plant = await buildDeepHook({ features: ['plant-compiled-rule'] });
    const seen = await observe(plant);
    const failure = await failureOf(() => judgeAC1(seen));
    expect(failure, 'the deep-hook with the rule compiled in must fail the criterion').not.toBeNull();
    expect(decision(seen.apply), `the compiled rule denies terraform apply: ${shown(seen.apply)}`).toBe('deny');
    expect(denialText(seen.apply), 'the compiled rule\'s denial carries none of the words you wrote').not.toContain(seen.guard.reason);
  }, 900_000);
});
