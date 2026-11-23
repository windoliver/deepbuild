// #2896 AC2: every reply that pages, filled to a page by a fixture, as a stand-in Codex client and a stand-in Claude Code client
// receive it through `deep mcp` on a fixture hub: Codex at most 8,000 tokens; Claude Code at most 40,000 characters and 20,000
// tokens (README: The paging replies and their fixtures).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLAUDE, CODEX, DOC, PAGE_ROWS, REFS_TARGET, boundsDocument, call, cleanup, client, draw, fmt, openWorld, overCap, pageDocument, sizeReceived,
  type ClientSpec, type HubWorld, type Line, type Received,
} from './helpers.ts';

const TEST_MS = 3_600_000;
/** Each paging reply, the call that fills its page, and whether a full page carries `next` (the sheet is one page by design). */
const READS: { what: string; tool: string; args: Line; pages: boolean }[] = [
  { what: "deep_query's rows", tool: 'deep_query', args: { doc: DOC.page, what: 'rows', cap: PAGE_ROWS }, pages: true },
  { what: "deep_query's refs_to", tool: 'deep_query', args: { doc: DOC.page, what: 'refs_to', target: REFS_TARGET, cap: PAGE_ROWS }, pages: true },
  { what: "deep_kinds' list", tool: 'deep_kinds', args: { op: 'list' }, pages: true },
  { what: "deep_kinds' search", tool: 'deep_kinds', args: { op: 'search', query: 'a' }, pages: true },
  { what: "deep_kinds' sheet", tool: 'deep_kinds', args: { op: 'sheet' }, pages: false },
  { what: "deep_show's bounds mode readings", tool: 'deep_show', args: { doc: DOC.bounds, mode: 'bounds' }, pages: true },
];
/** The search words whose hits name the installed guides. */
const GUIDE_QUERIES = ['a', 'e', 'guide'];

interface Read { what: string; spec: ClientSpec; r: Received; filled: boolean }
let w: HubWorld | undefined;
let error = '';
const reads: Read[] = [];
const problems: string[] = [];

/** The guides' names, from every page of the search hits for each of GUIDE_QUERIES. */
async function guideNames(world: HubWorld): Promise<string[]> {
  const names = new Set<string>();
  for (const query of GUIDE_QUERIES) {
    let cursor: string | null = null;
    for (let n = 0; n < 50; n++) {
      const r = await call(world, client(world, CLAUDE), 'deep_kinds', { op: 'search', query, cursor });
      const v = r.value as Line;
      for (const h of Array.isArray(v?.hits) ? (v.hits as Line[]) : []) if (h.kind === 'guide' && typeof h.name === 'string') names.add(h.name);
      if (typeof v?.next !== 'string') break;
      cursor = v.next;
    }
  }
  return [...names].sort();
}

describe('#2896 AC2: each paging reply\'s full page as each client receives it', () => {
  beforeAll(async () => {
    try {
      w = await openWorld([CLAUDE, CODEX]);
      await draw(w, client(w, CLAUDE), DOC.page, pageDocument());
      await draw(w, client(w, CLAUDE), DOC.bounds, boundsDocument());
      for (const spec of [CODEX, CLAUDE]) {
        for (const read of READS) {
          const r = await call(w, client(w, spec), read.tool, read.args);
          const v = r.value as Line;
          if (r.isError || typeof v !== 'object' || v === null) { problems.push(`${read.what} for ${spec.name} was refused: ${r.text.slice(0, 600)}`); continue; }
          const filled = typeof v.next === 'string' || typeof v.next === 'number';
          if (read.pages && !filled) problems.push(`the fixture didn't fill a page of ${read.what} for ${spec.name}: the reply carries no next (${fmt(sizeReceived(r).chars)} characters)`);
          reads.push({ what: read.what, spec, r, filled });
        }
        // A guide's page: every page of every installed guide (README: no fixture fills a guide's page through the hub).
        for (const guide of await guideNames(w)) {
          let offset: number | null = null;
          for (let n = 1; n <= 50; n++) {
            const r = await call(w, client(w, spec), 'deep_kinds', { op: 'read', guide, offset });
            const v = r.value as Line;
            if (r.isError || typeof v?.text !== 'string') { problems.push(`deep_kinds' read of the guide ${guide} for ${spec.name} was refused: ${r.text.slice(0, 600)}`); break; }
            reads.push({ what: `deep_kinds' read of the guide ${guide}, page ${n}`, spec, r, filled: v.truncated === true });
            if (typeof v.next !== 'number') break;
            offset = v.next;
          }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }, TEST_MS);
  afterAll(cleanup, 60_000);

  // AC2: "For each reply that pages, `deep_query`'s rows and `refs_to`, `deep_kinds`' list, search, sheet and a guide's page, and a
  // `deep_show` mode's readings among them, a fixture fills a page. As a stand-in Codex client receives it, the page is at most
  // 8,000 tokens (drafted: a fifth under 10,000). As a stand-in Claude Code client receives it, it is at most 40,000 characters
  // and 20,000 tokens (drafted). On the merge base `deep_query`'s full page is over 50,000 characters, and this test fails, naming
  // the tool and both counts"
  it('AC2 #2896.4f78f2ef every paging reply\'s full page is at most 8,000 tokens as the Codex stand-in receives it, and at most 40,000 characters and 20,000 tokens as the Claude Code stand-in does', () => {
    expect(error, 'the world opened and every read ran').toBe('');
    const table = reads.map((x) => { const s = sizeReceived(x.r); return `${x.spec.label} ${x.what}: ${fmt(s.chars)} characters, ${fmt(s.tokens)} tokens${x.filled ? ', a full page' : ''}`; });
    console.log(`AC2 each page as its client receives it:\n${table.join('\n')}`);
    const over = reads.map((x) => overCap(x.spec, x.what, sizeReceived(x.r))).filter((f): f is string => f !== null);
    expect([...problems, ...over], 'each paging reply\'s full page fits its client\'s drafted cap (each failure names the reply and both counts)').toEqual([]);
  }, TEST_MS);
});
