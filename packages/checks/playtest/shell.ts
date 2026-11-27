// shell.journeys (#851; canvas primitives: Check input: shell journeys): a game shell's journeys, each played once per
// device and size in a replica through deep.canvas.play, and judged here from the rows the replica returns, never
// from a frame. The replica turns each move into the device's own inputs; this file only reads what happened.
import type { CheckResult, Failure } from '@deepbuild/conformance';
import { failure, said } from './run.ts';

type Row = {
  step: number; screen: string | null; level: number; level_step: number; paused: boolean; unlocked: boolean[];
  focus: string | null; enabled: string[]; prompts: Record<string, string>; device: string | null; hash: string;
  transition: number; screen_step: number; from?: string; control?: string; quit?: boolean;
  /** #3605: the levels finished, the piece's own settings, the loaded level's arrays and its own full-state hash. */
  done?: boolean[]; custom?: number[]; values?: Record<string, unknown[]> | null; level_hash?: string | null;
};
type Box = [number, number, number, number];
type ShownControl = { box: Box | null; enabled: boolean; kind: string; item: string; text: Box | null; does: string | null };
type ShownScreen = { controls: Record<string, ShownControl>; frame: string | null; size: [number, number]; ends?: number; back?: string; prompts?: Record<string, { action: string }> };
export interface ShellAnswer {
  journey: string; device: string; size: [number, number]; steps: Row[]; screens: Record<string, ShownScreen>;
  entered: { level: number; step: number; carry: string | null; arrays: Record<string, unknown[]> | null; values?: Record<string, unknown[]> }[];
  carry: { level: number; step: number; sha256: string; arrays: Record<string, unknown[]> }[];
  track: { shell: unknown; step: number; device: string | null }[];
  refused: { code: string; message: string } | null; stopped: { code?: string; message?: string } | null;
  recording: string | null; levels: number; unpaused?: { level_step: number; hash: string }[]; paused?: { level_step: number; hash: string }[];
  unreached?: { from: string; control?: string; stop: { code?: string; message?: string } }[];
  /** #3605: each level load's own input track, and each completion's shell step. */
  level_tracks?: { level: number; entries: unknown[]; steps: number }[]; completions?: { level: number; step: number }[];
}
export type ShellPlay = (piece: string, run: { seed: number; shell: Record<string, unknown>; track?: unknown[] }) => Promise<{ shell: ShellAnswer } & Record<string, unknown>>;

export interface ShellInput {
  piece: string; seed: number; journeys?: string[]; devices?: string[]; sizes?: [number, number][];
  level?: { actions?: Record<string, number[]>; span?: number }; pause?: { at?: number; hold?: number; to?: number }; budget?: number;
  /** #3605: the moves journey's script, and the relaunch journey's first launch's. */
  moves?: unknown[];
}

export const JOURNEYS = ['title_to_level', 'unlock', 'carry', 'pause', 'credits', 'back', 'focus', 'prompts', 'layout', 'wired'];
const PLAYS = ['title_to_level', 'unlock', 'pause', 'credits', 'moves'];
/** #3605: the relaunch journey's four launches over one profile store, in order. */
export const LAUNCHES = ['first', 'relaunch', 'fresh', 'relaunch'] as const;
const DEVICES = ['keys', 'pad', 'touch'];
const SIZES: [number, number][] = [[1512, 982], [2400, 1080]];
/** The glyphs a prompt shows for confirm, back, pause and adjust, by device (Recipe: shell@1 game shell: Glyphs). */
export const GLYPHS: Record<string, Record<string, string>> = {
  keys: { confirm: 'Enter', back: 'Esc', pause: 'Esc', adjust: '← →' },
  pad: { confirm: '(A)', back: '(B)', pause: '(Menu)', adjust: '(D-pad)' },
  touch: { confirm: 'Tap', back: 'Back', pause: 'Pause', adjust: 'Drag' },
};

const levelWords = (i: number): string => `level ${i + 1}`;
const sizeWords = (s: [number, number] | undefined): string => (s ? `${s[0]} × ${s[1]}` : 'its size');
const fail = (code: string, test: string, message: string): Failure => failure(test, `${code}: ${message}`);

/** The rows of one sub-run, by the screen it started from. */
function byFrom(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) if (r.from !== undefined) out.set(r.from, [...(out.get(r.from) ?? []), r]);
  return out;
}

/** Each journey's own failures, from one run's answer. */
export function judge(a: ShellAnswer, input: ShellInput): Failure[] {
  const test = `${a.journey} with ${a.device} at ${sizeWords(a.size)}`;
  const out: Failure[] = [];
  if (a.refused) return [fail(a.refused.code, test, a.refused.message)];
  if (a.stopped) {
    const code = a.stopped.code ?? 'shell.device';
    out.push(fail(code, test, a.stopped.message ?? 'the run stopped short'));
    if (code === 'shell.device') return out;
  }
  const rows = a.steps;
  switch (a.journey) {
    case 'title_to_level': {
      const entered = rows.findIndex((r) => r.level === 0 && r.screen === null);
      if (entered < 0) {
        out.push(fail('shell.device', test, "the title's Start never entered level 1"));
        break;
      }
      const after = rows.slice(entered);
      const left = after.find((r) => r.screen !== null);
      if (!left || left.screen !== 'pause') out.push(fail('shell.back', test, `from level 1, back showed ${left?.screen ?? 'nothing'} before it left, not pause`));
      const backs = a.track.filter((e) => e.step >= rows[entered]!.step && (e.shell === 'back' || e.shell === 'pause' || isBackControl(a, e)));
      const title = after.findIndex((r) => r.screen === 'title');
      if (title < 0) out.push(fail('shell.back', test, 'back from level 1 never reached the title'));
      else if (backs.filter((e) => e.step <= after[title]!.step).length > 3) out.push(fail('shell.back', test, `back from level 1 took ${backs.filter((e) => e.step <= after[title]!.step).length} presses to reach the title, past 3`));
      break;
    }
    case 'unlock': {
      const first = rows[0];
      if (!first) break;
      const early = first.unlocked.map((u, i) => (u && i > 0 ? i : -1)).filter((i) => i >= 0);
      if (early.length) out.push(fail('shell.unlock', test, `${early.map(levelWords).join(' and ')} ${early.length > 1 ? 'are' : 'is'} open at the start, before ${early.length > 1 ? 'their turn' : 'its turn'}: only level 1 is`));
      const done = a.carry.find((c) => c.level === 0);
      const back = rows.findIndex((r, i) => i > 0 && rows[i - 1]!.level === 0 && r.level === -1);
      if (back < 0) {
        out.push(fail('shell.unlock', test, 'level 1 was never completed in the journey'));
        break;
      }
      const after = rows[back]!;
      const extra = after.unlocked.map((u, i) => (u && i > 1 ? i : -1)).filter((i) => i >= 0);
      if (!after.unlocked[1] && a.levels > 1) out.push(fail('shell.unlock', test, 'completing level 1 left level 2 locked'));
      if (extra.length && !early.length) out.push(fail('shell.unlock', test, `completing level 1 opened ${extra.map(levelWords).join(' and ')}, before ${extra.length > 1 ? 'their turn' : 'its turn'}`));
      const shown = rows.slice(back).find((r) => r.screen !== null);
      if (shown && shown.screen !== 'levels') out.push(fail('shell.unlock', test, `after level 1 the shell showed ${shown.screen}, not the level select`));
      void done;
      break;
    }
    case 'carry': {
      const given = a.carry.find((c) => c.level === 0);
      const took = a.entered.find((e) => e.level === 1);
      if (!given) out.push(fail('shell.carry', test, 'completing level 1 wrote no carry record'));
      else if (!took) out.push(fail('shell.carry', test, 'level 2 was never entered after level 1'));
      else if (took.carry !== given.sha256) out.push(fail('shell.carry', test, `level 2 started from ${took.carry ?? 'no carry record'}, not level 1's record ${given.sha256}`));
      else {
        for (const [name, v] of Object.entries(given.arrays)) {
          if (JSON.stringify(took.arrays?.[name]) !== JSON.stringify(v)) out.push(fail('shell.carry', test, `level 2's carried ${name} is ${JSON.stringify(took.arrays?.[name])}, not level 1's ${JSON.stringify(v)}`));
        }
      }
      break;
    }
    case 'pause':
    case 'relaunch':
      // Judged from all its plays together (pauseFailures, relaunchFailures).
      break;
    case 'moves':
      out.push(...doneFailures(a, test));
      break;
    case 'credits': {
      const ends = a.screens['credits']?.ends ?? 0;
      const on = rows.filter((r) => r.screen === 'credits');
      if (!on.length) out.push(fail('shell.credits', test, 'the credits screen was never shown'));
      else if (Math.max(...on.map((r) => r.screen_step)) < ends) out.push(fail('shell.credits', test, `the credits' roll never reached its end at step ${ends}`));
      const last = rows.at(-1);
      if (on.length && last?.screen === 'credits') out.push(fail('shell.credits', test, 'back never left the credits screen'));
      break;
    }
    case 'back': {
      for (const [from, sub] of byFrom(rows)) {
        const start = sub.findIndex((r) => r.control === 'back');
        if (start < 0) continue;
        const after = sub.slice(start);
        const t0 = after[0]!.step;
        const presses = a.track.filter((e) => e.step >= t0 && e.step <= (after.at(-1)?.step ?? t0) && (e.shell === 'back' || e.shell === 'pause' || isBackControl(a, e)));
        const title = after.find((r) => r.screen === 'title');
        const name = from === 'level' ? 'a level' : `the ${from} screen`;
        if (from === 'level') {
          const shown = after.find((r) => r.screen !== null);
          if (shown?.screen !== 'pause') out.push(fail('shell.back', test, `from a level, back showed ${shown?.screen ?? 'nothing'} before it left, not pause`));
        }
        if (!title) out.push(fail('shell.back', test, `from ${name}, back pressed again and again never reaches the title`));
        else {
          const n = presses.filter((e) => e.step <= title.step).length;
          if (n > 3) out.push(fail('shell.back', test, `from ${name}, back takes ${n} presses to reach the title, past 3`));
        }
      }
      for (const u of a.unreached ?? []) if (!rows.some((r) => r.from === u.from && r.screen === 'title' && r.control === 'back')) out.push(fail('shell.back', test, `from the ${u.from} screen there is no way back with ${a.device}: ${u.stop.message ?? ''}`));
      break;
    }
    case 'focus': {
      for (const [from, sub] of byFrom(rows)) {
        let engaged = false;
        for (const r of sub) {
          if (r.screen !== from) {
            engaged = false;
            continue;
          }
          if (!engaged) {
            engaged = (r.device === 'keys' || r.device === 'pad') && r.focus !== null;
            if (!engaged) continue;
          }
          if (r.focus !== null && !r.enabled.includes(r.focus)) {
            out.push(fail('shell.focus', test, `on the ${from} screen, focus stays on ${r.focus}, which is disabled, at step ${r.step}`));
            break;
          }
          if (r.focus === null && r.enabled.length) {
            out.push(fail('shell.focus', test, `on the ${from} screen, no control holds focus at step ${r.step} though ${r.enabled.join(', ')} ${r.enabled.length > 1 ? 'are' : 'is'} enabled`));
            break;
          }
        }
      }
      break;
    }
    case 'prompts': {
      for (const [from, sub] of byFrom(rows)) {
        const prompts = a.screens[from]?.prompts ?? {};
        for (let i = 1; i < sub.length; i++) {
          const r = sub[i]!;
          const prev = sub[i - 1]!;
          if (r.screen !== from || prev.screen !== from || !prev.device) continue;
          for (const [item, glyph] of Object.entries(r.prompts)) {
            const action = prompts[item]?.action ?? 'confirm';
            const want = GLYPHS[prev.device]?.[action];
            if (want !== undefined && glyph !== want) {
              out.push(fail('prompt.agree', test, `on the ${from} screen, the prompt ${item} shows ${glyph} at step ${r.step}, after ${prev.device} wrote last, whose glyph is ${want}`));
              break;
            }
          }
        }
      }
      break;
    }
    case 'layout': {
      const [w, h] = a.size;
      for (const [screen, s] of Object.entries(a.screens)) {
        const cs = Object.entries(s.controls).filter(([, c]) => c.box);
        for (let i = 0; i < cs.length; i++) {
          const [id, c] = cs[i]!;
          const b = c.box!;
          if (b[0] < -0.5 || b[1] < -0.5 || b[0] + b[2] > w + 0.5 || b[1] + b[3] > h + 0.5) out.push(fail('ui.layout', test, `on the ${screen} screen at ${sizeWords(a.size)}, ${id} (${c.item}) lies outside the frame at [${b.map(Math.round).join(', ')}]`));
          if (b[2] < 24 || b[3] < 24) out.push(fail('ui.layout', test, `on the ${screen} screen at ${sizeWords(a.size)}, ${id} (${c.item}) is ${b[2].toFixed(1)} × ${b[3].toFixed(1)} px, under 24 × 24`));
          const t = c.text;
          if (t && (t[0] < b[0] - 0.5 || t[1] < b[1] - 0.5 || t[0] + t[2] > b[0] + b[2] + 0.5 || t[1] + t[3] > b[1] + b[3] + 0.5)) out.push(fail('ui.layout', test, `on the ${screen} screen at ${sizeWords(a.size)}, ${id}'s text runs outside ${id} (${c.item})`));
          for (const [jd, d] of cs.slice(i + 1)) {
            const e = d.box!;
            const ow = Math.min(b[0] + b[2], e[0] + e[2]) - Math.max(b[0], e[0]);
            const oh = Math.min(b[1] + b[3], e[1] + e[3]) - Math.max(b[1], e[1]);
            if (ow > 1 && oh > 1) out.push(fail('ui.layout', test, `on the ${screen} screen at ${sizeWords(a.size)}, ${id} (${c.item}) and ${jd} (${d.item}) overlap by ${ow.toFixed(1)} × ${oh.toFixed(1)} px`));
          }
        }
      }
      break;
    }
    case 'wired': {
      const budget = input.budget ?? 30;
      const runs = new Map<string, Row[]>();
      for (const r of rows) if (r.from !== undefined && r.control !== undefined) runs.set(`${r.from}\u0000${r.control}`, [...(runs.get(`${r.from}\u0000${r.control}`) ?? []), r]);
      for (const [key, sub] of runs) {
        const [from, control] = key.split('\u0000') as [string, string];
        const before = sub[0]!;
        const changed = sub.slice(1).some((r) => r.hash !== before.hash || r.screen !== before.screen || r.quit === true);
        if (!changed) out.push(fail('wired', test, `on the ${from} screen, ${control} is enabled and, once activated, changed neither the full-state hash nor the screen within ${budget} steps`));
      }
      for (const u of a.unreached ?? []) {
        if (u.stop.code === 'shell.device') out.push(fail('shell.device', test, u.stop.message ?? `on the ${u.from} screen, ${u.control ?? 'a control'} can't be operated with ${a.device}`));
        else if (u.control) out.push(fail('wired', test, `on the ${u.from} screen, ${u.control} couldn't be activated: ${u.stop.message ?? ''}`));
      }
      break;
    }
  }
  return out;
}

const doneOf = (r: Row | undefined, i: number): boolean => r?.done?.[i] === true || (r?.done?.[i] as unknown) === 1;

/**
 * #3605: a level's `done` element turns true only at the shell step its level's own `done` first turned true, the row
 * whose step ran the level's last step and left it, and never turns false.
 */
export function doneFailures(a: ShellAnswer, test: string): Failure[] {
  const out: Failure[] = [];
  const rows = a.steps;
  for (let i = 0; i < a.levels; i++) {
    for (let r = 1; r < rows.length; r++) {
      const [was, now] = [doneOf(rows[r - 1], i), doneOf(rows[r], i)];
      if (was && !now) {
        out.push(fail('shell.done', test, `${levelWords(i)}'s mark is cleared at step ${rows[r]!.step}, which only start fresh or delete may do`));
        break;
      }
      if (now && !was) {
        const ran = rows[r - 1]!.level === i && rows[r]!.level !== i;
        const completed = (a.completions ?? []).some((c) => c.level === i && c.step === rows[r]!.step);
        if (!ran || !completed) out.push(fail('shell.done', test, `${levelWords(i)} is marked done at step ${rows[r]!.step}, where its own done never turned true`));
        break;
      }
    }
  }
  return out;
}

/** #3605: each level load's rows, in load order: the runs of rows with a level loaded. */
function loadRows(rows: Row[]): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] | null = null;
  for (const r of rows) {
    if (r.level >= 0) {
      if (!cur || cur[0]!.level !== r.level) { cur = []; out.push(cur); }
      cur.push(r);
    } else cur = null;
  }
  return out;
}

/**
 * #3605: each level load's own input track replayed as a piece with no shell: at every step its arrays must equal the
 * run's, and at its last step its full-state hash, or the replay fails, naming the first step that differs.
 */
export async function replayFailures(a: ShellAnswer, input: ShellInput, play: ShellPlay, test: string): Promise<Failure[]> {
  const out: Failure[] = [];
  const loads = loadRows(a.steps);
  for (const [n, t] of (a.level_tracks ?? []).entries()) {
    const rows = loads[n] ?? [];
    const steps = Math.max(0, ...rows.map((r) => r.level_step));
    if (!steps) continue;
    const at = (k: number): Row | undefined => rows.find((r) => r.level_step === k + 1);
    const paths = [...new Set(rows.flatMap((r) => Object.keys(r.values ?? {})))];
    const shell = { journey: 'replay', device: a.device, size: a.size, of: t.level, steps, values: paths };
    let r: ShellAnswer & { values?: Record<string, unknown[]>; final?: string };
    try {
      r = (await play(input.piece, { seed: input.seed, shell, track: t.entries })).shell as typeof r;
    } catch (e) {
      out.push(failure(test, `shell.replay: ${levelWords(t.level)}'s track couldn't be replayed with no shell: ${said(e)}`));
      continue;
    }
    let first = -1;
    for (let k = 0; k < steps && first < 0; k++) {
      const row = at(k);
      if (!row) continue;
      if (paths.some((p) => JSON.stringify(row.values?.[p]) !== JSON.stringify(r.values?.[p]?.[k]))) first = k;
    }
    if (first >= 0) {
      const p = paths.find((x) => JSON.stringify(at(first)?.values?.[x]) !== JSON.stringify(r.values?.[x]?.[first]))!;
      out.push(fail('shell.replay', test, `${levelWords(t.level)}'s track, replayed with no shell, first differs from the run at step ${first}: ${p} reads ${JSON.stringify(r.values?.[p]?.[first])}, the run ${JSON.stringify(at(first)?.values?.[p])}`));
    } else if (at(steps - 1)?.level_hash && r.final !== at(steps - 1)!.level_hash) {
      out.push(fail('shell.replay', test, `${levelWords(t.level)}'s track, replayed with no shell, ends at step ${steps - 1} on another full-state hash than the run's`));
    }
  }
  return out;
}

/**
 * #3605: the relaunch journey's launches over one profile store: a relaunch holds from its first row every mark the
 * last launch before it that wasn't fresh left; start fresh holds none.
 */
export function relaunchFailures(plays: ShellAnswer[], test: string): Failure[] {
  const out: Failure[] = [];
  let kept: Row | undefined;
  for (const [n, a] of plays.entries()) {
    const launch = LAUNCHES[n];
    const rows = a.steps;
    if (launch === 'fresh') {
      const marked = rows.find((r) => (r.done ?? []).some((_, i) => doneOf(r, i)));
      if (marked) out.push(fail('shell.profile', test, `start fresh shows ${(marked.done ?? []).map((_, i) => i).filter((i) => doneOf(marked, i)).map(levelWords).join(' and ')} marked done at step ${marked.step}`));
      continue;
    }
    if (launch === 'relaunch' && kept) {
      for (let i = 0; i < a.levels; i++) {
        const lost = rows.find((r) => doneOf(r, i) !== doneOf(kept, i));
        if (lost) out.push(fail('shell.profile', test, `on a relaunch ${levelWords(i)}'s mark reads ${doneOf(lost, i) ? 'done' : 'not done'} at step ${lost.step}, where the launch before it left it ${doneOf(kept, i) ? 'done' : 'not done'}`));
      }
    }
    kept = rows.at(-1);
  }
  return out;
}

/** A level step's full-state hash in a run: the hash of the first row at which level 1 reached it. */
function levelHashes(rows: Row[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of rows) if (r.level === 0 && !out.has(r.level_step)) out.set(r.level_step, r.hash);
  return out;
}

/** The pause journey's two plays, one never paused and one paused, compared level step by level step. */
export function pauseFailures(never: ShellAnswer, paused: ShellAnswer, input: ShellInput): Failure[] {
  const test = `pause with ${paused.device} at ${sizeWords(paused.size)}`;
  const to = input.pause?.to ?? 3600;
  const a = levelHashes(never.steps);
  const b = levelHashes(paused.steps);
  for (let k = 0; k <= to; k++) {
    if (a.get(k) === b.get(k)) continue;
    if (a.get(k) === undefined || b.get(k) === undefined) return [fail('shell.pause', test, `level 1 never reached level step ${k} in ${a.get(k) === undefined ? 'the run never paused' : 'the paused run'}`)];
    return [fail('shell.pause', test, `paused at level step ${input.pause?.at ?? 1200} and resumed, level 1 first differs from a run never paused at level step ${k}`)];
  }
  return [];
}

/** An entry that activated a control whose does is back. */
function isBackControl(a: ShellAnswer, e: { shell: unknown }): boolean {
  const s = e.shell as { control?: string } | string;
  if (typeof s !== 'object' || !s?.control) return false;
  return Object.values(a.screens).some((sc) => sc.controls[s.control!]?.does === 'back');
}

/** The check: every journey the input names, with each device and at each size, judged; the play journeys' runs of one size end on one full-state hash across devices. */
export async function runShell(input: ShellInput, play: ShellPlay): Promise<CheckResult> {
  const journeys = input.journeys ?? JOURNEYS;
  const devices = input.devices ?? DEVICES;
  const sizes = input.sizes ?? SIZES;
  const failures: Failure[] = [];
  const evidence: string[] = [];
  let testsRun = 0;
  const ends = new Map<string, Map<string, string>>();
  for (const journey of journeys) {
    // Layout reads boxes alone, so one device; focus is keys' and a pad's alone, since touches move no focus.
    const runDevices = journey === 'layout' ? [devices[0]!] : journey === 'focus' ? devices.filter((d) => d !== 'touch') : devices;
    for (const size of sizes) {
      for (const device of runDevices) {
        const shell: Record<string, unknown> = { journey, device, size };
        if (input.level !== undefined) shell['level'] = input.level;
        if (input.pause !== undefined) shell['pause'] = input.pause;
        if (input.budget !== undefined) shell['budget'] = input.budget;
        if (journey === 'moves' && input.moves !== undefined) shell['moves'] = input.moves;
        // The pause journey is two plays: one never paused, then one paused and resumed; the relaunch journey four, over
        // one profile store no other play shares.
        const store = `relaunch ${input.piece} ${device} ${size.join('x')} ${Date.now()} ${Math.random()}`;
        const runs = journey === 'pause'
          ? [{ ...shell, paused: false }, shell]
          : journey === 'relaunch'
            ? LAUNCHES.map((launch, n) => ({ ...shell, launch, store, ...(n === 0 && input.moves !== undefined ? { moves: input.moves } : {}) }))
            : [shell];
        const answers: ShellAnswer[] = [];
        try {
          for (const r of runs) answers.push((await play(input.piece, { seed: input.seed, shell: r })).shell);
        } catch (e) {
          failures.push(failure(`${journey} with ${device} at ${sizeWords(size)}`, `refused: ${said(e)}`, false));
          continue;
        }
        testsRun += answers.length;
        for (const a of answers) {
          for (const s of Object.values(a.screens)) if (s.frame) evidence.push(s.frame);
          if (a.recording) evidence.push(a.recording);
          failures.push(...judge(a, input));
        }
        const answer = answers.at(-1)!;
        const whole = answers.every((a) => !a.refused && !a.stopped);
        if (journey === 'pause' && whole) failures.push(...pauseFailures(answers[0]!, answer, input));
        if (journey === 'relaunch' && whole) failures.push(...relaunchFailures(answers, `${journey} with ${device} at ${sizeWords(size)}`));
        if (journey === 'moves' && whole) failures.push(...await replayFailures(answer, input, play, `${journey} with ${device} at ${sizeWords(size)}`));
        if (PLAYS.includes(journey) && !answer.refused && !answer.stopped && answer.steps.length) {
          // A journey's end: its last row's hash, and the pause journey's at level step `to`.
          const end = journey === 'pause' ? levelHashes(answer.steps).get(input.pause?.to ?? 3600) ?? 'none' : answer.steps.at(-1)!.hash;
          const key = `${journey} at ${sizeWords(size)}`;
          ends.set(key, (ends.get(key) ?? new Map()).set(device, end));
        }
      }
    }
  }
  for (const [key, byDevice] of ends) {
    if (new Set(byDevice.values()).size > 1) failures.push(failure(key, `shell.device: ${key}, the runs end on different full-state hashes: ${[...byDevice].map(([d, h]) => `${d} ${h.slice(0, 12)}`).join(', ')}`));
  }
  const seen = new Set<string>();
  const unique = failures.filter((f) => (seen.has(f.message) ? false : (seen.add(f.message), true)));
  const outcome = !unique.length ? 'passed' : unique.every((f) => !f.assertion) ? 'ran_nothing' : 'failed';
  return { outcome, testsRun, failures: unique, evidence: [...new Set(evidence)], read: [], mask: null };
}
