// AC12 #83.b4c17e65: budgets, on the reference Mac in the local preflight, compared with the merge base: a status
// question is answered from the record in under 100 ms, with no model call.
//
// Each measurement (README: Budgets) runs `deep setup`'s own UserPromptSubmit entry through the Claude Code stand-in
// against a real hub: twenty sessions that worked and stopped, each then asked "still going?". A sample is how long
// the entry ran, from Claude Code starting it to its exit with the answer; a sample whose prompt wasn't answered from
// the record, or reached the model, fails the measurement naming the session. The merge base's side is measured by
// the same driver on the base's own build; a base that doesn't answer has no reading, and nothing regresses from it.
// Readings count only on a reference Mac (Mac15,7 or Mac15,12), Low Power Mode off, thermal state nominal, not loaded
// past its core count; anywhere else the test skips as INCONCLUSIVE with the readings, never PASS.
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import {
  AC12, answerOf, begin, cleanup, CURRENT, edits, firedShown, hubWithSetup, inconclusiveIfLoaded, judge, load, makeHome, median, mergeBase, modelCalled, newSession, ours, payload,
  percentile, promptEntry, REPO, stop, stopHub, type Checkout,
} from './helpers.ts';

afterAll(cleanup, 120_000);

const FILE = 'tests/acceptance/83/budgets.test.ts';
const LIMIT_MS = 100;
const SESSIONS = 20;
const QUESTION = 'still going?';

interface Reading { checkout: string; answeredMs: number[]; failures: string[]; loads: { one: number; cores: number }[] }
const shownReading = (r: Reading) => `${r.checkout}: answered ${r.answeredMs.map((x) => x.toFixed(0)).join('/')} ms; ${r.failures.length} failure(s)${r.failures.length ? `: ${r.failures.join('; ').slice(0, 1500)}` : ''}; load ${r.loads.map((l) => l.one.toFixed(1)).join(' to ')} on ${r.loads[0]?.cores} cores`;

/** One measurement of a checkout: twenty sessions, each asked "still going?" after a judged stop. */
async function measure(co: Checkout, n = SESSIONS): Promise<Reading> {
  const h = makeHome(co);
  const hub = await hubWithSetup(h);
  const reading: Reading = { checkout: co.label, answeredMs: [], failures: [], loads: [load()] };
  try {
    for (let i = 0; i < n; i++) {
      const s = newSession(h);
      const claude = await begin(h, s);
      await edits(claude, s);
      const stopped = await stop(claude, s);
      if (stopped.blocked) { reading.failures.push(`${s.id}'s stop was sent back: ${firedShown(stopped)}`); claude.quit(); continue; }
      promptEntry(s, QUESTION, 'person');
      const fired = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: QUESTION }));
      const entry = ours(fired.ran).find((r) => !r.async && r.ended !== null);
      if (answerOf(fired) === undefined) reading.failures.push(`${s.id}: "${QUESTION}" wasn't answered from the record (${co.label}): ${firedShown(fired)}`);
      else if (modelCalled(h, s, QUESTION)) reading.failures.push(`${s.id}: "${QUESTION}" reached the model (${co.label})`);
      else if (!entry) reading.failures.push(`${s.id}: no DeepBuild UserPromptSubmit entry ran (${co.label}): ${firedShown(fired)}`);
      else reading.answeredMs.push(entry.ended! - entry.started);
      claude.quit();
    }
    reading.loads.push(load());
    return reading;
  } finally {
    await stopHub(hub);
  }
}
async function measured(ctx: TestContext, co: Checkout): Promise<Reading> {
  const r = await measure(co);
  if (r.failures.length) {
    inconclusiveIfLoaded(ctx, [...r.loads, load()], shownReading(r));
    throw Error(r.failures.join('\n'));
  }
  return r;
}

describe(`${AC12} Budgets, on the reference Mac in the local preflight, compared with the merge base: a status question is answered from the record in under ${LIMIT_MS} ms, with no model call`, () => {
  it(`${AC12} the local preflight runs ${FILE}: a check lane in scripts/lanes.mjs runs it with Vitest, one file at a time, not excluded`, async () => {
    const { checks } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const covers = (arg: string) => arg === FILE || (arg.endsWith('/') && FILE.startsWith(arg)) || (arg.endsWith('/**') && FILE.startsWith(arg.slice(0, -2)));
    const runs = checks.flatMap((lane) => lane.commands.map((command) => ({ lane: lane.name, command })))
      .filter(({ command }) => command.some((a) => /vitest/.test(a)) && command.includes('--no-file-parallelism')
        && command.some((a, i) => covers(a) && command[i - 1] !== '--exclude'));
    const vitest = checks.flatMap((lane) => lane.commands.filter((c) => c.some((a) => /vitest/.test(a))).map((c) => `${lane.name}: ${c.slice(2).join(' ').slice(0, 300)}`));
    expect(runs.map((r) => r.lane), `some lane must run ${FILE} with --no-file-parallelism (it starts hubs and times them); the lanes' Vitest commands are:\n${vitest.join('\n')}`).not.toEqual([]);
  });

  it(`${AC12} on the reference Mac, "${QUESTION}" is answered from the record in under ${LIMIT_MS} ms at p95 with no model call, over a warm-up and five runs of ${SESSIONS} sessions, compared with the merge base`, async (ctx) => {
    const warm = await measured(ctx, CURRENT);
    console.log(`${AC12} warm-up: ${shownReading(warm)}`);
    const base = await measure(await mergeBase());
    console.log(`${AC12} merge base: ${shownReading(base)}`);
    inconclusiveIfLoaded(ctx, [...warm.loads, ...base.loads], `readings only. ${shownReading(warm)}. ${shownReading(base)}`);
    const runs: Reading[] = [];
    for (let i = 0; i < 5; i++) {
      runs.push(await measured(ctx, CURRENT));
      console.log(`${AC12} run ${i + 1}: ${shownReading(runs[i]!)}`);
    }
    const judged = judge(`${AC12} status question answered from the record, p95`, runs.map((r) => percentile(r.answeredMs, 95)), LIMIT_MS, 'ms');
    console.log(`${judged.verdict} ${judged.text}`);
    const regressed: string[] = [];
    const mine = median(runs.flatMap((r) => r.answeredMs));
    if (base.answeredMs.length) {
      const theirs = median(base.answeredMs);
      console.log(`${AC12} answered: median ${mine.toFixed(1)} ms against the merge base's ${theirs.toFixed(1)} ms`);
      if (mine > theirs * 1.5 && mine - theirs > 2) regressed.push(`answered regressed: median ${mine.toFixed(1)} ms against the merge base's ${theirs.toFixed(1)} ms`);
    } else console.log(`${AC12} answered: median ${mine.toFixed(1)} ms; the merge base has no reading (it doesn't answer a status question from the record: ${base.failures.join('; ').slice(0, 600)})`);
    inconclusiveIfLoaded(ctx, runs.flatMap((r) => r.loads), `readings only. ${judged.text}`);
    expect([...(judged.verdict === 'FAIL' ? [`FAIL ${judged.text}`] : []), ...regressed.map((r) => `FAIL ${AC12} ${r}`)], 'the budget within its limit and no reading regressed from the merge base').toEqual([]);
    if (judged.verdict === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${judged.text}`);
  }, 7_200_000);

  // The instrument, on any machine: a prompt that asks for work reaches the model, and the no-model-call check catches it.
  it(`${AC12} (instrument) a prompt that asks for work ("Now add the tests.") shows as a model call in the hook log, so a status answer that woke the model would be caught`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const s = newSession(h);
    const claude = await begin(h, s);
    await edits(claude, s);
    await stop(claude, s);
    const work = 'Now add the tests.';
    promptEntry(s, work, 'person');
    const fired = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: work }));
    expect(answerOf(fired), 'work isn\'t answered from the record').toBeUndefined();
    expect(modelCalled(h, s, work), 'the hook log shows the model call').toBe(true);
    await claude.end();
    await stopHub(hub);
  }, 180_000);
});
