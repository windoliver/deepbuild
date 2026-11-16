// #238.6e920ef3: sandbox@1's kit gives the same results with wasmtime 49.0.5 in the app on macOS arm64 and on
// Linux x86_64 and with headless Chrome's own WebAssembly engine: each refusal fixture is refused at check,
// naming its import, its instruction and function, its segment or its limit; f32 and f64 NaNs from 0 ÷ 0,
// sqrt(−1) and inf − inf reach memory as 0x7FC00000 and 0x7FF8000000000000; an endless loop traps with kind
// fuel and an endless recursion with kind stack, each at the same function and offset on every host; and with a
// fuel budget of 10,000,000 a loop of 1 MiB memory.fill calls traps with kind fuel at its tenth fill, before
// that fill runs; while a program built to the subset passes, and a program that calls through a table its
// active segments filled passes.
//
// This suite's own fixtures carry the issue's values on all three hosts; the kit's own fixtures (README: The
// kit) must give one result per fixture on every host, in deep-sandbox and in the app (deep-show's kit).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOUR_MIB, KIT, KIT_FIXTURES, KIT_PLAN, REPO, WASMTIME, about, arr, caseKey, checkCall, deepShow, fixture, holds, inChrome, kitOf,
  macSandbox, obj, onLinux, onMac, prebuild, ran, refusals, runShow, runShown, sameRun, show, sized, str, theCase, useTemp, webRunnerSource,
  type Case, type JsonObject, type Kit,
} from './helpers.ts';
import { CRITERION_ONE, OVER_4MIB_WANT, REFUSALS, chromeRuns, criterionOneFailures, nativeRuns, sameOnHosts } from './programs.ts';

const ID = '#238.6e920ef3';
prebuild(() => { macSandbox(); deepShow(['full']); });
const temp = useTemp();

/** The check's answer for every refusal fixture, its 4 MiB pair and the passing twins, on one host. */
function checks(host: 'mac' | 'linux'): { name: string; reply: JsonObject }[] {
  const over = sized(fixture('pass_subset'), FOUR_MIB + 1, 'over_4mib');
  const at = sized(fixture('pass_subset'), FOUR_MIB, 'at_4mib');
  const programs = [...REFUSALS.map((r) => fixture(r.fixture)), over, at, fixture('pass_subset'), fixture('table_call'), fixture('table_65536')];
  const out = (host === 'mac' ? onMac : onLinux)(programs.map((p) => checkCall(p)));
  return programs.map((p, i) => ({ name: p.name, reply: out[i]! }));
}
function refusalFailures(where: string, answers: { name: string; reply: JsonObject }[]): string[] {
  const failures: string[] = [];
  const reply = (name: string): JsonObject => answers.find((a) => a.name === name)!.reply;
  for (const r of [...REFUSALS, { fixture: 'over_4mib', want: [OVER_4MIB_WANT] }]) {
    const got = refusals(reply(r.fixture), `${where}: check ${r.fixture}`);
    if (got.length === 0) failures.push(`${where}: ${r.fixture} was admitted at check`);
    else if (!got.some((x) => r.want.some((w) => holds(x, w)))) failures.push(`${where}: ${r.fixture} was refused without naming ${r.want.map((w) => JSON.stringify(w)).join(' or ')}: ${show(got as JsonObject[])}`);
  }
  for (const name of ['at_4mib', 'pass_subset', 'table_call', 'table_65536']) {
    const got = reply(name);
    if (got['ok'] !== true) failures.push(`${where}: ${name}, inside the subset, was refused at check: ${show(got)}`);
  }
  return failures;
}

/** What a host's kit must show by itself: PASS, every named fixture, and each case's kind. */
function kitFailures(where: string, kit: Kit): string[] {
  const failures: string[] = [];
  if (kit.verdict !== 'PASS') failures.push(`${where}: the kit's verdict is ${kit.verdict}: ${show(kit.failures)}`);
  for (const name of [...KIT_FIXTURES.refusals, ...KIT_FIXTURES.proposals, ...KIT_FIXTURES.runs]) {
    const c = kit.cases.find((x) => x.fixture === name);
    if (!c) { failures.push(`${where}: the kit has no fixture ${name}`); continue; }
    if (c.verdict !== 'PASS') failures.push(`${where}: ${name} is ${c.verdict}: ${show(c.raw)}`);
    if (name.startsWith('refuse.')) {
      if (c.refusals.length === 0 || c.hash !== null) failures.push(`${where}: ${name} isn't refused at check (refusals ${show(c.refusals)}, hash ${c.hash})`);
      continue;
    }
    if (c.hash === null || c.hash !== c.expected_hash) failures.push(`${where}: ${name}'s rewritten hash ${c.hash} isn't the reference's ${c.expected_hash}`);
    const kind = name.startsWith('fuel.') ? 'fuel' : name.startsWith('stack.') ? 'stack' : name.startsWith('trap.') ? name.slice(5) : null;
    if ((c.trap?.kind ?? null) !== kind) failures.push(`${where}: ${name} trapped ${show(c.trap as unknown as JsonObject)}, not ${kind === null ? 'not at all' : `with kind ${kind}`}`);
  }
  return failures;
}
/** The cases two hosts disagree on; each failure names the fixture and both results. */
function kitDiff(a: Kit, b: Kit, host: string): string[] {
  const failures: string[] = [];
  for (const c of a.cases) {
    const d = b.cases.find((x) => x.fixture === c.fixture);
    if (!d) failures.push(`${host} has no case for ${c.fixture}`);
    else if (caseKey(c) !== caseKey(d)) failures.push(`${c.fixture}: macOS arm64 ${caseKey(c).slice(0, 400)} but ${host} ${caseKey(d).slice(0, 400)}`);
  }
  if (b.cases.length !== a.cases.length) failures.push(`${host} has ${b.cases.length} cases, macOS arm64 ${a.cases.length}`);
  return failures;
}
const caseRun = (c: Case): ReturnType<typeof ran> => ran({ ok: true, trap: c.raw['trap'] ?? null, result: c.raw['result'] ?? null, reads: c.raw['reads'] ?? [] }, `the kit's ${c.fixture}`);

describe(`${ID} sandbox@1's kit gives the same results with wasmtime 49.0.5 on macOS arm64, on Linux x86_64 and in headless Chrome`, () => {
  it(`${ID} the implementation is wasmtime 49.0.5 in the app on both native hosts, pinned =49.0.5 in Cargo.lock`, () => {
    const lock = readFileSync(join(REPO, 'Cargo.lock'), 'utf8');
    const versions = [...lock.matchAll(/\[\[package\]\]\nname = "wasmtime"\nversion = "([^"]+)"/g)].map((m) => m[1]);
    expect(versions, 'Cargo.lock holds wasmtime once, at 49.0.5').toEqual([WASMTIME]);
    for (const [host, reply, arch, os] of [['macOS arm64', onMac([about])[0]!, 'aarch64', 'macos'], ['Linux x86_64', onLinux([about])[0]!, 'x86_64', 'linux']] as const) {
      expect(reply['interface'], `${host}: about names sandbox@1`).toBe('sandbox@1');
      expect(obj(reply['engine'], `${host}: about.engine`), `${host}: the engine is wasmtime ${WASMTIME}`).toMatchObject({ name: 'wasmtime', version: WASMTIME });
      const pins = obj(obj(reply['implementation'], `${host}: about.implementation`)['pins'], `${host}: implementation.pins`);
      expect(str(obj(pins['wasmtime'], `${host}: pins.wasmtime`)['version'], `${host}: pins.wasmtime.version`), `${host}: the implementation pins wasmtime =49.0.5`).toBe('=49.0.5');
      expect([reply['arch'], reply['os']], `${host}: the runner reports where it ran`).toEqual([arch, os]);
    }
  }, 5_400_000);

  it(`${ID} each refusal fixture is refused at check on macOS arm64 and on Linux x86_64, naming its import, its instruction and function, its segment or its limit, the same on both; the subset's own programs and limits pass`, () => {
    const mac = checks('mac');
    expect(refusalFailures('macOS arm64', mac), 'macOS arm64 refuses each fixture by name and admits the twins').toEqual([]);
    const linux = checks('linux');
    expect(refusalFailures('Linux x86_64', linux), 'Linux x86_64 refuses each fixture by name and admits the twins').toEqual([]);
    const differ = mac.filter((m, i) => JSON.stringify(m.reply) !== JSON.stringify(linux[i]!.reply)).map((m, i) => `${m.name}: ${show(m.reply).slice(0, 300)} vs ${show(linux[i]!.reply).slice(0, 300)}`);
    expect(differ, 'the check answers the same on both hosts').toEqual([]);
  }, 5_400_000);

  it(`${ID} NaNs reach memory canonical, an endless loop traps fuel and an endless recursion stack at one function and offset, the 1 MiB fill traps fuel at its tenth fill before it runs, and the subset's programs pass: the same on macOS arm64, Linux x86_64 and headless Chrome`, async () => {
    const mac = nativeRuns('mac', CRITERION_ONE);
    expect(criterionOneFailures('macOS arm64', CRITERION_ONE, mac.runs), 'macOS arm64 gives the issue\'s values').toEqual([]);
    const linux = nativeRuns('linux', CRITERION_ONE);
    expect(linux.rewrites.map((r) => r.hash), 'Linux x86_64 rewrites every program to the same bytes as macOS arm64').toEqual(mac.rewrites.map((r) => r.hash));
    expect(criterionOneFailures('Linux x86_64', CRITERION_ONE, linux.runs), 'Linux x86_64 gives the issue\'s values').toEqual([]);
    expect(sameOnHosts(CRITERION_ONE, mac.runs, linux.runs, 'Linux x86_64'), 'Linux x86_64 gives macOS arm64\'s results').toEqual([]);
    const chrome = await chromeRuns(CRITERION_ONE, mac.rewrites);
    expect(criterionOneFailures('headless Chrome', CRITERION_ONE, chrome), 'headless Chrome gives the issue\'s values').toEqual([]);
    expect(sameOnHosts(CRITERION_ONE, mac.runs, chrome, 'headless Chrome'), 'headless Chrome gives macOS arm64\'s results').toEqual([]);
  }, 5_400_000);

  it(`${ID} the kit passes with one result per fixture on macOS arm64 (deep-sandbox and the app's deep-show kit), on Linux x86_64 and, for every fixture that runs, in headless Chrome`, async () => {
    const [kitReply, planReply] = onMac([KIT, KIT_PLAN]);
    const mac = kitOf(kitReply!, 'macOS arm64: kit');
    expect(kitFailures('macOS arm64', mac), 'the kit passes on macOS arm64 with every fixture the issue names').toEqual([]);

    const appReply = runShow(deepShow(['full']), { evidence: temp(), calls: [{ call: 'kit', modules: ['sandbox'], parts: ['sandbox'] }] })[0]!;
    const module = arr(appReply['modules'], 'the app\'s kit: modules').map((m, i) => obj(m, `modules[${i}]`)).find((m) => m['module'] === 'sandbox');
    expect(module, `the app's kit reports the sandbox module: ${show(appReply)}`).toBeDefined();
    const part = arr(module!['parts'], 'sandbox.parts').map((p, i) => obj(p, `parts[${i}]`)).find((p) => p['part'] === 'sandbox');
    expect(part, 'the sandbox module\'s kit has the part sandbox (sandbox@1\'s kit)').toBeDefined();
    const app = kitOf({ interface: 'sandbox@1', verdict: part!['verdict'] ?? null, cases: part!['cases'] ?? [], failures: part!['failures'] ?? [] }, 'the app: kit part sandbox');
    expect(kitDiff(mac, app, 'the app (deep-show)'), 'the app\'s kit gives deep-sandbox\'s results').toEqual([]);

    const linux = kitOf(onLinux([KIT])[0]!, 'Linux x86_64: kit');
    expect(kitFailures('Linux x86_64', linux), 'the kit passes on Linux x86_64').toEqual([]);
    expect(kitDiff(mac, linux, 'Linux x86_64'), 'Linux x86_64 gives macOS arm64\'s results').toEqual([]);

    const plan = arr(obj(planReply, 'kit_plan')['fixtures'], 'kit_plan: fixtures').map((f, i) => obj(f, `kit_plan.fixtures[${i}]`));
    const planned = plan.map((f) => str(f['fixture'], 'kit_plan fixture'));
    expect([...planned].sort(), 'kit_plan holds every fixture that runs').toEqual([...KIT_FIXTURES.runs].sort());
    const page = await inChrome(webRunnerSource(), plan.map((f) => obj(f['request'], `kit_plan ${String(f['fixture'])}.request`)));
    const differ: string[] = [];
    planned.forEach((name, i) => {
      const want = caseRun(theCase(mac, name, 'macOS arm64: kit'));
      const got = ran(page.replies[i], `headless Chrome: ${name}`);
      if (!sameRun(want, got)) differ.push(`${name}: macOS arm64 ${runShown(want)} but headless Chrome ${runShown(got)}`);
    });
    expect(differ, 'headless Chrome gives macOS arm64\'s result for every fixture that runs').toEqual([]);
  }, 7_200_000);
});
