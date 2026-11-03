// What this suite runs and expects of its own fixtures, every expected value from the issue (README: Fixtures):
// the budgets and reads of each run, the refusals each program must get at check, the trap each trap fixture
// must make, and the three hosts' runs side by side. The values the issue doesn't give (a trap's offset for
// fuel and stack, the bits of a float that isn't NaN) are compared across hosts, never invented.

import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import {
  MIB, bin, fixture, fn, writePack, inChrome, onLinux, onMac, opAt, ran, rewriteCall, rewritten, runCall, runShown, sameRun, webRun, webRunnerSource,
  type Budget, type Fixture, type JsonObject, type PackDir, type Ran, type Read, type SandboxPlanted,
} from './helpers.ts';

export interface Spec { fixture: string; budget: Budget; read: Read[] }

/** The canonical NaNs the issue names, as little-endian hex: 0x7FC00000 and 0x7FF8000000000000. */
export const F32_NAN = '0000c07f';
export const F64_NAN = '000000000000f87f';
/** x86_64's default NaN for f64 0 / 0 when nothing canonicalizes it: 0xFFF8000000000000. */
export const F64_X86_NAN = '000000000000f8ff';
export const NAN: Spec = { fixture: 'nan', budget: { fuel: 1_000_000 }, read: [{ at: 0, len: 40 }] };
/** f32 0/0, sqrt(-1), inf-inf at 0, 4, 8; 12..16 untouched; f64 the same at 16, 24, 32. */
export const NAN_MEMORY = `${F32_NAN.repeat(3)}00000000${F64_NAN.repeat(3)}`;

export const FUEL_LOOP: Spec = { fixture: 'fuel_loop', budget: { fuel: 1_000_000 }, read: [] };
/** The issue's budget, and the 1 MiB regions fuel_fill.wat fills from 64 KiB on. */
export const FILL_FUEL = 10_000_000;
export const region = (i: number): number => 65536 + i * MIB;
export const FUEL_FILL: Spec = {
  fixture: 'fuel_fill', budget: { fuel: FILL_FUEL, memory_mib: 16 },
  read: [{ at: 0, len: 4 }, { at: region(8), len: 64 }, { at: region(9) - 64, len: 64 }, { at: region(9), len: 64 }, { at: region(10) - 64, len: 64 }],
};
export const RECURSION: Spec = { fixture: 'stack_small', budget: { fuel: 100_000_000 }, read: [{ at: 0, len: 4 }] };
export const PASS: Spec = { fixture: 'pass_subset', budget: { fuel: 1_000_000 }, read: [{ at: 0, len: 4 }, { at: 8, len: 4 }] };
export const TABLE_CALL: Spec = { fixture: 'table_call', budget: { fuel: 1_000_000 }, read: [] };

/** The stack ladder: the smallest and a large frame at the issue's two caps. */
export const CAPS = [65_536, 262_144] as const;
/** Bytes a call of each ladder fixture's function 1 charges by the design's rule: 8 per param, local and value-stack slot, plus 64. */
export const FRAME = { stack_small: 8 * (0 + 0 + 3) + 64, stack_large: 8 * (0 + 1000 + 3) + 64 } as const;
export const ladder = (name: keyof typeof FRAME, cap: number): Spec => ({ fixture: name, budget: { fuel: 100_000_000, stack: cap }, read: [{ at: 0, len: 4 }] });
/** The depths the per-call rule allows at `cap`: within 5% of cap / frame, either way (whose frames count toward the cap is the implementer's). */
export const depthWindow = (frame: number, cap: number): [number, number] => [Math.floor(cap / (frame * 1.05)), Math.ceil(cap / (frame * 0.95))];

/** The seven engine trap kinds of criterion 9: the fixture, and the operator in its function 1 that traps. */
export const TRAP_KINDS = [
  { kind: 'unreachable', fixture: 'trap_unreachable', op: 'Unreachable', which: 'first' },
  { kind: 'divide', fixture: 'trap_divide', op: 'I32DivS', which: 'first' },
  { kind: 'overflow', fixture: 'trap_overflow', op: 'I32DivS', which: 'first' },
  { kind: 'conversion', fixture: 'trap_conversion', op: 'I32TruncF32S', which: 'first' },
  { kind: 'bounds', fixture: 'trap_bounds', op: 'I32Load', which: 'last' },
  { kind: 'call', fixture: 'trap_call', op: 'CallIndirect', which: 'first' },
  { kind: 'grow', fixture: 'trap_grow', op: 'MemoryGrow', which: 'first' },
] as const;
export const trapSpec = (name: string): Spec => ({ fixture: name, budget: { fuel: 1_000_000 }, read: [{ at: 0, len: 8 }] });

/** Criterion 1's refusal fixtures: each must be refused at check by a refusal holding all of one `want`'s fields. */
export const REFUSALS: { fixture: string; want: JsonObject[] }[] = [
  { fixture: 'refuse_import', want: [{ import: { module: 'env', name: 'forbidden_fn' } }] },
  { fixture: 'refuse_vector', want: [{ instruction: 'v128.const', function: 1 }] },
  { fixture: 'refuse_atomic', want: [{ instruction: 'i32.atomic.load', function: 1 }] },
  { fixture: 'refuse_memory_grows', want: [{ limit: { name: 'memory' } }] },
  { fixture: 'refuse_memory_unbounded', want: [{ limit: { name: 'memory' } }] },
  { fixture: 'refuse_table_set', want: [{ instruction: 'table.set', function: 1 }] },
  { fixture: 'refuse_data_drop', want: [{ instruction: 'data.drop', function: 1 }, { instruction: 'memory.init', function: 1 }, { segment: { kind: 'data', index: 0 } }] },
  { fixture: 'refuse_mutable_funcref_global', want: [{ global: 3 }] },
  { fixture: 'refuse_table_65537', want: [{ limit: { name: 'table', max: 65_536, actual: 65_537 } }] },
];
/** The 4 MiB limit, both sides: pass_subset.wasm padded with a custom section to 4 MiB + 1 byte (refused) and to 4 MiB (passes). */
export const OVER_4MIB_WANT: JsonObject = { limit: { name: 'program', max: 4_194_304, actual: 4_194_305 } };
/** Criterion 8's proposals: one refusal must hold the proposal, the instruction and its function (or, for a constant expression, its global). */
export const PROPOSALS: { fixture: string; want: JsonObject[]; kit: string }[] = [
  { fixture: 'refuse_tail_call', want: [{ proposal: 'tail_call', instruction: 'return_call', function: 1 }], kit: 'refuse.tail_call' },
  { fixture: 'refuse_exceptions', want: [{ proposal: 'exceptions', instruction: 'try_table', function: 1 }, { proposal: 'exceptions', instruction: 'throw', function: 1 }], kit: 'refuse.exceptions' },
  { fixture: 'refuse_multi_memory', want: [{ proposal: 'multi_memory', instruction: 'i32.load', function: 1 }], kit: 'refuse.multi_memory' },
  { fixture: 'refuse_memory64', want: [{ proposal: 'memory64', instruction: 'i32.load', function: 1 }], kit: 'refuse.memory64' },
  { fixture: 'refuse_gc', want: [{ proposal: 'gc', instruction: 'struct.new', function: 1 }], kit: 'refuse.gc' },
  { fixture: 'refuse_extended_const', want: [{ proposal: 'extended_const', instruction: 'i32.add', global: 3 }], kit: 'refuse.extended_const' },
];

/** Each host's runs of `specs`, in order: `rewrite` then `run` per spec, natively; the rewritten bytes in Chrome. */
export interface Rewrite { b64: string; hash: string }
export function nativeRuns(host: 'mac' | 'linux', specs: Spec[], planted?: SandboxPlanted): { rewrites: Rewrite[]; runs: Ran[] } {
  const calls: JsonObject[] = specs.flatMap((s) => [rewriteCall(fixture(s.fixture), 'provider', s.budget), runCall(fixture(s.fixture), s.budget, s.read)]);
  const out = host === 'mac' ? onMac(calls, planted) : onLinux(calls, planted);
  const where = `${host === 'mac' ? 'macOS arm64' : 'Linux x86_64'}${planted ? ` --planted ${planted}` : ''}`;
  const rewrites: Rewrite[] = [];
  const runs: Ran[] = [];
  specs.forEach((s, i) => {
    const rw = rewritten(out[2 * i]!, `${where}: rewrite ${s.fixture}`);
    const r = ran(out[2 * i + 1], `${where}: run ${s.fixture}`);
    if (!planted) expect(r.hash, `${where}: run ${s.fixture} ran the bytes the rewrite gave (its hash)`).toBe(rw.hash);
    rewrites.push({ b64: rw.b64, hash: rw.hash });
    runs.push(r);
  });
  return { rewrites, runs };
}
export async function chromeRuns(specs: Spec[], rewrites: Rewrite[]): Promise<Ran[]> {
  const page = await inChrome(webRunnerSource(), specs.map((s, i) => webRun(rewrites[i]!.b64, s.budget, s.read)));
  expect(page.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome\//);
  expect(page.replies.length, 'headless Chrome: one reply per request').toBe(specs.length);
  return page.replies.map((r, i) => ran(r, `headless Chrome: run ${specs[i]!.fixture}`));
}
/** Every host's run of each spec equals the reference host's; each failure names the fixture and both runs. */
export function sameOnHosts(specs: Spec[], reference: Ran[], other: Ran[], host: string): string[] {
  return specs.flatMap((s, i) => (sameRun(reference[i]!, other[i]!) ? [] : [`${s.fixture}: macOS arm64 ${runShown(reference[i]!)} but ${host} ${runShown(other[i]!)}`]));
}

/** What criterion 1 requires of one host's runs of its fixtures, from the issue's values; each failure names the fixture. */
export function criterionOneFailures(where: string, specs: Spec[], runs: Ran[]): string[] {
  const failures: string[] = [];
  const at = (name: string): Ran => runs[specs.findIndex((s) => s.fixture === name)]!;
  const inBody = (fx: Fixture, offset: number): boolean => { const f = fn(fx, 1); return offset >= f.start && offset < f.end; };
  const nan = at(NAN.fixture);
  if (nan.trap) failures.push(`${where}: nan.wat trapped: ${runShown(nan)}`);
  if (nan.reads.get('0+40') !== NAN_MEMORY) failures.push(`${where}: nan.wat's NaNs reached memory as ${nan.reads.get('0+40')}, not ${NAN_MEMORY} (f32 0x7FC00000 and f64 0x7FF8000000000000 for 0/0, sqrt(-1), inf-inf)`);
  const loop = at(FUEL_LOOP.fixture);
  if (loop.trap?.kind !== 'fuel' || loop.trap.function !== 1 || !inBody(fixture('fuel_loop'), loop.trap.offset)) failures.push(`${where}: the endless loop didn't trap with kind fuel in function 1: ${runShown(loop)}`);
  const rec = at(RECURSION.fixture);
  if (rec.trap?.kind !== 'stack' || rec.trap.function !== 1 || !inBody(fixture('stack_small'), rec.trap.offset)) failures.push(`${where}: the endless recursion didn't trap with kind stack in function 1: ${runShown(rec)}`);
  const fill = at(FUEL_FILL.fixture);
  const fillOp = opAt(fixture('fuel_fill'), 1, 'MemoryFill');
  if (fill.trap?.kind !== 'fuel' || fill.trap.function !== 1 || fill.trap.offset !== fillOp) failures.push(`${where}: the memory.fill loop under fuel ${FILL_FUEL} didn't trap with kind fuel at its memory.fill (function 1, offset ${fillOp}): ${runShown(fill)}`);
  const want: [string, string, string][] = [
    ['0+4', '0a000000', 'the count is 10: the tenth iteration began'],
    [`${region(8)}+64`, 'ab'.repeat(64), 'the ninth fill ran (its region starts with 0xAB)'],
    [`${region(9) - 64}+64`, 'ab'.repeat(64), 'the ninth fill ran to its end'],
    [`${region(9)}+64`, '00'.repeat(64), 'the tenth fill never ran (its region still starts with zeros)'],
    [`${region(10) - 64}+64`, '00'.repeat(64), 'the tenth fill never ran (its region still ends with zeros)'],
  ];
  for (const [key, hex, why] of want) if (fill.reads.get(key) !== hex) failures.push(`${where}: fuel_fill: ${why}; read ${key} is ${fill.reads.get(key)?.slice(0, 32)}…`);
  const pass = at(PASS.fixture);
  if (pass.trap || pass.result !== 5050 || pass.reads.get('0+4') !== 'ba130000') failures.push(`${where}: the program built to the subset didn't run to 5050: ${runShown(pass)}`);
  const table = at(TABLE_CALL.fixture);
  if (table.trap || table.result !== 4207) failures.push(`${where}: the call through the table its active segment filled didn't return 4207: ${runShown(table)}`);
  return failures;
}
export const CRITERION_ONE: Spec[] = [NAN, FUEL_LOOP, RECURSION, FUEL_FILL, PASS, TABLE_CALL];

// ---------------------------------------------------------------------------------------------------
// Criteria 3, 4 and 7's packs, written per test with their assets' sha256s (README: Packs).

/** test/quadpack@1.0.0: the provider quadpack.quad (quad.wat, a one-quad mesh) and the layout quadpack.grid@1 (grid_validator.wat, twin grid_twin.bin). */
export function quadPack(root: string): { pack: PackDir; sha: Record<string, string> } {
  const assets = { 'quad.wasm': fixture('quad').bytes, 'grid_validator.wasm': fixture('grid_validator').bytes, 'grid_twin.bin': bin('grid_twin.bin') };
  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
  return writePack(root, 'test', {
    name: 'quadpack', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #238 acceptance suite: a provider that writes a one-quad mesh, and a layout with a validator and its malformed twin.',
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
    providers: { quad: { program: sha(assets['quad.wasm']), params: {}, out: { mesh: { max_vertices: 4, closed: false } } } },
    layouts: { 'quadpack.grid@1': { validator: sha(assets['grid_validator.wasm']), max_bytes: 4096, twins: [sha(assets['grid_twin.bin'])], doc: 'One byte a cell, each a cell type 0 to 3.' } },
  }, assets);
}
/** test/acceptpack@1.0.0: the same validator with a twin it accepts (grid_valid.bin), so its layout must be refused. */
export function acceptPack(root: string): { pack: PackDir; sha: Record<string, string> } {
  const assets = { 'grid_validator.wasm': fixture('grid_validator').bytes, 'grid_valid.bin': bin('grid_valid.bin') };
  const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
  return writePack(root, 'test', {
    name: 'acceptpack', version: '1.0.0', license: 'MIT',
    description: 'A planted pack of the #238 acceptance suite: its layout\'s twin is well formed, so the validator accepts it.',
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
    layouts: { 'acceptpack.grid@1': { validator: sha(assets['grid_validator.wasm']), max_bytes: 4096, twins: [sha(assets['grid_valid.bin'])], doc: 'One byte a cell, each a cell type 0 to 3.' } },
  }, assets);
}
/** A pack filling test.prog@1 with one program entry `<name>.<entry>`; it names only test.prog in requires.modules, never sandbox. */
export function progPack(root: string, name: string, entry: string, program: Fixture): { pack: PackDir; sha: Record<string, string> } {
  const sha = createHash('sha256').update(program.bytes).digest('hex');
  return writePack(root, 'test', {
    name, version: '1.0.0', license: 'MIT',
    description: `A test pack of the #238 acceptance suite: one program entry of the test registry test.prog@1 (${program.name}.wat).`,
    requires: { core: '>=0.0.0', modules: { 'test.prog': '>=0.0.0' } },
    entries: { 'test.prog@1': [{ name: `${name}.${entry}`, program: sha }] },
  }, { [`${entry}.wasm`]: program.bytes });
}
/** The test kind of test-mesh-item, naming the provider's mesh. */
export const meshItem = (id: string): JsonObject => ({ id, kind: 'test.mesh@1', name: `Mesh ${id}`, order: 'a0', params: { mesh: { gen: 'quadpack.quad', params: {} } } });
/** The quad as quad.wat writes it. */
export const QUAD = {
  positions: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
  uv0: [[0, 0], [1, 0], [1, 1], [0, 1]],
  indices: [0, 1, 2, 0, 2, 3],
  bounds: [[0, 0, 0], [1, 1, 0]],
};
