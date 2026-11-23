// AC10 #161.1392976e: A 129 × 65 px group holding a two-color checker, under each blur and distort operator at its
// defaults and under the blur-then-invert chain, placed at (16, 16) and then at (53, 35) on a 257 × 129 px frame, gives
// the same texels moved by (37, 19), within one 10-bit code value on 99.9% of the texels inside its bounds. A planted
// twirl that takes its centre from the frame's origin fails, naming the operator and the first texel that differs.
//
// The group's children are one 129 × 65 px rectangle and the odd squares of a 16 px checker over it, in two roles, so
// its bounds are that rectangle. 23 cases: the issue's seven blur operators and fifteen distort operators, each alone
// in `passes` with no params and no `grow` (its defaults), and the chain `blur@1 {radius: 8}` then `fx.invert@1` at
// `grow: 8`. Each case is drawn twice by `layers` with `float: true` (#430), the children at (16, 16) and at
// (53, 35), with the same item IDs and document seed, in a 2D writer layer; so is the checker with no pass.
//
// Per case, over the 8,385 texels of the bounds: texel (x, y) of the first drawing against texel (x + 37, y + 19) of
// the second, all four channels; at most 8 (0.1%) may be more than one code apart. Each case must also draw (64 or
// more texels that aren't (0, 0, 0, 0)) and change the checker (64 or more texels over two codes from the checker with
// no pass), so two equal pictures of nothing don't pass.
//
// Wrong programs: the base (its twirl, radial wipe and directional blur measure in the frame's uv, and 20 of the 22
// operators are unknown to it); `--planted twirl_center_from_frame_origin`, under which `fx.twirl@1` measures
// `center` and `radius` from the frame's origin in the frame's uv, as the base's does: the judge fails, naming
// `fx.twirl@1` and the first texel that differs.
import { describe, expect, it } from 'vitest';
import {
  AC, CATEGORIES, ONE, TIMEOUT, at, buildLine, document, fx, group, layersCall, listProblems, mainLayer, off, opId, packOperators, rect, requireGpu, runGpu, useBin, useDir,
  type Drawn, type Floats, type JsonObject, type JsonValue, type Planted,
} from './helpers.ts';

const ID = AC[10];
const gpu = useBin('deep-gpu');
const dir = useDir();
const SIZE = [257, 129] as const;
const GROUP = [129, 65] as const;
const PLACES: readonly (readonly [number, number])[] = [[16, 16], [53, 35]];
const TEXELS = GROUP[0] * GROUP[1];
/** 0.1% of 8,385 texels. */
const ALLOWED = Math.floor(TEXELS / 1000);
const CHAIN = 'blur@1 then fx.invert@1';
const CASES: { name: string; passes: JsonValue[] }[] = [
  ...[...CATEGORIES.blur, ...CATEGORIES.distort].map((n) => ({ name: opId(n), passes: [{ op: opId(n), params: {} }] as JsonValue[] })),
  { name: CHAIN, passes: [{ op: 'blur@1', params: { radius: 8 } }, { op: 'fx.invert@1', params: {}, grow: 8 }] },
];
const OPERATORS = [...CATEGORIES.blur, ...CATEGORIES.distort].map(opId);

/** The checker at `place`: a rectangle of one role and the odd 16 px squares of the other, cut at the group's edge. */
function checker(id: string, place: readonly [number, number], passes: JsonValue[]): JsonObject {
  const items: JsonObject[] = [group('moved', 'a1', passes), rect('field', 'a2', [place[0], place[1], GROUP[0], GROUP[1]], 'amber', 1, { parent: 'moved' })];
  for (let j = 0; j * 16 < GROUP[1]; j++) for (let i = 0; i * 16 < GROUP[0]; i++) {
    if ((i + j) % 2 === 0) continue;
    items.push(rect(`sq${i}_${j}`, `b${String(j).padStart(2, '0')}${String(i).padStart(2, '0')}`, [place[0] + 16 * i, place[1] + 16 * j, Math.min(16, GROUP[0] - 16 * i), Math.min(16, GROUP[1] - 16 * j)], 'ink', 1, { parent: 'moved' }));
  }
  return document(id, SIZE, items);
}

interface Pair { a: Floats; b: Floats }
/** Each case drawn at both places, then the checker with no pass at both: a pair, or why there is none. */
function draw(cases: readonly { name: string; passes: JsonValue[] }[], planted?: Planted): Map<string, Pair | string> {
  const out = dir();
  const all = [...cases, { name: 'the checker with no pass', passes: [] as JsonValue[] }];
  const ran = runGpu(gpu().bin, out, all.flatMap((c, k) => PLACES.map((p, i) => layersCall(checker(`moved-${k}-${i}`, p, c.passes)))), planted);
  const read = new Map<string, Pair | string>();
  all.forEach((c, k) => {
    if (ran.problem) { read.set(c.name, ran.problem); return; }
    const [a, b] = PLACES.map((p, i) => mainLayer(out, ran.replies[2 * k + i], SIZE, `${c.name} at (${p[0]}, ${p[1]})`)) as [Drawn | string, Drawn | string];
    read.set(c.name, typeof a === 'string' ? a : typeof b === 'string' ? b : { a: a.floats, b: b.floats });
  });
  return read;
}
/** What is wrong with one case, each line starting with its name. */
function problems(name: string, pair: Pair | string, plain: Pair | string): string[] {
  if (typeof pair === 'string') return [pair.startsWith(name) ? pair : `${name}: ${pair}`];
  if (typeof plain === 'string') return [`${name}: ${plain}`];
  let differ = 0; let first = ''; let drawn = 0; let changed = 0;
  for (let y = 0; y < GROUP[1]; y++) for (let x = 0; x < GROUP[0]; x++) {
    const a = fx(pair.a, x + PLACES[0]![0], y + PLACES[0]![1]); const b = fx(pair.b, x + PLACES[1]![0], y + PLACES[1]![1]);
    if (a.some((v) => v !== 0)) drawn++;
    if (off(a, fx(plain.a, x + PLACES[0]![0], y + PLACES[0]![1])) > 2) changed++;
    if (off(a, b) > ONE) { differ++; first ||= `first texel (${x}, ${y}) of the group: ${at(a)} at (16, 16), ${at(b)} at (53, 35)`; }
  }
  const found: string[] = [];
  if (drawn < 64) found.push(`${name}: it draws ${drawn} texels inside the group's bounds, under 64`);
  if (changed < 64) found.push(`${name}: at its defaults it changes ${changed} texels of the checker by more than two codes, under 64; a pass that does nothing moves with anything`);
  if (differ > ALLOWED) found.push(`${name}: ${differ} of ${TEXELS} texels inside the group's bounds differ by more than one 10-bit code when the group moves by (37, 19), past ${ALLOWED} (0.1%); ${first}`);
  return found;
}

describe(`${ID} a group moved by whole pixels gives the same result moved by those pixels`, () => {
  it(`${ID} under each of the 7 blur and 15 distort operators at its defaults, and under blur@1 then fx.invert@1, a 129 × 65 px checker at (16, 16) and at (53, 35) gives the same texels moved by (37, 19), within one 10-bit code on 99.9% of 8,385`, () => {
    expect(OPERATORS.length, 'the issue\'s blur and distort lists hold 22 names').toBe(22);
    expect(listProblems(packOperators()).filter((p) => OPERATORS.some((id) => p.includes(id))), 'the pack holds the 22 blur and distort operators').toEqual([]);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const read = draw(CASES);
    const plain = read.get('the checker with no pass')!;
    const found = CASES.flatMap((c) => problems(c.name, read.get(c.name)!, plain));
    expect(found, `${found.length} findings over the 23 cases:\n  ${found.slice(0, 30).join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} planted: a twirl that takes its centre from the frame's origin (--planted twirl_center_from_frame_origin) fails, naming the operator and the first texel that differs`, () => {
    const twirl = opId('twirl');
    expect(twirl in packOperators(), 'the pack holds fx.twirl@1').toBe(true);
    requireGpu();
    expect(gpu().error, buildLine('deep-gpu')).toBe('');
    const read = draw(CASES.filter((c) => c.name === twirl), 'twirl_center_from_frame_origin');
    const found = problems(twirl, read.get(twirl)!, read.get('the checker with no pass')!);
    expect(found.some((f) => f.startsWith(`${twirl}: `) && /differ by more than one 10-bit code.*first texel \(\d+, \d+\) of the group/.test(f)), `the judge fails, naming ${twirl} and the first texel that differs: ${found.join('; ')}`).toBe(true);
  }, TIMEOUT);
});
