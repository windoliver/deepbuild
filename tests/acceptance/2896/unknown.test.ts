// #2896 AC6: a client that names itself as neither agent in `initialize` is held to the smallest limit any facts file holds, and
// `mcp.tools_listed` in the record says which limit applied (README: A client the facts don't know).
import { afterAll, describe, expect, it } from 'vitest';
import {
  CLAUDE, DOC, OTHER, PAGE_ROWS, PLANT, call, cleanup, client, draw, fmt, overCap, pageDocument, sizeReceived, t26, tryWorld,
  type HubWorld, type Line,
} from './helpers.ts';

const TEST_MS = 1_800_000;
/** The fields mcp.tools_listed@1 holds at the base; the limit that applied is a field beside them. */
const BASE_FIELDS = new Set(['server', 'scope', 'version', 'tools', 'held']);
/** The smallest limit any facts file holds is Codex's 10,000 tokens (8,000 with a fifth to spare): a field naming it says so. */
const NAMES_SMALLEST = /\b(10,?000|8,?000)\b|codex/i;

/** The unknown client's full page of deep_query's rows: why it passes the smallest limit, or null. */
async function unknownPage(w: HubWorld): Promise<{ failure: string | null; said: string }> {
  await draw(w, client(w, CLAUDE), DOC.page, pageDocument());
  const r = await call(w, client(w, OTHER), 'deep_query', { doc: DOC.page, what: 'rows', cap: PAGE_ROWS });
  const v = r.value as Line;
  if (r.isError || !Array.isArray(v?.rows)) return { failure: `deep_query's rows for ${OTHER.name} was refused: ${r.text.slice(0, 600)}`, said: '' };
  const s = sizeReceived(r);
  return { failure: overCap(OTHER, `deep_query's rows page (${v.rows.length} rows${typeof v.next === 'string' ? ', a full page' : ''})`, s), said: `${fmt(s.chars)} characters, ${fmt(s.tokens)} tokens` };
}

describe('#2896 AC6: a client the facts don\'t know', () => {
  afterAll(cleanup, 60_000);

  // AC6: "A client that names itself as neither agent is held to the smallest limit in any facts file, and `mcp.tools_listed` says
  // which limit applied. A planted `deep mcp` that gives an unknown client 64 KB fails, naming the client"
  it('AC6 #2896.012f2f9c a client that names itself as neither agent is held to the smallest limit in any facts file, and mcp.tools_listed says which limit applied', async () => {
    const opened = await tryWorld([CLAUDE, OTHER]);
    try {
      expect(opened.error, 'the world opened').toBe('');
      const w = opened.w!;
      const { failure, said } = await unknownPage(w);
      const session = client(w, OTHER).session;
      const listed = (await t26.events(w.hub)).filter((e) => e.kind === 'mcp.tools_listed');
      const about = listed.filter((e) => e.session === session || JSON.stringify(e.data).includes(OTHER.name));
      const naming = about.filter((e) => Object.entries(e.data ?? {}).some(([k, v]) => !BASE_FIELDS.has(k) && NAMES_SMALLEST.test(JSON.stringify(v))));
      console.log(`AC6 ${OTHER.name}'s full page: ${said}; mcp.tools_listed events: ${JSON.stringify(listed.map((e) => ({ session: e.session, data: { ...e.data, tools: `${(e.data?.tools as unknown[] | undefined)?.length ?? 0} tools` } }))).slice(0, 3000)}`);
      const failures = [
        ...(failure ? [failure] : []),
        ...(naming.length ? [] : [`the record holds no mcp.tools_listed for ${OTHER.name}'s session (${session}) that says which limit applied (a field beside ${[...BASE_FIELDS].join(', ')} naming the smallest limit, Codex's 10,000 tokens); it holds ${listed.length} mcp.tools_listed event(s), ${about.length} about that session or client`]),
      ];
      expect(failures, 'the unknown client\'s page fits the smallest limit, and the record says which limit applied').toEqual([]);
    } finally {
      await cleanup();
    }
  }, TEST_MS);

  it(`AC6 #2896.012f2f9c (wrong program ${PLANT.unknown64}) a planted deep mcp that gives an unknown client 64 KB fails, naming the client`, async () => {
    const planted = await tryWorld([CLAUDE, OTHER], PLANT.unknown64);
    try {
      expect(planted.error, `the hub and deep mcp run with DEEP_HUB_PLANT=${PLANT.unknown64}`).toBe('');
      const { failure } = await unknownPage(planted.w!);
      console.log(`AC6 ${PLANT.unknown64}: ${failure}`);
      expect(failure, 'the planted deep mcp\'s page fails the smallest limit').not.toBeNull();
      expect(failure!, 'the failure names the client').toContain(OTHER.name);
    } finally {
      await cleanup();
    }
  }, TEST_MS);
});
