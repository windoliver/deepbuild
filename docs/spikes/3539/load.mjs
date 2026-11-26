// #3539: this checkout's packages loaded from their TypeScript sources, as scripts/lifecycle-sim.mjs loads the record,
// so a run never reads a stale build and needs none. A source asked for with `?patch=<file>` is that source with the
// unified diff in <file> applied to it in memory: the changed order runs from a copy, and nothing under packages/
// is written.
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');

/** `source` with the unified diff applied; every context and removed line must be the source's own, at the line the hunk names. */
function applyPatch(source, patch, name) {
  const lines = source.split('\n');
  const out = [];
  let at = 0;
  let hunks = 0;
  const rows = patch.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const head = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(rows[i]);
    if (!head) continue;
    hunks++;
    const from = Number(head[1]) - 1;
    if (from < at) throw Error(`${name}: hunk ${hunks} starts at line ${from + 1}, before the hunk above it ends`);
    out.push(...lines.slice(at, from));
    at = from;
    for (i++; i < rows.length && !rows[i].startsWith('@@'); i++) {
      const row = rows[i];
      if (row.startsWith('\\') || (row === '' && i === rows.length - 1)) continue;
      const text = row.slice(1);
      if (row[0] === '+') { out.push(text); continue; }
      if (row[0] !== ' ' && row[0] !== '-') throw Error(`${name}: hunk ${hunks} has a line that is neither context, removed nor added: ${JSON.stringify(row)}`);
      if (lines[at] !== text) throw Error(`${name}: hunk ${hunks} doesn't apply at line ${at + 1}: the source holds ${JSON.stringify(lines[at])}, the patch ${JSON.stringify(text)}`);
      if (row[0] === ' ') out.push(text);
      at++;
    }
    i--;
  }
  if (!hunks) throw Error(`${name}: no hunk in the patch`);
  return [...out, ...lines.slice(at)].join('\n');
}

registerHooks({
  resolve(specifier, context, next) {
    // A source file imports its siblings as .js; the source beside it is .ts.
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.split('?')[0].endsWith('.ts')) {
      try { return next(`${specifier.slice(0, -3)}.ts`, context); } catch { /* a real .js */ }
    }
    return next(specifier, { ...context, conditions: [...(context.conditions ?? []), 'development'] });
  },
  load(url, context, next) {
    const [file, query] = url.split('?');
    if (!file.startsWith('file:') || !file.endsWith('.ts') || file.endsWith('.d.ts')) return next(url, context);
    const path = fileURLToPath(file);
    const patch = new URLSearchParams(query ?? '').get('patch');
    const source = patch ? applyPatch(readFileSync(path, 'utf8'), readFileSync(patch, 'utf8'), patch) : readFileSync(path, 'utf8');
    const { outputText } = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});

/** A module of this checkout by its path from the repository root, from source; with `patch`, a copy with that diff applied. */
export const source = (path, patch) => import(`${pathToFileURL(join(REPO, path)).href}${patch ? `?patch=${encodeURIComponent(patch)}` : ''}`);

const leaf = (v) => v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'));
/** JSON for a kept file: a row (an object of plain values and lists of them) on one line, whatever holds rows a line each. */
export function kept(value, indent = '') {
  if (leaf(value) || (!Array.isArray(value) && Object.values(value).every(leaf))) return JSON.stringify(value);
  const inner = `${indent} `;
  const parts = Array.isArray(value) ? value.map((v) => kept(v, inner)) : Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${kept(v, inner)}`);
  const [open, close] = Array.isArray(value) ? '[]' : '{}';
  return `${open}\n${parts.map((part) => `${inner}${part}`).join(',\n')}\n${indent}${close}`;
}
