import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths } from './lanes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = /^packages\/([^/]+)\/src\/.+\.(?:[cm]?[jt]sx?)$/;
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const blocked = (why) => { console.log(`BLOCKED unread-exports: ${why}\n  Fix: run node scripts/unread-exports.mjs at a git checkout with origin/main fetched and node_modules installed`); process.exit(2); };

const changed = changedPaths(root);
if (!changed) blocked('no merge base with origin/main, or git failed');
const sources = changed.filter((f) => SOURCE.test(f) && !f.endsWith('.d.ts') && !/(?:\.generated\.|\/generated\/)/.test(f) && existsSync(join(root, f)));
if (!sources.length) {
  console.log('PASS unread-exports: the change holds no package source file');
  process.exit(0);
}
const ts = await import('typescript').then((m) => m.default, (e) => blocked(`typescript can't be loaded: ${e.message}`));

function exportsOf(path) {
  const sf = ts.createSourceFile(path, readFileSync(join(root, path), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = [];
  const add = (node, name) => names.push({ name, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  const bound = (node) => (ts.isIdentifier(node) ? [node.text] : ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node) ? node.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bound(e.name))) : []);
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause)) for (const e of s.exportClause.elements) if (e.name.text !== 'default') add(e, e.name.text);
      continue;
    }
    const mods = ts.canHaveModifiers(s) ? ts.getModifiers(s) ?? [] : [];
    if (!mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) continue;
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) for (const n of bound(d.name)) add(d, n);
    else if (s.name && ts.isIdentifier(s.name)) add(s, s.name.text);
  }
  return names;
}

const files = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 28 });
if (files.status !== 0) blocked(`git ls-files failed: ${files.stderr.trim()}`);
const exported = new Map();
for (const file of sources) {
  try { exported.set(file, exportsOf(file)); } catch (e) { blocked(`${file} can't be read: ${e.message}`); }
}
const reexporters = new Map();
const aliases = new Map();
const bare = (path) => path.replace(CODE, '');
const code = files.stdout.split('\0').filter((file) => CODE.test(file) && !/(?:^|\/)(?:dist|node_modules)\//.test(file) && existsSync(join(root, file)))
  .map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));
for (const { file, text } of code.filter((o) => SOURCE.test(o.file))) {
  for (const [, list, spec] of text.matchAll(/^export\s+(?:type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    const target = bare(posix.join(posix.dirname(file), spec));
    reexporters.set(target, new Set([...(reexporters.get(target) ?? []), file]));
    for (const [, from, to] of list.matchAll(/([\w$]+)\s+as\s+([\w$]+)/g)) aliases.set(`${target}:${from}`, [...(aliases.get(`${target}:${from}`) ?? []), to]);
  }
}
const names = (file, name) => [name, ...[...reexporting(file)].flatMap((path) => aliases.get(`${path}:${name}`) ?? [])];
const wanted = new Set([...exported].flatMap(([file, list]) => list.flatMap(({ name }) => names(file, name))));
const namers = new Map();
for (const o of code) for (const word of new Set(o.text.match(/[A-Za-z_$][\w$]*/g))) if (wanted.has(word)) namers.set(word, [...(namers.get(word) ?? []), o]);
function reexporting(file) {
  const seen = new Set([bare(file)]);
  for (const path of seen) for (const by of reexporters.get(path) ?? []) seen.add(bare(by));
  return seen;
}
const twinless = (path) => path.replace(/^.*\/twins\/[^/]+\/(?=packages\/)/, '');
const resolved = (from, spec) => bare(posix.join(posix.dirname(twinless(from)), spec)).replace(/\/dist\//, '/src/');
const named = (clause) => clause.replace(/^type\s+/, '').match(/\{([^}]*)\}/)?.[1].split(',').map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean) ?? [];
const listed = (list) => list.split(',').map((n) => n.trim().split(/\s*:\s*/)[0]).filter(Boolean);
function imports(source, file = '') {
  const text = source.replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1').replace(/(^|\s)\/\/.*$/gm, '$1');
  const found = [];
  if (file.startsWith('tests/')) for (const [, list, spec] of text.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm)) found.push({ spec, names: named(`{${list}}`) });
  for (const [, clause, spec] of text.matchAll(/^\s*import\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) found.push({ spec, names: named(clause), as: /\*\s*as\s+([\w$]+)/.exec(clause)?.[1] });
  const taken = [];
  const dynamic = (re, take) => { for (const m of text.matchAll(re)) { const i = take(m); taken.push(i.spec); found.push(i); } };
  dynamic(/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (m) => ({ spec: m[2], names: [], as: m[1] }));
  dynamic(/(?:const|let|var)\s*\{([^{}]*)\}\s*=\s*(?:await\s+)?(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (m) => ({ spec: m[2], names: listed(m[1]) }));
  dynamic(/\(\s*await\s+import\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)\s*\.\s*([\w$]+)/g, (m) => ({ spec: m[1], names: [m[2]] }));
  for (const [, spec] of text.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g)) {
    const at = taken.indexOf(spec);
    if (at === -1) found.push({ spec, loose: true });
    else taken.splice(at, 1);
  }
  return found;
}
function helpers(o) {
  return imports(o.text).filter(({ spec }) => spec.startsWith('.')).flatMap(({ spec }) => {
    const near = bare(posix.join(posix.dirname(o.file), spec));
    const found = ['.ts', '.tsx', '.mts', '.js', '.mjs'].map((ext) => near + ext).find((path) => existsSync(join(root, path)));
    return found ? [{ file: found, text: readFileSync(join(root, found), 'utf8') }] : [];
  });
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findings = [];
for (const file of sources) {
  const [, pkg] = SOURCE.exec(file);
  const targets = reexporting(file);
  const built = new RegExp(`(?:${[...targets].flatMap((path) => [path, path.replace('/src/', '/dist/')]).map(escape).join('|')})(?![\\w-])`);
  const hits = (from, spec) => spec === `@deepbuild/${pkg}` || spec.startsWith(`@deepbuild/${pkg}/`) || (spec.startsWith('.') && targets.has(resolved(from, spec)));
  const reachable = (o) => built.test(o.text) || imports(o.text).some((i) => i.loose && hits(o.file, i.spec));
  const used = (text, as) => new RegExp(`\\.\\s*${escape(as)}\\b|[{,]\\s*${escape(as)}\\s*(?:[,}:]|as\\b)|['"\`]${escape(as)}['"\`]`).test(text);
  const reads = (o, as) => imports(o.text, o.file).some((i) => hits(o.file, i.spec) && (i.names?.includes(as) || (i.as && new RegExp(`\\b${escape(i.as)}\\s*\\.\\s*${escape(as)}\\b|['"\`]${escape(as)}['"\`]|\\{[^{}]*\\b${escape(as)}\\b[^{}]*\\}\\s*=\\s*${escape(i.as)}\\b`).test(o.text)) || (i.loose && used(o.text, as))))
    || ((built.test(o.text) || helpers(o).some(reachable)) && used(o.text, as))
    || new RegExp(`(?:const|let|var)\\s*\\{[^{}]*\\b${escape(as)}\\b[^{}]*\\}\\s*=\\s*(?:await\\s+)?(?:import|require)\\s*\\(\\s*[^'"\\s]`).test(o.text);
  for (const { name, line } of exported.get(file)) {
    const read = names(file, name).some((as) => (namers.get(as) ?? []).some((o) => twinless(o.file) !== file && reads(o, as)));
    if (!read) findings.push(`FAIL unread-exports: ${file}:${line}: ${name} is exported and read by no other file`);
  }
}
if (findings.length) {
  console.log(findings.join('\n'));
  console.log('  Fix: drop `export` from each name another file doesn\'t read, or delete a name nothing reads (#1688).');
  process.exit(1);
}
console.log(`PASS unread-exports: ${sources.length} package source files of the change export only names another file reads`);
