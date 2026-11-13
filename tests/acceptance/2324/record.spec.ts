// Records what the merge base gives on the old engine into fixtures/base-*.json (README: The merge base's readings).
// It runs only by hand, at the merge base: DEEP_2324_RECORD=1 and the command in the README. The repository's lanes
// never run it (their pattern is *.test.ts), and the suite's tests only read what it wrote.
//
// #531's programs come from its own programs.ts, and sandbox@1's kit programs from crates/deep-canvas-sandbox/kit.
// #531's assembler and its Rust program don't build in place at this base: their lockfiles list the patches
// .cargo/config.toml had when they were written, and `cargo build --locked` refuses to add the two it has gained. So
// this file builds copies of those two crates outside the checkout (the same sources and the same exact versions,
// with no --locked) and puts them behind #531's `assemble` and `rulesProgram`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as P from '../531/programs.ts';
import { L, REPO, S, TIMEOUT, bakeRecords, recorded, type FuelCount, type JsonObject, type JsonValue } from './helpers.ts';

vi.mock('../531/helpers.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../531/helpers.ts')>();
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const suite = path.join(real.REPO, 'tests', 'acceptance', '531');
  const built = (dir: string, args: string[]): string => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-2324-crate-'));
    for (const f of fs.readdirSync(dir)) if (f !== 'target') fs.cpSync(path.join(dir, f), path.join(copy, f), { recursive: true });
    const run = spawnSync('cargo', ['build', ...args], { cwd: copy, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, CARGO_TARGET_DIR: path.join(copy, 'target') } });
    if (run.status !== 0) throw Error(`cargo build ${args.join(' ')} in a copy of ${dir} failed: ${run.stderr.slice(-3000)}`);
    return copy;
  };
  let wat = '';
  const assemble = (name: string, text: string | Buffer): import('../531/helpers.ts').Program => {
    wat ||= path.join(built(path.join(suite, 'wat'), []), 'target', 'debug', 'acceptance-531-wat');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-2324-wat-'));
    try {
      const file = path.join(dir, typeof text === 'string' ? `${name}.wat` : `${name}.wasm`);
      fs.writeFileSync(file, text);
      fs.mkdirSync(path.join(dir, 'out'));
      const run = spawnSync(wat, [path.join(dir, 'out'), file], { encoding: 'utf8', maxBuffer: 64 << 20 });
      if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
      const bytes = fs.readFileSync(path.join(dir, 'out', `${name}.wasm`));
      const listing = JSON.parse(fs.readFileSync(path.join(dir, 'out', `${name}.ops.json`), 'utf8')) as Partial<import('../531/helpers.ts').Program>;
      return { name, bytes, b64: bytes.toString('base64'), sha: real.sha256(bytes), functions: listing.functions ?? [], exports: listing.exports ?? [], start: listing.start ?? null };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  let rules: import('../531/helpers.ts').Rules | undefined;
  const rulesProgram = (): import('../531/helpers.ts').Rules => {
    if (rules) return rules;
    const copy = built(path.join(suite, 'rules'), ['--release', '--target', 'wasm32-unknown-unknown']);
    const bytes = fs.readFileSync(path.join(copy, 'target', 'wasm32-unknown-unknown', 'release', 'acceptance_531_rules.wasm'));
    const { program, sidecar } = real.splitDebug(bytes);
    rules = { built: bytes, program: assemble('rules', program), sidecar, judge: -1, divide: -1, work: -1 };
    return rules;
  };
  return { ...real, assemble, rulesProgram };
});

const MADE_BY = 'DEEP_2324_RECORD=1 npx vitest run --root tests/acceptance/2324 record.spec.ts, at the merge base, with rust-toolchain.toml\'s cargo first on PATH';
/** JSON with the top two levels' object keys and object list entries one to a line, everything under them on that line. */
const lines = (v: JsonValue, depth = 0): string => {
  const pad = ' '.repeat(depth + 1);
  if (depth < 2 && S.isObject(v)) return `{\n${Object.entries(v).map(([k, x]) => `${pad}${JSON.stringify(k)}: ${lines(x, depth + 1)}`).join(',\n')}\n${' '.repeat(depth)}}`;
  if (depth < 2 && Array.isArray(v) && v.some(S.isObject)) return `[\n${v.map((x) => `${pad}${JSON.stringify(x)}`).join(',\n')}\n${' '.repeat(depth)}]`;
  return JSON.stringify(v);
};
const write = (name: string, value: JsonValue): void => writeFileSync(join(REPO, 'tests', 'acceptance', '2324', 'fixtures', name), `${lines(value)}\n`);
const KIT_DIR = join(REPO, 'crates', 'deep-canvas-sandbox', 'kit');

/** The least fuel budget under which each program's run doesn't trap `fuel`, found by halving on this Mac's deep-sandbox. */
function fuelCounts(specs: Omit<FuelCount, 'count'>[]): FuelCount[] {
  const traps = (fuel: number[]): boolean[] =>
    S.onMac(specs.map((f, i) => ({ call: 'run', program: f.program, role: 'provider', seed: 0, budget: { ...f.budget, fuel: fuel[i]! }, read: [] })))
      .map((r, i) => {
        expect(r['ok'], `${specs[i]!.fixture} runs: ${S.show(r)}`).toBe(true);
        const trap = r['trap'];
        return S.isObject(trap) && trap['kind'] === 'fuel';
      });
  const lo = specs.map(() => 0);
  const hi = specs.map(() => 2 ** 40);
  expect(traps(lo), 'each run traps fuel with none').toEqual(specs.map(() => true));
  expect(traps(hi), 'each run ends with 2^40 fuel').toEqual(specs.map(() => false));
  while (lo.some((l, i) => hi[i]! - l > 1)) {
    const mid = lo.map((l, i) => Math.floor((l + hi[i]!) / 2));
    traps(mid).forEach((t, i) => { if (t) lo[i] = mid[i]!; else hi[i] = mid[i]!; });
  }
  return specs.map((f, i) => ({ ...f, count: hi[i]! }));
}

// #531's fixtures as one piece: every program of #531's suite that its check admits, each as the item #531's tests
// build it for, at 60 Hz, checkpoints every 20 steps, over 60 steps of one track.
const SEED = 2324;
const QUIZ_WRITES = { order: { type: 'i32' as const, count: 5 }, seed: { type: 'i32' as const, count: 2 } };
const TABLE_WRITES = { acc: { type: 'i32' as const }, mix: { type: 'f64' as const } };
const LOOKUP_WRITES = { v: { type: 'i32' as const }, sum: { type: 'i32' as const }, starts: { type: 'i32' as const }, inits: { type: 'i32' as const } };
const CONTROLS = ['go', 'start', 'nudge', 'boom', 'c1'];
const EVERY = { every: 20 };
/** Nudges and a c1, a start at 20 (the quiz shuffles), a go at 45 (spin loops until its fuel runs out) and a boom of 0 at 50 (the Rust program divides by it). */
const TRACK: L.Entry[] = [
  L.yours('nudge', 5, 1, 0), L.yours('c1', 8, 0.25, 1), L.yours('nudge', 17, 3, 2), L.yours('start', 20, 1, 3),
  L.yours('nudge', 33, 2, 4), L.yours('go', 45, 1, 5), L.yours('boom', 50, 0, 6), L.yours('nudge', 52, 4, 7),
];
/** The layouts `check` gives the items whose programs are built against theirs, read with #531's layout probe. */
const layoutCall = (): JsonObject => L.checkCall(L.piece({
  seed: SEED, controls: CONTROLS, items: {
    quiz: { program: P.probe(), reads: ['start'], writes: QUIZ_WRITES },
    table_copy: { program: P.probe(), reads: ['nudge'], writes: TABLE_WRITES },
    lookup: { program: P.probe(), writes: LOOKUP_WRITES },
  },
}));
function fixturePiece(at: Record<string, L.Checked>): JsonObject {
  const k = { k: { type: 'i32' as const } };
  return L.piece({
    seed: SEED, controls: CONTROLS, items: {
      spin: { program: P.spin(), reads: ['go'], writes: k, checkpoint: EVERY },
      tally: { program: P.tally(), writes: k, checkpoint: EVERY },
      recurse: { program: P.recurse(), writes: { d: { type: 'i32' } }, budget: { stack: 64 }, checkpoint: EVERY },
      quiz: { program: P.quiz(at['quiz']!.layout), reads: ['start'], writes: QUIZ_WRITES, checkpoint: EVERY },
      nine_fills: { program: P.nineFills(), writes: k, budget: { fuel: 10_000_000, memory: 16 }, checkpoint: EVERY },
      table_copy: { program: P.tableCopy(at['table_copy']!.layout), reads: ['nudge'], writes: TABLE_WRITES, checkpoint: EVERY },
      lookup: { program: P.lookup(at['lookup']!.layout), writes: LOOKUP_WRITES, checkpoint: EVERY },
      start_forever: { program: P.startForever(), writes: k, checkpoint: EVERY },
      touch_pages: { program: P.touchPages(), writes: k, checkpoint: EVERY },
      quiet_pages: { program: P.quietPages(), writes: k, checkpoint: EVERY },
      src: { program: P.levels(), writes: { level: { type: 'f64', count: 4 } }, checkpoint: EVERY },
      aim: { program: P.aim(), reads: ['c1', 'src.level'], writes: { hit: { type: 'i32' } }, checkpoint: EVERY },
      work: { program: P.work(), writes: { x: { type: 'i32' } }, budget: { fuel: 5_000_000 }, checkpoint: EVERY },
      rules: { program: L.rulesProgram().program, reads: ['boom'], writes: { acc: { type: 'i32' } }, checkpoint: EVERY },
    },
  });
}
/** The save: table_copy alone (its memory and mutable globals, call_indirect, memory.copy), 120 steps, checkpoints every 30. */
const savePiece = (at: Record<string, L.Checked>): JsonObject =>
  L.piece({ seed: SEED, controls: ['nudge'], items: { table_copy: { program: P.tableCopy(at['table_copy']!.layout), reads: ['nudge'], writes: TABLE_WRITES, checkpoint: { every: 30 } } } });
const SAVE_TRACK: L.Entry[] = [L.yours('nudge', 7, 1, 0), L.yours('nudge', 29, 4, 1), L.yours('nudge', 61, 2, 2), L.yours('nudge', 97, 3, 3)];

describe.runIf(process.env['DEEP_2324_RECORD'] === '1')('#2324: the merge base\'s readings', () => {
  it('records the kit and its fuel counts, the bake of #531\'s fixtures, the save and the seal\'s runtime digest', () => {
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    const [kitReply] = S.onMac([S.KIT]);
    const kit = S.kitOf(kitReply!, 'the merge base\'s kit');
    expect(kit.verdict, 'the merge base\'s kit passes').toBe('PASS');
    const fixtures = (JSON.parse(readFileSync(join(KIT_DIR, 'kit.json'), 'utf8')) as { fixtures: JsonObject[] }).fixtures;
    // Every fixture that runs and ends (fuel.loop never ends: its trap is in its case).
    const runs = (f: JsonObject): boolean => { const e = f['expect']; return !(S.isObject(e) && 'refusals' in e) && f['fixture'] !== 'fuel.loop'; };
    const specs = fixtures.filter(runs).map((f) => {
      const budget = f['budget'];
      const program = L.assemble(String(f['program']).replace(/\.wat$/, ''), readFileSync(join(KIT_DIR, String(f['program'])), 'utf8'));
      return { fixture: String(f['fixture']), program: program.b64, budget: S.isObject(budget) ? budget : {} };
    });
    write('base-kit.json', { base, made_by: MADE_BY, cases: kit.cases.map(recorded), fuel: fuelCounts(specs) as unknown as JsonValue });

    const [layouts] = L.onMac([layoutCall()]);
    const at = L.admitted(layouts!, 'check of the layout probes');
    const bakeInput = { piece: fixturePiece(at), track: TRACK as unknown as JsonValue, steps: 60 };
    const [bake] = L.onMac([{ call: 'bake', ...bakeInput }]);
    write('base-bake.json', { base, made_by: MADE_BY, ...bakeInput, items: bakeRecords(bake!, 'the merge base\'s bake') as unknown as JsonValue });
    const saveInput = { piece: savePiece(at), track: SAVE_TRACK as unknown as JsonValue, steps: 120 };
    const [golden] = L.onMac([{ call: 'golden', ...saveInput }]);
    expect(golden!['ok'], `the merge base records the golden: ${S.show(golden)}`).toBe(true);
    write('base-golden.json', { base, made_by: MADE_BY, ...saveInput, golden: S.obj(golden!['golden'], 'golden') });

    const evidence = mkdtempSync(join(tmpdir(), 'deep-2324-'));
    try {
      const [schedule] = S.runShow(S.deepShow(['full']), S.scenario(evidence, [S.SCHEDULE]));
      write('base-seal.json', { base, made_by: MADE_BY, full: S.str(schedule!['runtime_digest'], 'schedule: runtime_digest') });
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  }, TIMEOUT);
});
