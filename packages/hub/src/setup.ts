// `deep setup` (#18, #19): Claude Code's hook entries merged into your user settings beside yours, its status line
// forwarder, DeepBuild's MCP server and skill at user scope, the fast safety rules, your login shell's PATH and your ask
// settings, and the hub started through its login service; `deep setup --undo` takes all of it out again, once the OS
// confirms you. Each agent file is planned first, parsed strictly, and written through its link (agent-files.ts);
// its bytes before the first write are kept, so undo puts back exactly what you had. `deep doctor`'s timing-relation
// items live here too. The background entry that wakes an idle session with an answer is deep-hook's waiter (#25),
// small enough to wait the longest ask deadline; `deep waiter` is only the planted Node waiter that polls.
// #1100: it runs the rows of the one list of steps (setup-steps.ts) the app's first-launch screen names before the click,
// and records each step it took as a `setup.step` event.
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readFacts } from '@deepbuild/adapters';
import { draftAskSettings } from '@deepbuild/asks';
import { keepOriginal, noteWritten, putBack, saveRecord, setupRecord, strictObject, target, writeThrough } from './agent-files.js';
import { confirmed } from './authority.js';
import { Confirmer } from './confirm.js';
import { claudeCommand, claudeSettings, installedRecord, longestDeadline, ourGroups, relations, withHooks, withoutOurs, writeJson } from './claude-settings.js';
import { codexConfig, codexHooks, codexRelations, fixedHook, forgetEntries, recordedHome, recordedServer, recordEntries, withEntries, withoutEntries, withoutServer, withServer } from './codex-settings.js';
import { call } from './client.js';
import { deepHook, hubAddress, installedPrograms, installedRoot, lastingNode, rootOf } from './paths.js';
import { activePlant as plant } from './plant.js';
import { removeService, startHub, stopIfRunning } from './service.js';
import { changes, doing, key, onPath, planned as plannedRows, saying, setUpLine, type Row } from './setup-steps.js';
import { Devices } from './trusted.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** Claude Code's user-scope state, where its user MCP servers live. */
const claudeJson = (): string => join(homedir(), '.claude.json');
const skillDir = (): string => join(dirname(claudeSettings()), 'skills', 'deepbuild');
const q = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;
// #1002: setup's first step writes the second, and keeps in it why it stopped and the fix; its last step writes the
// first, with its version, and takes the second away. The app and the first `deep` command offer Set up while setup
// hasn't finished: no folder yet, or one a setup started in and didn't finish. A folder with neither file is a home set
// up before these records, or a hub run on its own, and is left as it is.
const finishedFile = (root: string) => join(root, 'setup-finished.json');
const stoppedFile = (root: string) => join(root, 'setup-stopped.json');
const unfinished = (root: string) => !existsSync(finishedFile(root)) && (!existsSync(root) || existsSync(stoppedFile(root)));


/** `deep setup [--undo]`. `cli` is the deep command's script. */
export async function setupCommand(cli: string, args: readonly string[] = []): Promise<number> {
  if (args.length === 1 && args[0] === '--undo') return undo();
  if (args.length) {
    process.stderr.write('Usage: deep setup [--undo]\n');
    return 2;
  }
  return (await install(cli)).code;
}

/**
 * The first `deep` command (#326, #1100): in a home where setup hasn't finished (#1002), `deep setup`'s steps run
 * without asking. Every line it says goes to stderr, so the command's own output stays on stdout: the one line, once
 * setup changed an agent's settings, whatever its exit code, then any step that failed after that. 0 when nothing was
 * needed or an agent's settings changed, so the command you typed still runs; else setup's exit code.
 */
export async function setUpFirst(cli: string): Promise<number> {
  if (!unfinished(installedRoot())) return 0;
  const said = await install(cli, true);
  // The planted wrong program writes the line to stdout, where the command's own output goes.
  if (said.line) (plant() === 'set-up-line-to-stdout' ? process.stdout : process.stderr).write(`${said.line}\n`);
  for (const text of said.later) process.stderr.write(text);
  return said.line ? 0 : said.code;
}

/** What setup ended with: its exit code; its one line, once an agent's settings changed; and, when quiet, what it held back to say after the line. */
interface Said { code: number; line: string | undefined; later: string[] }

/**
 * Runs the rows of the one list (setup-steps.ts) that apply here. Exit 0 once everything is in place; 1 when a file of
 * yours refused it, with nothing written; 3 when the hub didn't start; 4 when the wiki wasn't built. `quiet` keeps
 * stdout empty and holds every failure after the hooks for the caller to say after its one line.
 */
async function install(cli: string, quiet = false): Promise<Said> {
  const root = installedRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  rmSync(finishedFile(root), { force: true });
  const done: Row[] = [];
  const later: string[] = [];
  const tell = (text: string) => { if (quiet) later.push(text); else process.stderr.write(text); };
  let blocking = 0;
  const said = (code: number, hub = false): Said => ({ code, line: done.some(changes) ? setUpLine(done, blocking, hub) : undefined, later });
  // Kept until the last step, so a setup that stops anywhere, even killed, is offered again.
  stopped(root, 0, 'it was interrupted before it finished', 'Set up again.', done);
  const deepbuild = version(cli);
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
      return said(stopped(root, 1, `${file} ${read.refused}`, 'Fix the file, then Set up again.', done));
    }
    planned.set(file, read.value);
  }
  const rows = plannedRows();
  const record = setupRecord(root);
  try {
    await draftAskSettings(root);
    recordLoginPath(root);
    blocking = installRules(root);
    await enrollConfirm(root, tell);
    // An installed version's fixed programs, which every update keeps (#41); a checkout's own build otherwise.
    const hook = installedPrograms(root)?.hook ?? await builtHook();
    // For an agent whose hooks run in its own process, which no settings entry names deep-hook to: the pi package.
    editConfig(root, (c) => { c.hook = { binary: hook }; });
    // The waiter waits as long as your longest ask deadline, so an answer in time can still wake the session.
    const longest = longestDeadline(root) ?? 0;
    const waiter = plant() === 'waiter-polls' ? `'${process.execPath}' '${cli}' waiter` : claudeCommand(hook, 'waiter');
    const groups = ourGroups(hook, waiter, Math.max(600, Math.ceil(longest / 1000)));
    for (const file of [settingsFile, userFile]) keepOriginal(root, record, file);
    saveRecord(root, record);
    // Each row's step. Codex's or paseo's failing leaves that agent out, and Claude Code's goes on.
    const steps: Record<string, () => Promise<void> | void> = {
      'hooks:claude-code': () => {
        const settings = withStatusLine(root, withHooks(root, planned.get(settingsFile)!, groups), `${q(hook)} statusline`);
        writeJson(settingsFile, settings);
        noteWritten(record, settingsFile);
        // The planted wrong program writes its entries into the repo it runs in too.
        if (plant() === 'setup-writes-project-settings') writeJson(join(process.cwd(), '.claude', 'settings.json'), withHooks(root, {}, groups));
        const user = planned.get(userFile)!;
        const servers = isObj(user.mcpServers) ? user.mcpServers : {};
        // deep-actions is the second server entry (#363): the plug-ins' actions, apart from the deep_* tools. deep-hook
        // serves it, so a session runs one Node server, not two (#824's memory per session).
        writeJson(userFile, { ...user, mcpServers: { ...servers, deepbuild: { type: 'stdio', ...mcpServer(root, cli) }, 'deep-actions': { type: 'stdio', command: hook, args: ['mcp', 'actions'] } } });
        noteWritten(record, userFile);
        const skill = skillDir();
        if (!existsSync(skill) || record.created.includes(skill)) {
          cpSync(join(REPO, 'skills', 'deepbuild'), skill, { recursive: true });
          if (!record.created.includes(skill)) record.created.push(skill);
        }
      },
      'hooks:codex': () => installCodex(root, record, cli, hook),
      'plugin:paseo': () => installPaseo(root, record, onPath('paseo')!, cli, quiet),
    };
    const left: Record<string, string> = { 'hooks:codex': 'Fix the file and run deep setup again.', 'plugin:paseo': "Run deep setup again once paseo's daemon runs." };
    for (const row of rows.filter((r) => r.step !== 'history')) {
      const step = steps[key(row)];
      if (!step) throw Error(`the list of steps names ${key(row)}, which setup has no step for`);
      try {
        await saying(doing(row), step);
      } catch (e) {
        if (!left[key(row)]) throw e;
        tell(`${row.name} was left out of setup: ${e instanceof Error ? e.message : String(e)}. ${left[key(row)]}\n`);
        continue;
      }
      done.push(row);
      saveRecord(root, record);
      stopped(root, 0, 'it was interrupted before it finished', 'Set up again.', done);
    }
  } catch (error) {
    saveRecord(root, record);
    const why = error instanceof Error ? error.message : String(error);
    tell(`deep setup: ${why}\n`);
    return said(stopped(root, 1, why, 'Set up again once that is fixed.', done));
  }
  if (!quiet) console.log(`Its hooks and status line forwarder are in ${settingsFile}, beside yours; its MCP server in ${userFile}; its skill at ${skillDir()}; its safety rules at ${join(root, 'rules.json')}.`);
  // Only a relation that doesn't hold needs you; deep doctor lists them all.
  if (!quiet) for (const r of relations(root)) if (!r.holds) console.log(`BROKEN ${r.text}`);
  const started = await startHub({ cli });
  if (started !== 0) {
    tell('deep setup: the hub didn\'t start through its login service; deep doctor names what is missing.\n');
    return said(stopped(root, 3, 'the hub didn\'t start through its login service', 'Run deep doctor, which names what is missing, then Set up again.', done));
  }
  // One wiki build reads every agent's history: its rows are done together.
  const history = rows.filter((r) => r.step === 'history');
  const code = history.length ? await saying(doing(history[0]!), () => readHistory(quiet, tell)) : 0;
  if (code === 0) done.push(...history);
  await report(done, tell);
  writeFileSync(finishedFile(root), `${JSON.stringify({ version: deepbuild, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  rmSync(stoppedFile(root), { force: true });
  const end = said(code, true);
  // Its last line, which the app's Set up shows as its notice (#1455, #1100).
  if (!quiet && end.line) console.log(end.line);
  return end;
}
/** What setup says when building deep-hook failed: with no cargo at all, how to get one. */
export function buildFailure(error: unknown): string {
  if ((error as { code?: unknown } | null)?.code === 'ENOENT') return "deep-hook isn't built and cargo isn't installed: install Rust with rustup (https://rustup.rs), then run cargo build --locked -p deep-hook in the checkout, or npm run build";
  return error instanceof Error ? error.message : String(error);
}
/** The record's `setup.step` events (#1100): one per step setup took, through the hub, which appends them. */
async function report(done: readonly Row[], tell: (text: string) => void): Promise<void> {
  try {
    const reply = await call(hubAddress().path, readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), 'setup.report', { steps: done.map((r) => ({ step: r.step, agent: r.agent ?? null })) });
    if ('error' in reply) tell(`deep setup: the record didn't keep setup's steps: ${reply.error.remediation}\n`);
  } catch (error) {
    tell(`deep setup: the record didn't keep setup's steps: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
/**
 * Keeps why setup stopped, and its fix, for the app to show beside Set up, with the rows it has done so far, which the
 * app marks done as each ends (#1100); answers `code`.
 */
function stopped(root: string, code: number, reason: string, fix: string, done: readonly Row[]): number {
  writeFileSync(stoppedFile(root), `${JSON.stringify({ reason, fix, at: new Date().toISOString(), done: done.map(key) })}\n`, { mode: 0o600 });
  return code;
}
/** DeepBuild's version, as `deep --version` says it: the CLI's package, beside its script's folder. */
const version = (cli: string): string => (JSON.parse(readFileSync(join(dirname(cli), '..', 'package.json'), 'utf8')) as { version: string }).version;
/**
 * Once the hub is up, it reads your Claude Code and Codex history into the wiki (#356): pattern matching written first,
 * then each reading job finished or waiting on the plan reserve. Each wiki page that changed gets a line, unless quiet.
 * The reading is the hub's; the agent's own session and settings are already in place, so a failure here is told and
 * setup still stands: 4 only when the hub couldn't be asked.
 */
async function readHistory(quiet: boolean, tell: (text: string) => void): Promise<number> {
  try {
    const root = installedRoot();
    const reply = await call(hubAddress().path, readFileSync(rootOf(root).token, 'utf8').trim(), 'wiki.build', {});
    if ('error' in reply) {
      tell(`deep setup: the wiki wasn't built: ${reply.error.remediation}\n`);
      return 4;
    }
    if (!quiet) for (const page of (reply.result.changed as string[] | undefined) ?? []) console.log(`Wiki: ${page}`);
    return 0;
  } catch (error) {
    tell(`deep setup: the wiki wasn't built: ${error instanceof Error ? error.message : String(error)}\n`);
    return 4;
  }
}
/**
 * deep-hook as this checkout built it; from a checkout with none, or one built before it served deep-actions (#824),
 * setup builds it once (a release ships it built, #41).
 */
/** DeepBuild's MCP server's program: the installed version's fixed deep, or Node with this checkout's CLI. */
function mcpServer(root: string, cli: string): { command: string; args: string[] } {
  const installed = installedPrograms(root);
  return installed ? { command: installed.deep, args: ['mcp'] } : { command: lastingNode(), args: [cli, 'mcp'] };
}
async function builtHook(): Promise<string> {
  // Whether a build lists deep-actions; undefined when its --help can't be read, which is no reason to rebuild.
  const serves = (hook: string) => { try { return execFileSync(hook, ['--help'], { encoding: 'utf8', timeout: 10_000 }).includes('mcp actions'); } catch { return undefined; } };
  try {
    const hook = deepHook();
    if (serves(hook) !== false) return hook;
  } catch { /* none built */ }
  // Cargo and rustup live in your account's home, whatever HOME a script runs setup with.
  const home = userInfo().homedir;
  const env = { ...process.env, CARGO_HOME: process.env.CARGO_HOME ?? join(home, '.cargo'), RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(home, '.rustup') };
  // Awaited, so a build past 2 s can say what it's doing (#1100).
  const build = () => promisify(execFile)('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, env, timeout: 900_000, maxBuffer: 1 << 26 });
  try { await saying('Building deep-hook, the program DeepBuild\'s hooks run, once', build); } catch (error) { throw Error(buildFailure(error)); }
  // The build just made, even where an older release build is newer on disk.
  const built = join(REPO, 'target', 'debug', 'deep-hook');
  if (serves(built) === false) throw Error(`${built} doesn't serve deep-actions after cargo build -p deep-hook`);
  return built;
}
function lenient(text: string): { value: Obj } | { refused: string } {
  try {
    const value: unknown = JSON.parse(text);
    return isObj(value) ? { value } : { refused: 'holds no JSON object' };
  } catch (error) {
    return { refused: `isn't JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}
/**
 * Codex's entries after yours in its hooks.json, and DeepBuild's MCP server in its config.toml (#39): each written only
 * when it isn't there yet, through a link if the file is one, so a second setup leaves the bytes and Codex's trust alone.
 */
function installCodex(root: string, record: ReturnType<typeof setupRecord>, cli: string, built: string): void {
  const hook = fixedHook(root, built);
  const read = (file: string) => { const real = target(file); return existsSync(real) ? readFileSync(real, 'utf8') : ''; };
  // Both are read before either is written: one that won't parse refuses the pair.
  const [hooksFile, configFile] = [codexHooks(), codexConfig()];
  const [hooksText, configText] = [read(hooksFile), read(configFile)];
  const server = mcpServer(root, cli);
  const [hooks, config] = [withEntries(hooksText, hook), withServer(configText, server)];
  recordEntries(root, hook, server);
  for (const [file, before, after] of [[hooksFile, hooksText, hooks], [configFile, configText, config]] as const) {
    if (after === before) continue;
    keepOriginal(root, record, file);
    writeThrough(file, after);
    noteWritten(record, file);
  }
}

/** Your status line runs behind ours: its command kept as `statusline.yours` in config.json, which deep-hook runs. */
function withStatusLine(root: string, settings: Obj, ours: string): Obj {
  const line = isObj(settings.statusLine) ? settings.statusLine : undefined;
  if (line?.command === ours) return settings;
  // An earlier setup's forwarder, from where deep-hook was then: yours stays as that setup kept it.
  if (typeof line?.command === 'string' && /deep-hook\S*'? statusline$/.test(line.command)) return { ...settings, statusLine: { ...line, command: ours } };
  editConfig(root, (c) => {
    const statusline = isObj(c.statusline) ? c.statusline : {};
    if (typeof line?.command === 'string') c.statusline = { ...statusline, yours: line.command };
    else { delete statusline.yours; c.statusline = statusline; }
  });
  return { ...settings, statusLine: { ...(line ?? {}), type: 'command', command: ours } };
}
/** Edits DeepBuild's own config.json under `root`. */
export function editConfig(root: string, edit: (config: Obj) => void): void {
  const file = join(root, 'config.json');
  let config: Obj = {};
  try { config = JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { /* draftAskSettings wrote it */ }
  edit(config);
  writeJson(file, config);
}
/**
 * deep-confirm's key (#880), made once: the hub then counts the OS confirming you only as a signature by it, from the
 * helper recorded with it. A key already recorded stays, since setting one up again is the trusted path's alone. Where
 * a test file stands in for the OS confirming you, or off macOS, there is nothing to set up.
 */
async function enrollConfirm(root: string, tell: (text: string) => void): Promise<void> {
  if (process.platform !== 'darwin' || process.env.DEEP_HUB_TEST_CONFIRM) return;
  const paths = rootOf(root);
  const devices = new Devices(paths.devices);
  if (devices.enclave()) return;
  const why = await new Confirmer({ devices, key: paths.confirmKey }).enroll(Date.now());
  if (why) tell(`deep setup: deep-confirm's key wasn't set up (${why}), so no answer from the CLI counts until it is; run deep setup again.\n`);
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
/**
 * The fast safety rules, which apply from the start: the shipped guard entries, added beside any of yours. Answers how
 * many of the shipped entries block, which the one line says (#1100).
 */
function installRules(root: string): number {
  const file = join(root, 'rules.json');
  const shipped = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-hook', 'default-rules.json'), 'utf8')) as { v: number; entries: Obj };
  const blocking = Object.values(shipped.entries).filter((entry) => isObj(entry) && entry.mode === 'block').length;
  if (!existsSync(file)) {
    writeJson(file, shipped);
    return blocking;
  }
  let current: unknown;
  try { current = JSON.parse(readFileSync(file, 'utf8')); } catch { return blocking; /* unreadable: deep-hook names it */ }
  if (!isObj(current) || !isObj(current.entries)) return blocking;
  const missing = Object.keys(shipped.entries).filter((name) => !(name in (current.entries as Obj)));
  if (missing.length) writeJson(file, { ...current, entries: { ...current.entries, ...Object.fromEntries(missing.map((n) => [n, shipped.entries[n]])) } });
  return blocking;
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
    delete servers['deep-actions'];
    return { ...v, mcpServers: servers };
  });
  // The planted wrong program takes our entries out and writes the JSON again, whatever you had.
  const notes = [
    plant() === 'undo-reserializes' ? hooksOut() : putBack(root, record, settingsFile, hooksOut),
    putBack(root, record, userFile, mcpOut),
    ...removeCodex(root, record),
    undoPaseo(root, record),
  ].filter((n): n is string => n !== undefined);
  // Every other agent file an Agents page sync wrote (#148): its original bytes back where you haven't edited it since.
  const handled = new Set([settingsFile, userFile, join(homedir(), '.paseo', 'config.json')]);
  for (const file of Object.keys(record.files).filter((f) => !handled.has(f))) {
    const note = putBack(root, record, file, () => `you edited ${file} since DeepBuild wrote it, so undo left it as it is; take DeepBuild's entries out by hand`);
    if (note) notes.push(note);
  }
  for (const dir of record.created) rmSync(dir, { recursive: true, force: true });
  rmSync(installedRecord(root), { force: true });
  rmSync(join(root, 'setup.json'), { force: true });
  rmSync(finishedFile(root), { force: true });
  rmSync(stoppedFile(root), { force: true });
  for (const note of notes) console.log(note);
  console.log(`DeepBuild is removed from Claude Code: its hooks, status line forwarder, MCP server, skill and the hub's login service are gone, and your settings are as they were. Your record, evidence and wiki stay in ${root}; deleting that folder is yours to do.`);
  return 0;
}

/**
 * DeepBuild out of Codex alone, as `deep setup --undo` takes it out (#1998): each Codex file setup wrote gets its bytes
 * from before back where you haven't edited it since, and only our parts taken out where you have; then what setup
 * kept for Codex goes, so nothing watches or restores its entries. The notes say what was left as it is.
 */
export function removeCodex(root: string, record = setupRecord(root)): string[] {
  // Codex's files where setup wrote them, and the server as it wrote it, whatever this environment says today.
  const [hooks, config, server] = [join(recordedHome(root), 'hooks.json'), join(recordedHome(root), 'config.toml'), recordedServer(root)];
  const notes = [
    putBack(root, record, hooks, () => editedCodex(hooks, (text) => withoutEntries(root, text), "only DeepBuild's entries")),
    putBack(root, record, config, () => editedCodex(config, (text) => (server ? withoutServer(text, server) : text), "DeepBuild's MCP server if it was as setup wrote it")),
  ].filter((n): n is string => n !== undefined);
  delete record.files[hooks];
  delete record.files[config];
  if (existsSync(join(root, 'setup.json'))) saveRecord(root, record);
  forgetEntries(root);
  return notes;
}

const paseoConfig = (): string => join(homedir(), '.paseo', 'config.json');
/**
 * DeepBuild's paseo plugin (#55), added through paseo's own manager at the one version its facts pin, said before
 * anything is written, except on the first `deep` command, whose one line names paseo (#1100). paseo rewrites its
 * config.json as it installs, so the bytes before are kept for undo. Awaited, so a slow install says what it's doing.
 */
async function installPaseo(root: string, record: ReturnType<typeof setupRecord>, paseo: string, cli: string, quiet: boolean): Promise<void> {
  const facts = readFacts<{ install: { source: string } }>('paseo.facts.json');
  const source = facts.install.source;
  const run = promisify(execFile);
  const { stdout: listed } = await run(paseo, ['plugin', 'ls', '--json'], { encoding: 'utf8', timeout: 60_000 });
  if (listed.includes('"deepbuild"')) return;
  if (!quiet) console.log(`paseo: + plugin deepbuild from ${source}, through paseo plugin install; ${paseoConfig()} is kept as it is now, and deep setup --undo puts it back.`);
  keepOriginal(root, record, paseoConfig());
  saveRecord(root, record);
  // The plugin runs DeepBuild's MCP server with this deep, whatever PATH paseo's agents get: your deep command, or this CLI.
  const deep = onPath('deep');
  editConfig(root, (c) => { c.paseo = { deep: deep ? [deep] : [process.execPath, cli], plugin: 'deepbuild' }; });
  await run(paseo, ['plugin', 'install', source], { timeout: 300_000 });
  noteWritten(record, paseoConfig());
}
/** The plugin taken out through paseo's own manager, and paseo's config.json put back as it was before setup. */
function undoPaseo(root: string, record: ReturnType<typeof setupRecord>): string | undefined {
  const file = paseoConfig();
  const kept = record.files[file];
  if (!kept) return undefined;
  const paseo = onPath('paseo');
  let note: string | undefined;
  try {
    if (paseo) execFileSync(paseo, ['plugin', 'remove', 'deepbuild'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  } catch (e) {
    note = `paseo didn't remove its plugin deepbuild (${e instanceof Error ? e.message.split('\n')[0] : String(e)}); run paseo plugin remove deepbuild once its daemon runs`;
  }
  if (kept.before === null) rmSync(target(file), { force: true });
  else writeThrough(file, readFileSync(join(root, 'originals', kept.before)));
  return note;
}

/** A Codex file you edited since setup: ours taken out, or, one that's gone or no longer reads, left as it is and said. */
function editedCodex(file: string, without: (text: string) => string, what: string): string {
  try {
    writeThrough(file, without(readFileSync(target(file), 'utf8')));
    return `you edited ${file} since setup, so undo took out ${what}`;
  } catch (e) {
    return `undo left ${file} as it is: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** deep doctor's item for each timing relation our entries keep, with both values: broken is a failed item. */
export function relationItems(): { item: string; agent: string; code: string; level: 'ok' | 'fail'; evidence: string; fix: string }[] {
  const codex = codexRelations(installedRoot()).map((r) => ({
    item: `timing.codex_${r.name.replaceAll(' ', '_')}`,
    agent: 'codex',
    code: r.holds ? 'healthy' : 'timing_relation_broken',
    level: r.holds ? 'ok' as const : 'fail' as const,
    evidence: r.text,
    fix: r.holds ? 'Nothing to do.' : `Put the value back as the reading says; setup never changes it, since Codex asks for trust again when an entry's timeout changes.`,
  }));
  return [...codex, ...relations(installedRoot()).map((r) => ({
    item: `timing.${r.name.replaceAll(' ', '_')}`,
    agent: 'claude-code',
    code: r.holds ? 'healthy' : 'timing_relation_broken',
    level: r.holds ? 'ok' as const : 'fail' as const,
    evidence: r.text,
    fix: r.holds ? 'Nothing to do.' : `Run deep setup, which writes the entry's timeout again, or raise it in ${claudeSettings()}.`,
  }))];
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
