// Sessions on a host (#999; design: Blocks for work on your other machines, Sessions on a host). `deep host add` on a
// host your SSH config names installs deep-hook and Claude Code's hook entries there as you, each a host change with
// its undo. The hooks reach ~/.deepbuild/hub.sock on the host, a socket the hub's SSH link forwards to a listener of
// its own here (host-link.ts), so nothing listens on the host's network and every hook over it carries the host's
// name. While the link is down deep-hook there spools and fails open as it does here. When it returns the hub takes
// that spool before any hook from the host: moved aside there, copied here and synced, removed there, then replayed in
// the order it was written.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { runnerConfig } from '@deepbuild/gate';
import { scriptsOf, type Changes } from './claim-changes.js';
import { claudeCommand, longestDeadline, ourGroups, withHooks } from './claude-settings.js';
import { shellQuote as q } from './shell.js';
import { syncPath, writeAtomic } from './vfs.js';
import { refusal, Refused, ulid } from './wire.js';
import { parseYaml } from './yaml.js';

type Obj = Record<string, unknown>;
const sha = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * A host whose sessions record here: its home, its deep-hook, the version and contract that deep-hook reported when
 * the link last came up, and the hub's own then, which `deep doctor` reads beside them.
 */
export interface AddedHost { home: string; hook: string; version: string | null; contract: string | null; hubVersion: string; hubContract: string }
/** This hub's version, as its package says it. */
const HUB_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
/** The hosts added, by name; the event loop reads the same file to open each one's link. */
export function addedHosts(root: string): Record<string, AddedHost> {
  try { return (JSON.parse(readFileSync(join(root, 'host-sessions.json'), 'utf8')) as { hosts?: Record<string, AddedHost> }).hosts ?? {}; } catch { return {}; }
}
/** Where a host's hooks reach the hub: the socket its link forwards. */
export const hostSocket = (home: string): string => `${home}/.deepbuild/hub.sock`;
/** A host's name as a file name here: an SSH config may name a host with any characters, a path's among them. */
export const hostKey = (host: string): string => sha(host).slice(0, 16);

/** Node's name for a host's architecture, by what `uname -sm` prints there. */
const ARCH: Record<string, string> = { 'Linux aarch64': 'arm64', 'Linux arm64': 'arm64', 'Linux x86_64': 'x64' };
/** What `deep host add` reads first: the home, the machine, the hash of each program it installs, and the text of each file it merges into. */
const LOOK = String.raw`printf 'home\t%s\nmachine\t%s %s\n' "$HOME" "$(uname -s)" "$(uname -m)"
for p in .deepbuild/bin/deep-hook .deepbuild/rules.json; do [ -f "$HOME/$p" ] && printf 'has\t%s\t%s\n' "$p" "$(sha256sum < "$HOME/$p" | cut -d' ' -f1)"; done
for p in .claude/settings.json .deepbuild/config.json; do [ -f "$HOME/$p" ] && printf 'text\t%s\t%s\t%s\n' "$p" "$(stat -c %a "$HOME/$p")" "$(base64 -w0 < "$HOME/$p")"; done
true`;
/** Keeps a file as it was before a merge, by its hash, for the change's undo. */
const KEEP = String.raw`umask 077; d="$HOME/.deepbuild/originals"; mkdir -p "$d" && cp -p "$HOME/$1" "$d/$2"`;
/** What the installed deep-hook says of itself; one older than `--contract` says nothing for it. */
const REPORT = String.raw`h="$HOME/.deepbuild/bin/deep-hook"
printf 'version\t%s\ncontract\t%s\n' "$("$h" --version 2>/dev/null </dev/null)" "$("$h" --contract 2>/dev/null </dev/null)"`;
/**
 * The host's spool, taken: the live file moved aside under the name the hub gives, so a hook that spools meanwhile
 * begins a new one (deep-hook writes its line again when its file moved), then each file moved aside, in name order.
 */
const TAKE = String.raw`d="$HOME/.deepbuild/spool"; [ -d "$d" ] || exit 0
if [ -f "$d/spool.jsonl" ]; then mv "$d/spool.jsonl" "$d/taken-$1.jsonl" && sleep 0.1; fi
for f in "$d"/taken-*.jsonl; do [ -f "$f" ] && printf 'file\t%s\t%s\n' "$(basename "$f")" "$(base64 -w0 < "$f")"; done; true`;
const DROP = String.raw`d="$HOME/.deepbuild/spool"; for f; do rm -f "$d/$f"; done`;
const STARTED = String.raw`LC_ALL=C TZ=UTC ps -o lstart= -p "$1"`;
const ARGS = String.raw`ps -o args= -p "$1"`;
/** A folder's HEAD on the host, and the branch it is on when it is on one. */
const HEAD = String.raw`git -C "$1" rev-parse -q --verify HEAD 2>/dev/null; git -C "$1" symbolic-ref -q --short HEAD 2>/dev/null; true`;
/** The repo's spec as a commit holds it there: its blob's id and its bytes, or `none`. Nothing of the repo's that runs a program is run. */
const SPEC_AT = String.raw`o=$(GIT_NO_REPLACE_OBJECTS=1 git -C "$1" -c core.hooksPath=/dev/null rev-parse -q --verify "$2:.deepbuild/done.yaml" 2>/dev/null) || { echo none; exit 0; }
printf 'oid\t%s\ntext\t%s\n' "$o" "$(GIT_NO_REPLACE_OBJECTS=1 git -C "$1" -c core.hooksPath=/dev/null cat-file blob "$o" | base64 -w0)"`;
/**
 * Files a folder on the host holds, each by its place in the list asked for: one that is a file under the folder by
 * its real path, never a link out of it, with its first `$2` bytes. A file past that is cut there.
 */
const FILES = String.raw`r=$(realpath -e -- "$1" 2>/dev/null) || { echo read; exit 0; }; max=$2; shift 2; i=0
for p; do f=$(realpath -e -- "$r/$p" 2>/dev/null) && case "$f" in "$r"/*) [ -f "$f" ] && printf 'file\t%s\t%s\n' "$i" "$(head -c "$max" < "$f" | base64 -w0)" ;; esac; i=$((i + 1)); done; echo read`;
/**
 * What a folder there changed against a commit (#3511), as claim-changes reads it here: the files that differ from it,
 * the untracked ones and the tracked ones with their index flags, each list in base64 with its paths unquoted, then
 * package.json as the commit and the folder hold it. Each git read ends within `$3` seconds; one that fails says so
 * on a line of its own, with its exit status.
 */
const CHANGES = String.raw`cd -- "$1" || { printf 'unread\t%s\n' "$(printf 'the folder %s could not be entered' "$1" | base64 -w0)"; echo read; exit 0; }
g() { LC_ALL=C timeout -k 1 "$S" git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.quotePath=false "$@" 2>/dev/null; }
one() { n=$1; shift; if o=$(g "$@"); then printf '%s\t%s\n' "$n" "$(printf '%s' "$o" | base64 -w0)"; else x=$?; printf 'unread\t%s\n' "$(printf 'git %s exited %s' "$*" "$x" | base64 -w0)"; fi; }
S=$3; one diff diff --name-only --no-renames "$2"; one others ls-files --others --exclude-standard; one tracked ls-files -v
one has ls-tree --name-only "$2" -- package.json; if [ -n "$(g ls-tree --name-only "$2" -- package.json)" ]; then one was show "$2:package.json"; fi
[ -f package.json ] && printf 'now\t%s\n' "$(head -c 1048576 package.json | base64 -w0)"; echo read`;
/** A prompt's own entry in a session's transcript there, among its last 4 MiB, as turn-loops' turnFrom finds one here. */
const PROMPT = String.raw`[ -f "$1" ] && tail -c 4194304 -- "$1" | grep -F -- "$2" | grep -F -m 1 '"promptId"'; true`;
/** Claude Code's own record there of the folders you trusted. */
const CLAUDE_JSON = String.raw`[ -f "$HOME/.claude.json" ] && base64 -w0 < "$HOME/.claude.json"; true`;

interface Ran { code: number | null; stdout: string; stderr: string }
interface HostSessionsOptions {
  root: string;
  /** The contract this hub speaks, major.minor. */
  contract: string;
  /** Where the deep-hook a Linux host of that architecture runs is, on this machine; throws when none is built. */
  hook(arch: string): string;
  /** The host link (hosts.ts): a name your SSH config gives, your yes to changes as you, and its calls over SSH. */
  hosts: {
    named(host: unknown): string;
    granted(host: string): Promise<void>;
    read(host: string, args: string[], script: string): Promise<Ran>;
    exec(host: string, args: string[], script: string): Promise<Ran>;
    put(host: string, path: string, bytes: Uint8Array, mode: string): Promise<Ran>;
  };
  /** Appends a core event. */
  append(kind: string, data: Obj): Promise<void>;
  /** Reads the record. */
  raw(query: string, params: readonly string[]): Promise<unknown[]>;
  /** Replays every spool file in a folder here as hooks from `host`, each once and in order, removing each once its events are synced. */
  replay(host: string, dir: string): Promise<void>;
  /** A session the record holds on `host`: the core's events about it carry that host. */
  on(session: string, host: string): void;
  /** Marks a session unknown: its hooks can't reach the hub, so nothing says what it does now. */
  unknown(session: string, agent: string): Promise<void>;
}

export class HostSessions {
  private readonly starts = new Map<string, Promise<string | undefined>>();
  /** Each host's passes over its spool, one after another. */
  private readonly taking = new Map<string, Promise<void>>();
  constructor(private readonly o: HostSessionsOptions) {}

  private keep(host: string, added: AddedHost): void {
    writeAtomic(join(this.o.root, 'host-sessions.json'), Buffer.from(JSON.stringify({ hosts: { ...addedHosts(this.o.root), [host]: added } })));
  }
  /** The home of a host that was added, where its agents keep their sessions. */
  home(host: string): string | undefined { return addedHosts(this.o.root)[host]?.home; }

  /**
   * host.add, `deep host add <host>`: deep-hook for the host's machine, the hub's guard entries, the setting that gives
   * a forwarded socket the network route's time, and Claude Code's hook entries beside yours, each written as you only
   * where it differs and recorded as a host change with its undo. It answers where the link forwards.
   */
  async add(name: unknown): Promise<Obj> {
    const host = this.o.hosts.named(name);
    await this.o.hosts.granted(host);
    const blocked = (why: string, retry: boolean) => new Refused(refusal('unavailable', '/params/host', `BLOCKED: ${why}`, host, retry));
    const looked = await this.o.hosts.read(host, [], LOOK);
    const lines = looked.stdout.split('\n').map((l) => l.split('\t'));
    const home = lines.find((l) => l[0] === 'home')?.[1];
    if (looked.code !== 0 || !home?.startsWith('/')) throw blocked(`${host} couldn't be read over SSH: ${looked.stderr.trim().slice(-400)}`, true);
    const machine = lines.find((l) => l[0] === 'machine')?.[1] ?? '';
    const arch = ARCH[machine];
    if (!arch) throw blocked(`${host} is ${machine || 'a machine uname names nothing for'}, and deep-hook is built for Linux on arm64 and x86_64 hosts`, false);
    let binary: Buffer;
    try { binary = readFileSync(this.o.hook(arch)); } catch (error) { throw blocked(error instanceof Error ? error.message : String(error), false); }
    const has = new Map(lines.filter((l) => l[0] === 'has').map((l) => [l[1]!, l[2]!]));
    const texts = new Map(lines.filter((l) => l[0] === 'text').map((l) => [l[1]!, { mode: l[2]!, text: Buffer.from(l[3] ?? '', 'base64').toString('utf8') }]));
    const json = (path: string): Obj => {
      const found = texts.get(path);
      if (!found) return {};
      try {
        const value: unknown = JSON.parse(found.text);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Obj;
      } catch { /* refused below */ }
      throw blocked(`~/${path} on ${host} isn't a JSON object, so it was left as it is and nothing was installed; fix it, then run deep host add ${host} again`, false);
    };
    const hook = `${home}/.deepbuild/bin/deep-hook`;
    const config = json('.deepbuild/config.json');
    const record = join(this.o.root, 'hosts', hostKey(host));
    mkdirSync(record, { recursive: true, mode: 0o700 });
    const groups = ourGroups(hook, claudeCommand(hook, 'waiter'), Math.max(600, Math.ceil((longestDeadline(this.o.root) ?? 0) / 1000)));
    const settings = withHooks(record, json('.claude/settings.json'), groups);
    let rules: Buffer | undefined;
    try { rules = readFileSync(join(this.o.root, 'rules.json')); } catch { /* none before setup: deep-hook there reads none */ }
    const pretty = (value: Obj) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const files: { path: string; bytes: Buffer; mode: string; does: string }[] = [
      { path: '.deepbuild/bin/deep-hook', bytes: binary, mode: '755', does: `Install deep-hook on ${host}, the program its agents' hooks run` },
      ...(rules ? [{ path: '.deepbuild/rules.json', bytes: rules, mode: '600', does: `Copy DeepBuild's guard entries to ${host}, which deep-hook there applies while the link is down` }] : []),
      { path: '.deepbuild/config.json', bytes: pretty({ ...config, hub: { ...(typeof config.hub === 'object' && config.hub !== null ? config.hub : {}), forwarded: true } }), mode: texts.get('.deepbuild/config.json')?.mode ?? '600', does: `Tell deep-hook on ${host} its hub is reached over a forwarded socket, so its hooks wait the network route's time` },
      { path: '.claude/settings.json', bytes: pretty(settings), mode: texts.get('.claude/settings.json')?.mode ?? '600', does: `Add DeepBuild's hook entries to Claude Code's settings on ${host}, beside yours` },
    ];
    let changed = 0;
    for (const file of files) {
      const was = texts.get(file.path);
      // What the host holds there now, by its hash: a file of its own is kept before it is written over.
      const before = was ? sha(was.text) : has.get(file.path);
      if (before === sha(file.bytes)) continue;
      const target = `${home}/${file.path}`;
      let undo = `rm -f ${q(target)}`;
      if (before) {
        const kept = await this.o.hosts.exec(host, [file.path, before], KEEP);
        if (kept.code !== 0) throw blocked(`~/${file.path} on ${host} couldn't be kept as it was before its change: ${kept.stderr.trim().slice(-300)}`, true);
        undo = `mv -f ${q(`${home}/.deepbuild/originals/${before}`)} ${q(target)}`;
      }
      const put = await this.o.hosts.put(host, file.path, file.bytes, file.mode);
      if (put.code !== 0) throw blocked(`~/${file.path} couldn't be written on ${host}: ${put.stderr.trim().slice(-300)}`, true);
      await this.o.append('host.changed', { host, change: file.does, changes: [target], undo, grant: 'you', fingerprint: [{ target, sha256: sha(file.bytes) }], ask: null, run: null });
      changed++;
    }
    const added: AddedHost = { home, hook, ...(await this.report(host)) };
    this.keep(host, added);
    return { host, home, socket: hostSocket(home), hook, version: added.version, contract: added.contract, changed };
  }
  /** What the host's deep-hook says of itself now, beside what this hub is. */
  private async report(host: string): Promise<Pick<AddedHost, 'version' | 'contract' | 'hubVersion' | 'hubContract'>> {
    const said = (await this.o.hosts.exec(host, [], REPORT)).stdout.split('\n').map((l) => l.split('\t'));
    const one = (key: string) => said.find((l) => l[0] === key)?.[1] || null;
    return { version: one('version'), contract: one('contract'), hubVersion: HUB_VERSION, hubContract: this.o.contract };
  }

  /**
   * A host's link came up or went down, recorded as host.link, or its deep-hook spooled while it was up. Down: each of
   * its sessions at work or waiting reads unknown, never finished or gone, until its next hook says otherwise. Up: what
   * the host's deep-hook and this hub each speak, read again, since either may have been updated while the other ran;
   * then the host's spool, pass after pass until one finds none (three at most, since a busy session spools while one runs). The event loop reads
   * no hook from the host until this settles. A spool while it is up is taken the same way, one host's passes in turn.
   */
  async link(host: string, state: 'up' | 'down' | 'spool', why: string): Promise<void> {
    if (state !== 'spool') {
      const added = addedHosts(this.o.root)[host];
      const said = state === 'up' && added ? await this.report(host) : undefined;
      await this.o.append('host.link', { host, up: state === 'up', why: state === 'up' ? null : why, hook_version: said?.version ?? null, hook_contract: said?.contract ?? null, hub_version: said?.hubVersion ?? null, hub_contract: said?.hubContract ?? null });
      const sessions = (await this.o.raw('SELECT id, agent, status FROM sessions WHERE host = ?', [host])) as { id: string; agent: string | null; status: string }[];
      for (const s of sessions) this.o.on(s.id, host);
      if (state === 'down') {
        for (const s of sessions) if (['running', 'working', 'waiting'].includes(s.status)) await this.o.unknown(s.id, s.agent ?? 'claude-code');
        return;
      }
      if (added && said) this.keep(host, { ...added, ...said });
    }
    const passes = (this.taking.get(host) ?? Promise.resolve()).then(async () => { for (let pass = 0; pass < 3 && await this.take(host); pass++); });
    this.taking.set(host, passes.catch(() => undefined));
    return passes;
  }
  /** One pass over the host's spool: how many files it brought here and replayed. */
  private async take(host: string): Promise<number> {
    const taken = await this.o.hosts.exec(host, [ulid(Date.now())], TAKE);
    const files = taken.code === 0 ? taken.stdout.split('\n').map((l) => l.split('\t')).filter((l) => l[0] === 'file' && /^taken-[0-9A-Z]{26}\.jsonl$/.test(l[1] ?? '')) : [];
    if (!files.length) return 0;
    const dir = join(this.o.root, 'spool', 'hosts', hostKey(host));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const [, name, text] of files) {
      writeAtomic(join(dir, name!), Buffer.from(text ?? '', 'base64'));
      syncPath(join(dir, name!));
    }
    syncPath(dir);
    // Synced here before it goes there: a hub that stops between the two takes the same file again, and records each event once.
    await this.o.hosts.exec(host, files.map((f) => f[1]!), DROP);
    await this.o.replay(host, dir);
    return files.length;
  }

  /** The HEAD of a session's folder on its host, as session-facts' headOf reads one here; undefined where it has none or can't be read. */
  async headOf(host: string, cwd: string): Promise<{ sha: string; branch: string | null } | undefined> {
    const [sha, branch] = (await this.o.hosts.exec(host, [cwd], HEAD)).stdout.split('\n');
    return sha && /^[0-9a-f]{40}$/.test(sha) ? { sha, branch: branch || null } : undefined;
  }
  /**
   * The repo's spec as `base` holds it in a session's folder on its host, in approvedSpec's shape: read from the
   * commit, never the folder the agent works in. A base that can't be read there throws: its revision is unknown.
   */
  async spec(host: string, cwd: string, base: string): Promise<{ text: string | undefined; oid: string | undefined; spec: unknown; parsed: boolean }> {
    if (!/^[0-9a-f]{40}$/.test(base) || /^0+$/.test(base)) return { text: undefined, oid: undefined, spec: undefined, parsed: true };
    const r = await this.o.hosts.read(host, [cwd, base], SPEC_AT);
    const lines = r.stdout.split('\n').map((l) => l.split('\t'));
    const oid = lines.find((l) => l[0] === 'oid')?.[1];
    if (r.code !== 0 || (!oid && r.stdout.trim() !== 'none')) throw Error(`.deepbuild/done.yaml couldn't be read on ${host} at the claim's base commit ${base.slice(0, 12)}, so the revision you approved is unknown`);
    if (!oid) return { text: undefined, oid: undefined, spec: undefined, parsed: true };
    const text = Buffer.from(lines.find((l) => l[0] === 'text')?.[1] ?? '', 'base64').toString('utf8');
    try { return { text, oid, spec: parseYaml(text), parsed: true }; } catch { return { text, oid, spec: undefined, parsed: false }; }
  }
  /** The files among `paths` a session's folder on its host holds, each with its bytes up to `max`; a host that can't be read throws, since a file not read is not a file missing. */
  private async files(host: string, cwd: string, paths: string[], max: number): Promise<Map<string, Buffer>> {
    const asked = paths.map((p) => normalize(p)).filter((p) => p && p !== '.' && !isAbsolute(p) && !p.startsWith('..'));
    const r = asked.length ? await this.o.hosts.read(host, [cwd, String(max), ...asked], FILES) : { code: 0, stdout: 'read\n', stderr: '' };
    if (r.code !== 0 || !r.stdout.endsWith('read\n')) throw Error(`the session's folder on ${host} couldn't be read over SSH: ${r.stderr.trim().slice(-300)}`);
    return new Map(r.stdout.split('\n').map((l) => l.split('\t')).filter((l) => l[0] === 'file' && asked[Number(l[1])] !== undefined).map((l) => [asked[Number(l[1])]!, Buffer.from(l[2] ?? '', 'base64')]));
  }
  /**
   * What a claim changed in its session's folder on its host against `base`, as changesOf reads one here (#3511), all
   * of it within `ms`. A read that failed there, a link that didn't answer and a read past `ms` are its `unread`,
   * naming which: then nothing is known of what it changed.
   */
  async changes(host: string, cwd: string, base: string, ms: number): Promise<Changes> {
    const unread = (why: string): Changes => ({ changed: [], configs: new Map(), scripts: false, unread: `on ${host}, ${why}` });
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<Changes>((done) => { timer = setTimeout(() => done(unread(`the read of what the claim changed ran past its ${Math.ceil(ms)} ms deadline`)), ms); });
    const read = (async (): Promise<Changes> => {
      const r = await this.o.hosts.read(host, [cwd, base, String(Math.max(1, Math.floor(ms / 1000)))], CHANGES);
      if (r.code !== 0 || !r.stdout.endsWith('read\n')) return unread(`the read of what the claim changed didn't end (ssh exit ${String(r.code)}: ${r.stderr.trim().slice(-200)})`);
      const lines = r.stdout.split('\n').map((l) => l.split('\t'));
      const text = (name: string): string[] => lines.filter((l) => l[0] === name).map((l) => Buffer.from(l[1] ?? '', 'base64').toString('utf8'));
      const list = (name: string): string[] => text(name).flatMap((t) => t.split('\n').filter(Boolean));
      const failed = text('unread');
      if (failed.length) return unread(failed.join('; '));
      const [diff, others, flagged] = [list('diff'), list('others'), list('tracked')];
      // A file the index is told not to compare (assume-unchanged, skip-worktree) is never listed as changed, and a
      // path git still quotes names no file: either way what changed isn't known.
      const hidden = flagged.filter((l) => /^[a-zS] /.test(l)).map((l) => l.slice(2));
      if (hidden.length) return unread(`git compares ${hidden.length} file${hidden.length === 1 ? '' : 's'} with nothing (${hidden.slice(0, 3).join(', ')}): the index is told to assume ${hidden.length === 1 ? 'it' : 'them'} unchanged`);
      const tracked = flagged.map((l) => l.slice(2));
      const quoted = [...diff, ...others, ...tracked].find((path) => path.startsWith('"'));
      if (quoted) return unread(`git names a path it can't list plainly (${quoted})`);
      const configs = new Map([...await this.files(host, cwd, [...new Set([...tracked, ...others].filter(runnerConfig))], 1 << 20)].map(([path, bytes]) => [path, bytes.toString('utf8')]));
      return { changed: [...new Set([...diff, ...others])].sort(), configs, scripts: diff.includes('package.json') && scriptsOf(text('was')[0]) !== scriptsOf(text('now')[0]) };
    })().catch((error: unknown) => unread(error instanceof Error ? error.message : String(error)));
    return Promise.race([read, late]).finally(() => clearTimeout(timer));
  }
  /** A file a session's folder on its host holds, whole: a drafted check's bytes, as ask-tasks' bytesOf reads one here. */
  async bytesOf(host: string, cwd: string, path: string): Promise<Uint8Array | undefined> {
    return (await this.files(host, cwd, [path], 16 << 20)).get(normalize(path));
  }
  /**
   * What the validity gate reads of a claim's checkout, brought here from the session's folder on its host: `read` is
   * given a folder of this hub's holding each of `paths` the folder there holds, its first megabyte, gone once it read.
   */
  async viewed<T>(host: string, cwd: string, paths: string[], read: (checkout: string) => T): Promise<T> {
    const held = await this.files(host, cwd, paths, 1 << 20);
    const record = join(this.o.root, 'hosts', hostKey(host));
    mkdirSync(record, { recursive: true, mode: 0o700 });
    const dir = mkdtempSync(join(record, 'view-'));
    try {
      for (const [path, bytes] of held) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), bytes);
      }
      return read(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  /**
   * What a drafted check's run on a host does first, in the session's folder there, where no checkout is laid: proves
   * that the check, and each output it references, is the bytes approved, and runs nothing when one isn't.
   */
  proven(host: string, files: { path: string; sha256: string }[]): string {
    return files.map(({ path, sha256 }) => `[ "$(sha256sum < ${q(path)} | cut -d' ' -f1)" = ${sha256} ] || { echo ${q(`${path} on ${host} isn't the bytes approved for this check (sha256 ${sha256.slice(0, 12)}), so nothing ran`)} >&2; exit 126; }\n`).join('');
  }
  /** A host whose changes were undone (`deep host remove`): its sessions record here no more, and its link isn't opened again. */
  forget(host: string): void {
    const { [host]: gone, ...hosts } = addedHosts(this.o.root);
    if (gone) writeAtomic(join(this.o.root, 'host-sessions.json'), Buffer.from(JSON.stringify({ hosts })));
  }
  /** Whether Claude Code on the host trusts a folder there, by its own record: the trust its spec's commands run on. */
  async trusted(host: string, cwd: string): Promise<boolean> {
    try {
      const user = JSON.parse(Buffer.from((await this.o.hosts.read(host, [], CLAUDE_JSON)).stdout.trim(), 'base64').toString('utf8')) as { projects?: Record<string, { hasTrustDialogAccepted?: unknown } | undefined> };
      return user.projects?.[cwd]?.hasTrustDialogAccepted === true;
    } catch { return false; }
  }
  /** A prompt's entry in a session's transcript on its host, which its origin joins to; undefined when it holds none or can't be read. */
  async promptEntry(host: string, transcript: string, prompt: string): Promise<Obj | undefined> {
    const r = await this.o.hosts.exec(host, [transcript, prompt], PROMPT);
    try {
      const entry: unknown = JSON.parse(r.stdout);
      return typeof entry === 'object' && entry !== null && !Array.isArray(entry) && (entry as Obj).isSidechain !== true ? entry as Obj : undefined;
    } catch { return undefined; }
  }
  /** A process's command line on a host; empty when it can't be read. */
  argsOf(host: string, pid: number): Promise<string> {
    return this.o.hosts.exec(host, [String(pid)], ARGS).then((r) => (r.code === 0 ? r.stdout.trim() : ''));
  }
  /** A process's start time on a host, read over SSH and kept by its ID; undefined when it can't be read. */
  startOf(host: string, pid: number, fresh = false): Promise<string | undefined> {
    const key = `${host}:${pid}`;
    const known = this.starts.get(key);
    if (known && !fresh) return known;
    const read = this.o.hosts.exec(host, [String(pid)], STARTED).then((r) => (r.code === 0 && r.stdout.trim() ? r.stdout.trim() : undefined));
    this.starts.set(key, read);
    // A read that failed proves nothing about the process: the next hook reads again.
    void read.then((start) => { if (start === undefined && this.starts.get(key) === read) this.starts.delete(key); });
    return read;
  }
}
