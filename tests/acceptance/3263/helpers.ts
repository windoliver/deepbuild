import { expect } from 'vitest';
import { DOC, Pool, lockPlay, macOnly, openHub, ownPlay, putPiece, runSeed, scalar, valuesOf, type Hub, type Obj } from '../556/helpers.ts';
import { EXIT, START, closedBy, floorOf, type Cell, type Floor, type FloorName, type Through } from './floors.ts';
import { runName, type Crossing, type SkipWanted } from './judges.ts';
import { CELLS, DEPTH, FLOOR_DEPTH, SEED, floorPlay, piece, program } from './programs.ts';

export { TIMEOUT, fillOf, reachKit, reachSpec, runCheck, runFill, type Hub, type Obj, type Pool, type Result } from '../556/helpers.ts';
export { judge, none } from '../184/helpers.ts';

const AT: Record<FloorName, string> = { locked: DOC.vault, opened: DOC.walled, rooms: DOC.hex, nokey: DOC.noturn, walled: DOC.stale };
export const keep = (name: FloorName): string => putPiece(AT[name], piece(program(name)));

export interface Bench { pool: Pool; hub: Hub; play: Obj }
let opened: Promise<Bench> | undefined;
export function bench(): Promise<Bench> {
  macOnly();
  return (opened ??= (async () => {
    const pool = await Pool.open(2);
    return { pool, hub: await openHub(pool), play: await lockPlay(floorPlay()) };
  })());
}

export async function published(pool: Pool, at: string): Promise<{ cells: number[]; depth: number }> {
  const reply = await ownPlay(pool, at, { seed: SEED, span: { steps: 1 }, values: [CELLS, DEPTH], frames: [] });
  const cells = valuesOf(reply, CELLS);
  const depth = valuesOf(reply, DEPTH);
  expect([cells.length, depth.length], `this suite's own play of ${at} answers the floor and its depth at its one step`).toEqual([1, 1]);
  return { cells: (cells[0] as number[]).map(Number), depth: scalar(depth[0]) };
}

export async function publishes(pool: Pool, at: string, name: FloorName): Promise<void> {
  expect(await published(pool, at), `the piece at ${at} publishes the drawn floor ${name} at depth ${FLOOR_DEPTH}`).toEqual({ cells: [...floorOf(name).cells], depth: FLOOR_DEPTH });
}

export interface FloorOfRun { run: string; seed: number; depth: number }
export const floorOfRun = (i: number): FloorOfRun => ({ run: runName(i), seed: runSeed(SEED, i), depth: FLOOR_DEPTH });

export function skipOf(i: number, floor: Floor, through: readonly Through[], cross: readonly Crossing[], goal: Cell = EXIT): SkipWanted {
  return { ...floorOfRun(i), floor, starts: [START], goal, closed: closedBy(floor, through), cross };
}
