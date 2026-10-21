import { describe, expect, it } from 'vitest';
import {
  buildCatalogue, catalogue, catalogueDrift, checkViewBindings, fixtures, listSchemas, validate,
} from '../../../packages/contracts/src/index.ts';
import { DESIGN_KINDS, expectRefused, fixtureText, getAt, kindSchema, setAt } from './helpers.ts';

describe('AC16 the event catalogue is generated from the kinds\' schemas, and a drift test holds it to the design and the issues', () => {
  it('AC16 every catalogue entry is one published event schema, and dropping a schema drops its kind', () => {
    const entries = listSchemas();
    expect(buildCatalogue(entries)).toEqual(catalogue());
    const names = new Set(entries.map((e) => e.name));
    for (const entry of catalogue()) expect(names.has(entry.schema), `${entry.kind}'s schema ${entry.schema}`).toBe(true);
    // A kind appears once per version (#603: agent.stop@1 stays catalogued beside agent.stop@2; owner-approved).
    expect(new Set(catalogue().map((e) => `${e.kind}@${e.version}`)).size).toBe(catalogue().length);
    const userAsk = kindSchema('user.ask');
    const without = buildCatalogue(entries.filter((e) => e.name !== userAsk));
    expect(without.map((e) => e.kind)).not.toContain('user.ask');
    expect(without).toHaveLength(catalogue().length - 1);
  });

  it.each(['transcript.archived', 'learn.proposed', 'learn.applied', 'learn.widened', 'learn.rolled_back'])('AC16 %s is in the catalogue', (kind) => {
    expect(catalogue().map((e) => e.kind)).toContain(kind);
  });

  it('AC16 each kind names the projections it feeds, as the canvas reference\'s catalogue says', () => {
    const feeds: Record<string, string[]> = {
      'user.ask': ['tasks', 'returns'], 'claim.made': ['claims'], 'verdict.made': ['verdicts'], 'ask.created': ['asks'],
      'lease.acquired': ['leases'], 'doc.patched': ['documents', 'returns'], 'transcript.archived': ['sessions', 'evidence'],
      'tool.before': ['session_files', 'returns'], 'reading.rollup': ['rollups'], 'layer.rows': ['layer_rows'], 'reading.batch': [],
    };
    for (const [kind, want] of Object.entries(feeds)) {
      expect([...catalogue().find((e) => e.kind === kind)!.feeds].sort(), kind).toEqual([...want].sort());
    }
  });

  it.each(['shell', 'read', 'edit', 'write', 'search', 'fetch', 'mcp', 'unknown'])('AC16 tool.before takes the tool kind %s', (toolKind) => {
    const name = kindSchema('tool.before');
    const found = fixtures(name).filter((event) => getAt(event, '/data/kind') === toolKind && validate(name, event).ok);
    expect(found.length, `a valid tool.before fixture with data.kind ${toolKind}`).toBeGreaterThan(0);
  });

  it('AC16 tool.before refuses a tool kind outside the list', () => {
    const name = kindSchema('tool.before');
    expectRefused(validate(name, setAt(fixtures(name)[0]!, '/data/kind', 'bash')), '/data/kind', 'tool kind bash');
  });

  it('AC16 a planted issue body naming learn.paused, which has no schema, fails the drift test, naming the kind and the issue', () => {
    const drift = catalogueDrift([{ where: '#9311', text: fixtureText('issue-learn-paused.md') }]);
    // A drift test that reads only the design, or ignores issue bodies, passes this body and fails here.
    expect(drift).toEqual([{ kind: 'learn.paused', where: '#9311' }]);
  });

  it('AC16 its clean twin, naming only catalogued kinds and backticked names that aren\'t event kinds, passes', () => {
    expect(catalogueDrift([{ where: '#9312', text: fixtureText('issue-clean.md') }])).toEqual([]);
  });

  it('AC16 every kind the design documents passes the drift test as an issue body naming them all', () => {
    const body = DESIGN_KINDS.map((k) => `- \`${k}\``).join('\n');
    expect(catalogueDrift([{ where: '#9313', text: body }])).toEqual([]);
    const missing = catalogueDrift([{ where: '#9314', text: `${body}\n- \`verdict.created\`` }]);
    expect(missing).toEqual([{ kind: 'verdict.created', where: '#9314' }]);
  });
});

describe('AC7 a view that binds to an event kind outside the catalogue is refused, naming the kind', () => {
  it('AC7 a view bound to catalogued kinds passes', () => {
    expect(checkViewBindings(['user.ask', 'verdict.made', 'ask.created', 'lease.acquired']).ok).toBe(true);
  });

  it.each(['learn.paused', 'verdict.created', 'sendback.delivered', 'claim.point'])('AC7 a view bound to %s is refused, naming the kind', (kind) => {
    const result = checkViewBindings(['user.ask', kind, 'verdict.made']);
    expectRefused(result, '/1', `view bound to ${kind}`);
    if (!result.ok) expect(result.issues.find((i) => i.path === '/1')?.actual).toBe(kind);
  });
});
