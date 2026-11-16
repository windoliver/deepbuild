// The repo's spec as a claim reads it (#322, #2218): the checks its `done` claim names, each a command with the
// deadline, the clean runs and the test count its entry declares. A key of done.yaml no reader takes is never
// dropped: it stands on the claim as a check of the spec's own, BLOCKED naming each such key and its line (#2205's
// checks the gate can't run stand beside it the same way).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAlias, isMap, isScalar, LineCounter, parseDocument } from 'yaml';
import { duration } from '@deepbuild/asks';
import type { JsonValue } from '@deepbuild/contracts';
import { runsNeeded } from '@deepbuild/verdicts';
import { docCommand, type DocCheck } from './doc-checks.js';
import type { ClaimCheck } from './gate-runner.js';
import type { McpOperationsPort } from './hub-ports.js';
import { isObj } from './hub-shared.js';
import { blocked, cantRun, specEntries } from './release.js';

const SPEC = '.deepbuild/done.yaml';
/** The top-level keys a reader takes: the gate's own, teardowns' `resources`, the stack's `environment`, the `asks` settings and deep-hook's `heavy_commands`. */
const TOP = new Set(['claims', 'checks', 'outside', 'release', 'switches', 'resources', 'environment', 'asks', 'heavy_commands']);
/** The keys a reader takes on a check entry: a command's, and a document check's (#1723). */
const ON_CHECK = new Set(['type', 'run', 'deadline', 'host', 'runs', 'accept', 'min_tests', 'kind', 'doc', 'input']);

/** Each key of the spec's text that no reader takes, at its top or on a check entry, with the line it is written at. */
export function unreadKeys(text: string): { key: string; line: number; check?: string }[] {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  const keysOf = (node: unknown): { key: string; line: number; value: unknown }[] => {
    const map = isAlias(node) ? node.resolve(doc) : node;
    return isMap(map) ? map.items.map(({ key, value }) => ({ key: String(isScalar(key) ? key.value : key), line: isScalar(key) && key.range ? lines.linePos(key.range[0]).line : 0, value })) : [];
  };
  return keysOf(doc.contents).flatMap((top) => [
    ...(TOP.has(top.key) ? [] : [{ key: top.key, line: top.line }]),
    ...(top.key === 'checks' ? keysOf(top.value).flatMap((entry) => keysOf(entry.value).filter((k) => !ON_CHECK.has(k.key)).map((k) => ({ key: k.key, line: k.line, check: entry.key }))) : []),
  ]);
}

/**
 * The repo's spec checks (#322): each check the spec's `done` claim names (or, with no claims block, every check),
 * as a command run in the claim's checkout, the repo's own, covering the claim as a whole. A key no reader takes stands
 * beside them as the spec's own check, missing a key the hub reads, and a count it can't read on the check that writes it.
 */
export function specChecks(cwd: string, spec: unknown, checks: ReturnType<McpOperationsPort['checksOf']>, docs: Map<string, DocCheck>): ClaimCheck[] {
  let text = '';
  try { text = readFileSync(join(cwd, SPEC), 'utf8'); } catch { /* gone since it was read: it writes no key */ }
  const unread = unreadKeys(text);
  const done = isObj(spec) && isObj(spec.claims) && isObj(spec.claims.done) && Array.isArray(spec.claims.done.checks) ? spec.claims.done.checks.map(String) : [...new Set([...checks.keys(), ...docs.keys(), ...specEntries(spec)])];
  return [
    ...(unread.length ? [blocked(SPEC, `a key DeepBuild reads in place of ${unread.map((u) => `\`${u.key}\`${u.check ? ` on check ${u.check}` : ''} at line ${u.line}`).join(', ')}`)] : []),
    ...done.flatMap((name): ClaimCheck[] => {
      const check = checks.get(name);
      const doc = docs.get(name);
      if (!check && doc) return [{ check: name, approved: null, command: docCommand(doc, undefined), covers: [], depth: 'unit', on_base: 'passes', asserts: [], source: 'spec', document: doc.doc }];
      if (!check) return [cantRun(spec, name)];
      const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
      // `runs`, or the count `accept` computes (design: Run counts, exactly); a count it can't read is yours to write.
      const need = runsNeeded({ ...(check.runs !== undefined ? { runs: check.runs as number } : {}), ...(check.accept !== undefined ? { accept: String(check.accept) } : {}) });
      if (!need.ok) return [blocked(name, `a run count DeepBuild can read: ${need.reason}`)];
      const tests = check.min_tests;
      if (tests !== undefined && !(Number.isInteger(tests) && (tests as number) >= 0)) return [blocked(name, `a test count DeepBuild can read: min_tests ${String(tests)} must be a whole number of tests`)];
      // A journey runs on the repo's stack, as its environment block starts it (#33, #580).
      return [{
        check: name, approved: null, command: check.run, covers: [], depth: check.type === 'journey' ? 'journey' as const : 'unit' as const, on_base: 'passes' as const, asserts: [], source: 'spec' as const,
        ...(deadline ? { deadline_ms: deadline } : {}), ...(need.needed > 1 ? { runs: need.needed } : {}), ...(typeof tests === 'number' ? { min_tests: tests } : {}),
      }];
    }),
  ];
}
