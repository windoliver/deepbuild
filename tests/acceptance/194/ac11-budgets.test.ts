// AC11 #194.60b4ab87: "Budgets, on the reference Mac in the local preflight, compared with the merge base: packing 10,000
// rows of 20 columns takes under 1 s, catalog.reach and catalog.economy over 5,000 recipes each take under 200 ms, and a
// piece that names a catalog gains no work per frame"
//
// The timed file (README: Criterion 11), judged as #556's budgets are:
//   1. On any Mac, debug builds: what each budget times. `deep-catalog pack` of one table of 10,000 rows and 20 columns
//      (fixtures.ts `wideTable`) packs and reports `ms`, its own wall time; catalog.reach over a chain of 5,000 recipes
//      (`chain`) and catalog.economy over 2,500 recipe-and-uncraft pairs (`pairs`) pass through the hub and report
//      `catalog.ms`, the check's own time. "No work per frame": a film whose logic item `idle` names the fixture catalog,
//      against the same film naming none, in one deep-show: each of 60 frames runs as many nodes, the frames run nothing
//      in the sandbox (no validator per frame), and each of 60 logic steps spends the same fuel.
//   2. The record the local preflight's perf lane and the budget window compare with the merge base:
//      benchmarks/budgets.json's task `catalog-checks`, valid by the lane's validator, naming this criterion and #194,
//      and scripts/lanes.mjs runs this file as a timed one.
//   3. Only where the lane can judge (a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load
//      under the core count; else INCONCLUSIVE, never a pass): the release probe and the hub's plug-in, a warm-up and
//      five readings each, judged by scripts/benchmark.mjs's judgeLimit: the pack within 1 s, reach and economy within
//      0.2 s each.
// The wrong programs: the base (no deep-catalog, no plug-in, no record), a probe slower than a second, a fixed point or
// cycle search past 200 ms, and a piece that validates or copies its catalog again per frame.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bench, load, readJson } from '../184/helpers.ts';
import { binOf, framesCall, prebuild, presented, putEvidence, runShow, scenario, SESSION, showCall } from '../538/helpers.ts';
import {
  AC, DOC, REPO, TIMEOUT, canon, catalogBin, catalogOf, inconclusive, openHub, packAll, packCall, prebuildCatalog, runCheck, runPack, scratch, show, shown, specOf,
  type Hub, type Obj, type PackCall, type Packed,
} from './helpers.ts';
import { RECIPE_SCHEMA, SCHEMA, catalog, chain, pairs, wideTable } from './fixtures.ts';
import { idle, readerDoc } from './programs.ts';

prebuildCatalog(['debug', 'release']);
prebuild(['full']);

const FILE = 'tests/acceptance/194/ac11-budgets.test.ts';
const READINGS = 5;
const TASK = {
  id: 'catalog-checks', command: ['node', 'benchmarks/canvas.mjs', 'catalog-checks'], margin: 0.5,
  targets: { pack_10000x20_s: 1, reach_5000_s: 0.2, economy_5000_s: 0.2, frame_work: 0 },
};
const FRAMES = 60;

/** The record's gaps: the task as given, naming its criterion and #194, valid by the lane's validator, this file timed. */
async function recordGaps(): Promise<string[]> {
  const gaps: string[] = [];
  const budgets = readJson(join(REPO, 'benchmarks', 'budgets.json'));
  const found = (budgets['tasks'] as Obj[] | undefined)?.find((t) => t['id'] === TASK.id);
  if (!found) gaps.push(`benchmarks/budgets.json has no task ${TASK.id} for the perf lane and the budget window to compare with the merge base`);
  else {
    for (const [k, want] of Object.entries(TASK)) if (canon(found[k]) !== canon(want)) gaps.push(`${TASK.id}.${k} is ${show(found[k])}, not ${show(want)}`);
    if (!(Array.isArray(found['criteria']) && found['criteria'].includes(AC[11]))) gaps.push(`${TASK.id}.criteria doesn't name ${AC[11]}`);
    if (!(typeof found['initialReason'] === 'string' && found['initialReason'].includes('#194'))) gaps.push(`${TASK.id}.initialReason doesn't name #194`);
  }
  try { (await bench()).validateBudgets(budgets, { tasks: [] }); } catch (e) { gaps.push(`the lane's validator refuses benchmarks/budgets.json: ${(e as Error).message}`); }
  const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
  if (!lanes.timed.includes(FILE)) gaps.push(`scripts/lanes.mjs doesn't run ${FILE} as a timed file`);
  return gaps;
}
/** Only on a reference Mac at rest, as the perf lane judges; INCONCLUSIVE elsewhere, never a pass. */
async function gate(): Promise<Obj> {
  const bn = await bench();
  const fingerprint = bn.fingerprint();
  const g = bn.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint, loads: Array.from({ length: READINGS }, () => ({ start: load(), end: load() })) });
  if (g.status !== 'PASS') inconclusive(`the timings are judged only on a reference Mac at rest: ${g.reason ?? g.status}`);
  return fingerprint;
}
/** A warm-up, then five readings, each with the load at its start and end. */
async function readings(read: () => Promise<number>): Promise<{ runs: number[]; loads: { start: number; end: number }[] }> {
  await read();
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let n = 0; n < READINGS; n++) {
    const start = load();
    runs.push(await read());
    loads.push({ start, end: load() });
  }
  return { runs, loads };
}
/** The pack's own time, s, from its reply's `ms`. */
function packSeconds(call: PackCall, bin: string): number {
  const [r] = runPack([call], bin);
  expect(r!['ok'], `the 10,000 × 20 table packs: ${show(r)}`).toBe(true);
  expect(typeof r!['ms'] === 'number' && r!['ms'] >= 0, `the pack reports ms, its own wall time: ${show(r!['ms'])}`).toBe(true);
  return (r!['ms'] as number) / 1000;
}
const reachSpec = (c: Packed): Obj => specOf('catalog.reach', { catalog: c.sha256, roots: [{ table: 'items', ids: ['a0'] }], makes: [{ table: 'recipes', inputs: 'inputs', tools: 'tools', outputs: 'outputs' }], every: ['items', 'recipes'] }, [c]);
const economySpec = (c: Packed): Obj => specOf('catalog.economy', { catalog: c.sha256, makes: [{ table: 'recipes', inputs: 'inputs', tools: 'tools', outputs: 'outputs' }] }, [c]);
/** A check's own time, s, from its result's `catalog.ms`. */
async function checkSeconds(hub: Hub, spec: Obj): Promise<number> {
  const r = await runCheck(hub, spec);
  expect(r.outcome, `${String(spec['kind'])} over 5,000 recipes passes: ${shown(r)}`).toBe('passed');
  return catalogOf(r, spec['kind']).ms / 1000;
}

describe(`${AC[11]} the budgets: packing 10,000 × 20, reach and economy over 5,000 recipes, no work per frame`, () => {
  it(`${AC[11]} each budget's measure, no work per frame for a piece naming a catalog, the record; on a reference Mac, five readings within each budget`, async () => {
    const dir = scratch('ac11');
    const wide = wideTable();
    const call = packCall(dir, wide.tables, wide.schema);
    packSeconds(call, catalogBin());
    const [c] = packAll([call], 'the 10,000 × 20 table');
    const t = (c!.record['tables'] as Obj[])[0]!;
    expect([t['rows'], (t['columns'] as Obj[]).length], 'the record holds 10,000 rows of 20 columns').toEqual([10_000, 20]);
    const [chained, paired, fixture] = packAll([packCall(dir, chain(), RECIPE_SCHEMA), packCall(dir, pairs(), RECIPE_SCHEMA), packCall(dir, catalog(), SCHEMA)], 'the 5,000-recipe catalogs and the fixture');
    const hub = await openHub();
    await checkSeconds(hub, reachSpec(chained!));
    await checkSeconds(hub, economySpec(paired!));

    // No work per frame: the same film naming the catalog and naming none.
    const program = idle();
    const ev = scratch('ev');
    for (const b of [program.bytes, fixture!.bytes]) putEvidence(ev, b);
    const [a, b] = [DOC(21), DOC(22)];
    const steps = Array.from({ length: FRAMES }, (_, k) => k);
    const query = (doc: string): Obj => ({ call: 'deep_query', session: SESSION, doc, what: 'logic', items: ['idle'], steps, at: 0 });
    const r: Obj[] = runShow(binOf('full'), scenario(ev, [a, b], [
      showCall(a, readerDoc('idle', program, { k: 'i32' }, fixture!.sha256) as never), { call: 'sandbox' }, framesCall(a, FRAMES), { call: 'sandbox' }, query(a),
      showCall(b, readerDoc('idle', program, { k: 'i32' }, null) as never), framesCall(b, FRAMES), query(b),
    ]), 'AC11 no work per frame');
    presented(r[0]!, 'the film naming the catalog');
    presented(r[5]!, 'the same film naming none');
    const gaps: string[] = [];
    const ran = (x: Obj): unknown[] => (Array.isArray(x['frames']) ? (x['frames'] as Obj[]).map((f) => f['ran']) : []);
    if (ran(r[2]!).length !== FRAMES) gaps.push(`the frames call answered ${ran(r[2]!).length} frames, not ${FRAMES}: ${show(r[2])}`);
    else if (canon(ran(r[2]!)) !== canon(ran(r[6]!))) gaps.push(`frame_work: the frames of the film naming the catalog run other nodes than the film naming none: ${show(ran(r[2]!), 400)} against ${show(ran(r[6]!), 400)}`);
    if (canon(r[3]) !== canon(r[1])) gaps.push(`frame_work: the frames ran sandbox work (a validator, a check or a rewrite): ${show(r[1])} before, ${show(r[3])} after`);
    const fuel = (x: Obj): unknown[] => ((x['logic']?.['idle']?.['steps'] as Obj[] | undefined) ?? []).map((s) => s['fuel']);
    if (fuel(r[4]!).length !== FRAMES || canon(fuel(r[4]!)) !== canon(fuel(r[7]!))) gaps.push(`frame_work: the logic steps of the film naming the catalog spend other fuel than the film naming none: ${show(fuel(r[4]!), 300)} against ${show(fuel(r[7]!), 300)}`);
    gaps.push(...(await recordGaps()));
    expect(gaps, 'what the budgets time, and their record').toEqual([]);

    const fingerprint = await gate();
    const bn = await bench();
    const release = catalogBin('release');
    const judged: [string, number, { status: string; reason?: string; runs?: number[] }][] = [];
    const packs = await readings(async () => packSeconds(call, release));
    judged.push(['pack_10000x20_s', TASK.targets.pack_10000x20_s, bn.judgeLimit({ limit: TASK.targets.pack_10000x20_s, ...packs, fingerprint })]);
    const reach = await readings(() => checkSeconds(hub, reachSpec(chained!)));
    judged.push(['reach_5000_s', TASK.targets.reach_5000_s, bn.judgeLimit({ limit: TASK.targets.reach_5000_s, ...reach, fingerprint })]);
    const economy = await readings(() => checkSeconds(hub, economySpec(paired!)));
    judged.push(['economy_5000_s', TASK.targets.economy_5000_s, bn.judgeLimit({ limit: TASK.targets.economy_5000_s, ...economy, fingerprint })]);
    for (const [name, limit, j] of judged) expect(j.status, `${name} within ${limit}: ${show(j.runs)}, ${j.reason ?? ''}`).not.toBe('FAIL');
    const open = judged.filter(([, , j]) => j.status !== 'PASS');
    if (open.length) inconclusive(open.map(([name, , j]) => `${name}: ${j.status}, ${show(j.runs)}, ${j.reason ?? ''}`).join('; '));
  }, TIMEOUT * 3);
});
