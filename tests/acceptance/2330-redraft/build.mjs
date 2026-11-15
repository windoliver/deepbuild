// Disposable, unmodified CLI/lifecycle code; only the hub server is the issue's stand-in.
import ts from 'typescript';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export function build(out) {
  const done = new Set();
  const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
  put(join(out, 'package.json'), '{"type":"module"}');
  function pkg(name) {
    const path = `packages/${name}/package.json`;
    if (existsSync(join(out, path))) return;
    put(join(out, path), readFileSync(join(repo, path)));
    mkdirSync(join(out, 'node_modules/@deepbuild'), { recursive: true });
    symlinkSync(join(out, 'packages', name), join(out, 'node_modules/@deepbuild', name));
  }
  function emit(input, output) {
    if (done.has(input)) return;
    done.add(input);
    if (input === 'packages/hub/src/server.ts') {
      put(join(out, output), 'export function runHub() { throw Error("INVALID: stand-in preload absent"); }');
      return;
    }
    const source = readFileSync(join(repo, input), 'utf8');
    const result = input.endsWith('.ts') ? ts.transpileModule(source, {
      fileName: input, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }) : { outputText: source, diagnostics: [] };
    if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw Error(`BLOCKED: transpiling ${input}`);
    put(join(out, output), result.outputText);
    // Static runtime closure only: unrelated lazy CLI commands need no workspace build.
    const ast = ts.createSourceFile(output, result.outputText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const node of ast.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
      const spec = node.moduleSpecifier.text;
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('.')) {
        const emitted = resolve(dirname(join(out, output)), spec).slice(out.length + 1);
        const js = resolve(dirname(join(repo, input)), spec).slice(repo.length);
        const src = existsSync(join(repo, js.replace(/\.js$/, '.ts'))) ? js.replace(/\.js$/, '.ts') : js;
        emit(src, emitted);
      } else if (spec.startsWith('@deepbuild/')) {
        const [name, ...entry] = spec.slice('@deepbuild/'.length).split('/');
        pkg(name);
        const manifest = JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json')));
        const target = manifest.exports[entry.length ? `./${entry.join('/')}` : '.'].default.replace(/^\.\//, '');
        const input = target.startsWith('dist/') ? target.replace('dist/', 'src/').replace(/\.js$/, '.ts') : target;
        emit(`packages/${name}/${input}`, `packages/${name}/${target}`);
      } else throw Error(`BLOCKED: unsupported runtime dependency ${spec}`);
    }
  }
  mkdirSync(join(out, 'contracts'), { recursive: true });
  copyFileSync(join(repo, 'contracts/setup-steps.json'), join(out, 'contracts/setup-steps.json'));
  pkg('cli'); pkg('hub');
  emit('packages/cli/src/main.ts', 'packages/cli/dist/main.js');
  emit('packages/hub/src/hub-command.ts', 'packages/hub/dist/hub-command.js');
  for (const name of ['observe.mjs', 'hub.mjs']) copyFileSync(new URL(name, import.meta.url), join(out, name));
  return join(out, 'packages/cli/dist/main.js');
}
