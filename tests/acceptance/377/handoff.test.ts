// #377.756c6dce: each platform's GPU surface handoff ships only after it passes one conformance fixture
// against the copy path on the same machine (parity/gpu/surface-handoff.scene). Every check here reads
// the scene's own numbers: the bytes each frame holds are computed from the scene by helpers.ts, the
// window is captured from the window the binary draws (README: Window capture), and the page under the
// view is captured alone. The handoff's timing parts are in budgets.test.ts. At the base there is no
// `deep-gpu` binary, so each test fails at the build assertion.
import { describe, expect, it } from 'vitest';
import {
  HEALTH, PARTS, SCENES, SURFACE, arr, conformanceCall, conformanceReply, everyFrame, expectNotBlank, fenceCoverage, fenceProblems, framesCall,
  framesReply, imageHash, loadScene, obj, overProblems, readCapture, run, scenario, sizeAt, slotHash, staleProblems, surfaceReply, tear, useBuilds,
  useOut, type Fence, type Frame, type Image,
} from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const SCENE = loadScene(SCENES.handoff);
const H = SCENES.handoff;

/** Frames whose pixel_hash isn't the scene's bytes for that frame at its size, by frame. */
function wrongSlots(frames: Frame[], resize: boolean): string[] {
  return frames.flatMap((f) => {
    const size = sizeAt(SCENE, f.frame, resize);
    if (f.size[0] !== size[0] || f.size[1] !== size[1]) return [`frame ${f.frame} drew at ${f.size.join(' × ')}, not ${size.join(' × ')}`];
    return f.pixel_hash === slotHash(SCENE, f.frame, size) ? [] : [`frame ${f.frame}'s slot (${f.pixel_hash}) isn't the scene's frame ${f.frame} at ${size.join(' × ')}`];
  });
}

describe('#377.756c6dce the surface handoff passes parity/gpu/surface-handoff.scene against the copy path on this machine', () => {
  it('#377.756c6dce the fixture is the issue\'s: a 1936 × 1584 premultiplied BGRA frame with an alpha ramp, a grey ramp and a marker that moves every frame', () => {
    // The fixture's own consistency, checked before anything reads it.
    expect(SCENE.size).toEqual([1936, 1584]);
    expect(SCENE.format).toBe('bgra8_premultiplied');
    const names = (SCENE.regions ?? []).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['alpha_ramp', 'grey_ramp', 'marker', 'glow', 'object', 'pane']));
    const hashes = new Set(Array.from({ length: 30 }, (_, n) => slotHash(SCENE, n, SCENE.size)));
    expect(hashes.size, 'the marker moves every frame: 30 frames hold 30 different slots').toBe(30);
    // The binary under test draws it.
    const [reply, surface] = run(builds.bin(), scenario(out(), [framesCall({ scene: H, count: 2 }), SURFACE]));
    const r = framesReply(reply!, 'two frames of the fixture');
    everyFrame(r, 0, 2, 'two frames of the fixture');
    expect(wrongSlots(r.frames, false), 'each frame\'s slot holds exactly the scene\'s bytes for that frame').toEqual([]);
    const s = surfaceReply(surface!);
    expect(s.device.count, 'one wgpu device for the app').toBe(1);
    expect(s.format).toBe('bgra8_premultiplied');
    expect(s.color_space).toBe('srgb');
    expect(s.size_px).toEqual([1936, 1584]);
    expect([2, 3], 'the surface has 2 or 3 slots').toContain(s.slots.length);
    for (const slot of s.slots) expect(['free', 'rendering', 'ready', 'on_screen']).toContain(slot.state);
    expect(s.msaa).toBe('transient');
    expect(s.internal_scale >= 0.5 && s.internal_scale <= 1, `internal_scale ${s.internal_scale} is within 0.5 to 1`).toBe(true);
    if (process.platform === 'darwin') expect(s.path, 'macOS passes the fixture, so it hands off zero copy').toBe('zero_copy');
  }, 1_800_000);

  it('#377.756c6dce every frame of the fixture is pixel-identical to the copy path\'s: the same slot bytes and the same window, frame by frame', () => {
    const o = out();
    const [zero, copy] = run(builds.bin(), scenario(o, [
      framesCall({ scene: H, path: 'zero_copy', window_hash: true, capture: [0, SCENE.frames - 1] }),
      framesCall({ scene: H, path: 'copy', window_hash: true, capture: [0] }),
    ]));
    const z = framesReply(zero!, 'the zero-copy run');
    const c = framesReply(copy!, 'the copy run');
    everyFrame(z, 0, SCENE.frames, 'the zero-copy run');
    everyFrame(c, 0, SCENE.frames, 'the copy run');
    expect(z.frames.every((f) => f.path === 'zero_copy'), 'the zero-copy run handed off zero copy').toBe(true);
    expect(c.frames.every((f) => f.path === 'copy'), 'the copy run handed off by copy').toBe(true);
    expect(wrongSlots(z.frames, false), 'zero copy: each slot is the scene\'s frame').toEqual([]);
    expect(wrongSlots(c.frames, false), 'copy: each slot is the scene\'s frame').toEqual([]);
    // The window hash is what the capture holds, and the window isn't blank (the blank guard first).
    const first = readCapture(o, z.frames[0]!.window, 'zero copy, frame 0');
    expect(imageHash(first), 'window_hash is the SHA-256 of the captured window\'s RGBA pixels').toBe(z.frames[0]!.window_hash);
    expectNotBlank(first, 'the zero-copy window at frame 0');
    expectNotBlank(readCapture(o, c.frames[0]!.window, 'copy, frame 0'), 'the copy window at frame 0');
    const differ = z.frames.filter((f, i) => f.window_hash === null || f.window_hash !== c.frames[i]!.window_hash).map((f) => f.frame);
    expect(differ, 'every frame\'s window is pixel-identical on the zero-copy and copy paths (frames that differ)').toEqual([]);
    expect(new Set(z.frames.map((f) => f.window_hash)).size, 'the window changes with the marker: no two of the first 23 frames show one window').toBeGreaterThanOrEqual(23);
  }, 1_800_000);

  it('#377.756c6dce captured from the window, the glow beyond the 3D object over the 2D page and the 50% pane match the f64 premultiplied over of the slot onto the page within one code value, on both paths', () => {
    const o = out();
    const [page, zero, copy] = run(builds.bin(), scenario(o, [
      framesCall({ scene: H, count: 1, layer: false, capture: 'every' }),
      framesCall({ scene: H, count: 1, path: 'zero_copy', capture: 'every' }),
      framesCall({ scene: H, count: 1, path: 'copy', capture: 'every' }),
    ]));
    const pageImg = readCapture(o, framesReply(page!).frames[0]!.window, 'the page alone');
    expectNotBlank(pageImg, 'the page alone');
    for (const [name, reply] of [['zero copy', zero!], ['copy', copy!]] as const) {
      const f = framesReply(reply, name).frames[0]!;
      const win = readCapture(o, f.window, `${name}, frame 0`);
      expectNotBlank(win, `the ${name} window`);
      expect(overProblems(SCENE, 0, SCENE.size, win, pageImg, ['glow', 'pane', 'alpha_ramp'], name), `${name}: the window is the premultiplied over of the slot onto the page`).toEqual([]);
    }
  }, 1_800_000);

  it('#377.756c6dce a planted patch that divides alpha out (--planted divides_alpha) loses the glow and fails, naming the glow', () => {
    const o = out();
    const [page, zero] = run(builds.bin(), scenario(o, [
      framesCall({ scene: H, count: 1, layer: false, capture: 'every' }),
      framesCall({ scene: H, count: 1, path: 'zero_copy', capture: 'every' }),
    ]), { planted: 'divides_alpha' });
    const pageImg = readCapture(o, framesReply(page!).frames[0]!.window, 'the page alone');
    const win = readCapture(o, framesReply(zero!).frames[0]!.window, 'the planted window');
    const problems = overProblems(SCENE, 0, SCENE.size, win, pageImg, ['glow'], 'divides_alpha');
    expect(problems.join('\n'), 'the planted compositor fails the over check on the glow').toMatch(/glow/);
  }, 1_800_000);

  it(`#377.756c6dce over ${SCENE.fence_frames} frames no slot is drawn into while on screen or released before GPUI's command buffer completes, as the fences record`, () => {
    const count = SCENE.fence_frames!;
    const [reply, surface] = run(builds.bin(), scenario(out(), [framesCall({ scene: H, count, fences: true }), SURFACE]));
    const r = framesReply(reply!, 'the fence run');
    everyFrame(r, 0, count, 'the fence run');
    const slots = surfaceReply(surface!).slots.length;
    expect([2, 3]).toContain(slots);
    const fences = r.fences;
    expect(fences, 'the run returns the fence record').not.toBeNull();
    expect(fenceCoverage(fences!, count, 'the fence record'), 'every frame is rendered once and shown').toEqual([]);
    expect(fences!.filter((e) => e.event === 'gpui_done').length, 'the record holds GPUI\'s command buffer completions').toBeGreaterThan(0);
    expect(fenceProblems(fences!, slots, 'the fence record'), 'no slot drawn into while on screen, none released before GPUI\'s command buffer completed').toEqual([]);
    // The check's own twins, on this record: a release moved before its command buffer completes, and a
    // render into the slot on screen, must each fail it.
    const relIdx = fences!.findIndex((e) => e.event === 'release');
    const rel = fences![relIdx]!;
    const shownBy = [...fences!.slice(0, relIdx)].reverse().find((e) => e.event === 'show' && e.slot === rel.slot)!;
    const doneIdx = fences!.findIndex((e) => e.event === 'gpui_done' && e.cb === shownBy.cb);
    const early: Fence[] = fences!.map((e) => ({ ...e }));
    const [moved] = early.splice(relIdx, 1);
    early.splice(doneIdx, 0, moved!);
    early.forEach((e, i) => { e.seq = i; });
    expect(fenceProblems(early, slots, 'twin').join('\n'), 'a release before GPUI\'s completion fails').toMatch(/released before GPUI's command buffer/);
    const showIdx = fences!.findIndex((e) => e.event === 'show');
    const sh = fences![showIdx]!;
    const into: Fence[] = [...fences!.slice(0, showIdx + 1), { seq: 0, event: 'render', slot: sh.slot, frame: 99_999, cb: null }, ...fences!.slice(showIdx + 1)].map((e, i) => ({ ...e, seq: i }));
    expect(fenceProblems(into, slots, 'twin').join('\n'), 'a render into the slot on screen fails').toMatch(/drawn into while on screen/);
  }, 1_800_000);

  it('#377.756c6dce a planted handoff that releases a shown slot before GPUI\'s command buffer completes (--planted releases_before_completion) fails the fence record, naming the slot', () => {
    const [reply, surface] = run(builds.bin(), scenario(out(), [framesCall({ scene: H, count: 300, fences: true }), SURFACE]), { planted: 'releases_before_completion' });
    const r = framesReply(reply!, 'the planted fence run');
    const problems = fenceProblems(r.fences ?? [], surfaceReply(surface!).slots.length, 'releases_before_completion');
    expect(problems.join('\n'), 'the fence record shows a release before completion').toMatch(/released before GPUI's command buffer .* \(slot \d+/);
  }, 1_800_000);

  it('#377.756c6dce a resize every 50 frames and one forced device loss show no stale or torn frame, on the zero-copy path and against the copy path', () => {
    const o = out();
    const count = SCENE.stale_frames!;
    const loss = SCENE.device_loss_at!;
    const every = SCENE.resize!.every;
    const events = Array.from({ length: Math.floor((count - 1) / every) }, (_, k) => (k + 1) * every);
    const captured = [...new Set([...events.flatMap((r) => [r - 1, r, r + 1]), loss - 1, loss + 1, loss + 2])].sort((a, b) => a - b);
    const [page, zero, copy] = run(builds.bin(), scenario(o, [
      framesCall({ scene: H, count: 1, layer: false, capture: 'every' }),
      framesCall({ scene: H, count, resize: true, lose_device_at: loss, window_hash: true, capture: captured, path: 'zero_copy' }),
      framesCall({ scene: H, count, resize: true, lose_device_at: loss, window_hash: true, path: 'copy' }),
    ]));
    const pageImg = readCapture(o, framesReply(page!).frames[0]!.window, 'the page alone');
    const z = framesReply(zero!, 'the resize and device-loss run');
    const c = framesReply(copy!, 'the copy run of the same schedule');
    expect(z.device_losses, 'the device was lost once').toBe(1);
    const seen = z.frames.map((f) => f.frame);
    expect(seen.every((n, i) => i === 0 || n > seen[i - 1]!), 'frames are presented in order, none twice').toBe(true);
    const missing = Array.from({ length: count }, (_, n) => n).filter((n) => n !== loss && !seen.includes(n));
    expect(missing, `every frame but the one the device was lost in (${loss}) is presented`).toEqual([]);
    expect(wrongSlots(z.frames, true), 'each presented slot is its own frame at its scheduled size').toEqual([]);
    const copyBy = new Map(c.frames.map((f) => [f.frame, f]));
    const unlike = z.frames.filter((f) => copyBy.has(f.frame) && copyBy.get(f.frame)!.window_hash !== f.window_hash).map((f) => f.frame);
    expect(unlike, 'each window equals the copy path\'s for the same frame').toEqual([]);
    const caps = new Map<number, Image>();
    const problems: string[] = [];
    for (const n of captured) {
      const f = z.frames.find((x) => x.frame === n);
      expect(f, `frame ${n}, around a resize or the device loss, is presented`).toBeDefined();
      const img = readCapture(o, f!.window, `frame ${n}`);
      caps.set(n, img);
      problems.push(...staleProblems(SCENE, n, sizeAt(SCENE, n, true), img, pageImg, `frame ${n}`));
    }
    expect(problems, 'no captured frame around a resize or the device loss is stale or torn').toEqual([]);
    // The check's own twins: frame 50's window judged as frame 49 (stale), and rows of 51 over 50 (torn).
    const r = events[0]!;
    expect(staleProblems(SCENE, r - 1, sizeAt(SCENE, r - 1, true), caps.get(r)!, pageImg, 'twin').length, 'a frame judged as the one before it fails').toBeGreaterThan(0);
    const torn = tear(caps.get(r + 1)!, caps.get(r)!, SCENE.view[1] + Math.floor(sizeAt(SCENE, r, true)[1] / 2));
    expect(staleProblems(SCENE, r, sizeAt(SCENE, r, true), torn, pageImg, 'twin').length, 'a torn frame fails').toBeGreaterThan(0);
  }, 1_800_000);

  it('#377.756c6dce the conformance run: macOS passes every part of the fixture on this machine, keeps the zero-copy path, and health shows no handoff reading', () => {
    const [conf, surface, health] = run(builds.bin(), scenario(out(), [conformanceCall(H), framesCall({ scene: H, count: 1 }), HEALTH]));
    const c = conformanceReply(conf!);
    expect(c.platform).toBe(process.platform === 'darwin' ? 'macos' : c.platform);
    expect(c.parts.map((p) => p.part).sort(), 'the conformance run reports each part of the fixture').toEqual([...PARTS].sort());
    expect(c.parts.filter((p) => p.result !== 'pass'), 'every part passes on this machine').toEqual([]);
    expect(c.result).toBe('pass');
    expect(c.path).toBe('zero_copy');
    expect(framesReply(surface!).frames[0]!.path, 'frames after it hand off zero copy').toBe('zero_copy');
    const readings = arr(obj(health!, 'health')['readings'], 'health: readings').map((v) => obj(v, 'a reading'));
    expect(readings.filter((x) => x['part'] !== undefined), 'no reading names a failed part of the handoff').toEqual([]);
  }, 3_600_000);

  it('#377.756c6dce a platform that fails a part uses the copy path, capped at 30 fps at a render scale of 0.5, and health shows one reading naming each part that failed (--planted divides_alpha fails premultiplied)', () => {
    const [conf, frames, surface, health] = run(builds.bin(), scenario(out(), [conformanceCall(H), framesCall({ scene: H, count: 1 }), SURFACE, HEALTH]), { planted: 'divides_alpha' });
    const c = conformanceReply(conf!);
    expect(c.result).toBe('fail');
    expect(c.parts.find((p) => p.part === 'premultiplied')?.result, 'the premultiplied part fails').toBe('fail');
    expect(c.path).toBe('copy');
    expect(framesReply(frames!).frames[0]!.path, 'frames after it hand off by copy').toBe('copy');
    const s = surfaceReply(surface!);
    expect(s.path).toBe('copy');
    expect(s.fps_cap, 'the copy path is capped at 30 fps').toBe(30);
    expect(s.internal_scale, 'at a render scale of 0.5').toBe(0.5);
    const failed = c.parts.filter((p) => p.result === 'fail').map((p) => p.part).sort();
    const named = arr(obj(health!, 'health')['readings'], 'health: readings').map((v) => obj(v, 'a reading')).filter((x) => x['part'] !== undefined);
    expect(named.map((x) => String(x['part'])).sort(), 'health shows one reading for each part that failed, naming it').toEqual(failed);
  }, 3_600_000);
});
