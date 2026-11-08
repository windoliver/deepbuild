#!/usr/bin/env node
// The `deep` of the npm package (#41), shipped as bin/deep.mjs by scripts/release-stage.mjs. npm ships no links, and the
// workspaces keep the checkout's layout (their code reads the package's root by relative path), so on each start it
// makes what is missing of what npm would have linked: node_modules/@deepbuild/<name> to packages/<dir>, and SQLite's
// native module to the copy in this platform's deep-hook package. Then it runs the CLI.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
/** A link made under a name of its own and renamed into place, so two starts at once never see half of one. */
const link = (target, at) => {
  if (existsSync(at)) return;
  mkdirSync(dirname(at), { recursive: true });
  const tmp = `${at}.${process.pid}`;
  try {
    symlinkSync(relative(dirname(at), target), tmp);
    renameSync(tmp, at);
  } catch (error) {
    rmSync(tmp, { force: true });
    if (!existsSync(at)) {
      process.stderr.write(`deep: can't finish the install in ${root}: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }
};
for (const dir of readdirSync(join(root, 'packages'))) {
  const meta = join(root, 'packages', dir, 'package.json');
  if (existsSync(meta)) link(join(root, 'packages', dir), join(root, 'node_modules', ...JSON.parse(readFileSync(meta, 'utf8')).name.split('/')));
}
const sqlite = join(root, 'node_modules', 'better-sqlite3', 'prebuilds', `${process.platform}-${process.arch}.node`);
if (!existsSync(sqlite)) {
  try {
    const platform = dirname(createRequire(join(root, 'package.json')).resolve(`@deepbuild/deep-hook-${process.platform}-${process.arch}/package.json`));
    link(join(platform, 'bin', 'better_sqlite3.node'), sqlite);
  } catch {
    process.stderr.write(`deep: no @deepbuild/deep-hook-${process.platform}-${process.arch} is installed beside ${root}; this platform has no DeepBuild build\n`);
    process.exit(1);
  }
}
await import(pathToFileURL(join(root, 'packages', 'cli', 'dist', 'main.js')).href);
