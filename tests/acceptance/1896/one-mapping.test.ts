// #1896 AC2: packages/proof/src holds one mapping from runner name, so a planted second switch fails this test. It
// parses every hand-written TypeScript source under packages/proof/src (tests left out) and counts the places that
// map from a runner's name (README, The AC2 pattern): a comparison with a runner's name, a switch on a runner, and a
// table keyed by the runners' names. One table, or one switch, is the one mapping; anything beside it is a second.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const AC2 = '#1896.ab6a2c22';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROOF = join(ROOT, 'packages/proof/src');
/** The runners' names (packages/proof/src/types.ts, ProofRunner). */
const RUNNERS = ['lean4', 'kani'];

const bare = (e: ts.Node | undefined): ts.Node | undefined => {
  while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e))) e = e.expression;
  return e;
};
const runnerName = (e: ts.Node | undefined): boolean => { const b = bare(e); return !!b && ts.isStringLiteralLike(b) && RUNNERS.includes(b.text); };
/** An expression that reads a runner: `runner`, `spec.runner`, `spec['runner']`, `s.runner!`. */
const readsRunner = (e: ts.Node | undefined): boolean => {
  const b = bare(e);
  if (!b) return false;
  if (ts.isIdentifier(b)) return /^runner$/i.test(b.text);
  if (ts.isPropertyAccessExpression(b)) return /^runner$/i.test(b.name.text);
  if (ts.isElementAccessExpression(b)) { const a = bare(b.argumentExpression); return !!a && ts.isStringLiteralLike(a) && /^runner$/i.test(a.text); }
  return false;
};
const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const keyOf = (p: ts.ObjectLiteralElementLike): string | undefined => {
  if (!p.name) return undefined;
  if (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) return p.name.text;
  if (ts.isComputedPropertyName(p.name)) { const b = bare(p.name.expression); return b && ts.isStringLiteralLike(b) ? b.text : undefined; }
  return undefined;
};
/** A list's element as the name it is keyed by: a tuple's first element, as `new Map([['lean4', …], ['kani', …]])` holds. */
const tupleKey = (e: ts.Expression): string | undefined => {
  const b = bare(e);
  if (!b || !ts.isArrayLiteralExpression(b) || b.elements.length < 2) return undefined;
  const first = bare(b.elements[0]);
  return first && ts.isStringLiteralLike(first) ? first.text : undefined;
};
const everyRunner = (keys: (string | undefined)[]): boolean => RUNNERS.every((r) => keys.includes(r));

/** The places in `text` that map from a runner's name, each as `<file>:<line> <what>`. */
function mappings(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node, what: string): void => { found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${what}`); };
  const visit = (node: ts.Node): void => {
    // `spec.runner === 'kani'`, `'lean4' !== runner`: an if, a ternary or a filter, each comparison a place.
    if (ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind) && (runnerName(node.left) || runnerName(node.right))) at(node, 'comparison');
    // `switch (spec.runner)`, or any switch with a case that is a runner's name: one place, whatever its cases.
    else if (ts.isSwitchStatement(node) && (readsRunner(node.expression) || node.caseBlock.clauses.some((c) => ts.isCaseClause(c) && runnerName(c.expression)))) at(node, 'switch');
    // `{ lean4: …, kani: … }`: a table keyed by every runner's name.
    else if (ts.isObjectLiteralExpression(node) && everyRunner(node.properties.map(keyOf))) at(node, 'table');
    // `[['lean4', …], ['kani', …]]`: the same table as a Map's entries.
    else if (ts.isArrayLiteralExpression(node) && everyRunner(node.elements.map(tupleKey))) at(node, 'table');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' ? [] : sources(path);
    return /\.(?:ts|mts|cts|tsx)$/.test(e.name) && !/\.d\.ts$|\.test\.tsx?$|\.spec\.tsx?$/.test(e.name) ? [path] : [];
  });
}

/** The planted second switch: what a copy of the mapping looks like, read as one more source of the package. */
const PLANTED = `import type { ProofSpec } from './types.js';
export function plantedFlags(spec: ProofSpec): string[] {
  switch (spec.runner) {
    case 'kani': return ['--exact'];
    default: return [];
  }
}
`;

it(`${AC2} packages/proof/src holds exactly one mapping from a runner's name, and a planted second switch makes two`, () => {
  const held = sources(PROOF).sort().flatMap((file) => mappings(relative(ROOT, file), readFileSync(file, 'utf8')));
  const planted = mappings('packages/proof/src/planted-1896.ts', PLANTED);
  const summary = { mappingsFromRunnerName: held.length, withAPlantedSecondSwitch: held.length + planted.length };
  expect(summary, `the places in packages/proof/src that map from a runner's name: ${held.join(', ') || 'none'}`).toEqual({ mappingsFromRunnerName: 1, withAPlantedSecondSwitch: 2 });
}, 30_000);
