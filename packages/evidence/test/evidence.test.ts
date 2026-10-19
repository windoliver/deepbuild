import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore, type PutRequest } from '../src/index.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function open() {
  const root = mkdtempSync(join(tmpdir(), 'deep-evidence-unit-'));
  roots.push(root);
  let clock = 0;
  const store = await openEvidenceStore({ root, now: () => clock });
  const writer = store.connect({ role: 'deepbuild', via: 'capture' });
  const put = async (text: string, extra: Partial<PutRequest> = {}) => {
    const result = await writer.put({ bytes: Buffer.from(text), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] }, ...extra });
    if (result.status !== 'stored') throw Error(result.reason);
    return result.evidence.sha256;
  };
  return { store, writer, put, at: (ms: number) => { clock = ms; } };
}

describe('retention of a series and of map layers', () => {
  it('drops uncited batches after 24 hours and uncited minute rollups after 7 days; cited ones and hour rollups follow 30 days', async () => {
    const { store, put, at } = await open();
    const batch = await put('batch 10:00:00', { kind: 'reading.batch' });
    const citedBatch = await put('batch 10:00:10', { kind: 'reading.batch' });
    const minute = await put('rollup 10:00', { kind: 'reading.rollup.minute' });
    const hour = await put('rollup 10', { kind: 'reading.rollup.hour' });
    const keep = { cited: new Set([citedBatch]), archived: new Set<string>() };

    at(23 * HOUR);
    expect((await store.retain(keep)).removed).toEqual([]);
    at(25 * HOUR);
    expect((await store.retain(keep)).removed).toEqual([batch]);
    at(6 * DAY);
    expect((await store.retain(keep)).removed).toEqual([]);
    at(8 * DAY);
    expect((await store.retain(keep)).removed).toEqual([minute]);
    at(31 * DAY);
    expect((await store.retain(keep)).removed).toEqual([hour]);
    expect(await store.get(citedBatch)).toBeDefined();
  });

  it("keeps an installed layer's newest rows file for each parent and level, and lets it go once the layer is removed", async () => {
    const { store, writer, put, at } = await open();
    const rows = (text: string, parent: string | null, level: number) => put(text, { kind: 'layer.rows', layer: { id: 'infra', parent, level } });
    const older = await rows('rows v1', null, 0);
    const deeper = await rows('rows for checkout', 'checkout', 1);
    at(DAY);
    const newest = await rows('rows v2', null, 0);
    const other = await put('rows of a removed layer', { kind: 'layer.rows', layer: { id: 'old', parent: null, level: 0 } });

    at(40 * DAY);
    const installed = { cited: new Set<string>(), archived: new Set<string>(), installed: new Set(['infra']) };
    expect((await store.retain(installed)).removed.sort()).toEqual([older, other].sort());
    expect(await store.get(newest)).toBeDefined();
    expect(await store.get(deeper)).toBeDefined();
    expect((await store.retain({ ...installed, installed: new Set() })).removed.sort()).toEqual([deeper, newest].sort());

    const unnamed = await writer.put({ bytes: Buffer.from('rows'), kind: 'layer.rows', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] } });
    expect(unnamed).toMatchObject({ status: 'refused', reason: expect.stringMatching(/layer, parent and level/) });
  });
});

describe('video step times', () => {
  it('keeps where each step starts and ends, and refuses a step that runs backwards', async () => {
    const { store, writer, put } = await open();
    const steps = [{ step: 'open cart', startMs: 0, endMs: 1200 }, { step: 'pay', startMs: 1200, endMs: 4100 }];
    const video = await put('a recording', { kind: 'recording', steps });
    expect((await store.get(video))?.steps).toEqual(steps);
    const backwards = await writer.put({ bytes: Buffer.from('another'), kind: 'recording', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: [] }, steps: [{ step: 'pay', startMs: 4100, endMs: 1200 }] });
    expect(backwards).toMatchObject({ status: 'refused', reason: expect.stringMatching(/step pay/) });
  });
});

describe('your yes to a send', () => {
  it('holds after the store reopens, so the same file to the same host is never asked about twice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deep-evidence-unit-'));
    roots.push(root);
    const first = await openEvidenceStore({ root, now: () => 0 });
    const put = await first.connect({ role: 'agent', session: 'session:1' }).put({ bytes: Buffer.from('agent file'), kind: 'log', source: 'test', redaction: 'complete', license: { name: 'CC0-1.0', allows: ['post'] } });
    if (put.status !== 'stored') throw Error(put.reason);
    const file = put.evidence.sha256;
    const asked: string[] = [];
    const boundary = { ask: async (q: { destination: string }) => { asked.push(q.destination); return true; }, deliver: async () => undefined };
    await first.send({ files: [file], via: 'post', destination: 'social.example' }, boundary);

    const reopened = await openEvidenceStore({ root, now: () => 0 });
    const again = await reopened.send({ files: [file], via: 'post', destination: 'social.example' }, boundary);
    await reopened.send({ files: [file], via: 'post', destination: 'other.example' }, boundary);
    expect(asked).toEqual(['social.example', 'other.example']);
    expect(again.sent).toEqual([{ sha256: file, destination: 'social.example' }]);
  });
});
