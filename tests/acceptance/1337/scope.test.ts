// AC2 #1337.dfaf2997: "One repo cloned at two different paths reads as one project scope."
//
// acme/shop is cloned twice on maya's machine, at two different paths, one clone naming its remote by HTTPS and the
// other by SSH: two clones of one forge repo. A session works in each. Every event of both sessions, and both sessions'
// rows, must name one project, and at one scope. Two guards keep the reading from passing a wrong program: another repo
// (maya/notes) reads as another project, and a repo with no remote keeps its path scope, as the issue's Scope says.
// The world is the fixture project with two people (bob is added first when the hub can add him), so a hub that reads
// forge identity only once a project has people is judged where it does.
import { afterAll, describe, expect, it } from 'vitest';
import { addPerson, cleanup, ended, pathScope, settled, work, world, type Ev, type Read, type Sent } from './helpers.ts';

afterAll(cleanup);

/** The one value a session's events name for `field`, or a failure naming the events that disagree or lack it. */
function one(read: Read, sent: readonly Sent[], field: 'project' | 'scope', where: string): string {
  const byId = new Map(read.events.map((e) => [e.id, e]));
  const events = sent.map((s) => ({ s, e: byId.get(s.id) as Ev | undefined }));
  for (const { s, e } of events) expect(e, `event ${s.id} (${s.event} in ${where}) is not in the record (the hook ${ended(s)})`).toBeDefined();
  const values = new Set(events.map(({ e }) => (e as unknown as Record<string, unknown>)[field] as string | undefined));
  expect(values.size, `the events of the session in ${where} name ${values.size} values of ${field}: ${JSON.stringify([...values])}`).toBe(1);
  const [value] = values;
  expect(typeof value === 'string' && value.length > 0, `the events of the session in ${where} name no ${field}: ${JSON.stringify(value)}`).toBe(true);
  return value!;
}

describe('AC2 #1337.dfaf2997 one repo cloned at two different paths reads as one project scope', () => {
  it('AC2 #1337.dfaf2997 sessions in two clones of acme/shop, at two paths, read as one project at one scope; another repo reads as another; a repo with no remote keeps its path scope', async () => {
    const w = await world();
    const added = await addPerson(w, 'bob', w.repos.shop);
    if (!added.ok) console.log(`the hub added no second person (${added.refused}); judged as a one-person hub`);
    const a = await work(w, { home: w.maya, cwd: w.repos.shop });
    const b = await work(w, { home: w.maya, cwd: w.repos.shop2 });
    const notes = await work(w, { home: w.maya, cwd: w.repos.notes });
    const scratch = await work(w, { home: w.maya, cwd: w.repos.scratch });
    const read = await settled(w, [a, b, notes, scratch].flatMap((x) => x.sent.map((s) => s.id)));
    const at = (p: string, url: string) => `${p} (origin ${url})`;
    const A = at(w.repos.shop, 'https://github.com/acme/shop.git');
    const B = at(w.repos.shop2, 'git@github.com:acme/shop.git');

    const projectA = one(read, a.sent, 'project', A);
    const projectB = one(read, b.sent, 'project', B);
    expect(projectB, `one repo, two clones: the session in ${A} reads as project ${JSON.stringify(projectA)}, the one in ${B} as ${JSON.stringify(projectB)}`).toBe(projectA);
    const scopeA = one(read, a.sent, 'scope', A);
    const scopeB = one(read, b.sent, 'scope', B);
    expect(scopeB, `one repo, two clones: the session in ${A} is at scope ${JSON.stringify(scopeA)}, the one in ${B} at ${JSON.stringify(scopeB)}`).toBe(scopeA);
    const rows = new Map(read.sessions.map((r) => [String(r.id), r]));
    for (const [x, where] of [[a, A], [b, B]] as const) {
      const row = rows.get(x.session.id);
      expect(row?.project_id, `the session row of ${x.session.id} (in ${where}) names project ${JSON.stringify(row?.project_id)}${row ? '' : ' (no row)'}`).toBe(projectA);
    }

    const projectNotes = one(read, notes.sent, 'project', at(w.repos.notes, 'https://github.com/maya/notes.git'));
    expect(projectNotes, `maya/notes is another repo, yet it reads as acme/shop's project ${JSON.stringify(projectA)}`).not.toBe(projectA);
    const projectScratch = one(read, scratch.sent, 'project', `${w.repos.scratch} (no remote)`);
    expect(projectScratch, `a repo with no remote keeps its path scope: ${w.repos.scratch} reads as ${JSON.stringify(projectScratch)}`).toBe(pathScope(w.repos.scratch));
    expect(w.forgeRequests.filter((r) => !r.startsWith('GET ')), 'the hub wrote nothing to the forge').toEqual([]);
  }, 180_000);
});
