// Private load and installation data shared by the host's cohesive services. No imports of service owners.
import type { Server as HttpServer } from 'node:http';
import type { SlotFill } from '@deepbuild/conformance';
import type { Connection } from '@deepbuild/record';
import type { LeaseKind } from '@deepbuild/leases';
import type { Cleanup } from '@deepbuild/supervisor';
import type { ProvideRow, UseRow } from './compose.js';
import type { Template } from './replies.js';
import type { HeldJobs } from './job-kinds.js';
import type { Declared } from './source-types.js';
import type { Action } from './action-schema.js';
type ChannelKind = 'device' | 'chat' | 'email' | 'text';
/** A host you approved for a package's outside calls, with its quota. */
export interface HostGrant { host: string; quota: { calls: number; per_ms: number } }

/** A kit the install ran on what the package registers: the slot, the fill (a check kind's name), its verdict. */
export interface KitRun { slot: string; fill: string; verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE' }

/** A view of a project's pack, as the app shows it while you're in the project (#67). */
export interface ProjectView { name: string; extension: string; commands: { name: string; action: string }[] }

/** A view of a package you installed, as the app mounts it (#1454): its panel's folder, its pages, and what panel@1 said of these bytes, if it ran. */
export interface InstalledView extends ProjectView { version: string; folder: string; area: string; pages: { name: string; param: string; values?: string[] }[]; kit: KitRun['verdict'] | null }

export interface Installed { id: string; version: string; folder: string; digest: string; builtBy: string | null; project: string | null; kits: KitRun[] }

/** An index@1 fill as the host reaches it in the package: each call answered over the package's side. */
export interface IndexFill extends SlotFill {
  slot: 'index@1';
  revision: number;
  rebuild(claims: { id: string; page: string; source: string; text: string }[]): Promise<unknown>;
  upsert(claims: { id: string; page: string; source: string; text: string }[]): Promise<unknown>;
  search(query: string): Promise<{ claim: string; page: string; quote: string; source: string }[]>;
  dropSource(source: string): Promise<unknown>;
}

export interface Manifest {
  id: string; version: string; digest?: string; access?: { words: string[] }; checks?: string[]; replaces?: string[]; notices?: string[]; actions?: string[]; environments?: string[];
  stores?: string[]; events?: string[];
  provides?: ProvideRow[]; uses?: UseRow[]; templates?: Template[];
  conflicts?: string[]; kernel?: string[]; publisher_key?: string; signature?: string; leases?: LeaseKind[];
  /** extension.contract@1's (#139): whether it declares itself stable, and the preview entries it uses by name. */
  stability?: 'stable' | 'preview'; requires?: { preview?: string[] };
  host?: { runs: 'terminals'; lives: 'past_app'; owns: 'terminals'[] };
  secrets?: { name: string; for: string }[];
  sources?: { name: string; variant: string; reading?: string; host?: string }[];
  /** The state sources it registers (#67), each held to state-source@1's kit at install. */
  state_sources?: string[];
  /** The job kinds it registers and the tools it adds to a kind (#1922), each tool pinned by name@version. */
  jobs?: string[];
  job_tools?: { kind: string; tool: string; host?: string; provider?: string }[];
}

/** An install: also the check kinds it holds, its own until a package that replaces one installs. */
export interface Entry extends Installed { grant: { record: string[]; text?: boolean; projects?: string[]; hosts?: HostGrant[]; docs?: string[] }; holds: string[]; jobs?: HeldJobs }

export type Ask = (method: string, params: unknown) => Promise<unknown>;

/** A store a piece declared (#363): the generation its items are held to, their check against its schema, and its quota in bytes (#365). */
export interface Store { generation: number; check: (value: unknown) => string | undefined; quota: number | null }

export interface Ext {
  entry: Entry;
  /** Its project folder's real path, resolved when it loads, which the hook path asks trust about (#881). */
  project: string | null;
  /** The copy of its install folder it runs from, which only the host writes. */
  folder: string;
  manifest: Manifest;
  place: 'hub' | 'sandbox';
  run: string | null;
  digest: string;
  mode: 'conformance' | 'loaded';
  /** Check kinds it registered; at its conformance run, every one it tried. */
  kinds: string[];
  /** Environments it registered (#331); at its conformance run, every one it tried. */
  environments: string[];
  /** The job kinds and tools it registered (#1922), as it declared them; read at its install's run. */
  jobKinds: Map<string, unknown>;
  jobTools: { kind: string; tool: unknown }[];
  /** Starts and handles owned by this exact load; removal drains them before dropping its handlers. */
  environmentStarts: Set<Promise<unknown>>;
  environmentStops: Set<() => Promise<void>>;
  subscribed: Set<string>;
  routes: Set<string>;
  /** The adapter names it registered. */
  adapters: Set<string>;
  /** The channels it registered (#65), by name, with what each reaches and whether it draws a plan's steps (#1580); their deliver and receive stay with the package. */
  channels: Map<string, { kind: ChannelKind; steps: boolean }>;
  /** The state sources it registered (#67), by name; their read, compare, undo and fixture stay with the package. */
  stateSources: string[];
  /** The index it registered, by name, with the kit revision it declares, and how the host reaches it once loaded. */
  index?: { name: string; revision: number; fill?: IndexFill };
  /** Whether a load of these bytes runs in the hub: a release package written by no agent, with an index.ts. */
  hubBound: boolean;
  /** The sources it registered, by name, as declared (#364); their functions stay with the package. */
  sources: Map<string, Declared>;
  /** Its views, each with the reading handles it binds (#262). */
  views: Map<string, string[]>;
  /** Each view's ⌘K commands (#67), as the app shows them while you're in its project. */
  commands: Map<string, { name: string; action: string }[]>;
  /** Where each view's panel sits (#1454): its folder, its area and its pages. */
  panels: Map<string, { folder: string; area: string; pages: InstalledView['pages'] }>;
  /** The sources each check kind it registered reads, as declared (#365). */
  checkReads: Map<string, string[]>;
  /** How many times its code started in this copy: a restart imports a hub package's code afresh. */
  starts: number;
  /** How to take its resolver back from the asks core, once it registered one. */
  resolverDrop?: () => void;
  /** Inside DeepBuild's signed release: its replies are text, and join first. */
  released: boolean;
  /**
   * Staged until its start finished: only then do hooks, action calls and events reach it. Cleared first when it
   * is removed, so no new call reaches it while it stops.
   */
  live: boolean;
  actions: Map<string, Action>;
  /** The outputs it provides, by interface. */
  provides: Set<string>;
  /** The output interfaces it uses, each with whether its `deep.use` marked it optional. */
  uses: Map<string, boolean>;
  /** Removing it detached its users' uses: their reads through it read missing. */
  detached: boolean;
  /** Its users' reads through it under way, which its removal waits for before it stops. */
  reads: Set<Promise<unknown>>;
  /** How to refuse each of those reads at once, when a new version replaces it rather than waiting for them (#103). */
  refuseReads: Set<(e: Error) => void>;
  /** The callers of the action calls it is serving, by the scope token each call was given. */
  scopes: Map<string, Connection>;
  /** The recorded change or send call each scope token serves, by its call ID: the store items written for it name it. */
  callOf: Map<string, string>;
  /** Its stores, by kind (#363). */
  stores: Map<string, Store>;
  /**
   * A new version's start before it replaces the one in use (#103): it registers as at conformance, and may read its
   * stores and its uses, so its outputs can be recorded for its users' contract tests; it writes nothing.
   */
  staged?: boolean;
  /** While a contract test replays its tests (#103): what `t.read` of an interface it uses answers, the provider's new outputs. */
  replay?: Map<string, unknown>;
  /** The readings it read through its edges, by handle, which its model jobs may take as inputs (#103). */
  edgeReads: Map<string, { edge: string; value: unknown; at: number }>;
  /** How the host asks the running package: its in-process side, or its socket. Unset until it runs. */
  ask?: Ask;
  stop?: () => Promise<void>;
  /** A sandboxed one's run, as the supervisor's cleanup left it once stopped: its leases end only on a clean one. */
  cleaned?: Cleanup | undefined;
  /** The leases granted to this load of it: its unload ends these, never another load's under the same holder. */
  leased: string[];
  /** The calls the host refused it for using a preview method other than by name (#139): each refuses its install. */
  refusals: string[];
  /** Set once its unload ends its leases: one granted after, to a call already under way, ends at its grant. */
  leasesEnded?: boolean;
  server?: HttpServer;
  /** While its own tests run (#366): only then does the host answer their calls. */
  testing?: boolean;
  /** How to push an action call's deadline later, by its scope: to a runner job's own while that job runs (#366). */
  deadlines: Map<string, (ms: number) => void>;
}
