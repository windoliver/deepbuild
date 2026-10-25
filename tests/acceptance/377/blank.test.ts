// #377.5a0d84fc: one blank guard runs before every image comparison the parity fixtures make. The
// comparison is the binary's `compare` call (README: The image comparison), which the conformance run's
// comparisons go through too; images are 100 × 100 opaque PNGs written here, grey where the threshold
// is probed, so the luma weights don't matter there (a grey of 15 is luma 0.0588, 16 is 0.0627). At the
// base there is no `deep-gpu` binary.
import { describe, expect, it } from 'vitest';
import {
  DECISIONS, SCENES, arr, conformanceCall, conformanceReply, numbersIn, obj, run, scenario, solid, str, useBuilds, useOut, writePng, type Image, type JsonObject,
} from './helpers.ts';

const builds = useBuilds(['default']);
const out = useOut();
const N = 100;
const FIXTURE = 'parity/gpu/dark-room.scene';
const OTHER = 'parity/gpu/surface-handoff.scene';

const grey = (v: number): Image => solid(N, N, [v, v, v]);
/** `bright` pixels of 200 grey in the first rows, the rest grey 15: 1 − bright / 10,000 of it is dark. */
const mostlyDark = (bright: number): Image => solid(N, N, [15, 15, 15], (x, y) => (y * N + x < bright ? [200, 200, 200] : null));
/** A frame with content: a gradient across. */
const content = (): Image => solid(N, N, [0, 0, 0], (x, y) => [x * 2, y * 2, 128]);
/** An object-ID pass: item `lamp` drawn red in the top half, `chair` green in the bottom half (or not at all). */
const ids = (withChair: boolean): Image => solid(N, N, [0, 0, 0], (_x, y) => (y < N / 2 ? [255, 0, 0] : withChair ? [0, 255, 0] : null));
const ID_ITEMS: JsonObject = { lamp: [255, 0, 0], chair: [0, 255, 0] };

interface Written { path: string; sha: string }
function images(dir: string): Record<string, Written> {
  return {
    black: writePng(dir, 'black', grey(0)), content: writePng(dir, 'content', content()), grey15: writePng(dir, 'grey15', grey(15)), grey16: writePng(dir, 'grey16', grey(16)),
    grey16b: writePng(dir, 'grey16b', solid(N, N, [16, 16, 16], (x, y) => (x === 50 && y === 50 ? [40, 40, 40] : null))),
    dark98: writePng(dir, 'dark98', mostlyDark(200)), dark9799: writePng(dir, 'dark9799', mostlyDark(201)),
    ids: writePng(dir, 'ids', ids(true)), idsMissing: writePng(dir, 'ids-missing', ids(false)),
  };
}
const compare = (a: Written, b: Written, extra: JsonObject = {}): JsonObject => ({ call: 'compare', fixture: FIXTURE, a: a.path, b: b.path, ...extra });
const result = (reply: JsonObject, what: string): string => str(reply['result'], `${what}: result`);

/** A comparison the guard blocked: BLOCKED, with no number anywhere in the reply. */
function expectBlocked(reply: JsonObject, what: string): void {
  expect(result(reply, what), `${what} is BLOCKED by the blank guard: ${JSON.stringify(reply)}`).toBe('BLOCKED');
  expect(numbersIn(reply), `${what}: a BLOCKED comparison carries no other number`).toEqual([]);
}

describe('#377.5a0d84fc one blank guard runs before every image comparison the parity fixtures make', () => {
  it('#377.5a0d84fc a frame blank or black on either side makes the comparison BLOCKED with no other number, never PASS; two frames that draw nothing are BLOCKED', () => {
    const im = images(out());
    const [blackA, blackB, both, normal, differ] = run(builds.bin(), scenario(out(), [
      compare(im.black!, im.content!), compare(im.content!, im.black!), compare(im.black!, im.black!), compare(im.content!, im.content!), compare(im.grey16!, im.grey16b!),
    ]));
    expectBlocked(blackA!, 'black against a frame with content');
    expect(arr(blackA!['blank'], 'blank').map(String), 'the guard names the blank side').toEqual(['a']);
    expectBlocked(blackB!, 'a frame with content against black');
    expect(arr(blackB!['blank'], 'blank').map(String)).toEqual(['b']);
    expectBlocked(both!, 'two black frames, which would compare as equal');
    expect(arr(both!['blank'], 'blank').map(String).sort()).toEqual(['a', 'b']);
    // Not blank: the comparison runs and reports its numbers.
    expect(result(normal!, 'two equal frames with content')).toBe('PASS');
    expect(result(differ!, 'two grey-16 frames one pixel apart'), 'grey 16 is not blank, so the comparison runs and finds the pixel').toBe('FAIL');
    expect(numbersIn(differ!).length, 'a comparison that ran reports its numbers').toBeGreaterThan(0);
  }, 600_000);

  it('#377.5a0d84fc the guard\'s threshold is luma at most 0.06 over at least 98% of the pixels', () => {
    const im = images(out());
    const [g15, g16, d98, d9799] = run(builds.bin(), scenario(out(), [compare(im.grey15!, im.grey15!), compare(im.grey16!, im.grey16!), compare(im.dark98!, im.dark98!), compare(im.dark9799!, im.dark9799!)]));
    expectBlocked(g15!, 'grey 15 everywhere (luma 0.0588)');
    expect(result(g16!, 'grey 16 everywhere (luma 0.0627)')).toBe('PASS');
    expectBlocked(d98!, 'exactly 98% of the pixels at grey 15');
    expect(result(d9799!, '97.99% of the pixels at grey 15')).toBe('PASS');
  }, 600_000);

  it('#377.5a0d84fc your decision declaring a frame dark for the fixture, recorded once with its hash, lets it compare while its object-ID pass shows each kept item; an agent\'s dark declaration is refused', () => {
    const im = images(out());
    const idPass = (png: Written): JsonObject => ({ ids: { png: png.path, items: ID_ITEMS, kept: ['lamp', 'chair'] } });
    const [agent, afterAgent, yours, again, decided, ok, missing, otherFixture, otherFrame] = run(builds.bin(), scenario(out(), [
      { call: 'declare_dark', fixture: FIXTURE, frame: im.black!.sha, via: 'agent' },
      compare(im.black!, im.black!, idPass(im.ids!)),
      { call: 'declare_dark', fixture: FIXTURE, frame: im.black!.sha, via: 'you' },
      { call: 'declare_dark', fixture: FIXTURE, frame: im.black!.sha, via: 'you' },
      DECISIONS,
      compare(im.black!, im.black!, idPass(im.ids!)),
      compare(im.black!, im.black!, idPass(im.idsMissing!)),
      { call: 'compare', fixture: OTHER, a: im.black!.path, b: im.black!.path, ...idPass(im.ids!) },
      compare(im.grey15!, im.grey15!, idPass(im.ids!)),
    ]));
    expect(str(agent!['outcome'], 'the agent\'s declaration'), 'an agent\'s dark declaration is refused').toBe('refused');
    expectBlocked(afterAgent!, 'black frames after the agent\'s refused declaration');
    expect(str(yours!['outcome'], 'your declaration')).toBe('recorded');
    expect(str(again!['outcome'], 'your second declaration of the same frame'), 'recorded once').toBe('already_recorded');
    const dark = arr(obj(decided!, 'decisions')['dark'], 'decisions: dark').map((d) => obj(d, 'a dark declaration'));
    expect(dark, 'one record of the declaration, with the frame\'s hash, and none of the agent\'s').toEqual([{ fixture: FIXTURE, frame: im.black!.sha }]);
    expect(result(ok!, 'the declared dark frame whose object-ID pass shows each kept item'), 'the comparison runs').toBe('PASS');
    expectBlocked(missing!, 'the declared dark frame whose object-ID pass is missing a kept item (chair)');
    expectBlocked(otherFixture!, 'the same frame in a fixture it wasn\'t declared dark for');
    expectBlocked(otherFrame!, 'another dark frame (grey 15) with a different hash');
  }, 600_000);

  it('#377.5a0d84fc the parity fixtures\' own comparisons run the guard: the handoff\'s conformance run on a scene where the GPU layer and its reference both draw nothing is BLOCKED, never PASS', () => {
    const [conf] = run(builds.bin(), scenario(out(), [conformanceCall(SCENES.blank)]));
    const c = conformanceReply(conf!, 'conformance on parity/gpu/blank.scene');
    expect(c.result, 'a fixture that draws nothing on both sides is BLOCKED').toBe('blocked');
    for (const part of ['identical', 'premultiplied', 'stale_or_torn']) {
      expect(c.parts.find((p) => p.part === part)?.result, `the ${part} part compares blank frames, so it is BLOCKED`).toBe('blocked');
    }
  }, 1_800_000);
});
