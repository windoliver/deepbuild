import { describe, expect, it } from 'vitest';
import { LOOK, VSYNC_60, arr, clone, fixture, num, obj, render, useBinaries, type JsonObject } from './helpers.ts';

useBinaries('deep-canvas-render');

const BOARD = fixture('parity/2d/patch-equals-rebuild.board');

/** The board with nothing that changes: no channel, no bound value, and no item that shows one. */
function stillBoard(): JsonObject {
  const doc = clone(BOARD);
  delete doc['channels'];
  delete doc['bound_values'];
  delete obj(doc['items'], 'items')['count'];
  return doc;
}

interface Vsync { t: number; presented: boolean; commandBuffers: number; gpuNs: number }

function frames(doc: JsonObject, vsyncs: number): Vsync[] {
  const out = render('frames', {
    doc, look: LOOK, view: { zoom: 1, theme: 'light' }, readings: { 'reading:01JB0000000000000000000000': 1234 }, refresh_hz: 60, vsyncs,
  });
  const list = arr(out['vsyncs'], 'frames: vsyncs');
  expect(list.length, 'frames: one record per vsync').toBe(vsyncs);
  return list.map((v, k) => {
    const r = obj(v, `vsyncs[${k}]`);
    expect(typeof r['presented'], `vsyncs[${k}].presented is a boolean`).toBe('boolean');
    const rec = {
      t: num(r['t'], `vsyncs[${k}].t`), presented: r['presented'] === true,
      commandBuffers: num(r['command_buffers'], `vsyncs[${k}].command_buffers`), gpuNs: num(r['gpu_ns'], `vsyncs[${k}].gpu_ns`),
    };
    expect(rec.t, `vsyncs[${k}] is at k × 1/60 s`).toBe(k * VSYNC_60);
    return rec;
  });
}

describe('AC1 a still view uses no GPU time', () => {
  it('AC1 after its first frame, a still board commits no command buffer and spends no GPU time at any vsync', () => {
    const run = frames(stillBoard(), 120);
    const first = run[0]!;
    // The view opens with one frame: that frame does reach the GPU, so the counters can count.
    expect(first.presented, 'vsync 0 presents the view\'s first frame').toBe(true);
    expect(first.commandBuffers >= 1 && first.gpuNs > 0, `the first frame is drawn on the GPU: ${JSON.stringify(first)}`).toBe(true);
    // A canvas that redraws every vsync, or keeps encoding while nothing changes, fails here.
    const busy = run.slice(1).filter((v) => v.presented || v.commandBuffers !== 0 || v.gpuNs !== 0);
    expect(busy, `a still view drew after its first frame at ${busy.length} vsyncs, first ${JSON.stringify(busy[0])}`).toEqual([]);
  }, 600_000);

  it('AC1 the same board while its live layer moves uses GPU time at every vsync, so the counters are not a fixed zero', () => {
    // The dot's channel runs over [0, 10 s), so every one of these 120 vsyncs has something new to show.
    const run = frames(clone(BOARD), 120);
    // A reporter that always says 0 passes the still test and fails here.
    const idle = run.filter((v) => !v.presented || v.commandBuffers < 1 || v.gpuNs <= 0);
    expect(idle, `a moving view reported no GPU work at ${idle.length} vsyncs, first ${JSON.stringify(idle[0])}`).toEqual([]);
  }, 600_000);

  it('AC1 once the motion ends the view goes still again: no GPU time from the vsync after its last change', () => {
    // The dot reaches its last key at 2 s: vsync 120 shows it, and nothing changes after.
    const doc = clone(BOARD);
    const channel = obj(obj(doc['channels'], 'channels')['dot-x'], 'channels.dot-x');
    obj(obj(channel['keys'], 'keys')['k1'], 'keys.k1')['t'] = '2s';
    const run = frames(doc, 180);
    const moving = run.slice(0, 120).filter((v) => !v.presented || v.gpuNs <= 0);
    expect(moving, `the view drew every vsync while the dot moved; idle at ${JSON.stringify(moving[0])}`).toEqual([]);
    const after = run.slice(121).filter((v) => v.presented || v.commandBuffers !== 0 || v.gpuNs !== 0);
    expect(after, `the view kept drawing after its motion ended, at ${after.length} vsyncs, first ${JSON.stringify(after[0])}`).toEqual([]);
  }, 600_000);
});
