// Whether the programs DeepBuild's hook entries run are there to run (#993). setup writes deep-hook's path into each
// agent's settings, and for a source install that is a build folder: a clean build, a removed worktree or a settings
// file copied from another machine leaves the entries in place with nothing to run, and no hook ever arrives to say so.
// `deep doctor` and the hub both read this.
import { accessSync, constants, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ADAPTERS } from '@deepbuild/adapters';
import { claudeSettings, installed } from './claude-settings.js';
import { recordedEntries, recordedHome } from './codex-settings.js';

/** The entries of one agent's settings that run one program that can't run: missing, or not executable. */
interface Unrunnable { agent: 'claude-code' | 'codex'; file: string; events: string[]; path: string; why: 'gone' | 'not executable' }

/** The program a command runs: its first word past an `exec`, unquoted as setup quotes it (`'…'`, with `'\''` for a quote). */
export function programOf(command: string): string {
  const run = command.trim().replace(/^exec\s+/, '');
  const quoted = /^'((?:[^']|'\\'')*)'/.exec(run);
  if (quoted) return quoted[1]!.replaceAll(`'\\''`, "'");
  return run.split(/\s+/)[0] ?? '';
}

/** Setup's recorded entries for each agent, with the settings file that holds them. */
function recordedRuns(root: string): { agent: Unrunnable['agent']; file: string; entries: { event: string; command: string }[] }[] {
  const claude = installed(root);
  const codex = recordedEntries(root);
  return [
    ...(claude ? [{ agent: 'claude-code' as const, file: claudeSettings(), entries: Object.entries(claude.hooks).flatMap(([event, groups]) => groups.flatMap((g) => (g.hooks as Record<string, unknown>[]).map((h) => ({ event, command: String(h.command) })))) }] : []),
    ...(codex.length ? [{ agent: 'codex' as const, file: join(recordedHome(root), 'hooks.json'), entries: codex }] : []),
  ];
}

/** Each program setup's recorded entries run that can't run, grouped per agent and program, with the events naming it. */
export function unrunnable(root: string): Unrunnable[] {
  const out: Unrunnable[] = [];
  for (const { agent, file, entries } of recordedRuns(root)) {
    const byPath = new Map<string, string[]>();
    for (const { event, command } of entries) {
      const path = programOf(command);
      if (!byPath.has(path)) byPath.set(path, []);
      if (!byPath.get(path)!.includes(event)) byPath.get(path)!.push(event);
    }
    for (const [path, events] of byPath) {
      if (!existsSync(path)) { out.push({ agent, file, events, path, why: 'gone' }); continue; }
      try { accessSync(path, constants.X_OK); } catch { out.push({ agent, file, events, path, why: 'not executable' }); }
    }
  }
  return out;
}

/** The programs setup's recorded entries run, by absolute path: whether each can run is part of an agent's reach (#2648). */
export const entryPrograms = (root: string): string[] =>
  [...new Set(recordedRuns(root).flatMap((r) => r.entries.map((e) => programOf(e.command))))].filter((path) => isAbsolute(path));

/** One line naming the entries, the file and the program. */
export const describe = (u: Unrunnable): string =>
  `DeepBuild's ${u.events.join(', ')} hook entr${u.events.length === 1 ? 'y' : 'ies'} in ${u.file} run${u.events.length === 1 ? 's' : ''} ${u.path}, which is ${u.why}`;

const mappedBy = (adapter: string): string[] => Object.keys(ADAPTERS).filter((agent) => ADAPTERS[agent] === adapter);
/** The agents whose hooks each agent's settings carry, as the adapters map them: Cursor's CLI and Grok run the hooks in Claude Code's. */
export const RUN_BY: Readonly<Record<Unrunnable['agent'], readonly string[]>> = { 'claude-code': mappedBy('claude'), codex: mappedBy('codex') };
/** A session's reading while its agent's hooks can't run, and the one once they can again (#993). */
export const CANT_RUN = 'BLOCKED: hooks can\'t run';
export const CAN_RUN = 'Hooks can run again';
