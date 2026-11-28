import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { maskIn } from './mask.js';
import { targetBody } from './own.js';

export interface DefinitionParts {
  task_ref: string;
  requirements: { id: string; text: string; check: string | null }[];
  deliverables: string[];
  files: Record<string, string>;
}
export interface Lock { hash: string; parts: Record<string, string> }

const digest = (v: unknown): string => sha256Hex(canonicalize(v as JsonValue));
function partsOf(d: DefinitionParts): Record<string, string> {
  const parts: Record<string, string> = { task_ref: digest(d.task_ref), deliverables: digest([...d.deliverables].sort()) };
  for (const r of d.requirements) parts[`requirement:${r.id}`] = digest(r);
  for (const [path, bytes] of Object.entries(d.files)) parts[`file:${path}`] = sha256Hex(new TextEncoder().encode(bytes));
  return parts;
}
const hashOf = (parts: Record<string, string>): string => digest(Object.fromEntries(Object.entries(parts).sort(([a], [b]) => (a < b ? -1 : 1))));

/** The locked hash and each part's digest, so a later difference names what changed. */
export function lockDefinition(definition: DefinitionParts): Lock {
  const parts = partsOf(definition);
  return { hash: hashOf(parts), parts };
}
/** The hash recomputed from the definition as it reads now, and the part keys that differ from the lock. */
export function recomputeHash(definition: DefinitionParts, locked: Lock): { same: boolean; hash: string; changed: string[] } {
  const parts = partsOf(definition);
  const hash = hashOf(parts);
  const keys = [...new Set([...Object.keys(parts), ...Object.keys(locked.parts)])];
  const changed = hash === locked.hash ? [] : keys.filter((k) => parts[k] !== locked.parts[k]);
  return { same: hash === locked.hash, hash, changed };
}

export interface SessionRun { command: string; exit_status: number | null; output: string }
export interface SessionLog { read: string[]; ran: SessionRun[]; links?: string[] }
export interface Finding {
  kind: 'definition_hash' | 'deliverable' | 'file' | 'line' | 'test' | 'run' | 'link' | 'masked_exit';
  ref: string;
  why: string;
  mask?: string;
  changed?: string[];
}
export interface FloorInput {
  claim: { claim: string; message: string };
  checkout: string;
  definition: DefinitionParts;
  locked: Lock;
  session: SessionLog;
}
export type FloorResult = { ok: true } | { ok: false; action: 'send_back' | 'INVALID'; findings: Finding[]; claim: string };
type FloorPlant = 'run-happened-only' | 'leaves-to-done-gate' | 'no-deliverable-check' | 'no-read-check';

/**
 * A run as the agent typed it: deep-hook rewrites a heavy command into `deep lease [kinds] -- <command>`, or through
 * `/bin/sh -c '<command>'` when it isn't one plain command (#1015), and the record keeps the rewritten one.
 */
function typed(command: string): string {
  const leased = /^deep lease (?:[\w-]+ )*-- (.*)$/s.exec(command);
  if (!leased) return command;
  const sh = /^\/bin\/sh -c '((?:[^']|'\\'')*)'$/s.exec(leased[1]!);
  return sh ? sh[1]!.replace(/'\\''/g, "'") : leased[1]!;
}

/** A repo-relative path inside the checkout, or null for one that leaves it. */
function inside(checkout: string, path: string): string | null {
  if (isAbsolute(path)) return null;
  const p = normalize(path);
  return p.startsWith('..') ? null : join(checkout, p);
}
const isFile = (path: string | null): boolean => {
  try { return path !== null && statSync(path).isFile(); } catch { return false; }
};
/** The package script, Makefile or justfile target a command runs, read from the checkout: what it really runs. */
function scriptOf(checkout: string, command: string): string | null {
  const [tool, sub, name] = command.trim().split(/\s+/);
  if (!tool || !sub) return null;
  const read = (file: string, target: string): string | null => {
    try { const body = targetBody(file, readFileSync(join(checkout, file), 'utf8'), target); return typeof body === 'string' ? body : null; } catch { return null; }
  };
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(tool)) {
    const target = sub === 'run' || sub === 'run-script' ? name : sub;
    return target ? read('package.json', target) : null;
  }
  if (tool !== 'make' && tool !== 'just') return null;
  const file = ['Makefile', 'makefile', 'justfile', 'Justfile'].find((f) => isFile(join(checkout, f)));
  const rules = file ? read(file, sub) : null;
  return rules === null ? null : rules.split('\n').filter((l) => l !== l.trimStart()).map((l) => l.trim()).join('\n') || null;
}
/** The mask a cited run's command, or the script it runs, hides its exit status with. */
function maskOf(checkout: string, command: string): string | null {
  return maskIn(command) ?? ((script) => (script === null ? null : maskIn(script)))(scriptOf(checkout, command));
}

const LINK = /^https?:\/\/\S+$|^[\w./@-]+#[\w-]+$/;
const TEST = /^(.+?)\s+›\s+(.+)$/;
const FILE_LINE = /^([\w./@-]+?)(?::(\d+))?$/;

/** A final message's cites. Inline ones only: a fenced block is code shown, never a cite, and its backticks would pair with the next inline one. */
function citesOf(message: string): string[] {
  const prose = message.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*|$)/gm, '');
  return [...prose.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim()).filter(Boolean);
}
/**
 * The paths the validity gate may read of a claim's checkout: each deliverable, each file a cite names, and the files
 * a cited run's script is read from. What a checkout on another machine (#999) brings here for the gate to read.
 */
export function validityReads(input: Pick<ValidityInput, 'claim' | 'deliverables'>): string[] {
  const cited = citesOf(input.claim.message).flatMap((cite) => [TEST.exec(cite)?.[1], FILE_LINE.exec(cite)?.[1], LINK.test(cite) && !/^https?:/.test(cite) ? cite.replace(/#.*$/, '') : undefined]);
  return [...new Set([...input.deliverables, 'package.json', 'Makefile', 'makefile', 'justfile', 'Justfile', ...cited.filter((path): path is string => !!path)])];
}

export interface ValidityInput { claim: { claim: string; message: string }; checkout: string; deliverables: string[]; session: SessionLog }
export function validityGate(input: ValidityInput, plant?: FloorPlant): Finding[] {
  const { checkout, session } = input;
  const found: Finding[] = [];
  const read = new Set(session.read.map((p) => normalize(p)));
  if (plant !== 'no-deliverable-check') {
    for (const d of input.deliverables) {
      if (!existsSync(inside(checkout, d) ?? '\0')) found.push({ kind: 'deliverable', ref: d, why: `the deliverable ${d} the definition names doesn't exist in the claim's checkout` });
    }
  }
  const cites = citesOf(input.claim.message);
  const runs = session.ran.map((r) => ({ ...r, command: typed(r.command) }));
  for (const cite of new Set(cites)) {
    const run = runs.find((r) => cite === r.command) ?? runs.find((r) => cite.startsWith(`${r.command} `));
    if (run) {
      const mask = plant === 'run-happened-only' ? null : maskIn(cite) ?? maskOf(checkout, run.command);
      if (mask !== null) found.push({ kind: 'masked_exit', ref: run.command, mask, why: `the run \`${cite}\` it cites proves nothing: exit status masked by \`${mask}\`` });
      continue;
    }
    if (LINK.test(cite)) {
      const path = cite.replace(/#.*$/, '');
      if (!(session.links ?? []).includes(cite) && !(!/^https?:/.test(cite) && isFile(inside(checkout, path)))) found.push({ kind: 'link', ref: cite, why: `the link ${cite} it cites resolves to nothing this session fetched or the checkout holds` });
      continue;
    }
    const test = TEST.exec(cite);
    if (test) {
      const [, file, name] = test as unknown as [string, string, string];
      const path = inside(checkout, file);
      if (!isFile(path) || !readFileSync(path!, 'utf8').includes(name)) found.push({ kind: 'test', ref: file, why: `the test ${cite} it cites doesn't exist in ${file}` });
      else if (plant !== 'no-read-check' && !read.has(normalize(file)) && !session.ran.some((r) => r.command.includes(file) || r.output.includes(file))) {
        found.push({ kind: 'test', ref: file, why: `the test ${cite} it cites was never read or run in this session (${file})` });
      }
      continue;
    }
    const fl = FILE_LINE.exec(cite);
    if (fl && (fl[1]!.includes('/') || fl[1]!.includes('.')) && !/\s/.test(cite)) {
      const [, file, line] = fl as unknown as [string, string, string | undefined];
      const path = inside(checkout, file);
      const kind = line === undefined ? 'file' : 'line';
      if (!isFile(path)) { found.push({ kind, ref: cite, why: `the ${kind} ${cite} it cites doesn't exist in the claim's checkout` }); continue; }
      if (line !== undefined && Number(line) > readFileSync(path!, 'utf8').split('\n').length - (readFileSync(path!, 'utf8').endsWith('\n') ? 1 : 0)) {
        found.push({ kind, ref: cite, why: `the line ${cite} it cites is past the end of ${file}` });
        continue;
      }
      if (plant !== 'no-read-check' && !read.has(normalize(file))) found.push({ kind, ref: cite, why: `the ${kind} ${cite} it cites was never read in this session` });
      continue;
    }
    if (/\s/.test(cite) && /^[\w./-]+(\s|$)/.test(cite)) found.push({ kind: 'run', ref: cite, why: `the run \`${cite}\` it cites was never made in this session` });
  }
  return found;
}

export function floor(input: FloorInput, options: { safe?: boolean; doneGate?: (input: FloorInput) => FloorResult | undefined; plant?: FloorPlant } = {}): FloorResult {
  const { plant } = options;
  if (plant === 'leaves-to-done-gate') return options.safe ? { ok: true } : options.doneGate?.(input) ?? { ok: true };
  const hash = recomputeHash(input.definition, input.locked);
  if (!hash.same) {
    return {
      ok: false, action: 'INVALID', claim: input.claim.claim,
      findings: [{ kind: 'definition_hash', ref: hash.changed.join(', '), changed: hash.changed, why: `${input.claim.claim}: the definition's hash differs from the one locked; changed: ${hash.changed.join(', ')}` }],
    };
  }
  const findings = validityGate({ claim: input.claim, checkout: input.checkout, deliverables: input.definition.deliverables, session: input.session }, plant);
  return findings.length ? { ok: false, action: 'send_back', findings, claim: input.claim.claim } : { ok: true };
}
