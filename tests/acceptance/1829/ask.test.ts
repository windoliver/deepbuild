// AC1 #1829.4f01565f: a promise set a fourth time raises exactly one ask naming its owner, and it shows in the inbox.
// A planted sources file without the row fails, naming `promise.blocked`.
//
// The ask half is the #120 wake-up fixture (tests/acceptance/120, AC3's "set a fourth time"), reused through its
// helpers, with the inbox read after the fourth set (the issue's Proof). The promise is the agent's last words, "I'll
// check the deploy again in 20 minutes."; the agent says it again in each woken turn; the fourth time it is BLOCKED.
// Its owner is the one the BLOCKED record names (the deploy is a service's, #120's ownerOf), and the ask must name
// it. The planted half (README: The planted sources file) is a scratch copy of this checkout's packages/ whose
// packages/asks/sources.json lacks the `promise.blocked` row, run through the ask-source check: it fails, naming it.
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  allEvents, awaitEvent, begin, cleanup, edits, evShown, hubWithSetup, inboxRead, MINUTE, moveOn, newSession, PROMISE_MS, QUOTE, stop,
  waitFor, wakeAfter, wakeupEvents, type Claude, type Ev, type Hub, type Line, type Session,
} from '../120/helpers.ts';
import { AC1, copyOfCheckout, guardShown, GUARD, makeHome, namesSource, removeTemps, runGuard, sitesIn, SOURCE, SOURCES_FILE, sourceRows } from './helpers.ts';

afterAll(async () => { await cleanup(); removeTemps(); }, 60_000);

/** The session works, promises the check and stops; its waiter waits; the wake-up is recorded (#120's AC2 proves this). */
async function promised(hub: Hub, s: Session, claude: Claude): Promise<void> {
  const before = (await allEvents(hub)).length;
  const fired = await stop(claude, s, QUOTE);
  if (fired.blocked) throw Error(`the stop goes through (nothing to send back): ${fired.blocked}`);
  await awaitEvent(hub, s, (e) => e.kind === 'agent.stop' && e.log_pos > before, 'the stop', 60_000)
    .catch((e: Error) => { throw Error(`BLOCKED: the #120 fixture didn't reach the promise (its stop never reached the record): ${e.message}`); });
  await waitFor(async () => (await claude.liveWaiters(s.id)).length > 0 || undefined, 30_000, `${s.id}'s waiter, waiting once its stop went through`);
  await waitFor(async () => wakeupEvents(await allEvents(hub), s.id)[0], 15_000, `the wake-up recorded with the quote ${JSON.stringify(QUOTE)} (#120)`);
}
/** Time moves on past the due time; the waiter wakes the session; in the woken turn the agent promises again and stops. */
async function setAgain(hub: Hub, s: Session, claude: Claude, n: number): Promise<Hub> {
  const before = Date.now();
  hub = await moveOn(hub, PROMISE_MS + MINUTE);
  const wake = await waitFor(() => wakeAfter(claude, s, before), 30_000, 'the wake').catch(() => undefined);
  if (!wake) throw Error(`BLOCKED: the wake-up must wake the session at its time (#120's AC2) for the promise to be set a ${n}th time: wakes ${JSON.stringify(claude.wakes)}`);
  const count = (await allEvents(hub)).length;
  await stop(claude, s, QUOTE);
  await awaitEvent(hub, s, (e) => e.kind === 'agent.stop' && e.log_pos > count, `the stop of the ${n}th set`, 60_000)
    .catch((e: Error) => { throw Error(`BLOCKED: the #120 fixture didn't set the promise a ${n}th time (its stop never reached the record): ${e.message}`); });
  return hub;
}
/** The record's BLOCKED for the promise: an event of the session saying BLOCKED about the deploy (#120's README, 8). */
const blockedOf = (events: Ev[], s: Session): Ev[] => events.filter((e) => e.session === s.id && /BLOCKED/.test(JSON.stringify(e.data)) && /deploy/i.test(JSON.stringify(e.data)));
/** The owner a BLOCKED record names: its `owner` field, else the word `service` or `you` in it. */
function ownerOf(e: Ev): string | undefined {
  if (typeof e.data.owner === 'string' && /^(service|you)$/.test(e.data.owner)) return e.data.owner;
  return /\b(service|you)\b/.exec(JSON.stringify(e.data))?.[1];
}
/** Every string an ask carries, joined: what the inbox shows of it. */
const textOf = (ask: Line): string => JSON.stringify(ask);

describe(`${AC1} A promise set a fourth time raises exactly one ask naming its owner, and it shows in the inbox. A planted sources file without the row fails, naming \`promise.blocked\``, () => {
  it(`${AC1} the #120 wake-up fixture: set a fourth time, the promise is BLOCKED and the inbox holds exactly one ask about it, naming the owner the record names`, async () => {
    const h = makeHome();
    let hub = await hubWithSetup(h);
    const s = newSession(h);
    const { claude } = await begin(h, s, 'Deploy the fix and make sure it is up.');
    await edits(claude, s);
    await promised(hub, s, claude);
    for (let n = 2; n <= 4; n++) hub = await setAgain(hub, s, claude, n);
    const events = await waitFor(async () => { const all = await allEvents(hub); return blockedOf(all, s).length ? all : undefined; }, 20_000, 'the BLOCKED record')
      .catch(async () => allEvents(hub));
    const blocked = blockedOf(events, s);
    if (!blocked.length) throw Error(`BLOCKED: set a fourth time the promise must be BLOCKED in the record (#120's AC3) before its ask can be read; the session's events: ${events.filter((e) => e.session === s.id).map((e) => e.kind).join(', ')}`);
    const owner = ownerOf(blocked[0]!);
    expect(owner, `${AC1} the BLOCKED record names its owner, the service or you: ${evShown(blocked[0]!)}`).toBeDefined();
    // The inbox, read after the fourth set.
    const inbox = await waitFor(async () => { const asks = await inboxRead(hub); return asks.some((a) => /deploy/i.test(textOf(a))) ? asks : undefined; }, 10_000, 'an ask about the promise in the inbox')
      .catch(async () => inboxRead(hub));
    const asks = inbox.filter((a) => /deploy/i.test(textOf(a)) || textOf(a).includes(QUOTE));
    const asked = events.filter((e) => e.kind === 'ask.created').map(evShown);
    expect(asks.length, `${AC1} set a fourth time, the promise raises exactly one ask from source ${SOURCE}, and it shows in the inbox (inbox.read); the inbox: ${JSON.stringify(inbox).slice(0, 800)}; ask.created in the record: ${JSON.stringify(asked).slice(0, 800)}; the BLOCKED record: ${evShown(blocked[0]!)}`).toBe(1);
    expect(textOf(asks[0]!), `${AC1} the ask names the promise's owner, ${owner}, as the BLOCKED record does: ${textOf(asks[0]!).slice(0, 800)}`).toMatch(new RegExp(`\\b${owner}\\b`));
    await claude.end();
  }, 300_000);

  it(`${AC1} a planted packages/asks/sources.json without the ${SOURCE} row fails the ask-source check, naming ${SOURCE} at its raise`, () => {
    const root = copyOfCheckout();
    const rows = sourceRows(root);
    const kept = rows.filter((r) => r.source !== SOURCE);
    writeFileSync(join(root, SOURCES_FILE), `${JSON.stringify(kept, null, 2)}\n`);
    const c = runGuard(root);
    expect(c.code, `${AC1} the ask-source check (${GUARD}) runs on the planted tree and exits 1 on its finding: ${guardShown(c)}`).toBe(1);
    expect(c.fails.length, `${AC1} the planted sources file fails, with a FAIL line: ${guardShown(c)}`).toBeGreaterThan(0);
    for (const line of c.fails) {
      expect(namesSource(line, SOURCE), `${AC1} each finding on the planted tree (only the ${SOURCE} row is gone) names ${SOURCE}: ${line}`).toBe(true);
      const sites = sitesIn(line);
      expect(sites.length, `${AC1} the finding names its call site, <path>:<line>: ${line}`).toBeGreaterThan(0);
      const text = readFileSync(join(root, sites[0]!.path), 'utf8').split('\n')[sites[0]!.line - 1] ?? '';
      expect(text, `${AC1} the named line ${sites[0]!.path}:${sites[0]!.line} is the raise of ${SOURCE}: ${JSON.stringify(text)}`).toMatch(/raise|promise\.blocked/);
    }
    // The planted tree is this checkout with one row taken out: this checkout itself must carry that row.
    expect(rows.map((r) => r.source), `${AC1} this checkout's ${SOURCES_FILE} has a row for ${SOURCE} (the planted file is it without that row)`).toContain(SOURCE);
  }, 120_000);
});
