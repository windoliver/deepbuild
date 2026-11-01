// #881 AC3's planted wrong program (the criterion names none; regression protection): project trust keyed by the
// folder as given. The extension host's public entry, with every module's exports as they are, except `openTrust`:
// each reader it opens keeps a list of its own keyed by the path it was given, so a symlink and its target each get
// their own answer. Your answers still reach the record.
export { API as EXTENSION_API, type ApiMethod } from '../runtime/deep.mjs';
export * from './digest.js';
export * from './host.js';
export * from './sources.js';
export * from './kit.js';
export * from './trust.js';
import { openTrust as openRealTrust, type ProjectTrust } from './trust.js';

export async function openTrust(...args: Parameters<typeof openRealTrust>): Promise<ProjectTrust> {
  const real = await openRealTrust(...args);
  const list = new Map<string, boolean>();
  return {
    async trusted(project) {
      return list.get(project) ?? false;
    },
    async answer(connection, project, trusted) {
      await real.answer(connection, project, trusted);
      list.set(project, trusted);
    },
  };
}
