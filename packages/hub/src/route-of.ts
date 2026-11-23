// The route a session's adapter read at its starts (#1886), as each session.start keeps it.
import type { SessionRoute } from '@deepbuild/adapters';

/**
 * Any start's proxied key holds for the session, since its transcript may name a model from that start; null where it
 * has no start or one recorded no route, so its model reads as unknown.
 */
export async function routeOf(record: { raw(query: string, params?: readonly (string | number | null)[]): Promise<unknown[]> }, session: string | null): Promise<SessionRoute | null> {
  if (!session) return null;
  const rows = (await record.raw(`SELECT json_extract(data, '$.route') AS route FROM events WHERE session_id = ? AND kind = 'session.start' ORDER BY log_pos`, [session])) as { route: string | null }[];
  if (!rows.length) return null;
  const route: SessionRoute = {};
  for (const row of rows) {
    const read: unknown = row.route ? JSON.parse(row.route) : undefined;
    if (typeof read !== 'object' || read === null) return null;
    for (const [key, set] of Object.entries(read)) if (typeof set === 'boolean') route[key] = route[key] === true || set;
  }
  return route;
}
