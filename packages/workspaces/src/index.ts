// Workspaces (#67; design: Work outside a repo): the state sources DeepBuild ships and a workspace's git work, with no
// hub in them. A source only reads and says how to undo: `undo` answers a plan for someone to carry out, or that it
// can't, so nothing here changes a host. Each source brings the fixture its kit makes and undoes changes on, since a kit
// can't change a real host. Git runs with an identity of its own, so a person never sets one up.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { StateChange, StateDiff, StateItem, StatePlan, StateSource, StateSourceFill, StateUndo } from '@deepbuild/conformance';

const run = promisify(execFile);
/** Where a workspace names itself and what it touches, under the guard every `.deepbuild/` is. */
export const WORKSPACE_FILE = '.deepbuild/workspace.json';
/** What a workspace touches: an ID, the state source that reads it and that source's settings. */
export interface Touch { id: string; source: string; [setting: string]: unknown }
export interface WorkspaceFile { id: string; name: string; touches: Touch[] }
type Items = Record<string, JsonValue>;
type Source = Omit<StateSource, 'fixture'>;

const text = (bytes: Uint8Array | string): string => sha256Hex(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
const itemsOf = (values: Items): StateItem[] => Object.keys(values).sort().map((id) => ({ id, value: values[id]! }));
const compare = (item: StateItem, expected: JsonValue): StateDiff => {
  const same = sha256Hex(canonicalize(item.value)) === sha256Hex(canonicalize(expected));
  return { item: item.id, changed: same ? [] : [{ what: item.id, was: expected, now: item.value }] };
};
const planOf = (change: StateChange, does: string, again: string): StatePlan => ({
  steps: [{ does, changes: [change.item], undo: again, public: false, cost: 0 }], diff: sha256Hex(canonicalize(change as unknown as JsonValue)),
});
/** Undo for a thing whose value can be set back: only one that had a value to go back to. */
const setBack = (change: StateChange): StateUndo => (change.was === null
  ? { cannot: `${change.item} had no earlier value to go back to` }
  : { plan: planOf(change, `Set ${change.item} back to ${String(change.was)}`, `Set ${change.item} to ${String(change.to)}`) });

/** A reading's identity: the digest of its items, whatever read them, and the bytes the evidence store keeps it as. */
export function reading(items: readonly StateItem[]): { digest: string; bytes: Uint8Array } {
  const bytes = canonicalize([...items].sort((a, b) => (a.id < b.id ? -1 : 1)) as unknown as JsonValue);
  return { digest: sha256Hex(bytes), bytes };
}
/** Each item that differs from what was read then, through the source's own compare. */
export async function diffOf(source: Pick<Source, 'compare'>, then: readonly StateItem[], now: readonly StateItem[]): Promise<{ item: string; was: JsonValue; now: JsonValue }[]> {
  const ids = [...new Set([...then, ...now].map((i) => i.id))].sort();
  const out: { item: string; was: JsonValue; now: JsonValue }[] = [];
  // Each ID's first item, as `find` would give it, looked up once per reading and not once per ID.
  const firstOf = (items: readonly StateItem[]): Map<string, StateItem> => {
    const first = new Map<string, StateItem>();
    for (const item of items) if (!first.has(item.id)) first.set(item.id, item);
    return first;
  };
  const [was, is] = [firstOf(then), firstOf(now)];
  for (const id of ids) {
    const item = is.get(id) ?? { id, value: null };
    const diff = await source.compare(item, was.get(id)?.value ?? null);
    for (const c of diff.changed) out.push({ item: diff.item, was: c.was, now: c.now });
  }
  return out;
}

/** The plan of a change through a source: `step`, with the undo its source gives, or none, which the asks core shows as "can't undo". */
export async function changePlan(source: Pick<StateSource, 'undo'>, change: StateChange, step: { does: string; changes: string[]; public: boolean; cost: number }): Promise<StatePlan> {
  const undo = await source.undo(change);
  return { steps: [{ ...step, undo: 'plan' in undo ? undo.plan.steps[0]?.does ?? null : null }], diff: sha256Hex(canonicalize(change as unknown as JsonValue)) };
}

// ---- Git, for a workspace's own work.

const IDENTITY = ['-c', 'user.name=DeepBuild', '-c', 'user.email=workspace@deepbuild.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false'];
const gitEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_TERMINAL_PROMPT: '0' });
async function git(folder: string, args: string[]): Promise<string> {
  return (await run('git', [...IDENTITY, '-C', folder, ...args], { env: gitEnv(), maxBuffer: 64 * 1024 * 1024 })).stdout.trim();
}
/** Commits everything in the folder, when anything changed. Answers whether it did. */
export async function keepWork(folder: string, message: string): Promise<boolean> {
  await git(folder, ['add', '-A']);
  if (!(await git(folder, ['status', '--porcelain']))) return false;
  await git(folder, ['commit', '-q', '-m', message]);
  return true;
}
/** A new workspace in `folder`: a repo with its first commit, naming itself. */
export async function makeWorkspace(folder: string, file: WorkspaceFile): Promise<void> {
  mkdirSync(join(folder, dirname(WORKSPACE_FILE)), { recursive: true });
  writeFileSync(join(folder, WORKSPACE_FILE), `${JSON.stringify(file, null, 2)}\n`);
  await run('git', ['init', '-q', '-b', 'main', folder], { env: gitEnv() });
  await keepWork(folder, 'Start the workspace');
}
export const workspaceFile = (folder: string): WorkspaceFile => JSON.parse(readFileSync(join(folder, WORKSPACE_FILE), 'utf8')) as WorkspaceFile;
/** Undoes one commit as a new one on top. One that later work conflicts with is refused, leaving the folder as it was. */
export async function revertCommit(folder: string, commit: string): Promise<string> {
  try {
    await git(folder, ['revert', '--no-edit', commit]);
  } catch (error) {
    await git(folder, ['revert', '--abort']).catch(() => undefined);
    throw Error(`${commit} doesn't revert cleanly: ${String((error as Error).message).split('\n')[0]}`);
  }
  return git(folder, ['rev-parse', 'HEAD']);
}
/** What the file at `path` was renamed to since `base`, by git's own history; undefined when it wasn't. */
export async function renamedSince(folder: string, base: string, path: string): Promise<string | undefined> {
  const lines = (await git(folder, ['diff', '-M', '--name-status', '-z', base]).catch(() => '')).split('\0');
  for (let i = 0; i < lines.length; i++) if (/^R\d+$/.test(lines[i]!) && lines[i + 1] === path) return lines[i + 2];
  return undefined;
}

// ---- The sources. Each reads the one thing a touch names; `live` is what a fixture stands in for.

async function gitItems(folder: string): Promise<StateItem[]> {
  const paths = (await git(folder, ['ls-files', '-co', '--exclude-standard', '-z'])).split('\0').filter(Boolean).sort();
  return paths.flatMap((id) => (existsSync(join(folder, id)) ? [{ id, value: text(readFileSync(join(folder, id))) }] : []));
}
function gitSource(folder: () => string): Source {
  return {
    read: () => gitItems(folder()), compare,
    async undo(change) {
      const commit = await git(folder(), ['log', '-1', '--format=%H', '--', change.item]);
      return commit ? { plan: planOf(change, `Revert ${commit}, which changed ${change.item}`, `Revert the revert of ${commit}`) } : { cannot: `${change.item} was never kept in the workspace's history` };
    },
  };
}
function hostItems(log: string): Items {
  const values: Items = {};
  for (const line of readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
    const change = JSON.parse(line) as { item: string; value: JsonValue };
    values[change.item] = change.value;
  }
  return values;
}
const hostSource = (log: () => string): Source => ({ read: () => itemsOf(hostItems(log())), compare, undo: setBack });
const apiSource = (load: () => Items | Promise<Items>): Source => ({ read: async () => itemsOf(await load()), compare, undo: setBack });
/** A document by its versions: each read keeps what it found under its digest, so a value read once can come back. */
function documentSource(path: () => string, versions: () => string): Source {
  return {
    read() {
      const bytes = readFileSync(path());
      const value = text(bytes);
      mkdirSync(versions(), { recursive: true });
      if (!existsSync(join(versions(), value))) writeFileSync(join(versions(), value), bytes);
      return [{ id: basename(path()), value }];
    },
    compare,
    undo: (change) => (existsSync(join(versions(), String(change.was)))
      ? { plan: planOf(change, `Restore ${change.item} from its version ${String(change.was)}`, `Restore ${change.item} from its version ${String(change.to)}`) }
      : { cannot: `no version of ${change.item} was kept from before this change` }),
  };
}

/** The source a touch names among the shipped four, on that touch's settings; undefined for any other, a plug-in's. */
export function sourceOf(touch: Touch, folder: string): Source | undefined {
  const setting = (name: string): string => {
    const value = touch[name];
    if (typeof value !== 'string' || !value) throw Error(`the touch ${touch.id} names no ${name} for its ${touch.source} source`);
    return value;
  };
  if (touch.source === 'git') return gitSource(() => folder);
  if (touch.source === 'host') return hostSource(() => setting('log'));
  if (touch.source === 'document') return documentSource(() => setting('path'), () => setting('versions'));
  if (touch.source !== 'api') return undefined;
  return apiSource(async () => {
    const answer = await fetch(setting('url'), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!answer.ok) throw Error(`the touch ${touch.id} answered ${answer.status}`);
    return await answer.json() as Items;
  });
}

// ---- The shipped sources as fills: each one's own fixture, in a temporary folder or in memory.

const fill = (name: string, source: Source, fixture: StateSourceFill['fixture']): StateSourceFill => ({ slot: 'state-source@1', revision: 1, name, ...source, fixture });
const scratch = (name: string): string => mkdtempSync(join(tmpdir(), `deep-${name}-`));

function gitFill(): StateSourceFill {
  let dir = '';
  const write = (path: string, body: string): void => writeFileSync(join(dir, path), body);
  const changes: StateChange[] = [
    { id: 'edit-note', item: 'note.md', was: text('one\n'), to: text('two\n') },
    { id: 'new-scratch', item: 'scratch.md', was: null, to: text('scratch\n') },
  ];
  return fill('git', gitSource(() => dir), {
    async start() {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = scratch('state-git');
      await makeWorkspace(dir, { id: 'fixture', name: 'fixture', touches: [] });
      write('note.md', 'one\n');
      await keepWork(dir, 'A note');
      return changes;
    },
    // A kept file's change is a commit; a new file stays out of the history, so nothing can take it back.
    async make(change) {
      if (change.id === 'new-scratch') return write('scratch.md', 'scratch\n');
      write('note.md', 'two\n');
      await keepWork(dir, 'Change the note');
    },
    async run() { await revertCommit(dir, 'HEAD'); },
  });
}
function hostFill(): StateSourceFill {
  let log = '';
  const append = (item: string, value: JsonValue): void => writeFileSync(log, `${JSON.stringify({ id: `c-${item}`, item, value })}\n`, { flag: 'a' });
  return fill('host', hostSource(() => log), {
    start() {
      log = join(scratch('state-host'), 'changes.jsonl');
      writeFileSync(log, '');
      append('port', 80);
      return [{ id: 'set-port', item: 'port', was: 80, to: 8080 }, { id: 'add-flag', item: 'flag', was: null, to: true }];
    },
    make: (change) => append(change.item, change.to),
    run: (change) => append(change.item, change.was),
  });
}
function apiFill(): StateSourceFill {
  let snapshot: Items = {};
  return fill('api', apiSource(() => snapshot), {
    start() {
      snapshot = { plan: 'team' };
      return [{ id: 'set-plan', item: 'plan', was: 'team', to: 'solo' }, { id: 'add-seat', item: 'seats', was: null, to: 3 }];
    },
    make(change) { snapshot = { ...snapshot, [change.item]: change.to }; },
    run(change) { snapshot = { ...snapshot, [change.item]: change.was }; },
  });
}
function documentFill(): StateSourceFill {
  let dir = '';
  const path = (): string => join(dir, 'doc.md');
  const versions = (): string => join(dir, 'versions');
  return fill('document', documentSource(path, versions), {
    start() {
      dir = scratch('state-document');
      writeFileSync(path(), 'one\n');
      return [
        { id: 'rewrite', item: 'doc.md', was: text('one\n'), to: text('two\n') },
        { id: 'from-unkept', item: 'doc.md', was: text('never read\n'), to: text('three\n') },
      ];
    },
    make: (change) => writeFileSync(path(), change.id === 'rewrite' ? 'two\n' : 'three\n'),
    run: (change) => copyFileSync(join(versions(), String(change.was)), path()),
  });
}
/** The state sources DeepBuild ships first, as fills, each with its fixture. */
export function shippedSources(): StateSourceFill[] {
  return [gitFill(), hostFill(), apiFill(), documentFill()];
}
