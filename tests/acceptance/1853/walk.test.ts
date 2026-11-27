// AC4 and AC5: the walk calls every published method once, from #348's walk package holding each method's grant,
// through the host; a method may answer or refuse its arguments, but none may end in the host's not-wired error.
// AC5's planted host (`plant: 'unwired-method'`, README, Wrong programs) publishes one more method,
// deep.planted.unwired, which needs no grant and has no case in the host: the walk must fail, naming it.
import { describe, expect, it } from 'vitest';
import { EXTENSION_API, type ApiMethod } from '../../../packages/extension-host/src/index.ts';
import { extensionApi } from '../../../packages/contracts/src/index.ts';
import { AC4, AC5, NOT_WIRED, walk, walkProblems } from './helpers.ts';

const PLANTED: ApiMethod = { method: 'deep.planted.unwired', needs: null };

describe(`AC4 ${AC4} the walk of every published method, holding each method's grant, ends with 0 calls in the host's not-wired error`, () => {
  it('AC4 every published method is called once, and none ends in "isn\'t wired into this host yet"', async () => {
    const published = extensionApi().map((m) => m.method);
    expect(EXTENSION_API.map((m) => m.method).sort(), 'the host\'s schema is the published contract').toEqual([...published].sort());
    const calls = await walk(EXTENSION_API);
    expect(calls.filter((c) => (c.error ?? '').includes(NOT_WIRED)).map((c) => `${c.method}: ${c.error}`), 'calls in the not-wired error').toEqual([]);
    expect(walkProblems(EXTENSION_API, calls), 'every method was called and answered under its grant').toEqual([]);
  }, 180_000);
});

describe(`AC5 ${AC5} a planted published method that needs no grant and has no case in the host fails the walk, naming the method`, () => {
  it('AC5 (wrong program) the planted host\'s deep.planted.unwired ends in the not-wired error and the walk names it', async () => {
    const schema = [...EXTENSION_API, PLANTED];
    const calls = await walk(schema, 'unwired-method');
    const call = calls.find((c) => c.method === PLANTED.method);
    expect({ outcome: call?.outcome, error: call?.error }, 'the planted method is published and reaches the host, which has no case for it')
      .toEqual({ outcome: 'error', error: expect.stringContaining(`${PLANTED.method} ${NOT_WIRED}`) });
    expect(walkProblems(schema, calls), 'the walk fails, naming the planted method').toContainEqual(expect.stringContaining(`${PLANTED.method}: ${PLANTED.method} ${NOT_WIRED}`));
  }, 180_000);
});
