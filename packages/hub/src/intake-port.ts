// What the one input (#1342) needs of the hub, without the concrete intake: the intake imports the briefs extension,
// so only the composition root builds it, and control reaches it through this port.
import type { Asks, Delivery } from '@deepbuild/asks';
import type { Runner } from '@deepbuild/runner';
import type { Plant } from './plant.js';
import type { Row } from './rows.js';
import type { WorkspaceService } from './workspaces-port.js';

type Obj = Record<string, unknown>;
export interface IntakeDeps {
  root: string;
  now(): number;
  plant: Plant | undefined;
  /** The forge a software result's private repo is made on, and its token. */
  forge: string;
  token(): Promise<string | undefined>;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string }): Promise<void>;
  /** Kept as evidence: its SHA-256. */
  keep(bytes: Uint8Array, source: string): Promise<string>;
  /** Where the research job runs. */
  runner(): Runner;
  asks(): Asks;
  spaces(): WorkspaceService;
  /** The run your yes on the card approved, under that card's ask: no second ask (Work.under). */
  start(ask: string, folder: string, scope: string): Promise<void>;
  /** A row of the list, or its leaving it, on the record before it resolves. */
  row(id: string, row: Row | null): Promise<void>;
}
export interface IntakeService {
  /** Your words, with the files and links you added: one row now, the card once the research is done. */
  say(words: string, files: readonly string[]): Promise<Obj>;
  /** Your answer to a brief's card: true when it was one. A yes applies it. */
  answered(delivery: Delivery): boolean;
  /** Each pass of the work runs: briefs a restart left half done carry on, and held steps that are due ask. */
  due(): Promise<void>;
}
