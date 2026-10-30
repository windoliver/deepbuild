// The acceptance scenarios of #393 and #384 that the hub and the app take over from the `deep-show` stand-in (criterion 1),
// each as the stand-in's own scenario JSON, built from #393's and #384's helpers and fixtures (imported, not copied). The
// calls are the sibling suites' tests' calls, in their order; what the sibling suites assert about the replies is what the
// stand-in already answers, so this suite compares the hub's replies with the stand-in's (replay.ts).
//
// A scenario's `deep-show run` fields that the hub has no use for (`clock`, the calls' virtual times `at`, `planted`) are
// ignored by the replay; the app plays the user's calls in order, each after it has drawn what the hub presented.

import { MAGENTA, SMALL, board, clone, fixture, label, rect, solidPng, sorted, type JsonObject } from '../393/helpers.ts';
import * as t384 from '../384/helpers.ts';
import * as t393 from '../393/helpers.ts';
import { sha256 } from './helpers.ts';

export interface Entry {
  /** The sibling suite's criterion this plays: `#393 AC4`, `#384 AC3`. */
  from: string;
  /** What it plays, in a phrase. */
  about: string;
  /** The app is part of it: the scenario has calls that are the user's, or reads what the app drew. */
  app: boolean;
  /** PNGs its documents name as assets: put in the stand-in's evidence store and the hub's. */
  assets: Buffer[];
  build(evidence: string): JsonObject;
  /** The scenario sessions whose agent process "ended", their PIDs now another process's (the hub is told, DEEP_HUB_TEST_PID_REUSE). */
  reused?: string[];
  /** Bounds on a call's time in ms, by its index (1-based): the 2 s it answers within, the 1.5 s a late frame is waited for. */
  bounds?: Record<number, { min?: number; max?: number }>;
}

const D = t393.DOC;
const world = (evidence: string, calls: JsonObject[], extra: JsonObject = {}): JsonObject => ({
  evidence, sessions: t393.SESSIONS, processes: t393.PROCESSES, panels: t393.PANELS,
  docs: { [D.a]: { panel: 'main' }, [D.b]: { panel: 'main' }, [D.c]: { panel: 'main' }, [D.d]: { panel: 'main' } }, calls, ...extra,
});
const mcp = (session: string | null, doc: string, document: JsonObject = SMALL, more: JsonObject = {}): JsonObject => ({ call: 'deep_show', session, doc, document, include: ['issues'], ...more });
const cli = (peer: JsonObject, doc: string, document: JsonObject = SMALL, more: JsonObject = {}): JsonObject => ({ call: 'deep show', peer, doc, document, include: ['issues'], ...more });
const state = (doc: string): JsonObject => ({ call: 'revisions', doc });
const screen: JsonObject = { call: 'screen' };

// ---- #393 ---------------------------------------------------------------------------------------------

/** AC4 and AC6: the writer from the connection, in each agent's own layer, the peer check, the unbound call and the payloads that name a layer or a writer. */
const writer: Entry = {
  from: '#393 AC4, AC6', about: 'writer layers: stamped from the connection, the peer check, no session, a payload that names its layer or writer', app: true, assets: [], reused: [t393.CHARLIE.id],
  build: (evidence) => {
    const withLayers = { ...clone(SMALL), layers: { mine: { writer: 'you', title: 'Mine', order: 'a0' } } };
    const itemLayer = clone(SMALL);
    ((itemLayer['items'] as JsonObject)['bar'] as JsonObject)['layer'] = 'mine';
    const claimsWriter = { ...clone(SMALL), writer: 'you' };
    return world(evidence, [
      mcp(t393.ALPHA.id, D.a), cli(t393.IN_ALPHA, D.a), state(D.a),
      mcp(t393.BRAVO.id, D.b), state(D.b),
      cli(t393.IN_BRAVO, D.c), state(D.c),
      cli(t393.IN_YOURS, D.d), state(D.d),
      cli(t393.UNDER_REUSED_PID, D.a), state(D.a),
      mcp(null, D.a, SMALL, { include: ['issues', 'pixels'], size: [320, 200] }), state(D.a),
      mcp(t393.ALPHA.id, D.a, withLayers), mcp(t393.ALPHA.id, D.a, itemLayer), mcp(t393.ALPHA.id, D.a, claimsWriter), state(D.a),
      screen,
    ], { window: t393.WINDOW, card: t393.CARD });
  },
};

/** AC5: a status or a value bound to a handle the session can't read. */
const refs: Entry = {
  from: '#393 AC5', about: 'bindings to the session\'s own ask and reading, and to another session\'s, refused with ref_unresolved and no snapshot', app: false, assets: [],
  build: (evidence) => {
    const [aAsk, bAsk, aReading, bReading] = [t393.ask(1), t393.ask(2), t393.reading(1), t393.reading(2)];
    const bound = (askHandle: string, readingHandle: string): JsonObject => board('Open asks', [320, 120], [
      rect('back', 'Backdrop', [0, 0, 320, 120], 'a0', 'ground'),
      { id: 'gate', kind: 'rect@1', name: 'Ask state', order: 'a1', params: { box: [16, 16, 96, 24] } },
      label('title', 'Title', 'Open asks', [128, 18], 'a2'),
      { id: 'count', kind: 'text@1', name: 'Open asks count', order: 'a3', params: { text: '', font: 'body', size: 13, numerals: 'tabular', widest: '999', box: { w: 160, h: 20 } }, at: { pos: [16, 64, 0] } },
    ], {
      status_bindings: { 'gate-state': { target: 'items/gate/params/paint/fill', source: askHandle } },
      bound_values: { 'open-count': { target: 'items/count/params/text', source: readingHandle } },
    });
    const show = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: t393.ALPHA.id, doc: D.a, document, size: [320, 120], include: ['issues', 'pixels'] });
    return {
      evidence, sessions: t393.SESSIONS, panels: t393.PANELS, docs: { [D.a]: { panel: 'main' } },
      record: {
        [aAsk]: { session: t393.ALPHA.id, state: 'needs_you' }, [bAsk]: { session: t393.BRAVO.id, state: 'needs_you' },
        [aReading]: { session: t393.ALPHA.id, value: 3, as_of: 0 }, [bReading]: { session: t393.BRAVO.id, value: 7, as_of: 0 },
      },
      calls: [show(bound(aAsk, aReading)), state(D.a), show(bound(bAsk, aReading)), show(bound(aAsk, bReading)), state(D.a)],
    };
  },
};

/** AC7: whole revisions that keep their items, `removes`, and the diff. */
const revisions: Entry = {
  from: '#393 AC7', about: 'a 14-item document re-sent with 9, with the five named in removes, with a label changed, and without a marker', app: false, assets: [],
  build: (evidence) => {
    const fourteen = fixture('fourteen.json');
    const dropped = sorted(['row-3', 'label-3', 'row-6', 'label-6', 'label-7']);
    const without = (doc: JsonObject, section: string, ids: readonly string[]): JsonObject => {
      const out = clone(doc);
      for (const id of ids) delete (out[section] as JsonObject)[id];
      return out;
    };
    const edited = clone(fourteen);
    (((edited['items'] as JsonObject)['label-2'] as JsonObject)['params'] as JsonObject)['text'] = 'Bravo, revised';
    const show = (document: JsonObject, removes?: string[]): JsonObject => ({ call: 'deep_show', session: t393.ALPHA.id, doc: D.a, document, ...(removes ? { removes } : {}), include: ['issues'] });
    const nine = without(fourteen, 'items', dropped);
    return {
      evidence, sessions: t393.SESSIONS, panels: t393.PANELS, docs: { [D.a]: { panel: 'main' } },
      calls: [show(fourteen), state(D.a), show(nine), state(D.a), show(nine, dropped), state(D.a), show(fourteen), show(edited), state(D.a), show(without(edited, 'markers', ['review'])), state(D.a)],
    };
  },
};

/** AC9: 5,000 unnamed marks, by deep_show and by `deep show --check`. */
const issues: Entry = {
  from: '#393 AC9', about: '5,000 unnamed marks refused: the read cap, truncated, and the full list by its evidence hash', app: false, assets: [],
  build: (evidence) => {
    const ids = Array.from({ length: 5_000 }, (_, i) => `m-${i + 1}`);
    let seed = 393;
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i--) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      const j = seed % (i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const marks = board('Five thousand marks', [1000, 500], order.map((id) => {
      const n = Number(id.slice(2)) - 1;
      return { id, kind: 'rect@1', order: `a${String(n).padStart(4, '0')}`, params: { box: [(n % 100) * 10, Math.floor(n / 100) * 10, 8, 8], paint: { fill: { role: 'ink' } } } };
    }));
    return world(evidence, [mcp(t393.ALPHA.id, D.a, marks), cli(t393.IN_ALPHA, D.b, marks, { check: true })]);
  },
};

/** AC3: a settled snapshot never proves a claim whose deliverable is another document. */
const proof: Entry = {
  from: '#393 AC3', about: '`deep show --check --snap` for a claim whose deliverable is another document, and for one whose deliverable is the document', app: false, assets: [],
  build: (evidence) => {
    const [other, own] = [t393.claim(1), t393.claim(2)];
    const check = (claim: string): JsonObject => ({ call: 'deep show', peer: t393.IN_ALPHA, check: true, claim, doc: D.a, document: SMALL, t: '0s', size: [320, 200], include: ['issues', 'pixels'] });
    return world(evidence, [check(other), check(own)], {
      sessions: sessionsOf([t393.ALPHA]),
      claims: { [other]: { session: t393.ALPHA.id, deliverables: [D.b] }, [own]: { session: t393.ALPHA.id, deliverables: [D.a] } },
    });
  },
};
const sessionsOf = (list: t393.SessionFixture[]): JsonObject => t393.sessionsOf(...list);

/** A still board with a bar, a label and an image: an asset to decode, text to shape, a pipeline to build (#393's settle suite). */
const SWATCH = solidPng(32, 32, MAGENTA);
const settling = (asset: string): JsonObject => board('Swatch', [320, 200], [
  rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
  rect('bar', 'Bar', [16, 140, 200, 16], 'a1'),
  label('caption', 'Caption', 'Swatch ready', [16, 24], 'a2'),
  { id: 'swatch', kind: 'image@1', name: 'Swatch', order: 'a3', params: { asset, box: [200, 80, 32, 32], fit: 'fill', alt: 'A magenta swatch' } },
], { assets: { swatch: { sha256: asset, license: 'CC0-1.0' } } });

export const HOLDS = ['fallback_pipeline', 'rebuild_queue', 'asset_decode'] as const;
export type Hold = (typeof HOLDS)[number];
/** AC1: a frame that settles late is waited for; one that can't settle returns not presented within 2 s, and a check that needed it is BLOCKED. */
export function settle(hold: Hold, ms: number, via: 'deep_show' | 'deep show --check'): Entry {
  const asset = sha256(SWATCH);
  const call: JsonObject = via === 'deep_show'
    ? { call: 'deep_show', session: t393.ALPHA.id }
    : { call: 'deep show', peer: t393.IN_ALPHA, check: true };
  return {
    from: '#393 AC1', about: `${via}, the frame held by ${hold} for ${ms} ms`, app: false, assets: [SWATCH],
    bounds: { 1: ms <= 2_000 ? { min: ms } : { max: t393.REPLY_BOUND_MS + t393.SLACK_MS } },
    build: (evidence) => world(evidence, [{ ...call, doc: D.a, document: settling(asset), t: '1s', size: [320, 200], include: ['issues', 'pixels'] }], {
      sessions: sessionsOf([t393.ALPHA]), fault: { holds: hold, ms },
    }),
  };
}
/** AC2: on a hidden panel, not presented within 2 s. */
const hidden: Entry = {
  from: '#393 AC2', about: 'deep_show on a hidden panel', app: false, assets: [SWATCH], bounds: { 2: { max: t393.REPLY_BOUND_MS + t393.SLACK_MS } },
  build: (evidence) => world(evidence, [
    { call: 'deep_show', session: t393.ALPHA.id, doc: D.a, document: settling(sha256(SWATCH)), t: '1s', size: [320, 200], include: ['issues', 'pixels'] },
    { call: 'deep_show', session: t393.ALPHA.id, doc: D.b, document: settling(sha256(SWATCH)), t: '1s', size: [320, 200], include: ['issues', 'pixels'] },
  ], { sessions: sessionsOf([t393.ALPHA]), docs: { [D.a]: { panel: 'main' }, [D.b]: { panel: 'tucked' } } }),
};

export const ENTRIES_393: Record<string, Entry> = { writer, refs, revisions, issues, proof, hidden };

// ---- #384 ---------------------------------------------------------------------------------------------

const SHOT = t384.screenshotPng();
const board384 = (calls: (doc: JsonObject) => JsonObject[]) => (evidence: string): JsonObject => {
  const shot = sha256(SHOT);
  return t384.boardScenario(evidence, shot, calls(t384.boardDoc(shot)));
};
const CAPTION = 'alpha.caption';
const PARTS = ['alpha.part-api', 'alpha.part-db'];
const REQUEST = 'why do these two talk so much?';
const ON_PAY_BUTTON: t384.Point = [692, 228];

export const ENTRIES_384: Record<string, Entry> = {
  selection: {
    from: '#384 AC1', about: 'two parts selected by click and shift-click and a typed request, read by the session', app: true, assets: [SHOT],
    build: board384((doc) => {
      const [api, db] = PARTS.map((id) => t384.center(t384.boxOf(doc, id)));
      return [...t384.click(t384.slot(0), api!), ...t384.click(t384.slot(1), db!, true), t384.ask(t384.slot(2), 'main', REQUEST), t384.messagesCall(t384.slot(3))];
    }),
  },
  caption: {
    from: '#384 AC2', about: 'the caption pointed at at 4.2 s and revision 14: one message with its time, revision, precision and quote', app: true, assets: [SHOT],
    build: board384((doc) => [t384.ask(t384.slot(0), 'main', t384.WORDS, t384.center(t384.boxOf(doc, CAPTION))), t384.messagesCall(t384.slot(1))]),
  },
  note: {
    from: '#384 AC2', about: 'a caption that reads like an instruction arrives only as quote', app: true, assets: [SHOT],
    build: board384((doc) => [t384.ask(t384.slot(0), 'main', t384.WORDS, t384.center(t384.boxOf(doc, 'alpha.note'))), t384.messagesCall(t384.slot(1))]),
  },
  screenshot: {
    from: '#384 AC2', about: 'pointing inside a journey screenshot: precision geometry with the image\'s handle and a region', app: true, assets: [SHOT],
    build: board384(() => [t384.ask(t384.slot(0), 'main', t384.WORDS, ON_PAY_BUTTON), t384.messagesCall(t384.slot(1))]),
  },
  page: {
    from: '#384 AC2', about: 'pointing inside an HTML deliverable: precision region with no handle', app: true, assets: [],
    build: (evidence) => t384.pageScenario(evidence, [t384.ask(t384.slot(0), 'page', t384.WORDS, [200, 50]), t384.messagesCall(t384.slot(1))]),
  },
  detached: {
    from: '#384 AC3', about: 'the caption deleted at revision 15 before the session reads: detached, the ask-task open, render-back of revision 14 unchanged', app: true, assets: [SHOT],
    build: board384((doc) => [
      t384.ask(t384.slot(0), 'main', t384.WORDS, t384.center(t384.boxOf(doc, CAPTION))),
      t384.renderBack(t384.slot(1), t384.T_POINTED, t384.REV_SEEN),
      t384.deletePatch(t384.slot(2), CAPTION),
      t384.messagesCall(t384.slot(4)),
      t384.renderBack(t384.slot(5), t384.T_POINTED, t384.REV_SEEN),
      t384.renderBack(t384.slot(6), t384.T_POINTED, t384.REV_DELETE),
      t384.renderBack(t384.slot(7), 0, t384.REV_SEEN),
    ]),
  },
};
