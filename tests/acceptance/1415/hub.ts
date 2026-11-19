// Test-side tools for the #1415 acceptance tests through the hub (README): a real hub (`deep hub run`) with #806's world file, a
// Claude Code stand-in bound by its hooks and a `deep mcp` bound to no session (#806's and #26's), and the walk over every
// published canvas tool's schema (AC5, AC9). Nothing here stands in for the hub, `deep mcp` or the canvas core. Processes are
// stopped by PID (#806's cleanup).

import { join } from 'node:path';
import { CLAUDE, sessionId } from '../806/figure.ts';
import { Stand, World, makeHome, startHub, t26, t393, type Line } from '../806/helpers.ts';

/** The canvas's agent-facing tools (design: Building blocks, the Canvas and Screen and panel rows; deep_job for jobs). */
export const CANVAS_TOOLS = ['deep_show', 'deep_query', 'deep_kinds', 'deep_job'] as const;
/** The document the session draws and the walk's deep_show and deep_query read (#393's DOC.a, minted on the main panel). */
export const DOC = t393.DOC.a;
/** A missing_field refusal carries its tool's schema in under this many bytes (AC5). */
export const SCHEMA_BYTES = 4096;

export interface HubWorld { home: string; hub: t26.Hub; stand: Stand; unbound: t26.McpProcess }

/** A hub with the world file (#806), the Claude Code session established by its hooks, and a `deep mcp` bound to no session. */
export async function openWorld(plant?: string): Promise<HubWorld> {
  const { tmp, home } = makeHome();
  const world = new World(join(tmp, 'world.json'), { names: { [sessionId(CLAUDE)]: CLAUDE.name }, panels: t393.PANELS, docs: { [DOC]: { panel: 'main' } } });
  const work = t26.makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home, { world: world.path, plant });
  const stand = Stand.start(home, work.path, CLAUDE.kind, sessionId(CLAUDE));
  await stand.establish(hub);
  await t26.initialize(stand);
  const unbound = t26.McpProcess.start(home, work.path);
  await t26.initialize(unbound);
  return { home, hub, stand, unbound };
}

const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const brief = (v: unknown, n = 500): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
/** A field's types as its schema lists them. */
const typesOf = (s: unknown): string[] => (isObj(s) ? (Array.isArray(s.type) ? (s.type as unknown[]).map(String) : s.type === undefined ? [] : [String(s.type)]) : []);

/** One call of the walk: its tool, what it varies, the field it leaves out, and its outcome. */
export interface Called { tool: string; what: 'default' | 'without_optional' | 'without_required' | 'unbound'; field: string | null; o: t26.Outcome }
export interface Walked { listed: Map<string, Line>; calls: Called[]; problems: string[] }

/** The arguments with every field at its default (null for an optional one) and each required one given (README: The walk). */
function defaults(tool: string, schema: Line): { args: Line; required: string[]; optional: string[]; problems: string[] } {
  const args: Line = {};
  const required: string[] = [];
  const optional: string[] = [];
  const problems: string[] = [];
  for (const [key, field] of Object.entries(isObj(schema.properties) ? schema.properties : {})) {
    if (typesOf(field).includes('null')) { optional.push(key); args[key] = null; continue; }
    required.push(key);
    const listed = isObj(field) && Array.isArray(field.enum) ? (field.enum as unknown[]).filter((v) => v !== null) : [];
    if (key === 'doc') args[key] = DOC;
    else if (listed.length) args[key] = listed[0];
    else problems.push(`the walk has no value to give ${tool}'s required field ${key}`);
  }
  return { args, required, optional, problems };
}
const without = (args: Line, key: string): Line => Object.fromEntries(Object.entries(args).filter(([k]) => k !== key));

/**
 * The walk through the hub (README: The walk through deep mcp): the session draws #393's small board on DOC; then, for each
 * canvas tool its deep mcp lists, the call with every field at its default, with each optional field left out and with each
 * required field left out, from the bound session, and the default call from the deep mcp bound to no session.
 */
export async function walkTools(w: HubWorld): Promise<Walked> {
  const listed = new Map((await t26.listTools(w.stand)).map((t) => [t.name, t.inputSchema] as const));
  const drawn = await t26.callTool(w.stand, 'deep_show', { doc: DOC, document: JSON.stringify(t393.SMALL), include: ['issues'] });
  if (drawn.isError || !isObj(drawn.value) || drawn.value.outcome !== 'presented') throw Error(`BLOCKED: the session's deep_show of #393's small board on ${DOC} wasn't presented: ${brief(drawn.reply, 1200)}`);
  const calls: Called[] = [];
  const problems: string[] = [];
  for (const tool of CANVAS_TOOLS) {
    const schema = listed.get(tool);
    if (!schema) { problems.push(`deep mcp doesn't list ${tool}, a canvas tool`); continue; }
    const d = defaults(tool, schema);
    problems.push(...d.problems);
    calls.push({ tool, what: 'default', field: null, o: await t26.callTool(w.stand, tool, d.args) });
    for (const key of d.optional) calls.push({ tool, what: 'without_optional', field: key, o: await t26.callTool(w.stand, tool, without(d.args, key)) });
    for (const key of d.required) calls.push({ tool, what: 'without_required', field: key, o: await t26.callTool(w.stand, tool, without(d.args, key)) });
    calls.push({ tool, what: 'unbound', field: null, o: await t26.callTool(w.unbound, tool, d.args) });
  }
  return { listed, calls, problems };
}

/** Why a call didn't act (README: What acting means through deep mcp), or null when it did. */
function notActed(tool: string, o: t26.Outcome): string | null {
  if (o.protocolError) return `a JSON-RPC error: ${brief(o.reply)}`;
  if (o.isError) return `it was refused: ${brief(o.value)}`;
  const v = isObj(o.value) ? o.value : {};
  switch (tool) {
    case 'deep_show': return v.outcome === 'presented' ? null : `deep_show didn't present the document's current revision: ${brief(v)}`;
    case 'deep_query': return Array.isArray(v.rows) && v.rows.length > 0 ? null : `deep_query gave no rows: ${brief(v)}`;
    case 'deep_kinds': return Array.isArray(v.registries) ? null : `deep_kinds gave no listing: ${brief(v)}`;
    case 'deep_job': return Array.isArray(v.kinds) ? null : `deep_job gave no list of kinds: ${brief(v)}`;
    default: return `the walk doesn't know ${tool}`;
  }
}

/** AC5's failures: each names the tool and the field. */
export function schemaFailures(walked: Walked): string[] {
  const failures = [...walked.problems];
  for (const c of walked.calls) {
    if (c.what === 'default') {
      const why = notActed(c.tool, c.o);
      if (why) failures.push(`${c.tool}: the call with every field at its default doesn't act: ${why}`);
    } else if (c.what === 'without_optional') {
      const why = notActed(c.tool, c.o);
      if (why) failures.push(`${c.tool}: the call with its optional field ${c.field} left out doesn't act: ${why}`);
    } else if (c.what === 'without_required') {
      const v = isObj(c.o.value) ? c.o.value : {};
      const at = `/params/arguments/${String(c.field)}`;
      if (v.code !== 'missing_field') failures.push(`${c.tool}: the call with its required field ${c.field} left out isn't refused with missing_field: ${brief(c.o.value)}`);
      if (v.path !== at) failures.push(`${c.tool}: the refusal for its missing field ${c.field} doesn't name it at ${at}: ${brief(c.o.value)}`);
      const carried = v.schema;
      const published = walked.listed.get(c.tool);
      const keys = (s: unknown): string[] => (isObj(s) && isObj(s.properties) ? Object.keys(s.properties).sort() : []);
      if (!isObj(carried)) failures.push(`${c.tool}: the refusal for its missing field ${c.field} carries no schema: ${brief(c.o.value)}`);
      else {
        const bytes = Buffer.byteLength(JSON.stringify(carried), 'utf8');
        if (bytes >= SCHEMA_BYTES) failures.push(`${c.tool}: the schema the missing_field refusal carries is ${bytes} bytes, not under ${SCHEMA_BYTES}`);
        if (keys(carried).join(',') !== keys(published).join(',')) failures.push(`${c.tool}: the schema the missing_field refusal carries isn't ${c.tool}'s alone: its fields are [${keys(carried).join(', ')}], the published schema's [${keys(published).join(', ')}]`);
      }
    }
  }
  return failures;
}

/** A value that refuses: an outcome refused, or a code of its own (error@2's, or the canvas core's). */
const refusalCode = (value: unknown): string | null => (isObj(value) && (value.outcome === 'refused' || typeof value.code === 'string') ? String(value.code ?? 'refused') : null);

/** AC9's failures: each names the tool. */
export function flagFailures(walked: Walked): string[] {
  const failures = [...walked.problems];
  for (const c of walked.calls) {
    const what = c.field ? `${c.what} ${c.field}` : c.what;
    if (c.o.protocolError) { failures.push(`${c.tool} (${what}): answered with a JSON-RPC error, not a tool result with its error flag: ${brief(c.o.reply)}`); continue; }
    const code = refusalCode(c.o.value);
    if (code !== null && !c.o.isError) failures.push(`${c.tool} (${what}): refused with ${code} as ordinary text, its error flag (isError) unset: ${brief(c.o.reply)}`);
  }
  // The walk holds the canvas core's own refusals: deep_show and deep_query bound to no session are refused.
  for (const tool of ['deep_show', 'deep_query']) {
    const c = walked.calls.find((x) => x.tool === tool && x.what === 'unbound');
    if (c && refusalCode(c.o.value) === null && !c.o.isError) failures.push(`${tool} (unbound): a call bound to no session isn't refused: ${brief(c.o.value)}`);
  }
  return failures;
}
