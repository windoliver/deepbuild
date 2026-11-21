// #1898: a static import walk over the built JavaScript, as Node resolves it at run time (the `default` condition of
// each package's `exports`, workspace links followed to their real files). An edge is an `import … from '…'`,
// `export … from '…'` or bare `import '…'` declaration, or a `require('…')` call naming its module by a string literal
// (CommonJS's static form, and an ES module's createRequire). A dynamic `import(…)` is not an edge: it loads only when
// the code runs that far, and a static closure leaves it out.
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const REPO = realpathSync(new URL('../../../', import.meta.url).pathname);
const BUILTIN = new Set(builtinModules);

const IMPORT = /^[ \t]*(?:import|export)[ \t\r\n]+(?:type[ \t]+)?(?:[\w$*{},\s]|\bas\b)*?[ \t\r\n]*from[ \t]*['"]([^'"]+)['"]/gm;
const BARE = /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;
const REQUIRE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

/** The specifiers a module names statically, each with how it's named (ESM or require). */
export function edges(file: string): { spec: string; how: 'import' | 'require' }[] {
  if (!/\.(m|c)?js$/.test(file)) return [];
  const text = readFileSync(file, 'utf8');
  const out: { spec: string; how: 'import' | 'require' }[] = [];
  for (const re of [IMPORT, BARE]) for (const m of text.matchAll(re)) out.push({ spec: m[1]!, how: 'import' });
  for (const m of text.matchAll(REQUIRE)) out.push({ spec: m[1]!, how: 'require' });
  return out;
}

const file = (path: string): string | undefined => {
  for (const candidate of [path, `${path}.js`, `${path}.mjs`, `${path}.cjs`, `${path}.json`, `${path}.node`, join(path, 'index.js')])
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate);
  return undefined;
};

type Exports = string | null | Exports[] | { [key: string]: Exports };
const conditioned = (target: Exports, conditions: string[]): string | undefined => {
  if (typeof target === 'string') return target;
  if (target === null) return undefined;
  if (Array.isArray(target)) {
    for (const t of target) { const hit = conditioned(t, conditions); if (hit) return hit; }
    return undefined;
  }
  for (const [key, value] of Object.entries(target)) if (conditions.includes(key)) { const hit = conditioned(value, conditions); if (hit) return hit; }
  return undefined;
};

/** A bare specifier's file, from the nearest node_modules folder above `from` that holds its package. */
function bare(spec: string, from: string, how: 'import' | 'require'): string | undefined {
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  const sub = `.${spec.slice(name.length)}`;
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    const pkgDir = join(dir, 'node_modules', name);
    if (existsSync(join(pkgDir, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { exports?: Exports; main?: string };
      const conditions = ['node', how, 'default'];
      if (pkg.exports !== undefined) {
        const map = typeof pkg.exports === 'object' && pkg.exports !== null && !Array.isArray(pkg.exports) && Object.keys(pkg.exports).some((k) => k.startsWith('.'))
          ? pkg.exports as Record<string, Exports> : { '.': pkg.exports };
        let target = map[sub] !== undefined ? conditioned(map[sub]!, conditions) : undefined;
        if (target === undefined)
          for (const [key, value] of Object.entries(map)) {
            const star = key.indexOf('*');
            if (star < 0 || !sub.startsWith(key.slice(0, star)) || !sub.endsWith(key.slice(star + 1))) continue;
            const hit = conditioned(value, conditions);
            if (hit) { target = hit.replaceAll('*', sub.slice(star, sub.length - (key.length - star - 1))); break; }
          }
        return target === undefined ? undefined : file(join(pkgDir, target));
      }
      return file(join(pkgDir, sub === '.' ? (pkg.main ?? 'index.js') : sub));
    }
    if (dir === dirname(dir)) return undefined;
  }
}

/** Where `spec`, named in `from`, resolves: a file, a built-in, or undefined when it doesn't resolve. */
export function resolveFrom(spec: string, from: string, how: 'import' | 'require'): string | undefined {
  if (spec.startsWith('node:') || BUILTIN.has(spec)) return spec.startsWith('node:') ? spec : `node:${spec}`;
  if (spec.startsWith('.') || spec.startsWith('/')) return file(spec.startsWith('/') ? spec : join(dirname(from), spec));
  if (spec.startsWith('file:')) return file(new URL(spec).pathname);
  return bare(spec, from, how);
}

/** A module the lease path must not reach: the yaml package, better-sqlite3, or any native addon. */
export const forbidden = (path: string): string | undefined =>
  /\/node_modules\/yaml\//.test(path) ? 'yaml'
    : /\/node_modules\/better-sqlite3\//.test(path) ? 'the SQLite addon (better-sqlite3)'
      : path.endsWith('.node') ? 'a native addon' : undefined;

export const shown = (path: string): string => path.startsWith('node:') ? path : relative(REPO, path);

export interface Walk {
  /** Every module reached, with the module that first named it (undefined for a root). */
  parent: Map<string, { from: string | undefined; spec: string }>;
  /** Specifiers that resolved to nothing, by the module naming them. */
  unresolved: string[];
  /** Each forbidden module reached, with its chain from a root. */
  hits: { what: string; chain: string[] }[];
}

/** The static closure of `roots` (each with how it's reached, for the chain); forbidden modules end their branch. */
export function walk(roots: { file: string; via: string }[]): Walk {
  const parent: Walk['parent'] = new Map();
  const unresolved: string[] = [];
  const hits: Walk['hits'] = [];
  const queue: string[] = [];
  for (const root of roots) if (!parent.has(root.file)) { parent.set(root.file, { from: undefined, spec: root.via }); queue.push(root.file); }
  const chain = (path: string): string[] => {
    const out: string[] = [];
    for (let at: string | undefined = path; at !== undefined; at = parent.get(at)!.from) {
      const { from, spec } = parent.get(at)!;
      out.unshift(from === undefined ? `${spec} ${shown(at)}` : `${shown(at)} (as '${spec}')`);
    }
    return out;
  };
  while (queue.length) {
    const at = queue.shift()!;
    const what = forbidden(at);
    if (what) { hits.push({ what, chain: chain(at) }); continue; }
    if (at.startsWith('node:')) continue;
    for (const { spec, how } of edges(at)) {
      const to = resolveFrom(spec, at, how);
      if (to === undefined) { unresolved.push(`${shown(at)}: '${spec}'`); continue; }
      if (parent.has(to)) continue;
      parent.set(to, { from: at, spec });
      queue.push(to);
    }
  }
  return { parent, unresolved, hits };
}
