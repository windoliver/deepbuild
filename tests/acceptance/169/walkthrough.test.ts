// AC1 #169.b1f34a83: "A walkthrough with four stages, an explode toggle and a three-option color variant set exports a
// page of 24 states; a scripted browser with networking off clicks every target and presses every key, reaches all 24
// states and makes no network request, and each state's still decodes to the raw frame hash the app's export of that
// state recorded"
//
// AC7 #169.fa0fa9b6: "In the 24-state walkthrough, every target is reachable by Tab and plays its edge on Enter, and
// each state's accessibility tree, read in a scripted browser with networking off, equals the app's for that state as
// data; a page whose targets are only boxes on an image fails this test, naming the first target"
//
// The walkthrough (helpers.ts `walkthrough`) is exported once for the file as a page at 640 × 360 and 30 fps.
//
// asserts:
//   - AC1: the receipt and the manifest hold 24 states, one for each stage × explode × finish, the start the defaults;
//     each state's still, decoded to BGRA8 and hashed with BLAKE3, equals `receipt.frame_hashes[0]` of the app's own
//     png_seq export of that state (the document on an input track that sets its three controls at 0.5 s, the still
//     at 2 s, settled). Wrong program: the page with two states' stills swapped, which fails naming the state.
//   - AC1: in Google Chrome with networking off (README: The browser), the page opened from disk shows the start
//     state; a walk that takes every action in every state exactly once (a circuit), clicking each of the seven
//     targets and pressing each of the eight keys, lands each time in the state whose controls the action sets,
//     playing an edge when they change and none when they don't, shows the seven targets in every state, reaches all
//     24 states, and the page starts no request outside its own files. Wrong program: a copy of the page that asks the
//     network for one picture, which fails naming the URL, while the request reaches nothing.
//   - AC7: the same browser and walk, by keyboard: in every state Tab reaches each of the seven targets, and Enter on
//     each plays its edge to the state it picks; each state's accessibility tree read in the browser (README: The
//     page's tree) equals, node for node and in order, the app's tree (#376's `see`) after the same three controls
//     are set. The planted `page_targets_on_image` (the scenario's `planted`) fails, naming the first target.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, COMBOS, DEFAULTS, DOC, EXPLODE_KEY, FINISHES, FINISH_KEYS, FULL, Headless, Listener, STAGES, STAGE_KEYS, TARGETS, TIMEOUT, WALK_RATE, WALK_SIZE,
  appStills, circuit, comboKey, comboOf, comboTrack, failsNaming, fl, manifestOf, none, pageExport, pageReceiptOf, present, presented, runShow,
  scenarioOf, stillHash, treeFailures, treeOf, useFileTemp, useShow, useTemp, walkthrough,
  type Combo, type JsonObject, type JsonValue, type Manifest, type PageReceipt, type PageState, type TreeNode, type WebPage,
} from './helpers.ts';

const shows = useShow([FULL]);
const keep = useFileTemp();
const temp = useTemp();

interface Exported { out: string; receipt: PageReceipt; manifest: Manifest; byCombo: Map<string, PageState> }
let walk: Exported | null = null;
/** The walkthrough's page, exported once for the file. */
function walkPage(): Exported {
  if (!walk) {
    const out = join(keep(), 'page');
    const r = runShow(shows(FULL), scenarioOf({ evidence: keep(), docs: [DOC.walk], calls: [present(DOC.walk, walkthrough()), pageExport(DOC.walk, out, { size: WALK_SIZE, rate: WALK_RATE })] }), 'the walkthrough page');
    presented(r[0], 'the walkthrough');
    const receipt = pageReceiptOf(r[1], 'the walkthrough page');
    const manifest = manifestOf(out, 'the walkthrough page');
    const byCombo = new Map<string, PageState>();
    for (const s of manifest.states) { const c = comboOf(s); if (c) byCombo.set(comboKey(c), s); }
    walk = { out, receipt, manifest, byCombo };
  }
  return walk;
}

let trees: Map<string, TreeNode[]> | null = null;
/** The app's accessibility tree in each state: the walkthrough shown on a 640 × 360 panel on #383's virtual clock, its
 * three controls set by `input` (#504's control events) every 3 s, and #376's `see` 2 s after each, settled. */
function appTrees(): Map<string, TreeNode[]> {
  if (!trees) {
    const input = (s: number, control: string, value: JsonValue): JsonObject => ({ call: 'input', at: fl(s), panel: 'main', event: { type: 'control', control, value } });
    const calls: JsonObject[] = [present(DOC.walk, walkthrough(), { at: fl(0.05) })];
    COMBOS.forEach((c, k) => {
      const t = 1 + 3 * k;
      calls.push(input(t, 'tour', c.tour), input(t + 0.05, 'explode', c.explode), input(t + 0.1, 'finish', c.finish), { call: 'see', at: fl(t + 2), panel: 'main' });
    });
    const r = runShow(shows(FULL), scenarioOf({ evidence: keep(), docs: [DOC.walk], calls, clock: true, panel: WALK_SIZE }), "the app's tree in each state");
    presented(r[0], "the walkthrough on the app's panel");
    trees = new Map(COMBOS.map((c, k) => [comboKey(c), treeOf(r[4 + 4 * k], `the app's tree in ${comboKey(c)}`)]));
    for (const [key, tree] of trees) {
      const buttons = tree.filter((n) => n.role === 'button').map((n) => n.id).sort();
      expect(buttons, `the fixture: the app's tree in ${key} lists the walkthrough's seven targets as buttons`).toEqual([...TARGETS].sort());
    }
  }
  return trees;
}

/** Each state's still against the app's still of that state; `stillOf` may hand a state another's still (the wrong program). */
function stillFailures(w: Exported, app: Map<string, string>, stillOf: (s: PageState) => string = (s) => s.still): string[] {
  const f: string[] = [];
  for (const c of COMBOS) {
    const key = comboKey(c);
    const s = w.byCombo.get(key);
    if (!s) { f.push(`the page has no state for ${key}`); continue; }
    const got = stillHash(w.out, stillOf(s), `state ${s.id} (${key})`);
    if (got !== app.get(key)) f.push(`state ${s.id} (${key}): its still decodes to ${got}, the app's export of that state recorded ${String(app.get(key))}`);
  }
  return f;
}

type Action = { kind: 'click'; target: string } | { kind: 'key'; key: string };
const ACTIONS: Action[] = [
  ...TARGETS.map((target): Action => ({ kind: 'click', target })),
  ...STAGES.map((s): Action => ({ kind: 'key', key: STAGE_KEYS[s] })),
  { kind: 'key', key: EXPLODE_KEY },
  ...FINISHES.map((f): Action => ({ kind: 'key', key: FINISH_KEYS[f] })),
];
const describeAction = (a: Action): string => (a.kind === 'click' ? `a click on ${a.target}` : `the key ${a.key}`);
/** The controls an action leaves: a target picks its option, a key sets its value, the explode key flips the toggle. */
function apply(c: Combo, a: Action): Combo {
  const pick = a.kind === 'click' ? a.target : null;
  if (pick?.startsWith('tour/')) return { ...c, tour: pick.slice(5) };
  if (pick?.startsWith('finish/')) return { ...c, finish: pick.slice(7) };
  if (a.kind === 'key' && a.key === EXPLODE_KEY) return { ...c, explode: !c.explode };
  const stage = STAGES.find((s) => a.kind === 'key' && STAGE_KEYS[s] === a.key);
  if (stage) return { ...c, tour: stage };
  const finish = FINISHES.find((f) => a.kind === 'key' && FINISH_KEYS[f] === a.key);
  if (finish) return { ...c, finish };
  throw Error(`harness: no action ${JSON.stringify(a)}`);
}
const comboAt = (key: string): Combo => COMBOS.find((c) => comboKey(c) === key)!;

/** AC1's walk: every action in every state once, by click and by key. */
async function clickAndKeyWalk(page: WebPage, w: Exported): Promise<string[]> {
  const f: string[] = [];
  const idOf = (c: Combo): string | null => w.byCombo.get(comboKey(c))?.id ?? null;
  const arcs = COMBOS.flatMap((c) => ACTIONS.map((action) => ({ from: comboKey(c), to: comboKey(apply(c, action)), action })));
  const start = await page.now();
  if (start.state !== idOf(DEFAULTS)) return [`the page opens on ${String(start.state)}, not the start state ${String(idOf(DEFAULTS))} (${comboKey(DEFAULTS)})`];
  const reached = new Set<string>([start.state!]);
  const looked = new Set<string>();
  for (const arc of circuit(arcs, comboKey(DEFAULTS))) {
    const fromId = idOf(comboAt(arc.from)); const toId = idOf(comboAt(arc.to));
    if (!fromId || !toId) return [...f, `the page has no state for ${fromId ? arc.to : arc.from}`];
    if (!looked.has(fromId)) {
      looked.add(fromId);
      const shown = (await page.targets()).sort();
      if (shown.join(',') !== [...TARGETS].sort().join(',')) f.push(`state ${fromId} (${arc.from}) shows the targets [${shown.join(', ')}], not the document's [${TARGETS.join(', ')}]`);
    }
    const before = (await page.now()).edges;
    if (arc.action.kind === 'click') {
      const err = await page.click(arc.action.target);
      if (err) return [...f, `in state ${fromId} (${arc.from}): ${err}`];
    } else await page.press(arc.action.key);
    const miss = await page.land(toId, toId !== fromId, before);
    if (miss) return [...f, `in state ${fromId} (${arc.from}), ${describeAction(arc.action)}: the page ${miss} (${arc.to})`];
    reached.add(toId);
  }
  const never = w.manifest.states.map((s) => s.id).filter((id) => !reached.has(id));
  if (never.length || reached.size !== 24) f.push(`the walk reached ${reached.size} states, not all 24; never ${never.join(', ')}`);
  return f;
}

/** One state's keyboard and tree checks: Tab reaches all seven targets, and the page's tree equals the app's. */
async function stateFailures(page: WebPage, id: string, key: string, app: readonly TreeNode[]): Promise<string[]> {
  const f = treeFailures(`state ${id} (${key})`, app, await page.tree());
  const reached = await page.tabSweep();
  for (const t of TARGETS) if (!reached.includes(t)) f.push(`state ${id} (${key}): Tab never reaches the target ${t}; it reaches [${reached.join(', ')}]`);
  return f;
}
/** AC7's walk: in each half (together, apart) every target's Enter in every state once, then the explode key. */
async function keyboardWalk(page: WebPage, w: Exported, app: Map<string, TreeNode[]>): Promise<string[]> {
  const f: string[] = [];
  const idOf = (c: Combo): string | null => w.byCombo.get(comboKey(c))?.id ?? null;
  const looked = new Set<string>();
  for (const explode of [false, true]) {
    const home: Combo = { ...DEFAULTS, explode };
    const half = COMBOS.filter((c) => c.explode === explode);
    const arcs = half.flatMap((c) => TARGETS.map((target) => ({ from: comboKey(c), to: comboKey(apply(c, { kind: 'click', target })), target })));
    for (const arc of circuit(arcs, comboKey(home))) {
      const fromId = idOf(comboAt(arc.from)); const toId = idOf(comboAt(arc.to));
      if (!fromId || !toId) return [...f, `the page has no state for ${fromId ? arc.to : arc.from}`];
      if (!looked.has(fromId)) { looked.add(fromId); f.push(...(await stateFailures(page, fromId, arc.from, app.get(arc.from)!))); }
      const missed = await page.tabTo(arc.target);
      if (missed) return [...f, `in state ${fromId} (${arc.from}), Tab never reaches the target ${arc.target}; it reaches [${missed.join(', ')}]`];
      const before = (await page.now()).edges;
      await page.press('Enter');
      const miss = await page.land(toId, toId !== fromId, before);
      if (miss) return [...f, `in state ${fromId} (${arc.from}), Enter on ${arc.target}: the page ${miss} (${arc.to})`];
    }
    if (!explode) {
      const before = (await page.now()).edges;
      await page.press(EXPLODE_KEY);
      const to = idOf({ ...DEFAULTS, explode: true });
      const miss = to === null ? 'has no state for the exploded start' : await page.land(to, true, before);
      if (miss) return [...f, `the key ${EXPLODE_KEY} in the start state: the page ${miss}`];
    }
  }
  if (looked.size !== 24) f.push(`the keyboard walk looked at ${looked.size} states, not 24`);
  return f;
}

describe(`${AC[1]} the walkthrough's page: 24 states, every target clicked and key pressed with networking off, stills equal to the app's`, () => {
  it(`${AC[1]} the page holds 24 states, one per stage × explode × finish, and each state's still decodes to the raw frame hash the app's export of that state recorded`, () => {
    const w = walkPage();
    expect(w.receipt.states, 'the receipt counts 24 states').toBe(24);
    expect(w.manifest.states.length, 'the manifest lists 24 states').toBe(24);
    none(COMBOS.filter((c) => !w.byCombo.has(comboKey(c))).map((c) => `no state has the controls ${comboKey(c)}`), 'every stage × explode × finish is a state of its own');
    expect(comboOf(w.manifest.byId.get(w.manifest.start)!), 'the page starts in the defaults').toEqual(DEFAULTS);
    const app = appStills(shows(FULL), { evidence: temp(), doc: DOC.walk, document: walkthrough() },
      COMBOS.map((c) => ({ name: comboKey(c), track: comboTrack(c), range: { still: { t: '2s' } } })), { size: WALK_SIZE, rate: WALK_RATE }, temp(), 'the walkthrough');
    expect(new Set(app.values()).size, 'the fixture: the app draws the 24 states apart').toBe(24);
    none(stillFailures(w, app), "each state's still decodes to the app's raw frame hash for that state");
    // Wrong program: a page that shows the exploded graphite cap stage's still for the start state, and the reverse.
    const a = w.byCombo.get(comboKey(DEFAULTS)); const b = w.byCombo.get(comboKey({ tour: 'cap', explode: true, finish: 'graphite' }));
    const swapped = stillFailures(w, app, (s) => (s === a ? b!.still : s === b ? a!.still : s.still));
    failsNaming(swapped, comboKey(DEFAULTS), 'the page with two states\' stills swapped');
  }, TIMEOUT);

  it(`${AC[1]} in a browser with networking off, every target clicked and every key pressed in every state lands where its controls say, all 24 states are reached, and the page requests nothing outside its own files`, async () => {
    const w = walkPage();
    const h = await Headless.open();
    try {
      const page = await h.load(w.out, 'the walkthrough page');
      const failures = await clickAndKeyWalk(page, w);
      failures.push(...page.outside().map((u) => `the page requested ${u}, outside its own files`));
      none(failures, 'the walk by click and key, with networking off');
      await page.close();
      // Wrong program: the same page asking the network for one picture.
      const listener = new Listener();
      const leak = `http://127.0.0.1:${await listener.start()}/leak.png`;
      try {
        const copy = join(temp(), 'leaky');
        cpSync(w.out, copy, { recursive: true });
        writeFileSync(join(copy, 'index.html'), `<img src="${leak}">${readFileSync(join(copy, 'index.html'), 'utf8')}`);
        const leaky = await h.load(copy, 'the leaky copy', false);
        await leaky.pause(1_000);
        failsNaming(leaky.outside().map((u) => `the page requested ${u}, outside its own files`), leak, 'a copy of the page that asks the network for a picture');
        expect(listener.requests().length, 'with networking off the leaky request reached nothing').toBe(0);
      } finally { await listener.stop(); }
    } finally { await h.close(); }
  }, TIMEOUT);
});

describe(`${AC[7]} the walkthrough's page by keyboard: every target by Tab and Enter, and each state's tree equal to the app's`, () => {
  it(`${AC[7]} in every state every target is reachable by Tab and plays its edge on Enter, and the page's accessibility tree, read with networking off, equals the app's for that state`, async () => {
    const w = walkPage();
    const app = appTrees();
    const h = await Headless.open();
    try {
      const page = await h.load(w.out, 'the walkthrough page');
      const failures = await keyboardWalk(page, w, app);
      failures.push(...page.outside().map((u) => `the page requested ${u}, outside its own files`));
      none(failures, 'the keyboard walk and the trees, with networking off');
    } finally { await h.close(); }
  }, TIMEOUT);

  it(`${AC[7]} a page whose targets are only boxes on an image (planted page_targets_on_image) fails this test, naming the first target`, async () => {
    const app = appTrees();
    const start = app.get(comboKey(DEFAULTS))!;
    const first = start.find((n) => n.role === 'button')!.id;
    const out = join(temp(), 'page');
    const r = runShow(shows(FULL), scenarioOf({ evidence: temp(), docs: [DOC.walk], planted: 'page_targets_on_image', calls: [present(DOC.walk, walkthrough()), pageExport(DOC.walk, out, { size: WALK_SIZE, rate: WALK_RATE })] }), 'the walkthrough page, targets on the image');
    presented(r[0], 'the walkthrough');
    pageReceiptOf(r[1], 'the walkthrough page, targets on the image');
    const h = await Headless.open();
    try {
      const page = await h.load(out, 'the page with its targets on the image', false);
      const id = (await page.now()).state ?? '(no state)';
      failsNaming(await stateFailures(page, id, comboKey(DEFAULTS), start), first, 'the page whose targets are only boxes on an image');
    } finally { await h.close(); }
  }, TIMEOUT);
});
