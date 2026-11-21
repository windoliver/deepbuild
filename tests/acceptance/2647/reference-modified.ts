// The merge base's `modified` (packages/hub/src/codex-settings.ts at 6a2b68d44), with the helpers it calls there
// (`recordedHome`, `entriesFor`, `recorded`, claude-settings.ts's `readJson`), copied as they were so AC5 compares a
// change's `modified` with what the merge base returns for the same files. Its reads go through `readFileSync` from
// node:fs as the base's do; AC5 counts opens only while the program under test runs, never while this runs.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function readJson(file: string): Obj | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return isObj(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
const home = (): string => process.env.CODEX_HOME || join(homedir(), '.codex');
const recordFile = (root: string): string => join(root, 'codex-hooks.json');
const recordedHome = (root: string): string => { const set = readJson(recordFile(root))?.home; return typeof set === 'string' && set ? set : home(); };
const entriesFor = (root: string, event: string): Obj[] => {
  const file = join(recordedHome(root), 'hooks.json');
  const hooks = existsSync(file) ? readJson(file)?.hooks : undefined;
  const groups = isObj(hooks) && Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [];
  return groups.flatMap((g) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks.filter(isObj) : []));
};
type Group = { hooks: Obj[] };
function recorded(root: string): { event: string; command: string; entry: Obj }[] {
  const record = readJson(recordFile(root));
  if (!record || !isObj(record.hooks)) return [];
  return Object.entries(record.hooks).flatMap(([event, g]) => ((g as Group).hooks ?? []).map((entry) => ({ event, command: String(entry.command), entry })));
}
export function modifiedOnBase(root: string): string[] {
  const file = join(recordedHome(root), 'hooks.json');
  return recorded(root).flatMap(({ event, command, entry }) => {
    const found = entriesFor(root, event).find((h) => h.command === command);
    if (!found) return [`Codex's ${event} entry was removed from ${file}, so that hook doesn't reach the hub`];
    return JSON.stringify(found) === JSON.stringify(entry) ? [] : [`Codex's ${event} entry was modified in ${file}: it isn't what setup wrote, so Codex asks for trust again and holds may not fit`];
  });
}
