// #2897 AC6: "To a client whose facts say it loads by search, no tool is listed with an empty schema, and a `deep_show`
// with valid arguments runs on its first call. A planted server that lists one-line entries to that client fails, naming
// `schema_needed`"
//
// 1. The client: adapters/claude-code.facts.json says, for each version it lists, that Claude Code loads an MCP server's
//    tools by search, with where `instructions` are cut (4,096 characters), the mark it reads (anthropic/alwaysLoad) and
//    where that was read (README: Open questions 3).
// 2. A Claude Code session bound to a real hub by its hooks, its deep mcp initialized as Claude Code: no tool in its
//    tools/list has an empty schema (no properties), and its first deep_show, #1725's red box on the world's document,
//    runs: neither the call nor the document is refused.
// 3. The planted server (twins/one-line-server.mjs.txt): the same check on its list and its first deep_show must fail,
//    naming schema_needed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { AC, CUT, MARK, Mcp, converse, facts, schemaFailures, scratch, searchEntry, suite } from './helpers.ts';
import { claudeWorld, cleanup, firstShow } from './world.ts';
import { redBox } from '../1725/helpers.ts';

afterEach(cleanup, 60_000);

const holdsLeaf = (value: unknown, leaf: unknown): boolean =>
  Array.isArray(value) ? value.some((v) => holdsLeaf(v, leaf)) : value && typeof value === 'object' ? Object.values(value).some((v) => holdsLeaf(v, leaf)) : value === leaf;

test(`${AC.fullSchema} to Claude Code, whose facts say it loads by search, deep lists no tool with an empty schema and a deep_show with valid arguments runs on its first call; the same check fails a planted server that lists one-line entries, naming schema_needed`, { timeout: 600_000 }, async () => {
  const versions = facts('claude-code').versions as string[];
  const missing = versions.flatMap((version) => {
    const entry = searchEntry('claude-code', version);
    if (!entry) return [`${version}: no entry of adapters/claude-code.facts.json with its versions and a source says Claude Code loads an MCP server's tools by search`];
    return [...(holdsLeaf(entry.obj, CUT) ? [] : [`${version}: ${entry.path} doesn't name the ${CUT}-character cut of instructions`]), ...(holdsLeaf(entry.obj, MARK) ? [] : [`${version}: ${entry.path} doesn't name the mark ${MARK}`])];
  });
  expect(missing, 'Claude Code\'s facts say how it loads an MCP server\'s tools').toEqual([]);

  const w = await claudeWorld();
  expect(w.tools.length, 'the session\'s deep mcp lists its tools').toBeGreaterThan(0);
  expect(schemaFailures(w.tools, await firstShow(w)), 'deep\'s list to Claude Code and its first deep_show').toEqual([]);

  const home = scratch();
  const file = join(home, 'one-line-server.mjs');
  writeFileSync(file, readFileSync(join(suite, 'twins/one-line-server.mjs.txt'), 'utf8').replaceAll("'BASE_TOOLS'", JSON.stringify(join(suite, 'base-tools.json'))));
  const plantedServer = Mcp.script(file, 'the planted one-line server', home);
  const planted = await converse(plantedServer);
  const call = await plantedServer.request('tools/call', { name: 'deep_show', arguments: { doc: 'planted', document: redBox(), include: ['issues'] } });
  const result = call.message.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
  let value: unknown = null;
  try { value = JSON.parse(result?.content?.[0]?.text ?? 'null'); } catch { /* not JSON */ }
  const failures = schemaFailures(planted.tools ?? [], { isError: result?.isError === true, value, raw: call.raw });
  expect(failures.some((line) => line.includes('schema_needed')), `the planted server that lists one-line entries fails, naming schema_needed: ${failures.join(' | ') || 'it passed'}`).toBe(true);
});
