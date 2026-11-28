// #3370's blind redraft of #854's idle test (README). Everything of #3300's redraft helpers is used as written (`export *`
// below), and through them the first draft's: the lane's runner and judge, the report checks, the reference-Mac gate,
// the design's rule and the made-up readings with their loads and shown windows. Added here: the window canvas-idle's
// runs held, read as the lane's judge reads it, so a reading whose window AppKit never showed is INCONCLUSIVE.
import { expect } from 'vitest';
import { arr, judged, obj, str, type JsonObject } from '../redraft-3300/helpers.ts';

export * from '../redraft-3300/helpers.ts';

/** What a test's context is to a reading it can't judge: a skip that ends the test, naming why. */
export interface Skipper { skip: (note: string) => never }

/**
 * The window each canvas-idle run held, as the lane's judge reads it: `node benchmarks/canvas.mjs judge` on the report
 * gives `window`, benchmarks/canvas-judge.mjs `shownWindow` of the runs: each run's `window.state` (`shown`, `covered`,
 * `hidden`, `display_asleep`, from deep-show's answer as canvas.mjs records it), `headless` when a run gives none; PASS
 * only when all five say `shown`, else INCONCLUSIVE naming each run that wasn't. Not shown throughout in every run, the
 * test skips as INCONCLUSIVE with the judge's reason (design: a run that can't be read counts neither way); shown, it
 * returns and the test judges the runs.
 */
export function requireShownWindow(ctx: Skipper, report: JsonObject, what: string): void {
  const verdict = judged(report);
  const window = obj(verdict['window'], `${what}: the judge reads the window the runs held (verdict.window): ${JSON.stringify(verdict).slice(0, 1500)}`);
  const status = str(window['status'], `${what}: verdict.window.status`);
  if (status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE (the window was not shown throughout every run, so the runs read nothing of a shown window): ${what}: window: ${str(window['reason'], `${what}: verdict.window.reason`)}`);
  expect(status, `${what}: the judge reads the window as shown in every run (PASS) or not (INCONCLUSIVE): ${JSON.stringify(window)}`).toBe('PASS');
  arr(report['runs'], `${what}: runs`).forEach((run, r) =>
    expect(obj(obj(run, `${what}: runs[${r}]`)['window'], `${what}: run ${r + 1}: window`)['state'], `${what}: run ${r + 1}: the judge read its window as shown`).toBe('shown'));
}
