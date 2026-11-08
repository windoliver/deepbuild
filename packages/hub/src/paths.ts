// Where a hub keeps its files, and the one setting every client reads the hub's address from.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repos = new Map<string, string | undefined>();
/** The workspaces the record holds, by real path (#67): a project id the core gave, never one a folder's files claim. */
const workspaces = new Map<string, string>();
/** Names a folder as a workspace's, or takes the name back; a folder may have been read before it became one. */
export function nameWorkspace(folder: string, id: string | undefined): void {
  if (id === undefined) workspaces.delete(folder);
  else workspaces.set(folder, id);
  repos.clear();
}
/** The forge repos of the projects people share on this hub (#1337), as `host/owner/name`. */
const shared = new Set<string>();
/** Names the forge repos people share: a clone of one reads as that project, by its forge identity. */
export function shareProjects(forges: Iterable<string>): void {
  shared.clear();
  for (const forge of forges) shared.add(forge);
  repos.clear();
}
/** A shared project's ID, from its forge identity: its name and a digest of `host/owner/name`, so every clone reads as one. */
export const projectIdOf = (forge: string): string => `${basename(forge).replace(/[^0-9A-Za-z]/g, '')}${createHash('sha256').update(forge).digest('hex').slice(0, 8)}`;
/** A remote's URL as `host/owner/name`, lowercase and without `.git`: the same for its HTTPS and SSH spellings. */
export function forgeIdentity(url: string): string | undefined {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?[:/]+(.+?)(?:\.git)?\/*$/i.exec(url.trim());
  if (!m || !m[2]!.includes('/')) return undefined;
  return `${m[1]}/${m[2]}`.toLowerCase();
}
/** The main checkout a folder is in: the folder holding `.git`, a worktree's main checkout for a worktree; undefined outside git. */
function checkoutOf(cwd: string): string | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    const git = join(dir, '.git');
    try {
      if (statSync(git).isDirectory()) return dir;
      // A worktree's .git names its folder under the main checkout's .git/worktrees.
      const gitdir = resolve(dir, /^gitdir:\s*(.+)$/m.exec(readFileSync(git, 'utf8'))?.[1]?.trim() ?? '');
      return /[\\/]worktrees[\\/][^\\/]+$/.test(gitdir) ? dirname(dirname(dirname(gitdir))) : dir;
    } catch { /* not here: look further up */ }
    if (dirname(dir) === dir) return undefined;
  }
}
/** The forge identity of the repo a folder is in, from its `origin` remote; undefined with none. */
export function forgeOf(cwd: string): string | undefined {
  const checkout = checkoutOf(cwd);
  if (!checkout) return undefined;
  let config: string;
  try {
    const git = join(checkout, '.git');
    config = readFileSync(statSync(git).isDirectory() ? join(git, 'config') : join(resolve(checkout, /^gitdir:\s*(.+)$/m.exec(readFileSync(git, 'utf8'))?.[1]?.trim() ?? ''), 'config'), 'utf8');
  } catch {
    return undefined;
  }
  let origin = false;
  for (const line of config.split('\n')) {
    const section = /^\s*\[([^\]]*)\]/.exec(line);
    if (section) origin = /^remote\s+"origin"$/.test(section[1]!.trim());
    const url = origin ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
    if (url) return forgeIdentity(url[1]!);
  }
  return undefined;
}
/**
 * The repo a folder is in, as a decision's scope names it (`repo:<id>`, #23): its main checkout's folder name and a
 * digest of its path, the same from every worktree of it. A clone of a project people share reads as that project, by
 * its forge identity (#1337); one with no remote keeps its path. Undefined outside a git repo. Read once per folder.
 */
export function repoOf(cwd: string): string | undefined {
  if (!cwd) return undefined;
  if (repos.has(cwd)) return repos.get(cwd);
  const found = checkoutOf(cwd);
  let id: string | undefined;
  if (found) {
    let real = found;
    try { real = realpathSync(found); } catch { /* as found */ }
    const forge = shared.size ? forgeOf(found) : undefined;
    id = workspaces.get(real) ?? (forge && shared.has(forge) ? projectIdOf(forge) : undefined) ?? `${basename(real).replace(/[^0-9A-Za-z]/g, '')}${createHash('sha256').update(real).digest('hex').slice(0, 8)}`;
  }
  repos.set(cwd, id);
  return id;
}

/** The installed hub's root: ~/.deepbuild. A dev hub's is the folder given to --root. */
export const installedRoot = (): string => join(homedir(), '.deepbuild');
/**
 * Drops every test's setting on a process that acts on your own record at `root`, by your account's home, which a
 * variable can't move: a service's environment is anyone's to set (`systemctl --user set-environment`), and a planted
 * program or a stand-in for polkit there would count an answer you never gave (#70). A test's hub runs elsewhere.
 */
export function dropTestSettings(root: string): void {
  if (resolve(root) !== join(userInfo().homedir, '.deepbuild')) return;
  for (const name of Object.keys(process.env)) if (/^DEEP_HUB_(TEST_|PLANT$)/.test(name)) delete process.env[name];
}
/** The Node path to write into a file that outlives this run: a login service, an MCP server entry. Homebrew's
 * Cellar path names one version, which the next `brew upgrade` deletes, and every entry naming it then fails to
 * start; its `opt/<formula>` link names the version installed now, so it is written instead, when it runs this Node. */
export function lastingNode(node: string = process.execPath): string {
  const at = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/.exec(node);
  if (!at) return node;
  const opt = join(at[1]!, 'opt', at[2]!, 'bin', 'node');
  try { return realpathSync(opt) === realpathSync(node) ? opt : node; } catch { return node; }
}

export interface Root {
  dir: string;
  socket: string;
  ledger: string;
  evidence: string;
  token: string;
  spool: string;
  lock: string;
  /** The runs the supervisor started and hasn't seen finish durably, so a restart can stop and rerun them. */
  runs: string;
  /** `running` while a hub runs here, `stopped` after a clean stop: a start that finds `running` records a crash. */
  state: string;
  logs: string;
  /** How far the hub has judged each session's transcript, so a restart judges the turns it missed. */
  transcripts: string;
  /** The wiki's pages, which deep_search reads through the index. */
  wiki: string;
  /** The devices you paired, whose signatures answer for you (#34). */
  devices: string;
  /** deep-confirm's key as the Secure Enclave wraps it, usable only by this Mac's enclave and only once you confirm (#880). */
  confirmKey: string;
  /** Present while `deep restore` swaps a backup in, naming its folder: no hub starts until a restore finishes (#572). */
  restoring: string;
}
export function rootOf(dir: string): Root {
  const at = resolve(dir);
  return {
    dir: at,
    socket: join(at, 'hub.sock'),
    ledger: join(at, 'ledger.db'),
    evidence: join(at, 'evidence'),
    token: join(at, 'control.token'),
    spool: join(at, 'spool'),
    lock: join(at, 'hub-lock.sqlite'),
    runs: join(at, 'runs.json'),
    state: join(at, 'hub.state'),
    logs: join(at, 'logs'),
    transcripts: join(at, 'transcripts.json'),
    wiki: join(at, 'wiki'),
    devices: join(at, 'devices.json'),
    confirmKey: join(at, 'confirm.key'),
    restoring: join(at, 'restore.pending'),
  };
}

/**
 * The hub's address: `hub.address` in ~/.deepbuild/config.json, `unix:<absolute path>`; absent, the installed
 * hub's socket. deep-hook, `deep mcp`, the app and the CLI all read this one setting, and none assumes the hub
 * is on this machine: a forwarded socket named here works for each. A worktree that `deep hub use --root` sent to a
 * dev hub (`hub.use`, `{<worktree>: "unix:<path>"}`) reads that hub from inside it, unless `cwd` is null.
 */
export function hubAddress(cwd: string | null = process.cwd()): { address: string; path: string } {
  const file = join(installedRoot(), 'config.json');
  let configured: unknown;
  let uses: unknown;
  if (existsSync(file)) {
    try {
      const hub = (JSON.parse(readFileSync(file, 'utf8')) as { hub?: { address?: unknown; use?: unknown } }).hub;
      configured = hub?.address;
      uses = hub?.use;
    } catch (error) {
      throw Error(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const used = cwd !== null && typeof uses === 'object' && uses !== null ? worktreeHub(uses as Record<string, unknown>, cwd) : undefined;
  if (used) return { address: used, path: used.slice(5) };
  if (configured === undefined) {
    const path = rootOf(installedRoot()).socket;
    return { address: `unix:${path}`, path };
  }
  if (typeof configured !== 'string' || !configured.startsWith('unix:') || !isAbsolute(configured.slice(5))) {
    throw Error(`${file}: hub.address must be unix:<absolute path>, not ${JSON.stringify(configured)}`);
  }
  return { address: configured, path: configured.slice(5) };
}

/** The dev hub a worktree holding `cwd` was sent to, the longest such worktree winning. */
function worktreeHub(uses: Record<string, unknown>, cwd: string): string | undefined {
  let real = cwd;
  try { real = realpathSync(cwd); } catch { /* gone: as given */ }
  const holds = (worktree: string) => [cwd, real].some((p) => p === worktree || p.startsWith(worktree.endsWith(sep) ? worktree : worktree + sep));
  const found = Object.entries(uses).filter(([worktree, address]) => typeof address === 'string' && address.startsWith('unix:') && holds(worktree))
    .sort(([a], [b]) => b.length - a.length)[0];
  return found?.[1] as string | undefined;
}

/** The deep-hook this checkout built, the newer of its release and debug builds. */
export function deepHook(): string {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const built = ['release', 'debug'].map((p) => join(repo, 'target', p, 'deep-hook')).filter((p) => existsSync(p));
  if (!built.length) throw Error(`no deep-hook is built under ${join(repo, 'target')}; run cargo build -p deep-hook first`);
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}
