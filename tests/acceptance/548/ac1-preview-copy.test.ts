// #548.1e9cd89b: A hex board whose preview writes the 12-cell route from the selected unit to the hovered hex: hovering
// 40 hexes in turn changes no full-state hash, step hash, bake byte or input-track entry against the same run without
// hovering, and an export's frames draw the route array at its default, empty; a planted preview that writes into the
// item's own memory instead of the copy fails, naming the first checkpoint whose full-state hash differs from the run
// without hovering; and a preview that loops forever traps with kind fuel, its arrays clear, and the item plays on
//
// The hex board is `game` (programs.ts) in a live view of `deep-logic` (README: deep-logic), played a frame at a time at
// 60 frames a second for 4 s, with its point control's hover set by each frame's `hover` (README: frame `hover`). The
// run with hovering moves the pointer over the 40 hexes 11 from the unit, two frames each from frame 61; the run
// without has no hover. Every frame's full-state hash, the session's bake (`baked`: its step hashes, checkpoints, bytes
// and input track) are compared; the routes the frames draw are this suite's own `routeOf`. The planted
// `preview_writes_item_memory` runs the preview on the item's own instance, so its first changed checkpoint is the one
// at step 120, the first after the first hovered frame. The export half runs the same board in deep-show.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_PREVIEW, HOVERS, MOVE_STEP, ROUTE, TRAP, U0, U1, game, litOf, probe, routeOf, type Cell } from './programs.ts';
import { HEX_PAGE, gamePiece, hexCentre, hexDoc, putAtlas } from './fixtures.ts';
import {
  AC, DOC, MS, STEP, TIMEOUT, admitted, bakeCall, bakeOf, bakedOf, camOf, checkCall, failsNaming, firstDiff, live, logic, logicBin, none,
  offsetIn, openView, prebuild, presented, putEvidence, runShow, same, scenario, sha256, show, showBin, showCall, toPanel, useTemp,
  type Baked, type Frame, type JsonObject, type JsonValue, type LogicPlanted,
} from './helpers.ts';

prebuild(() => { logicBin(); showBin(); });
const temp = useTemp();
/** Frames the view plays: 4 s at 60 frames a second, each one step on. */
const FRAMES = 240;
const FIRST_HOVER = 61;
const NO_HOVER_FROM = FIRST_HOVER + 2 * HOVERS.length;

/** The hex board's program, built against the layout `check` gives its item. */
function program(): ReturnType<typeof game> {
  const [reply] = logic([checkCall(gamePiece(probe()))]);
  const l = admitted(reply!, 'check of the hex board\'s item (its preview included)')['game']!;
  return game({ unit: offsetIn(l, 'writes', 'unit'), here: offsetIn(l, 'writes', 'here') });
}
/** The hover a frame sets (README: frame `hover`): the 40 hexes two frames each from frame 61, then the pointer leaves. */
function hoverAt(n: number): Cell | null | undefined {
  if (n >= FIRST_HOVER && n < NO_HOVER_FROM && (n - FIRST_HOVER) % 2 === 0) return HOVERS[(n - FIRST_HOVER) / 2]!;
  if (n === NO_HOVER_FROM) return null;
  return undefined;
}
interface Run { frames: Frame[]; baked: Baked }
/** A view of the board played frame by frame through `frames` frames, hovering or not, and its bake. */
async function play(p: JsonObject, hovering: boolean, frames: number, planted: LogicPlanted[] = [], hover: (n: number) => Cell | null | undefined = hoverAt): Promise<Run> {
  const l = live(planted);
  try {
    const v = await openView(l, p, 5);
    const out: Frame[] = [];
    for (let n = 1; n <= frames; n++) {
      const h = hovering ? hover(n) : undefined;
      const { landed } = await v.frame({ play: true, ...(h !== undefined ? { hover: { place: h } } : {}) });
      out.push(landed);
    }
    return { frames: out, baked: bakedOf(await l.call({ call: 'baked', session: v.session }), `baked of the view (${planted.join(', ') || 'the real program'})`) };
  } finally {
    l.stop();
  }
}
/** The route a frame draws: `game.preview.route` as drawing reads it (README: draws). */
const routeIn = (f: Frame): JsonValue[] | undefined => f.draws['game.preview.route'];
const litIn = (f: Frame): JsonValue[] | undefined => f.draws['game.preview.lit'];
const unitAfter = (n: number): Cell => (n >= MOVE_STEP ? U1 : U0);
const at = (f: Frame): string => `frame ${f.frame} (t ${(f.t / (60 * STEP)).toFixed(4)} s)`;

/**
 * The criterion's judgement of a run with hovering against the same run without: the first frame whose full-state hash
 * differs, every step hash, the first checkpoint whose full-state hash differs (named), the bake's bytes and its input
 * track.
 */
function judge(without: Run, hovering: Run): string[] {
  const failures: string[] = [];
  const f = hovering.frames.find((x, i) => JSON.stringify(x.deep_hash) !== JSON.stringify(without.frames[i]?.deep_hash));
  if (f) failures.push(`${at(f)}: its full-state hash differs from the run without hovering`);
  const hashes = (r: Run): JsonValue[] => r.baked.steps.map((s) => s.items['game']?.hash ?? null);
  const d = firstDiff(hashes(hovering), hashes(without));
  if (d) failures.push(`the step hashes differ from the run without hovering at step ${d}`);
  const cs = hovering.baked.checkpoints['game'] ?? [];
  const ws = without.baked.checkpoints['game'] ?? [];
  if (JSON.stringify(cs.map((c) => c.step)) !== JSON.stringify(ws.map((c) => c.step))) failures.push(`the checkpoints are taken at other steps: ${show(cs.map((c) => c.step))} against ${show(ws.map((c) => c.step))}`);
  const c = cs.find((x) => ws.find((w) => w.step === x.step)?.deep_hash !== x.deep_hash);
  if (c) failures.push(`the first checkpoint whose full-state hash differs from the run without hovering: checkpoint ${c.step} (${c.deep_hash} against ${ws.find((w) => w.step === c.step)?.deep_hash ?? 'none'})`);
  if (!hovering.baked.bytes.equals(without.baked.bytes)) {
    const i = [...hovering.baked.bytes].findIndex((b, k) => b !== without.baked.bytes[k]);
    failures.push(`the bake's bytes differ from the run without hovering, first at byte ${i < 0 ? Math.min(hovering.baked.bytes.length, without.baked.bytes.length) : i} (${hovering.baked.bytes.length} against ${without.baked.bytes.length} bytes)`);
  }
  if (JSON.stringify(hovering.baked.track) !== JSON.stringify(without.baked.track)) failures.push(`the input track differs from the run without hovering: ${show(hovering.baked.track, 400)} against ${show(without.baked.track, 400)}`);
  return failures;
}
/** What the run with hovering draws: each hovered frame the route from the unit's cell then, and nothing once the pointer left. */
function drawsRoutes(r: Run): string[] {
  const failures: string[] = [];
  let hovered: Cell | null = null;
  for (const [i, f] of r.frames.entries()) {
    const n = i + 1;
    const h = hoverAt(n);
    if (h !== undefined) hovered = h;
    const route = hovered ? routeOf(unitAfter(n), hovered) : new Array<number>(ROUTE).fill(0);
    if (!same(routeIn(f), route)) failures.push(`${at(f)}: route ${show(routeIn(f) ?? null, 200)}, not ${show(route)} (the hover ${show(hovered)}, the unit at ${show(unitAfter(n))})`);
    if (!same(litIn(f), litOf(route))) failures.push(`${at(f)}: lit isn't the route's cells`);
    if (f.previews === null || f.previews > 1) failures.push(`${at(f)}: previews ${show(f.previews)}: the preview runs at most once a frame`);
    if (h !== undefined && f.previews !== 1) failures.push(`${at(f)}: the hover changed and the preview didn't run (previews ${show(f.previews)})`);
  }
  return failures;
}

const cache = new Map<string, Promise<Run>>();
const runOf = (key: string, make: () => Promise<Run>): Promise<Run> => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key)!; };

describe(`${AC[1]} the hex board's preview runs on a throwaway copy: hovering changes nothing that is hashed, baked or recorded`, () => {
  it(`${AC[1]} hovering 40 hexes in turn changes no full-state hash, step hash, bake byte or input-track entry; the planted preview_writes_item_memory fails, naming checkpoint 120`, async () => {
    const p = gamePiece(program());
    const without = await runOf('without', () => play(p, false, FRAMES));
    const hovering = await runOf('hovering', () => play(p, true, FRAMES));
    // The harness first: the frames land on their times, the route is drawn while hovering, and the session's bake is the logic module's.
    hovering.frames.forEach((f, i) => expect([f.t, f.at], `${at(f)} lands at ${i + 1}/60 s with steps 0 to ${i + 1} run`).toEqual([(i + 1) * STEP, i + 2]));
    none(drawsRoutes(hovering), 'the board previews the route to each hovered hex');
    expect(HOVERS.every((h) => routeOf(U0, h).every((c) => c > 0)), 'each of the 40 hexes is 11 from the unit: a 12-cell route').toBe(true);
    const [b] = logic([bakeCall(p, FRAMES + 1)]);
    const bake = bakeOf(b!, `bake of the board, ${FRAMES + 1} steps`);
    expect(without.baked.steps.map((s) => s.items['game']?.hash), 'the session\'s bake holds the step hashes a bake of the same piece gives').toEqual(bake.steps.map((s) => s.items['game']?.hash));
    expect(without.baked.checkpoints['game'], 'and its checkpoints').toEqual(bake.checkpoints['game']);
    expect(without.baked.bytes.length, 'the session\'s bake has bytes').toBeGreaterThan(0);
    expect(without.baked.track, 'no hover is ever an entry: the input track stays empty').toEqual([]);
    none(judge(without, hovering), 'hovering 40 hexes against the run without hovering');

    // The planted twin: the real program passed on the same input above.
    const pw = await play(p, false, FRAMES, ['preview_writes_item_memory']);
    const ph = await play(p, true, FRAMES, ['preview_writes_item_memory']);
    const failures = judge(pw, ph);
    console.log(`${AC[1]} preview_writes_item_memory:\n  ${failures.join('\n  ')}`);
    failsNaming(failures, [/^the first checkpoint whose full-state hash differs from the run without hovering: checkpoint 120\b/], 'the planted preview_writes_item_memory');
  }, TIMEOUT);

  it(`${AC[1]} a preview that loops forever traps with kind fuel, its arrays clear, and the item plays on`, async () => {
    const p = gamePiece(program());
    const without = await runOf('without', () => play(p, false, FRAMES));
    const HOVER_AT = 30;
    const trapHover = (n: number): Cell | null | undefined => (n === HOVER_AT ? HOVERS[0]! : n === HOVER_AT + 1 ? TRAP : undefined);
    const r = await play(p, true, 90, [], trapHover);
    const before = r.frames[HOVER_AT - 1]!;
    expect(routeIn(before), `${at(before)}: the route to ${show(HOVERS[0])} is drawn first`).toEqual(routeOf(U0, HOVERS[0]!));
    const failures: string[] = [];
    for (const [i, f] of r.frames.entries()) {
      if (i < HOVER_AT) continue;
      const w = without.frames[i];
      if (!same(routeIn(f), new Array(ROUTE).fill(0)) || !same(litIn(f), new Array(GAME_PREVIEW.writes.lit.count).fill(false))) failures.push(`${at(f)}: the preview's arrays aren't clear: route ${show(routeIn(f) ?? null, 200)}`);
      if (f.at !== i + 2) failures.push(`${at(f)}: the item stopped: it shows ${f.at} steps run, not ${i + 2}`);
      if (!w || JSON.stringify(f.deep_hash) !== JSON.stringify(w.deep_hash)) failures.push(`${at(f)}: its full-state hash differs from the run without hovering`);
      if (!w || !same(f.draws['game.unit'], w.draws['game.unit'])) failures.push(`${at(f)}: game.unit differs from the run without hovering`);
    }
    const trapped = r.frames[HOVER_AT]!;
    const traps = (trapped.traps ?? []).filter((t) => t['item'] === 'game' && t['export'] === 'preview');
    expect(traps.map((t) => t['kind']), `${at(trapped)}: the pointer on the trap hex ${show(TRAP)}: the preview traps (README: frame traps): ${show(trapped.traps)}`).toEqual(['fuel']);
    none(failures, 'after the trap: the preview\'s arrays clear, and the item plays on as the run without hovering');
    const steps = r.baked.steps.map((s) => s.items['game']?.hash ?? null);
    expect(steps.every((h) => typeof h === 'string'), 'every step the session ran has a step hash: the item never failed').toBe(true);
    expect(steps, 'and they are the run without hovering\'s').toEqual(without.baked.steps.slice(0, steps.length).map((s) => s.items['game']?.hash ?? null));
  }, TIMEOUT);

  it(`${AC[1]} an export's frames draw the route array at its default, empty, while the live view draws it under the pointer`, () => {
    const pr = program();
    const shoot = (hover: boolean): { view: string; frames: string[] } => {
      const ev = temp();
      const out = temp();
      const atlas = putAtlas(ev);
      putEvidence(ev, pr.bytes);
      const D = DOC(1);
      const doc = hexDoc('board', atlas, pr);
      const first = runShow(scenario(ev, [D], [showCall(D, doc, 1), { call: 'scope', panel: 'p1', at: 100 * MS }]), 'the board presented and its scope read');
      presented(first[0]!, 'the hex board');
      const cam = camOf(first[1]!, 'the scope');
      const calls: JsonObject[] = [showCall(D, doc, 1)];
      if (hover) calls.push({ call: 'input', panel: 'p1', event: { type: 'move', pos: toPanel(cam, hexCentre(HOVERS[0]!)) }, at: 300 * MS });
      calls.push({ call: 'view', panel: 'p1', at: 600 * MS }, { call: 'export', doc: D, out, video: { codec: 'png_seq' }, frame_rate: [4, 1], at: 700 * MS });
      const r = runShow(scenario(ev, [D], calls), `the board ${hover ? 'hovered' : 'never hovered'}, viewed and exported`);
      presented(r[0]!, 'the hex board');
      const view = r[calls.length - 2]!;
      const snap = view['snapshot'];
      expect(typeof snap === 'object' && snap !== null && !Array.isArray(snap) && typeof (snap as JsonObject)['sha256'] === 'string', `the live view gives a snapshot: ${show(view, 600)}`).toBe(true);
      expect(r[calls.length - 1]!['outcome'], `the export: ${show(r[calls.length - 1], 800)}`).toBe('exported');
      const files = readdirSync(out).filter((n) => n.endsWith('.png')).sort();
      return { view: String((snap as JsonObject)['sha256']), frames: files.map((n) => sha256(readFileSync(join(out, n)))) };
    };
    const still = shoot(false);
    const hovered = shoot(true);
    expect(hovered.view, `the live view draws the route to ${show(HOVERS[0])} under the pointer (it differs from the view never hovered)`).not.toBe(still.view);
    expect(still.frames.length, 'the export writes the span\'s frames (4 s at 4 frames a second)').toBeGreaterThanOrEqual(16);
    const d = hovered.frames.findIndex((h, i) => h !== still.frames[i]);
    expect(hovered.frames.length === still.frames.length && d < 0 ? 'every frame' : `frame ${d} of ${hovered.frames.length}`, `the export after hovering draws the route at its default, empty: its frames equal the export of the board never hovered (${HEX_PAGE.join(' × ')} u)`).toBe('every frame');
  }, TIMEOUT);
});
