// What the proof lanes read from the repository they check (#569): its change against the merge
// base, commit by commit, the issue the change names, and the approvals signed for its commits.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';
import ts from 'typescript';
import { testPaths } from './lanes.mjs';

const TAG = /#(\d+)\.([0-9a-f]{8})\b/g;
export const tagsIn = (text) => [...new Set([...text.matchAll(TAG)].map(([tag]) => tag))];
export const testPattern = RegExp(`^(?:${testPaths.map((glob) => glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/|\*\*|\*/g, (wild) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*' })[wild])).join('|')})$`);
export const underTestPaths = (path) => testPattern.test(path) && !path.split('/').includes('node_modules');
export const isTestFile = (path) => underTestPaths(path) && /\.test\.(?:mjs|js|ts)$/.test(path);
// A test's name in every line and approval: its file's repo path, then its full name.
export const named = (path, name) => `${path} › ${name}`;

export class Blocked extends Error {}

export function git(root, args, options = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
const z = (text) => text.split('\0').filter(Boolean);

/** The files git lists in the worktree, tracked or not, less those it ignores and those deleted. */
export const listFiles = (root) => [...new Set(z(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])))]
  .filter((path) => { try { return !lstatSync(join(root, path)).isDirectory(); } catch { return false; } });

/** A file as `rev` holds it, or null when it doesn't. `rev` null reads the worktree. */
export function show(root, rev, path) {
  if (rev === null) {
    const file = join(root, path);
    return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : null;
  }
  const result = spawnSync('git', ['cat-file', 'blob', `${rev}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  return result.status === 0 ? result.stdout : null;
}

function hunks(text) {
  const found = [];
  let hunk;
  for (const line of text.split('\n')) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) found.push(hunk = { oldStart: Number(header[1]), newStart: Number(header[2]), removed: [], added: [] });
    else if (hunk && line.startsWith('-')) hunk.removed.push(line.slice(1));
    else if (hunk && line.startsWith('+')) hunk.added.push(line.slice(1));
  }
  return found;
}

/**
 * The files `to` changes against `from`, each with its hunks: removed lines from `oldStart` in the old
 * file (an insertion has none and comes after line `oldStart`), added lines from `newStart` in the new.
 * `to` null is the worktree, its untracked files included. Every file diffs as text, whatever its
 * bytes or the repository's attributes say, so no edit hides as a binary change.
 */
function diff(root, from, to) {
  const range = to ? [from, to] : [from];
  const status = z(git(root, ['diff', '--name-status', '-z', '--no-renames', ...range]));
  const files = [];
  for (let index = 0; index < status.length; index += 2) {
    const path = status[index + 1];
    files.push({ path, status: status[index][0], hunks: hunks(git(root, ['diff', '--text', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '-U0', ...range, '--', path])) });
  }
  if (!to) {
    for (const path of z(git(root, ['ls-files', '-z', '--others', '--exclude-standard']))) {
      const content = show(root, null, path);
      if (content === null) continue;
      files.push({ path, status: 'A', hunks: [{ oldStart: 0, newStart: 1, removed: [], added: content.replace(/\n$/, '').split('\n') }] });
    }
  }
  return files;
}

/** Line numbers a file's hunks remove, in the old file. */
export const removedLines = (file) => file.hunks.flatMap(({ oldStart, removed }) => removed.map((_, index) => oldStart + index));
/** Line numbers a file's hunks add, in the new file. */
export const addedLines = (file) => file.hunks.flatMap(({ newStart, added }) => added.map((_, index) => newStart + index));

/**
 * The change: the merge base with origin/main, each first-parent commit since it read against its
 * first parent, then the worktree's uncommitted and untracked changes as one more commit (sha null)
 * that no approval covers. `whole` is the worktree against the merge base.
 */
export function readChange(root) {
  let base;
  try {
    base = git(root, ['merge-base', 'HEAD', 'origin/main']).trim();
  } catch {
    throw new Blocked('no merge base with origin/main');
  }
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  // Every commit the change brings that main doesn't hold, a merged branch's own included; main's
  // commits a merge brings are main's.
  const commits = git(root, ['rev-list', '--reverse', '--topo-order', 'HEAD', '^origin/main']).split('\n').filter(Boolean).map((sha) => {
    const parents = git(root, ['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').slice(1);
    // A merge is judged by its own resolution: what it changes against git's automatic merge of its
    // parents, as git show --remerge-diff shows it. What it brings in is judged in the commits that
    // made it, and a change it drops, such as by -s ours, is its own edit.
    // A file git couldn't merge holds conflict markers there, so it is judged against the merge's
    // parents and their merge base instead.
    const merge = parents.length > 1 ? { parents, base: git(root, ['merge-base', ...parents]).trim(), ...autoMerge(root, parents) } : null;
    const parent = merge ? merge.tree : parents[0];
    // Main as it stood when the commit was made, which a looser bound is weighed against.
    const since = git(root, ['merge-base', sha, 'origin/main']).trim();
    return { sha, parent, merge, base: since, message: git(root, ['log', '-1', '--format=%B', sha]), files: diff(root, parent, sha) };
  });
  const uncommitted = diff(root, 'HEAD', null);
  if (uncommitted.length) commits.push({ sha: null, parent: head, base, message: '', files: uncommitted });
  return { root, base, head, commits, whole: diff(root, base, null) };
}

/** Where `rev` holds the file `to` has at `path`, following a rename; null when `rev` lacks it. */
export function sourceOf(root, rev, to, path) {
  const entries = z(git(root, ['diff', '-M', '-z', '--name-status', rev, to]));
  for (let index = 0; index < entries.length;) {
    const status = entries[index];
    if (/^[RC]/.test(status)) {
      if (entries[index + 2] === path) return entries[index + 1];
      index += 3;
    } else {
      if (entries[index + 1] === path) return status === 'A' ? null : path;
      index += 2;
    }
  }
  return path;
}

/** The ID of the blob `rev` holds at `path`, so files compare byte for byte; null when it holds none. */
export function blobId(root, rev, path) {
  const result = spawnSync('git', ['rev-parse', '--verify', '-q', `${rev}:${path}`], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** The tree git's automatic merge of the commits gives, conflict markers and all, and the files it couldn't merge. */
function autoMerge(root, parents) {
  const result = spawnSync('git', ['merge-tree', '--write-tree', '--no-messages', '--name-only', '-z', ...parents], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (result.status > 1 || !result.stdout) throw new Blocked(`git merge-tree cannot remerge ${parents.join(' and ')}: ${String(result.stderr).trim()}`);
  const [tree, ...conflicts] = z(result.stdout);
  return { tree, conflicts: [...new Set(conflicts)] };
}

/** A criterion's ID: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed. */
const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

/**
 * The issue the change's commit messages name with `Part of #n`, or with `Closes #n` or any other
 * keyword GitHub closes an issue on, with its criteria; null when none does. Its body comes from
 * $DEEP_PROOF_ISSUES/<n>.md, else from gh.
 */
export function readIssue(root, change) {
  const named = new Map(), foreign = new Set();
  const own = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).stdout?.trim().match(/[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1].toLowerCase();
  // As GitHub reads them: Closes #n, Closes: #n, Closes owner/repo#n or Closes <issue URL>.
  for (const { message } of change.commits)
    for (const [, keyword, short, url, number] of message.matchAll(/\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+(?:([\w.-]+\/[\w.-]+)#|https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|#)(\d+)\b/gi)) {
      const repository = (short ?? url)?.toLowerCase();
      if (repository && repository !== own) {
        foreign.add(`${short ?? url}#${number}`);
        continue;
      }
      const word = /^part of$/i.test(keyword) ? 'Part of' : 'Closes';
      named.set(number, named.get(number) === 'Closes' ? 'Closes' : word);
    }
  if (foreign.size) return { blocked: `the change names ${[...foreign].join(' and ')}, an issue of another repository than origin's` };
  if (!named.size) return null;
  if (named.size > 1) return { blocked: `the change names ${[...named.keys()].map((n) => `#${n}`).join(' and ')}; one change proves one issue` };
  const [[number, word]] = named;
  let body = null;
  if (process.env.DEEP_PROOF_ISSUES) {
    const file = join(process.env.DEEP_PROOF_ISSUES, `${number}.md`);
    if (existsSync(file)) body = readFileSync(file, 'utf8');
  } else {
    const result = spawnSync('gh', ['issue', 'view', number, '--json', 'body', '-q', '.body'], { cwd: root, encoding: 'utf8' });
    if (result.status === 0) body = result.stdout;
  }
  if (body === null) return { number, word, blocked: `cannot read issue #${number}` };
  const section = body.split(/^###\s+Acceptance criteria\s*$/m)[1]?.split(/^#{1,6}\s/m)[0] ?? '';
  const criteria = [...section.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, text]) => ({ id: criterionId(number, text), text: text.trim() }));
  return { number, word, criteria };
}

// A module path as vite and node resolve it: as written, with a script extension, or a folder's index.
const EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx'];
export const resolveModule = (root, rev, path) => [path, ...EXTENSIONS.map((extension) => path + extension), ...EXTENSIONS.map((extension) => `${path}/index${extension}`)]
  .find((candidate) => show(root, rev, candidate) !== null) ?? path;

/**
 * A test file with the files under the test paths it imports, near and far, each with its source.
 * `rev` null reads the worktree.
 */
export function testImports(root, rev, path, found = new Map()) {
  const source = show(root, rev, path);
  if (source === null || found.has(path)) return found;
  found.set(path, source);
  const imported = [...source.matchAll(/(?:\bfrom|\bimport\s*\(|\brequire\s*\(|^\s*import)\s*['"](\.{1,2}\/[^'"]+)['"]/gm)].map(([, specifier]) => posix.normalize(posix.join(posix.dirname(path), specifier)));
  for (const file of imported.filter(underTestPaths)) testImports(root, rev, resolveModule(root, rev, file), found);
  return found;
}

/** The tags a test file holds, with those of the files under the test paths it imports, as in test(`${ID.coverage} …`) with ID from a helper. */
export const tagsWithImports = (root, rev, path) => [...new Set([...testImports(root, rev, path).values()].flatMap(tagsIn))];

/**
 * Approval items by the commit they approve. An approval is an annotated tag under
 * refs/tags/deep/approved/ on a commit of the change, SSH-signed by a key the approvers file
 * ($DEEP_APPROVERS, else ~/.deepbuild/approvers) lists, with one `Approves: <item>` line per item.
 * Nothing in the change itself can make one: it needs the maintainer's private key. The signature is
 * checked with ssh-keygen itself, never through git verify-tag, whose verifier the repository's own
 * config could replace.
 */
export function readApprovals(root, change) {
  const approvals = new Map();
  const approvers = resolve(process.env.DEEP_APPROVERS || join(homedir(), '.deepbuild', 'approvers'));
  if (!existsSync(approvers)) return approvals;
  const shas = new Set(change.commits.map(({ sha }) => sha).filter(Boolean));
  const directory = mkdtempSync(join(tmpdir(), 'deep-proof-approval-'));
  try {
    for (const row of git(root, ['for-each-ref', '--format=%(refname)%09%(objecttype)%09%(*objectname)', 'refs/tags/deep/approved/']).split('\n').filter(Boolean)) {
      const [ref, type, target] = row.split('\t');
      if (type !== 'tag' || !shas.has(target)) continue;
      const tag = git(root, ['cat-file', 'tag', ref]);
      const at = tag.indexOf('-----BEGIN SSH SIGNATURE-----\n');
      if (at < 0 || !tag.trimEnd().endsWith('-----END SSH SIGNATURE-----')) continue;
      const signature = join(directory, 'signature');
      writeFileSync(signature, tag.slice(at));
      const ssh = (args, input) => spawnSync('ssh-keygen', ['-Y', ...args, '-f', approvers, '-s', signature], { input, encoding: 'utf8' });
      const principal = ssh(['find-principals']).stdout?.split('\n')[0]?.trim();
      if (!principal || ssh(['verify', '-n', 'git', '-I', principal], tag.slice(0, at)).status !== 0) continue;
      const message = tag.slice(0, at).split('\n\n').slice(1).join('\n\n');
      const items = [...message.matchAll(/^Approves: (.+?)\s*$/gm)].map(([, item]) => item);
      approvals.set(target, [...(approvals.get(target) ?? []), ...items]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return approvals;
}

/**
 * The tests a source file declares: each `describe`, `it` or `test` call, or a call of one of its
 * forms such as `it.skip`, `it.only`, `it.each(table)` or `it.skipIf(condition)`, with its full name (its suites' names and its own, joined by ` › `), its first and last
 * line, its kind (describe, it or test), and whether it or a suite around it is skipped or only. The source is read with TypeScript's parser, so a test planted
 * inside a string, comment or regular expression is not one. A name is read from a string literal,
 * or from a template of the file's string constants, as in test(`${ID} adds`); a test whose name
 * can't be read so, such as one built in a loop or from a table, has the name null, and so do the
 * tests inside it.
 */
const FORMS = ['skip', 'only', 'todo', 'each', 'for', 'concurrent', 'sequential', 'fails', 'skipIf', 'runIf', 'shuffle'];
// The forms that take arguments of their own before the test's: it.each(table)(name, fn).
const CALLED = ['each', 'for', 'skipIf', 'runIf'];
/**
 * The source ranges, [from, to) by UTF-16 offset, of its string, template, regular expression and JSX
 * text literals: text inside them is data, so white space there counts as much as any other text.
 */
export function literals(source) {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const kinds = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail, ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.JsxText]);
  const found = [];
  const visit = (node) => {
    if (kinds.has(node.kind)) found.push([node.getStart(file), node.end]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export function spans(source) {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const line = (offset) => file.getLineAndCharacterOfPosition(offset).line + 1;
  // A name in a template is read where it is bound: the nearest scope around the test that binds it
  // must bind it once, as a const string; any other binding, such as a parameter, can't be read.
  const bound = (pattern) => (ts.isIdentifier(pattern) ? [pattern.text] : ts.isObjectBindingPattern(pattern) || ts.isArrayBindingPattern(pattern) ? pattern.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bound(element.name))) : []);
  const bindings = (scope, name) => {
    const found = [];
    const take = (declaration) => { if (bound(declaration.name).includes(name)) found.push(declaration); };
    if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope))
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement)) statement.declarationList.declarations.forEach(take);
        else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) found.push(statement);
        else if (ts.isImportDeclaration(statement) && statement.importClause) {
          const { name: own, namedBindings } = statement.importClause;
          const names = [own?.text, namedBindings && ts.isNamespaceImport(namedBindings) ? namedBindings.name.text : null, ...(namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements.map((element) => element.name.text) : [])];
          if (names.includes(name)) found.push(statement);
        }
      }
    if (ts.isFunctionLike(scope)) {
      scope.parameters.forEach(take);
      if ((ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) && scope.name?.text === name) found.push(scope);
    }
    if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)) scope.initializer.declarations.forEach(take);
    if (ts.isCatchClause(scope) && scope.variableDeclaration) take(scope.variableDeclaration);
    return found;
  };
  const constant = (node) => {
    if (!ts.isIdentifier(node)) return null;
    for (let scope = node.parent; scope; scope = scope.parent) {
      const found = bindings(scope, node.text);
      if (!found.length) continue;
      const [only] = found;
      const value = found.length === 1 && ts.isVariableDeclaration(only) && ts.isIdentifier(only.name) && only.parent.flags & ts.NodeFlags.Const && only.initializer;
      return value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) ? value.text : null;
    }
    return null;
  };
  const text = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (!ts.isTemplateExpression(node)) return null;
    const parts = node.templateSpans.map(({ expression, literal }) => [constant(expression), literal.text]);
    return parts.every(([value]) => value !== null) ? node.head.text + parts.map((part) => part.join('')).join('') : null;
  };
  const found = [];
  const calls = new Map();
  const visit = (node, suites) => {
    let inner = suites;
    if (ts.isCallExpression(node)) {
      // The callee's chain down to its root: it.each(table) is a call of a call of it.each, and
      // it.each`table` a call of a tagged template.
      const forms = [];
      let root = node.expression;
      while (ts.isPropertyAccessExpression(root) || ts.isCallExpression(root) || ts.isTaggedTemplateExpression(root)) {
        if (ts.isPropertyAccessExpression(root)) forms.unshift(root.name.text);
        root = ts.isTaggedTemplateExpression(root) ? root.tag : root.expression;
      }
      const [first] = node.arguments;
      if (ts.isIdentifier(root) && ['describe', 'it', 'test'].includes(root.text) && forms.every((form) => FORMS.includes(form)) && first && !(ts.isCallExpression(node.expression) && !forms.some((form) => CALLED.includes(form))) && !(ts.isPropertyAccessExpression(node.expression) && CALLED.includes(forms.at(-1)))) {
        const own = forms.some((form) => form === 'each' || form === 'for') ? null : text(first);
        const name = own === null || suites.some((suite) => suite.name === null) ? null : [...suites.map((suite) => suite.name), own].join(' › ');
        // node:test and vitest also skip a test or suite by its options: (name, { skip: true }, fn).
        const options = node.arguments[1];
        const skippedBy = options && ts.isObjectLiteralExpression(options) && options.properties.some((property) => ts.isPropertyAssignment(property)
          && ['skip', 'todo'].includes(property.name.text) && (property.initializer.kind === ts.SyntaxKind.TrueKeyword || ts.isStringLiteral(property.initializer)));
        const skipped = forms.some((form) => ['skip', 'todo', 'skipIf'].includes(form)) || Boolean(skippedBy) || suites.some((suite) => suite.skipped);
        const only = forms.includes('only') || suites.some((suite) => suite.only);
        // It registers whenever its file or suite runs only as a statement of the file or of its
        // suite's callback, not under an if, a && or a function no one calls.
        let statement = node.parent;
        while (ts.isAwaitExpression(statement) || ts.isParenthesizedExpression(statement) || ts.isVoidExpression(statement)) statement = statement.parent;
        const scope = ts.isExpressionStatement(statement) ? statement.parent : statement;
        const callback = ts.isBlock(scope) ? scope.parent : scope;
        const suite = suites.at(-1);
        const runs = (suite ? suite.runs && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && calls.get(suite) === callback.parent : ts.isSourceFile(scope))
          && (ts.isExpressionStatement(statement) || (suite && scope === statement && ts.isArrowFunction(statement)));
        const span = { name, kind: root.text, from: node.getStart(file), to: node.end - 1, start: line(node.getStart(file)), end: line(node.end - 1), skipped, only, runs, leaf: true };
        calls.set(span, node);
        for (const suite of suites) suite.leaf = false;
        found.push(span);
        inner = [...suites, span];
      }
    }
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(file, []);
  return found;
}

/**
 * The text with each test's own source, `from` to `to` inclusive, blanked out, and the `;` that ends
 * its statement right after it, so what is left lies outside every test.
 */
export function outsideTests(text, tests) {
  // By UTF-16 units, as the parser counts offsets.
  const chars = text.split('');
  for (const { from, to } of tests) {
    for (let index = from; index <= to; index += 1) if (chars[index] !== '\n') chars[index] = ' ';
    if (text[to + 1] === ';') chars[to + 1] = ' ';
  }
  return chars.join('');
}
