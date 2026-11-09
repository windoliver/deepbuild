// #1492.3139ba2b: the idle report prints the energy reading, or BLOCKED naming the counter when it reads zero.
// Energy is a reading only, never a gate (the issue's Not in scope). The judge is the lane's own, fed readings made up
// for it; the live test runs the idle task itself on a Mac.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BENCH, REPO, idleReport, judged, str, type Json, type Line } from './helpers.ts';

const ID = '#1492.3139ba2b';
const COUNTER = 'ri_energy_nj';
const energyOf = (verdict: Line): Line => verdict['energy'] as Line;

describe(`${ID} the idle report prints the energy reading, or BLOCKED, naming the counter, when it reads zero`, () => {
  it(`${ID} a reading prints beside CPU with its counter's name and each run's value`, () => {
    const nj = [1_100_000, 1_200_000, 1_150_000, 1_300_000, 1_250_000];
    const verdict = judged(idleReport((i) => ({ counter: COUNTER, nj: nj[i - 1]! })));
    expect(energyOf(verdict), JSON.stringify(verdict).slice(0, 1500)).toMatchObject({ status: 'READING', counter: COUNTER, runs: nj });
  });

  it(`${ID} a counter that reads zero is BLOCKED, naming it, also when one run of five does`, () => {
    const energy = energyOf(judged(idleReport(() => ({ counter: COUNTER, nj: 0 }))));
    expect(energy['status'], JSON.stringify(energy)).toBe('BLOCKED');
    expect(str(energy['counter']), 'it names the counter').toBe(COUNTER);
    expect(str(energy['reason']), 'and says why').toContain(COUNTER);
    const mixed = energyOf(judged(idleReport((i): Json => ({ counter: COUNTER, nj: i === 3 ? 0 : 1_000_000 }))));
    expect(mixed['status'], 'one run that reads zero blocks the reading').toBe('BLOCKED');
    expect(str(mixed['counter'])).toBe(COUNTER);
  });

  it(`${ID} energy is a reading only: the same report at 1e6, 9e9 and 0 nJ gets the same verdict status and targets`, () => {
    const at = (nj: number): Line => judged(idleReport(() => ({ counter: COUNTER, nj })));
    const [low, high, zero] = [at(1_000_000), at(9_000_000_000), at(0)];
    const without = (v: Line): Line => { const { energy: _, ...rest } = v; return rest; };
    expect(without(high), 'a thousandfold energy changes no status, target or reason').toEqual(without(low));
    expect(without(zero), 'a zero reading changes none either').toEqual(without(low));
    expect(energyOf(low)['status']).toBe('READING');
    expect(energyOf(high)['status']).toBe('READING');
    expect(energyOf(zero)['status']).toBe('BLOCKED');
  });

  it(`${ID} the idle task itself reports each run's energy, and the judge prints it or BLOCKED`, (ctx) => {
    if (process.platform !== 'darwin') ctx.skip('INCONCLUSIVE: the idle window draws on macOS');
    const run = spawnSync(process.execPath, [BENCH, 'idle'], { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, killSignal: 'SIGKILL', maxBuffer: 1 << 29 });
    expect(run.status, `idle exits 0: ${(run.stderr ?? '').slice(-2000)}`).toBe(0);
    const report = JSON.parse(run.stdout.split('\n').filter((l) => l.trim() !== '').at(-1)!) as Line;
    const runs = report['runs'] as Line[];
    expect(runs.length).toBe(5);
    for (const [i, each] of runs.entries()) {
      const energy = each['energy'] as Line;
      expect(str(energy?.['counter']), `run ${i + 1} names its counter: ${JSON.stringify(each).slice(0, 600)}`).not.toBe('');
      expect(typeof energy['nj'], `run ${i + 1} reads a number`).toBe('number');
    }
    const verdict = energyOf(judged(report));
    const zero = runs.some((each) => (each['energy'] as Line)['nj'] === 0);
    expect(verdict['status'], JSON.stringify(verdict)).toBe(zero ? 'BLOCKED' : 'READING');
    console.log(`#1492 energy: ${JSON.stringify(verdict)}`);
  }, 3_600_000);
});
