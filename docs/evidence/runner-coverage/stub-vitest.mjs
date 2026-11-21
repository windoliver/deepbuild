// For a hand run outside vitest: helpers.ts registers an afterAll at load; give it a no-op vitest.
import { registerHooks } from 'node:module';
const stub = 'data:text/javascript,' + encodeURIComponent('export const afterAll = () => {}; export const expect = () => { throw Error("no expect in a hand run"); };');
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'vitest') return { url: stub, shortCircuit: true };
    return next(specifier, context);
  },
});
