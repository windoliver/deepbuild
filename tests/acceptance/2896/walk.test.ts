// #2896 AC3 and AC4: a 10,000-row walk of deep_query's rows, page by page by `next`, through `deep mcp` on a fixture hub, as a
// stand-in Codex client (it cuts past 10,000 tokens, keeping both ends) and a stand-in Claude Code client (it files a result over
// 50,000 characters or 25,000 tokens) receive it; and the walk's rows against the merge base's (README: The walk, The walk's rows).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLAUDE, CODEX, CODEX_PAGE_TOKENS, DOC, PLANT, WALK_ROWS, cleanup, client, draw, fmt, notWhole, openWorld, rowKey, tryWorld, walk, walkDocument, walkModel,
  type ClientSpec, type HubWorld, type Walk,
} from './helpers.ts';

const TEST_MS = 7_200_000;
const sha = (keys: readonly string[]): string => createHash('sha256').update(keys.join('\n')).digest('hex');
/** The merge base's walk, as this job recorded it at the base commit (README: The walk's rows). */
const BASE = JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures', 'base-walk.json'), 'utf8')) as { commit: string; rows: number; sha256: string };
const idOf = (key: string): string => String((JSON.parse(key) as unknown[])[0]);

/** Why `got` isn't the base's rows in its order (AC4), each naming a row; `prefix` judges a walk stopped early, up to where it stopped. */
function rowProblems(got: readonly string[], want: readonly string[], prefix = false): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const k of got) { if (seen.has(k)) problems.push(`row ${idOf(k)} comes twice`); seen.add(k); }
  const wanted = new Set(want);
  for (const k of got) if (!wanted.has(k)) problems.push(`row ${idOf(k)} (${k}) isn't a row of the base's walk`);
  if (!prefix) for (const k of want) if (!seen.has(k)) problems.push(`row ${idOf(k)} is missing`);
  const first = got.findIndex((k, i) => k !== want[i]);
  if (first >= 0) problems.push(`row ${first + 1} of the walk is ${idOf(got[first]!)}, where the base's is ${idOf(want[first]!)}${got.includes(want[first]!) ? '' : `: ${idOf(want[first]!)} is missing`}`);
  if (!prefix && got.length !== want.length) problems.push(`the walk returned ${fmt(got.length)} rows, the base's ${fmt(want.length)}`);
  return problems;
}
/** AC3's failures for one client's walk: every page whole, and every row returned. */
function wholeProblems(spec: ClientSpec, wk: Walk): string[] {
  const out = [...wk.problems.map((p) => `${spec.label}: ${p}`)];
  for (const p of wk.pages) { const why = notWhole(spec, p); if (why) out.push(why); }
  if (wk.rows.length !== WALK_ROWS) out.push(`the ${spec.label} walk returned ${fmt(wk.rows.length)} rows, not ${fmt(WALK_ROWS)}`);
  return out;
}

let w: HubWorld | undefined;
let error = '';
const walks = new Map<string, Walk>();

describe('#2896 AC3 and AC4: the 10,000-row walk', () => {
  beforeAll(async () => {
    try {
      w = await openWorld([CLAUDE, CODEX]);
      await draw(w, client(w, CLAUDE), DOC.walk, walkDocument());
      for (const spec of [CODEX, CLAUDE]) walks.set(spec.label, await walk(w, client(w, spec), DOC.walk));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await cleanup();
  }, TEST_MS);
  afterAll(cleanup, 60_000);

  // AC3: "A stand-in client that cuts as Codex does, keeping the two ends of 10,000 tokens, and one that files as Claude Code
  // does, receive every page of a 10,000-row walk whole: no page holds a cut marker or a path. A planted cap of 64 KB fails,
  // naming the first page that was cut"
  it('AC3 #2896.bd79ba6e the Codex stand-in and the Claude Code stand-in receive every page of the 10,000-row walk whole: no page holds a cut marker or a path', () => {
    expect(error, 'the world opened and both walks ran').toBe('');
    for (const [label, wk] of walks) console.log(`AC3 the ${label} walk: ${wk.pages.length} pages, ${fmt(wk.rows.length)} rows; pages as received: ${wk.pages.map((p) => `${p.n}: ${fmt(p.size.chars)} ch / ${fmt(p.size.tokens)} tok`).join('; ')}`);
    const failures = [CODEX, CLAUDE].flatMap((spec) => wholeProblems(spec, walks.get(spec.label)!));
    expect(failures, 'every page of both walks reaches its stand-in whole (each failure names the page)').toEqual([]);
  }, TEST_MS);

  it(`AC3 #2896.bd79ba6e (wrong program ${PLANT.cap64}) a planted cap of 64 KB fails the walk, naming the first page that was cut`, async () => {
    const planted = await tryWorld([CLAUDE, CODEX], PLANT.cap64);
    try {
      expect(planted.error, `the hub and deep mcp run with DEEP_HUB_PLANT=${PLANT.cap64}`).toBe('');
      await draw(planted.w!, client(planted.w!, CLAUDE), DOC.walk, walkDocument());
      const failures: string[] = [];
      for (const spec of [CODEX, CLAUDE]) {
        const wk = await walk(planted.w!, client(planted.w!, spec), DOC.walk, (p) => notWhole(spec, p) !== null);
        failures.push(...wholeProblems(spec, wk).filter((f) => f.startsWith('page ')).slice(0, 1));
      }
      console.log(`AC3 ${PLANT.cap64}: ${JSON.stringify(failures)}`);
      expect(failures.length, `under a 64 KB cap each stand-in's walk fails at its first cut page, naming it: ${JSON.stringify(failures)}`).toBe(2);
      for (const f of failures) expect(f, 'the failure names the page that was cut').toMatch(/^page \d+ of the walk reached the (Codex|Claude Code) stand-in (cut|as a path)/);
    } finally {
      await cleanup();
    }
  }, TEST_MS);

  // AC4: "The rows of that walk, read page by page under the Codex cap, equal the merge base's rows read under its cap: the same
  // rows in the same order, none twice and none missing. A planted pager that drops the row at a page's edge fails, naming the
  // row"
  it('AC4 #2896.1feb9185 the walk\'s rows, read page by page under the Codex cap, equal the merge base\'s rows read under its cap: the same rows in the same order, none twice and none missing', () => {
    expect(error, 'the world opened and both walks ran').toBe('');
    const model = walkModel();
    expect(sha(model), `the base's walk recorded at ${BASE.commit} (fixtures/base-walk.json) is the rows the walk's document gives, in their order`).toBe(BASE.sha256);
    expect(model.length).toBe(BASE.rows);
    const codex = walks.get(CODEX.label)!;
    const overCap = codex.pages.filter((p) => p.size.tokens > CODEX_PAGE_TOKENS).map((p) => `page ${p.n} of the Codex walk is ${fmt(p.size.tokens)} tokens, so it wasn't read under the Codex cap (${fmt(CODEX_PAGE_TOKENS)})`);
    const got = codex.rows.map(rowKey);
    const failures = [...codex.problems, ...overCap, ...rowProblems(got, model)];
    console.log(`AC4 the Codex walk: ${codex.pages.length} pages, ${fmt(got.length)} rows, sha256 ${sha(got)}; the base's: ${BASE.rows} rows, sha256 ${BASE.sha256}`);
    expect(failures, 'the walk under the Codex cap returns the base\'s rows, in its order (each failure names the page or the row)').toEqual([]);
  }, TEST_MS);

  it(`AC4 #2896.1feb9185 (wrong program ${PLANT.dropsEdgeRow}) a planted pager that drops the row at a page's edge fails, naming the row`, async () => {
    const planted = await tryWorld([CLAUDE, CODEX], PLANT.dropsEdgeRow);
    try {
      expect(planted.error, `the hub and deep mcp run with DEEP_HUB_PLANT=${PLANT.dropsEdgeRow}`).toBe('');
      await draw(planted.w!, client(planted.w!, CLAUDE), DOC.walk, walkDocument());
      const model = walkModel();
      const wk = await walk(planted.w!, client(planted.w!, CODEX), DOC.walk, (_p, rows) => rows.some((r, i) => rowKey(r) !== model[i]));
      const failures = [...wk.problems, ...rowProblems(wk.rows.map(rowKey), model, wk.pages.at(-1)?.next !== null)];
      console.log(`AC4 ${PLANT.dropsEdgeRow}: ${JSON.stringify(failures).slice(0, 2000)}`);
      const ids = new Set(model.map(idOf));
      expect(failures.some((f) => [...f.matchAll(/\bg\d{3}(?:\.c\d{3})?\b/g)].some((m) => ids.has(m[0]))),`the walk under the planted pager fails, naming a row: ${JSON.stringify(failures).slice(0, 2000)}`).toBe(true);
    } finally {
      await cleanup();
    }
  }, TEST_MS);
});
