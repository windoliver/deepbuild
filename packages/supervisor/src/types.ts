// The supervisor's public shapes: the sandbox seam, host@1 and the supervisor itself (#236).
import type { Asks } from '@deepbuild/asks';
import type { LeaseTable } from '@deepbuild/leases';
import type { RecordStore } from '@deepbuild/record';

/** What a process may touch beyond the system's own runtime, each word enforced by the sandbox (Access). */
export interface Grant {
  /** Absolute paths it may read, and run the programs in. */
  read?: string[];
  /** Absolute paths it may read and write. */
  write?: string[];
  /** "<host>:<port>" the egress filter lets it connect to; on Seatbelt and bubblewrap, a port on this machine. */
  hosts?: string[];
  /** Absolute paths of the local sockets it may connect to. */
  sockets?: string[];
  /** "<host>:<port>" it may listen on; on Seatbelt and bubblewrap, the port on every address of this machine, the LAN's too: neither tells loopback from the wildcard. A run's leased ports are added to it. */
  listen?: string[];
  /** Run-as-you (Access): your files and programs, as you. Still no device, and no socket or host it doesn't name. */
  run_as_you?: boolean;
  /** Folders under a guarded path that are this run's alone, which it may write: a hosted terminal's own, never its neighbours'. Bubblewrap only; Seatbelt's guards are one profile for every run. */
  own?: string[];
}
/** A process to start: what the supervisor would spawn. */
export interface Launch { argv: string[]; cwd: string; env: Record<string, string> }
/** The sandbox seam: one interface, a backend per platform (Seatbelt now; bubblewrap #70 and AppContainer later). */
export interface SandboxBackend {
  readonly name: string;
  readonly platform: NodeJS.Platform;
  /** The launch that runs `launch` confined to `grant`: its folder readable, nothing else beyond the grant. `run` tags what it denies. */
  confine(launch: Launch, grant: Grant, run?: string): Promise<Launch>;
}

/** host@1: what every place that runs work does. The supervisor is its local implementation. */
export interface StartSpec {
  /** `run:<ULID>`, the caller's. */
  run: string;
  argv: string[];
  /** The run's folder, absolute. */
  cwd: string;
  /** Added to its environment; the supervisor adds the run token, unless the caller names it as DEEP_RUN_TOKEN. */
  env?: Record<string, string>;
  /** false: `env` and the run token are its whole environment, none of the host's own (a hermetic check run, a runner job that allowlists it). */
  inherit?: boolean;
  /**
   * Written to its stdin once its process is tracked, then stdin is closed; with none, stdin is closed from the start.
   * A function is asked only then, and its undefined closes stdin with nothing written.
   */
  input?: Buffer | (() => Buffer | undefined);
  grant?: Grant;
  /**
   * Credentials for its environment (#1106): one with `hosts` reaches it only as a stand-in, which the run's egress
   * filter swaps for the value in one header of an HTTPS request to those hosts (and `methods`); one without, by value.
   */
  credentials?: { env: string; value: string; hosts?: string[]; methods?: string[] }[];
  /** No key: any free key of that kind's pool. `env`: the variable its key is passed to the process in. */
  leases?: { kind: string; key?: string; env?: string }[];
  /** Who holds the run's leases, as their events name the holder: a writer such as the session's deep mcp (`mcp:<session>`) whose call started the run; the core unless given. */
  holder?: string;
  /** It keeps running when the hub stops (a hosted terminal, #104): a supervisor opened later adopts the run rather than reaping it, and its cleanup still stops it. */
  keep?: boolean;
  /**
   * The program confines itself in its own sandbox (an agent's, in a session DeepBuild starts, #1330): macOS can't nest
   * Seatbelt, so the supervisor's isn't applied and the grant is unused. Its processes are still owned and stopped.
   */
  own_sandbox?: boolean;
  /** Where the caller takes the run's output as it comes, beside the digests in its exit. */
  output?: { stdout(chunk: Buffer): void; stderr(chunk: Buffer): void };
  /**
   * What the run may take once started (#1409), each in MiB: `memory_mb` over its whole process tree, read on the
   * supervisor's scan; `file_mb` for any one file it writes, the kernel's RLIMIT_FSIZE on each of its processes. Past
   * one, the run is stopped and its exit names the limit.
   */
  limits?: { memory_mb: number; file_mb: number };
}
/** A run stopped at one of its limits: which, its value (`max`) and, for memory, the reading that passed it, all in MiB. */
export interface LimitStop { limit: 'memory_mb' | 'file_mb'; max: number; reading?: number }
export type Started =
  | { run: string; status: 'started'; pid: number; pgid: number; start: string; leases: { kind: string; key: string }[] }
  | { run: string; status: 'BLOCKED'; cause: 'resource'; kind: string };
/** evidence: SHA-256 (hex) of the bytes the parent read from the process's stdout and stderr; `limit`: the run was stopped at one (#1409). */
export interface Exit { run: string; code: number | null; signal: NodeJS.Signals | null; evidence: { stdout: string; stderr: string }; limit?: LimitStop }
export interface HostFacts { host: string; platform: NodeJS.Platform; arch: string; cores: number; memory: number }
export interface Host {
  readonly name: string;
  /** Resolves once the process exists and is recorded, or BLOCKED; while held on a resource, it waits. */
  start(spec: StartSpec): Promise<Started>;
  /** Signals what the run owns: its process group and every process tracked for it. */
  signal(run: string, signal: NodeJS.Signals): Promise<void>;
  /** The started process's end, once its output has closed. */
  wait(run: string): Promise<Exit>;
  facts(): Promise<HostFacts>;
}

/** A step run in the platform sandbox with DEEP_RESOURCE_KEY set, its folder writable, and what its grant and environment add. */
export interface ResourceStep { argv: string[]; cwd: string; grant?: Grant; env?: Record<string, string> }
export interface ResourceKind {
  kind: string;
  /** Its pool. */
  keys: string[];
  /** The cleanup step that gives a key back. */
  release?: ResourceStep;
  /** The cleanup check: exit 0 when the key is clean. */
  check?: ResourceStep;
  /** Asked before a key nobody here holds is leased: false skips it, as something outside DeepBuild holds it. */
  free?: (key: string) => Promise<boolean>;
  /** Its keys are TCP ports on this machine: its holder may listen on its key, and connect to it. */
  port?: boolean;
}
export interface Cleanup {
  run: string;
  outcome: 'clean' | 'unfinished';
  /** What's left, each named: "phone:+15550100", "pid:123". */
  left: string[];
  /** The PIDs it stopped. */
  stopped: number[];
}
export interface RunStatus { run: string; state: 'held' | 'running' | 'exited' | 'cleaned' | 'BLOCKED'; on?: string[] }
/** The planted wrong programs the acceptance tests select; tests only. */
export type Plant = 'kept-in-service-cgroup' | 'sandbox-left-to-caller' | 'stops-token-bearing-group-members' | 'requires-token-in-group' | 'records-only-started' | 'hold-without-ask' | 'holds-lease-while-taken'
  // #1106's: the stand-in's value in the run's environment too, a filter that substitutes on every allowed host, the run's CA in the login keychain.
  | 'standin-value-in-env' | 'standin-every-host' | 'run-ca-in-login-keychain' | 'sandbox-any-loopback'
  // The denial stream's: a macOS whose sandbox reports carry another subsystem than the stream's filter names.
  | 'reports-other-subsystem';
export interface SupervisorOptions {
  /** Ownership records, leases, denials and cleanup outcomes go here, written as `core`. */
  record: RecordStore;
  /** The asks core its unblock asks go through. */
  asks: Asks;
  /** The clock of records and deadlines; waits and grace periods are real time. */
  now: () => number;
  /** What your settings give an unblock ask. */
  settings: { asks: { unblock: { deadline_ms: number } } };
  resources?: ResourceKind[];
  /**
   * The kernel's lease table (#237). With one, every key a run takes is the table's lease, held by the core for the
   * run, and the table's grant replaces the kind's own free check; the supervisor releases it, citing the
   * process.ended events that prove the run's processes gone. Each kind must be declared in it.
   */
  leases?: LeaseTable;
  /** Paths no run may write, whatever its grant: the hub's record, and where agents read their hooks. One with
   * `except` leaves those folders under it to each run's own grant (the hub's jobs/ under its root). */
  guarded?: (string | { path: string; except: string[] })[];
  /** How long a lease is granted for; past it a lease whose holder still runs is only stale. A day unless a test sets it. */
  lease_ms?: number;
  /**
   * Where a kept run's output goes under a systemd service, a folder only you can read: a pipe to the hub would end
   * with the hub, and the run with it (#70).
   */
  kept?: string;
  plant?: Plant;
  /** Tests only: the supervisor's process kills itself right after a start is recorded, or right after its spawn. */
  crash?: 'start-recorded' | 'spawned';
}
export interface Supervisor extends Host {
  /** Stops every process the run owns that it can prove, releases its leases, runs their cleanup steps and checks. */
  cleanup(run: string): Promise<Cleanup>;
  status(run: string): Promise<RunStatus>;
  /** Whether any process the run owns still runs, as it can prove: what an adopted run has in place of its exit. */
  lives(run: string): Promise<boolean>;
  /** While an unblock ask is open or a key is out of its pool: ticks the asks core, reads what the record gained (an answer, a default) and acts on it. */
  tick(): Promise<void>;
  close(): Promise<void>;
}
