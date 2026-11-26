// How this suite loads a commit's exported `.ts` sources (base.mjs), as scripts/lifecycle-sim.mjs loads the record's
// from this checkout: a source imports its siblings as `.js` and the file beside it is `.ts`; a workspace package
// resolves to its source, the `development` condition of its package.json; and types are stripped with the repo's own
// TypeScript, since Node's own type stripping refuses a source of the base (packages/evidence/src/records.ts).
// Importing this file registers that for the process: base.mjs imports it, and preloads it (`node --import`) into
// each build step of the exported packages.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      try { return next(`${specifier.slice(0, -3)}.ts`, context); } catch { /* a real .js */ }
    }
    if (specifier.startsWith('@deepbuild/')) return next(specifier, { ...context, conditions: [...(context.conditions ?? []), 'development'] });
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts') || url.endsWith('.d.ts')) return next(url, context);
    const file = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
