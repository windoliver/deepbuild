// AC4: the 2D label stays within 0.5 px of its box in a capture of every presented frame while the camera orbits.
// The scene and its label go through `deep show` (two test agents' processes); the hub's current revision is
// drawn by the GPU layer's view in a window (#378's `view3d` with `window`), the label's 2D writer layer beside
// the 3D one, for the 300 frames of the 5 s orbit at 60 fps, the window captured at every present. The label is
// anchored to box-02-01 at 1.5 m above its centre, with its pin (green, the look's `ink`) placed on the anchor.
// The anchor is measured in the same frame's object-ID target: the scene's beacon, a 16 px point mark at that
// world point, drawn in the 3D writer layer above every box so nothing covers it. At the base the hub refuses the
// scene, so nothing reaches the view.
import { describe, expect, it } from 'vitest';
import {
  BEACON, FPS, GPU_BIN, LABEL, LABEL_AGENT, LABELED_BOX, LOOK, ORBIT_FRAMES, SHOW_BIN, SIZE, WINDOW, everyFrame, greenness, idCentroid,
  ink, is3dKind, keepProof, labelProblems, layerOf, obj, readIds, readPng, requireGpu, runGpu, useBins, useOut, view3d, view3Reply,
  viaDeepShow, writerText, type JsonObject, type LabelFrame,
} from './helpers.ts';

const bins = useBins([SHOW_BIN, GPU_BIN]);
const out = useOut();

describe('AC4 the 2D label stays within 0.5 px of its box in a capture of every presented frame while the camera orbits', () => {
  it('AC4 in the window capture of every presented frame of the 5 s orbit, the label in its own 2D writer layer sits within 0.5 px of its anchor on box-02-01', () => {
    requireGpu();
    const hub = viaDeepShow(bins.bin(SHOW_BIN), out(), 'the checkpoint');
    // The label is its own writer's 2D layer, beside the 3D one (scope): a hub that folds it into the scene's
    // layer, which would draw it as a mark in 3D, fails here.
    const labelLayer = layerOf(hub.doc, 'label');
    expect(labelLayer.writer, 'the label is in the label agent\'s writer layer').toBe(writerText(LABEL_AGENT));
    expect(labelLayer.layer, 'a layer other than the scene\'s').not.toBe(layerOf(hub.doc, LABELED_BOX).layer);
    const inLabelLayer = Object.entries(obj(hub.doc['items'], 'the hub\'s items')).filter(([, v]) => (v as JsonObject)['layer'] === labelLayer.layer);
    expect(inLabelLayer.map(([id]) => id).sort(), 'the label\'s layer holds the label\'s items').toEqual(Object.keys(obj(LABEL['items'], 'label')).sort());
    expect(inLabelLayer.filter(([, v]) => is3dKind(String((v as JsonObject)['kind']))).map(([id]) => id), 'and no 3D item: it is a 2D writer layer').toEqual([]);

    const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: hub.path, look: LOOK, size: SIZE, frames: ORBIT_FRAMES, fps: FPS, window: WINDOW, targets: ['ids'], capture: 'every' })]);
    const v = view3Reply(reply!, 'the orbit in the window');
    everyFrame(v, ORBIT_FRAMES, 'the orbit in the window');
    const capture: LabelFrame[] = v.frames.map((f) => {
      const what = `presented frame ${f.frame}`;
      // With no latency each present shows its own frame's slot, so the anchor read from frame n's ID target is the one the window shows.
      expect(f.frame_seq, `${what}: presentation feedback reports the frame its slot carries`).toBe(f.frame);
      const ids = readIds(out(), f, `${what}'s object-ID target`);
      const beacon = idCentroid(ids, BEACON);
      expect(beacon.n, `${what}: the beacon at the label's anchor draws (${beacon.n} px in the ID target)`).toBeGreaterThan(100);
      const window = readPng(out(), f.window, `${what}'s window capture`);
      expect([window.width, window.height], `${what}: the capture is the whole window`).toEqual(WINDOW.size);
      const pin = ink(window, greenness);
      expect(pin.mass, `${what}: the label's pin shows in the window`).toBeGreaterThan(2);
      return { frame: f.frame, frame_seq: f.frame_seq, anchor: [beacon.x + WINDOW.view[0], beacon.y + WINDOW.view[1]], pin: [pin.cx, pin.cy], beaconPixels: beacon.n, pinMass: pin.mass };
    });
    keepProof('ac4-label-capture', capture.map((c, i) => ({ ...c, distance: Math.hypot(c.pin[0] - c.anchor[0], c.pin[1] - c.anchor[1]), window: v.frames[i]!.window })));
    // The camera orbits: the anchor moves more than 1 px every frame, so a label a frame late, or drawn from
    // another frame's evaluation, is off by more than the tolerance.
    const steps = capture.slice(1).map((c, i) => Math.hypot(c.anchor[0] - capture[i]!.anchor[0], c.anchor[1] - capture[i]!.anchor[1]));
    expect(Math.min(...steps), 'the anchor moves more than 1 px between every two presented frames').toBeGreaterThan(1);
    // The measure's twin: the same capture with each pin paired with the frame before's anchor (a label a frame late) fails.
    const late = capture.slice(1).map((c, i) => ({ ...c, anchor: capture[i]!.anchor }));
    expect(labelProblems(late, 'a label a frame late').length, 'the check fails a label drawn a frame late').toBeGreaterThan(0);
    // A label anchored to the box's origin instead of its point, drawn from another frame, or not drawn fails here, naming the frame.
    expect(labelProblems(capture, 'the orbit'), 'the label within 0.5 px of its anchor on the box in every presented frame').toEqual([]);
  }, 1_800_000);
});
