import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { PutRequest } from '../../../packages/evidence/src/index.ts';
import { anyUse, png, removeRoots, sha256, storeText, stored, T0, tempRoot, utf8 } from './helpers.ts';

afterEach(removeRoots);

const req = (bytes: Uint8Array, kind: string, source: string, extra: Partial<PutRequest> = {}): PutRequest => ({
  bytes, kind, source, redaction: 'complete', license: anyUse, ...extra,
});

describe('AC10 origin comes from the writer connection, never from the call', () => {
  it('AC10 journey, paste and agent connections record deepbuild, you and agent; a job keeps agent from its inputs', async () => {
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const journey = store.connect({ role: 'deepbuild', via: 'journey' });
    const app = store.connect({ role: 'you', via: 'paste' });
    const agent = store.connect({ role: 'agent', session: 'session:01J9ZK' });
    const job = store.connect({ role: 'deepbuild', via: 'job' });

    const shot = png(20, 20, 10);
    const pasted = png(20, 20, 11);
    const agentFile = png(20, 20, 12);
    const agentLog = utf8('agent wrote this log\n');
    await journey.put(req(shot, 'screenshot', 'journey:checkout#2', { declares: 'png' }));
    await app.put(req(pasted, 'screenshot', 'paste:message-42', { declares: 'png' }));
    // The agent's call says deepbuild; its connection says agent.
    await agent.put(req(agentFile, 'screenshot', 'deep_attach', { declares: 'png', origin: 'deepbuild' }));
    const logHash = stored(await storeText(agent, { kind: 'log', source: 'deep_attach', redaction: 'complete', license: anyUse, origin: 'deepbuild' }, [agentLog]));

    // A local job highlights each screenshot: one from the agent's file, one from the journey's.
    const fromAgent = png(20, 20, 13);
    const fromJourney = png(20, 20, 14);
    await job.put(req(fromAgent, 'screenshot', 'job:highlight', { declares: 'png', derivedFrom: [sha256(agentFile)] }));
    await job.put(req(fromJourney, 'screenshot', 'job:highlight', { declares: 'png', derivedFrom: [sha256(shot)] }));

    const expected: [string, string, Uint8Array | string][] = [
      ['deepbuild', 'the journey screenshot', shot],
      ['you', 'the pasted image', pasted],
      // A store that takes origin from the arguments records deepbuild for these two.
      ['agent', "the agent's file whose call said deepbuild", agentFile],
      ['agent', "the agent's log whose call said deepbuild", logHash],
      // A store that gives a job's output origin deepbuild fails here.
      ['agent', "the job's output made from the agent's file", fromAgent],
      ['deepbuild', "the job's output made from the journey's file", fromJourney],
    ];
    for (const [origin, name, file] of expected) {
      const hash = typeof file === 'string' ? file : sha256(file);
      expect((await store.get(hash))?.origin, `${name} (${hash})`).toBe(origin);
    }
    expect((await store.get(sha256(fromAgent)))?.derivedFrom).toEqual([sha256(agentFile)]);
  });
});
