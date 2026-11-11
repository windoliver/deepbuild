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
  /** Each input by name; one declared `many` (#154) takes zero or more files, in order, all of them in the key. */
  schema: { params: Schema; inputs: Record<string, { media?: string; many?: boolean }> };
  outputs: Record<string, { media?: string }>;
  key: string[];
  output_checks: string[];
  qualification: { fixtures: JobFixture[] };
}
/** A weight file an open model's tool runs, by its name on the host and its hash (#1924). */
export interface Weight { name: string; sha256: string }
/**
 * A tool runs as its own files (`run {dir, entry}`), or off the machine at a URL on the one host its manifest names
 * (`run {url}`, #1924); one that runs an open model there declares its weight files by hash and the capabilities its
 * call needs, which the host reports before each call.
 */
export interface JobTool {
  tool: string; params: Schema; run: { dir: string; entry: string } | { url: string }; qualification: unknown; cost?: { usd: number };
  weights?: Weight[]; needs?: string[];
}
/**
 * What an install holds of the job API: the kinds it registered, and its tools, each with the build it qualified as,
 * none for a tool off the machine, whose files aren't here, and the host it runs on.
 */
export interface HeldJobs { kinds: Record<string, JobKind>; tools: { kind: string; tool: string; build: string | null; host?: string; descriptor: JobTool; provider?: string }[] }
/**
 * A paid call's run (#1923): the provider's host the tool may reach, its submission key, and the call journal it
 * appends to, `{key, provider}` before its request leaves and `{key, provider, task}` when the provider answers.
 */
export interface JobCall { provider: string; key: string; journal: string }
/** A job's input files by name: one file each, or a list for an input declared `many` (#154). */
export type JobBytes = Record<string, Uint8Array | Uint8Array[]>;
/** A qualification fixture's inputs as bytes: each text in UTF-8, and an empty list for a `many` input it leaves out. */
export function fixtureInputs(inputs: JobKind['schema']['inputs'], texts: Texts): JobBytes {
  const bytes: JobBytes = Object.fromEntries(Object.entries(texts).map(([n, t]) => [n, Buffer.from(t, 'utf8')]));
  for (const [n, d] of Object.entries(inputs)) if (d.many && !bytes[n]) bytes[n] = [];
  return bytes;
}
/** The inputs as a tool reads them on stdin: each file's bytes in base64, a list as a list. */
export function encodedInputs(inputs: JobBytes): Record<string, string | string[]> {
  const b64 = (b: Uint8Array): string => Buffer.from(b).toString('base64');
  return Object.fromEntries(Object.entries(inputs).map(([n, b]) => [n, Array.isArray(b) ? b.map(b64) : b64(b)]));
}
/** The URL a tool off the machine is called at, or undefined for one that runs as its own files. */
export const urlOf = (t: JobTool): string | undefined => ('url' in t.run ? t.run.url : undefined);
/** The planted hosts of #1922 AC6 and AC7, each a build that isn't the digest of the tool's files as installed. */
export type BuildPlant = 'job-build-entry-only' | 'job-build-hashes-paths' | 'job-build-hashes-mtimes';
/** A running tool's own counter (#1925): done of a total, such as frames written or steps of a span, or a provider's percent. */
export type JobCounter = { done: number; total: number } | { percent: number };

/**
 * The counter one line of a tool's stderr reports (#1925): `{"progress": {"done": n, "total": n}}`, whole numbers with
 * done at most the total, or `{"progress": {"percent": n}}` from 0 to 100. Any other line is the tool's own text.
 */
export function counterOf(line: string): JobCounter | undefined {
  let v: unknown;
  try { v = JSON.parse(line); } catch { return undefined; }
  const p = isPlain(v) ? v.progress : undefined;
  if (!isPlain(p)) return undefined;
  const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
  if (whole(p.done) && whole(p.total) && p.total > 0 && p.done <= p.total) return { done: p.done, total: p.total };
  if (typeof p.percent === 'number' && p.percent >= 0 && p.percent <= 100) return { percent: p.percent };
  return undefined;
}

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
  // A kind whose params hold everything it reads, such as typeset (#220), declares no inputs.
  if (!isPlain(k.schema) || !isPlain(k.schema.params) || !isPlain(k.schema.inputs)) throw Error(`the job kind ${kind} declares no params schema and inputs`);
  if (!Object.values(k.schema.inputs).every((i) => isPlain(i) && (i.many === undefined || typeof i.many === 'boolean'))) throw Error(`the job kind ${kind}'s inputs are {name: {media, many}}, many true or false`);
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

/**
 * A tool as `deep.registerJobTool` declares it, its files under the package's folder or its URL on `host`, the one
 * host its manifest names for it, or an Error naming what isn't so.
 */
export function toolOf(kind: string, raw: unknown, folder: string, host?: string): JobTool {
  const t = (isPlain(raw) ? raw : {}) as Partial<JobTool>;
  if (typeof t.tool !== 'string' || !TOOL.test(t.tool)) throw Error(`a tool of ${kind} is pinned by name@version, not ${JSON.stringify(t.tool)}`);
  const run = (isPlain(t.run) ? t.run : {}) as { dir?: unknown; entry?: unknown; url?: unknown };
  if (run.url !== undefined || host !== undefined) {
    let url: URL | undefined;
    try { url = new URL(String(run.url)); } catch { /* not a URL */ }
    // Over https, or plain http on loopback only, as a model's call is made.
    const loopback = url && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!url || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) throw Error(`${t.tool} runs off the machine at run {url}, over https or plain http on loopback, not ${JSON.stringify(run.url)}`);
    if (url.host !== host) throw Error(`${t.tool}'s run {url} is on ${url.host}, and its manifest's job_tools names ${host ?? 'no host'} for it: a call goes only to the host the manifest names`);
    const weights = t.weights ?? [];
    if (!Array.isArray(weights) || !weights.every((w) => isPlain(w) && typeof w.name === 'string' && !!w.name && typeof w.sha256 === 'string' && /^[0-9a-f]{64}$/.test(w.sha256))) throw Error(`${t.tool}'s weights are [{name, sha256}], each file by its SHA-256`);
    if (!Array.isArray(t.needs ?? []) || !(t.needs ?? []).every((n) => typeof n === 'string' && !!n)) throw Error(`${t.tool}'s needs are the capabilities its call needs, by name`);
  } else {
    const { dir, entry } = run;
    const inside = (p: unknown): p is string => typeof p === 'string' && !!p && !isAbsolute(p) && !normalize(p).startsWith('..');
    if (!inside(dir) || !inside(entry)) throw Error(`${t.tool} names its files as run {dir, entry} inside its package`);
    if (!statSync(join(folder, dir, entry), { throwIfNoEntry: false })?.isFile()) throw Error(`${t.tool}'s entry ${dir}/${entry} isn't a file of its package`);
    if (t.weights !== undefined || t.needs !== undefined) throw Error(`${t.tool} declares weights or needs, which its host reports before each call, and runs on no host`);
  }
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
