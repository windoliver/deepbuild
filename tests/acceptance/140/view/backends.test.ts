// Criterion 7 (#140.fabe5dd3): every result names its backends, and a backend with a new version misses the
// caches it keyed.
//
// "Every result" is read as every result the canvas hands back across the surfaces this suite drives: the
// headless raster, the app's GPUI frame and its session (`deep-canvas-render raster | render | session`), a
// render-back reply with its snapshot (`deep-show run`), and a GPU snapshot from the headless worker
// (`deep-gpu run --headless`). Each names, under `backends`, every seam that fed it with its backend's name and
// version (README: Backends on every result). The new version is a build of `deep-canvas-render` with
// `--features test-fonts-next`: the same bundled fonts backend at its next version and nothing else changed.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CPU_ARCH, DEEP_GPU, DEEP_SHOW, FIGURE, LOOK_2D, RENDER, RENDER_FONTS_NEXT, SCENE, answers, arr, backendsOf, obj, ok, replies, showScenario,
  str, useBuilds, useDir, type Backend, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([RENDER, RENDER_FONTS_NEXT, DEEP_SHOW, DEEP_GPU]);
const dir = useDir();

/** What a result's backends must name: the seams that fed it (README: Backends on every result). */
function namesProblems(what: string, b: Map<string, Backend>, needs: string[]): string[] {
  const p: string[] = [];
  for (const seam of needs) if (!b.has(seam)) p.push(`${what} doesn't name its ${seam} backend (it names ${JSON.stringify([...b.keys()])})`);
  const cpu = b.get('cpu');
  if (cpu && cpu.name !== CPU_ARCH) p.push(`${what} names the cpu backend ${cpu.name} on a ${CPU_ARCH} machine`);
  const gpu = b.get('gpu');
  if (gpu && process.platform === 'darwin' && !/metal/i.test(gpu.name)) p.push(`${what} names the gpu backend ${gpu.name}, not wgpu on Metal`);
  return p;
}

const rasterLine = (out: string): JsonObject => ({ out, doc: FIGURE(), look: LOOK_2D(), t: 0 });
const sessionLine = (): JsonObject => ({ look: LOOK_2D(), steps: [{ doc: FIGURE(), t: 0, frames: 5 }] });

describe('#140.fabe5dd3 (C7) every result names its backends; a backend with a new version misses the caches it keyed', () => {
  it('#140.fabe5dd3 (C7) the headless raster, the app\'s frame and session, a render-back reply with a snapshot and a GPU snapshot each name every backend that fed them, with its name and version', () => {
    const problems: string[] = [];
    const render = builds.bin(RENDER);
    const [raster] = answers(render, ['raster'], [rasterLine(join(dir(), 'raster.png'))]);
    problems.push(...namesProblems('the headless raster', backendsOf(ok(raster!, 'raster'), 'the headless raster'), ['fonts', 'headless', 'cpu']));
    if (process.platform === 'darwin') {
      const [frame] = answers(render, ['render'], [rasterLine(join(dir(), 'render.png'))]);
      problems.push(...namesProblems('the app\'s frame', backendsOf(ok(frame!, 'render'), 'the app\'s frame'), ['fonts', 'cpu']));
      const [session] = answers(render, ['session'], [sessionLine()]);
      problems.push(...namesProblems('the app\'s session', backendsOf(ok(session!, 'session'), 'the app\'s session'), ['fonts', 'cpu']));
    }
    const show = builds.bin(DEEP_SHOW);
    const [run] = answers(show, ['run'], [showScenario(dir(), FIGURE(), 'fig', {}, [{ call: 'render_back', session: 's1', doc: 'fig', rev: 1, t: '0s', size: [480, 270], include: ['pixels'] }])]);
    const back = replies(run!, 'deep-show run');
    const shown = obj(back[0], 'the deep_show reply');
    const rb = obj(back[1], 'the render_back reply');
    expect(arr(rb['snapshots'], 'render_back: snapshots').length, 'the render-back reply carries its snapshot').toBe(1);
    problems.push(...namesProblems('the deep_show reply', backendsOf(shown, 'the deep_show reply'), ['fonts', 'cpu']));
    problems.push(...namesProblems('the render-back reply', backendsOf(rb, 'the render-back reply'), ['fonts', 'headless', 'cpu']));
    if (process.platform === 'darwin') {
      const gpu = builds.bin(DEEP_GPU);
      const [snap] = answers(gpu, ['run', '--headless'], [{ out: dir(), calls: [{ call: 'snapshot', scene: SCENE, case: 'scene3d-glow-shadows' }] }]);
      const record = obj(obj(arr(ok(snap!, 'deep-gpu run --headless')['replies'], 'replies')[0], 'the snapshot reply')['record'], 'the snapshot record');
      problems.push(...namesProblems('the GPU snapshot', backendsOf(record, 'the GPU snapshot'), ['gpu', 'fonts', 'headless', 'cpu']));
    }
    expect(problems, 'backends on every result').toEqual([]);
  }, 1_800_000);

  it('#140.fabe5dd3 (C7) the fonts backend at a new version: the result names the new version, and every text cache entry it keyed misses, while two runs of one build key alike', () => {
    const now = builds.bin(RENDER);
    const next = builds.bin(RENDER_FONTS_NEXT);
    const [a] = answers(now, ['raster'], [rasterLine(join(dir(), 'a.png'))]);
    const [b] = answers(next, ['raster'], [rasterLine(join(dir(), 'b.png'))]);
    const fa = backendsOf(ok(a!, 'raster'), 'raster').get('fonts');
    const fb = backendsOf(ok(b!, 'raster (test-fonts-next)'), 'raster (test-fonts-next)').get('fonts');
    expect(fa, 'the raster names its fonts backend').toBeDefined();
    expect(fb, 'the test-fonts-next raster names its fonts backend').toBeDefined();
    expect(fb!.name, 'the same fonts backend').toBe(fa!.name);
    expect(fb!.version, 'at a new version').not.toBe(fa!.version);

    if (process.platform !== 'darwin') return;
    const textKeys = (bin: string, what: string): Map<string, string> => {
      const [s] = answers(bin, ['session'], [sessionLine()]);
      const steps = arr(ok(s!, what)['steps'], `${what}: steps`);
      const caches = obj(obj(steps[steps.length - 1], `${what}: last step`)['caches'], `${what}: caches`);
      return new Map(arr(caches['text'], `${what}: caches.text`).map((v, i) => {
        const e = obj(v, `${what}: caches.text[${i}]`);
        return [str(e['item'], 'item'), str(e['key'], 'key')] as const;
      }));
    };
    const first = textKeys(now, 'session');
    const again = textKeys(now, 'session, again');
    const bumped = textKeys(next, 'session (test-fonts-next)');
    expect(first.size, 'the figure\'s texts are cached').toBeGreaterThanOrEqual(2);
    expect([...again], 'one build keys its text alike on every run').toEqual([...first]);
    const kept = [...bumped].filter(([item, key]) => first.get(item) === key || [...first.values()].includes(key));
    expect(kept, 'no text entry the new fonts version made is found under a key the old version made').toEqual([]);
    expect([...bumped.keys()].sort(), 'the same texts are cached').toEqual([...first.keys()].sort());
  }, 1_800_000);
});
