// Sessions DeepBuild starts without your Send (#1330): only under a run you approved, each in its own worktree from the
// default branch's head, inside its agent's own sandbox wherever its facts name one. `deep start approve` raises one
// authority ask bound to the run's set, agents, homes, modes, how many at once, plan share and end; it counts once you
// answer it yes on the trusted path. `deep start` is the one start (`startSession`, which the app's Send and paseo's
// route call later, #146 #576): refused with no approval, past its end or outside a bound, from an agent's process
// tree, an MCP call or a plug-in, whatever it claims. The agent is the unmodified CLI in a terminal the hub hosts,
// never typed into, its permission mode set at launch; with no first event in 60 s it ends as never started.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import type { JsonObject } from '@deepbuild/adapters';
import { isRecord as isObj, canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { Asks } from '@deepbuild/asks';
import type { AppKey, SessionCredentials } from './forge-port.js';
import { TERMINAL_PROTOCOL } from '@deepbuild/extension-host';
import { alive, HELPER, type Supervisor } from '@deepbuild/supervisor';
import { parents } from './children.js';
import { registry } from './hookmap.js';
import { refusal, Refused, ulid, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const DAY = 86_400_000;
/** How long a started agent has to write its first event before it ends as never started. */
const FIRST_EVENT_MS = 60_000;
/** The folders no command in a started session may read: your keys and the sign-ins other tools keep. */
const CREDENTIALS = ['.ssh', '.aws', '.gnupg', '.config/gh', '.netrc', '.docker', '.kube', 'Library/Keychains', '.codex/auth.json', '.claude/.credentials.json'];
/** The agents a start can name, and the name their facts and binary go by. */
const AGENTS: Record<string, string> = { 'claude-code': 'claude', codex: 'codex' };
const WALLS = ['writes', 'credentials', 'network'] as const;
type Walls = Record<(typeof WALLS)[number], boolean>;
interface Sandbox { sandboxed: boolean; walls: Walls }
const NONE: Sandbox = { sandboxed: false, walls: { writes: false, credentials: false, network: false } };

/** A run you approved, as `start.approval` records it, and the ask whose yes makes it count. */
interface Approval { ask: string; at: number; repo: string; issues: number[]; agents: string[]; homes: Record<string, string>; modes: Record<string, string>; at_once: number; plan_share: number; until: number | null; hosts: string[] }
/** A start the hub made: its approval, its agent's process, the session its first hook named, and its sandbox. */
interface Started { run: string; ask: string; agent: string; pid?: number; dir?: string; session?: string; sandbox: Sandbox; ended: boolean; timer?: NodeJS.Timeout; worktree?: string; token?: string; model?: string; adopted?: number }
/** A session's own forge credential while it lives, and the login GitHub records its pushes as. */
interface Credential { token: string; login: string | null }
type StartResult = { status: 'started'; run: string; worktree: string; branch: string; agent: string; version: string; mode: string; sandbox: Sandbox } | { status: 'refused'; reason: string; bound: string };
/** Who asks for a start: you in your terminal, by the process the CLI names; the core reads the rest from the connection. */
interface Caller { role: string; peer?: { pid: number; start: string }; session?: string | null }

interface StartsOptions {
  root: string;
  /** The hub's socket: a started session's hooks and deep commands reach it from inside the sandbox. */
  socket: string;
  /** The hub's lock file, which the terminal's host checks a connection against; nothing connects to type. */
  lock: string;
  loginPath: () => string;
  now: () => number;
  plant: Plant | undefined;
  supervisor: () => Supervisor;
  asks: () => Asks;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string; v?: number }): Promise<void>;
  /** The agent session whose process is above the caller's, or undefined: the peer check. */
  agentAbove(peer: Caller['peer']): Promise<string | undefined>;
  /** The most used live plan window of the account an agent runs on in a home, in percent. */
  windowUsed(agent: string, home: string): number | undefined;
  /** The forge's REST root, the agents' app a session's own credential comes from, and the gate's token (#1325). */
  forge: string;
  credentials: SessionCredentials;
  agentsApp(): AppKey | undefined;
  gateToken(repo: string): Promise<string | undefined>;
}
/** The variables your own forge login reaches a process by: it stays the hub's, and never reaches a session (#1325). */
const LOGINS = ['GH_TOKEN', 'GITHUB_TOKEN'];

const exec = (file: string, args: string[], o: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<string> =>
  new Promise((done, fail) => execFile(file, args, { encoding: 'utf8', timeout: o.timeout ?? 30_000, ...o }, (error, stdout, stderr) => (error ? fail(Error(`${file} ${args.join(' ')}: ${String(stderr || error.message).trim()}`)) : done(stdout))));
const tilde = (p: string): string => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

export class Starts {
  private readonly started = new Map<string, Started>();
  /** The logins GitHub records the agents' app's pushes as. */
  private readonly agentLogins = new Set<string>();
  constructor(private readonly o: StartsOptions) {}

  /** What the record holds of earlier starts: each session's run and sandbox, and which runs still hold a slot. */
  async open(): Promise<void> {
    const rows = (await this.o.raw(`SELECT kind, data FROM events WHERE kind IN ('start.started', 'start.session', 'session.never_started') ORDER BY log_pos`)) as { kind: string; data: string }[];
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      const run = String(d.run);
      if (row.kind === 'start.started') this.started.set(run, { run, ask: String(d.ask), agent: String(d.agent), sandbox: d.sandbox as Sandbox, ended: true, worktree: String(d.worktree) });
      const s = this.started.get(run);
      if (!s) continue;
      if (row.kind === 'start.session') s.session = String(d.session);
      if (row.kind === 'session.never_started') delete s.session;
    }
    // A run the supervisor adopted still runs: it holds its slot until it ends, and its credential ends with it. One
    // that ended while the hub was down has its credential revoked now.
    for (const s of this.started.values()) {
      s.dir = join(this.o.root, 'starts', letters(s.run));
      const kept = this.keptCredential(s);
      if (kept) { s.token = kept.token; if (kept.login) this.agentLogins.add(kept.login); }
      const status = await this.o.supervisor().status(s.run).catch(() => undefined);
      // This supervisor has no exit to wait for on a run the last hub started: it lives while the process the
      // supervisor tracked for it does (#1332), read each time its liveness is asked.
      const [tracked] = status?.state === 'running' ? (await this.o.raw(`SELECT json_extract(data, '$.pid') AS pid FROM events WHERE kind = 'process.tracked' AND json_extract(data, '$.run') = ? ORDER BY log_pos LIMIT 1`, [s.run])) as { pid: number }[] : [];
      if (tracked && alive(tracked.pid)) { s.ended = false; s.adopted = tracked.pid; }
      else this.endCredential(s);
    }
  }
  close(): void {
    for (const s of this.started.values()) clearTimeout(s.timer);
  }

  /** What a session's row shows of its start: its run and what its agent's sandbox holds. */
  rowOf(session: string): { run: string; sandbox: Sandbox } | undefined {
    for (const s of this.started.values()) if (s.session === session) return { run: s.run, sandbox: s.sandbox };
    return undefined;
  }
  /** A work run's approval (#1332): its bounds once you answered its ask yes, else undefined. */
  async approvalOf(ask: string): Promise<Approval | undefined> {
    const [row] = (await this.o.raw(`SELECT data FROM events WHERE kind = 'start.approval' AND subject = ? LIMIT 1`, [ask])) as { data: string }[];
    return row ? (await this.approvals((JSON.parse(row.data) as Approval).repo)).find((a) => a.ask === ask) : undefined;
  }
  /** Whether a session is one a work run started (#1332): `deep work` raised the approval its start ran under. */
  async inWorkRun(session: string): Promise<boolean> {
    const s = this.runOf(session);
    if (!s) return false;
    const [row] = (await this.o.raw(`SELECT 1 AS x FROM events WHERE kind = 'work.run' AND subject = ? LIMIT 1`, [s.ask])) as unknown[];
    return row !== undefined;
  }
  /** The model a started run's agent reported, while this hub has heard it. */
  modelOf(run: string): string | undefined {
    return this.started.get(run)?.model;
  }
  /** Whether a started run's agent still runs. */
  live(run: string): boolean {
    const s = this.started.get(run);
    if (s?.adopted !== undefined && !s.ended && !alive(s.adopted)) { s.ended = true; this.endCredential(s); }
    return s !== undefined && !s.ended;
  }
  /** The session a started run's first hook named. */
  sessionOfRun(run: string): string | undefined {
    return this.started.get(run)?.session;
  }
  /** A started run's worktree, branch and base, as `start.started` recorded them: where a next attempt goes on. */
  async treeOf(run: string): Promise<{ path: string; branch: string; base: string }> {
    const [row] = (await this.o.raw(`SELECT data FROM events WHERE kind = 'start.started' AND subject = ? LIMIT 1`, [run])) as { data: string }[];
    const d = JSON.parse(row!.data) as { worktree: string; branch: string; base: string };
    return { path: d.worktree, branch: d.branch, base: d.base };
  }
  /** How a started run ended: whether it never wrote a first event. */
  async endOf(run: string): Promise<{ never: boolean; session: string | null }> {
    const [never] = (await this.o.raw(`SELECT 1 AS x FROM events WHERE kind = 'session.never_started' AND subject = ? LIMIT 1`, [run])) as unknown[];
    return { never: never !== undefined, session: this.started.get(run)?.session ?? null };
  }
  /** The started run a session belongs to, once its first hook linked it. */
  runOf(session: string): Started | undefined {
    for (const s of this.started.values()) if (s.session === session) return s;
    return undefined;
  }

  // ---- The approval.

  /** `deep start approve`: one authority ask bound to the run's bounds, and its record; nothing counts until you answer it. */
  async approve(params: Obj, caller: Caller): Promise<{ ask: string }> {
    if (caller.role !== 'cli') throw new Refused(refusal('role', '/method', 'Ask for a run from your own terminal, with deep start approve.', 'start.approve'));
    const agent = await this.o.agentAbove(caller.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing was asked: this deep command runs inside agent session ${agent}'s process tree, and no session asks for a run of its own. Ask from your own terminal.`, 'start.approve'));
    const { bounds, sandbox, versions } = await this.drafted(params);
    const { repo, issues, agents, homes, modes, at_once, plan_share, until, hosts } = bounds;
    const now = this.o.now();
    const key = sha256Hex(canonicalize({ start: bounds } as unknown as JsonValue));
    const held = (a: string): string => {
      const s = sandbox[a]!;
      const named = WALLS.filter((w) => s.walls[w]);
      return !s.sandboxed ? `${a}${versions[a] ? ` ${versions[a]}` : ''} has no sandbox of its own here, so it starts with none`
        : `${a} ${versions[a]}'s own sandbox holds ${named.join(', ')}${named.length < 3 ? `; not held: ${WALLS.filter((w) => !s.walls[w]).join(', ')}` : ''}`;
    };
    const modeWords = (a: string): string => {
      const started = this.launchOf(a)!;
      const m = modes[a];
      if (!m) return `${a} in ${String(started.asks)}, its mode that asks before acting`;
      return (started.skipping as string[]).includes(m) ? `${a} may run in ${m}, which skips permission prompts` : `${a} may run in ${m}, or ${String(started.asks)}`;
    };
    const question = [
      `Let DeepBuild start sessions without your Send on ${repo}, for issue${issues.length === 1 ? '' : 's'} ${issues.join(', ')}?`,
      `${agents.map((a) => `${modeWords(a)}, in ${homes[a] ?? String(this.launchOf(a)!.defaultHome)}`).join('; ')}.`,
      `At most ${String(at_once)} at once, up to ${plan_share}% of each plan window${until !== null ? `, until ${new Date(until as number).toISOString()}` : ', with no end'}.`,
      `Each in its own worktree from the default branch; commands reach ${hosts.length ? hosts.join(', ') : 'no host'} beside the agent's own API. ${agents.map(held).join('. ')}.`,
      // A work run (#1332) lands what it works: each session's push and PR are part of what you approve.
      ...(params.lands === true ? ['Each session pushes its own branch and opens a pull request for its issue, which lands only on its own PASS.'] : []),
      // A workspace's run (#1347) has no forge: each task's change finishes on the workspace's own main.
      ...(params.lands === 'workspace' ? ["Each task's change finishes on the workspace's own main, only on its own PASS; no forge is read or written."] : []),
    ].join(' ');
    const ask = await this.o.asks().raise({ writer: 'core', actor: 'you', scope: 'you' }, 'start.approve', {
      kind: 'authority', question: question.slice(0, 2000),
      options: [{ id: 'allow', label: 'Approve this run', decision: 'allow' }, { id: 'deny', label: "Don't", decision: 'deny' }],
      recommended: null, deadline: now + DAY, fallback: 'you', default: 'deny', provisional: false, owner: 'you',
      key, pinned_to: { kind: 'evidence', ref: key },
    }, {
      steps: [{ does: `Start ${agents.join(' or ')} sessions on ${basename(repo)} for issue${issues.length === 1 ? '' : 's'} ${issues.join(', ')}, each in its own worktree`, changes: [`worktrees of ${repo}`, `plan usage, up to ${plan_share}%`], undo: null, public: false, cost: 0 }],
      diff: key,
    });
    await this.o.appendCore('start.approval', { ask, ...bounds, sandbox }, { subject: ask });
    return { ask };
  }

  /** A run's bounds from its params, refused where one is out of range, with what each agent's own sandbox holds at the version installed now. */
  private async drafted(params: Obj): Promise<{ bounds: { repo: string; issues: number[]; agents: string[]; homes: Record<string, string>; modes: Record<string, string>; at_once: number; plan_share: number; until: number | null; hosts: string[] }; sandbox: Record<string, Sandbox>; versions: Record<string, string> }> {
    const repo = await this.repoOf(params.repo);
    const list = (v: unknown, at: string): string[] => {
      if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'string' && x)) throw new Refused(refusal('type', at, `Give ${at.slice(8)} as a list of names.`, v));
      return v as string[];
    };
    const map = (v: unknown, at: string): Record<string, string> => {
      if (v === undefined) return {};
      if (!isObj(v) || !Object.values(v).every((x) => typeof x === 'string' && x)) throw new Refused(refusal('type', at, `Give ${at.slice(8)} as agent=value pairs.`, v));
      return v as Record<string, string>;
    };
    const issues = Array.isArray(params.issues) && params.issues.length && params.issues.every((n) => Number.isSafeInteger(n) && (n as number) > 0) ? params.issues as number[] : undefined;
    if (!issues) throw new Refused(refusal('type', '/params/issues', 'Name the set: one or more issue numbers.', params.issues));
    const agents = list(params.agents, '/params/agents');
    for (const a of agents) if (!this.launchOf(a)) throw new Refused(refusal('enum', '/params/agents', `${a} can't be started here: name ${Object.keys(AGENTS).join(' or ')}.`, a));
    const homes = map(params.homes, '/params/homes');
    const modes = map(params.modes, '/params/modes');
    for (const [a, m] of Object.entries(modes)) if (!isObj(this.launchOf(a)?.modes) || !(m in (this.launchOf(a)!.modes as Obj))) throw new Refused(refusal('enum', '/params/modes', `${a} has no mode ${m}: its facts name ${Object.keys((this.launchOf(a)?.modes ?? {}) as Obj).join(', ')}.`, m));
    const at_once = params.at_once;
    if (!Number.isSafeInteger(at_once) || (at_once as number) < 1 || (at_once as number) > 1000) throw new Refused(refusal('type', '/params/at_once', 'Say how many may run at once: 1 to 1000.', at_once));
    const plan_share = params.plan_share;
    if (typeof plan_share !== 'number' || !(plan_share >= 0 && plan_share <= 100)) throw new Refused(refusal('type', '/params/plan_share', 'Give the plan share as a percent, 0 to 100.', plan_share));
    const until = params.until === undefined || params.until === null ? null : params.until;
    if (until !== null && (!Number.isSafeInteger(until) || (until as number) <= this.o.now())) throw new Refused(refusal('type', '/params/until', 'Give its end as a time still to come.', until));
    const hosts = params.hosts === undefined ? [] : list(params.hosts, '/params/hosts');
    const bounds = { repo, issues, agents, homes, modes, at_once: at_once as number, plan_share, until: until as number | null, hosts };
    // What each agent's own sandbox holds at the version installed now, so the ask shows it.
    const sandbox: Record<string, Sandbox> = {};
    const versions: Record<string, string> = {};
    for (const a of agents) {
      const v = await this.versionOf(a).catch(() => undefined);
      if (v) versions[a] = v.version;
      sandbox[a] = v ? this.sandboxOf(a, v.version).sandbox : NONE;
    }
    return { bounds, sandbox, versions };
  }
  /** A run your yes on another card already approved (#1342's brief): its bounds recorded under that card's ask, with no ask of its own. */
  async approved(ask: string, params: Obj): Promise<void> {
    const { bounds, sandbox } = await this.drafted(params);
    await this.o.appendCore('start.approval', { ask, ...bounds, sandbox }, { subject: ask });
  }

  /** The approvals on the record for a repo, newest first: each `start.approval` whose ask you answered yes on the trusted path. */
  private async approvals(repo: string): Promise<Approval[]> {
    const rows = (await this.o.raw(`SELECT a.ts AS ts, a.data AS data, (SELECT y.data FROM events y WHERE y.kind = 'ask.answered' AND y.subject = a.subject ORDER BY y.log_pos LIMIT 1) AS answer
      FROM events a WHERE a.kind = 'start.approval' ORDER BY a.log_pos DESC`)) as { ts: number; data: string; answer: string | null }[];
    return rows.flatMap((row) => {
      const d = JSON.parse(row.data) as Approval;
      const answer = row.answer ? JSON.parse(row.answer) as Obj : undefined;
      // Only your yes counts: a token the trusted path minted, verified, never text typed in a session.
      const yes = answer?.decision === 'allow' && typeof answer.token === 'string' && answer.verified !== false && answer.via !== 'session';
      return yes && d.repo === repo ? [{ ...d, at: row.ts }] : [];
    });
  }

  // ---- The start.

  /** A refusal, recorded with its caller and bound. */
  private async refused(bound: string, reason: string, caller: string, about: { repo?: string | null; issue?: number | null; agent?: string | null }): Promise<StartResult> {
    await this.o.appendCore('start.refused', { caller, bound, reason: reason.slice(0, 8000), repo: about.repo ?? null, issue: about.issue ?? null, agent: about.agent ?? null });
    return { status: 'refused', reason, bound };
  }

  /** An MCP call's start, refused whatever it claims: deep_start is never served. */
  async refuseMcp(session: string | null | undefined): Promise<never> {
    const caller = `an MCP call${session ? ` from agent session ${session}` : ''}`;
    const reason = `deep_start is refused: ${caller} can't start a session, whatever it claims. Only deep start, run in your own terminal under a run you approved, starts one.`;
    await this.refused('caller', reason, caller, {});
    throw new Refused(refusal('role', '/params/tool', reason, 'deep_start'));
  }

  /**
   * `deep start`, deep.startSession: refused with no approval, past its end or outside a bound, and from an agent's
   * process tree; else a worktree from the default branch's head and the agent in a terminal the hub hosts.
   */
  async startSession(params: Obj, caller: Caller): Promise<StartResult> {
    const issue = Number.isSafeInteger(params.issue) && (params.issue as number) > 0 ? params.issue as number : undefined;
    const agent = typeof params.agent === 'string' ? params.agent : undefined;
    const prompt = typeof params.prompt === 'string' && params.prompt.trim() ? params.prompt : undefined;
    const asked = typeof params.mode === 'string' && params.mode ? params.mode : undefined;
    if (!issue || !agent || !prompt) throw new Refused(refusal('required', '/params', 'Name the repo, the issue, the agent and your words for its prompt.', params));
    if (caller.role !== 'cli') return this.refused('caller', `A ${caller.role} connection can't start a session; only deep start in your own terminal does.`, caller.role, { issue, agent });
    if (!caller.peer) return this.refused('caller', 'The start names no process for the peer check, so nothing started; run deep start itself.', 'a call naming no process', { issue, agent });
    const above = await this.o.agentAbove(caller.peer);
    if (above) {
      return this.refused('caller', `deep start runs inside agent session ${above}'s process tree, so it acts as that session, and no session starts another, whatever it claims. Start it from your own terminal.`, `agent session ${above}`, { issue, agent });
    }
    return this.launch({ repo: await this.repoOf(params.repo), issue, agent, prompt, ...(asked ? { mode: asked } : {}) }, 'you');
  }

  /**
   * A start a work run makes (#1332): under the one approval it was raised as, by the hub and never a session, on the
   * same bounds as `deep start`. A next attempt goes on in its issue's earlier worktree and branch, uncommitted files
   * kept; a first one gets a worktree of its own.
   */
  runStart(r: { ask: string; repo: string; issue: number; agent: string; prompt: string; worktree?: { path: string; branch: string; base: string } }): Promise<StartResult> {
    return this.launch(r, `the work run ${r.ask}`);
  }

  private async launch(r: { ask?: string; repo: string; issue: number; agent: string; prompt: string; mode?: string; worktree?: { path: string; branch: string; base: string } }, caller: string): Promise<StartResult> {
    const { repo, issue, agent, prompt } = r;
    const about = { repo, issue, agent };
    const started = this.launchOf(agent);
    if (!started) return this.refused('agent', `${agent} can't be started here: name ${Object.keys(AGENTS).join(' or ')}.`, caller, about);
    const mode = r.mode ?? String(started.asks);
    // The planted wrong program starts with no approval on the record.
    const approvals = this.o.plant === 'starts-without-approval'
      ? [{ ask: 'ask:0', at: 0, repo, issues: [issue], agents: [agent], homes: {}, modes: { [agent]: mode }, at_once: 1000, plan_share: 100, until: null, hosts: [] }]
      : (await this.approvals(repo)).filter((a) => !r.ask || a.ask === r.ask);
    if (!approvals.length) return this.refused('approval', `No run you approved covers ${repo}, so issue ${issue} doesn't start. Ask for one with deep start approve and answer it yes.`, caller, about);
    let approval: Approval | undefined;
    let outside: { bound: string; reason: string } | undefined;
    for (const a of approvals) {
      const why = this.outside(a, issue, agent, mode, String(started.asks));
      if (!why) { approval = a; break; }
      outside ??= why;
    }
    if (!approval) return this.refused(outside!.bound, outside!.reason, caller, about);
    const home = tilde(approval.homes[agent] ?? String(started.defaultHome));
    const used = this.o.windowUsed(agent, home);
    if (used !== undefined && used >= approval.plan_share) return this.refused('plan_share', `${agent}'s plan window in ${home} is ${used}% used, at the ${approval.plan_share}% plan share ${approval.ask} allows.`, caller, about);
    const found = await this.versionOf(agent).catch((error: Error) => error);
    if (found instanceof Error) return this.refused('version', `${agent} can't start: ${found.message}`, caller, about);
    const facts = this.factsOf(agent)!;
    if (!(facts.versions as string[]).includes(found.version)) {
      return this.refused('version', `${agent} ${found.version} is past the versions its facts cover (${(facts.versions as string[]).join(', ')}), so its hooks would be watch-only; it doesn't start.`, caller, about);
    }
    const run = `run:${ulid(this.o.now())}`;
    const tree = r.worktree ?? await this.worktree(repo, issue, run);
    const { sandbox, entry } = this.o.plant === 'starts-without-sandbox' ? { sandbox: NONE, entry: undefined } : this.sandboxOf(agent, found.version);
    const argv = this.argvOf(started, entry, mode, approval, prompt, tree.path);
    const env = this.envOf(started, home);
    const forge = await this.credential(repo, env);
    this.trust(started, home, tree.path);
    const dir = join(this.o.root, 'starts', letters(run));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Kept where a restarted hub finds it to revoke, under a folder the session's sandbox can't read.
    if (forge) writeFileSync(join(dir, 'credential'), JSON.stringify(forge), { mode: 0o600 });
    const s: Started = { run, ask: approval.ask, agent, sandbox, ended: false, dir, worktree: tree.path, ...(forge ? { token: forge.token } : {}) };
    this.started.set(run, s);
    const launched = await this.o.supervisor().start({
      run, argv: [HELPER, 'pty', dir, '120', '40', String(TERMINAL_PROTOCOL), this.o.lock, '-', found.path, ...argv],
      cwd: tree.path, env, inherit: false, own_sandbox: true, keep: true, input: Buffer.from(`${ulid(this.o.now())}\n`),
    }).catch((error: Error) => error);
    if (launched instanceof Error || launched.status !== 'started') {
      s.ended = true;
      this.endCredential(s);
      return this.refused('version', `${agent} didn't start: ${launched instanceof Error ? launched.message : `held on ${launched.kind}`}.`, caller, about);
    }
    s.pid = launched.pid;
    // The session's own credential ends with it: revoked as soon as its agent's process is gone.
    void this.o.supervisor().wait(run).then(() => { s.ended = true; clearTimeout(s.timer); this.endCredential(s); }, () => { s.ended = true; this.endCredential(s); });
    await this.o.appendCore('start.started', { run, ask: approval.ask, repo, issue, agent, version: found.version, home, mode, worktree: tree.path, branch: tree.branch, base: tree.base, sandbox }, { subject: run });
    s.timer = setTimeout(() => void this.neverStarted(s).catch(() => undefined), FIRST_EVENT_MS);
    return { status: 'started', run, worktree: tree.path, branch: tree.branch, agent, version: found.version, mode, sandbox };
  }

  /** The first bound of an approval a start falls outside, or undefined when it fits. */
  private outside(a: Approval, issue: number, agent: string, mode: string, asks: string): { bound: string; reason: string } | undefined {
    if (a.until !== null && this.o.now() >= a.until) return { bound: 'end', reason: `The run ${a.ask} approved ended at ${new Date(a.until).toISOString()}, so issue ${issue} doesn't start.` };
    if (!a.issues.includes(issue)) return { bound: 'set', reason: `Issue ${issue} is outside the set ${a.ask} approved: ${a.issues.join(', ')}.` };
    if (!a.agents.includes(agent)) return { bound: 'agent', reason: `${agent} is outside the agents ${a.ask} approved: ${a.agents.join(', ')}.` };
    if (mode !== asks && mode !== a.modes[agent]) return { bound: 'mode', reason: `The mode ${mode} is one ${a.ask} doesn't name for ${agent}: it allows ${[asks, a.modes[agent]].filter(Boolean).join(' or ')}.` };
    const running = [...this.started.values()].filter((s) => s.ask === a.ask && !s.ended).length;
    if (running >= a.at_once) return { bound: 'at_once', reason: `${running} of the ${a.at_once} sessions ${a.ask} lets run at once ${running === 1 ? 'is' : 'are'} running.` };
    return undefined;
  }

  /** A started agent with no first event in 60 s: recorded as never started, its process stopped and its slot freed. */
  private async neverStarted(s: Started): Promise<void> {
    if (s.session || s.ended) return;
    await this.o.appendCore('session.never_started', { run: s.run, after_ms: FIRST_EVENT_MS }, { subject: s.run });
    await this.end(s);
  }
  /** A work run's session whose change landed (#1332): its agent stopped and its slot freed. */
  async stop(run: string): Promise<void> {
    const s = this.started.get(run);
    if (s && !s.ended) await this.end(s);
  }
  private async end(s: Started): Promise<void> {
    s.ended = true;
    const sup = this.o.supervisor();
    // The agent first, by the PID its terminal's host wrote: it runs in a session of its own under the host.
    let agent = NaN;
    try { agent = s.dir ? Number(readFileSync(join(s.dir, 'pid'), 'utf8').trim()) : NaN; } catch { /* none written */ }
    if (Number.isSafeInteger(agent) && agent > 1) try { process.kill(agent, 'SIGTERM'); } catch { /* gone */ }
    await sup.signal(s.run, 'SIGTERM').catch(() => undefined);
    await sup.cleanup(s.run).catch(() => undefined);
  }

  /**
   * A hook's process, read when a session's first hook arrives: the started run whose terminal its agent runs under,
   * now that session's; the core records `start.session` before the hook's own events.
   */
  async sessionOf(session: string, pid: number, agent: string, model?: string): Promise<string | undefined> {
    // The model a started session's agent reports in its hooks (#1332): its attempt records it.
    const linked = model ? this.runOf(session) : undefined;
    if (linked && model) linked.model = model;
    const waiting = [...this.started.values()].filter((s) => !s.ended && !s.session && s.pid !== undefined);
    if (!waiting.length || this.runOf(session)) return undefined;
    const up = await parents();
    const seen = new Set<number>();
    for (let p: number | undefined = pid; p !== undefined && p > 1 && !seen.has(p); p = up.get(p)) {
      seen.add(p);
      const s = waiting.find((w) => w.pid === p);
      if (!s) continue;
      s.session = session;
      if (model) s.model = model;
      clearTimeout(s.timer);
      await this.o.appendCore('start.session', { run: s.run, session, agent }, { subject: s.run });
      return s.run;
    }
    return undefined;
  }

  /** What a started session's own sandbox refused a shell call, as its output says: each recorded once per call and target. */
  async refusals(session: string, call: string | undefined, printed: string): Promise<void> {
    const s = this.runOf(session);
    if (!s) return;
    await this.forgeRefusals(s, session, call, printed);
    if (!s.sandbox.sandboxed) return;
    const seen = new Set<string>();
    for (const { operation, target } of refusedIn(printed)) {
      if (seen.has(`${operation} ${target}`)) continue;
      seen.add(`${operation} ${target}`);
      await this.o.appendCore('sandbox.refused', { run: s.run, session, operation, target: target.slice(0, 8000), call: call ?? null }, { subject: s.run });
    }
  }

  /**
   * What the forge refused a started session's credential, as the call's output says (#1325): a REST refusal's
   * `documentation_url` naming the endpoint, and a push a ruleset refused (GH013). Its git and curl are
   * a command's children, which no hook sees, so the output is where the record learns of them.
   */
  private async forgeRefusals(s: Started, session: string, call: string | undefined, printed: string): Promise<void> {
    const found = forgeRefusedIn(printed);
    if (!found.length) return;
    const main = found.some((f) => f.ref?.startsWith('refs/heads/')) ? await this.defaultBranch(s) : undefined;
    const seen = new Set<string>();
    for (const f of found) {
      const action = f.action ?? (f.ref === `refs/heads/${main}` ? 'push-default-branch' : f.ref!.startsWith('refs/tags/deep/approved/') ? 'push-approved-tag' : undefined);
      if (!action || seen.has(`${action} ${f.target}`)) continue;
      seen.add(`${action} ${f.target}`);
      await this.o.appendCore('forge.refused', { run: s.run, session, action, target: f.target.slice(0, 8000), call: call ?? null }, { subject: s.run });
    }
  }
  /** The default branch a started session's worktree came from, as its repo's origin names it. */
  private async defaultBranch(s: Started): Promise<string | undefined> {
    if (!s.worktree) return undefined;
    const head = await exec('git', ['-C', s.worktree, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '');
    return head.trim().replace(/^origin\//, '') || undefined;
  }

  // ---- The session's own forge credential (#1325).

  /**
   * In place of your login, which the environment loses here, a token of the agents' app for this repo alone, as
   * GH_TOKEN: it can push branches, open PRs and comment, never post a status. None when your settings name no agents'
   * app or the repo's origin isn't on GitHub; a mint the forge refuses starts the session with none, said on stderr.
   */
  private async credential(repo: string, env: Record<string, string>): Promise<Credential | undefined> {
    const app = this.o.agentsApp();
    const origin = await exec('git', ['-C', repo, 'remote', 'get-url', 'origin']).catch(() => '');
    const slug = this.o.credentials.repoOf(origin.trim());
    // The planted wrong program: the gate's own token in the session's environment.
    if (this.o.plant === 'passes-gate-credential' && slug) { const gate = await this.o.gateToken(slug).catch(() => undefined); if (gate) env.DEEP_GATE_TOKEN = gate; }
    if (!app || !slug) return undefined;
    const made = await this.o.credentials.sessionToken(this.o.forge, app, slug, this.o.plant === 'agent-credential-posts-statuses').catch((error: Error) => error);
    if (made instanceof Error) { process.stderr.write(`deep hub: no credential of the agents' app for ${slug}: ${made.message}\n`); return undefined; }
    env.GH_TOKEN = made.token;
    if (made.login) this.agentLogins.add(made.login);
    return { token: made.token, login: made.login };
  }
  private keptCredential(s: Started): Credential | undefined {
    try { return JSON.parse(readFileSync(join(s.dir!, 'credential'), 'utf8')) as Credential; } catch { return undefined; }
  }
  /** A session's credential revoked: the forge takes it no more. A revoke that fails leaves it to expire within the hour, said on stderr. */
  private endCredential(s: Started): void {
    const token = s.token;
    if (!token) return;
    delete s.token;
    void this.o.credentials.revoke(this.o.forge, token).then(() => { if (s.dir) rmSync(join(s.dir, 'credential'), { force: true }); },
      (error: Error) => process.stderr.write(`deep hub: ${s.run}'s forge credential wasn't revoked (${error.message}); it expires within the hour\n`));
  }

  /**
   * A push GitHub recorded as the agents' app's (#1325): the session whose commit it carried, or the one live started
   * session whose worktree holds it, and the person who approved that session's run. Its author and committer fields
   * are never read: the record of who made the commit and of the run say who did it.
   */
  async pushed(change: { ref: string; commit: string; pusher: string | null }): Promise<void> {
    if (!change.pusher || !this.agentLogins.has(change.pusher)) return;
    const rows = (await this.o.raw(`SELECT session_id FROM commits WHERE sha = ? AND session_id IS NOT NULL`, [change.commit])) as { session_id: string }[];
    let s = rows.map((r) => this.runOf(r.session_id)).find((x) => x !== undefined);
    if (!s) {
      const holding: Started[] = [];
      for (const x of this.started.values()) {
        if (x.ended || !x.session || !x.worktree) continue;
        if (await exec('git', ['-C', x.worktree, 'cat-file', '-e', `${change.commit}^{commit}`]).then(() => true, () => false)) holding.push(x);
      }
      if (holding.length === 1) s = holding[0];
    }
    const [answer] = s ? (await this.o.raw(`SELECT actor FROM events WHERE kind = 'ask.answered' AND subject = ? ORDER BY log_pos LIMIT 1`, [s.ask])) as { actor: string }[] : [];
    await this.o.appendCore('session.pushed', {
      ref: change.ref, commit: change.commit, pusher: change.pusher, session: s?.session ?? null, run: s?.run ?? null, approval: s?.ask ?? null, approved_by: answer?.actor ?? null,
    }, s ? { subject: s.run } : {});
  }

  // ---- The parts of a start.

  private factsOf(agent: string): JsonObject | undefined {
    const name = AGENTS[agent];
    if (!name) return undefined;
    try { return registry().get(name).facts as JsonObject; } catch { return undefined; }
  }
  /** The agent's `launch.started` facts, or undefined for one no start can run. */
  private launchOf(agent: string): Obj | undefined {
    const launch = this.factsOf(agent)?.launch;
    return isObj(launch) && isObj(launch.started) ? launch.started : undefined;
  }
  /** What the agent's own sandbox holds at a version, by its facts, and the facts' entry; none for a version not listed. */
  private sandboxOf(agent: string, version: string): { sandbox: Sandbox; entry: Obj | undefined } {
    const sb = this.factsOf(agent)?.sandbox;
    const entry = isObj(sb) && isObj(sb.versions) && isObj(sb.versions[version]) ? sb.versions[version] as Obj : undefined;
    if (!entry) return { sandbox: NONE, entry: undefined };
    const walls = isObj(entry.walls) ? entry.walls : {};
    return { sandbox: { sandboxed: true, walls: { writes: 'writes' in walls, credentials: 'credentials' in walls, network: 'network' in walls } }, entry };
  }
  /** The repo's checkout, a real path that git knows. */
  private async repoOf(given: unknown): Promise<string> {
    if (typeof given !== 'string' || !isAbsolute(given) || !existsSync(given)) throw new Refused(refusal('type', '/params/repo', "Name the repo's checkout as an absolute path.", given));
    const top = (await exec('git', ['-C', given, 'rev-parse', '--show-toplevel']).catch(() => '')).trim();
    if (!top) throw new Refused(refusal('type', '/params/repo', `${given} is no git checkout.`, given));
    return real(top);
  }
  /** The agent's binary on your login shell's PATH and the version it reports. */
  private async versionOf(agent: string): Promise<{ path: string; version: string }> {
    const name = AGENTS[agent]!;
    const path = this.o.loginPath().split(delimiter).filter(Boolean).map((d) => join(d, name)).find((p) => existsSync(p));
    if (!path) throw Error(`no ${name} on your login shell's PATH`);
    const said = await exec(path, ['--version'], { env: { ...process.env, PATH: this.o.loginPath() }, timeout: 20_000 });
    const version = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?/.exec(said)?.[0];
    if (!version) throw Error(`${path} --version named no version: ${said.slice(0, 200)}`);
    return { path, version };
  }
  /**
   * A worktree of its own: off the event loop, against the repo's own checkout, from the remote-tracking default
   * branch as last fetched (never fetched here), on a new branch named for the issue.
   */
  private async worktree(repo: string, issue: number, run: string): Promise<{ path: string; branch: string; base: string }> {
    const git = (...args: string[]) => exec('git', ['-C', repo, ...args]).then((o) => o.trim());
    const head = await git('symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD').catch(() => '');
    let ref = head;
    // A workspace has no forge and no remote (#1347): its own main is the default branch.
    const remote = await git('remote').catch(() => '');
    for (const candidate of remote ? ['refs/remotes/origin/main', 'refs/remotes/origin/master'] : ['refs/heads/main']) {
      if (ref) break;
      if (await git('rev-parse', '--verify', '--quiet', candidate).then(() => true, () => false)) ref = candidate;
    }
    if (!ref) throw new Refused(refusal('not_found', '/params/repo', `${repo} has no remote-tracking default branch (origin/HEAD, main or master); fetch it first.`, repo));
    const base = await git('rev-parse', `${ref}^{commit}`);
    const id = letters(run);
    const path = join(this.o.root, 'worktrees', basename(repo), id);
    const branch = `deep/${issue}-${id.slice(-6).toLowerCase()}`;
    mkdirSync(join(this.o.root, 'worktrees', basename(repo)), { recursive: true });
    await git('worktree', 'add', '--quiet', '-b', branch, path, base);
    await this.o.appendCore('worktree.created', { path, branch, owner: `task:${id}`, base });
    return { path: real(path), branch, base };
  }
  /** The launch's arguments from the facts: mode, settings and sandbox filled, your words as the prompt's argument. */
  private argvOf(started: Obj, entry: Obj | undefined, mode: string, approval: Approval, prompt: string, worktree: string): string[] {
    const home = homedir();
    // Your keys and other tools' sign-ins, and where the hub keeps sessions' own forge credentials.
    const credentials = [...CREDENTIALS.map((c) => join(home, c)), join(this.o.root, 'starts')];
    const sockets = this.o.plant === 'sandbox-cuts-hub-socket' ? [] : [this.o.socket];
    const open = this.o.plant === 'sandbox-way-out-open';
    const modes = started.modes as Record<string, string>;
    const value = (!open && isObj(entry?.modes) ? (entry!.modes as Record<string, string>)[mode] : undefined) ?? modes[mode] ?? mode;
    let settings: Obj = {};
    if (typeof entry?.settings === 'string') {
      settings = JSON.parse(entry.settings, (_, v: unknown) => (v === '{credentials}' ? credentials : v === '{hosts}' ? approval.hosts : v === '{sockets}' ? sockets : v)) as Obj;
      // The planted wrong program: the setting that turns the way out off, set the other way.
      const way = isObj(entry.wayOut) ? entry.wayOut : {};
      if (open && typeof way.setting === 'string') {
        const path = way.setting.split('.');
        let at: Obj = settings;
        for (const k of path.slice(0, -1)) at = (isObj(at[k]) ? at[k] : (at[k] = {})) as Obj;
        at[path.at(-1)!] = !way.off;
      }
    }
    const toml = (s: string) => JSON.stringify(s);
    const filesystem = `{${[`${toml(home)}="read"`, ...credentials.map((c) => `${toml(c)}="deny"`)].join(',')}}`;
    const sandboxArgs = Array.isArray(entry?.args) ? (entry!.args as string[]).map((a) => a.replaceAll('{filesystem}', filesystem)) : [];
    return (started.args as string[]).flatMap((a) => a === '{sandbox}' ? sandboxArgs : a === '{prompt}' ? [prompt]
      : [a.replaceAll('{mode}', value).replaceAll('{settings}', JSON.stringify(settings)).replaceAll('{worktree}', worktree)]);
  }
  /**
   * The worktree a start made is one you approved, so it starts trusted where the agent keeps folder trust as JSON
   * (its facts' `trust`): nothing types into its trust dialog. Written whole through a rename, the rest kept.
   */
  private trust(started: Obj, home: string, worktree: string): void {
    const t = isObj(started.trust) ? started.trust : undefined;
    if (!t || typeof t.set !== 'string') return;
    const file = real(home) === real(tilde(String(started.defaultHome))) ? tilde(String(t.file)) : join(home, String(t.homeFile));
    let config: Obj = {};
    try { config = JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return; }
    const path = t.set.split('.').map((k) => (k === '{worktree}' ? worktree : k));
    let at = config;
    for (const k of path.slice(0, -1)) at = (isObj(at[k]) ? at[k] : (at[k] = {})) as Obj;
    at[path.at(-1)!] = true;
    const tmp = `${file}.deep-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }
  /** Your login shell's environment minus what marks a nested session and your forge login, with the account's home only when it isn't the default. */
  private envOf(started: Obj, home: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !(started.nested as string[]).includes(k) && k !== 'DEEP_RUN_TOKEN' && !LOGINS.includes(k)) env[k] = v;
    env.PATH = this.o.loginPath();
    const variable = String(started.home);
    if (real(home) !== real(tilde(String(started.defaultHome)))) env[variable] = home;
    else delete env[variable];
    return env;
  }
}

/**
 * What a command's output says the sandbox refused it: Node's EPERM on a path or a connection, a program's "Operation
 * not permitted" on a path, and the sandbox's own `deny` lines. A refusal that printed nothing isn't seen.
 */
function refusedIn(text: string): { operation: string; target: string }[] {
  const out: { operation: string; target: string }[] = [];
  for (const m of text.matchAll(/EPERM: operation not permitted, (\w+) '([^'\n]+)'/g)) out.push({ operation: m[1]!, target: m[2]! });
  for (const m of text.matchAll(/^(?:[^:\n]+: )?(\/[^:\n]+): Operation not permitted$/gm)) out.push({ operation: 'open', target: m[1]! });
  for (const m of text.matchAll(/connect EPERM (\S+:\d+)/g)) out.push({ operation: 'connect', target: m[1]! });
  for (const m of text.matchAll(/\bdeny(?:\(\d+\))? ((?:network|file)[\w*-]*) (\S+)/g)) out.push({ operation: m[1]!, target: m[2]! });
  return out;
}

/**
 * What a command's output says the forge refused (#1325): a REST refusal, by the endpoint its `documentation_url`
 * names (a status, a merge), and a push a ruleset refused, by GitHub's GH013 line naming the ref.
 */
function forgeRefusedIn(text: string): { action?: 'post-status' | 'merge'; ref?: string; target: string }[] {
  const out: { action?: 'post-status' | 'merge'; ref?: string; target: string }[] = [];
  for (const m of text.matchAll(/"documentation_url"\s*:\s*"([^"]+)"/g)) {
    if (/#create-a-commit-status\b/.test(m[1]!)) out.push({ action: 'post-status', target: m[1]! });
    else if (/#merge-a-pull-request\b/.test(m[1]!)) out.push({ action: 'merge', target: m[1]! });
  }
  for (const m of text.matchAll(/GH013: Repository rule violations found for (refs\/\S+?)\.?(?:\s|$)/g)) out.push({ ref: m[1]!, target: m[1]! });
  return out;
}
