// AC1 #1337.e27cfa33: "An event claiming another actor is stamped with its connection's person. A planted hub that
// trusts the field fails, naming the event."
//
// The fixture project with two people: maya owns the hub, bob joins acme/shop with his own credential. bob's session,
// in his clone, sends its hooks over connections that present his credential, each payload claiming `actor: "you"`
// (the owner). maya's session, in her clone, sends hers as hooks connect today, each payload claiming bob's actor.
// Each event must be in the record under its ID, stamped with its own connection's person.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, ended, failureOf, joinBob, OWNER, settled, work, world, type Read, type Sent } from './helpers.ts';

afterAll(cleanup);

interface Case { who: string; claimed: string; expected: string; sent: Sent[] }
async function scenario(plant?: string): Promise<{ cases: Case[]; read: Read }> {
  const w = await world(plant === undefined ? {} : { plant });
  const bob = await joinBob(w);
  const bobs = await work(w, { home: w.bob, cwd: w.repos.bobShop, token: bob.token, extra: { actor: OWNER } });
  const mayas = await work(w, { home: w.maya, cwd: w.repos.shop, extra: { actor: bob.person } });
  const cases: Case[] = [
    { who: "bob's connection (his credential)", claimed: OWNER, expected: bob.person, sent: bobs.sent },
    { who: "maya's connection (a hook as today, the owner's)", claimed: bob.person, expected: OWNER, sent: mayas.sent },
  ];
  return { cases, read: await settled(w, cases.flatMap((c) => c.sent.map((s) => s.id))) };
}

/** The criterion's assertion: each event under its ID, its actor its connection's person; a failure names the event. */
function stampedByConnection(cases: readonly Case[], read: Read): void {
  const byId = new Map(read.events.map((e) => [e.id, e]));
  for (const c of cases) {
    for (const s of c.sent) {
      const e = byId.get(s.id);
      const what = e ? `stored as ${e.kind} with actor ${JSON.stringify(e.actor)}` : `not in the record (the hook ${ended(s)})`;
      expect(e?.actor, `event ${s.id} (${s.event} from ${c.who}, its payload claiming actor ${JSON.stringify(c.claimed)}): ${what}, not ${JSON.stringify(c.expected)}`).toBe(c.expected);
    }
  }
}

describe('AC1 #1337.e27cfa33 an event claiming another actor is stamped with its connection\'s person', () => {
  it('AC1 #1337.e27cfa33 each hook event is stamped with its own connection\'s person, whatever actor its payload claims', async () => {
    const { cases, read } = await scenario();
    expect(cases[0]!.expected, 'bob reads as a person of his own, not as the owner').not.toBe(OWNER);
    stampedByConnection(cases, read);
  }, 120_000);

  it('AC1 #1337.e27cfa33 (wrong program) a hub that takes the actor from the event\'s own field fails, naming the event', async () => {
    const { cases, read } = await scenario('actor-from-payload');
    const failure = failureOf(() => stampedByConnection(cases, read));
    expect(failure, `the planted hub passed: ${JSON.stringify(read.events.filter((e) => cases.some((c) => c.sent.some((s) => s.id === e.id))).map((e) => ({ id: e.id, actor: e.actor })))}`).toBeDefined();
    const ids = cases.flatMap((c) => c.sent.map((s) => s.id));
    expect(ids.some((id) => failure!.message.includes(`event ${id}`)), `the failure names no event: ${failure!.message}`).toBe(true);
  }, 120_000);
});
