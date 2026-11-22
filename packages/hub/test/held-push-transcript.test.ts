// A held push copies the session's transcript from the path its hook named (#2316): the archive is handed the
// hook's transcript_path, so it needn't list every transcript folder before the ask is raised (ARCHIVE_WAIT_MS).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord, ulid, type Connection } from '@deepbuild/record';
import { Holds } from '../src/holds.js';
import type { HookMeta } from '../src/wire.js';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a push held in a proceed turn', () => {
  it("has the archive copy the session's transcript from the path its hook named", async () => {
    dir = mkdtempSync(join(tmpdir(), 'held-push-'));
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ asks: { deadline: { authority: '1d' }, default: { authority: 'no' } } }));
    let t = 1_760_000_000_000;
    const now = () => (t += 1000);
    const record = await openRecord({ path: join(dir, 'record.db'), now });
    const asks = await openAsks({ record, now, deliver: () => undefined, home: dir });
    const as = (writer: string, session: string): Connection => ({ writer, actor: 'you', scope: 'you', session, agent: 'claude-code' });
    const copies: [string, string][] = [];
    const holds = new Holds({
      raw: (q, params) => record.raw(q, params), asks: () => asks, now, plant: undefined, sorter: undefined,
      append: async (c, e) => { await record.append(c, e); }, connection: (s) => as('core', s), pin: async () => ({ kind: 'commit', ref: '0'.repeat(40) }),
      reading: async () => undefined,
      archived: async (session, transcript) => { copies.push([session, transcript]); },
    });
    const transcript = join(dir, '.claude', 'projects', '-work', 's1.jsonl');
    await record.append(as('core', 's1'), { v: 1, id: ulid(now()), kind: 'question.proceeded', ts: now(), data: { question: 'Push?', rule: 'r' } });
    const held = await holds.gate({ session: 's1', agent: 'claude-code', cwd: dir, transcript } as HookMeta, { label: 'git push https://example.com/a/b.git main', classes: ['push'] });
    expect(held, 'the push waits on an ask').toContain('ask:');
    expect(copies, "the archive is handed the hook's transcript path").toEqual([['s1', transcript]]);
  });
});
