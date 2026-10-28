// Test-side tools for #400's AC5 (README): the caps a window's frames are held to when you switch away from it, the
// Mac is hot or you hide it. They build on the #400 suite's helpers (`../helpers.ts`: the deep-show build, the two
// displays, the scenario, the reply parsers), adding only this criterion's calls, its planted programs, a run that
// keeps something new at every latch of either display, and the readings of rates and evaluations. Nothing here
// stands in for the frame clock, the caps or the evaluation of a session.

import { expect } from 'vitest';
import {
  A, ALPHA, B, DOC, FLICKS, MS, PERIOD_A, arr, clearPoint, click, framesOf, lines, num, obj, onGrid, opened, popOut, presentedCall,
  scenario, scopeCall, serialOf, sharedBoard, str, ulid, windowsOf,
  type Display, type Frame, type JsonObject, type World,
} from '../helpers.ts';

/** The planted wrong programs of this criterion (README: Planted programs). */
export type CapPlanted = 'ignores_inactive_cap' | 'ignores_thermal_cap' | 'presents_hidden' | 'evaluates_hidden';

/** The design's per-window caps (Frame clock and scheduler: `caps: {inactive: 30 Hz, thermal: 60 Hz, hidden: 0}`). */
export interface Cap { name: 'inactive' | 'thermal'; hz: 30 | 60 }
export const INACTIVE: Cap = { name: 'inactive', hz: 30 };
export const THERMAL: Cap = { name: 'thermal', hz: 60 };
export const capLabel = (c: Cap): string => `${c.name}: ${c.hz} Hz`;
export const HIDDEN_CAP = 'hidden: 0';

// ---------------------------------------------------------------------------------------------------
// The three signals (README: Calls and replies)

/** The window server's report that this window became the key window; `null`: you switched to another app. */
export const activate = (at: number, window: string | null): JsonObject => ({ call: 'activate', at, window });
/** The OS's thermal state (ProcessInfo.thermalState): `serious` is hot, `nominal` isn't. */
export const thermal = (at: number, state: 'nominal' | 'serious'): JsonObject => ({ call: 'thermal', at, state });
/** The window server's report that you hid that window (`hidden: true`) or showed it again (`false`). */
export const hideWindow = (at: number, window: string, hidden: boolean): JsonObject => ({ call: 'hide_window', at, window, hidden });

// ---------------------------------------------------------------------------------------------------
// The run

type CapWorld = Omit<World, 'calls' | 'planted'> & { planted?: CapPlanted };

/** `deep-show run` on one scenario with this criterion's `planted` name: answered ok, one reply per call, in call order. */
function runCaps(bin: string, s: JsonObject, what: string): JsonObject[] {
  const [answer] = lines(bin, ['run'], [s]);
  expect(answer!['ok'], `${what}: deep-show run answers the scenario ok (the #400 surface, and AC5's \`activate\`, \`thermal\` and \`hide_window\` calls, the \`presented\` reply's \`evaluations\`${s['planted'] ? ` and planted ${String(s['planted'])}` : ''}, README: The surface under test); got ${JSON.stringify(answer).slice(0, 600)}`).toBe(true);
  const replies = arr(answer!['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(s['calls'], 'calls').length);
  return replies;
}

/**
 * The #400 suite's Driver, with this criterion's planted names: each step's calls are made from what the steps
 * before answered, and the whole scenario is replayed from the start with them added (the virtual clock reads no
 * wall time, so a replay answers the same). Returns each step's replies in the order its calls were given.
 */
class CapDriver {
  private calls: JsonObject[] = [];
  constructor(private readonly bin: string, private readonly world: CapWorld) {}
  step(added: JsonObject[], what: string): JsonObject[] {
    const fresh = added.map((c) => ({ ...c }));
    const { planted, ...rest } = this.world;
    const s = scenario({ ...rest, calls: [...this.calls, ...fresh] });
    if (planted) s['planted'] = planted;
    const replies = runCaps(this.bin, s, what);
    const sorted = arr(s['calls'], 'calls');
    this.calls = [...this.calls, ...fresh];
    return fresh.map((c) => replies[sorted.indexOf(c)]!);
  }
  one(call: JsonObject, what: string): JsonObject { return this.step([call], what)[0]!; }
}

interface Evaluation { at: number; session: string; window: string }
/** The `presented` reply's `evaluations`: every evaluation of the panel's sessions, each for the presentation time `at`. */
function evaluationsOf(reply: JsonObject | undefined, what: string): Evaluation[] {
  return arr(obj(reply, what)['evaluations'], `${what}: evaluations`).map((v, i) => {
    const e = obj(v, `${what}: evaluations[${i}]`);
    const at = `${what}: evaluations[${i}]`;
    return { at: num(e['at'], `${at}.at`), session: str(e['session'], `${at}.session`), window: str(e['window'], `${at}.window`) };
  });
}

/** One signal of a run: a call made at a phase boundary (after the window IDs are known). */
export type Signal = (ids: { main: string; popped: string }) => JsonObject;

export const PHASE = 300 * MS;
/** Where a phase's rate is read: 200 ms from 50 ms after the phase starts, half open. */
const SPAN = 200 * MS;
const PATCH_EVERY = 4 * MS; // under half a period of A (8.33 ms), so every latch of either display has something new

export interface CapRun {
  main: string; popped: string; s0: number;
  x: Frame[]; y: Frame[]; yEvaluations: Evaluation[];
  /** Each signal's reply, in the order given. */
  signals: JsonObject[];
  /** Each patch: its doc, its `at` and its reply. */
  patches: { doc: string; at: number; reply: JsonObject }[];
}

/**
 * Two windows, x in the main window on A (120 Hz) and y popped out onto B (60 Hz), as in the #400 suite's AC3; then,
 * from s0, alpha patches each board every 4 ms through `phases` phases of 300 ms, and `signals[k]` is made at the
 * start of phase k + 1. Ends with each panel's `presented`.
 */
export function capRun(bin: string, evidence: string, phases: number, signals: Signal[], planted?: CapPlanted): CapRun {
  const what = `x on A, y on B${planted ? ` (planted ${planted})` : ''}`;
  const d = new CapDriver(bin, {
    evidence, displays: [A, B], ...(planted ? { planted } : {}),
    docs: [
      { doc: DOC.x, panel: 'x', document: sharedBoard('Orders, live'), seed: true },
      { doc: DOC.y, panel: 'y', document: sharedBoard('Refunds, live'), seed: true },
    ],
  });
  const t0 = 20 * PERIOD_A;
  const p = clearPoint(d.one(scopeCall(t0, 'y'), `${what}: the scope of y`), `${what}: the scope of y`);
  const [press] = d.step(click(t0 + 5 * MS, 'y', p), `${what}: a click on y`);
  const y = opened(d.one(popOut(t0 + 100 * MS, 'y', B.uuid, serialOf(press, `${what}: the press on y`)), `${what}: pop y out onto B`), `${what}: pop y out onto B`);
  const main = windowsOf(d.one({ call: 'windows', at: t0 + 150 * MS }, `${what}: windows`), `${what}: windows`).find((w) => w.kind === 'main')?.window;
  expect(main, `${what}: the windows reply has the main window`).toBeDefined();
  const ids = { main: main!, popped: y.window };
  const s0 = t0 + 200 * MS;
  const end = s0 + phases * PHASE;
  const patchCalls: JsonObject[] = [];
  for (const [doc, offset, prefix] of [[DOC.x, 0, '01JB405P'], [DOC.y, MS, '01JB405Q']] as const) {
    for (let k = 0; s0 + offset + k * PATCH_EVERY < end; k++) {
      // Each patch adds a dot of alpha's own on base 0, so every one rebases cleanly whenever it arrives (#96).
      patchCalls.push({
        call: 'deep_show', session: ALPHA.id, doc, at: s0 + offset + k * PATCH_EVERY,
        patch: {
          patch: ulid(prefix, k + 1), doc, base: 0, reason: 'add a dot',
          ops: [{ op: 'create', item: { id: `alpha.d${k}`, kind: 'rect@1', name: `Dot ${k}`, order: `b${String(k).padStart(4, '0')}`, params: { box: [0, 0, 6, 6], paint: { fill: { role: 'ink' } } }, at: { pos: [10 + 8 * (k % 70), 20 + 8 * Math.floor(k / 70), 0] } } }],
        },
      });
    }
  }
  const signalCalls: JsonObject[] = signals.map((sig, k) => ({ ...sig(ids), at: s0 + (k + 1) * PHASE }));
  const tail = [presentedCall(end + 500 * MS, 'x'), presentedCall(end + 500 * MS, 'y')];
  const r = d.step([...patchCalls, ...signalCalls, ...tail], `${what}: the patches and the signals`);
  const n = patchCalls.length;
  const signalReplies = r.slice(n, n + signalCalls.length);
  signalReplies.forEach((reply, k) => expect(reply['code'], `${what}: the ${String(signalCalls[k]!['call'])} at phase ${k + 1} is taken, not refused: ${JSON.stringify(reply).slice(0, 400)}`).toBeUndefined());
  const yReply = r[n + signalCalls.length + 1];
  return {
    ...ids, s0, signals: signalReplies,
    patches: patchCalls.map((c, i) => ({ doc: String(c['doc']), at: num(c['at'], 'at'), reply: r[i]! })),
    x: framesOf(r[n + signalCalls.length], `${what}: x's frames`), y: framesOf(yReply, `${what}: y's frames`),
    yEvaluations: evaluationsOf(yReply, `${what}: y's presented reply`),
  };
}

/** Patches made in [from, to) that weren't applied: the run had something new at every latch only if this is empty. */
export function unapplied(r: CapRun, from: number, to: number): string[] {
  return r.patches.filter((p) => p.at >= from && p.at < to && p.reply['outcome'] !== 'applied').map((p) => `the patch at ${p.at} on ${p.doc === DOC.x ? 'x' : 'y'} was not applied: ${JSON.stringify(p.reply).slice(0, 300)}`);
}

// ---------------------------------------------------------------------------------------------------
// Readings

export const phaseSpan = (r: CapRun, phase: number): [number, number] => [r.s0 + phase * PHASE + 50 * MS, r.s0 + phase * PHASE + 50 * MS + SPAN];
const ms = (flicks: number): string => (flicks / MS).toFixed(2);

/**
 * What a window's frames in a span got wrong. Uncapped: a frame at every vsync of its display (its display's rate,
 * exactly, since something new reaches every latch). Capped: no two frames closer than the cap's period (at most
 * the cap) and still presenting at the cap, one frame short at most; each failure names the window and the cap.
 */
export function rateFailures(frames: Frame[], name: string, window: string, display: Display, span: [number, number], cap: Cap | null, why: string): string[] {
  const f: string[] = [];
  const label = display === A ? 'A (120 Hz)' : 'B (60 Hz)';
  const inSpan = frames.filter((fr) => fr.vsync >= span[0] && fr.vsync < span[1]);
  for (const fr of inSpan) {
    if (!onGrid(display, fr.vsync)) f.push(`window ${window} (${name})'s frame at ${fr.vsync} is not at a vsync of ${label}`);
    if (fr.display !== display.uuid) f.push(`window ${window} (${name})'s frame at ${fr.vsync} is paced by ${fr.display}, not ${label}`);
    if (fr.window !== window) f.push(`window ${name}'s frame at ${fr.vsync} names window ${fr.window}, not ${window}`);
  }
  if (cap === null) {
    const want = SPAN / (FLICKS / display.refresh_hz);
    if (inSpan.length !== want) f.push(`window ${window} (${name}) presented ${inSpan.length} frames in 200 ms ${why}, not ${want}, its display ${label}'s rate`);
    return f;
  }
  const period = FLICKS / cap.hz;
  const most = SPAN / period;
  let closest = Infinity;
  inSpan.forEach((fr, i) => { if (i > 0) closest = Math.min(closest, fr.vsync - inSpan[i - 1]!.vsync); });
  if (closest < period) f.push(`window ${window} (${name}) presented ${inSpan.length} frames in 200 ms ${why}, over its cap ${capLabel(cap)}: two frames ${ms(closest)} ms apart, under the cap's ${ms(period)} ms`);
  if (inSpan.length > most) f.push(`window ${window} (${name}) presented ${inSpan.length} frames in 200 ms ${why}, over its cap ${capLabel(cap)} (at most ${most})`);
  if (inSpan.length < most - 1) f.push(`window ${window} (${name}) presented only ${inSpan.length} frames in 200 ms ${why}, with something new at every latch: not presenting at its cap ${capLabel(cap)} (${most - 1} to ${most})`);
  return f;
}

/** Whether a failure names this window and this cap, as the criterion's "fails, naming the window and the cap". */
export const names = (failures: string[], window: string, cap: string): boolean => failures.some((m) => m.includes(window) && m.includes(cap));

