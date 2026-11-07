// AC2 #467.93e9eaf5: Glow, the inner shade, bevel and satin on text each reuse the shaped run and count in the fit
// check: the inner ones stay inside the coverage and the outer ones inside the item's bounds; a still card with all
// four costs nothing per frame after its first; each matches its CPU reference within one 8-bit code value on 99.9% of
// pixels; and a status role is refused
//
// The pixels come from `deep-gpu run`'s `layers` (#385): the GPU layer's drawing and Vello CPU's, the CPU reference
// goldens and snapshots draw with, from one call. The text's coverage is `layers`' glyph run for it; the item's bounds
// and its shaped run are `deep-canvas-render raster`'s `texts.word` (`bounds`, `glyphs`). The fit check is AC1's
// (`number_unfit`). "Costs nothing per frame" is read from `live` (#379): the card's view isn't drawn and no pass is
// charged to it after its first frame. README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import {
  AC, ALL_FOUR, CARD_SIZE, LOOK, PAINTS, answered, arr, card, check, describeErrors, diffAt, glyphsOf, layersCall, num, numberCard,
  obj, rasterAll, rasterLine, refusalNames, render, requireMetal, runGpu, shown, sideOf, textEntry, useBin, useDir,
  writeJson, type Image, type JsonObject,
} from './helpers.ts';

const ID = AC[2];
const gpu = useBin('deep-gpu');
const cpu = useBin('deep-canvas-render');
const dir = useDir();

/** Pixels where `a` and `b` differ by more than one code value in any channel. */
function changed(a: Image, b: Image): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (diffAt(a, b, x, y) > 1) out.push([x, y]);
  return out;
}
/** The larger glyph-run alpha of the sides given, at (x, y): the text's coverage there. */
const coverage = (runs: (Image | undefined)[], x: number, y: number): number => Math.max(0, ...runs.filter((r): r is Image => r !== undefined).map((r) => r.rgba[(y * r.width + x) * 4 + 3]!));

describe(`${ID} glow, the inner shade, bevel and satin on text`, () => {
  it(`${ID} each reuses the shaped run, stays inside the coverage (inner) or the item's bounds (outer), and matches its CPU reference within one code value on 99.9% of pixels`, () => {
    requireMetal();
    const out = dir();
    const docs = [card('plain'), ...PAINTS.map((p, i) => card(`paint-${i}`, p.paint))];
    const replies = runGpu(gpu(), out, docs.map((d) => layersCall(d, ['gpu_layer', 'vello_cpu'])));
    const rasters = rasterAll(cpu(), out, docs, 'the card');
    const plain = { gpu: sideOf(out, replies[0]!, 'gpu_layer', 'the plain card'), cpu: sideOf(out, replies[0]!, 'vello_cpu', 'the plain card') };
    const runs = [plain.gpu.runs.get('word'), plain.cpu.runs.get('word')];
    expect(runs.some((r) => r !== undefined), 'layers gives the text\'s glyph run, its coverage').toBe(true);
    const ownGlyphs = glyphsOf(textEntry(rasters[0]!.answer, 'word', 'the plain card')['glyphs'], 'the plain card\'s glyphs');
    const failures: string[] = [];
    const total = CARD_SIZE[0] * CARD_SIZE[1];
    PAINTS.forEach((p, i) => {
      const text = textEntry(rasters[i + 1]!.answer, 'word', p.name);
      if (JSON.stringify(glyphsOf(text['glyphs'], `${p.name}: glyphs`)) !== JSON.stringify(ownGlyphs)) failures.push(`${p.name}: the shaped run moved or was reshaped`);
      const sides = { gpu_layer: sideOf(out, replies[i + 1]!, 'gpu_layer', p.name), vello_cpu: sideOf(out, replies[i + 1]!, 'vello_cpu', p.name) };
      for (const [renderer, side] of Object.entries(sides)) {
        const moved = changed(side.image, renderer === 'gpu_layer' ? plain.gpu.image : plain.cpu.image);
        if (moved.length < 50) { failures.push(`${p.name} on ${renderer}: it changes only ${moved.length} pixels, so it isn't drawn`); continue; }
        if (p.where === 'inner') {
          const outside = moved.filter(([x, y]) => coverage(runs, x, y) === 0);
          if (outside.length) failures.push(`${p.name} on ${renderer}: ${outside.length} changed pixels lie outside the text's coverage, first at (${outside[0]!.join(', ')})`);
        } else {
          const b = arr(text['bounds'], `${p.name}: texts.word.bounds`).map((v) => num(v, 'bounds'));
          const [bx, by, bw, bh] = [b[0]!, b[1]!, b[2]!, b[3]!];
          const outside = moved.filter(([x, y]) => x + 1 <= bx || x >= bx + bw || y + 1 <= by || y >= by + bh);
          if (outside.length) failures.push(`${p.name} on ${renderer}: ${outside.length} changed pixels lie outside the item's bounds [${b.join(', ')}], first at (${outside[0]!.join(', ')})`);
        }
      }
      const off = changed(sides.gpu_layer.image, sides.vello_cpu.image).length;
      console.log(`${ID}: ${p.name}: ${off} of ${total} pixels more than one code from the CPU reference`);
      if (off > total * 0.001) failures.push(`${p.name}: ${off} of ${total} pixels (${((off / total) * 100).toFixed(3)}%) are more than one code value from its CPU reference, over 0.1%`);
    });
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`${ID} each counts in the fit check: an outer glow takes a number past its box and is refused; the inner ones leave it fitting`, () => {
    const cases: [string, JsonObject, boolean][] = [
      ['nothing', {}, true],
      ['an outer glow', { glow: { where: 'outer', role: 'glow', size: 10 } }, false],
      ['an inner glow', { glow: { where: 'inner', role: 'glow', size: 4 } }, true],
      ['the inner shade', { shade: { kind: 'inner', role: 'shade', offset: 2, blur: 1 } }, true],
      ['an inner bevel', { bevel: { shape: 'inner', size: 2, highlight: { role: 'light' }, shadow: { role: 'dark' } } }, true],
      ['satin', { satin: { role: 'satin', offset: 2, size: 3 } }, true],
    ];
    const answers = render(cpu(), 'raster', cases.map(([, paint], i) => rasterLine(dir(), numberCard(`fit-${i}`, paint))));
    cases.forEach(([name, , fits], i) => {
      const a = answers[i]!;
      if (fits) expect(a['ok'], `the number with ${name} fits its 30 u box and draws: ${shown(a)}`).toBe(true);
      else {
        expect(a['ok'], `the number with ${name} reaches 10 px past its glyphs, outside its box, so it doesn't fit: ${shown(a)}`).toBe(false);
        expect(a['code'], `${name}: the fit check's refusal for a number`).toBe('number_unfit');
        expect(refusalNames(a, 'fit'), `${name}: the refusal names the number's item: ${shown(a)}`).toBe(true);
      }
    });
  });

  it(`${ID} a still card with all four costs nothing per frame after its first`, () => {
    requireMetal();
    const out = dir();
    // As a live session's writer sends it (#393's deep_show payload): no id, no layers, no item layer. Nothing moves.
    const without = (o: JsonObject, keys: string[]): JsonObject => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
    const payload = (d: JsonObject): JsonObject => ({
      ...without(d, ['id', 'layers']),
      items: Object.fromEntries(Object.entries(obj(d['items'], 'items')).map(([k, v]) => [k, without(obj(v, k), ['layer'])])),
    });
    const FRAMES = 30;
    const call = (name: string, d: JsonObject): JsonObject => ({ call: 'live', look: LOOK, frames: FRAMES, fps: 60, report: ['passes', 'hashes'], sessions: [{ session: 's-0', writer: 'agent:card', doc: writeJson(out, `${name}.json`, payload(d)) }] });
    const [four, bare] = runGpu(gpu(), out, [call('four', card('four', ALL_FOUR)), call('bare', card('bare'))]);
    const read = (reply: JsonObject, what: string): { drawn: boolean; hash: unknown; gpu: number; passes: number }[] => {
      answered(reply, what);
      const session = arr(reply['sessions'], `${what}: sessions`).map((s) => obj(s, 'session')).find((s) => s['session'] === 's-0');
      expect(session?.['state'], `${what}: the card is a live session, not refused: ${shown(session)}`).toBe('live');
      const frames = arr(reply['frames'], `${what}: frames`).map((f) => obj(f, `${what}: frame`));
      expect(frames.length, `${what}: ${FRAMES} frames presented`).toBe(FRAMES);
      return frames.map((f, k) => {
        const view = arr(f['views'], `${what}: frame ${k + 1} views`).map((v) => obj(v, 'view')).find((v) => v['session'] === 's-0');
        const passes = arr(f['passes'] ?? [], `${what}: frame ${k + 1} passes`).filter((p) => obj(p, 'pass')['session'] === 's-0').length;
        return { drawn: view?.['drawn'] === true, hash: view?.['pixel_hash'], gpu: typeof view?.['charged_gpu_ms'] === 'number' ? view['charged_gpu_ms'] : NaN, passes };
      });
    };
    const withFour = read(four!, 'the card with all four');
    const plain = read(bare!, 'the bare card');
    expect(withFour[0]!.drawn, 'the card draws in its first frame').toBe(true);
    expect(typeof withFour[0]!.hash === 'string' && withFour[0]!.hash !== plain[0]!.hash, `the first frame shows the four: its pixels differ from the bare card's (${String(withFour[0]!.hash)} vs ${String(plain[0]!.hash)})`).toBe(true);
    const costly = withFour.slice(1).flatMap((f, k) => (f.drawn || f.passes > 0 || f.gpu !== 0 ? [`frame ${k + 2}: drawn ${f.drawn}, ${f.passes} passes, ${f.gpu} ms of GPU charged`] : []));
    expect(costly, `after its first frame the still card costs nothing: no frame draws it, runs a pass for it or charges it GPU time:\n${costly.join('\n')}`).toEqual([]);
  });

  it(`${ID} a status role is refused in each of the four`, () => {
    const cases: [string, JsonObject][] = [
      ['glow', { glow: { role: 'status.pass' } }],
      ['the inner shade', { shade: { kind: 'inner', role: 'status.pass' } }],
      ['bevel', { bevel: { highlight: { role: 'status.pass' }, shadow: { role: 'dark' } } }],
      ['satin', { satin: { role: 'status.pass' } }],
    ];
    for (const [name, paint] of cases) {
      const { answer, errors } = check(cpu(), card(`status-${name}`, paint));
      expect(answer['ok'], `${name} naming status.pass is refused at check: ${describeErrors(errors)}`).toBe(false);
      expect(errors.map((e) => e.code), `${name}: the only error is the status-color rule's`).toEqual(['status_color_unbound']);
      expect(errors[0]!.ids, `${name}: the refusal names the text`).toContain('word');
    }
    const { errors } = check(cpu(), card('status-none', ALL_FOUR));
    expect(describeErrors(errors), 'the same four in data roles pass the check').toBe('none');
  });
});
