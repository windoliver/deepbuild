// #3229's rules beside its criteria: how a call can spell what it reaches, whose calls count, and what a sealed file gives
// back, on the real record and the real evidence store.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore, type EvidenceStore } from '@deepbuild/evidence';
import { openRecord, ulid, type RecordStore } from '@deepbuild/record';
import { sealerIn, Variants, type Variant } from '../src/variants.js';
import type { Draft, HookMeta } from '../src/wire.js';

const dirs: string[] = [];
const open: RecordStore[] = [];
afterEach(async () => {
  for (const r of open.splice(0)) await r.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = (): string => { const d = mkdtempSync(join(tmpdir(), 'dh3229-unit-')); dirs.push(d); return d; };
const memory = () => { const held = new Map<string, string>(); return { held, get: async (k: string) => held.get(k), set: async (k: string, v: string) => { held.set(k, v); }, delete: async (k: string) => { held.delete(k); } }; };

describe('a sealed file', () => {
  const MARKER = 'variant-marker-5f1c';
  const put = (store: EvidenceStore) => store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes: Buffer.from(MARKER), kind: 'held-out', source: 'R2 held-out variant 1', redaction: 'unknown', license: { name: 'session', allows: ['export'] }, sealed: true });
  const all = (dir: string): string => (readdirSync(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => readFileSync(join(e.parentPath, e.name), 'latin1')).join('\n');

  it('lies in the store under nothing that says it, and only a hub with the key reads it', async () => {
    const root = temp();
    const secrets = memory();
    const store = await openEvidenceStore({ root, sealer: sealerIn(secrets) });
    const kept = await put(store);
    if (kept.status !== 'stored') throw Error(kept.reason);
    const { sha256 } = kept.evidence;
    expect(all(root)).not.toContain(MARKER);
    await expect(store.read(sha256)).rejects.toThrow(/R2 held-out variant 1/);
    await expect((async () => { for await (const _ of store.chunks(sha256)) void _; })()).rejects.toThrow(/R2 held-out variant 1/);
    const sent = await store.send({ files: [sha256], via: 'export', destination: 'x' }, { ask: async () => true, deliver: async () => { throw Error('it left'); } });
    expect(sent.withheld.map((w) => w.sha256)).toEqual([sha256]);
    expect(Buffer.from(await store.unseal(sha256)).toString()).toBe(MARKER);
    // A reader of the same store, as `deep read` is, and a hub on the same store with another key.
    const reader = await openEvidenceStore({ root, readOnly: true });
    await expect(reader.read(sha256)).rejects.toThrow(/R2 held-out variant 1/);
    const later = await openEvidenceStore({ root, sealer: sealerIn(secrets) });
    expect(Buffer.from(await later.unseal(sha256)).toString()).toBe(MARKER);
    const other = await openEvidenceStore({ root, sealer: sealerIn(memory()) });
    await expect(other.unseal(sha256)).rejects.toThrow(/key/);
    // The same bytes seal alike under one key, so a check's key still equals another session's (#1018).
    const again = await put(later);
    expect(again.status === 'stored' && again.evidence.sha256).toBe(sha256);
  });
  it('is refused by a store with no sealer', async () => {
    expect((await put(await openEvidenceStore({ root: temp() }))).status).toBe('refused');
  });
});

const DIGEST = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';
const TASK = 'task:shop12';
const CHECK = '.deepbuild/checks/cart.sh';
const FILES = { 'test/fixtures/cart.json': DIGEST };

/** A task worked on in thread A (sessions A, its compaction A2 and A's child), beside an unrelated session B. */
async function world() {
  const root = temp();
  let now = 1_000;
  const record = await openRecord({ path: join(root, 'ledger.db'), now: () => now });
  open.push(record);
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  const start = (session: string, thread: string) => record.append({ ...core, writer: 'hook', session, agent: 'claude-code' }, { v: 3, id: ulid(++now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: root, branch: null, thread, loads: [] } });
  await start('A', 'A');
  await start('A2', 'A');
  await start('child', 'child');
  await start('B', 'B');
  await record.append(core, { v: 1, id: ulid(++now), kind: 'session.child_started', ts: now, data: { parent: 'session:A2', child: 'session:child', task_ref: null } });
  await record.append(core, { v: 1, id: ulid(++now), kind: 'task.created', ts: now, data: { task_ref: TASK, thread: 'A', owner: 'you', title: 'x' } });
  const judged: string[] = [];
  const variants = new Variants({
    root, now: () => now, raw: (q, p) => record.raw(q, p), spent: async (task) => { judged.push(task); },
    append: async (session, agent, input) => { await record.append({ ...core, session, agent }, input as never); },
  });
  await variants.open([]);
  variants.keeps(TASK, [{ check: CHECK, held_out: [{ files: FILES }] }]);
  const call = (session: string, input: Record<string, unknown>, ts = ++now) => {
    const id = ulid(ts);
    return variants.called({ id, session, agent: 'claude-code', toolUse: `toolu_${id}`, call: { mode: '', tool: 'Bash', input, suggestions: [] } } as unknown as HookMeta, [{ kind: 'tool.before', v: 3, id, ts, data: { kind: 'shell', paths: [], command: null } } as Draft]);
  };
  return { root, record, variants, judged, call, tick: () => ++now };
}
const spent = async (w: Awaited<ReturnType<typeof world>>): Promise<number> => ((await w.record.raw(`SELECT 1 FROM events WHERE kind = 'variant.spent'`)) as unknown[]).length;

describe('a call that names a variant', () => {
  const tail = `${DIGEST.slice(0, 2)}/${DIGEST.slice(2)}`;
  for (const command of [`echo ${DIGEST}`, `cat ~/.deepbuild/evidence/${tail}`, `cat ~/.deepbuild/evidence/${DIGEST.slice(0, 2)}/"${DIGEST.slice(2, 20)}"*`, `CAT ~/.DEEPBUILD/EVIDENCE/${tail.toUpperCase()}`]) {
    it(`spends it, however spelled: ${command.slice(0, 60)}`, async () => {
      const w = await world();
      await w.call('A', { command });
      expect(w.variants.spent(TASK, FILES)?.call).toMatch(/^toolu_/);
      expect(w.judged).toEqual([TASK]);
      expect(await spent(w)).toBe(1);
      // Another call of it changes nothing, and a hub that starts again reads the mark.
      await w.call('A', { command });
      expect(await spent(w)).toBe(1);
      const next = new Variants({ root: w.root, now: () => 0, raw: (q, p) => w.record.raw(q, p), spent: async () => undefined, append: async () => undefined });
      await next.open([]);
      expect(next.spent(TASK, FILES)?.n).toBe(1);
    });
  }
  it('not another digest, nor a hex run too short to be one', async () => {
    const w = await world();
    await w.call('A', { command: `echo ${'cd'.repeat(32)} ${DIGEST.slice(0, 6)}` });
    expect(await spent(w)).toBe(0);
  });
  it('whatever tool it uses: an MCP call is recorded by its tool alone, and read by its arguments', async () => {
    const w = await world();
    await w.call('A', { path: { at: [`/x/evidence/${tail}`] } });
    expect(await spent(w)).toBe(1);
  });
  it('from the thread a compaction went on in, or a session one of them started, and from no other', async () => {
    for (const [session, n] of [['A2', 1], ['child', 1], ['B', 0]] as const) {
      const w = await world();
      await w.call(session, { command: `echo ${DIGEST}` });
      expect([session, await spent(w)]).toEqual([session, n]);
    }
  });
});

describe('a call that names a checkout', () => {
  const V: Variant = { task: TASK, check: CHECK, n: 1, digests: [DIGEST] };
  const at = async (command: (root: string) => string, when: 'before' | 'while' | 'after'): Promise<number> => {
    const w = await world();
    const before = w.tick();
    w.variants.lies('run:1', V, join(w.root, 'checkouts', 'c-AbC123'), w.tick());
    const during = w.tick();
    if (when === 'after') { w.variants.gone('run:1'); w.tick(); await w.call('A', { command: command(w.root) }); } else await w.call('A', { command: command(w.root) }, when === 'before' ? before : during);
    return spent(w);
  };
  it('spends the variant that lies there, by its folder, a glob over the checkouts or the checkouts themselves', async () => {
    expect(await at((root) => `cat ${root}/checkouts/c-AbC123/test/cart.json`, 'while')).toBe(1);
    expect(await at(() => 'cat ~/.deepbuild/checkouts/*/test/cart.json', 'while')).toBe(1);
    expect(await at(() => 'grep -r total ~/.deepbuild/checkouts', 'while')).toBe(1);
  });
  it('spends nothing before it lay there, after it was gone, for another checkout, or for a folder of the repo', async () => {
    expect(await at((root) => `cat ${root}/checkouts/c-AbC123/test/cart.json`, 'before')).toBe(0);
    expect(await at((root) => `cat ${root}/checkouts/c-AbC123/test/cart.json`, 'after')).toBe(0);
    expect(await at(() => 'cat ~/.deepbuild/checkouts/c-Zz9999/test/cart.json', 'while')).toBe(0);
    expect(await at(() => 'ls src/checkouts', 'while')).toBe(0);
  });
  it('one the last hub left in a checkout lay there until this one opened', async () => {
    const w = await world();
    const began = w.tick();
    const run = `run:${ulid(began)}`;
    const next = new Variants({ root: w.root, now: () => began + 50, raw: (q, p) => w.record.raw(q, p), spent: async () => undefined, append: async () => undefined });
    await next.open([{ run, variant: V, dir: join(w.root, 'checkouts', 'c-AbC123') }]);
    next.keeps(TASK, [{ check: CHECK, held_out: [{ files: FILES }] }]);
    const id = ulid(began + 10);
    await next.called({ id, session: 'A', agent: 'claude-code', call: { mode: '', tool: 'Bash', input: { command: 'cat ~/.deepbuild/checkouts/c-AbC123/x' }, suggestions: [] } } as unknown as HookMeta, [{ kind: 'tool.before', v: 3, id, ts: began + 10, data: {} } as Draft]);
    expect(next.spent(TASK, FILES)?.call).toBe(id);
  });
});
