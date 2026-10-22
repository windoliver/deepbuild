// Stand-ins, found by a search of the source with no model: a check whose setup (a test file its run read, or one
// in the repo's test, fixture and script folders) writes a table or settings key that no file outside those folders writes
// tests a state real users never reach, so it is marked a stand-in, naming the table and the file that seeds it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { OWN_FOLDERS, ownFile } from './report.js';

export interface Seeded { name: string; by: string; standIn: boolean }

/** SQL that writes a table, and a settings call that writes a key. */
const WRITES = [
  /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"[]?([A-Za-z_]\w*)/gi, /\bREPLACE\s+INTO\s+[`"[]?([A-Za-z_]\w*)/gi, /\bUPDATE\s+[`"[]?([A-Za-z_]\w*)[`"\]]?\s+SET\b/gi,
  /\b(?:setSetting|settings\.set|config\.set)\(\s*['"`]([\w.:-]+)['"`]/g,
];
const SKIP = new Set(['node_modules', '.git']);
/** Text files only, and not huge ones: a source search, not a scan of build output. */
const MAX_BYTES = 1_000_000;
const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rb|sql|php|java|kt|rs|cs|swift)$/;

const written = (text: string): Set<string> => new Set(WRITES.flatMap((w) => [...text.matchAll(w)].map((m) => m[1]!)));
const textOf = (path: string): string => {
  try {
    return statSync(path).size <= MAX_BYTES ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
};

/** What the run's setup seeds, each a stand-in unless a file outside the test, fixture and script folders writes it too. */
export function seededBy(checkout: string, read: string[]): Seeded[] {
  const setup = read.filter((p) => ownFile(p) && !p.startsWith('node_modules/') && SOURCE.test(p));
  const seeds = new Map<string, string>();
  for (const path of setup) for (const name of written(textOf(join(checkout, path)))) if (!seeds.has(name)) seeds.set(name, path);
  if (!seeds.size) return [];
  const app = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const rel = relative(checkout, path).split(sep).join('/');
      if (entry.isDirectory()) {
        if (!OWN_FOLDERS.test(`${rel}/`)) walk(path);
      } else if (entry.isFile() && SOURCE.test(entry.name) && !ownFile(rel)) for (const name of written(textOf(path))) app.add(name);
    }
  };
  walk(checkout);
  return [...seeds].map(([name, by]) => ({ name, by, standIn: !app.has(name) }));
}
