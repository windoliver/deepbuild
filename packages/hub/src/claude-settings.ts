// Claude Code's user settings, where DeepBuild's hook entries live in R1 (#18): `deep setup` merges them in beside
// yours, the timing relations read them (design: Numbers, timing relations), and the core puts a removed or weakened
// entry of ours back. Our entries are the ones setup recorded in <root>/claude-hooks.json, by their exact command.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeThrough } from './agent-files.js';
import { activePlant } from './plant.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The longest a stop is held, and how long before the Stop hook's timeout a hold must end. */
export const STOP_HOLD_MS = 60_000;
export const HOLD_MARGIN_MS = 5_000;
/** Claude Code's own timeouts, unless an entry sets one (its facts' hookTimeouts). */
const DEFAULT_TIMEOUT_S: Record<string, number> = { Stop: 600, UserPromptSubmit: 30 };
const DEFAULT_TIMEOUT = 60;
/**
 * The hooks the adapter maps (#18), each one entry; Stop also carries the waiter. FileChanged maps to no event: it is
 * the route a line takes into the terminal while a call still runs (#120), fired by the session's ticker file, which
 * the SessionStart reply names in `watchPaths`.
 */
export const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd', 'FileChanged'];
const TOOL_HOOKS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);

export const claudeSettings = (): string => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
const installedFile = (root: string): string => join(root, 'claude-hooks.json');

export interface Installed { hooks: Record<string, Obj[]> }
type Group = { matcher?: string; hooks: Obj[] };

export function readJson(file: string): Obj | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isObj(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
/**
 * Written whole, then moved over the file a link points to, so Claude Code never reads half of it and a link into
 * your dotfiles stays a link. The planted wrong program moves its temporary file over the link itself.
 */
export function writeJson(file: string, value: Obj): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (activePlant() !== 'setup-renames-over-link') return writeThrough(file, text);
  mkdirSync(dirname(file), { recursive: true });
  const next = `${file}.deepbuild-${process.pid}.tmp`;
  writeFileSync(next, text);
  renameSync(next, file);
}

/** What setup installed, or undefined before any setup. */
export const installed = (root: string): Installed | undefined => {
  const value = readJson(installedFile(root));
  return value && isObj(value.hooks) ? (value as unknown as Installed) : undefined;
};
export const commands = (record: Installed): Set<string> => new Set(Object.values(record.hooks).flatMap((groups) => groups.flatMap((g) => (g.hooks as Obj[]).map((h) => String(h.command)))));

/** Our groups: one entry per hook, plus the stop's waiter. Each runs deep-hook, or the deep CLI's waiter. */
export function ourGroups(deepHook: string, waiter: string, waiterTimeoutS: number): Record<string, Obj[]> {
  const q = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;
  const groups: Record<string, Obj[]> = {};
  for (const hook of HOOKS) {
    const entry = { type: 'command', command: `${q(deepHook)} claude-code ${hook}` };
    groups[hook] = [TOOL_HOOKS.has(hook) ? { matcher: '*', hooks: [entry] } : { hooks: [entry] }];
  }
  // A background waiter wakes an idle session with an answer; its timeout covers your longest ask deadline.
  groups.Stop!.push({ hooks: [{ type: 'command', command: waiter, asyncRewake: true, timeout: waiterTimeoutS }] });
  return groups;
}

/** Your groups with ours taken out: each of ours goes, and a group it leaves empty goes with it. */
function without(groups: unknown, ours: Set<string>): Group[] {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => {
    if (!isObj(group) || !Array.isArray(group.hooks)) return [group as Group];
    const kept = group.hooks.filter((h) => !(isObj(h) && ours.has(String(h.command))));
    return kept.length || !group.hooks.length ? [{ ...group, hooks: kept } as Group] : [];
  });
}

/**
 * Our groups merged into `settings` beside yours, replacing what an earlier setup put there; records them as ours in
 * <root>/claude-hooks.json, which the caller writes the settings after.
 */
export function withHooks(root: string, settings: Obj, groups: Record<string, Obj[]>): Obj {
  const before = installed(root);
  const ours = new Set([...(before ? commands(before) : []), ...commands({ hooks: groups })]);
  const record: Installed = { hooks: groups };
  writeJson(installedFile(root), record as unknown as Obj);
  return merged(settings, record, ours);
}
/** `settings` with our entries taken out: the hooks setup recorded, and our status line forwarder for yours. */
export function withoutOurs(root: string, settings: Obj, yours: string | undefined): Obj {
  const record = installed(root);
  const next = record ? merged(settings, { hooks: {} }, commands(record)) : { ...settings };
  if (isObj(next.hooks) && !Object.keys(next.hooks).length && !isObj(settings.hooks)) delete next.hooks;
  const line = next.statusLine;
  if (isObj(line) && /deep-hook\S*'? statusline$/.test(String(line.command))) {
    if (yours) next.statusLine = { ...line, command: yours };
    else delete next.statusLine;
  }
  return next;
}
/** The installed record's file, which undo removes so no hub start puts our entries back. */
export const installedRecord = installedFile;
export function merged(settings: Obj, record: Installed, ours: Set<string>): Obj {
  const hooks: Obj = isObj(settings.hooks) ? { ...settings.hooks } : {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = without(groups, ours);
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  for (const [event, groups] of Object.entries(record.hooks)) hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] as Obj[] : []), ...groups];
  return { ...settings, hooks };
}

/** Each entry of ours the settings no longer hold as setup wrote it: removed, or changed in any field. */
export function tampered(settings: Obj | undefined, record: Installed): string[] {
  const hooks = settings && isObj(settings.hooks) ? settings.hooks : {};
  const out: string[] = [];
  for (const [event, groups] of Object.entries(record.hooks)) {
    const present = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    for (const group of groups) {
      const same = JSON.stringify(group);
      if (!present.some((g) => JSON.stringify(g) === same)) out.push(`${event} ${(group.hooks as Obj[]).map((h) => String(h.command)).join(', ')}`);
    }
  }
  return out;
}
/** Puts our entries back as setup wrote them, and with `flag` takes Claude Code's hooks disable out; yours stay. */
export function restore(record: Installed, flag = false): void {
  const file = claudeSettings();
  const settings = readJson(file) ?? {};
  const next = merged(settings, record, commands(record));
  if (flag) delete next.disableAllHooks;
  writeJson(file, next);
}

// ---- Timing relations (design: Numbers version 0 has to hold): each with both values, in the words a person reads.

export interface Relation { name: 'stop hold' | 'waiter' | 'deep_ask' | 'stop continuations' | 'asks and batches'; holds: boolean; text: string; timeoutS: number }

/** How long deep_ask and deep_wait wait for an answer before saying it's still waiting, and the margin before the tool timeout. */
export const ASK_WAIT_MS = 40_000;
/** The MCP tool timeout DeepBuild takes when Claude Code's MCP_TOOL_TIMEOUT isn't set. */
const MCP_TOOL_TIMEOUT_MS = 60_000;
/** Claude Code's cap on consecutive stop-hook continuations in a turn, reset when the agent calls a tool. */
export const CONTINUATION_CAP = 8;

/** A duration in words: seconds as "300 s", whole minutes, hours or days in words. */
export function words(ms: number): string {
  for (const [unit, size] of [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]] as const) {
    if (ms >= size && ms % size === 0) return `${ms / size} ${unit}${ms === size ? '' : 's'}`;
  }
  return `${Math.round(ms / 1000)} s`;
}
const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
/** The longest ask deadline in your settings (config.json's asks block, as setup drafts it), in ms. */
export function longestDeadline(root: string): number | undefined {
  const config = readJson(join(root, 'config.json'));
  const deadlines = config && isObj(config.asks) && isObj(config.asks.deadline) ? Object.values(config.asks.deadline) : [];
  const ms = deadlines.map((v) => (typeof v === 'string' ? /^(\d+)([mhd])$/.exec(v) : null)).filter((m) => m !== null).map((m) => Number(m![1]) * UNITS[m![2]!]!);
  return ms.length ? Math.max(...ms) : undefined;
}
const entriesOf = (settings: Obj | undefined, event: string, ours: Set<string>): Obj[] => {
  const groups = settings && isObj(settings.hooks) && Array.isArray(settings.hooks[event]) ? (settings.hooks[event] as unknown[]) : [];
  return groups.flatMap((g) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks.filter((h): h is Obj => isObj(h) && ours.has(String(h.command))) : []));
};
const seconds = (entry: Obj, event: string): number => (typeof entry.timeout === 'number' ? entry.timeout : DEFAULT_TIMEOUT_S[event] ?? DEFAULT_TIMEOUT);

/** The relations our entries in `settings` keep, or none before setup. `env` is where sessions start, for MCP_TOOL_TIMEOUT. */
export function relations(root: string, settings: Obj | undefined = readJson(claudeSettings()), env: NodeJS.ProcessEnv = process.env): Relation[] {
  const record = installed(root);
  if (!record) return [];
  const ours = commands(record);
  const out: Relation[] = [];
  const stop = entriesOf(settings, 'Stop', ours).find((h) => !h.async && !h.asyncRewake);
  if (stop) {
    const timeoutS = seconds(stop, 'Stop');
    const hold = `${STOP_HOLD_MS / 1000} s`;
    // The planted wrong programs: one compares the hold with the timeout with no margin, one with twice the margin, one
    // only that the entry exists.
    const plant = activePlant();
    const margin = plant === 'stop-hold-no-margin' ? 0 : plant === 'stop-hold-wide-margin' ? 2 * HOLD_MARGIN_MS : HOLD_MARGIN_MS;
    out.push(plant === 'stop-hold-entry-only' || STOP_HOLD_MS + margin <= timeoutS * 1000
      ? { name: 'stop hold', holds: true, timeoutS, text: `stop hold holds: the ${hold} hold ends at least 5 s before the Stop hook entry's ${timeoutS} s timeout` }
      : { name: 'stop hold', holds: false, timeoutS, text: `stop hold broken: the ${hold} hold must end at least 5 s before the Stop hook entry's timeout, ${timeoutS} s, so Claude Code's stop holds are watch-only; raise that entry's timeout above ${(STOP_HOLD_MS + HOLD_MARGIN_MS) / 1000} s, or run deep setup` });
  }
  const waiter = entriesOf(settings, 'Stop', ours).find((h) => h.asyncRewake === true);
  const longest = longestDeadline(root);
  if (waiter && longest !== undefined) {
    const timeoutS = seconds(waiter, 'Stop');
    out.push(timeoutS * 1000 >= longest
      ? { name: 'waiter', holds: true, timeoutS, text: `waiter holds: the waiter entry's ${timeoutS} s timeout covers the longest ask deadline in your settings, ${words(longest)}` }
      : { name: 'waiter', holds: false, timeoutS, text: `waiter broken: the waiter entry's timeout, ${timeoutS} s, is shorter than the longest ask deadline in your settings, ${words(longest)}, so an answer given after the waiter stops arrives at the session's next prompt; run deep setup to restore it` });
  }
  // deep_ask says "still waiting" at least 5 s before Claude Code cuts the tool call off; past that it returns at once.
  const set = (isObj(settings?.env) ? settings.env.MCP_TOOL_TIMEOUT : undefined) ?? env.MCP_TOOL_TIMEOUT;
  const toolMs = /^\d+$/.test(String(set ?? '')) ? Number(set) : MCP_TOOL_TIMEOUT_MS;
  const from = set === undefined ? `the ${toolMs / 1000} s DeepBuild takes while MCP_TOOL_TIMEOUT isn't set` : `MCP_TOOL_TIMEOUT, ${toolMs / 1000} s`;
  out.push(toolMs >= 10_000 && ASK_WAIT_MS + HOLD_MARGIN_MS <= toolMs
    ? { name: 'deep_ask', holds: true, timeoutS: toolMs / 1000, text: `deep_ask holds: it says still waiting after ${ASK_WAIT_MS / 1000} s, at least 5 s before Claude Code's MCP tool timeout, ${from}` }
    : { name: 'deep_ask', holds: false, timeoutS: toolMs / 1000, text: `deep_ask broken: Claude Code's MCP tool timeout is ${from}, and deep_ask's ${ASK_WAIT_MS / 1000} s wait must end at least 5 s before it, so deep_ask returns at once with the ask's ID, deadline and default and the agent waits with deep_wait; set MCP_TOOL_TIMEOUT to at least ${(ASK_WAIT_MS + HOLD_MARGIN_MS) / 1000}000` });
  // Enforced by the hub: a held stop's send-back past the cap goes by the next prompt instead.
  out.push({ name: 'stop continuations', holds: true, timeoutS: 0, text: `stop continuations hold: DeepBuild sends back at most ${CONTINUATION_CAP} answers and send-backs through held stops in one Claude Code turn with no tool call between, its cap of ${CONTINUATION_CAP} consecutive stop-hook continuations; another waits for the next prompt` });
  // Enforced by the asks core: an ask whose deadline comes before its next batch shows at once.
  const config = readJson(join(root, 'config.json'));
  const every = config && isObj(config.asks) && isObj(config.asks.batch) ? String(config.asks.batch.every) : undefined;
  if (every) out.push({ name: 'asks and batches', holds: true, timeoutS: 0, text: `asks and batches hold: asks show in batches every ${every}, and one whose deadline${longest !== undefined ? ` (the longest is ${words(longest)})` : ''} comes before its next batch shows at once, so none reaches its deadline unseen` });
  return out;
}
