import { execFileSync } from 'node:child_process';
import { closeSync, constants, openSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { Origin, Peer, Redaction, SendBoundary, ShareAsk, ShareVia } from '../../../packages/evidence/src/index.ts';
import { png, removeRoots, sha256, T0, tempRoot } from './helpers.ts';

afterEach(removeRoots);

const peers: Record<Origin, Peer> = {
  deepbuild: { role: 'deepbuild', via: 'journey' },
  you: { role: 'you', via: 'drop' },
  agent: { role: 'agent', session: 'session:01J9ZK' },
};
const vias: ShareVia[] = ['export', 'report', 'post'];
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A boundary that records every ask and delivery, and whether each delivery came after its answer. */
function recorder(answer: (q: ShareAsk) => Promise<boolean>) {
  const asks: ShareAsk[] = [];
  const delivered: { sha256: string; destination: string; bytesHash: string }[] = [];
  const answered = new Set<string>();
  const early: string[] = [];
  const boundary: SendBoundary = {
    async ask(q) {
      asks.push(q);
      const yes = await answer(q);
      answered.add(`${q.sha256}@${q.destination}`);
      return yes;
    },
    async deliver(file, destination) {
      if (asks.some((q) => q.sha256 === file.sha256 && q.destination === destination) && !answered.has(`${file.sha256}@${destination}`))
        early.push(file.sha256);
      delivered.push({ sha256: file.sha256, destination, bytesHash: sha256(file.bytes) });
    },
  };
  return { asks, delivered, early, boundary };
}

describe('AC6 evidence that is not cleared never leaves the machine unless you approve it', () => {
  it('AC6 every redaction, license, origin, way out and answer: it goes out only when cleared or approved', async () => {
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const redactions: Redaction[] = ['complete', 'incomplete', 'unknown'];
    const licenses = Array.from({ length: 8 }, (_, mask) => vias.filter((_, bit) => mask & (1 << bit)));
    const files: { hash: string; redaction: Redaction; allows: ShareVia[]; origin: Origin }[] = [];
    let seed = 600;
    for (const redaction of redactions)
      for (const allows of licenses)
        for (const origin of Object.keys(peers) as Origin[]) {
          const bytes = png(8, 8, seed++);
          const result = await store.connect(peers[origin]).put({
            bytes, kind: 'screenshot', source: 'fixture', redaction, license: { name: 'fixture', allows }, declares: 'png',
          });
          expect(result.status).toBe('stored');
          files.push({ hash: sha256(bytes), redaction, allows, origin });
        }

    const wrong: string[] = [];
    let n = 0;
    for (const file of files)
      for (const via of vias)
        for (const yes of [false, true]) {
          const destination = `host${n++}.example`; // a fresh destination, so no earlier yes applies
          const { asks, delivered, early, boundary } = recorder(async () => yes);
          const receipt = await store.send({ files: [file.hash], via, destination }, boundary);
          const needs = file.origin === 'agent' || file.redaction !== 'complete' || !file.allows.includes(via);
          const out = delivered.some((d) => d.sha256 === file.hash);
          const label = `${file.hash.slice(0, 12)} (${file.origin}, ${file.redaction}, allows [${file.allows}]) by ${via}, answer ${yes ? 'yes' : 'no'}`;
          if (needs !== (asks.length === 1)) wrong.push(`${label}: asked ${asks.length} times`);
          if (out !== (!needs || yes)) wrong.push(`${label}: ${out ? 'went out' : 'stayed'}`);
          if (early.length) wrong.push(`${label}: went out before the answer`);
          if (out !== receipt.sent.some((s) => s.sha256 === file.hash && s.destination === destination)) wrong.push(`${label}: receipt disagrees`);
          if (asks.length && (asks[0]!.sha256 !== file.hash || asks[0]!.destination !== destination)) wrong.push(`${label}: ask names the wrong file or host`);
        }
    expect(wrong, wrong.slice(0, 5).join('\n')).toEqual([]);
  });
});

describe('AC11 a file an agent stored leaves only by hash, after one ask per hash and host', () => {
  it('AC11 one ask naming hash and host, nothing out before the answer, asked once per pair; a journey screenshot needs no ask', async () => {
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const agentBytes = png(16, 16, 21);
    const shotBytes = png(16, 16, 22);
    const license = { name: 'CC0-1.0', allows: vias };
    await store.connect(peers.agent).put({ bytes: agentBytes, kind: 'screenshot', source: 'deep_attach', redaction: 'complete', license, declares: 'png' });
    await store.connect(peers.deepbuild).put({ bytes: shotBytes, kind: 'screenshot', source: 'journey:checkout#5', redaction: 'complete', license, declares: 'png' });
    const agentFile = sha256(agentBytes);
    const shot = sha256(shotBytes);

    // A report bound for a post on social.example carries the agent's file.
    let answer!: (yes: boolean) => void;
    const first = recorder(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    const sending = store.send({ files: [agentFile], via: 'post', destination: 'social.example' }, first.boundary);
    await tick();
    expect(first.asks.map((q) => [q.sha256, q.destination])).toEqual([[agentFile, 'social.example']]);
    // A store that sends the agent's file before the answer fails here.
    expect(first.delivered.map((d) => d.sha256), `agent file ${agentFile} went out before the answer`).toEqual([]);
    answer(true);
    const receipt = await sending;
    expect(first.delivered).toEqual([{ sha256: agentFile, destination: 'social.example', bytesHash: agentFile }]);
    expect(receipt.sent).toEqual([{ sha256: agentFile, destination: 'social.example' }]);

    // Same file, same host: no ask. A store that asks twice for the approved pair fails here.
    const again = recorder(async () => { throw Error('asked again'); });
    await store.send({ files: [agentFile], via: 'post', destination: 'social.example' }, again.boundary);
    expect(again.asks.map((q) => q.sha256), `agent file ${agentFile} was asked about twice for social.example`).toEqual([]);
    expect(again.delivered.map((d) => d.sha256)).toEqual([agentFile]);

    // Same file, another host: asks again, naming that host.
    const other = recorder(async () => false);
    const otherReceipt = await store.send({ files: [agentFile], via: 'post', destination: 'other.example' }, other.boundary);
    expect(other.asks.map((q) => [q.sha256, q.destination])).toEqual([[agentFile, 'other.example']]);
    expect(other.delivered).toEqual([]);
    expect(otherReceipt.sent).toEqual([]);

    // The journey's screenshot goes without that ask.
    const journey = recorder(async () => { throw Error('asked about a journey screenshot'); });
    const journeyReceipt = await store.send({ files: [shot], via: 'post', destination: 'social.example' }, journey.boundary);
    expect(journey.asks).toEqual([]);
    expect(journeyReceipt.sent).toEqual([{ sha256: shot, destination: 'social.example' }]);
  });

  it('AC11 a request that names a path instead of a hash is refused before any file is read', async () => {
    const root = tempRoot();
    const store = await openEvidenceStore({ root, now: () => T0 });
    const shotBytes = png(16, 16, 23);
    await store.connect(peers.deepbuild).put({ bytes: shotBytes, kind: 'screenshot', source: 'journey:checkout#6', redaction: 'complete', license: { name: 'CC0-1.0', allows: vias }, declares: 'png' });
    // A named pipe: opening it to read is visible to the test, which can open its write end only then.
    const pipe = join(tempRoot(), 'attachment.png');
    execFileSync('mkfifo', [pipe]);
    const r = recorder(async () => true);
    const refusal = await store.send({ files: [sha256(shotBytes), pipe], via: 'report', destination: 'reports.example' }, r.boundary)
      .then(() => undefined, (error: unknown) => error);
    await tick();
    let opened = false;
    try {
      closeSync(openSync(pipe, constants.O_WRONLY | constants.O_NONBLOCK));
      opened = true; // someone holds the read end: the store opened the path
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('ENXIO');
    }
    expect(refusal, 'a request naming a path was not refused').toMatchObject({ code: 'refused' });
    expect(opened, `the store opened ${pipe}`).toBe(false);
    expect(r.asks).toEqual([]);
    expect(r.delivered, 'a file went out from a request that named a path').toEqual([]);
  });
});
