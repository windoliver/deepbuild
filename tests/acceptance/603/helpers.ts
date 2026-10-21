// Shared by the #603 acceptance tests: the stop events they plant, refusal assertions, the Rust binary,
// a TypeScript type check over the generated types, and the recorded corpus. None of them stands in for
// the contracts package, the adapters or the corpus replay; see README.md.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { fixtures, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue, Validation } from '../../../packages/contracts/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = realpathSync(join(HERE, '..', '..', '..'));
export const CORPUS = join(REPO, 'adapters', 'corpus');
export const AGENTS = ['claude-code', 'codex'] as const;

export type JsonObject = { [key: string]: JsonValue };
export const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const clone = <T>(v: T): T => structuredClone(v);

export const V1 = 'agent.stop@1';
export const V2 = 'agent.stop@2';

/**
 * The closed set of stop causes (technical-design.md:145), spelled as the base already spells them:
 * adapters/corpus/README.md, "Stop causes", and the slugs adapters/claude-code.facts.json maps to.
 */
export const CAUSES = [
  'sign_in_required', 'token_refresh_failed', 'plan_window_spent', 'rate_limited', 'refusal', 'max_turns',
  'context_overflow', 'tool_schema_rejected', 'agent_crashed', 'timed_out', 'unknown',
] as const;
export type Cause = (typeof CAUSES)[number];

/** agent.stop@1's frozen d1 digest at the base commit 2307398 (packages/contracts/digests.json), after #604 refroze it; see AC4-DIGEST-REDRAFT.md. */
export const BASE_V1_DIGEST = 'd1:eaddd33caced46ca2441d9da7bb4492c4e22a8f31897edb8c92bd1b25839d6ba';

/** A reset time in ms since the epoch, for plan_window_spent. */
export const RESETS = 1760020000000;

/** A turn's usage as the issue's Shape gives it: a reported cost, every count exact. */
export const USAGE_REPORTED: JsonObject = {
  covers: 'turn',
  model: 'claude-haiku-4-5',
  input: { value: 1200, exact: true },
  cached: { value: 800, exact: true },
  output: { value: 64, exact: true },
  context_fill: 0.42,
  cost: { usd: 0.0125, basis: 'reported' },
};
/** The session so far, with a cost estimated from a named rate card and estimated counts. */
export const USAGE_ESTIMATED: JsonObject = {
  covers: 'session',
  model: 'gpt-reserve',
  input: { value: 21569, exact: false },
  cached: { value: 9856, exact: false },
  output: { value: 118, exact: false },
  context_fill: 0.08,
  cost: { usd: 0.031, basis: 'estimated', rate_card: 'openai-2026-10' },
};

/** The envelope of agent.stop@1's published fixture, at version 2: only `data` changes between versions. */
export function envelope(): JsonObject {
  const [first] = fixtures(V1);
  if (!isObject(first)) throw Error(`${V1} has no fixture to take the event envelope from`);
  return { ...clone(first), v: 2 };
}

/** The data of a valid agent.stop@2 for a cause: plan_resets exactly when the cause is plan_window_spent. */
export function stopData(cause: string, usage: JsonValue = null): JsonObject {
  return { turn: 7, did_work: true, cause, ...(cause === 'plan_window_spent' ? { plan_resets: RESETS } : {}), usage: clone(usage) };
}
export const stop = (data: JsonObject): JsonObject => ({ ...envelope(), data });

/** Fails, as an assertion, when the schema isn't published, instead of the validator throwing unknown_schema. */
export function expectPublished(name: string): void {
  expect(listSchemas().map((e) => e.name), `${name} is a published schema`).toContain(name);
}

export function check(name: string, value: unknown): Validation {
  expectPublished(name);
  return validate(name, value);
}

export function expectAccepted(name: string, value: unknown, why: string): void {
  const result = check(name, value);
  expect(result.ok ? [] : result.issues, `${why}: ${name} refused ${JSON.stringify(value).slice(0, 400)}`).toEqual([]);
}

/** Refused, with an issue at `path` or under it (a missing field's own pointer, per the base's error shape). */
export function expectRefused(name: string, value: unknown, path: string, why: string): void {
  const result = check(name, value);
  expect(result.ok, `${why}: ${name} accepted ${JSON.stringify(value).slice(0, 400)}`).toBe(false);
  if (result.ok) return;
  const paths = result.issues.map((i) => i.path);
  expect(paths.some((p) => p === path || p.startsWith(`${path}/`)), `${why}: the refusal names ${path}; it named ${JSON.stringify(paths)}`).toBe(true);
}

// ---- Rust ----------------------------------------------------------------------------------------

export const BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-contracts.exe' : 'deep-contracts');

export function buildRust(): void {
  const run = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-contracts', '--bin', 'deep-contracts'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`cargo build failed:\n${run.stderr}`);
}

/** `deep-contracts check <schema>`: true where the generated Rust type's from_json takes the line. */
export function rustAccepts(name: string, values: JsonValue[]): boolean[] {
  const run = spawnSync(BIN, ['check', name], { input: `${values.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`deep-contracts check ${name} failed:\n${run.stderr}`);
  return run.stdout.trimEnd().split('\n').map((line) => line === 'ok');
}

/** `deep-contracts roundtrip <schema>`: each line decoded into the Rust type and printed back, or the error. */
export function rustRoundtrip(name: string, values: JsonValue[]): { ok: true; out: string[] } | { ok: false; error: string } {
  const run = spawnSync(BIN, ['roundtrip', name], { input: `${values.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) return { ok: false, error: run.stderr || `exit ${run.status}` };
  return { ok: true, out: run.stdout.trimEnd().split('\n') };
}

// ---- The generated TypeScript types --------------------------------------------------------------

export const TYPES = join(REPO, 'packages', 'contracts', 'src', 'generated', 'types.ts');
export const RUST = join(REPO, 'crates', 'deep-contracts', 'src', 'generated.rs');

/** The generated type's name for a schema, found by the doc comment generateTypeScript writes above it. */
export function typeNameIn(source: string, schema: string): string | undefined {
  const doc = schema.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/\\*\\* ${doc} \\*/\\nexport (?:interface|type) ([A-Za-z0-9_]+)`).exec(source)?.[1];
}

/**
 * Type-checks one module against the committed generated types under the root tsconfig's strict options.
 * `{{V1}}` and `{{V2}}` in the source become the generated types of agent.stop@1 and @2, imported from
 * types.ts. Returns tsc's diagnostics; an unused `@ts-expect-error` is one.
 */
export function typecheck(source: string): string[] {
  const text = readFileSync(TYPES, 'utf8');
  const v1 = typeNameIn(text, V1);
  const v2 = typeNameIn(text, V2);
  expect(v1, `${TYPES.slice(REPO.length + 1)} has a type for ${V1}`).toBeDefined();
  expect(v2, `${TYPES.slice(REPO.length + 1)} has a type for ${V2}`).toBeDefined();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-603-tsc-')));
  try {
    const module = `import type { ${v1} as V1, ${v2} as V2 } from ${JSON.stringify(TYPES)};\n${source.replaceAll('{{V1}}', 'V1').replaceAll('{{V2}}', 'V2')}`;
    writeFileSync(join(dir, 'check.ts'), module);
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, allowImportingTsExtensions: true,
        noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, skipLibCheck: true, types: [],
      },
      files: ['check.ts'],
    }));
    const run = spawnSync(process.execPath, [join(REPO, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', dir], { encoding: 'utf8' });
    return `${run.stdout}${run.stderr}`.split('\n').filter((line) => line.trim()).map((line) => line.replaceAll(dir, '<tmp>'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- The recorded corpus -------------------------------------------------------------------------

export interface RecordedCase { payload: JsonObject; expect?: { kind: string; data: JsonObject }[]; [key: string]: JsonValue | undefined }
export interface RecordedSession { agent: string; version: string; name: string; ref: string; dir: string; cases: RecordedCase[]; transcript: JsonObject[] }

const readLines = (path: string): JsonObject[] => readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as JsonObject);
const folders = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

/** Every recorded session under a corpus folder laid out as adapters/corpus/README.md says. */
export function sessions(corpus = CORPUS): RecordedSession[] {
  return folders(corpus).flatMap((agent) => folders(join(corpus, agent)).flatMap((version) => folders(join(corpus, agent, version)).map((name) => {
    const dir = join(corpus, agent, version, name);
    let transcript: JsonObject[] = [];
    try { transcript = readLines(join(dir, 'transcript.jsonl')); } catch { /* a session may have none */ }
    return { agent, version, name, ref: `${agent}/${version}/${name}`, dir, cases: readLines(join(dir, 'events.jsonl')) as unknown as RecordedCase[], transcript };
  })));
}

export const factsOf = (agent: string): JsonObject => JSON.parse(readFileSync(join(REPO, 'adapters', `${agent}.facts.json`), 'utf8')) as JsonObject;

/** A recorded stop: the hooks the corpus README maps to agent.stop (Claude Code's Stop and StopFailure, Codex's Stop). */
export const STOP_HOOKS = ['Stop', 'StopFailure'];
export const isStopPayload = (c: RecordedCase): boolean => STOP_HOOKS.includes(String(c.payload?.hook_event_name));

/** A copy of the corpus in a scratch folder; the real one is never edited. */
export function corpusCopy(): { dir: string; remove: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-603-corpus-')));
  cpSync(CORPUS, join(dir, 'corpus'), { recursive: true });
  return { dir: join(dir, 'corpus'), remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function writeSession(session: RecordedSession): void {
  writeFileSync(join(session.dir, 'events.jsonl'), `${session.cases.map((c) => JSON.stringify(c)).join('\n')}\n`);
  writeFileSync(join(session.dir, 'transcript.jsonl'), session.transcript.map((e) => JSON.stringify(e)).join('\n') + (session.transcript.length ? '\n' : ''));
}

/** `node scripts/corpus.mjs replay [--corpus <dir>]`, its JSON lines parsed. */
export function replayCli(corpus?: string): { status: number | null; lines: JsonObject[]; text: string } {
  const run = spawnSync(process.execPath, [join(REPO, 'scripts', 'corpus.mjs'), 'replay', ...(corpus ? ['--corpus', corpus] : [])], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const lines = run.stdout.split('\n').flatMap((l) => { try { const v = JSON.parse(l) as unknown; return isObject(v) ? [v] : []; } catch { return []; } });
  return { status: run.status, lines, text: `${run.stdout.slice(-3000)}${run.stderr.slice(-2000)}` };
}

/** Every string value of a key named `model` anywhere in a value. */
export function modelsIn(value: JsonValue | undefined, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) modelsIn(v, out);
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) { if (k === 'model' && typeof v === 'string') out.add(v); else modelsIn(v, out); }
  return out;
}

/** Resolves a JSON Pointer in a value; undefined when nothing is there. */
export function resolvePointer(value: JsonValue, pointer: string): JsonValue | undefined {
  if (pointer === '') return value;
  let node: JsonValue | undefined = value;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = Array.isArray(node) ? node[Number(key)] : isObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
    if (node === undefined) return undefined;
  }
  return node;
}
