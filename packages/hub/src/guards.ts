// The guard engine's install (#304; design: Before each command). `deep guard add <file>` hands the hub guard@1
// entries, each with a planted call it must deny and a twin it must allow, `{"v": 1, "entries": {<name>: guard@1},
// "proofs": {<name>: {"planted": <call>, "twin": <call>}}}`, or a list of them for an entry that reads more than one
// spelling of an effect, one pair for each (#1523). The hub runs deep-hook's check mode, the one
// matcher, over each pair; an entry whose planted call goes through, or whose twin is matched, is refused, naming it and the call.
// Then it rewrites rules.json with every installed entry, its mode included, and what each tool counts as, so
// deep-hook matches a call the same way with the hub up or down. The hub never reads an entry's `match` itself.
// A fail_closed entry that names a program or an effect class must also deny its planted call with the program
// computed by the line (#1097).
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isRecord as isObj, validate } from '@deepbuild/contracts';
import { callAsYou } from './client.js';
import { writeSynced } from './vfs.js';
import type { Plant } from './wire.js';

type Obj = Record<string, unknown>;
/** A call as a planted call or twin names it: the call fields of an agent's PreToolUse payload. */
interface Call { tool_name: string; tool_input: Obj; cwd?: string }
const isCall = (v: unknown): v is Call => isObj(v) && typeof v.tool_name === 'string' && isObj(v.tool_input);
/** A call as a person reads it: a shell call's command, or the tool and its input. */
const shown = (c: Call): string => (c.tool_name === 'Bash' && typeof c.tool_input.command === 'string' ? c.tool_input.command : `${c.tool_name} ${JSON.stringify(c.tool_input)}`);

/** A shell call with its program computed by the line, `"$(printf git)" push`; none for a call that runs no program. */
function computed(c: Call): Call | undefined {
  const command = c.tool_name === 'Bash' && typeof c.tool_input.command === 'string' ? c.tool_input.command : '';
  const found = /^((?:\s*\w+=\S*\s+)*)\s*([\w.+-]+)(?=\s|$)/.exec(command);
  if (!found) return undefined;
  return { ...c, tool_input: { ...c.tool_input, command: `${found[1]}"$(printf ${found[2]})"${command.slice(found[0].length)}` } };
}

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

/** Whether a block entry of `<dir>/rules.json` reads this shell command, by deep-hook's check mode: your rule reserves it. */
export async function blocksCall(dir: string, deepHook: string, command: string): Promise<boolean> {
  const read = JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8')) as { entries?: Obj; classes?: Obj };
  const blocks = Object.values(read.entries ?? {}).filter((e) => isObj(e) && e.mode === 'block');
  const said = await Promise.all(blocks.map((entry) => matches(deepHook, entry, { tool_name: 'Bash', tool_input: { command } }, read.classes ?? {}).catch(() => false)));
  return said.includes(true);
}

/**
 * The guard entries in `<dir>/rules.json` that name a rule they enforce (`proofs.<name>.rule`, #344) and pass their check
 * now: deep-hook's matcher denies the planted call and allows the twin. An entry that fails, or that can't be checked, is
 * left out, so its rule reads text only.
 */
export async function provenGuards(dir: string, deepHook: string): Promise<{ name: string; rule: string }[]> {
  let read: { entries?: Obj; proofs?: Obj; classes?: Obj };
  try { read = JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8')) as typeof read; } catch { return []; }
  const out: { name: string; rule: string }[] = [];
  for (const [name, proof] of Object.entries(read.proofs ?? {})) {
    const entry = read.entries?.[name];
    if (!isObj(entry) || !isObj(proof) || typeof proof.rule !== 'string' || !isCall(proof.planted) || !isCall(proof.twin)) continue;
    const classes = read.classes ?? {};
    const denied = await matches(deepHook, entry, proof.planted, classes).catch(() => false);
    const allowed = denied && !(await matches(deepHook, entry, proof.twin, classes).catch(() => true));
    if (allowed) out.push({ name, rule: proof.rule });
  }
  return out;
}

type Added = { status: 'installed'; names: string[] } | { status: 'refused'; reason: string };

/**
 * Installs `given`'s entries into `<dir>/rules.json` once each one's planted call matches and its twin doesn't,
 * by `deepHook`'s check mode with the classes rules.json will hold; otherwise refuses, naming the entry and the call,
 * and installs none of them.
 */
export async function addGuards(dir: string, given: unknown, o: { deepHook: string; classes: Obj; plant?: Plant | undefined }): Promise<Added> {
  // Only tests set it: the deep-hook whose check mode the install runs, such as a planted twin (#1097's AC4).
  o = { ...o, deepHook: process.env.DEEP_HUB_TEST_DEEP_HOOK || o.deepHook };
  const refused = (reason: string): Added => ({ status: 'refused', reason });
  if (!isObj(given) || !isObj(given.entries) || !Object.keys(given.entries).length) {
    return refused('Give a file of {"v": 1, "entries": {<name>: guard@1}, "proofs": {<name>: {"planted": <call>, "twin": <call>}}}.');
  }
  const proofs = isObj(given.proofs) ? given.proofs : {};
  for (const [name, entry] of Object.entries(given.entries)) {
    const checked = validate('guard@1', entry);
    if (!checked.ok) return refused(`${name} isn't a guard@1 entry: ${checked.issues[0]!.path} ${checked.issues[0]!.remediation}`);
    const proof = proofs[name];
    const pairs: unknown[] = Array.isArray(proof) ? proof : [proof];
    if (!pairs.length || !pairs.every((p) => isObj(p) && isCall(p.planted) && isCall(p.twin))) {
      return refused(`${name} ships no planted call it denies and twin it allows: give proofs.${name}.planted and proofs.${name}.twin, each {"tool_name", "tool_input"}, or a list of such pairs.`);
    }
    if (o.plant === 'installs-unchecked') continue;
    const match = String((entry as Obj).match);
    try {
      for (const { planted, twin } of pairs as { planted: Call; twin: Call }[]) {
        if (!(await matches(o.deepHook, entry, planted, o.classes))) return refused(`${name}: its planted call \`${shown(planted)}\` goes through its match ${match}, so it guards nothing.`);
        if (await matches(o.deepHook, entry, twin, o.classes)) return refused(`${name}: its twin \`${shown(twin)}\` is matched by ${match}, so it would deny a call it must allow.`);
        const form = (entry as Obj).fail_closed === true && /^(run|effect):/.test(match) ? computed(planted) : undefined;
        if (form && !(await matches(o.deepHook, entry, form, o.classes))) return refused(`${name}: its planted call with the program computed, \`${shown(form)}\`, goes through its match ${match}, so a line that computes the program gets past it.`);
      }
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
  const result = await callAsYou('guard.add', { guards }, 'nothing was added');
  if (typeof result === 'number') return result;
  process.stdout.write(`Added ${(result.names as string[]).join(', ')} to your rules\n`);
  return 0;
}
