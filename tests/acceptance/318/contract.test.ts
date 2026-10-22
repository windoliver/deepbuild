// Criteria 1, 6, 9 and 11, schema half: what an ask must state, held by the published ask.created@1
// schema (the contracts package) and the record. These load no asks core, and they pass on the base,
// whose ask.created@1 already holds them; they keep it from regressing. raise.test.ts holds the core to it.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openRecord, RecordError } from '../../../packages/record/src/index.ts';
import { ENDS, KINDS, NOT_DECISIONS, NOT_KINDS, STATES, T0, ask, created, refusedAt, type Obj } from './data.ts';

test('#318.b64bd314 an item of no ask kind fails ask.created, and the record refuses to append it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-318-'));
  const record = await openRecord({ path: join(dir, 'record.db'), now: () => T0 });
  try {
    for (const kind of NOT_KINDS) {
      const { writer: _w, actor: _a, scope: _s, ...input } = created({ ...ask('taste', T0), kind });
      refusedAt('ask.created@1', created({ ...ask('taste', T0), kind }), '/data/kind');
      await expect(record.append({ writer: 'core', actor: 'you', scope: 'you', session: 'S1' }, input as never), `the record appended an ask of kind "${kind}"`).rejects.toBeInstanceOf(RecordError);
    }
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#318.785af8ee an ask without what it decides, its options, the recommendation or the default fails its schema, naming the field', () => {
  for (const kind of KINDS) {
    for (const field of STATES) {
      const data: Obj = ask(kind, T0);
      delete data[field];
      refusedAt('ask.created@1', created(data), `/data/${field}`);
    }
    refusedAt('ask.created@1', created({ ...ask(kind, T0), question: '' }), '/data/question');
  }
});

test('#318.fc8e493b an authority ask with an option that has no decision, or any value but allow, deny or none, fails its schema', () => {
  const missing = ask('authority', T0);
  delete ((missing.options as Obj[])[1] as Obj).decision;
  refusedAt('ask.created@1', created(missing), '/data/options/1/decision');
  for (const value of NOT_DECISIONS) {
    const data = ask('authority', T0);
    ((data.options as Obj[])[0] as Obj).decision = value;
    refusedAt('ask.created@1', created(data), '/data/options/0/decision');
  }
});

test('#318.e4675a8d an ask.created without its fallback, owner, key or pinned_to fails its schema, naming the field', () => {
  for (const kind of KINDS) {
    for (const field of ENDS) {
      const data: Obj = ask(kind, T0);
      delete data[field];
      refusedAt('ask.created@1', created(data), `/data/${field}`);
    }
  }
});
