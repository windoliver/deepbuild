// #2495: the writer route is authenticated, stores the exact bytes once, and never silently accepts a bad report.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { withHub } from './hub.js';

type Reply = { result?: { handle?: string }; error?: { code: string } };
function request(root: string, role: string, token: string, report: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(join(root, 'hub.sock'));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', reject);
    socket.setTimeout(10_000, () => socket.destroy(Error('hub did not answer')));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (line.hello) socket.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`);
        else if (line.role) socket.write(`${JSON.stringify({ v: 1, id: 1, method: 'eval.report', params: { report } })}\n`);
        else { socket.destroy(); resolve(line); }
      }
    });
  });
}

it('stores exact report bytes, deduplicates by hash, and refuses malformed or non-CLI writes', async () => {
  await withHub(async (root) => {
    const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
    const report = '{\n  "plan": {"id":"transport"}, "runs": []\n}\n';
    const hash = createHash('sha256').update(report).digest('hex');
    for (let i = 0; i < 2; i++) {
      expect(await request(root, 'cli', token, report)).toMatchObject({ result: { handle: `ev:${hash}` } });
    }
    const store = await openEvidenceStore({ root: join(root, 'evidence'), readOnly: true });
    expect(await store.get(hash)).toMatchObject({ sha256: hash, kind: 'replay', source: 'config-eval' });
    expect(Buffer.from(await store.read(hash)).toString('utf8')).toBe(report);
    for (const invalid of [null, '{}', '{', '{"plan":[],"runs":[]}', '{"plan":{},"runs":{}}']) {
      expect(await request(root, 'cli', token, invalid)).toMatchObject({ error: { code: 'type' } });
    }
    expect(await request(root, 'app', token, report)).toMatchObject({ error: { code: 'role' } });
    expect((await request(root, 'cli', 'wrong-token', report)).error).toBeDefined();
  });
}, 60_000);

it('never labels a caller-supplied report as already redacted or licensed for sharing', async () => {
  await withHub(async (root) => {
    const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
    const report = JSON.stringify({ plan: { id: 'unreviewed-report' }, runs: [] });
    const reply = await request(root, 'cli', token, report);
    expect(reply.error).toBeUndefined();
    const store = await openEvidenceStore({ root: join(root, 'evidence'), readOnly: true });
    expect(await store.get(reply.result!.handle!.slice(3))).toMatchObject({
      redaction: 'unknown', license: { name: 'session', allows: [] },
    });
  });
}, 60_000);
