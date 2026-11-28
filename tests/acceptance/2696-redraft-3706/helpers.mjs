import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtFiles, builtPackages, childEnv, copyCheckout, MIN, REPO, run, scratch, shown, textOf } from '../2696/helpers.mjs';

export { builtFiles, childEnv, cleanup, coreHeap, highFiles, lineCount, messagesOf, MIN, NODE, REPO, run, scratch, seedHistory, shortTemp, shown, textOf, where } from '../2696/helpers.mjs';

export const ABOVE = /[^\u0000-\u00ff]/u;
export const MB = 2 ** 20;
export const mb = (bytes) => (bytes / MB).toFixed(3);
export const listed = (list, n = 5) => `${list.slice(0, n).join('\n')}${list.length > n ? `\n... and ${list.length - n} more` : ''}`;

const NEEDLESS = ['tests', 'docs', 'reports'];

export function rootEntriesAtHead() {
  const listedNames = spawnSync('git', ['ls-tree', '--name-only', 'HEAD'], { cwd: REPO, encoding: 'utf8', env: childEnv() });
  const names = String(listedNames.stdout).split('\n').filter((name) => name && !NEEDLESS.includes(name));
  if (listedNames.status !== 0 || !names.includes('packages')) throw Error(`BLOCKED: git ls-tree HEAD failed in ${REPO}: ${String(listedNames.stderr).trim().split('\n')[0]}`);
  return names;
}

export function needBuiltCheckout() {
  const texts = builtFiles(REPO).filter(({ text }) => text !== null);
  if (!texts.length) throw Error('BLOCKED: this checkout has no built file under packages/*/dist; run npm ci and npm run build --workspaces');
  return texts;
}

function removeBuiltOutput(tree) {
  for (const name of builtPackages(tree)) rmSync(join(tree, 'packages', name, 'dist'), { recursive: true, force: true });
  for (const name of readdirSync(join(tree, 'packages'))) {
    const folder = join(tree, 'packages', name);
    if (!existsSync(folder)) continue;
    for (const entry of readdirSync(folder)) if (entry.endsWith('.tsbuildinfo')) rmSync(join(folder, entry), { force: true });
  }
}

export function copyOfCheckoutAsBuilt(folder, name) {
  return copyCheckout(join(folder, name), rootEntriesAtHead());
}

export async function buildCopyWithoutEscapeStep(folder, name) {
  const tree = copyCheckout(join(folder, name), rootEntriesAtHead());
  removeBuiltOutput(tree);
  writeFileSync(join(tree, 'scripts', 'built-escapes.mjs'), 'process.exit(0);\n');
  const built = await run('npm', ['run', 'build', '--workspaces'], { cwd: tree, timeoutMs: 15 * MIN });
  if (built.code !== 0) throw Error(`BLOCKED: this checkout, copied with its escape step left out, did not build in ${tree}: ${shown(built)}`);
  const left = builtFiles(tree).filter(({ text }) => text !== null && ABOVE.test(text));
  if (!left.length) throw Error('BLOCKED: built without its escape step, no built file of this checkout holds a character above U+00FF, so the escape step has nothing to change and no comparison here could fail');
  return { tree, unescaped: left.length };
}

let unescaped;
export function unescapedTree() {
  unescaped ??= buildCopyWithoutEscapeStep(scratch('deep-2696r-'), 'bare');
  return unescaped;
}

export function sourceFilesAbove() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path); }
      else if (entry.isFile() && /\.(?:[cm]?[jt]s|json)$/.test(entry.name)) {
        const text = textOf(path);
        if (text !== null && ABOVE.test(text)) found.push(path.slice(REPO.length + 1));
      }
    }
  };
  for (const name of builtPackages(REPO)) if (existsSync(join(REPO, 'packages', name, 'src'))) walk(join(REPO, 'packages', name, 'src'));
  return found;
}
