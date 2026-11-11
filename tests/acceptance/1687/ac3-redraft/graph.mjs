// Independent AC3 oracle. Reads source, never executes product modules or inspects other acceptance drafts.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';

export const BASE = 'c52f1c66d22886c336189d41237265e82843c34a';
const code = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const production = (file) => /^(packages|adapters)\//.test(file) && code.test(file)
  && !/(^|\/)(test|tests|__tests__|fixtures|kit|dist|node_modules|native|corpus)(\/|$)/.test(file)
  && !/\.(test|spec)\.[^.]+$/.test(file);
const manifest = (file) => /^packages\/[^/]+\/package\.json$/.test(file);
export function snapshot(root, revision) {
  const git = (args, input) => execFileSync('git', args, { cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const paths = new Set(git(revision ? ['ls-tree', '-rz', '--name-only', revision, '--', 'packages', 'adapters']
    : ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'packages', 'adapters']).split('\0').filter(Boolean));
  const selected = [...paths].filter((file) => production(file) || manifest(file)).sort();
  const texts = new Map();
  if (revision) {
    // Only the pinned base's selected blobs, never another branch or worktree.
    const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root,
      input: selected.map((file) => `${revision}:${file}\n`).join(''), maxBuffer: 64 * 1024 * 1024 });
    let at = 0;
    for (const file of selected) {
      const end = out.indexOf(10, at), header = out.subarray(at, end).toString();
      if (!/^[a-f0-9]+ blob \d+$/.test(header)) throw Error(`BLOCKED missing base blob: ${file}`);
      const size = Number(header.split(' ')[2]);
      texts.set(file, out.subarray(end + 1, end + 1 + size).toString());
      at = end + size + 2;
    }
  } else for (const file of selected) {
    try { texts.set(file, readFileSync(`${root}/${file}`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; paths.delete(file); }
  }
  return { paths, texts };
}

// Token/AST identity is independent of line numbers, comments and formatting. It is not
// an approval: reviewed-loaders.json records the input provenance and its trust boundary.
export function syntaxDigest(node) {
  const shape = (part) => [part.kind, part.text ?? null, part.getChildren().map(shape)];
  return createHash('sha256').update(JSON.stringify(shape(node))).digest('hex');
}

export function imports(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw Error(`BLOCKED source syntax: ${file}`);
  const edges = [], unknown = [];
  const add = (node, literal, runtime) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (!literal || !ts.isStringLiteralLike(literal)) {
      let scope = node;
      // The containing top-level declaration includes the loader's guards and input transformations.
      while (scope.parent && !ts.isSourceFile(scope.parent)) scope = scope.parent;
      unknown.push({ from: file, line, expression: node.getText(source), expressionDigest: syntaxDigest(node),
        scope: scope.name?.getText(source) ?? ts.SyntaxKind[scope.kind], scopeDigest: syntaxDigest(scope) });
    }
    else edges.push({ spec: literal.text, runtime: runtime && !source.isDeclarationFile, line });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) add(node, node.moduleSpecifier, !node.importClause?.isTypeOnly);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) add(node, node.moduleSpecifier, !node.isTypeOnly);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node, node.moduleReference.expression, !node.isTypeOnly);
    else if (ts.isImportTypeNode(node)) add(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null, false);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) add(node, node.arguments[0], true);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { edges, unknown };
}

export function graph({ paths, texts }, reviewedEdges = []) {
  const packages = new Map([...texts].filter(([file]) => manifest(file)).map(([file, text]) => {
    const value = JSON.parse(text); return [value.name, { ...value, dir: posix.dirname(file) }];
  }));
  const nodes = new Set([...texts.keys()].filter(production));
  const target = (path) => {
    const at = posix.normalize(path).replace(/^(packages\/[^/]+)\/dist\//, '$1/src/');
    const stem = at.replace(/\.[cm]?js$/, '');
    return [at, ...['.ts', '.mts', '.cts', '.tsx', '.mjs', '.cjs', '.js', '.d.mts', '.d.ts'].map((ext) => stem + ext),
      ...['.ts', '.mts', '.js', '.mjs'].map((ext) => `${at}/index${ext}`)].find((candidate) => paths.has(candidate));
  };
  const condition = (entry, runtime) => {
    if (typeof entry === 'string') return entry;
    if (!entry || Array.isArray(entry)) return null;
    for (const key of runtime ? ['development', 'import', 'node', 'default'] : ['types', 'development', 'import', 'node', 'default']) {
      const found = condition(entry[key], runtime); if (found) return found;
    }
    return null;
  };
  const resolve = (from, spec, runtime) => {
    if (spec.startsWith('.')) return target(posix.join(posix.dirname(from), spec));
    const pkg = [...packages.values()].find((pkg) => spec === pkg.name || spec.startsWith(`${pkg.name}/`));
    if (!pkg) return spec.startsWith('@deepbuild/') || spec.startsWith('#') || spec.startsWith('/') || spec.startsWith('file:') ? undefined : 'external';
    const sub = spec === pkg.name ? '.' : `.${spec.slice(pkg.name.length)}`;
    const exports = pkg.exports;
    const entry = exports && typeof exports === 'object' && Object.keys(exports).some((key) => key.startsWith('.')) ? exports[sub] : sub === '.' ? exports : null;
    const path = condition(entry, runtime);
    return path ? target(posix.join(pkg.dir, path)) : undefined;
  };
  const edges = [], unresolved = [], unknown = [], outside = [];
  for (const file of [...nodes].sort()) {
    const parsed = imports(file, texts.get(file)); unknown.push(...parsed.unknown);
    for (const edge of [...parsed.edges, ...reviewedEdges.filter((edge) => edge.from === file)]) {
      const to = resolve(file, edge.spec, edge.runtime);
      const row = { from: file, ...edge, to };
      if (!to) unresolved.push(row);
      else if (to === 'external') outside.push(row);
      else if (nodes.has(to)) edges.push(row);
      else if (code.test(to)) unresolved.push({ ...row, reason: 'source outside scanned production set' });
      // Non-code data files have no outgoing module imports.
    }
  }
  return { nodes, edges, unresolved, unknown, outside, packages };
}

const key = (edge) => `${edge.from} -> ${edge.to}`;
export function cyclicEdges(graph, runtimeOnly) {
  const adjacency = new Map([...graph.nodes].map((node) => [node, new Set()]));
  for (const edge of graph.edges) if (!runtimeOnly || edge.runtime) adjacency.get(edge.from).add(edge.to);
  // An edge is cyclic exactly when its target can reach its source. This catches a new edge inside an old SCC,
  // and an old acyclic edge newly put on a cycle; comparing only SCC membership would miss the former.
  const reaches = (start, end) => {
    const seen = new Set(), pending = [start];
    while (pending.length) {
      const node = pending.pop(); if (node === end) return true;
      if (seen.has(node)) continue; seen.add(node); pending.push(...adjacency.get(node) ?? []);
    }
    return false;
  };
  return new Set(graph.edges.filter((edge) => (!runtimeOnly || edge.runtime) && reaches(edge.to, edge.from)).map(key));
}
export function newCycles(base, current, runtimeOnly) {
  const before = cyclicEdges(base, runtimeOnly);
  return [...cyclicEdges(current, runtimeOnly)].filter((edge) => !before.has(edge)).sort();
}

// Roles are frozen from the design and BASE package responsibilities, not inferred from candidate import choices.
export const corePackages = new Set(['adapters', 'asks', 'budget', 'conformance', 'contracts', 'evidence',
  'extension-host', 'gate', 'leases', 'readings', 'record', 'runner', 'supervisor', 'verdicts']);
export const extensionPackages = new Set(['archive', 'buying', 'checks-command', 'checks-host', 'checks-journey', 'checks-numbers',
  'checks-review', 'checks-work', 'config-eval', 'env-local', 'github', 'otlp', 'paseo', 'pi', 'proof',
  'resolver-decisions', 'routing-replay', 'wiki', 'workspaces']);
const owner = (file) => file.match(/^packages\/([^/]+)\//)?.[1];
export function boundary(graph) {
  const roots = [...graph.nodes].filter((file) => corePackages.has(owner(file)) || file === 'packages/hub/src/core.ts');
  if (!roots.includes('packages/hub/src/core.ts')) throw Error('BLOCKED issue-named hub core missing; classification needs review');
  const adjacency = new Map([...graph.nodes].map((node) => [node, []]));
  for (const edge of graph.edges) adjacency.get(edge.from).push(edge);
  const pending = [...roots], seen = new Set(), violations = new Set();
  while (pending.length) {
    const from = pending.pop(); if (seen.has(from)) continue; seen.add(from);
    for (const edge of adjacency.get(from) ?? []) {
      if (extensionPackages.has(owner(edge.to)) || /^packages\/(sources|channels)\//.test(edge.to)) violations.add(key(edge));
      else pending.push(edge.to); // A helper, barrel, or hub service is not an escape from the boundary.
    }
  }
  const classified = new Set([...corePackages, ...extensionPackages, 'hub', 'cli', 'reading']);
  const unclassified = [...graph.packages.values()].filter((pkg) => !classified.has(pkg.dir.split('/')[1])).map((pkg) => pkg.name);
  return { violations: [...violations].sort(), unclassified: unclassified.sort() };
}
