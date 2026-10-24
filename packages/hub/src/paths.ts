// Where a hub keeps its files, and the one setting every client reads the hub's address from.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

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
  };
}

/**
 * The hub's address: `hub.address` in ~/.deepbuild/config.json, `unix:<absolute path>`; absent, the installed
 * hub's socket. deep-hook, `deep mcp`, the app and the CLI all read this one setting, and none assumes the hub
 * is on this machine: a forwarded socket named here works for each.
 */
export function hubAddress(): { address: string; path: string } {
  const file = join(installedRoot(), 'config.json');
  let configured: unknown;
  if (existsSync(file)) {
    try {
      configured = (JSON.parse(readFileSync(file, 'utf8')) as { hub?: { address?: unknown } }).hub?.address;
    } catch (error) {
      throw Error(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (configured === undefined) {
    const path = rootOf(installedRoot()).socket;
    return { address: `unix:${path}`, path };
  }
  if (typeof configured !== 'string' || !configured.startsWith('unix:') || !isAbsolute(configured.slice(5))) {
    throw Error(`${file}: hub.address must be unix:<absolute path>, not ${JSON.stringify(configured)}`);
  }
  return { address: configured, path: configured.slice(5) };
}
