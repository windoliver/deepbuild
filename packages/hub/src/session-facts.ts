// What the core reads about a Claude Code session beside its hooks (#18): what it loads at its start, each with a
// digest; the short briefing it gets then; and the commits made in its worktree, read from git's own files.
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { run } from './children.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export interface Load { kind: 'instructions' | 'skill' | 'hooks' | 'mcp'; name: string; source: string; digest: string }

const sha = (parts: (string | Buffer)[]): string => {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return `sha256:${hash.digest('hex')}`;
};
const text = (file: string): Promise<string | undefined> => readFile(file, 'utf8').catch(() => undefined);
const json = async (file: string): Promise<Obj | undefined> => {
  const raw = await text(file);
  try { const value: unknown = raw === undefined ? undefined : JSON.parse(raw); return isObj(value) ? value : undefined; } catch { return undefined; }
};
/** Every file under a folder, sorted, with its path from the folder: a skill's digest covers all of them. */
async function files(dir: string, at = ''): Promise<string[]> {
  const entries = await readdir(join(dir, at), { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) out.push(...await files(dir, join(at, e.name)));
    else if (e.isFile()) out.push(join(at, e.name));
  }
  return out;
}
/** The folders from `cwd` up to the root. */
const upFrom = (cwd: string): string[] => {
  const out: string[] = [];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    out.push(dir);
    if (dirname(dir) === dir) return out;
  }
};

/** What a Claude Code session in `cwd` loads: instruction files, skills, hook settings and MCP servers, each digested. */
export async function loadsOf(cwd: string): Promise<Load[]> {
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const out: Load[] = [];
  const instructions = [join(claude, 'CLAUDE.md'), ...upFrom(cwd).flatMap((d) => [join(d, 'CLAUDE.md'), join(d, 'CLAUDE.local.md'), join(d, '.claude', 'CLAUDE.md')])];
  for (const file of instructions) {
    const body = await text(file);
    if (body !== undefined) out.push({ kind: 'instructions', name: file.slice(file.lastIndexOf('/') + 1), source: file, digest: sha([body]) });
  }
  for (const root of [join(claude, 'skills'), join(cwd, '.claude', 'skills')]) {
    for (const name of (await readdir(root).catch(() => [])).sort()) {
      const dir = join(root, name);
      const inside = await files(dir);
      if (!inside.includes('SKILL.md')) continue;
      const parts: (string | Buffer)[] = [];
      for (const file of inside) parts.push(file, '\0', await readFile(join(dir, file)).catch(() => Buffer.alloc(0)), '\0');
      out.push({ kind: 'skill', name, source: join(dir, 'SKILL.md'), digest: sha(parts) });
    }
  }
  for (const file of [join(claude, 'settings.json'), join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')]) {
    const settings = await json(file);
    if (settings && isObj(settings.hooks)) out.push({ kind: 'hooks', name: file.slice(file.lastIndexOf('/') + 1), source: file, digest: sha([JSON.stringify(settings.hooks)]) });
  }
  const user = await json(join(homedir(), '.claude.json'));
  const project = user && isObj(user.projects) && isObj(user.projects[cwd]) ? user.projects[cwd] : {};
  const shared = await json(join(cwd, '.mcp.json'));
  const configs: [string, unknown][] = [[`${join(homedir(), '.claude.json')} (user)`, user?.mcpServers], [`${join(homedir(), '.claude.json')} (local)`, project.mcpServers], [join(cwd, '.mcp.json'), shared?.mcpServers]];
  for (const [source, servers] of configs) {
    if (!isObj(servers)) continue;
    for (const [name, config] of Object.entries(servers)) out.push({ kind: 'mcp', name, source, digest: sha([JSON.stringify(config)]) });
  }
  return out;
}

/**
 * The short briefing an agent gets at its session's start: its repo's active checks, as the nearest
 * .deepbuild/done.yaml names them, and how to declare a claim.
 */
export async function briefing(cwd: string): Promise<string> {
  let checks: string[] = [];
  let environment = false;
  for (const dir of upFrom(cwd)) {
    const raw = await text(join(dir, '.deepbuild', 'done.yaml'));
    if (raw === undefined) continue;
    let spec: unknown;
    try { spec = parseYaml(raw); } catch { break; }
    const claims = isObj(spec) && isObj(spec.claims) ? Object.values(spec.claims) : [];
    checks = [...new Set(claims.flatMap((c) => (isObj(c) && Array.isArray(c.checks) ? c.checks.map(String) : [])))];
    if (!checks.length && isObj(spec) && isObj(spec.checks)) checks = Object.keys(spec.checks);
    environment = isObj(spec) && isObj(spec.environment);
    break;
  }
  const active = checks.length ? `Active checks in this repo: ${checks.join(', ')}.` : 'No checks are active in this repo yet.';
  // The repo's stack, as its environment block sets it up (#332): started for you, its keys loaded by reference.
  const stack = environment
    ? ' Start this repo\'s stack with `deep env up` and stop it with `deep env down`; DeepBuild leases its ports, accounts and screens to this session and loads its credentials into the stack itself, so don\'t read, print or copy keys or the files that hold them.'
    : '';
  return `DeepBuild is watching this session. ${active}${stack} When you finish a piece of work, declare it with the deep_claim tool (say what you claim is done); the checks' results decide its verdict, never your own words about it.`;
}

/** The git folder of the repo `cwd` is in, and the common folder its refs live in (a worktree's differs). */
async function gitDirs(cwd: string): Promise<{ git: string; common: string } | undefined> {
  for (const dir of upFrom(cwd)) {
    const dotgit = join(dir, '.git');
    const info = await stat(dotgit).catch(() => undefined);
    if (!info) continue;
    if (info.isDirectory()) return { git: dotgit, common: dotgit };
    const pointer = /^gitdir: (.+)$/m.exec((await text(dotgit)) ?? '');
    if (!pointer) return undefined;
    const git = resolve(dir, pointer[1]!.trim());
    const common = await text(join(git, 'commondir'));
    return { git, common: common ? resolve(git, common.trim()) : git };
  }
  return undefined;
}
/** The commit `cwd`'s worktree has checked out, and its branch (null when detached), read from git's files. */
export async function headOf(cwd: string): Promise<{ sha: string; branch: string | null } | undefined> {
  const dirs = cwd ? await gitDirs(cwd) : undefined;
  if (!dirs) return undefined;
  const head = ((await text(join(dirs.git, 'HEAD'))) ?? '').trim();
  if (/^[0-9a-f]{40}$/.test(head)) return { sha: head, branch: null };
  const ref = /^ref: (refs\/\S+)$/.exec(head)?.[1];
  if (!ref) return undefined;
  const loose = ((await text(join(dirs.git, ref))) ?? (await text(join(dirs.common, ref))) ?? '').trim();
  const packed = loose || (((await text(join(dirs.common, 'packed-refs'))) ?? '').split('\n').find((l) => l.endsWith(` ${ref}`))?.slice(0, 40) ?? '');
  return /^[0-9a-f]{40}$/.test(packed) ? { sha: packed, branch: ref.replace(/^refs\/heads\//, '') } : undefined;
}
/** The commits from `from` (exclusive) to `to`, oldest first; just `to` when `from` isn't one of its ancestors. */
export async function commitsBetween(cwd: string, from: string, to: string): Promise<string[]> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const r = await run('git', ['-C', cwd, 'rev-list', '--reverse', '--max-count=100', `${from}..${to}`], { env, timeout: 10_000 });
  const list = r.error ? [] : r.stdout.split('\n').filter((l) => /^[0-9a-f]{40}$/.test(l));
  return list.length ? list : [to];
}
