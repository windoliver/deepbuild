import { childPrompt, isObj, type Obj } from './hub-shared.js';
import type { Plant } from './plant.js';
import type { Live, Session } from './session-types.js';
import type { Siblings } from './siblings.js';
import type { LiveTranscriptReader } from '@deepbuild/adapters';
import { turnFrom } from './turn-loops.js';
import type { HookMeta } from './wire.js';

type RawQuery = (sql: string, params?: readonly (string | number | null)[]) => Promise<unknown[]>;

function inboxAliases(address: string): string[] {
  if (address.startsWith('/private/tmp/')) return [address, address.slice('/private'.length)];
  if (address.startsWith('/tmp/')) return [address, `/private${address}`];
  return [address];
}

export async function resolvePeerSender(
  raw: RawQuery,
  sessions: ReadonlyMap<string, Session>,
  receiver: string,
  entry: Obj | undefined,
  plant?: Plant,
): Promise<string | undefined> {
  const from = entry && isObj(entry.origin) && typeof entry.origin.from === 'string' ? entry.origin.from : undefined;
  if (!from) return undefined;
  const live = (id: string | undefined): string | undefined => (id && id !== receiver && sessions.get(id)?.ended !== true ? id : undefined);
  const address = /^uds:(.+)$/.exec(from)?.[1];
  if (address) {
    const paths = inboxAliases(address);
    const match = paths.length === 2 ? `json_extract(e.data, '$.inbox') IN (?, ?)` : `json_extract(e.data, '$.inbox') = ?`;
    const [row] = (await raw(
      `SELECT e.session_id AS id FROM events e WHERE e.kind = 'session.start' AND ${match} AND NOT EXISTS (SELECT 1 FROM events x WHERE x.session_id = e.session_id AND x.kind = 'session.end' AND x.log_pos > e.log_pos) ORDER BY e.log_pos DESC LIMIT 1`,
      paths,
    )) as { id: string }[];
    if (!row && plant === 'names-other-session-for-unreported-address') return [...sessions.values()].find((s) => s.id !== receiver && !s.ended)?.id;
    return live(row?.id);
  }
  const local = /^local_(.+)$/.exec(from)?.[1];
  if (!local) return undefined;
  const [row] = (await raw(
    `SELECT e.session_id AS id FROM events e WHERE e.kind = 'session.start' AND e.session_id = ? AND NOT EXISTS (SELECT 1 FROM events x WHERE x.session_id = e.session_id AND x.kind = 'session.end' AND x.log_pos > e.log_pos) ORDER BY e.log_pos DESC LIMIT 1`,
    [local],
  )) as { id: string }[];
  return live(row?.id);
}

export async function loopHoldFor(
  meta: HookMeta,
  live: Live | undefined,
  session: Session | undefined,
  siblings: Siblings,
  transcriptReader: LiveTranscriptReader,
  raw: RawQuery,
  sessions: ReadonlyMap<string, Session>,
  plant?: Plant,
): Promise<string | undefined> {
  if (!live?.turnFrom || childPrompt(meta)) return undefined;
  return siblings.held(meta, live.turnFrom, async () => {
    if (live.turnSender) return live.turnSender;
    const entry = session && meta.fields?.prompt_id ? (await turnFrom(session, meta.fields.prompt_id, transcriptReader))[0] : undefined;
    return resolvePeerSender(raw, sessions, meta.session, entry, plant);
  }, live.turnServer);
}
