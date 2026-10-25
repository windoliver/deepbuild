// The wrong programs the #348 criteria name that live on the test's side. The host's own planted twins
// ('hub-unless-agent-built', 'grants-only-in-record-query', 'first-party-appends-every-kind') are selected through
// the surface's `plant` option (README, Wrong programs); these are the ones the criteria describe as test pieces or
// as the walk's own failure.
//
// - The two stand-ins for the done gate and spec drafting (AC3) each read the one trust decision every time they
//   would run a repo's commands. The planted piece keeps its own trust list: it adds a repo the first time it sees
//   it trusted and never asks again, so it still runs the repo's commands after you revoke trust.
// - The walk (AC10) must fail, naming the method, when the schema lists one it didn't call. `withUncalledMethod`
//   adds a method to the schema the test package never saw, so the walk over the same calls must name it.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiMethod, ProjectTrust } from '../../../packages/extension-host/src/index.ts';
import { NODE } from './helpers.ts';

/** A piece that runs a repo's commands: the done gate's checks or spec drafting's reads of the repo's scripts. */
export interface Piece { name: string; run(repo: string): Promise<boolean> }

/** Runs the repo's command (its run.mjs, which leaves `ran-<piece>` in the repo) and says whether it ran. */
function runRepoCommand(repo: string, piece: string): boolean {
  const marker = join(repo, `ran-${piece}`);
  rmSync(marker, { force: true });
  const r = spawnSync(NODE, ['run.mjs', piece], { cwd: repo, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' } });
  if (r.status !== 0) throw Error(`the repo's command failed under ${piece}: ${r.stderr}`);
  return existsSync(marker);
}

/** A stand-in that reads the one trust decision each time, through its own reader of the record. */
export function standIn(name: string, trust: ProjectTrust): Piece {
  return {
    name,
    async run(repo: string): Promise<boolean> {
      if (!(await trust.trusted(repo))) return false;
      return runRepoCommand(repo, name);
    },
  };
}

/** The planted piece: it keeps its own trust list, filled the first time it sees a repo trusted, never re-read. */
export function ownTrustList(name: string, trust: ProjectTrust): Piece {
  const list = new Set<string>();
  return {
    name,
    async run(repo: string): Promise<boolean> {
      if (!list.has(repo) && (await trust.trusted(repo))) list.add(repo);
      if (!list.has(repo)) return false;
      return runRepoCommand(repo, name);
    },
  };
}

/** The schema with one method more than the test package was given to call. */
export const withUncalledMethod = (schema: readonly ApiMethod[]): ApiMethod[] => [...schema, { method: 'deep.planted.uncalled', needs: 'record' }];
