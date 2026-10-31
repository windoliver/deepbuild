// AC8: a schedule run whose plug-in host process is killed before its send's request, after the request and before
// the provider answers, and after the answer is recorded is INVALID each time and reads not sent, unknown and sent; a
// hub that records a killed run as FAIL, or reads a send as sent with no recorded answer, fails, naming the send's key.
//
// The brief plug-in's relay schedule, every five minutes, runs in the sandbox, its own process. Its job sends one
// email (its key one per run) and then reads ext.brief.pause. The process is killed through the supervisor run the
// host started it under, at one of three points:
// - before its send's request: no standing rule covers the send, so it waits on its authority ask; killed then
// - after the request, before the provider answers: a standing rule covers it, and the provider holds the request
// - after the answer is recorded: the provider answers, and holds the pause read that follows
import { describe, expect, it } from 'vitest';
import type { ScheduleRun } from '../../../packages/extension-host/src/index.ts';
import {
  at, authorityAsks, BRIEF_ID, briefPackage, clock, grantFor, installAndLoad, json, killPlugin, MAIL, ME, memoryStore, MINUTE, openHost, openWorld, provider,
  routedClient, runsOf, sendOf, sleep, waitUntil, YOU, type Reply,
} from './helpers.ts';
import { judgeKilled, type Point } from './judges.ts';
import { killedAsFail, sentWithoutAnswer } from './twins.ts';

const RELAY = 'ext.brief.relay';
const keyOf = (run: string) => `brief-${run.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/** Runs the relay until `point`, kills the plug-in's process there, and waits for the run to end. */
async function killedAt(point: Point): Promise<{ run: ScheduleRun | undefined; key: string; runs: ScheduleRun[]; reached: number }> {
  const c = clock(at('2026-11-03T09:55'));
  let sends = 0;
  let pauses = 0;
  const mail = await provider(c, (req): Reply => {
    if (req.url.startsWith('/send')) { sends++; return point === 'after the request, before the answer' ? 'hang' : json({ id: 'm' }); }
    if (req.url.startsWith('/pause')) { pauses++; return point === 'after the answer' ? 'hang' : json({ ok: true }); }
    return { status: 404 };
  });
  const w = await openWorld(c);
  const h = await openHost(w, { secrets: memoryStore(), http: routedClient({ [MAIL]: mail }).client });
  await installAndLoad(h, await briefPackage({ schedules: [{ name: 'relay', every: 5 * MINUTE }], to: [ME], key: 'run', pause: true }), grantFor(MAIL));
  if (point !== 'before the request') await h.setSendRule(YOU, { sentence: 'my relay brief, to me', piece: BRIEF_ID, recipients: [ME], schedule: RELAY });

  const reached = async () => (point === 'before the request' ? (await authorityAsks(w)).length > 0 : point === 'after the answer' ? pauses > 0 : sends > 0);
  for (let t = at('2026-11-03T09:55'); !(await reached()); t += MINUTE) {
    if (t > at('2026-11-03T10:06')) throw Error(`the relay never reached the point "${point}" by 10:06: ${JSON.stringify(await runsOf(h, RELAY))}`);
    c.set(t);
    await h.tick();
    await sleep(300);
  }
  if (point === 'after the answer') await waitUntil(async () => (await sendOf(h, keyOf((await runsOf(h, RELAY)).find((r) => r.dispatched !== null)!.run)))?.outcome === 'sent', 20_000, 'the answer recorded');
  const dispatched = (await runsOf(h, RELAY)).find((r) => r.dispatched !== null);
  expect(dispatched, 'the relay run that reached the point').toBeDefined();
  await killPlugin(w, h, BRIEF_ID);
  await waitUntil(async () => (await runsOf(h, RELAY)).find((r) => r.run === dispatched!.run)?.ended != null, 30_000, `the killed run ${dispatched!.run} to end`).catch(() => undefined);
  const runs = await runsOf(h, RELAY);
  return { run: runs.find((r) => r.run === dispatched!.run), key: keyOf(dispatched!.run), runs, reached: sends };
}

describe('AC8 #365.40d6759a A schedule run whose plug-in host process is killed before its send\'s request, after the request and before the provider answers, and after the answer is recorded is INVALID each time and reads not sent, unknown and sent; a hub that records a killed run as FAIL, or reads a send as sent with no recorded answer, fails, naming the send\'s key', () => {
  it('AC8 killed before its send\'s request: INVALID, and the send reads not sent', async () => {
    const r = await killedAt('before the request');
    expect(judgeKilled('before the request', r.run, r.key)).toEqual([]);
    expect(r.reached, 'requests that reached the provider').toBe(0);
  }, 120_000);

  it('AC8 killed after the request, before the provider answers: INVALID, and the send reads unknown', async () => {
    const r = await killedAt('after the request, before the answer');
    expect(judgeKilled('after the request, before the answer', r.run, r.key)).toEqual([]);
    expect(r.reached, 'requests that reached the provider').toBe(1);
  }, 120_000);

  it('AC8 killed after the answer is recorded: INVALID, and the send reads sent', async () => {
    const r = await killedAt('after the answer');
    expect(judgeKilled('after the answer', r.run, r.key)).toEqual([]);
    expect(r.reached, 'requests that reached the provider').toBe(1);
  }, 120_000);

  it('AC8 (wrong program) a hub that records the killed run as FAIL fails, naming the send\'s key', async () => {
    const r = await killedAt('after the answer');
    const twin = killedAsFail(r.runs).find((x) => x.run === r.run?.run);
    expect(judgeKilled('after the answer', twin, r.key).join('\n')).toMatch(new RegExp(`the run that started the send ${r.key}, killed after the answer, reads FAIL, not INVALID`));
  }, 120_000);

  it('AC8 (wrong program) a hub that reads the unanswered send as sent fails, naming the send\'s key', async () => {
    const r = await killedAt('after the request, before the answer');
    const twin = sentWithoutAnswer(r.runs).find((x) => x.run === r.run?.run);
    expect(judgeKilled('after the request, before the answer', twin, r.key).join('\n')).toMatch(new RegExp(`the send ${r.key}, killed after the request, before the answer, reads sent with no recorded answer`));
  }, 120_000);
});
