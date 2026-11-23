// Oracle lane for criterion 3 (README: Oracle lane): the WebAssembly core tests' float_exprs.wast at the oracle map's
// pin, fffc6e12fa (doneright/oracles/issues/416.md; its copy is the map's vendor/wasm-spec-fffc6e12fa/test/core/), run
// on our code. Its f32.no_fma and f64.no_fma cases hold x × y + z to two roundings where one fused rounding differs,
// and its f64.no_contraction cases rule out wider intermediates. Only their inputs and expected results are ported,
// as data below; no upstream code is.
//
// Each f32 case runs as a one-input, one-output network (weight x, input y, bias z) through nn.mlp@1's forward, linked
// from mlp@1 by the interface (`lib:nn.mlp@1`), so it passes through this issue's link; each f64 case runs as
// f64.add(f64.mul(x, y), z) in the program's own code. Both go through our sandbox's check and rewrite, on macOS arm64
// (wasmtime), Linux x86_64 (a linux/amd64 container) and headless Chrome (the web runner), and every result must be
// upstream's bits. The wrong program shown failing: the same program linking mlp_fused@1, whose f32 results are the
// fused ones, which differ from upstream's in every case.
import { describe, expect, it } from 'vitest';
import { ABOUT, TIMEOUT, WEB_RUNNER, arraysAt, bakeCall, bakeOf, inChrome, logicBin, num, obj, onHost, onLinux, prebuild, requireMacArm64, str, webPlanCall, type JsonObject } from '../../../190/helpers.ts';
import { add32, add64, bits32, bits64, fma32, fma64, hexFloat, mul32, mul64 } from '../floats.ts';
import { AC, nnLib, oracleLayout, pack, piece } from '../helpers.ts';
import { ORACLE_WRITES, oracleProgram, type Triple } from '../programs.ts';

prebuild(() => { logicBin(); });

// float_exprs.wast's cases: [x, y, z, the result upstream expects].
const F32_NO_FMA = [
  ['0x1.a78402p+124', '0x1.cf8548p-23', '0x1.992adap+107', '0x1.a5262cp+107'],
  ['0x1.ed15a4p-28', '-0x1.613c72p-50', '0x1.4757bp-88', '-0x1.5406b8p-77'],
  ['0x1.ae63a2p+37', '0x1.b3a59ap-13', '0x1.c16918p+10', '0x1.6e385cp+25'],
  ['0x1.2a77fap-8', '-0x1.bb7356p+22', '-0x1.32be2ap+1', '-0x1.0286d4p+15'],
  ['0x1.298fb6p+126', '-0x1.03080cp-70', '-0x1.418de6p+34', '-0x1.2d15c6p+56'],
];
const F64_NO_FMA = [
  ['0x1.ac357ff46eed4p+557', '0x1.852c01a5e7297p+430', '-0x1.05995704eda8ap+987', '0x1.855d905d338ep+987'],
  ['0x1.e2fd6bf32010cp+749', '0x1.01c2238d405e4p-130', '0x1.2ecc0db4b9f94p+573', '0x1.e64eb07e063bcp+619'],
  ['0x1.92b7c7439ede3p-721', '-0x1.6aa97586d3de6p+1011', '0x1.8de4823f6358ap+237', '-0x1.1d4139fd20ecdp+291'],
  ['-0x1.466d30bddb453p-386', '-0x1.185a4d739c7aap+443', '0x1.5f9c436fbfc7bp+55', '0x1.bd61a350fcc1ap+57'],
  ['0x1.7e2c44058a799p+52', '0x1.c73b71765b8b2p+685', '-0x1.16c641df0b108p+690', '0x1.53ccb53de0bd1p+738'],
];
const F64_NO_CONTRACTION = [
  ['-0x1.9e87ce14273afp-103', '0x1.2515ad31db63ep+664', '0x1.868c6685e6185p+533', '-0x1.da94885b11493p+561'],
  ['0x1.da21c460a6f44p+52', '0x1.60859d2e7714ap-321', '0x1.e63f1b7b660e1p-302', '0x1.4672f256d1794p-268'],
  ['-0x1.f3eaf43f327cp-594', '0x1.dfcc009906b57p+533', '0x1.5984e03c520a1p-104', '-0x1.d4797fb3db166p-60'],
  ['0x1.dab6c772cb2e2p-69', '-0x1.d761663679a84p-101', '0x1.f22f92c843226p-218', '-0x1.b50d72dfcef68p-169'],
  ['-0x1.87c5def1e4d3dp-950', '-0x1.50cd5dab2207fp+935', '0x1.e629bd0da8c5dp-54', '0x1.01b6feb4e78a7p-14'],
];
const parse = (cs: string[][]): { t: Triple; want: number }[] => cs.map((c) => { const [x, y, z, w] = c.map(hexFloat); return { t: { x: x!, y: y!, z: z! }, want: w! }; });
const f32 = parse(F32_NO_FMA), noFma = parse(F64_NO_FMA), noContraction = parse(F64_NO_CONTRACTION);
const u32 = (xs: number[]): string[] => xs.map((x) => (x >>> 0).toString(16).padStart(8, '0'));
const u64 = (xs: number[]): string[] => xs.map((x) => bits64(x).toString(16).padStart(16, '0'));

/** The oracle item, `oracle`, linking `lib` (from a pack of its own) and importing its forward from `module`. */
const oraclePiece = (module: string, lib: ReturnType<typeof nnLib>): JsonObject =>
  piece(4160, { oracle: { program: oracleProgram(oracleLayout(), module, f32.map((c) => c.t), { no_fma: noFma.map((c) => c.t), no_contraction: noContraction.map((c) => c.t) }), writes: ORACLE_WRITES, links: [lib] } }, [pack(lib.name.split('@')[0]!, [lib])]);
/** The three result arrays of a bake's step 0, as bits. */
function results(reply: JsonObject, what: string, web = false): { f32: string[]; noFma: string[]; noContraction: string[] } {
  const a = arraysAt(bakeOf(reply, what, web), 'oracle', 0);
  const nums = (k: string): number[] => (a[k] ?? []).map((v, i) => num(v, `${what}: ${k}[${i}]`));
  return { f32: u32(nums('f32_bits')), noFma: u64(nums('f64_no_fma')), noContraction: u64(nums('f64_no_contraction')) };
}
const upstream = { f32: u32(f32.map((c) => bits32(c.want))), noFma: u64(noFma.map((c) => c.want)), noContraction: u64(noContraction.map((c) => c.want)) };

describe(`${AC[3]} oracle: float_exprs.wast's no_fma and no_contraction cases, run on our code`, () => {
  it(`${AC[3]} every case gives upstream's bits through nn.mlp@1 and our sandbox, on macOS arm64, Linux x86_64 and in headless Chrome, and a library that fuses each multiply and add misses them`, async () => {
    // First, the cases themselves: two roundings give upstream's results, one fused rounding doesn't.
    for (const { t, want } of f32) expect([bits32(add32(mul32(t.x, t.y), t.z)) === bits32(want), bits32(fma32(t.x, t.y, t.z)) !== bits32(want)], `f32 case ${t.x} ${t.y} ${t.z}`).toEqual([true, true]);
    for (const { t, want } of [...noFma, ...noContraction]) expect([bits64(add64(mul64(t.x, t.y), t.z)) === bits64(want), bits64(fma64(t.x, t.y, t.z)) !== bits64(want)], `f64 case ${t.x} ${t.y} ${t.z}`).toEqual([true, true]);
    const p = oraclePiece('lib:nn.mlp@1', nnLib());
    const fusedLib = nnLib(true, null);
    expect(fusedLib.implements, 'mlp_fused@1\'s entry declares no implements').toBeUndefined();
    const [bake, runner, plan, fusedBake] = onHost([bakeCall(p, 1), WEB_RUNNER, webPlanCall(p, 1), bakeCall(oraclePiece('lib:mlp_fused', fusedLib), 1)]);
    expect(results(bake!, 'this host\'s bake'), 'this host gives upstream\'s bits').toEqual(upstream);
    // The wrong program: mlp_fused@1, linked by its own name, under the same cases.
    const fused = results(fusedBake!, 'the fused library\'s bake');
    expect(fused.f32, 'the fused library\'s f32 results are the fused ones').toEqual(u32(f32.map((c) => bits32(fma32(c.t.x, c.t.y, c.t.z)))));
    expect(fused.f32.map((b, i) => b !== upstream.f32[i]), 'and each misses upstream\'s bits').toEqual(f32.map(() => true));
    requireMacArm64('the first native host');
    const [about, linux] = onLinux([ABOUT, bakeCall(p, 1)]);
    expect(about!['arch'], 'the second native host is Linux x86_64').toBe('x86_64');
    expect(results(linux!, 'Linux x86_64\'s bake'), 'Linux x86_64 gives upstream\'s bits').toEqual(upstream);
    expect(plan!['ok'], `web_plan gave a request: ${JSON.stringify(plan).slice(0, 400)}`).toBe(true);
    const chrome = await inChrome(str(runner!['source'], 'web_runner.source'), [plan!['request']!]);
    expect(results(obj(chrome.replies[0], 'Chrome\'s bake'), 'headless Chrome\'s bake', true), 'headless Chrome gives upstream\'s bits').toEqual(upstream);
  }, TIMEOUT);
});
