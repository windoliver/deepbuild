// What the blind suite doesn't reach (#342): a spec's kinds that can't work, a command that names nothing, a repo's
// pattern that would hold the core's thread, and a default, which closes no teardown task.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures } from '@deepbuild/contracts';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { afterEach, expect, it } from 'vitest';
import { resourceKinds, Teardowns, type Ran } from '../src/teardowns.js';
import { ulid } from '../src/wire.js';

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const SESSION = '7c4d5e60-1111-4222-8333-44445555b342';
async function world(resources: string): Promise<{ record: RecordStore; teardowns: Teardowns; asks: Record<string, unknown>[]; readings: string[]; ran: (command: string, stdout: string) => Ran }> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-teardowns-'));
  made.push(dir);
  mkdirSync(join(dir, '.deepbuild'));
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), `checks:\n  gone: { type: command, run: "true" }\nresources:\n${resources}\n`);
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks: Record<string, unknown>[] = [];
  const readings: string[] = [];
  const core = { writer: 'core', actor: 'you', scope: 'you', session: SESSION, agent: 'claude-code' };
  const teardowns = new Teardowns({
    raw: (query, params) => record.raw(query, params), held: ['s3cret-value'],
    append: async (_session, _agent, kind, data) => { const ts = Date.now(); await record.append(core, { v: 1, id: ulid(ts), kind, ts, subject: `session:${SESSION.replace(/-/g, '')}`, data: data as never }); },
    reading: async (_session, _agent, text) => { readings.push(text); },
    raise: async (_session, _agent, ask) => { asks.push(ask); },
  });
  return { record, teardowns, asks, readings, ran: (command, stdout) => ({ session: SESSION, agent: 'claude-code', cwd: dir, call: `toolu_${asks.length}`, command, stdout }) };
}
const KIND = "  box: { created_by: '^make box', key: 'made (\\S+)', cost: 3, check: gone }";

it('names what can\'t work: a kind with no check its spec holds gets no task, and says so', async () => {
  expect(resourceKinds({ checks: { gone: {} }, resources: { ok: { created_by: 'a', key: 'b', cost: 1, check: 'gone' }, stray: { created_by: 'a', key: 'b', cost: 1, check: 'nope' }, broken: { created_by: '(', key: 'b', cost: 1, check: 'gone' } } })).toEqual({
    kinds: [{ name: 'ok', created_by: 'a', key: 'b', cost: 1, check: 'gone' }], wrong: ['stray', 'broken'],
  });
  const w = await world("  box: { created_by: 'x', key: 'y', cost: 1, check: nope }");
  try {
    await w.teardowns.saw(w.ran('x', 'y'));
    expect(w.asks).toEqual([]);
    expect(w.readings.join(' ')).toContain('box');
  } finally { await w.record.close(); }
});

it('gives every resource a command\'s output names its task, once, and one that names none still gets one', async () => {
  const w = await world(KIND);
  try {
    await w.teardowns.saw(w.ran('make box', 'made a1\nmade b2\n'));
    await w.teardowns.saw(w.ran('make box', 'made a1\n'));
    expect(w.asks.map((a) => a.cost_usd)).toEqual([3, 3]);
    expect(String(w.asks[0]!.question)).toContain('a1');
    expect(String(w.asks[1]!.question)).toContain('b2');
    await w.teardowns.saw(w.ran('make box', 'done\n'));
    expect(w.asks, 'the output named none').toHaveLength(3);
    expect((await w.teardowns.of(w.asks[2]!))?.key, 'its check gets no key').toBeUndefined();
    await w.teardowns.saw(w.ran('ls', 'made c3\n'));
    expect(w.asks, 'another command creates nothing').toHaveLength(3);
  } finally { await w.record.close(); }
});

it('records no value the hub holds, and a pattern that runs away matches nothing', async () => {
  const w = await world(KIND);
  try {
    await w.teardowns.saw(w.ran('make box', 'made s3cret-value\n'));
    expect(JSON.stringify(await w.record.raw(`SELECT data FROM events WHERE kind = 'resource.created'`))).not.toContain('s3cret-value');
  } finally { await w.record.close(); }
  const slow = await world("  box: { created_by: '^(a+)+$', key: 'x', cost: 1, check: gone }");
  try {
    const at = Date.now();
    await slow.teardowns.saw(slow.ran(`${'a'.repeat(40)}!`, ''));
    expect(slow.asks).toEqual([]);
    expect(Date.now() - at, 'the core\'s thread goes on').toBeLessThan(5000);
  } finally { await slow.record.close(); }
});

it('hands back each teardown task that took its default, once, and no other', async () => {
  const w = await world(KIND);
  try {
    await w.teardowns.saw(w.ran('make box', 'made a1\n'));
    const core = { writer: 'core', actor: 'you', scope: 'you', session: SESSION, agent: 'claude-code' };
    expect(await w.teardowns.defaulted()).toEqual([]);
    const id = ulid(Date.now());
    await w.record.append(core, { v: 3, id, kind: 'ask.created', ts: Date.now(), data: { ...w.asks[0], deadline: Date.now() + 1000 } as never });
    await w.record.append(core, { v: 1, id: ulid(Date.now() + 1), kind: 'ask.defaulted', ts: Date.now(), subject: `ask:${id}`, data: (fixtures('ask.defaulted@1')[0] as { data: never }).data });
    const first = await w.teardowns.defaulted();
    expect(first.map((d) => d.resource.key)).toEqual(['a1']);
    expect(await w.teardowns.defaulted(), 'once').toEqual([]);
  } finally { await w.record.close(); }
});

it('takes the core\'s own record of an Archive no hook fired', async () => {
  const w = await world(KIND);
  try {
    const ts = Date.now();
    await w.record.append({ writer: 'core', actor: 'you', scope: 'you', session: SESSION, agent: 'codex' }, { v: 1, id: ulid(ts), kind: 'session.archived', ts, subject: `session:${SESSION.replace(/-/g, '')}`, data: { transcript: '/h/.codex/sessions/rollout.jsonl' } });
    expect(await w.record.raw(`SELECT 1 FROM events WHERE kind = 'session.archived'`)).toHaveLength(1);
  } finally { await w.record.close(); }
});
