// AC9 #458.4ebd041e: "Generated valid documents and logic programs, from recorded seeds and with transforms that must
// not change the output (an invisible item, an identity group, renamed IDs, a patch split in two), give the same
// result on Vello CPU and the GPU layer, in the app and the web player, on wasmtime and in the browser engine, and from
// the sandbox's rewrite of a program and the original, by hash where the pair is exact and within its tolerance class
// where it isn't; a planted GPU-layer blend that differs from Vello CPU on one generated document fails, naming its
// seed and the first pixel, and a planted rewrite that changes one result fails, naming the program's seed"
//
// Two tests, one for documents and one for programs (README: The generated cases, with the counts). Every failure
// names the recorded seed its case was generated from, and the generators give the same case from the same seed.
//
// Documents: 4 figures (seeds 45800, 45802, 45809, 45812), each as generated and under each transform (6 renderings):
//   1. a patch split in two, through `deep-show`: one patch of two ops and two patches of one op leave the same items
//      as the figure written whole;
//   2. Vello CPU and the GPU layer (`deep-gpu`'s `layers`): every rendering's Vello CPU pixels are the generated
//      figure's bit for bit (the transform changes nothing), and its GPU-layer pixels are within the tolerance class;
//   3. `--planted gpu_layer_multiply_as_screen`: the same check fails on the one figure whose group multiplies, naming
//      its seed and the first pixel, inside the group's rect;
//   4. the app and the web player: 2 films (seeds 45801, 45803), as generated and under the three document transforms
//      at once, exported to the web and played in headless Chrome; `probe()`'s evaluated data at 3 times is the app's.
// Programs: 6 providers (seeds 45801, 45804, 45805, 45806, 45808, 45811):
//   1. the sandbox's rewrite and the original: `deep-sandbox`'s run of its rewrite on wasmtime gives what the program
//      as written gives, unrewritten, in this process's own engine;
//   2. `--planted rewrite_rotl_as_rotr`: the same check fails on the one program that rotates left, naming its seed;
//   3. wasmtime and the browser's engine: the rewritten bytes through the web runner in headless Chrome give wasmtime's.
// At the base each test passes its honest native steps and fails at its planted step: `bad_input`, no such plant.
import { describe, expect, it } from 'vitest';
import { appValues, bundleFailures, done, exportOnce, play, webReceiptOf } from '../../172/helpers.ts';
import { inChrome } from '../../238/helpers.ts';
import { decodePng } from '../../385/helpers.ts';
import {
  BLENDS, FIGURE, FIGURE_LOOK, VARIANTS, expected, figure, film, program, runAsWritten, sessionForm, splitPatch, storedForm, transformedFilm, variant,
  type Figure, type Film, type Program, type Result,
} from './generate.ts';
import {
  AC, TIMEOUT, arr, blocked, colors, docId, failsNaming, firstDifference, isObject, judge, needsMetal, none, obj, outFile, patchCall, readCall, runGpu, runSandbox,
  runShow, scenario, show, str, useBins, useTemp, type Image, type JsonObject, type JsonValue, type Tolerance,
} from './helpers.ts';

const bin = useBins(['deep-show', 'deep-gpu', 'deep-sandbox']);
const temp = useTemp();

// ---------------------------------------------------------------------------------------------------
// Documents

const FIGURE_SEEDS = [45800, 45802, 45809, 45812];
const FILM_SEEDS = [45801, 45803];
const FILM_TIMES = [0.5, 1.5, 3.25];
const BLEND_PLANTED = 'gpu_layer_multiply_as_screen';
/** Vello CPU against the GPU layer on these figures: two backends, so a tolerance class, not a hash. */
const LAYER_TOLERANCE: Tolerance = {
  within: 1, on: 99.9, ceiling: 2, window: { size: 8, off: 4 },
  reason: 'Two renderers each round a color once, so a fill may land one code value apart; every edge of these figures is on a whole pixel and every fill is solid, so no pixel holds coverage for them to disagree on.',
};
/** The six renderings of a figure: as generated, under each document transform, and after a patch in one and in two. */
const RENDERINGS = [...VARIANTS, 'one_patch', 'two_patches'] as const;
type Rendering = (typeof RENDERINGS)[number];

/** Each figure's two patched documents as the hub holds them after one patch of two ops and after two patches of one
 * op; both must hold the items the figure holds when written whole. */
function patched(figures: Figure[]): Map<number, { one: JsonObject; two: JsonObject }> {
  const [evidence, goldens] = [temp(), temp()];
  const docs: JsonObject[] = [];
  const calls: JsonObject[] = [];
  for (const [i, f] of figures.entries()) {
    const { base, ops } = splitPatch(f);
    const [whole, one, two] = [docId(3 * i + 1), docId(3 * i + 2), docId(3 * i + 3)];
    docs.push(storedForm(f.doc), storedForm(base), storedForm(base));
    calls.push(readCall(whole), patchCall(one, 10 * i + 1, 0, ops), readCall(one), patchCall(two, 10 * i + 2, 0, [ops[0]]), patchCall(two, 10 * i + 3, 1, [ops[1]]), readCall(two));
  }
  const replies = runShow(bin('deep-show'), scenario({ evidence, goldens, docs }, calls), 'a patch split in two');
  const out = new Map<number, { one: JsonObject; two: JsonObject }>();
  const failures: string[] = [];
  for (const [i, f] of figures.entries()) {
    const r = replies.slice(6 * i, 6 * i + 6);
    for (const k of [1, 3, 4]) expect(r[k]!['outcome'], `seed ${f.seed}: the patch applies: ${show(r[k], 600)}`).toBe('applied');
    const stored = (k: number): JsonObject => obj(r[k]!['document'], `seed ${f.seed}: the stored document`);
    const items = (k: number): string => JSON.stringify(stored(k)['items']);
    if (items(2) !== items(5)) failures.push(`seed ${f.seed}: one patch of two ops and two patches of one op leave different items`);
    if (items(2) !== items(0)) failures.push(`seed ${f.seed}: the patched figure's items differ from the figure written whole`);
    out.set(f.seed, { one: stored(2), two: stored(5) });
  }
  none(failures, 'a patch split in two leaves the same document');
  return out;
}

interface Drawn { seed: number; rendering: Rendering; cpu: Image; gpu: Image }
/** Every rendering of every figure drawn by Vello CPU and by the GPU layer, in one `deep-gpu` process. */
function drawLayers(figures: Figure[], patches: Map<number, { one: JsonObject; two: JsonObject }>, planted?: string): Drawn[] {
  const out = temp();
  const cases = figures.flatMap((f) => RENDERINGS.map((rendering) => {
    const doc = rendering === 'one_patch' ? patches.get(f.seed)!.one : rendering === 'two_patches' ? patches.get(f.seed)!.two : sessionForm(variant(f, rendering), `gen-${f.seed}-${rendering.replace(/_/g, '-')}`);
    return { seed: f.seed, rendering, doc };
  }));
  const replies = runGpu(bin('deep-gpu'), out, cases.map((c) => ({ call: 'layers', doc: c.doc, look: FIGURE_LOOK, by: ['vello_cpu', 'gpu_layer'] })), 'the generated figures by Vello CPU and by the GPU layer', planted);
  return cases.map((c, i) => {
    const what = `seed ${c.seed}, ${c.rendering}`;
    const layers = arr(replies[i]!['layers'], `${what}: layers (the reply: ${show(replies[i], 400)})`);
    expect(layers.length, `${what}: the figure has one writer layer`).toBe(1);
    const sides = obj(obj(layers[0], `${what}: its layer`)['drawn'], `${what}: drawn`);
    const side = (who: 'vello_cpu' | 'gpu_layer'): Image => {
      const s = obj(sides[who], `${what}: drawn.${who}`);
      if (s['ok'] === false) blocked(`${what}: ${who} can't draw the layer here: ${show(s, 400)}`);
      const image = decodePng(outFile(out, s['png'], 'png', `${what}: the layer by ${who}`));
      expect([image.width, image.height], `${what}: the layer by ${who} is the figure's size`).toEqual(FIGURE);
      return image;
    };
    return { seed: c.seed, rendering: c.rendering, cpu: side('vello_cpu'), gpu: side('gpu_layer') };
  });
}
/** This suite's check of the layer pair: each rendering's Vello CPU pixels are the generated figure's, bit for bit, and
 * its GPU-layer pixels are within the tolerance class of them. A failure names the seed, the rendering and a pixel. */
function layerFailures(drawn: Drawn[]): string[] {
  const out: string[] = [];
  for (const d of drawn) {
    const what = `seed ${d.seed}, ${d.rendering}`;
    const plain = drawn.find((x) => x.seed === d.seed && x.rendering === 'plain')!;
    if (colors(d.cpu) < 3) { out.push(`${what}: Vello CPU drew a blank figure (${colors(d.cpu)} colors), so the pair compares nothing`); continue; }
    const moved = firstDifference(plain.cpu, d.cpu, what);
    if (moved) out.push(`${what}: the transform changed Vello CPU's output; the first pixel that differs is (${moved.x}, ${moved.y})`);
    const j = judge(d.cpu, d.gpu, LAYER_TOLERANCE, what);
    if (!j.pass) out.push(`${what}: the GPU layer differs from Vello CPU past the tolerance class (${j.off} pixels off, ${j.allowed} allowed${j.pastCeiling ? `, (${j.pastCeiling.x}, ${j.pastCeiling.y}) past the ceiling` : ''}${j.window ? `, ${j.window.off} off in the window at (${j.window.x}, ${j.window.y})` : ''}); the first pixel that differs is (${j.first!.x}, ${j.first!.y}): ${show(j.first!.a)} against ${show(j.first!.b)}`);
  }
  return out;
}

const filmId = (n: number): string => `01JB458W${String(n).padStart(18, '0')}`;
/** A film in the app (`deep-show`'s `eval`) against the web player (`probe()` in headless Chrome) at each time: each
 * failure names the seed, the time and the path. */
async function webFailures(f: Film, what: string): Promise<string[]> {
  const show_ = bin('deep-show');
  const app = appValues(show_, temp(), f.doc, FILM_TIMES, f.paths, `${what}: the app`);
  const folder = `${temp()}/bundle`;
  const receipt = webReceiptOf(exportOnce(show_, temp(), f.doc, folder, `${what}: the web export`), `${what}: the web export`);
  none(bundleFailures(folder, receipt, `${what}: the bundle`), `${what}: the bundle holds every file its receipt names, each by its hash`);
  const page = await play(folder);
  const failures: string[] = [];
  // The page, its browser and its server are closed here whatever happens, each by its own PID.
  try {
    await page.tab.mustBeReady(what);
    for (const [i, t] of FILM_TIMES.entries()) {
      await page.tab.evaluate(`void (document.querySelector('deep-player').currentTime = ${t})`);
      const until = Date.now() + 10_000;
      let now = NaN;
      while (Date.now() < until) {
        now = await page.tab.evaluate<number>(`document.querySelector('deep-player').currentTime`);
        if (now === t) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(now, `${what}: a seek to ${t} s lands there`).toBe(t);
      const p = await page.tab.probe(`${what} at ${t} s`);
      for (const path of f.paths) {
        const [web, mine] = [p.values[path] ?? null, app[i]![path] ?? null];
        if (typeof mine !== 'number') failures.push(`${what}: the app evaluates no number at ${path} at ${t} s: ${show(mine)}`);
        else if (JSON.stringify(web) !== JSON.stringify(mine)) failures.push(`${what}: at ${t} s ${path} is ${show(web, 200)} in the web player and ${show(mine, 200)} in the app`);
      }
    }
  } finally {
    await done(page);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Programs

const PROGRAM_SEEDS = [45801, 45804, 45805, 45806, 45808, 45811];
const REWRITE_PLANTED = 'rewrite_rotl_as_rotr';
/** `gen`'s argument, the budget and the read every run takes: the 64-bit result the program leaves at memory 0. */
const ARG = 9;
const BUDGET: JsonObject = { fuel: 1_000_000 };
const READ: JsonObject[] = [{ at: 0, len: 8 }];
const digest = (r: Result): string => `${r.result}:${r.hex}`;

interface Native { seed: number; rewritten: string; result: Result }
/** Each program checked, rewritten and run once on wasmtime by `deep-sandbox`: the rewritten bytes and the result. */
function onWasmtime(programs: Program[], planted?: string): Native[] {
  const calls = programs.flatMap((p): JsonObject[] => [
    { call: 'rewrite', program: p.b64, role: 'provider', budget: BUDGET },
    { call: 'run', program: p.b64, role: 'provider', seed: ARG, budget: BUDGET, read: READ },
  ]);
  const replies = runSandbox(bin('deep-sandbox'), calls, 'the generated programs', planted);
  return programs.map((p, i) => {
    const [rw, run] = [replies[2 * i]!, replies[2 * i + 1]!];
    expect(rw['ok'], `seed ${p.seed}: the generated program passes the subset's check and is rewritten: ${show(rw, 600)}`).toBe(true);
    return { seed: p.seed, rewritten: str(rw['rewritten'], `seed ${p.seed}: rewritten`), result: resultOf(run, `seed ${p.seed}: wasmtime's run of the rewrite`) };
  });
}
/** A run's result from a `run` reply (native or the web runner's): no trap, the i32 returned, the 8 bytes read. */
function resultOf(reply: JsonValue | undefined, what: string): Result {
  const r = obj(reply, what);
  expect(r['ok'], `${what} ran: ${show(r, 600)}`).toBe(true);
  expect(r['trap'] ?? null, `${what} doesn't trap: ${show(r, 600)}`).toBeNull();
  const reads = arr(r['reads'], `${what}: reads`).filter(isObject);
  expect(reads.length, `${what}: one read`).toBe(1);
  expect(typeof r['result'], `${what}: gen's return is a number: ${show(r, 400)}`).toBe('number');
  return { result: r['result'] as number, hex: str(reads[0]!['hex'], `${what}: the bytes read`).toLowerCase() };
}
/** This suite's check of the rewrite against the original: each failure names the program's seed and both results. */
function rewriteFailures(native: Native[], written: Map<number, Result>): string[] {
  return native.filter((n) => digest(n.result) !== digest(written.get(n.seed)!))
    .map((n) => `program seed ${n.seed}: the sandbox's rewrite gives ${digest(n.result)} and the program as written ${digest(written.get(n.seed)!)}`);
}

describe(`${AC[9]} generated documents and programs across each pair of implementations`, () => {
  it(`${AC[9]} generated documents, as generated and transformed, draw the same on Vello CPU and the GPU layer and evaluate the same in the app and the web player; a planted GPU-layer blend fails, naming its seed and the first pixel`, async () => {
    // The cases: the same figure from the same seed, and exactly one whose group multiplies.
    const figures = FIGURE_SEEDS.map(figure);
    none(FIGURE_SEEDS.filter((s) => JSON.stringify(figure(s)) !== JSON.stringify(figure(s))).map((s) => `seed ${s} gives two figures`), 'a seed replays its figure');
    expect(new Set(figures.map((f) => JSON.stringify(f.doc['items']))).size, 'the seeds give different figures').toBe(FIGURE_SEEDS.length);
    const multiplies = figures.filter((f) => f.blend === 'multiply');
    expect(multiplies.map((f) => f.seed), `the seeds draw each of ${BLENDS.join(', ')}; one figure's group multiplies`).toEqual([45802]);

    // 1. A patch split in two leaves the same document.
    const patches = patched(figures);

    // 2. Vello CPU and the GPU layer, on every rendering.
    needsMetal('the GPU layer');
    const honest = drawLayers(figures, patches);
    expect(honest.length, 'four figures, six renderings each').toBe(24);
    none(layerFailures(honest), 'Vello CPU and the GPU layer on the generated figures');

    // 3. The planted GPU-layer blend: the one figure that multiplies fails, by its seed and its first pixel.
    const planted = drawLayers(figures, patches, BLEND_PLANTED);
    const failures = layerFailures(planted);
    const wrong = multiplies[0]!;
    const named = failsNaming(failures, new RegExp(`^seed ${wrong.seed}, plain: the GPU layer differs .*first pixel that differs is \\(\\d+, \\d+\\)`), `--planted ${BLEND_PLANTED}`);
    const [, x, y] = /first pixel that differs is \((\d+), (\d+)\)/.exec(named)!.map(Number);
    const [wx, wy, ww, wh] = wrong.wash;
    expect(x! >= wx && x! < wx + ww && y! >= wy && y! < wy + wh, `the first pixel, (${x}, ${y}), is inside the blended group's rect ${show(wrong.wash)}`).toBe(true);
    none(failures.filter((f) => !f.startsWith(`seed ${wrong.seed},`)), `--planted ${BLEND_PLANTED} differs on the one figure that multiplies, and on no other`);
    none(planted.filter((d, i) => firstDifference(d.cpu, honest[i]!.cpu, 'Vello CPU, planted against honest') !== null).map((d) => `seed ${d.seed}, ${d.rendering}`), 'the planted blend is the GPU layer\'s: Vello CPU draws as before');

    // 4. The app and the web player, on generated films as generated and transformed.
    const films = FILM_SEEDS.map((s, i) => film(s, filmId(2 * i + 1)));
    const web: string[] = [];
    for (const [i, f] of films.entries()) {
      expect(JSON.stringify(film(f.seed, filmId(2 * i + 1))), `seed ${f.seed} replays its film`).toBe(JSON.stringify(f));
      web.push(...await webFailures(f, `film seed ${f.seed}, as generated`));
      web.push(...await webFailures(transformedFilm(f, filmId(2 * i + 2)), `film seed ${f.seed}, with an invisible item, an identity group and renamed IDs`));
    }
    none(web, 'the app and the web player on the generated films');
  }, TIMEOUT);

  it(`${AC[9]} generated programs give the same result from the sandbox's rewrite and the original, and on wasmtime and in the browser's engine; a planted rewrite that changes one result fails, naming the program's seed`, async () => {
    // The cases: the same program from the same seed, each computing what the specification's integer rules give.
    const programs = PROGRAM_SEEDS.map(program);
    none(PROGRAM_SEEDS.filter((s) => program(s).b64 !== program(s).b64).map((s) => `seed ${s} gives two programs`), 'a seed replays its program');
    expect(new Set(programs.map((p) => p.b64)).size, 'the seeds give different programs').toBe(PROGRAM_SEEDS.length);
    const written = new Map<number, Result>();
    for (const p of programs) {
      written.set(p.seed, runAsWritten(p, ARG));
      expect(digest(written.get(p.seed)!), `seed ${p.seed}: the program as written computes what the WebAssembly specification's integer rules give`).toBe(digest(expected(p, ARG)));
    }
    const rotating = programs.filter((p) => p.steps.some((s) => s.op === 'i64.rotl'));
    expect(rotating.map((p) => p.seed), 'one program rotates left').toEqual([45804]);
    expect(digest(expected(rotating[0]!, ARG, true)), 'a right rotation in its place changes that program\'s result').not.toBe(digest(expected(rotating[0]!, ARG)));

    // 1. The sandbox's rewrite of a program and the original.
    const honest = onWasmtime(programs);
    none(rewriteFailures(honest, written), 'the sandbox\'s rewrite against the program as written');

    // 2. The planted rewrite: the one program that rotates left fails, by its seed.
    const failures = rewriteFailures(onWasmtime(programs, REWRITE_PLANTED), written);
    failsNaming(failures, new RegExp(`^program seed ${rotating[0]!.seed}: `), `--planted ${REWRITE_PLANTED}`);
    expect(failures.length, `--planted ${REWRITE_PLANTED} changes one result: ${failures.join(' | ')}`).toBe(1);

    // 3. Wasmtime and the browser's engine, on the rewritten bytes through the web runner.
    const [runner] = runSandbox(bin('deep-sandbox'), [{ call: 'web_runner' }], 'the web runner');
    const page = await inChrome(str(runner!['source'], 'web_runner: source'), honest.map((n): JsonObject => ({ rewritten: n.rewritten, role: 'provider', seed: ARG, budget: BUDGET, read: READ })));
    expect(page.userAgent, 'the page ran in headless Chrome').toMatch(/HeadlessChrome|Chrome\//);
    expect(page.replies.length, 'headless Chrome: one reply per program').toBe(honest.length);
    none(honest.map((n, i) => ({ n, browser: resultOf(page.replies[i], `seed ${n.seed}: the browser's run of the rewrite`) })).filter(({ n, browser }) => digest(browser) !== digest(n.result))
      .map(({ n, browser }) => `program seed ${n.seed}: the browser's engine gives ${digest(browser)} and wasmtime ${digest(n.result)}`), 'wasmtime against the browser\'s engine');
  }, TIMEOUT);
});
