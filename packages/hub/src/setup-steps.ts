// The one list of what setup does on this machine (#1100): contracts/setup-steps.json, a row a step in the order setup
// runs them. Setup runs a row only where it finds the row's agent, and the app's first-launch screen names the same rows
// before the click (crates/deep-app/src/setup.rs reads the same file), so neither can name a step the other skips.
// Setup's one line and its record events name the rows it took.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { activePlant as plant } from './plant.js';

/** Where a row's agent is found: always, a home folder (an env variable naming it first), or a program on PATH. */
export type Found = 'always' | { env: string; folder: string } | { program: string };
export interface Row {
  step: 'hooks' | 'plugin' | 'history';
  /** The agent whose settings the step changes, or whose history it reads. */
  agent?: string;
  /** The agent's name, on a step that changes its settings. */
  name?: string;
  found: Found;
  /** The box's words that take this agent's part back out (#1998), where the box has them. */
  box?: string;
}

const LIST = JSON.parse(readFileSync(new URL('../../../contracts/setup-steps.json', import.meta.url), 'utf8')) as { steps: Row[] };
/** A row's key, `<step>:<agent>`, as setup's runners, its stop record and the screen's nodes name it. */
export const key = (row: Row): string => (row.agent ? `${row.step}:${row.agent}` : row.step);
export const onPath = (name: string): string | undefined => (process.env.PATH ?? '').split(':').map((dir) => join(dir, name)).find((file) => file.startsWith('/') && existsSync(file));
const found = (f: Found): boolean => f === 'always' || ('program' in f ? onPath(f.program) !== undefined : existsSync(process.env[f.env] || join(homedir(), f.folder)));

/** The rows setup will run on this machine, in order. */
export const planned = (): Row[] => LIST.steps.filter((row) => found(row.found));

/** `setup.report`'s steps, each `{step, agent}` as a row of the list names it; anything else is refused, naming it. */
export function reported(params: unknown): { step: string; agent: string | null }[] {
  const steps = (params as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) throw Error('setup.report takes steps, an array of {step, agent}');
  return steps.map((s: { step?: unknown; agent?: unknown } | null) => {
    const row = LIST.steps.find((r) => r.step === s?.step && (r.agent ?? null) === s?.agent);
    if (!row) throw Error(`setup's list of steps has no ${JSON.stringify(s)}`);
    return { step: row.step, agent: row.agent ?? null };
  });
}

/** How long a step runs before it says what it's doing (#1100). */
const SLOW_MS = 2000;
/** Runs `work`, saying `doing` once on stderr if it takes more than 2 s. */
export async function saying<T>(doing: string, work: () => Promise<T> | T): Promise<T> {
  // The planted wrong program says nothing, however long a step takes.
  const timer = plant() === 'silent-steps' ? undefined : setTimeout(() => process.stderr.write(`${doing}…\n`), SLOW_MS);
  try {
    return await work();
  } finally {
    clearTimeout(timer);
  }
}
/** What a row's step says it's doing when it's slow. */
export const doing = (row: Row): string => (row.step === 'history' ? "Reading your agents' history into the wiki, with your own agent" : `Adding DeepBuild's ${row.step === 'plugin' ? 'plugin' : 'hooks'} to ${row.name}`);
/** A row that changes an agent's settings. */
export const changes = (row: Row): boolean => row.name !== undefined;

/** "A", "A and B", "A, B and C". */
const listed = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
/**
 * What `deep setup`, the first `deep` command and the app's Set up say they did (#326, #1100), in one line from the rows
 * they took: the agents whose settings changed, the history read, how many shipped guard entries block from now, that
 * the rest is watch-only, the hub at login, and how to take it all back. Its one definition (#1455).
 */
export function setUpLine(done: readonly Row[], blocking: number, hub: boolean): string {
  // Each agent's possessive, so a name the line holds is never its longest literal piece.
  const agents = listed(done.filter(changes).map((r) => `${r.name!}'s`));
  const history = done.some((r) => r.step === 'history') ? ', and it read their history into the wiki with your own agent, on your plan' : '';
  const start = `DeepBuild's hooks are in ${agents} settings${history}; deep setup --undo removes it all.`;
  const login = hub ? ', and the hub starts at login' : '';
  // The planted wrong program's line says nothing of the guard entries that block, as the merge base's didn't.
  if (plant() === 'set-up-line-says-nothing-blocks') return `${start} Everything is in watch-only mode until you approve a project's checks${login}.`;
  return `${start} ${blocking} of DeepBuild's guard entries block commands that could break other work on this machine from now, each saying why; everything else is in watch-only mode until you approve a project's checks${login}.`;
}
