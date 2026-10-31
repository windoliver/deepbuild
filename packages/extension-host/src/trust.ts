// Project trust (#348): one decision the core holds in the record, per project folder. Your answer comes through
// the trusted path (the app's card, connection writer `app`) and the core records it as a decision.created. The
// answer is held in memory, one per record and real path (#881): read from the record the first time its folder is
// asked about, and set by the same call that appends a new decision, so a revoke counts on the very next ask. Every
// reader, the host's, the done gate's and spec drafting's, opens trust on the same record and reads that one answer;
// none keeps a list of its own, and the hook path reads it with no record query and no file-system call.
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';

export interface ProjectTrust {
  /** False with no decision. A real path already held is answered from memory alone. */
  trusted(project: string): Promise<boolean>;
  /** Your one answer, on the trusted path. */
  answer(connection: Connection, project: string, trusted: boolean): Promise<void>;
}

const TRUSTED = 'trusted';
const realOf = (project: string): string => (existsSync(project) ? realpathSync(project) : resolve(project));
const keyOf = (real: string): string => createHash('sha256').update(`project trust\n${real}`).digest('hex');
/** The answers held for each record, by real path. */
const answers = new WeakMap<RecordStore, Map<string, boolean>>();

export async function openTrust(options: { record: RecordStore; now: () => number }): Promise<ProjectTrust> {
  const { record, now } = options;
  const held = answers.get(record) ?? new Map<string, boolean>();
  answers.set(record, held);
  return {
    async trusted(project) {
      // The host asks with the real path it resolved at load, so a hook resolves nothing.
      const known = held.get(project);
      if (known !== undefined) return known;
      const real = realOf(project);
      if (held.has(real)) return held.get(real)!;
      // The key is hex, so it is safe in the query's text.
      const rows = (await record.raw(`SELECT json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'decision.created' AND writer = 'core'
        AND json_extract(data, '$.key') = '${keyOf(real)}' ORDER BY log_pos DESC LIMIT 1`)) as { answer: string }[];
      // An answer given while the record was read is the newer one.
      if (!held.has(real)) held.set(real, rows[0]?.answer === TRUSTED);
      return held.get(real)!;
    },
    async answer(connection, project, trusted) {
      if (connection.writer !== 'app') throw Error(`project trust is set only by your answer on the trusted path, the app, not by ${connection.writer}`);
      const real = realOf(project);
      const key = keyOf(real);
      // The card you answered is the decision's ask.
      await record.append({ writer: 'core', actor: connection.actor, scope: connection.scope }, {
        v: 1, id: ulid(now()), kind: 'decision.created', ts: now(),
        data: { key, scope: `repo:${key.slice(0, 32)}`, answer: trusted ? TRUSTED : 'not trusted', ask: `ask:${ulid(now())}` },
      });
      held.set(real, trusted);
    },
  };
}
