// A dependency the plan doesn't name (#23, #1509; design: Before each command). deep-hook's note says what a call
// adds: packages it names, packages it runs straight from a registry, or a bare install, which is read here through
// the manifest's diff since the base. The registry's word on each package's version, when it was published and when
// the name first was, is read once with no credential, within the gate's hold, and shown: on the ask, or, for a package
// run straight from a registry whose version and name are past a week old, on the return card's what-changed line.
// It's a reading, never a pass.
import { readFile } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { gitEnv } from '@deepbuild/gate';
import { exec as run } from './children.js';

/** What deep-hook read of a call that adds a dependency (`dependency manager=… registry=… form=… <item>…`). */
export interface Note { manager: string; registry: 'npm' | 'pypi' | 'none'; form: 'run' | 'add' | 'manifest'; items: string[] }
/** One package as the registry reads it: its version, when that was published and when the name first was; or why it couldn't. */
export interface Reading { name: string; asked: string | null; version?: string; published?: number; first?: number; couldnt?: string }

const DAY = 86_400_000;
/** Under this a version or a name is new (drafted): the ask names it so. */
const NEW_MS = 7 * DAY;
/** How long the registry's read may take: well within the gate's hold of a call (server.ts, GATE_HOLD_MS). */
const READ_MS = 5000;
/** The public registries, unless a test names its own (DEEP_HUB_TEST_REGISTRY). */
const NPM = 'https://registry.npmjs.org';
const PYPI = 'https://pypi.org';

/** The note deep-hook gave a call's dependency entry, if any. */
export function noteOf(notes: Record<string, string> | undefined): Note | undefined {
  const text = Object.values(notes ?? {}).find((n) => n.startsWith('dependency '));
  if (!text) return undefined;
  const [, ...words] = text.split(' ');
  const field = (key: string) => words.find((w) => w.startsWith(`${key}=`))?.slice(key.length + 1);
  const registry = field('registry'), form = field('form'), manager = field('manager');
  if (!manager || (registry !== 'npm' && registry !== 'pypi' && registry !== 'none') || (form !== 'run' && form !== 'add' && form !== 'manifest')) return undefined;
  const items = words.filter((w) => !/^(manager|registry|form)=/.test(w)).map((w) => w.replace(/%20/g, ' ').replace(/%25/g, '%'));
  return { manager, registry, form, items };
}

/** A package as written, `name` or `name@spec`, split at its version: npm's scope keeps its leading `@`. */
function split(item: string): { name: string; asked: string | null } {
  const at = item.indexOf('@', 1);
  return at < 0 ? { name: item, asked: null } : { name: item.slice(0, at), asked: item.slice(at + 1) || null };
}

const git = async (cwd: string, args: string[]): Promise<string | undefined> => {
  const r = await run('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: gitEnv(), timeout: 10_000 }).catch(() => undefined);
  return r && !r.error ? r.stdout : undefined;
};
/** The base a session's changes are read against: where its HEAD left the default branch, else its HEAD. */
async function baseOf(top: string): Promise<string | undefined> {
  for (const ref of ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']) {
    const base = (await git(top, ['merge-base', 'HEAD', ref]))?.trim();
    if (base) return base;
  }
  return (await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD']))?.trim() || undefined;
}

/** The names a package.json's dependency lists hold. */
function manifestNames(text: string | undefined): string[] {
  try {
    const m = JSON.parse(text ?? '') as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((k) => (m[k] && typeof m[k] === 'object' ? Object.keys(m[k] as object) : []));
  } catch {
    return [];
  }
}
/** The names a requirements file asks for, PEP 503's way: options, comments and local paths left out. */
function requirementNames(text: string | undefined): string[] {
  return (text ?? '').split('\n').flatMap((raw) => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    const name = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line)?.[1];
    return line.startsWith('-') || !name ? [] : [name.toLowerCase().replace(/[-_.]+/g, '-')];
  });
}

/**
 * The names a bare install's manifests add since the base: each manifest as the working tree holds it against the base
 * commit's copy. A manifest outside a checkout counts all it names.
 */
export async function addedSince(manifests: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of manifests) {
    const names = path.endsWith('package.json') ? manifestNames : requirementNames;
    const now = names(await readFile(path, 'utf8').catch(() => undefined));
    const top = (await git(dirname(path), ['rev-parse', '--show-toplevel']))?.trim();
    const base = top ? await baseOf(top) : undefined;
    const before = top && base ? names(await git(top, ['show', `${base}:${relative(top, path)}`])) : [];
    for (const name of now) if (!before.includes(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** What the registry says of one package: its version as asked for, when that was published, and when the name first was. */
export async function readRegistry(registry: Note['registry'], item: string, base: string | undefined): Promise<Reading> {
  const { name, asked } = split(item);
  if (registry === 'none') return { name, asked, couldnt: 'it reads only the npm registry and PyPI' };
  const url = registry === 'npm' ? `${base ?? NPM}/${name.replace('/', '%2f')}` : `${base ?? PYPI}/pypi/${encodeURIComponent(name)}/json`;
  let doc: Record<string, unknown>;
  try {
    // No credential and no cookie: the public document only, read once.
    const res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(READ_MS) });
    if (!res.ok) return { name, asked, couldnt: `the registry answered ${res.status}` };
    doc = (await res.json()) as Record<string, unknown>;
  } catch (error) {
    const why = error instanceof Error && error.name === 'TimeoutError' ? `it didn't answer within ${READ_MS / 1000} s` : 'it couldn\'t be reached';
    return { name, asked, couldnt: why };
  }
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const at = (v: unknown): number | undefined => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : undefined);
  if (registry === 'npm') {
    const time = obj(doc.time), tags = obj(doc['dist-tags']);
    const version = asked === null ? tags.latest : /^\d/.test(asked) ? asked : tags[asked];
    if (typeof version !== 'string') return { name, asked, couldnt: `the registry names no single version for ${asked ?? 'latest'}` };
    const times = Object.entries(time).filter(([k]) => k !== 'modified' && k !== 'created').map(([, v]) => at(v)).filter((t): t is number => t !== undefined);
    const published = at(time[version]);
    const first = at(time.created) ?? (times.length ? Math.min(...times) : undefined);
    return published === undefined || first === undefined ? { name, asked, version, couldnt: `the registry gives no publish time for ${version}` } : { name, asked, version, published, first };
  }
  const releases = obj(doc.releases);
  const uploaded = (files: unknown): number[] => (Array.isArray(files) ? files.map((f) => at(obj(f).upload_time_iso_8601) ?? at(obj(f).upload_time)).filter((t): t is number => t !== undefined) : []);
  const version = asked === null ? obj(doc.info).version : asked;
  if (typeof version !== 'string' || !/^\d/.test(version)) return { name, asked, couldnt: `the registry names no single version for ${asked ?? 'latest'}` };
  const own = uploaded(releases[version]);
  const all = Object.values(releases).flatMap(uploaded);
  return own.length && all.length ? { name, asked, version, published: Math.min(...own), first: Math.min(...all) } : { name, asked, version, couldnt: `the registry gives no publish time for ${version}` };
}

/** How long ago `t` was, in the largest whole unit: "2 days ago", "3 years ago". */
function ago(t: number, now: number): string {
  const ms = Math.max(0, now - t);
  const [n, unit] = ms < 3600_000 ? [Math.floor(ms / 60_000), 'minute'] : ms < DAY ? [Math.floor(ms / 3600_000), 'hour'] : ms < 60 * DAY ? [Math.floor(ms / DAY), 'day'] : ms < 730 * DAY ? [Math.floor(ms / (30 * DAY)), 'month'] : [Math.floor(ms / (365 * DAY)), 'year'];
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** Whether a reading lets the call run with no ask: the version and the name were both first published at least NEW_MS ago. */
export const settled = (r: Reading, now: number): boolean => r.couldnt === undefined && now - r.published! >= NEW_MS && now - r.first! >= NEW_MS;

/** How the session's reading of a package run with no ask starts: the change's sentence finds it by this. */
const RAN = 'Ran straight from a registry with no ask: ';
/** The session's reading of a call run straight from a registry with no ask: each package with its version's age and its name's, then the call. */
export function ranReading(note: Note, readings: readonly Reading[], command: string, now: number): string {
  const where = note.registry === 'pypi' ? 'PyPI' : 'the npm registry';
  const each = readings.map((r) => `${r.name} ${r.version} from ${where}, published ${ago(r.published!, now)} (the name first ${ago(r.first!, now)})`);
  return `${RAN}${each.join('; ')} (\`${command}\`).`;
}
/** The packages and ages a run's reading names, for the return card's what-changed line; undefined for any other reading. */
export function ranOf(reading: string): string | undefined {
  const end = reading.indexOf(' (`');
  return reading.startsWith(RAN) && end > RAN.length ? reading.slice(RAN.length, end) : undefined;
}
/** The SQL LIKE pattern of a run's reading. */
export const RAN_LIKE = `${RAN}%`;

/** A reading in the ask's words: when the version and the name were published, naming either one under a week old as new, or that it couldn't check. */
export function readingWords(r: Reading, registry: Note['registry'], now: number): string {
  const where = registry === 'pypi' ? 'PyPI' : 'the npm registry';
  if (r.couldnt !== undefined) return `DeepBuild couldn't check ${registry === 'none' ? 'the registry' : where} for ${r.name}${r.version ? ` ${r.version}` : ''}: ${r.couldnt}.`;
  const version = `${r.name} ${r.version} was published ${ago(r.published!, now)}${now - r.published! < NEW_MS ? ', so it is new (under 7 days)' : ''}`;
  const name = `the name ${r.name} was first published ${ago(r.first!, now)}${now - r.first! < NEW_MS ? ', a new name (under 7 days)' : ''}`;
  return `${where === 'PyPI' ? 'PyPI' : 'The npm registry'} says ${version}, and ${name}.`;
}
