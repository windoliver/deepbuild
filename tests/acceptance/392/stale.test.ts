import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  VSYNC_60, arr, canonical, chroma, contrast, drawn, fixture, isObject, num, obj, pixel, pixelsIn, readPng, sec, seconds, useRenderBinary,
  type Image, type JsonObject, type JsonValue, type Rgb,
} from './helpers.ts';

useRenderBinary();

const scratch = mkdtempSync(join(tmpdir(), 'deep-392-stale-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const DOC = fixture('stale-value.json');
const VALUE = 'open-asks';
const HANDLE = 'reading:01JB3000000000000000000001';
/** The reading was taken 7,000,000 flicks (about 9.9 ms) before the view opened, off any vsync. */
const AS_OF = -7_000_000;
const STALE_AFTER = sec(2);
const WINDOW_END = sec(2.1);
/** 3 s at 60 Hz: vsyncs 0–180. */
const VSYNCS = 181;
/** The count's box on screen (its at.pos plus its box), where the value and its age are drawn. */
const COUNT_BOX: [number, number, number, number] = [16, 48, 280, 24];
const READINGS: JsonObject = { [HANDLE]: { value: 1234, as_of: AS_OF } };

interface Vsync { k: number; t: number; presented: boolean; commandBuffers: number; gpuNs: number; bound: JsonObject }

function frames(extra: JsonObject): Vsync[] {
  const out = drawn('frames', { doc: DOC, look: 'clean', view: { zoom: 1, theme: 'light' }, readings: READINGS, refresh_hz: 60, vsyncs: VSYNCS, ...extra });
  const list = arr(out['vsyncs'], 'frames: vsyncs');
  expect(list.length, 'frames: one record per vsync').toBe(VSYNCS);
  return list.map((v, k) => {
    const r = obj(v, `vsyncs[${k}]`);
    expect(typeof r['presented'], `vsyncs[${k}].presented is a boolean`).toBe('boolean');
    const rec: Vsync = {
      k, t: num(r['t'], `vsyncs[${k}].t`), presented: r['presented'] === true,
      commandBuffers: num(r['command_buffers'], `vsyncs[${k}].command_buffers`), gpuNs: num(r['gpu_ns'], `vsyncs[${k}].gpu_ns`),
      bound: obj(r['bound'], `vsyncs[${k}].bound`),
    };
    expect(rec.t, `vsyncs[${k}] is at k × 1/60 s from the run's start`).toBe(k * VSYNC_60);
    return rec;
  });
}

/**
 * The criterion's check of one run, as failures that each name the bound value: the view's first frame,
 * then nothing drawn until 2.0 s after the reading's as-of time, exactly one frame drawn (with GPU work)
 * between 2.0 and 2.1 s after it, and that frame showing the value greyed with its age. `pinnedAt0` is the
 * time the frame at vsync 0 is pinned to: the host time in a live run, the mapped record time in a replay.
 */
function staleFailures(run: Vsync[], pinnedAt0: number): string[] {
  const name = `bound value ${VALUE}`;
  const failures: string[] = [];
  const age = (v: Vsync): number => pinnedAt0 + v.t - AS_OF;
  const shown = (v: Vsync): JsonObject | null => (isObject(v.bound[VALUE]) ? (v.bound[VALUE] as JsonObject) : null);
  const drew = (v: Vsync): boolean => v.presented || v.commandBuffers !== 0 || v.gpuNs !== 0;
  if (!run[0]?.presented) failures.push(`${name}: the view's first frame was not presented`);
  const early = run.slice(1).filter((v) => age(v) < STALE_AFTER && drew(v));
  if (early.length > 0) failures.push(`${name}: ${early.length} frame(s) drawn before 2.0 s after its as-of time, first at vsync ${early[0]!.k} (${seconds(age(early[0]!))} after it)`);
  const greyEarly = run.filter((v) => age(v) < STALE_AFTER && shown(v)?.['stale'] !== false);
  if (greyEarly.length > 0) failures.push(`${name}: not shown live before 2.0 s after its as-of time, at vsync ${greyEarly[0]!.k}: ${JSON.stringify(shown(greyEarly[0]!))}`);
  const window = run.filter((v) => v.k > 0 && age(v) >= STALE_AFTER && age(v) <= WINDOW_END);
  const drawnIn = window.filter((v) => v.presented);
  if (drawnIn.length !== 1) {
    failures.push(`${name}: ${drawnIn.length} frames drawn between 2.0 and 2.1 s after its as-of time (vsyncs ${window[0]?.k}–${window.at(-1)?.k}), not exactly one`);
  } else {
    const f = drawnIn[0]!;
    if (f.commandBuffers < 1 || f.gpuNs <= 0) failures.push(`${name}: the frame at vsync ${f.k} was presented with no GPU work: ${JSON.stringify(f)}`);
    const s = shown(f);
    if (s?.['stale'] !== true || s['age'] !== age(f)) failures.push(`${name}: the frame at vsync ${f.k} (${seconds(age(f))} after its as-of time) doesn't show it greyed with its age ${age(f)}: ${JSON.stringify(s)}`);
  }
  const idle = window.filter((v) => !v.presented && (v.commandBuffers !== 0 || v.gpuNs !== 0));
  if (idle.length > 0) failures.push(`${name}: GPU work at vsync ${idle[0]!.k}, where no frame was presented`);
  return failures;
}

describe('AC3 a still core view with one bound value of stale_after: 2 s greys it at one frame, on time', () => {
  it('AC3 with no further reading the view draws exactly one frame between 2.0 and 2.1 s after the as-of time, greyed with its age, and none before', () => {
    const run = frames({});
    // A clock that never arms on staleness draws nothing in the window; one that rounds the stale time down
    // draws at vsync 119, 1.993 s after it; one that redraws once stale draws six frames in the window.
    expect(staleFailures(run, 0), 'the live run').toEqual([]);
  }, 900_000);

  it('AC3 the frame drawn then shows the value greyed: its text turns grey and lighter than the live value\'s, and shows its age', () => {
    const live = join(scratch, 'live-119.png'); const stale = join(scratch, 'stale-125.png');
    frames({ captures: [{ vsync: 119, out: live }, { vsync: 125, out: stale }] });
    const before = readPng(live); const after = readPng(stale);
    const ground = pixel(before, 2, 2);
    const ink = (image: Image): Rgb => {
      let best: Rgb = ground; let ratio = 1;
      for (const [x, y] of pixelsIn(image, COUNT_BOX)) {
        const c = pixel(image, x, y); const r = contrast(c, ground);
        if (r > ratio) { ratio = r; best = c; }
      }
      return best;
    };
    const fresh = ink(before); const grey = ink(after);
    expect(contrast(fresh, ground) > 1, `the live value is drawn in its box: ${JSON.stringify(fresh)} on ${JSON.stringify(ground)}`).toBe(true);
    expect(contrast(grey, ground) > 1, `the stale value is drawn in its box: ${JSON.stringify(grey)}`).toBe(true);
    // A clock that shows the stale value in ink, or tints it with a status color, fails here.
    expect(chroma(grey) <= 0.05, `the stale value is grey (OKLab chroma ${chroma(grey).toFixed(3)}): ${JSON.stringify(grey)}`).toBe(true);
    expect(contrast(grey, ground) < contrast(fresh, ground), `greyed: ${JSON.stringify(grey)} has less contrast on the ground than the live ${JSON.stringify(fresh)}`).toBe(true);
    // Its age is shown: the text on screen is not the live text any more.
    const run = frames({});
    const text = (k: number): JsonValue | undefined => obj(run[k]!.bound[VALUE], `vsyncs[${k}].bound.${VALUE}`)['text'];
    expect(typeof text(119), 'the live frame names the value\'s text').toBe('string');
    expect(text(125) !== text(119), `the stale frame's text ${JSON.stringify(text(125))} shows more than the live ${JSON.stringify(text(119))}: its age`).toBe(true);
  }, 900_000);

  it('AC3 a replay an hour later, pinned to the mapped record time, greys it at the same frame', () => {
    const live = frames({});
    const replay = frames({ start: sec(3600), replay: { record_t: 0 } });
    // A replay that reads the host clock finds the reading an hour old at vsync 0 and greys it there.
    expect(staleFailures(replay, 0), 'the replay, judged on its record time').toEqual([]);
    const differ = live.filter((v, k) => v.presented !== replay[k]!.presented || canonical(v.bound) !== canonical(replay[k]!.bound));
    expect(differ.map((v) => `vsync ${v.k}: live ${JSON.stringify([v.presented, v.bound])}, replay ${JSON.stringify([replay[v.k]!.presented, replay[v.k]!.bound])}`),
      'the replay presents and shows the same at every vsync').toEqual([]);
  }, 900_000);

  it('AC3 a planted frame clock that arms only on readings never greys it and fails this check, naming the value', () => {
    const run = frames({ planted: 'arms_only_on_readings' });
    expect(run[0]!.presented, 'the planted clock still draws the first frame').toBe(true);
    expect(run.filter((v) => obj(v.bound[VALUE], `vsyncs[${v.k}].bound.${VALUE}`)['stale'] !== false).map((v) => v.k), 'it never greys the value').toEqual([]);
    const failures = staleFailures(run, 0);
    expect(failures.length > 0, 'the planted clock fails the criterion\'s check').toBe(true);
    expect(failures.every((f) => f.startsWith(`bound value ${VALUE}:`)), `every failure names the value: ${JSON.stringify(failures)}`).toBe(true);
    expect(failures.some((f) => f.includes('0 frames drawn between 2.0 and 2.1 s')), `the failure is the missing frame: ${JSON.stringify(failures)}`).toBe(true);
  }, 900_000);
});
