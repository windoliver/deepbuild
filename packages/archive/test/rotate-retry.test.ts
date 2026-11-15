// #2365: a failed rotate-ask write must not disappear behind a successfully linked archive checkpoint.
import { afterAll, expect, test } from 'vitest';
import { allEvents, claudeTranscript, dataOf, openArchiveOn, openWorld, removeTemps } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);
test('a failed rotate ask is retried on the next pass, without archiving or asking twice', async () => {
  const w = await openWorld();
  try {
    // Synthetic PAT-shaped text, not a credential.
    const key = `ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6'}`;
    claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: `deploy with ${key} please` }]);
    const raise = w.asks.raise.bind(w.asks);
    let fail = true;
    w.asks.raise = async (...args) => { if (fail) { fail = false; throw Error('injected ask write failure'); } return raise(...args); };
    const archive = await openArchiveOn(w);
    await expect(archive.pass()).rejects.toThrow('injected ask write failure');
    await archive.pass();
    await archive.pass();
    expect(await allEvents(w.record, ['transcript.archived'])).toHaveLength(1);
    const asks = (await allEvents(w.record, ['ask.created'])).filter((e) => String(dataOf(e).question).includes('Rotate'));
    expect(asks).toHaveLength(1);
    expect(JSON.stringify(asks)).not.toContain(key);
  } finally { await w.close(); }
}, 120_000);
