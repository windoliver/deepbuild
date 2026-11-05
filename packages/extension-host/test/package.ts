// What the host's tests share: temp folders and opened stores, closed and removed after each file, and packages of code.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageDigest } from '../src/index.js';

/** The preview methods a package's code calls, which its manifest lists by name since #139 (requires.preview). */
const PREVIEW = /\bdeep\.(on|registerResolver|registerSource|registerEnvironment|lease|registerView|readNow|registerAdapter|registerRoute|registerIndex|record\.append|record\.query|evidence\.put|asks\.create|config\.get|notices\.send|store|schedule|secret|send|provide|use|read|fetch|registerAction)\(/g;
const previewOf = (code: string): { requires?: { preview: string[] } } => {
  const used = [...new Set([...code.matchAll(PREVIEW)].map((m) => `deep.${m[1]}`))].sort();
  return used.length ? { requires: { preview: used } } : {};
};

const dirs: string[] = [];
/** What a test opened, closed last-first by `cleanup`. */
export const closing: { close(): Promise<void> }[] = [];
/** Each file's afterAll: closes what its tests opened and removes their folders. */
export async function cleanup(): Promise<void> {
  for (const c of closing.reverse()) await c.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
export const temp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'deep-ext-test-')));
  dirs.push(d);
  return d;
};

/** A package of `code`, its manifest's id and fields given, its digest stamped. */
export function pkgOf(id: string, code: string, fields: Record<string, unknown> = {}, file = 'index.ts'): string {
  const folder = temp();
  writeFileSync(join(folder, file), code, { mode: file === 'main' ? 0o755 : 0o644 });
  const manifest = { id, version: '1.0.0', digest: '', ...previewOf(code), ...fields };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return folder;
}
