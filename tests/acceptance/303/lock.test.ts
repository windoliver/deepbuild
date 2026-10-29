// #303 AC9: each `definition.locked` carries the definition's hash, the issue's revision and the base commit, and one
// without any of them fails its schema, naming the field; the hash recomputed from the locked definition equals the
// recorded one, and a requirement edited in the store after the lock gives another; a planted lock that hashes only
// the requirement IDs (DEEP_HUB_PLANT=hash-ids-only) gives the same hash after the edit and fails this test, naming the
// requirement.
//
// The schema is read through the contracts package's public entry, by name: the newest `definition.locked@<n>` it
// publishes, and the version each recorded event names. The hash is recomputed by the kernel at the next claim (README,
// The claim's recomputed hash): a stop with work after the lock. The store is the record's `definitions` table in
// `<home>/.deepbuild/ledger.db`, where the base keeps each locked definition's requirements; the edit is made with the
// hub stopped, and read by the hub started again.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { fixtures, getSchema, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import {
  AC9, BEHAVIOR, askNamed, cleanup, expectTask, failureOf, lastPos, lockedFor, makeWorld, must, recomputedAt, said, Session,
  settle, startHub, stopHub, taskOf, type Ev, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const FIELDS = ['hash', 'issue_rev', 'base_commit'] as const;
const EDITED = 'R2 as edited in the store after the lock';

/** The newest definition.locked schema the contracts publish. */
function newest(): string {
  const names = listSchemas().map((e) => e.name).filter((n) => /^definition\.locked@\d+$/.test(n));
  return names.sort((a, b) => Number(a.split('@')[1]) - Number(b.split('@')[1])).at(-1)!;
}
/** The event as its schema reads it: only the top-level fields the schema lists. */
function asRecorded(name: string, e: Line): Line {
  const props = Object.keys((getSchema(name) as { properties: Line }).properties);
  return Object.fromEntries(Object.entries(e).filter(([k]) => props.includes(k)));
}
/** The event passes its schema, and without each of the three fields it fails it, naming the field. */
function carriesAndRequires(name: string, e: Line, what: string): void {
  const ok = validate(name, e);
  must(ok.ok, `${AC9} ${what} must pass ${name}: ${JSON.stringify(ok.ok ? [] : ok.issues).slice(0, 800)}`);
  for (const field of FIELDS) {
    must(e.data?.[field] !== undefined, `${AC9} ${what} must carry ${field}: ${JSON.stringify(e.data).slice(0, 600)}`);
    const without = structuredClone(e);
    delete without.data[field];
    const r = validate(name, without);
    must(!r.ok, `${AC9} ${what} without ${field} must fail ${name}; it passes`);
    must(!r.ok && r.issues.some((i) => i.path === `/data/${field}` || i.path.endsWith(`/${field}`)), `${AC9} ${what} without ${field} must fail ${name} naming ${field}: ${JSON.stringify(r.ok ? [] : r.issues).slice(0, 800)}`);
  }
}

describe(`${AC9} definition.locked carries its hash, the issue's revision and the base commit`, () => {
  it(`${AC9} the newest definition.locked schema the contracts publish requires the hash, the issue's revision and the base commit, naming each one missing`, () => {
    const name = newest();
    const [fixture] = fixtures(name);
    must(fixture !== undefined, `${AC9} ${name} must have a valid fixture`);
    carriesAndRequires(name, fixture as Line, `${name}'s fixture`);
  });
});

/** You ask for a change; its definition locks; one claim recomputes the hash; the store is edited; the next claim recomputes it again. */
async function lockedAndEdited(plant?: string): Promise<{ lock: Ev; first: Ev | undefined; second: Ev | undefined; ref: string }> {
  const w = makeWorld();
  let hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.ts');
  await s.stop('I have read checkToken.');
  let events = await settle(hub, (all) => { const ref = taskOf(askNamed(all, s, BEHAVIOR)); return ref !== undefined && lockedFor(all, ref).length > 0; });
  const ref = expectTask(events, s, BEHAVIOR, AC9);
  const [lock] = lockedFor(events, ref);
  must(lock !== undefined, `${AC9} the task ${ref} must hold a definition.locked: none was recorded`);
  carriesAndRequires(`definition.locked@${String(lock!.v)}`, asRecorded(`definition.locked@${String(lock!.v)}`, lock!), `the recorded definition.locked for ${ref}`);
  must(lock!.data.base_commit === w.base, `${AC9} the definition's base commit is the commit the session worked from, ${w.base}: ${said(lock)}`);

  // The next claim: a stop whose turn edited a file, after the lock.
  let since = await lastPos(hub);
  await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
  await s.stop('checkToken now rejects a token whose exp has passed.');
  events = await settle(hub, (all) => recomputedAt(all, ref, since) !== undefined);
  const first = recomputedAt(events, ref, since);

  // A requirement edited in the store, the hub stopped, then started again.
  await stopHub(hub);
  const db = new Database(join(w.root, 'ledger.db'));
  try {
    const row = db.prepare('SELECT requirements FROM definitions WHERE task_ref = ?').get(ref) as { requirements: string } | undefined;
    must(row !== undefined, `${AC9} the store holds the locked definition of ${ref} in its definitions table`);
    const requirements = JSON.parse(row!.requirements) as Line[];
    const r2 = requirements.find((r) => r.id === 'R2');
    must(r2 !== undefined, `${AC9} the stored definition of ${ref} holds R2: ${row!.requirements.slice(0, 600)}`);
    r2!.text = EDITED;
    db.prepare('UPDATE definitions SET requirements = ? WHERE task_ref = ?').run(JSON.stringify(requirements), ref);
  } finally {
    db.close();
  }
  hub = await startHub(w, { plant });
  since = await lastPos(hub);
  await s.edit('src/auth.ts', 'export function', '// Rejects expired tokens.\nexport function');
  await s.stop('Documented checkToken.');
  events = await settle(hub, (all) => recomputedAt(all, ref, since) !== undefined);
  return { lock: lock!, first, second: recomputedAt(events, ref, since), ref };
}

/** The criterion's hash half: the recompute matches the lock, and R2 edited in the store gives another hash. */
function recomputes(t: { lock: Ev; first: Ev | undefined; second: Ev | undefined; ref: string }): void {
  const locked = String(t.lock.data.hash);
  must(t.first !== undefined, `${AC9} the claim after the lock must recompute the definition's hash for ${t.ref}: no event after the stop names the task with a hash`);
  must(t.first!.data.hash === locked, `${AC9} the hash recomputed from the locked definition of ${t.ref} equals the recorded one, ${locked}: ${said(t.first)}`);
  must(t.second !== undefined, `${AC9} the claim after R2 was edited in the store must recompute the hash for ${t.ref}: no event after the stop names the task with a hash`);
  must(t.second!.data.hash !== locked, `${AC9} requirement R2 of ${t.ref}, edited in the store after the lock ("${EDITED}"), must give another hash than the locked ${locked}; the claim recomputed the same: ${said(t.second)}`);
}

describe(`${AC9} the locked hash, recomputed`, () => {
  it(`${AC9} the recorded definition.locked passes its schema and fails it without each field; the claim's recomputed hash equals the locked one, and R2 edited in the store gives another`, async () => {
    recomputes(await lockedAndEdited());
  }, 240_000);

  it(`${AC9} (wrong program) a lock that hashes only the requirement IDs (DEEP_HUB_PLANT=hash-ids-only) gives the same hash after the edit and fails this test, naming the requirement`, async () => {
    const t = await lockedAndEdited('hash-ids-only');
    const failure = await failureOf(() => recomputes(t));
    must(failure !== null, `${AC9} the planted lock must fail this test: it passed`);
    must(t.second?.data.hash === t.lock.data.hash, `${AC9} the planted lock recomputes the same hash after R2's edit: locked ${String(t.lock.data.hash)}, recomputed ${said(t.second)}`);
    must(/\bR2\b/.test(failure), `${AC9} the failure must name the edited requirement, R2; it said: ${failure}`);
  }, 240_000);
});

