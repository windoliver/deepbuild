// Test-side tools for the #1889 acceptance tests (README): the criteria's IDs, and a world with the shipped Gmail
// source (packages/sources/gmail) loaded in a real extension host, its HTTP client routed to a stand-in Gmail. The
// stand-in is suite 66's recorded mailbox (tests/acceptance/66/providers.ts) behind a front of our own that can, once,
// lose a send's answer and answer the next message reads with the statuses a test names. Everything else is suite
// 66's helpers, imported: the clock, the world, the host, the package copy and seal, the delivery rows.
import { expect } from 'vitest';
import {
  clock, deliveryOf, grantFor, installAndLoad, json, memoryStore, MINUTE, openHost, openWorld, provider, result, routedClient, runNow, shipped, tasksOf,
  workSourcesOf, YOU, DAY, type Clock, type DeliveryRow, type Host, type Provider, type Reply, type Seen, type World,
} from '../66/helpers.ts';
import { gmail, GMAIL, LABEL, type Gmail } from '../66/providers.ts';
import { GMAIL_TOKEN, REPLY_RULE } from '../66/worlds.ts';

// ---- The criteria, in the issue's order: scripts/proof-change.mjs's criterionId over each one's text.
export const AC1 = 'AC1 #1889.3ff068ee';
export const AC2 = 'AC2 #1889.312f3a56';
export const AC3 = 'AC3 #1889.5e4d1e1c';

export { at, MINUTE } from '../66/helpers.ts';
const API = '/gmail/v1/users/me';
const MESSAGE = /^\/messages\/[\w-]+$/;

/** What the front does to the next requests: lose the next send's answer (Gmail keeping it, or not), and answer the next bare message reads with these statuses, in turn. */
export interface Plan { lose?: 'kept' | 'dropped'; reads: number[] }
export interface Stand {
  c: Clock; w: World; h: Host; gm: Gmail; front: Provider; plan: Plan; handle: string;
  /** Replies Gmail kept: messages labelled SENT in the mailbox. */
  sent(): number;
  /** Send requests that reached the front, kept or not. */
  posts(): number;
  /** Message reads the front answered with a planned status. */
  failed: Seen[];
}

/**
 * The shipped Gmail source over the stand-in: its token entered, its work source over `Label_7` with your reply rule,
 * run only on your "run now" (every day), so no scheduled read of the label falls between a test's ticks.
 */
export async function stand(start: number): Promise<Stand> {
  const c = clock(start);
  const gm = await gmail(c);
  const plan: Plan = { reads: [] };
  const failed: Seen[] = [];
  let front: Provider;
  const forward = async (s: Seen): Promise<Reply> => {
    const headers: Record<string, string> = {};
    for (const k of ['authorization', 'content-type']) if (s.headers[k]) headers[k] = s.headers[k]!;
    const res = await fetch(`${gm.p.base}${s.url}`, { method: s.method, headers, ...(s.method === 'GET' ? {} : { body: s.body }) });
    return { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' }, body: await res.text() };
  };
  front = await provider(c, async (s) => {
    const p = s.path.replace(API, '');
    if (s.method === 'POST' && p === '/messages/send' && plan.lose) {
      const kept = plan.lose === 'kept';
      delete plan.lose;
      if (kept) await forward(s);
      // The answer never comes back: the connection drops with the request out.
      setImmediate(() => front.drop());
      return 'hang';
    }
    if (s.method === 'GET' && MESSAGE.test(p) && [...s.query.keys()].length === 0 && plan.reads.length) {
      const status = plan.reads.shift()!;
      failed.push(s);
      const message = status === 404 ? 'Requested entity was not found.' : status === 429 ? 'Quota exceeded for quota metric \'Queries\'.' : 'The service is currently unavailable.';
      return json({ error: { code: status, message } }, status, status === 429 || status === 503 ? { 'retry-after': '30' } : {});
    }
    return forward(s);
  });
  const w = await openWorld(c);
  const h = await openHost(w, { secrets: memoryStore(), http: routedClient({ [GMAIL]: front }).client });
  const dir = await shipped('gmail');
  const p = await installAndLoad(h, dir, grantFor(GMAIL));
  const entered = await h.enterSecret(YOU, p.id, 'gmail_token', GMAIL_TOKEN);
  if (!entered.saved) throw Error(`the Gmail token wasn't saved: ${JSON.stringify(entered)}`);
  const [source] = workSourcesOf(dir);
  if (!source) throw Error('packages/sources/gmail registers no source whose reading is work.item@1');
  const handle = await h.addWorkSource(YOU, { source, scope: LABEL, every: DAY });
  await h.setWorkRule(YOU, handle, REPLY_RULE);
  const sendPath = `${API}/messages/send`;
  return {
    c, w, h, gm, front, plan, handle, failed,
    sent: () => gm.sent().length,
    posts: () => front.seen.filter((s) => s.method === 'POST' && s.path === sendPath).length,
  };
}

/** One tick of the hub at `t`, and what it started ended. */
export async function tickAt(g: Stand, t: number): Promise<void> {
  g.c.set(t);
  await g.h.tick();
  await g.h.idle();
}

/**
 * A client's email in the label, taken in as a task by a run now, and its result recorded for delivery under your
 * rule; then the hub's next tick sends it, and the front loses that send's answer (`lose`). The send key.
 */
export async function lostSend(g: Stand, start: number, lose: 'kept' | 'dropped'): Promise<string> {
  g.gm.add({ id: 'm1889', threadId: 't-1889', at: start + MINUTE, subject: 'The export drops rows', text: 'Please fix the nightly export, it drops rows.' });
  g.c.set(start + 2 * MINUTE);
  await runNow(g.h, g.handle);
  const [task] = await tasksOf(g.h, g.handle);
  expect(task?.id, 'the labelled email is a task').toBe('m1889');
  const key = await g.h.deliverResult(task!.task_ref, result('PASS', 2, 'https://receipts.example/r/m1889'));
  g.plan.lose = lose;
  await tickAt(g, start + 3 * MINUTE);
  expect(g.plan.lose, 'the hub sent the reply, and its answer was lost').toBeUndefined();
  expect(g.posts(), 'one send request went out').toBe(1);
  expect(g.sent(), lose === 'kept' ? 'Gmail kept the first send' : 'Gmail never kept the first send').toBe(lose === 'kept' ? 1 : 0);
  expect((await row(g, key)).outcome, 'no answer came, so the hub has none recorded').toBe('unknown');
  return key;
}

export async function row(g: Stand, key: string): Promise<DeliveryRow> {
  const d = await deliveryOf(g.h, key);
  if (!d) throw Error(`no delivery row for ${key}: ${JSON.stringify(await g.h.deliveries())}`);
  return d;
}

/** The send keys carried by the replies Gmail kept in the thread, one per kept reply. */
export const markers = (g: Stand): string[] => g.gm.sent().map((m) => m.headers?.['x-deepbuild-send'] ?? '');

