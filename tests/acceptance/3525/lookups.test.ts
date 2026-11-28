// AC2: each form deep_kinds' listed schema takes is called on a fixture hub with #1731's library on and under your
// standing rule for its rows (so a fetch there would bring a model in with no ask), one call at a time. After the calls
// the record holds no new asset, ask, job, evidence or revision, the store no new file and the hub no new asset, and no
// process was started. A planted deep_kinds that still takes fetch (fixtures/plant.mjs `still-fetch`) fails the same
// check, naming the asset it brought in. On the merge base the schema still takes fetch, so the base fails naming it.
import { afterAll, describe, expect, it } from 'vitest';
import { kinds, onWorld } from '../1731/helpers.ts';
import { fileHash } from '../1731/library.ts';
import {
  AC, MODEL, TEST_MS, baseFetchFields, brief, changes, deepMcp, formArgs, listed, ops, ruled, snapshot, t26,
  type Raw,
} from './helpers.ts';

afterAll(t26.cleanup, 60_000);

/** Every form the server's listed deep_kinds takes, called one at a time: one line per change a call made, naming it. */
async function lookupFailures(w: Awaited<ReturnType<typeof onWorld>>, server: Raw): Promise<{ failures: string[]; calls: string[] }> {
  const tool = listed(await server.tools(), 'deep_kinds');
  const failures: string[] = [];
  const calls: string[] = [];
  if (!tool) return { failures: [`${server.name} lists no deep_kinds`], calls };
  for (const op of ops(tool)) {
    const args = formArgs(tool, op);
    if (!args) { failures.push(`deep_kinds' op ${JSON.stringify(op)} is a form this suite doesn't know how to call`); continue; }
    const since = await snapshot(w);
    const o = await server.call('deep_kinds', args);
    await t26.sleep(500);
    const got = await changes(w, since);
    calls.push(`op ${op}: ${o.isError ? 'refused' : 'answered'} ${brief(o.value, 200)}`);
    const brought = got.some((g) => g.includes(fileHash(MODEL))) ? `; it brought in the asset ${MODEL} (${fileHash(MODEL)})` : '';
    if (got.length) failures.push(`deep_kinds ${brief(args, 200)} changed what the hub holds${brought}: ${got.join('; ')}`);
  }
  return { failures, calls };
}

describe('every form of deep_kinds changes nothing', () => {
  it(`AC2 ${AC.lookups} each form deep_kinds' schema takes, called on a fixture hub with a library that serves the model, leaves no new asset, ask, job, evidence or revision, no new file in the store and no process started; a planted deep_kinds that still takes fetch fails, naming the asset it brought in`, async () => {
    const w = await onWorld();
    await ruled(w);
    // The library's thumbnails for the search are fetched and kept once, before the calls (README: The record and the store).
    const warm = await kinds(w, formArgs({ inputSchema: { properties: { query: {} } } }, 'assets')!);
    expect(Array.isArray(warm.value.rows) && warm.value.rows.length > 0, `BLOCKED: the library answers the search: ${warm.text.slice(0, 400)}`).toBe(true);

    const server = await deepMcp('deep mcp', w.home, w.work);
    const real = await lookupFailures(w, server);
    expect(real.failures, `every form of deep_kinds leaves the record, the store and the hub's assets as they were (calls: ${real.calls.join(' | ')})`).toEqual([]);
    const answered = real.calls.filter((c) => /^op (list|word|read|field): answered/.test(c));
    expect(answered.length, `the lookups reach the canvas core and answer (calls: ${real.calls.join(' | ')})`).toBe(4);

    const planted = await deepMcp('deep mcp that still takes fetch', w.home, w.work, { kind: 'still-fetch', fields: baseFetchFields() });
    const wrong = await lookupFailures(w, planted);
    expect(wrong.failures.filter((f) => f.startsWith('deep_kinds {"op":"fetch"') && f.includes(`brought in the asset ${MODEL}`)),
      `the same check fails the planted deep_kinds that still takes fetch, naming the asset it brought in (${MODEL}): ${wrong.failures.join(' | ') || wrong.calls.join(' | ')}`).not.toEqual([]);
  }, TEST_MS);
});
