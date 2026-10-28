// #488.ee0f61fe: a still timeline draws no new frames. The live transport plays a board on a virtual
// 144 Hz display (`play`, README) and reports how many frames it drew and the last one's time: a board
// with nothing that moves draws its first frame and no other over 3 s; a board whose rect slides for
// 2 s draws every display frame while it moves, the frame it rests on, and nothing after. The wrong
// programs: the base (no `play` call), and a transport that draws every display frame whether or not
// anything changes (Transport: "It can never: Run while nothing changes").
import { describe, expect, it } from 'vitest';
import { DISPLAY, DOC, FULL, SLIDING, STILL, int, outcome, playCall, presented, run, scenario, sec, show, useBuilds, useEvidence, type JsonObject } from './helpers.ts';

const builds = useBuilds([FULL]);
const evidence = useEvidence();

const TO = sec(3);
/** Display frames at 144 Hz from 0 to 3 s inclusive: k × 4,900,000 for k = 0 … 432. */
const DISPLAY_FRAMES = TO / DISPLAY + 1;
const REST = sec(2);

interface Played { frames: number; drawn: number; last: number | null }
function played(reply: JsonObject, what: string): Played {
  expect(outcome(reply), `${what} played: ${JSON.stringify(reply).slice(0, 800)}`).toBe('played');
  const last = reply['last_drawn'];
  return { frames: int(reply['frames'], `${what}: frames`), drawn: int(reply['drawn'], `${what}: drawn`), last: last === null ? null : int(last, `${what}: last_drawn`) };
}

describe('#488.ee0f61fe a still timeline draws no new frames', () => {
  it('#488.ee0f61fe a board with nothing that moves, played for 3 s on a 144 Hz display, draws its first frame and no other', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [show(STILL), playCall(DOC.a, TO)]));
    presented(replies[0]!, 'the still board');
    const p = played(replies[1]!, 'the still board played to 3 s');
    expect(p.frames, 'the display ran 433 frames').toBe(DISPLAY_FRAMES);
    expect(p.drawn, 'one frame drawn: the first').toBe(1);
    expect(p.last, 'drawn at 0').toBe(0);
  }, 600_000);

  it('#488.ee0f61fe a board whose rect slides for 2 s draws every display frame while it moves, the frame it rests on at 2 s, and nothing in the still second after', () => {
    const replies = run(builds.bin(FULL), scenario(evidence(), [show(SLIDING), playCall(DOC.a, TO)]));
    presented(replies[0]!, 'the sliding board');
    const p = played(replies[1]!, 'the sliding board played to 3 s');
    expect(p.frames, 'the display ran 433 frames').toBe(DISPLAY_FRAMES);
    // 289 display frames fall in [0, 2 s]; the transport draws each while the rect moves and the one it rests on.
    expect(p.drawn, `every display frame of the slide and the resting frame are drawn, nothing after: ${p.drawn}`).toBeGreaterThanOrEqual(REST / DISPLAY);
    expect(p.drawn, `no frame is drawn in the still second after the slide: ${p.drawn}`).toBeLessThanOrEqual(REST / DISPLAY + 2);
    expect(p.last, 'the last frame drawn is the one the rect rests on, at 2 s').toBe(REST);
  }, 600_000);
});
