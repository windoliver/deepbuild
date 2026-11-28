import { availableParallelism, loadavg } from 'node:os';
import { expect, type TestContext } from 'vitest';
import { answer, carries, loadReading, p95, waitFor, type Asking } from '../25/routes/helpers.ts';

export async function seenWithin<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number, what: string): Promise<T | undefined> {
  const ownTimeout = `timed out after ${ms} ms waiting for ${what}`;
  return waitFor(probe, ms, what).catch((error: unknown) => {
    if (error instanceof Error && error.message === ownTimeout) return undefined;
    throw error;
  });
}

export async function answerEach(ac: string, home: string, sessions: Asking[], plant?: string, knownBeforeTheAnswers?: string): Promise<number[]> {
  const out: number[] = [];
  const also = knownBeforeTheAnswers ? `; ${knownBeforeTheAnswers}` : '';
  for (const [i, a] of sessions.entries()) {
    const r = await answer(home, a.handle, a.green.id, plant);
    const wake = await seenWithin(() => a.claude.wakes.find((w) => w.session === a.s.id && !w.dropped), 30_000, `${a.s.id} waking`);
    expect(wake, `${ac} idle session ${a.s.id} (${i + 1} of ${sessions.length} answered) never woke within 30 s of its answer to ${a.handle}${also}`).toBeDefined();
    expect(carries(wake!.prompt ?? '', a.green), `${ac} a wake's turn must carry the session's answer; ${a.s.id}'s prompt was ${JSON.stringify(wake!.prompt ?? '').slice(0, 400)}${also}`).toBe(true);
    out.push(Math.max(0, (wake!.started ?? wake!.at) - r.ended));
  }
  return out;
}

export function judgeP95(ctx: TestContext, name: string, samples: number[], limitMs: number): void {
  const value = p95(samples);
  const text = `${name}: p95 ${value.toFixed(0)} ms over ${samples.length} samples (${samples.map((v) => v.toFixed(0)).join(', ')} ms) against ${limitMs} ms`;
  console.log(text);
  if (value > limitMs && loadavg()[0]! > availableParallelism()) ctx.skip(`INCONCLUSIVE ${text}, read at ${loadReading()}`);
  expect(value, `FAIL ${text}, at ${loadReading()}`).toBeLessThanOrEqual(limitMs);
}

const asserted = (error: unknown): error is Error => error instanceof Error && /AssertionError/.test(error.name);
const unrun = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error);
  return Error(/^(?:BLOCKED|INCONCLUSIVE)\b/.test(message) ? message : `BLOCKED: ${message}`);
};

export async function blockedUnlessAsserted<T>(run: Promise<T>): Promise<T> {
  try {
    return await run;
  } catch (error) {
    throw asserted(error) ? error : unrun(error);
  }
}

export async function assertionFailureOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return '';
  } catch (error) {
    if (asserted(error)) return error.message;
    throw unrun(error);
  }
}
