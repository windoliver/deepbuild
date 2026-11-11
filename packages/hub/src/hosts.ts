// Hosts and remote runs (#1942; design: Blocks for work on your other machines). A host is a name a Host line in your
// ~/.ssh/config gives literally; nothing else is ever contacted. Every call is `ssh -F` that file on a connection of its
// own (ControlMaster off), so a stalled connection holds up only its own call, and your SSH agent keeps the keys. A
// host's facts are readings with the time they were read. A run starts as the user service `deep-<token>` through
// `systemd-run --user`, so it outlives the session that started it; its output goes to files under
// ~/.deepbuild/runs/<token>/ there, and `mkdir` of that folder locks the start, so it runs at most once per token.
// After a dropped link, a start whose outcome is unknown is read back by its token, never sent again; only reads retry
// on their own. Each run's follower is one connection streaming its output from a byte offset with a heartbeat: one
// that goes quiet is stopped by its PID and opened again at the offset, alone.
//
// Host changes and root plans (#1945). Before a host's first run, lingering is turned on for your user there, so its
// services outlive your last session: as you, a host change recorded with its undo, or a root plan where the host's
// policy needs root for it. A root plan is one authority ask, defaulting to no: the agent's script, where it wrote it
// on the host, locked by its SHA-256, with each step's undo, and what a package's install scripts do listed as not
// undoable. Only you run it, with `deep host run <ask>` in your own terminal: your sudo password goes from your terminal
// to sudo on the host and nowhere else; the script is copied into a folder only root can write, its hash checked
// there, and that copy run. The hub reads its output, exit and what it wrote from that folder as the run's evidence.
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import type { PlanInput } from '@deepbuild/asks';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { activePlant, refusal, Refused, ulid, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
/** How long a follower may go without a byte, output or heartbeat, before its connection counts as stalled; a new one may take longer for its first. */
const STALL_MS = 5000;
const FIRST_BYTE_MS = 30_000;
const DAY = 86_400_000;
const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');
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

/** Lingering for your user there: `on` already, `enabled` as you with the linger file's SHA-256, or `needs-root` and why. */
const LINGER = String.raw`u=$(id -un); f="/var/lib/systemd/linger/$u"
[ -e "$f" ] && { printf 'on\t%s\n' "$u"; exit 0; }
if e=$(loginctl enable-linger "$u" 2>&1 </dev/null) && [ -e "$f" ]; then printf 'enabled\t%s\t%s\n' "$u" "$(sha256sum < "$f" | cut -d' ' -f1)"
else printf 'needs-root\t%s\t%s\n' "$u" "$(printf %s "$e" | tr '\t\n' '  ')"; fi`;
/** A script where the agent wrote it, read as you: its bytes, base64. */
const READ_SCRIPT = String.raw`[ -f "$1" ] || { echo "$1 isn't a file there" >&2; exit 4; }
[ "$(wc -c < "$1")" -le 1048576 ] || { echo "$1 is over 1 MiB" >&2; exit 4; }
base64 < "$1"`;
/** A package file's name and install scripts (a .deb's maintainer scripts, an .rpm's scriptlets), or `unknown`. */
const PACKAGE = String.raw`f=$1
[ -r "$f" ] || { echo unknown; exit 0; }
case "$f" in
*.deb) printf 'name\t%s\n' "$(dpkg-deb -f "$f" Package 2>/dev/null)"; dpkg-deb --ctrl-tarfile "$f" 2>/dev/null | tar -t 2>/dev/null | sed -n 's#^\./\(preinst\|postinst\|prerm\|postrm\|config\)$#script\t\1#p' ;;
*.rpm) printf 'name\t%s\n' "$(rpm -qp --qf '%{NAME}' "$f" 2>/dev/null)"; rpm -qp --scripts "$f" 2>/dev/null | sed -n 's/^\([a-z]*\) scriptlet.*/script\t\1/p' ;;
*) echo unknown ;;
esac`;
/** Where a root plan's copy runs from on the host: folders root alone can write. */
const PLANS = '/var/lib/deepbuild/plans';
/**
 * The root side of `deep host run`, run by `sudo sh -c` with the script's bytes on its stdin: copied into a folder only
 * root can write, its hash checked there against the one your yes locked, and only then that copy run, from /. Its
 * stdout and stderr, exit and the SHA-256 of each file the plan names are kept beside it, for the hub to read.
 */
export const ROOT_RUN = String.raw`umask 022; want=$1; d=${PLANS}/$2; shift 2
install -d -m 0755 -o root -g root /var/lib/deepbuild ${PLANS} && mkdir -m 0755 "$d" || exit 96
cat > "$d/script" && chmod 0700 "$d/script" || exit 96
found=$(sha256sum < "$d/script" | cut -d' ' -f1)
if [ "$found" != "$want" ]; then rm -rf "$d"; printf 'deep: refused before anything ran as root: the plan you approved locked sha256 %s, and its copy has sha256 %s\n' "$want" "$found" >&2; exit 97; fi
echo "$found" > "$d/sha"
(cd / && sh "$d/script" 2> "$d/err"; echo $? > "$d/exit") | tee "$d/out"
cat "$d/err" >&2
for p; do if [ -f "$p" ]; then printf '%s\t%s\n' "$(sha256sum < "$p" | cut -d' ' -f1)" "$p"; else printf -- '-\t%s\n' "$p"; fi; done > "$d/prints"
exit "$(cat "$d/exit")"`;
/** What a root plan's run left in its folder, read as you: whose the folder is, the copy's hash, its exit, output and prints. */
const RAN = String.raw`d=${PLANS}/$1
[ -d "$d" ] || { echo absent; exit 0; }
printf 'owner\t%s\nsha\t%s\nexit\t%s\n' "$(stat -c %u -- "$d")" "$(cat "$d/sha" 2>/dev/null)" "$(cat "$d/exit" 2>/dev/null)"
[ -f "$d/out" ] && printf 'out\t%s\nerr\t%s\n' "$(base64 -w0 < "$d/out")" "$(base64 -w0 < "$d/err" 2>/dev/null)"
sed 's/^/print\t/' "$d/prints" 2>/dev/null; true`;

/** A fact as read over SSH: its value and when it was read, on this machine's clock. */
export interface Reading { value: unknown; as_of: number }
export interface RemoteSpec { host: string; token: string; argv: string[]; cwd?: string; env: Record<string, string>; adopt?: boolean; output: { stdout(chunk: Buffer): void; stderr(chunk: Buffer): void } }
export interface RemoteEnd { code: number | null; signal?: string; failed?: string }
interface Ran { code: number | null; stdout: string; stderr: string }
/** A step of a root plan as the agent gives it: a package step names the package file on the host. */
interface RootStep { does: string; changes: string[]; undo: string | null; package?: string | null }
/** A root plan the hub keeps by its ask: where its script is on the host, the hash your yes locks, and your answer. */
interface RootPlan { host: string; script: string; sha256: string; steps: RootStep[]; approved: boolean; linger?: string }
interface HostsOptions {
  root: string; now: () => number; plant: Plant | undefined;
  /** Raises an authority ask from `source` (a host's changes as you, or a root plan): its handle. */
  raise(source: 'host.change' | 'host.root_plan', ask: Obj, plan: PlanInput): Promise<string>;
  /** Appends a core event. */
  append(kind: string, data: Obj, extra: { subject?: string; v?: number }): Promise<void>;
  /** Puts bytes in the evidence store as they are: their SHA-256. */
  put(bytes: Uint8Array, kind: string, source: string): Promise<string>;
  /** Reads the record. */
  raw(query: string, params: readonly string[]): Promise<unknown[]>;
}

export class Hosts {
  private readonly kept = new Map<string, Record<string, Reading>>();
  /** Each host's live followers, by their ssh process. */
  private readonly followers = new Map<string, Set<ChildProcess>>();
  private closed = false;
  /** The open ask for changes as you on a host, and who waits on its answer. */
  private readonly asking = new Map<string, { ask?: string; answer: Promise<boolean>; done(yes: boolean): void }>();
  /** Each host's lingering, turned on once before its first run: undefined once on, else why it's off (#1945). */
  private readonly lingered = new Map<string, Promise<string | undefined>>();
  /** A run waiting on a root plan for lingering, by the plan's ask: told when it ran, or when you said no. */
  private readonly waiting = new Map<string, (ran: boolean) => void>();
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
      open.ask = await this.o.raise('host.change', {
        kind: 'authority', question: `Let DeepBuild start runs as you on ${host}, as user services under your user there?`,
        options: [{ id: 'allow', label: `Allow on ${host}`, decision: 'allow' }, { id: 'decline', label: "Don't", decision: 'deny' }],
        recommended: null, deadline: this.o.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key, pinned_to: { kind: 'evidence', ref: key },
      }, { steps: [{ does: `Start runs on ${host} as you: user services under your user, their files under ~/.deepbuild/runs there, never as root`, changes: [`${host}: user services deep-<run token>`], undo: `Stop them with systemctl --user stop on ${host}`, public: false, cost: 0 }], diff: key })
        .catch((error: unknown) => { this.asking.delete(host); throw error; });
    }
    if (!(await open.answer)) throw new Refused(refusal('denied', '/params/host', `You said no to runs as you on ${host}.`, host));
  }
  /** Your answer to a host's ask, or to a root plan: true when it was one. */
  answered(ask: string, decision: string): boolean {
    for (const open of this.asking.values()) if (open.ask === ask) { open.done(decision === 'allow'); return true; }
    const plans = this.plans();
    const plan = plans[ask];
    if (!plan) return false;
    plan.approved = decision === 'allow';
    this.keep(plans);
    // A no leaves lingering off for the run that waits on it.
    if (!plan.approved) this.waiting.get(ask)?.(false);
    return true;
  }

  /** host.changes: each change the record holds for a host, with its undo, oldest first. */
  async changes(name: unknown): Promise<Obj> {
    const host = this.named(name);
    const rows = (await this.o.raw(`SELECT ts, data FROM events WHERE kind = 'host.changed' AND writer = 'core' AND json_extract(data, '$.host') = ? ORDER BY log_pos`, [host])) as { ts: number; data: string }[];
    return { host, changes: rows.map((r) => ({ ts: r.ts, ...(JSON.parse(r.data) as Obj) })) };
  }

  // ---- Root plans (#1945).
  private get plansFile(): string { return join(this.o.root, 'root-plans.json'); }
  private plans(): Record<string, RootPlan> { try { return JSON.parse(readFileSync(this.plansFile, 'utf8')) as Record<string, RootPlan>; } catch { return {}; } }
  private keep(plans: Record<string, RootPlan>): void { writeFileSync(this.plansFile, JSON.stringify(plans), { mode: 0o600 }); }

  /**
   * deep_root_plan, and the hub's own root plans: the script where it was written on the host, read as you and locked by
   * its SHA-256, raised as one authority ask defaulting to no, each step with its undo. A step that installs a package
   * file is followed by one saying what its install scripts do can't be undone, unless the package has none.
   */
  async proposeRoot(args: Obj, linger?: { user: string; question: string }): Promise<Obj> {
    const host = this.named(args.host);
    const script = args.script;
    if (typeof script !== 'string' || !isAbsolute(script)) throw new Refused(refusal('type', '/params/arguments/script', `Give the script's absolute path on ${host}, where you wrote it.`, script));
    const given = Array.isArray(args.steps) ? (args.steps as RootStep[]) : [];
    if (!given.length) throw new Refused(refusal('required', '/params/arguments/steps', 'List what the plan does, step by step, each with its undo or null when it has none.', args.steps));
    const read = await this.read(host, [script], READ_SCRIPT);
    if (read.code !== 0) throw new Refused(refusal(read.code === 4 ? 'not_found' : 'unavailable', '/params/arguments/script', `BLOCKED: the script couldn't be read on ${host}: ${read.stderr.trim().slice(-400)}`, script, read.code !== 4));
    const bytes = Buffer.from(read.stdout, 'base64');
    const locked = sha(bytes);
    const steps: RootStep[] = [];
    for (const step of given) {
      steps.push({ does: step.does, changes: step.changes, undo: step.undo });
      if (typeof step.package !== 'string' || this.o.plant === 'host-package-fully-undoable') continue;
      const scripts = await this.installScripts(host, step.package);
      if (scripts) steps.push(scripts);
    }
    // The script itself is evidence, so the ask shows the exact bytes your yes locks.
    await this.o.put(bytes, 'root-plan.script', `${host}:${script}`);
    const question = linger?.question ?? `Run this root plan on ${host} as root? ${steps.length} step${steps.length === 1 ? '' : 's'}, from the script ${script} (sha256 ${locked.slice(0, 12)}); only you run it, with deep host run in your own terminal.`;
    const ask = await this.o.raise('host.root_plan', {
      kind: 'authority', question,
      options: [{ id: 'approve', label: 'Run it as root', decision: 'allow' }, { id: 'decline', label: "Don't run it", decision: 'deny' }],
      recommended: null, deadline: this.o.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you',
      key: sha(`host.root_plan:${host}:${script}:${locked}`), pinned_to: { kind: 'evidence', ref: locked },
    }, { steps: steps.map((s) => ({ does: s.does, changes: s.changes, undo: s.undo, public: false, cost: 0 })), diff: locked });
    const plans = this.plans();
    plans[ask] = { host, script, sha256: locked, steps, approved: plans[ask]?.approved ?? false, ...(linger ? { linger: linger.user } : {}) };
    this.keep(plans);
    return { ask, host, script, sha256: locked, steps: steps.length, next: `The person reads the plan and, if they say yes, runs it themselves with deep host run ${ask} in their own terminal; nothing runs as root until they do.` };
  }
  /** The step that says what a package's install scripts do can't be undone; none when it has no install scripts. */
  private async installScripts(host: string, file: string): Promise<RootStep | undefined> {
    const r = await this.read(host, [file], PACKAGE);
    const lines = r.stdout.split('\n').map((l) => l.split('\t'));
    const name = lines.find((l) => l[0] === 'name')?.[1] || basename(file);
    const scripts = lines.filter((l) => l[0] === 'script').map((l) => l[1]!);
    const unknown = r.code !== 0 || lines.some((l) => l[0] === 'unknown');
    if (!unknown && !scripts.length) return undefined;
    return unknown
      ? { does: `Whatever the install scripts of ${basename(file)} do on ${host}: they couldn't be read before your yes`, changes: [`what ${basename(file)}'s install scripts write, which no package log lists`], undo: null }
      : { does: `What the install scripts of ${name} (${basename(file)}: ${scripts.join(', ')}) do on ${host} beyond the files its package log lists`, changes: [`what ${name}'s ${scripts.join(', ')} write${scripts.length === 1 ? 's' : ''}, which its package log doesn't list`], undo: null };
  }
  /** host.plan: a root plan you said yes to, for `deep host run`, with a new run's handle; anything else is refused. */
  plan(ask: unknown): Obj {
    const p = typeof ask === 'string' ? this.plans()[ask] : undefined;
    if (!p) throw new Refused(refusal('not_found', '/params/ask', `${String(ask)} isn't a root plan this hub holds.`, ask));
    if (!p.approved) throw new Refused(refusal('denied', '/params/ask', `You haven't said yes to ${String(ask)}: read its plan and answer it first (deep inbox answer ${String(ask)} approve).`, ask));
    const paths = [...new Set(p.steps.flatMap((s) => s.changes).filter((c) => c.startsWith('/') && !/\s/.test(c)))];
    return { ask, host: p.host, script: p.script, sha256: p.sha256, run: `run:${ulid(this.o.now())}`, paths };
  }
  /**
   * host.ran: what `deep host run` left on the host, read as you from the folder only root can write: the run with its
   * output and exit as evidence, and each step as a host change with its undo and a fingerprint of what it wrote.
   */
  async ran(askIn: unknown, runIn: unknown): Promise<Obj> {
    const ask = String(askIn);
    const p = this.plans()[ask];
    if (!p) throw new Refused(refusal('not_found', '/params/ask', `${ask} isn't a root plan this hub holds.`, askIn));
    if (typeof runIn !== 'string' || !/^run:[0-9A-Za-z]+$/.test(runIn)) throw new Refused(refusal('pattern', '/params/run', 'Name the run as host.plan gave it.', runIn));
    const run = runIn;
    if ((await this.o.raw(`SELECT 1 FROM events WHERE kind = 'run.finished' AND subject = ? LIMIT 1`, [run])).length) return { ran: true, run, recorded: 'already' };
    const dir = `${PLANS}/${run.slice(4)}`;
    const r = await this.read(p.host, [run.slice(4)], RAN);
    if (r.code !== 0) throw new Refused(refusal('unavailable', '/params/run', `BLOCKED: what ${run} left on ${p.host} couldn't be read: ${r.stderr.trim().slice(-400)}`, run, true));
    const lines = r.stdout.split('\n').map((l) => l.split('\t'));
    const one = (key: string) => lines.find((l) => l[0] === key)?.[1];
    if (one('owner') !== '0' || one('sha') !== p.sha256 || one('out') === undefined) return { ran: false, why: `nothing of ${ask} ran as root on ${p.host} from ${dir}` };
    const exit = /^\d+$/.test(one('exit') ?? '') ? Number(one('exit')) : null;
    const host = p.host;
    const evidence = [await this.o.put(Buffer.from(one('out')!, 'base64'), 'run.stdout', run)];
    const err = Buffer.from(one('err') ?? '', 'base64');
    if (err.length) evidence.push(await this.o.put(err, 'run.stderr', run));
    await this.o.append('run.started', {
      run, check: 'root plan', ask, host, needs: { cores: 0, memory_mb: 0, stack_slot: 0, gpus: 0, expected_ms: null }, lane: 'slow',
      argv: ['/bin/sh', `${dir}/script`], cwd: '/', env: {}, grant: {}, deadline_ms: null, withheld: [],
    }, { subject: run, v: 4 });
    await this.o.append('run.finished', {
      run, outcome: exit === 0 ? 'passed' : exit === null ? 'stopped' : 'failed', tests_run: 0, passed: 0, runs: 1, evidence, check: 'root plan',
      assertion: null, expected: null, actual: null, step: null, points_to: null, findings: exit === 0 ? [] : [`the script exited ${exit ?? 'without a status'}`], environment: `host:${host}`, exit,
    }, { subject: run, v: 3 });
    const prints = new Map(lines.filter((l) => l[0] === 'print').map((l) => [l[2]!, l[1] === '-' ? null : l[1]!]));
    for (const s of p.steps) {
      await this.o.append('host.changed', {
        host, change: s.does, changes: s.changes, undo: s.undo, grant: 'root',
        fingerprint: s.changes.filter((c) => prints.has(c)).map((target) => ({ target, sha256: prints.get(target) ?? null })), ask, run,
      }, {});
    }
    this.waiting.get(ask)?.(true);
    return { ran: true, run, exit, evidence };
  }

  /**
   * Lingering for your user on a host, before its first run: on already, turned on as you and recorded as a host change
   * with its undo, or, where the host's policy needs root for it, a root plan the run waits on. Undefined once it's on.
   */
  private lingerOn(host: string): Promise<string | undefined> {
    if (this.o.plant === 'host-skips-lingering') return Promise.resolve(undefined);
    let on = this.lingered.get(host);
    if (!on) {
      on = this.turnOnLinger(host);
      this.lingered.set(host, on);
      void on.then((off) => { if (off) this.lingered.delete(host); });
    }
    return on;
  }
  private async turnOnLinger(host: string): Promise<string | undefined> {
    const r = await this.read(host, [], LINGER);
    const [state, user = '', more = ''] = (r.stdout.trim().split('\n').at(-1) ?? '').split('\t');
    if (r.code !== 0 || !user) return `lingering couldn't be read for your user on ${host}: ${r.stderr.trim().slice(-300)}`;
    const file = `/var/lib/systemd/linger/${user}`;
    if (state === 'on') return undefined;
    if (state === 'enabled') {
      await this.o.append('host.changed', {
        host, change: `loginctl enable-linger ${user}: your services on ${host} outlive your last session and start at boot`, changes: [file],
        undo: `loginctl disable-linger ${user}`, grant: 'you', fingerprint: [{ target: file, sha256: /^[0-9a-f]{64}$/.test(more) ? more : null }], ask: null, run: null,
      }, {});
      return undefined;
    }
    // The host's policy needs root for it: a root plan of the hub's own, its script written as you, that the run waits on.
    const text = `#!/bin/sh\n# DeepBuild's root plan for ${host}: lingering for ${user}, so runs there outlive the last session and start at boot.\nexec loginctl enable-linger ${q(user)}\n`;
    const end = `DEEP_${sha(text).slice(0, 16)}`;
    const wrote = await this.exec(host, [], `umask 077; mkdir -p "$HOME/.deepbuild/plans" && f="$HOME/.deepbuild/plans/linger-${sha(text).slice(0, 16)}.sh" && cat > "$f" <<'${end}'\n${text}${end}\nprintf '%s' "$f"`);
    if (wrote.code !== 0 || !wrote.stdout.startsWith('/')) return `lingering is off for ${user} on ${host}, and its root plan's script couldn't be written there: ${wrote.stderr.trim().slice(-300)}`;
    const { ask } = await this.proposeRoot({
      host, script: wrote.stdout,
      steps: [{ does: `Turn lingering on for ${user} on ${host} (loginctl enable-linger ${user}), so your runs there outlive your last session and start at boot`, changes: [file], undo: `loginctl disable-linger ${user}`, package: null }],
    }, { user, question: `Run this root plan on ${host} as root? It turns lingering on for ${user}, which ${host}'s policy needs root for (${more.trim().slice(0, 200) || 'loginctl enable-linger was refused'}); the first run there waits for it.` }) as { ask: string };
    const yes = await new Promise<boolean>((done) => this.waiting.set(ask, done));
    this.waiting.delete(ask);
    if (!yes) return `lingering is off for ${user} on ${host}: you said no to ${ask}, its root plan`;
    const again = await this.read(host, [], `[ -e "/var/lib/systemd/linger/$(id -un)" ] && echo on || echo off`);
    return again.stdout.trim() === 'on' ? undefined : `lingering is still off for ${user} on ${host} after ${ask} ran`;
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
        const off = await this.lingerOn(spec.host);
        if (off) return { code: null, failed: off };
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

/**
 * `deep host run <ask>`: a root plan you said yes to, run by you in your own terminal. The script where the agent wrote
 * it is checked as you against the hash your yes locked, before sudo; then it goes on a pipe to sudo on the host, which
 * copies it into a folder only root can write, checks it there again and runs that copy. Your terminal is ssh's own, so
 * the password you type at sudo's prompt goes to sudo on the host and passes through nothing of DeepBuild's.
 * `deep host changes <host>`: each change the record holds for a host, with its undo.
 */
export async function hostCommand(args: string[]): Promise<number> {
  const hub = async (method: string, params: Obj): Promise<{ result?: Obj; error?: { remediation: string } }> => {
    try {
      return await call(hubAddress().path, readFileSync(rootOf(installedRoot()).token, 'utf8').trim(), method, params) as { result?: Obj; error?: { remediation: string } };
    } catch (error) {
      return { error: { remediation: `BLOCKED: the hub can't be reached: ${error instanceof Error ? error.message : String(error)}` } };
    }
  };
  const say = (text: string, to: NodeJS.WriteStream = process.stdout) => new Promise<void>((done) => to.write(`${text}\n`, () => done()));
  if (args[0] === 'changes' && args.length === 2) {
    const reply = await hub('host.changes', { host: args[1] });
    if (!reply.result) { await say(reply.error?.remediation ?? 'no reply', process.stderr); return 1; }
    const changes = reply.result.changes as { ts: number; change: string; undo: string | null; grant: string; ask: string | null }[];
    await say(`${args[1]}: ${changes.length} change${changes.length === 1 ? '' : 's'} recorded`);
    for (const c of changes) await say(`  ${new Date(c.ts).toISOString()}  ${c.grant === 'root' ? `as root (${c.ask})` : 'as you'}  ${c.change}\n      undo: ${c.undo ?? "can't undo"}`);
    return 0;
  }
  if (args[0] !== 'run' || args.length !== 2) {
    await say('Usage: deep host run <ask>\n       deep host changes <host>', process.stderr);
    return 2;
  }
  const reply = await hub('host.plan', { ask: args[1] });
  if (!reply.result) { await say(reply.error?.remediation ?? 'no reply', process.stderr); return 1; }
  const p = reply.result as { ask: string; host: string; script: string; sha256: string; run: string; paths: string[] };
  const ssh = (extra: string[], command: string, stdio: StdioOptions) => spawn('ssh', ['-F', join(homedir(), '.ssh', 'config'), ...extra, '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '--', p.host, command], { stdio });
  // The planted wrong program runs the script where the agent wrote it, with no copy and no check.
  const planted = activePlant() === 'root-plan-runs-agent-path';
  if (!planted) {
    const check = ssh(['-o', 'BatchMode=yes'], `sha256sum -- ${q(p.script)}`, ['ignore', 'pipe', 'pipe']);
    let out = '';
    check.stdout!.setEncoding('utf8').on('data', (d: string) => (out += d));
    check.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
    await new Promise((done) => check.on('close', done));
    const found = /^[0-9a-f]{64}(?=\s)/.exec(out)?.[0];
    if (found !== p.sha256) {
      await say(`deep: refused ${p.ask} before anything ran as root on ${p.host}: the plan you approved locked sha256 ${p.sha256}, and ${p.script} there ${found ? `has sha256 ${found}` : `couldn't be hashed (${out.trim().slice(-300)})`} now. Nothing ran; ask for a new plan.`, process.stderr);
      return 1;
    }
  }
  await say(`deep: running ${p.ask} on ${p.host} as root. Type your sudo password only at sudo's own prompt.`);
  const remote = planted ? `sudo sh ${q(p.script)}`
    : `cat -- ${q(p.script)} | sudo -p ${q(`[sudo] password for %p on ${p.host}: `)} sh -c ${q(ROOT_RUN)} sh ${[p.sha256, p.run.slice(4), ...p.paths].map(q).join(' ')}`;
  const code = await new Promise<number>((done) => ssh(['-tt'], remote, 'inherit').on('close', (c) => done(c ?? 1)));
  const ran = await hub('host.ran', { ask: p.ask, run: p.run });
  if (!ran.result) await say(ran.error?.remediation ?? 'no reply', process.stderr);
  else if (ran.result.ran) await say(`deep: ${p.run} ran ${p.ask} on ${p.host} as root and exited ${String(ran.result.exit)}; its output is kept as evidence ${(ran.result.evidence as string[]).map((e) => e.slice(0, 12)).join(', ')}.`);
  else await say(`deep: ${String(ran.result.why)} (ssh ended ${code}).`, process.stderr);
  return code;
}
