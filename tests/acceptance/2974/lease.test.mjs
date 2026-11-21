// #2974 AC1 and AC2 (README: The scenes): a drain is a lease. A token holder's one `hub.drain()`, its process gone,
// lapses by itself: session starts are served again within 35 s, with no restart. A caller that renews it once a second
// keeps starts paused past 30 s.
import { test } from 'node:test';
import { LAPSE_MS, LONG, ONE_SHOT_MS, assert, drained, ended, hello, holder, redact, said, sandbox, served, shop, start, startInstalled, until, wait } from './helpers.mjs';

/** The installed hub with the shop repository the starts name, a start served before any drain. */
async function scene(t) {
  const box = await sandbox(t);
  shop(box);
  const up = await startInstalled(box);
  const first = await start(box);
  assert.ok(served(first), `BLOCKED: start.session wasn't served before any drain: ${said(first, box)}`);
  return { box, up };
}

/** One drain sent by a token holder that then exits: its reply, and when it came. */
async function oneShot(box, o) {
  const child = holder(box, 'hub.drain', {}, o);
  const run = await ended(child, 120_000);
  const sent = child.calls()[0];
  assert.ok(sent, `BLOCKED: the token holder printed no reply: ${redact(run.stdout + run.stderr, box)}`);
  return sent;
}

/** Starts sent once a second from `from` until one is served or `ms` pass: the served one, or undefined, and the last sent. */
async function servedAgain(box, from, ms) {
  let last;
  const got = await until(async () => { last = await start(box); return served(last) ? last : undefined; }, from + ms - Date.now(), 1000);
  return { got, last };
}

test('#2974.aaa94086 a token holder\'s one hub.drain(), its process gone, lapses: start.session is served again within 35 s with no restart', LONG, async (t) => {
  const { box, up } = await scene(t);
  const drain = await oneShot(box, { peer: true });
  assert.ok(typeof drain.reply === 'object' && drain.reply.result, `BLOCKED: hub.drain from a process holding the control token wasn't served: ${redact(JSON.stringify(drain.reply), box)}`);
  const right = await start(box);
  assert.ok(drained(right), `a start sent right after a served hub.drain must be paused by it, refused naming the drain; it got ${said(right, box)}`);

  const { got, last } = await servedAgain(box, drain.done, ONE_SHOT_MS + 10_000);
  const now = await hello(box, { ms: 10_000 });
  assert.ok(got && got.t - drain.done <= ONE_SHOT_MS, `hub.drain held session starts past ${ONE_SHOT_MS / 1000} s with its caller gone: one hub.drain() sent straight to the installed hub's socket by a process that then exited must lapse, ${LAPSE_MS / 1000} s with no renewal, and start.session be served again with no restart; ${got ? `the first start served was sent ${Math.round((got.t - drain.done) / 1000)} s after the drain` : `start.session was still refused ${Math.round((Date.now() - drain.done) / 1000)} s after the drain: ${said(last, box)}`}`);
  assert.equal(now?.start, up.hello.start, 'the drain must lapse with no restart: the installed hub\'s start ID changed');
});

test('#2974.aaa94086 a token holder\'s one hub.drain() naming no process lapses too, or is refused: start.session is served within 35 s', LONG, async (t) => {
  const { box, up } = await scene(t);
  const drain = await oneShot(box, { peer: false });
  const { got, last } = await servedAgain(box, drain.done, ONE_SHOT_MS + 10_000);
  const now = await hello(box, { ms: 10_000 });
  assert.ok(got && got.t - drain.done <= ONE_SHOT_MS, `hub.drain with the control token alone, naming no process, held session starts past ${ONE_SHOT_MS / 1000} s with its caller gone (it answered ${redact(JSON.stringify(drain.reply), box)}); ${got ? `the first start served was sent ${Math.round((got.t - drain.done) / 1000)} s after the drain` : `start.session was still refused: ${said(last, box)}`}`);
  assert.equal(now?.start, up.hello.start, 'the drain must end with no restart: the installed hub\'s start ID changed');
});

test('#2974.be96e768 a caller that renews hub.drain() once a second keeps session starts paused past 30 s', LONG, async (t) => {
  const { box } = await scene(t);
  const renewing = holder(box, 'hub.drain', {}, { peer: true, every: 1000, span: LAPSE_MS + 20_000 });
  const first = await until(() => renewing.calls()[0], 120_000, 50);
  assert.ok(first && typeof first.reply === 'object' && first.reply.result, `BLOCKED: hub.drain from a process holding the control token wasn't served: ${redact(JSON.stringify(first?.reply ?? renewing.err), box)}`);
  const samples = [];
  // Starts at 5, 15 and 25 s, then one after another, each as soon as the last came back, from 28 to 42 s after the
  // first drain was served: a lapse between two renewals shows even if the next renewal takes the drain again.
  for (const at of [5, 15, 25]) {
    await wait(Math.max(0, first.done + at * 1000 - Date.now()));
    samples.push({ at, ...(await start(box)) });
  }
  await wait(Math.max(0, first.done + 28_000 - Date.now()));
  while (Date.now() < first.done + 42_000) {
    const s = await start(box);
    samples.push({ at: Math.round((s.t - first.done) / 100) / 10, ...s });
  }
  const renewals = renewing.calls().filter((c) => c.t <= samples.at(-1).t);
  const unserved = renewals.filter((c) => !(typeof c.reply === 'object' && c.reply.result));
  const through = samples.filter((s) => !drained(s));
  assert.deepEqual(through.map((s) => `${s.at} s: ${said(s, box)}`), [], `a drain its caller renews once a second must keep every session start paused, past ${LAPSE_MS / 1000} s too; these starts weren't refused by the drain (its caller renewed it ${renewals.length} times, ${unserved.length} of them not served${unserved.length ? `: ${redact(JSON.stringify(unserved[0].reply), box)}` : ''})`);
});
