// Load the public CLI and its workers from this checkout's TypeScript, without stale dist or product mocks.
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('.') || specifier.startsWith('file:') || specifier.startsWith('/')) && specifier.endsWith('.js')) {
      const url = new URL(specifier, context.parentURL).href;
      if (url.startsWith('file:') && url.includes('/src/') && existsSync(fileURLToPath(url.slice(0, -3) + '.ts')))
        return next(url.slice(0, -3) + '.ts', context);
    }
    return next(specifier, { ...context, conditions: [...(context.conditions ?? []), 'development'] });
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText };
  },
});
