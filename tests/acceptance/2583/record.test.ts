// #2583 AC2: an event of kind `brief.uncited` without `job` or without `sentence` is refused by the record, naming the
// missing field. Through the record's public entry, appending as the core does: each test opens a record of its own in
// a temporary folder and appends the event with the payload #1193 writes, {job, sentence}, which the record must keep,
// so the refusal that follows is about the missing field and not the kind; then the same event without one field,
// which the record must refuse with a message naming that field, and leave out of its log.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openRecord, ulid } from '../../../packages/record/src/index.ts';
import type { Connection, EventInput } from '../../../packages/record/src/index.ts';

// What the hub's socket proves for the core, which records what a brief's runner job leaves uncited.
const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const AT = Date.UTC(2026, 10, 15, 12);
// The runner job, by the run: handle the record's job events name a job by, and a brief sentence that cites none of
// its stories. Neither value spells either field's name, so a message names a field only by naming it.
const PAYLOAD = { job: `run:${ulid(AT - 60_000, '0123456789abcdef0123')}`, sentence: 'Ferries to the islands resume on Monday morning.' };

const uncited = (data: Partial<typeof PAYLOAD>): EventInput => ({ v: 1, id: ulid(AT), kind: 'brief.uncited', ts: AT, data });

it.each(['job', 'sentence'] as const)('#2583.bfaf46c7 AC2 a brief.uncited event without %s is refused by the record, naming the missing field, where the event with job and sentence is recorded', async (missing) => {
  const folder = mkdtempSync(join(tmpdir(), 'deep-2583-'));
  const record = await openRecord({ path: join(folder, 'record.db'), now: () => AT });
  try {
    const whole = uncited(PAYLOAD);
    await expect(record.append(CORE, whole), 'the record keeps a brief.uncited event with the payload {job, sentence}').resolves.toMatchObject({ existing: false });

    const { [missing]: _left, ...rest } = PAYLOAD;
    const refused: unknown = await record.append(CORE, uncited(rest)).then(() => undefined, (error: unknown) => error);
    expect(refused, `the record refuses a brief.uncited event without ${missing}`).toBeInstanceOf(Error);
    // The issue's Proof: the refused event's message.
    console.log(`brief.uncited without ${missing}: ${(refused as Error).message}`);
    expect((refused as Error).message, `the refusal names the missing field, ${missing}`).toMatch(new RegExp(`\\b${missing}\\b`));

    const kept = await record.read({ after: 0, kinds: ['brief.uncited'] });
    expect(kept.map(({ id, data }) => ({ id, data })), 'the log holds the whole event, and not the refused one').toEqual([{ id: whole.id, data: PAYLOAD }]);
  } finally {
    await record.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
