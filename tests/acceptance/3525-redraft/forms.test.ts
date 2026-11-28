// AC2: each form deep_kinds' schema takes, called on a fixture hub with a library source that serves one model,
// leaves the record with no new asset, ask, job, evidence or revision, the store with no new file, and starts no
// process; a planted deep_kinds that still takes fetch fails, naming the asset it brought in (README).
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, FETCH, MODEL, TEST_MS, argsFor, brief, changedSince, cleanup, describeChange, isChange, lookupWorld, lookups, mark, opsOf, schemaOf, t26,
  type Line, type Lookups, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** Each form the session's deep_kinds lists, called one at a time: one failure per call that changed anything. */
async function formFailures(w: Lookups, s: Session): Promise<{ failures: string[]; calls: string[] }> {
  const schema = schemaOf(await s.server.tools(), 'deep_kinds');
  const ops = opsOf(schema);
  expect(ops.length, `BLOCKED: deep_kinds lists the forms its op takes: ${brief(schema, 800)}`).toBeGreaterThan(0);
  const table: Record<string, Line[]> = { ...lookups(), fetch: [FETCH] };
  const failures: string[] = [];
  const calls: string[] = [];
  for (const op of ops) {
    const given = table[op];
    if (!given) { failures.push(`deep_kinds' schema takes op ${JSON.stringify(op)}, a form this suite has no call for`); continue; }
    for (const g of given) {
      const since = await mark(w);
      const o = await s.server.call('deep_kinds', argsFor(schema, { op, ...g }));
      // A fetch may land after its reply (a job); give anything it starts time to show.
      let changed = await changedSince(w, since);
      for (const deadline = Date.now() + (op === 'fetch' ? 60_000 : 1000); Date.now() < deadline && !(op === 'fetch' && changed.files.length); ) {
        await t26.sleep(500);
        changed = await changedSince(w, since);
      }
      calls.push(`op ${op} ${brief(g, 120)}: ${o.isError ? 'refused' : 'answered'} ${brief(o.value, 200)}`);
      if (isChange(changed)) failures.push(`deep_kinds op ${op} (${brief(g, 160)}) brought in or changed: ${describeChange(changed)}`);
    }
  }
  return { failures, calls };
}

describe('every form of deep_kinds changes nothing', () => {
  it(`AC2 ${AC.forms} each form deep_kinds' schema takes is called on a fixture hub with a library source that serves one model, and the record gains no asset, ask, job, evidence or revision, the store no file, and no process starts; a planted deep_kinds that still takes fetch fails, naming the asset it brought in`, async () => {
    const w = await lookupWorld([{ label: 'agent' }]);
    const real = await formFailures(w, w.sessions.get('agent')!);
    expect(real.failures, `every form of deep_kinds leaves the record, the store and the library as they were (calls: ${real.calls.join(' | ')})`).toEqual([]);

    // The planted deep_kinds that still takes fetch: the same server with fetch put back in deep_kinds' op (fixtures/plant.mjs),
    // in a world of its own, so the model isn't in its store yet.
    const p = await lookupWorld([{ label: 'planted', plant: { kind: 'kinds-fetch' } }]);
    const planted = p.sessions.get('planted')!;
    expect(opsOf(schemaOf(await planted.server.tools(), 'deep_kinds')), 'BLOCKED: the planted deep_kinds takes fetch').toContain('fetch');
    const caught = await formFailures(p, planted);
    expect(caught.failures.filter((f) => f.startsWith('deep_kinds op fetch') && f.includes(MODEL)), `the same check fails the planted deep_kinds that still takes fetch, naming the asset it brought in (${MODEL}): ${caught.failures.join(' | ') || caught.calls.join(' | ')}`).not.toEqual([]);
  }, TEST_MS);
});
