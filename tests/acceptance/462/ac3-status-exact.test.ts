// AC3: "Status colors are exact in every look and region, and the legend shows whenever they do"
//
// The cross-faded edge film with status (helpers.ts: edgeDoc('fade', {status: true})): shot `one` in look a with its
// region in look b, shot `two` in look c with its region in look d, joined by a 1 s cross-fade centred on 2 s; two posts
// above the slab, `post-l` outside the region and `post-r` inside it, their badges bound to verdicts in states fail and
// running. Each look tone maps or exposes differently (filmic, AgX, neutral; EV 0 to 1), and looks b, c and d carry
// status maps of their own (fail #b93c85, running #1f7a8c); the document's own look, the call's `look`, keeps the clean
// map and no shot or region names it. `view3d` (#382's `status` report, for the call's first frame) draws 1 s (shot one),
// 2 s (inside the window) and 3 s (shot two). At each: status shows; one mark per binding, each reporting and drawing
// (the most common pixel inside its bounds) the document's color for its state exactly, whichever look and region it
// sits in; and the legend lists exactly the states on screen, each entry and its swatch's most common pixel in the
// document's color. Guards: at 1 s and at 3 s the slab draws one color left of the edge and another right of it, and
// its left half changes between them (each look and region is in effect where the marks sit). The planted
// `status_in_look` draws each mark and the legend in the look under them and fails, naming the binding.

import { describe, it } from 'vitest';
import {
  STATUS, TIMEOUT, VERDICTS, ac, documentLook, edgeColumn, edgeDoc, failsNaming, frameAt, framesOf, fromHex, hex, mode, none,
  readPng, requireGpu, rgbText, run, slabMode, statusOf, STATUS_LOOKS, useBins, useDir, view3d, writeJson, type Image,
  type Planted, type State,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const FPS = 30;
const TIMES = [{ n: 30, when: '1 s (shot one: post-l in look a, post-r in region b)' }, { n: 60, when: '2 s (inside the cross-fade)' }, { n: 90, when: '3 s (shot two: post-l in look c, post-r in region d)' }] as const;
const STATES = { [VERDICTS.left]: 'fail', [VERDICTS.right]: 'running' };
const WANT: Record<string, { item: string; state: State }> = { 'b-left': { item: 'post-l', state: 'fail' }, 'b-right': { item: 'post-r', state: 'running' } };

const inside = (b: readonly number[]) => (x: number, y: number): boolean => x >= b[0]! + 1 && x < b[0]! + b[2]! - 1 && y >= b[1]! + 1 && y < b[1]! + b[3]! - 1;

function statusProblems(planted?: Planted): string[] {
  requireGpu();
  const d = dir();
  const looks = STATUS_LOOKS();
  const doc = writeJson(d, 'status.json', edgeDoc('fade', { status: true }));
  const replies = run(bins.bin('deep-gpu'), d, TIMES.map(({ n }) => view3d({ doc, look: documentLook(), looks, fps: FPS, from: n, frames: 1, capture: [n], targets: ['final'], states: STATES })), planted ? { planted } : {});
  const out: string[] = [];
  const images: Image[] = [];
  TIMES.forEach(({ n, when }, i) => {
    const reply = replies[i]!;
    const image = readPng(d, frameAt(framesOf(reply, `the status film at ${when}`), n, 'the status film').final, `the status film at ${when}`);
    images.push(image);
    const s = statusOf(reply, `the status film at ${when}`);
    if (!s.shows) out.push(`${when}: status.shows is false, yet two items are bound`);
    if (s.marks.length !== 2) out.push(`${when}: ${s.marks.length} status marks, not one per binding (2)`);
    for (const [binding, want] of Object.entries(WANT)) {
      const m = s.marks.find((x) => x.binding === binding);
      const color = STATUS[want.state];
      if (!m) { out.push(`${when}: no mark for ${binding} on ${want.item}`); continue; }
      if (m.state !== want.state) out.push(`${when}: ${binding}'s mark is in state ${m.state}, not ${want.state}`);
      if (hex(m.color) !== color) out.push(`${when}: ${binding}'s mark on ${want.item} reports ${hex(m.color)}, not the document's ${want.state} ${color}`);
      const drawnColor = hex(mode(image, inside(m.bounds)).color);
      if (drawnColor !== color) out.push(`${when}: ${binding}'s mark on ${want.item} draws ${drawnColor}, not the document's ${want.state} ${color}`);
    }
    const shown = new Set(s.marks.map((m) => m.state));
    const listed = s.legend.map((e) => e.state);
    if (listed.length !== shown.size || listed.some((st) => !shown.has(st))) out.push(`${when}: the legend lists ${listed.join(', ') || 'nothing'}, the states on screen are ${[...shown].join(', ')}`);
    for (const e of s.legend) {
      const color = STATUS[e.state];
      if (hex(e.color) !== color) out.push(`${when}: the legend's ${e.state} entry reports ${hex(e.color)}, not the document's ${color}`);
      const swatch = hex(mode(image, inside(e.swatch)).color);
      if (swatch !== color) out.push(`${when}: the legend's ${e.state} swatch draws ${swatch}, not the document's ${color}`);
    }
  });
  // The looks are in effect where the marks are checked: two colors across the edge at 1 s and at 3 s, and the shot's look changing.
  const sides = (image: Image): [string, string] => {
    const edge = edgeColumn([image.width, image.height]);
    return [hex(slabMode(image, (x) => x + 0.5 <= edge - 30).color), hex(slabMode(image, (x) => x + 0.5 >= edge + 30).color)];
  };
  const [first, , last] = images.map(sides);
  if (first![0] === first![1]) out.push(`1 s: the slab draws ${first![0]} on both sides of the region's edge, so looks a and b aren't both drawn`);
  if (last![0] === last![1]) out.push(`3 s: the slab draws ${last![0]} on both sides of the region's edge, so looks c and d aren't both drawn`);
  if (first![0] === last![0]) out.push(`the slab's left half draws ${first![0]} in both shots, so shot two's look c isn't drawn`);
  return out;
}

describe(`${ac(3)} status colors are exact in every look and region, with the legend whenever they show`, () => {
  it(`${ac(3)} in both shots' looks, in both regions and inside the cross-fade, each mark and legend swatch draws the document's status color exactly`, () => {
    none(statusProblems(), `status in every look and region (the colors expected: fail ${rgbText(fromHex(STATUS.fail))}, running ${rgbText(fromHex(STATUS.running))})`);
  }, TIMEOUT);

  it(`${ac(3)} (planted) status drawn in the look under each mark fails, naming the binding`, () => {
    const plant: Planted = 'status_in_look';
    failsNaming(statusProblems(plant), ['b-right'], `the planted ${plant}`);
  }, TIMEOUT);
});
