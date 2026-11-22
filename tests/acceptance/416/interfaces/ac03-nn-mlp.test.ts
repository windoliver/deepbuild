// Criterion 3 (the WebAssembly core tests' no_fma cases, run on our code, are oracle/no-fma.test.ts): "nn.mlp@1's
// fixture, a 4-8-2 network with weights from its fixture table and a fixed input, expects outputs equal to the
// interface's table bit for bit on macOS arm64, Linux x86_64 and in headless Chrome; a planted library that fuses a
// multiply and an add into one rounding differs from the table in the last bit on every host, since the subset runs the
// same bits everywhere, and is refused, naming the output"
//
// Through `deep-logic first_party`, `check`, `bake`, `web_plan` and `web_runner`, on this host (macOS arm64), in a
// linux/amd64 container and in headless Chrome (README: The surface; #190's helpers). The fixture's network and input
// are its item's two data assets; the table it expects is worked here from them with every multiply and add rounded to
// binary32 on its own (programs.ts: mlpRun, on floats.ts's exact rounding), and the fused values with each multiply
// and add rounded once. `mlp@1` is this suite's nn.mlp@1 library; `mlp_fused@1` fuses (README: Programs). Claiming
// nn.mlp@1 the fused library is refused; implementing nothing, under a fixture of its own, it links and its outputs on
// the fixture's table are read on every host.
import { describe, expect, it } from 'vitest';
import {
  ABOUT, TIMEOUT, WEB_RUNNER, admitted, arr, arraysAt, bakeCall, bakeOf, checkCall, inChrome, logicBin, num, obj, onHost, onLinux, prebuild,
  refusedOf, requireMacArm64, str, webPlanCall, type JsonObject,
} from '../../190/helpers.ts';
import { bits32, same32, ulps32 } from './floats.ts';
import { AC, byName, bytesOf, expectedAt, firstParty, fixturePiece, interfaceRuns, netItem, nnLib, pack, piece, refusalWhere } from './helpers.ts';
import { NN_EXPORTS, mlpRun, readF32, readNet } from './programs.ts';

prebuild(() => { logicBin(); });

const hex = (xs: number[]): string => xs.map((x) => bits32(x).toString(16).padStart(8, '0')).join(' ');
/** The outputs as binary32 values, each checked to be one (an f64 array of widened binary32 values). */
const outs = (values: unknown[] | undefined, what: string): number[] => (values ?? []).map((v, i) => {
  const x = num(v as never, `${what}[${i}]`);
  expect(Math.fround(x), `${what}[${i}] is a binary32 value`).toBe(x);
  return x;
});
const sameBits = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => same32(x, b[i]!));

/** nn.mlp@1's 4-8-2 fixture and its table, checked against this suite's own working of the network. */
function table() {
  const fp = firstParty();
  const iface = fp.iface('nn.mlp@1');
  expect(byName(iface.exports), 'nn.mlp@1 declares the exports README: The surface gives it').toEqual(byName(NN_EXPORTS));
  const fixture = fp.fixture(iface, '4-8-2');
  expect(fixture.tolerance, 'the fixture compares bit for bit').toBe('exact');
  const [netId, inId] = arr(fixture.params['assets'], 'the fixture item\'s assets').map((a) => str(a, 'an asset ID'));
  const net = readNet(bytesOf(fp.assets, netId!));
  const input = readF32(bytesOf(fp.assets, inId!));
  expect([net.sizes, input.length], 'a 4-8-2 network and a fixed input of 4').toEqual([[4, 8, 2], 4]);
  const want = mlpRun(net, input);
  const fused = mlpRun(net, input, true);
  const expected = expectedAt(fixture, 'out');
  expect(expected.length, 'the fixture expects the out array').toBeGreaterThan(0);
  for (const [k, values] of expected) expect(hex(outs(values, `out at step ${k}`)), `at step ${k} the table is the network worked with each multiply and add rounded on its own`).toBe(hex(want));
  const apart = fused.map((f, i) => ulps32(f, want[i]!));
  expect(apart.every((d) => d <= 1) && apart.some((d) => d === 1), `fused, the outputs ${hex(fused)} differ from the table ${hex(want)} in the last bit`).toBe(true);
  return { fp, iface, fixture, netId: netId!, inId: inId!, want, fused, step: expected[0]![0] };
}
const bakedOuts = (reply: JsonObject, item: string, step: number, what: string, web = false): number[] =>
  outs(arraysAt(bakeOf(reply, what, web), item, step)['out'], `${what}: out`);

describe(`${AC[3]} nn.mlp@1's table holds a network library bit for bit on every host`, () => {
  it(`${AC[3]} the 4-8-2 fixture's outputs equal the interface's table bit for bit on macOS arm64, Linux x86_64 and in headless Chrome`, async () => {
    const t = table();
    const lib = nnLib();
    const p = fixturePiece(t.fixture, lib, [pack('nets', [lib])], t.fp.assets);
    const calls = [checkCall(p), bakeCall(p, t.fixture.steps, t.fixture.track as never)];
    const [check, bake, runner, plan] = onHost([...calls, WEB_RUNNER, webPlanCall(p, t.fixture.steps, t.fixture.track as never)]);
    const judge = (c: JsonObject, b: JsonObject, host: string): void => {
      admitted(c, `${host}: check of the fixture's item linking mlp@1`);
      expect(interfaceRuns(c, 'fixture', 'mlp@1')['nn.mlp@1']?.map((r) => r.verdict), `${host}: mlp@1 passes nn.mlp@1's fixtures`).toEqual(t.iface.fixtures.map(() => 'PASS'));
      expect(hex(bakedOuts(b, 'fixture', t.step, `${host}: the fixture's bake`)), `${host}: the outputs are the table bit for bit`).toBe(hex(t.want));
    };
    judge(check!, bake!, 'macOS arm64');
    requireMacArm64('the first host of the three');
    const [about, lcheck, lbake] = onLinux([ABOUT, ...calls]);
    expect(about!['arch'], 'the second host is Linux x86_64').toBe('x86_64');
    judge(lcheck!, lbake!, 'Linux x86_64');
    expect(plan!['ok'], `web_plan gave a request: ${JSON.stringify(plan).slice(0, 400)}`).toBe(true);
    const chrome = await inChrome(str(runner!['source'], 'web_runner.source'), [plan!['request']!]);
    expect(chrome.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome/);
    expect(hex(bakedOuts(obj(chrome.replies[0], 'Chrome\'s bake'), 'fixture', t.step, 'headless Chrome\'s bake', true)), 'in headless Chrome the outputs are the table bit for bit').toBe(hex(t.want));
  }, TIMEOUT);

  it(`${AC[3]} a planted library that fuses a multiply and an add into one rounding differs from the table in the last bit on every host and is refused, naming the output`, async () => {
    const t = table();
    const first = t.fused.findIndex((f, i) => !same32(f, t.want[i]!));
    const claiming = nnLib(true);
    const own = nnLib(true, null);
    expect([claiming.implements, own.implements], 'one entry claims nn.mlp@1, the other declares no implements').toEqual([['nn.mlp@1'], undefined]);
    const refusedPiece = fixturePiece(t.fixture, claiming, [pack('fused', [claiming], '1.0.0')], t.fp.assets);
    const runPiece = piece(416, { net: netItem('lib:mlp_fused', t.netId, t.inId, 2, [own]) }, [pack('fused', [own], '1.0.1')], t.fp.assets);
    const calls = [checkCall(refusedPiece), bakeCall(runPiece, 1)];
    const [refused, bake, runner, plan] = onHost([...calls, WEB_RUNNER, webPlanCall(runPiece, 1)]);
    const judge = (r: JsonObject, b: JsonObject, host: string): void => {
      const x = refusedOf(r, `${host}: check of the fixture's item linking mlp_fused@1 as nn.mlp@1`);
      expect([x.code, x.item], `${host}: it is refused at link`).toEqual(['link_refused', 'fixture']);
      const named = refusalWhere(x.refusals, (y) => y['interface'] === 'nn.mlp@1' && y['fixture'] === t.fixture.id, `${host}: a refusal names nn.mlp@1 and the fixture`);
      expect([named['library'], named['array'], named['index']], `${host}: it names the output: out[${first}]`).toEqual(['mlp_fused@1', 'out', first]);
      expect([hex([num(named['expected'], 'expected')]), hex([num(named['actual'], 'actual')])], `${host}: the table's value against the fused one`).toEqual([hex([t.want[first]!]), hex([t.fused[first]!])]);
      const got = bakedOuts(b, 'net', 0, `${host}: the fused library on the table's network`);
      expect(hex(got), `${host}: its outputs are the fused ones, a last bit off the table`).toBe(hex(t.fused));
      expect(sameBits(got, t.want), `${host}: they differ from the table`).toBe(false);
    };
    judge(refused!, bake!, 'macOS arm64');
    requireMacArm64('the first host of the three');
    const [about, lrefused, lbake] = onLinux([ABOUT, ...calls]);
    expect(about!['arch'], 'the second host is Linux x86_64').toBe('x86_64');
    judge(lrefused!, lbake!, 'Linux x86_64');
    expect(plan!['ok'], `web_plan gave a request: ${JSON.stringify(plan).slice(0, 400)}`).toBe(true);
    const chrome = await inChrome(str(runner!['source'], 'web_runner.source'), [plan!['request']!]);
    const web = bakedOuts(obj(chrome.replies[0], 'Chrome\'s bake'), 'net', 0, 'headless Chrome\'s bake', true);
    expect(hex(web), 'in headless Chrome its outputs are the same fused ones').toBe(hex(t.fused));
  }, TIMEOUT);
});
