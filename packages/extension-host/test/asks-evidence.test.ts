// #1853's review regressions, beyond its acceptance tests: a plug-in's ask may not carry an allow option, which only
// DeepBuild writes, nor declare what may answer it; and a file it puts as evidence is on the record as an evidence.stored event, as the hub's own puts
// are. Each runs a real sandboxed package through a real host, asks core, evidence store and record.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust, packageDigest } from '../src/index.js';
import { cleanup, closing, pkgOf, temp } from './package.js';

afterAll(cleanup);

/** Loads `code` as test/plug, sandboxed, and returns what its code returned at the load, and the record. */
async function loaded(code: string, files: Record<string, string> = {}): Promise<{ result: Record<string, unknown> | undefined; record: RecordStore }> {
  const dir = temp();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: Date.now });
  closing.push(record, supervisor);
  mkdirSync(join(dir, 'home'));
  const h = await openExtensionHost({ record, supervisor, trust: await openTrust({ record, now: Date.now }), home: join(dir, 'home'), release: [], now: Date.now, asks, evidence });
  closing.push(h);
  await h.ready();
  const folder = pkgOf('test/plug', code, { access: { words: ['files'] } });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  // The extra files change the package's bytes: stamp it again.
  if (Object.keys(files).length) {
    const manifest = { ...JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Record<string, unknown>, digest: '' };
    writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
    writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify({ ...manifest, digest: packageDigest(folder) }));
  }
  const p = await h.install({ from: folder, builtBy: null });
  expect((await h.check(p)).passed).toBe(true);
  const load = await h.load(p);
  expect(load.status === 'loaded' && load.place).toBe('sandbox');
  return { result: h.loadResult('test/plug'), record };
}

const ASK = (decision: string) => JSON.stringify({
  kind: 'choice', question: 'Ship the build?', options: [{ id: 'ship', label: 'Ship it', decision }, { id: 'hold', label: 'Hold', decision: 'none' }],
  recommended: 'ship', deadline: Date.now() + 172_800_000, fallback: 'you', default: 'hold', provisional: true, owner: 'you',
  key: 'a'.repeat(64), pinned_to: { kind: 'evidence', ref: 'b'.repeat(64) },
});

it('a plug-in\'s ask with an allow option is refused, naming the option, and no ask opens', async () => {
  const { result, record } = await loaded(`export default async function (deep: any) {
  try { return { ok: await deep.asks.create(${ASK('allow')}) }; } catch (e: any) { return { error: String(e.message) }; }
}
`);
  expect(result?.error).toContain('ship declares allow');
  const asked = (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'ask.created');
  expect(asked).toEqual([]);
}, 60_000);

it('a plug-in\'s ask takes the trusted path alone, whatever it declares (#1581): only DeepBuild declares what may answer it', async () => {
  const ask = { ...JSON.parse(ASK('none')) as Record<string, unknown>, may_answer: 'verified_channel' };
  const { result, record } = await loaded(`export default async function (deep: any) {
  try { return { ok: await deep.asks.create(${JSON.stringify(ask)}) }; } catch (e: any) { return { error: String(e.message) }; }
}
`);
  expect(result?.error).toBeUndefined();
  const asked = (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'ask.created').map((e) => (e.data as { may_answer?: unknown }).may_answer);
  expect(asked).toEqual(['trusted_path']);
}, 60_000);

it('a file a plug-in puts as evidence is on the record as evidence.stored, by its sha256, with the cautious origin', async () => {
  const text = 'a plug-in\'s report\n';
  const { result, record } = await loaded(`export default async function (deep: any) {
  try { return { ok: await deep.evidence.put('report.txt') }; } catch (e: any) { return { error: String(e.message) }; }
}
`, { 'report.txt': text });
  const sha = createHash('sha256').update(text).digest('hex');
  expect(result).toEqual({ ok: sha });
  const stored = (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'evidence.stored').map((e) => e.data as { sha256: string; origin: string });
  expect(stored.map((d) => [d.sha256, d.origin])).toEqual([[sha, 'agent']]);
}, 60_000);
