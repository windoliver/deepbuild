// The checks a repo's spec names (#322, #1723, #1864): read from a spec already parsed, so a caller reads the revision
// it was handed, the approved one for a claim. No parser here: this module stays off the hub's startup graph.
import { docCheckOf, type DocCheck } from './doc-checks.js';
import type { McpOperationsPort } from './hub-ports.js';
import { isRecord as isObj } from '@deepbuild/contracts';

/** The command checks a spec names, by name, with the command each runs and the counts and deadline it writes. */
export function checksIn(spec: unknown): ReturnType<McpOperationsPort['checksOf']> {
  const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
  return new Map(Object.entries(checks).flatMap(([name, c]) => {
    if (!isObj(c) || typeof c.run !== 'string') return [];
    const written = Object.fromEntries((['deadline', 'runs', 'accept', 'min_tests', 'memory_mb'] as const).flatMap((key) => (c[key] !== undefined ? [[key, c[key]]] : [])));
    return [[name, { run: c.run, ...written, ...(typeof c.type === 'string' ? { type: c.type } : {}), ...(typeof c.host === 'string' ? { host: c.host } : {}) }] as const];
  }));
}
/** The document checks a spec names (#1723). */
export function docChecksIn(spec: unknown): Map<string, DocCheck> {
  const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
  return new Map(Object.entries(checks).flatMap(([name, c]) => { const d = docCheckOf(c); return d ? [[name, d] as const] : []; }));
}
/**
 * Whether the approved spec runs this check outside the sandbox (#33, #1864): `outside: { checks: [paths], build }`
 * in .deepbuild/done.yaml, for suites that start sandboxes of their own, which macOS can't nest. Its build makes what
 * those suites start (the workspaces, deep-hook) once per checkout. A run of no claim the hub judges stays inside.
 */
export function outsideOf(spec: unknown, check: string): { build: string } | undefined {
  const o = isObj(spec) && isObj(spec.outside) ? spec.outside : undefined;
  const paths = Array.isArray(o?.checks) ? o.checks.map(String) : [];
  return o && typeof o.build === 'string' && paths.some((p) => check === p || (p.endsWith('/') && check.startsWith(p))) ? { build: o.build } : undefined;
}
