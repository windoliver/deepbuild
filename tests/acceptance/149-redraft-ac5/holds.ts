// What one fixture holds, given a way to draw it: each `draw` is a fresh process with nothing drawn before it.

import { FPS, FRAMES } from './fixtures.ts';

export interface Span { from?: number; frames: number; fps?: number }
/** The frames' pixel hashes in order; `plain` draws the same film with the family's fields off. */
export type Draw = (span: Span, plain?: boolean) => string[];

const OPENED = 4;
const SOUGHT = [2, 7, 11];

export function judge(name: string, draw: Draw): string[] {
  const bad: string[] = [];
  const played = draw({ frames: FRAMES });
  const same = (how: string, n: number, hash: string | undefined): void => {
    if (hash !== played[n]) bad.push(`${name}: frame ${n} by ${how} is ${hash}; played from frame 0 it is ${played[n]}`);
  };
  played.forEach((hash, n) => {
    if (n > 0 && hash === played[n - 1]) bad.push(`${name}: frames ${n - 1} and ${n} are one picture, so the film stands still there`);
    // A field reseeded from the film's own clock passes every comparison at one time: only two times can show it.
    if (n < 6) same(`the way back, whose document is frame ${n}'s, so no field may differ`, FRAMES - 1 - n, hash);
  });
  draw({ frames: FRAMES }).forEach((hash, n) => same('a second play in a fresh process', n, hash));
  draw({ from: OPENED, frames: FRAMES - OPENED }).forEach((hash, i) => same(`a play opened at frame ${OPENED}, nothing drawn before it`, OPENED + i, hash));
  for (const n of SOUGHT) same('seeking to it alone in a fresh process', n, draw({ from: n, frames: 1 })[0]);
  draw({ frames: 2 * FRAMES - 1, fps: 2 * FPS }).forEach((hash, i) => { if (i % 2 === 0) same(`frame ${i} at ${2 * FPS} fps, the same time`, i / 2, hash); });
  // A field that draws nothing can't reseed, so a pass here would prove nothing about it.
  if (draw({ from: OPENED, frames: 1 }, true)[0] === played[OPENED]) bad.push(`${name}: frame ${OPENED} is one picture with its fields off, so they draw nothing here`);
  return bad;
}
