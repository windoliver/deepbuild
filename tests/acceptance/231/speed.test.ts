// AC5 #231.0c28c755: "… The stated speeds hold for the mean of 3 cold runs, and a warm run is never averaged in; …"
// (its two starts and its planted receipt are starts.test.ts's)
// AC7 #231.f202d6a5: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a delivery
// with every export guard on (#157), export.fidelity's second draw of each distinct frame included, exports at least
// 2x real time at 1080p60 on each speed fixture on its own, the city's included; a planted guard that waits 8.4 ms a
// frame takes the city's delivery past 30 s and fails, naming the city and the guard"
// AC9 #231.2bfc9b79: "Each speed fixture, timed on its own on the reference Mac from the command to the file, exports
// as a draft and as a delivery within its own limits: the explainer in at most 9 s and 18 s, the orbit in at most 2.5 s
// and 5 s, and the city in at most 15 s and 30 s; a planted judge that times the set as a whole passes a 34 s city
// delivery beside a 14 s explainer and a 4 s orbit (52 s against the set's 53 s) and fails this test, naming the city"
//
// The speed fixture set (helpers.ts `speedFilm`: the explainer, the orbit and the city, each at 1080p60) is timed once
// for the file: each fixture, as a draft and as a delivery, in three fresh headless `deep-show run` processes, each
// timed from outside from the command to the file (helpers.ts `timedShow`). A fixture's speed is the mean of its
// three cold runs, held to its own limit by judges.ts `speedFailures`; the three criteria read the same 18 runs. The
// runs are made only on a reference Mac on mains power with Low Power Mode off, the thermal state nominal and the load
// at or under the core count, and each timed test reads INCONCLUSIVE with its reason anywhere else, never a pass; a
// run that waited for the GPU lease, or a load that rose during the runs, reads INCONCLUSIVE with the readings. The
// merge-base comparison is the perf lane's: benchmarks/budgets.json holds a task that names criterion 7, valid against
// the merge base's budgets. Criterion 9's planted judge is this suite's own (judges.ts `setAsWholeFailures`), shown the
// criterion's numbers on any machine. Planted in the product: `guard_waits_8_4_ms`. Wrong program otherwise: the
// merge base, which exports at about real time, reads no `purpose` and whose receipt holds no `start`.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CRITERION_9, FIXTURES, FULL, REPO, SET, SPEED, benchmark, cold3, count, countFailures, countedOf, failsNaming, inconclusive, isObject, loadProblem, mean, none,
  obj, receiptOf, referenceMacProblem, setAsWholeFailures, setFailures, speedFailures, speedRun, startOf, timingOf, useFileTemp, useShow,
  type Fixture, type JsonObject, type Planted, type Purpose, type Readings, type Run,
} from './helpers.ts';

const show = useShow();
const kept = useFileTemp();
const PURPOSES = ['draft', 'delivery'] as const;
const ID7 = AC[7].split(' ')[1]!;

interface Timed { run: Run; reply: JsonObject; loads: { start: number; end: number } }
/** Three cold runs of one fixture and purpose, each a fresh process timed from the command to the file. */
async function three(which: Fixture, purpose: Purpose, planted?: Planted): Promise<Timed[]> {
  const out: Timed[] = [];
  for (let i = 0; i < 3; i++) {
    const dir = kept();
    const what = `the ${which}'s ${purpose}, cold run ${i + 1}${planted ? ` (planted ${planted})` : ''}`;
    const r = await speedRun(show(FULL), dir, which, purpose, planted);
    const receipt = receiptOf(r.reply, what);
    expect(receipt.frames, `${what}: the ${which}'s ${SET[which].frames} frames at 1080p60`).toBe(SET[which].frames);
    expect([receipt.size, receipt.rate], `${what}: 1920 × 1080 at 60 fps`).toEqual([[1920, 1080], [60, 1]]);
    expect(r.measured, `${what}: the file came under its name`).not.toBeNull();
    out.push({ run: { seconds: r.measured!, start: startOf(receipt, what), timing: timingOf(receipt, what) }, reply: r.reply, loads: r.loads });
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
/** Why the machine's readings don't count now; null on a quiet reference Mac. */
const unfit = async (): Promise<string | null> => (await referenceMacProblem()) ?? loadProblem();
/** Why a set of runs made on a fit machine still doesn't count: the load rose, or a run waited for the GPU lease. */
function disturbed(runs: readonly Timed[]): string | null {
  const load = loadProblem(runs.map((r) => r.loads));
  if (load) return load;
  const waited = runs.map((r) => { const lease = obj(r.reply['receipt'], 'receipt')['lease']; return isObject(lease) && typeof lease['waited_ms'] === 'number' ? lease['waited_ms'] : 0; });
  return Math.max(...waited) >= 100 ? `a run waited ${Math.max(...waited)} ms for the GPU lease another export held` : null;
}

/** The 18 runs, made once for the file on a fit machine; elsewhere the reason they weren't. */
let made: Promise<{ off: string } | { set: Record<Fixture, Record<Purpose, Timed[]>> }> | undefined;
function timedSet(): Promise<{ off: string } | { set: Record<Fixture, Record<Purpose, Timed[]>> }> {
  made ??= (async () => {
    const off = await unfit();
    if (off) return { off };
    const set = {} as Record<Fixture, Record<Purpose, Timed[]>>;
    for (const x of FIXTURES) set[x] = { draft: await three(x, 'draft'), delivery: await three(x, 'delivery') };
    const lines = FIXTURES.flatMap((x) => PURPOSES.map((p) => {
      const secs = set[x][p].map((r) => r.run.seconds);
      return `  ${x} ${p}: ${secs.map((v) => v.toFixed(2)).join(', ')} s, mean ${mean(secs).toFixed(2)} s against ${SPEED[x][p]} s (${(SPEED[x].seconds / mean(secs)).toFixed(2)}x real time)`;
    }));
    console.log(`#231 the speed fixture set, each fixture on its own, the mean of 3 cold runs from the command to the file:\n${lines.join('\n')}`);
    return { set };
  })();
  return made;
}
/** The runs, or the test reads INCONCLUSIVE: off a quiet reference Mac nothing is timed. */
async function fitSet(): Promise<Record<Fixture, Record<Purpose, Timed[]>>> {
  const t = await timedSet();
  if ('off' in t) return inconclusive(`the speeds count only on a quiet reference Mac, so nothing is timed here: ${t.off}`);
  return t.set;
}
const readingsOf = (set: Record<Fixture, Record<Purpose, Timed[]>>): Readings => {
  const of = (x: Fixture): Record<Purpose, Run[]> => ({ draft: set[x].draft.map((r) => r.run), delivery: set[x].delivery.map((r) => r.run) });
  return { explainer: of('explainer'), orbit: of('orbit'), city: of('city') };
};
/** A miss while the machine was disturbed is a reading; a miss on a quiet machine fails. */
function judged(failures: string[], runs: readonly Timed[], what: string): void {
  const why = disturbed(runs);
  if (why) inconclusive(`${what}: ${failures.join(' | ') || 'within its limits'}; but the readings don't count: ${why}`);
  none(failures, what);
}

describe(`${AC[9]} each speed fixture, timed on its own, exports as a draft and as a delivery within its own limits`, () => {
  it(`${AC[9]} on the reference Mac the explainer takes at most 9 s and 18 s, the orbit 2.5 s and 5 s and the city 15 s and 30 s, each the mean of 3 cold runs from the command to the file`, async () => {
    const set = await fitSet();
    judged(setFailures(readingsOf(set)), FIXTURES.flatMap((x) => [...set[x].draft, ...set[x].delivery]), 'each speed fixture on its own, as a draft and as a delivery');
  });

  it(`${AC[9]} a planted judge that times the set as a whole passes a 34 s city delivery beside a 14 s explainer and a 4 s orbit, 52 s against the set's 53 s, and this suite's judge fails them, naming the city`, () => {
    const delivery = (x: Fixture): number => mean(CRITERION_9[x].delivery.map((r) => r.seconds));
    expect([delivery('city'), delivery('explainer'), delivery('orbit')], 'the criterion\'s readings').toEqual([34, 14, 4]);
    expect([delivery('city') + delivery('explainer') + delivery('orbit'), SPEED.city.delivery + SPEED.explainer.delivery + SPEED.orbit.delivery], '52 s against the set\'s 53 s').toEqual([52, 53]);
    expect(setAsWholeFailures(CRITERION_9), 'the planted judge, judge_times_set_as_whole, passes the set').toEqual([]);
    const own = setFailures(CRITERION_9);
    failsNaming(own, /^the city's delivery: 34\.000 s/, 'this suite\'s judge on the same readings');
    expect(own.length, `only the city's delivery misses: ${own.join(' | ')}`).toBe(1);
  });
});

describe(`${AC[7]} budgets: a delivery with every export guard on exports at least 2x real time at 1080p60 on each speed fixture on its own`, () => {
  it(`${AC[7]} the perf lane has a task that names ${ID7}, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string; criteria?: string[] }[] };
    const names = (t: { initialReason?: string; changeReason?: string; criteria?: string[] }): boolean => (t.criteria ?? []).includes(ID7) || `${t.initialReason ?? ''} ${t.changeReason ?? ''}`.includes(ID7);
    expect(current.tasks.some(names), `benchmarks/budgets.json has a task whose reason or criteria name ${ID7}`).toBe(true);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', env }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })));
  });

  it(`${AC[7]} on the reference Mac each fixture's delivery, export.fidelity's second draw of each distinct frame included, takes at most half its length: 18 s, 5 s and the city's 30 s`, async () => {
    const set = await fitSet();
    const failures: string[] = [];
    for (const x of FIXTURES) {
      set[x].delivery.forEach((r, i) => {
        const what = `the ${x}'s delivery, cold run ${i + 1}`;
        // Every guard ran: the count's own shape, each distinct frame drawn a second time, and the delivery read back.
        failures.push(...countFailures(what, countedOf(r.reply, what), { frames: SET[x].frames, draws: SET[x].draws, purpose: 'delivery' }));
        const receipt = obj(r.reply['receipt'], `${what}: receipt`);
        const read = count(obj(receipt['fidelity'], `${what}: receipt.fidelity`)['frames'], `${what}: receipt.fidelity.frames`);
        if (read !== SET[x].frames) failures.push(`${what}: export.fidelity read ${read} frames of the delivery, not ${SET[x].frames}`);
        if (!isObject(receipt['color_probe'])) failures.push(`${what}: the receipt holds no color_probe, so export.color didn't run`);
        if (!Array.isArray(receipt['nonfinite']) || receipt['nonfinite'].length !== 0) failures.push(`${what}: the receipt's nonfinite isn't [], frames.finite's pass`);
      });
      failures.push(...speedFailures(x, 'delivery', set[x].delivery.map((r) => r.run)));
    }
    judged(failures, FIXTURES.flatMap((x) => set[x].delivery), 'each speed fixture\'s delivery with every guard on, at 2x real time');
  });

  it(`${AC[7]} a planted guard that waits 8.4 ms a frame takes the city's delivery past 30 s and fails, naming the city and the guards`, async () => {
    const off = await unfit();
    if (off) inconclusive(`the budget counts only on a quiet reference Mac, so the planted guard isn't timed here: ${off}`);
    const runs = await three('city', 'delivery', 'guard_waits_8_4_ms');
    const failures = speedFailures('city', 'delivery', runs.map((r) => r.run));
    // 3,600 frames at 8.4 ms each are 30.24 s of waiting, whatever else the machine does.
    expect(Math.min(...runs.map((r) => r.run.seconds)), 'each run holds the guard\'s 30.24 s of waiting').toBeGreaterThan(30.24);
    failsNaming(failures, /^the city's delivery: .* over its 30 s; .*guards alone took/, 'a guard that waits 8.4 ms a frame');
  });
});

describe(`${AC[5]} the stated speeds hold for the mean of 3 cold runs, and a warm run is never averaged in`, () => {
  it(`${AC[5]} each averaged run is a fresh process's export and reads start cold; the judge refuses a warm run; and on the reference Mac a draft holds 4x real time and a delivery 2x on each fixture`, async () => {
    // The judge, on any machine: a warm run among the three is refused, however fast it makes the mean.
    const warm: Run[] = [...cold3(16).slice(0, 2), { seconds: 4, start: 'warm' }];
    expect(mean(warm.map((r) => r.seconds)), 'averaged in, the warm run would bring the city\'s draft under its 15 s').toBeLessThan(SPEED.city.draft);
    failsNaming(speedFailures('city', 'draft', warm), /run 3 reads start "warm": a warm run is never averaged in/, 'a warm run among the three');
    expect(FIXTURES.map((x) => [SPEED[x].seconds / SPEED[x].draft, SPEED[x].seconds / SPEED[x].delivery]), 'each fixture\'s limits are 4x real time for a draft and 2x for a delivery').toEqual([[4, 2], [4, 2], [4, 2]]);
    const set = await fitSet();
    const all = FIXTURES.flatMap((x) => PURPOSES.flatMap((p) => set[x][p].map((r, i) => ({ what: `the ${x}'s ${p}, cold run ${i + 1}`, r }))));
    expect(all.length, 'three runs of each fixture as a draft and as a delivery').toBe(18);
    none(all.filter(({ r }) => r.run.start !== 'cold').map(({ what, r }) => `${what}: a fresh process's export reads start ${JSON.stringify(r.run.start)}, not cold`), 'every averaged run is cold');
    judged(setFailures(readingsOf(set)), all.map(({ r }) => r), 'the stated speeds, each the mean of 3 cold runs');
  });
});
