// Criterion 11 of #531 (#531.6b6fc913), redrafted blind (README). A Rust logic program built with debug info whose
// step is one function with loops on rules.rs:10, 20 and 30; step 7, the bake's worst, runs them 3,000, 2,000 and
// 1,000 times. logic.budget names those three lines in that order, each with fuel that the rewrite's counter can
// account for. The planted report that charges each block to its function's first line puts the whole step on
// step's first line: one line, and the same judgement fails on it.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, TIMEOUT, admitted, assemble, at, bakeCall, bakeOf, blocked, entryAt, exported, fn, logicBin, none, onMac, piece, prebuild,
  show, splitDebug, type Bake, type JsonObject, type Program,
} from '../531/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRATE = join(HERE, 'budget');
const TARGET = join(process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'), 'acceptance-531-redraft-ac11-budget');
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';

/** The bake: 12 steps; step 7 runs the loops 3,000, 2,000 and 1,000 times, every other step 300, 200 and 100. */
const STEPS = 12;
const WORST = 7;
const LOOPS = [{ line: 10, iterations: 3000 }, { line: 20, iterations: 2000 }, { line: 30, iterations: 1000 }] as const;
/** The iterations step 7 runs beyond any other step's: 5,400. */
const EXTRA = LOOPS.reduce((s, l) => s + l.iterations - l.iterations / 10, 0);
const ITEM = 'rules';

interface Built { program: Program; sidecar: Buffer }
let built: Built | undefined;
/** Builds budget/ for wasm32 with debug info; the program is the module without its `.debug_*` sections, the sidecar holds them. */
function budgetProgram(): Built {
  if (built) return built;
  const run = spawnSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', join(CRATE, 'Cargo.toml')], {
    cwd: CRATE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CARGO_TARGET_DIR: TARGET, CARGO_INCREMENTAL: '0', PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` },
  });
  if (run.error || run.status !== 0) blocked(`this test's Rust program (budget/) didn't build for wasm32-unknown-unknown: ${run.error?.message ?? run.stderr.slice(-3000)}`);
  const { program, sidecar } = splitDebug(readFileSync(join(TARGET, 'wasm32-unknown-unknown', 'release', 'acceptance_531_redraft_ac11_budget.wasm')));
  expect(sidecar.length, 'the Rust program was built with debug info (.debug_* sections)').toBeGreaterThan(1000);
  const p = assemble('budget', program);
  // What the twin's expected output rests on: every block step(k) runs is in step itself. It calls nothing and holds
  // the three loops, so a report by function's first line has exactly one function, hence one line, to name.
  const step = fn(p, exported(p, 'step'));
  const calls = step.ops.filter(([, op]) => /^(Call|CallIndirect|ReturnCall|ReturnCallIndirect|CallRef|ReturnCallRef)$/.test(op));
  expect(calls, 'step calls no other function').toEqual([]);
  expect(step.ops.filter(([, op]) => op === 'Loop').length, 'step holds the three loops').toBe(3);
  built = { program: p, sidecar };
  return built;
}

const rulesLine = (source: string): number | null => { const m = /(?:^|[/\\])rules\.rs:(\d+)$/.exec(source); return m ? Number(m[1]) : null; };

/** The piece: one logic item at 60 Hz, no reads, one i32 write, the sidecar named as `debug`. */
function bake(planted?: 'budget_charges_function_first_line'): Bake {
  const { program, sidecar } = budgetProgram();
  const p = piece({ seed: 531, items: { [ITEM]: { program, debug: sidecar, writes: { acc: { type: 'i32' } } } } });
  const call: JsonObject = bakeCall(p, { steps: STEPS });
  const [reply] = onMac([call], planted);
  const b = bakeOf(reply!, `bake${planted ? ` (--planted ${planted})` : ''}`);
  // The program stores its result at writes_at + 0: the item's one write entry must be there.
  const items = admitted(reply!, 'bake');
  expect(entryAt(items[ITEM]!.layout, 'writes', 'acc').offset, 'acc is at offset 0 of the write region').toBe(0);
  return b;
}

/** Everything wrong with a bake's logic.budget for the criterion; [] when the report is right. */
function judge(b: Bake): { failures: string[]; lines: { source: string; fuel: number }[]; fuel: number } {
  const failures: string[] = [];
  expect(b.traps, 'no step traps').toEqual([]);
  expect(b.steps.map((s) => s.step), `the bake ran steps 0 to ${STEPS - 1}`).toEqual([...Array(STEPS).keys()]);
  const fuelAt = (k: number): number => at(b.steps, k, 'bake.steps').items[ITEM]!.fuel;
  const fuel = fuelAt(WORST);
  const other = fuelAt(WORST - 1);
  // The rewrite's counter makes step 7 the worst: the only step that runs the loops ten times as long.
  for (let k = 0; k < STEPS; k++) if (k !== WORST && fuelAt(k) >= fuel) failures.push(`step ${k} used ${fuelAt(k)} fuel, not less than step ${WORST}'s ${fuel}`);
  const budgets = b.budgets.filter((x) => x.item === ITEM);
  if (budgets.length !== 1) { failures.push(`logic.budget holds ${budgets.length} reports for ${ITEM}: ${JSON.stringify(b.budgets)}`); return { failures, lines: [], fuel }; }
  const budget = budgets[0]!;
  if (budget.step !== WORST) failures.push(`logic.budget names step ${budget.step}, not the worst step ${WORST}`);
  if (budget.fuel !== fuel) failures.push(`logic.budget gives the worst step ${budget.fuel} fuel; its step record says ${fuel}`);
  const named = budget.lines.map((l) => l.source);
  if (named.length !== 3 || LOOPS.some((l, i) => rulesLine(named[i] ?? '') !== l.line)) {
    failures.push(`logic.budget names the lines ${show(named)}, not rules.rs:10, rules.rs:20 and rules.rs:30 in that order`);
    return { failures, lines: budget.lines, fuel };
  }
  // Each line's fuel from the rewrite's per-block counts: every iteration runs its loop's blocks once, so a line spends
  // at least one unit an iteration, no more than its loop's share of the fuel step 7 spends beyond step 6 (the same
  // code with a tenth of the iterations; 10% for the loop's entry and exit), and at least a quarter of it (the build's
  // DWARF puts 9 of each loop body's 22 instructions on line 0, which a report may leave out, and a tenth of it is what
  // step 6's loop would spend); the three loops' bodies are the same code, so their fuel is 3 : 2 : 1.
  const extra = fuel - other;
  LOOPS.forEach((l, i) => {
    const got = budget.lines[i]!.fuel;
    const share = (extra * l.iterations) / EXTRA;
    if (got < l.iterations) failures.push(`rules.rs:${l.line} spent ${got} fuel in ${l.iterations} iterations, under one an iteration`);
    if (got > share * 1.1 || got < share * 0.25) failures.push(`rules.rs:${l.line} spent ${got} fuel; its loop's share of the ${extra} fuel step ${WORST} spent beyond step ${WORST - 1} is ${Math.round(share)}`);
  });
  const [f10, f20, f30] = budget.lines.map((l) => l.fuel) as [number, number, number];
  if (Math.abs(f10 / f30 - 3) > 0.3 || Math.abs(f20 / f30 - 2) > 0.2) failures.push(`the three lines' fuel ${f10} : ${f20} : ${f30} isn't 3 : 2 : 1 within 10%`);
  if (f10 + f20 + f30 > fuel) failures.push(`the three lines spent ${f10 + f20 + f30} fuel, more than the step's ${fuel}`);
  return { failures, lines: budget.lines, fuel };
}

prebuild(() => { budgetProgram(); logicBin(); });

describe('#531 criterion 11: logic.budget names the worst step\'s three costliest source lines', () => {
  it(`${AC[11]} the worst step's loops at rules.rs:10, 20 and 30 (3,000, 2,000 and 1,000 iterations) are logic.budget's three lines, in that order, each with its fuel`, () => {
    const { failures } = judge(bake());
    none(failures, 'logic.budget for the worst step');
  }, TIMEOUT);

  it(`${AC[11]} twin: budget_charges_function_first_line names one line, step's first, and fails`, () => {
    const { failures, lines } = judge(bake('budget_charges_function_first_line'));
    // Every block step 7 runs is in step (budgetProgram checks it), so the twin charges all of them to step's first
    // line, rules.rs:4 by its declaration (rules.rs:5 by its first instruction): a line before the first loop.
    expect(lines.length, `the twin names one line: ${JSON.stringify(lines)}`).toBe(1);
    const line = rulesLine(lines[0]!.source);
    expect(line !== null && line >= 3 && line < 10, `the twin's line ${lines[0]!.source} is step's first line in rules.rs, before its first loop`).toBe(true);
    expect(failures.length, 'the judgement that passes the real report fails on the twin').toBeGreaterThan(0);
    expect(failures.join('\n'), `the twin fails, naming the lines it gave: ${failures.join('; ')}`).toContain('not rules.rs:10, rules.rs:20 and rules.rs:30');
  }, TIMEOUT);
});
