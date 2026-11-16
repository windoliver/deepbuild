// AC6: a person's hub.health names only the sessions that person may see (README).
//
// #1337's world, on the real hub over its socket: maya owns the hub; bob is added to the project acme/shop only, with
// a credential of his own. maya works in two repos: maya/notes, her own repo (the criterion's repo A), and her clone
// of acme/shop (repo B). bob then calls hub.health on a connection that presented his credential. Its sessions list
// must hold no session of maya/notes. So that a health with no sessions at all can't pass, it must still hold the
// session in acme/shop, which bob may see: his own sessions.read shows it. On the base hub.health reads the newest
// sessions with no filter, so bob's holds both.
import { afterAll, expect, test } from 'vitest';
import { cleanup, connectAs, joinBob, owner, result, settled, work, world, type Conn, type Line } from '../1337/helpers.ts';

const AC6 = 'AC6 #2118.6cbb26ce';

afterAll(cleanup, 120_000);

/** The session IDs a connection's hub.health names. */
async function healthSessions(conn: Conn): Promise<string[] | undefined> {
  const health = result(await conn.call('hub.health', {}, 60_000));
  return Array.isArray(health.sessions) ? (health.sessions as Line[]).map((s) => String(s.id)) : undefined;
}

test(`${AC6} the owner has a session in maya/notes and one in acme/shop; bob, a person on acme/shop only, calls hub.health: its sessions list holds no session of maya/notes, and still holds the one in acme/shop`, async () => {
  const w = await world();
  const bob = await joinBob(w);
  const notes = await work(w, { home: w.maya, cwd: w.repos.notes });
  const shop = await work(w, { home: w.maya, cwd: w.repos.shop });

  // Given: both sessions are in the record, and the owner's own hub.health names both.
  const sent = [...notes.sent, ...shop.sent];
  const record = await settled(w, sent.map((s) => s.id));
  const missing = sent.filter((s) => !record.events.some((e) => e.id === s.id));
  if (missing.length) throw Error(`BLOCKED: ${AC6} the record lacks ${missing.map((s) => `${s.event} ${s.id}`).join(', ')} of the owner's two sessions; the scene didn't happen`);
  const asOwner = await owner(w);
  let ownerSees: string[] | undefined;
  try { ownerSees = await healthSessions(asOwner); } finally { asOwner.close(); }
  if (!ownerSees?.includes(notes.session.id) || !ownerSees.includes(shop.session.id)) throw Error(`BLOCKED: ${AC6} the owner's hub.health must name both of her sessions, ${notes.session.id} (maya/notes) and ${shop.session.id} (acme/shop): it names ${JSON.stringify(ownerSees)}`);

  // When: bob calls hub.health. What he may see is what his sessions.read shows: the project's session, not the notes one.
  const asBob = await connectAs(w, bob.token);
  let maySee: string[];
  let named: string[] | undefined;
  try {
    maySee = ((result(await asBob.call('sessions.read', {}, 60_000)).sessions ?? []) as Line[]).map((r) => String(r.id));
    named = await healthSessions(asBob);
  } finally {
    asBob.close();
  }
  if (maySee.includes(notes.session.id) || !maySee.includes(shop.session.id)) throw Error(`BLOCKED: ${AC6} bob's sessions.read must show the session in acme/shop and hide the one in maya/notes: it shows ${JSON.stringify(maySee)}`);

  const seen = `bob's hub.health names sessions ${JSON.stringify(named)}; the owner's session in maya/notes is ${notes.session.id}, the one in acme/shop is ${shop.session.id}; bob's sessions.read shows ${JSON.stringify(maySee)}`;
  expect(named, `${AC6} a person's hub.health holds no session of a repo that person isn't on; ${seen}`).not.toContain(notes.session.id);
  expect(named, `${AC6} it names the sessions that person may see; ${seen}`).toContain(shop.session.id);
}, 600_000);
