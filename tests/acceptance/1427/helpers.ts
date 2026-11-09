// Test-side tools for the #1427 acceptance tests (README: The surface): the motion recording as data, the planted
// fixtures that build one, the `motion_check` call, and the judges every test shares with the wrong programs it plants.
// Nothing here stands in for the check: every finding, claim and report comes from the `deep-drive` binary. The binary,
// its temporary homes and its process handling are #124's (../124/helpers.ts), reused by import; every process is
// stopped by its PID, nothing by name or port.
import { join } from 'node:path';
import { expect } from 'vitest';
import { Drive, FLICKS_PER_SECOND, REPO, must, type Obj } from '../124/helpers.ts';

export { Drive, REPO, must, type Obj };
export { cleanup, requireMacos, launch, sha256 } from '../124/helpers.ts';

export const HERE = join(REPO, 'tests', 'acceptance', '1427');
export const LAB = join(HERE, 'fixtures', 'panels', 'motion-lab');

/** The clock: flicks a second, and one step of a motion recording, a 120th of a second (the issue's step). */
export const FLICKS = FLICKS_PER_SECOND; // 705,600,000
export const STEP = FLICKS / 120; // 5,880,000
export const FORMAT = 'motion.recording@1';
/** The closed list of findings (the issue's scope), and the verdicts a claim may read. */
export const FINDINGS = ['pop_in', 'jump', 'overshoot', 'flicker', 'no_settle', 'reader_moved', 'moved_under_reduced_motion'] as const;
export const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'] as const;
export const NOT_MEASURED = 'pacing not measured';

// ---------------------------------------------------------------------------------------------------
// The recording, as data (README: The recording). One sample each step: every element's id, bounds, opacity and text.

export type Box = [number, number, number, number];
export interface El { id: string; bounds: Box; opacity: number; text: string }
export interface Declared { element: string; kind: 'flight' | 'spring' }
export interface Recording {
  format: typeof FORMAT;
  window: [number, number];
  step: number;
  reduced_motion: boolean;
  inputs: { t: number }[];
  reader: string | null;
  declared: Declared[];
  frames: { t: number; elements: El[] }[];
}

/** The window every data fixture is drawn in, in the recording's own unit (device pixels). */
export const WINDOW: [number, number] = [1000, 800];
/** Steps in a fixture: 5 s, so every fixture runs past 2 s after its last input and "still moving" can be judged. */
export const STEPS = 600;
export const W = 80;
export const H = 40;

/** An element at (x, y), 80 by 40, fully opaque, its text its id. */
export const el = (id: string, x: number, y: number, opacity = 1, text = id): El => ({ id, bounds: [x, y, W, H], opacity, text });

/**
 * A recording of `steps` steps from t = 0, one frame a step. `at(k)` gives the elements present at step `k` (an element
 * not in the list is absent from that frame). Everything else is a still element placed at the same spot all along.
 */
export function recording(o: {
  at: (k: number) => El[];
  steps?: number;
  inputs?: number[]; // times, in steps
  reduced?: boolean;
  reader?: string | null;
  declared?: Declared[];
  window?: [number, number];
}): Recording {
  const steps = o.steps ?? STEPS;
  return {
    format: FORMAT,
    window: o.window ?? WINDOW,
    step: STEP,
    reduced_motion: o.reduced ?? false,
    inputs: (o.inputs ?? [0]).map((k) => ({ t: k * STEP })),
    reader: o.reader ?? null,
    declared: o.declared ?? [],
    frames: Array.from({ length: steps }, (_, k) => ({ t: k * STEP, elements: o.at(k) })),
  };
}

/** Elements that never move: the page the planted element lives on. */
export const still = (): El[] => [el('header', 40, 20), el('footer', 40, 700)];

/** Linear: `from` to `to` over steps [a, b], held before and after. */
export const ramp = (k: number, a: number, b: number, from: number, to: number): number => (k <= a ? from : k >= b ? to : from + ((to - from) * (k - a)) / (b - a));
/** A triangle wave: `amp` a step up for `half` steps, then down, and so on; `n` half-waves, from step `a`; flat after. */
export function triangle(k: number, a: number, half: number, n: number, base: number, amp: number): number {
  const j = k - a;
  if (j <= 0) return base;
  const wave = Math.min(j, half * n);
  const phase = wave % (2 * half);
  const steps = phase <= half ? phase : 2 * half - phase;
  return base + steps * amp;
}

// ---------------------------------------------------------------------------------------------------
// The planted fixtures and their near-miss twins, each a recording; the README's table says what each plants.

/** Step 30: a row that was not there appears at full opacity in one step. */
export const POP = (opacityAtAppear: number, from: 'absent' | 'zero' = 'absent'): Recording =>
  recording({
    at: (k) => {
      if (from === 'zero' && k < 30) return [...still(), el('row:new', 100, 200, 0)];
      if (k < 30) return still();
      // Opacity at the first step it is there, then a rise of at most 10% a step to full: never a step over 50% after it.
      return [...still(), el('row:new', 100, 200, Math.min(1, opacityAtAppear + Math.max(0, k - 30) * 0.01))];
    },
  });

/** Step 30: an element moves `dx` right in ONE step (and sits there). */
export const JUMP = (dx: number, dy = 0, declared: Declared[] = []): Recording =>
  recording({ declared, at: (k) => [...still(), el('card:1', 100 + (k >= 30 ? dx : 0), 200 + (k >= 30 ? dy : 0))] });

/** A slide: 500 right over 100 steps (5 a step, 0.5% of the window), flight or not. */
export const SLIDE = (declared: Declared[] = []): Recording =>
  recording({ declared, at: (k) => [...still(), el('card:1', Math.round(ramp(k, 30, 130, 100, 600)), 200)] });

/**
 * Vertical, 0 to 720 over 24 steps (30 a step, 3.75% of the window), on to `peak`, then back to 720 and rest: the target
 * is 720, the move 720 long, the window 800 high. `peak - 720` is the excess: 110 is 15.3% of the move and 13.8% of the
 * window; 80 is 11.1% and 10%, under 12% either way it is read.
 */
export const OVERSHOOT = (peak: number, declared: Declared[] = []): Recording =>
  recording({
    declared,
    at: (k) => {
      const y = k <= 30 ? 0 : k <= 54 ? ((k - 30) * 720) / 24 : k <= 58 ? 720 + ((k - 54) * (peak - 720)) / 4 : k <= 66 ? peak - ((k - 58) * (peak - 720)) / 8 : 720;
      return [...still(), el('panel:1', 500, Math.round(y))];
    },
  });

/** Opacity 0.50 to 0.56 and back in 3-step half-waves from step 30, `n` half-waves: n - 1 reversals; flat after. */
export const FLICKER = (n: number, half = 3, amp = 0.02): Recording =>
  recording({ at: (k) => [...still(), el('badge:1', 100, 200, triangle(k, 30, half, n, 0.5, amp))] });

/** Input at step 0; the badge drifts a pixel a step from step 10 until step `until`, then rests. */
export const DRIFT = (until: number, inputs = [0]): Recording =>
  recording({ inputs, at: (k) => [...still(), el('badge:1', 100 + Math.max(0, Math.min(k, until) - 10), 200)] });

/**
 * A transcript, three lines (reader on `line-b`), and a line streamed in at step 40: at 10%, gaining 1% a step so it
 * never pops in. Above the reader it pushes line-b and line-c down 40 in one step; directly below the reader, line-c
 * only; at the end, nothing moves.
 */
export const STREAM = (where: 'above' | 'below' | 'end'): Recording =>
  recording({
    reader: 'line-b',
    inputs: [0],
    at: (k) => {
      const lines = [el('line-a', 40, 100, 1, 'Line A'), el('line-b', 40, 140, 1, 'Line B'), el('line-c', 40, 180, 1, 'Line C')];
      if (k < 40) return lines;
      const fresh = el('line-new', 40, 0, Math.min(1, 0.1 + (k - 40) * 0.01), `Streaming${'.'.repeat(Math.min(k - 40, 30))}`);
      if (where === 'above') {
        fresh.bounds[1] = 140;
        return [lines[0]!, fresh, { ...lines[1]!, bounds: [40, 180, W, H] }, { ...lines[2]!, bounds: [40, 220, W, H] }];
      }
      if (where === 'below') {
        fresh.bounds[1] = 180;
        return [lines[0]!, lines[1]!, fresh, { ...lines[2]!, bounds: [40, 220, W, H] }];
      }
      fresh.bounds[1] = 220;
      return [...lines, fresh];
    },
  });

/** Under reduced motion: a card moves `steps` steps, 10 each (so no jump), from step 30. */
export const REDUCED = (steps: number, reduced = true): Recording =>
  recording({ reduced, at: (k) => [...still(), el('card:1', 100 + 10 * Math.max(0, Math.min(k - 30, steps)), 200)] });

// ---------------------------------------------------------------------------------------------------
// The call, and the judges.

export interface Allowance { finding: string; element: string; reason?: string | null }

/** `{call: "motion_check", motion_check: args}`; the reply, whatever it says. It needs no launched replica. */
export async function motionCheck(drive: Drive, args: Obj): Promise<Obj> {
  return (await drive.call({ call: 'motion_check', motion_check: args }, 900_000)).reply;
}
/** The same, failing the test with the binary's words when the check didn't answer. */
export async function checked(drive: Drive, args: Obj): Promise<Obj> {
  const reply = await motionCheck(drive, args);
  expect(reply.ok, `motion_check answers: ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
  contract(reply);
  return reply;
}

/**
 * What every answer holds (README: The reply): a findings list from the closed list, each naming its element and time
 * (flicks, a whole number of steps) and measured value (a number); a claim among the five verdicts; and, never PASS,
 * the words pacing not measured.
 */
export function contract(reply: Obj): void {
  const at = JSON.stringify(reply).slice(0, 600);
  expect(Array.isArray(reply.findings), `findings is a list: ${at}`).toBe(true);
  for (const f of reply.findings as Obj[]) {
    expect(FINDINGS as readonly string[], `a finding from the closed list: ${JSON.stringify(f)}`).toContain(f.finding);
    expect(typeof f.element === 'string' && f.element.length > 0, `a finding names its element: ${JSON.stringify(f)}`).toBe(true);
    expect(Number.isInteger(f.t), `a finding names its time in flicks: ${JSON.stringify(f)}`).toBe(true);
    expect(typeof f.value === 'number' && Number.isFinite(f.value), `a finding names its measured value: ${JSON.stringify(f)}`).toBe(true);
  }
  expect(VERDICTS as readonly string[], `a claim is one of the five verdicts: ${at}`).toContain(reply.claim);
  expect(String(reply.pacing).toLowerCase(), `the result says pacing was not measured: ${at}`).toContain(NOT_MEASURED);
  expect(String(reply.pacing), `and never reads PASS for pacing: ${at}`).not.toMatch(/pass/i);
}

/** `partial`: the element's id holds `element` (a panel's own ids may come with a path, as a real replica keys them). */
type Want = { finding: string; element: string; partial?: boolean; t?: number; between?: [number, number]; value?: number; atLeast?: number };
/**
 * The findings are exactly `want`, in any order: each one's name and element, its time (`t` exactly, or `between` two
 * times inclusive) and its value (`value` within a thousandth, or `atLeast`). Problems come back as one message.
 */
export function problems(reply: Obj, want: Want[]): string[] {
  const found = (reply.findings as Obj[] | undefined) ?? [];
  const out: string[] = [];
  const name = (f: { finding: string; element: string } | Obj) => `${f.finding} on ${f.element}`;
  const left = [...found];
  for (const w of want) {
    const i = left.findIndex((f) => f.finding === w.finding && (w.partial ? String(f.element).includes(w.element) : f.element === w.element));
    if (i < 0) { out.push(`no ${name(w)}`); continue; }
    const [f] = left.splice(i, 1) as [Obj];
    if (w.t !== undefined && f.t !== w.t) out.push(`${name(w)} is at t ${f.t}, not ${w.t}`);
    if (w.between && !(f.t >= w.between[0] && f.t <= w.between[1])) out.push(`${name(w)} is at t ${f.t}, outside ${w.between[0]} to ${w.between[1]}`);
    if (w.value !== undefined && !(Math.abs(f.value - w.value) < 1e-3)) out.push(`${name(w)} measured ${f.value}, not ${w.value}`);
    if (w.atLeast !== undefined && !(f.value >= w.atLeast)) out.push(`${name(w)} measured ${f.value}, under ${w.atLeast}`);
  }
  for (const f of left) out.push(`unexpected ${name(f)} at t ${f.t} measuring ${f.value}`);
  return out;
}
/** The findings are exactly `want`; fails with every problem and the whole reply when they aren't. */
export function expectFindings(reply: Obj, want: Want[]): void {
  const p = problems(reply, want);
  expect(p, `findings ${JSON.stringify(reply.findings)}${p.length ? ` (claim ${reply.claim})` : ''}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Journeys on a real replica (README: Fixtures). A journey is a list of `deep_drive` calls, a launch first, as #124's
// `ui_check.journey` takes it; the replica field is left out.

/** The lab, launched at 640 by 600 points at 2x: 1280 by 1200 device pixels. */
export const LAB_WINDOW: [number, number] = [1280, 1200];
export const launchLab = (extra: Obj = {}): Obj => ({ call: 'launch', launch: { from: 'empty', panel: LAB, size: [640, 600], scale: 2, clock: 'virtual', ...extra } });
export const press = (name: string): Obj => ({ call: 'act', locator: { role: 'button', name }, act: { kind: 'click' } });
export const waitUntil = (seconds: number): Obj => ({ call: 'wait_for', wait_for: { t: seconds * FLICKS }, timeout: 120_000 });
/** Launch the lab, press `name`, run to 6 s of the replica's clock, and assert the button is still there. */
export const journey = (name: string, extra: Obj = {}): Obj[] => [
  launchLab(extra),
  press(name),
  waitUntil(6),
  { call: 'expect', locator: { role: 'button', name }, expect: { name: `${name} is there`, assert: 'visible' } },
];
