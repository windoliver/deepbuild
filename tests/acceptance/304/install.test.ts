// #304 AC4: at install the hub runs each entry's planted call and twin through deep-hook's check mode. An entry whose
// planted call its `match` lets through, and one whose twin it denies, are each refused, naming the entry and the
// call, and neither reaches rules.json; a sound entry installed the same way does (the control). A hub that installs
// entries without running them (DEEP_HUB_PLANT=installs-unchecked) fails this test.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC4, bashCall, cleanup, failureOf, guardAdd, guardFile, holds, makeHome, must, readRules, seedDefaults, shown,
  startHub, stopHub, testEntry, type Ran, type Rules,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LEAKY = 't-leaky';
const GREEDY = 't-greedy';
const GOOD = 't-good';
const LEAKY_PLANTED = 'terraform apply';
const GREEDY_TWIN = "echo 'gh pr merge 12'";

interface Seen { good: ReturnType<typeof testEntry>; addGood: Ran; addLeaky: Ran; addGreedy: Ran; rules: Rules | undefined }

async function observe(plant?: string): Promise<Seen> {
  const home = makeHome();
  seedDefaults(home);
  // Its match is `terraform destroy`, so its planted call `terraform apply` goes through.
  const leaky = testEntry(LEAKY, { match: 'run:terraform destroy' });
  // Its match reads the whole command line as text, so it denies its twin, which only mentions the merge.
  const greedy = testEntry(GREEDY, { match: 'shell:*gh pr merge*' });
  const good = testEntry(GOOD, { match: 'run:gh pr merge' });
  const hub = await startHub(home, plant ? { plant } : {});
  try {
    const addLeaky = await guardAdd(home, guardFile({ [LEAKY]: { guard: leaky, planted: bashCall(LEAKY_PLANTED), twin: bashCall('terraform plan') } }));
    const addGreedy = await guardAdd(home, guardFile({ [GREEDY]: { guard: greedy, planted: bashCall('gh pr merge 12'), twin: bashCall(GREEDY_TWIN) } }));
    const addGood = await guardAdd(home, guardFile({ [GOOD]: { guard: good, planted: bashCall('gh pr merge 12'), twin: bashCall(GREEDY_TWIN) } }));
    return { good, addGood, addLeaky, addGreedy, rules: readRules(home) };
  } finally {
    await stopHub(hub);
  }
}

const said = (r: Ran) => `${r.stdout}\n${r.stderr}`;

function judgeAC4(o: Seen): void {
  must(o.addGood.code === 0, `${GOOD} (the control): an entry whose planted call is denied and twin allowed must install, exit 0: ${shown(o.addGood)}`);
  must(holds(o.rules, GOOD, o.good), `${GOOD} (the control): an installed entry must reach rules.json: ${JSON.stringify(o.rules?.entries[GOOD])}`);
  must(o.addLeaky.code === 1, `${LEAKY}: an entry whose planted call \`${LEAKY_PLANTED}\` its match lets through must be refused at install, exit 1: ${shown(o.addLeaky)}`);
  must(said(o.addLeaky).includes(LEAKY) && said(o.addLeaky).includes(LEAKY_PLANTED), `${LEAKY}: the refusal must name the entry and the call \`${LEAKY_PLANTED}\`: ${shown(o.addLeaky)}`);
  must(o.addGreedy.code === 1, `${GREEDY}: an entry whose twin \`${GREEDY_TWIN}\` its match denies must be refused at install, exit 1: ${shown(o.addGreedy)}`);
  must(said(o.addGreedy).includes(GREEDY) && said(o.addGreedy).includes(GREEDY_TWIN), `${GREEDY}: the refusal must name the entry and the call \`${GREEDY_TWIN}\`: ${shown(o.addGreedy)}`);
  must(o.rules?.entries[LEAKY] === undefined, `${LEAKY}: a refused entry must not reach rules.json: ${JSON.stringify(o.rules?.entries[LEAKY])}`);
  must(o.rules?.entries[GREEDY] === undefined, `${GREEDY}: a refused entry must not reach rules.json: ${JSON.stringify(o.rules?.entries[GREEDY])}`);
}

describe(`AC4 ${AC4} an entry whose planted call goes through, or whose twin is denied, is refused at install`, () => {
  it(`AC4 ${LEAKY} and ${GREEDY} are each refused, naming the entry and the call, and neither reaches rules.json; ${GOOD} installs`, async () => {
    judgeAC4(await observe());
  }, 900_000);

  it('AC4 (wrong program) a hub that installs entries without running them (DEEP_HUB_PLANT=installs-unchecked) fails this test', async () => {
    const seen = await observe('installs-unchecked');
    const failure = await failureOf(() => judgeAC4(seen));
    expect(failure, 'the hub that installs unchecked must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the entry let in').toMatch(new RegExp(`${LEAKY}|${GREEDY}`));
    expect(seen.addLeaky.code, `the unchecked hub installs ${LEAKY}: ${shown(seen.addLeaky)}`).toBe(0);
  }, 900_000);
});
