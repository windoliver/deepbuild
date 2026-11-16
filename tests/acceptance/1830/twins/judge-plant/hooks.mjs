// Module hooks register.mjs installs: every import of scripts/benchmark.mjs that node itself resolves, in this process
// or a child that inherits NODE_OPTIONS (a suite's lane strings), gets judge.mjs instead, except judge.mjs's own.
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const real = (url) => pathToFileURL(realpathSync(fileURLToPath(url))).href;
const benchmark = real(new URL('../../../../../scripts/benchmark.mjs', import.meta.url));
const plant = real(new URL('./judge.mjs', import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (!resolved.url.startsWith('file:') || context.parentURL === plant) return resolved;
  return real(resolved.url) === benchmark ? { ...resolved, url: plant } : resolved;
}
