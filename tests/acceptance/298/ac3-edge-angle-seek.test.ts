// AC3: "`edge_angle` at 20 sampled times equals its value after a seek to each, by evaluated data; a planted driver that
// reads the previous frame's projection differs after a seek and fails, naming the time; a logic item whose read names a
// driver over `edge_angle` is refused at check, naming the item"
//
// The fixture (helpers.ts: clampDoc with arrows): the clamp fixture, each tag holding an arrow whose turn the driver
// `turn-<post>` sets from `tag-<post>.edge_angle`. Through `view3d` at 1920 × 1080 the flythrough is drawn twice in one
// run, each frame reporting the five arrows' evaluated turns (`evaluate`, #429): played, frames 0 to 19 at 5 frames a
// second in turn; and sought, the session opened at frame 3 and, after each frame, jumped to the next of a fixed order
// in which no frame follows the one before it (#484's `seeks`).
//
// asserts:
//   - at each of the 20 times, for each tag: the played frame holds the driver's value; where the rule clamps the tag
//     it is the rule's own `edge_angle` at that time, the direction from the frame's center toward the anchor's
//     projection (mirrored where behind the camera), within 0.05°; and the sought frame holds the same number, exactly;
//   - `--planted edge_from_previous_frame`: the same check fails, a failure naming the time and the value after a seek;
//   - through `deep-show run`: the still fixture with its arrows and a logic item `brain` that reads no driver is
//     presented; the same document whose `brain` reads `drivers/turn-east`, and the one whose `brain` reads the path
//     that driver writes, are each refused at check with an error naming `brain`.
// Guards on the fixture: every sampled pair is clear of the readings the design leaves open; for at least 40 clamped
// pairs the rule's angle turned by more than 0.5° since the frame before, so a driver a frame late is seen.
// Wrong programs: the base (a driver can't read `tag-east.edge_angle`, so the fixture is refused); an angle kept from
// the frame before, or from the last frame drawn; an angle that ignores the camera's flight; a check that lets logic
// read a view value through a driver.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC, FLY, INSET, MARKER_NAMES, Show, TAG, angleOff, clampDoc, clearOf, failsNaming, flyCam, frameSeconds, framesOf, none, presented, putEvidence,
  refusedNamingItem, requireGpu, runGpu, runShow, showScenario, stripped, tagId, tagRule, tickerProgram, turnPath, useBins, useDir, valueOf, view3d,
  writeJson, TIMEOUT, type Frame, type GpuPlanted, type JsonObject,
} from './helpers.ts';

/** This criterion's ID: `#298.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs: criterionId). */
const ID = 'AC3 #298.85119906';

const bin = useBins(['deep-gpu', 'deep-show']);
const dir = useDir();
const SIZE: [number, number] = [1920, 1080];
const FRAMES = Array.from({ length: FLY.frames }, (_, n) => n);
/** The order the sought run draws the 20 frames in: 3, 10, 17, 4, … (7n + 3 mod 20), so none follows the frame before it. */
const SOUGHT = FRAMES.map((n) => (7 * n + 3) % FLY.frames);
const PATHS = MARKER_NAMES.map(turnPath);
const ruleAt = (n: number, m: (typeof MARKER_NAMES)[number]) => tagRule(m, flyCam(n, SIZE), INSET[m] ?? 0);

/** The fixture's own numbers: they hold whatever the program does. */
function guards(): void {
  expect([...SOUGHT].sort((a, b) => a - b), 'the fixture: the sought order holds each of the 20 frames once').toEqual(FRAMES);
  expect(SOUGHT.every((n, k) => k === 0 || n !== SOUGHT[k - 1]! + 1), 'the fixture: no sought frame follows the frame before it').toBe(true);
  let turned = 0;
  for (const n of FRAMES) for (const m of MARKER_NAMES) {
    const r = ruleAt(n, m);
    expect(clearOf(r, TAG / 2 + (INSET[m] ?? 0)), `the fixture: frame ${n}, ${m}'s anchor is clear of the readings the design leaves open`).toBeGreaterThanOrEqual(2);
    if (n > 0 && r.edge === 1 && angleOff(r.angle, ruleAt(n - 1, m).angle) > 0.5) turned++;
  }
  expect(turned, "the fixture: at least 40 clamped pairs whose angle turned by more than 0.5° since the frame before").toBeGreaterThanOrEqual(40);
}

/** The played and the sought frames against the rule and each other. Every failure names the time. */
function judge(played: Frame[], sought: Frame[]): string[] {
  const failures: string[] = [];
  const soughtAt = new Map(sought.map((f) => [f.frame, f]));
  for (const p of played) {
    const at = `t = ${frameSeconds(p.frame, FLY.fps).toFixed(4)} s (frame ${p.frame})`;
    const s = soughtAt.get(p.frame);
    for (const m of MARKER_NAMES) {
      const who = `${tagId(m)}'s edge_angle, read by its driver`;
      const a = valueOf(p, turnPath(m));
      if (a === null) { failures.push(`${at}: the played frame holds no value for ${turnPath(m)}: ${who}`); continue; }
      const want = ruleAt(p.frame, m);
      if (want.edge === 1 && angleOff(a, want.angle) > 0.05) failures.push(`${at}: ${who}, is ${a.toFixed(4)} played, not ${want.angle.toFixed(4)}, the direction from the center toward its anchor then`);
      const b = s ? valueOf(s, turnPath(m)) : null;
      if (b === null) failures.push(`${at}: the frame after a seek holds no value for ${turnPath(m)}: ${who}`);
      else if (a !== b) failures.push(`${at}: ${who}, is ${a} played and ${b} after a seek`);
    }
  }
  return failures;
}

function run(planted?: GpuPlanted): string[] {
  const out = dir();
  const doc = writeJson(out, 'fly-arrows', clampDoc({ motion: 'fly', arrows: true }));
  const common = { doc, size: SIZE, fps: FLY.fps, frames: FLY.frames, evaluate: PATHS };
  const [play, seek] = runGpu(bin('deep-gpu'), out, [
    view3d({ ...common }),
    view3d({ ...common, from: SOUGHT[0]!, seeks: SOUGHT.slice(1).map((to, k) => ({ after: SOUGHT[k]!, to })) }),
  ], planted);
  const played = framesOf(play!, 'the flythrough played');
  const sought = framesOf(seek!, 'the flythrough sought');
  expect(played.map((f) => f.frame), 'the played run draws frames 0 to 19 in turn').toEqual(FRAMES);
  expect(sought.map((f) => f.frame), 'the sought run draws the 20 frames in its own order').toEqual(SOUGHT);
  return judge(played, sought);
}

describe(`${ID} edge_angle seeks as it plays, and logic never reads it`, () => {
  it(`${ID} edge_angle at the flythrough's 20 sampled times equals its value after a seek to each, by evaluated data`, () => {
    requireGpu();
    guards();
    none(run(), "each tag's edge_angle through its driver, played and sought");
  }, TIMEOUT);

  it(`${ID} the planted driver that reads the previous frame's projection differs after a seek and fails, naming the time`, () => {
    requireGpu();
    guards();
    failsNaming(run('edge_from_previous_frame'), [/^t = \d+\.\d{4} s \(frame \d+\): /, /is [-\d.e]+ played and [-\d.e]+ after a seek$/], "the driver that reads the previous frame's projection");
  }, TIMEOUT);

  it(`${ID} a logic item whose read names a driver over edge_angle is refused at check, naming the item`, () => {
    const evidence = join(dir(), 'evidence');
    mkdirSync(evidence);
    const program = tickerProgram();
    putEvidence(evidence, program.bytes);
    const docOf = (id: string, reads: string[]): JsonObject => stripped(clampDoc({ motion: 'still', arrows: true, id, logic: { program: program.sha, reads } }));
    const s = new Show();
    const plain = s.present(DOC(31), docOf('edge-logic-plain', []));
    const byDriver = s.present(DOC(32), docOf('edge-logic-driver', ['drivers/turn-east']));
    const byPath = s.present(DOC(33), docOf('edge-logic-path', [turnPath('east')]));
    const r = runShow(bin('deep-show'), showScenario(evidence, [DOC(31), DOC(32), DOC(33)], s.calls, [0, 0, 960, 540]), 'AC3 the logic reads');
    presented(r[plain]!, "the clamp fixture with its arrows' drivers over edge_angle and a logic item that reads no driver");
    refusedNamingItem(r[byDriver]!, 'brain', 'a logic item whose read names the driver turn-east, which reads tag-east.edge_angle');
    refusedNamingItem(r[byPath]!, 'brain', `a logic item whose read names ${turnPath('east')}, the path the driver turn-east writes from tag-east.edge_angle`);
  }, TIMEOUT);
});
