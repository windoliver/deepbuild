// AC3: the same gestures do the same thing on a chart and a session's line, checked by one shared input test. One
// gesture script runs against both documents, each presented by an agent's deep_show on an 800 × 450 panel, and
// each gesture starts from the document's own camera: drag pans, scroll zooms, pinch zooms, click selects and opens
// the panel, double-click flies in, Esc backs out, and ⌘K flies to a name. The scope's own rules ride on the same
// runs: one commit per gesture, on the input that ends it, and no picking mid-gesture. Driven through `deep-show
// run`'s `input` and `scope` calls on the virtual clock (README: The surface under test). At the base `deep-show`
// has no `input` or `scope` call and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  Driver, DOC, PANEL, SHOW_BIN, boxOf, center, down, fixture, inputOf, inside, key, move, nameOf, toContent, toScreen, uPerPx, up, useBins, useOut, viewBox, within,
  type Input, type JsonObject, type Point, type Scope, type ShowPlanted,
} from './helpers.ts';

const bins = useBins([SHOW_BIN]);
const out = useOut();

interface Target { name: 'chart' | 'line'; doc: JsonObject; click: string; fly: string; find: string }
const TARGETS: Target[] = [
  { name: 'chart', doc: fixture('chart.json'), click: 'bar-wed', fly: 'bar-thu', find: 'bar-fri' },
  { name: 'line', doc: fixture('line.json'), click: 'ev-3', fly: 'ev-4', find: 'ev-5' },
];
// Points in the panel (window px) that are empty on both documents at their own cameras: where a drag starts, a
// scroll and a pinch happen, and the click that focuses the panel before ⌘K lands.
const EMPTY: Point = [180, 330];
const SCROLL_AT: Point = [400, 120];
const PINCH_AT: Point = [600, 60];
const DRAG_STEP: Point = [30, 12];
const PINCH = [1.25, 1.25, 0.9];
const PINCH_PRODUCT = PINCH.reduce((a, b) => a * b, 1); // 1.40625

type Gesture = 'drag' | 'scroll' | 'pinch' | 'click' | 'double-click' | 'esc' | 'cmd-k';
const GESTURES: Gesture[] = ['drag', 'scroll', 'pinch', 'click', 'double-click', 'esc', 'cmd-k'];
interface Played { start: Scope; events: { type: string; reply: Input }[] }

const clickAt = (at: (g?: number) => number, p: Point): JsonObject[] => [
  { call: 'input', at: at(60), panel: 'main', event: down(p) }, { call: 'input', at: at(1500), panel: 'main', event: up(p) },
];
const doubleAt = (at: (g?: number) => number, p: Point): JsonObject[] => [
  { call: 'input', at: at(40), panel: 'main', event: down(p) }, { call: 'input', at: at(80), panel: 'main', event: up(p) },
  { call: 'input', at: at(40), panel: 'main', event: down(p) }, { call: 'input', at: at(1500), panel: 'main', event: up(p) },
];

/** The gesture's input calls, made from the state the document starts in. */
function script(g: Gesture, t: Target, s: Scope): (at: (gapMs?: number) => number) => JsonObject[] {
  const onItem = (id: string): Point => toScreen(s, center(boxOf(t.doc, id)));
  return (at) => {
    const ev = (event: JsonObject, gap: number): JsonObject => ({ call: 'input', at: at(gap), panel: 'main', event });
    switch (g) {
      case 'drag': {
        const path = Array.from({ length: 5 }, (_, i): Point => [EMPTY[0] + (i + 1) * DRAG_STEP[0], EMPTY[1] + (i + 1) * DRAG_STEP[1]]);
        return [ev(down(EMPTY), 16), ...path.map((p) => ev(move(p), 16)), ev(up(path[4]!), 1500)];
      }
      case 'scroll':
        return [ev({ type: 'scroll', phase: 'begin', pos: SCROLL_AT, delta: [0, 0] }, 16),
          ...[0, 1, 2].map(() => ev({ type: 'scroll', phase: 'change', pos: SCROLL_AT, delta: [0, -40] }, 16)),
          ev({ type: 'scroll', phase: 'end', pos: SCROLL_AT, delta: [0, 0] }, 1500)];
      case 'pinch':
        return [ev({ type: 'pinch', phase: 'begin', pos: PINCH_AT, scale: 1 }, 16),
          ...PINCH.map((k) => ev({ type: 'pinch', phase: 'change', pos: PINCH_AT, scale: k }, 16)),
          ev({ type: 'pinch', phase: 'end', pos: PINCH_AT, scale: 1 }, 1500)];
      case 'click': return clickAt(at, onItem(t.click));
      case 'double-click': return doubleAt(at, onItem(t.fly));
      case 'esc': return [...doubleAt(at, onItem(t.fly)), ev(key('Escape'), 1500)];
      case 'cmd-k': return [...clickAt(at, EMPTY), ev(key('k', ['cmd']), 300), ev({ type: 'text', text: nameOf(t.doc, t.find) }, 300), ev(key('Return'), 1500)];
    }
  };
}

function play(g: Gesture, t: Target, planted?: ShowPlanted): Played {
  const d = new Driver(bins.bin(SHOW_BIN), out, [{ doc: DOC, panel: 'main', rect: PANEL, document: t.doc }], 'main', planted);
  const start = d.scope(`${t.name}: its scope before any input`);
  for (const p of [EMPTY, SCROLL_AT, PINCH_AT]) {
    const c = toContent(start, p);
    const hit = Object.keys(t.doc['items'] as JsonObject).filter((id) => id !== 'cam' && within(boxOf(t.doc, id), c));
    expect(hit, `${t.name}: the suite's point ${JSON.stringify(p)} is empty at the document's own camera`).toEqual([]);
    expect(start.buttons.filter((b) => within(b.rect, p)).map((b) => b.verb), `${t.name}: the suite's point ${JSON.stringify(p)} isn't on one of the canvas's buttons`).toEqual([]);
  }
  const calls = script(g, t, start);
  const replies = d.step(calls, `${t.name}: ${g}${planted ? ` (planted ${planted})` : ''}`);
  const made = calls(() => 0);
  return { start, events: replies.map((r, i) => ({ type: String((made[i]!['event'] as JsonObject)['type']) + (typeof (made[i]!['event'] as JsonObject)['phase'] === 'string' ? `:${String((made[i]!['event'] as JsonObject)['phase'])}` : ''), reply: inputOf(r, `${t.name} ${g}: input ${i + 1}`) })) };
}

const near = (a: Point, b: Point, s: Scope): number => Math.hypot(a[0] - b[0], a[1] - b[1]) / uPerPx(s);
const sameCamera = (a: Scope, b: Scope): boolean => a.camera.target.every((v, i) => Object.is(v, b.camera.target[i])) && Object.is(a.camera.view_width, b.camera.view_width);

/** What each gesture must do, as failures (empty when it does), plus the numbers compared across the two documents. */
function outcome(g: Gesture, t: Target, p: Played): { failures: string[]; measure: number | null } {
  const f: string[] = [];
  const s0 = p.start;
  const at = (i: number): Scope => p.events[i]!.reply.state;
  const last = at(p.events.length - 1);
  switch (g) {
    case 'drag': {
      const grabbed = toContent(s0, EMPTY);
      p.events.slice(1).forEach((e, i) => {
        const pos: Point = [EMPTY[0] + Math.min(i + 1, 5) * DRAG_STEP[0], EMPTY[1] + Math.min(i + 1, 5) * DRAG_STEP[1]];
        const off = near(toContent(e.reply.state, pos), grabbed, e.reply.state);
        if (off > 0.5) f.push(`drag: after input ${i + 2} (${e.type}) the content grabbed at ${JSON.stringify(EMPTY)} is ${off.toFixed(2)} px from the pointer: a drag pans, the content following the pointer`);
        if (!Object.is(e.reply.state.camera.view_width, s0.camera.view_width)) f.push(`drag: input ${i + 2} changed the view width from ${s0.camera.view_width} to ${e.reply.state.camera.view_width}; a drag pans, it doesn't zoom`);
      });
      if (JSON.stringify(last.selection) !== JSON.stringify(s0.selection) || JSON.stringify(last.level) !== JSON.stringify(s0.level)) f.push(`drag: the drag changed the selection or the level (${JSON.stringify(last.selection)}, ${JSON.stringify(last.level)})`);
      return { failures: f, measure: (last.camera.target[0] - s0.camera.target[0]) / uPerPx(s0) };
    }
    case 'scroll':
    case 'pinch': {
      const point = g === 'scroll' ? SCROLL_AT : PINCH_AT;
      const under = toContent(s0, point);
      p.events.forEach((e, i) => {
        const off = near(toContent(e.reply.state, point), under, e.reply.state);
        if (off > 0.5) f.push(`${g}: after input ${i + 1} (${e.type}) the content under the pointer moved ${off.toFixed(2)} px: a ${g} zooms toward the pointer`);
      });
      const ratio = last.camera.view_width / s0.camera.view_width;
      if (Math.abs(ratio - 1) < 1e-6) f.push(`${g}: the view width stayed ${last.camera.view_width}: a ${g} zooms`);
      if (g === 'pinch' && Math.abs(ratio * PINCH_PRODUCT - 1) > 1e-9) f.push(`pinch: the view width went from ${s0.camera.view_width} to ${last.camera.view_width}, a factor of ${ratio}, not 1 ÷ ${PINCH_PRODUCT}: a pinch multiplies the zoom by its scale (#372)`);
      return { failures: f, measure: ratio };
    }
    case 'click':
      if (JSON.stringify(last.selection) !== JSON.stringify([t.click])) f.push(`click: the selection is ${JSON.stringify(last.selection)}, not [${t.click}]: a click selects`);
      if (last.details !== t.click) f.push(`click: the panel shows ${JSON.stringify(last.details)}, not ${t.click}: a click opens the panel`);
      if (!sameCamera(last, s0)) f.push('click: the camera moved; framing comes only from navigation, never from a click');
      if (JSON.stringify(last.level) !== JSON.stringify(s0.level)) f.push(`click: the level changed to ${JSON.stringify(last.level)}`);
      return { failures: f, measure: null };
    case 'double-click':
    case 'esc': {
      const flown = at(3);
      if (!sameCamera(at(1), s0)) f.push(`${g}: the double-click's first click moved the camera; a click never frames`);
      if (JSON.stringify(flown.level) !== JSON.stringify([t.fly])) f.push(`double-click: the level is ${JSON.stringify(flown.level)}, not [${t.fly}]: a double-click flies in`);
      if (!inside(viewBox(flown), boxOf(t.doc, t.fly))) f.push(`double-click: ${t.fly} isn't wholly in view after flying in: ${JSON.stringify(viewBox(flown))}`);
      if (!(flown.camera.view_width < s0.camera.view_width)) f.push(`double-click: the view width went from ${s0.camera.view_width} to ${flown.camera.view_width}; flying in comes closer`);
      if (g === 'esc') {
        if (JSON.stringify(last.level) !== JSON.stringify(s0.level)) f.push(`Esc: the level is ${JSON.stringify(last.level)}, not back at ${JSON.stringify(s0.level)}: Esc backs out`);
        if (!(last.camera.view_width > flown.camera.view_width)) f.push(`Esc: the view width stayed at ${last.camera.view_width}; backing out goes back out`);
      }
      return { failures: f, measure: null };
    }
    case 'cmd-k': {
      const name = nameOf(t.doc, t.find);
      if (!at(2).palette.open) f.push('⌘K: the palette didn\'t open');
      if (at(3).palette.query !== name) f.push(`⌘K: the palette's query is ${JSON.stringify(at(3).palette.query)}, not ${JSON.stringify(name)}`);
      if (last.palette.open) f.push('⌘K: the palette is still open after Return');
      if (last.level[last.level.length - 1] !== t.find) f.push(`⌘K: the level is ${JSON.stringify(last.level)}, not at ${t.find} ("${name}"): ⌘K flies to it by name`);
      if (!inside(viewBox(last), boxOf(t.doc, t.find))) f.push(`⌘K: ${t.find} isn't wholly in view after flying to it`);
      return { failures: f, measure: null };
    }
  }
}

/** One commit per gesture, on the input that ends it, and no picking while it runs, as failures. */
function scopeFailures(g: Gesture, p: Played): string[] {
  const f: string[] = [];
  let pressedHover: string | null = null;
  p.events.forEach((e, i) => {
    const r = e.reply;
    const label = `${g}: input ${i + 1} (${e.type})`;
    // A double-click's first release ends a click only if the scope treats it as one: it commits at most once.
    const firstOfDouble = e.type === 'up' && p.events[i + 1]?.type === 'down';
    const ends = !firstOfDouble && (e.type === 'up' || e.type.endsWith(':end') || (e.type === 'key' && (g === 'esc' || i === p.events.length - 1)));
    const begins = e.type === 'down' || e.type.endsWith(':begin');
    const mid = e.type === 'move' || e.type.endsWith(':change');
    if (begins) pressedHover = r.state.hover;
    if (ends && (r.commits.length !== 1 || r.commits[0] !== r.serial)) f.push(`${label} ends a gesture and commits ${JSON.stringify(r.commits)}, not once with its own serial ${r.serial}`);
    if (firstOfDouble && (r.commits.length > 1 || r.commits.some((c) => c !== r.serial))) f.push(`${label} commits ${JSON.stringify(r.commits)}; a release commits at most once, with its own serial ${r.serial}`);
    if ((begins || mid) && r.commits.length !== 0) f.push(`${label} commits ${JSON.stringify(r.commits)} while the gesture runs; a gesture commits once, when it ends`);
    if (mid && r.picks !== 0) f.push(`${label} ran ${r.picks} hit tests mid-gesture`);
    if (mid && r.state.hover !== pressedHover) f.push(`${label} moved the hover to ${JSON.stringify(r.state.hover)} mid-gesture`);
  });
  return f;
}

const played = new Map<string, Played>();
const get = (g: Gesture, t: Target): Played => {
  const k = `${g}:${t.name}`;
  if (!played.has(k)) played.set(k, play(g, t));
  return played.get(k)!;
};

describe('AC3 the same gestures do the same thing on a chart and a session\'s line', () => {
  it('AC3 one shared input test: drag pans, scroll and pinch zoom, click selects and opens the panel, double-click flies in, Esc backs out, ⌘K flies to a name, on both', () => {
    const failures: string[] = [];
    for (const g of GESTURES) {
      const [chart, line] = TARGETS.map((t) => outcome(g, t, get(g, t)));
      for (const [i, o] of [chart!, line!].entries()) failures.push(...o.failures.map((x) => `${TARGETS[i]!.name}: ${x}`));
      if (chart!.measure !== null && line!.measure !== null && Math.abs(chart!.measure - line!.measure) > 1e-9 * Math.max(1, Math.abs(chart!.measure))) {
        failures.push(`${g} did different things: ${chart!.measure} on the chart, ${line!.measure} on the line (${g === 'drag' ? 'the pan in px' : 'the view width\'s factor'})`);
      }
    }
    expect(failures, 'every gesture does what the design says, the same on the chart and the line').toEqual([]);

    // Wrong program: a line whose scroll pans in time instead of zooming fails, naming the line's scroll.
    const twin = outcome('scroll', TARGETS[1]!, play('scroll', TARGETS[1]!, 'line_scroll_pans')).failures;
    expect(twin.some((x) => x.startsWith('scroll:')), `the planted line_scroll_pans fails the line's scroll: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);

  it('AC3 one interaction scope owns every gesture: one commit per gesture, on the input that ends it, and no picking mid-gesture, on both', () => {
    const failures = GESTURES.flatMap((g) => TARGETS.flatMap((t) => scopeFailures(g, get(g, t)).map((x) => `${t.name}: ${x}`)));
    expect(failures, 'one commit per gesture and no picking mid-gesture').toEqual([]);

    // Wrong programs: committing on every move, and hit-testing on every move, each fail on the chart's drag.
    const commits = scopeFailures('drag', play('drag', TARGETS[0]!, 'commit_every_move'));
    expect(commits.some((x) => x.includes('while the gesture runs')), `the planted commit_every_move fails: ${JSON.stringify(commits)}`).toBe(true);
    const picks = scopeFailures('drag', play('drag', TARGETS[0]!, 'pick_mid_gesture'));
    expect(picks.some((x) => x.includes('hit tests mid-gesture')), `the planted pick_mid_gesture fails: ${JSON.stringify(picks)}`).toBe(true);
  }, 600_000);
});
