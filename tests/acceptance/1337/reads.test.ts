// AC3 #1337.2fe9c60c: "A person's read returns nothing at another person's personal scope, and a planted reader
// without the filter fails, naming the row."
//
// The fixture project with two people: maya owns the hub, bob joins acme/shop. maya works in two repos: maya/notes,
// her own (her personal scope, design: One hub for a project, What's shared), and her clone of acme/shop (the
// project's). bob then reads with his own credential: `events.read` and `sessions.read` on a `cli` connection. Nothing of
// maya's notes session may be in either. So that an empty read can't pass, bob must read the project's session.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, connectAs, failureOf, joinBob, readWith, settled, work, world, type Read, type Sent, type Session } from './helpers.ts';

afterAll(cleanup);

interface Seen { personal: { session: Session; sent: Sent[] }; project: { session: Session; sent: Sent[] }; bobRead: Read; ownerRead: Read }
async function scenario(plant?: string): Promise<Seen> {
  const w = await world(plant === undefined ? {} : { plant });
  const bob = await joinBob(w);
  const personal = await work(w, { home: w.maya, cwd: w.repos.notes });
  const project = await work(w, { home: w.maya, cwd: w.repos.shop });
  // What the record holds first, as its owner reads it: both sessions' events are in.
  const ownerRead = await settled(w, [...personal.sent, ...project.sent].map((s) => s.id));
  for (const s of [...personal.sent, ...project.sent]) {
    if (!ownerRead.events.some((e) => e.id === s.id)) throw Error(`BLOCKED: maya's own read lacks event ${s.id} (${s.event}); the scene didn't happen`);
  }
  const conn = await connectAs(w, bob.token);
  try {
    return { personal, project, bobRead: await readWith(conn), ownerRead };
  } finally {
    conn.close();
  }
}

/** The criterion's assertion: bob's read holds no row of maya's personal scope; a failure names the row. */
function nothingPersonal(seen: Seen): void {
  const { personal, project, bobRead } = seen;
  const ids = new Set(personal.sent.map((s) => s.id));
  const sid = personal.session.id;
  for (const e of bobRead.events) {
    const hers = ids.has(e.id) || e.session === sid;
    expect(hers, `bob's events.read returned event ${e.id} (${e.kind}, session ${e.session}, scope ${JSON.stringify(e.scope)}, actor ${JSON.stringify(e.actor)}) of maya's session in maya/notes, her personal scope`).toBe(false);
  }
  for (const row of bobRead.sessions) {
    expect(String(row.id), `bob's sessions.read returned the row of session ${String(row.id)} (project ${JSON.stringify(row.project_id)}, worktree ${JSON.stringify(row.worktree)}): maya's session in maya/notes, her personal scope`).not.toBe(sid);
  }
  // Not an empty read: the project's work is shared with every person on it.
  const read = new Set(bobRead.events.map((e) => e.id));
  for (const s of project.sent) expect(read.has(s.id), `bob's events.read lacks event ${s.id} (${s.event}) of maya's session in acme/shop, the project they share`).toBe(true);
  expect(bobRead.sessions.some((r) => String(r.id) === project.session.id), `bob's sessions.read lacks the row of maya's session in acme/shop, ${project.session.id}`).toBe(true);
}

describe('AC3 #1337.2fe9c60c a person\'s read returns nothing at another person\'s personal scope', () => {
  it('AC3 #1337.2fe9c60c bob\'s events.read and sessions.read hold nothing of maya\'s own repo, and hold the project\'s work', async () => {
    nothingPersonal(await scenario());
  }, 120_000);

  it('AC3 #1337.2fe9c60c (wrong program) a reader without the scope filter fails, naming the row', async () => {
    const seen = await scenario('reads-unfiltered');
    const failure = failureOf(() => nothingPersonal(seen));
    expect(failure, `the planted reader passed: bob read ${seen.bobRead.events.length} events and ${seen.bobRead.sessions.length} sessions`).toBeDefined();
    const rows = [...seen.personal.sent.map((s) => `event ${s.id}`), `session ${seen.personal.session.id}`];
    expect(rows.some((r) => failure!.message.includes(r)), `the failure names no row of maya's personal scope: ${failure!.message}`).toBe(true);
  }, 120_000);
});
