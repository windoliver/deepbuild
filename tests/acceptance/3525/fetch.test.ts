// AC3: the model fetched through its new form, deep_job {op: "fetch", library, id} (README: The new form), lands under
// the hash the merge base's deep_kinds fetch gave it (fixtures/base.json), after one authority ask, naming the library,
// for a library not yet allowed, and none under your standing rule for it. The judge that holds the first world fails
// a fetch with no ask for a library not allowed, naming the library: it is run on the second world's real fetch, which
// came with no ask, as a planted form that fetches with no ask. With the library's host unreachable the fetch answers
// BLOCKED, as the base's deep_kinds fetch does (#1731 AC5). On the base, deep_job takes no fetch.
import { afterAll, describe, expect, it } from 'vitest';
import { asks, blocked, must, onWorld, sleep, stored, yes, type World } from '../1731/helpers.ts';
import { AC, LIB, MODEL, NEW_FETCH, TEST_MS, base, brief, t26, type Line } from './helpers.ts';

afterAll(t26.cleanup, 60_000);

interface Got { isError: boolean; value: Line; text: string }
/** The new form's call through the world's deep mcp. */
async function fetchNew(w: World): Promise<Got> {
  const reply = (await (w.mcp as unknown as { request(m: string, p: Line): Promise<Line> }).request('tools/call', { name: NEW_FETCH.tool, arguments: NEW_FETCH.args })) as Line;
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  let value: Line = {};
  try { value = (result.structuredContent ?? JSON.parse(text)) as Line; } catch { /* text only */ }
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
async function fetchUntilDone(w: World, ms = 300_000): Promise<Got> {
  for (const deadline = Date.now() + ms; ;) {
    const o = await fetchNew(w);
    if (o.value.status !== 'held' || Date.now() > deadline) return o;
    await sleep(1000);
  }
}
const call = `${NEW_FETCH.tool} ${JSON.stringify(NEW_FETCH.args)}`;

/** The judge: a fetch from a library you haven't allowed raises exactly one authority ask naming it; one you have, none. */
function askFailures(allowed: boolean, raised: { kind: string; text: string }[]): string[] {
  const authority = raised.filter((a) => a.kind === 'authority');
  if (allowed) return authority.length ? [`${call} asked ${authority.length} times for ${LIB}, which your standing rule allows`] : [];
  if (authority.length !== 1) return [`${call} fetched from ${LIB}, which you haven't allowed, after ${authority.length} authority asks, not one`];
  return authority[0]!.text.includes(LIB) ? [] : [`the authority ask doesn't name the library ${LIB}: ${authority[0]!.text.slice(0, 400)}`];
}

describe('the fetch through its new form is the fetch it was', () => {
  it(`AC3 ${AC.fetch} the model fetched through its new form lands under the hash the merge base's fetch gives it, after one authority ask for a library not yet allowed and none for one that is; a planted form that fetches with no ask fails, naming the library; offline it answers BLOCKED`, async () => {
    const want = base().fetched[MODEL];
    expect(want, 'BLOCKED: fixtures/base.json holds the hash the base\'s fetch gave the model').toMatch(/^[0-9a-f]{64}$/);

    // A library not yet allowed: held on one authority ask, then fetched after your yes.
    const a = await onWorld();
    const before = (await asks(a)).length;
    const first = await fetchNew(a);
    expect(first.value.status, `${call} waits on your answer: ${first.text.slice(0, 800)}`).toBe('held');
    const raised = (await asks(a)).slice(before);
    expect(askFailures(false, raised), `the asks the fetch raised: ${brief(raised, 800)}`).toEqual([]);
    const answered = await yes(a, raised.find((r) => r.kind === 'authority')!);
    expect(answered.code, `deep inbox answer: ${answered.stderr.slice(-400)}`).toBe(0);
    const done = await fetchUntilDone(a);
    expect({ status: done.value.status, sha256: done.value.asset?.sha256 }, `after the yes the model lands under the base's hash: ${done.text.slice(0, 800)}`).toEqual({ status: 'fetched', sha256: want });
    expect(await stored(a, want!), `the store holds ${MODEL} under ${want}`).toBeDefined();
    expect(askFailures(false, (await asks(a)).slice(before)), 'the fetch asked once in all').toEqual([]);

    // A library your standing rule allows: no ask, the same hash.
    const b = await onWorld();
    await must(b, 'library.rule', { library: LIB, licenses: ['CC-BY-4.0'] });
    const bBefore = (await asks(b)).length;
    const ruled = await fetchUntilDone(b);
    const bRaised = (await asks(b)).slice(bBefore);
    expect({ status: ruled.value.status, sha256: ruled.value.asset?.sha256 }, `under your rule the model lands under the base's hash: ${ruled.text.slice(0, 800)}`).toEqual({ status: 'fetched', sha256: want });
    expect(askFailures(true, bRaised), 'under your rule nothing is asked').toEqual([]);
    // The planted form that fetches with no ask: the same judge, for a library not allowed, on a fetch that asked nothing.
    const planted = askFailures(false, bRaised);
    expect(planted.filter((f) => f.includes(LIB)), `the judge fails a fetch with no ask from a library not allowed, naming the library: ${planted.join(' | ') || 'it passed'}`).not.toEqual([]);

    // Offline: the library's host refuses connections.
    const c = await onWorld();
    await c.library.close();
    const offline = await fetchNew(c);
    expect(blocked(offline), `offline, ${call} answers BLOCKED: ${offline.text.slice(0, 800)}`).toBe(true);
    expect(await stored(c, want!), 'offline, nothing is stored').toBeUndefined();
  }, TEST_MS);
});
