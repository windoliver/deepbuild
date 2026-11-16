// #2324 AC2: sandbox@1's kit gives the same results on macOS arm64, on Linux x86_64 and in headless Chrome as #238
// recorded: every fixture's result, trap kind and fuel count. A host that can't run is BLOCKED, naming it.
//
// "As #238 recorded" is fixtures/base-kit.json: the merge base's kit cases, and the fuel each fixture that ends is
// charged (the least budget under which its run doesn't trap fuel). On macOS arm64 the kit runs in deep-sandbox and in
// the app (deep-show `full`); on Linux x86_64 in deep-sandbox in a linux/amd64 container; in headless Chrome as
// `kit_plan`'s requests through the web runner. A host that can't run fails `BLOCKED:`, naming it.
import { describe, expect, it } from 'vitest';
import {
  AC, BASE_KIT, KIT_CALL, S, TIMEOUT, appKit, deepShow, fuelCalls, fuelDiffs, kitDiffs, none, onLinux, type JsonObject,
} from './helpers.ts';

S.prebuild(() => { S.macSandbox(); deepShow(['full']); });
const temp = S.useTemp();

/** A kit_plan request with `fuel` in place of its budget's. */
const withFuel = (request: JsonObject, fuel: number): JsonObject => ({ ...request, budget: { ...S.obj(request['budget'], 'kit_plan request budget'), fuel } });

describe(`${AC[2]} sandbox@1's kit gives #238's results on macOS arm64, Linux x86_64 and headless Chrome`, () => {
  it(`${AC[2]} every kit fixture's result, trap kind and fuel count is the one #238 recorded, in deep-sandbox and the app on macOS arm64, on Linux x86_64 and in headless Chrome`, async () => {
    const fuel = fuelCalls();
    const [kitReply, planReply, ...macFuel] = S.onMac([S.KIT, S.KIT_PLAN, ...fuel]);
    none([...kitDiffs('macOS arm64', S.kitOf(kitReply!, 'macOS arm64: kit')), ...fuelDiffs('macOS arm64', macFuel)], 'macOS arm64 (deep-sandbox) gives #238\'s kit');

    const [appReply] = S.runShow(deepShow(['full']), S.scenario(temp(), [KIT_CALL]));
    none(kitDiffs('the app on macOS arm64', appKit(appReply!, 'the app\'s kit')), 'the app (deep-show full) gives #238\'s kit');

    const [linuxKit, ...linuxFuel] = onLinux('deep-sandbox', [S.KIT, ...fuel]);
    none([...kitDiffs('Linux x86_64', S.kitOf(linuxKit!, 'Linux x86_64: kit')), ...fuelDiffs('Linux x86_64', linuxFuel)], 'Linux x86_64 gives #238\'s kit');

    const base = BASE_KIT();
    const plan = S.arr(S.obj(planReply, 'kit_plan')['fixtures'], 'kit_plan: fixtures').map((f, i) => S.obj(f, `kit_plan.fixtures[${i}]`));
    const request = (name: string): JsonObject | undefined => { const f = plan.find((p) => p['fixture'] === name); return f ? S.obj(f['request'], `kit_plan ${name}.request`) : undefined; };
    const runs = base.cases.filter((c) => !String(c['fixture']).startsWith('refuse.')).map((c) => String(c['fixture']));
    const missing = [...runs, ...base.fuel.map((f) => f.fixture)].filter((name) => !request(name));
    expect(missing, 'kit_plan holds every fixture that runs').toEqual([]);
    const fuelRequests = base.fuel.flatMap((f) => [withFuel(request(f.fixture)!, f.count), withFuel(request(f.fixture)!, f.count - 1)]);
    const page = await S.inChrome(S.webRunnerSource(), [...runs.map((name) => request(name)!), ...fuelRequests]);
    console.log(`headless Chrome: ${page.userAgent}`);
    const differ = runs.flatMap((name, i) => {
      const want = base.cases.find((c) => c['fixture'] === name)!;
      const had = S.ran({ ok: true, trap: want['trap'] ?? null, result: want['result'] ?? null, reads: want['reads'] ?? [] }, `#238's ${name}`);
      const got = S.ran(page.replies[i], `headless Chrome: ${name}`);
      return S.sameRun(had, got) ? [] : [`${name} in headless Chrome: ${S.runShown(got)}, #238 recorded ${S.runShown(had)}`];
    });
    none([...differ, ...fuelDiffs('headless Chrome', page.replies.slice(runs.length))], 'headless Chrome gives #238\'s results and fuel counts');
  }, TIMEOUT);
});
