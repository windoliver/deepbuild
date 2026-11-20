// AC7: Both reads appear in `tools/list` through `deep mcp` and are counted as read by the Claude Code and Codex
// facts; a facts file that counts either as change fails its conformance case.
//
// Both reads are modes of one tool, `deep_query` (`what: refs_to | cost`), so an agent calls them as
// `mcp__deep__deep_query` (README: Surface choices). The list is read through a Claude Code session's and a Codex
// session's own `deep mcp`, bound by their hooks to a real hub (#1725's world, #806's stand-ins, #26's client). The
// facts are read through the adapters' public entry: the hub's read list takes a tool its facts' `toolKinds.tools`
// list as read or search (hookmap.ts `toolClasses`), and the adapter maps the tool's PreToolUse to a `tool.before`
// whose `kind` the facts give. "Its conformance case" is the adapter@1 case the facts' `toolKinds.conformance`
// names, run by the conformance runner (`runKit`) on the shipped adapter's fill (#18's `shippedFill`) and on a fill
// whose facts are the planted ones.
import { afterEach, describe, expect, it } from 'vitest';
import { CLAUDE, CODEX, cleanup, openWorld, standOf, t26, type Line } from '../1725/helpers.ts';
import { factsAdapter, type Adapter, type HookRequestLine, type JsonObject } from '../../../packages/adapters/src/index.ts';
import { kits, runKit, shippedFill, type Fill, type Kit } from '../../../packages/conformance/src/index.ts';

afterEach(cleanup, 60_000);

const TOOL = 'mcp__deep__deep_query';
const AGENTS = [{ agent: 'claude', name: 'Claude Code' }, { agent: 'codex', name: 'Codex' }] as const;
const READ_KINDS = ['read', 'search'];
const brief = (v: unknown, n = 1200): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const typesOf = (node: unknown): string[] => {
  const type = isObj(node) ? node['type'] : undefined;
  return Array.isArray(type) ? type.map(String) : type === undefined ? [] : [String(type)];
};
const adapterKit = (): Kit => {
  const kit = kits().find((k) => k.name === 'adapter@1');
  expect(kit, 'the conformance package has the adapter@1 kit').toBeDefined();
  return kit!;
};

/** The kind the fill's adapter gives a PreToolUse of `tool`: its `tool.before` event's `data.kind`. */
function kindOf(fill: Fill, tool: string): unknown {
  const payload = { hook_event_name: 'PreToolUse', session_id: 'sess_1801', prompt_id: 'turn_1801', turn_id: 'turn_1801', cwd: '/tmp/dk1801', tool_name: tool, tool_input: { doc: '01JC1801D00000000000000001', what: 'refs_to', target: 'door' }, tool_use_id: 'toolu_1801' };
  const request: HookRequestLine = { v: 1, agent: (fill.adapter.facts as JsonObject)['agent'] as string, event: 'PreToolUse', seq: '1760013451123456789', id: '01K74FKZVK8Q2X5R7M3N9P4T18', pid: 81234, ppid: 81200, matched: [], payload };
  const before = fill.adapter.mapHook(request, fill.version, []).events.find((e) => e.kind === 'tool.before');
  return before?.data['kind'];
}

/**
 * The planted facts file (test code, README: Planted programs): the agent's shipped facts with deep_query counted as
 * `mcp`, which guards treat as change: its `toolKinds.tools` entry is `mcp`, and every prefix entry longer than
 * `mcp__` that its name starts with is gone. The fill is the shipped fill with an adapter mapping by those facts.
 */
function countedAsChange(agent: string): Fill {
  const fill = shippedFill(agent);
  const facts = structuredClone(fill.adapter.facts) as JsonObject;
  const kinds = facts['toolKinds'] as JsonObject;
  const prefixes = Object.fromEntries(Object.entries(isObj(kinds['prefixes']) ? kinds['prefixes'] : {}).filter(([p]) => p === 'mcp__' || !TOOL.startsWith(p)));
  facts['toolKinds'] = { ...kinds, tools: { ...(kinds['tools'] as JsonObject), [TOOL]: 'mcp' }, prefixes };
  const shipped = fill.adapter;
  const mapper = factsAdapter(facts, { caps: shipped.caps, unsupported: shipped.unsupported, doctor: () => shipped.doctor() });
  const adapter: Adapter = { ...shipped, facts, mapHook: mapper.mapHook };
  return { ...fill, adapter };
}

/** The case the facts' `toolKinds.conformance` names, as adapter@1's runner reports it on `fill`. */
function conformanceCase(fill: Fill, who: string): { id: string; outcome: string; message: string } {
  const id = ((fill.adapter.facts as JsonObject)['toolKinds'] as JsonObject)['conformance'];
  const report = runKit(adapterKit(), fill, { headless: true });
  const found = report.cases.find((c) => c.id === id);
  expect(found, `the ${who} facts' toolKinds.conformance names ${String(id)}, a case adapter@1 runs; it runs ${report.cases.map((c) => c.id).join(', ')}`).toBeDefined();
  return { id: String(id), outcome: found!.outcome, message: found!.message };
}

describe('AC7 refs_to and cost are reads an agent can list and that its facts count as read', () => {
  it('AC7 deep_query in tools/list through deep mcp takes what: refs_to and cost, with refs_to\'s target and cost\'s by, for a Claude Code and a Codex session', async () => {
    const w = await openWorld();
    for (const who of [CLAUDE, CODEX]) {
      const tools = await t26.listTools(standOf(w, who));
      const query = tools.find((t) => t.name === 'deep_query');
      expect(query, `the ${who.name} session's deep mcp lists deep_query (${tools.map((t) => t.name).join(', ')})`).toBeDefined();
      const props = (query!.inputSchema['properties'] ?? {}) as Record<string, Line>;
      const what = (props['what']?.['enum'] ?? []) as unknown[];
      for (const read of ['refs_to', 'cost']) expect(what, `the ${who.name} session's deep_query lists what: ${read} (its what takes ${brief(what)})`).toContain(read);
      expect(typesOf(props['target']), `deep_query takes refs_to's target, a string (${brief(props['target'])})`).toContain('string');
      const by = (props['by']?.['enum'] ?? []) as unknown[];
      for (const column of ['cpu_ms', 'gpu_ms', 'gpu_mb', 'decoded_mb']) expect(by, `deep_query takes cost's by: ${column} (${brief(props['by'])})`).toContain(column);
    }
  }, 600_000);

  it('AC7 the Claude Code and Codex facts count deep_query as a read, by the hub\'s read list and by the adapter\'s mapping, and each one\'s toolKinds conformance case passes', () => {
    for (const { agent, name } of AGENTS) {
      const fill = shippedFill(agent);
      const kinds = (fill.adapter.facts as JsonObject)['toolKinds'] as JsonObject;
      expect(READ_KINDS, `the ${name} facts list ${TOOL} in toolKinds.tools as a read, the list the hub's guards count reads by (it lists ${brief((kinds['tools'] as JsonObject)[TOOL])})`).toContain((kinds['tools'] as JsonObject)[TOOL]);
      expect(READ_KINDS, `the ${name} adapter maps a PreToolUse of ${TOOL} to a tool.before of kind read (it gives ${brief(kindOf(fill, TOOL))})`).toContain(kindOf(fill, TOOL));
      const c = conformanceCase(fill, name);
      expect(c.outcome, `the ${name} facts' conformance case ${c.id} passes on the shipped adapter: ${c.message}`).toBe('PASS');
    }
  });

  it('AC7 a facts file that counts deep_query as a change fails its conformance case, naming the tool', () => {
    for (const { agent, name } of AGENTS) {
      const fill = countedAsChange(agent);
      expect(READ_KINDS, `the planted ${name} facts count ${TOOL} as a change`).not.toContain(kindOf(fill, TOOL));
      const c = conformanceCase(fill, `planted ${name}`);
      expect(c.outcome, `the planted ${name} facts fail their conformance case ${c.id}: ${c.message}`).toBe('FAIL');
      expect(c.message, `the failure names ${TOOL}`).toContain(TOOL);
    }
  });
});
