// Test-side tools for the #1045 acceptance tests (README: The surface under test). Reused unchanged: #169's `deep-show
// run` scenario, `deep show`, the builds, and its comparison of a page's accessibility tree with the app's
// (../169/helpers.ts); #172's web export, the bundle's server and headless Google Chrome with WebGPU on
// (../172/helpers.ts); #376's accessibility fixture figure and its readers of the app's `see` (../376/helpers.ts). New
// here: the figure as the player plays it (the fixture with its readout changed once during play), the app's tree and
// announcement of it, and three readings of the player's page over the DevTools protocol: the browser's computed
// accessibility tree of the elements marked `data-deep-id`, the controls real Tab presses reach, and the updates of the
// page's polite live region over seeks. Nothing here stands in for the player, its tree or the app: every value a test
// compares comes from `deep-show`, the bundle or the browser, and every expected value from the issue and the design.

import { setTimeout as sleep } from 'node:timers/promises';
import { expect } from 'vitest';
import { fl, treeFailures as treeAgainstApp, treeOf, type TreeNode } from '../169/helpers.ts';
import { arr, none, obj, present, presented, runShow, scenarioOf, str, type JsonObject, type Tab } from '../172/helpers.ts';
import { announcements, figure, treeFailures as partsAndControls, type Announcement } from '../376/helpers.ts';

/** Each criterion's ID: `#1045.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1045.ccb3fe36',
  2: 'AC2 #1045.acc208bf',
} as const;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------------
// The figure as the player plays it (README: Fixture). #376's fixture figure, read from its own file, with three things
// added in test code: its document ID (`id`, as #169's and #172's documents carry theirs), a span (`transport.span`,
// without which the player's clock can't leave 0), and one channel that keys the story value `data.count`, which the
// readout `count` shows as `Rays: {data/count}`: 3 from 0 s, 4 from 2 s, held (Channel and key; the path grammar: "A
// channel may key `data/<name>`"). Nothing else changes: the same parts, label, readout and controls, so the tree is the
// fixture's own, and the readout changes once during play, with no input.

/** The figure's document ID (26 Crockford characters, as the hub mints them). */
export const DOC = '01JB1045000000000000000001';
/** The readout the figure announces. */
export const READOUT = 'count';
/** When the readout changes from 3 to 4, in seconds of the piece's time. */
export const CHANGE_AT = 2;
const SPAN = 4;

export function playedFigure(): JsonObject {
  return {
    ...(figure() as JsonObject),
    id: DOC,
    transport: { span: `${SPAN}s` },
    channels: {
      count_up: { target: 'data/count', type: 'f32', keys: { k0: { t: '0s', value: 3, interp: 'hold' }, k1: { t: `${CHANGE_AT}s`, value: 4, interp: 'hold' } } },
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The app's side (README: The app's side): the same document shown on a panel of the app on #383's virtual clock, played
// from its start with no input, and #376's `see` of that panel at 3.5 s, after the change: the tree the app gives its
// accessibility seam, and every announcement it made. The fixture's own checks run first, so a figure the app doesn't
// hear as the criterion needs fails here, naming it, never in the player's checks.

/** When the app's `see` reads the panel: after the readout changed, inside the span. */
const SEEN = 3.5;

export interface AppTree {
  /** Every node of the app's tree, in its order (#376's `see`). */
  tree: TreeNode[];
  /** The document's node (the app keeps the document's ID in lower case), and its description. */
  document: TreeNode;
  description: string;
  /** The parts' nodes (items with `role: part`) and the controls' nodes, each in the app's order. */
  parts: TreeNode[];
  controls: TreeNode[];
  /** The app's one announcement: the readout's change. */
  announcement: Announcement;
}

export function appTree(bin: string, evidence: string): AppTree {
  const doc = playedFigure();
  const r = runShow(bin, scenarioOf({
    evidence, docs: [DOC], clock: true, panel: [480, 270],
    calls: [present(DOC, doc, { at: fl(0.05) }), { call: 'see', at: fl(SEEN), panel: 'main' }],
  }), "the app's side");
  presented(r[0], "the figure on the app's panel");
  const seen = obj(r[1], "the app's see");
  const tree = treeOf(seen, "the app's see");
  none(partsAndControls(tree, doc), "the fixture: the app's tree holds each part and control once, with its name and role");
  const said = announcements(seen);
  const once = said.length === 1 && said[0]!.id === READOUT && said[0]!.t >= fl(CHANGE_AT) && said[0]!.text.includes('4');
  expect(once, `the fixture: the app announces once, readout ${READOUT} changing to 4 at ${CHANGE_AT} s; it announced ${JSON.stringify(said)}`).toBe(true);
  const isDoc = (id: unknown): boolean => typeof id === 'string' && id.toLowerCase() === DOC.toLowerCase();
  const document = tree.find((n) => isDoc(n.id));
  expect(document, `the fixture: the app's tree has the document's node ${DOC}: ${JSON.stringify(tree)}`).toBeTruthy();
  const node = arr(seen['tree'], "the app's see: tree").map((n, i) => obj(n, `the app's see: tree[${i}]`)).find((n) => isDoc(n['id']));
  const description = str(node?.['description'], `the app's see: the document node ${document!.id}'s description`);
  const items = obj(doc['items'], 'the figure: items');
  const parts = new Set(Object.keys(items).filter((id) => obj(items[id], `item ${id}`)['role'] === 'part'));
  const controls = new Set(Object.keys(obj(doc['controls'], 'the figure: controls')));
  return { tree, document: document!, description, parts: tree.filter((n) => parts.has(n.id)), controls: tree.filter((n) => controls.has(n.id)), announcement: said[0]! };
}

// ---------------------------------------------------------------------------------------------------
// The player's page over the DevTools protocol (README: How the page is read). #172's `Tab` holds its protocol and its
// session as private fields and offers `evaluate`; these tests need two more of the protocol's domains on the same page
// (Accessibility with DOM, and Input), so they reach those two fields as the class holds them, sending commands only.

type Send = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
function sendOf(tab: Tab): Send {
  const t = tab as unknown as { cdp: { send(method: string, params: Record<string, unknown>, session: string): Promise<Record<string, unknown>> }; session: string };
  return (method, params = {}) => t.cdp.send(method, params, t.session);
}

/** A node of the page's tree: #169's `{id, role, name}` and the browser's computed description. */
export interface PageNode extends TreeNode { description: string }

/**
 * The page's accessibility tree as data, read as #169's suite reads a page's: each element marked `data-deep-id` that the
 * browser's own accessibility tree (`Accessibility.getFullAXTree`) holds and doesn't ignore, in document order, its `id`
 * the mark, its name the browser's computed name, its description the computed description, and as its role its
 * `aria-roledescription`, else its `role` attribute, else the browser's computed role.
 */
export async function pageTree(tab: Tab): Promise<PageNode[]> {
  const send = sendOf(tab);
  await send('DOM.enable');
  await send('Accessibility.enable');
  const { root } = await send('DOM.getDocument', { depth: -1 }) as { root: { nodeId: number } };
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-deep-id]' }) as { nodeIds: number[] };
  type Ax = { ignored?: boolean; backendDOMNodeId?: number; role?: { value?: unknown }; name?: { value?: unknown }; description?: { value?: unknown } };
  const { nodes } = await send('Accessibility.getFullAXTree') as { nodes: Ax[] };
  const ax = new Map(nodes.filter((n) => n.backendDOMNodeId !== undefined).map((n) => [n.backendDOMNodeId!, n]));
  const out: PageNode[] = [];
  for (const nodeId of nodeIds) {
    const { node } = await send('DOM.describeNode', { nodeId }) as { node: { backendNodeId: number; attributes?: string[] } };
    const list = node.attributes ?? [];
    const attrs = new Map<string, string>();
    for (let i = 0; i + 1 < list.length; i += 2) attrs.set(list[i]!, list[i + 1]!);
    const a = ax.get(node.backendNodeId);
    if (!a || a.ignored) continue;
    const role = attrs.get('aria-roledescription') ?? attrs.get('role') ?? String(a.role?.value ?? '');
    out.push({ id: attrs.get('data-deep-id') ?? '', role, name: String(a.name?.value ?? ''), description: String(a.description?.value ?? '') });
  }
  return out;
}

/** The page's tree against the app's: #169's comparison (each node by id, role and name, nothing missing or extra, then
 * the order), and the document node's description. Each failure names the node. */
export function treeFailures(app: AppTree, page: readonly PageNode[]): string[] {
  const f = treeAgainstApp("the player's accessibility tree", app.tree, page);
  const d = page.find((n) => n.id === app.document.id);
  if (d && collapse(d.description) !== collapse(app.description)) {
    f.push(`the player's accessibility tree: node ${d.id} (the document) is described as ${JSON.stringify(d.description)} on the page, ${JSON.stringify(app.description)} in the app`);
  }
  return f;
}

const TAB = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
/** The node whose element holds keyboard focus: the focused element's nearest `data-deep-id`, or null. */
const focused = (tab: Tab): Promise<string | null> =>
  tab.evaluate(`(() => { const e = document.activeElement; const n = e && e.closest ? e.closest('[data-deep-id]') : null; return n ? n.getAttribute('data-deep-id') : null; })()`);

/**
 * The controls real Tab presses give focus, in the order they first get it: from the page as it is (a control already
 * focused counts first), Tab pressed as a keyboard presses it (`Input.dispatchKeyEvent`, focus emulated as a focused
 * page's) until a control comes round again or `max` presses. Other stops between them are passed over.
 */
export async function tabOrder(tab: Tab, controls: readonly string[], max = 40): Promise<string[]> {
  const send = sendOf(tab);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  const reached: string[] = [];
  const first = await focused(tab);
  if (first !== null && controls.includes(first)) reached.push(first);
  for (let k = 0; k < max; k++) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...TAB });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...TAB });
    const f = await focused(tab);
    if (f === null || !controls.includes(f)) continue;
    if (reached.includes(f)) break;
    reached.push(f);
  }
  return reached;
}

/** Tab reaches every control of the app's tree, in the app's order. Each failure names the control. */
export function tabFailures(app: AppTree, reached: readonly string[]): string[] {
  const f = app.controls.filter((c) => !reached.includes(c.id))
    .map((c) => `Tab never reaches control ${c.id} (${c.role} "${c.name}"); it reaches [${reached.join(', ')}]`);
  const order = app.controls.map((c) => c.id);
  if (!f.length && reached.join(',') !== order.join(',')) f.push(`Tab reaches the controls in the order ${reached.join(', ')}; the app's order is ${order.join(', ')}`);
  return f;
}

// The live region's updates (README: The live region). The test installs one observer in the page, which reads only: on
// every batch of DOM changes it takes each element with `aria-live="polite"` the batch touched (changed inside it, or
// added) and, when that element then holds text, logs one update with its text and the mark of the latest seek.

const WATCH = `(() => {
  if (window.__deep1045) return true;
  const state = { mark: 0, log: [] };
  Object.defineProperty(window, '__deep1045', { value: state });
  const polite = (n) => { const e = n && (n.nodeType === 1 ? n : n.parentElement); return e && e.closest ? e.closest('[aria-live="polite"]') : null; };
  new MutationObserver((records) => {
    const touched = new Set();
    for (const r of records) {
      const at = polite(r.target); if (at) touched.add(at);
      for (const n of r.addedNodes) if (n.nodeType === 1) {
        if (n.matches('[aria-live="polite"]')) touched.add(n);
        for (const m of n.querySelectorAll('[aria-live="polite"]')) touched.add(m);
      }
    }
    for (const e of touched) { const text = (e.textContent || '').replace(/\\s+/g, ' ').trim(); if (text) state.log.push({ mark: state.mark, text }); }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  return true;
})()`;

export interface LiveUpdate { mark: number; text: string }
export interface Live { regions: number; updates: LiveUpdate[] }
/** The seeks, as steps of 1/60 s (#172's `seekStep`): the readout unchanged at 1 s and 1.5 s, changed at 2.5 s, unchanged
 * at 3 s. Seek k has the mark k + 1. */
export const SEEKS = [60, 90, 150, 180] as const;
const CHANGED = 3;
const logged = (tab: Tab): Promise<LiveUpdate[]> => tab.evaluate(`window.__deep1045 ? window.__deep1045.log.slice() : []`);

/**
 * The live region over the seeks: each seek marked, then made through `currentTime`, waiting until probe() reads its
 * step; 1.5 s after each, and after the changing seek first up to 10 s for an update. Whatever the observer logged, and
 * how many polite live regions the page holds at the end.
 */
export async function liveUpdates(tab: Tab, what: string): Promise<Live> {
  await tab.evaluate(WATCH);
  for (const [i, step] of SEEKS.entries()) {
    const mark = i + 1;
    await tab.evaluate(`void (window.__deep1045.mark = ${mark})`);
    await tab.seekStep(step, `${what}: the seek to ${step / 60} s`);
    if (mark === CHANGED) {
      const until = Date.now() + 10_000;
      while (Date.now() < until && !(await logged(tab)).some((u) => u.mark === mark)) await sleep(100);
    }
    await sleep(1_500);
  }
  const regions = await tab.evaluate<number>(`document.querySelectorAll('[aria-live="polite"]').length`);
  return { regions, updates: await logged(tab) };
}

/**
 * The changed readout updates the live region once: none over the seeks before the change, exactly one from the seek
 * that shows it on, and that one holds the app's announcement of the change. Updates before the first seek aren't
 * read. Each failure names the readout.
 */
export function liveFailures(app: AppTree, live: Live): string[] {
  const a = app.announcement;
  const name = `readout ${a.id}`;
  if (live.regions === 0) return [`the page has no polite live region (an element with aria-live="polite") to announce ${name}`];
  const f: string[] = [];
  const before = live.updates.filter((u) => u.mark >= 1 && u.mark < CHANGED);
  const after = live.updates.filter((u) => u.mark >= CHANGED);
  if (before.length) f.push(`${name} was unchanged over the seeks to 1 s and 1.5 s, and the live region updated ${before.length} time(s): ${JSON.stringify(before)}`);
  if (after.length !== 1) f.push(`${name} changed to ${JSON.stringify(a.text)} with the seek to 2.5 s, and the live region updated ${after.length} time(s) from then to 3 s, not once: ${JSON.stringify(after)}`);
  else if (!collapse(after[0]!.text).includes(collapse(a.text))) f.push(`after ${name} changed the live region says ${JSON.stringify(after[0]!.text)}, without the app's announcement ${JSON.stringify(a.text)}`);
  return f;
}

/** AC1's judgement of a ready player: the live region over the seeks, then the tree at 3 s, then Tab. */
export async function playerFailures(tab: Tab, app: AppTree, what: string): Promise<string[]> {
  const live = await liveUpdates(tab, what);
  const page = await pageTree(tab);
  const reached = await tabOrder(tab, app.controls.map((c) => c.id));
  return [...treeFailures(app, page), ...tabFailures(app, reached), ...liveFailures(app, live)];
}
