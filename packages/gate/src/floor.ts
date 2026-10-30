// The core's floor (#29; design: An agent says it's done, and First-party extensions, done-gate's row): what holds
// whatever done gate is installed, and in safe mode, which loads none. Before any check runs, with no model:
//
// - the validity gate: the deliverables the definition names exist in the claim's checkout, and everything the
//   claim cites (a file, a line, a test, a run or a link) resolves and was read or run in this session; a cited run
//   whose command masked its exit status goes back naming the mask, by the one masked-exit rule (`maskIn`);
// - the definition's hash, recomputed at the claim: one that differs from the locked one is INVALID, naming what
//   changed, part by part.
//
// A claim's cites are the backticked spans of its final message; words outside them decide nothing.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { maskIn } from './mask.js';

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
export type FloorPlant = 'run-happened-only' | 'leaves-to-done-gate' | 'no-deliverable-check' | 'no-read-check';

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
  const words = command.trim().split(/\s+/);
  const [tool, sub, name] = words;
  if (tool && ['npm', 'pnpm', 'yarn', 'bun'].includes(tool) && sub) {
    const target = sub === 'run' || sub === 'run-script' ? name : sub;
    try {
      const scripts = (JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
      return target && typeof scripts[target] === 'string' ? scripts[target]! : null;
    } catch { return null; }
  }
  if ((tool === 'make' || tool === 'just') && sub) {
    const file = ['Makefile', 'makefile', 'justfile', 'Justfile'].map((f) => join(checkout, f)).find(isFile);
    if (!file) return null;
    const lines = readFileSync(file, 'utf8').split('\n');
    const at = lines.findIndex((l) => new RegExp(`^${sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(l));
    if (at < 0) return null;
    const body: string[] = [];
    for (const l of lines.slice(at + 1)) { if (!/^\s/.test(l) || !l.trim()) break; body.push(l.trim()); }
    return body.join('\n') || null;
  }
  return null;
}
/** The mask a cited run's command, or the script it runs, hides its exit status with. */
function maskOf(checkout: string, command: string): string | null {
  return maskIn(command) ?? ((script) => (script === null ? null : maskIn(script)))(scriptOf(checkout, command));
}

const LINK = /^https?:\/\/\S+$|^[\w./@-]+#[\w-]+$/;
const TEST = /^(.+?)\s+›\s+(.+)$/;
const FILE_LINE = /^([\w./@-]+?)(?::(\d+))?$/;

/** What the validity gate reads: the claim and its final message, its checkout, the deliverables named, the session's log. */
export interface ValidityInput { claim: { claim: string; message: string }; checkout: string; deliverables: string[]; session: SessionLog }
/**
 * The validity gate's findings, before any check runs, with no model: each cite that doesn't resolve or wasn't read
 * or run here, each cited run whose exit status was masked, and each missing deliverable.
 */
export function validityGate(input: ValidityInput, plant?: FloorPlant): Finding[] {
  const { checkout, session } = input;
  const found: Finding[] = [];
  const read = new Set(session.read.map((p) => normalize(p)));
  if (plant !== 'no-deliverable-check') {
    for (const d of input.deliverables) {
      if (!existsSync(inside(checkout, d) ?? '\0')) found.push({ kind: 'deliverable', ref: d, why: `the deliverable ${d} the definition names doesn't exist in the claim's checkout` });
    }
  }
  const cites = [...input.claim.message.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.trim()).filter(Boolean);
  for (const cite of new Set(cites)) {
    const run = session.ran.find((r) => cite === r.command || cite.startsWith(`${r.command} `));
    if (run) {
      const mask = plant === 'run-happened-only' ? null : maskOf(checkout, run.command);
      if (mask !== null) found.push({ kind: 'masked_exit', ref: run.command, mask, why: `the run \`${run.command}\` it cites proves nothing: exit status masked by \`${mask}\`` });
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
    // A command the session never ran: anything else in backticks that reads as a shell command.
    if (/\s/.test(cite) && /^[\w./-]+(\s|$)/.test(cite)) found.push({ kind: 'run', ref: cite, why: `the run \`${cite}\` it cites was never made in this session` });
  }
  return found;
}

/**
 * The floor, before any check runs. It holds with no extension loaded: `safe` loads none, and an installed done gate
 * is never consulted for it. A hash that differs makes the claim INVALID; anything else it finds sends it back.
 */
export function floor(input: FloorInput, options: { safe?: boolean; doneGate?: (input: FloorInput) => FloorResult | undefined; plant?: FloorPlant } = {}): FloorResult {
  const { plant } = options;
  // The planted wrong program: leaves the floor to the done gate, so safe mode, with none loaded, checks nothing.
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
