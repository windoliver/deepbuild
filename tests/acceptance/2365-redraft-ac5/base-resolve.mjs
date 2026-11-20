// How a child process loads the merge base from its exported `.ts` sources. The merge base's sources import their
// siblings as .js; the source beside each is .ts, which Node doesn't try (resolved as scripts/lifecycle-sim.mjs
// resolves them). Importing this file registers that resolution: base-copy.mjs imports it before it loads the merge
// base's archive, and base.ts preloads it (`node --import`) into each of the merge base's own build steps.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
      try { return next(`${specifier.slice(0, -3)}.ts`, context); } catch { /* a real .js */ }
    }
    return next(specifier, context);
  },
});
