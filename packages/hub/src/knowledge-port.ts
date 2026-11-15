// Knowledge lifecycle contracts. The core schedules work; archive/wiki/index implementations are outer providers.
import type { Asks } from '@deepbuild/asks';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { Comparison, Connection, RecordReader, RecordStore, ReplayPlan } from '@deepbuild/record';
import type { Runner } from '@deepbuild/runner';
import type { Grant, Launch } from '@deepbuild/supervisor';
import type { Root } from './paths.js';
import type { IndexFill } from './search.js';

export interface WikiBuildOptions {
  record: RecordStore;
  root: Root;
  store: EvidenceStore;
  runner: Runner;
  asks: Asks;
  now(): number;
  archive(): Promise<void>;
  core: Connection;
  cli: Connection;
  plant?: string | undefined;
  held?: readonly string[] | undefined;
}
export interface WikiBuilt { changed: string[]; reading: { jobs: number; waiting: boolean } }
export interface WikiBuild {
  build(): Promise<WikiBuilt>;
  forget(claim: string): Promise<string>;
  writeRules(): Promise<void>;
}
export interface KnowledgeProvider {
  /** The outer eval provider owns planning/replay; the core owns recording and the conditional file change. */
  removal(reader: RecordReader, read: (sha: string) => Promise<Uint8Array>, change: {
    id: string; repo: string; file: string; before: string; after: string;
  }): Promise<{ plan: ReplayPlan; evaluate(context: {
    folder: string; env: Record<string, string>; signal: AbortSignal;
    checkpoint(agent: 'claude-code' | 'codex'): Promise<void>;
    execute(launch: Launch, grant: Grant, prompt: string, deadline: number): Promise<unknown[]>;
    read(agent: 'claude-code' | 'codex', model: string, prompt: string, deadline: number): Promise<unknown[]>;
  }): Promise<{ after: Comparison }> }>;
  archive(options: {
    record: RecordStore; evidence: EvidenceStore; asks: Asks;
    env: Record<string, string | undefined>; connection: Connection; now(): number;
    held(): readonly string[]; forge: { api: string; repos: readonly string[] }; plant?: string | undefined;
  }): Promise<{ pass(): Promise<void>; session(id: string): Promise<void>; archived(): Promise<Set<string>> }>;
  wiki(options: WikiBuildOptions): WikiBuild;
  index(wiki: string, module?: string): Promise<IndexFill | undefined>;
  cwdOf(text: string): string | undefined;
  writtenOf(wiki: string): string;
}
