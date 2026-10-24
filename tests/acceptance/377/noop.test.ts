// #377.8131b7ba (first half): the noop lane runs the render-logic tests without a GPU. The lane is a
// lane named `noop` in scripts/lanes.mjs's `checks` (the local preflight's lanes). The GPU layer runs
// on wgpu's noop backend when started with `--backend noop`; the second test is the Oracle page's port
// of wgpu's own tests/tests/wgpu-validation/noop.rs at eddf0b4c8f2c50b7895ad26ee946401e563cdd32 (an
// adapter only when the noop backend is asked for; a device that creates, writes and reads back
// buffers), run against our GPU layer's device rather than wgpu's. The compile-thread bound (the
// criterion's second half) is in budgets.test.ts. At the base there is no `noop` lane and no `deep-gpu`.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  REPO, RESOURCES, SCENES, SURFACE, arr, compileCall, framesCall, framesReply, loadScene, num, obj, resourcesReply, run, scenario, slotHash, str,
  surfaceReply, useBuilds, useOut, type JsonObject,
} from './helpers.ts';

interface Lane { name: string; commands: string[][]; paths?: string[] }
const { checks } = (await import('../../../scripts/lanes.mjs')) as unknown as { checks: Lane[] };

const builds = useBuilds(['default']);
const out = useOut();
const SCENE = loadScene(SCENES.handoff);
const BUFFER: JsonObject = { call: 'buffer', size: 8, writes: [{ offset: 0, bytes: [1, 2, 3, 4] }, { offset: 4, bytes: [5, 6, 7, 8] }] };

function readBack(reply: JsonObject, what: string): number[] {
  expect(num(reply['size'], `${what}: size`), `${what}: the buffer is 8 bytes`).toBe(8);
  return arr(reply['read'], `${what}: read`).map((v) => num(v, `${what}: read`));
}

/** What the render logic decides for a scene, with no pixels: what any backend must agree on. */
function logic(backend?: 'noop'): { resources: string[]; keys: string[]; frames: string[]; hashes: (string | null)[] } {
  const [frames, resources, compiled] = run(builds.bin(), scenario(out(), [framesCall({ scene: SCENES.handoff, count: 3 }), RESOURCES, compileCall(SCENES.pipelines)]), backend ? { backend } : {});
  const f = framesReply(frames!, `frames on ${backend ?? 'the default backend'}`).frames;
  const r = resourcesReply(resources!).resources.map((x) => `${x.module}/${x.name}:${x.kind}`).sort();
  const keys = arr(obj(compiled!, 'compile')['pipelines'], 'compile: pipelines').map((p, i) => str(obj(p, `pipelines[${i}]`)['key'], `pipelines[${i}].key`)).sort();
  return { resources: r, keys, frames: f.map((x) => `${x.frame}:${x.size.join('x')}:${x.settling}`), hashes: f.map((x) => x.pixel_hash) };
}

describe('#377.8131b7ba the noop lane runs the render-logic tests without a GPU', () => {
  it('#377.8131b7ba a lane named noop is in the local preflight\'s checks, and each of its commands passes', () => {
    const lane = checks.find((l) => l.name === 'noop');
    expect(lane, 'scripts/lanes.mjs has a lane named noop').toBeDefined();
    expect(lane!.commands.length, 'the noop lane runs something').toBeGreaterThan(0);
    for (const [command, ...args] of lane!.commands) {
      const r = spawnSync(command!, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000 });
      expect(r.status, `noop lane: ${[command, ...args].join(' ')} exits 0\n${(r.stdout ?? '').slice(-3000)}\n${(r.stderr ?? '').slice(-3000)}`).toBe(0);
    }
  }, 3_600_000);

  it('#377.8131b7ba the GPU layer\'s device on wgpu\'s noop backend, ported from wgpu\'s noop.rs: a noop device only when asked for, and one that creates, writes and reads back a buffer', () => {
    // device_is_available_when_requested + device_and_buffers
    const [frames, surface, buffer] = run(builds.bin(), scenario(out(), [framesCall({ scene: SCENES.handoff, count: 1 }), SURFACE, BUFFER]), { backend: 'noop' });
    framesReply(frames!, 'a frame on the noop backend');
    const s = surfaceReply(surface!, 'the surface on the noop backend');
    expect(s.device.backend, 'asked for, the device is on the noop backend').toBe('noop');
    expect(s.device.count).toBe(1);
    expect(readBack(buffer!, 'the noop buffer'), 'written at 0 and 4, read back whole').toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // device_is_not_available_by_default: started without asking, the GPU layer never runs on noop.
    const [f2, s2, b2] = run(builds.bin(), scenario(out(), [framesCall({ scene: SCENES.handoff, count: 1 }), SURFACE, BUFFER]));
    framesReply(f2!, 'a frame on the default backend');
    const d = surfaceReply(s2!, 'the surface on the default backend').device.backend;
    expect(d, 'not asked for, the device is not the noop backend').not.toBe('noop');
    if (process.platform === 'darwin') expect(d, 'on macOS the GPU layer runs on Metal').toBe('metal');
    expect(readBack(b2!, 'the default buffer')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  }, 1_800_000);

  it('#377.8131b7ba render logic on the noop backend is the default backend\'s (declared resources, pipeline keys, frames and their sizes and settling), and the noop backend makes no pixels', () => {
    const noop = logic('noop');
    const metal = logic();
    expect(metal.keys.length, 'the pipelines scene compiles 48 pipelines').toBe(48);
    expect(new Set(metal.keys).size, 'each with its own key').toBe(48);
    expect(metal.resources.length, 'the handoff scene declares resources').toBeGreaterThan(0);
    expect(noop.resources, 'the declared resources are the same on noop').toEqual(metal.resources);
    expect(noop.keys, 'the pipeline keys are the same on noop').toEqual(metal.keys);
    expect(noop.frames, 'the same frames, sizes and settling').toEqual(metal.frames);
    expect(metal.hashes, 'the default backend draws the scene').toEqual([0, 1, 2].map((n) => slotHash(SCENE, n, SCENE.size)));
    expect(noop.hashes, 'the noop backend makes no pixels, so it reports none').toEqual([null, null, null]);
  }, 1_800_000);
});
