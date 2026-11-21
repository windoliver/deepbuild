// AC1 #280.5334836f: net.budget on the eight-seat fixture reports a window for the app and for the web; declaring each
// host's reported window passes net.budget there, and declaring one more fails it, naming the canvas module that costs
// most; a planted report computed from one match step's cost without its checkpoints reports a larger window, which
// then fails net.budget, naming the host
//
// net.budget is `match`'s check (#549's member) with `on` (#551's), on fixtures.ts's eight-seat fixture, its players'
// seeded entries, 600 steps. Its report gives `windows: {host → window}` (the Fields line), each a whole number from 0
// to 16; with web in `on` and Chrome named in the scenario (README: `chrome`), its web part runs in the web player in
// headless Chrome. Each host's reported window, declared on the fixture's net item and measured on that host alone,
// passes (on app, as net.budget's own five runs give it: #551's rule); one more fails, a failure naming the host and the
// canvas module that costs most (the report's worst frame's costliest module). The planted report is
// `net_budget_window_without_checkpoints`: its window on app, declared and measured honestly, fails naming host app.
// Timings: INCONCLUSIVE (never a pass) off a reference Mac, under load, or where net.budget doesn't decide; a host
// whose report is 16 leaves "one more" undeclarable, which reads INCONCLUSIVE too. Wrong programs it fails: the merge
// base (no window for the web: its web part is BLOCKED); a report that's the declared window, or the app's for the web;
// a budget that names no host or module; a report from a step's cost without its checkpoints.
import { describe, it } from 'vitest';
import { eightDoc, seededMoves } from './fixtures.ts';
import {
  AC, FULL, TIMEOUT, budgetRun, hostVerdict, inconclusive, namesHost, none, timingProblem, useBuilds, useChildren, useTemp, windowOf,
  type Host,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const plays = seededMoves(STEPS);
const at = (window: number, on: Host[], what: string) => budgetRun(builds.show(), temp(), what, { document: eightDoc({ net: { window } }), steps: STEPS, plays, on });

describe(`${AC[1]} net.budget's window for each host on the eight-seat fixture`, () => {
  it(`${AC[1]} net.budget on the eight-seat fixture reports a window for the app and for the web; declaring each host's reported window passes net.budget there, and declaring one more fails it, naming the canvas module that costs most`, async () => {
    const report = await budgetRun(builds.show(), temp(), 'AC1 the report on app and web', { document: eightDoc(), steps: STEPS, plays, on: ['app', 'web'] });
    const reported: Record<Host, number> = { app: windowOf(report, 'app', 'AC1'), web: windowOf(report, 'web', 'AC1') };
    const f: string[] = [];
    const full: Host[] = [];
    for (const host of ['app', 'web'] as const) {
      const w = reported[host];
      const fits = await at(w, [host], `AC1 window ${w} on ${host}`);
      f.push(...hostVerdict(fits, host, 'PASS', `AC1 ${host}'s reported window ${w} declared`));
      if (w === 16) { full.push(host); continue; }
      const over = await at(w + 1, [host], `AC1 window ${w + 1} on ${host}`);
      f.push(...hostVerdict(over, host, 'FAIL', `AC1 one more than ${host}'s window, ${w + 1}, declared`), ...namesHost(over, host, `AC1 window ${w + 1} on ${host}`, { module: true }));
    }
    none(f, 'each host\'s reported window passes there and one more fails, naming the canvas module that costs most');
    if (full.length) inconclusive(`AC1: ${full.join(' and ')} reported window 16, the most a net item declares, so one more can't be declared on this machine (reported ${JSON.stringify(reported)})`);
  }, TIMEOUT);

  it(`${AC[1]} a planted report computed from one match step's cost without its checkpoints reports a larger window, which then fails net.budget, naming the host`, async () => {
    const honest = await budgetRun(builds.show(), temp(), 'AC1 the report on app', { document: eightDoc(), steps: STEPS, plays, on: ['app'] });
    const planted = await budgetRun(builds.show(), temp(), 'AC1 the planted report on app', { document: eightDoc(), steps: STEPS, plays, on: ['app'], planted: 'net_budget_window_without_checkpoints' });
    const [a, p] = [windowOf(honest, 'app', 'AC1 honest'), windowOf(planted, 'app', 'AC1 planted')];
    if (p <= a) {
      const problem = timingProblem();
      if (problem) inconclusive(`AC1: the planted report's window ${p} isn't larger than the honest ${a} here (${problem})`);
      none([`AC1: the planted report, from one match step's cost without its checkpoints, reports window ${p}, not more than the honest report's ${a}`], 'the planted report is larger');
    }
    const declared = await at(p, ['app'], `AC1 the planted report's window ${p} on app`);
    none([...hostVerdict(declared, 'app', 'FAIL', `AC1 the planted window ${p} declared`), ...namesHost(declared, 'app', `AC1 the planted window ${p} declared`)], 'the planted report\'s window fails net.budget, naming the host');
  }, TIMEOUT);
});
