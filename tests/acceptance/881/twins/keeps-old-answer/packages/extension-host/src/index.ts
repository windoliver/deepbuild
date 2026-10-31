// #881 AC2's planted wrong program: "a cache that keeps the old answer until the hub restarts". The extension host's
// public entry, with every module's exports as they are, except `openTrust`: each reader it opens keeps the first
// answer it reads for each project and never reads again, so only a new reader (the hub restarting) sees a revoke.
// Your answers still reach the record. Anything else the reader offers is passed through unchanged.
export { API as EXTENSION_API, type ApiMethod } from '../runtime/deep.mjs';
export * from './digest.js';
export * from './host.js';
export * from './sources.js';
export * from './kit.js';
export * from './trust.js';
import { openTrust as openRealTrust, type ProjectTrust } from './trust.js';

export async function openTrust(...args: Parameters<typeof openRealTrust>): Promise<ProjectTrust> {
  const real = await openRealTrust(...args);
  const kept = new Map<string, Promise<boolean>>();
  return new Proxy(real, {
    get(target, key, receiver) {
      if (key === 'trusted') {
        return (project: string): Promise<boolean> => {
          if (!kept.has(project)) kept.set(project, target.trusted(project));
          return kept.get(project)!;
        };
      }
      const value = Reflect.get(target, key, receiver) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
