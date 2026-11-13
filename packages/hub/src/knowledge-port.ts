// Knowledge lifecycle contracts. The core schedules work; archive/wiki/index implementations are outer providers.
import type { Asks } from '@deepbuild/asks';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { Connection, RecordStore } from '@deepbuild/record';
import type { Runner } from '@deepbuild/runner';
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
