// The judges of the #1047 acceptance tests: each decides one clause of a criterion from what the replicas answered,
// what the check's result says, or hashes, and returns one line for each thing that is wrong (none when it holds),
// so a failing test names the run, the step or the layouts its criterion names. They import nothing but Node's
// crypto and are plain data in, lines out, so each was run against planted inputs before any replica existed
// (README: The judges). Nothing here stands in for the replica, the host or the plug-in.
import { createHash } from 'node:crypto';

export type Obj = { [key: string]: any };
/** One play as a replica got it and answered it: #184's `Played`, the two fields read here. */
export interface PlayedLike { call: Obj; reply: Obj }
/** A run of a playtest as the replicas played it: #184's `RunPlays`. */
export interface RunLike { b: number; i: number; seed: number; play: PlayedLike; replays: PlayedLike[] }
/** The save a playtest starts from: its asset ID, its step, and the piece's full-state hash there as a play reports one. */
export interface SaveAt { id: string; step: number; hash: string }

/**
 * The piece's full state as one hash, as the replica's play forms a checkpoint's `hash` and its `final`: the SHA-256
 * of `<item ID>=<that item's full-state hash>` and a line end for each of the piece's own items, in piece order. With
 * a save's `deep_hash` it gives the hash a play must report where it stands on that save's state.
 */
export function fullState(deep: Record<string, unknown>, ids: readonly string[]): string {
  return createHash('sha256').update(ids.map((id) => `${id}=${typeof deep[id] === 'string' ? (deep[id] as string) : ''}\n`).join('')).digest('hex');
}

/** `text` as a whole word or number, not part of a longer one (#184's `word`). */
export const word = (text: string): RegExp => new RegExp(`(^|[^0-9A-Za-z_])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^0-9A-Za-z_])`);
const text = (v: unknown): string => JSON.stringify(v) ?? 'undefined';
const name = (r: RunLike): string => `bot ${r.b} run ${r.i} (seed ${r.seed})`;
const checkpoints = (p: PlayedLike): Obj[] => (Array.isArray(p.reply['checkpoints']) ? (p.reply['checkpoints'] as Obj[]) : []);
/** The save a play was given to start from: its call's `from.save`. */
const given = (p: PlayedLike): unknown => (p.call['from'] !== null && typeof p.call['from'] === 'object' ? (p.call['from'] as Obj)['save'] : undefined);
/** Where a play says it started: its first checkpoint. */
const start = (p: PlayedLike): string => {
  const first = checkpoints(p)[0];
  return `starts at step ${text(first?.['step'])} with the full-state hash ${text(first?.['hash'])}, given from ${text(p.call['from'])}`;
};
const fromSave = (p: PlayedLike, save: SaveAt): boolean => {
  const first = checkpoints(p)[0];
  return p.reply['ok'] === true && first?.['step'] === save.step && first?.['hash'] === save.hash && given(p) === save.id;
};
const wanted = (save: SaveAt): string => `not at the save's step ${save.step} with ${text(save.hash)}, given from ${text({ save: save.id })}`;

/**
 * Criterion 1, "starts each of its 20 runs at step 1,800 with the save's full-state hash": each run whose play, as
 * the replica got and answered it, wasn't given the save, or whose first checkpoint isn't the save's step with the
 * save's full-state hash. Each line names the run and its first step.
 */
export function notFromSave(runs: readonly RunLike[], save: SaveAt): string[] {
  return runs.filter((r) => !fromSave(r.play, save)).map((r) => `${name(r)} ${start(r.play)}, ${wanted(save)}`);
}

/**
 * Whether the state a run started from is the save's, read from what its bot did there: each run whose bot's entries
 * on `control` aren't `want`, the presses the bot's own rule makes from the saved state. A run that started from any
 * other state presses otherwise, whatever its first checkpoint says.
 */
export function notPlayedOn(runs: readonly RunLike[], control: string, want: readonly number[]): string[] {
  return runs.flatMap((r) => {
    const entries = Array.isArray(r.play.reply['entries']) ? (r.play.reply['entries'] as Obj[]) : [];
    const got = entries.filter((e) => e['control'] === control && e['writer'] === 'bot').map((e) => e['value'] as unknown);
    return text(got) === text(want) ? [] : [`${name(r)}'s bot pressed ${text(got)} on ${control}, not ${text(want)}, its presses from the state the save holds`];
  });
}

/** A run's own replays: the plays of its recorded track without a bot, at its seed. */
const replaysOf = (r: RunLike): PlayedLike[] => r.replays.filter((p) => p.call['seed'] === r.seed);

/**
 * Criterion 1, "each run's track replays from the save to the same hashes": each run whose track wasn't played again
 * without its bot, whose replay didn't start from the save, or whose replay's checkpoints or final hash aren't the
 * run's. Each line names the run and the first step whose full-state hash differs.
 */
export function replayDiffers(runs: readonly RunLike[], save: SaveAt): string[] {
  const lines: string[] = [];
  for (const r of runs) {
    const replays = replaysOf(r);
    if (!replays.length) lines.push(`${name(r)}: its track was never played again without its bot`);
    for (const p of replays) {
      if (!fromSave(p, save)) { lines.push(`${name(r)}'s replay ${start(p)}, ${wanted(save)}`); continue; }
      const [a, b] = [checkpoints(r.play), checkpoints(p)];
      const at = Array.from({ length: Math.max(a.length, b.length) }, (_, j) => j).find((j) => a[j]?.['step'] !== b[j]?.['step'] || a[j]?.['hash'] !== b[j]?.['hash']);
      if (at !== undefined) lines.push(`${name(r)}'s replay first differs in the full-state hash at step ${text(a[at]?.['step'] ?? b[at]?.['step'])}: ${text(b[at]?.['hash'])} against the run's ${text(a[at]?.['hash'])}`);
      else if (p.reply['final'] !== r.play.reply['final']) lines.push(`${name(r)}'s replay differs in the full-state hash at the end: ${text(p.reply['final'])} against the run's ${text(r.play.reply['final'])}`);
    }
  }
  return lines;
}

/**
 * Whether the two comparisons above compared anything: each run that played no step, has no checkpoint past its
 * first, or ends on the very state it started from, so that equal hashes would say nothing.
 */
export function stoodStill(runs: readonly RunLike[], save: SaveAt): string[] {
  const lines: string[] = [];
  for (const r of runs) {
    const c = checkpoints(r.play);
    if (!(Number(r.play.reply['steps']) > 0)) lines.push(`${name(r)} played ${text(r.play.reply['steps'])} steps`);
    else if (c.length < 2) lines.push(`${name(r)} has ${c.length} checkpoint, none past its first`);
    else if (r.play.reply['final'] === save.hash || typeof r.play.reply['final'] !== 'string') lines.push(`${name(r)} ends at ${text(r.play.reply['final'])}, the state it started from: nothing moved`);
  }
  return lines;
}

/** A check result's fields read here (check.kind@1's). */
export interface ResultLike { outcome: string; testsRun: number; failures: readonly { test?: string; message: string }[] }

/**
 * Criterion 1, "a planted runner that starts at step 0 fails, naming the run and its first step": what the result of
 * a runner that started the runs `started` at step `first` lacks. It must not read `passed`, and for each of those
 * runs one failure must name it, as `run <i>`, and its first step, as `step <first>`.
 */
export function notRefusedAtStart(result: ResultLike, started: readonly number[], first: number): string[] {
  const lines: string[] = [];
  if (result.outcome === 'passed') lines.push(`its outcome is passed, counting ${result.testsRun} runs`);
  for (const i of started) {
    if (!result.failures.some((f) => word(`run ${i}`).test(f.message) && word(`step ${first}`).test(f.message))) lines.push(`no failure names run ${i} and its first step, step ${first}`);
  }
  return lines;
}

/**
 * Criterion 2, "is refused by logic.layout before any run, naming both layouts; the playtest counts 0 runs from it
 * and … never PASS": what the playtest's result lacks. It must count 0 runs, must not read `passed`, and one
 * failure must name logic.layout and both layouts, the save's and the piece's.
 */
export function notRefusedByLayout(result: ResultLike, layouts: { save: string; piece: string }): string[] {
  const lines: string[] = [];
  if (result.testsRun !== 0) lines.push(`it counts ${result.testsRun} runs, not 0`);
  if (result.outcome === 'passed') lines.push('its outcome is passed');
  const names = (m: string): boolean => m.includes('logic.layout') && m.includes(layouts.save) && m.includes(layouts.piece);
  if (!layouts.save || !layouts.piece || layouts.save === layouts.piece) lines.push(`the two layouts to name aren't two: ${text(layouts)}`);
  else if (!result.failures.some((f) => names(f.message))) lines.push(`no failure names logic.layout and both layouts, the save's ${layouts.save} and the piece's ${layouts.piece}`);
  return lines;
}

/** Criterion 2, "before any run": each play in the log that ran a step. */
export function ranSteps(log: readonly PlayedLike[]): string[] {
  return log.filter((p) => p.reply['ok'] === true && Number(p.reply['steps']) !== 0)
    .map((p) => `a play ran ${text(p.reply['steps'])} steps at seed ${text(p.call['seed'])}${p.call['bot'] ? ', with its bot' : ''}${p.call['track'] !== undefined ? ', a recorded track' : ''}, given from ${text(p.call['from'])}`);
}
