// #580 AC1, the wrong program, redrafted blind on a dispute (README, Redrafts). It replaces the "(wrong program)" test in
// start-steps.test.ts. A planted environment that reuses the install after the lockfile changed fails environment@1,
// naming the step and both keys. The scenario is that file's, three claims with the third changing package-lock.json;
// the reading is the third run's own finding in `run.finished.findings`, whole, since an assertion's message over the
// list prints it only as `[ Array(1) ]`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Bench, environmentFailures, stepOf, type Done } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

async function scenario(plant: string): Promise<{ second: Done; third: Done }> {
  const b = bench = await Bench.open({ plant });
  const s = await b.session();
  await b.whole(s);
  const second = await b.whole(s);
  const third = await b.whole(s, {
    change: async () => {
      const path = join(s.cwd, 'package-lock.json');
      await s.call('Write', { file_path: path, content: b.w.lock101 }, { effect: () => writeFileSync(path, b.w.lock101) });
      const manifest = join(s.cwd, 'package.json');
      const text = readFileSync(manifest, 'utf8').replace('dh-wire-1.0.0', 'dh-wire-1.0.1');
      await s.call('Write', { file_path: manifest, content: text }, { effect: () => writeFileSync(manifest, text) });
    },
  });
  return { second, third };
}

describe('AC1 #580 a planted environment that reuses a stale install fails environment@1', () => {
  it('AC1 (wrong program, redraft) an environment that reuses the install after the lockfile changed (DEEP_HUB_PLANT=env-reuses-stale-install) fails environment@1, naming the step and both keys', async () => {
    const { second, third } = await scenario('env-reuses-stale-install');
    const findings = environmentFailures(third.finished);
    expect(findings.length, `the third run failed environment@1 (its findings: ${JSON.stringify(third.finished.findings).slice(0, 800)})`).toBeGreaterThan(0);
    const line = findings.find((f) => f.includes('install')) ?? findings.join(' | ');
    expect(line, 'it fails environment@1').toContain('environment@1');
    expect(line, 'naming the step').toContain('install');
    const kept = stepOf(second.served, 'install').key!;
    expect(line, 'naming the key the second run recorded, the one it reused').toContain(kept);
    const others = [...new Set(line.match(/[0-9a-f]{12,}/g) ?? [])].filter((key) => !kept.includes(key));
    expect(others.length, `and a second, different key, the one the lockfile makes: ${line}`).toBeGreaterThanOrEqual(1);
  }, 1_500_000);
});
