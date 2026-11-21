// AC3 #551.5f93fc7b: net.budget passes the two-player piece and fails a planted piece whose full window can't be
// restored and stepped again within its class's frame time, naming the canvas module that costs most
//
// net.budget is run by `match` with `check: "net.budget"` (#549's member) on the paddle piece (showpiece class, 4 ms
// of frame CPU; window 8) and on the planted piece: fixtures.ts's burning piece, whose logic spends about 0.8 ms of
// CPU on every match step beside a world at rest, with window 8, so the live step with its checkpoints fits 4 ms and
// restoring and stepping the window of 8 again doesn't. Timings follow the five-run rule: each verdict must be what
// net.budget's own five runs give, INCONCLUSIVE off a reference Mac or where the runs don't decide, never a pass.
// Wrong programs it fails: the merge base (net.budget answers BLOCKED for a window above 0); a budget that measures
// one step and no window; one that names the world, or no module; one whose verdict its five runs don't give.
import { describe, it } from 'vitest';
import { DOC, WINDOW, WINDOW_STEP_MS, burnDoc, burnItems, paddleDoc, rally, rulesProgram, spins } from './fixtures.ts';
import { AC, FULL, TIMEOUT, budgetFailures, budgetOf, namesModule, none, play, useBuilds, useChildren, useTemp } from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 600;

describe(`${AC[3]} net.budget on the paddle piece and on a piece whose window can't be stepped again in a frame`, () => {
  it(`${AC[3]} net.budget passes the two-player piece`, async () => {
    const r = await play(builds.show(), temp(), 'AC3 net.budget on the paddle piece', { document: paddleDoc(), steps: STEPS, plays: rally(2, STEPS), check: 'net.budget', programs: [rulesProgram()] });
    const b = budgetOf(r.check!, 'AC3 the paddle piece');
    none(budgetFailures(b, 'PASS', 'AC3 the paddle piece'), 'net.budget passes the paddle piece in the showpiece class');
  }, TIMEOUT);

  it(`${AC[3]} net.budget fails a planted piece whose full window can't be restored and stepped again within its class's frame time, naming the canvas module that costs most`, async () => {
    const burn = { every: 1, heavyMs: WINDOW_STEP_MS, lightMs: WINDOW_STEP_MS };
    const document = burnDoc(DOC.window, burn, { window: WINDOW });
    const r = await play(builds.show(), temp(), 'AC3 net.budget on the planted piece', { document, steps: STEPS, plays: spins(STEPS), check: 'net.budget', programs: [burnItems(burn).program] });
    const b = budgetOf(r.check!, 'AC3 the planted piece');
    const f = [...budgetFailures(b, 'FAIL', 'AC3 the planted piece'), ...namesModule(b, 'logic', 'AC3 the planted piece')];
    // What fails is the window: the live step with its checkpoints fits the frame in every run, the window never does.
    b.runs.forEach((x, i) => {
      if (x.stepMs >= b.frameMs) f.push(`run ${i + 1}: the live step with its checkpoints takes ${x.stepMs} ms, not within the ${b.frameMs} ms frame`);
      if (x.windowMs <= b.frameMs) f.push(`run ${i + 1}: restoring and stepping the window of ${WINDOW} again takes ${x.windowMs} ms, within the ${b.frameMs} ms frame`);
    });
    none(f, 'net.budget fails the planted piece on its window, naming logic');
  }, TIMEOUT);
});
