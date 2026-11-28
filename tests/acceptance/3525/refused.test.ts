// AC4: deep_kinds called with op "fetch" is refused with enum at /params/arguments/op, as a value its schema doesn't
// list is (packages/hub/src/tools.ts, `check`; the control is op "zzz"), and the refusal's remediation names the tool
// and form to call in its place, deep_job's fetch, in place of the nearest listed value. A planted server that answers
// the call with an empty listing (fixtures/plant.mjs `empty`) fails, naming the call. On the base the fetch is taken.
import { afterAll, describe, expect, it } from 'vitest';
import { onWorld } from '../1731/helpers.ts';
import { AC, FETCH_FIELDS, NEW_FETCH, TEST_MS, brief, deepMcp, listed, ops, t26, type Line, type Raw } from './helpers.ts';

afterAll(t26.cleanup, 60_000);

const FETCH = { op: 'fetch', ...FETCH_FIELDS };

/** The check: a refusal of the shared shape, enum at /params/arguments/op, whose remediation names deep_job's fetch. */
async function refusalFailures(server: Raw): Promise<{ failures: string[]; seen: string }> {
  const id = t26.nextId('deep_kinds-fetch');
  const { reply } = (await server.send([{ id, method: 'tools/call', params: { name: 'deep_kinds', arguments: FETCH } }]))[0]!;
  const o = t26.outcomeOf(reply, 0);
  const named = `deep_kinds ${JSON.stringify(FETCH)} (request ${id})`;
  const e = (o.value ?? {}) as Line;
  const failures: string[] = [];
  if (o.protocolError || !o.isError) failures.push(`${named} was answered, not refused: ${brief(o.value ?? reply, 600)}`);
  else {
    if (e.code !== 'enum' || e.path !== '/params/arguments/op') failures.push(`${named} was refused with ${String(e.code)} at ${String(e.path)}, not enum at /params/arguments/op`);
    const remedy = String(e.remediation ?? '');
    if (!remedy.includes(NEW_FETCH.tool) || !/\bfetch\b/.test(remedy)) failures.push(`${named}'s remediation doesn't name ${NEW_FETCH.tool}'s fetch: ${JSON.stringify(remedy)}`);
    if (/^Give \S+ in place of fetch\b/.test(remedy) || /^Give one of /.test(remedy)) failures.push(`${named}'s remediation names a value of deep_kinds' op in place of the tool and form: ${JSON.stringify(remedy)}`);
  }
  return { failures, seen: brief(reply, 900) };
}

describe('deep_kinds refuses fetch', () => {
  it(`AC4 ${AC.refused} deep_kinds called with op "fetch" is refused with enum at /params/arguments/op, as any value its schema doesn't list is, and its remediation names the tool and form to call in place of the nearest listed value; a planted hub that answers it with an empty listing fails, naming the call`, async () => {
    const w = await onWorld();
    const server = await deepMcp('deep mcp', w.home, w.work);
    const real = await refusalFailures(server);
    expect(real.failures, `deep_kinds with op fetch (${real.seen})`).toEqual([]);

    const tool = listed(await server.tools(), 'deep_kinds');
    expect(ops(tool), 'deep_kinds\' listed op no longer takes fetch').not.toContain('fetch');
    const control = t26.outcomeOf((await server.send([{ id: t26.nextId('deep_kinds-zzz'), method: 'tools/call', params: { name: 'deep_kinds', arguments: { op: 'zzz' } } }]))[0]!.reply, 0);
    expect({ code: control.value?.code, path: control.value?.path }, `a value the schema doesn't list is refused the same way: ${brief(control.reply, 600)}`).toEqual({ code: 'enum', path: '/params/arguments/op' });

    const planted = await deepMcp('deep mcp answering fetch with an empty listing', w.home, w.work, { kind: 'empty' });
    const wrong = await refusalFailures(planted);
    expect(wrong.failures.filter((f) => f.startsWith(`deep_kinds ${JSON.stringify(FETCH)} (request `) && f.includes('was answered, not refused')),
      `the same check fails the planted empty listing, naming the call: ${wrong.failures.join(' | ') || wrong.seen}`).not.toEqual([]);
  }, TEST_MS);
});
