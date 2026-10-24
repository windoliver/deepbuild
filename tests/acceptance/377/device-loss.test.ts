// #377.e281b005: a forced device loss in the middle of a scene rebuilds every declared GPU resource, and
// the next frame's pixel hash equals a clean start's. The scene is parity/gpu/surface-handoff.scene,
// whose marker moves every frame, so a frame drawn from stale state or the wrong time shows; the device
// is lost while frame 120 of 240 draws (`lose_device_at`). At the base there is no `deep-gpu` binary.
import { describe, expect, it } from 'vitest';
import { RESOURCES, SCENES, framesCall, framesReply, loadScene, resourcesReply, run, scenario, slotHash, useBuilds, useOut, type Resource } from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const SCENE = loadScene(SCENES.handoff);
const LOSS = 120;
const COUNT = 240;
const key = (r: Resource): string => `${r.module}/${r.name}`;

/** Declared resources that the rebuild left out or left on the lost device, each named. */
function notRebuilt(before: Resource[], after: Resource[], epoch: number): string[] {
  const now = new Map(after.map((r) => [key(r), r]));
  return before.flatMap((r) => {
    const a = now.get(key(r));
    if (!a) return [`${key(r)} (${r.kind}) isn't declared after the loss`];
    if (a.device_epoch !== epoch) return [`${key(r)} (${r.kind}) is on device epoch ${a.device_epoch}, not the rebuilt device's ${epoch}`];
    return a.kind === r.kind ? [] : [`${key(r)} was a ${r.kind} and is now a ${a.kind}`];
  });
}

describe('#377.e281b005 a forced device loss in the middle of a scene rebuilds every declared GPU resource, and the next frame\'s pixel hash equals a clean start\'s', () => {
  it('#377.e281b005 losing the device at frame 120 of 240 rebuilds every declared resource on the new device, and frame 121 and every later frame hash as a clean start\'s', () => {
    // One scene session: frames 0 to 119, the resources it declared, then frames 120 to 239 with the
    // device lost while frame 120 draws, and the resources again.
    const [first, before, lost, after] = run(builds.bin(), scenario(out(), [
      framesCall({ scene: SCENES.handoff, count: LOSS }),
      RESOURCES,
      framesCall({ scene: SCENES.handoff, from: LOSS, count: COUNT - LOSS, lose_device_at: LOSS }),
      RESOURCES,
    ]));
    const b = resourcesReply(before!, 'resources before the loss');
    const a = resourcesReply(after!, 'resources after the loss');
    const r = framesReply(lost!, 'the frames with the loss');
    const early = framesReply(first!, 'the frames before the loss');
    expect(r.device_losses, 'the device was lost once').toBe(1);
    expect(b.resources.length, 'the scene declares GPU resources before the loss').toBeGreaterThan(0);
    expect(a.device_epoch, 'a new device after the loss').toBe(b.device_epoch + 1);
    expect(notRebuilt(b.resources, a.resources, a.device_epoch), 'every declared resource is rebuilt on the new device').toEqual([]);
    // The check's own twin: one resource left on the lost device fails it, naming it.
    const left = a.resources.map((x, i) => (i === 0 ? { ...x, device_epoch: b.device_epoch } : x));
    expect(notRebuilt(b.resources, left, a.device_epoch).join('\n'), 'a resource not rebuilt is named').toContain(key(a.resources[0]!));

    const next = r.frames.find((f) => f.frame === LOSS + 1);
    expect(next, `frame ${LOSS + 1}, the next after the loss, is presented`).toBeDefined();
    const [clean] = run(builds.bin(), scenario(out(), [framesCall({ scene: SCENES.handoff, from: LOSS + 1, count: 1 })]));
    const fresh = framesReply(clean!, 'a clean start at frame 121').frames[0]!;
    expect(fresh.pixel_hash, 'a clean start draws the scene\'s frame 121').toBe(slotHash(SCENE, LOSS + 1, SCENE.size));
    expect(next!.pixel_hash, `frame ${LOSS + 1}'s pixel hash equals a clean start's`).toBe(fresh.pixel_hash);
    const wrong = [...early.frames, ...r.frames].filter((f) => f.frame !== LOSS && f.pixel_hash !== slotHash(SCENE, f.frame, SCENE.size)).map((f) => f.frame);
    expect(wrong, 'every frame before and after the loss holds its own frame, as a clean start draws it').toEqual([]);
    const after1 = r.frames.filter((f) => f.frame > LOSS).map((f) => f.frame);
    expect(after1, 'every frame after the loss is presented').toEqual(Array.from({ length: COUNT - LOSS - 1 }, (_, i) => LOSS + 1 + i));
  }, 1_800_000);
});
