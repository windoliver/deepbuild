// AC3: "The turbulence table is the same on every machine, by hash"
//
// Three smoke fixtures (helpers.ts: smokeDoc) with turbulence: seed 1 at the defaults (32 paths of 64 steps), seed 2,
// and seed 1 at the most the field takes (64 paths of 128 steps). The `particles` call reports each item's table as
// the SHA-256 of its bytes and writes the table, named by that hash, into the run's folder: paths × steps offsets of
// three f32 each (12 bytes a step). On this machine (aarch64): each file hashes to its name and holds paths × steps
// × 12 bytes, not all zero, and seeds 1 and 2 give different tables (so the hash isn't of something that doesn't
// depend on the table). Then on the other architecture this Mac runs, x86_64 under Rosetta 2 (`deep-gpu` built with
// `--target x86_64-apple-darwin`, built only once the native half holds): each table's hash is the same as here.
// Where no x86_64 target or no Rosetta 2 is available the test is INCONCLUSIVE after the native half, never passed.
// The criterion names no planted program.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SHA, TIMEOUT, ac, buildX86, flicks, inconclusive, passed, particlesCall, reading, runGpu, sha256, smokeDoc, useBins, useDir,
  writeJson, x86Unavailable, type Turbulence,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const TABLES: Record<string, Turbulence> = {
  'seed-1': { strength: 0.3, seed: 1 },
  'seed-2': { strength: 0.3, seed: 2 },
  'seed-1-largest': { strength: 0.3, seed: 1, paths: 64, steps: 128 },
};

function tables(bin: string, x86: boolean): Map<string, { table: string; paths: number; steps: number }> {
  const names = Object.keys(TABLES);
  const calls = names.map((n) => particlesCall({ doc: writeJson(dir(), `${n}.json`, smokeDoc(TABLES[n]!, `Smoke ${n}`)), t: [flicks(1)] }));
  const replies = runGpu(bin, dir(), calls, { backend: 'noop', x86 });
  return new Map(names.map((n, i) => {
    const turb = reading(passed(replies[i]!, calls[i]!, `${n}${x86 ? ' on x86_64' : ''}`), 'smoke', n).turbulence;
    expect(turb, `${n}: the reading reports its turbulence table`).not.toBeNull();
    return [n, turb!];
  }));
}

describe(`${ac(3)} the turbulence table is the same on every machine, by hash`, () => {
  it(`${ac(3)} each table's hash is the SHA-256 of its paths × steps × 12 bytes, seeds give different tables, and the x86_64 build under Rosetta 2 gives the same hashes as this arm64 build`, () => {
    const here = tables(bins.bin('deep-gpu'), false);
    for (const [n, t] of here) {
      const spec = TABLES[n]!;
      expect([t.paths, t.steps], `${n}: the table has the paths and steps the item declares`).toEqual([spec.paths ?? 32, spec.steps ?? 64]);
      expect(t.table, `${n}: the table is named by a SHA-256`).toMatch(SHA);
      const bytes = readFileSync(join(dir(), `${t.table}.f32`));
      expect(sha256(bytes), `${n}: the table's file hashes to its name`).toBe(t.table);
      expect(bytes.length, `${n}: paths × steps offsets of three f32`).toBe(t.paths * t.steps * 12);
      expect(bytes.some((b) => b !== 0), `${n}: the table holds offsets, not zeros`).toBe(true);
    }
    expect(here.get('seed-1')!.table, 'seeds 1 and 2 give different tables').not.toBe(here.get('seed-2')!.table);

    const why = x86Unavailable();
    if (why) inconclusive(`the tables on this machine hold, but the other architecture can't run here: ${why}`);
    const there = tables(buildX86(dir()), true);
    for (const [n, t] of here) expect(there.get(n)?.table, `${n}: the x86_64 build's table hash equals this machine's`).toBe(t.table);
  }, TIMEOUT);
});
