// #26.281a87e3 The tool list contains nothing that can answer, decide or overrule.
// #26.e335d28b Every tool is allowlisted, and none takes free-form shell input.
// #26.2d751e6d The skill and every tool description are generated from the Building blocks table, a test fails when
//   either drifts from it, and the skill names no tool parameter, which agents read from the tool's schema.
// Done when: the schemas pass strict validation (README: Strict).
// The live tool list is the one the agent's own deep mcp serves; the table and the allowlist are read from
// docs/technical-design.md as it stands, so an edit there that the skill or a description doesn't follow fails here.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  agentWorld, buildingBlocks, callTool, cleanup, Conn, deep, designTools, drift, events, listTools, pending, propertyNames, REQUIRED_TOOLS,
  rowsNaming, sampleArgs, SKILL, sleep, strictProblems, word, type Ev, type Line, type Tool, type World,
} from './helpers.ts';

afterAll(cleanup, 30_000);

let world: Promise<World & { tools: Tool[]; open: string; decided: string }> | undefined;
const setUp = () => (world ??= (async () => {
  let open = '';
  let decided = '';
  const w = await agentWorld({
    seeded: async (s, session, worktree) => {
      await s.start(session.id, worktree);
      open = await s.raise(session.id, 'taste', `Which border for ${word()}?`);
      await s.start('S0past', worktree);
      decided = await s.raise('S0past', 'choice', `Keep ${word()} on SQLite or plain files?`);
    },
  });
  const r = await deep(w.home, ['inbox', 'answer', decided, 'files']);
  if (r.code !== 0) throw Error(`BLOCKED: deep inbox answer ${decided} files exited ${r.code}: ${r.stdout}${r.stderr}`);
  return { ...w, tools: await listTools(w.agent), open, decided };
})());

const ANSWERING = /answer|approve|decide|decision|overrule|resolve|respond|reply|waive|grant/i;
/** Fields that would carry an answer, a decision or an overrule into a tool. */
const ANSWER_FIELDS = new Set(['answer', 'option', 'decision', 'overrule', 'approve', 'approval', 'verdict', 'waiver']);
const ANSWERED = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'decision.created', 'decision.applied', 'decision.overruled', 'decision.revoked']);

test('#26.281a87e3 the tool list holds nothing that can answer, decide or overrule, and no tool answers, decides or overrules whatever it is sent', async () => {
  const { tools, agent, hub, open, decided } = await setUp();
  const names = tools.map((t) => t.name);
  expect(names, 'the tool list holds the issue\'s tools').toEqual(expect.arrayContaining(REQUIRED_TOOLS));
  expect(names.filter((n) => ANSWERING.test(n)), 'no tool is named for answering, deciding or overruling').toEqual([]);
  for (const t of tools) {
    expect([...propertyNames(t.inputSchema)].filter((p) => ANSWER_FIELDS.has(p)), `${t.name} takes no field that carries an answer, a decision or an overrule`).toEqual([]);
  }
  const before = (await events(hub)).filter((e) => ANSWERED.has(e.kind)).map((e) => e.id);
  // Every tool, its every string the open ask's handle, then the decision's: whatever it does, nothing is answered.
  const calls = tools.flatMap((t) => [open, decided].map((handle) => pending(callTool(agent, t.name, sampleArgs(t.inputSchema, handle), 30_000))));
  await Promise.race([Promise.all(calls), sleep(5000)]);
  await sleep(500);
  const after = (await events(hub)).filter((e) => ANSWERED.has(e.kind) && !before.includes(e.id));
  expect(after.map((e: Ev) => `${e.kind} ${e.subject ?? ''} ${JSON.stringify(e.data).slice(0, 200)}`), `calling every tool (${names.join(', ')}) with ${open} and ${decided} answers, decides and overrules nothing`).toEqual([]);
}, 120_000);

const SHELLISH = new Set(['command', 'cmd', 'shell', 'script', 'argv', 'args', 'exec', 'bash', 'sh', 'program', 'run']);

test('#26.e335d28b every tool is one the design allowlists, an unlisted one is refused, and none takes free-form shell input', async () => {
  const { tools, agent, hub, tmp } = await setUp();
  const allowed = designTools();
  expect(tools.map((t) => t.name), 'the tool list holds the issue\'s tools').toEqual(expect.arrayContaining(REQUIRED_TOOLS));
  expect(tools.map((t) => t.name).filter((n) => !allowed.has(n)), `every listed tool is one the design's MCP tools row names (${[...allowed].join(', ')})`).toEqual([]);
  expect(new Set(tools.map((t) => t.name)).size, 'no tool is listed twice').toBe(tools.length);

  // An unlisted tool, through deep mcp and straight on the socket as the agent's deep mcp: refused, nothing recorded.
  const count = (await events(hub)).length;
  const fake = 'ask:01K74FKZVK8Q2X5R7M3N9P4T6W';
  for (const name of ['deep_shell', 'deep_answer', 'ask.answer']) {
    const o = await callTool(agent, name, { command: 'true', ask: fake, option: 'blue' });
    expect(o.isError, `tools/call of the unlisted ${name} is refused: ${JSON.stringify(o.reply).slice(0, 800)}`).toBe(true);
  }
  const { conn } = await Conn.open(hub.socket, { hello: 'mcp', parent: { pid: agent.pid, start: agent.start() } });
  const raw = await conn.call('mcp.call', { tool: 'deep_shell', arguments: { command: 'true', ask: fake } });
  conn.close();
  expect(raw.error, `mcp.call of the unlisted deep_shell on the hub's socket is refused: ${JSON.stringify(raw)}`).toBeDefined();
  const acted = (await events(hub)).slice(count).filter((e) => ANSWERED.has(e.kind) || ['claim.made', 'run.started', 'evidence.stored', 'open_item.opened'].includes(e.kind));
  expect(acted.map((e) => `${e.kind} ${e.id}`), 'the unlisted calls did nothing: no claim, answer, decision, run, evidence or open item').toEqual([]);

  // No free-form shell input: no field named for one, and a shell payload in every field runs nothing.
  for (const t of tools) expect([...propertyNames(t.inputSchema)].filter((p) => SHELLISH.has(p)), `${t.name} takes no shell command field`).toEqual([]);
  const marker = join(tmp, `ran-${word()}`);
  const payload = `$(touch ${marker}) ; touch ${marker} \`touch ${marker}\` | touch ${marker} && touch ${marker}`;
  const calls = tools.map((t) => pending(callTool(agent, t.name, sampleArgs(t.inputSchema, payload), 30_000)));
  await Promise.race([Promise.all(calls), sleep(5000)]);
  await sleep(1000);
  expect(existsSync(marker), `a shell payload in every field of every tool (${tools.map((t) => t.name).join(', ')}) ran nothing`).toBe(false);
}, 120_000);

test('#26.done-when every tool\'s published input schema passes strict validation', async () => {
  const { tools } = await setUp();
  // The validator itself fails each pattern a strict model API refuses.
  const planted: [string, Line][] = [
    ['anyOf', { type: 'object', properties: { a: { anyOf: [{ type: 'string' }, { type: 'integer' }] } }, required: ['a'], additionalProperties: false }],
    ['an open object', { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }],
    ['an optional field', { type: 'object', properties: { a: { type: 'string' } }, required: [], additionalProperties: false }],
    ['a map', { type: 'object', properties: {}, required: [], additionalProperties: { type: 'string' } }],
    ['$ref', { type: 'object', properties: { a: { $ref: '#/$defs/a' } }, required: ['a'], additionalProperties: false, $defs: { a: { type: 'string' } } }],
    ['a length', { type: 'object', properties: { a: { type: 'string', maxLength: 10 } }, required: ['a'], additionalProperties: false }],
    ['a format', { type: 'object', properties: { a: { type: 'string', format: 'ulid' } }, required: ['a'], additionalProperties: false }],
    ['a range', { type: 'object', properties: { a: { type: 'integer', minimum: 0 } }, required: ['a'], additionalProperties: false }],
    ['a root union', { anyOf: [{ type: 'object', properties: {}, required: [], additionalProperties: false }] }],
  ];
  for (const [what, schema] of planted) expect(strictProblems(what, schema).length, `the strict check refuses ${what}`).toBeGreaterThan(0);
  expect(strictProblems('clean', { type: 'object', properties: { a: { type: ['string', 'null'] }, b: { type: 'array', items: { type: 'string', enum: ['x', 'y'] } } }, required: ['a', 'b'], additionalProperties: false }), 'the strict check takes a clean schema').toEqual([]);

  expect(tools.map((t) => t.name), 'the tool list holds the issue\'s tools').toEqual(expect.arrayContaining(REQUIRED_TOOLS));
  expect(tools.flatMap((t) => strictProblems(t.name, t.inputSchema)), 'every tool\'s input schema is in the strict subset').toEqual([]);
}, 120_000);

test('#26.2d751e6d the skill and every tool description follow the Building blocks table, the skill names no parameter, and drift fails', async () => {
  const { tools } = await setUp();
  const rows = buildingBlocks();
  expect(rows.length, 'BLOCKED unless the Building blocks table reads').toBeGreaterThan(20);
  expect(tools.map((t) => t.name), 'the tool list holds the issue\'s tools').toEqual(expect.arrayContaining(REQUIRED_TOOLS));
  expect(existsSync(SKILL), `the skill is at ${SKILL}`).toBe(true);
  const skill = readFileSync(SKILL, 'utf8');
  expect(drift(rows, tools, skill), 'the skill and the tool descriptions match the Building blocks table and the live tool list').toEqual([]);

  // A test fails when either drifts: the same comparison against a table whose Never cells changed, and against a
  // skill that names a tool the list lacks, reports each.
  const changed = rows.map((r) => ({ ...r, never: `${r.never}, or anything drifted` }));
  const reported = drift(changed, tools, skill);
  for (const t of tools.filter((tool) => rowsNaming(rows, tool.name).length)) {
    expect(reported.some((line) => line.startsWith(`${t.name}:`)), `a drifted table is reported against ${t.name}'s description`).toBe(true);
  }
  expect(reported.some((line) => line.startsWith('the skill:')), 'a drifted table is reported against the skill').toBe(true);
  expect(drift(rows, tools, `${skill}\nUse deep_frobnicate to finish.\n`), 'a skill naming a tool the list lacks is reported').toContain('the skill: names deep_frobnicate, which the live tool list lacks');
}, 120_000);
