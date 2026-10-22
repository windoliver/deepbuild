import { describe, expect, it } from 'vitest';
import {
  ALPHA, BRAVO, CARD, DOC, IN_ALPHA, IN_BRAVO, IN_YOURS, PANELS, PROCESSES, SESSIONS, SMALL, UNDER_REUSED_PID, WINDOW, bands, clone, current, diff,
  evidenceHashes, expectBadInput, issues, outcome, revisions, run, snapshots, sorted, useEvidence, useShowBinary, type Band, type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

const ITEMS = sorted(Object.keys(SMALL['items'] as JsonObject));
const world = (calls: JsonObject[]): JsonObject => ({
  evidence: evidence(),
  sessions: SESSIONS,
  processes: PROCESSES,
  panels: PANELS,
  docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' }, [DOC.c]: { panel: 'main' }, [DOC.d]: { panel: 'main' } },
  window: WINDOW,
  card: CARD,
  calls,
});
const mcp = (session: string | null, doc: string, document: JsonObject = SMALL): JsonObject => ({ call: 'deep_show', session, doc, document, include: ['issues'] });
const cli = (peer: JsonObject, doc: string, document: JsonObject = SMALL): JsonObject => ({ call: 'deep show', peer, doc, document, include: ['issues'] });
const state = (doc: string): JsonObject => ({ call: 'revisions', doc });
const agentWriter = (s: typeof ALPHA) => ({ kind: 'agent', id: s.thread });
const ownerOf = (b: Band) => ({ kind: b.owner['kind'], id: b.owner['id'] });

describe('AC4 a `deep show` run from inside an agent\'s process tree draws in that agent\'s writer layer, stamped as that agent and never as you, and a deep_show call bound to no session is refused', () => {
  it('AC4 `deep show` run inside alpha\'s process tree lands in the same writer layer as alpha\'s own deep_show, stamped as alpha', () => {
    const { replies } = run(world([mcp(ALPHA.id, DOC.a), cli(IN_ALPHA, DOC.a), state(DOC.a), { call: 'screen' }]));
    const [own, fromTree, revs, shown] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];
    expect(outcome(own), 'alpha\'s deep_show is presented').toBe('presented');
    expect(outcome(fromTree), 'the `deep show` run inside alpha\'s tree is presented').toBe('presented');
    // In alpha's layer the same items are its own: nothing new is created, as it would be in a layer of yours.
    expect(diff(fromTree), 'the same document from alpha\'s tree diffs against alpha\'s layer: every item unchanged').toEqual({ changed: [], unchanged: ITEMS, created: [], removed: [] });
    expect(revisions(revs).map((r) => r.writer), 'both revisions are stamped as alpha\'s thread, never as you').toEqual([agentWriter(ALPHA), agentWriter(ALPHA)]);
    const rows = bands(shown).filter((b) => b.owner['kind'] !== 'shell');
    expect(rows.map(ownerOf), 'one writer layer on screen, alpha\'s').toEqual([agentWriter(ALPHA)]);
    expect(rows.map((b) => b.band), 'in the agent band').toEqual(['agent']);
  });

  it('AC4 the peer check picks the agent whose tree the command runs in, and you outside every agent\'s tree', () => {
    const { replies } = run(world([cli(IN_BRAVO, DOC.b), state(DOC.b), cli(IN_YOURS, DOC.c), state(DOC.c), cli(IN_ALPHA, DOC.d), state(DOC.d)]));
    for (const i of [0, 2, 4]) expect(outcome(replies[i]!), `call ${i + 1} is presented`).toBe('presented');
    expect(current(replies[1]!).writer, 'run inside bravo\'s tree: stamped as bravo').toEqual(agentWriter(BRAVO));
    expect(current(replies[5]!).writer, 'run inside alpha\'s tree: stamped as alpha').toEqual(agentWriter(ALPHA));
    expect(current(replies[3]!).writer['kind'], 'run in your shell, outside every agent\'s tree: stamped as you').toBe('you');
  });

  it('AC4 a process that reuses an ended agent\'s PID is not inside that agent\'s tree: `deep show` under it is you, not the agent', () => {
    const { replies } = run(world([cli(UNDER_REUSED_PID, DOC.a), state(DOC.a)]));
    expect(outcome(replies[0]!), 'it is presented').toBe('presented');
    expect(current(replies[1]!).writer['kind'], 'the peer check matches the agent\'s process by its start time, never by PID alone').toBe('you');
  });

  it('AC4 a deep_show call bound to no session is refused: it draws nothing, makes no revision and attaches no evidence', () => {
    const { replies } = run(world([{ ...mcp(null, DOC.a), include: ['issues', 'pixels'] }, state(DOC.a), { call: 'screen' }]));
    const [refused, revs, shown] = replies as [JsonObject, JsonObject, JsonObject];
    expect(outcome(refused), 'the unbound call is refused').toBe('refused');
    expect(refused['code'], 'with the code no_session').toBe('no_session');
    expect(snapshots(refused), 'and no snapshot').toEqual([]);
    expect(revisions(revs), 'the document has no revision').toEqual([]);
    expect(bands(shown).filter((b) => b.owner['kind'] !== 'shell'), 'no writer layer is on screen').toEqual([]);
    expect(evidenceHashes(evidence()), 'no evidence was attached').toEqual([]);
  });

  it('deep-show run answers bad_input to a line it can\'t read, and to a scenario with no calls', () => {
    expectBadInput('run', { evidence: evidence() });
  });
});

describe('AC6 an agent\'s deep_show document draws in its own writer layer, stamped from its connection and outlined with its name, in the agent band below the question card, and a payload that names its own layer or writer is refused', () => {
  it('AC6 two agents\' documents each draw in their own writer layer, stamped from the connection, outlined with the agent\'s name, in the agent band below the card', () => {
    const { replies } = run(world([mcp(ALPHA.id, DOC.a), mcp(BRAVO.id, DOC.b), state(DOC.a), state(DOC.b), { call: 'screen' }]));
    expect(replies.slice(0, 2).map(outcome), 'both are presented').toEqual(['presented', 'presented']);
    expect(current(replies[2]!).writer, 'alpha\'s document is stamped from alpha\'s connection').toEqual(agentWriter(ALPHA));
    expect(current(replies[3]!).writer, 'bravo\'s from bravo\'s').toEqual(agentWriter(BRAVO));
    const rows = bands(replies[4]!);
    const last = rows.at(-1);
    expect(last?.band, 'the question card composes last, on top').toBe('card');
    expect(rows.filter((b) => b.band === 'card').length, 'once').toBe(1);
    for (const s of [ALPHA, BRAVO]) {
      const mine = rows.filter((b) => b.owner['kind'] === 'agent' && b.owner['id'] === s.thread);
      expect(mine.length, `${s.id}'s document draws in one writer layer of its own`).toBe(1);
      const row = mine[0]!;
      expect(row.band, `${s.id}'s layer is in the agent band`).toBe('agent');
      expect(row.outline, `${s.id}'s layer is outlined`).toBe(true);
      expect(row.name, `with ${s.id}'s name`).toBe(s.name);
      expect(rows.indexOf(row), `${s.id}'s layer composes below the card`).toBeLessThan(rows.indexOf(last!));
    }
    const alphaLayer = rows.find((b) => b.owner['id'] === ALPHA.thread)!.layer;
    const bravoLayer = rows.find((b) => b.owner['id'] === BRAVO.thread)!.layer;
    expect(alphaLayer, 'two writers, two layers').not.toEqual(bravoLayer);
  });

  it('AC6 a payload that names its own layer, an item\'s layer or a writer is refused, naming the field, and nothing draws', () => {
    const withLayers = { ...clone(SMALL), layers: { mine: { writer: 'you', title: 'Mine', order: 'a0' } } };
    const itemLayer = clone(SMALL);
    ((itemLayer['items'] as JsonObject)['bar'] as JsonObject)['layer'] = 'mine';
    const claimsWriter = { ...clone(SMALL), writer: 'you' };
    const cases: [string, JsonObject, (path: string) => boolean][] = [
      ['a layers map naming its own layer and writer', withLayers, (p) => p === 'layers' || p.startsWith('layers/')],
      ['an item that names its layer', itemLayer, (p) => p === 'items/bar/layer'],
      ['a document that names its writer', claimsWriter, (p) => p === 'writer'],
    ];
    for (const [what, document, names] of cases) {
      const { replies } = run(world([mcp(ALPHA.id, DOC.a, document), state(DOC.a), { call: 'screen' }]));
      const [refused, revs, shown] = replies as [JsonObject, JsonObject, JsonObject];
      expect(outcome(refused), `${what} is refused`).toBe('refused');
      const paths = issues(refused).map((i) => String(i.path));
      expect(paths.some(names), `${what}: an issue names the field (paths ${JSON.stringify(paths)})`).toBe(true);
      expect(revisions(revs).filter((r) => r.state === 'current'), `${what}: no revision becomes current`).toEqual([]);
      expect(bands(shown).filter((b) => b.owner['kind'] !== 'shell'), `${what}: nothing draws`).toEqual([]);
    }
  });
});
