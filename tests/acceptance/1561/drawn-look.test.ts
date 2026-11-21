// AC1 #1561.785c8c1d: A 2D document under a drawn look with a named fill, a line profile, paper, light and a 2D camera
// draws in the live window (`flat.rs`) and through deep-show's frame path equal by pixel hash, on one machine, to
// `film2d`'s frame at the same t; a planted live path that passes no page draws plain role colors and fails, naming the
// first field it dropped.
//
// The fixture is a paper boat on a pond (fixtures/paper-boat.json) under fixtures/look.json: the pond and the hull take
// the look's wash `pool`, the hull, the sail and a reed its line `nib` with a profile, the ground is paper with tooth
// and age, the light rims and shadows the boat and the sun, and the document's camera dollies and pushes in for 2 s.
// One run on this machine draws it three ways at 4 frames a second and compares t = 0, 0.5 s and 1 s; the camera has
// moved at the last two. `film2d` (README: frames 0, 2 and 4) is the reference. The live window is `deep-gpu`'s `live`
// call on the writer's payload (frames 1, 3 and 5). deep-show's frame path is `deep-show run`'s `frames` call with
// `pixels` (frames 0, 2 and 4). A frame's pixel hash is the SHA-256 of its RGBA8 rows, decoded from the PNG its path
// keeps (README: The pixel hash); no picture is read for more than that.
//
// Guards, so nothing blank or plain passes: `film2d`'s frames aren't blank, differ from the same document under the
// look with its drawn fields removed, differ from each other (the camera moves), and differ when any one of the five is
// removed, so each is in the picture.
//
// A path that fails is asked which field it dropped first, without reading a picture: it draws the fixture again with
// one of the five removed at a time, in the criterion's order, and the first one whose removal leaves all three of its
// frames unchanged is the first it dropped. The planted `live_passes_no_page` draws plain role colors with or without
// the wash, so the judge names the named fill.
import { describe, expect, it } from 'vitest';
import {
  AC, BOAT, FIELDS, LOOK, blocked, failsNaming, film2dCall, filmShots, liveCall, liveRows, liveShot, none, plainLook, requireMetal, runGpu, runShow, showScenario,
  showShots, useBins, useDir, without, writePayload, type Field, type Planted, type Shot,
} from './helpers.ts';

const ID = AC[1];
const bin = useBins(['deep-gpu', 'deep-show']);
const dir = useDir();
const FPS = 4;
const FRAMES = 5;
/** The frames compared, as `film2d` numbers them: t = 0, 0.5 s and 1 s. */
const AT = [0, 2, 4] as const;
const seconds = (n: number): string => `t = ${n / FPS} s`;
/** A path's compared frames, by `film2d`'s frame number. */
type Shots = Map<number, Shot>;
/** A path's frames of the fixture, and of the fixture with each of the five removed. */
interface Drawn { own: Shots; lacking: Map<Field, Shots> }
const VARIANTS = FIELDS.map((f) => without(f));

// `film2d`'s frames of the fixture, drawn once for the file by the first test that needs them.
let reference: Shots | undefined;
function film(): Shots {
  if (reference) return reference;
  const out = dir();
  const calls = [film2dCall(BOAT, LOOK, FPS, FRAMES, [...AT]), film2dCall(BOAT, plainLook(), FPS, FRAMES, [...AT]), ...VARIANTS.map((v) => film2dCall(v.doc, v.look, FPS, FRAMES, [...AT]))];
  const replies = runGpu(bin('deep-gpu'), out, calls);
  const full = filmShots(out, replies[0]!, AT, 'film2d of the fixture');
  const plain = filmShots(out, replies[1]!, AT, 'film2d of the fixture under the look with its drawn fields removed');
  for (const n of AT) {
    if (full.get(n)!.blank) blocked(`film2d's frame ${n} of the fixture is blank`);
    expect(full.get(n)!.hash, `film2d's frame ${n} (${seconds(n)}) under the drawn look differs from the same document under the look with its drawn fields removed`).not.toBe(plain.get(n)!.hash);
  }
  expect(new Set(AT.map((n) => full.get(n)!.hash)).size, 'the camera moves: film2d\'s frames at t = 0, 0.5 s and 1 s are three pictures').toBe(AT.length);
  FIELDS.forEach((f, i) => {
    const lacking = filmShots(out, replies[2 + i]!, AT, `film2d of the fixture without ${f}`);
    for (const n of AT.slice(1)) expect(lacking.get(n)!.hash, `${f} is in film2d's frame ${n} (${seconds(n)}): the frame without it is another picture`).not.toBe(full.get(n)!.hash);
  });
  reference = full;
  return full;
}

/** The live window's frames: `film2d`'s frame n is its frame n + 1. */
function liveWindow(out: string, planted?: Planted): Drawn {
  const calls = [liveCall(writePayload(out, 'fixture.json', BOAT), LOOK, FPS, FRAMES), ...VARIANTS.map((v, i) => liveCall(writePayload(out, `lacking-${i}.json`, v.doc), v.look, FPS, FRAMES))];
  const replies = runGpu(bin('deep-gpu'), out, calls, planted);
  const shots = (k: number, what: string): Shots => {
    const rows = liveRows(replies[k]!, FRAMES, what);
    return new Map(AT.map((n) => [n, liveShot(out, rows, n + 1, what)]));
  };
  return { own: shots(0, 'the live window on the fixture'), lacking: new Map(FIELDS.map((f, i) => [f, shots(1 + i, `the live window on the fixture without ${f}`)])) };
}
/** deep-show's frames: `film2d`'s frame n is its frame n, a step of 60 / FPS frames at 60 a second apart. */
function deepShow(evidence: string): Drawn {
  const step = `${60 / FPS}f`;
  const replies = runShow(bin('deep-show'), [showScenario(evidence, BOAT, LOOK, FRAMES, step), ...VARIANTS.map((v) => showScenario(evidence, v.doc, v.look, FRAMES, step))]);
  return {
    own: showShots(evidence, replies[0]!, AT, FPS, 'deep-show on the fixture'),
    lacking: new Map(FIELDS.map((f, i) => [f, showShots(evidence, replies[1 + i]!, AT, FPS, `deep-show on the fixture without ${f}`)])),
  };
}

/** Each compared frame of `path` that isn't `film2d`'s at the same t, then the first of the five fields it dropped. */
function judge(path: string, frame: (n: number) => string, film2d: Shots, drawn: Drawn): string[] {
  const failures: string[] = [];
  for (const n of AT) {
    const own = drawn.own.get(n)!; const want = film2d.get(n)!;
    if (own.hash !== want.hash) failures.push(`${path}'s ${frame(n)} (${seconds(n)}) isn't film2d's frame ${n} at the same t: pixel hash ${own.hash} against ${want.hash}${own.blank ? '; it is blank' : ''}`);
  }
  if (failures.length === 0) return failures;
  const dropped = FIELDS.find((f) => AT.every((n) => drawn.lacking.get(f)!.get(n)!.hash === drawn.own.get(n)!.hash));
  failures.push(dropped
    ? `the first field ${path} dropped is ${dropped}: it draws the same three frames with and without it`
    : `${path} dropped none of the five whole (${FIELDS.join(', ')}): its frames change when each is removed`);
  return failures;
}
const liveFrame = (n: number): string => `frame ${n + 1}`;
const showFrame = (n: number): string => `frame ${n}`;

describe(`${ID} a 2D document under a drawn look draws in the live window and through deep-show's frame path as film2d draws it`, () => {
  it(`${ID} the live window draws the fixture at t = 0, 0.5 s and 1 s, the camera moved at the last two, equal by pixel hash to film2d's frames at the same t`, () => {
    requireMetal();
    const film2d = film();
    none(judge('the live window', liveFrame, film2d, liveWindow(dir())), 'the live window draws the fixture under its drawn look as film2d does');
  });

  it(`${ID} deep-show's frame path draws the fixture at t = 0, 0.5 s and 1 s, the camera moved at the last two, equal by pixel hash to film2d's frames at the same t`, () => {
    requireMetal();
    const film2d = film();
    none(judge('deep-show\'s frame path', showFrame, film2d, deepShow(dir())), 'deep-show\'s frame path draws the fixture under its drawn look as film2d does');
  });

  it(`${ID} planted live_passes_no_page, a live window that passes no page, draws plain role colors and fails, naming the named fill as the first field it dropped`, () => {
    requireMetal();
    const film2d = film();
    const failures = judge('the live window', liveFrame, film2d, liveWindow(dir(), 'live_passes_no_page'));
    failsNaming(failures, 'the first field the live window dropped is the named fill', 'planted live_passes_no_page');
  });
});
