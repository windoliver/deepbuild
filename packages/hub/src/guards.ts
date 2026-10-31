// The guard engine's install (#304; design: Before each command). `deep guard add <file>` hands the hub guard@1
// entries, each with a planted call it must deny and a twin it must allow, `{"v": 1, "entries": {<name>: guard@1},
// "proofs": {<name>: {"planted": <call>, "twin": <call>}}}`. The hub runs deep-hook's check mode, the one matcher,
// over both; an entry whose planted call goes through, or whose twin is matched, is refused, naming it and the call.
// Then it rewrites rules.json with every installed entry, its mode included, and what each tool counts as, so
// deep-hook matches a call the same way with the hub up or down. The hub never reads an entry's `match` itself.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validate } from '@deepbuild/contracts';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { writeSynced } from './vfs.js';
import { startOf, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A call as a planted call or twin names it: the call fields of an agent's PreToolUse payload. */
interface Call { tool_name: string; tool_input: Obj; cwd?: string }
const isCall = (v: unknown): v is Call => isObj(v) && typeof v.tool_name === 'string' && isObj(v.tool_input);
/** A call as a person reads it: a shell call's command, or the tool and its input. */
const shown = (c: Call): string => (c.tool_name === 'Bash' && typeof c.tool_input.command === 'string' ? c.tool_input.command : `${c.tool_name} ${JSON.stringify(c.tool_input)}`);

/** Whether deep-hook's matcher reads `c` under `entry`, through its check mode. */
function matches(deepHook: string, entry: unknown, c: Call, classes: Obj): Promise<boolean> {
  return new Promise((done, fail) => {
    const child = execFile(deepHook, ['check'], { timeout: 10_000 }, (error, stdout, stderr) => {
      let said: unknown;
      try { said = JSON.parse(stdout); } catch { /* not its line */ }
      if (!error && isObj(said) && typeof said.matched === 'boolean') done(said.matched);
      else fail(Error(`deep-hook's check mode couldn't read it: ${String(stderr).trim() || error?.message || stdout}`));
    });
    child.stdin!.end(JSON.stringify({ entry, call: c, classes }));
  });
}

export type Added = { status: 'installed'; names: string[] } | { status: 'refused'; reason: string };

/**
 * Installs `given`'s entries into `<dir>/rules.json` once each one's planted call matches and its twin doesn't,
 * by `deepHook`'s check mode with the classes rules.json will hold; otherwise refuses, naming the entry and the call,
 * and installs none of them.
 */
export async function addGuards(dir: string, given: unknown, o: { deepHook: string; classes: Obj; plant?: Plant | undefined }): Promise<Added> {
  const refused = (reason: string): Added => ({ status: 'refused', reason });
  if (!isObj(given) || !isObj(given.entries) || !Object.keys(given.entries).length) {
    return refused('Give a file of {"v": 1, "entries": {<name>: guard@1}, "proofs": {<name>: {"planted": <call>, "twin": <call>}}}.');
  }
  const proofs = isObj(given.proofs) ? given.proofs : {};
  for (const [name, entry] of Object.entries(given.entries)) {
    const checked = validate('guard@1', entry);
    if (!checked.ok) return refused(`${name} isn't a guard@1 entry: ${checked.issues[0]!.path} ${checked.issues[0]!.remediation}`);
    const proof = proofs[name];
    if (!isObj(proof) || !isCall(proof.planted) || !isCall(proof.twin)) {
      return refused(`${name} ships no planted call it denies and twin it allows: give proofs.${name}.planted and proofs.${name}.twin, each {"tool_name", "tool_input"}.`);
    }
    if (o.plant === 'installs-unchecked') continue;
    const match = String((entry as Obj).match);
    try {
      if (!(await matches(o.deepHook, entry, proof.planted, o.classes))) return refused(`${name}: its planted call \`${shown(proof.planted)}\` goes through its match ${match}, so it guards nothing.`);
      if (await matches(o.deepHook, entry, proof.twin, o.classes)) return refused(`${name}: its twin \`${shown(proof.twin)}\` is matched by ${match}, so it would deny a call it must allow.`);
    } catch (error) {
      return refused(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Read, merged and written in one step, so two installs never lose each other's entries.
  const file = join(dir, 'rules.json');
  let current: Obj = { entries: {} };
  try {
    current = JSON.parse(readFileSync(file, 'utf8')) as Obj;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return refused(`${file} can't be read (${error instanceof Error ? error.message : String(error)}); fix or remove it, then add again.`);
  }
  if (!isObj(current.entries)) return refused(`${file} has no entries object; fix or remove it, then add again.`);
  let entries: Obj = { ...current.entries, ...given.entries };
  // The planted wrong program for AC3 writes only the fail_closed entries.
  if (o.plant === 'fail-closed-only-rules') entries = Object.fromEntries(Object.entries(entries).filter(([, e]) => isObj(e) && e.fail_closed === true));
  const kept = isObj(current.proofs) ? current.proofs : {};
  const names = Object.keys(given.entries);
  const rules = { v: 1, entries, proofs: { ...kept, ...Object.fromEntries(names.map((n) => [n, proofs[n]])) }, classes: o.classes, ...(Array.isArray(current.standing) ? { standing: current.standing } : {}) };
  writeSynced(file, Buffer.from(`${JSON.stringify(rules, null, 2)}\n`));
  return { status: 'installed', names };
}

/**
 * Rewrites `<dir>/rules.json` with the members `change` returns, keeping every other, and only when it returns some. No
 * rules.json, or one deep-hook can't read either, has nothing to change.
 */
function rewriteRules(dir: string, change: (current: Obj & { entries: Obj }) => Obj | undefined): void {
  const file = join(dir, 'rules.json');
  let current: Obj;
  try {
    current = JSON.parse(readFileSync(file, 'utf8')) as Obj;
  } catch {
    return;
  }
  const changed = isObj(current.entries) ? change(current as Obj & { entries: Obj }) : undefined;
  if (changed) writeSynced(file, Buffer.from(`${JSON.stringify({ ...current, ...changed }, null, 2)}\n`));
}

/**
 * Copies your standing rules for cloud resources into `<dir>/rules.json` (#23), keeping every other member, so
 * deep-hook lets a call one covers through with the hub down. Written only when they changed.
 */
export function writeStanding(dir: string, standing: readonly unknown[]): void {
  rewriteRules(dir, (current) => (JSON.stringify(current.standing ?? []) === JSON.stringify(standing) ? undefined : { standing }));
}

/** Takes the entries `drops` names out of `<dir>/rules.json` (#111), keeping every other. */
export function dropEntries(dir: string, drops: (name: string) => boolean): void {
  rewriteRules(dir, ({ entries }) => (Object.keys(entries).some(drops) ? { entries: Object.fromEntries(Object.entries(entries).filter(([name]) => !drops(name))) } : undefined));
}

/** Copies the directions you rejected into `<dir>/rules.json` as `rejected-*` entries (#111), keeping every other. */
export function writeRejected(dir: string, rejected: Obj): void {
  rewriteRules(dir, (current) => {
    const entries = { ...Object.fromEntries(Object.entries(current.entries).filter(([name]) => !name.startsWith('rejected-'))), ...rejected };
    return JSON.stringify(Object.entries(entries).sort()) === JSON.stringify(Object.entries(current.entries).sort()) ? undefined : { entries };
  });
}

const USAGE = 'Usage: deep guard add <file>';
/** Refusals that leave nothing added and nothing decided: not confirmed, an agent's command, or a hub that couldn't. */
const UNDECIDED_CODES = new Set(['unconfirmed', 'role', 'unavailable']);

/** `deep guard add <file>`: exit 0 added, 1 refused, 2 a usage error, 3 not decided. */
export async function guardCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 2 || args[0] !== 'add') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const from = resolve(args[1]!);
  let guards: unknown;
  try {
    guards = JSON.parse(readFileSync(from, 'utf8'));
  } catch (error) {
    process.stderr.write(`deep guard add: ${from} isn't readable JSON (${error instanceof Error ? error.message : String(error)})\n`);
    return 2;
  }
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    reply = await call(hubAddress().path, token, 'guard.add', { guards }, { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}; nothing was added\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return UNDECIDED_CODES.has(reply.error.code) ? 3 : 2;
  }
  if (reply.result.status === 'refused') {
    process.stderr.write(`REFUSED: ${String(reply.result.reason)}\n`);
    return 1;
  }
  process.stdout.write(`Added ${(reply.result.names as string[]).join(', ')} to your rules\n`);
  return 0;
}
