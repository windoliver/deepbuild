// Claude Code's mods (#1033): plugins whose functions run inside Claude Code and answer its events. One that handles
// the facts' overriding event (tool.check) answers after the PreToolUse hooks, so it can approve a call deep-hook
// denied, unless one of the facts' cases holds the deny. A home's mods are read from Claude Code's plugin list and
// each plugin's `claude plugin validate` lines, never by loading a mod's code.
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ModsFacts {
  since: { terminal: string; desktop: string };
  validate: { args: string[]; hooks: string; calls: string };
  overrides: { event: string; past: string };
  promptCalls: string[];
  holdsWhen: { case: 'managed' | 'login' | 'plan' | 'interactive'; text: string; subscriptionTypes?: string[]; mode?: string; since?: string; tools?: string[] }[];
}
/** The Claude Code facts' mods entry. */
export const modsFacts = (): ModsFacts => (JSON.parse(readFileSync(new URL('../../../adapters/claude-code.facts.json', import.meta.url), 'utf8')) as { mods: ModsFacts }).mods;

export interface Mod {
  /** The plugin as Claude Code names it, `name@marketplace`. */
  plugin: string;
  name: string;
  hooks: string[];
  calls: string[];
  /** It handles the overriding event, so it can approve a call past a PreToolUse deny. */
  overrides: boolean;
  /** It submits prompts. */
  prompts: boolean;
}
/** A home's mods, or why they couldn't be read. */
export type HomeMods = { home: string; mods: Mod[] } | { home: string; unread: string };

/** Claude Code's managed settings file; DEEP_HUB_TEST_MANAGED_SETTINGS names another for tests. Present, it holds a hook's deny. */
export const managedSettings = (env: NodeJS.ProcessEnv): string =>
  env.DEEP_HUB_TEST_MANAGED_SETTINGS || (process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json' : '/etc/claude-code/managed-settings.json');
/** The first executable claude on the environment's PATH. */
export function claudeOnPath(env: NodeJS.ProcessEnv): string | undefined {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    try { accessSync(join(dir, 'claude'), constants.X_OK); return join(dir, 'claude'); } catch { /* not here */ }
  }
  return undefined;
}
/**
 * Why the setup holds a PreToolUse deny whatever a mod answers, by the facts' cases: managed settings on the machine,
 * or a Team or Enterprise login (`claude auth status`); undefined when nothing does.
 */
export async function denyHolds(env: NodeJS.ProcessEnv, claude: string | undefined, facts: ModsFacts = modsFacts()): Promise<string | undefined> {
  const managed = managedSettings(env);
  if (existsSync(managed)) return `Claude Code's managed settings (${managed}) are present`;
  const login = facts.holdsWhen.find((c) => c.case === 'login')?.subscriptionTypes ?? [];
  if (!claude || !login.length) return undefined;
  const ran = await run(claude, ['auth', 'status'], env);
  let plan: unknown;
  try { plan = (JSON.parse(ran?.out ?? '') as Obj).subscriptionType; } catch { return undefined; }
  return typeof plan === 'string' && login.includes(plan) ? `the session signs in with a ${plan} login` : undefined;
}
/** Each Claude Code home: CLAUDE_CONFIG_DIR where it is set, and ~/.claude. */
export function claudeHomes(env: NodeJS.ProcessEnv): string[] {
  const home = join(env.HOME || homedir(), '.claude');
  return [...new Set([...(env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : []), home])];
}
/** The Claude Code home a session's transcript lives in: `<home>/projects/<folder>/<session>.jsonl`. */
export function homeOfTranscript(transcript: string): string | undefined {
  const at = transcript.lastIndexOf('/projects/');
  return at > 0 ? transcript.slice(0, at) : undefined;
}

function run(claude: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): Promise<{ code: number | null; out: string; err: string } | null> {
  return new Promise((done) => {
    execFile(claude, args, { timeout: 10_000, encoding: 'utf8', env, maxBuffer: 16 << 20, ...(cwd ? { cwd } : {}) }, (error, out, err) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return done(null);
      done({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, out: String(out), err: String(err) });
    });
  });
}
/**
 * What each of a plugin's hooks modules lists after `prefix`, as `❯ ./register.ts hooks: tool.check`, joined; a line
 * that starts with it counts too. `none` and `nothing on $` list nothing.
 */
const listed = (out: string, prefix: string): string[] => out.split('\n').flatMap((line) => {
  const rest = new RegExp(`(?:^|\\.[cm]?[jt]sx?\\s+)${prefix}\\s*(.*)$`).exec(line.replace(/^\s*❯?\s*/, ''))?.[1]?.trim();
  return rest === undefined || /^(none|nothing\b)/.test(rest) ? [] : rest.split(/[\s,]+/).filter(Boolean);
});

interface Plugin { plugin: string; folder: string }
/**
 * The plugins a home loads, as `claude plugin list --json` reports them (installed, skills-dir and project ones, each
 * with the folder its code is read from); where that can't be read, the registry and the skills folder, each turned off
 * only by `enabledPlugins` saying false. A registry that isn't JSON is unread, whatever the list says.
 */
async function plugins(home: string, claude: string, env: NodeJS.ProcessEnv, cwd?: string): Promise<Plugin[] | string> {
  // Claude Code lists nothing from a registry it can't parse, so what it would load from there can't be known.
  const registry = join(home, 'plugins', 'installed_plugins.json');
  let installed: Obj = {};
  if (existsSync(registry)) {
    try {
      const parsed = JSON.parse(readFileSync(registry, 'utf8')) as unknown;
      installed = isObj(parsed) && isObj(parsed.plugins) ? parsed.plugins : {};
    } catch (error) {
      return `${registry} couldn't be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const ran = await run(claude, ['plugin', 'list', '--json'], { ...env, CLAUDE_CONFIG_DIR: home }, cwd);
  try {
    const list = JSON.parse(ran?.code === 0 ? ran.out : '') as unknown;
    if (Array.isArray(list)) return list.filter((p): p is Obj => isObj(p) && p.enabled !== false && typeof p.id === 'string').flatMap((p) => {
      const folder = typeof p.readFromFolder === 'string' ? p.readFromFolder : p.installPath;
      return typeof folder === 'string' ? [{ plugin: String(p.id), folder }] : [];
    });
  } catch { /* an older claude: read its files */ }
  let enabled: Obj = {};
  try {
    const settings = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as unknown;
    if (isObj(settings) && isObj(settings.enabledPlugins)) enabled = settings.enabledPlugins;
  } catch { /* no settings: every installed plugin counts as loaded */ }
  const found: Plugin[] = [];
  for (const [plugin, entries] of Object.entries(installed)) {
    const entry = Array.isArray(entries) ? entries.find(isObj) : undefined;
    if (typeof entry?.installPath !== 'string') return `${registry} names no folder for ${plugin}`;
    found.push({ plugin, folder: entry.installPath });
  }
  const skills = join(home, 'skills');
  for (const name of existsSync(skills) ? readdirSync(skills) : []) {
    if (existsSync(join(skills, name, '.claude-plugin', 'plugin.json'))) found.push({ plugin: `${name}@skills-dir`, folder: join(skills, name) });
  }
  // A plugin is left out only when the settings turn it off, so one the reader can't place is still read.
  return found.filter((p) => enabled[p.plugin] !== false);
}

/**
 * The mods the home loads, and those of the `dirs` a session was started with (`--plugin-dir`): each plugin read by
 * `claude plugin validate` on its folder, never loaded. A home whose plugins can't be listed, a claude that can't be
 * run, or a plugin validate fails on leaves the home unread; a plugin with no hooks module handles no event.
 */
export async function homeMods(home: string, claude: string | undefined, env: NodeJS.ProcessEnv, o: { cwd?: string; dirs?: string[] } = {}): Promise<HomeMods> {
  if (!claude) return { home, unread: 'no claude on PATH to list and read the plugins with' };
  const found = await plugins(home, claude, env, o.cwd);
  if (typeof found === 'string') return { home, unread: found };
  const all = [...found, ...(o.dirs ?? []).map((folder) => ({ plugin: `${basename(folder)}@plugin-dir`, folder }))];
  const facts = modsFacts();
  const mods: Mod[] = [];
  for (const { plugin, folder } of all) {
    const ran = await run(claude, [...facts.validate.args, folder], { ...env, CLAUDE_CONFIG_DIR: home });
    if (!ran || ran.code !== 0) return { home, unread: `claude ${facts.validate.args.join(' ')} couldn't read ${plugin} (exit ${ran?.code ?? 'none'}): ${(ran?.err || ran?.out || '').trim().slice(0, 200)}` };
    const hooks = listed(ran.out, facts.validate.hooks);
    const calls = listed(ran.out, facts.validate.calls);
    const name = listed(ran.out, 'name:')[0] ?? plugin.split('@')[0]!;
    mods.push({ plugin, name, hooks, calls, overrides: hooks.includes(facts.overrides.event), prompts: calls.some((c) => facts.promptCalls.includes(c)) });
  }
  return { home, mods };
}
/** The `--plugin-dir` folders a Claude Code command line names. */
export const pluginDirs = (args: string): string[] => [...args.matchAll(/(?:^|\s)--plugin-dir[\s=](\S+)/g)].map((m) => m[1]!);

/** What a mod can override, in words: approve a call past a PreToolUse deny, submit prompts, or nothing. */
export function overrideWords(mod: Mod, facts: ModsFacts = modsFacts()): string | undefined {
  const can = [
    ...(mod.overrides ? [`handles ${facts.overrides.event}, so it can approve a call DeepBuild's guard denied at ${facts.overrides.past}`] : []),
    ...(mod.prompts ? [`submits prompts (${mod.calls.filter((c) => facts.promptCalls.includes(c)).join(', ')}), which no person typed`] : []),
  ];
  return can.length ? can.join(', and ') : undefined;
}
