// #12 AC3: no workflow under `.github/workflows/`.
//
// Read from the repository tree: the files git lists there, tracked or new, and any file on disk there.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AC3, MINUTE, ROOT, listed } from './helpers.ts';

function onDisk(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => !entry.isDirectory()).map((entry) => join(entry.parentPath, entry.name));
}

it(`${AC3} no workflow under .github/workflows/`, () => {
  const tracked = listed().filter((path) => path.startsWith('.github/workflows/'));
  expect(tracked, `${AC3} git lists no file under .github/workflows/`).toEqual([]);
  expect(onDisk(join(ROOT, '.github/workflows')), `${AC3} no file sits under .github/workflows/`).toEqual([]);
}, MINUTE);
