import type { HubEvents, HubRuntime, HookSchedule } from './hub-capabilities.js';
import type { AnswerDeliveryPort, StopJudgingPort, SessionStatePort, HubControlPort } from './hub-ports.js';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';

import { Numbers } from './numbers.js';

import { isAbsolute, join } from 'node:path';

import { AskRefused, duration, type Asks } from '@deepbuild/asks';

import { canonicalize, registry as schemas, sha256Hex, type JsonValue, type Schema } from '@deepbuild/contracts';
import { scrubText } from '@deepbuild/evidence';
import { type ExtensionHost } from '@deepbuild/extension-host';
import { RecordError, type Connection, type RecordStore } from '@deepbuild/record';

import { predictionContradictions, type Prediction, type RunOutcome } from '@deepbuild/verdicts';
import { parse as parseYaml } from 'yaml';
import { ASK_WAIT_MS, relations, words } from './claude-settings.js';

import { codexRelations } from './codex-settings.js';

import { revives } from './memory.js';

import { Holds } from './holds.js';
import type { Hosts } from './hosts.js';

import { couldDo, struck } from './could-do.js';

import { repoOf, type Root } from './paths.js';

import { type About } from './standing.js';

import { aboutSessions, pageClaims, search, type IndexFill } from './search.js';

import { slackConfig, slackThread } from './reach.js';

import { Runs } from './runs.js';

import { Stacks } from './stacks.js';
import { Starts } from './starts.js';
import { checkArguments, nearest } from './tools.js';
import { showCall } from './canvas.js';

import { Replicas } from './drive.js';

import { refuse, Refused, refusal, ulid, type CoreOptions, type Refusal } from './wire.js';
import type { CallContext, Stamp } from './session-types.js';
import { HubCanvas } from './hub-canvas.js';
import { docCommand, docSpec } from './doc-checks.js';

import { sql, letters, noWake, unseenTools, type Obj, isObj, isUnder, asRefused } from "./hub-shared.js";

export interface McpOperationsOptions {
  settings: CoreOptions;
  services: {
    readonly sessionStarts: Starts;
    readonly hosts: Hosts;
    readonly canvasSide: HubCanvas;
    readonly replicas: Replicas;
    readonly extensions: ExtensionHost | undefined;
    readonly holds: Holds;
    readonly record: RecordStore;
    readonly numbers: Numbers;
    readonly root: Root;
    readonly asks: Asks;
    readonly now: () => number;
    readonly raw: RecordStore['raw'];
    readonly runs: Runs;
    readonly stacks: Stacks;
  };
  control: () => Pick<HubControlPort, "attach" | "job">;
  state: () => Pick<SessionStatePort, "live" | "rows" | "sessions">;
  judging: () => Pick<StopJudgingPort, "claimed" | "reachOfSession">;
  delivery: () => Pick<AnswerDeliveryPort, "askWaits" | "deliver" | "routes" | "settling" | "waitingFor">;
  events: Pick<HubEvents, "connection" | "appendReading" | "append">;
kernel: Pick<HubRuntime, "blocked" | "stopping">;
schedule: Pick<HookSchedule, "replaying" | "queue" | "askingNow" | "wakeable">;

}

/** McpOperations: owns its domain state; services are resolved only when used. */
export class McpOperations {
  constructor(private readonly options: McpOperationsOptions) {}

  /** Unspent PreToolUse stamps: a call that binds to one spends it, and SessionEnd spends its session's. */
  stamps: Stamp[] = [];

  /** The ask each plug-in change or send waits on, by its session and request ID (#363). */
  private readonly actionAsks = new Map<string, string>();

  /** The test's index@1 fill for the wiki, if it named one; the ledger's own index otherwise. */
  index!: Promise<IndexFill | undefined>;

  /** A package's index, once rebuilt from the pages. */
  private swapped: IndexFill | undefined;

  // ---- deep mcp.

  /**
   * One deep_* call: its arguments held to its tool's schema, bound to the session it acts for, then served. Binding
   * holds the queue, so it sees every hook that arrived before the call; serving holds up no session's hooks. Its
   * refusal reaches the agent scrubbed of every value the hub holds, scrubbed whole before it is cut.
   */
  async mcpCall(params: Obj, context: CallContext): Promise<unknown> {
    const tool = String(params.tool);
    // No MCP call starts a session, whatever it claims (#1330): refused before its arguments are read.
    if (tool === 'deep_start') return this.options.services.sessionStarts.refuseMcp(context.session);
    try {
      const args = checkArguments(tool, params.arguments);
      const sent = isObj(params.arguments) ? params.arguments : {};
      // What deep-hook spooled ran before this call, as a hook's does: a replay running goes first, so a claim comes
      // after the call it follows, not before the work it claims.
      await (this.options.schedule.replaying ?? Promise.resolve());
      // A call bound to no session still reads what belongs to no session; every other tool needs its session.
      // A deep_show bound to no session is refused by the canvas side with no_session, as its reply (#806).
      const session = await this.options.schedule.queue(async () => this.bind(tool, sent, context, tool !== 'deep_status' && tool !== 'deep_search' && tool !== 'deep_show' && tool !== 'deep_kinds' && tool !== 'deep_job' && tool !== 'find_actions'));
      switch (tool) {
        case 'find_actions': return await this.findActions(args.query as string | null);
        case 'call_action': return await this.callPluginAction(session!, args);
        case 'deep_show': return await this.options.services.canvasSide.show(session ? { session } : { session: null }, showCall(args));
        case 'deep_kinds': return await this.options.services.canvasSide.kinds(args);
        case 'deep_job': return await this.options.control().job(args, context.call);
        case 'deep_root_plan': return await this.options.services.hosts.proposeRoot(args);
        case 'deep_status': return await this.status(session);
        case 'deep_search': return await this.find(String(args.query), session, context, typeof args.file === 'string' ? args.file : undefined, typeof args.cursor === 'string' ? args.cursor : undefined);
        case 'deep_ask': return await this.askFor(session!, args);
        case 'deep_wait': return await this.waitFor(session!, String(args.ask));
        case 'deep_open_item': return await this.openItem(session!, String(args.text));
        case 'deep_claim': return await this.claim(session!, args);
        case 'deep_evidence': return await this.options.control().attach(session!, args);
        case 'deep_propose': return await this.propose(session!, args);
        case 'deep_env': return await this.deepEnv(session!, String(args.action));
        case 'deep_drive': return await this.options.services.replicas.drive(session!, args);
        default: return await this.runCheck(session!, args);
      }
    } catch (error) {
      throw this.forAgent(error, tool);
    }
  }

  private forAgent(error: unknown, tool: string): Refused {
    const refused = error instanceof Refused ? error : error instanceof AskRefused ? (asRefused(error) as Refused)
      : new Refused(refusal('unavailable', '', `${tool} failed in the hub: ${error instanceof Error ? error.message : String(error)}; nothing was recorded.`, tool, true));
    const plant = this.options.settings.plant;
    const scrub = (text: string) => (plant === 'errors-unscrubbed' ? text : scrubText(text, { held: this.options.settings.held }));
    const out: Partial<Refusal> = { ...refused.refusal, remediation: scrub(refused.refusal.remediation), actual: scrub(refused.whole ?? refused.refusal.actual).slice(0, 8192) };
    if (plant === 'errors-without-actual') delete out.actual;
    return new Refused(out as Refusal);
  }

  /**
   * The session a deep_* call acts for: its deep mcp's own, or the one unspent PreToolUse stamped for this very call,
   * by its tool and the digest of its arguments as sent. A call more than one unspent stamp matches binds to none.
   * Unbound, a call that needs its session is refused; one that only reads goes on bound to none.
   */
  private bind(tool: string, args: Obj, context: CallContext, required: boolean): string | undefined {
    const live = (id: string) => { const s = this.options.state().sessions.get(id); return s && !s.ended ? s : undefined; };
    if (context.session) {
      if (live(context.session)) return context.session;
      if (!required) return undefined;
      throw refuse('unbound', '/params/tool', `Session ${context.session} has ended; this deep mcp acts for no session now.`, tool);
    }
    const parent = context.parent;
    const digest = sha256Hex(canonicalize(args as JsonValue));
    const matches = parent ? this.stamps.filter((s) => {
      const session = live(s.session);
      void digest; return s.tool === tool && session !== undefined && session.pid === parent.pid && session.start === parent.start;
    }) : [];
    const bound = matches[0];
    if (!bound) {
      if (!required) return undefined;
      throw refuse('unbound', '/params/arguments', `This ${tool} call binds to no session: ${matches.length ? 'more than one' : 'no'} PreToolUse stamped for it is unspent.`, tool);
    }
    this.stamps.splice(this.stamps.indexOf(bound), 1);
    return bound.session;
  }

  /** The connection a session's deep mcp writes through: writer mcp:<session>, from the binding, never the call. */
  agentConnection(session: string): Connection {
    const agent = this.options.state().sessions.get(session)?.agent;
    return this.options.events.connection(`mcp:${session}`, { session, ...(agent ? { agent } : {}) });
  }

  /** find_actions (deep-actions, #363): the actions the loaded plug-ins offer agents, each typed from its input schema. */
  private async findActions(query: string | null): Promise<Obj> {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const offered = (await this.options.services.extensions?.actions() ?? []).filter((a) => a.exposed && words.every((w) => `${a.action} ${a.extension}`.toLowerCase().includes(w)));
    return { actions: offered.map(({ action, extension, declares, input }) => ({ action, extension, declares, input })) };
  }

  /**
   * call_action (deep-actions, #363): a plug-in action for the session, its input held to the action's schema before
   * anything else. A read runs. A change runs on your standing rule or your yes to its ask, and a send on your yes
   * alone: until you answer, the call returns held with the ask, and the same request ID called again runs it once you
   * said yes. The target is the plug-in that registered the action, at its loaded version, and the authority the
   * session's own connection, never a window, a folder or another session.
   */
  private async callPluginAction(session: string, args: Obj): Promise<Obj> {
    const name = String(args.action);
    const request = String(args.request);
    const listed = (await this.options.services.extensions?.actions() ?? []).find((a) => a.action === name);
    if (!listed) throw refuse('not_found', '/params/arguments/action', 'Call an action find_actions lists, by its name.', name);
    if (!listed.exposed) throw refuse('not_found', '/params/arguments/action', `${name} isn't offered to agents: ${listed.reason}.`, name);
    let input: unknown;
    try {
      input = JSON.parse(String(args.input));
    } catch {
      throw refuse('type', '/params/arguments/input', 'Give the input as one string holding its JSON text.', args.input);
    }
    const held = schemas([{ name, schema: listed.input as Schema }]).validate(name, input);
    if (!held.ok) throw refuse('type', `/params/arguments/input${held.issues[0]!.path}`, `Give input that ${name}'s input schema takes: ${held.issues[0]!.remediation}`, input);
    if (listed.declares !== 'read') {
      const s = this.options.state().sessions.get(session)!;
      const key = `${session}|${request}`;
      let ask = this.actionAsks.get(key);
      if (!ask) {
        // A send's ask names its request, so no saved decision ever answers it; a change's is answered by a standing rule.
        const about: About = {
          source: `action.${listed.declares}`,
          subject: { effect: `action.${listed.declares}`, target: { kind: 'action', ref: listed.declares === 'send' ? `${name}#${request}` : name, owner: listed.extension }, change: null },
          question: `Let this session ${listed.declares === 'send' ? 'send with' : 'change your data with'} ${listed.extension}'s ${name}, given ${JSON.stringify(input).slice(0, 500)}?`,
          options: [listed.declares === 'send' ? 'Send it' : 'Change it', 'Don\'t'],
        };
        ask = (await this.options.services.holds.asked({ session, agent: s.agent, cwd: s.cwd }, about)).ask;
        this.actionAsks.set(key, ask);
      }
      const [row] = (await this.options.services.record.raw('SELECT decision FROM asks WHERE id = ?', [ask.slice(4)])) as { decision: string | null }[];
      if (row?.decision === 'deny') return { status: 'declined', ask };
      if (row?.decision !== 'allow') return { status: 'held', ask, reason: `DeepBuild is holding ${name}: it waits for your answer to ${ask}; once you say yes, call it again with the same request ID.` };
    }
    const result = await this.options.services.extensions!.callAction({
      action: name, target: { handle: `ext:${listed.extension}`, version: listed.version }, input, caller: this.agentConnection(session), request,
    });
    // Refused before its handler started, it did not run; one that started and failed reaches the agent as an error,
    // with what the hub wrote for it on record as unverified.
    if (result.status === 'refused' && !result.started) throw refuse('unavailable', '/params/arguments/action', `${result.reason}; nothing ran.`, name);
    if (listed.declares === 'read') return result.status === 'refused' ? { status: 'failed', reason: result.reason } : result;
    // A change or send's report, and what the hub wrote for it, as its action.reported holds them.
    const [reported] = (await this.options.services.record.raw(`SELECT r.data AS data FROM events e JOIN events r ON r.kind = 'action.reported' AND json_extract(r.data, '$.call') = json_extract(e.data, '$.call')
      WHERE e.kind = 'action.entered' AND e.session_id = ? AND json_extract(e.data, '$.request') = ? ORDER BY r.log_pos DESC LIMIT 1`, [session, request])) as { data: string }[];
    const { error: _error, ...report } = reported ? JSON.parse(reported.data) as Obj : {};
    if (result.status === 'refused') return { status: 'failed', reason: result.reason, call: result.call, report: reported ? report : null };
    return { ...result, report: reported ? report : null };
  }

  /** deep_status: the gates, and for a bound session its newest claims, each with its runs, its verdict and its contradictions. */
  private async status(session: string | undefined): Promise<Obj> {
    const gates = { watch_only: this.options.kernel.blocked !== undefined, reason: this.options.kernel.blocked ?? null };
    if (!session) return { session: null, gates, claims: [] };
    const made = (await this.options.services.record.raw(`SELECT id, data FROM events WHERE session_id = ? AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 10`, [session])) as { id: string; data: string }[];
    const claims: Obj[] = [];
    for (const row of made) {
      const claim = JSON.parse(row.data) as { task_ref: string; commit: string; predictions?: Prediction[] };
      const runs = (await this.options.services.record.raw(`SELECT kind, ts, data FROM events WHERE kind IN ('run.started', 'run.finished') AND subject IN
        (SELECT subject FROM events WHERE kind = 'run.started' AND json_extract(data, '$.claim') = 'claim:${row.id}') ORDER BY log_pos`)) as { kind: string; ts: number; data: string }[];
      const byRun = new Map<string, { run: string; check: string; started?: number; ended?: number; outcome?: RunOutcome }>();
      for (const r of runs) {
        const d = JSON.parse(r.data) as { run: string; check?: string; outcome?: RunOutcome };
        const one = byRun.get(d.run) ?? { run: d.run, check: String(d.check) };
        if (r.kind === 'run.started') Object.assign(one, { check: String(d.check), started: r.ts });
        else Object.assign(one, { ended: r.ts, outcome: d.outcome });
        byRun.set(d.run, one);
      }
      const finished = [...byRun.values()].flatMap((r) => (r.outcome !== undefined && r.ended !== undefined ? [{ ...r, outcome: r.outcome, ended: r.ended }] : []));
      const checks = [...new Set(finished.map((r) => r.check))].map((check) => ({ check, runs: finished.filter((r) => r.check === check) }));
      const [verdict] = (await this.options.services.record.raw(`SELECT handle, outcome, smallest, points_to FROM verdicts WHERE claim_id = ? AND stale = 0 ORDER BY created DESC LIMIT 1`, [row.id])) as Obj[];
      claims.push({
        claim: `claim:${row.id}`, task_ref: claim.task_ref, commit: claim.commit,
        runs: [...byRun.values()].map((r) => ({ run: r.run, check: r.check, outcome: r.outcome ?? 'running' })),
        verdict: verdict ?? null,
        contradictions: predictionContradictions(claim.predictions ?? [], checks),
      });
    }
    // An agent's deep_status is its own session's (#1463): the planted wrong program leaks every session's asks into it.
    if (this.options.settings.plant === 'status-row-leak') return { session, gates, claims, rows: [...this.options.state().rows.values()].filter((p) => p.row.id.startsWith('ask:')).map((p) => p.row) as unknown as Obj[] };
    return { session, gates, claims };
  }

  /**
   * deep_search: the wiki, decisions and the project's spec; bound to a session, its own open items and verdicts too,
   * and its repo's past sessions (#1515), narrowed to those that touched `file` when it names one.
   */
  private async find(query: string, session: string | undefined, context: CallContext, file?: string, cursor?: string): Promise<Obj> {
    const worktree = session ? this.options.state().sessions.get(session)?.cwd : this.worktreeAt(context.cwd);
    const everyone = !session && this.options.settings.plant === 'unbound-reads-all';
    // A claim reaches a session at its own scope, its repo's or everywhere's; a call bound to no session reads every repo's.
    const [project] = session ? (await this.options.services.record.raw(`SELECT project_id FROM sessions WHERE id = ?`, [session])) as { project_id: string | null }[] : [];
    const scopes = new Set(session ? [`session:${letters(session)}`, 'all', ...(project?.project_id ? [`repo:${letters(project.project_id)}`] : [])] : []);
    const covers = (scope: string): boolean => everyone || (session ? scopes.has(scope) : scope === 'all' || scope.startsWith('repo:'));
    return search({
      query, index: await this.wikiIndex(), raw: (q, params) => this.options.services.record.raw(q, params), worktree, session: everyone ? { everyone: true } : session, covers,
      trustsIndex: this.options.settings.plant === 'trusts-index',
      readings: (q) => this.options.services.numbers.search(q, everyone ? { everyone: true } : session),
      ...(session ? { past: await this.pastSessions(project?.project_id ?? null, file, worktree) } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
  }

  /**
   * The past sessions a bound call reads (#1515): its repo's archived ones, newest first, and, naming a file, only
   * those whose recorded reads and edits touched it. Another repo's are reached only as a wiki claim's scope allows.
   */
  private async pastSessions(project: string | null, file: string | undefined, worktree: string | undefined): Promise<NonNullable<Parameters<typeof search>[0]['past']>> {
    let sessions = project === null ? [] : ((await this.options.services.record.raw('SELECT id FROM sessions WHERE project_id = ? AND transcript IS NOT NULL ORDER BY last_seen DESC, id', [project])) as { id: string }[]).map((r) => r.id);
    if (file !== undefined) {
      const by = new Set((await this.options.services.record.touched(file, worktree)).map((t) => t.session));
      sessions = sessions.filter((id) => by.has(id));
    }
    return { sessions, messages: (terms, ids) => this.options.services.record.findMessages(terms, ids), about: (ids) => aboutSessions((sql, params) => this.options.services.record.raw(sql, params), ids) };
  }

  /** The wiki's index: a loaded package's in place of the shipped one, rebuilt from the pages when it first serves (#355). */
  private async wikiIndex(): Promise<IndexFill | undefined> {
    const swapped = this.options.services.extensions?.index()?.fill;
    if (!swapped) return this.index;
    if (this.swapped !== swapped) {
      await swapped.rebuild(pageClaims(this.options.services.root.wiki));
      this.swapped = swapped;
    }
    return swapped;
  }

  /** The worktree of a session the hub knows that holds `folder`: an unbound call reads that project's spec, and no other file. */
  private worktreeAt(folder: string | undefined): string | undefined {
    if (!folder || !isAbsolute(folder)) return undefined;
    let real: string;
    try { real = realpathSync(folder); } catch { return undefined; }
    return [...this.options.state().sessions.values()].map((s) => s.cwd).find((cwd) => cwd === real || isUnder(real, cwd));
  }

  /** The checks a worktree's spec names, by name, with the command each runs and its deadline as the spec writes it, where it gives one. */
  checksOf(worktree: string): Map<string, { run: string; deadline?: unknown; type?: string; host?: string }> {
    let spec: unknown;
    try { spec = parseYaml(readFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return new Map(); }
    const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
    return new Map(Object.entries(checks).flatMap(([name, c]) => {
      if (!isObj(c) || typeof c.run !== 'string') return [];
      return [[name, { run: c.run, ...(c.deadline !== undefined ? { deadline: c.deadline } : {}), ...(typeof c.type === 'string' ? { type: c.type } : {}), ...(typeof c.host === 'string' ? { host: c.host } : {}) }] as const];
    }));
  }

  private unknownCheck(worktree: string, check: unknown): Refused {
    const names = [...this.checksOf(worktree).keys(), ...this.options.services.canvasSide.docChecksOf(worktree).keys()];
    const near = typeof check === 'string' ? nearest(check, names) : undefined;
    return refuse('enum', '/params/arguments/check', near ? `Name ${near} in place of ${String(check)}.` : `Name a check this repo's .deepbuild/done.yaml names: ${names.join(', ') || 'it names none'}.`, check);
  }

  /** deep_ask: raises the ask under the session, then waits for its answer as deep_wait does. */
  private async askFor(session: string, args: Obj): Promise<Obj> {
    const s = this.options.state().sessions.get(session)!;
    const kind = String(args.kind);
    const question = String(args.question);
    const need = (field: string, why: string) => { if (args[field] === null) throw refuse('required', `/params/arguments/${field}`, why, null); };
    let raised: Obj;
    if (kind === 'unblock') {
      const thread = args.thread as { link: string; expect: string } | null | undefined;
      if (thread) {
        if (!slackThread(thread.link)) throw refuse('format', '/params/arguments/thread/link', 'Give a Slack thread link: https://<workspace>.slack.com/archives/<channel>/p<timestamp>.', thread.link);
        if (!slackConfig(this.options.services.root.dir)) throw refuse('required', '/params/arguments/thread', 'No Slack connector: put your bot token and user ID in the hub\'s slack.json, mode 0600, to read this thread.', null);
      } else {
        need('check', 'Name the check in the repo\'s spec that will prove the task done; a task without one is refused, since nobody could tell it was done.');
        if (!this.checksOf(s.cwd).has(String(args.check))) throw this.unknownCheck(s.cwd, args.check);
      }
      need('steps', 'List the task\'s steps, in order.');
      need('where', 'Say where the person does the task.');
      need('why', 'Say what the task unblocks.');
      // A task names a provider or a secret, never a URL: where it goes comes from the trusted path (#84).
      const host = (text: string) => text.replace(/[a-z][a-z0-9+.-]*:\/\/([^/\s]+)\S*/gi, '$1');
      raised = {
        kind, question, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done',
        steps: (args.steps as string[]).map(host), where: host(String(args.where)), why: args.why, unblocks: [`session:${letters(session)}`], proves: thread ? `thread:${sha256Hex(new TextEncoder().encode(thread.link))}` : args.check, ...(thread ? { thread } : {}),
      };
      // Could the agent do it? A task the check finds a way through goes back, and never reaches you (#84).
      const step = [question, ...(Array.isArray(args.steps) ? args.steps as string[] : [])].join(' ');
      const found = couldDo(step, await this.options.judging().reachOfSession(session));
      if (found.length) {
        await this.options.events.appendReading(session, s.agent, `Hand-back sent back with ${found.map((f) => f.use).join(', ')}: ${question}`.slice(0, 2000));
        return { ask: null, status: 'back', answer: null, use: found.map((f) => f.how) };
      }
      await this.options.events.appendReading(session, s.agent, `Hand-back reached you: ${question}`.slice(0, 2000));
    } else {
      need('options', 'Give the question\'s options.');
      // An option that needs a tool the agent lacks is struck before you see it (#84).
      const reach = await this.options.judging().reachOfSession(session);
      const options = (args.options as { id: string; label: string }[]).filter((o) => !struck(o.label, reach)).map((o) => ({ ...o, decision: 'none' }));
      const recommended = options.some((o) => o.id === args.recommended) ? args.recommended : null;
      // With no recommendation nothing goes on: the question waits for you, its first option the default at its deadline.
      raised = { kind, question, options, recommended, ...(recommended === null && options[0] ? { default: options[0].id } : {}) };
    }
    const pinned = await this.pinOf(s.cwd, question);
    // A question that names what it is about is keyed by the asks core from that alone (#23); one that names
    // nothing keeps a key of its own wording in its session, which no saved decision answers elsewhere.
    const about = isObj(args.subject) ? args.subject : {};
    // The repeat-reaches-you plant (#27) drops the subject, so no saved decision answers a repeat.
    const subject = this.options.settings.plant === 'repeat-reaches-you' ? undefined
      : kind === 'choice' && typeof about.point === 'string' ? { point: about.point }
      : kind === 'taste' && typeof about.screen === 'string' && typeof about.element === 'string' ? { screen: about.screen, element: about.element } : undefined;
    // A taste call or a choice with a recommendation goes on at once with it, marked as undoable (#84).
    const provisional = kind !== 'unblock' && raised.recommended !== null && raised.recommended !== undefined;
    const ask = { ...raised, fallback: 'you', provisional, owner: 'you', key: sha256Hex(canonicalize({ kind, question, session } as JsonValue)), pinned_to: pinned, ...(subject ? { subject } : {}) };
    const handle = await this.options.services.asks.raise(this.agentConnection(session), `deep_ask.${kind}`, ask);
    if (provisional) {
      const label = (raised.options as { id: string; label: string }[]).find((o) => o.id === raised.recommended)?.label;
      await this.options.schedule.askingNow().catch(() => undefined);
      return { ask: handle, status: 'provisional', answer: raised.recommended, note: `Go on with ${label ?? String(raised.recommended)}: it is provisional and can be undone, and only steps that leave the machine wait for the answer.` };
    }
    // The event loop knows this session's stop may carry the answer back before the agent hears of its ask.
    await this.options.schedule.askingNow().catch(() => undefined);
    await this.waiterNote(session, handle).catch(() => undefined);
    return this.waitFor(session, handle);
  }

  /**
   * An ask whose deadline runs past the waiter's timeout says why its answer may wait: Claude Code stops the waiter
   * at its timeout, and an answer after it arrives at the session's next prompt.
   */
  private async waiterNote(session: string, handle: string): Promise<void> {
    const waiter = relations(this.options.services.root.dir).find((r) => r.name === 'waiter');
    const [row] = (await this.options.services.record.raw(`SELECT deadline, created FROM asks WHERE id = ?`, [handle.slice(4)])) as { deadline: number | null; created: number | null }[];
    if (!waiter || !row?.deadline || row.deadline - (row.created ?? this.options.services.now()) <= waiter.timeoutS * 1000) return;
    await this.options.events.appendReading(session, this.options.state().sessions.get(session)?.agent ?? 'claude-code', `${handle} can be answered up to ${words(row.deadline - (row.created ?? this.options.services.now()))} on, past the waiter's ${waiter.timeoutS} s timeout: an answer you give after the waiter stops arrives at this session's next prompt.`);
  }

  /** What an ask shows: the worktree's commit, or where there's none, the question's own digest. */
  pinOf(worktree: string, question: string): Promise<Obj> {
    return new Promise((done) => execFile('git', ['-C', worktree, 'rev-parse', 'HEAD'], { timeout: 2000 }, (error, out) => {
      const commit = String(out ?? '').trim();
      done(!error && /^[0-9a-f]{40}$/.test(commit) ? { kind: 'commit', ref: commit } : { kind: 'evidence', ref: sha256Hex(new TextEncoder().encode(question)) });
    }));
  }

  /**
   * deep_wait: the ask's answer once one arrives, or before the agent's tool timeout, that it's still waiting, with
   * its deadline and default. Only the session that raised an ask waits on it.
   */
  /** How long deep_ask and deep_wait wait: none once Claude Code's MCP tool timeout leaves no room (the deep_ask relation). */
  private askWait(session: string): number {
    if (this.options.state().sessions.get(session)?.agent === 'codex') {
      const relation = codexRelations(this.options.services.root.dir).find((r) => r.name === 'deep_ask');
      if (relation) return relation.waitMs;
    }
    return relations(this.options.services.root.dir).find((r) => r.name === 'deep_ask')?.holds === false ? 0 : ASK_WAIT_MS;
  }

  private async waitFor(session: string, handle: string): Promise<Obj> {
    const until = Date.now() + this.askWait(session);
    const places = this.options.delivery().routes.get(session)?.places === true;
    if (places) {
      const [own] = (await this.options.services.record.raw(`SELECT session_id FROM asks WHERE id = ?`, [handle.slice(4)])) as { session_id: string | null }[];
      if (own?.session_id === session) this.options.delivery().askWaits.set(handle.slice(4), session);
    }
    // The deep-wait-polls plant reads the ask every 100 ms, as the hub did before #823.
    const polls = this.options.settings.plant === 'deep-wait-polls';
    for (;;) {
      // The ask is read again only once an event about it lands, its call is stopped, the hub stops or the wait runs out (#823).
      const wait = polls ? { woken: new Promise((done) => setTimeout(done, 100)), cancel: () => undefined } : this.options.schedule.wakeable(this.options.delivery().settling, handle, until - Date.now());
      try {
        const [row] = (await this.options.services.record.raw(`SELECT session_id, status, answer, deadline, default_option FROM asks WHERE id = ?`, [handle.slice(4)])) as { session_id: string | null; status: string; answer: string | null; deadline: number; default_option: string | null }[];
        if (!row || row.session_id !== session) throw refuse('not_found', '/params/arguments/ask', 'Wait on an ask this session raised, by the handle deep_ask returned.', handle);
        // Aborted: the answer goes as a message of its own.
        if (places && !this.options.delivery().askWaits.has(handle.slice(4))) return { ask: handle, status: 'waiting', answer: null, deadline: row.deadline, default: row.default_option === null ? null : JSON.parse(row.default_option) };
        // Decided for you (#27): the answer is the one the decision that closed it saved.
        if (row.status === 'decided' && row.answer === null) {
          if (places) this.options.delivery().askWaits.delete(handle.slice(4));
          const [d] = (await this.options.services.record.raw(`SELECT d.answer AS answer FROM events e JOIN decisions d ON 'decision:' || d.id = json_extract(e.data, '$.decision') WHERE e.kind = 'decision.applied' AND json_extract(e.data, '$.ask') = ? ORDER BY e.log_pos DESC LIMIT 1`, [handle])) as { answer: string | null }[];
          return { ask: handle, status: row.status, answer: d?.answer ? JSON.parse(d.answer) : null };
        }
        if (row.status !== 'open' && row.status !== 'later') {
          // The running call carries it into the turn; the package says when it has, and till then nothing else hands it over.
          if (places && row.status !== 'answered') this.options.delivery().askWaits.delete(handle.slice(4));
          // Your answer, in the call's reply: delivered into the turn, so its green turn end starts a loop's held checks (#965).
          const live = this.options.state().live.get(session);
          if (row.status === 'answered' && live && this.options.settings.plant !== 'words-only-at-turn-start') live.words ??= 'answer';
          return { ask: handle, status: row.status, answer: row.answer === null ? null : JSON.parse(row.answer) };
        }
        if (this.options.kernel.stopping && this.options.settings.plant !== 'stop-answers-waiting') throw refuse('unavailable', '', 'The hub is stopping, and nothing was answered; wait on the ask again once it is back.', handle, true);
        if (this.options.kernel.stopping || Date.now() >= until) {
          if (places) this.options.delivery().askWaits.delete(handle.slice(4));
          return { ask: handle, status: 'waiting', ...(noWake(this.options.state().sessions.get(session)?.agent) ? { note: 'Still waiting for your answer; wait on it again with deep_wait.' } : {}), answer: null, deadline: row.deadline, default: row.default_option === null ? null : JSON.parse(row.default_option) };
        }
        await wait.woken;
      } finally {
        wait.cancel();
      }
    }
  }

  /** deep_open_item: an open item on the session's newest claim's task, or else on the message it works on. */
  private async openItem(session: string, text: string): Promise<Obj> {
    const [claim] = (await this.options.services.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 1`, [session])) as { data: string }[];
    const message = this.options.state().sessions.get(session)?.turn?.uuid.replace(/[^A-Za-z0-9._-]/g, '') || 'start';
    const task_ref = claim ? String((JSON.parse(claim.data) as Obj).task_ref) : `session:${letters(session)}#${message}`;
    const ts = this.options.services.now();
    const id = ulid(ts);
    try {
      await this.options.events.append(this.agentConnection(session), { v: 1, id, kind: 'open_item.opened', ts, data: { task_ref, text: scrubText(text, { held: this.options.settings.held }).slice(0, 8192) } });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_open_item');
    }
    return { task_ref, event: id };
  }

  /**
   * deep_propose: a change the agent proposes, recorded as learn.proposed and applied by no one, and an ask in your
   * inbox naming it; the proposal cites that ask, whose question holds the change's words (#355).
   */
  async propose(session: string, args: Obj): Promise<Obj> {
    const target = scrubText(String(args.target), { held: this.options.settings.held }).slice(0, 1000);
    const change = scrubText(String(args.change), { held: this.options.settings.held }).slice(0, 4000);
    // A direction you rejected isn't asked about again: the agent hears your decision, and you hear nothing (#111).
    const revived = await revives(this.options.services.raw, change, repoOf(this.options.state().sessions.get(session)!.cwd), session);
    if (revived) throw refuse('rejected', '/params/arguments/change', `You can't propose \`${revived.direction}\`: the person rejected it (${revived.decision}). Take another direction; only they can overrule that decision.`, revived.decision);
    const question = `Apply this change an agent proposed to ${target}? ${change}`;
    const pinned = await this.pinOf(this.options.state().sessions.get(session)!.cwd, question);
    const options = [{ id: 'apply', label: 'Apply it', decision: 'none' }, { id: 'keep', label: 'Keep it as it is', decision: 'none' }];
    const raised = { kind: 'choice', question, options, recommended: 'keep', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'propose', target, change, session } as JsonValue)), pinned_to: pinned };
    const ask = await this.options.services.asks.raise(this.agentConnection(session), 'deep_propose.choice', raised);
    const ts = this.options.services.now();
    const id = ulid(ts);
    const evidence = [...((args.evidence as { at: string; quote: string }[] | null) ?? []), { at: ask, quote: change }];
    try {
      await this.options.events.append(this.agentConnection(session), {
        v: 1, id, kind: 'learn.proposed', ts,
        data: { layer: 'learned', target, diff: `+ ${change}`, evidence, scope: `session:${letters(session)}`, replay: null, applied_by: null, supersedes: null },
      });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_propose');
    }
    return { proposal: `doc:${id}`, ask };
  }

  private async claim(session: string, args: Obj): Promise<Obj> {
    // While appends fail, no claim is acknowledged.
    if (this.options.kernel.blocked) throw refuse('unavailable', '/params/tool', `${this.options.kernel.blocked}; the claim was not recorded. Claim again once appends work.`, 'deep_claim', true);
    const ts = this.options.services.now();
    const id = ulid(ts);
    // What the agent expects each check to show, stamped now, before any run it could have seen.
    const predictions = ((args.predictions ?? []) as { check: string; expects: string }[]).map((p) => ({ ...p, at: ts }));
    const data = { task_ref: args.task_ref, attempt: args.attempt, commit: args.commit, scope: args.scope, predictions };
    try {
      await this.options.events.append(this.agentConnection(session), { v: 2, id, kind: 'claim.made', ts, data: data as JsonValue });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_claim');
    }
    this.options.judging().claimed(session, `claim:${id}`);
    // A claim in a loop's turn starts its stop's slow checks as any turn end does (#965).
    const live = this.options.state().live.get(session);
    if (live) live.claimedInTurn = true;
    // An agent paseo runs with no hooks of its own shows no work but this claim: its turn's end is judged on it (#55).
    if (live && unseenTools(this.options.state().sessions.get(session)?.agent)) live.judged = true;
    // An answer to an ended session of another thread waits on its task: the next session that works the task reads it.
    const task = sql(String(args.task_ref));
    const answers = await this.options.schedule.queue(async () => this.options.delivery().deliver(await this.options.delivery().waitingFor(session, `a.session_id IN (SELECT session_id FROM events WHERE kind = 'claim.made' AND json_extract(data, '$.task_ref') = '${task}')
      AND a.session_id IN (SELECT session_id FROM events WHERE kind = 'session.end')`), 'next_prompt'));
    return { session, claim: `claim:${id}`, event: id, ...(answers ? { answers } : {}) };
  }

  /** deep_run: a check the session's spec names, run for one of its claims (its newest by default) at that claim's commit, answered with its outcome. */
  private async runCheck(session: string, args: Obj): Promise<Obj> {
    const cwd = this.options.state().sessions.get(session)!.cwd;
    const check = this.checksOf(cwd).get(String(args.check));
    const doc = check ? undefined : this.options.services.canvasSide.docChecksOf(cwd).get(String(args.check));
    if (check === undefined && doc === undefined) throw this.unknownCheck(cwd, args.check);
    // A deadline the hub can't read is refused before the run starts, never taken as none (#822).
    const deadline = check?.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
    if (check?.deadline !== undefined && !deadline) {
      throw refuse('pattern', `/checks/${String(args.check)}/deadline`, `Give the check's deadline in .deepbuild/done.yaml as a whole number above 0 of m, h or d, such as 30m, not ${String(check.deadline)}.`, String(check.deadline));
    }
    const which = args.claim === null ? '' : `AND id = '${sql(String(args.claim).slice(6))}'`;
    const [claim] = (await this.options.services.record.raw(`SELECT id, data FROM events WHERE session_id = ? AND kind = 'claim.made' ${which} ORDER BY log_pos DESC LIMIT 1`, [session])) as { id: string; data: string }[];
    if (!claim) throw refuse('not_found', '/params/arguments/claim', 'Run a check for a claim this session made: claim first with deep_claim.', args.claim);
    const commit = String((JSON.parse(claim.data) as Obj).commit);
    // A document check runs on its current revision (#1723); a host check runs at your remote home (#1942).
    const at = doc && await this.options.services.canvasSide.docRevision(doc.doc);
    const { run } = doc
      ? await this.options.services.runs.start({ check: args.check, claim: `claim:${claim.id}`, commit, argv: ['/bin/sh', '-c', docCommand(doc, at)], command: docCommand(doc, at), spec: docSpec(doc, at) as unknown as Obj, cwd })
      : await this.options.services.runs.start({ check: args.check, claim: `claim:${claim.id}`, commit, argv: ['/bin/sh', '-c', check!.run], ...(check!.host === undefined ? { cwd } : { host: check!.host }) }, deadline);
    // A run on a host is long work, such as a model download: it answers once started there, and the claim waits for it.
    if (check?.host !== undefined) return { run, claim: `claim:${claim.id}`, outcome: 'running', evidence: [] };
    // The run's outcome once it finishes, so the agent needn't poll; past the wait, that it's still running.
    const until = Date.now() + this.askWait(session);
    for (;;) {
      // Read again only once an event about the run lands, the hub stops or the wait runs out (#823).
      const wait = this.options.schedule.wakeable(this.options.delivery().settling, String(run), until - Date.now());
      try {
        const [done] = (await this.options.services.record.raw(`SELECT data FROM events WHERE kind = 'run.finished' AND subject = ? LIMIT 1`, [String(run)])) as { data: string }[];
        if (done) {
          const d = JSON.parse(done.data) as { outcome: string; evidence: string[] };
          return { run, claim: `claim:${claim.id}`, outcome: d.outcome, evidence: d.evidence.map((sha) => `ev:${sha}`) };
        }
        if (this.options.kernel.stopping || Date.now() >= until) return { run, claim: `claim:${claim.id}`, outcome: 'running', evidence: [] };
        await wait.woken;
      } finally {
        wait.cancel();
      }
    }
  }

  private refusedAppend(error: unknown, what: string): Refused {
    if (error instanceof RecordError && error.code === 'storage') return new Refused(refusal('unavailable', '', `BLOCKED: appends fail: ${error.message}; ${what} was not recorded.`, what, true));
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(\w+) at /.exec(message)?.[1] ?? 'type';
    return new Refused(refusal(code, error instanceof RecordError && error.path ? `/params/arguments${error.path.replace(/^\/data/, '')}` : '/params/arguments', message, what));
  }

  /**
   * deep_env (#331): the bound session's own worktree's stack, up or down, as `deep env up` and `deep env down` run
   * there. The worktree is the session's, from its hooks, never from the call, so a child session in a worktree of its
   * own leases its own ports there and never its parent's. Its leases name the session's deep mcp as their holder; a
   * stack already up in that worktree is reused as it is, so the holder says who leased it, not who uses it.
   */
  private async deepEnv(session: string, action: string): Promise<Obj> {
    const cwd = this.options.state().sessions.get(session)!.cwd;
    if (!existsSync(cwd)) throw refuse('not_found', '/params/arguments', `Session ${session}'s worktree ${cwd} doesn't exist; its stack runs from its worktree alone.`, cwd);
    const worktree = realpathSync(cwd);
    return action === 'up' ? this.options.services.stacks.up(worktree, `mcp:${session}`) : this.options.services.stacks.down(worktree, { path: '/params/arguments', remedy: 'deep_env with action up' }, `mcp:${session}`);
  }
}
