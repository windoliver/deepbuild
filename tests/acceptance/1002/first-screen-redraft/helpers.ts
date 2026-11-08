// #1002's first screen on the real window (README): the app in a temp home with the suite's stand-ins, the judges of
// what its window shows, and the planted `deep` commands. Homes, stand-ins and the finished record are ../helpers.ts's;
// the window is window.ts's. Each judge returns what's wrong, so a tagged test and a wrong program go through the same one.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import { answers, binOf, buildHook, childEnv, CLI, NODE, own, recordFile, rootOf, sleep, socketOf, type Home } from '../helpers.ts';
import { App, appBinary, named, onPixels, read, squash, type Plant, type Seen } from './window.ts';

const MINUTE = 60_000;
/** Long enough for a Set up that ends in a login service starting nothing, on a loaded machine. */
export const SETUP_MS = 3 * MINUTE;

const ZERO = /(^|[^\d])0 (asks? needs? you|waiting on you)\b/i;
const DIDNT_FINISH = /set ?up did(n['’]?t| not) finish/i;
const DIDNT_FINISH_SQUASHED = /setupdid(nt|not)finish/;
const SETTINGS = 'claudesettingsjson';

/** The app as a person starts it: no arguments, in the home `h`, light, as the reference window is. */
export async function open(h: Home, o: { hub?: 'starts' | 'dead'; plant?: Plant } = {}): Promise<App> {
  await buildHook();
  const binary = await appBinary(o.plant);
  return App.launch({ binary, cwd: h.tmp, own, env: { ...childEnv(h.home, { hub: o.hub ?? 'starts' }), DEEP_APP_APPEARANCE: 'light' } });
}

const button = (s: Seen) => s.nodes.find((n) => n.role === 'AXButton' && n.name === 'Set up');
const offers = (s: Seen): boolean => button(s) !== undefined;
const texts = (s: Seen): string[] => s.nodes.map((n) => n.name).filter(Boolean);

/** The count on a first screen whose setup didn't finish, on the nodes, the pixels and the menu bar, the 0 judged first. */
export function countFailures(s: Seen): string[] {
  const out: string[] = [];
  const zero = [...texts(s), ...s.lines].find((t) => ZERO.test(t));
  if (zero !== undefined) out.push(`the count must read setup didn't finish, never 0: the window reads ${JSON.stringify(zero)}`);
  const menu = s.menu.join(' ').trim();
  if (menu === '' || /^\d+$/.test(menu)) out.push(`the count must read setup didn't finish, never 0: the menu bar reads ${JSON.stringify(menu)}`);
  else if (!DIDNT_FINISH.test(menu)) out.push(`the count must read setup didn't finish: the menu bar reads ${JSON.stringify(menu)}`);
  if (!texts(s).some((t) => DIDNT_FINISH.test(t))) out.push(`the count must read setup didn't finish: no node of the window says so; its names are ${named(s)}`);
  if (!DIDNT_FINISH_SQUASHED.test(squash(s.lines.join('')))) out.push(`the count must read setup didn't finish: the window's pixels don't say so; they read ${read(s)}`);
  return out;
}

/** The one Set up button: a node a screen reader can press, inside the window, drawn. */
function buttonFailures(s: Seen): string[] {
  const out: string[] = [];
  const b = button(s);
  if (!b) out.push(`reopening the app must offer Set up again: no button named "Set up"; the window's names are ${named(s)}`);
  else {
    const [x, y, w, h] = s.window as [number, number, number, number];
    const [bx, by, bw, bh] = b.frame as [number, number, number, number];
    if (bx < x || by < y || bx + bw > x + w || by + bh > y + h) out.push(`reopening the app must offer Set up again: its button at ${JSON.stringify(b.frame)} is outside the window ${JSON.stringify(s.window)}`);
  }
  if (!s.lines.some((l) => /^set up$/i.test(l.trim()))) out.push(`reopening the app must offer Set up again: the window's pixels draw no Set up button; they read ${read(s)}`);
  return out;
}

/** Why setup stopped, with its fix, on the nodes and the pixels. */
function reasonFailures(s: Seen, why: { file: string } | 'hub'): string[] {
  const out: string[] = [];
  const nodesSay = texts(s).join('\n');
  const pixels = squash(s.lines.join(''));
  if (why === 'hub') {
    if (!/\bhub\b/i.test(nodesSay) || !/start/i.test(nodesSay)) out.push(`reopening the app must show why setup stopped, that the hub didn't start; the window's names are ${named(s)}`);
    if (!pixels.includes('hub') || !pixels.includes('start')) out.push(`reopening the app must show why setup stopped, that the hub didn't start; its pixels read ${read(s)}`);
    return out;
  }
  if (!nodesSay.includes(why.file) && !nodesSay.includes('~/.claude/settings.json')) out.push(`reopening the app must show why setup stopped, naming ${why.file}; the window's names are ${named(s)}`);
  if (!/\bfix/i.test(nodesSay)) out.push(`reopening the app must show the reason's fix; the window's names are ${named(s)}`);
  if (!pixels.includes(SETTINGS)) out.push(`reopening the app must show why setup stopped, naming ${why.file}; its pixels read ${read(s)}`);
  if (!pixels.includes('fix')) out.push(`reopening the app must show the reason's fix; its pixels read ${read(s)}`);
  return out;
}

/** After a setup that stopped: the count, then Set up, then, where one was kept, the reason. A setup of an earlier version kept none (`'none'`). */
export const offeredFailures = (s: Seen, why: { file: string } | 'hub' | 'none'): string[] => [
  ...countFailures(s), ...buttonFailures(s), ...(why === 'none' ? [] : reasonFailures(s, why)),
];

/** Once setup finished: no Set up, and nothing reading setup didn't finish. */
export function finishedFailures(s: Seen): string[] {
  const out: string[] = [];
  if (offers(s)) out.push('once setup finished, the app must not offer Set up again: the window still has the Set up button');
  const said = [...texts(s), ...s.lines, ...s.menu].find((t) => DIDNT_FINISH.test(t));
  if (said !== undefined) out.push(`once setup finished, the count must not read setup didn't finish: the window reads ${JSON.stringify(said)}`);
  return out;
}

/** Waits for the window's Set up, and presses it as a screen reader does. */
export async function pressSetUp(app: App): Promise<void> {
  const { seen, failures } = await app.settled((s) => (offers(s) ? [] : ['no Set up']));
  if (failures.length) expect.fail(`#1002 the app must offer Set up to be pressed; the window's names are ${named(seen)}`);
  const pressed = await app.press('Set up', 'AXButton');
  if (!pressed.found) expect.fail('#1002 the Set up button went away before it could be pressed');
}
/** The window's own word that Set up failed, naming the settings file. */
export const namesTheFile = (s: Seen): string[] => (onPixels(s, '.claude/settings.json') ? [] : [`Set up must fail naming the settings file on the window; its pixels read ${read(s)}`]);
/** The window's own word that Set up failed on the hub. */
export const namesTheHub = (s: Seen): string[] => (onPixels(s, 'hub') && !offers(s) ? [] : [`Set up must fail naming the hub on the window; its pixels read ${read(s)}`]);

/** `deep hub run` in the home, as a hub left running there: stopped at cleanup, by PID. */
export async function startHub(h: Home): Promise<void> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: h.tmp, env: childEnv(h.home), stdio: 'ignore' });
  own(child.pid);
  const deadline = Date.now() + 2 * MINUTE;
  while (!(await answers(socketOf(h.home)))) {
    if (Date.now() > deadline) throw Error('BLOCKED: the hub started for the test never answered');
    await sleep(200);
  }
}
/** What a setup that stopped at the merge base left: the folder, with the copy of the file it couldn't parse in it. */
export function leftByMergeBase(h: Home): void {
  mkdirSync(`${rootOf(h.home)}/originals`, { recursive: true, mode: 0o700 });
}

/**
 * A planted `deep` first on the home's PATH, which is the `deep setup` the app's Set up runs:
 * - `record-first` writes the finished record before setup plans any file and puts it back whatever setup did;
 * - `no-record` runs setup and leaves no record that it finished.
 */
export function plantDeep(h: Home, plant: 'record-first' | 'no-record'): void {
  const real = `'${NODE}' '${CLI}'`;
  const record = recordFile(h.home);
  const body = plant === 'record-first'
    ? [`keep() { printf '{"version":"%s"}\\n' "$(${real} --version)" > '${record}'; }`, `mkdir -p '${rootOf(h.home)}'`, 'keep', `${real} setup`, 'code=$?', 'keep', 'exit $code']
    : [`${real} setup`, 'code=$?', `rm -f '${record}'`, 'exit $code'];
  const file = `${binOf(h.home)}/deep`;
  writeFileSync(file, ['#!/bin/sh', `[ "$1" = setup ] || exec ${real} "$@"`, ...body, ''].join('\n'));
  chmodSync(file, 0o755);
}
