// Test-side tools for the #3423 acceptance tests, written blind (README.md). They spawn this checkout's
// `node scripts/taste.mjs <command>` (the surface README.md defines) and read its one JSON object on stdout; they make
// scratch git repositories holding fixture taste records; and they stand in for a security key so a fixture approval
// tag can be signed (ported from tests/acceptance/3166/authenticator.mjs, this repo's own code). Nothing here stands in
// for the lane, the verdict, the list or the counts under test, and no implementation module is imported, so a
// missing script fails each test at its assertion, never at load.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The checkout root (tests/acceptance/3423 is three levels down). */
export const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
export const SCRIPT = join(REPO, 'scripts', 'taste.mjs');
export const TIMEOUT = 300_000;

/** The criterion IDs: sha256 of each criterion's text, trimmed, whitespace collapsed, first 8 hex. */
export const AC = {
  1: '#3423.63f64cd6', 2: '#3423.88a9d39c', 3: '#3423.16f305aa', 4: '#3423.a83451d1',
  5: '#3423.fca57d94', 6: '#3423.997b049e', 7: '#3423.408915d5', 8: '#3423.4573dacd',
} as const;

/** The commit the issue's counts were read on. */
export const READ_ON = 'ebf1e7f44bedb850047741cea366ac08df62dcbc';

// ---------------------------------------------------------------------------------------------------
// git on this checkout

export function git(cwd: string, args: string[], input?: string): string {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 30, input });
  if (r.status !== 0) throw new Error(`BLOCKED: git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

/** The merge base of this change with main (origin/main, else main). */
export function mergeBase(): string {
  for (const main of ['origin/main', 'main']) {
    const r = spawnSync('git', ['merge-base', 'HEAD', main], { cwd: REPO, encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  throw new Error('BLOCKED: no merge base with origin/main or main');
}

/** A record's path, as README.md's record set defines it: these three names, never under a test folder's twins/. */
export const isRecordPath = (path: string): boolean =>
  /(^|\/)(TASTE\.json|taste\.json|taste-call\.json)$/.test(path) && !/^tests\/acceptance\/[^/]+\/(.*\/)?twins\//.test(path);

export function recordPathsAt(rev: string): string[] {
  return git(REPO, ['ls-tree', '-r', '--name-only', '--full-tree', rev]).split('\n').filter((p) => p && isRecordPath(p)).sort();
}

/** Whether any record at `rev` has a `maker` member: the change has landed there. */
export function holdsMaker(rev: string): boolean {
  return recordPathsAt(rev).some((path) => { try { return 'maker' in (JSON.parse(showAt(rev, path)) as JsonObject); } catch { return false; } });
}

export const showAt = (rev: string, path: string): string => git(REPO, ['show', `${rev}:${path}`]);

/** The call a record holds, read as the record's own words do: its first of verdict, call or said. */
export function callOf(record: JsonObject): string | null {
  for (const key of ['verdict', 'call', 'said']) if (typeof record[key] === 'string') return record[key] as string;
  return null;
}

/** Every SHA-256 a record names: a 64-hex string value, or a 64-hex key, anywhere in it. */
export function hashesOf(value: JsonValue, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') { if (/^[0-9a-f]{64}$/.test(value)) out.add(value); }
  else if (Array.isArray(value)) for (const v of value) hashesOf(v, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { if (/^[0-9a-f]{64}$/.test(k)) out.add(k); hashesOf(v, out); }
  return out;
}

/** The issue a record belongs to: its own `issue` number, else the number of its folder. */
export function issueOf(path: string, record: JsonObject): number {
  if (typeof record['issue'] === 'number') return record['issue'];
  const m = /^(?:docs\/evidence|tests\/acceptance)\/(\d+)/.exec(path);
  if (!m) throw new Error(`BLOCKED: no issue for ${path}`);
  return Number(m[1]);
}

// ---------------------------------------------------------------------------------------------------
// The surface under test

export interface Run { status: number | null; stdout: string; stderr: string; out: string; json: JsonObject | null }

/** `node scripts/taste.mjs <args>` in `cwd`; its stdout parsed as one JSON object, or null when it isn't one. */
export function taste(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Run {
  const r: SpawnSyncReturns<string> = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: options.cwd ?? REPO, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 240_000, env: options.env ?? process.env,
  });
  if (r.error) throw new Error(`BLOCKED: cannot run node: ${r.error.message}`);
  let json: JsonObject | null = null;
  try { const v = JSON.parse(r.stdout) as JsonValue; if (v && typeof v === 'object' && !Array.isArray(v)) json = v; } catch { json = null; }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}\n${r.stderr}`, json };
}

/** The run's JSON, asserted to be there: a missing script or a non-JSON reply fails here, at an assertion. */
export function reply(r: Run, what: string): JsonObject {
  expect(r.json, `${what}: \`node scripts/taste.mjs\` printed no JSON object (exit ${r.status}):\n${r.out.slice(0, 1500)}`).not.toBeNull();
  return r.json as JsonObject;
}

export const brief = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 800);

export function list(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${brief(value)}`).toBe(true);
  return value as JsonValue[];
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(typeof value === 'object' && value !== null && !Array.isArray(value), `${what} is an object, got ${brief(value)}`).toBe(true);
  return value as JsonObject;
}

/** The lane's entry for one record file. */
export function entryFor(lane: JsonObject, file: string): JsonObject {
  const found = list(lane['records'], 'the lane\'s records').map((e) => obj(e, 'a lane record')).filter((e) => e['file'] === file);
  expect(found.length, `the lane lists the record ${file} once; it lists ${found.length}: ${brief(lane['records'])}`).toBe(1);
  return found[0]!;
}

// ---------------------------------------------------------------------------------------------------
// Fixture repositories

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

export function scratchDir(prefix = 'd3423-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

export function put(file: string, text: string): void { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }

/** A scratch git repository with no remote and its files committed one commit per `commits` entry; returns the SHAs. */
export function fixtureRepo(commits: Array<Record<string, string>>): { dir: string; shas: string[] } {
  const dir = scratchDir();
  const g = (...args: string[]) => git(dir, ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args]);
  g('init', '-q', '-b', 'main');
  const shas: string[] = [];
  commits.forEach((files, i) => {
    for (const [path, text] of Object.entries(files)) put(join(dir, path), text);
    g('add', '-A');
    g('commit', '-q', '--allow-empty', '-m', `fixture commit ${i + 1}`);
    shas.push(g('rev-parse', 'HEAD').trim());
  });
  return { dir, shas };
}

// Placeholder pictures: their hashes only, no file needed by any criterion here.
export const PIC_A = createHash('sha256').update('fixture picture a').digest('hex');
export const PIC_B = createHash('sha256').update('fixture picture b').digest('hex');

export const PERSON = { person: 'person-a' };
export const agent = (session: string, inputs?: string[]): JsonObject => ({ agent: { model: 'model-x', session, ...(inputs ? { inputs } : {}) } });

/** A record in README.md's shape. */
export function record(issue: number, fields: JsonObject): string {
  return `${JSON.stringify({ issue, criterion: `#${issue}.0000c0de`, screenshots: { 'a.png': PIC_A, 'b.png': PIC_B }, ...fields }, null, 2)}\n`;
}
export const recordPath = (issue: number): string => `docs/evidence/${issue}/taste-call.json`;

// ---------------------------------------------------------------------------------------------------
// A security key's stand-in and a signed approval tag (ported from tests/acceptance/3166/authenticator.mjs): fresh
// in-memory keys, OpenSSH SSHSIG/FIDO wire bytes with the user-presence flag set; the real ssh-keygen verifies it.

const digest = (data: Buffer | string, algorithm = 'sha256') => createHash(algorithm).update(data).digest();
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const str = (s: Buffer | string) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]); };

export interface Key { name: string; type: string; blob: Buffer; privateKey: KeyObject; app: string; line: string }

/** An sk-ssh-ed25519 key's stand-in and its allowed-signers line. */
export function hardware(name: string): Key {
  const pair = generateKeyPairSync('ed25519');
  const type = 'sk-ssh-ed25519@openssh.com', app = 'ssh:3423';
  const x = (pair.publicKey.export({ format: 'jwk' }) as { x: string }).x;
  const blob = Buffer.concat([str(type), str(Buffer.from(x, 'base64url')), str(app)]);
  return { name, type, blob, privateKey: pair.privateKey, app, line: `${name} namespaces="git" ${type} ${blob.toString('base64')}\n` };
}

/** An annotated tag deep/approved/<name> on `on`, one `Approves: <line>` per line, signed by `key` with presence. */
export function approve(dir: string, key: Key, lines: string[], on: string, name: string): string {
  const ref = `deep/approved/${name}`;
  const content = `object ${on}\ntype commit\ntag ${ref}\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\n${lines.map((l) => `Approves: ${l}`).join('\n')}\n`;
  const alg = 'sha512', magic = Buffer.from('SSHSIG');
  const signed = Buffer.concat([magic, str('git'), str(''), str(alg), str(digest(content, alg))]);
  const flagsCounter = Buffer.concat([Buffer.from([1]), u32(1)]);
  const raw = sign(null, Buffer.concat([digest(key.app), flagsCounter, digest(signed)]), key.privateKey);
  const wire = Buffer.concat([magic, u32(1), str(key.blob), str('git'), str(''), str(alg), str(Buffer.concat([str(key.type), str(raw), flagsCounter]))]);
  const armor = `-----BEGIN SSH SIGNATURE-----\n${wire.toString('base64').match(/.{1,70}/g)!.join('\n')}\n-----END SSH SIGNATURE-----\n`;
  const side = scratchDir('d3423-sig-');
  put(join(side, 'sig'), armor);
  put(join(side, 'signers'), key.line);
  const verified = spawnSync('ssh-keygen', ['-Y', 'verify', '-f', join(side, 'signers'), '-I', key.name, '-n', 'git', '-s', join(side, 'sig')], { input: content, encoding: 'utf8' });
  if (verified.status !== 0) throw new Error(`BLOCKED: the authenticator stand-in's signature did not verify: ${verified.stderr}`);
  const made = git(dir, ['mktag'], content + armor).trim();
  git(dir, ['update-ref', `refs/tags/${ref}`, made]);
  return ref;
}

/** A fake `gh` (the forge, a boundary this repo doesn't own) that logs each call's arguments, one JSON array a line. */
export function fakeGh(): { bin: string; log: string } {
  const bin = scratchDir('d3423-gh-');
  const log = join(bin, 'calls.jsonl');
  put(join(bin, 'gh'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  put(log, '');
  return { bin, log };
}
