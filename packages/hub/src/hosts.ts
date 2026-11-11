// Hosts and remote runs (#1942; design: Blocks for work on your other machines). A host is a name a Host line in your
// ~/.ssh/config gives literally; nothing else is ever contacted. Every call is `ssh -F` that file on a connection of its
// own (ControlMaster off), so a stalled connection holds up only its own call, and your SSH agent keeps the keys. A
// host's facts are readings with the time they were read. A run starts as the user service `deep-<token>` through
// `systemd-run --user`, so it outlives the session that started it; its output goes to files under
// ~/.deepbuild/runs/<token>/ there, and `mkdir` of that folder locks the start, so it runs at most once per token.
// After a dropped link, a start whose outcome is unknown is read back by its token, never sent again; only reads retry
// on their own. Each run's follower is one connection streaming its output from a byte offset with a heartbeat: one
// that goes quiet is stopped by its PID and opened again at the offset, alone.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import type { PlanInput } from '@deepbuild/asks';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { refusal, Refused, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
/** How long a follower may go without a byte, output or heartbeat, before its connection counts as stalled; a new one may take longer for its first. */
const STALL_MS = 5000;
const FIRST_BYTE_MS = 30_000;
const DAY = 86_400_000;
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const RUNS = 'd="$HOME/.deepbuild/runs/$1"';

/** The host's facts, one `<name>\t<value>` line each; /proc stands in where `ss` is missing. */
const FACTS = String.raw`printf 'kernel\t%s\narch\t%s\n' "$(uname -r)" "$(uname -m)"
[ -r /etc/os-release ] && (. /etc/os-release; printf 'os\t%s\n' "$PRETTY_NAME")
printf 'cores\t%s\n' "$(getconf _NPROCESSORS_ONLN)"
awk '/^MemTotal:/ { printf "memory_kb\t%s\n", $2 }' /proc/meminfo
command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits | sed 's/^/gpu\t/'
[ -r /proc/driver/nvidia/version ] && printf 'nvidia\t%s\n' "$(head -n 1 /proc/driver/nvidia/version)"
df -Pk "$HOME" | awk 'NR == 2 { printf "disk\t%s\t%s\n", $6, $4 }'
if command -v ss >/dev/null; then ss -Hltn | awk '{ printf "listening\t%s\n", $4 }'
else awk 'NR > 1 && $4 == "0A" { split($2, a, ":"); print a[2] }' /proc/net/tcp /proc/net/tcp6 | while read -r p; do printf 'listening\t:%d\n' "0x$p"; done; fi`;
/** The unit: its command is a file of its folder, so systemd expands nothing in what the run says; its exit goes to `exit`. */
const UNIT = String.raw`systemd-run --user --quiet --collect -p WorkingDirectory=~ -p StandardOutput="append:$d/out" -p StandardError="append:$d/err" -p ExecStopPost="$d/post"`;
/** Starts the run once, `cmd` its command file: the folder's mkdir is the lock, and its state is kept before the reply, which a drop may lose. */
const start = (cmd: string, end: string): string => String.raw`trap '' HUP PIPE
r="$HOME/.deepbuild/runs"; d="$r/$1"
umask 077; mkdir -p "$r" || exit 3
mkdir "$d" 2>/dev/null || { echo exists; exit 0; }
: > "$d/out"; : > "$d/err"
cat > "$d/cmd" <<'${end}'
${cmd}
${end}
printf '%s\n' '#!/bin/sh' 'printf "%s %s\n" "$EXIT_CODE" "$EXIT_STATUS" > "$(dirname "$0")/exit.part" && mv "$(dirname "$0")/exit.part" "$(dirname "$0")/exit"' > "$d/post"
chmod 700 "$d/post"
if ${UNIT} --unit="$2" /bin/sh "$d/cmd"; then echo started > "$d/state"; echo started
else echo failed > "$d/state"; echo failed; fi`;
/** The planted wrong program's resend: no lock and a unit of another name, so the run really starts again. */
const RESEND = String.raw`d="$HOME/.deepbuild/runs/$1"
${UNIT} --unit="$2-again" /bin/sh "$d/cmd" && echo started`;
/** What became of a start: absent (never reached the host), or its state once written. */
const READ_BACK = String.raw`${RUNS}
[ -d "$d" ] || { echo absent; exit 0; }
i=0; while [ ! -s "$d/state" ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
cat "$d/state" 2>/dev/null || echo unknown`;
/**
 * The run's stdout from a byte offset, as it comes; a heartbeat on stderr while it's quiet, and its exit at the end. It
 * stops the follower it replaces there first, so a stalled link isn't fed more output than it held when it stalled.
 */
const FOLLOW = String.raw`${RUNS}; off=$2; n=0
[ -d "$d" ] || { echo 'no such run' >&2; exit 5; }
p=$(cat "$d/follower" 2>/dev/null) && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qF -- "$1" && { kill -- "-$p" 2>/dev/null || kill "$p"; }
echo $$ > "$d/follower"
while :; do
  s=$(wc -c < "$d/out")
  if [ "$s" -gt "$off" ]; then tail -c +$((off + 1)) "$d/out" | head -c $((s - off)); off=$s; n=0; continue; fi
  if [ -s "$d/exit" ]; then [ "$(wc -c < "$d/out")" -gt "$off" ] && continue; printf '\nexit %s\n' "$(cat "$d/exit")" >&2; exit 0; fi
  n=$((n + 1)); [ $n -ge 5 ] && { printf . >&2; n=0; }
  sleep 0.05
done`;

/** A fact as read over SSH: its value and when it was read, on this machine's clock. */
export interface Reading { value: unknown; as_of: number }
export interface RemoteSpec { host: string; token: string; argv: string[]; cwd?: string; env: Record<string, string>; adopt?: boolean; output: { stdout(chunk: Buffer): void; stderr(chunk: Buffer): void } }
export interface RemoteEnd { code: number | null; signal?: string; failed?: string }
interface Ran { code: number | null; stdout: string; stderr: string }
interface HostsOptions {
  root: string; now: () => number; plant: Plant | undefined;
  /** Raises the authority ask for changes as you on a host: its handle. */
  raise(ask: Obj, plan: PlanInput): Promise<string>;
}

export class Hosts {
  private readonly kept = new Map<string, Record<string, Reading>>();
  /** Each host's live followers, by their ssh process. */
  private readonly followers = new Map<string, Set<ChildProcess>>();
  private closed = false;
  /** The open ask for changes as you on a host, and who waits on its answer. */
  private readonly asking = new Map<string, { ask?: string; answer: Promise<boolean>; done(yes: boolean): void }>();
  constructor(private readonly o: HostsOptions) {}

  private get config(): string { return join(homedir(), '.ssh', 'config'); }
  /** The hosts your SSH config names: each name a Host line gives that is no pattern, through its Include lines. */
  names(file = this.config, seen = new Set<string>()): string[] {
    if (seen.has(file)) return [];
    seen.add(file);
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { return []; }
    const names: string[] = [];
    for (const line of text.split('\n')) {
      const m = /^\s*(\w+)\s*(?:=\s*|\s)(.*)$/.exec(line);
      if (!m) continue;
      const values = (m[2]!.match(/"[^"]*"|\S+/g) ?? []).map((v) => v.replace(/^"(.*)"$/, '$1')).filter(Boolean);
      if (m[1]!.toLowerCase() === 'host') names.push(...values.filter((v) => !/[*?!]/.test(v)));
      if (m[1]!.toLowerCase() === 'include') for (const v of values) names.push(...this.names(v.startsWith('~/') ? join(homedir(), v.slice(2)) : isAbsolute(v) ? v : join(homedir(), '.ssh', v), seen));
    }
    return [...new Set(names)];
  }
  /** Refuses a name your SSH config doesn't name, before anything reaches it. */
  named(host: unknown): string {
    if (typeof host === 'string' && this.names().includes(host)) return host;
    throw new Refused(refusal('not_found', '/params/host', `${String(host)} isn't a host your SSH config (~/.ssh/config) names, so DeepBuild won't contact it. Name one of: ${this.names().join(', ') || 'none'}.`, host));
  }

  /** One ssh call on a connection of its own: the script on its stdin, run by `sh -s` with `args`. */
  private ssh(host: string, args: string[], script: string): ChildProcess {
    const child = spawn('ssh', ['-F', this.config, '-o', 'BatchMode=yes', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=30', '--', host, ['sh', '-s', '--', ...args].map(q).join(' ')], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin!.on('error', () => undefined);
    // Braced, so the shell has read all of it before any of it runs.
    child.stdin!.end(`{\n${script}\n}\n`);
    return child;
  }
  private exec(host: string, args: string[], script: string): Promise<Ran> {
    return new Promise((resolve) => {
      const child = this.ssh(host, args, script);
      let stdout = '';
      let stderr = '';
      child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      child.on('error', (error) => resolve({ code: null, stdout, stderr: error.message }));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }
  /** A read: tried again on its own while the link fails (ssh's 255), up to a few minutes. */
  private async read(host: string, args: string[], script: string): Promise<Ran> {
    for (let wait = 250, until = this.o.now() + 180_000; ; wait = Math.min(wait * 2, 10_000)) {
      const r = await this.exec(host, args, script);
      if (r.code !== 255 || this.o.now() > until) return r;
      await new Promise((done) => setTimeout(done, wait));
    }
  }

  /** host.facts: the host's facts, read over SSH now when `refresh` or none are kept, else as last read. */
  async facts(name: unknown, refresh: boolean): Promise<Obj> {
    const host = this.named(name);
    const kept = this.kept.get(host);
    if (kept && !refresh) return { host, facts: kept };
    const r = await this.read(host, [], FACTS);
    if (r.code !== 0) throw new Refused(refusal('unavailable', '/params/host', `BLOCKED: ${host}'s facts couldn't be read over SSH: ${r.stderr.trim().slice(-400)}`, host, true));
    const as_of = this.o.now();
    const lines = r.stdout.split('\n').map((l) => l.split('\t'));
    const one = (key: string) => lines.find((l) => l[0] === key)?.[1] ?? null;
    const all = (key: string) => lines.filter((l) => l[0] === key).map((l) => l.slice(1));
    const gpus = all('gpu').map(([g = '']) => { const [name, memory_mb, driver] = g.split(',').map((s) => s.trim()); return { name, memory_mb: Number(memory_mb), driver }; });
    const facts: Record<string, Reading> = {
      system: { value: { kernel: one('kernel'), arch: one('arch'), os: one('os'), cores: Number(one('cores')), memory_bytes: Number(one('memory_kb')) * 1024 }, as_of },
      gpus: { value: gpus, as_of },
      drivers: { value: { nvidia: one('nvidia') ?? gpus[0]?.driver ?? null }, as_of },
      disk: { value: all('disk').map(([path, kb]) => ({ path, free_bytes: Number(kb) * 1024 })), as_of },
      listening: { value: all('listening').map(([at = '']) => ({ address: at.slice(0, at.lastIndexOf(':')), port: Number(at.slice(at.lastIndexOf(':') + 1)) })), as_of },
    };
    this.kept.set(host, facts);
    return { host, facts };
  }

  /** Changes as you on a host, asked once: resolves once you said yes, now or before; your no refuses, naming the host. */
  async granted(host: string): Promise<void> {
    const file = join(this.o.root, 'hosts.json');
    const grants = (): string[] => { try { return (JSON.parse(readFileSync(file, 'utf8')) as { change_as_you: string[] }).change_as_you; } catch { return []; } };
    if (grants().includes(host)) return;
    let open = this.asking.get(host);
    if (!open) {
      let done!: (yes: boolean) => void;
      const answer = new Promise<boolean>((resolve) => (done = resolve)).then((yes) => {
        this.asking.delete(host);
        if (yes) writeFileSync(file, JSON.stringify({ change_as_you: [...new Set([...grants(), host])] }));
        return yes;
      });
      const key = sha(`host.change:${host}`);
      open = { answer, done };
      this.asking.set(host, open);
      open.ask = await this.o.raise({
        kind: 'authority', question: `Let DeepBuild start runs as you on ${host}, as user services under your user there?`,
        options: [{ id: 'allow', label: `Allow on ${host}`, decision: 'allow' }, { id: 'decline', label: "Don't", decision: 'deny' }],
        recommended: null, deadline: this.o.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key, pinned_to: { kind: 'evidence', ref: key },
      }, { steps: [{ does: `Start runs on ${host} as you: user services under your user, their files under ~/.deepbuild/runs there, never as root`, changes: [`${host}: user services deep-<run token>`], undo: `Stop them with systemctl --user stop on ${host}`, public: false, cost: 0 }], diff: key })
        .catch((error: unknown) => { this.asking.delete(host); throw error; });
    }
    if (!(await open.answer)) throw new Refused(refusal('denied', '/params/host', `You said no to runs as you on ${host}.`, host));
  }
  /** Your answer to a host's ask: true when it was one. */
  answered(ask: string, decision: string): boolean {
    for (const open of this.asking.values()) if (open.ask === ask) { open.done(decision === 'allow'); return true; }
    return false;
  }

  /** Stops this hub's followers, by their PIDs; the runs they follow go on, on their hosts. */
  close(): void {
    this.closed = true;
    for (const own of this.followers.values()) for (const child of own) child.kill('SIGTERM');
  }
  /** A remote run: started once (or adopted after a hub restart), followed to its end, its output streamed as it comes. */
  run(spec: RemoteSpec): { ended: Promise<RemoteEnd>; stop(): void } {
    const unit = `deep-${spec.token}`;
    const ended = (async (): Promise<RemoteEnd> => {
      if (!spec.adopt) {
        const started = await this.start(spec, unit);
        if (started) return { code: null, failed: started };
      }
      const end = await this.follow(spec);
      // Its stderr whole, then its folder goes: the token's lock is spent once its end is read.
      const err = await this.read(spec.host, [spec.token], `${RUNS}; cat "$d/err" && rm -rf "$d"`);
      if (err.code === 0 && err.stdout) spec.output.stderr(Buffer.from(err.stdout));
      return end;
    })();
    return { ended, stop: () => void this.exec(spec.host, [unit], 'systemctl --user stop "$1"') };
  }
  /** Sends the start once; when the link drops before its reply, reads it back by its token: undefined once it started. */
  private async start(spec: RemoteSpec, unit: string): Promise<string | undefined> {
    const env = Object.entries({ ...spec.env, DEEP_RUN_TOKEN: spec.token }).filter(([k]) => /^[A-Za-z_]\w*$/.test(k)).map(([k, v]) => `export ${k}=${q(v)}`);
    const cmd = [...env, ...(spec.cwd ? [`cd ${q(spec.cwd)} || exit 127`] : []), `exec ${spec.argv.map(q).join(' ')}`].join('\n');
    const sent = await this.exec(spec.host, [spec.token, unit], start(cmd, `DEEP_${sha(cmd).slice(0, 16)}`));
    let state = sent.code === 0 ? sent.stdout.trim() : '';
    if (!state && this.o.plant === 'host-link-resends-on-reconnect') state = (await this.read(spec.host, [spec.token, unit], RESEND)).stdout.trim();
    else if (!state) state = (await this.read(spec.host, [spec.token], READ_BACK)).stdout.trim();
    if (state === 'started' || state === 'exists') return undefined;
    return state === 'absent' ? `the start never reached ${spec.host}: read back by its token, nothing is there` : `systemd-run --user didn't start it on ${spec.host} (${state || sent.stderr.trim().slice(-300)})`;
  }
  /** Follows the run's output to its end, opening its connection again at the byte it reached whenever it stalls or drops. */
  private follow(spec: RemoteSpec): Promise<RemoteEnd> {
    const own = this.followers.get(spec.host) ?? new Set<ChildProcess>();
    this.followers.set(spec.host, own);
    let offset = 0;
    return new Promise((resolve) => {
      const open = (wait: number) => {
        const child = this.ssh(spec.host, [spec.token, String(offset)], FOLLOW);
        own.add(child);
        let last = Date.now();
        let tick = last;
        let heard = false;
        let err = '';
        child.stdout!.on('data', (chunk: Buffer) => { last = Date.now(); heard = true; offset += chunk.length; spec.output.stdout(chunk); });
        child.stderr!.setEncoding('utf8').on('data', (d: string) => { last = Date.now(); heard = true; err = (err + d).slice(-2000); });
        const watch = setInterval(() => {
          const now = Date.now();
          // A tick that comes late means this process was held up, not the connection: what came meanwhile isn't read yet.
          if (now - tick > 1000) last = now;
          tick = now;
          if (now - last < (heard ? STALL_MS : FIRST_BYTE_MS)) return;
          clearInterval(watch);
          // The planted wrong program drops every connection to the host on one stall.
          for (const c of this.o.plant === 'host-link-drops-every-connection' ? [...own] : [child]) c.kill('SIGKILL');
        }, 250);
        child.on('close', (code, signal) => {
          clearInterval(watch);
          own.delete(child);
          if (this.closed) return;
          const exit = /\nexit (\S+) (\S+)/.exec(err);
          if (exit) return resolve(exit[1] === 'exited' ? { code: Number(exit[2]) } : { code: null, signal: `SIG${exit[2]}` });
          if (code === 5) return resolve({ code: null, failed: `${spec.host} has no run with its token: its folder there is gone` });
          // A stall is opened again at once; a link that won't come up, a little later each time.
          setTimeout(() => open(Math.min(wait * 2, 10_000)), signal === 'SIGKILL' ? 100 : wait);
        });
      };
      open(500);
    });
  }
}

/** `deep run follow <run>`: the run's stdout from its start, then as it comes, until it has ended. */
export async function followCommand(run: string): Promise<number> {
  let token: string | undefined;
  const output = async (from: number) => call(hubAddress().path, token ??= readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), 'run.output', { run, from });
  for (let from = 0; ;) {
    const reply = await output(from).catch((error: Error) => ({ error: { remediation: `BLOCKED: ${error.message}` } }));
    if ('error' in reply) {
      process.stderr.write(`${reply.error.remediation}\n`);
      return 1;
    }
    const { text, next, ended } = reply.result as { text: string; next: number; ended: boolean };
    if (text) await new Promise((done) => process.stdout.write(Buffer.from(text, 'base64'), done));
    from = next;
    if (ended) return 0;
  }
}
export const isRoot = (argv: string[]): boolean => ['sudo', 'su', 'doas', 'pkexec'].includes(basename(argv[0] ?? ''));
