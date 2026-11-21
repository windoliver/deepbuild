// AC9 #551.75e2a4bd: A planted piece whose match step with its checkpoints, and whose window restored and stepped
// again, each fit the class's frame time alone but not together fails net.budget, naming the canvas module that costs
// most; and the paddle piece's web part reads BLOCKED until its headless Chrome run
//
// The planted piece is fixtures.ts's burning piece whose logic spends about 2.4 ms of CPU on every match step, with
// window 1 (showpiece class, 4 ms of frame CPU): the live step with its checkpoints fits 4 ms, and so does restoring
// and stepping its window of one step again with its checkpoint, but not both in one frame. net.budget is `match`'s
// check, its timings by the five-run rule (INCONCLUSIVE off a reference Mac or where the runs don't decide, never a
// pass); each run's two parts are its `step_ms` and `window_ms`. The web part: net.budget on the paddle piece with
// `on: ["app", "web"]`, run by `match` in the app's process, which never starts a browser, so no headless Chrome run
// has been made for it. Wrong programs it fails: the merge base; a budget that holds each part to the frame alone; one
// that names the world; a web part that passes, or reads the app's numbers, without a browser run.
import { describe, it } from 'vitest';
import { DOC, TOGETHER_STEP_MS, burnDoc, burnItems, paddleDoc, rally, spins } from './fixtures.ts';
import { AC, FULL, TIMEOUT, budgetFailures, budgetOf, inconclusive, isObject, namesModule, none, play, show, useBuilds, useChildren, useTemp } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;

describe(`${AC[9]} net.budget holds a frame's step and window together, and its web part waits for a browser`, () => {
  it(`${AC[9]} a planted piece whose step with its checkpoints and whose window stepped again each fit the frame alone but not together fails net.budget, naming the canvas module that costs most`, async () => {
    const burn = { every: 1, heavyMs: TOGETHER_STEP_MS, lightMs: TOGETHER_STEP_MS };
    const document = burnDoc(DOC.together, burn, { window: 1 });
    const r = await play(builds.show(), temp(), 'AC9 net.budget on the planted piece', { document, steps: STEPS, plays: spins(STEPS), check: 'net.budget', programs: [burnItems(burn).program] });
    const b = budgetOf(r.check!, 'AC9 the planted piece');
    const f = [...budgetFailures(b, 'FAIL', 'AC9 the planted piece'), ...namesModule(b, 'logic', 'AC9 the planted piece')];
    b.runs.forEach((x, i) => {
      if (x.stepMs >= b.frameMs) f.push(`run ${i + 1}: the live step with its checkpoints takes ${x.stepMs} ms, not within the ${b.frameMs} ms frame alone`);
      if (x.windowMs >= b.frameMs) f.push(`run ${i + 1}: the window restored and stepped again takes ${x.windowMs} ms, not within the ${b.frameMs} ms frame alone`);
    });
    none(f, 'net.budget fails the piece whose parts fit alone but not together, naming logic');
  }, TIMEOUT);

  it(`${AC[9]} the paddle piece's web part reads BLOCKED until its headless Chrome run`, async () => {
    const r = await play(builds.show(), temp(), 'AC9 net.budget on app and web', { document: paddleDoc(), steps: STEPS, plays: rally(2, STEPS), check: 'net.budget', on: ['app', 'web'] });
    const c = r.check!;
    const blocked = Array.isArray(c.raw['blocked']) ? c.raw['blocked'].filter(isObject) : [];
    const web = blocked.filter((x) => x['host'] === 'web');
    const f: string[] = [];
    if (c.verdict === 'INCONCLUSIVE' && web.length === 1) inconclusive(`AC9: net.budget's app part doesn't decide on this machine, so its verdict can't read BLOCKED: ${show(c.raw, 600)}`);
    if (c.verdict !== 'BLOCKED') f.push(`net.budget on [app, web] reads ${c.verdict}, not BLOCKED, with no headless Chrome run: ${show(c.raw, 800)}`);
    if (web.length !== 1 || typeof web[0]!['ask'] !== 'string' || !(web[0]!['ask'] as string).trim()) f.push(`net.budget's blocked holds ${web.length} entries for host web, not one with its unblock ask: ${show(blocked, 600)}`);
    if (blocked.some((x) => x['host'] !== 'web')) f.push(`net.budget blocks a host besides web: ${show(blocked, 600)}`);
    if (c.failures.some((x) => x['host'] === 'web')) f.push(`net.budget fails host web with no reading from a browser: ${show(c.failures, 600)}`);
    none(f, 'the paddle piece\'s web part reads BLOCKED');
  }, TIMEOUT);
});
