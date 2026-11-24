// #1112.883bbf6d: No worktree on an open branch and no uncommitted edit was removed: the before and after lists of
// worktrees, with `git status --porcelain` per remaining worktree, are saved.
//
// The issue changes no code: its Proof is "the saved command outputs before and after, on both machines", and those
// are the files of docs/evidence/1112/. So the record is what is under test, and a wrong program is a wrong record
// (twins/). The tests read the real files and judge the criterion from the command outputs in them alone (README: How
// the criterion is read): `git worktree list` before and after, `git status --porcelain` per listed worktree, and, for
// whether a branch is open, the Mac's saved table of worktree facts. The decisions files and the diff file are an
// agent's account of those outputs and are not read (AGENTS.md, invariant 1).
// Anything the outputs don't show is a problem, named with its worktree, never a pass.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const AC = '#1112.883bbf6d';
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'evidence', '1112');

/** Each machine's saved outputs. `facts` is the saved table that says, per worktree, its PRs and whether its head is in origin/main. */
interface Machine { machine: string; before: string; after: string; facts: string | null }
const MAC: Machine = { machine: 'Mac', before: 'mac-before-worktrees.txt', after: 'mac-after-worktrees.txt', facts: 'mac-before.txt' };
const SPARK: Machine = { machine: 'Spark', before: 'spark-before.txt', after: 'spark-after.txt', facts: null };

interface Entry { path: string; head: string; branch: string | null; prunable: boolean }
interface Reading { file: string; text: string; entries: Entry[]; status: Map<string, string[]>; twice: string[] }

const LISTED = /^(.+?)\s+([0-9a-f]{7,40})\s+(?:\[(.+)\]|\(detached HEAD\))((?:\s+(?:locked|prunable))*)$/;
const STATUS_OF = /^(?:\$ git -C (.+) status --porcelain|### (.+))$/;
const NEXT_OUTPUT = /^(?:\$ |## |### )/;
/** One line of `git status --porcelain`: two status letters, a space, a path. */
const ENTRY = /^[ MADRCUT?!]{2} \S/;
/** `git status` answering that the folder is no worktree of any repository. */
const NO_REPOSITORY = /^fatal: not a git repository/;

function read(file: string): Reading {
  let text = '';
  try { text = readFileSync(join(EVIDENCE, file), 'utf8'); } catch { /* not saved: no entries, reported below */ }
  const lines = text.split('\n');
  const entries: Entry[] = [];
  const status = new Map<string, string[]>();
  const twice: string[] = [];
  const list = lines.indexOf('$ git worktree list');
  for (let at = list + 1; list !== -1 && at < lines.length; at++) {
    const found = LISTED.exec(lines[at] ?? '');
    if (!found) break;
    entries.push({ path: found[1] ?? '', head: found[2] ?? '', branch: found[3] ?? null, prunable: /prunable/.test(found[4] ?? '') });
  }
  for (let at = 0; at < lines.length; at++) {
    const found = STATUS_OF.exec(lines[at] ?? '');
    const path = found?.[1] ?? found?.[2];
    if (path === undefined) continue;
    const output: string[] = [];
    for (let next = at + 1; next < lines.length && !NEXT_OUTPUT.test(lines[next] ?? ''); next++) if ((lines[next] ?? '') !== '') output.push(lines[next] ?? '');
    if (status.has(path)) twice.push(path);
    status.set(path, output);
  }
  return { file, text, entries, status, twice };
}

/**
 * A list entry git itself reports as no worktree at the before reading: `git worktree list` marks it prunable and
 * `git status` there answers "not a git repository". Dropping such an entry removes no worktree (README).
 */
const stale = (entry: Entry, output: readonly string[] | undefined): boolean =>
  entry.prunable && output !== undefined && output.length === 1 && NO_REPOSITORY.test(output[0] ?? '');

/** The cargo build folder's path, which the issue's scope has deleted as build output: not an edit. */
const buildOutput = (line: string): boolean => line === '?? target' || line === '?? target/';
const edits = (output: readonly string[]): string[] => output.filter((line) => ENTRY.test(line) && !buildOutput(line));
const unread = (output: readonly string[]): string[] => output.filter((line) => !ENTRY.test(line));
const some = (lines: readonly string[]): string => `${lines.slice(0, 3).map((line) => `\`${line}\``).join(', ')}${lines.length > 3 ? ` and ${lines.length - 3} more` : ''}`;

/** The saved worktree facts: one row per worktree, by the header's column names. */
function factsOf(file: string | null): Map<string, Record<string, string>[]> {
  const rows = new Map<string, Record<string, string>[]>();
  if (file === null) return rows;
  let lines: string[] = [];
  try { lines = readFileSync(join(EVIDENCE, file), 'utf8').split('\n'); } catch { return rows; }
  const head = lines.findIndex((line) => line.startsWith('$ worktree facts')) + 1;
  if (head === 0) return rows;
  const columns = (lines[head] ?? '').split(' | ');
  for (let at = head + 1; at < lines.length && (lines[at] ?? '').includes(' | '); at++) {
    const cells = (lines[at] ?? '').split(' | ');
    const row = Object.fromEntries(columns.map((name, i) => [name, cells[i] ?? '']));
    const name = (row.worktree ?? '').split('/').pop() ?? '';
    rows.set(name, [...(rows.get(name) ?? []), row]);
  }
  return rows;
}

/** Why the saved outputs don't show `entry`'s branch merged with no open PR; empty when they do. */
function openBranch(entry: Entry, facts: Map<string, Record<string, string>[]>, factsFile: string | null): string[] {
  if (entry.branch === null) return []; // a detached HEAD is on no branch
  const on = `it was on branch ${entry.branch} at ${entry.head}`;
  if (factsFile === null) return [`${on}, and no saved command output on this machine says whether that branch is merged or has an open PR`];
  const rows = facts.get(entry.path.split('/').pop() ?? '') ?? [];
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) return [`${on}, and ${factsFile}'s worktree facts hold ${rows.length} rows for it, not one: nothing saved says whether that branch is merged or has an open PR`];
  if (row.head !== entry.head || row.branch !== entry.branch) return [`${on}, but ${factsFile}'s worktree facts read it on ${row.branch} at ${row.head}: the facts are of another state, so nothing saved says whether ${entry.branch} is merged`];
  const prs = (row.PRs ?? '').split(/[\s,]+/).filter(Boolean);
  const open = prs.filter((pr) => /:OPEN\b/.test(pr));
  if (open.length) return [`${on}, an open branch: ${factsFile} reads its PRs as ${row.PRs}`];
  if (!prs.every((pr) => pr === '-' || /^\d+:(?:MERGED|CLOSED)(?::at-tip)?$/.test(pr))) return [`${on}, and ${factsFile} reads its PRs as "${row.PRs}", which says neither open nor merged`];
  if (row['HEAD in origin/main'] !== 'yes') return [`${on}, an open branch: ${factsFile} reads its head as not in origin/main ("${row['HEAD in origin/main']}"), so the branch is not merged`];
  return [];
}

function none(problems: readonly string[], what: string): void {
  expect(problems, `${what}:\n  ${problems.join('\n  ')}`).toEqual([]);
}

/** The before and after lists of worktrees are saved, each with `git status --porcelain` per worktree. */
function saved({ machine, before: beforeFile, after: afterFile }: Machine): void {
  const problems: string[] = [];
  const before = read(beforeFile);
  const after = read(afterFile);
  const remaining = new Set(after.entries.map(({ path }) => path));
  for (const reading of [before, after]) {
    const where = `docs/evidence/1112/${reading.file}`;
    if (reading.text === '') { problems.push(`${where} is missing or empty: that list of worktrees is not saved`); continue; }
    if (!reading.entries.length) { problems.push(`${where} holds no \`git worktree list\` output: that list of worktrees is not saved`); continue; }
    for (const path of reading.twice) problems.push(`${path}: ${where} holds two \`git status --porcelain\` outputs for it, so neither is its reading`);
    for (const entry of reading.entries) {
      const output = reading.status.get(entry.path);
      if (output === undefined) problems.push(`${entry.path}: ${where} lists it and saves no \`git status --porcelain\` for it`);
      else if (remaining.has(entry.path) && unread(output).length) problems.push(`${entry.path}: a remaining worktree whose \`git status --porcelain\` in ${where} is not a status: ${some(unread(output))}`);
    }
  }
  none(problems, `${machine}: the before and after lists of worktrees, with \`git status --porcelain\` per remaining worktree, are saved`);
}

/** No worktree on an open branch and no uncommitted edit was removed between the two lists. */
function kept({ machine, before: beforeFile, after: afterFile, facts: factsFile }: Machine): void {
  const problems: string[] = [];
  const before = read(beforeFile);
  const after = read(afterFile);
  const facts = factsOf(factsFile);
  if (!before.entries.length || !after.entries.length) problems.push(`docs/evidence/1112/${beforeFile} holds ${before.entries.length} listed worktrees and ${afterFile} ${after.entries.length}: with a list missing, nothing shows what was removed`);
  else for (const entry of before.entries) {
    const was = before.status.get(entry.path);
    const remains = after.entries.some(({ path }) => path === entry.path);
    if (remains) {
      const now = after.status.get(entry.path);
      const gone = edits(was ?? []).filter((line) => !(now ?? []).includes(line));
      if (now === undefined) problems.push(`${entry.path}: it remains, and ${afterFile} saves no \`git status --porcelain\` for it, so nothing shows its uncommitted edits were kept`);
      else if (gone.length) problems.push(`${entry.path}: it remains, but uncommitted edits in its \`git status --porcelain\` before are not in the one after: ${some(gone)}`);
      continue;
    }
    if (stale(entry, was)) continue;
    const removed = `${entry.path}: removed (in ${beforeFile}'s list, not in ${afterFile}'s)`;
    for (const why of openBranch(entry, facts, factsFile)) problems.push(`${removed}; ${why}`);
    if (was === undefined) problems.push(`${removed}; no \`git status --porcelain\` was saved for it before, so nothing shows it held no uncommitted edit`);
    else if (unread(was).length) problems.push(`${removed}; its \`git status --porcelain\` before is not a status (${some(unread(was))}) and git's list doesn't mark it prunable, so nothing shows it held no uncommitted edit`);
    else if (edits(was).length) problems.push(`${removed}; it held uncommitted edits: ${some(edits(was))}`);
  }
  none(problems, `${machine}: no worktree on an open branch and no uncommitted edit was removed`);
}

it(`${AC} Mac: the before and after lists of worktrees are saved, each with git status --porcelain per worktree`, () => saved(MAC));
it(`${AC} Mac: no worktree on an open branch and no uncommitted edit was removed between the two lists`, () => kept(MAC));
it(`${AC} Spark: the before and after lists of worktrees are saved, each with git status --porcelain per worktree`, () => saved(SPARK));
it(`${AC} Spark: no worktree on an open branch and no uncommitted edit was removed between the two lists`, () => kept(SPARK));
