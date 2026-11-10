// Job kinds and the tools that join them (#1922): what `deep.registerJob` and `deep.registerJobTool` hand the host,
// held to their shapes, a kind's params made canonical (every default written out, −0 stored as +0), and a tool's
// build, the digest of its files as installed. All of it is data: a tool's code is its own files, which the host runs
// as a process of their own, never the package's `deep`.
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { registry, sha256Hex, type JsonValue, type Schema } from '@deepbuild/contracts';
import { packageDigest } from './digest.js';

type Texts = Record<string, string>;
export interface JobFixture { name: string; params: Record<string, JsonValue>; inputs: Texts; expect: Texts }
export interface JobKind {
  schema: { params: Schema; inputs: Record<string, { media?: string }> };
  outputs: Record<string, { media?: string }>;
  key: string[];
  output_checks: string[];
  qualification: { fixtures: JobFixture[] };
}
export interface JobTool { tool: string; params: Schema; run: { dir: string; entry: string }; qualification: unknown; cost?: { usd: number } }
/** What an install holds of the job API: the kinds it registered, and its tools, each with the build it qualified as. */
export interface HeldJobs { kinds: Record<string, JobKind>; tools: { kind: string; tool: string; build: string; descriptor: JobTool; provider?: string }[] }
/**
 * A paid call's run (#1923): the provider's host the tool may reach, its submission key, and the call journal it
 * appends to, `{key, provider}` before its request leaves and `{key, provider, task}` when the provider answers.
 */
export interface JobCall { provider: string; key: string; journal: string }
/** The planted hosts of #1922 AC6 and AC7, each a build that isn't the digest of the tool's files as installed. */
export type BuildPlant = 'job-build-entry-only' | 'job-build-hashes-paths' | 'job-build-hashes-mtimes';

export const TOOL = /^[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+$/;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texts = (v: unknown): v is Texts => isPlain(v) && Object.values(v).every((x) => typeof x === 'string');
const KEY_PARTS = ['tool', 'params', 'inputs'];

/** The schema the contracts' validator reads: `default` taken out, and an enum of texts typed as text. */
function checkable(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(checkable);
  if (!isPlain(schema)) return schema;
  const { default: _default, ...rest } = schema;
  const out = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, k === 'enum' || k === 'const' ? v : checkable(v)]));
  if (Array.isArray(out.enum) && out.type === undefined && out.enum.every((e) => typeof e === 'string')) out.type = 'string';
  return out;
}
/** −0 as +0, and nothing but JSON: the params as their canonical form holds them. */
const plain = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v, (_k, x: unknown) => (Object.is(x, -0) ? 0 : x))) as JsonValue;

/**
 * A kind's params made canonical: a JSON object its params schema holds, with each default it declares written out
 * where the params leave it out, so params that differ only by an omitted default or key order are one.
 */
export function paramsOf(schema: Schema, value: unknown): Record<string, JsonValue> {
  if (!isPlain(value)) throw Error('the params are a JSON object');
  const filled: Record<string, unknown> = { ...value };
  for (const [name, prop] of Object.entries(isPlain(schema.properties) ? schema.properties : {})) {
    if (!Object.hasOwn(filled, name) && isPlain(prop) && Object.hasOwn(prop, 'default')) filled[name] = prop.default;
  }
  const params = plain(filled) as Record<string, JsonValue>;
  const held = registry([{ name: 'params', schema: checkable(schema) as Schema }]).validate('params', params);
  if (!held.ok) throw Error(`the params don't hold to the kind's params schema: ${held.issues.map((i) => `${i.path || '/'} ${i.code}`).join(', ')}`);
  return params;
}

/** A kind as `deep.registerJob` declares it, or an Error naming what isn't so. */
export function kindOf(kind: string, raw: unknown): JobKind {
  const k = (isPlain(raw) ? raw : {}) as Partial<JobKind>;
  const fixtures = isPlain(k.qualification) && Array.isArray(k.qualification.fixtures) ? k.qualification.fixtures : [];
  if (!isPlain(k.schema) || !isPlain(k.schema.params) || !isPlain(k.schema.inputs) || !Object.keys(k.schema.inputs).length) throw Error(`the job kind ${kind} declares no params schema and inputs`);
  if (!isPlain(k.outputs) || !Object.keys(k.outputs).length) throw Error(`the job kind ${kind} declares no outputs`);
  if (!Array.isArray(k.key) || KEY_PARTS.some((p) => !k.key!.includes(p)) || k.key.some((p) => !KEY_PARTS.includes(p))) throw Error(`the job kind ${kind}'s key is hash(tool@version, params, input hashes): its key lists tool, params and inputs`);
  if (!Array.isArray(k.output_checks) || !k.output_checks.every((c) => typeof c === 'string' && c)) throw Error(`the job kind ${kind} lists its output checks by check kind`);
  if (!fixtures.length) throw Error(`the job kind ${kind} declares no qualification fixtures`);
  for (const f of fixtures as Partial<JobFixture>[]) {
    if (!isPlain(f) || typeof f.name !== 'string' || !texts(f.inputs) || !texts(f.expect)) throw Error(`the job kind ${kind}'s qualification fixture ${JSON.stringify((f as { name?: unknown })?.name)} names no inputs and expected outputs as text`);
    try {
      paramsOf(k.schema.params, f.params);
    } catch (e) {
      throw Error(`the job kind ${kind}'s qualification fixture ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return plain(k) as unknown as JobKind;
}

/** A tool as `deep.registerJobTool` declares it, its files under the package's folder, or an Error naming what isn't so. */
export function toolOf(kind: string, raw: unknown, folder: string): JobTool {
  const t = (isPlain(raw) ? raw : {}) as Partial<JobTool>;
  if (typeof t.tool !== 'string' || !TOOL.test(t.tool)) throw Error(`a tool of ${kind} is pinned by name@version, not ${JSON.stringify(t.tool)}`);
  const { dir, entry } = (isPlain(t.run) ? t.run : {}) as Partial<JobTool['run']>;
  const inside = (p: unknown): p is string => typeof p === 'string' && !!p && !isAbsolute(p) && !normalize(p).startsWith('..');
  if (!inside(dir) || !inside(entry)) throw Error(`${t.tool} names its files as run {dir, entry} inside its package`);
  if (!statSync(join(folder, dir, entry), { throwIfNoEntry: false })?.isFile()) throw Error(`${t.tool}'s entry ${dir}/${entry} isn't a file of its package`);
  if (!isPlain(t.params)) throw Error(`${t.tool} declares no params schema`);
  if (t.cost !== undefined && !(isPlain(t.cost) && typeof t.cost.usd === 'number' && t.cost.usd >= 0)) throw Error(`${t.tool}'s cost is {usd}, a price per run`);
  return plain(t) as unknown as JobTool;
}

/** Every file under a folder, by its path in it, sorted. */
function files(dir: string, at = ''): string[] {
  return readdirSync(join(dir, at), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((d) => (d.isDirectory() ? files(dir, join(at, d.name)) : [join(at, d.name)]));
}
/**
 * A tool's build: the digest of its files as installed, every file under its folder by path, mode and bytes, so the
 * same files anywhere, at any modified times, are one build. The planted hosts hash its entry alone, or add where the
 * files are, or when they were modified.
 */
export function buildOf(dir: string, entry: string, plant?: string): string {
  const d1 = (text: string): string => `d1:${sha256Hex(new TextEncoder().encode(text))}`;
  if (plant === 'job-build-entry-only') return `d1:${sha256Hex(readFileSync(join(dir, entry)))}`;
  if (plant === 'job-build-hashes-paths') return d1(`${packageDigest(dir)}\n${realpathSync(dir)}`);
  if (plant === 'job-build-hashes-mtimes') return d1(`${packageDigest(dir)}\n${files(dir).map((f) => statSync(join(dir, f)).mtimeMs).join('\n')}`);
  return packageDigest(dir);
}
