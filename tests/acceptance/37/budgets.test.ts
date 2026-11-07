// AC16: budgets, on the reference Mac in the local preflight, compared with the merge base: a journey run's
// evidence stays under 20 MB (video at 720p and 15 fps); the runner adds under 10% to Playwright's own time. The
// numbers are judged by the design's timing rule and count only on a reference Mac in a fit state
// (environmentProblem, as #348's and #331's budgets gate theirs); anywhere else the test fails BLOCKED naming why,
// since nothing unrun passes. The merge-base comparison is the perf lane's. Run by hand on the Mac.
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blocked, checkout, journey, journeyPath, openWorld, runOptions, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state (tests/acceptance/348's rule). */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
const MB = 1024 * 1024;

describe('AC16 #37.2f7f3193 budgets on the reference Mac: a journey run\'s evidence stays under 20 MB (720p, 15 fps); the runner adds under 10% to Playwright\'s own time', () => {
  it('AC16 on the reference Mac, five cart-journey runs each leave under 20 MB of evidence, and each run\'s time beyond Playwright\'s own stays under 10%', async () => {
    const problem = environmentProblem();
    if (problem) blocked(`this budget counts only on the reference Mac in the local preflight, and this machine can't give it: ${problem}`);
    const { runJourney, playwrightTime } = await journey();
    const dir = checkout();
    await runJourney(runOptions(world, dir, journeyPath('cart-total')));   // a warm-up
    const sizes: number[] = [];
    const added: number[] = [];
    for (let i = 0; i < 5; i++) {
      const run = await runJourney(runOptions(world, dir, journeyPath('cart-total')));
      expect(run.outcome).toBe('passed');
      let total = 0;
      for (const sha of run.evidence) total += (await world.evidence.get(sha))!.size;
      sizes.push(total);
      const own = playwrightTime(run);
      added.push((run.timing.total - own) / own);
    }
    console.log(`evidence per run (MB): ${sizes.map((s) => (s / MB).toFixed(2)).join(', ')}; runner's share: ${added.map((a) => `${(a * 100).toFixed(1)}%`).join(', ')}`);
    expect(sizes.every((s) => s < 20 * MB), `every run's evidence is under 20 MB: ${sizes.map((s) => (s / MB).toFixed(2)).join(', ')}`).toBe(true);
    expect(added.every((a) => a < 0.1), `the runner adds under 10% to Playwright's own time: ${added.map((a) => `${(a * 100).toFixed(1)}%`).join(', ')}`).toBe(true);
  }, 900_000);
});
