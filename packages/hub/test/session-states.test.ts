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
