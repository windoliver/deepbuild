// Watch-only holds (#2019): why a session's holds only watch, read from the record's holds.watch events by their
// cause, never from a reading's text, with the one fix for each cause. A session's row and its verdict line read
// them here, so both say the same.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { say } from './row-sentences.js';

type Query = (sql: string) => Promise<unknown[]>;

/** Whether `deep off` holds, as the hub's folder keeps it in gates.json: the server reads it for its holds, the core to record it. */
export function gatesOff(dir: string): boolean {
  try { return (JSON.parse(readFileSync(join(dir, 'gates.json'), 'utf8')) as { off?: unknown }).off === true; } catch { return false; }
}

export type WatchCause = 'off' | 'checks' | 'version' | 'hooks';
/** A cause in force for a session, with the event that set it. */
export interface Watch { cause: WatchCause; version: string | null; at: { kind: string; ts: number; log_pos: number } }

/** The order causes are named in when several hold: `deep off` first, as it covers every session. */
const ORDER: readonly WatchCause[] = ['off', 'version', 'hooks', 'checks'];

/**
 * What each cause says, and its fix: the version's and the hooks' are `deep doctor`'s own. `short` is why in a few
 * words, for the verdict line, which keeps its cause within the narrowest chat.
 */
export function watchWords(w: Watch, agent: string | null): { why: string; short: string; fix: string } {
  switch (w.cause) {
    case 'off': return { why: say('watch_off'), short: 'deep off', fix: say('watch_off_fix') };
    case 'version': return { why: agent === null ? (w.version ? say('watch_version_unnamed_at', w.version) : say('watch_version_unnamed')) : say('watch_version', w.version ? `${agent} ${w.version}` : agent), short: `${w.version ?? 'its version'} not in its facts`, fix: say('watch_version_fix') };
    case 'hooks': return { why: say('watch_hooks'), short: "hooks don't reach DeepBuild", fix: say('hook_entries_missing_fix') };
    case 'checks': return { why: say('watch_checks'), short: 'checks not approved', fix: say('watch_checks_fix') };
  }
}

/**
 * Each session's watch-only cause in force, of those `of` names (an SQL filter on `session_id`), and `deep off`'s for
 * every session: per cause the newest holds.watch says whether it holds (the core records a version read again at a
 * start, covered or not, as on or off); a later tool call a hook reported takes back hooks that didn't reach.
 */
export async function watched(query: Query, of: string): Promise<{ off?: Watch; sessions: Map<string, Watch> }> {
  const rows = (await query(`SELECT w.session_id, json_extract(w.data, '$.cause') AS cause, json_extract(w.data, '$.on') AS on_, json_extract(w.data, '$.version') AS version, w.ts, w.log_pos FROM events w WHERE w.kind = 'holds.watch' AND (w.session_id IS NULL OR (1 = 1${of}))
    AND NOT (json_extract(w.data, '$.cause') = 'hooks' AND EXISTS (SELECT 1 FROM events t WHERE t.session_id = w.session_id AND t.kind = 'tool.before' AND t.writer = 'hook' AND t.log_pos > w.log_pos))
    ORDER BY w.log_pos`)) as { session_id: string | null; cause: WatchCause; on_: number | boolean; version: string | null; ts: number; log_pos: number }[];
  const newest = new Map<string, Map<WatchCause, Watch | null>>();
  for (const r of rows) {
    const key = r.session_id ?? '';
    const causes = newest.get(key) ?? newest.set(key, new Map()).get(key)!;
    causes.set(r.cause, r.on_ === 1 || r.on_ === true ? { cause: r.cause, version: r.version, at: { kind: 'holds.watch', ts: r.ts, log_pos: r.log_pos } } : null);
  }
  const first = (causes: Map<WatchCause, Watch | null> | undefined): Watch | undefined => ORDER.map((c) => causes?.get(c)).find((w): w is Watch => !!w);
  const sessions = new Map<string, Watch>();
  for (const [session, causes] of newest) {
    const w = session ? first(causes) : undefined;
    if (w) sessions.set(session, w);
  }
  const off = first(newest.get(''));
  return { ...(off ? { off } : {}), sessions };
}
