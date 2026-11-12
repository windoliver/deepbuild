import { createHash } from 'node:crypto';
import ts from 'typescript';

export function parse(source, file = 'fixture.ts') {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (tree.parseDiagnostics.length) throw Error(`INVALID: ${file}: ${ts.flattenDiagnosticMessageText(tree.parseDiagnostics[0].messageText, ' ')}`);
  return tree;
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => { walk(child, visit); });
}

function callable(node) {
  return Boolean(node.body) && (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node));
}

function nameOf(node) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  const name = node.name ?? node.parent?.name;
  return name ? name.getText() : '<anonymous>';
}

// Syntax, not source-text search: trivia and quote styles don't affect a digest; identifiers,
// literals, operators, types and child order do. Never execute production code.
function syntax(tree) {
  const digests = new Map();
  function digest(node) {
    const children = node.getChildren(tree);
    const value = children.length ? children.map(digest) : [node.text ?? node.getText(tree)];
    const hash = createHash('sha256').update(JSON.stringify([node.kind, value])).digest('hex');
    digests.set(node, hash);
    return hash;
  }
  digest(tree);
  return digests;
}

// Selectors describe the pinned BASE only, never required destination names. A case is an
// actual branch inside a named method, needed for sends embedded in Host's dispatch.
export function capture(tree, selector) {
  const found = [];
  walk(tree, (node) => {
    if (!callable(node) || nameOf(node) !== selector.name) return;
    if (selector.owner && node.parent.name?.getText(tree) !== selector.owner) return;
    if (selector.case === undefined) found.push(node.body);
    else walk(node.body, (child) => {
      if (ts.isCaseClause(child) && ts.isStringLiteral(child.expression) && child.expression.text === selector.case) {
        if (child.statements.length !== 1 || !ts.isBlock(child.statements[0])) throw Error('INVALID: expected one case block');
        found.push(child.statements[0]);
      }
    });
  });
  if (found.length !== 1) throw Error(`INVALID: base surface ${JSON.stringify(selector)} matched ${found.length} bodies`);
  const body = found[0];
  const hashes = syntax(tree);
  const start = tree.getLineAndCharacterOfPosition(body.getStart(tree)).line + 1;
  const end = tree.getLineAndCharacterOfPosition(body.end - 1).line + 1;
  if (ts.isBlock(body)) {
    if (!body.statements.length) throw Error('INVALID: empty base algorithm');
    return { start, end, statements: body.statements.map((statement) => hashes.get(statement)) };
  }
  return { start, end, expression: hashes.get(body) };
}

export function retained(tree, surfaces) {
  const hashes = syntax(tree);
  const nodes = [];
  walk(tree, (node) => { nodes.push(node); });
  return surfaces.flatMap((surface) => {
    const at = nodes.find((node) => {
      if (surface.expression) return hashes.get(node) === surface.expression;
      if (!ts.isBlock(node) && !ts.isSourceFile(node)) return false;
      const statements = node.statements.map((statement) => hashes.get(statement));
      return statements.some((_, offset) => surface.statements.every((hash, i) => hash === statements[offset + i]));
    });
    return at ? [`${surface.responsibility}: ${surface.label} retained at line ${tree.getLineAndCharacterOfPosition(at.getStart(tree)).line + 1}`] : [];
  });
}

export function callableLengths(tree) {
  const lengths = [];
  walk(tree, (node) => {
    if (!callable(node)) return;
    const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    const end = tree.getLineAndCharacterOfPosition(node.end - 1).line + 1;
    lengths.push({ name: nameOf(node), start, lines: end - start + 1 });
  });
  return lengths;
}

export function corePresent(tree) {
  return tree.statements.some((node) => ts.isClassDeclaration(node) && node.name?.text === 'Core'
    && node.members.some(callable));
}
