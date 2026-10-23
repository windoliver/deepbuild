// The supervisor's public shapes: the sandbox seam, host@1 and the supervisor itself (#236).
import type { Asks } from '@deepbuild/asks';
import type { RecordStore } from '@deepbuild/record';

/** What a process may touch beyond the system's own runtime, each word enforced by the sandbox (Access). */
export interface Grant {
  /** Absolute paths it may read, and run the programs in. */
  read?: string[];
  /** Absolute paths it may read and write. */
  write?: string[];
  /** "<host>:<port>" the egress filter lets it connect to; on Seatbelt, a port on this machine. */
  hosts?: string[];
  /** Absolute paths of the local sockets it may connect to. */
  sockets?: string[];
  /** "<host>:<port>" it may listen on; on Seatbelt, the port on every address of this machine, the LAN's too: Seatbelt can't tell loopback from the wildcard. A run's leased ports are added to it. */
  listen?: string[];
  /** Run-as-you (Access): your files and programs, as you. Still no device, and no socket or host it doesn't name. */
  run_as_you?: boolean;
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
  grant?: Grant;
  /** No key: any free key of that kind's pool. `env`: the variable its key is passed to the process in. */
  leases?: { kind: string; key?: string; env?: string }[];
  /** Where the caller takes the run's output as it comes, beside the digests in its exit. */
  output?: { stdout(chunk: Buffer): void; stderr(chunk: Buffer): void };
}
export type Started =
  | { run: string; status: 'started'; pid: number; pgid: number; start: string; leases: { kind: string; key: string }[] }
  | { run: string; status: 'BLOCKED'; cause: 'resource'; kind: string };
/** evidence: SHA-256 (hex) of the bytes the parent read from the process's stdout and stderr. */
export interface Exit { run: string; code: number | null; signal: NodeJS.Signals | null; evidence: { stdout: string; stderr: string } }
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
export type Plant = 'sandbox-left-to-caller' | 'stops-token-bearing-group-members' | 'requires-token-in-group' | 'records-only-started' | 'hold-without-ask' | 'holds-lease-while-taken';
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
  /** Paths no run may write, whatever its grant: the hub's record, and where agents read their hooks. */
  guarded?: string[];
  /** How long a lease is granted for; past it a lease whose holder still runs is only stale. A day unless a test sets it. */
  lease_ms?: number;
  plant?: Plant;
  /** Tests only: the supervisor's process kills itself right after a start is recorded, or right after its spawn. */
  crash?: 'start-recorded' | 'spawned';
}
export interface Supervisor extends Host {
  /** Stops every process the run owns that it can prove, releases its leases, runs their cleanup steps and checks. */
  cleanup(run: string): Promise<Cleanup>;
  status(run: string): Promise<RunStatus>;
  /** While an unblock ask is open or a key is out of its pool: ticks the asks core, reads what the record gained (an answer, a default) and acts on it. */
  tick(): Promise<void>;
  close(): Promise<void>;
}
