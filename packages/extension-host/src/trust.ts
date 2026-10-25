// Project trust (#348): one decision the core holds in the record, per project folder. Your answer comes through
// the trusted path (the app's card, connection writer `app`) and the core records it as a decision.created; every
// reader, the host's, the done gate's and spec drafting's, reads the latest one each time it asks, and none keeps a
// list of its own.
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';

export interface ProjectTrust {
  /** False with no decision. */
  trusted(project: string): Promise<boolean>;
  /** Your one answer, on the trusted path. */
  answer(connection: Connection, project: string, trusted: boolean): Promise<void>;
}

const TRUSTED = 'trusted';
const keyOf = (project: string): string => {
  const path = existsSync(project) ? realpathSync(project) : resolve(project);
  return createHash('sha256').update(`project trust\n${path}`).digest('hex');
};

export async function openTrust(options: { record: RecordStore; now: () => number }): Promise<ProjectTrust> {
  const { record, now } = options;
  return {
    async trusted(project) {
      // The key is hex, so it is safe in the query's text.
      const rows = (await record.raw(`SELECT json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'decision.created' AND writer = 'core'
        AND json_extract(data, '$.key') = '${keyOf(project)}' ORDER BY log_pos DESC LIMIT 1`)) as { answer: string }[];
      return rows[0]?.answer === TRUSTED;
    },
    async answer(connection, project, trusted) {
      if (connection.writer !== 'app') throw Error(`project trust is set only by your answer on the trusted path, the app, not by ${connection.writer}`);
      const key = keyOf(project);
      // The card you answered is the decision's ask.
      await record.append({ writer: 'core', actor: connection.actor, scope: connection.scope }, {
        v: 1, id: ulid(now()), kind: 'decision.created', ts: now(),
        data: { key, scope: `repo:${key.slice(0, 32)}`, answer: trusted ? TRUSTED : 'not trusted', ask: `ask:${ulid(now())}` },
      });
    },
  };
}
