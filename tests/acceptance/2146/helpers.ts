// Shared by #2146's acceptance tests: the repo's paths, the lint's real run, and the published schemas with one enum
// widened by a code nothing maps. The few pointer lines are copied from tests/acceptance/313/helpers.ts, which this
// suite doesn't import.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSchemas } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Schema, SchemaEntry } from '../../../packages/contracts/src/index.ts';

export const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
/** A code no family maps and no schema lists, as #313's tests plant. */
export const PLANTED = 'flaky_maybe';
/** The lint takes about a minute on a loaded machine; a test that waits for it gets ten. */
export const LINT_TIMEOUT_MS = 600_000;

type JsonObject = { [key: string]: JsonValue };
const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const segments = (pointer: string): string[] => (pointer === '' ? [] : pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')));
const segment = (key: string): string => `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;

export interface Lint { status: number | null; signal: string | null; lines: string[]; stderr: string }
/** One real run of `node scripts/conformance-lint.mjs` in the checkout, over the built packages. */
export function runLint(): Lint {
  const ran = spawnSync(process.execPath, ['scripts/conformance-lint.mjs'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: LINT_TIMEOUT_MS - 30_000 });
  if (ran.error) throw ran.error;
  return { status: ran.status, signal: ran.signal, lines: ran.stdout.split('\n').filter(Boolean), stderr: ran.stderr };
}

export interface EnumAt { schema: string; pointer: string; values: string[] }
/** Every enum node of the published schemas, by its schema and the JSON Pointer of the node that holds `enum`. */
export function publishedEnums(): EnumAt[] {
  const found: EnumAt[] = [];
  const walk = (schema: string, node: JsonValue | undefined, pointer: string): void => {
    if (Array.isArray(node)) return node.forEach((child, i) => walk(schema, child, `${pointer}/${i}`));
    if (!isObject(node)) return;
    if (Array.isArray(node.enum)) found.push({ schema, pointer, values: node.enum.map(String) });
    for (const [key, child] of Object.entries(node)) if (key !== 'enum') walk(schema, child, `${pointer}${segment(key)}`);
  };
  for (const { name, schema } of listSchemas()) walk(name, schema as JsonValue, '');
  return found;
}

/** The published schemas, with `code` added to the enum of the node at `pointer` in the schema `name`. */
export function widened(name: string, pointer: string, code: string): SchemaEntry[] {
  let hit = false;
  const entries = listSchemas().map((entry): SchemaEntry => {
    if (entry.name !== name) return entry;
    const schema = structuredClone(entry.schema);
    const node = segments(pointer).reduce<unknown>((at, key) => (Array.isArray(at) ? at[Number(key)] : isObject(at) ? at[key] : undefined), schema);
    if (!isObject(node) || !Array.isArray(node.enum)) throw Error(`${name} has no enum at ${JSON.stringify(pointer)}`);
    node.enum = [...node.enum, code];
    hit = true;
    return { name, schema: schema as Schema };
  });
  if (!hit) throw Error(`no published schema is named ${name}`);
  return entries;
}
