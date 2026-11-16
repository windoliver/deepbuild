// AC7 #458.89f8a711: "Pairs that must draw the same on one machine are compared with no golden: a recipe and its
// expansion into primitives, a pack kind and its expansion, an item at opacity 1 and the same item with no group, a 2D
// layer drawn by GPUI and the same layer on the GPU layer, and a seek to a time and play to it; each pair is equal bit
// for bit where both sides draw through one backend and within its tolerance class where they don't, and a planted
// expansion that drops one item's stroke fails its pair, naming the pair and the first pixel that differs"
//
// One test, in this order (README: The pairs):
//   1. recipe-expansion, pack-kind-expansion, group-opacity-1: each side a board shown through `deep-show` and drawn
//      by Vello CPU (one backend), with an empty golden store; the two snapshots' pixels are equal bit for bit;
//   2. the planted expansion (`planted: "expansion_drops_stroke"`): the same check fails recipe-expansion, naming the
//      pair and the first pixel that differs, which is the top-left pixel of one derived item's stroke; every pixel
//      that differs is on that one item's stroke; the golden stores stay empty;
//   3. seek-play: #1897's sliding board, the GPU pixel hash of a seek to each time and of a play to it (one backend);
//   4. gpui-gpu-layer: #385's 2D writer layer drawn by GPUI and by the GPU layer, within that pair's tolerance class
//      (#385's oracle: interior pixels within one code value on 99.9%, each glyph run and stroke against Vello CPU).
// At the base the first step passes and the second answers `bad_input`: the base has no such planted expansion.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOOK, WRITER_RUNS, decodePng, layerParityProblems, layersCall, readLayers, writerDoc } from '../../385/helpers.ts';
import { DOC as SLIDING_DOC, SLIDING, hash128, noGpu, present, scenario as boardScenario, sec } from '../../1897/helpers.ts';
import { BOARD, GROUP_PAIR, KIND_PAIR, LAYER_PAIR, RECIPE_PAIR, SEEK_PAIR, type Pair } from './generate.ts';
import {
  AC, TIMEOUT, arr, blocked, colors, differing, docId, evidenceFile, failsNaming, firstDifference, needsMetal, none, obj, onStrokeRing, presented, runGpu,
  runShow, scenario, show, showCall, useBins, useTemp, type Image, type JsonObject,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-gpu']);
const temp = useTemp();
const DRAWN: readonly Pair[] = [RECIPE_PAIR, KIND_PAIR, GROUP_PAIR];
const PLANTED = 'expansion_drops_stroke';
/** The times seek-play compares at: the start, three times inside the slide, and the flick before its last key. */
const TIMES = [0, sec(0.5), sec(1), sec(1.5), sec(2) - 1];

interface Sides { pair: Pair; a: Image; b: Image }
/** Both sides of each drawn pair, shown in one `deep-show` process with an empty golden store, read back as pixels. */
function drawn(planted?: string): Sides[] {
  const [evidence, goldens] = [temp(), temp()];
  const calls = DRAWN.flatMap((p, i) => [showCall(docId(2 * i + 1), p.a, BOARD), showCall(docId(2 * i + 2), p.b, BOARD)]);
  const replies = runShow(bin('deep-show'), scenario({ evidence, goldens, docs: calls.map(() => null), packs: true, planted }, calls), 'the pairs drawn by Vello CPU');
  const side = (reply: JsonObject, what: string): Image => {
    presented(reply, what);
    const shots = arr(reply['snapshots'], `${what}: snapshots`);
    expect(shots.length, `${what}: one snapshot`).toBe(1);
    const image = decodePng(evidenceFile(evidence, obj(shots[0], `${what}: its snapshot`)['sha256'], `${what}: its snapshot`));
    expect([image.width, image.height], `${what}: the snapshot is the board's size, one pixel a unit`).toEqual(BOARD);
    return image;
  };
  const sides = DRAWN.map((pair, i) => ({ pair, a: side(replies[2 * i]!, `${pair.name}: side a`), b: side(replies[2 * i + 1]!, `${pair.name}: side b`) }));
  expect(readdirSync(goldens), 'the pairs are compared with no golden: the golden store is still empty').toEqual([]);
  return sides;
}
/** This suite's check of a pair on one backend: equal bit for bit, or a failure naming the pair and the first pixel. */
function exactFailures(sides: Sides[]): string[] {
  const out: string[] = [];
  for (const s of sides) {
    if (colors(s.a) < 3 || colors(s.b) < 3) { out.push(`${s.pair.name}: a side is blank (${colors(s.a)} and ${colors(s.b)} colors), so the pair compares nothing`); continue; }
    const d = firstDifference(s.a, s.b, s.pair.name);
    if (d) out.push(`pair ${s.pair.name}: the sides differ; the first pixel that differs is (${d.x}, ${d.y}): ${show(d.a)} against ${show(d.b)}`);
  }
  return out;
}

describe(`${AC[7]} pairs that must draw the same, with no golden`, () => {
  it(`${AC[7]} the five pairs draw the same, bit for bit on one backend and within the tolerance class across two; a planted expansion that drops one item's stroke fails its pair, naming the pair and the first pixel`, () => {
    // 1. One backend: a recipe, a pack kind and a group at opacity 1 against what each must draw as.
    none(exactFailures(drawn()), 'recipe-expansion, pack-kind-expansion and group-opacity-1, bit for bit');

    // 2. The planted expansion: one derived item loses its stroke, and its pair fails on that item's first pixel.
    const sides = drawn(PLANTED);
    const failures = exactFailures(sides);
    const named = failsNaming(failures, new RegExp(`pair ${RECIPE_PAIR.name}: .*first pixel that differs is \\((\\d+), (\\d+)\\)`), `planted ${PLANTED}`);
    const [, x, y] = /first pixel that differs is \((\d+), (\d+)\)/.exec(named)!.map(Number);
    const item = RECIPE_PAIR.stroked.find((s) => onStrokeRing(s.box, x!, y!));
    expect(item, `the first pixel that differs, (${x}, ${y}), is on the stroke of one of the recipe's items: ${show(RECIPE_PAIR.stroked)}`).toBeDefined();
    expect([x, y], `the first pixel that differs is the top-left pixel of ${item!.item}'s stroke`).toEqual([item!.box[0] - 1, item!.box[1] - 1]);
    const recipe = sides.find((s) => s.pair === RECIPE_PAIR)!;
    const stray = differing(recipe.a, recipe.b).map((i) => [i % BOARD[0], Math.floor(i / BOARD[0])] as const).filter(([px, py]) => !onStrokeRing(item!.box, px, py));
    expect(stray.slice(0, 5), `the planted expansion drops one item's stroke and nothing else: every pixel that differs is on ${item!.item}'s stroke`).toEqual([]);
    none(failures.filter((f) => f.includes(GROUP_PAIR.name)), 'the group pair holds no expansion, so the planted expansion leaves it equal');

    // 3. A seek to a time and a play to it, by the GPU pixel hash of each side's canonical render (one backend).
    needsMetal('the GPU pixel hash');
    const evidence = temp();
    const [shown, compared] = runShow(bin('deep-show'), boardScenario(evidence, [present(SLIDING), { call: 'determinism', doc: SLIDING_DOC, display_hz: 144, at_times: TIMES, compare: 'same_machine' }]), SEEK_PAIR);
    expect(shown!['outcome'], `${SEEK_PAIR}: the sliding board is presented: ${show(shown)}`).toBe('presented');
    if (noGpu(compared!)) blocked(`${SEEK_PAIR}: no GPU to hash on here: ${show(compared)}`);
    expect(compared!['outcome'], `${SEEK_PAIR}: the two sides are compared: ${show(compared)}`).toBe('compared');
    const frames = arr(compared!['frames'], `${SEEK_PAIR}: frames`).map((f, i) => obj(f, `${SEEK_PAIR}: frames[${i}]`));
    expect(frames.map((f) => f['t']), `${SEEK_PAIR}: one frame for each time asked`).toEqual(TIMES);
    const hashes = frames.map((f, i) => ({
      t: TIMES[i]!,
      play: hash128(obj(f['play'], `${SEEK_PAIR}: frames[${i}].play`)['pixel_hash'], `${SEEK_PAIR}: play's pixel_hash at ${TIMES[i]}`),
      seek: hash128(obj(f['seek'], `${SEEK_PAIR}: frames[${i}].seek`)['pixel_hash'], `${SEEK_PAIR}: seek's pixel_hash at ${TIMES[i]}`),
    }));
    none(hashes.filter((h) => h.play !== h.seek).map((h) => `pair ${SEEK_PAIR}: at ${h.t} flicks a seek hashes to ${h.seek} and a play to ${h.play}`), 'a seek to a time and a play to it, by hash');
    expect(new Set(hashes.map((h) => h.play)).size, `${SEEK_PAIR}: the slide moves the picture, so the times hash apart`).toBe(TIMES.length);

    // 4. Two backends: a 2D writer layer by GPUI and the same layer on the GPU layer, within the pair's tolerance class.
    const out = temp();
    const [reply] = runGpu(bin('deep-gpu'), out, [layersCall(writerDoc(), LOOK, ['gpui', 'gpu_layer', 'vello_cpu'])], LAYER_PAIR);
    const layers = readLayers(out, reply!, LAYER_PAIR);
    expect([...layers.keys()], `${LAYER_PAIR}: the figure has one 2D writer layer, main`).toEqual(['main']);
    const problems = layerParityProblems(`pair ${LAYER_PAIR}`, layers.get('main')!, WRITER_RUNS);
    const voided = problems.find((p) => p.startsWith('BLOCKED:'));
    if (voided) blocked(voided.slice('BLOCKED: '.length));
    none(problems, 'a 2D writer layer by GPUI and on the GPU layer, within its tolerance class');
  }, TIMEOUT);
});
