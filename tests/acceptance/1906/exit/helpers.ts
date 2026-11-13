// What the #1906 exit tests stand on (README): the hub's built modules as the core's thread loads them, a real git
// repository, stand-ins for `git` and `ps` on PATH that run the real program and then hold at their own exit until
// this thread has read children.ts's tables, and that reading, taken from children.ts's own module scope through
// V8's inspector, so no export is asked of it.
import { execFileSync } from 'node:child_process';
import { accessSync, closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { Session } from 'node:inspector';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const DIST = new URL('../../../../packages/hub/dist/', import.meta.url);
type Hub = {
  children: typeof import('../../../../packages/hub/src/children.ts');
  facts: typeof import('../../../../packages/hub/src/session-facts.ts');
  openItems: typeof import('../../../../packages/hub/src/open-items.ts');
  scope: typeof import('../../../../packages/hub/src/scope.ts');
  /** children.ts as built: the file whose module scope holds its tables. */
  childrenFile: string;
};
/**
 * The hub's modules that start children for the core, from the hub's build: children.ts starts its thread from
 * children-worker.js beside its own module, which only the build writes.
 */
export async function hub(): Promise<Hub> {
  for (const f of ['children.js', 'children-worker.js', 'session-facts.js', 'open-items.js', 'scope.js']) {
    if (!existsSync(new URL(f, DIST))) throw Error(`BLOCKED: packages/hub/dist/${f} is missing; build first: npm run build --workspaces`);
  }
  const load = (f: string) => import(new URL(f, DIST).href) as Promise<never>;
  return { children: await load('children.js'), facts: await load('session-facts.js'), openItems: await load('open-items.js'), scope: await load('scope.js'), childrenFile: fileURLToPath(new URL('children.js', DIST)) };
}

/** Where a program is on PATH, found without starting a process. */
function which(name: string): string {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const path = join(dir, name);
    try { accessSync(path, constants.X_OK); return path; } catch { /* the next folder */ }
  }
  throw Error(`BLOCKED: no ${name} on PATH`);
}

export interface World {
  dir: string;
  repo: string;
  /** The stand-ins' notes: `<pid>.exiting` as a child reaches its exit, and `<pid>.gate`, the pipe it waits on for this thread's reading. */
  marks: string;
  /** The repository's commits, oldest first: `base`, then `feat: 1`, `fix: 1`, `feat: 2`. */
  commits: string[];
  /** The real git, by path: what builds the repository, never through the stand-in. */
  git(...args: string[]): string;
  close(): void;
}
/** How many seconds a stand-in holds at its exit for this thread before it gives up and says so (`<pid>.unseen`). */
const HOLD_S = 3;
/**
 * A repository with four commits (every `feat` adds one file of 2 lines, every `fix` one of 3) and a working tree that
 * leaves a placeholder in a tracked file and in an untracked one, and PATH led by the stand-ins for `git` and `ps`.
 */
export function world(): World {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh1906-')));
  const bin = join(dir, 'bin');
  const marks = join(dir, 'marks');
  const repo = join(dir, 'repo');
  for (const d of [bin, marks, repo]) mkdirSync(d);
  const real = { git: which('git'), ps: which('ps') };
  for (const [name, path] of Object.entries(real)) {
    // The real program runs first, on the same streams; then the stand-in notes that it is at its exit, with its
    // parent and its command, and holds until this thread answers, so the tables are read while it is still a process.
    writeFileSync(join(bin, name), [
      '#!/bin/bash',
      `m='${marks}'/$$`,
      `'${path}' "$@"`,
      's=$?',
      `{ printf '%s\\n' "$PPID"; printf '%s ' '${name}' "$@"; } > "$m.note"`,
      'mkfifo "$m.gate" && exec 3<>"$m.gate"',
      ': > "$m.exiting"',
      `read -t ${HOLD_S} -u 3 go || : > "$m.unseen"`,
      'exit "$s"',
      '',
    ].join('\n'), { mode: 0o755 });
  }
  const before = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${before ?? ''}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const git = (...args: string[]) => execFileSync(real.git, ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@example.test', ...args], { cwd: repo, encoding: 'utf8', env }).trim();
  git('init', '-q', '-b', 'main', repo);
  const commit = (subject: string, file: string, text: string) => {
    writeFileSync(join(repo, file), text);
    git('add', '-A');
    git('commit', '-q', '-m', subject);
    return git('rev-parse', 'HEAD');
  };
  const commits = [commit('base', 'a.js', 'a\n'), commit('feat: 1', 'f1.js', 'x\ny\n'), commit('fix: 1', 'b1.js', 'x\ny\nz\n'), commit('feat: 2', 'f2.js', 'x\ny\n')];
  writeFileSync(join(repo, 'a.js'), 'a\n// TODO: wire the retry\n');
  writeFileSync(join(repo, 'notes.js'), '// FIXME: name the owner\n');
  return { dir, repo, marks, commits, git, close: () => { process.env.PATH = before; rmSync(dir, { recursive: true, force: true }); } };
}

/** The entries of each table in children.ts's module scope, by the table's name: one name per entry. */
export type Reading = Record<string, string[]>;
/** An entry's name: a primitive by its type and value, an object by a number it keeps for as long as it lives. */
const KEYS = `function () {
  const ids = (globalThis.__dh1906 ??= { of: new WeakMap(), n: 0 });
  const name = (k) => ((typeof k === 'object' && k !== null) || typeof k === 'function'
    ? 'object#' + (ids.of.get(k) ?? (ids.of.set(k, ++ids.n), ids.n)) : typeof k + ':' + String(k));
  return [...(this instanceof Map ? this.keys() : this.values())].map(name);
}`;
type Remote = { type: string; subtype?: string; objectId?: string; description?: string };
type Props = { result: { name: string; value?: Remote }[]; internalProperties?: { name: string; value?: Remote }[]; privateProperties?: { name: string; value?: Remote }[] };
const COLLECTION = new Set(['map', 'set', 'array']);

/**
 * children.ts's tables, read where they are: every Map, Set and array a top-level name of children.ts holds, or that
 * an object such a name holds keeps in a field of its own. The names come from the built file's syntax tree; the
 * values from the scope its exported functions close over, through the inspector. Nothing is asked of the module but
 * that its table is one of those.
 */
export function tables(module: object, file: string): { read(): Reading; close(): void } {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const own = new Set<string>();
  for (const s of source.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) own.add(d.name.text);
    if (ts.isClassDeclaration(s) && s.name) own.add(s.name.text);
  }
  const session = new Session();
  session.connect();
  const post = <T>(method: string, params: object): T => {
    let out: T | undefined;
    let failed: Error | null | undefined;
    session.post(method, params, (error, result) => { failed = error; out = result as T; });
    if (failed) throw failed;
    if (out === undefined) throw Error(`BLOCKED: the inspector did not answer ${method} at once`);
    return out;
  };
  const props = (objectId: string) => post<Props>('Runtime.getProperties', { objectId, ownProperties: true });
  const slot = '__dh1906module';
  const read = (): Reading => {
    (globalThis as Record<string, unknown>)[slot] = module;
    const found = new Map<string, string>();
    const take = (name: string, v: Remote | undefined, deep: boolean) => {
      if (!v?.objectId || found.has(name)) return;
      if (COLLECTION.has(v.subtype ?? '')) found.set(name, v.objectId);
      else if (deep && v.type === 'object' && !v.subtype) {
        const p = props(v.objectId);
        for (const f of [...p.result, ...(p.privateProperties ?? [])]) take(`${name}.${f.name}`, f.value, false);
      }
    };
    for (const name of Object.keys(module)) {
      // Each exported function, by its name: a module's namespace gives its exports through getters.
      const exported = post<{ result: Remote }>('Runtime.evaluate', { expression: `globalThis.${slot}[${JSON.stringify(name)}]` }).result;
      if (exported.type !== 'function' || !exported.objectId) continue;
      const scopes = props(exported.objectId).internalProperties?.find((p) => p.name === '[[Scopes]]')?.value;
      if (!scopes?.objectId) continue;
      for (const scope of props(scopes.objectId).result) {
        if (!scope.value?.objectId || /^(Global|Script)/.test(scope.value.description ?? '')) continue;
        for (const variable of props(scope.value.objectId).result) if (own.has(variable.name)) take(variable.name, variable.value, true);
      }
    }
    const reading: Reading = {};
    for (const [name, objectId] of found) {
      reading[name] = post<{ result: { value: string[] } }>('Runtime.callFunctionOn', { objectId, functionDeclaration: KEYS, returnByValue: true }).result.value;
    }
    return reading;
  };
  return { read, close: () => { delete (globalThis as Record<string, unknown>)[slot]; session.disconnect(); } };
}

/** One child this process started, as it was at its own exit. */
export interface Child {
  pid: number;
  command: string;
  /** Whether this thread read the tables while the child held at its exit, still a process. */
  held: boolean;
  /** The tables then. */
  at: Reading;
  /** The entry that is this child's: one the tables did not hold before the call, and that no earlier child of the call took. */
  entry: string | undefined;
}
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

/**
 * Runs one call of the core's and reads children.ts's tables at the exit of every child this process starts
 * meanwhile: each stand-in notes that it is at its exit and holds; this thread reads the tables, then lets it go.
 * A child whose entry is in a table then has an entry the tables did not hold before the call, its own.
 */
export async function watched<T>(w: World, table: { read(): Reading }, call: () => Promise<T>): Promise<{ result: T; children: Child[] }> {
  for (const f of readdirSync(w.marks)) rmSync(join(w.marks, f));
  const before = table.read();
  const children: Child[] = [];
  const done = new Set<string>();
  const sweep = () => {
    for (const f of readdirSync(w.marks)) {
      const note = /^(\d+)\.(exiting|unseen)$/.exec(f);
      if (!note || done.has(f)) continue;
      done.add(f);
      const pid = Number(note[1]);
      const [parent, command] = readFileSync(join(w.marks, `${pid}.note`), 'utf8').split('\n');
      const mine = Number(parent) === process.pid;
      if (note[2] === 'unseen') {
        // It left before this thread could read: the thread was held for the child's whole life.
        if (mine && !children.some((c) => c.pid === pid)) children.push({ pid, command: command!.trim(), held: false, at: {}, entry: undefined });
        continue;
      }
      if (mine) children.push({ pid, command: command!.trim(), held: alive(pid), at: table.read(), entry: undefined });
      // Its pipe is open at its end by now; one that is gone has no reader, and nothing to let go.
      try { const gate = openSync(join(w.marks, `${pid}.gate`), constants.O_WRONLY | constants.O_NONBLOCK); writeSync(gate, 'go\n'); closeSync(gate); } catch { /* gone */ }
    }
  };
  let settled = false;
  const running = call().finally(() => { settled = true; });
  running.catch(() => undefined);
  while (!settled) {
    sweep();
    await new Promise((r) => setTimeout(r, 1));
  }
  sweep();
  const taken = new Set<string>();
  for (const c of children) {
    const fresh = Object.entries(c.at).flatMap(([name, keys]) => keys.filter((k) => !before[name]?.includes(k)).map((k) => `${name}[${k}]`)).filter((k) => !taken.has(k));
    c.entry = c.held ? fresh[0] : undefined;
    if (c.entry) taken.add(c.entry);
  }
  return { result: await running, children };
}

/** The children of a call that were in no table of children.ts at their exit, each in words; none is the criterion. */
export const outside = (children: Child[]): string[] => children.filter((c) => !c.entry).map((c) => (c.held
  ? `${c.command} (pid ${c.pid}) was at its exit, in no table of children.ts: ${JSON.stringify(c.at)}`
  : `${c.command} (pid ${c.pid}) ran with the starting thread held, so no table could be read at its exit`));
