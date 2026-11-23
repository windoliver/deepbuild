// #2696 (blind): a child of compare.test.mjs. `node load.mjs <tree> <out file>` loads every entry each package of the
// tree names in its package.json (`exports`, `main`) and writes, as JSON, every string the entry exports that holds a
// character above U+00FF, by its path from the entry: a string itself, or one held in an exported array, object, Map
// or Set, or as a class's static value, to any depth. A key that holds such a character counts too. No exported
// function is called and no getter is read, so nothing runs but each module's own top level. What a module prints as
// it loads goes to this process's output, which the test compares as well.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [tree, out] = process.argv.slice(2);
const HIGH = /[^\u0000-ÿ]/u;

function entriesOf(manifest) {
  const found = new Set();
  const take = (value) => {
    if (typeof value === 'string') { if (/\.[cm]?js$/.test(value)) found.add(value); }
    else if (value && typeof value === 'object') Object.values(value).forEach(take);
  };
  take(manifest.exports);
  take(manifest.main);
  return [...found].sort();
}

function strings(value, path, seen, into, depth = 0) {
  if (typeof value === 'string') {
    if (HIGH.test(value)) into[path] = value;
    return;
  }
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value) || depth > 12) return;
  seen.add(value);
  if (ArrayBuffer.isView(value) || value instanceof RegExp || value instanceof Promise) return;
  if (value instanceof Map) {
    let at = 0;
    for (const [key, held] of value) {
      strings(key, `${path}<key ${at}>`, seen, into, depth + 1);
      strings(held, `${path}<value ${at}>`, seen, into, depth + 1);
      at += 1;
    }
    return;
  }
  if (value instanceof Set) {
    let at = 0;
    for (const held of value) strings(held, `${path}<member ${at++}>`, seen, into, depth + 1);
    return;
  }
  let at = 0;
  for (const key of Object.getOwnPropertyNames(value)) {
    const described = Object.getOwnPropertyDescriptor(value, key);
    if (!described || !('value' in described) || (typeof value === 'function' && key === 'prototype')) continue;
    // A key is named by its place, so a key whose spelling changed still compares under the same path.
    const label = HIGH.test(key) ? `<key ${at}>` : key;
    if (HIGH.test(key)) into[`${path}.${label}#key`] = key;
    strings(described.value, `${path}.${label}`, seen, into, depth + 1);
    at += 1;
  }
}

const result = {};
for (const name of readdirSync(join(tree, 'packages')).sort()) {
  const file = join(tree, 'packages', name, 'package.json');
  if (!existsSync(file)) continue;
  for (const entry of entriesOf(JSON.parse(readFileSync(file, 'utf8')))) {
    const id = `packages/${name}/${entry.replace(/^\.\//, '')}`;
    if (!existsSync(join(tree, id))) continue;
    try {
      const module = await import(pathToFileURL(join(tree, id)).href);
      const into = {};
      strings(module, 'exports', new Set(), into);
      result[id] = { loaded: true, exported: Object.keys(module).length, strings: into };
    } catch (error) {
      result[id] = { loaded: false, error: `${error?.name}: ${String(error?.message).split(tree).join('<tree>').split('\n')[0]}` };
    }
  }
}
writeFileSync(out, JSON.stringify(result));
// A module's timers or handles never keep this child.
process.exit(0);
