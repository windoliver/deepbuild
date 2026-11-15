// Compile only the real CLI's exercised module graph, never workspace links or stale dist output.
// The sole substituted component is the hub server, explicitly required by #2330's Proof.
import { mkdirSync, readFileSync, existsSync, writeFileSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
export function build(into) {
  const seen = new Set(), packages = new Set();
  function workspace(specifier) {
    const [, name, ...sub] = specifier.split('/');
    const pkg = join(repo, 'packages', name);
    const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
    const entry = manifest.exports[sub.length ? `./${sub.join('/')}` : '.'];
    const target = typeof entry === 'string' ? entry : entry.default;
    if (!packages.has(name)) {
      packages.add(name);
      mkdirSync(join(into, 'packages', name), { recursive: true });
      writeFileSync(join(into, 'packages', name, 'package.json'), JSON.stringify(manifest));
      mkdirSync(join(into, 'node_modules', '@deepbuild'), { recursive: true });
      symlinkSync(join(into, 'packages', name), join(into, 'node_modules', '@deepbuild', name));
    }
    compile(resolve(pkg, target));
  }
  function compile(destination) {
    if (seen.has(destination)) return;
    seen.add(destination);
    const output = join(into, destination.slice(repo.length));
    mkdirSync(dirname(output), { recursive: true });
    if (destination === join(repo, 'packages/hub/dist/server.js')) {
      writeFileSync(output, `export { runHub } from ${JSON.stringify(new URL('./hub.mjs', import.meta.url).href)};\n`);
      return;
    }
    const sourcePath = destination.replace('/dist/', '/src/').replace(/\.js$/, '.ts');
    const source = existsSync(sourcePath) ? sourcePath : destination.replace('/dist/', '/src/');
    const text = readFileSync(source, 'utf8');
    const js = source.endsWith('.ts') ? ts.transpileModule(text, {
      fileName: source, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText : text;
    writeFileSync(output, js);
    // Only static imports: unrelated CLI commands are lazy and are not part of this suite.
    const ast = ts.createSourceFile(output, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier?.text;
      if (!specifier || specifier.startsWith('node:')) continue;
      if (specifier.startsWith('@deepbuild/')) workspace(specifier);
      else if (specifier.startsWith('.')) compile(resolve(dirname(destination), specifier));
      else throw Error(`BLOCKED: unhandled dependency ${specifier}; do not resolve workspace source through node_modules`);
    }
  }
  mkdirSync(join(into, 'packages/cli'), { recursive: true });
  writeFileSync(join(into, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(into, 'packages/cli/package.json'), readFileSync(join(repo, 'packages/cli/package.json')));
  compile(join(repo, 'packages/cli/dist/main.js'));
  workspace('@deepbuild/hub/hub');
  return join(into, 'packages/cli/dist/main.js');
}
