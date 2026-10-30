// `deep setup` (#18, #19): Claude Code's hook entries merged into your user settings beside yours, its status line
// forwarder, DeepBuild's MCP server and skill at user scope, the fast safety rules, your login shell's PATH and your ask
// settings, and the hub started through its login service; `deep setup --undo` takes all of it out again, once the OS
// confirms you. Each agent file is planned first, parsed strictly, and written through its link (agent-files.ts);
// its bytes before the first write are kept, so undo puts back exactly what you had. `deep doctor`'s timing-relation
// items live here too. The background entry that wakes an idle session with an answer is deep-hook's waiter (#25),
// small enough to wait the longest ask deadline; `deep waiter` is only the planted Node waiter that polls.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftAskSettings } from '@deepbuild/asks';
import { keepOriginal, noteWritten, putBack, saveRecord, setupRecord, strictObject, target } from './agent-files.js';
import { confirmed } from './authority.js';
import { claudeSettings, installedRecord, longestDeadline, ourGroups, relations, withHooks, withoutOurs, writeJson } from './claude-settings.js';
import { call } from './client.js';
import { deepHook, hubAddress, installedRoot, rootOf } from './paths.js';
import { activePlant as plant } from './plant.js';
import { removeService, startHub, stopIfRunning } from './service.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** Claude Code's user-scope state, where its user MCP servers live. */
const claudeJson = (): string => join(homedir(), '.claude.json');
const skillDir = (): string => join(dirname(claudeSettings()), 'skills', 'deepbuild');
const q = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;


/** `deep setup [--undo]`. `cli` is the deep command's script. */
export async function setupCommand(cli: string, args: readonly string[] = []): Promise<number> {
  if (args.length === 1 && args[0] === '--undo') return undo();
  if (args.length) {
    process.stderr.write('Usage: deep setup [--undo]\n');
    return 2;
  }
  return install(cli);
}

/** What the Set up click and the first `deep` command say they did (#326), in one line. */
export const SET_UP_LINE = 'DeepBuild added its hooks in watch-only mode, so no stop is held and no verdict blocks until you approve a repo\'s checks, and started the hub at login; deep setup --undo removes it all.';

/**
 * The first `deep` command (#326): in a home with nothing of DeepBuild in it, `deep setup`'s steps run without asking,
 * and the one line goes to stderr, so the command's own output stays on stdout. 0 when nothing was needed or all of
 * it is in place; else setup's exit code.
 */
export async function setUpFirst(cli: string): Promise<number> {
  if (existsSync(installedRoot())) return 0;
  const code = await install(cli, true);
  if (code === 0) process.stderr.write(`${SET_UP_LINE}\n`);
  return code;
}

/**
 * Exit 0 once everything is in place; 1 when a file of yours refused it, with nothing written; 3 when the hub didn't
 * start. `quiet` leaves the summary to the caller's one line.
 */
async function install(cli: string, quiet = false): Promise<number> {
  const root = installedRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const settingsFile = claudeSettings();
  const userFile = claudeJson();
  // Every file is planned before any is written: one that won't parse refuses the whole setup.
  const planned = new Map<string, Obj>();
  for (const file of [settingsFile, userFile]) {
    const real = target(file);
    if (!existsSync(real)) {
      planned.set(file, {});
      continue;
    }
    const text = readFileSync(real, 'utf8');
    const read = plant() === 'setup-last-duplicate-wins' ? lenient(text) : strictObject(text);
    if ('refused' in read) {
      const copy = join(root, 'originals', createHash('sha256').update(text).digest('hex'));
      mkdirSync(dirname(copy), { recursive: true, mode: 0o700 });
      writeFileSync(copy, text, { mode: 0o600 });
      process.stderr.write(`deep setup: ${file} ${read.refused}, so setup left it byte-for-byte as it was and wrote nothing; a copy is at ${copy}. Fix it, then run deep setup again.\n`);
      return 1;
    }
    planned.set(file, read.value);
  }
  const record = setupRecord(root);
  try {
    await draftAskSettings(root);
    recordLoginPath(root);
    installRules(root);
    const hook = builtHook();
    // The waiter waits as long as your longest ask deadline, so an answer in time can still wake the session.
    const longest = longestDeadline(root) ?? 0;
    const waiter = plant() === 'waiter-polls' ? `'${process.execPath}' '${cli}' waiter` : `${q(hook)} claude-code waiter`;
    const groups = ourGroups(hook, waiter, Math.max(600, Math.ceil(longest / 1000)));
    for (const file of [settingsFile, userFile]) keepOriginal(root, record, file);
    saveRecord(root, record);
    const settings = withStatusLine(root, withHooks(root, planned.get(settingsFile)!, groups), `${q(hook)} statusline`);
    writeJson(settingsFile, settings);
    noteWritten(record, settingsFile);
    // The planted wrong program writes its entries into the repo it runs in too.
    if (plant() === 'setup-writes-project-settings') writeJson(join(process.cwd(), '.claude', 'settings.json'), withHooks(root, {}, groups));
    const user = planned.get(userFile)!;
    const servers = isObj(user.mcpServers) ? user.mcpServers : {};
    writeJson(userFile, { ...user, mcpServers: { ...servers, deepbuild: { type: 'stdio', command: process.execPath, args: [cli, 'mcp'] } } });
    noteWritten(record, userFile);
    const skill = skillDir();
    if (!existsSync(skill) || record.created.includes(skill)) {
      cpSync(join(REPO, 'skills', 'deepbuild'), skill, { recursive: true });
      if (!record.created.includes(skill)) record.created.push(skill);
    }
    saveRecord(root, record);
  } catch (error) {
    saveRecord(root, record);
    process.stderr.write(`deep setup: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (!quiet) console.log(`DeepBuild added its hooks and status line forwarder to ${settingsFile}, beside yours; its MCP server to ${userFile}; its skill at ${skillDir()}; its safety rules at ${join(root, 'rules.json')}. Its gates are watch-only until you approve a repo's checks. deep setup --undo removes it all.`);
  if (!quiet) for (const r of relations(root)) console.log(`${r.holds ? 'OK' : 'BROKEN'} ${r.text}`);
  const started = await startHub({ cli });
  if (started !== 0) {
    process.stderr.write('deep setup: the hub didn\'t start through its login service; deep doctor names what is missing.\n');
    return 3;
  }
  return readHistory(quiet);
}
/**
 * Once the hub is up, it reads your Claude Code and Codex history into the wiki (#356): pattern matching written first,
 * then each reading job finished or waiting on the plan reserve. Each wiki page that changed gets a line, unless quiet.
 * The reading is the hub's; the agent's own session and settings are already in place, so a failure here is told and
 * setup still stands: 4 only when the hub couldn't be asked.
 */
async function readHistory(quiet: boolean): Promise<number> {
  try {
    const root = installedRoot();
    const reply = await call(hubAddress().path, readFileSync(rootOf(root).token, 'utf8').trim(), 'wiki.build', {});
    if ('error' in reply) {
      process.stderr.write(`deep setup: the wiki wasn't built: ${reply.error.remediation}\n`);
      return 4;
    }
    if (!quiet) for (const page of (reply.result.changed as string[] | undefined) ?? []) console.log(`Wiki: ${page}`);
    return 0;
  } catch (error) {
    process.stderr.write(`deep setup: the wiki wasn't built: ${error instanceof Error ? error.message : String(error)}\n`);
    return 4;
  }
}
/** deep-hook as this checkout built it; from a checkout with none, setup builds it once (a release ships it built, #41). */
function builtHook(): string {
  try {
    return deepHook();
  } catch {
    // Cargo and rustup live in your account's home, whatever HOME a script runs setup with.
    const home = userInfo().homedir;
    const env = { ...process.env, CARGO_HOME: process.env.CARGO_HOME ?? join(home, '.cargo'), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(home, '.rustup') };
    execFileSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, env, stdio: 'ignore', timeout: 900_000 });
    return deepHook();
  }
}
function lenient(text: string): { value: Obj } | { refused: string } {
  try {
    const value: unknown = JSON.parse(text);
    return isObj(value) ? { value } : { refused: 'holds no JSON object' };
  } catch (error) {
    return { refused: `isn't JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}
/** Your status line runs behind ours: its command kept as `statusline.yours` in config.json, which deep-hook runs. */
function withStatusLine(root: string, settings: Obj, ours: string): Obj {
  const line = isObj(settings.statusLine) ? settings.statusLine : undefined;
  if (line?.command === ours) return settings;
  editConfig(root, (c) => {
    const statusline = isObj(c.statusline) ? c.statusline : {};
    if (typeof line?.command === 'string') c.statusline = { ...statusline, yours: line.command };
    else { delete statusline.yours; c.statusline = statusline; }
  });
  return { ...settings, statusLine: { ...(line ?? {}), type: 'command', command: ours } };
}
function editConfig(root: string, edit: (config: Obj) => void): void {
  const file = join(root, 'config.json');
  let config: Obj = {};
  try { config = JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { /* draftAskSettings wrote it */ }
  edit(config);
  writeJson(file, config);
}
/** Your login shell's PATH, so the hub, started with a login service's short PATH, runs the same claude and codex. */
function recordLoginPath(root: string): void {
  let path = process.env.PATH ?? '';
  try {
    const shown = execFileSync(process.env.SHELL || '/bin/sh', ['-l', '-c', 'printf %s "$PATH"'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (shown.trim()) path = shown.trim();
  } catch { /* the shell this process runs in */ }
  editConfig(root, (c) => { c.runner = { ...(isObj(c.runner) ? c.runner : {}), login_path: path }; });
}
/** The fast safety rules, which apply from the start: the shipped guard entries, added beside any of yours. */
function installRules(root: string): void {
  const file = join(root, 'rules.json');
  const shipped = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-hook', 'default-rules.json'), 'utf8')) as { v: number; entries: Obj };
  if (!existsSync(file)) return writeJson(file, shipped);
  let current: unknown;
  try { current = JSON.parse(readFileSync(file, 'utf8')); } catch { return; /* unreadable: deep-hook names it */ }
  if (!isObj(current) || !isObj(current.entries)) return;
  const missing = Object.keys(shipped.entries).filter((name) => !(name in (current.entries as Obj)));
  if (missing.length) writeJson(file, { ...current, entries: { ...current.entries, ...Object.fromEntries(missing.map((n) => [n, shipped.entries[n]])) } });
}

/**
 * `deep setup --undo`, once the OS confirms you: the login service and the hub stop first, so no watch puts an entry
 * back; then each file setup wrote gets its original bytes back where you haven't edited it since, and only our parts
 * taken out where you have; the skill goes. ~/.deepbuild stays, with the record, evidence and wiki.
 */
async function undo(): Promise<number> {
  const why = await confirmed('deep setup --undo');
  if (why) {
    process.stderr.write(`${why}\n`);
    return 3;
  }
  const root = installedRoot();
  const record = setupRecord(root);
  if (plant() !== 'undo-keeps-login-service') removeService();
  await stopIfRunning(root);
  const settingsFile = claudeSettings();
  const userFile = claudeJson();
  let yours: string | undefined;
  try {
    const statusline = (JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as Obj).statusline;
    if (isObj(statusline) && typeof statusline.yours === 'string') yours = statusline.yours;
  } catch { /* none */ }
  const edited = (file: string, without: (value: Obj) => Obj) => (): string | undefined => {
    const real = target(file);
    if (!existsSync(real)) return undefined;
    const read = strictObject(readFileSync(real, 'utf8'));
    if ('refused' in read) return `${file} ${read.refused}, so undo left it as it is; take DeepBuild's entries out by hand`;
    writeJson(file, without(read.value));
    return `you edited ${file} since setup, so undo took out only DeepBuild's entries`;
  };
  const hooksOut = edited(settingsFile, (v) => withoutOurs(root, v, yours));
  const mcpOut = edited(userFile, (v) => {
    const servers = isObj(v.mcpServers) ? { ...v.mcpServers } : {};
    delete servers.deepbuild;
    return { ...v, mcpServers: servers };
  });
  // The planted wrong program takes our entries out and writes the JSON again, whatever you had.
  const notes = [
    plant() === 'undo-reserializes' ? hooksOut() : putBack(root, record, settingsFile, hooksOut),
    putBack(root, record, userFile, mcpOut),
  ].filter((n): n is string => n !== undefined);
  for (const dir of record.created) rmSync(dir, { recursive: true, force: true });
  rmSync(installedRecord(root), { force: true });
  rmSync(join(root, 'setup.json'), { force: true });
  for (const note of notes) console.log(note);
  console.log(`DeepBuild is removed from Claude Code: its hooks, status line forwarder, MCP server, skill and the hub's login service are gone, and your settings are as they were. Your record, evidence and wiki stay in ${root}; deleting that folder is yours to do.`);
  return 0;
}

/** deep doctor's item for each timing relation our entries keep, with both values: broken is a failed item. */
export function relationItems(): { item: string; agent: string; code: string; level: 'ok' | 'fail'; evidence: string; fix: string }[] {
  return relations(installedRoot()).map((r) => ({
    item: `timing.${r.name.replaceAll(' ', '_')}`,
    agent: 'claude-code',
    code: r.holds ? 'healthy' : 'timing_relation_broken',
    level: r.holds ? 'ok' as const : 'fail' as const,
    evidence: r.text,
    fix: r.holds ? 'Nothing to do.' : `Run deep setup, which writes the entry's timeout again, or raise it in ${claudeSettings()}.`,
  }));
}

/**
 * `deep waiter`, the planted wrong program waiter-polls (#25): a waiter in Node, as #18's was, that asks the hub for
 * its session's answer every 50 ms instead of being told, and wakes the session with it (exit 2, the answer on stderr).
 */
export async function waiterCommand(): Promise<number> {
  let session = '';
  try { session = String((JSON.parse(readFileSync(0, 'utf8')) as { session_id?: unknown }).session_id ?? ''); } catch { /* no payload */ }
  if (!session) return 0;
  const parent = process.ppid;
  for (;;) {
    try { process.kill(parent, 0); } catch { return 0; }
    try {
      const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
      const reply = await call(hubAddress().path, token, 'session.wait', { session, poll: true });
      if ('result' in reply && typeof reply.result.text === 'string') {
        process.stderr.write(`${reply.result.text}\n`);
        return 2;
      }
    } catch { /* the hub is away: ask again */ }
    await new Promise((done) => setTimeout(done, 50));
  }
}
