// AC13: stopping the hub with one run accepted and one queued resumes the first once and records the second as
// stopped before dispatch; a hub that sends both again fails this test, naming the run.
//
// The brief plug-in's relay schedule, every five minutes, under a standing rule for it. Its first run is accepted:
// the plug-in's process took it, its send went out and was answered, and it is held at its pause read. The clock then
// passes the next slot, so the schedule's next run is due and queued behind it (runs never overlap). The hub stops
// with both, and starts again on the same files, the provider now answering the pause at once. The plug-in reports
// each run its new process was given; the provider shows each send by its key, one per run.
import { describe, expect, it } from 'vitest';
import {
  at, BRIEF_ID, briefPackage, carrying, clock, gate, grantFor, installAndLoad, json, MAIL, ME, memoryStore, MINUTE, openHost, openWorld, provider,
  report, routedClient, runsOf, sleep, startHub, stopHub, waitUntil, YOU, type BriefReport, type HostSeams,
} from './helpers.ts';
import { judgeStopped } from './judges.ts';
import { sendsBothAgain } from './twins.ts';

const RELAY = 'ext.brief.relay';
const keyOf = (run: string) => `brief-${run.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

async function stopped(twin = false) {
  const c = clock(at('2026-11-03T10:00'));
  const held = gate();
  let holding = true;
  const mail = await provider(c, async (req) => {
    if (req.url.startsWith('/send')) return json({ id: 'm' });
    if (req.url.startsWith('/pause')) { if (holding) await held.wait; return json({ ok: true }); }
    return { status: 404 };
  });
  const routes = { [MAIL]: mail };
  const seams: HostSeams = { secrets: memoryStore(), http: routedClient(routes).client };
  const w = await openWorld(c);
  const h = await openHost(w, seams);
  await installAndLoad(h, await briefPackage({ schedules: [{ name: 'relay', every: 5 * MINUTE }], to: [ME], key: 'run', pause: true }), grantFor(MAIL));
  await h.setSendRule(YOU, { sentence: 'my relay brief, to me', piece: BRIEF_ID, recipients: [ME], schedule: RELAY });

  // The first run: accepted, sent, held at its pause read.
  await h.tick();
  for (let t = at('2026-11-03T10:01'); !mail.seen.some((s) => s.url.startsWith('/pause')); t += MINUTE) {
    if (t > at('2026-11-03T10:06')) throw Error(`no relay run reached its pause read by 10:06: ${JSON.stringify(await runsOf(h, RELAY))}`);
    await sleep(300);
    c.set(t);
    await h.tick();
  }
  const accepted = (await runsOf(h, RELAY)).find((r) => r.dispatched !== null)!;
  expect(carrying(mail, keyOf(accepted.run)).length, `the accepted run ${accepted.run} sent once before the stop`).toBe(1);
  // The next slot passes while it is held: the next run is due and queued.
  let queued = undefined as Awaited<ReturnType<typeof runsOf>>[number] | undefined;
  for (let t = c.now() + MINUTE; !queued && t <= accepted.dispatched! + 11 * MINUTE; t += MINUTE) {
    c.set(t);
    await h.tick();
    await sleep(200);
    queued = (await runsOf(h, RELAY)).find((r) => r.run !== accepted.run && r.dispatched === null && r.stopped === null);
  }
  expect(queued, `a run queued behind the held one: ${JSON.stringify(await runsOf(h, RELAY))}`).toBeDefined();

  await stopHub(h, w);
  holding = false;
  held.open();
  const again = await startHub(w, seams);
  await waitUntil(async () => (await runsOf(again.h, RELAY)).find((r) => r.run === accepted.run)?.ended != null, 60_000, `the accepted run ${accepted.run} to end after the restart`).catch(() => undefined);
  await again.h.idle();
  await sleep(500);
  if (twin) await sendsBothAgain(routes, mail.seen, accepted.run, { run: queued!.run, key: keyOf(queued!.run) });

  const jobs = (await report<BriefReport>(again.h, 'ext.brief.report')).jobs;
  const after = await runsOf(again.h, RELAY);
  return judgeStopped(
    { run: accepted.run, key: keyOf(accepted.run), reached: carrying(mail, keyOf(accepted.run)).length, resumed: jobs.filter((j) => j.run === accepted.run).length, after: after.find((r) => r.run === accepted.run) },
    { run: queued!.run, reached: carrying(mail, keyOf(queued!.run)).length, dispatched: jobs.filter((j) => j.run === queued!.run).length + (twin ? 1 : 0), after: after.find((r) => r.run === queued!.run) },
  );
}

describe('AC13 #365.6d5ba1fd Stopping the hub with one run accepted and one queued resumes the first once and records the second as stopped before dispatch; a hub that sends both again fails this test, naming the run', () => {
  it('AC13 after the restart the accepted run resumes once, its send not made again, and the queued run is recorded as stopped before dispatch', async () => {
    expect(await stopped()).toEqual([]);
  }, 240_000);

  it('AC13 (wrong program) a hub that sends both runs again fails, naming each run', async () => {
    const problems = (await stopped(true)).join('\n');
    expect(problems).toMatch(/the accepted run run:\S+'s send brief-\S+ reached the provider 2 times, not once/);
    expect(problems).toMatch(/the queued run run:\S+ was sent 1 times though it was stopped before dispatch/);
  }, 240_000);
});
