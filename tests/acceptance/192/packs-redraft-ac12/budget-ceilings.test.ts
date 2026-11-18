// #192.e8dea9d2 (criterion 12), blind redraft: a provider's budget is checked where its pack is checked, before any
// run. A new fixture pack whose provider states `budget: {fuel: 10,000,000,001}` is refused at check, naming the
// provider and `budget/fuel`; one that states `memory: 257` is refused, naming `budget/memory`; a provider that states
// 10,000,000,000 and 256 runs. The merge base's check runs both refused providers, returns no refusal and fails this
// test, naming the first.
//
// What the redraft changes (README): the two refused providers have different content keys at the merge base (their
// `out` differs: max_vertices 4 and 8), since the base's key covers the program, params, seed, assets, out and the
// sandbox module's version but never the budget; and the base's runs are counted around each document's check, so
// each refused provider's own run is seen. The packs, programs and the surface are the packs suite's
// (tests/acceptance/192/packs/README.md: The surface), through its helpers.
import { describe, expect, it } from 'vitest';
import {
  DOC, SANDBOX_COUNTS, SHOW, TIMEOUT, baseShow, deepShow, errors, fresh, hostReady, installPack, installShown, issuesAt, meshBytes, meshDoc,
  meshProvider, nodeRun, prebuild, present, program, provided, providedRow, providerPack, ranTheQuad, runShow, runsOf, scenario, show, useTemp,
  type JsonObject, type PackDir,
} from '../packs/helpers.ts';

/** Criterion 12's ID: `#192.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#192.e8dea9d2';
prebuild(() => { deepShow(SHOW); baseShow(); });
const temp = useTemp();

const FUEL_OVER = 10_000_000_001;
const FUEL_MAX = 10_000_000_000;
const MEMORY_OVER = 257;
const MEMORY_MAX = 256;

interface Packs { fuel: PackDir; memory: PackDir; ceiling: PackDir }
function packs(root: string): Packs {
  const quad = program('quad');
  const ceiling = program('ceiling');
  return {
    // max_vertices 4 and 8: the same program and params, another `out`, so another content key at the merge base.
    fuel: providerPack(root, 'fuelover', { fuel_over: meshProvider(quad, { budget: { fuel: FUEL_OVER } }, 4) }, { 'quad.wasm': quad.bytes }).pack,
    memory: providerPack(root, 'memoryover', { memory_over: meshProvider(quad, { budget: { memory: MEMORY_OVER } }, 8) }, { 'quad.wasm': quad.bytes }).pack,
    ceiling: providerPack(root, 'ceilings', { at_ceiling: meshProvider(ceiling, { budget: { fuel: FUEL_MAX, memory: MEMORY_MAX } }) }, { 'ceiling.wasm': ceiling.bytes }).pack,
  };
}
/** The calls, in order: the two refused packs, the run count, the pack at the ceilings, each document's check with the run count after it, the rows. */
const calls = (p: Packs): JsonObject[] => [
  installPack(p.fuel), installPack(p.memory), SANDBOX_COUNTS, installPack(p.ceiling),
  present(DOC.a, meshDoc(p.fuel, 'fuelover.fuel_over')), SANDBOX_COUNTS, present(DOC.b, meshDoc(p.memory, 'memoryover.memory_over')), SANDBOX_COUNTS,
  present(DOC.c, meshDoc(p.ceiling, 'ceilings.at_ceiling')), provided(DOC.a), provided(DOC.b), provided(DOC.c),
];

/** What the criterion requires of one run of the scenario, in its order; each failure names what it misses. */
function failures(r: JsonObject[]): string[] {
  const [fuel, memory, counts, ceiling, , , , , shownCeiling, , , providedCeiling] = r;
  const out: string[] = [];
  if (fuel?.['outcome'] !== 'refused' || issuesAt(fuel, 'providers/fuel_over/budget/fuel').length === 0) {
    out.push(`test/fuelover@1.0.0, whose provider fuel_over states budget {fuel: 10,000,000,001}, isn't refused at check naming the provider and budget/fuel (an issue at providers/fuel_over/budget/fuel): ${installShown(fuel)}`);
  }
  if (memory?.['outcome'] !== 'refused' || issuesAt(memory, 'providers/memory_over/budget/memory').length === 0) {
    out.push(`test/memoryover@1.0.0, whose provider memory_over states budget {memory: 257}, isn't refused at check naming the provider and budget/memory (an issue at providers/memory_over/budget/memory): ${installShown(memory)}`);
  }
  if (typeof counts?.['runs'] !== 'number' || counts['runs'] !== 0) {
    out.push(`a budget past its ceiling is refused before any run, but the sandbox module had run ${show(counts?.['runs'])} programs after the two refused packs`);
  }
  if (ceiling?.['outcome'] !== 'installed') {
    out.push(`test/ceilings@1.0.0, whose provider at_ceiling states budget {fuel: 10,000,000,000, memory: 256}, isn't installed: ${installShown(ceiling)}`);
  }
  if (shownCeiling?.['outcome'] !== 'presented' || errors(shownCeiling).length > 0) {
    out.push(`the document naming ceilings.at_ceiling isn't presented without an error: ${show(shownCeiling)}`);
  }
  if (!ranTheQuad(providedRow(providedCeiling))) {
    out.push(`ceilings.at_ceiling (budget 10,000,000,000 and 256) didn't run at the document's check to its one-quad mesh in the top 4 KiB of its 256 MiB memory: ${show(providedCeiling)}`);
  }
  return out;
}

describe(`${ID} a provider's budget past fuel 10,000,000,000 or memory 256 is refused at check, naming the provider and the field; at the ceilings it runs`, () => {
  it(`${ID} fuel 10,000,000,001 is refused naming budget/fuel and memory 257 naming budget/memory, both before any run; 10,000,000,000 and 256 run; the merge base runs both refused providers with no refusal and fails, naming the first`, () => {
    hostReady();
    // The fixtures as written, in Node's engine: quad.wat writes its quad; ceiling.wat holds 256 MiB and writes its
    // quad in the top 4 KiB.
    const quadRun = nodeRun(program('quad'));
    expect([quadRun.trap, meshBytes(quadRun).n, meshBytes(quadRun).indices], 'quad.wat runs to a 4-vertex, 6-index mesh').toEqual([null, 4, 6]);
    const ceilingRun = nodeRun(program('ceiling'));
    expect([ceilingRun.trap, ceilingRun.memoryBytes, meshBytes(ceilingRun).n], 'ceiling.wat holds 256 MiB and writes its quad at its top').toEqual([null, MEMORY_MAX * 1024 * 1024, 4]);

    const dir = fresh(temp(), 'here');
    const here = runShow(deepShow(SHOW), scenario(dir, calls(packs(dir))));
    expect(failures(here), 'this build meets criterion 12').toEqual([]);

    // The merge base, on the same scenario: both refused providers install, each document's check runs its provider
    // (one run each, their keys apart), and this test's first failure names budget/fuel.
    const base = baseShow();
    const baseDir = fresh(temp(), 'base');
    const there = runShow(base.bin, scenario(baseDir, calls(packs(baseDir))));
    const [fuel, memory, before, , , afterFuel, , afterMemory, , providedFuel, providedMemory] = there;
    const at = `the merge base ${base.sha.slice(0, 12)}`;
    expect([fuel?.['outcome'], memory?.['outcome']], `${at} refuses neither budget at check: ${installShown(fuel)}; ${installShown(memory)}`).toEqual(['installed', 'installed']);
    const runs = [runsOf(before, `${at}: sandbox`), runsOf(afterFuel, `${at}: sandbox after fuelover's document`), runsOf(afterMemory, `${at}: sandbox after memoryover's document`)];
    expect(runs[1]! - runs[0]!, `${at} runs fuelover.fuel_over at its document's check (runs ${runs.join(' → ')})`).toBeGreaterThanOrEqual(1);
    expect(runs[2]! - runs[1]!, `${at} runs memoryover.memory_over at its document's check (runs ${runs.join(' → ')})`).toBeGreaterThanOrEqual(1);
    expect(ranTheQuad(providedRow(providedFuel)), `${at}: fuelover.fuel_over wrote its quad, no trap: ${show(providedFuel)}`).toBe(true);
    expect(ranTheQuad(providedRow(providedMemory)), `${at}: memoryover.memory_over wrote its quad, no trap: ${show(providedMemory)}`).toBe(true);
    const baseFailures = failures(there);
    expect(baseFailures[0] ?? '', `${at} fails this test, naming the first refusal, budget/fuel: ${show(baseFailures)}`).toContain('budget/fuel');
  }, TIMEOUT);
});
