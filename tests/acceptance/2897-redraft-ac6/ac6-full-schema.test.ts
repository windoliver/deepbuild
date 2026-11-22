// #2897 AC6, redrafted blind (README). To a client whose facts say it loads by search (Claude Code, as it names itself
// in initialize at the newest version its facts list), no DeepBuild server lists a tool with an empty schema, and the
// session's first deep_show with valid arguments runs. A planted server that lists #1105's one-line entries to that
// client fails the same check, naming schema_needed.
//
// "Empty schema" (README: Reading "empty schema"): a listed input schema that names none of the arguments the tool takes.
// What a tool takes is its full schema, the one its server lists at the merge base (base-tools.json). A tool that takes
// no arguments there (deep_status) is not "empty" for listing none; a tool the merge base doesn't list is empty when its
// schema neither names an argument nor closes itself to all (additionalProperties: false).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { argsFor, DOC, redBox, t26 } from '../1725/helpers.ts';
import { AC, Mcp, SERVERS, base, baseKey, claudeClient, converse, scratch, searchEntry, startSession, suite, type Obj, type Tool } from '../2897/helpers.ts';
import { claudeWorld, cleanup } from '../2897/world.ts';

afterEach(cleanup);

/** The merge base's full schema of a tool, by the key base-tools.json holds its server under. */
const fullSchema = (key: string, tool: string): Obj | undefined => base().servers[key]?.find((t) => t.name === tool)?.inputSchema;
const argumentsOf = (schema: unknown): string[] => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const props = (schema as Obj).properties;
  return props && typeof props === 'object' && !Array.isArray(props) ? Object.keys(props as Obj) : [];
};

/** One listed tool's schema, if it is empty: names none of the arguments the tool takes. */
function emptyListed(label: string, key: string, tool: Tool): string | undefined {
  const schema = tool.inputSchema;
  const shown = JSON.stringify(schema ?? null).slice(0, 120);
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return `${label}: ${tool.name} is listed with no input schema (${shown})`;
  if (argumentsOf(schema).length) return undefined;
  const full = fullSchema(key, tool.name);
  if (full) {
    const takes = argumentsOf(full);
    return takes.length ? `${label}: ${tool.name} is listed with an empty schema ${shown}; its full schema names ${takes.length} arguments (${takes.join(', ')})` : undefined;
  }
  return schema.additionalProperties === false ? undefined : `${label}: ${tool.name} is listed with an empty schema ${shown}, naming no argument and closed to none`;
}

/** The first deep_show's outcome: "runs" is answered, and refused neither as a call nor as a document. */
interface Show { refused: boolean; code: string | undefined; raw: string }
function showOf(outcome: t26.Outcome): Show {
  const value = outcome.value as Obj | null | undefined;
  const raw = JSON.stringify(outcome.reply);
  const code = typeof value?.code === 'string' ? value.code : /"code"\s*:\s*"([a-z_]+)"/.exec(typeof outcome.value === 'string' ? outcome.value : raw)?.[1];
  return { refused: outcome.isError || value?.outcome === 'refused', code, raw };
}

/** The criterion's check: every tool listed with an empty schema, and a first deep_show that didn't run, naming its code. */
function schemaNeededFailures(lists: ReadonlyArray<{ label: string; key: string; tools: readonly Tool[] | undefined }>, show: Show): string[] {
  const failures: string[] = [];
  for (const { label, key, tools } of lists) {
    if (!tools) { failures.push(`${label}: tools/list gave no tools`); continue; }
    for (const tool of tools) { const empty = emptyListed(label, key, tool); if (empty) failures.push(empty); }
  }
  if (show.refused) failures.push(`the first deep_show with valid arguments didn't run${show.code ? `: refused with ${show.code}` : ''}: ${show.raw.slice(0, 600)}`);
  return failures;
}

/** Valid arguments for deep_show: a red box on the world's document, sent as deep_show's full schema types them. */
const showArgs = (): Obj => argsFor({ doc: DOC.a, document: redBox(), include: ['issues'] }, fullSchema('deep', 'deep_show'));

/** The plant (the first suite's twins/one-line-server.mjs.txt) run through the check: what it names. */
async function plantFailures(): Promise<string[]> {
  const home = scratch();
  const file = join(home, 'one-line-server.mjs');
  writeFileSync(file, readFileSync(join(suite, 'twins/one-line-server.mjs.txt'), 'utf8').replaceAll('BASE_TOOLS', join(suite, 'base-tools.json')));
  const mcp = Mcp.script(file, 'planted one-line server', home);
  const session = await converse(mcp);
  // The first suite's Mcp.request answers { raw, message }; a server that dies or never answers throws BLOCKED, naming why.
  const { message } = await mcp.request('tools/call', { name: 'deep_show', arguments: showArgs() });
  return schemaNeededFailures([{ label: 'planted one-line server', key: 'deep', tools: session.tools }], showOf(t26.outcomeOf(message, 0)));
}

describe('#2897 AC6, to a client that loads by search: the full schema and a first deep_show that runs', () => {
  it(`${AC.fullSchema} no tool is listed to Claude Code with an empty schema, its first deep_show with valid arguments runs, and a planted one-line server fails naming schema_needed`, async () => {
    // Precondition: the check flags #1105's one-line entries listed to this client, naming schema_needed and the empty deep_show.
    const planted = await plantFailures();
    expect(planted.some((line) => line.includes('schema_needed')), `the check must name schema_needed on the planted one-line server: ${planted.join('\n')}`).toBe(true);
    expect(planted.some((line) => line.includes('deep_show is listed with an empty schema')), `the check must name the planted server's empty deep_show: ${planted.join('\n')}`).toBe(true);

    const failures: string[] = [];
    const client = claudeClient();
    const entry = searchEntry('claude-code', client.version);
    if (!entry) failures.push(`adapters/claude-code.facts.json has no entry, naming where it was read, that says Claude Code ${client.version} loads an MCP server's tools by search`);

    const lists: Array<{ label: string; key: string; tools: readonly Tool[] | undefined }> = [];
    for (const server of SERVERS) lists.push({ label: server.label, key: baseKey(server), tools: (await startSession(server)).tools });

    const w = await claudeWorld();
    lists.push({ label: 'deep (deep mcp, bound to a hub by its hooks)', key: 'deep', tools: w.tools });
    const sent = showArgs();
    await w.stand.stamp(w.hub, 'deep_show', sent);
    const show = showOf(await t26.callTool(w.stand, 'deep_show', sent));

    failures.push(...schemaNeededFailures(lists, show));
    expect(failures, `to Claude Code ${client.version}, a client that loads by search: ${failures.join('\n')}`).toEqual([]);
  }, 600_000);
});
