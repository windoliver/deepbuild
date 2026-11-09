// Criterion 5 (no upstream test): "A program that calls through a fixed function table with call_indirect and
// moves data with memory.copy, restored from each checkpoint and run on for 600 steps, gives the same full-state
// hashes at each checkpoint, step hashes and continuation probes as a straight run, in the app and in headless
// Chrome's own WebAssembly engine"
//
// Through `deep-logic bake` and the logic module's web runner (README: deep-logic, The web runner). `table_copy`
// (programs.ts) calls one of four functions through a table its active segment filled, picked by the step and a
// `nudge` entry's value, and moves 512 bytes with memory.copy each step. A straight run of 1,200 steps checkpoints
// every 60 steps (checkpoint.every's default); each checkpoint of its first 600 steps is restored into a fresh
// instance and run on for 600 steps. A continuation probe feeds the straight state and the restored one at that
// checkpoint the same next input, a nudge three steps on, then 60 steps (Check input: logic kinds). "In the app" is
// `deep-logic` on this Mac; Chrome runs the bytes the app rewrote, through `web_plan`'s request.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, at, bakeCall, bakeOf, checkCall, firstDiff, inChrome, logicBin, none, obj, onMac, piece, prebuild, seeded, stepHashes, webPlanCall, webPlans, webRunnerSource, yours, type Bake, type BakeSpec, type Entry, type JsonObject, type Layout, type ProbeResult, type StepRecord } from './helpers.ts';
import { probe, tableCopy } from './programs.ts';

prebuild(() => { logicBin(); });

const STEPS = 1200;
const RUN_ON = 600;
const EVERY = 60;
const FROM = Array.from({ length: RUN_ON / EVERY + 1 }, (_, i) => i * EVERY);
const WRITES = { acc: { type: 'i32' as const }, mix: { type: 'f64' as const } };

let layout: Layout | undefined;
function tableLayout(): Layout {
  if (layout) return layout;
  const [reply] = onMac([checkCall(piece({ seed: 531_05, controls: ['nudge'], items: { table: { program: probe(), reads: ['nudge'], writes: WRITES } } }))]);
  layout = admitted(reply!, 'check of the table item')['table']!.layout;
  return layout;
}
const tablePiece = (): JsonObject => piece({ seed: 531_05, controls: ['nudge'], items: { table: { program: tableCopy(tableLayout()), reads: ['nudge'], writes: WRITES } } });
/** Nudges of yours at seeded steps (about one in 40), values 0 to 4. */
function track(): Entry[] {
  const r = seeded(531_05);
  const out: Entry[] = [];
  for (let k = 1; k < STEPS; k++) if (r() < 0.025) out.push(yours('nudge', k, Math.floor(r() * 5)));
  return out;
}
const probeEntries = (c: number): Entry[] => [yours('nudge', c + 3, 2, 1)];
const SPEC: BakeSpec = {
  steps: STEPS, track: track(),
  restores: FROM.map((from) => ({ from, steps: RUN_ON, probe: { entries: probeEntries(from), steps: 60 } })),
  probes: FROM.map((c) => ({ at: c, entries: probeEntries(c), steps: 60 })),
};

const rows = (steps: StepRecord[]): string[] => steps.map((s) => JSON.stringify([s.step, s.items['table']?.hash ?? null, s.arrays['table.acc'] ?? null, s.arrays['table.mix'] ?? null]));
const probeRows = (p: ProbeResult): string[] => [...rows(p.steps), `deep ${p.deep_hash['table']}`];

/** Every restore against the straight run: deep hashes at each checkpoint, step hashes and arrays, probes. */
function judgeRestores(b: Bake, what: string): string[] {
  const failures: string[] = [];
  const straight = b.checkpoints['table'] ?? [];
  expect(straight.map((c) => c.step), `${what}: the straight run checkpoints every ${EVERY} steps from step 0`).toEqual(Array.from({ length: STEPS / EVERY + 1 }, (_, i) => i * EVERY));
  expect(new Set(straight.map((c) => c.deep_hash)).size, `${what}: the state changes between checkpoints`).toBeGreaterThan(straight.length / 2);
  expect(b.restores.map((r) => r.from), `${what}: one restore per checkpoint of the first ${RUN_ON} steps`).toEqual(FROM);
  for (const r of b.restores) {
    const mine = r.checkpoints['table'] ?? [];
    const want = straight.filter((c) => c.step >= r.from && c.step <= r.from + RUN_ON);
    const d1 = firstDiff(mine.map((c) => `${c.step} ${c.deep_hash}`), want.map((c) => `${c.step} ${c.deep_hash}`));
    if (d1) failures.push(`${what}, restored from ${r.from}: the full-state hashes at its checkpoints differ from the straight run's, first at ${d1}`);
    const d2 = firstDiff(rows(r.steps), rows(b.steps.filter((s) => s.step >= r.from && s.step < r.from + RUN_ON)));
    if (d2) failures.push(`${what}, restored from ${r.from}: its step hashes or arrays differ from the straight run's, first at ${d2}`);
    const p = b.probes.find((x) => x.at === r.from);
    if (!r.probe || !p) { failures.push(`${what}, restored from ${r.from}: no probe from both states`); continue; }
    const d3 = firstDiff(probeRows(r.probe), probeRows(p));
    if (d3) failures.push(`${what}, restored from ${r.from}: the continuation probe differs from the straight state's, first at ${d3}`);
  }
  return failures;
}
/** The fields the app and Chrome must agree on. */
const agreed = (b: Bake): string[] => [
  ...stepHashes(b.steps), ...rows(b.steps),
  ...(b.checkpoints['table'] ?? []).map((c) => `checkpoint ${c.step} ${c.deep_hash}`),
  ...b.restores.flatMap((r) => [...(r.checkpoints['table'] ?? []).map((c) => `restore ${r.from} checkpoint ${c.step} ${c.deep_hash}`), ...rows(r.steps).map((x) => `restore ${r.from} ${x}`), ...(r.probe ? probeRows(r.probe).map((x) => `restore ${r.from} probe ${x}`) : [])]),
  ...b.probes.flatMap((p) => probeRows(p).map((x) => `probe ${p.at} ${x}`)),
];

describe(`${AC[5]} seeking equals playing for a table and memory.copy program, in the app and in headless Chrome`, () => {
  it(`${AC[5]} in the app, each checkpoint of the first 600 steps, restored and run on for 600 steps, gives the straight run's full-state hashes, step hashes and continuation probes`, () => {
    const b = bakeOf(onMac([bakeCall(tablePiece(), SPEC)])[0]!, 'the app\'s bake');
    expect(b.traps, 'the program never traps').toEqual([]);
    expect(at(b.steps, STEPS - 1, 'the straight run').items['table']?.hash, 'the straight run reached its last step').toBeTruthy();
    none(judgeRestores(b, 'in the app'), 'every restore equals the straight run');
  }, TIMEOUT);

  it(`${AC[5]} in headless Chrome's own WebAssembly engine, the same bake gives the app's full-state hashes, step hashes, restores and probes`, async () => {
    const app = bakeOf(onMac([bakeCall(tablePiece(), SPEC)])[0]!, 'the app\'s bake');
    const source = webRunnerSource();
    const [request] = webPlans([webPlanCall(tablePiece(), SPEC)]);
    const chrome = await inChrome(source, [request!]);
    expect(chrome.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome/);
    const web = bakeOf(obj(chrome.replies[0], 'Chrome\'s bake'), 'Chrome\'s bake');
    none(judgeRestores(web, 'in headless Chrome'), 'every restore equals the straight run in Chrome too');
    const d = firstDiff(agreed(web), agreed(app));
    expect(d, `Chrome's hashes, arrays, restores and probes equal the app's (first difference: ${d})`).toBeNull();
  }, TIMEOUT);
});
