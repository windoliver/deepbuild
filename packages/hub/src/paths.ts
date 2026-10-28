// Where a hub keeps its files, and the one setting every client reads the hub's address from.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The installed hub's root: ~/.deepbuild. A dev hub's is the folder given to --root. */
export const installedRoot = (): string => join(homedir(), '.deepbuild');

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
