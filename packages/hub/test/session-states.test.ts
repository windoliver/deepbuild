// The one reading of a session's state (#992), over a record: a process gone outranks a permission prompt, and a
// session that started again since, as a resume does in a new process, is no longer gone.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtures, type JsonValue } from '@deepbuild/contracts';
import { openRecord } from '@deepbuild/record';
import { expect, it } from 'vitest';
import { sessionStates } from '../src/status.js';
import { ulid } from '../src/wire.js';

it('a session resumed after its process went reads by its new prompt, not as gone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-states-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  try {
    const S = '7c4d5e60-1111-4222-8333-44445555b992';
    const subject = `session:${S.replace(/-/g, '')}`;
    const hook = { writer: 'hook', actor: 'you', scope: 'you', session: S };
    const core = { ...hook, writer: 'core' };
    let at = Date.now();
    const data = (kind: string) => (fixtures(kind)[0] as { data: Record<string, JsonValue> }).data;
    const start = () => record.append(hook, { v: 1, id: ulid(++at), kind: 'session.start', ts: at, data: data('session.start@1') });
    const prompt = () => record.append(hook, { v: 1, id: ulid(++at), kind: 'permission.request', ts: at, seq: `${BigInt(at) * 1_000_000n}`, subject, data: data('permission.request@1') });
    const read = async () => (await sessionStates((sql) => record.raw(sql), at)).find((r) => r.id === S);
    await start();
    await prompt();
    await record.append(core, { v: 1, id: ulid(++at), kind: 'session.gone', ts: at, subject, data: { pid: 4242, start: 'Mon Nov  2 23:00:00 2026' } });
    expect((await read())?.state, 'its process gone while its prompt showed: flagged').toBe('flagged');
    // Resumed in a new process, it shows a permission prompt again.
    await start();
    await prompt();
    expect(await read(), 'the resumed session needs you').toMatchObject({ state: 'needs you', cause: 'waiting' });
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('a finished session reads its stop\'s age, not that of the idle-prompt notification a minute after it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-states-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  try {
    const S = '7c4d5e60-1111-4222-8333-44445555c992';
    const subject = `session:${S.replace(/-/g, '')}`;
    const hook = { writer: 'hook', actor: 'you', scope: 'you', session: S };
    const stopped = Date.now() - 180_000;
    const data = (kind: string) => (fixtures(kind)[0] as { data: Record<string, JsonValue> }).data;
    await record.append(hook, { v: 1, id: ulid(stopped - 10), kind: 'session.start', ts: stopped - 10, data: data('session.start@1') });
    await record.append(hook, { v: 5, id: ulid(stopped), kind: 'agent.stop', ts: stopped, seq: `${BigInt(stopped) * 1_000_000n}`, subject, data: data('agent.stop@5') });
    // Claude Code tells an idle prompt a minute after the stop: a sign of the session, not of its turn.
    const idle = stopped + 60_000;
    await record.append(hook, { v: 2, id: ulid(idle), kind: 'session.attention', ts: idle, seq: `${BigInt(idle) * 1_000_000n}`, subject, data: { state: 'finished' } });
    const row = (await sessionStates((sql) => record.raw(sql), stopped + 180_000)).find((r) => r.id === S);
    expect(row).toMatchObject({ state: 'finished', why: 'its turn stopped 3m ago' });
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('a permission prompt with no hook for 5 minutes reads quiet, as the hub that saw it would have, after a restart too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-states-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  try {
    const S = '7c4d5e60-1111-4222-8333-44445555d992';
    const subject = `session:${S.replace(/-/g, '')}`;
    const hook = { writer: 'hook', actor: 'you', scope: 'you', session: S };
    const at = Date.now() - 600_000;
    const data = (kind: string) => (fixtures(kind)[0] as { data: Record<string, JsonValue> }).data;
    await record.append(hook, { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: data('session.start@1') });
    await record.append(hook, { v: 1, id: ulid(at + 1), kind: 'permission.request', ts: at + 1, seq: `${BigInt(at + 1) * 1_000_000n}`, subject, data: data('permission.request@1') });
    const read = async (now: number) => (await sessionStates((sql) => record.raw(sql), now)).find((r) => r.id === S);
    expect(await read(at + 240_000), 'four minutes on, the prompt still needs you').toMatchObject({ state: 'needs you', cause: 'waiting' });
    expect(await read(at + 301_000), 'past five minutes with no hook, it reads quiet').toMatchObject({ state: 'quiet', cause: 'quiet' });
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('a row only an archived transcript made, naming the session by its handle, is no session of its own', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-states-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  try {
    const S = '7c4d5e60-1111-4222-8333-44445555e992';
    const handle = S.replace(/-/g, '');
    const hook = { writer: 'hook', actor: 'you', scope: 'you', session: S };
    const at = Date.now();
    const data = (kind: string) => (fixtures(kind)[0] as { data: Record<string, JsonValue> }).data;
    await record.append(hook, { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: data('session.start@1') });
    await record.append({ writer: 'app', actor: 'you', scope: 'you' }, { v: 1, id: ulid(at + 1), kind: 'transcript.archived', ts: at + 1, data: { ...data('transcript.archived@1'), session: `session:${handle}` } });
    const ids = (await sessionStates((sql) => record.raw(sql), at + 2)).map((r) => r.id).filter((id) => id.replace(/-/g, '') === handle);
    expect(ids, 'one reading, of the session itself').toEqual([S]);
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
