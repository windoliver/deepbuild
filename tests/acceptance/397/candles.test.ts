// AC1: Five days of one-minute candles draw within the frame budget.
// fixtures/candles-5d-1m.csv holds 7,200 one-minute candles (t in flicks, o, h, l, c). The chart is one `series@1` item
// in a `chart` document whose budget class is `data_view` (The cost model: frame GPU 2 ms, frame CPU 2 ms), decimated
// OHLC per 1 px bucket into a 1,440 u pane, so five candles fall in each pixel column. Its x position eases by 2 u
// over 60 s, so every frame has something to draw (every class draws nothing while still). The frame times come
// from `deep-gpu run`'s `live` call, the app's live window that the perf lane's `canvas.mjs class` reads (#379):
// five runs of 30 warm-up and 300 judged frames, each run's p95 against the class. The judged test reads its timings,
// then off a reference Mac, or on one that is loaded, skips as INCONCLUSIVE; it never passes by skipping.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, arr, checked, cleanLook, environmentProblem, f32Column, fixtureBytes, i64s, issuesOf, judge, lines, lookWith, near, num, obj, p95,
  readPng, rolesOf, shownIssues, useBuilds, useTemp, writeJson, type Image, type JsonObject, type Rgb,
} from './helpers.ts';

const builds = useBuilds([{ bin: 'deep-canvas-render' }, { bin: 'deep-gpu' }]);
const temp = useTemp('candles');
const render = (): string => builds.path({ bin: 'deep-canvas-render' });
const gpu = (): string => builds.path({ bin: 'deep-gpu' });

const ROLES = rolesOf('candles');
const LIMIT_MS = 2; // The cost model, budget class "data view": frame GPU 2 ms, frame CPU 2 ms.
const WARM_UP = 30;
const JUDGED = 300;

interface Candles { t: bigint[]; o: number[]; h: number[]; l: number[]; c: number[] }
function candles(): Candles {
  const rows = fixtureBytes('candles-5d-1m.csv').toString('utf8').trim().split('\n');
  expect(rows[0], 'the candles file has its header').toBe('t,o,h,l,c');
  const out: Candles = { t: [], o: [], h: [], l: [], c: [] };
  for (const line of rows.slice(1)) {
    const [t, o, h, l, c] = line.split(',');
    out.t.push(BigInt(t!)); out.o.push(Number(o)); out.h.push(Number(h)); out.l.push(Number(l)); out.c.push(Number(c));
  }
  return out;
}

/** The chart: as `raster` takes it (with `id`, `layers` and item `layer`), or as a live session's writer sends it. */
function chart(live: boolean): JsonObject {
  const d = candles();
  const n = d.t.length;
  const series: JsonObject = {
    id: 'candles', kind: 'series@1', name: 'Candles', order: 'a0',
    params: {
      source: 'reading:01JB397R000000000000000001#candles',
      t: { dtype: 'i64', len: n, data: i64s(d.t) },
      o: f32Column(d.o), h: f32Column(d.h), l: f32Column(d.l), c: f32Column(d.c),
      window: [Number(d.t[0]), Number(d.t[n - 1])],
      decimate: 'ohlc', bucket: '1px', marks: ['candle'], candle: { up: 'candle_up', down: 'candle_down' },
      box: [20, 20, 1440, 440],
    },
  };
  const doc: JsonObject = {
    format: 1, profile: 'chart', title: 'Five days of one-minute candles',
    description: 'Seven thousand two hundred one-minute candles over five days, decimated per pixel column.',
    size: [1480, 480], budget: { class: 'data_view' }, items: { candles: series },
  };
  if (live) {
    doc['transport'] = { span: '60s' };
    doc['channels'] = { pan: { target: 'items/candles/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '60s', value: 2, interp: 'linear' } } } };
  } else {
    doc['id'] = 'chart-candles';
    doc['layers'] = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
    series['layer'] = 'main';
  }
  return doc;
}

interface Frame { frame: number; gpu_ms: number; cpu_ms: number; drawn: boolean }
interface Live { frames: Frame[]; session: JsonObject }

/** `deep-gpu run` with one `live` call per entry of `runs` (each that many frames), in one process. */
function live(dir: string, look: JsonObject, runs: number[]): Live[] {
  const doc = writeJson(dir, 'candles.json', chart(true));
  const calls = runs.map((frames) => ({ call: 'live', look, frames, fps: 60, sessions: [{ session: 's-0', writer: 'agent:candles', doc }] }));
  const [answer] = lines(gpu(), ['run'], [{ out: dir, calls }]);
  const a = obj(answer, 'deep-gpu run: the answer');
  if (a['code'] === 'unsupported_platform') expect.fail('INCONCLUSIVE: deep-gpu reports unsupported_platform; the live window is the reference platform\'s; this is not a pass');
  const replies = arr(a['replies'], `deep-gpu run: replies (${JSON.stringify(a).slice(0, 1500)})`);
  expect(replies.length, 'one reply per live call').toBe(runs.length);
  return replies.map((r, k) => {
    const reply = obj(r, `live reply ${k}`);
    expect(reply['code'], `live call ${k} answers frames, not a refusal: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
    const session = obj(arr(reply['sessions'], 'live: sessions').map((s) => obj(s, 'session row')).find((s) => s['session'] === 's-0'), 'live: the session row s-0');
    const frames = arr(reply['frames'], 'live: frames').map((f, i) => {
      const fr = obj(f, `frame ${i}`);
      const view = arr(fr['views'], `frame ${i}: views`).map((v) => obj(v, 'view')).find((v) => v['session'] === 's-0');
      return { frame: num(fr['frame'], `frame ${i}.frame`), gpu_ms: num(fr['gpu_ms'], `frame ${i}.gpu_ms`), cpu_ms: num(fr['cpu_ms'], `frame ${i}.cpu_ms`), drawn: view?.['drawn'] === true };
    });
    return { frames, session };
  });
}

function count(image: Image, color: Rgb): number {
  let n = 0;
  for (let i = 0; i < image.rgba.length; i += 4) if (near([image.rgba[i]!, image.rgba[i + 1]!, image.rgba[i + 2]!], color, 2)) n++;
  return n;
}

describe('AC1 five days of one-minute candles draw within the frame budget', () => {
  it('AC1 (draw) the 7,200 candles pass the check as a series@1 item and draw in their up and down roles', () => {
    const d = candles();
    expect(d.t.length, 'the fixture is five days of one-minute candles').toBe(5 * 24 * 60);
    expect(d.t.every((t, i) => i === 0 || t - d.t[i - 1]! === 60n * 705_600_000n), 'one candle a minute, t in flicks, strictly increasing').toBe(true);
    const ups = d.o.filter((o, i) => d.c[i]! > o).length;
    expect(ups > 1000 && d.t.length - ups > 1000, 'the fixture holds both up and down candles').toBe(true);
    const look = lookWith(cleanLook(render()), ROLES);
    const [c] = lines(render(), ['check'], [{ doc: chart(false), look }]);
    const check = checked(c, 'check of the candle chart');
    const skipped = [...check.issues, ...issuesOf(check.raw['notices'], 'check: notices')].filter((i) => ['unknown_kind', 'module_missing', 'unknown_field'].includes(i.code));
    expect(skipped.map((i) => `${i.code} ${i.ids.join(',')}`), `series@1 is a kind this build draws: ${shownIssues(check)}`).toEqual([]);
    expect(check.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `the chart passes the check: ${shownIssues(check)}`).toEqual([]);
    const out = `${temp()}/candles.png`;
    const [answer] = lines(render(), ['raster'], [{ out, doc: chart(false), look }]);
    expect(obj(answer, 'raster')['ok'], `raster draws the chart: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
    const image = readPng(out);
    expect([image.width, image.height], 'the PNG is the document\'s size').toEqual([1480, 480]);
    expect(count(image, ROLES['candle_up']!), 'up candles draw in the candle_up role').toBeGreaterThan(500);
    expect(count(image, ROLES['candle_down']!), 'down candles draw in the candle_down role').toBeGreaterThan(500);
  }, TIMEOUT);

  it('AC1 (live) the chart is a live data_view session in the app\'s live window and draws in every frame', () => {
    const look = lookWith(cleanLook(render()), ROLES);
    const [run] = live(temp(), look, [60]);
    const s = run!.session;
    expect(s['state'], `the session is live, not refused: ${JSON.stringify(s).slice(0, 2000)}`).toBe('live');
    expect(s['class'], 'the session draws under the data view budget class it names').toBe('data_view');
    const issues = issuesOf(s['issues'], 'session issues');
    expect(issues.filter((i) => ['unknown_kind', 'module_missing'].includes(i.code)).map((i) => i.code), 'series@1 is drawn, not skipped').toEqual([]);
    const revisions = arr(s['revisions'], 'session revisions').map((r) => obj(r, 'revision'));
    expect(revisions[0]?.['outcome'], 'its revision is current').toBe('current');
    expect(run!.frames.length, 'every frame of the run is presented').toBe(60);
    expect(run!.frames.filter((f) => !f.drawn).map((f) => f.frame), 'the moving chart draws in every frame').toEqual([]);
  }, TIMEOUT);

  it('AC1 (budget) each of five runs keeps its p95 frame GPU and CPU time within the data view class\'s 2 ms', (ctx) => {
    const look = lookWith(cleanLook(render()), ROLES);
    const runs = live(temp(), look, Array.from({ length: 5 }, () => WARM_UP + JUDGED));
    for (const [k, run] of runs.entries()) {
      expect(run.session['state'], `run ${k}: the session is live`).toBe('live');
      const judged = run.frames.slice(WARM_UP);
      expect(judged.length, `run ${k}: ${JUDGED} judged frames`).toBe(JUDGED);
      expect(judged.filter((f) => !f.drawn).length, `run ${k}: every judged frame draws the chart`).toBe(0);
    }
    const gpuP95 = runs.map((r) => p95(r.frames.slice(WARM_UP).map((f) => f.gpu_ms)));
    const cpuP95 = runs.map((r) => p95(r.frames.slice(WARM_UP).map((f) => f.cpu_ms)));
    console.log(`AC1 readings: GPU p95 ${gpuP95.map((v) => v.toFixed(3)).join(', ')} ms; CPU p95 ${cpuP95.map((v) => v.toFixed(3)).join(', ')} ms`);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    judge(ctx, 'AC1 frame GPU p95 (ms)', gpuP95, LIMIT_MS);
    judge(ctx, 'AC1 frame CPU p95 (ms)', cpuP95, LIMIT_MS);
  }, TIMEOUT);
});
