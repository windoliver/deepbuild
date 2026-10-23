// Regressions for event kinds whose schemas read the design looser, or other, than it says.
import { describe, expect, it } from 'vitest';
import { buildCatalogue, catalogue, catalogueDrift, checkViewBindings, fixtures, getSchema, listSchemas, validate } from '../src/index.js';

type Event = Record<string, unknown> & { data: Record<string, unknown> };
const first = (name: string): Event => structuredClone(fixtures(name)[0]) as Event;
const ok = (name: string, event: unknown) => validate(name, event).ok;

describe('the design says', () => {
  it('only the core appends the kinds that record a decision', () => {
    for (const kind of ['verdict.made', 'verdict.stale', 'definition.locked', 'definition.revised', 'decision.created', 'decision.applied', 'ask.answered', 'ask.defaulted']) {
      const name = `${kind}@1`;
      expect(ok(name, first(name)), kind).toBe(true);
      for (const writer of ['hook', 'app', 'ext:planted']) expect(ok(name, { ...first(name), writer }), `${kind} by ${writer}`).toBe(false);
    }
  });

  it('an unblock adds its steps, where, why, unblocks and proves, and no other ask has them', () => {
    const asks = fixtures('ask.created@1') as Event[];
    const unblock = asks.find((a) => a.data.kind === 'unblock')!;
    const other = asks.find((a) => a.data.kind !== 'unblock')!;
    expect(ok('ask.created@1', unblock)).toBe(true);
    for (const field of ['steps', 'where', 'why', 'unblocks', 'proves']) {
      const { [field]: value, ...without } = unblock.data;
      expect(ok('ask.created@1', { ...unblock, data: without }), `an unblock without ${field}`).toBe(false);
      expect(ok('ask.created@1', { ...other, data: { ...other.data, [field]: value } }), `a ${String(other.data.kind)} ask with ${field}`).toBe(false);
    }
  });

  it('an ask is pinned to a commit, or an evidence hash, in its form', () => {
    const ask = first('ask.created@1');
    expect(ok('ask.created@1', { ...ask, data: { ...ask.data, pinned_to: { kind: 'commit', ref: 'x' } } })).toBe(false);
    expect(ok('ask.created@1', { ...ask, data: { ...ask.data, pinned_to: { kind: 'evidence', ref: 'not-a-hash' } } })).toBe(false);
  });

  it('an event whose data names no ask, task or session says which one in its subject', () => {
    for (const kind of ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.later', 'task.closed', 'agent.stop', 'session.attention']) {
      const name = `${kind}@1`;
      const { subject: _subject, ...without } = first(name);
      expect(ok(name, first(name)), kind).toBe(true);
      expect(ok(name, without), `${kind} without subject`).toBe(false);
    }
  });

  it("a learned change's layer, scope and replay take the design's example", () => {
    const learn = first('learn.proposed@1');
    const example = { ...learn.data, layer: 'learned', scope: 'session:01J9ABC', replay: { tasks: 20, regressions: 0 }, applied_by: 'you' };
    expect(ok('learn.proposed@1', { ...learn, data: example })).toBe(true);
    expect(ok('learn.proposed@1', { ...learn, data: { ...example, layer: 'rules' } })).toBe(false);
    expect(ok('learn.proposed@1', { ...learn, data: { ...example, applied_by: 'agent' } })).toBe(false);
    expect(ok('learn.proposed@1', { ...learn, data: { ...example, scope: 'everywhere' } })).toBe(false);
    for (const replay of [{ tasks: 20 }, { regressions: 0 }, 'twenty']) expect(ok('learn.proposed@1', { ...learn, data: { ...example, replay } }), JSON.stringify(replay)).toBe(false);
  });

  it('a lease names its resource by host, kind and key', () => {
    const lease = first('lease.acquired@1');
    expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, resource: { host: 'local', kind: 'port', key: '4317' } } })).toBe(true);
    expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, resource: 'port:4317' } })).toBe(false);
    for (const field of ['host', 'kind', 'key']) {
      const { [field]: _dropped, ...resource }: Record<string, string> = { host: 'local', kind: 'port', key: '4317' };
      expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, resource } }), `a resource without ${field}`).toBe(false);
    }
  });

  it("a task's task_ref may be the message that asked for it", () => {
    const task = first('task.created@1');
    expect(ok('task.created@1', { ...task, data: { ...task.data, task_ref: 'session:01K74G1Z3X5V7T9R1P3N5M7K9H#msg3' } })).toBe(true);
    for (const task_ref of ['session:01K74G1Z3X5V7T9R1P3N5M7K9H', 'verdict:01K74G4B6D8F0H2K4M6P8R0T2V']) expect(ok('task.created@1', { ...task, data: { ...task.data, task_ref } }), task_ref).toBe(false);
  });

  it("evidence carries its source and origin, and a verdict its reasons", () => {
    const evidence = first('evidence.put@1');
    for (const field of ['source', 'origin']) {
      const { [field]: _dropped, ...without } = evidence.data;
      expect(ok('evidence.put@1', { ...evidence, data: without }), `without ${field}`).toBe(false);
    }
    for (const origin of ['deepbuild', 'you', 'agent']) expect(ok('evidence.put@1', { ...evidence, data: { ...evidence.data, origin } }), origin).toBe(true);
    expect(ok('evidence.put@1', { ...evidence, data: { ...evidence.data, origin: 'model' } })).toBe(false);
    const { reasons: _reasons, ...noReasons } = first('verdict.made@1').data;
    expect(ok('verdict.made@1', first('verdict.made@1'))).toBe(true);
    expect(ok('verdict.made@1', { ...first('verdict.made@1'), data: noReasons })).toBe(false);
  });

  it('a time in flicks fits an i64', () => {
    const note = first('note.opened@1');
    for (const t of ['9223372036854775807', '-9223372036854775807', '-9223372036854775808']) expect(ok('note.opened@1', { ...note, data: { ...note.data, t } }), t).toBe(true);
    for (const t of ['9223372036854775808', '9999999999999999999', '-9999999999999999999']) expect(ok('note.opened@1', { ...note, data: { ...note.data, t } }), t).toBe(false);
  });

  it("a note's region is a rectangle of the frame", () => {
    const note = first('note.opened@1');
    expect(ok('note.opened@1', { ...note, data: { ...note.data, region: { x: 0, y: 0, w: 10, h: 10 } } })).toBe(true);
    expect(ok('note.opened@1', { ...note, data: { ...note.data, region: 'top left' } })).toBe(false);
    for (const field of ['x', 'y', 'w', 'h']) {
      const { [field]: _dropped, ...region }: Record<string, number> = { x: 0, y: 0, w: 10, h: 10 };
      expect(ok('note.opened@1', { ...note, data: { ...note.data, region } }), `a region without ${field}`).toBe(false);
    }
  });

  it('a task asked for by a message closes by that same handle', () => {
    expect(ok('task.closed@1', { ...first('task.closed@1'), subject: 'session:01K74G1Z3X5V7T9R1P3N5M7K9H#msg3' })).toBe(true);
    expect(ok('task.closed@1', { ...first('task.closed@1'), subject: 'verdict:01K74G4B6D8F0H2K4M6P8R0T2V' })).toBe(false);
  });

  it("a decision's scope is the learned layer's ladder, written the same way", () => {
    const decision = first('decision.created@1');
    for (const scope of ['session:01J9ABC', 'repo:shop', 'all']) expect(ok('decision.created@1', { ...decision, data: { ...decision.data, scope } }), scope).toBe(true);
    expect(ok('decision.created@1', { ...decision, data: { ...decision.data, scope: 'all_repos' } })).toBe(false);
  });

  it("a lease's holder is a session, or a document prefix's writer", () => {
    const lease = first('lease.acquired@1');
    for (const holder of ['session:01K74G1Z3X5V7T9R1P3N5M7K9H', 'ext:shop', 'mcp:01K74G1Z3X5V7T9R1P3N5M7K9H']) {
      expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, holder } }), holder).toBe(true);
    }
    expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, holder: 'verdict:01K74G4B6D8F0H2K4M6P8R0T2V' } })).toBe(false);
  });

  it("a prompt links to a task by any task_ref, as every other kind does", () => {
    const ask = first('user.ask@1');
    expect(ok('user.ask@1', { ...ask, data: { ...ask.data, tasks: ['session:01K74G1Z3X5V7T9R1P3N5M7K9H#m214'] } })).toBe(true);
    expect(ok('user.ask@1', { ...ask, data: { ...ask.data, tasks: ['verdict:01K74G4B6D8F0H2K4M6P8R0T2V'] } })).toBe(false);
  });

  it("a patch is named by its ULID, and says what it achieved in counts", () => {
    const patched = first('doc.patched@1');
    const achieved = { created: { 'rect@1': 1 }, updated: 0, deleted: {}, unchanged: false };
    expect(ok('doc.patched@1', { ...patched, data: { ...patched.data, patch: '01K74G3A5C7E9G1J3M5P7R9T1V', achieved } })).toBe(true);
    expect(ok('doc.patched@1', { ...patched, data: { ...patched.data, achieved: true } })).toBe(false);
    for (const field of ['created', 'updated', 'deleted', 'unchanged']) {
      const { [field]: _dropped, ...partial }: Record<string, unknown> = achieved;
      expect(ok('doc.patched@1', { ...patched, data: { ...patched.data, achieved: partial } }), `achieved without ${field}`).toBe(false);
    }
    const filed = first('suggestion.filed@1');
    const ops = [{ set: { id: 'row.m14', path: 'params/label', value: 'x' } }];
    expect(ok('suggestion.filed@1', { ...filed, data: { ...filed.data, patch: '01K74G3A5C7E9G1J3M5P7R9T1V', ops } })).toBe(true);
  });

  it('no agent or plug-in writes or closes a note, and a note is named by its ULID', () => {
    for (const name of ['note.opened@1', 'note.closed@1']) {
      expect(ok(name, first(name)), name).toBe(true);
      for (const writer of ['mcp:01K74G1Z3X5V7T9R1P3N5M7K9H', 'ext:x', 'hook']) expect(ok(name, { ...first(name), writer }), `${name} by ${writer}`).toBe(false);
      expect(ok(name, { ...first(name), data: { ...first(name).data, note: 'x' } }), `${name} note x`).toBe(false);
    }
  });

  it('agents cannot apply or widen a learned change, and an applied one names who applied it', () => {
    for (const name of ['learn.applied@1', 'learn.widened@1']) {
      const event = first(name);
      expect(ok(name, event), name).toBe(true);
      expect(ok(name, { ...event, writer: 'mcp:01K74G1Z3X5V7T9R1P3N5M7K9H' }), `${name} by an agent`).toBe(false);
      expect(ok(name, { ...event, data: { ...event.data, applied_by: null } }), `${name} by no one`).toBe(false);
    }
    expect(ok('learn.proposed@1', { ...first('learn.proposed@1'), writer: 'mcp:01K74G1Z3X5V7T9R1P3N5M7K9H' })).toBe(true);
  });

  it("a patch counts what it made by kind, as family.name@major", () => {
    const patched = first('doc.patched@1');
    const achieved = { created: { 'slab@1': 1 }, updated: 0, deleted: { 'village.house@1': 2 }, unchanged: false };
    expect(ok('doc.patched@1', { ...patched, data: { ...patched.data, achieved } })).toBe(true);
    for (const kind of ['slab', 'Slab@1', 'slab@0']) expect(ok('doc.patched@1', { ...patched, data: { ...patched.data, achieved: { ...achieved, created: { [kind]: 1 } } } }), kind).toBe(false);
  });

  it("a worktree's owner is its task, with its base commit, and only you remove one", () => {
    const created = first('worktree.created@1');
    expect(ok('worktree.created@1', created)).toBe(true);
    expect(ok('worktree.created@1', { ...created, data: { ...created.data, owner: 'not a task at all' } })).toBe(false);
    const { base: _base, ...noBase } = created.data;
    expect(ok('worktree.created@1', { ...created, data: noBase })).toBe(false);
    for (const writer of ['mcp:01K74G1Z3X5V7T9R1P3N5M7K9H', 'ext:shop']) expect(ok('worktree.removed@1', { ...first('worktree.removed@1'), writer }), writer).toBe(false);
  });

  it('a lease always expires', () => {
    const lease = first('lease.acquired@1');
    expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, expires: null } })).toBe(false);
  });

  it('a reading may be below zero', () => {
    const reading = first('reading.recorded@1');
    expect(ok('reading.recorded@1', { ...reading, data: { ...reading.data, value: -3.5 } })).toBe(true);
    expect(ok('reading.recorded@1', { ...reading, data: { ...reading.data, value: '-3.5' } })).toBe(false);
  });

  it("an item is named by the document's item ID grammar", () => {
    for (const name of ['note.opened@1', 'suggestion.filed@1']) {
      expect(ok(name, { ...first(name), data: { ...first(name).data, item: 'Bad Item/#x:@~' } }), name).toBe(false);
    }
  });

  it('an event keeps at most the read cap of any text field', () => {
    // Every string an event's data can hold, in every kind, is held to the read cap, unless an enum or a format
    // (a ULID, a seq) already bounds it.
    const strings = (node: unknown, at: string): { at: string; max: unknown }[] => {
      if (!node || typeof node !== 'object') return [];
      const schema = node as Record<string, unknown>;
      const own = (schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'))) && !('enum' in schema) && !('format' in schema) ? [{ at, max: schema.maxLength }] : [];
      return [...own, ...Object.entries(schema).flatMap(([key, child]) => strings(child, `${at}/${key}`))];
    };
    for (const { schema } of catalogue()) {
      const { properties, $defs } = getSchema(schema) as { properties: { data: unknown }; $defs?: unknown };
      for (const { at, max } of [...strings(properties.data, '/data'), ...strings($defs, '/$defs')]) expect(max, `${schema} ${at}`).toBe(8192);
    }
    const long = 'x'.repeat(8193);
    const before = first('tool.before@1');
    expect(ok('tool.before@1', { ...before, data: { ...before.data, command: long } })).toBe(false);
    expect(ok('tool.before@1', { ...before, data: { ...before.data, command: long.slice(1) } })).toBe(true);
    const ask = first('user.ask@1');
    expect(ok('user.ask@1', { ...ask, data: { ...ask.data, text: long } })).toBe(false);
  });

  it("a patch and the suggestion filed from it name the patch's canvas writer kind", () => {
    for (const name of ['doc.patched@1', 'suggestion.filed@1']) {
      const event = first(name);
      for (const writer of ['shell', 'record', 'agent', 'plugin']) expect(ok(name, { ...event, data: { ...event.data, writer } }), `${name} ${writer}`).toBe(true);
      for (const writer of ['any thing', 'mcp:01K74G1Z3X5V7T9R1P3N5M7K9H']) expect(ok(name, { ...event, data: { ...event.data, writer } }), `${name} ${writer}`).toBe(false);
    }
    expect(ok('doc.patched@1', { ...first('doc.patched@1'), data: { ...first('doc.patched@1').data, writer: 'you' } })).toBe(true);
  });

  it('a PASS verdict has no requirement pending or short of PASS', () => {
    const made = first('verdict.made@1');
    const requirements = made.data.requirements as Record<string, unknown>[];
    const pass = { ...made, data: { ...made.data, outcome: 'PASS', requirements: requirements.map((r) => ({ ...r, outcome: 'PASS' })) } };
    expect(ok('verdict.made@1', pass)).toBe(true);
    for (const outcome of ['pending', 'FAIL']) {
      expect(ok('verdict.made@1', { ...pass, data: { ...pass.data, requirements: requirements.map((r) => ({ ...r, outcome })) } }), outcome).toBe(false);
    }
    expect(new Set((fixtures('verdict.made@1') as Event[]).map((e) => e.data.outcome))).toEqual(new Set(['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE']));
  });

  it("an action's report says what it checked, and a note's time is optional", () => {
    const reported = first('action.reported@1');
    expect(ok('action.reported@1', { ...reported, data: { ...reported.data, checked: 'the forecast store after the write' } })).toBe(true);
    expect(ok('action.reported@1', { ...reported, data: { ...reported.data, checked: true } })).toBe(false);
    const note = first('note.opened@1');
    const { t: _t, ...still } = note.data;
    expect(ok('note.opened@1', { ...note, data: still })).toBe(true);
  });

  it('a learned change cites the sessions and quotes behind it; a rollback need not', () => {
    for (const name of ['learn.proposed@1', 'learn.applied@1', 'learn.widened@1']) {
      expect(ok(name, { ...first(name), data: { ...first(name).data, evidence: [] } }), name).toBe(false);
    }
    expect(ok('learn.rolled_back@1', { ...first('learn.rolled_back@1'), data: { ...first('learn.rolled_back@1').data, evidence: [] } })).toBe(true);
  });

  it("a reading's value is any finite number, past 2^53 too", () => {
    const reading = first('reading.recorded@1');
    for (const value of [6.02214076e23, -1e16]) expect(ok('reading.recorded@1', { ...reading, data: { ...reading.data, value } }), String(value)).toBe(true);
    for (const value of [Infinity, Number.NaN]) expect(ok('reading.recorded@1', { ...reading, data: { ...reading.data, value } }), String(value)).toBe(false);
  });

  it('no agent, plug-in or hook settles a suggestion or puts an ask off; the app and the core do', () => {
    const agents = ['mcp:01K74G1Z3X5V7T9R1P3N5M7K9H', 'ext:acme.panel', 'hook'];
    for (const name of ['suggestion.settled@1', 'ask.later@1']) {
      for (const writer of agents) expect(ok(name, { ...first(name), writer }), `${name} ${writer}`).toBe(false);
      for (const writer of ['app', 'core']) expect(ok(name, { ...first(name), writer }), `${name} ${writer}`).toBe(true);
    }
  });

  it('the hub alone records what it made, ran, read or closed: an action and its report, layer rows, readings and rollups, a dry merge, a closed task, a superseded or moot ask', () => {
    for (const name of ['action.entered@1', 'action.reported@1', 'layer.rows@1', 'reading.recorded@1', 'reading.batch@1', 'reading.rollup@1', 'merge.dry_run@1', 'task.closed@1', 'ask.superseded@1', 'ask.moot@1']) {
      for (const writer of ['mcp:s1', 'ext:infra', 'hook', 'app', 'cli']) expect(ok(name, { ...first(name), writer }), `${name} ${writer}`).toBe(false);
      expect(ok(name, { ...first(name), writer: 'core' }), name).toBe(true);
    }
  });

  it("an agent's tool calls, stops, session starts, prompts and completed tasks come only through the hook", () => {
    for (const name of ['tool.before@1', 'tool.after@1', 'agent.stop@1', 'session.start@1', 'user.ask@1', 'task.completed@1']) {
      for (const writer of ['mcp:s1', 'ext:codex', 'core', 'app', 'cli']) expect(ok(name, { ...first(name), writer }), `${name} ${writer}`).toBe(false);
      expect(ok(name, { ...first(name), writer: 'hook' }), name).toBe(true);
    }
  });

  it('no agent sends a notice or drafts a definition: only an extension, through the API, or the core', () => {
    for (const name of ['notice.sent@1', 'definition.drafted@1']) {
      for (const writer of ['mcp:01JZ0000000000000000000000', 'hook']) expect(ok(name, { ...first(name), writer }), `${name} ${writer}`).toBe(false);
      for (const writer of ['ext:spec-draft', 'core']) expect(ok(name, { ...first(name), writer }), `${name} ${writer}`).toBe(true);
    }
  });

  // The kinds a deep_* MCP tool produces (technical-design.md:429): ask.created and plan.proposed from deep_ask,
  // claim.made from deep_claim, learn.proposed from deep_propose, run.started from deep_run, open items from
  // deep_open_item, evidence.put from deep_evidence, a lease from deep_env, a patch and its suggestion from deep_show.
  const FROM_AGENTS = ['ask.created', 'plan.proposed', 'claim.made', 'learn.proposed', 'run.started', 'open_item.opened', 'open_item.closed',
    'evidence.put', 'lease.acquired', 'lease.released', 'doc.patched', 'suggestion.filed'];

  it('an agent, through MCP, appends only the kinds a deep_* tool produces', () => {
    for (const { kind, schema } of catalogue()) {
      expect(ok(schema, { ...first(schema), writer: 'mcp:s1' }), schema).toBe(FROM_AGENTS.includes(kind));
    }
  });

  it('every kind shares one envelope; only its kind, subject, writer and data differ', () => {
    const envelope = (name: string) => {
      const { properties, required, ...rest } = getSchema(name) as { properties: Record<string, unknown>; required: string[] };
      const { kind: _kind, subject: _subject, writer: _writer, data: _data, v, ...shared } = properties;
      const { title: _title, description: _description, $defs: _defs, 'x-feeds': _feeds, ...root } = rest as Record<string, unknown>;
      // Each version fixes its own v.
      const { const: _version, ...version } = v as Record<string, unknown>;
      return { root, shared: { ...shared, v: version }, required: required.filter((key) => key !== 'subject') };
    };
    const kinds = catalogue().map((e) => e.schema);
    expect(kinds).toHaveLength(84);
    for (const name of kinds) expect(envelope(name), name).toEqual(envelope(kinds[0]!));
  });

  it('every ask kind and every pin kind has a fixture', () => {
    const asks = fixtures('ask.created@1') as Event[];
    expect(new Set(asks.map((a) => a.data.kind))).toEqual(new Set(['authority', 'unblock', 'taste', 'exception', 'choice', 'definition']));
    expect(new Set(asks.map((a) => (a.data.pinned_to as { kind: string }).kind))).toEqual(new Set(['commit', 'doc_revision', 'evidence']));
  });
});

it("the catalogue's checks read a list by its indices, never through its own flatMap", () => {
  const forge = <T>(items: T[]): T[][] => {
    const own = [...items];
    Object.defineProperty(own, 'flatMap', { value: () => [] });
    class Flat<U> extends Array<U> { override flatMap<V>(): V[] { return []; } }
    return [own, Flat.from(items)];
  };
  for (const kinds of forge(['learn.paused'])) expect(checkViewBindings(kinds).ok).toBe(false);
  for (const sources of forge([{ where: '#1', text: '`learn.paused`' }])) expect(catalogueDrift(sources)).toEqual([{ kind: 'learn.paused', where: '#1' }]);
  for (const entries of forge(listSchemas())) expect(buildCatalogue(entries)).toEqual(catalogue());
});

it('an MCP tool call names its server and its tool, and no other call does', () => {
  for (const name of ['tool.before@1', 'tool.after@1']) {
    const mcp = fixtures(name).find((event) => (event as { data: { kind: string } }).data.kind === 'mcp') as { data: Record<string, unknown> } | undefined;
    expect(mcp, `${name} has an mcp fixture`).toBeDefined();
    expect(ok(name, mcp!), name).toBe(true);
    for (const field of ['server', 'tool']) {
      const { [field]: _dropped, ...data } = mcp!.data;
      expect(ok(name, { ...mcp!, data }), `${name} without ${field}`).toBe(false);
    }
    for (const call of fixtures(name) as { data: Record<string, unknown> }[]) {
      if (call.data.kind === 'mcp') continue;
      for (const [field, value] of [['server', 'deep'], ['tool', 'deep_ask']]) {
        expect(ok(name, { ...call, data: { ...call.data, [field!]: value } }), `${name} ${String(call.data.kind)} naming a ${field}`).toBe(false);
      }
    }
  }
});

describe('the learned layer', () => {
  it('a change aimed at the base names you as its applier, never a rule, in every learn kind', () => {
    for (const name of ['learn.proposed@1', 'learn.applied@1', 'learn.widened@1', 'learn.rolled_back@1']) {
      const event = first(name);
      const data = (layer: string, applied_by: string | null) => ({ ...event, data: { ...event.data, layer, applied_by } });
      expect(ok(name, data('base', 'rule:abc')), `${name} base by a rule`).toBe(false);
      expect(ok(name, data('base', null)), `${name} base by no one`).toBe(false);
      expect(ok(name, data('learned', 'rule:abc')), `${name} learned by a rule`).toBe(true);
      expect(ok(name, data('base', 'you')), `${name} base by you`).toBe(true);
    }
  });
});

describe('the drift check', () => {
  it('a kind of a family the catalogue lacks is drift where the text calls it an event kind, and other dotted names are not', () => {
    const text = 'Adds the event kind `telemetry.sampled`, and the event kinds `telemetry.dropped` and `telemetry.kept`. '
      + 'It reads `rules.json`, the preset `art.ink_wash` and the code `grid.out_of_range`.';
    expect(catalogueDrift([{ where: '#1', text }])).toEqual(['telemetry.sampled', 'telemetry.dropped', 'telemetry.kept'].map((kind) => ({ kind, where: '#1' })));
  });

  it('a name the text calls an event kind through a connective or a colon is drift too, and its twins that are not kinds are not', () => {
    const text = 'Adds the event kind named `telemetry.sampled`, an event kind: `telemetry.dropped`, the event kind called '
      + '`telemetry.kept` and event kinds such as `telemetry.lost`. The event kind field reads `rules.json`; event kinds live in `catalog.refs`.';
    expect(catalogueDrift([{ where: '#2', text }])).toEqual(['telemetry.sampled', 'telemetry.dropped', 'telemetry.kept', 'telemetry.lost'].map((kind) => ({ kind, where: '#2' })));
  });
});

// Readings the design leaves open, pinned here so a change to one is a decision; each is listed in the PR for
// the maintainer to confirm.
describe('readings pending a maintainer', () => {
  it("a lease's holder may be any writer, so a document writer can hold its prefix", () => {
    const lease = first('lease.acquired@1');
    for (const holder of ['app', 'cli', 'core']) expect(ok('lease.acquired@1', { ...lease, data: { ...lease.data, holder } }), holder).toBe(true);
  });

  it("a suggestion filed from another person's patch names the canvas writer kind you", () => {
    const filed = first('suggestion.filed@1');
    expect(ok('suggestion.filed@1', { ...filed, data: { ...filed.data, writer: 'you' } })).toBe(true);
  });
});
