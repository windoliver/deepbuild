// Loaded in the hub process only. Inject the existing public EvalOptions.launcher
// seam; runEval itself and its return value are never mocked or rewritten.
import { registerHooks } from 'node:module';
const fixture = new URL('./launcher.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (specifier !== '@deepbuild/config-eval') return resolved;
    const source = `
      export * from ${JSON.stringify(resolved.url)};
      import { runEval as real } from ${JSON.stringify(resolved.url)};
      import { launcher } from ${JSON.stringify(fixture)};
      export const runEval = (options) => real({ ...options, launcher: launcher() });
    `;
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  },
});
