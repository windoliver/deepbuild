// A twin for #1156's proof lane (README: Wrong programs): project trust read from the record at every call, as the
// host on main was before #881. It replaces packages/record/src/trust.ts whole, its exports kept: on a padded record
// the project extension's deny misses the hook's deadline.
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid } from '@deepbuild/record/ids';
import type { Connection, RecordStore } from './index.js';

export interface ProjectTrust {
  /** False with no decision. */
  trusted(project: string): Promise<boolean>;
  /** Your one answer, on the trusted path. */
  answer(connection: Connection, project: string, trusted: boolean): Promise<void>;
}

const TRUSTED = 'trusted';
const keyOf = (project: string): string => createHash('sha256').update(`project trust\n${existsSync(project) ? realpathSync(project) : resolve(project)}`).digest('hex');

export async function openTrust(options: { record: RecordStore; now: () => number }): Promise<ProjectTrust> {
  const { record, now } = options;
  return {
    async trusted(project) {
      const rows = (await record.raw(`SELECT json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'decision.created' AND writer = 'core'
        AND json_extract(data, '$.key') = '${keyOf(project)}' ORDER BY log_pos DESC LIMIT 1`)) as { answer: string }[];
      return rows[0]?.answer === TRUSTED;
    },
    async answer(connection, project, trusted) {
      if (connection.writer !== 'app') throw Error(`project trust is set only by your answer on the trusted path, the app, not by ${connection.writer}`);
      const key = keyOf(project);
      await record.append({ writer: 'core', actor: connection.actor, scope: connection.scope }, {
        v: 1, id: ulid(now()), kind: 'decision.created', ts: now(),
        data: { key, scope: `repo:${key.slice(0, 32)}`, answer: trusted ? TRUSTED : 'not trusted', ask: `ask:${ulid(now())}` },
      });
    },
  };
}
