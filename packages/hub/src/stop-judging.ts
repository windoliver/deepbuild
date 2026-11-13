import type { HubEvents, HubRuntime, HookSchedule } from './hub-capabilities.js';
import { StopReply } from './stop-reply.js';
import type { AnswerDeliveryPort, TranscriptsPort, SessionFlagsPort, SessionStatePort, McpOperationsPort, HubControlPort } from './hub-ports.js';
import { backgrounded } from './hub-shared.js';
import type { Questions } from './questions.js';
import { STOP_HOLD_MS } from './claude-settings.js';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { liveFetch, readIssue, recordedFetch } from './github-source.js';
import type { Outcome } from './landing.js';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { duration, type Asks, type Delivery } from '@deepbuild/asks';
import { type BudgetInput, type Ledger } from '@deepbuild/budget';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { type EvidenceStore } from '@deepbuild/evidence';
import { type ExtensionHost, type ProjectTrust } from '@deepbuild/extension-host';
import { type RecordStore } from '@deepbuild/record';
import { endsEmpty, freshCount, gitEnv, judgeStop, leftOpen, priceDefinition, toldToRun, unitless, validityGate, type PaidKind, type SessionLog, type StallCount, type StallRule } from '@deepbuild/gate';
import { type LeaseTable } from '@deepbuild/leases';
import { type Runner, type WindowReport } from '@deepbuild/runner';
import { type Grant, type Host } from '@deepbuild/supervisor';
import { recordVerdict, verdictHash, verdictLine, type Result } from '@deepbuild/verdicts';
import { shellQuote } from './shell.js';
import { words } from './claude-settings.js';
import { holdsFor, stopTimeoutS } from './codex-settings.js';
import { codexReadings, heartbeatsGone, loopsCovered, standingReadings, stands, uncoveredLoops } from './codex-loops.js';
import { AskTasks } from './ask-tasks.js';
import { SizeScope } from './scope.js';
import { codexTrusted } from './codex-settings.js';
import { Holds } from './holds.js';
import { countMcp } from './mcp-servers.js';
import { reachOf, type Reach, type ReachTool } from './could-do.js';
import { coveredBy } from './hookmap.js';
import { mergedWithMain, releaseSpec, switchesOff } from './release.js';
import { headOf } from './session-facts.js';
import { GateRunner, type ClaimCheck, type DefinitionState, type RunKey, type StatePin } from './gate-runner.js';
import { type Root } from './paths.js';
import { Agents } from './agents.js';
import { Box } from './box.js';
import { closesIssue, partOfIssue, prUrlIn } from './forge.js';
import { OpenItems } from './open-items.js';
import { claimState, newestClaim, type ClaimState } from './verdict-chat.js';
import { RUN_AS_YOU, Runs } from './runs.js';
import type { CheckKinds, ReviewOf } from './checks-port.js';
import type { ReviewRounds } from './review-rounds.js';
import type { CheckSpec } from '@deepbuild/conformance';
import { Stacks, type StackWant } from './stacks.js';
import { HeavyQueue } from './heavy.js';
import { HubCanvas } from './hub-canvas.js';
import { docCheckIn, docCommand, docSpec } from './doc-checks.js';
import { refuse, Refused, refusal, ulid, type CoreOptions, type HookMeta } from './wire.js';
import type { Live, Counter, Routes } from './session-types.js';
import { DAY, sql, letters, ghToken, COMPLETION_PROMPTS, unseenTools, type Obj, isObj, misjudged, watching, waitingOn, READS, OWN_TURN } from "./hub-shared.js";

/** How long a landing's judgement waits for its verdict (#1331). */
const VERDICT_WAIT_MS = 30 * 60_000;

export interface StopJudgingOptions {
  settings: CoreOptions & { forge: string };
  doneSpec(cwd: string): unknown;
  services: {
    readonly tasks: AskTasks;
    readonly openItems: OpenItems;
    readonly now: () => number;
    readonly asks: Asks;
    readonly agents: Agents;
    readonly box: Box;
    readonly ledger: Ledger;
    readonly record: RecordStore;
    readonly gate: GateRunner;
    readonly raw: RecordStore['raw'];
    readonly leases: LeaseTable;
    readonly extensions: ExtensionHost | undefined;
    readonly sizing: SizeScope;
    readonly root: Root;
    readonly holds: Holds;
    readonly questions: Questions;
    readonly runner: Runner;
    readonly checkKinds: CheckKinds;
    readonly reviewRounds: Pick<ReviewRounds, "settled">;
    readonly store: EvidenceStore;
    readonly trust: ProjectTrust;
    readonly heavy: HeavyQueue;
    readonly host: Host;
    readonly runs: Runs;
    readonly stacks: Stacks;
    readonly canvasSide: HubCanvas;
  };
  state: () => Pick<SessionStatePort, "attention" | "live" | "sessions" | "startOf">;
  mcp: () => Pick<McpOperationsPort, "checksOf" | "pinOf">;
  delivery: () => Pick<AnswerDeliveryPort, "cap" | "deliver" | "handed" | "offer" | "promiseCarried" | "releases" | "unwoken" | "waiting" | "answers">;
  transcripts: () => Pick<TranscriptsPort, "cursors">;
  control: () => Pick<HubControlPort, "onSwitchedTree">;
  flags: () => Pick<SessionFlagsPort, "watchOnly">;
  events: Pick<HubEvents, "append" | "appendReading" | "connection">;
kernel: Pick<HubRuntime, "blocked" | "overrides" | "stopping">;
schedule: Pick<HookSchedule, "abandoned" | "askingNow" | "askingSoon" | "queue" | "wakeable">;

}

/** StopJudging: owns its domain state; services are resolved only when used. */
export class StopJudging {
  private readonly reply: StopReply;
  constructor(private readonly options: StopJudgingOptions) {
    const readclaimRequirements = () => this.claimRequirements;
    const readverdictWrites = () => this.verdictWrites;
    const readlanes = () => this.lanes;
    this.reply = new StopReply({ settings: options.settings, services: options.services, events: options.events, kernel: options.kernel, schedule: options.schedule, delivery: options.delivery, state: options.state, judging: () => ({ judging: (meta) => this.judging(meta), laneOf: (claim, until) => this.laneOf(claim, until), requirementsOf: (session) => this.requirementsOf(session), completion: (meta, claim, sendBack) => this.completion(meta, claim, sendBack), prDelivery: (judged) => this.prDelivery(judged), noWorkOnce: (session, claim) => this.noWorkOnce(session, claim), stallGate: (meta, claim, sendBack) => this.stallGate(meta, claim, sendBack), sizedAt: (claim, meta, deadline) => this.sizedAt(claim, meta, deadline), idleOrResumed: (meta, judged, sentBack) => this.idleOrResumed(meta, judged, sentBack), questionHolds: (session) => this.questionHolds(session), slowStop: (meta, r, claim, held) => this.slowStop(meta, r, claim, held), provisionalCarried: (session) => this.provisionalCarried(session), smallestOf: (claim) => this.smallestOf(claim), stopHold: (meta, r, until) => this.stopHold(meta, r, until), stillNeeded: (meta, claim) => this.stillNeeded(meta, claim), judgedLine: (live) => this.judgedLine(live), heldLine: (session, line) => this.heldLine(session, line), get claimRequirements() { return readclaimRequirements(); }, get verdictWrites() { return readverdictWrites(); }, get lanes() { return readlanes(); } }) });
  }

  /** The commands each claim's final message told you to run, which its gate ran as the agent's own checks (#323). */
  private readonly told = new Map<string, Set<string>>();

  /** Each session's last stop's final message, what its claims cite (#29). */
  readonly lastMessage = new Map<string, string>();

  /**
   * What the stop rule reads of each session's turns: whether no prompt has come since its start (a startup, a resume
   * or /clear), the prompt its turn began with, and whether the turn made an edit, a write or an ask.
   */
  readonly counters = new Map<string, Counter>();

  /** What each claim's stop waits on: its fast lane, and what the hold reports of it. */
  readonly lanes = new Map<string, Promise<{ fast: string[]; slow: string[]; snapshot: string; readyAt: number; budgetCost?: string[]; changed?: boolean; findings: string[] }>>();

  /** Each claim's requirements by handle, with the ID and text a send-back names (#322). */
  readonly claimRequirements = new Map<string, Map<string, { id: string; text: string }>>();

  /** Each claim's task, base and folder, for its size and scope at its stop (#324). */
  private readonly claimScopes = new Map<string, { task: string; base: string; cwd: string }>();
  /** The folder a claim was made in, which a stated speed's baseline is checked out from (#1863). */
  claimFolder(claim: string): string | undefined { return this.claimScopes.get(claim)?.cwd; }

  private readonly budgetAsks = new Map<string, BudgetInput>();

  private readonly paidChecks = new Map<string, Map<string, { paid: PaidKind; task: string }>>();

  /** The sessions whose next stop with no work may be sent on (#82): their stops are held for the reply. */
  readonly nudgeable = new Set<string>();

  /** The asks each session's no-work stops were sent back on once (#82); a judged stop starts it again. */
  readonly idleSent = new Map<string, Set<string>>();

  /** Each session's completion prompts in a row (#82): a stop that says something starts the count again. */
  readonly completions = new Map<string, number>();

  /** Each task's count toward a stalled claim, and each stalled claim's one decision by its ask (#325). */
  private readonly stalls = new Map<string, StallCount>();

  private readonly stallAsks = new Map<string, { task: string; session: string; agent: string }>();

  /** The tasks you accepted as proven, and the switches you decided stay off, by folder and name, with each switch's ask (#325). */
  private readonly accepted = new Set<string>();

  private readonly offDecided = new Set<string>();

  private readonly switchAsks = new Map<string, { key: string; name: string; deployed: string; task: string; issue: number; session: string; agent: string }>();

  /** Claims in an untrusted repo whose spec names checks (#322): watch-only, so none of them passes. */
  private readonly watchOnlyClaims = new Set<string>();

  /** Claims a target of whose requirements no longer resolves (#323): each verdict on them is INVALID, naming it. */
  readonly unresolvedTargets = new Map<string, { req: string; reason: string }[]>();

  /** Sessions told once that their repo's spec checks are watch-only until the project is trusted. */
  private readonly toldUntrusted = new Set<string>();

  /** How long each run still going is expected to take, in seconds, by run handle: what the line's "about" reads (#83). */
  private readonly expected = new Map<string, number>();

  /** Each claim's checks of a kind other than command, by check (#1537): its spec, and the claim's session for a review. */
  readonly kindChecks = new Map<string, Map<string, { spec: CheckSpec; of: ReviewOf }>>();

  /** Each claim's verdict on its way to the record after its lane (#82): what reads the record waits for it. */
  readonly verdictWrites = new Map<string, Promise<void>>();

  /** Each claim's last recorded verdict, by its hash: a verdict that didn't change isn't recorded again. */
  private readonly verdictsMade = new Map<string, string>();

  /** Each checkout's outside build, run once, as you, outside the sandbox; one that fails keeps its checks from starting, naming it. */
  private readonly outsideBuilds = new Map<string, Promise<void>>();

  /**
   * Why a `gh pr create` or `gh pr edit` whose body says `Closes #n` is refused (#322): a requirement of the issue's
   * open task that no verdict has passed keeps the PR at "Part of", and so does a review note on its PR that is
   * neither fixed nor accepted by you (#87); the refusal lists what's left; undefined when it may run.
   */
  async closesGate(session: string, command: string): Promise<string | undefined> {
    const issue = closesIssue(command);
    if (issue === undefined) return this.partOfGate(session, command);
    // The planted wrong program judges the bootstrap's commands alone: the issue's criteria never hold a PR back.
    if (this.options.settings.plant === 'bootstrap-commands-only') return undefined;
    const open = await this.options.services.tasks.unproven(session, issue);
    if (!open) return undefined;
    if (!open.locked) return `DeepBuild blocked this: the pull request can't say Closes #${issue} while the definition of ${open.task_ref} hasn't locked, so nothing of it is proven yet. Say Part of #${issue} instead, and list what's left.`;
    // What a split moved to a new issue, or all of it once you accepted what's proven, no longer keeps it open (#325).
    const moved = this.accepted.has(open.task_ref) ? undefined : await this.movedOut(open.task_ref);
    const unproven = moved ? open.left.filter((q) => !moved.has(q.id)) : [];
    if (unproven.length) {
      const left = unproven.map((q) => `${q.id} (${q.text})`).join('; ');
      return `DeepBuild blocked this: the pull request can't say Closes #${issue} while a requirement of ${open.task_ref} is unproven. Say Part of #${issue} instead, and list what's left: ${left}.`;
    }
    const notes = await this.options.services.openItems.openNotes(open.task_ref);
    if (notes.length) return `DeepBuild blocked this: the pull request can't say Closes #${issue} while a review note on it is neither fixed nor accepted. Fix each, or have it accepted through its ask, and say Part of #${issue} until then: ${notes.join('; ')}.`;
    // Nor until its release checks pass on its merge with main, and you decided its switches left off stay off (#325).
    return this.deliveryHeld(session, issue, open.task_ref);
  }

  /**
   * A pull request that says Part of #n (#82; design: Every stop is judged): its body lists, under that line, each
   * requirement of the issue's open task still unproven, so they land on the PR as its open items. Why it is refused
   * while one is missing, naming them; undefined when it may run.
   */
  private async partOfGate(session: string, command: string): Promise<string | undefined> {
    const issue = partOfIssue(command);
    if (issue === undefined) return undefined;
    const open = await this.options.services.tasks.unproven(session, issue);
    const missing = open?.left.filter((q) => !new RegExp(`\\b${q.id}\\b`).test(command.slice(command.search(/\bpart of\b/i)))) ?? [];
    if (!missing.length) return undefined;
    return `DeepBuild blocked this: the pull request says Part of #${issue}, so list under that line what's left of ${open!.task_ref}, as its open items: ${missing.map((q) => `${q.id} (${q.text})`).join('; ')}.`;
  }

  /**
   * A paid check's price, or its run's cost reading, from the tests' file (DEEP_HUB_TEST_PRICES); null, a price nobody
   * knows, without one.
   */
  priceOf(check: string, of: 'prices' | 'costs' = 'prices'): number | null {
    if (!this.options.settings.prices) return null;
    try {
      const table = (JSON.parse(readFileSync(this.options.settings.prices, 'utf8')) as Obj)[of];
      const usd = isObj(table) ? table[check] : undefined;
      return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : null;
    } catch {
      return null;
    }
  }

  /**
   * A definition just locked (#325; design: One budget): its paid checks priced, and you asked once for the issue's
   * budget, with the total, for one run of each until a week on. A price nobody knows asks nothing: those runs are
   * BLOCKED until priced, never free.
   */
  async priceLocked(d: { session: string; agent: string; task_ref: string; requirements: { id: string; check: string | null; paid?: PaidKind }[] }): Promise<void> {
    const pricing = await priceDefinition(d.requirements, async (c) => this.priceOf(c.check));
    const n = pricing.checks.length;
    if (!n) return;
    if (pricing.total_usd === null) {
      const unknown = pricing.checks.filter((c) => c.usd === null).map((c) => c.check);
      return this.options.events.appendReading(d.session, d.agent, `${d.task_ref}'s paid check${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')} ${unknown.length === 1 ? 'has' : 'have'} no price, so no budget is asked for yet and ${unknown.length === 1 ? 'its runs are' : 'their runs are'} BLOCKED until priced.`);
    }
    const usd = (v: number) => `$${v.toFixed(2)}`;
    const total = usd(pricing.total_usd);
    const ends = this.options.services.now() + 7 * DAY;
    const until = new Date(ends).toISOString().slice(0, 10);
    const budget: BudgetInput = { scope: { kind: 'issue', ref: d.task_ref }, runs: n, cap_usd: pricing.total_usd, ends };
    const listed = pricing.checks.map((c) => `${basename(c.check)} (${c.paid}) ${usd(c.usd!)}`).join(', ');
    const question = `${d.task_ref}'s definition locked with ${n} paid check${n === 1 ? '' : 's'}: ${listed}, ${total} in all. Approve a budget of ${total} for ${n === 1 ? 'its run' : `their ${n} runs`} until ${until}?`;
    const key = sha256Hex(canonicalize({ kind: 'budget.issue', task_ref: d.task_ref, budget } as unknown as JsonValue));
    const ask = await this.options.services.asks.raise(this.options.events.connection('core', { session: d.session, agent: d.agent }), 'budget.issue', {
      kind: 'authority', question, options: [{ id: 'approve', label: `Approve ${total}`, decision: 'allow' }, { id: 'decline', label: "Don't fund them", decision: 'deny' }],
      recommended: null, deadline: this.options.services.now() + DAY, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key, pinned_to: { kind: 'evidence', ref: key },
    }, { steps: [{ does: `Approve a budget of ${total} for ${d.task_ref}: ${listed}, until ${until}`, changes: [d.task_ref], undo: null, public: false, cost: pricing.total_usd }], diff: key });
    this.budgetAsks.set(ask, budget);
  }

  /** Your answer to an ask the done gate raised (#325): an issue's budget approved, a stalled claim split, funded or accepted, a switch left off. */
  delivery(d: Delivery): void {
    if (this.options.services.agents.delivered(d.ask, d.option, d.decision)) return;
    if (this.options.services.box.delivered(d.ask, d.option)) return;
    const fail = (what: string) => (error: unknown) => process.stderr.write(`deep hub: ${what} for ${d.ask} was not recorded: ${error instanceof Error ? error.message : String(error)}\n`);
    const budget = this.budgetAsks.get(d.ask);
    if (budget) {
      this.budgetAsks.delete(d.ask);
      if (d.decision === 'allow') void this.options.services.ledger.approveOn(this.options.events.connection('core'), d.ask, budget).catch(fail('the budget'));
      return;
    }
    const stall = this.stallAsks.get(d.ask);
    if (stall) {
      this.stallAsks.delete(d.ask);
      if (d.option === 'split') void this.split(d.ask, stall).catch(fail('the split'));
      // What's proven is accepted: the rest is dropped, and the issue may close.
      else if (d.option === 'accept') this.accepted.add(stall.task);
      // Funded: the send-backs start again from round 1.
      else if (d.option === 'fund') this.stalls.delete(stall.task);
      return;
    }
    const off = this.switchAsks.get(d.ask);
    if (off && d.option === 'stay-off') {
      this.switchAsks.delete(d.ask);
      this.offDecided.add(off.key);
      void this.followUp(d.ask, off).catch(fail('the follow-up'));
    }
  }

  /** The decision the asks core saved from your answer to `ask`, which lands just after the answer is handed on; null when none does. */
  private async decisionOf(ask: string): Promise<string | null> {
    for (let i = 0; i < 30; i++) {
      const [row] = (await this.options.services.record.raw(`SELECT id FROM events WHERE kind = 'decision.created' AND json_extract(data, '$.ask') = ? ORDER BY log_pos DESC LIMIT 1`, [ask])) as { id: string }[];
      if (row) return `decision:${row.id}`;
      await new Promise((done) => setTimeout(done, 100));
    }
    return null;
  }

  /**
   * A stalled claim you split (#325): what's proven closes now, and the rest moves to a new issue, drafted with what
   * each item needs. The draft is recorded; nothing is filed for you.
   */
  private async split(ask: string, s: { task: string; session: string; agent: string }): Promise<void> {
    const left = await this.options.services.tasks.leftOf(s.task) ?? [];
    const decision = await this.decisionOf(ask);
    const items = left.map((r) => ({ id: r.id, text: r.text, needs: r.check ? `its check ${r.check} to pass${r.paid ? `, a ${r.paid} the issue's budget pays for` : ''}` : 'a check that proves it' }));
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', { session: s.session, agent: s.agent }), {
      v: 1, id: ulid(ts), kind: 'issue.drafted', ts, subject: ask,
      data: {
        task_ref: s.task, issue: s.task, because: 'split', decision, title: `The rest of ${s.task}: ${items.map((i) => i.text).join('; ') || 'nothing left'}`.slice(0, 200), items,
        follow_up: `File this issue for what the split moved out of ${s.task}; ${s.task} closes with what's proven.`,
      },
    });
  }

  /** A switch you decided stays off (#325): the decision is saved with its follow-up, a drafted issue to turn it on. */
  private async followUp(ask: string, off: { name: string; deployed: string; task: string; issue: number; session: string; agent: string }): Promise<void> {
    const decision = await this.decisionOf(ask);
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', { session: off.session, agent: off.agent }), {
      v: 1, id: ulid(ts), kind: 'issue.drafted', ts, subject: ask,
      data: {
        task_ref: off.task, issue: `#${off.issue}`, because: 'switch', decision, title: `Turn ${off.name} on where it's deployed`,
        items: [{ id: off.name, text: `${off.name} is on where it's deployed`, needs: `${off.name} switched on in ${off.deployed}, and #${off.issue}'s checks run again with it on` }],
        follow_up: `Turn ${off.name} on in ${off.deployed} and check #${off.issue}'s change with it on: you decided it stays off for now${decision ? ` (${decision})` : ''}.`,
      },
    });
  }

  /**
   * What keeps a pull request whose requirements all passed at Part of (#325; design: Done means switched on): a
   * release check that hasn't passed on the PR's commit merged with main, and a switch the change adds that's off or
   * unset where it's deployed, until you decide it stays off; you're asked about each such switch once.
   */
  private async deliveryHeld(session: string, issue: number, task: string): Promise<string | undefined> {
    const cwd = this.options.state().live.get(session)?.cwd;
    if (!cwd) return undefined;
    const spec = releaseSpec(cwd);
    const instead = `Say Part of #${issue} instead`;
    if (spec.checks.length) {
      const head = (await headOf(cwd).catch(() => undefined))?.sha;
      const merged = head ? await mergedWithMain(cwd, head) : undefined;
      if (merged && 'conflict' in merged) return `DeepBuild blocked this: the pull request can't say Closes #${issue}: ${merged.conflict}, so its release checks (${spec.checks.join(', ')}) can't pass on its merge with main. ${instead}.`;
      if (merged) {
        const rows = (await this.options.services.record.raw(`SELECT check_id, outcome FROM runs WHERE commit_sha = ? AND ended IS NOT NULL ORDER BY started`, [merged.commit])) as { check_id: string; outcome: string | null }[];
        const last = new Map(rows.map((r) => [r.check_id, r.outcome]));
        const open = spec.checks.filter((c) => last.get(c) !== 'passed');
        if (open.length) {
          const said = open.map((c) => `${c} ${last.has(c) ? `${last.get(c) ?? 'ended'} there` : 'is still to run there'}`).join('; ');
          return `DeepBuild blocked this: the pull request can't say Closes #${issue} until the repo's release check${open.length === 1 ? '' : 's'} pass${open.length === 1 ? 'es' : ''} on its commit merged with main (${merged.commit.slice(0, 12)}): ${said}. ${instead}; the PR's claim runs ${open.length === 1 ? 'it' : 'them'} there in the slow lane.`;
        }
      }
    }
    if (spec.switches) {
      const [row] = (await this.options.services.record.raw(`SELECT base_commit FROM definitions WHERE task_ref = ? LIMIT 1`, [task])) as { base_commit: string | null }[];
      const base = row?.base_commit;
      if (base) {
        const off = (await switchesOff(cwd, base, spec.switches)).filter((w) => !this.offDecided.has(`${cwd}\0${w.name}`));
        if (off.length) {
          for (const w of off) await this.askSwitch(session, cwd, task, issue, w, spec.switches.deployed).catch(() => undefined);
          const named = off.map((w) => `${w.name} (${w.state === 'off' ? 'off' : 'unset'} in ${spec.switches!.deployed})`).join(' and ');
          return `DeepBuild blocked this: the pull request can't say Closes #${issue} while the change ships behind ${named}, until you decide ${off.length === 1 ? 'it stays' : 'they stay'} off; you're asked in your inbox. ${instead}.`;
        }
      }
    }
    return undefined;
  }

  /** Asks you once whether a switch the change adds stays off where it's deployed (#325). */
  private async askSwitch(session: string, cwd: string, task: string, issue: number, w: { name: string; state: 'off' | 'unset' }, deployed: string): Promise<void> {
    const key = `${cwd}\0${w.name}`;
    if ([...this.switchAsks.values()].some((a) => a.key === key)) return;
    const agent = this.options.state().live.get(session)?.agent ?? 'claude-code';
    const question = `The change for #${issue} ships behind ${w.name}, which is ${w.state === 'off' ? 'off' : 'unset'} where it's deployed (${deployed}). Does it stay off for now? Then the pull request may say Closes, with a follow-up to turn ${w.name} on.`;
    const ask = await this.options.services.asks.raise(this.options.events.connection('core', { session, agent }), 'switch.off', {
      kind: 'exception', question,
      options: [{ id: 'stay-off', label: `${w.name} stays off: close it with a follow-up to turn it on`, decision: 'none' }, { id: 'not-yet', label: "Keep the pull request at Part of until it's on", decision: 'none' }],
      recommended: 'stay-off', deadline: this.options.services.now() + 2 * DAY, fallback: 'you', default: 'not-yet', provisional: false, owner: 'you',
      key: sha256Hex(canonicalize({ kind: 'switch.off', cwd, name: w.name })), pinned_to: await this.options.mcp().pinOf(cwd, question),
    });
    this.switchAsks.set(ask, { key, name: w.name, deployed, task, issue, session, agent });
  }

  /**
   * A stop that would be sent back, against its task's count toward a stalled claim (#325; design: Stalled claims): sent
   * back as round n of 3, or not, once the open items came back unchanged on two stops in a row or three send-backs
   * passed without new evidence, when the claim becomes one decision for you. While a question holds the send-back
   * the stop isn't sent back and counts toward neither. What the stop is sent back with, or nothing.
   */
  async stallGate(meta: HookMeta, claim: string, sendBack: string | undefined): Promise<string | undefined> {
    const [row] = (await this.options.services.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
    const task = row?.subject_ref;
    if (!task) return sendBack;
    const standing = this.options.services.gate.standing(claim);
    if (!sendBack) {
      // A green claim starts the count again.
      if (standing.length && standing.every((c) => c.result === 'PASS')) this.stalls.delete(task);
      return undefined;
    }
    const held = await this.questionHolds(meta.session);
    // The planted wrong program counts the stops a question holds, though it still doesn't send them back.
    if (held && this.options.settings.plant !== 'counts-waiting-stops') return undefined;
    const items = [...standing.filter((c) => c.result !== 'PASS').map((c) => `${c.check}: ${c.result}`), ...leftOpen(this.lastMessage.get(meta.session) ?? '').map((o) => o.text)];
    const runs = ((await this.options.services.record.raw(`SELECT id FROM runs WHERE claim_id = ?`, [claim.slice(6)])) as { id: string }[]).map((r) => r.id);
    let count = this.stalls.get(task);
    if (!count) this.stalls.set(task, count = freshCount());
    // The planted wrong program counts any new run as new evidence, whatever its result.
    const fate = judgeStop(count, { items, passing: standing.filter((c) => c.result === 'PASS').map((c) => c.check), runs }, this.options.settings.plant === 'new-run-is-evidence');
    if (fate.sendBack) {
      if (held) return undefined;
      const [verdict] = (await this.options.services.record.raw(`SELECT handle FROM verdicts WHERE claim_id = ? ORDER BY created DESC LIMIT 1`, [claim.slice(6)])) as { handle: string | null }[];
      const ts = this.options.services.now();
      if (verdict?.handle) await this.options.events.append(this.options.events.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'claim.sent_back', ts, subject: claim, data: { claim, verdict: verdict.handle, round: fate.round, to: `session:${letters(meta.session)}` } });
      return sendBack;
    }
    if (fate.stalled) await this.stalled(meta, claim, task, fate.stalled);
    return undefined;
  }

  /** The session's newest claim's line as it stands, when a question holds its send-back; undefined otherwise. */
  async lineStanding(session: string): Promise<string | undefined> {
    if (!await this.questionHolds(session)) return undefined;
    const claim = this.options.state().live.get(session)?.claim ?? await newestClaim(this.options.services.raw, session).then((id) => (id ? `claim:${id}` : undefined));
    const state = claim ? await this.stateOf(claim) : undefined;
    return state ? this.heldLine(session, verdictLine(state.state)) : undefined;
  }

  /** A line while a question holds the send-back: the session wasn't sent back, so it names the FAIL and that the next step is yours. */
  async heldLine(session: string, line: string): Promise<string> {
    return await this.questionHolds(session) ? line.replace(/^sent back \d+\/\d+/, 'FAIL').replace(/\bnext: agent\b/, 'next: you') : line;
  }

  /** The requirements of a session's open ask-tasks, as a definition locked them: what a question can name. */
  async requirementsOf(session: string): Promise<{ id: string; text: string }[]> {
    const rows = (await this.options.services.record.raw(`SELECT requirements FROM definitions WHERE task_ref IN (SELECT subject_ref FROM claims WHERE session_id = ?) OR task_ref IN (SELECT j.value FROM events e, json_each(e.data, '$.tasks') j WHERE e.session_id = ? AND e.kind = 'user.ask')`, [session, session])) as { requirements: string | null }[];
    return rows.flatMap((r) => (JSON.parse(r.requirements ?? '[]') as { id: string; text: string }[]).map((q) => ({ id: q.id, text: q.text })));
  }

  /** The newest verdict's smallest failing case for a claim, in words for the reply that carries it. */
  async smallestOf(claim: string): Promise<string | undefined> {
    await this.verdictWrites.get(claim)?.catch(() => undefined);
    const [row] = (await this.options.services.record.raw(`SELECT smallest, requirements FROM verdicts WHERE claim_id = ? ORDER BY created DESC LIMIT 1`, [claim.slice(6)])) as { smallest: string | null; requirements: string | null }[];
    const failing = (JSON.parse(row?.requirements ?? '[]') as { outcome?: string; smallest?: string }[]).find((q) => q.outcome === 'FAIL' && q.smallest)?.smallest ?? row?.smallest;
    return failing ? `Its smallest failing case: ${failing}` : undefined;
  }

  /** The recommended options of the provisional asks the session has open, as the reply that goes on with them says it. */
  async provisionalCarried(session: string): Promise<string | undefined> {
    const rows = (await this.options.services.record.raw(`SELECT id, options, recommended FROM asks WHERE session_id = ? AND status IN ('open', 'later') AND provisional = 1`, [session])) as { id: string; options: string | null; recommended: string | null }[];
    const said = rows.map((r) => `ask:${r.id} goes on with ${(JSON.parse(r.options ?? '[]') as { id: string; label: string }[]).find((o) => o.id === r.recommended)?.label ?? r.recommended}, marked as undoable`);
    return said.length ? `DeepBuild: ${said.join('; ')}.` : undefined;
  }

  /** What a session really has, for the could-the-agent-do-it check (#84): its servers' tools and what it leases. */
  async reachOfSession(session: string): Promise<Reach> {
    const lists = (await this.options.services.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'mcp.tools_listed'`, [session])) as { data: string }[];
    const cwd = this.options.state().sessions.get(session)?.cwd ?? '';
    const tools = lists.flatMap((l) => {
      const { server, tools: listed } = JSON.parse(l.data) as { server: string; tools: { name: string }[] };
      return listed.map((t): ReachTool => ({ name: `mcp__${server}__${t.name}`, kind: /computer/.test(server) ? 'computer' : 'mcp', connector: server, read_only: countMcp(server, t.name, cwd).counts === 'read' }));
    });
    const leases = (await this.options.services.leases.leases()).filter((v) => v.lease.holder === `mcp:${session}`);
    const profiles = leases.filter((v) => v.lease.resource.kind === 'browser-profile').map((v) => { const [provider = '', profile = ''] = v.lease.resource.key.split(':'); return { profile, provider, leased: true }; });
    return reachOf({ tools, profiles, credentials: await this.options.services.extensions?.heldSecrets().catch(() => []) ?? [] });
  }

  /**
   * Whether a question holds a session's send-back (#325; design: A question holds the send-back): a step only you can
   * take, an exception, or a taste call or choice that isn't provisional, open, or answered and not yet delivered.
   */
  async questionHolds(session: string): Promise<boolean> {
    // The planted wrong programs: one gate never holds, the other holds for every ask, authority and provisional too.
    if (this.options.settings.plant === 'sends-back-held-stop' || this.options.settings.plant === 'hold-as-choice') return false;
    if (this.options.settings.plant === 'holds-every-ask') return (await this.options.services.record.raw(`SELECT 1 FROM asks WHERE session_id = ? AND status IN ('open', 'later') LIMIT 1`, [session])).length > 0;
    const asks = (await this.options.services.record.raw(`SELECT key FROM asks WHERE session_id = ? AND status IN ('open', 'later', 'answered') AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered')
      AND (kind IN ('unblock', 'exception') OR (kind IN ('taste', 'choice') AND provisional = 0))`, [session])) as { key: string }[];
    if (!asks.length) return false;
    // Size and scope's own asks (#324) are DeepBuild's readings, not a question the agent left: they hold no send-back.
    const sized = await this.options.services.sizing.keysIn(session);
    return asks.some((a) => !sized.has(a.key));
  }

  /**
   * The stop of a turn that opened the pull request your ask asked for (#82): the words that keep the agent working on
   * the requirements still unmet in that same pull request, or null when none is unmet or your ask says the pull
   * request ends the work. Undefined for any other stop.
   */
  async prDelivery(judged: Live): Promise<string | null | undefined> {
    const pr = judged.prOpened;
    if (!pr || !judged.turnAsk || !judged.claim) return undefined;
    const [ask] = (await this.options.services.record.raw(`SELECT json_extract(data, '$.text') AS text FROM events WHERE id = ? AND kind = 'user.ask'`, [judged.turnAsk])) as { text: string | null }[];
    const text = ask?.text ?? '';
    if (!/\b(?:pull request|PR)\b/i.test(text)) return undefined;
    const open = this.openRequirements(judged.claim);
    if (!open.length || /\b(?:ends? the work|stop there|then stop|and stop)\b/i.test(text)) return null;
    return `DeepBuild: ${pr} is open as Part of its issue, with ${open.join(', ')} still unmet. Keep working on ${open.length === 1 ? 'it' : 'them'} in the same pull request: push to its branch, open no new one.`;
  }

  /**
   * What each requirement of a claim whose verdict is pending or INCONCLUSIVE still waits for (#82): a run of its
   * check, or your answer where no check covers it; nothing for one passed or failed.
   */
  private needsOf(claim: string): string[] {
    const v = this.options.services.gate.verdictOf(claim);
    const named = this.claimRequirements.get(claim);
    if (!v || !named) return [];
    const standing = this.options.services.gate.standing(claim);
    return v.requirements.filter((q) => q.outcome === 'pending' || q.outcome === 'INCONCLUSIVE').flatMap((q) => {
      const n = named.get(q.req);
      if (!n) return [];
      const on = standing.filter((c) => c.covers.includes(q.req) && c.result !== 'PASS');
      return [`${n.id} ("${n.text}") waits for ${on.length ? on.map((c) => `${c.result === 'INCONCLUSIVE' ? 'another run' : 'a run'} of ${c.check}`).join(' and ') : 'your answer'}`];
    });
  }

  /** Records what a claim the stop let through still needs, as open items of its task (#82). */
  async stillNeeded(meta: HookMeta, claim: string): Promise<void> {
    const needs = this.needsOf(claim);
    if (!needs.length) return;
    const [row] = (await this.options.services.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
    if (row?.subject_ref) await this.options.services.openItems.stillNeeded({ session: meta.session, agent: meta.agent, task: row.subject_ref, cwd: meta.cwd }, needs);
  }

  /** The requirements of a claim its standing checks haven't all passed, by ID and text; else its checks not passed. */
  private openRequirements(claim: string): string[] {
    const standing = this.options.services.gate.standing(claim);
    const passed = (req: string) => { const on = standing.filter((c) => c.covers.includes(req)); return on.length > 0 && on.every((c) => c.result === 'PASS'); };
    const reqs = [...(this.claimRequirements.get(claim) ?? [])].filter(([req]) => !passed(req)).map(([, q]) => `${q.id} ("${q.text}")`);
    return reqs.length ? reqs : standing.filter((c) => c.result !== 'PASS').map((c) => c.check);
  }

  /**
   * A judged stop's completion prompt (#82; design: Every stop is judged): when its final message is empty or says
   * nothing and a requirement of its claim is still open, the prompt naming them, with the send-back's failing case
   * when there is one; at the fourth such stop in a row, the claim stalls and the prompt is null. Undefined for a stop
   * that said something or left nothing open, which also starts the count again.
   */
  async completion(meta: HookMeta, claim: string, sendBack: string | undefined): Promise<string | null | undefined> {
    if (!endsEmpty(meta.fields?.last_assistant_message ?? '')) { this.completions.delete(meta.session); return undefined; }
    const open = this.openRequirements(claim);
    if (!open.length) { this.completions.delete(meta.session); return undefined; }
    const n = (this.completions.get(meta.session) ?? 0) + 1;
    this.completions.set(meta.session, n);
    if (n > COMPLETION_PROMPTS) {
      const [row] = (await this.options.services.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
      if (n === COMPLETION_PROMPTS + 1 && row?.subject_ref) await this.stalled(meta, claim, row.subject_ref, 'four stops in a row did work and ended on an empty message');
      return null;
    }
    const prompt = `DeepBuild: this turn did work but ended on an empty message, with ${open.join(', ')} still open. Go on with the work, or end the turn saying what you did and what's still open (completion prompt ${n} of ${COMPLETION_PROMPTS}).`;
    return sendBack ? `${sendBack}\n\n${prompt}` : prompt;
  }

  /** Whether this stop, with no work in it, is its claim's ask's one send-back (#82): true once per ask until work is done again. */
  async noWorkOnce(session: string, claim: string): Promise<boolean> {
    if (this.options.state().live.get(session)?.idle !== true || this.options.settings.plant === 'no-work-never-sent-back') return false;
    const [row] = (await this.options.services.record.raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
    const sent = this.idleSent.get(session) ?? new Set<string>();
    if (!row?.subject_ref || sent.has(row.subject_ref)) return false;
    this.idleSent.set(session, sent.add(row.subject_ref));
    return true;
  }

  /**
   * What a stop that isn't sent back on its checks is sent on with (#82; design: Every stop is judged): after the app's
   * own resume prompt, when the interrupted turn had done work and asks are open, one automatic continue; a stop with
   * no work that isn't an answer, leaving an ask open, one send-back naming the requirements still unmet per ask, and
   * after it the ask's row says the session is idle with it open. Undefined for any other stop.
   */
  async idleOrResumed(meta: HookMeta, judged: Live | undefined, sentBack: boolean): Promise<string | undefined> {
    const live = this.options.state().live.get(meta.session);
    if (!live) return undefined;
    const resumed = live.resumed === true;
    live.resumed = false;
    // A stop sent back on its checks needs no other push, and a question that holds the send-back holds this too.
    if (sentBack || await this.questionHolds(meta.session)) return undefined;
    // The planted wrong program drops the send-back of every stop with no work in it.
    const idle = live.idle === true && this.options.settings.plant !== 'no-work-never-sent-back';
    if (!resumed && !idle) {
      if (judged) { this.idleSent.delete(meta.session); this.nudgeable.add(meta.session); }
      return undefined;
    }
    const open = await this.options.services.tasks.stillOpen(meta.session);
    if (!open.length) { this.nudgeable.delete(meta.session); this.options.schedule.askingSoon(); return undefined; }
    const named = (left: { id: string; text: string }[]) => left.map((q) => `${q.id} ("${q.text}")`).join(', ');
    if (resumed && live.cutOff) {
      live.cutOff = false;
      // The continue is the one push its asks get: a later stop with no work isn't sent back on them.
      this.idleSent.set(meta.session, new Set(open.map((o) => o.task_ref)));
      const asks = open.map((o) => `${o.task_ref}: ${named(o.left)}`).join('; ');
      return `DeepBuild: the app restarted while this session was working, with ${asks} still unmet. Continue where you left off; this is its one automatic continue.`;
    }
    if (!idle) return undefined;
    const sent = this.idleSent.get(meta.session) ?? new Set<string>();
    this.idleSent.set(meta.session, sent);
    const due = open.filter((o) => !sent.has(o.task_ref));
    if (!due.length) {
      this.nudgeable.delete(meta.session);
      this.options.schedule.askingSoon();
      await this.options.events.appendReading(meta.session, meta.agent, `The session is idle with ${open.map((o) => o.task_ref).join(', ')} open.`).catch(() => undefined);
      return undefined;
    }
    for (const o of due) sent.add(o.task_ref);
    return `DeepBuild: this stop did no work, and ${due.map((o) => `${o.task_ref} still has ${named(o.left)} unmet`).join('; ')}. Work on ${due.length === 1 ? 'it' : 'them'}, or say what keeps you from it.`;
  }

  /** A claim that stalled (#325): recorded, and one decision for you instead of another send-back: split the issue, fund the live runs, or accept what's proven. */
  private async stalled(meta: HookMeta, claim: string, task: string, rule: StallRule): Promise<void> {
    const core = this.options.events.connection('core', { session: meta.session, agent: meta.agent });
    const ts = this.options.services.now();
    await this.options.events.append(core, { v: 1, id: ulid(ts), kind: 'claim.stalled', ts, subject: claim, data: { claim, rule } });
    const left = await this.options.services.tasks.leftOf(task) ?? [];
    const named = left.length ? left.map((r) => `${r.id} ("${r.text}")`).join(', ') : 'its open items';
    const question = `The claim on ${task} stalled: ${rule} and no new passing evidence, with ${named} still open, so DeepBuild stopped sending the agent back. Split the issue (what's proven closes now, and the rest moves to a new issue with what each item needs), fund the live runs it needs, or accept what's proven?`;
    const ask = await this.options.services.asks.raise(core, 'claim.stalled', {
      kind: 'exception', question,
      options: [{ id: 'split', label: "Split the issue: what's proven closes now", decision: 'none' }, { id: 'fund', label: 'Fund the live runs it needs', decision: 'none' }, { id: 'accept', label: "Accept what's proven", decision: 'none' }],
      recommended: 'split', deadline: this.options.services.now() + 2 * DAY, fallback: 'you', default: 'split', provisional: false, owner: 'you',
      key: sha256Hex(canonicalize({ kind: 'claim.stalled', task, claim })), pinned_to: await this.options.mcp().pinOf(meta.cwd, question),
    });
    this.stallAsks.set(ask, { task, session: meta.session, agent: meta.agent });
    await this.options.events.appendReading(meta.session, meta.agent, `${claim} stalled (${rule}), so it isn't sent back again: it reaches you as one decision, ${ask}.`).catch(() => undefined);
  }

  /** The requirements a split moved to a new issue, by ID, from the record. */
  private async movedOut(task: string): Promise<Set<string>> {
    const rows = (await this.options.services.record.raw(`SELECT data FROM events WHERE kind = 'issue.drafted' AND json_extract(data, '$.task_ref') = ? AND json_extract(data, '$.because') = 'split'`, [task])) as { data: string }[];
    return new Set(rows.flatMap((r) => (JSON.parse(r.data) as { items: { id: string }[] }).items.map((i) => i.id)));
  }

  /**
   * A pull request's claim runs the repo's release checks on the PR's commit merged with main (#325): each as a spec
   * check pinned to that commit, in the slow lane, once per head; one that can't merge fails, naming the conflict.
   */
  private async releaseChecks(cwd: string, head: string): Promise<ClaimCheck[]> {
    const names = releaseSpec(cwd).checks;
    if (!names.length || !/^[0-9a-f]{40}$/.test(head) || /^0+$/.test(head)) return [];
    const merged = await mergedWithMain(cwd, head);
    if (!merged) return [];
    const checks = this.options.mcp().checksOf(cwd);
    return names.flatMap((name) => {
      const check = checks.get(name);
      if (!check) return [];
      const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
      const conflict = 'conflict' in merged ? merged.conflict : undefined;
      const command = conflict ? `printf '%s\\n' ${shellQuote(conflict)} >&2; exit 1` : check.run;
      return [{ check: name, approved: null, command, covers: [], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], source: 'spec' as const, commit: 'commit' in merged ? merged.commit : head, ...(deadline ? { deadline_ms: deadline } : {}) }];
    });
  }

  /** Background work held a session's slow checks 30 minutes: they start now, and its row names what still runs (#907). */
  async backgroundCapped(session: string, checks: string[]): Promise<void> {
    const live = this.options.state().live.get(session);
    const still = [...(live?.background.values() ?? [])].map((b) => b.what);
    await this.options.schedule.queue(() => this.options.events.appendReading(session, live?.agent ?? 'claude-code', `${checks.join(', ')} waited 30 minutes for work in the background and ${checks.length === 1 ? 'starts' : 'start'} now${still.length ? `; still running: ${backgrounded(still)}, which DeepBuild leaves running` : ''}.`));
  }

  /**
   * A claim's fast lane as the stop's hold sees it (#29), waited for until `until`: the validity gate's findings and a
   * fast-lane check that failed send the claim back, naming what's missing or which check failed.
   */
  async laneOf(claim: string, until: number): Promise<{ fast: string[]; slow: string[]; readyAt: number; budgetCost?: string[]; changed?: boolean; sendBack?: string } | undefined> {
    const lane = this.lanes.get(claim);
    if (!lane) return undefined;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<undefined>((done) => { timer = setTimeout(() => done(undefined), Math.max(0, until - Date.now())); });
    const ran = await Promise.race([lane.catch(() => undefined), late]).finally(() => clearTimeout(timer));
    if (!ran) return undefined;
    // A send-back is a FAIL's (or a BLOCKED's cause): an INVALID names a check or a definition the agent can't change,
    // so it is recorded for a person, never sent back.
    // A definition still to lock, or held by a cause outside the code, is never a send-back (#322).
    const failed = this.options.services.gate.standing(claim).filter((c) => c.lane === 'fast' && (c.result === 'FAIL' || (c.result === 'BLOCKED' && c.holds)));
    // The message names the missing proof precisely (#322): each requirement left unproven, by its ID and text, with
    // the check that fails it, or the spec's check by name; never just "tests failed".
    const named = this.claimRequirements.get(claim);
    const sendBack = ran.findings.length ? `DeepBuild sent this claim back before any check ran:\n${ran.findings.map((f) => `- ${f}`).join('\n')}`
      : failed.length ? `DeepBuild sent this claim back: ${failed.map((c) => {
        const reqs = c.covers.map((req) => named?.get(req)).filter((q): q is { id: string; text: string } => q !== undefined);
        if (this.told.get(claim)?.has(c.check)) return `the command your final message tells you to run, \`${c.check}\`, ${c.result === 'FAIL' ? 'fails' : c.result}:\n${this.options.services.gate.outputOf(claim, c.check)}`;
        return reqs.length ? `${reqs.map((q) => `${q.id} ("${q.text}")`).join(' and ')} ${reqs.length === 1 ? 'is' : 'are'} unproven: its check ${c.check} ${c.result}` : `the repo's spec check ${c.check} ${c.result}`;
      }).join('; ')}.` : undefined;
    return { fast: ran.fast, slow: ran.slow, readyAt: ran.readyAt, ...(ran.budgetCost ? { budgetCost: ran.budgetCost } : {}), ...(ran.changed === undefined ? {} : { changed: ran.changed }), ...(sendBack ? { sendBack } : {}) };
  }

  /**
   * A judged stop's size and scope (#324): measured and recorded as claim.sized; what it sends back once, or undefined.
   * A question that holds the send-back (#325) holds it too, and nothing is spent: sent back or asked once it's answered.
   */
  async sizedAt(claim: string, meta: HookMeta, deadline: number): Promise<string | undefined> {
    const c = this.claimScopes.get(claim);
    if (!c) return undefined;
    const requirements = [...(this.claimRequirements.get(claim)?.values() ?? [])];
    const holds = await this.questionHolds(meta.session).catch(() => false);
    return this.options.services.sizing.atStop({ claim, ...c, session: meta.session, agent: meta.agent, requirements, reached: this.options.services.gate.reached(claim), holds, deadline }).catch(async (e: unknown) => {
      await this.options.events.appendReading(meta.session, meta.agent, `This stop's size and scope could not be read: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    });
  }

  /**
   * A Codex stop with slow checks (#39): held for them only when each one's deadline ends at least 5 s before the Stop
   * entry's timeout, so a FAIL reaches the agent in the same turn; otherwise replied at once, with the row saying why,
   * and the verdict comes with the next message. What it is sent back with, or nothing.
   */
  async slowStop(meta: HookMeta, r: Routes, claim: string, held: number): Promise<string | undefined> {
    const timeoutS = stopTimeoutS(this.options.services.root.dir) ?? 600;
    const slowClaims = (r.slowClaims ??= []);
    const verdictLater = async (why: string) => {
      // A claim the agent stopped on again is told once, and said once.
      if (slowClaims.includes(claim)) return;
      slowClaims.push(claim);
      await this.options.events.appendReading(meta.session, meta.agent, `This stop isn't held: ${why}. Its verdict comes with your next message.`).catch(() => undefined);
    };
    // Something already sends the agent on: the turn isn't ending, so no slow check starts.
    const waiting = () => this.options.schedule.queue(() => this.options.delivery().answers.waitingFor(meta.session));
    if (r.sendBacks.length || (await waiting()).length) return undefined;
    const deadlines = this.options.services.gate.slowDeadlines(claim);
    const late = deadlines.find((c) => c.deadline_ms === null || !holdsFor(c.deadline_ms, timeoutS));
    await this.options.services.gate.turnEnded(claim);
    if (late) {
      const deadline = late.deadline_ms === null ? 'has no deadline' : `has a deadline of ${words(late.deadline_ms)}`;
      await verdictLater(`${late.check} ${deadline}, which must end at least 5 s before Codex's Stop hook timeout, ${timeoutS} s`);
      return undefined;
    }
    // Measured from now, with the check started: `held` already ends 5 s before the timeout, counted from the stop.
    const unstarted = this.options.services.gate.slowUnstarted(claim);
    if (unstarted.length) { await verdictLater(`${unstarted[0]} is waiting for a CPU slot, so its deadline can't be kept before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    const tight = deadlines.find((c) => Date.now() + c.deadline_ms! > held);
    if (tight) { await verdictLater(`${tight.check} has a deadline of ${words(tight.deadline_ms!)}, which no longer ends at least 5 s before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    while (Date.now() < held && this.options.services.gate.slowStanding(claim).pending) {
      await this.options.services.gate.slowEnded(claim, Math.min(held, Date.now() + 500));
      // An answer goes back at once; the check's verdict then comes with your next message.
      if (r.sendBacks.length || (await waiting()).length) { if (!slowClaims.includes(claim)) slowClaims.push(claim); return undefined; }
    }
    const standing = this.options.services.gate.slowStanding(claim);
    if (standing.pending) { await verdictLater(`its checks were still going when the hold ended, 5 s before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    return standing.failed.length ? `DeepBuild sent this claim back: ${standing.failed.join(', ')}.` : undefined;
  }

  /** The verdicts of the slow checks no stop was held for, once each has ended: what a prompt carries, or nothing. */
  slowVerdicts(r: Routes): string | undefined {
    const told: string[] = [];
    r.slowClaims = (r.slowClaims ?? []).filter((claim) => {
      const { pending, failed } = this.options.services.gate.slowStanding(claim);
      if (pending) return true;
      if (failed.length) told.push(`DeepBuild sent this claim back: ${failed.join(', ')}.`);
      return false;
    });
    return told.join('\n') || undefined;
  }

  /** A stop held while the agent left a question: what it is sent back with, or nothing. */
  async stopHold(meta: HookMeta, r: Routes, until: number): Promise<string | undefined> {
    const session = meta.session;
    // A promised check that came due while no route could wake the session goes back with this stop (#120).
    const promised = await this.options.schedule.queue(() => this.options.delivery().promiseCarried(session, 'stop_hold'));
    if (promised) return promised;
    // Size and scope's own asks (#324) wait days for you and the agent didn't ask them: an open one holds no stop,
    // though your answer to one, once given, is delivered here like any other.
    const sized = await this.options.services.sizing.keysIn(session).catch(() => new Set<string>());
    const open = async () => ((await this.options.services.record.raw(`SELECT key, status FROM asks WHERE session_id = ? AND (status = 'answered' OR (status IN ('open', 'later') AND provisional = 0)) AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered')`, [session])) as { key: string; status: string }[])
      .some((a) => a.status === 'answered' || (!sized.has(a.key) && !this.options.services.holds.offers.has(a.key)));
    if (this.options.settings.plant !== 'no-stop-count' && r.continued >= this.options.delivery().cap()) {
      // One more block would pass Claude Code's cap and be overridden: what would continue the turn waits for its next prompt.
      if (!r.sendBacks.length && !await open()) return undefined;
      r.later.push(...r.sendBacks.splice(0));
      r.capped = true;
      this.options.schedule.askingSoon();
      await this.options.events.appendReading(session, meta.agent, `This turn's stop was sent back ${r.continued} times in a row with no tool call between, Claude Code's cap of ${this.options.delivery().cap()} stop-hook continuations, so the next would be overridden: what waits for this session goes with its next prompt instead.`).catch(() => undefined);
      return undefined;
    }
    if (r.sendBacks.length) {
      this.options.schedule.askingSoon();
      return r.sendBacks.shift();
    }
    const polls = this.options.settings.plant === 'stop-hold-polls';
    const held = Date.now();
    while (!this.options.kernel.stopping && Date.now() < until && !this.options.schedule.abandoned.has(meta.id) && await open()) {
      // A continue the core recorded while the stop waited (#85): sent back with it.
      if (r.sendBacks.length) {
        this.options.schedule.askingSoon();
        return r.sendBacks.shift();
      }
      if (this.options.delivery().releases) {
        if ((await this.options.schedule.queue(() => this.options.delivery().answers.waitingFor(session))).length) return undefined;
      } else {
        const block = await this.options.schedule.queue(async () => (this.options.schedule.abandoned.has(meta.id) ? undefined : this.options.delivery().deliver(await this.options.delivery().answers.waitingFor(session), 'stop_hold', { session, id: meta.id })));
        if (block) return block;
      }
      if (polls) await new Promise((done) => setTimeout(done, Math.min(250, Math.max(0, until - Date.now()))));
      else await this.options.schedule.wakeable(this.options.delivery().waiting, session, Math.min(until - Date.now(), 1000)).woken;
    }
    // A hold that ran out with the agent's question still open ends on the record (#27), naming what it waited for.
    if (!this.options.kernel.stopping && !this.options.schedule.abandoned.has(meta.id) && Date.now() >= until) {
      const asks = (await this.options.services.record.raw(`SELECT id FROM asks WHERE session_id = ? AND status IN ('open', 'later') ORDER BY created`, [session])) as { id: string }[];
      if (asks.length) await this.options.events.appendReading(session, meta.agent, `This stop was held ${words(until - held)} for ${asks.map((a) => `ask:${a.id}`).join(', ')} and nothing was answered, so the hold ended and the stop went through. The session waits on you: your answer goes by its waiter or its next prompt.`).catch(() => undefined);
    }
    return undefined;
  }

  // ---- The verdict in the chat, and status from the record (#83; design: The verdict in the chat).

  /** The newest claim the session's line reads, and the turn it was made in. */
  claimed(session: string, claim: string): void {
    const live = this.options.state().live.get(session);
    if (!live) return;
    live.claim = claim;
    live.claimTurn = live.turn;
    live.workedSinceClaim = false;
  }

  /** A claim's state from the record (verdict-chat), with the runs' expected times. */
  stateOf(claim: string): Promise<ClaimState | undefined> {
    return claimState(this.options.services.raw, claim.replace(/^claim:/, ''), this.expected);
  }

  /**
   * A stop that is judged (design: Every stop is judged): one the stop rule (#303) reads as a claim, and a later
   * stop of the same turn with nothing changed since; undefined for any other. The pull request the turn opened is
   * recorded, and a turn with no claim yet gets one, as the agent's claim for the task its prompt named, at the
   * worktree's commit, or at the record's no-commit value (forty zeros) where the folder has none.
   */
  async judging(meta: HookMeta): Promise<Live | undefined> {
    const live = this.options.state().live.get(meta.session);
    if (!live?.judged) return undefined;
    // A stop while a monitor's watch runs isn't final (#997): the turn is judged at the first stop after the watch ends.
    if (watching(live).length) return undefined;
    // The claims the rule made at this stop, for the locked ask-tasks (#303): the newest is the one the line reads.
    const made = (await live.claiming) ?? [];
    live.claiming = undefined;
    const newest = made[made.length - 1];
    if (newest) { this.claimed(meta.session, newest); return live; }
    // With none, the turn's claim stands while nothing changed since it: a stop after a send-back that changed code
    // claims anew, for the turn's own task.
    if (live.claim && live.claimTurn === live.turn && !live.workedSinceClaim) {
      // An agent paseo runs with no hooks of its own claims through deep_claim alone: its turn's end runs the gate on
      // that claim, the repo's spec checks at its commit (#55).
      if (unseenTools(meta.agent) && !this.lanes.has(live.claim)) await this.paseoClaim(meta, live.claim);
      return live;
    }
    // The head as the turn's last commits left it, read by the chain follow() started.
    await live.reading?.catch(() => undefined);
    const commit = live.head ?? (await headOf(meta.cwd).catch(() => undefined))?.sha ?? '0'.repeat(40);
    const ts = this.options.services.now();
    const id = ulid(ts);
    const task_ref = await this.turnTaskOf(meta.session, live);
    const [before] = (await this.options.services.record.raw(`SELECT COUNT(*) AS n FROM claims WHERE session_id = ? AND subject_ref = ?`, [meta.session, task_ref])) as { n: number }[];
    await this.options.events.append(this.options.events.connection('core', { session: meta.session, agent: live.agent }), { v: 2, id, kind: 'claim.made', ts, data: { task_ref, attempt: (before?.n ?? 0) + 1, commit, scope: 'session', predictions: [] } });
    this.claimed(meta.session, `claim:${id}`);
    // The claim (and any reading taken with it) lands behind the stop that ended the session's turn: its end is
    // recorded again after them, or an unclean restart would read the idle session as active and its claim as lost.
    if (live.state === 'finished' || live.state === 'failed') await this.options.state().attention(meta.session, live.agent, live.state);
    return live;
  }

  /** A deep_claim of a session paseo's plugin gates, judged on the repo's spec at the claim's commit (#55). */
  private async paseoClaim(meta: HookMeta, claim: string): Promise<void> {
    const [row] = (await this.options.services.record.raw(`SELECT data FROM events WHERE id = ? AND kind = 'claim.made'`, [claim.slice('claim:'.length)])) as { data: string }[];
    if (!row) return;
    const d = JSON.parse(row.data) as Obj;
    const commit = typeof d.commit === 'string' ? d.commit : '0'.repeat(40);
    await this.runClaim({ claim, session: meta.session, task: String(d.task_ref), commit, base: commit, cwd: meta.cwd, deliverables: [], requirements: [], checks: [], definition: 'pending' });
  }

  /** The turn's task: the one the prompt that opened the turn named, kept at the prompt; after a restart, the newest a person named; else the session's own. */
  async turnTaskOf(session: string, live: Live): Promise<string> {
    const [prompt] = live.turnTask ? [] : (await this.options.services.record.raw(`SELECT json_extract(data, '$.tasks[0]') AS task FROM events WHERE session_id = ? AND kind = 'user.ask' AND json_extract(data, '$.from') = 'person' AND json_extract(data, '$.tasks[0]') IS NOT NULL ORDER BY log_pos DESC LIMIT 1`, [session])) as { task: string | null }[];
    return live.turnTask ?? prompt?.task ?? `session:${letters(session)}#0`;
  }

  /**
   * A monitor's watch ended (#997). Mid-turn, the turn's stop reads it; at an idle session the stop that went before is
   * final now: its row reads it again, and it is judged as it would have been with no watch, its claim made and its
   * checks started.
   */
  async watchEnded(session: string, id: string, why: string): Promise<void> {
    const live = this.options.state().live.get(session);
    const b = live?.background.get(id);
    if (!live || !b?.watch) return;
    live.background.delete(id);
    if (live.state === 'working') return;
    await this.options.schedule.queue(() => this.options.events.appendReading(session, live.agent, `Its monitor ${backgrounded([b.what])} ended: ${why}.`)).catch(() => undefined);
    // Another watch still running keeps the row waiting on it; a wake that began a turn meanwhile is judged at its stop.
    if (watching(live).length) return void await this.options.schedule.queue(() => this.options.events.appendReading(session, live.agent, waitingOn(watching(live)))).catch(() => undefined);
    await this.judgeEnded(session);
  }

  /** Judges a turn that ended with no stop's reply to hold: its claim is made, its fast lane runs and its slow checks start. */
  async judgeEnded(session: string): Promise<void> {
    const live = this.options.state().live.get(session);
    if (!live?.judged || live.state === 'working') return;
    live.claiming ??= (live.deferred ?? (async () => this.options.services.tasks.claim(session, live.agent, live.cwd)))().catch((): string[] => []);
    live.deferred = undefined;
    const judged = await this.options.schedule.queue(() => this.judging({ session, cwd: live.cwd } as HookMeta)).catch(() => undefined);
    // Judged here once: a later wake's stop with no work in it doesn't judge it again.
    live.judged = false;
    if (!judged?.claim) return;
    await this.laneOf(judged.claim, Date.now() + STOP_HOLD_MS);
    await this.options.services.gate.turnEnded(judged.claim, [...live.background.values()].map((x) => x.what), this.options.services.now(), { session, origin: live.turnFrom, due: null, starter: 'claim' }).catch(() => undefined);
  }

  /**
   * A session whose turn this hub's restart interrupted, with work the stop rule would read as a claim, is judged
   * from the start (#83): its stop is held for its line, as it would have been had the hub stayed up.
   */
  async judgedAcrossRestart(): Promise<void> {
    const rows = (await this.options.services.record.raw(`SELECT id, agent, worktree FROM sessions WHERE status NOT IN ('finished', 'failed') AND id IN (${[...this.options.transcripts().cursors.keys()].map(() => '?').join(', ') || "''"})`, [...this.options.transcripts().cursors.keys()]).catch(() => [])) as { id: string; agent: string | null; worktree: string | null }[];
    for (const row of rows) {
      if (!this.stopRule(await this.counterOf(row.id))) continue;
      // A session the spool replay already brought back keeps what the replay knew of it.
      const live = this.options.state().live.get(row.id);
      if (live) live.judged = true;
      else this.options.state().live.set(row.id, { agent: row.agent ?? 'claude-code', cwd: row.worktree && row.worktree !== '-' ? row.worktree : '', last: 0, calls: new Map(), wakeups: [], crons: new Map(), background: new Map(), looping: false, turn: 0, judged: true });
    }
    // Told before the hub reports ready, so the stop that comes first is held.
    await this.options.schedule.askingNow();
  }

  /** The line a judged stop carries, from the record as it stands now, never from the agent's words. */
  async judgedLine(live: Live): Promise<string> {
    const state = live.claim && live.claimTurn === live.turn ? await this.stateOf(live.claim) : undefined;
    // #669's planted line: PASS whatever the record holds, with no verdict behind it.
    if (this.options.settings.plant === 'line-pass-without-verdict') return verdictLine({ outcome: 'PASS', requirements: (state?.state.requirements ?? []).map((r) => ({ ...r, outcome: 'PASS' as const })), running: [], tests: state?.state.tests ?? 0 });
    return verdictLine(state ? state.state : { outcome: null, requirements: [], running: [] });
  }

  /** A line that changed since the chat last saw one, for the session's next prompt (Codex hears a late verdict there); undefined otherwise. */
  async landedLine(session: string): Promise<string | undefined> {
    const live = this.options.state().live.get(session);
    if (!live) return undefined;
    // After a restart the newest claim is the record's; its line may show once more, never go unseen.
    live.claim ??= await newestClaim(this.options.services.raw, session).then((id) => (id ? `claim:${id}` : undefined));
    if (!live.claim) return undefined;
    const state = await this.stateOf(live.claim);
    if (!state) return undefined;
    const line = await this.heldLine(session, verdictLine(state.state));
    if (line === live.delivered) return undefined;
    live.delivered = line;
    return line;
  }

  /**
   * The pull request a session opened with `gh pr create`, read from the call's own PostToolUse (hookmap) and
   * recorded once as a session.reading, for the receipt (#83); a Codex session's too, whose rollout is never read.
   */
  async openedPr(session: string, agent: string, url: string): Promise<void> {
    const reading = `Opened pull request ${url}`;
    const [seen] = await this.options.services.record.raw(`SELECT 1 FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') = ? LIMIT 1`, [session, reading]);
    if (!seen) await this.options.events.appendReading(session, agent, reading);
  }

  /** What a Codex stop's own records say (#39): its goal and heartbeat as the stop's loop, each new reading once. */
  async codexStop(meta: HookMeta, data: Obj, live: Live): Promise<void> {
    const read = await codexReadings(meta.session, meta.transcript, meta.fields?.turn_id, live.from === 'continuation');
    if (read.loop) data.loop = read.loop;
    live.looping = read.loop?.state === 'looping' || live.looping;
    // A session's newest windows are what the runner admits the account's Codex jobs by.
    if (read.limits && read.account) await this.options.services.runner.report({ agent: 'codex', account: read.account, rate_limits: read.limits } as unknown as WindowReport).then(() => this.options.services.tasks.windowChanged()).catch(() => undefined);
    const readings = read.version && !loopsCovered(read.version) && coveredBy('codex', read.version) ? [uncoveredLoops(read.version)] : read.readings;
    const before = (await this.options.services.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = '${sql(meta.session)}' AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Codex %: %' ORDER BY log_pos`)) as { reading: string }[];
    const standing = standingReadings(before.map((b) => b.reading));
    if (readings === read.readings) for (const gone of heartbeatsGone(standing, readings)) await this.options.events.appendReading(meta.session, meta.agent, gone);
    for (const reading of readings) if (!stands(standing, reading)) await this.options.events.appendReading(meta.session, meta.agent, reading);
  }

  /** The pull request a session opened, as its readings record it: the newest. */
  async prOf(session: string | null): Promise<string | undefined> {
    if (!session) return undefined;
    const [row] = (await this.options.services.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Opened pull request %' ORDER BY log_pos DESC LIMIT 1`, [session])) as { reading: string }[];
    return row ? prUrlIn(row.reading) : undefined;
  }

  /**
   * test.verdict: a record state planted on a session's claim, by the events the core's gate would append (the
   * server serves it only with DEEP_HUB_TEST_VERDICT=1, to the CLI): a verdict.made with the given requirement
   * outcomes, a claim.sent_back for a FAIL's round, a run.started and run.finished for each check that ran, and a
   * run.started for each still going, with its expected time. The line and the receipt then read the record alone.
   */
  async testVerdict(params: Obj): Promise<Obj> {
    const session = typeof params.session === 'string' ? params.session : undefined;
    const claim = typeof params.claim === 'string' && /^claim:[0-9A-Za-z]+$/.test(params.claim) ? params.claim : undefined;
    if (!session || !claim) throw refuse('type', '/params', 'Name the session and the claim (claim:<id>).', params);
    const [row] = (await this.options.services.record.raw(`SELECT commit_sha FROM claims WHERE id = ?`, [claim.slice(6)])) as { commit_sha: string | null }[];
    if (!row) throw new Refused(refusal('not_found', '/params/claim', `No claim ${claim} in the record.`, claim));
    const commit = row.commit_sha && /^[0-9a-f]{40}$/.test(row.commit_sha) ? row.commit_sha : '0'.repeat(40);
    const agent = this.options.state().live.get(session)?.agent ?? this.options.state().sessions.get(session)?.agent ?? 'claude-code';
    const core = this.options.events.connection('core', { session, agent });
    const ran = Array.isArray(params.ran) ? (params.ran as { check: string; outcome: string }[]) : [];
    const running = Array.isArray(params.running) ? (params.running as { check: string; about_s: number }[]) : [];
    const started = async (check: string): Promise<string> => {
      const ts = this.options.services.now();
      const run = `run:${ulid(ts)}`;
      await this.options.events.append(core, { v: 1, id: ulid(ts), kind: 'run.started', ts, subject: run, data: { run, check, claim, commit } });
      return run;
    };
    for (const r of ran) {
      const run = await started(r.check);
      const ts = this.options.services.now();
      await this.options.events.append(core, { v: 1, id: ulid(ts), kind: 'run.finished', ts, subject: run, data: { run, outcome: r.outcome, tests_run: 1, passed: r.outcome === 'passed' ? 1 : 0, runs: 1, evidence: [], check: r.check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'test' } });
    }
    for (const r of running) this.expected.set(await started(r.check), Number(r.about_s));
    const outcome = params.outcome;
    if (typeof outcome !== 'string') return { planted: true, verdict: null };
    const reqs = (Array.isArray(params.requirements) ? (params.requirements as Obj[]) : []).map((r) => ({
      req: String(r.req), outcome: String(r.outcome), check: String(r.check ?? 'unit'), depth: 'unit', oracle: 'code', runs: { clean: 0, needed: 0, counted: [] },
      smallest: typeof r.smallest === 'string' ? r.smallest : null, points_to: typeof r.points_to === 'string' ? r.points_to : null, evidence: [], proof: 'test_run',
    }));
    const failing = reqs.find((r) => r.outcome === outcome && r.smallest);
    const ts = this.options.services.now();
    const id = ulid(ts);
    const verdict = `verdict:${id}`;
    await this.options.events.append(core, {
      v: 1, id, kind: 'verdict.made', ts, subject: claim,
      data: { outcome, verdict, claim, reasons: [], requirements: reqs, smallest: failing?.smallest ?? null, points_to: failing?.points_to ?? null, commit, key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'test', tools: [] } },
    });
    if (outcome === 'FAIL' && typeof params.round === 'number') {
      const at = this.options.services.now();
      await this.options.events.append(core, { v: 1, id: ulid(at), kind: 'claim.sent_back', ts: at, subject: claim, data: { claim, verdict, round: params.round, to: `session:${letters(session)}` } });
    }
    return { planted: true, verdict };
  }

  async runClaim(r: { claim: string; session: string; task: string; commit: string; base: string; cwd: string; deliverables: string[]; requirements: { req: string; id: string; text: string; depth: string; oracle: string; on_base: 'fails' | 'passes'; check: string | null }[]; checks: (Pick<ClaimCheck, 'check' | 'approved' | 'on_base' | 'asserts' | 'req' | 'surface' | 'expected_ms' | 'deadline_ms' | 'references' | 'runs' | 'held_out' | 'timing'> & { command?: string; paid?: PaidKind })[]; definition: DefinitionState; joins?: boolean; state?: StatePin }): Promise<void> {
    const at = this.options.services.now();
    this.claimRequirements.set(r.claim, new Map(r.requirements.map((q) => [q.req, { id: q.id, text: q.text }])));
    this.claimScopes.set(r.claim, { task: r.task, base: r.base, cwd: r.cwd });
    this.paidChecks.set(r.claim, new Map(r.checks.flatMap((c) => (c.paid ? [[c.check, { paid: c.paid, task: r.task }] as const] : []))));
    // Nothing but reads since the session's last claim: its snapshot and the lines it added stand, and its results carry (#82).
    const same = this.options.state().live.get(r.session)?.workedSinceClaim === false && this.options.state().live.get(r.session)?.claim !== undefined;
    const lane = (async () => {
      const message = this.lastMessage.get(r.session) ?? '';
      // What the claim leaves open becomes open items before any verdict is made on it (#323). Read beside the session's
      // log for the validity gate and the project's trust for its spec checks, none of which waits on another (#82).
      const spec = r.joins ? [] : this.specChecks(r.cwd);
      const reads = Promise.all([r.definition === 'pending' ? undefined : this.sessionLog(r.session), spec.length ? this.projectTrusted(r.cwd) : false]);
      reads.catch(() => undefined);
      if (!r.joins) {
        await this.options.services.openItems.atClaim({ session: r.session, agent: this.options.state().live.get(r.session)?.agent ?? 'claude-code', task: r.task, cwd: r.cwd, base: r.base, message, transcript: this.options.state().sessions.get(r.session)?.transcript, pr: await this.prOf(r.session), same })
          .catch((error: unknown) => process.stderr.write(`deep hub: ${r.claim}'s open items were not read: ${error instanceof Error ? error.message : String(error)}\n`));
      }
      // A command the final message tells you to run is the gate's to run first (#323), not a run the session cites.
      const told = r.joins ? [] : toldToRun(message);
      const cited = told.reduce((m, command) => m.replaceAll(`\`${command}\``, command), message);
      // The validity gate reads the claim against its definition: a claim with none yet, and none on its way, has nothing to be read against.
      // A number's cited query is the numbers check's to re-run (#1537), never a run or a file the session had to make or read.
      const [log, trusted] = await reads;
      const findings = log === undefined ? [] : validityGate({ claim: { claim: r.claim, message: this.options.services.checkKinds.uncited(cited) }, checkout: r.cwd, deliverables: r.deliverables, session: log }).map((f) => f.why);
      // A claim that fails the validity gate goes back naming what's missing, before any check runs.
      if (findings.length) return { fast: [], slow: [], snapshot: r.commit, readyAt: this.options.services.now(), findings };
      // The planted wrong program runs no check before the definition locks, the repo's spec included.
      if (r.definition !== 'locked' && this.options.settings.plant === 'lock-before-any-check') return { fast: [], slow: [], snapshot: r.commit, readyAt: this.options.services.now(), findings };
      // Every claim check runs through the command check kind (#30): hermetic, in the platform sandbox, with no network
      // and no credentials, whatever the head's trust, which is what an untrusted head gets (#29) and more.
      // Each check as the gate judges it: the command its run is (the approved file, run by the shell in the claim's
      // checkout), the requirements it covers, and the deepest proof they need; each requirement with the depth and
      // oracle its definition states.
      const DEPTHS = ['unit', 'integration', 'journey', 'live'] as const;
      const depth = (d: string): typeof DEPTHS[number] => (DEPTHS as readonly string[]).includes(d) ? d as typeof DEPTHS[number] : 'unit';
      const oracle = (o: string): 'code' | 'model' | 'person' => (o === 'model' || o === 'person' ? o : 'code');
      const requirements = r.requirements.map((q) => ({ req: q.req, depth: depth(q.depth), oracle: oracle(q.oracle), on_base: q.on_base }));
      const checks: ClaimCheck[] = r.checks.map((c) => {
        const covered = r.requirements.filter((q) => q.check === c.check);
        const deepest = covered.map((q) => DEPTHS.indexOf(depth(q.depth))).reduce((a, b) => Math.max(a, b), 0);
        return { ...c, command: c.command ?? `sh ${shellQuote(c.check)}`, covers: covered.map((q) => q.req), depth: DEPTHS[deepest]!, source: 'definition' as const };
      });
      // The repo's spec checks run beside the definition's (#322): in a project the core's trust decision marks
      // trusted, or one the agents' own trust records already do; an untrusted repo's spec commands never run, and
      // its claims are watch-only, so none passes. On a claim that joins its early run they ran already.
      if (!r.joins) {
        if (spec.length && trusted && this.options.settings.plant !== 'drafted-spec-only') {
          checks.push(...spec);
          // A claim on a pull request also runs the repo's release checks, on the PR's commit merged with main (#325).
          if (await this.prOf(r.session)) checks.push(...await this.releaseChecks(r.cwd, r.commit));
        }
        else if (spec.length) {
          this.watchOnlyClaims.add(r.claim);
          if (!this.toldUntrusted.has(r.session)) {
            this.toldUntrusted.add(r.session);
            await this.options.events.appendReading(r.session, this.options.state().live.get(r.session)?.agent ?? 'claude-code', `This repo isn't trusted (neither by your answer in the app nor by Claude Code's or Codex's own trust), so its spec checks (${spec.map((c) => c.check).join(', ')}) never run here and its claims are watch-only: none passes until you trust it.`).catch(() => undefined);
            await this.options.flags().watchOnly(r.session, this.options.state().live.get(r.session)?.agent ?? 'claude-code', 'checks', true);
          }
        }
      }
      // The checks of the other kinds the hub holds (#1537), each run through its kind: a drafted check whose bytes name
      // a work kind; the review on every claim that opens or updates a PR, its second model through the runner under
      // your reserve (#87); the numbers check on every claim whose words state a number or a speed with the check behind it (#1863).
      const of: ReviewOf = { claim: r.claim, task: r.task, agent: this.options.state().live.get(r.session)?.agent ?? 'claude-code', transcript: this.options.state().sessions.get(r.session)?.transcript, pr: await this.prOf(r.session) };
      const kinded = new Map<string, { spec: CheckSpec; of: ReviewOf }>();
      const docs = this.options.services.canvasSide.docChecksOf(r.cwd);
      for (const c of checks) {
        const bytes = c.source === 'definition' && c.approved ? await this.options.services.store.read(c.approved).catch(() => new Uint8Array()) : undefined;
        const doc = bytes ? docCheckIn(bytes) : c.source === 'spec' ? docs.get(c.check) : undefined;
        if (doc) {
          const at = await this.options.services.canvasSide.docRevision(doc.doc);
          Object.assign(c, { command: docCommand(doc, at), document: doc.doc });
          kinded.set(c.check, { spec: docSpec(doc, at), of });
          continue;
        }
        const spec = bytes ? this.options.services.checkKinds.definitionSpec(bytes) : undefined;
        if (spec) kinded.set(c.check, { spec, of });
      }
      if (!r.joins) {
        const add = (check: string, spec: CheckSpec | undefined, command: string): void => {
          if (!spec) return;
          checks.push({ check, approved: null, command, covers: [], depth: 'unit', on_base: 'passes', asserts: [], source: 'spec' });
          kinded.set(check, { spec, of });
        };
        if (await this.prOf(r.session)) add('review', this.options.services.checkKinds.reviewSpec(r.base, r.commit, this.options.services.root.dir), `review ${r.base}..${r.commit}`);
        for (const n of await this.options.services.checkKinds.claimChecks(cited, r.cwd, r.base, r.definition === 'locked' ? (await this.options.services.tasks.scopeOf(r.task)).sample : null)) { checks.push(n.check); kinded.set(n.check.check, { spec: n.spec, of }); }
      }
      if (kinded.size) this.kindChecks.set(r.claim, kinded);
      // Each told command runs once on the claim's snapshot as the agent's own check: failing, it sends the claim back
      // with its output; passing, it proves nothing, as the agent's own checks never pass a claim.
      for (const command of told) checks.push({ check: command, approved: null, command, covers: [], depth: 'unit', on_base: 'passes', asserts: [], source: 'own' });
      if (told.length) this.told.set(r.claim, new Set(told));
      const ran = await this.options.services.gate.stop({ session: r.session, claim: r.claim, task: r.task, cwd: r.cwd, base: r.base, requirements, checks, stopAt: at, definition: r.definition, same, ...(r.joins ? { joins: true } : {}), ...(r.state ? { state: r.state } : {}) });
      // The verdict is written beside the stop's reply, which waits for it only where it reads the record (#82).
      const written = this.judged(r.claim);
      this.verdictWrites.set(r.claim, written);
      written.catch(() => undefined).finally(() => { if (this.verdictWrites.get(r.claim) === written) this.verdictWrites.delete(r.claim); });
      return { ...ran, findings };
    })();
    this.lanes.set(r.claim, lane);
    // A claim whose checks could not start is INCONCLUSIVE, naming why, as one past its budget is: never left with no verdict.
    lane.catch((error: unknown) => {
      const why = error instanceof Error ? error.message : String(error);
      process.stderr.write(`deep hub: ${r.claim}'s checks did not start: ${why}\n`);
      void this.invalid(r.claim, r.commit, `its checks did not start: ${why}`, 'INCONCLUSIVE', 'checks_not_started').catch((failed: unknown) => process.stderr.write(`deep hub: ${r.claim}'s verdict wasn't recorded: ${failed instanceof Error ? failed.message : String(failed)}\n`));
    });
  }

  /**
   * The repo's spec checks (#322): each check the spec's `done` claim names (or, with no claims block, every check),
   * as a command run in the claim's checkout, the repo's own, covering the claim as a whole.
   */
  private specChecks(cwd: string): ClaimCheck[] {
    const spec = this.options.doneSpec(cwd);
    if (spec === undefined) return [];
    const checks = this.options.mcp().checksOf(cwd);
    const docs = this.options.services.canvasSide.docChecksOf(cwd);
    const done = isObj(spec) && isObj(spec.claims) && isObj(spec.claims.done) && Array.isArray(spec.claims.done.checks) ? spec.claims.done.checks.map(String) : [...checks.keys(), ...docs.keys()];
    return done.flatMap((name): ClaimCheck[] => {
      const check = checks.get(name);
      const doc = docs.get(name);
      if (!check && doc) return [{ check: name, approved: null, command: docCommand(doc, undefined), covers: [], depth: 'unit', on_base: 'passes', asserts: [], source: 'spec', document: doc.doc }];
      if (!check) return [];
      const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
      // A journey runs on the repo's stack, as its environment block starts it (#33, #580).
      return [{ check: name, approved: null, command: check.run, covers: [], depth: check.type === 'journey' ? 'journey' as const : 'unit' as const, on_base: 'passes' as const, asserts: [], source: 'spec' as const, ...(deadline ? { deadline_ms: deadline } : {}) }];
    });
  }

  /**
   * Whether a project is trusted (#322; design: spec-draft's row): by the one decision the core holds (#348), or, so
   * a repo trusted in an agent needs no second answer, by Claude Code's workspace trust or Codex's trusted projects.
   */
  async projectTrusted(cwd: string): Promise<boolean> {
    if (await this.options.services.trust.trusted(cwd).catch(() => false)) return true;
    let real = cwd;
    try { real = realpathSync(cwd); } catch { /* as given */ }
    try {
      const user = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')) as Obj;
      const projects = isObj(user.projects) ? user.projects : {};
      for (const key of [cwd, real]) { const p = projects[key]; if (isObj(p) && p.hasTrustDialogAccepted === true) return true; }
    } catch { /* no Claude Code settings */ }
    return codexTrusted([cwd, real]);
  }

  /**
   * A product's entry build (#1017): the hub's own command, under a heavy-command lease (#1015) held by the hub, run
   * by the supervisor as you, so it sees your toolchains and caches as any build of yours does.
   */
  async buildProduct(b: { cwd: string; command: string }): Promise<{ code: number | null; tail: string }> {
    const peer = { pid: process.pid, start: (await this.options.state().startOf(process.pid)) ?? '' };
    const none = async (): Promise<undefined> => undefined;
    let r = await this.options.services.heavy.wait({ kinds: [], command: b.command, cwd: b.cwd }, peer, none);
    while (r.status !== 'granted') {
      await new Promise((done) => setTimeout(done, 1000));
      r = await this.options.services.heavy.wait({ ticket: r.ticket, secret: r.secret }, peer, none);
    }
    const own = { ticket: r.ticket, secret: r.secret };
    const run = `run:${ulid(this.options.services.now())}`;
    let tail = '';
    const keep = (chunk: Buffer): void => { tail = `${tail}${chunk.toString('utf8')}`.slice(-8000); };
    try {
      // Joined to the host's job pool (#1016), as a build `deep lease` runs is.
      const env = typeof r.makeflags === 'string' ? { MAKEFLAGS: r.makeflags, CARGO_MAKEFLAGS: r.makeflags } : {};
      const started = await this.options.services.host.start({ run, argv: ['/bin/sh', '-c', b.command], cwd: b.cwd, env, grant: RUN_AS_YOU, output: { stdout: keep, stderr: keep } });
      if (started.status !== 'started') { await this.options.services.heavy.release(own); return { code: null, tail: `BLOCKED: no ${started.kind} free` }; }
      await this.options.services.heavy.started({ ...own, pid: started.pid, pgid: started.pgid, cwd: b.cwd });
      const exit = await this.options.services.host.wait(run);
      return { code: exit.code, tail };
    } catch (error) {
      await this.options.services.heavy.release(own).catch(() => undefined);
      throw error;
    }
  }

  /** What this session read and ran, from its own tool calls in the record: what a claim's cites must name. */
  private async sessionLog(session: string): Promise<SessionLog> {
    const rows = (await this.options.services.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'tool.after'`, [session])) as { data: string }[];
    const read: string[] = [];
    const ran: SessionLog['ran'] = [];
    const cwd = this.options.state().live.get(session)?.cwd ?? '';
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      for (const p of Array.isArray(d.paths) ? d.paths : []) if (typeof p === 'string') read.push(cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p);
      if (typeof d.command === 'string') ran.push({ command: d.command, exit_status: typeof d.exit_code === 'number' ? d.exit_code : d.outcome === 'ok' ? 0 : null, output: '' });
    }
    return { read, ran, links: [] };
  }

  /** A run's outcome, once its finish is in the record. */
  async runEnded(run: string): Promise<string> {
    await this.options.services.runs.ended(run);
    const [row] = (await this.options.services.record.raw(`SELECT outcome FROM runs WHERE id = ?`, [run.slice(4)])) as { outcome: string | null }[];
    return row?.outcome ?? 'stopped';
  }

  /**
   * The claim's verdict as its runs now stand (#30): made by the verdict engine from the runs the command check kind
   * recorded, through the gate; recorded as verdict.made once it isn't pending, and again each time it changes as
   * pending results land. The line in the chat and the receipt read it from the record.
   */
  async judged(claim: string): Promise<void> {
    let v = this.options.services.gate.verdictOf(claim);
    if (!v || v.outcome === 'pending') return;
    // The planted engine reads a run cut short, or one missing what lies outside the code, as a failure.
    if (this.options.settings.plant === 'failures-as-fail' && (v.outcome === 'BLOCKED' || v.outcome === 'INCONCLUSIVE')) v = { ...v, outcome: 'FAIL' };
    // An untrusted repo's spec commands never ran, so its claim is watch-only: it never passes (#322). Each reason the
    // core gives of its own goes with its code (verdict.reason@1), so a view says it in words (#2029).
    const coded = (reason: string, texts: string[]): { reason: string; text: string }[] => texts.map((text) => ({ reason, text }));
    const untrusted = 'project trust: the repo\'s spec checks never run until you trust the project, so this claim is watch-only';
    if (v.outcome === 'PASS' && this.watchOnlyClaims.has(claim)) v = { ...v, outcome: 'BLOCKED', reasons: [...v.reasons, untrusted], why: [...(v.why ?? []), ...coded('untrusted_project', [untrusted])] };
    // A target that no longer resolves makes the claim INVALID, naming it, whatever its checks show; a FAIL still goes first (#323).
    const unresolved = this.unresolvedTargets.get(claim);
    if (unresolved && v.outcome !== 'FAIL') {
      const reqs = new Set(unresolved.map((u) => u.req));
      v = { ...v, outcome: 'INVALID', reasons: [...unresolved.map((u) => u.reason), ...v.reasons], why: [...coded('target_unresolved', unresolved.map((u) => u.reason)), ...(v.why ?? [])], requirements: v.requirements.map((q) => (reqs.has(q.req) ? { ...q, outcome: 'INVALID' as const, smallest: unresolved.find((u) => u.req === q.req)!.reason } : q)) };
    }
    // A threshold without a unit makes its requirement's check BLOCKED (#323; design: Solved or not): no run can decide it.
    const bare = [...(this.claimRequirements.get(claim) ?? [])].flatMap(([req, q]) => unitless(q.text).map((t) => ({ req, why: `${q.id}'s threshold “${t.text}” has no unit, so no run can decide it: name its unit, such as ${t.value} ms` })));
    if (bare.length) {
      const held = (o: Result): boolean => o !== 'FAIL' && o !== 'INVALID';
      v = {
        ...v, outcome: held(v.outcome) ? 'BLOCKED' : v.outcome, reasons: [...bare.map((b) => b.why), ...v.reasons], why: [...coded('threshold_without_unit', bare.map((b) => b.why)), ...(v.why ?? [])],
        requirements: v.requirements.map((q) => { const b = bare.find((x) => x.req === q.req); return b && held(q.outcome) ? { ...q, outcome: 'BLOCKED' as const, smallest: b.why } : q; }),
      };
    }
    // What a pending claim waited for closes once its run ended or your answer came (#82), before open items are read.
    const [owner] = (await this.options.services.record.raw(`SELECT subject_ref, session_id FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null; session_id: string | null }[];
    if (owner?.subject_ref) await this.options.services.openItems.settled({ session: owner.session_id ?? '', agent: this.options.state().live.get(owner.session_id ?? '')?.agent ?? 'claude-code', task: owner.subject_ref }, this.needsOf(claim)).catch(() => undefined);
    // Nor while what its task left open stays open (#323): an item closes on evidence, your answer or a rule, never the agent's word.
    if (v.outcome === 'PASS') {
      const open = (await this.options.services.record.raw(`SELECT text FROM open_items WHERE closed IS NULL AND task_ref = (SELECT subject_ref FROM claims WHERE id = ?)`, [claim.slice(6)])) as { text: string }[];
      const left = `open items: ${open.length} still open, each closed only by evidence, your answer or a rule: ${open.slice(0, 3).map((o) => `“${o.text.slice(0, 200)}”`).join('; ')}${open.length > 3 ? '; …' : ''}`;
      if (open.length) v = { ...v, outcome: 'BLOCKED', reasons: [...v.reasons, left], why: [...(v.why ?? []), ...coded('open_items', [left])] };
    }
    // You chose another option after the agent went on with one (#84): the claim can't pass until a check of yours runs.
    if (v.outcome === 'PASS') {
      const why = await this.options.control().onSwitchedTree(claim).catch(() => undefined);
      if (why) v = { ...v, outcome: 'BLOCKED', reasons: [...v.reasons, why], why: [...(v.why ?? []), ...coded('option_switched', [why])] };
    }
    // A call DeepBuild denied ran anyway in the claim's session (#1033): its own checks can't pass it.
    if (v.outcome === 'PASS') {
      const ran = await this.overridesFor(claim);
      const overridden = `a call DeepBuild denied ran anyway in this session: ${ran.map((o) => `${o.label} (${o.call})`).join('; ')}; its own checks can't pass it`.slice(0, 8000);
      if (ran.length) v = { ...v, outcome: 'INCONCLUSIVE', reasons: [...v.reasons, overridden], why: [...(v.why ?? []), ...coded('denied_call_ran', [overridden])] };
    }
    // A document check's key names the revisions it read (#1723).
    const docs = this.options.services.canvasSide.revisionsOf(claim);
    if (docs?.size) v = { ...v, key: { ...v.key, doc_revisions: [...docs].sort() } };
    v = misjudged(v, this.options.settings.plant);
    const hash = verdictHash(v);
    if (this.verdictsMade.get(claim) === hash) return;
    try {
      await recordVerdict(this.options.services.record, v, this.options.services.now());
      this.verdictsMade.set(claim, hash);
      // A claim on a pull request settles when it passes: how each item its review rounds sent back ended is recorded (#1862).
      const pr = v.outcome === 'PASS' ? await this.prOf(owner?.session_id ?? null) : undefined;
      if (pr) await this.options.services.reviewRounds.settled(pr, claim).catch((error: unknown) => process.stderr.write(`deep hub: how ${claim}'s sent-back review items ended was not recorded: ${error instanceof Error ? error.message : String(error)}\n`));
    } catch (error) {
      process.stderr.write(`deep hub: ${claim}'s verdict was not recorded: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  /**
   * A claim's check, run from its approved bytes (#303): read from the evidence store by their digest and written at
   * the check's own path in the claim's temporary checkout, over whatever the snapshot holds there, so the file in the
   * session's folder never runs. The run is the command check kind's (#30): `sh <check>` in that checkout, hermetic,
   * through host@1, whatever the head's trust; an untrusted head gets no hosts and no credentials, which no drafted
   * check has anyway.
   */
  async runApproved(r: { claim: string; check: string; approved: string | null; command: string; commit: string; cwd: string; lane?: 'fast' | 'slow'; expected_ms?: number | null; deadline_ms?: number | null; env?: Record<string, string>; hosts?: string[]; standIns?: string[]; references?: { path: string; sha256: string }[]; overlay?: Record<string, string>; key?: RunKey; stack?: StackWant }): Promise<string> {
    // A spec check is a command alone: nothing of it is written. A drafted check and each expected output it
    // references are written from their approved bytes (#322).
    if (r.approved !== null && this.options.settings.plant !== 'runs-disk-bytes') {
      for (const { path, sha256 } of [{ path: r.check, sha256: r.approved }, ...(r.references ?? [])]) {
        const file = join(r.cwd, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, await this.options.services.store.read(sha256), { mode: path === r.check ? 0o500 : 0o400 });
        renameSync(`${file}.tmp`, file);
      }
    }
    // A held-out variant's files (#1018), from the store by their digests, over the snapshot's in its own checkout.
    // Its folder is resolved through any link the snapshot holds and must still lie in the checkout, and a link in the
    // file's place is removed, never written through: the agent never reaches the variant's bytes.
    for (const [path, sha] of Object.entries(r.overlay ?? {})) {
      const file = join(r.cwd, path);
      let folder = dirname(file);
      while (!existsSync(folder)) folder = dirname(folder);
      if (!`${realpathSync(folder)}/`.startsWith(`${realpathSync(r.cwd)}/`) || !`${file}/`.startsWith(`${r.cwd}/`)) throw Error(`a held-out variant's file ${path} lies outside its checkout`);
      mkdirSync(dirname(file), { recursive: true });
      rmSync(file, { force: true });
      writeFileSync(file, await this.options.services.store.read(sha), { flag: 'wx' });
    }
    // A stand-in's port (#874) is the one host it may reach, and its origin the one variable it gets; a command's stand-in is found by name.
    const grant: Grant = r.hosts?.length ? { ...RUN_AS_YOU, hosts: r.hosts } : RUN_AS_YOU;
    // A paid check reserves its price against the issue's budget before it starts, and is charged its cost reading
    // once it ends (#325): one that doesn't fit, or whose price nobody knows, never starts, so its check is BLOCKED.
    const paid = this.paidChecks.get(r.claim)?.get(r.check);
    const id = paid ? `run:${ulid(this.options.services.now())}` : undefined;
    if (paid && id) {
      const inputs = sha256Hex(new TextEncoder().encode(`${r.check}\n${r.approved ?? r.command}\n${r.commit}`));
      const out = await this.options.services.ledger.request(this.options.events.connection('core'), { run: id, check: r.check, inputs, issue: paid.task });
      if (out.status !== 'started') throw Error(out.status === 'BLOCKED' ? (out.cause === 'price' ? `${out.missing} is unknown` : `the budget for ${paid.task} has no room for it (${out.ask})`) : `it waits for your answer, ${out.ask}`);
    }
    // A check your repo's spec lists under `outside` runs as you, outside the sandbox, once its checkout is built (#33).
    const outside = this.outsideOf(r.cwd, r.check);
    if (outside) await this.builtOutside(r.cwd, outside.build);
    // A check of another kind runs its spec through the kinds the hub holds, within its kind's budget unless it names a deadline (#1537).
    const kinded = this.kindChecks.get(r.claim)?.get(r.check);
    const { run } = await this.options.services.runs.start({ check: r.check, claim: r.claim, commit: r.commit, argv: ['/bin/sh', '-c', r.command], command: r.command, ...(outside ? { outside: true } : {}), env: r.env ?? {}, cwd: r.cwd, grant, lane: r.lane ?? 'slow', expected_ms: r.expected_ms ?? null, deadline_ms: r.deadline_ms ?? (kinded ? this.options.services.checkKinds.deadline(kinded.spec.kind) : null), ...(kinded ? { spec: kinded.spec } : {}), ...(r.standIns?.length ? { stand_ins: r.standIns } : {}) }, undefined, id, r.key, r.overlay !== undefined, r.stack && this.options.services.stacks.wanted(r.cwd) ? r.stack : undefined);
    if (paid) {
      const charge = () => this.options.services.ledger.charge(this.options.events.connection('core'), String(run), this.priceOf(r.check, 'costs') ?? this.priceOf(r.check) ?? 0);
      void this.options.services.runs.ended(String(run)).then(charge).catch((error: unknown) => process.stderr.write(`deep hub: ${String(run)} was not charged: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    return String(run);
  }

  /**
   * Whether the checkout's spec runs this check outside the sandbox (#33): `outside: { checks: [paths], build }` in
   * .deepbuild/done.yaml, for suites that start sandboxes of their own, which macOS can't nest. Its build makes what
   * those suites start (the workspaces, deep-hook) once per checkout.
   */
  private outsideOf(cwd: string, check: string): { build: string } | undefined {
    const spec = this.options.doneSpec(cwd);
    const o = isObj(spec) && isObj(spec.outside) ? spec.outside : undefined;
    const paths = Array.isArray(o?.checks) ? o.checks.map(String) : [];
    return o && typeof o.build === 'string' && paths.some((p) => check === p || (p.endsWith('/') && check.startsWith(p))) ? { build: o.build } : undefined;
  }

  private builtOutside(cwd: string, build: string): Promise<void> {
    let built = this.outsideBuilds.get(cwd);
    if (!built) {
      built = (async () => {
        const run = `run:${ulid(this.options.services.now())}`;
        let tail = '';
        const keep = (chunk: Buffer): void => { tail = `${tail}${chunk.toString('utf8')}`.slice(-2000); };
        const started = await this.options.services.host.start({ run, argv: ['/bin/sh', '-c', build], cwd, own_sandbox: true, output: { stdout: keep, stderr: keep } });
        if (started.status !== 'started') throw Error(`its checkout's build \`${build}\` found no ${started.kind} free`);
        const exit = await this.options.services.host.wait(run);
        if (exit.code !== 0) throw Error(`its checkout's build \`${build}\` exited ${String(exit.code)}: ${tail.trim().split('\n').slice(-3).join(' ')}`);
      })();
      this.outsideBuilds.set(cwd, built);
    }
    return built;
  }

  /**
   * A change judged on its merge with the default branch's head (#1331): the issue's task, opened once from its
   * reading, claims the merge commit in a worktree of its own, as `session` did a stop; its slow checks start, and its
   * verdict is read once made. Each check whose key the merge didn't change carries from the run that made it (#1018).
   */
  async judgeLanding(r: { repo: string; checkout: string; issue: number; pr: number; commit: string; session: string }): Promise<{ claim: string; outcome: Outcome; requirements: { req: string; text: string; settled_by: string | null; outcome: string }[] } | undefined> {
    const [owner, name] = r.repo.split('/') as [string, string];
    const fetch = this.options.settings.github ? recordedFetch(this.options.settings.github) : liveFetch(this.options.settings.forge, process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken());
    // A reading with no revision time is revised by its text: the definition still names the issue it locked from.
    const readings = (await readIssue(fetch, owner, name, r.issue, this.options.settings.plant).catch(() => undefined))?.map((x) => (x.updated ? x : { ...x, updated: sha256Hex(new TextEncoder().encode(x.body)) }));
    if (!readings?.[0]) throw Error(`issue #${r.issue} of ${r.repo} couldn't be read, so its change can't be judged`);
    const item = { ...readings[0], readings };
    // A worktree of the checkout's repo at the merge commit: the claim's folder, removed once its verdict is read.
    const tree = join(this.options.services.root.dir, 'landing', 'trees', letters(r.session));
    mkdirSync(dirname(tree), { recursive: true });
    await new Promise<void>((done, fail) => execFile('git', ['-C', r.checkout, 'worktree', 'add', '--quiet', '--detach', '--force', tree, r.commit], { env: gitEnv() }, (error) => (error ? fail(error) : done())));
    // The checkout's installs serve the claim's checks: a link, which the gate's checkouts clone from where it points.
    for (const dep of ['node_modules', '.venv']) if (existsSync(join(r.checkout, dep)) && !existsSync(join(tree, dep))) symlinkSync(join(r.checkout, dep), join(tree, dep));
    try {
      this.options.state().live.set(r.session, { agent: 'claude-code', cwd: tree, last: this.options.services.now(), calls: new Map(), wakeups: [], crons: new Map(), background: new Map(), looping: false, turn: 0, judged: false });
      const made = await this.options.services.tasks.landing({ session: r.session, cwd: tree, item, at: this.options.services.now() });
      if (!made) return undefined;
      await this.lanes.get(made.claim)?.catch(() => undefined);
      // Nothing sends this claim on: its slow checks start now, as a turn's end starts them.
      await this.options.services.gate.turnEnded(made.claim, [], this.options.services.now(), { session: r.session, origin: 'person', due: null, starter: 'claim' }).catch(() => undefined);
      // The verdict the core recorded, once the gate's is no longer pending: what the poster posts and the record keeps.
      const until = Date.now() + VERDICT_WAIT_MS;
      for (;;) {
        await this.verdictWrites.get(made.claim)?.catch(() => undefined);
        const v = this.options.services.gate.verdictOf(made.claim);
        const [row] = v && v.outcome !== 'pending' ? (await this.options.services.record.raw(`SELECT outcome, requirements FROM verdicts WHERE claim_id = ? ORDER BY created DESC LIMIT 1`, [made.claim.slice(6)])) as { outcome: Outcome; requirements: string | null }[] : [];
        if (row) {
          const settled = new Map((await this.options.services.tasks.lockedRequirements(made.task)).map((q) => [q.req, q]));
          const reqs = (JSON.parse(row.requirements ?? '[]') as { req: string; outcome: string }[]).map((q) => ({ req: q.req, text: settled.get(q.req)?.text ?? q.req, settled_by: settled.get(q.req)?.settled_by ?? null, outcome: q.outcome }));
          return { claim: made.claim, outcome: row.outcome, requirements: reqs };
        }
        if (Date.now() > until) return undefined;
        await new Promise((done) => setTimeout(done, 200));
      }
    } finally {
      this.options.state().live.delete(r.session);
      await new Promise<void>((done) => execFile('git', ['-C', r.checkout, 'worktree', 'remove', '--force', tree], { env: gitEnv() }, () => done()));
    }
  }

  /** The core's INVALID verdict on a claim the floor refused (#29): before any check counts, naming why, by its code when it has one (#2029). */
  async invalid(claim: string, commit: string, reason: string, outcome: 'INVALID' | 'INCONCLUSIVE' = 'INVALID', code?: string): Promise<void> {
    const ts = this.options.services.now();
    const id = ulid(ts);
    await this.options.events.append(this.options.events.connection('core'), {
      v: code ? 2 : 1, id, kind: 'verdict.made', ts, subject: claim,
      data: {
        outcome, verdict: `verdict:${id}`, claim, reasons: [reason.slice(0, 8192)], ...(code ? { why: [{ reason: code, text: reason.slice(0, 8192) }] } : {}), requirements: [], smallest: null, points_to: null, commit,
        key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: `${process.platform}-${process.arch}`, tools: [] },
      },
    });
  }

  /** The denied calls that ran anyway in a claim's session (#1033): as they arrived, and as the record holds them. */
  private async overridesFor(claim: string): Promise<{ call: string; label: string; ts: number }[]> {
    const [row] = (await this.options.services.record.raw(`SELECT session_id FROM events WHERE kind = 'claim.made' AND id = ? LIMIT 1`, [claim.slice(6)])) as { session_id: string | null }[];
    if (!row?.session_id) return [];
    const recorded = (await this.options.services.record.raw(`SELECT ts, json_extract(data, '$.call') AS call, json_extract(data, '$.label') AS label FROM events WHERE session_id = ? AND kind = 'guard.overridden'`, [row.session_id])) as { call: string; label: string; ts: number }[];
    const seen = this.options.kernel.overrides.get(row.session_id) ?? [];
    return [...seen, ...recorded.filter((r) => !seen.some((s) => s.call === r.call))];
  }

  /**
   * The stop rule (#303, design: Every stop is judged): a stop whose turn did work is a claim, other than one right
   * after startup, a resume or /clear, or an answer, a turn begun by a prompt you typed that opened no task, with no
   * edit, write or ask in it. The planted wrong program reads every stop with tool calls as a claim.
   */
  stopRule(count: Counter): boolean {
    return this.options.settings.plant === 'claim-on-tool-calls' ? count.worked : count.worked && !count.fresh && !this.isAnswer(count);
  }

  /** An answer: a turn begun by a prompt you typed that opened no task, with no edit, write or ask in it. */
  isAnswer(count: Counter): boolean {
    // The planted wrong program reads every turn a prompt began as an answer, whatever it did and whoever sent it.
    if (this.options.settings.plant === 'skips-prompt-turns') return count.prompt !== undefined;
    return count.prompt?.person === true && !count.prompt.opened && !count.changed;
  }

  /**
   * A session's counter, its messages numbered on from its last recorded one, so a restarted hub never reuses a
   * handle; with what the stop rule reads of the turn under way: its prompt, and whether a start came after it.
   */
  async counterOf(session: string): Promise<Counter> {
    const [row] = session ? await this.options.services.record.raw(`SELECT MAX(json_extract(data, '$.msg')) AS msg FROM events WHERE session_id = ? AND kind = 'user.ask'`, [session]).catch(() => []) as { msg: number | null }[] : [];
    // The newest prompt stands for the turn's: a mid-turn message after the one that opened a task reads, until
    // the next prompt, as a prompt that opened none.
    const [prompt] = session ? await this.options.services.record.raw(`SELECT json_extract(data, '$.from') AS f, json_extract(data, '$.tasks[0]') AS task, log_pos FROM events WHERE session_id = ? AND kind = 'user.ask' AND NOT (agent = 'codex' AND json_extract(data, '$.from') = 'subagent') ORDER BY log_pos DESC LIMIT 1`, [session]).catch(() => []) as { f: string | null; task: string | null; log_pos: number }[] : [];
    const [started] = prompt ? await this.options.services.record.raw(`SELECT 1 AS one FROM events WHERE session_id = ? AND kind = 'session.start' AND log_pos > ? LIMIT 1`, [session, prompt.log_pos]).catch(() => []) as { one: number }[] : [];
    // The turn's work since its last boundary (its prompt, its last stop or a start), so a turn a hub restart
    // interrupted is judged at its stop as the rule reads it (#83): a tool call, and one that may have changed code.
    const [boundary] = session ? await this.options.services.record.raw(`SELECT MAX(log_pos) AS at FROM events e WHERE e.session_id = ? AND e.kind IN ('user.ask', 'agent.stop', 'session.start') AND ${OWN_TURN} AND NOT (e.kind = 'user.ask' AND e.agent = 'codex' AND json_extract(e.data, '$.from') = 'subagent')`, [session]).catch(() => []) as { at: number | null }[] : [];
    const calls = boundary?.at !== null && boundary?.at !== undefined ? (await this.options.services.record.raw(`SELECT json_extract(data, '$.kind') AS k FROM events WHERE session_id = ? AND kind = 'tool.after' AND log_pos > ?`, [session, boundary.at]).catch(() => [])) as { k: string | null }[] : [];
    const count = this.counters.get(session) ?? {
      msgs: row?.msg === null || row?.msg === undefined ? 0 : Number(row.msg) + 1, turns: 0, worked: calls.length > 0, changed: calls.some((c) => !READS.has(String(c.k))),
      ...(prompt ? { prompt: { person: prompt.f === 'person', opened: prompt.task !== null }, fresh: started !== undefined } : {}),
    };
    this.counters.set(session, count);
    return count;
  }

  async stopReply(meta: HookMeta, until: number, r: Routes, stepped: () => number): Promise<{ context?: string; block?: string; message?: string }> {
    return this.reply.stopReply(meta, until, r, stepped);
  }
}
