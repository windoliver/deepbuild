// A world for criteria 2 to 4: a hub with the world file, a Claude Code stand-in and a Codex stand-in each in a session of its own, a
// `deep mcp` by hand, and, when asked, the app's replica. The six-item figure each agent shows on its claim.

import { join } from 'node:path';
import { expect } from 'vitest';
import {
  App, FIGURE, FIGURE_ITEMS, FIGURE_SIZE, Stand, World, aboutDoc, deepShow, events, makeHome, readEvidence, startHub, t26, t393, uuidOf,
  type AgentKind, type Drawn, type JsonObject, type JsonValue, type Line,
} from './helpers.ts';

export const CLAUDE = { label: 'claude-code-session', kind: 'claude-code' as AgentKind, name: 'Claude Code: login fix' };
export const CODEX = { label: 'codex-session', kind: 'codex' as AgentKind, name: 'Codex: release notes' };
export type Who = typeof CLAUDE | typeof CODEX;

export interface Figures {
  tmp: string;
  home: string;
  hub: t26.Hub;
  world: World;
  stands: Map<string, Stand>;
  hand: t26.McpProcess;
  app: App | undefined;
}
export const sessionId = (who: Who): string => uuidOf(who.label);
/** A fresh session's thread is its own ID (session.start's `thread`). */
export const threadOf = sessionId;

/** The hub with its world file (both sessions' names, the panel, the documents it minted), both agents established, a `deep mcp` by hand. */
export async function openFigures(o: { plant?: string; app: boolean }): Promise<Figures> {
  const { tmp, home } = makeHome();
  const world = new World(join(tmp, 'world.json'), {
    names: { [sessionId(CLAUDE)]: CLAUDE.name, [sessionId(CODEX)]: CODEX.name },
    panels: t393.PANELS,
    docs: { [t393.DOC.a]: { panel: 'main' }, [t393.DOC.b]: { panel: 'main' }, [t393.DOC.c]: { panel: 'main' } },
  });
  const hub = await startHub(home, { world: world.path, ...(o.plant ? { plant: o.plant } : {}) });
  const work = t26.makeWorktree(join(tmp, 'work'));
  const stands = new Map<string, Stand>();
  for (const who of [CLAUDE, CODEX]) {
    const stand = Stand.start(home, work.path, who.kind, sessionId(who), o.plant ? { DEEP_HUB_PLANT: o.plant } : {});
    await stand.establish(hub);
    await t26.initialize(stand);
    stands.set(who.label, stand);
  }
  const hand = t26.McpProcess.start(home, work.path, o.plant ? { DEEP_HUB_PLANT: o.plant } : {});
  await t26.initialize(hand);
  const app = o.app ? await App.start(home, join(tmp, 'app')) : undefined;
  return { tmp, home, hub, world, stands, hand, app };
}

/** The figure as an agent sends it; `claimed` puts a writer in the payload, which no agent's payload may name. */
export const figureDoc = (claimed?: string): JsonObject => (claimed ? { ...FIGURE, writer: claimed } : FIGURE);
export const SHOW = { t: '0s', size: FIGURE_SIZE, include: ['issues', 'pixels'] };

/** The session files its claim, then shows the figure on its document: the call, its reply and how long it took. */
export async function showFigure(f: Figures, who: Who, doc: string, claimed?: string): Promise<{ claim: string; reply: JsonObject; ms: number }> {
  const stand = f.stands.get(who.label)!;
  const made = t26.valueOf(await t26.callTool(stand, 'deep_claim', t26.claimArgs()), `deep_claim of the ${who.name} session`);
  const shown = await deepShow(stand, { doc, document: figureDoc(claimed), ...SHOW }, `deep_show of the ${who.name} session`);
  return { claim: String(made.claim ?? made.event), reply: shown.reply, ms: shown.ms };
}

const HEX = /^[0-9a-f]{64}$/;
/**
 * What criterion 2 reads of one agent's reply: presented at revision 1, no error, one snapshot of the figure's size by hash, and the
 * snapshot's PNG in the hub's evidence store.
 */
export async function expectPresentedReply(home: string, label: string, reply: JsonObject): Promise<string> {
  expect(reply['outcome'], `${label}: deep_show says presented (${JSON.stringify(reply).slice(0, 500)})`).toBe('presented');
  expect(reply['rev'], `${label}: at revision 1`).toBe(1);
  expect(t393.arr(reply['issues'], 'issues').filter((i) => (i as JsonObject)['severity'] === 'error'), `${label}: the figure has no error`).toEqual([]);
  const shots = t393.arr(reply['snapshots'], 'snapshots');
  expect(shots.length, `${label}: one snapshot`).toBe(1);
  const shot = t393.obj(shots[0], 'snapshots[0]');
  expect(String(shot['sha256']), `${label}: the snapshot is named by its hash`).toMatch(HEX);
  expect([shot['w'], shot['h']], `${label}: of the size asked for`).toEqual(FIGURE_SIZE);
  const png = t393.decodePng(await readEvidence(home, String(shot['sha256'])));
  expect([png.width, png.height], `${label}: the snapshot's PNG, read from the evidence store by its hash`).toEqual(FIGURE_SIZE);
  return String(shot['sha256']);
}
export const expectPresented = (f: Figures, who: Who, reply: JsonObject): Promise<string> => expectPresentedReply(f.home, who.name, reply);

/**
 * "The record holds the revision by hash": an event of the hub's record about the document, at revision 1, written by the session's
 * connection, names the revision's hash, and the evidence store holds the canonical document under that hash: the figure's six items, in
 * a layer whose writer is the session's thread.
 */
export async function expectRecordedRevision(hub: t26.Hub, home: string, of: { session: string; thread: string; doc: string; label: string }): Promise<string> {
  const { session, thread, doc, label } = of;
  const all = await events(hub);
  const held = aboutDoc(all, doc).filter((e) => e.data?.rev === 1 && typeof e.data?.hash === 'string');
  expect(held.length, `${label}: the record holds revision 1 of ${doc} by hash (events about it: ${JSON.stringify(aboutDoc(all, doc).map((e) => [e.kind, e.data])).slice(0, 600)})`).toBe(1);
  const event = held[0]!;
  const hash = String(event.data.hash);
  expect(hash, `${label}: the revision's hash`).toMatch(HEX);
  expect(event.writer, `${label}: written by its own connection, never the payload`).toBe(`mcp:${session}`);
  expect(event.session, `${label}: under its own session`).toBe(session);
  const canonical = JSON.parse((await readEvidence(home, hash)).toString('utf8')) as JsonObject;
  expect(t393.sorted(Object.keys(t393.obj(canonical['items'], 'the revision\'s items'))), `${label}: the stored revision is the figure, its six items`).toEqual(FIGURE_ITEMS);
  const layers = t393.obj(canonical['layers'], 'the revision\'s layers');
  const mine = Object.entries(layers).filter(([, l]) => (l as JsonObject)['writer'] === `agent:${thread}`).map(([id]) => id);
  expect(mine.length, `${label}: one layer of the stored revision is written by agent:${thread}: ${JSON.stringify(layers).slice(0, 400)}`).toBe(1);
  for (const [id, item] of Object.entries(t393.obj(canonical['items'], 'items'))) expect((item as JsonObject)['layer'], `${label}: item ${id} is in that layer`).toBe(mine[0]);
  return hash;
}
export const expectRecorded = (f: Figures, who: Who, doc: string): Promise<string> =>
  expectRecordedRevision(f.hub, f.home, { session: sessionId(who), thread: threadOf(who), doc, label: who.name });

/** The deep_show reply in a real agent's output: the first JSON object with an `outcome`, found in a tool result's text. */
export function findReply(output: string): JsonObject | undefined {
  const walk = (v: JsonValue | undefined): JsonObject | undefined => {
    if (typeof v === 'string') {
      if (!v.trimStart().startsWith('{')) return undefined;
      try { return walk(JSON.parse(v) as JsonValue); } catch { return undefined; }
    }
    if (Array.isArray(v)) { for (const x of v) { const f = walk(x); if (f) return f; } return undefined; }
    if (typeof v === 'object' && v !== null) {
      if (typeof v['outcome'] === 'string' && 'snapshots' in v) return v;
      for (const x of Object.values(v)) { const f = walk(x); if (f) return f; }
    }
    return undefined;
  };
  for (const line of output.split('\n')) {
    try { const f = walk(JSON.parse(line) as JsonValue); if (f) return f; } catch { /* not a JSON line */ }
  }
  return undefined;
}

export type { Drawn, JsonValue, Line };
