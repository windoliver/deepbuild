// Workspace record/state capabilities consumed by tasks and control, without the concrete workspace implementation.
import type { StateSource } from '@deepbuild/conformance';
import type { JsonValue } from '@deepbuild/contracts';
import type { Connection, EventInput, RecordStore } from '@deepbuild/record';
import type { StatePin } from './gate-runner.js';
import type { Plant } from './plant.js';

type Obj = Record<string, unknown>;
export interface WorkspaceDeps {
  root: string;
  now(): number;
  plant?: Plant | undefined;
  record(): RecordStore;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  append(connection: Connection, input: EventInput): Promise<void>;
  connection(extra?: Partial<Connection>): Connection;
  keep(bytes: Uint8Array, source: string): Promise<string>;
  fetch(sha256: string): Promise<Uint8Array>;
  trust(folder: string): Promise<void>;
  plugin(name: string): Promise<Omit<StateSource, 'fixture'>>;
  adopted(session: string, id: string): void;
  told(session: string, cwd: string, text: string): void;
  rerun(claim: string, checks: readonly string[], state: StatePin): boolean;
}
interface Space { id: string; folder: string; name: string }
export interface WorkspaceService {
  open(): Promise<void>;
  make(topic: string, pick?: string, task_ref?: string | null, at?: string): Promise<Space>;
  move(id: string, to: string): Promise<Space>;
  revert(id: string, commit: string): Promise<{ commit: string }>;
  land(task: { session: string; cwd: string; task_ref: string; text: string; item?: { title?: string } }): Promise<string | undefined>;
  folderOf(task_ref: string): string | undefined;
  fill(folder: string, handed: Obj): Promise<void>;
  keep(folder: string, task_ref: string): Promise<boolean>;
  pin(task_ref: string, folder: string, requirements: readonly Obj[]): Promise<void>;
  claimState(task_ref: string, folder: string, claim: string): Promise<StatePin | undefined>;
  diff(id: string): Promise<{ diffs: { touch: string; item: string; was: JsonValue; now: JsonValue }[] }>;
  drift(id: string): Promise<{ drifted: string[]; stale: string[]; reran: string[] }>;
  pinned(): Promise<string[]>;
  driftAll(): Promise<void>;
}
export interface WorkspacesProvider {
  create(options: WorkspaceDeps): WorkspaceService;
  renamedSince(folder: string, base: string, path: string): Promise<string | undefined>;
}
