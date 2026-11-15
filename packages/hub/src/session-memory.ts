import type { HubEvents, HubRuntime } from './hub-capabilities.js';
import type { AnswerDeliveryPort, SessionStatePort, McpOperationsPort } from './hub-ports.js';

import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';

import { type Asks } from '@deepbuild/asks';

import { sha256Hex } from '@deepbuild/contracts';
import { type EvidenceStore } from '@deepbuild/evidence';

import { openRecordReader, type RecordStore } from '@deepbuild/record';
import type { Runner } from '@deepbuild/runner';
import type { DecisionsProvider } from './decisions-port.js';

import { Confirmer } from './confirm.js';
import { RemovalApplication } from './removal-application.js';
import type { Durable } from './vfs.js';

import { addGuards, provenGuards, writeStanding } from './guards.js';
import { decisionKey, guardOf, keepLesson, lessonsOf, repoFolders, syncRejected, tasteBlock, tastesFor, type Lesson } from './memory.js';

import { toolClasses } from './hookmap.js';
import { type Piece } from './context-fit.js';

import { cachedRuleFiles, handleOf as ruleHandle, pageLines, reachOf as ruleReach, reachSince, readHeld, readRuleFiles, repoRoot, ruleId, rulesInFile, rulesOf, saveHeld, savePage, sameRule, setOf, type Held, type Rule, type RuleFile, type RuleFileBefore } from './rules.js';

import { deepHook, repoOf, type Root } from './paths.js';

import type { WikiBuild, KnowledgeProvider } from './knowledge-port.js';

import { standingRules } from './standing.js';

import { Refused, refusal, ulid, type CoreOptions, type HookMeta } from './wire.js';
import type { CallContext } from './session-types.js';

import { TYPED_RULE, RULES_HEAD, letters, rulePieces, FOREIGN, type Obj, isObj } from "./hub-shared.js";

export interface SessionMemoryOptions {
  decisions: Pick<DecisionsProvider, 'evidence' | 'judge'>;
  cwdOf: KnowledgeProvider['cwdOf'];
  removal: KnowledgeProvider['removal'];
  settings: CoreOptions;
  services: {
    readonly record: RecordStore;
    readonly now: () => number;
    readonly asks: Asks;
    readonly raw: RecordStore['raw'];
    readonly root: Root;
    readonly store: EvidenceStore;
    readonly wikiBuild: WikiBuild;
    readonly confirmer: Confirmer;
    readonly runner: Runner;
    readonly durable: Durable;
  };
  delivery: () => Pick<AnswerDeliveryPort, "routes">;
  mcp: () => Pick<McpOperationsPort, "propose">;
  state: () => Pick<SessionStatePort, "agentAbove">;
  events: Pick<HubEvents, "connection" | "append">;
kernel: Pick<HubRuntime, "config">;

}

/** SessionMemory: owns its domain state; services are resolved only when used. */
export class SessionMemory {
  private readonly application: RemovalApplication;
  constructor(private readonly options: SessionMemoryOptions) { this.application = new RemovalApplication(() => this.options.services); }
  recoverRemovals(): Promise<void> { return this.application.recover(); }

  /** The taste calls each session was given since it started, and the sessions whose first prompt was read for its screen (#111). */
  tasted = new Map<string, Set<string>>();

  /** What each session was given of your rules (#344): the set's handles, whether its next prompt carries every rule you typed, and a rule file's lines before an agent's edit. */
  ruleState = new Map<string, { given: Set<string>; full: boolean; editing: Map<string, RuleFileBefore[]> }>();

  /** Each repo's rule files, read at most once a few seconds, so a call's notice reads no folder tree. */
  private ruleFiles = new Map<string, { at: number; files: RuleFile[] }>();

  firstPrompted = new Set<string>();

  /** One round of judging your standing rules by what later broke, at the margin and over the window in your settings (#23). */
  async judgeRules(): Promise<void> {
    const { margin, windowMs } = this.options.kernel.config().rules;
    for (const e of await this.options.decisions.evidence({ record: this.options.services.record, now: this.options.services.now(), window: windowMs })) {
      await this.options.services.asks.judged(this.options.events.connection('core'), e.decision, { rule: e.rule, yours: e.yours, margin, judgment: this.options.decisions.judge(e.rule, e.yours, margin) });
    }
    await this.syncStanding();
    await syncRejected(this.options.services.raw, this.options.services.root.dir);
  }

  /** The past taste decisions `said` names a screen for that this session wasn't given since it started (#111). */
  async tasteAt(session: string, cwd: string, said: string, starting: boolean): Promise<string | undefined> {
    const given = starting ? new Set<string>() : this.tasted.get(session) ?? new Set<string>();
    this.tasted.set(session, given);
    const fresh = (await tastesFor(this.options.services.raw, repoOf(cwd), said)).filter((t) => !given.has(t.ask));
    for (const t of fresh) given.add(t.ask);
    return tasteBlock(fresh);
  }

  /** `deep memory`'s list (#111). */
  async lessons(): Promise<Lesson[]> {
    const lessons = [...await lessonsOf(this.options.services.raw, await repoFolders(this.options.services.record, this.options.services.store, this.options.cwdOf)), ...await this.ruleLessons()];
    return lessons.map((l, i) => ({ ...l, rank: i + 1 }));
  }

  // ---- Your rules (#344): the rules page, the start slice's rules, rules you type, scoped notices and held rule lines.
  private filesOf(repo: string): RuleFile[] {
    return cachedRuleFiles(this.ruleFiles, repo);
  }

  /** The rules you typed, in force: base changes to `rule:typed<id>`. */
  private async typedRules(): Promise<{ target: string; text: string }[]> {
    const rows = (await this.options.services.record.raw(`SELECT target, diff FROM learned_layer WHERE kind IN ('learn.applied', 'learn.widened') AND state = 'applied' AND layer = 'base' AND target LIKE 'rule:typed%' ORDER BY log_pos`)) as { target: string; diff: string }[];
    return rows.map((r) => ({ target: r.target, text: r.diff.replace(/^\+ /, '') }));
  }

  /** The rule lines an agent's edit removed, still in force; each leaves once you apply the proposal it became. */
  private async heldRules(): Promise<Held[]> {
    const held = readHeld(this.options.services.root.dir);
    const kept: Held[] = [];
    for (const h of held) {
      const [answer] = (await this.options.services.record.raw(`SELECT json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'ask.answered' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [h.ask])) as { answer: unknown }[];
      if (answer?.answer !== 'apply') kept.push(h);
    }
    if (kept.length !== held.length) saveHeld(this.options.services.root.dir, kept);
    return kept;
  }

  /** Every rule on the page: each repo a session worked in, your user-level files and the rules you typed. */
  private async allRules(guards: readonly { name: string; rule: string }[]): Promise<{ rules: Rule[]; files: RuleFile[] }> {
    // The record's sessions, and the ones whose hooks reached the hub but aren't folded into it yet.
    const worktrees = [...((await this.options.services.record.raw('SELECT DISTINCT worktree FROM sessions WHERE worktree IS NOT NULL')) as { worktree: string }[]).map((w) => w.worktree), ...[...this.options.delivery().routes.values()].map((r) => r.cwd)];
    const repos = [...new Set(worktrees.map((w) => repoRoot(w)).filter((r): r is string => r !== undefined))].sort();
    const files = [...repos.flatMap((repo) => readRuleFiles(repo, null)), ...readRuleFiles(undefined)];
    return { rules: rulesOf({ files, typed: await this.typedRules(), held: await this.heldRules(), guards }), files };
  }

  /** What the start slice gives a session of your rules: every rule for all paths but the files its own agent reads, then the slice's entries. */
  private async startSet(session: string, cwd: string, agent: string): Promise<{ handles: string[]; lines: Map<string, string> }> {
    const repo = repoRoot(cwd);
    const own = agent === 'codex' ? 'codex' : 'claude-code';
    const lines = new Map<string, string>();
    for (const r of rulesOf({ files: [...(repo ? this.filesOf(repo) : []), ...readRuleFiles(undefined)], typed: [], held: await this.heldRules(), guards: [] })) {
      if (r.scope === 'all' && r.native !== own) lines.set(ruleHandle(r), r.text);
    }
    for (const e of await this.options.services.record.startSlice(session)) lines.set(e.target, e.text);
    return { handles: [...lines.keys()], lines };
  }

  ruleStateOf(session: string) {
    let st = this.ruleState.get(session);
    if (!st) this.ruleState.set(session, (st = { given: new Set(), full: false, editing: new Map() }));
    return st;
  }

  /** The record of what a session was given, at the log position its rules and start slice were read at. */
  private async delivered(session: string, via: 'start' | 'prompt' | 'notice', rules: string[]): Promise<void> {
    const [row] = (await this.options.services.record.raw('SELECT COALESCE(MAX(log_pos), 0) AS pos FROM events')) as { pos: number }[];
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', { session }), { v: 1, id: ulid(ts), kind: 'session.rules_delivered', ts, subject: `session:${letters(session)}`, data: { via, pos: Number(row?.pos ?? 0), rules } });
  }

  /** At a session's start: its rules, first; after a compaction or a resume its next prompt carries every rule you typed, and a scoped rule is heard once more. */
  async startRules(meta: HookMeta): Promise<Piece[] | undefined> {
    const st = this.ruleStateOf(meta.session);
    const set = await this.startSet(meta.session, meta.cwd, meta.agent);
    st.given = new Set(set.handles);
    await this.delivered(meta.session, 'start', set.handles);
    return set.lines.size ? rulePieces(RULES_HEAD, [...set.lines]) : undefined;
  }

  /** A rule you type, `rule: <text>.`, saved at once as yours; resolves with the targets this prompt typed. */
  private async saveTyped(prompt: string): Promise<Set<string>> {
    const out = new Set<string>();
    if (prompt.includes('<task-notification>')) return out;
    const have = new Set((await this.typedRules()).map((t) => t.target));
    for (const m of prompt.matchAll(TYPED_RULE)) {
      const text = m[1]!.trim();
      if (!text) continue;
      const target = `rule:typed${ruleId('you', text)}`;
      out.add(target);
      if (have.has(target)) continue;
      have.add(target);
      // The rule's own words are its evidence, never the rest of the prompt.
      const at = await this.options.services.record.keep(this.options.events.connection('core'), { bytes: new TextEncoder().encode(`rule: ${text}.`), kind: 'user.rule', source: 'prompt' });
      const ts = this.options.services.now();
      await this.options.events.append(this.options.events.connection('cli'), { v: 1, id: ulid(ts), kind: 'learn.applied', ts, data: { layer: 'base', target, diff: `+ ${text}`, evidence: [{ at, quote: text }], scope: 'all', replay: null, applied_by: 'you', supersedes: null } });
    }
    return out;
  }

  /** At a prompt: a new set (a rule typed anywhere, a slice entry) is carried and recorded; after a compaction or a resume, every rule you typed. */
  async promptRules(meta: HookMeta, prompt: string, from: string | undefined): Promise<Piece[] | undefined> {
    const typedNow = from === 'person' ? await this.saveTyped(prompt) : new Set<string>();
    const st = this.ruleStateOf(meta.session);
    const set = await this.startSet(meta.session, meta.cwd, meta.agent);
    const fresh = set.handles.filter((h) => !st.given.has(h));
    if (!fresh.length && !st.full && set.handles.length === st.given.size) return undefined;
    const typedAll = await this.typedRules();
    for (const t of typedAll) if (!set.lines.has(t.target)) set.lines.set(t.target, t.text);
    const typed = st.full ? typedAll.map((t) => t.target) : [];
    const carried = [...new Set([...typed, ...fresh])].filter((h) => !typedNow.has(h));
    st.given = new Set(set.handles);
    st.full = false;
    await this.delivered(meta.session, 'prompt', set.handles);
    return carried.length ? rulePieces(`${RULES_HEAD}${typed.length ? ', every rule you typed again after the compaction or resume' : ', new since your last prompt'}`, carried.map((h) => [h, set.lines.get(h)!])) : undefined;
  }

  /**
   * At a tool call, behind its hook (#344): the scoped rules the server's reply carried, recorded as delivered; an agent's
   * edit of a rule file, read before the call by the server and after it here, and each rule line it removed held.
   */
  async ruleHook(meta: HookMeta): Promise<void> {
    if (FOREIGN.has(meta.agent) || !meta.session) return;
    const st = this.ruleStateOf(meta.session);
    const key = meta.toolUse ?? '';
    if (meta.event === 'PreToolUse' && meta.rules) {
      for (const handle of meta.rules.notices) await this.delivered(meta.session, 'notice', [handle]);
      if (meta.rules.before?.length && key) st.editing.set(key, meta.rules.before);
    }
    const before = meta.event === 'PostToolUse' ? st.editing.get(key) : undefined;
    const repo = before ? repoRoot(meta.cwd) : undefined;
    if (before) st.editing.delete(key);
    if (before && repo) await this.holdRemoved(meta.session, repo, before);
  }

  /** Each rule line an agent's edit removed stays in force, held, and becomes one proposal to you, as deep_propose's are. */
  private async holdRemoved(session: string, repo: string, before: { file: string; scope: string; rules: string[] }[]): Promise<void> {
    this.ruleFiles.delete(repo);
    const held = readHeld(this.options.services.root.dir);
    for (const b of before) {
      const after = new Set(rulesInFile(join(repo, b.file)).map(sameRule));
      for (const text of b.rules.filter((r) => !after.has(sameRule(r)))) {
        const id = ruleId(b.file, text);
        if (held.some((h) => h.id === id && h.repo === repo)) continue;
        const made = await this.options.mcp().propose(session, { target: `wiki:rules#${id}`, change: `Remove the rule “${text}” from ${b.file}. An agent's edit took this line out; the rule stays in force on the rules page until you apply this.`, evidence: null }).catch(() => undefined);
        if (made) held.push({ id, text, file: b.file, scope: b.scope, repo, proposal: String(made.proposal), ask: String(made.ask) });
      }
    }
    saveHeld(this.options.services.root.dir, held);
  }

  /** `deep rules sync`: the rules page, each rule with its file, scope, size and what enforces it, written through the wiki. */
  async syncRules(): Promise<Obj> {
    this.ruleFiles.clear();
    const { rules, files } = await this.allRules(await this.ruleGuards());
    savePage(this.options.services.root.dir, pageLines(rules, files));
    await this.options.services.wikiBuild.writeRules();
    return { rules: rules.length, files: new Set(rules.map((r) => `${r.repo ?? ''} ${r.file}`)).size };
  }

  /** The guard entries that enforce a rule: only those whose planted call deep-hook denies and whose twin it allows now. */
  private ruleGuards(): Promise<{ name: string; rule: string }[]> {
    return provenGuards(this.options.services.root.dir, process.env.DEEP_HUB_TEST_DEEP_HOOK || deepHook());
  }

  /**
   * The rules offered for removal on the keep-or-remove list (#111): a rule a guard enforces, naming it, and a rule whose
   * path scope matched no session's tool calls in the last 60 days, naming the count. Never one you typed; once each,
   * until its text changes.
   */
  private async ruleLessons(): Promise<Lesson[]> {
    const { rules } = await this.allRules(await this.ruleGuards());
    const decided = new Set(((await this.options.services.record.raw("SELECT key FROM decisions WHERE state = 'active'")) as { key: string }[]).map((d) => d.key));
    const out: Lesson[] = [];
    for (const r of rules) {
      if (r.known !== 'repo' || r.held) continue;
      let why: string | undefined;
      if (r.enforcer.kind === 'guard') why = `The guard ${r.enforcer.name} enforces it: its planted call is denied and its twin allowed, so the line in ${r.file} only repeats it.`;
      else if (r.scope !== 'all' && r.repo) {
        const reach = await ruleReach(this.options.services.raw, r.repo, r.scope, reachSince(this.options.services.now(), 60));
        if (!reach.sessions.length) why = `Its scope ${r.scope} matched ${reach.sessions.length} sessions' tool calls in the last 60 days.`;
      }
      if (!why) continue;
      const id = this.removalId(r);
      if (!decided.has(decisionKey(id))) out.push({ id, kind: 'removal', text: r.text, rank: 0, claim: ruleHandle(r), scope: 'all', sources: [{ at: null, path: r.file, quote: r.text }], why });
    }
    return out;
  }

  private removalId(rule: Rule): string {
    return `lesson-${sha256Hex(new TextEncoder().encode(`removal ${ruleHandle(rule)} ${rule.repo ?? ''}`)).slice(0, 12)}`;
  }

  /** Repeated takes of a still-listed lesson join its eval, including while its plan is being frozen. */
  private removals = new Map<string, Promise<Obj>>();
  private confirmingRemovals = new Map<string, Promise<Obj>>();

  /** Taking a removal starts one eval; only a recorded adopt may change the file. */
  removeRule(lesson: Lesson): Promise<Obj> {
    const pending = this.removals.get(lesson.id);
    if (pending) return pending;
    const started = this.startRemoval(lesson);
    this.removals.set(lesson.id, started);
    void started.then((reply) => {
      if (reply.status === 'pending') return this.options.services.runner.wait(String(reply.job));
      return undefined;
    }).finally(() => this.removals.delete(lesson.id)).catch(() => undefined);
    return started;
  }

  /** The box's approved removal waits for its eval, rather than reporting a queued change as applied. */
  async removeRuleAndWait(lesson: Lesson): Promise<string | undefined> {
    const reply = await this.removeRule(lesson);
    if (reply.status === 'refused') return String(reply.reason);
    if (reply.status !== 'pending') return;
    const ended = await this.options.services.runner.wait(String(reply.job));
    return (await this.lessons()).some((l) => l.id === lesson.id) ? ended.result ?? ended.refused ?? `INCONCLUSIVE: ${ended.job}` : undefined;
  }

  private async startRemoval(lesson: Lesson): Promise<Obj> {
    const { rules } = await this.allRules([]);
    const rule = rules.find((r) => ruleHandle(r) === lesson.claim && r.repo && lesson.id === this.removalId(r));
    if (!rule?.repo) return { status: 'refused', reason: `${lesson.claim} is no rule in a repo file now; nothing changed.` };
    const path = join(rule.repo, rule.file);
    const original = lstatSync(path);
    if (!original.isFile() || realpathSync(path) !== join(realpathSync(rule.repo), rule.file)) return { status: 'refused', reason: `${rule.file} is not a regular rule file in its repo; nothing changed.` };
    const before = readFileSync(path, 'utf8');
    const unchanged = (): boolean => {
      try { const current = lstatSync(path); return current.isFile() && current.dev === original.dev && current.ino === original.ino && realpathSync(path) === join(realpathSync(rule.repo!), rule.file) && readFileSync(path, 'utf8') === before; }
      catch { return false; }
    };
    const lines = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const front = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(before)?.[0].length ?? 0;
    let offset = 0, fenced = false;
    const at = lines.findIndex((line) => {
      const inFront = offset < front; offset += line.length;
      if (inFront) return false;
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return false; }
      const m = fenced ? null : /^\s*[-*+]\s+(.+?)\s*$/.exec(line);
      return m !== null && sameRule(m[1]!) === sameRule(rule.text);
    });
    if (at < 0) return { status: 'refused', reason: `${rule.file} no longer holds “${rule.text}”; nothing changed.` };
    lines.splice(at, 1);
    const after = lines.join('');
    const given = process.env.DEEP_HUB_TEST_EVAL;
    if (!given) {
      const { root, store, runner } = this.options.services;
      const job = await runner.submit({ kind: 'eval', agent: 'claude-code', prompt: `Remove ${lesson.id}: ${rule.text}`, deadline_ms: 110 * 60_000 }, async (context) => {
        const reader = openRecordReader({ path: root.ledger, evidence: store });
        let input: Awaited<ReturnType<KnowledgeProvider['removal']>>;
        try { input = await this.options.removal(reader, (sha) => store.read(sha), { id: context.job, repo: rule.repo!, file: rule.file, before, after }); }
        finally { reader.close(); }
        // Prove inactivity from the 60 days BEFORE the frozen score cohort, never from its held-out tasks.
        // A guard-backed lesson is selected by its planted check, not by the replay history.
        if (!lesson.why?.startsWith('The guard ')) {
          const cutoff = input.plan.cutoff;
          const earlier: RecordStore['raw'] = (sql, params = []) => this.options.services.record.raw(sql.replace("WHERE e.kind = 'tool.before'", "WHERE e.ts <= ? AND e.kind = 'tool.before'"), [cutoff, ...params]);
          const learned = await ruleReach(earlier, rule.repo!, rule.scope, reachSince(cutoff, 60));
          if (learned.sessions.length) throw Error(`${rule.file}'s removal was not justified before the replay cutoff; collect a later held-out cohort, nothing removed`);
        }
        await this.application.keep(context.job, input.plan, 'configuration-plan');
        const result = await input.evaluate(context);
        const evidence = await this.application.keep(context.job, result, 'configuration-result');
        context.signal.throwIfAborted();
        const answer = `${context.job}: ${result.after.outcome}: ${result.after.reason}`;
        if (result.after.outcome !== 'adopt') return `${answer}; ${rule.file} is unchanged.`;
        if (!unchanged()) return `${answer}; BLOCKED: ${rule.file} changed during the eval; nothing removed.`;
        const applied = await this.application.apply({ job: context.job, lesson, repo: rule.repo!, file: rule.file, before, after, original: { dev: original.dev, ino: original.ino }, report: evidence }, context.signal);
        this.ruleFiles.delete(rule.repo!);
        return `${answer}; ${applied}`;
      });
      return { status: 'pending', job: job.job, state: job.state };
    }
    const evaluated = JSON.parse(readFileSync(given, 'utf8')) as { outcome?: string; broke?: string[] };
    if (evaluated.outcome !== 'adopt') {
      return { status: 'refused', reason: `the configuration eval reads removing “${rule.text}” as a regression (${evaluated.outcome ?? 'no outcome'}) on ${(evaluated.broke ?? []).join(', ') || 'no named task'}; ${rule.file} is unchanged.` };
    }
    writeFileSync(path, after);
    this.ruleFiles.delete(rule.repo);
    return { decision: `removed “${rule.text}” from ${rule.file}` };
  }

  /** `deep session rules <id>`: the set a session was given, whether a newer one is in force since, and the set a regression in it is credited to. */
  async sessionRules(params: Obj): Promise<Obj> {
    const session = String(params.session ?? '');
    const set = await setOf(this.options.services.raw, session);
    if (!set) throw new Refused(refusal('not_found', '/params/session', `No rules were recorded as given to session ${session}.`, session));
    const [row] = (await this.options.services.record.raw('SELECT worktree, agent FROM sessions WHERE id = ?', [session])) as { worktree: string | null; agent: string | null }[];
    const now = await this.startSet(session, row?.worktree ?? '', row?.agent ?? 'claude-code');
    const current = [...now.handles].sort().join('\n') === [...set.rules].sort().join('\n');
    return { session: `session:${session}`, runs: current ? 'current' : 'earlier', set: set.pos, credited_to: set.pos };
  }

  /**
   * `deep memory keep` and `remove` (#111): yours alone, from your own terminal, once the OS confirms you. Keeping a
   * proposed guard installs it through the guard engine, checked on its planted call and twin, before the decision is saved.
   */
  async memoryAct(params: Obj, context: CallContext): Promise<Obj> {
    const verb = params.verb;
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A lesson is kept or removed from the CLI, once the OS confirms you.', 'memory.act'));
    const lesson = (await this.lessons()).find((l) => l.id === params.lesson);
    if (!lesson) throw new Refused(refusal('not_found', '/params/lesson', `No lesson ${String(params.lesson)}; deep memory lists the lessons left.`, params.lesson));
    if (verb === 'remove' && lesson.claim.startsWith('wiki:rules#') && lesson.why) {
      const pending = this.confirmingRemovals.get(lesson.id) ?? this.removals.get(lesson.id);
      if (pending) return pending;
      const taking = this.confirmLesson(lesson, verb, context).then(() => this.removeRule(lesson));
      this.confirmingRemovals.set(lesson.id, taking);
      void taking.finally(() => this.confirmingRemovals.delete(lesson.id)).catch(() => undefined);
      return taking;
    }
    await this.confirmLesson(lesson, verb, context);
    if (verb === 'remove') return { decision: await this.options.services.wikiBuild.forget(lesson.claim) };
    const guard = guardOf(lesson);
    if (guard) {
      const added = await addGuards(this.options.services.root.dir, guard, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.settings.plant });
      if (added.status === 'refused') return added;
    }
    return { decision: await keepLesson(this.options.services.record, this.options.events.connection('cli'), this.options.services.now, lesson) };
  }

  private async confirmLesson(lesson: Lesson, verb: unknown, context: CallContext): Promise<void> {
    // An agent may start this; the OS prompt is yours to refuse, so it says so, and shows the whole rule a guard would install.
    const agent = await this.options.state().agentAbove(context.peer);
    const why = await this.options.services.confirmer.you(`${verb === 'keep' ? 'keep' : 'remove'} the lesson “${lesson.text}”${agent ? `, asked from inside agent session ${agent}` : ''}`, { handle: lesson.id, revision: lesson.claim, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing changed: the OS didn't confirm you (${why}).`, lesson.id, true));
  }

  /** Copies your standing rules for cloud resources into rules.json, so deep-hook honours them with the hub down (#23). */
  async syncStanding(): Promise<void> {
    if (this.options.settings.plant === 'copies-no-standing-rules') return;
    const rows = (await this.options.services.record.raw(`SELECT d.id AS id, d.answer AS answer, d.state AS state, e.data AS data FROM decisions d JOIN events e ON e.id = d.ask_id AND e.kind = 'ask.created'`)) as { id: string; answer: string; state: string; data: string }[];
    const decided = rows.map((r) => {
      const data = JSON.parse(r.data) as Obj;
      return { id: r.id, answer: (JSON.parse(r.answer) as unknown) as string, state: r.state, subject: isObj(data.subject) ? data.subject : null };
    });
    writeStanding(this.options.services.root.dir, standingRules(decided));
  }
}
