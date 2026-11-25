// AC3's process: the test starts it under a locale of its own (LC_ALL), since a process's locale is fixed at its start.
// It loads this checkout's TypeScript as Vitest does, from source, runs the tie between the providers its arguments
// name, and prints one JSON line: its locale, how that locale orders the first two providers, and what `u`'s use of
// x@1 is wired to.
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, next) {
    // The packages' sources import their siblings as .js; the source beside each is .ts.
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      const url = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL).href;
      if (existsSync(fileURLToPath(url))) return next(url, context);
    }
    return next(specifier, { ...context, conditions: [...context.conditions, 'development'] });
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, context);
    const fileName = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), { fileName, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
    return { format: 'module', shortCircuit: true, source: outputText };
  },
});

const { cleanup, tie } = await import('./world.ts');
const providers = process.argv.slice(2);
try {
  const edges = await tie(providers);
  console.log(JSON.stringify({ locale: new Intl.Collator().resolvedOptions().locale, order: providers[0].localeCompare(providers[1]), edges }));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await cleanup();
  process.exit();
}
