// AC5: "A card frame with a title, an image and a close button, anchored to a lamp, draws over a sofa that stands
// between the lamp and the camera, stays within 0.5 px of the lamp's projected point at 120 sampled times of a 360°
// orbit, hides at each sampled time a fly-through puts the lamp behind the camera, and its close button is reached by
// Tab and closes the card on Enter"
//
// The fixture (helpers.ts: roomDoc): a lamp, and a sofa 2 m in front of it; the card is `overlay.frame@1` `card`
// holding a 160 × 100 px frame (background `card-bg` in the role `card`, title "Reading lamp", a 64 × 48 PNG made here,
// and the close button `card-close`, drawn for the view-class toggle `close-card` bound to `items/card/visible`),
// anchored to the lamp's point (world (0, 0.7, 0)) at offset (0, 0).
//
// asserts:
//   - through `view3d` with `overlays: true`, the orbit (the camera circling (0.8, 0.7, 0.3) at 6 m, 5° up, its azimuth
//     0° to 360° over 12 s), 120 frames at 10 fps: at every frame the card is shown and its reported place is within
//     0.5 px of the lamp's point projected through that frame's camera, worked out from the document; at frame 0 the
//     ray from the eye to the lamp's point passes through the sofa (worked out here), and a 3 × 3 spot of the card's
//     background reads the role `card` within 2 codes where, in the same frame without the card, the object-ID target
//     shows the sofa;
//   - through `view3d`, the fly-through (the camera from z = 6 m to z = −6 m past the lamp over 4 s), 60 frames at
//     15 fps: at every frame where the lamp's point is behind the camera, the card's place is null and no pixel reads
//     the card's background within 2 codes; at every frame where it projects at least 2 px inside the safe frame, the
//     card is shown within 0.5 px of it (at least 10 frames of each);
//   - through `deep-show run` (the scope, on #383's virtual clock): Tab, pressed until the scope's `focus` is
//     `close-card` (found in a first run, at most 8 presses), then Return (the scope's name for Enter): the panel's view
//     shows the card's background before (at least 2,000 pixels within 2 codes) and none after.
// Wrong programs: the base (overlays not drawn into the frame, no place reported, Enter acts only on a pick target); a
// card placed a frame late or by the previous frame's camera; a card that the sofa hides; one that draws while its
// point is behind the camera; a close button that Tab skips or Enter doesn't press.
import { describe, expect, it } from 'vitest';
import {
  CARD_SPOT, FLICKS, FLY, ORBIT, ROLES, ROOM, TIMEOUT, YOU_PEER, ac, cardImage, codeOff, decodePng, docId, finalOf, flyCam, fmt, frameAt, framesOf,
  getEvidence, hexRgb, hitBox, idsOf, look, none, obj, orbitCam, px, putEvidence, requireGpu, rgbText, roomDoc, runGpu, runShow,
  scenarioOf, sha256, str, strip, sub, toScreen, unit, useBins, useDir, view3d, writeBytes, writeJson, type Cam, type Image, type JsonObject,
} from './helpers.ts';

const bin = useBins(['deep-gpu', 'deep-show']);
const dir = useDir();
const CARD = hexRgb(ROLES['card']!);

/** Where the card's frame must sit through `cam`: the lamp's point projected, plus the offset (0, 0), and its depth (≤ 0 behind the eye). */
function anchorOn(cam: Cam): { x: number; y: number; depth: number } { return toScreen(cam, ROOM.anchor); }
const cardPixels = (im: Image): number => { let n = 0; for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (codeOff(px(im, x, y), CARD) <= 2) n++; return n; };
const insideSafe = (p: { x: number; y: number }, margin: number): boolean => p.x >= 24 + margin && p.x <= ROOM.size[0] - 24 - margin && p.y >= 24 + margin && p.y <= ROOM.size[1] - 24 - margin;

describe(`${ac(5)} a card anchored to a lamp, over the scene`, () => {
  it(`${ac(5)} the card draws over the sofa between the lamp and the camera and stays within 0.5 px of the lamp's projected point at 120 times of a 360° orbit`, () => {
    requireGpu();
    const out = dir();
    const image = cardImage();
    const sha = sha256(image);
    const assets = { [sha]: writeBytes(out, `${sha}.png`, image) };
    const [orbit, bare] = runGpu(bin('deep-gpu'), out, [
      view3d({ doc: writeJson(out, 'orbit', roomDoc(sha, 'orbit')), look: look(), size: ROOM.size, fps: ORBIT.fps, frames: ORBIT.frames, capture: [0], overlays: true, assets }),
      view3d({ doc: writeJson(out, 'orbit-bare', roomDoc(sha, 'orbit', false)), look: look(), size: ROOM.size, fps: ORBIT.fps, frames: 1, capture: [0], targets: ['final', 'ids'], assets }),
    ]);
    const frames = framesOf(orbit!, 'the orbit');
    expect(frames.length, 'the orbit: 120 sampled times').toBe(ORBIT.frames);
    const failures: string[] = [];
    for (const f of frames) {
      const cam = orbitCam(f.frame);
      const want = anchorOn(cam);
      expect(want.depth > 0 && insideSafe(want, 0), `the fixture: the lamp's point is in front of the camera and inside the safe frame at orbit frame ${f.frame}`).toBe(true);
      const card = (f.overlays ?? []).find((o) => o.id === 'card');
      if (!f.overlays) { failures.push(`orbit frame ${f.frame}: the reply reports no overlays`); continue; }
      if (!card || !card.at) { failures.push(`orbit frame ${f.frame}: the card isn't shown; the lamp's point projects at (${fmt(want.x)}, ${fmt(want.y)})`); continue; }
      const off = Math.hypot(card.at[0] - want.x, card.at[1] - want.y);
      if (off > 0.5) failures.push(`orbit frame ${f.frame}: the card sits at (${fmt(card.at[0], 3)}, ${fmt(card.at[1], 3)}) px, ${fmt(off, 3)} px from the lamp's projected point (${fmt(want.x, 3)}, ${fmt(want.y, 3)})`);
    }
    // Frame 0: the sofa stands between the lamp and the camera, and the card draws over it.
    const cam0 = orbitCam(0);
    const toLamp = sub(ROOM.anchor, cam0.position);
    const sofaHit = hitBox(cam0.position, unit(toLamp), ROOM.sofa.pos, ROOM.sofa.size);
    expect(sofaHit !== null && sofaHit[0] > 0 && sofaHit[0] < Math.hypot(...toLamp), 'the fixture: at frame 0 the sofa stands between the camera and the lamp').toBe(true);
    const at0 = anchorOn(cam0);
    const sx = Math.floor(at0.x + CARD_SPOT[0]); const sy = Math.floor(at0.y + CARD_SPOT[1]);
    const ids = idsOf(out, frameAt(framesOf(bare!, 'the orbit without the card'), 0, 'without the card'), 'the orbit without the card');
    expect(ids.at(sx, sy), `the fixture: without the card, (${sx}, ${sy}) shows the sofa`).toBe('sofa');
    const im = finalOf(out, frameAt(frames, 0, 'the orbit'), 'the orbit at frame 0');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const c = px(im, sx + dx, sy + dy);
      if (codeOff(c, CARD) > 2) failures.push(`orbit frame 0: the card's background at (${sx + dx}, ${sy + dy}) reads ${rgbText(c)}, not ${rgbText(CARD)}: the sofa hides the card`);
    }
    none(failures, "the card stays on the lamp's projected point through the orbit, over the sofa");
  }, TIMEOUT);

  it(`${ac(5)} the card hides at each sampled time a fly-through puts the lamp behind the camera`, () => {
    requireGpu();
    const out = dir();
    const image = cardImage();
    const sha = sha256(image);
    const assets = { [sha]: writeBytes(out, `${sha}.png`, image) };
    const [fly] = runGpu(bin('deep-gpu'), out, [view3d({ doc: writeJson(out, 'fly', roomDoc(sha, 'fly')), look: look(), size: ROOM.size, fps: FLY.fps, frames: FLY.frames, capture: 'every', overlays: true, assets })]);
    const frames = framesOf(fly!, 'the fly-through');
    expect(frames.length, 'the fly-through: 60 sampled times').toBe(FLY.frames);
    const failures: string[] = [];
    let behind = 0; let shown = 0;
    for (const f of frames) {
      const want = anchorOn(flyCam(f.frame));
      const card = (f.overlays ?? []).find((o) => o.id === 'card');
      if (!f.overlays) { failures.push(`fly-through frame ${f.frame}: the reply reports no overlays`); continue; }
      if (want.depth <= 0) {
        behind++;
        if (card && card.at) failures.push(`fly-through frame ${f.frame}: the lamp is behind the camera, but the card is shown at (${fmt(card.at[0])}, ${fmt(card.at[1])})`);
        const n = cardPixels(finalOf(out, f, `fly-through frame ${f.frame}`));
        if (n) failures.push(`fly-through frame ${f.frame}: the lamp is behind the camera, but ${n} pixels read the card's background`);
      } else if (insideSafe(want, 2)) {
        shown++;
        if (!card || !card.at) failures.push(`fly-through frame ${f.frame}: the lamp's point is in front, at (${fmt(want.x)}, ${fmt(want.y)}), but the card isn't shown`);
        else if (Math.hypot(card.at[0] - want.x, card.at[1] - want.y) > 0.5) failures.push(`fly-through frame ${f.frame}: the card sits at (${fmt(card.at[0], 3)}, ${fmt(card.at[1], 3)}), not on (${fmt(want.x, 3)}, ${fmt(want.y, 3)})`);
      }
    }
    expect(behind, 'the fixture: at least 10 sampled times put the lamp behind the camera').toBeGreaterThanOrEqual(10);
    expect(shown, 'the fixture: at least 10 sampled times show the lamp inside the safe frame').toBeGreaterThanOrEqual(10);
    none(failures, 'the card hides while the lamp is behind the camera');
  }, TIMEOUT);

  it(`${ac(5)} the card's close button is reached by Tab and closes the card on Enter`, () => {
    requireGpu();
    const evidence = dir();
    const sha = putEvidence(evidence, cardImage());
    const DOC = docId(51);
    const PANEL: [number, number, number, number] = [0, 0, ...ROOM.size];
    const document = roomDoc(sha, 'still');
    class Calls {
      readonly list: JsonObject[] = [];
      private t = FLICKS;
      private add(c: JsonObject, gapMs: number): void { this.t += Math.round((gapMs * FLICKS) / 1000); this.list.push({ ...c, at: this.t }); }
      constructor() { this.list.push({ call: 'deep show', peer: YOU_PEER, doc: DOC, document: strip(document), include: ['issues'], at: this.t }); this.scope(); }
      scope(): void { this.add({ call: 'scope', panel: 'main' }, 50); }
      key(key: string): void { this.add({ call: 'input', panel: 'main', event: { type: 'key', key } }, 200); }
      view(): void { this.add({ call: 'view', panel: 'main' }, 100); }
    }
    const run = (c: Calls, what: string): JsonObject[] =>
      runShow(bin('deep-show'), scenarioOf({ evidence, panels: { main: PANEL }, docs: { [DOC]: { panel: 'main' } }, clock: { refresh_hz: 60, lead: 0, check: 0 }, calls: c.list }), what);
    const presented = (r: JsonObject): void => expect(r['outcome'], `the room is presented: ${JSON.stringify(r).slice(0, 2000)}`).toBe('presented');

    // How many Tabs put the focus on the close button.
    const probe = new Calls();
    for (let k = 0; k < 8; k++) { probe.key('Tab'); probe.scope(); }
    const first = run(probe, 'Tab through the room');
    presented(first[0]!);
    const foci = Array.from({ length: 8 }, (_, k) => obj(obj(first[3 + 2 * k], `the scope after Tab ${k + 1}`)['state'], `the scope after Tab ${k + 1}: state`)['focus'] ?? null);
    const tabs = foci.findIndex((f) => f === 'close-card') + 1;
    expect(tabs, `Tab reaches the card's close button within 8 presses; the focus after each: ${JSON.stringify(foci)}`).toBeGreaterThan(0);

    // Tab to it, then Enter.
    const c = new Calls();
    c.view();
    for (let k = 0; k < tabs; k++) c.key('Tab');
    c.key('Return'); c.scope(); c.view();
    const r = run(c, 'Tab to the close button, then Enter');
    presented(r[0]!);
    const snap = (reply: JsonObject | undefined, what: string): Image => {
      const s = obj(obj(reply, what)['snapshot'], `${what}: snapshot`);
      return decodePng(getEvidence(evidence, str(s['sha256'], `${what}: snapshot.sha256`), what));
    };
    const before = cardPixels(snap(r[2], 'the view before'));
    const after = cardPixels(snap(r[r.length - 1], 'the view after Enter'));
    const focus = obj(obj(r[r.length - 2], 'the scope after Enter')['state'], 'the scope after Enter: state')['focus'];
    expect(before, "the view shows the card before Enter (pixels of the card's background)").toBeGreaterThanOrEqual(2000);
    expect(after, `Enter on the close button (focus ${JSON.stringify(focus)}) closes the card: pixels of its background after it`).toBe(0);
  }, TIMEOUT);
});
