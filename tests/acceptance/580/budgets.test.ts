// #580 AC9: budgets, on the reference Mac, compared with the repo's own start, on the sample app: a run on unchanged keys
// has its stack ready within 5 s plus the app's own start; cloning the sample's 50 MB template database takes under 1 s;
// kept products add under 2 GB of disk per repo (targets, to be measured). Five runs on unchanged keys after the cold
// one. A timing over its limit on a loaded machine, or off a reference Mac, reads INCONCLUSIVE, never a pass or a FAIL;
// nothing gates on mains power. The readings are the record's; the disk is `du` and Docker's own sizes.
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Bench, containers, docker, judge, nameOf, passed, psql, stepOf, verdictOf, volumes, type Done, type Line } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

const RUNS = 5;
const MB = 1024 * 1024;
const du = (path: string): number => Number(execFileSync('du', ['-sk', path], { encoding: 'utf8' }).split('\t')[0]) * 1024;
/** Docker's own size of the project's volumes, in bytes. */
function volumeBytes(project: string): number {
  const names = new Set(volumes(project));
  const out = docker(['system', 'df', '-v', '--format', '{{json .Volumes}}'], 180_000).stdout.trim();
  const rows = JSON.parse(out || '[]') as Line[];
  const unit: Record<string, number> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return rows.filter((r) => names.has(String(r.Name))).reduce((sum, r) => {
    const m = /([\d.]+)\s*([A-Za-z]+)/.exec(String(r.Size));
    return sum + (m ? Number(m[1]) * (unit[m[2]!] ?? 1) : 0);
  }, 0);
}

describe('AC9 #580 a warm run stays near the repo\'s own start', () => {
  it('AC9 a run on unchanged keys is ready within 5 s plus the app\'s own start; cloning the 50 MB template takes under 1 s; kept products add under 2 GB', async (ctx) => {
    const b = bench = await Bench.open({ seedMb: 50 });
    const s = await b.session();
    const cold = await b.whole(s);
    passed(cold);
    const db = containers(cold.served.project, 'db')[0]!;
    const template = nameOf(b.stepLog().find((l) => l.step === 'seed')!.database!);
    const size = Number(psql(db, 'postgres', `SELECT pg_database_size('${template}')`));
    expect(size / MB, `the scenario formed: the template database ${template} holds 50 MB`).toBeGreaterThanOrEqual(50);

    const warm: Done[] = [];
    for (let i = 0; i < RUNS; i++) warm.push(await b.whole(s));
    for (const d of warm) {
      passed(d);
      for (const step of ['services', 'install', 'migrate', 'seed']) expect(stepOf(d.served, step).status, `${d.run} is on unchanged keys`).toBe('reused');
    }
    const kept = du(join(b.w.root, 'products')) + volumeBytes(cold.served.project);
    expect(kept, 'the kept products hold the install and the template').toBeGreaterThan(50 * MB);
    expect(kept / 1e9, `kept products add under 2 GB (${(kept / 1e9).toFixed(2)} GB)`).toBeLessThan(2);

    verdictOf(ctx, [
      judge('stack ready less the app\'s own start, ms', warm.map((d) => d.served.ready_ms - stepOf(d.served, 'app').ms), 5000),
      judge('cloning the 50 MB template, ms', warm.map((d) => stepOf(d.served, 'clone').ms), 1000),
    ]);
  }, 2_400_000);
});
