#!/usr/bin/env node
// The panel catalog's lint check (#1425): a panel imports only @deepbuild/panel, so the extension guide and its samples
// never name the toolkit (no `gpui-` string in any of their files), every component the pinned toolkit exports is on the
// catalog or on its not_offered list (so a toolkit bump can't add one unnoticed), and each not_offered entry says why.
// One `PASS panel-catalog` line, or one `FAIL panel-catalog: <finding>` line per finding and exit 1.
//   node scripts/panel-catalog.mjs
// DEEP_PANEL_CATALOG and DEEP_PANEL_TOOLKIT_INVENTORY name other copies of the catalog and of the toolkit's inventory.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = process.env.DEEP_PANEL_CATALOG || join(ROOT, 'crates/deep-app/panel-catalog.json');
const GUIDE = ['docs/extension-guide.md', 'docs/extension-guide'];
const fails = [];

// The guide and its samples, as the checkout holds them: tracked, or untracked and not ignored.
const guide = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...GUIDE], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter((file) => file && existsSync(join(ROOT, file)));
for (const file of [...new Set(guide)].sort()) {
  readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, at) => {
    if (line.includes('gpui-')) fails.push(`${file}:${at + 1} names the toolkit ("gpui-"); a panel and the guide name only @deepbuild/panel`);
  });
}

/** The pinned gpui-shell's component inventory, from cargo's metadata for this checkout's Cargo.lock. */
function pinnedInventory() {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 29 }));
  const shell = metadata.packages.find((p) => p.name === 'gpui-shell');
  if (!shell) throw Error('cargo metadata lists no gpui-shell');
  return join(dirname(shell.manifest_path), 'component-inventory.json');
}

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const listed = new Set([...(catalog.components ?? []), ...(catalog.not_offered ?? [])].map((entry) => entry.name));
const inventory = JSON.parse(readFileSync(process.env.DEEP_PANEL_TOOLKIT_INVENTORY || pinnedInventory(), 'utf8'));
const exported = new Set();
for (const item of inventory.items ?? []) {
  if (item.classification === 'infrastructure') continue;
  for (const name of item.registration?.exports ?? []) exported.add(name);
  for (const part of item.registration?.related ?? []) for (const name of part.exports ?? []) exported.add(name);
}
for (const name of [...exported].sort()) {
  if (!listed.has(name)) fails.push(`${name}: the toolkit exports it, and it is on neither the catalog nor its not_offered list in crates/deep-app/panel-catalog.json`);
}

for (const entry of catalog.not_offered ?? []) {
  if (typeof entry.reason !== 'string' || !entry.reason.trim()) fails.push(`${entry.name}: its not_offered entry gives no reason`);
}
const offered = new Set((catalog.components ?? []).map((entry) => entry.name));
for (const entry of catalog.components ?? []) {
  if (!entry.props || typeof entry.props !== 'object' || typeof entry.example !== 'string' || !entry.example.trim()) fails.push(`${entry.name}: its catalog entry needs its props and an example`);
}
for (const entry of catalog.not_offered ?? []) {
  if (offered.has(entry.name)) fails.push(`${entry.name}: it is both on the catalog and not offered`);
}

for (const fail of fails) console.log(`FAIL panel-catalog: ${fail}\n  Fix: name the toolkit nowhere in the guide, put the component on the catalog or on not_offered with its reason`);
if (fails.length) process.exit(1);
console.log(`PASS panel-catalog: the guide names no toolkit, the ${exported.size} toolkit components are each on the catalog or not offered, each with its reason`);
