// Results shared across sessions (#1018; design: Pinned to a commit): a run's key names everything its result depends
// on, so any claim in the same repo on the same host whose key is equal reads that run as carried, whichever session
// made it. The key is a stem (the repo, the host, the check's approved bytes and command, its held-out variants, the
// environment's installs, and for a base run the merge base) and the contents of the files it reads: the files its runs
// read, or for a base run its own files. A key's runs come from every claim that ran it, each counted once.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { RecordedRun } from '@deepbuild/gate';

/** A run on a key, with the claim and session it ran for. */
export interface Source { run: string; claim: string; session: string; withheld: boolean }
/** What run.finished keeps of a run's key (#1018), by which a restarted hub reads it again. */
export interface KeyFacts { id: string; stem: string; paths: string[]; claim: string; session: string; base: boolean; withheld: boolean }
/** One key of one check (`id`): the key itself, its stem, the paths whose contents it holds, and its runs from every claim, oldest first. */
export interface Group { id: string; key: string; stem: string; paths: string[]; runs: Source[] }
/** Folders of installed dependencies: the environment the key's stem names, never files hashed one by one. */
export const INSTALLS = ['node_modules', '.venv'];

const sha = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');
/** The digest of an empty output: what a withheld or unkept run shows in place of its own. */
export const EMPTY = sha('');
const installed = (path: string): boolean => INSTALLS.some((d) => path === d || path.startsWith(`${d}/`));
/** The files a run read that the key holds: those outside installed dependencies, in order. */
export const keyPaths = (read: readonly string[]): string[] => [...new Set(read.filter((p) => !installed(p)))].sort();

/** The contents of `paths` in `dir` as one digest: each path with its bytes' digest, or `-` where it's absent. */
export async function contents(dir: string, paths: readonly string[]): Promise<string> {
  const lines = await Promise.all(paths.map(async (p) => `${p}\0${await readFile(join(dir, p)).then(sha, () => '-')}`));
  return sha(lines.join('\n'));
}
export const keyId = (stem: string, paths: readonly string[], digest: string): string => sha(`${stem}\0${paths.join('\0')}\0${digest}`);

/** The repo a worktree belongs to: git's common folder, which every linked worktree of one repo shares. */
export function repoOf(cwd: string): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return new Promise((done) => execFile('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, env }, (error, out) => done(error ? cwd : out.trim())));
}
/** The installs a checkout has, as the key's environment: each folder's lock record, or its top-level names. */
export async function installsOf(dir: string): Promise<string> {
  const parts = await Promise.all(INSTALLS.map(async (d) => {
    const lock = await readFile(join(dir, d, '.package-lock.json')).then(sha, () => null);
    return `${d}\0${lock ?? (await readdir(join(dir, d)).then((names) => names.sort().join('\0'), () => '-'))}`;
  }));
  return sha(parts.join('\n'));
}
/** The stem of a key: everything but the files' contents. */
export const stemOf = (facts: { repo: string; check: string; approved: string; command: string; held_out: unknown; installs: string; base: string | null; session?: string }): string =>
  sha(JSON.stringify([facts.repo, hostname(), facts.check, facts.approved, facts.command, facts.held_out ?? null, facts.installs, facts.base, facts.session ?? null]));

export class SharedRuns {
  private readonly groups = new Map<string, Group>();
  /** By stem, the path sets its keys hold, each once. */
  private readonly sets = new Map<string, Map<string, string[]>>();

  group(id: string): Group | undefined {
    return this.groups.get(id);
  }
  /**
   * A run of `check` joins its key's group, and a run already in it is one run, however often it's added. Groups are
   * the check's own, so a kept key never reads as another check's.
   */
  add(check: string, facts: KeyFacts, run: string): Group {
    const id = `${check}\0${facts.id}`;
    let g = this.groups.get(id);
    if (!g) {
      g = { id, key: facts.id, stem: facts.stem, paths: facts.paths, runs: [] };
      this.groups.set(id, g);
      const sets = this.sets.get(facts.stem) ?? new Map<string, string[]>();
      sets.set(facts.paths.join('\0'), facts.paths);
      this.sets.set(facts.stem, sets);
    }
    if (!g.runs.some((r) => r.run === run)) g.runs.push({ run, claim: facts.claim, session: facts.session, withheld: facts.withheld });
    return g;
  }
  /** The groups of `check` under `stem` whose files hold in `dir` what they held for the key, the one with most runs first. */
  async find(check: string, stem: string, dir: string): Promise<Group[]> {
    const found: Group[] = [];
    for (const paths of this.sets.get(stem)?.values() ?? []) {
      const g = this.groups.get(`${check}\0${keyId(stem, paths, await contents(dir, paths))}`);
      if (g) found.push(g);
    }
    return found.sort((a, b) => b.runs.length - a.runs.length);
  }
}

/**
 * A kept run's record as run.finished holds it, for a claim that reads it after a restart: its outcome, counts, the
 * failures its findings name and the digests of its output.
 */
export function keptRecord(run: string, d: { outcome: string; tests_run: number; findings: string[]; evidence: string[] }): RecordedRun {
  const failures = d.outcome === 'failed' ? d.findings.flatMap((f) => {
    const m = /^(.*) \(([^()]*):(\d+)\): ([\s\S]*)$/.exec(f);
    return m ? [{ test: m[1]!, file: m[2]!, line: Number(m[3]), stack: null, assertion: true, message: m[4]! }] : [];
  }) : [];
  return {
    run, outcome: d.outcome as RecordedRun['outcome'], testsRun: d.tests_run, failures, evidence: [], read: [], mask: null, exit: null,
    output: { stdout: '', stderr: '', sha256: { stdout: d.evidence[0] ?? EMPTY, stderr: d.evidence[1] ?? EMPTY } }, attempts: [], seeded: [], contract: null,
  };
}
/** A held-out variant's run as a claim may show it: its outcome and counts, never its fixture or output (#1018). */
export function withheld(r: RecordedRun): RecordedRun {
  const failures = r.failures.length ? [{ test: 'held-out variant', file: '.', line: 1, stack: null, assertion: true, message: 'failed on a held-out variant of its fixtures' }] : [];
  return { ...r, failures, evidence: [], read: [], output: { stdout: '', stderr: '', sha256: { stdout: EMPTY, stderr: EMPTY } }, attempts: [], seeded: [], contract: null };
}
