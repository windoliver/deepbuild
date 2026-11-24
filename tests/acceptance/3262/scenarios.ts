// The scenarios criterion 3 of #3262 is played on, besides #3222's 16-session script (ac3-suites.test.ts plays them;
// README: Criterion 3, A session that ends), each as the lines a hub sends a canvas side:
// - #393's and #384's, as #806's suite plays them through the hub's canvas side: `../806/scenarios.ts`, imported as
//   #806's own replay tests import it (it builds each from #393's and #384's helpers and fixtures);
// - #806's own: its two sessions each showing the six-item figure on one panel (sessions.test.ts), where one session
//   then ends: no scenario of the five suites ends a session, and the criterion's planted side needs one that does;
// - #1415's two default-build scenarios (patches.test.ts) and #2694's three (ac1, ac3 and ac4), written out here
//   from those suites' own helpers, which no other suite imports.
import { DOC, PANELS } from '../393/helpers.ts';
import { FIGURE, FIGURE_SIZE } from '../806/helpers.ts';
import { ENTRIES_384, ENTRIES_393 } from '../806/scenarios.ts';
import { linesOf, type Fed, type JsonObject } from './side.mjs';

export interface Transcript { name: string; assets: Buffer[]; feed(side: Fed): Promise<void> }

/** A stand-in scenario as the lines a side is sent, its documents' assets in both stores first. */
const scenario = (name: string, build: (evidence: string) => JsonObject, assets: Buffer[] = []): Transcript => ({
  name, assets,
  feed: async ({ evidence, send }) => { for (const line of linesOf(build(evidence))) await send(line); },
});

// ---- #806: two sessions, the six-item figure each on its own document of one panel; then one session ends.
const CLAUDE = { id: '0a806c1a-0000-4000-8000-000000000001', name: 'Claude Code: login fix' };
const CODEX = { id: '0a806c0d-0000-4000-8000-000000000002', name: 'Codex: release notes' };
/** A session as the hub's world holds it (packages/hub/src/canvas.ts `shape`): a fresh session's thread is its own ID. */
const live = (...list: { id: string; name: string }[]): JsonObject => Object.fromEntries(list.map((s) => [s.id, { thread: s.id, name: s.name, process: { pid: 0, start: 0 } }]));
const figureWorld = (...sessions: { id: string; name: string }[]): JsonObject => ({
  sessions: live(...sessions), record: {}, panels: PANELS, docs: { [DOC.a]: { panel: 'main' }, [DOC.b]: { panel: 'main' }, [DOC.c]: { panel: 'main' } }, packs: [],
});
const showFigure = (session: string, doc: string, document: JsonObject = FIGURE): JsonObject => ({ call: 'deep_show', session, doc, t: '0s', size: FIGURE_SIZE, include: ['issues', 'pixels'], document });
/** The figure with its build bar moved on: a second whole revision. */
const movedOn = (): JsonObject => {
  const figure = JSON.parse(JSON.stringify(FIGURE)) as JsonObject;
  (((figure['items'] as JsonObject)['bar-build'] as JsonObject)['params'] as JsonObject)['box'] = [16, 60, 280, 16];
  return figure;
};
const sessionEnds: Transcript = {
  name: '#806\'s two sessions\' figures on one panel, where the Codex session then ends', assets: [],
  feed: async ({ send }) => {
    await send({ world: figureWorld(CLAUDE, CODEX) });
    await send({ call: showFigure(CLAUDE.id, DOC.a) });
    await send({ call: showFigure(CODEX.id, DOC.b) });
    // The Codex session's SessionEnd reaches the hub: the world it sends next leaves that session out.
    await send({ world: figureWorld(CLAUDE) });
    await send({ call: { call: 'revisions', doc: DOC.b } });
    await send({ call: { call: 'revisions', doc: DOC.a } });
    await send({ call: { call: 'render_back', doc: DOC.a, t: 0, rev: 1, size: FIGURE_SIZE, session: CLAUDE.id } });
    await send({ call: showFigure(CLAUDE.id, DOC.a, movedOn()) });
    await send({ call: { call: 'revisions', doc: DOC.a } });
  },
};

// ---- #1415 (helpers.ts, patches.test.ts): two sessions' shared board at revision 0, alpha's patches and undo.
const D1415 = '01JB1415D00000000000000001';
const P = (n: number): string => `01JB1415P${String(n).padStart(17, '0')}`;
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: doors', process: { pid: 4100, start: 1_000 } };
const BRAVO = { id: 'sess-bravo', thread: 'thread-bravo', name: 'Codex: labels', process: { pid: 5200, start: 2_000 } };
const item = (id: string, layer: string, name: string, order: string, box: number[], pos: [number, number], role = 'ink'): JsonObject =>
  ({ id, kind: 'rect@1', layer, name, order, params: { box, paint: { fill: { role } } }, at: { pos: [pos[0], pos[1], 0] } });
const doors = (calls: JsonObject[]) => (evidence: string): JsonObject => ({
  evidence,
  sessions: Object.fromEntries([ALPHA, BRAVO].map((s) => [s.id, { thread: s.thread, name: s.name, process: s.process }])),
  panels: { main: { rect: [0, 0, 640, 360] } },
  docs: { [D1415]: { panel: 'main', document: {
    format: 1, profile: 'board', title: 'Doors', description: 'A board two test agents share: a door in one layer, a card and a tag in the other.', size: [640, 360],
    layers: { 'alpha-main': { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a1' }, 'bravo-main': { writer: `agent:${BRAVO.thread}`, title: BRAVO.name, order: 'a2' } },
    items: {
      door: item('door', 'bravo-main', 'Door', 'a0', [0, 0, 120, 48], [40, 40], 'muted'),
      card: item('card', 'alpha-main', 'Card', 'a1', [0, 0, 60, 30], [200, 40]),
      tag: item('tag', 'alpha-main', 'Tag', 'a2', [0, 0, 20, 10], [300, 40]),
    },
  } } },
  calls,
});
const patch = (id: string, base: number, ops: JsonObject[]): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: D1415, patch: { patch: id, doc: D1415, base, reason: 'a #1415 test patch', ops } });
const set = (id: string, field: string, value: JsonObject[string]): JsonObject => ({ op: 'set', id, path: `items/${id}/${field}`, value });
const rows1415: JsonObject = { call: 'revisions', doc: D1415 };
const again = { id: 'door', kind: 'rect@1', name: 'Door again', order: 'a5', params: { box: [0, 0, 10, 10], paint: { fill: { role: 'ink' } } }, at: { pos: [0, 0, 0] } };
const noChange = doors([
  patch(P(1), 0, [set('tag', 'params/box', [0, 0, 22, 10])]), rows1415,
  patch(P(2), 1, [set('card', 'params/box', [0, 0, 60, 30]), set('card', 'name', 'Card')]), rows1415,
  { call: 'deep_show', session: ALPHA.id, doc: D1415, undo: { patch: P(3), of: P(2) } }, rows1415,
]);
const idTaken = doors([patch(P(1), 0, [set('tag', 'params/box', [0, 0, 22, 10])]), rows1415, patch(P(2), 1, [{ op: 'create', item: again }]), rows1415]);

// ---- #2694 (helpers.ts, ac1, ac3 and ac4): one session, one document; shows, reads between them, a terminal's feed.
const S2694 = 'sess-2694';
const D2694 = '01JB7D00000000000000002694';
const world2694 = (evidence: string): JsonObject => ({
  evidence, sessions: { [S2694]: { thread: 'thread-2694', name: 'Claude Code: terminal tab', process: { pid: 0, start: 0 } } },
  record: {}, panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [D2694]: { panel: 'main' } },
});
const progress = (bar: number): JsonObject => ({
  format: 1, profile: 'board', title: 'Build progress', description: 'Build progress, drawn by a test agent through deep_show.', size: [320, 200],
  items: {
    back: { id: 'back', kind: 'rect@1', name: 'Backdrop', order: 'a0', params: { box: [0, 0, 320, 200], paint: { fill: { role: 'ground' } } } },
    bar: { id: 'bar', kind: 'rect@1', name: 'Progress bar', order: 'a1', params: { box: [16, 120, bar, 16], paint: { fill: { role: 'muted' } } } },
  },
});
const show2694 = (bar: number): JsonObject => ({ call: 'deep_show', session: S2694, doc: D2694, document: progress(bar), include: ['issues'] });
const CELLS: JsonObject = { call: 'cells', session: S2694, tab: 'terminal' };
const many = (call: JsonObject, n: number): JsonObject[] => Array.from({ length: n }, () => call);
const with2694 = (calls: JsonObject[]) => (evidence: string): JsonObject => ({ ...world2694(evidence), calls });
/** The row arrives at 2 s on the side's clock: the 24th call (ac3-clock.test.ts). */
const OPEN: JsonObject = { call: 'terminal_open', terminal: 'tty-2694', session: S2694, cols: 40, rows: 3, feed: [{ at: 2 * 705_600_000, text: 'ROWS AT TWO SECONDS' }] };

export const TRANSCRIPTS: Transcript[] = [
  ...Object.entries(ENTRIES_393).map(([key, e]) => scenario(`${e.from} as #806 plays it (${key}: ${e.about})`, e.build, e.assets)),
  ...Object.entries(ENTRIES_384).map(([key, e]) => scenario(`${e.from} as #806 plays it (${key}: ${e.about})`, e.build, e.assets)),
  sessionEnds,
  scenario('#1415 AC6: a patch that changes nothing, and its undo', noChange),
  scenario('#1415 AC7: a create of an item the board holds', idTaken),
  // The reads between two shows are 8 here, not #2694's 14,400: that count is its cost criterion's, not a reply's.
  scenario('#2694 AC1: a show, reads, a second show', with2694([show2694(80), ...many(CELLS, 8), show2694(240)])),
  scenario('#2694 AC3: a terminal\'s row that arrives at 2 s, read 35 times', with2694([OPEN, ...many(CELLS, 35)])),
  scenario('#2694 AC4: a read of the revisions between two shows', with2694([show2694(80), { call: 'revisions', doc: D2694 }, show2694(240)])),
];
