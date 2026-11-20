// The merge base's `ownChanges` (packages/gate/src/own.ts at 6a2b68d44), with `ownRead` and the runner-config pattern
// it reads, copied as they were so AC2 compares a change's `ownChanges` with the list the merge base returns for the
// same claim. Nothing here is the program under test.
const OWN_FOLDERS = new Set(['test', 'tests', '__tests__', 'fixtures', '__fixtures__', '__snapshots__', 'scripts', 'spec']);
const ownRead = (path: string): boolean => path.split('/').slice(0, -1).some((part) => OWN_FOLDERS.has(part));
const LOADED_BY_TOOL = /(^|\/)((vitest|vite|jest)\.config\.[cm]?[jt]s|vitest\.workspace\.[cm]?[jt]s|pytest\.ini|conftest\.py)$/;
export type ChangesPlant = 'edited-check-approved' | 'own-files-test-folders-only';
export interface Changes { changed: readonly string[]; configs: ReadonlyMap<string, string>; scripts: boolean }

export function ownChangesOnBase(changes: Changes, read: readonly string[], plant?: ChangesPlant): string[] {
  if (plant === 'edited-check-approved') return [];
  const { changed, configs } = changes;
  const reads = new Set(read);
  const named = (path: string): boolean => [...configs].some(([config, text]) => {
    const dir = config.includes('/') ? config.slice(0, config.lastIndexOf('/') + 1) : '';
    if (!path.startsWith(dir)) return false;
    const rel = path.slice(dir.length);
    return [rel, rel.replace(/\.[cm]?[jt]s$/, '')].some((name) => new RegExp(`['"\`](\\./)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(text));
  });
  const script = (path: string): boolean => path === 'package.json' && changes.scripts && reads.has(path);
  return changed.filter((path) => (reads.has(path) && ownRead(path)) || (plant !== 'own-files-test-folders-only' && (LOADED_BY_TOOL.test(path) || named(path) || script(path))));
}
