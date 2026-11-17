// The one list of what setup does on this machine (#1100): contracts/setup-steps.json, a row a step in the order setup
// runs them. Setup runs a row only where it finds the row's agent, and the app's first-launch screen names the same rows
// before the click (crates/deep-app/src/setup.rs reads the same file), so neither can name a step the other skips.
// Setup's one line and its record events name the rows it took.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFacts } from '@deepbuild/adapters';
import { onPath } from './paths.js';
import { activePlant as plant } from './plant.js';
export { onPath } from './paths.js';

/**
 * Where a row's agent is found: always, a home folder (an env variable naming it first), a program on PATH (with its
 * home folder, where the row names one), or, for the install row (#1349), none of these programs on PATH and none
 * where an agent's own installer puts its program.
 */
export type Found = 'always' | { env: string; folder: string } | { program: string; folder?: string } | { none: string[] };
export interface Row {
  step: 'install' | 'hooks' | 'plugin' | 'package' | 'history';
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
/** Each agent's own installer and its plan, by agent (adapters/install.json). */
export interface Installer { name: string; plan: { paid: boolean; page: string; price?: string; read?: string }; [platform: string]: unknown }
export const installers = (): Record<string, Installer> => readFacts<{ agents: Record<string, Installer> }>('install.json').agents;
/** Where an agent's installer puts its program on this platform, under your home, or undefined when it has none here. */
export const lands = (agent: string): string | undefined => {
  const on = installers()[agent]?.[process.platform] as { lands?: string } | undefined;
  return on?.lands ? join(homedir(), on.lands) : undefined;
};
const found = (f: Found): boolean =>
  f === 'always' ? true
    : 'none' in f ? f.none.every((program) => onPath(program) === undefined) && Object.keys(installers()).every((agent) => { const at = lands(agent); return !at || !existsSync(at); })
      : 'program' in f ? onPath(f.program) !== undefined && (!f.folder || existsSync(join(homedir(), f.folder)))
        : existsSync(process.env[f.env] || join(homedir(), f.folder));

/** The rows setup will run on this machine, in order. */
export const planned = (): Row[] => LIST.steps.filter((row) => found(row.found));

/** `setup.report`'s steps, each `{step, agent}` as a row of the list names it; anything else is refused, naming it. */
export function reported(params: unknown): { step: string; agent: string | null }[] {
  const steps = (params as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) throw Error('setup.report takes steps, an array of {step, agent}');
  return steps.map((s: { step?: unknown; agent?: unknown } | null) => {
    const row = LIST.steps.find((r) => r.step === s?.step && (r.agent ?? null) === s?.agent);
    if (!row) throw Error(`setup's list of steps has no ${JSON.stringify(s)}`);
    // The planted wrong program installs Codex where the first screen named Claude Code.
    if (row.step === 'install' && plant() === 'installs-other-agent') return { step: row.step, agent: 'codex' };
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
export const doing = (row: Row): string => (row.step === 'history' ? "Reading your agents' history into the wiki, with your own agent"
  : row.step === 'install' ? `Installing ${installers()[row.agent!]?.name ?? row.agent} with its maker's own installer` : `Adding DeepBuild's ${row.step} to ${row.name}`);
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
  // An agent Set up installed (#1349) stays installed when DeepBuild is taken back, and the line says so.
  const installed = done.filter((r) => r.step === 'install').map((r) => installers()[r.agent!]?.name ?? r.agent!);
  const first = installed.length ? `${listed(installed)} is installed with its maker's own installer. ` : '';
  const start = `${first}DeepBuild's hooks are in ${agents} settings${history}; deep setup --undo removes ${installed.length ? `DeepBuild's part and leaves ${listed(installed)} installed` : 'it all'}.`;
  const login = hub ? ', and the hub starts at login' : '';
  // The planted wrong program's line says nothing of the guard entries that block, as the merge base's didn't.
  if (plant() === 'set-up-line-says-nothing-blocks') return `${start} Everything is in watch-only mode until you approve a project's checks${login}.`;
  return `${start} ${blocking} of DeepBuild's guard entries block commands that could break other work on this machine from now, each saying why; everything else is in watch-only mode until you approve a project's checks${login}.`;
}
