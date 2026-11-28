// What this redraft changes of ../25/routes/helpers.ts: the wake check and the p95 judgement fail at Vitest's own
// assertion, never as an Error a helper throws, so a wrong program counts only where its failure is the test's
// (design, Failing on an assertion). Everything else is the original suite's, imported.

import { availableParallelism, loadavg } from 'node:os';
import { expect, type TestContext } from 'vitest';
import { answer, carries, loadReading, p95, waitFor, type Asking } from '../25/routes/helpers.ts';

/**
 * Answers each session's ask in turn with `deep inbox answer` and waits up to 30 s for that session to wake; the time is
 * from the answer command's exit to the start of the wake's turn at Claude Code's side. A session that never wakes, or
 * wakes with a turn that doesn't carry its answer, fails at its assertion, naming it; `why` adds what the scenario knew
 * of its sessions before the answers.
 */
export async function answerEach(ac: string, home: string, sessions: Asking[], plant?: string, why?: string): Promise<number[]> {
  const out: number[] = [];
  const also = why ? `; ${why}` : '';
  for (const [i, a] of sessions.entries()) {
    const r = await answer(home, a.handle, a.green.id, plant);
    const wake = await waitFor(() => a.claude.wakes.find((w) => w.session === a.s.id && !w.dropped), 30_000, `${a.s.id} waking`).catch(() => undefined);
    expect(wake, `${ac} idle session ${a.s.id} (${i + 1} of ${sessions.length} answered) never woke within 30 s of its answer to ${a.handle}${also}`).toBeDefined();
    expect(carries(wake!.prompt ?? '', a.green), `${ac} a wake's turn must carry the session's answer; ${a.s.id}'s prompt was ${JSON.stringify(wake!.prompt ?? '').slice(0, 400)}${also}`).toBe(true);
    out.push(Math.max(0, (wake!.started ?? wake!.at) - r.ended));
  }
  return out;
}

/**
 * p95 of the samples against the limit. Over it on a machine loaded past its core count: INCONCLUSIVE (skipped, with
 * the load), never PASS; over it otherwise: a failure at the assertion, with the samples and the load.
 */
export function judgeP95(ctx: TestContext, name: string, samples: number[], limitMs: number): void {
  const value = p95(samples);
  const text = `${name}: p95 ${value.toFixed(0)} ms over ${samples.length} samples (${samples.map((v) => v.toFixed(0)).join(', ')} ms) against ${limitMs} ms`;
  console.log(text);
  if (value > limitMs && loadavg()[0]! > availableParallelism()) ctx.skip(`INCONCLUSIVE ${text}, read at ${loadReading()}`);
  expect(value, `FAIL ${text}, at ${loadReading()}`).toBeLessThanOrEqual(limitMs);
}

const asserted = (error: unknown): error is Error => error instanceof Error && /AssertionError/.test(error.name);
/** An error that isn't Vitest's own assertion failure, as BLOCKED: a world that couldn't be set up or run is unrun, never a fail. */
const unrun = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  return Error(/^(?:BLOCKED|INCONCLUSIVE)\b/.test(message) ? message : `BLOCKED: ${message}`);
};

/** Runs a world; a failure at an assertion goes on as it is, any other failure as BLOCKED (or INCONCLUSIVE, as it said). */
export async function blockedUnlessAsserted<T>(run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (error) {
    throw asserted(error) ? error : unrun(error);
  }
}

/**
 * The assertion failure a run expected to fail ends with, or '' when it didn't fail. A run that ends any other way
 * (BLOCKED, INCONCLUSIVE, a helper's timeout) proves nothing about the plant, so it ends the test BLOCKED, never as text
 * a wrong-program test compares.
 */
export async function assertionFailureOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return '';
  } catch (error) {
    if (asserted(error)) return error.message;
    throw unrun(error);
  }
}
