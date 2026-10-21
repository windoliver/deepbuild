import { describe, expect, it } from 'vitest';
import { batch, fixture, randomDrag, randomPinch, revisionHash, Rng, SEEDS, session, sessions, useBinary, wrapDeg } from './helpers.ts';
import type { Input, JsonObject, Session, State } from './helpers.ts';

const VIEW = fixture('view.json');
const EYE = fixture('eye.json');
const YAW = fixture('yaw.json');
const PAN = fixture('pan2d.json');
const PINCH = fixture('pinch2d.json');

const HD: [number, number] = [1920, 1080];
const BOARD: [number, number] = [1600, 900];
const CENTRE: [number, number] = [960, 540];

useBinary();

/** The saved document is the one that came in: the session's hash, and the hash of the document it hands back. */
function expectDocumentUnchanged(out: Session, doc: JsonObject, label: string): void {
  const want = revisionHash(doc);
  // A session input that writes the camera's pose, a hover or a cutaway into the document changes this hash.
  expect(out.hash, `${label}: the session's document hash is the saved document's revision hash; a view or viewer input changed the document`).toBe(want);
  expect(revisionHash(out.doc), `${label}: the document the session hands back has the saved document's revision hash`).toBe(want);
}

/** No view or viewer input reaches the input track. */
function expectTrackEmpty(out: Session, label: string): void {
  expect(out.track, `${label}: the document's input track is unchanged (empty); a viewer or view input was recorded on it`).toEqual([]);
}

describe('AC1 hover, a camera moved on a view and a view\'s cutaway never change the saved document\'s hash', () => {
  it('AC1 a hover, camera drags, a pinch and the cutaway change session state only; a document-class input alone reaches the track', () => {
    const inputs: Input[] = [
      { op: 'hover', at: CENTRE },
      { op: 'drag', at: [900, 500], delta: [120, 0] },
      { op: 'drag', at: [1000, 600], delta: [0, -60] },
      { op: 'drag', at: [400, 300], delta: [-40, 30] },
      { op: 'drag', at: [1500, 800], delta: [200, 20] },
      { op: 'control', control: 'cutaway', value: false },
      { op: 'pinch', at: CENTRE, scale: 1.25 },
      { op: 'control', control: 'throttle', value: 0.5 },
      { op: 'hover', at: CENTRE },
    ];
    const out = session(VIEW, HD, inputs);
    const first = out.trace[0]!;
    const last = out.trace[out.trace.length - 1]!;

    // The inputs took effect in session state, so the unchanged hash below is not a session that ignored them.
    expect(out.start.camera.azimuth, 'the session starts at the document camera\'s azimuth, 45°').toBeCloseTo(45, 6);
    expect(out.start.camera.elevation, 'the session starts at the document camera\'s elevation, 30°').toBeCloseTo(30, 6);
    expect(first.hover, 'a hover at the view\'s centre resolves to the part under it, the core dot at the target').toBe('core');
    const turned = Math.abs(wrapDeg(last.camera.azimuth - 45)) > 1 || Math.abs(last.camera.elevation - 30) > 1;
    expect(turned, `the drags turned the camera in session state (azimuth ${last.camera.azimuth}, elevation ${last.camera.elevation})`).toBe(true);
    expect(out.start.view['cutaway'], 'the view control starts at its declared default').toBe(true);
    expect(last.view['cutaway'], 'the cutaway is held in session state').toBe(false);
    expect(last.hover, 'the last hover still resolves to the core dot').toBe('core');

    expectDocumentUnchanged(out, VIEW, 'hover, camera, pinch and cutaway');

    // The track holds the document-class input and nothing else: the cutaway (class view), the drags, the
    // pinch and the hovers (class viewer) never enter it.
    expect(out.track.length, `the input track holds exactly the one document-class entry: ${JSON.stringify(out.track)}`).toBe(1);
    expect(out.track[0]!['control'], 'the track entry is the throttle\'s').toBe('throttle');
    expect(out.track[0]!['value'], 'the track entry carries the throttle\'s value').toBe(0.5);
  });

  it('AC1 1,000 seeded hovers, drags, pinches and cutaway toggles over 100 sessions never change the document\'s hash or its track', () => {
    const rng = new Rng(SEEDS.ac1);
    const runs: { doc: JsonObject; viewport: [number, number]; inputs: Input[] }[] = [];
    for (let s = 0; s < 100; s++) {
      const inputs: Input[] = [];
      for (let i = 0; i < 10; i++) {
        const pick = rng.range(0, 3);
        if (pick === 0) inputs.push({ op: 'hover', at: [rng.range(0, HD[0] - 1), rng.range(0, HD[1] - 1)] });
        else if (pick === 1) inputs.push(randomDrag(rng, HD, 300));
        else if (pick === 2) inputs.push(randomPinch(rng, HD));
        else inputs.push({ op: 'control', control: 'cutaway', value: rng.chance(0.5) });
      }
      runs.push({ doc: VIEW, viewport: HD, inputs });
    }
    const want = revisionHash(VIEW);
    const outs = sessions(runs);
    const handedBack = batch(['canonical'], outs.map((o) => ({ doc: o.doc })));
    outs.forEach((out, s) => {
      expect(out.hash, `session ${s} (seed ${SEEDS.ac1.toString(16)}): a view or viewer input changed the document's hash; inputs ${JSON.stringify(runs[s]!.inputs)}`).toBe(want);
      expect(handedBack[s]!['sha256'], `session ${s}: the document handed back has the saved revision hash`).toBe(want);
      expectTrackEmpty(out, `session ${s}`);
    });
  });
});

describe('AC2 the camera you move: pivot eye, yaw limits, pan bounds and zoom at the pointer', () => {
  it('AC2 with pivot: eye, 1,000 seeded drags and pinches leave the position unchanged bit for bit and the field of view inside its zoom range', () => {
    const rng = new Rng(SEEDS.eye);
    const inputs: Input[] = [];
    for (let i = 0; i < 1000; i++) inputs.push(rng.chance(0.5) ? randomDrag(rng, HD, 400) : randomPinch(rng, HD));
    const out = session(EYE, HD, inputs);

    // The zoom range [0.5, 4] magnifies the authored 40° view: tan(fov/2) = tan(20°) / zoom.
    const t20 = Math.tan((20 * Math.PI) / 180);
    const fovLo = (2 * Math.atan(t20 / 4) * 180) / Math.PI;
    const fovHi = (2 * Math.atan(t20 / 0.5) * 180) / Math.PI;
    const eps = 1e-9;

    const start = out.start.camera.position;
    expect(start, 'the session starts at the authored position [2.5, 1.5, 4], exactly').toEqual([2.5, 1.5, 4]);
    expect(out.start.camera.fov, 'the session starts at the authored 40° field of view').toBeCloseTo(40, 9);
    let minFov = Infinity; let maxFov = -Infinity; let aimed = false;
    out.trace.forEach((state: State, i) => {
      const p = state.camera.position;
      // A camera that orbits its target, or dollies on a pinch, under pivot: eye moves its position: caught here.
      const same = p.length === 3 && p.every((v, k) => Object.is(v, start[k]));
      expect(same, `input ${i} (${JSON.stringify(inputs[i])}): with pivot: eye the camera's position moved from ${JSON.stringify(start)} to ${JSON.stringify(p)}`).toBe(true);
      const fov = state.camera.fov;
      // A zoom that dollies or doesn't clamp leaves the field of view outside the zoom range: caught here.
      expect(fov >= fovLo - eps && fov <= fovHi + eps, `input ${i}: the field of view ${fov}° left its zoom range [${fovLo}, ${fovHi}]`).toBe(true);
      minFov = Math.min(minFov, fov); maxFov = Math.max(maxFov, fov);
      if (state.camera.target.some((v, k) => Math.abs(v - out.start.camera.target[k]!) > 1e-3)) aimed = true;
    });
    // Not a camera that ignores the input: the drags turned the view and the pinches reached both ends of the range.
    expect(aimed, 'the drags turned the view about the eye (the aim moved)').toBe(true);
    expect(minFov, `1,000 pinches reach the narrowest field of view the zoom range allows (${fovLo}°)`).toBeCloseTo(fovLo, 6);
    expect(maxFov, `1,000 pinches reach the widest field of view the zoom range allows (${fovHi}°)`).toBeCloseTo(fovHi, 6);

    expectDocumentUnchanged(out, EYE, 'pivot eye');
    expectTrackEmpty(out, 'pivot eye');
  });

  it('AC2 with yaw [-60, 60], 1,000 seeded drags and pinches never take the azimuth past 60° either side of the shot\'s', () => {
    const rng = new Rng(SEEDS.yaw);
    const inputs: Input[] = [];
    for (let i = 0; i < 1000; i++) inputs.push(rng.chance(0.8) ? randomDrag(rng, HD, 400) : randomPinch(rng, HD));
    const out = session(YAW, HD, inputs);

    const shot = 30;
    expect(out.start.camera.azimuth, 'the session starts at the authored azimuth, 30°').toBeCloseTo(shot, 6);
    let lo = 0; let hi = 0;
    out.trace.forEach((state, i) => {
      const d = wrapDeg(state.camera.azimuth - shot);
      // A turn with no yaw clamp, or one clamped about 0° rather than the shot's azimuth, passes 60° here.
      expect(Math.abs(d) <= 60 + 1e-6, `input ${i} (${JSON.stringify(inputs[i])}): the azimuth ${state.camera.azimuth}° is ${d}° from the shot's 30°, past the yaw limit of 60°`).toBe(true);
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    });
    expect(hi, 'the drags turn the camera up to the +60° limit').toBeGreaterThan(59.9);
    expect(lo, 'the drags turn the camera down to the -60° limit').toBeLessThan(-59.9);

    expectDocumentUnchanged(out, YAW, 'yaw limits');
    expectTrackEmpty(out, 'yaw limits');
  });

  it('AC2 a 2D pan with content bounds keeps the view\'s centre inside the content\'s bounds widened by the margin after each of 1,000 seeded drags', () => {
    const rng = new Rng(SEEDS.pan);
    const inputs: Input[] = [];
    for (let i = 0; i < 1000; i++) inputs.push(randomDrag(rng, BOARD, 500));
    const out = session(PAN, BOARD, inputs);

    // Content bounds: the two blocks, x [200, 1600], y [100, 900]; widened by 0.1 of their extent each side.
    const box = { x0: 200 - 140, x1: 1600 + 140, y0: 100 - 80, y1: 900 + 80 };
    const eps = 1e-6;
    expect(out.start.camera.target.slice(0, 2), 'the session starts at the authored target [800, 450]').toEqual([800, 450]);
    const xs = new Set<number>();
    out.trace.forEach((state, i) => {
      const [x, y] = state.camera.target;
      // A pan that ignores its bounds walks out of this box within a few drags of up to 500 px.
      const inside = x >= box.x0 - eps && x <= box.x1 + eps && y >= box.y0 - eps && y <= box.y1 + eps;
      expect(inside, `drag ${i} (${JSON.stringify(inputs[i])}): the view's centre [${x}, ${y}] left the content's bounds widened by the margin, x [${box.x0}, ${box.x1}], y [${box.y0}, ${box.y1}]`).toBe(true);
      xs.add(Math.round(x));
    });
    expect(xs.size, 'the drags pan the view (its centre takes many places)').toBeGreaterThan(10);

    expectDocumentUnchanged(out, PAN, '2D pan');
    expectTrackEmpty(out, '2D pan');
  });

  it('AC2 a pinch at the pointer keeps the content point under it within 0.5 px, over 1,000 seeded pinches and drags', () => {
    const rng = new Rng(SEEDS.pinch);
    const inputs: Input[] = [];
    for (let i = 0; i < 1000; i++) inputs.push(rng.chance(0.75) ? randomPinch(rng, BOARD) : randomDrag(rng, BOARD, 300));
    const out = session(PINCH, BOARD, inputs);

    const [W, H] = BOARD;
    expect(out.start.camera.view_width, 'the session starts at the authored view width, 1600 u').toBe(1600);
    let zoomed = 0;
    inputs.forEach((input, i) => {
      if (input.op !== 'pinch') return;
      const before = (i === 0 ? out.start : out.trace[i - 1]!).camera;
      const after = out.trace[i]!.camera;
      const [px, py] = input.at;
      // The content point under the pointer before the pinch (orthographic, y down, W / view_width px per u) ...
      const cx = before.target[0] + ((px - W / 2) * before.view_width) / W;
      const cy = before.target[1] + ((py - H / 2) * before.view_width) / W;
      // ... and where it lands after. A zoom about the view's centre moves it by up to half the view.
      const sx = W / 2 + ((cx - after.target[0]) * W) / after.view_width;
      const sy = H / 2 + ((cy - after.target[1]) * W) / after.view_width;
      const off = Math.hypot(sx - px, sy - py);
      expect(off <= 0.5, `pinch ${i} (${JSON.stringify(input)}): the content point under the pointer moved ${off} px (to [${sx}, ${sy}]); the zoom is not toward the pointer`).toBe(true);
      if (Math.abs(after.view_width - before.view_width) > 1e-6) zoomed++;
    });
    expect(zoomed, 'the pinches change the view width (more than 100 of them)').toBeGreaterThan(100);

    expectDocumentUnchanged(out, PINCH, '2D pinch');
    expectTrackEmpty(out, '2D pinch');
  });
});
