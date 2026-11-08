// AC5 #496.16281962: A counter with roll {span: 0.32 s, interp: ease in_out_cubic} over hold keys counting down from
// 02:15:04 once a second from 0.4 s: at 4.56 s the three graphemes that change at 4.4 s (the minutes' ones digit and both
// seconds digits) are each half way, the old glyph half a cell up inside its clip and the new half a cell below rest,
// while the other three hold still bit for bit; seeking to 4.56 s equals playing to it; and a planted roll that moves
// every grapheme moves the hours' digits and fails, naming the first of them.
//
// The counter reads the data value `left`, seconds, which a channel with hold keys counts down: 8104 (02:15:04) from 0,
// then one less at 0.4 s, 1.4 s, … 5.4 s, so at 4.4 s 02:15:00 becomes 02:14:59 and graphemes 4, 6 and 7 of the eight
// change. 4.56 s is 0.16 s into the 0.32 s roll, where in_out_cubic is exactly 0.5. Rest is where each glyph sits when
// nothing rolls: the old glyphs at 4.3 s, the new at 5.0 s, after the roll ends at 4.72 s. A cell is the glyph's clip,
// so half a cell is half the clip's height; up is −y. Holding still is the same glyph at the same pen and transform, bit
// for bit, as at 4.3 s. Play is every 60 fps frame from 0 to 4.55 s and then 4.56 s, in one process; seek is 4.56 s
// alone in a fresh one, and the two answers for the counter must be the same JSON.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, centreOf, drawn, failsNaming, film, fl, frames60, keys, none, raster, show, textItem, textOf, useRender,
  type Glyph, type JsonObject, type Text,
} from './helpers.ts';

const render = useRender();

const COUNTER = film('rolling-counter', [textItem('clock', {
  text: { counter: { source: 'data/left', format: { notation: 'clock' }, roll: { span: '0.32s', interp: { ease: { name: 'in_out_cubic' } } } } },
  size: 64, box: { w: 400, h: 80 }, widest: '88:88:88',
}, [16, 16])], {
  data: { left: { value: 8104 } },
  channels: {
    left: {
      target: 'data/left', type: 'f32',
      keys: keys([[0, 8104, 'hold'], [0.4, 8103, 'hold'], [1.4, 8102, 'hold'], [2.4, 8101, 'hold'], [3.4, 8100, 'hold'], [4.4, 8099, 'hold'], [5.4, 8098, 'hold']]),
    },
  },
}, '6s', [480, 160]);

const BEFORE = fl(4.3);
const AFTER = fl(5.0);
const HALF = fl(4.56);
const ROLLING = { 4: 'the minutes\' ones digit', 6: 'the seconds\' tens digit', 7: 'the seconds\' ones digit' } as const;
const HOLDING = { 0: 'the hours\' tens digit', 1: 'the hours\' ones digit', 3: 'the minutes\' tens digit' } as const;

const of = (text: Text, g: number): Glyph[] => text.glyphs.filter((x) => x.grapheme === g);
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const sameNumbers = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/** Where a grapheme that holds at 4.56 s isn't its 4.3 s glyph bit for bit, naming the grapheme. */
function holdFailures(before: Text, half: Text): string[] {
  const out: string[] = [];
  for (const [g, role] of Object.entries(HOLDING)) {
    const rest = of(before, Number(g));
    const now = of(half, Number(g));
    const at = `grapheme ${g} (${role})`;
    if (rest.length !== 1) { out.push(`${at} draws ${rest.length} glyphs at 4.3 s`); continue; }
    if (now.length !== 1) { out.push(`${at} draws ${now.length} glyphs at 4.56 s, not one`); continue; }
    const [r, n] = [rest[0]!, now[0]!];
    if (n.id !== r.id || !Object.is(n.x, r.x) || !Object.is(n.y, r.y) || !sameNumbers(n.transform, r.transform)) {
      out.push(`${at} moved: glyph ${n.id} at pen (${n.x}, ${n.y}) by ${show(n.transform)} at 4.56 s, glyph ${r.id} at (${r.x}, ${r.y}) by ${show(r.transform)} at rest`);
    }
  }
  return out;
}

/** Where a grapheme that changes at 4.4 s isn't half way at 4.56 s: old half a cell up, new half a cell below rest. */
function rollFailures(before: Text, after: Text, half: Text): string[] {
  const out: string[] = [];
  for (const [g, role] of Object.entries(ROLLING)) {
    const at = `grapheme ${g} (${role})`;
    const [old, next] = [of(before, Number(g)), of(after, Number(g))];
    if (old.length !== 1 || next.length !== 1) { out.push(`${at} draws ${old.length} glyphs at 4.3 s and ${next.length} at 5.0 s, not one each`); continue; }
    const [o, n] = [old[0]!, next[0]!];
    const now = of(half, Number(g));
    const going = now.find((x) => x.id === o.id); const coming = now.find((x) => x.id === n.id);
    if (now.length !== 2 || !going || !coming) { out.push(`${at} draws glyphs ${show(now.map((x) => x.id))} at 4.56 s, not the old ${o.id} and the new ${n.id}`); continue; }
    if (!going.clip || !coming.clip || !going.clip.every((v, i) => near(v, coming.clip![i]!, 1e-9)) || !(going.clip[3]! > 0)) {
      out.push(`${at}: the old and the new glyph aren't clipped to one cell: ${show(going.clip)} and ${show(coming.clip)}`);
      continue;
    }
    const [cx, cy, cw, ch] = going.clip;
    const [rx, ry] = centreOf(o);
    if (!(rx >= cx! && rx <= cx! + cw! && ry >= cy! && ry <= cy! + ch!)) out.push(`${at}: the cell ${show(going.clip)} doesn't hold the glyph's rest (${rx}, ${ry})`);
    const halfCell = ch! / 2;
    const placed = (x: Glyph, rest: Glyph, dy: number, which: string): void => {
      const [a, b, c, d, e, f] = x.transform; const r = rest.transform;
      if (![a, b, c, d].every((v, i) => near(v!, r[i]!, 1e-6)) || !near(e!, r[4]!, 0.01) || !near(f!, r[5]! + dy, 0.01)) {
        out.push(`${at}: the ${which} glyph is placed by ${show(x.transform)}, not its rest ${show(r)} moved ${dy} u in y`);
      }
    };
    placed(going, o, -halfCell, 'old');
    placed(coming, n, halfCell, 'new');
  }
  return out;
}

const draw = (frames: { t: number; planted?: string }[], what: string): Text[] => drawn(raster(render, COUNTER, frames), what).map((a, i) => textOf(a, 'clock', `${what}, frame ${i + 1}`));

describe(`${AC[5]} a rolling counter: what changes rolls half way at mid-span, what stays holds still`, () => {
  it(`${AC[5]} at 4.56 s the minutes' ones digit and both seconds digits are half way, old half a cell up, new half a cell below rest, inside their clip, while the hours' digits and the minutes' tens hold still bit for bit`, () => {
    const [before, after, half] = draw([{ t: BEFORE }, { t: AFTER }, { t: HALF }], 'the counter');
    expect(before!.shown, 'the counter shows 02:15:00 at 4.3 s').toBe('02:15:00');
    expect(after!.shown, 'the counter shows 02:14:59 at 5.0 s').toBe('02:14:59');
    none([...rollFailures(before!, after!, half!), ...holdFailures(before!, half!)], 'the roll at 4.56 s');
  }, TIMEOUT);

  it(`${AC[5]} seeking to 4.56 s draws the counter exactly as playing every frame to it does`, () => {
    const played = drawn(raster(render, COUNTER, [...frames60(4.55).map((t) => ({ t })), { t: HALF }]), 'the counter played').at(-1)!;
    const seeked = drawn(raster(render, COUNTER, [{ t: HALF }]), 'the counter seeked')[0]!;
    textOf(seeked, 'clock', 'seeked');
    expect(JSON.stringify((seeked['texts'] as JsonObject)['clock']), 'the seeked counter is the played one, bit for bit').toBe(JSON.stringify((played['texts'] as JsonObject)['clock']));
  }, TIMEOUT);

  it(`${AC[5]} a planted roll that moves every grapheme moves the hours' digits and fails, naming the first of them`, () => {
    const [before, half] = draw([{ t: BEFORE }, { t: HALF, planted: 'roll_moves_every_grapheme' }], 'the planted roll');
    failsNaming(holdFailures(before!, half!), ['grapheme 0'], 'roll_moves_every_grapheme');
  }, TIMEOUT);
});
