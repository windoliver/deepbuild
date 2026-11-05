// A twin for #992's proof lane (tests/acceptance/992/README.md, Planted programs): the planted wrong program
// waiting-as-working, whatever DEEP_HUB_PLANT says, on the hub's side and the CLI's: the app maps a session waiting on
// you to Working; the hub and the CLI run as shipped (AC3). The tests hand the hub's active plant to the replica as
// DEEP_HUB_PLANT. It replaces packages/hub/src/plant.ts whole, the base commit's copy with Plant widened to any name
// (so every comparison the implementation makes with a plant's name still type-checks) and plantOf and activePlant
// giving this plant; every other export is kept as the base has it.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { close as closeInspector } from 'node:inspector';
import { createServer, type Server } from 'node:net';

/** A planted wrong program's name: any, in this twin. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'waiting-as-working';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'waiting-as-working';

// ---- #824's planted leaks: each holds what it leaves until the hub stops, so a run's children go with its hub.
const keptSessions = new Map<string, string>();
const reloads = new EventEmitter().setMaxListeners(0);
const leftSockets: Server[] = [];
const leftTimers: NodeJS.Timeout[] = [];
const leftChildren: ChildProcess[] = [];
/** 1 KiB no other value shares: 1 MB over 5,000 cycles is 200 bytes a cycle, so a short ID alone would stay under it. */
const kibibyte = (): string => randomBytes(512).toString('hex');

/** What a planted hub leaves behind as a session ends. */
export function plantedSessionEnd(plant: Plant | undefined, session: string): void {
  if (plant === 'churn-keeps-ended-session') keptSessions.set(session, kibibyte());
  if (plant === 'churn-leaves-socket') leftSockets.push(createServer().listen(0, '127.0.0.1').unref());
  if (plant === 'churn-leaves-timer') leftTimers.push(setInterval(() => undefined, 2 ** 30).unref());
  if (plant === 'churn-leaves-child') leftChildren.push(spawn('/bin/sleep', ['86400'], { stdio: 'ignore' }));
}
/** What a planted hub leaves behind as an extension reloads. */
export function plantedReload(plant: Plant | undefined): void {
  if (plant !== 'churn-keeps-reload-listener') return;
  const held = kibibyte();
  reloads.on('reload', () => held.length);
}
/** What a planted hub takes away at its start: the inspector that forces a collection, or its resident memory. */
export function plantedStart(plant: Plant | undefined): void {
  if (plant === 'churn-no-full-collection') closeInspector();
  if (plant === 'churn-no-resident-read') process.memoryUsage = (() => { throw Error('this platform reads no resident memory'); }) as unknown as typeof process.memoryUsage;
}
/** The hub stops: nothing a planted run left outlives it. */
export function plantedStop(): void {
  for (const server of leftSockets.splice(0)) server.close();
  for (const timer of leftTimers.splice(0)) clearInterval(timer);
  for (const child of leftChildren.splice(0)) child.kill();
}

/** #40's wrong program on the hub's side: an answer of a replaced session handed to the session that replaced it. Only tests set it. */
export const piAcceptsReplaced = (): boolean => process.env.DEEP_PI_PLANT === 'accepts-replaced';
