// AC2 #280.c693445e: A net item whose window exceeds the web's reported window, in a piece whose `on` lists web, fails
// net.budget naming web and both windows, while the same window passes with `on: [app]` where the app's report allows
// it; and a report of 0 names lockstep as the only fit
//
// net.budget is `match`'s check with `on`, on fixtures.ts's eight-seat fixture (its web part in headless Chrome, README:
// `chrome`). First the report on app and web; then the fixture whose net item declares the web's window + 1, with `on:
// [app, web]`: FAIL, a failure `{host: "web", declared, reported}` naming the declared window and that run's own report
// for the web; then, where the app's report allows that window, the same fixture with `on: [app]`: PASS, as net.budget's
// five runs give it (#551's rule). A report of 0: #551's burning piece (every step about 2.4 ms of logic, so the live
// step and one step restored and stepped again can't fit the showpiece class's 4 ms) on app: `windows.app` 0, and
// `lockstep` lists app, the hosts where only lockstep fits (README: net.budget's report). Timings: INCONCLUSIVE (never a
// pass) off a reference Mac, under load, or where net.budget doesn't decide; and where the web fits 16, or the app's
// report doesn't allow the web's window + 1 on this machine, the half that can't be declared reads INCONCLUSIVE. Wrong
// programs it fails: the merge base (no window for the web; no lockstep named); a window rule that holds a piece to the
// app's number with web in `on`, or to the web's without it; a report of 0 that names no lockstep.
import { describe, it } from 'vitest';
import { DOC, eightDoc, seededMoves } from './fixtures.ts';
import { TOGETHER_STEP_MS, burnDoc, burnItems, spins } from '../551/fixtures.ts';
import {
  AC, FULL, TIMEOUT, budgetRun, hostVerdict, inconclusive, none, show, timingProblem, useBuilds, useChildren, useTemp, windowOf,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;
const plays = seededMoves(STEPS);

describe(`${AC[2]} the web's window holds a piece that plays on the web, and 0 names lockstep`, () => {
  it(`${AC[2]} a net item whose window exceeds the web's reported window, in a piece whose on lists web, fails net.budget naming web and both windows, while the same window passes with on: [app] where the app's report allows it`, async () => {
    const report = await budgetRun(builds.show(), temp(), 'AC2 the report on app and web', { document: eightDoc(), steps: STEPS, plays, on: ['app', 'web'] });
    const [app, web] = [windowOf(report, 'app', 'AC2'), windowOf(report, 'web', 'AC2')];
    if (web === 16) inconclusive(`AC2: the web reports window 16, the most a net item declares, so no window exceeds it on this machine (app ${app})`);
    const declared = web + 1;
    const both = await budgetRun(builds.show(), temp(), `AC2 window ${declared} on app and web`, { document: eightDoc({ net: { window: declared } }), steps: STEPS, plays, on: ['app', 'web'] });
    const now = windowOf(both, 'web', `AC2 window ${declared}`);
    if (now >= declared) inconclusive(`AC2: the web's report moved from ${web} to ${now} between two runs, so window ${declared} no longer exceeds it (${timingProblem() ?? 'a reference Mac at rest'})`);
    const f: string[] = [];
    if (both.check.verdict !== 'FAIL') f.push(`AC2: window ${declared} with web in on reads ${both.check.verdict}, not FAIL: ${show(both.raw, 900)}`);
    const named = both.check.failures.filter((x) => x['host'] === 'web' && x['declared'] === declared && x['reported'] === now);
    if (!named.length) f.push(`AC2: no failure names host web with the declared window ${declared} and the web's reported ${now} ({host, declared, reported}): ${show(both.check.failures, 1200)}`);
    none(f, 'a window past the web\'s fails net.budget with web in on, naming web and both windows');
    if (declared > app) inconclusive(`AC2: the app's report (${app}) doesn't allow window ${declared} on this machine, so the on: [app] half can't be declared here`);
    const alone = await budgetRun(builds.show(), temp(), `AC2 window ${declared} on app`, { document: eightDoc({ net: { window: declared } }), steps: STEPS, plays, on: ['app'] });
    const appNow = windowOf(alone, 'app', `AC2 window ${declared} on app`);
    if (appNow < declared) inconclusive(`AC2: the app's report moved from ${app} to ${appNow} between two runs, so it no longer allows window ${declared} (${timingProblem() ?? 'a reference Mac at rest'})`);
    none(hostVerdict(alone, 'app', 'PASS', `AC2 window ${declared} on app`), 'the same window passes with on: [app], where the app\'s report allows it');
  }, TIMEOUT);

  it(`${AC[2]} a report of 0 names lockstep as the only fit`, async () => {
    const burn = { every: 1, heavyMs: TOGETHER_STEP_MS, lightMs: TOGETHER_STEP_MS };
    const r = await budgetRun(builds.show(), temp(), 'AC2 the 2.4 ms piece on app', {
      document: burnDoc(DOC.burn, burn, { window: 1 }), steps: STEPS, plays: spins(STEPS), on: ['app'], programs: [burnItems(burn).program.bytes],
    });
    const w = windowOf(r, 'app', 'AC2 the 2.4 ms piece');
    if (w !== 0) {
      const problem = timingProblem();
      if (problem) inconclusive(`AC2: the 2.4 ms piece reports window ${w} on app here (${problem})`);
      none([`AC2: a piece whose every step costs about 2.4 ms reports window ${w} on app, not 0`], 'the 2.4 ms piece reports 0');
    }
    const lockstep = Array.isArray(r.raw['lockstep']) ? r.raw['lockstep'] : null;
    none(lockstep?.includes('app') ? [] : [`AC2: net.budget reports window 0 on app and names no lockstep for it (lockstep: [host]): ${show(r.raw, 1200)}`], 'a report of 0 names lockstep as the only fit');
  }, TIMEOUT);
});
