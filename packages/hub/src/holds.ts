// Authority at PreToolUse (#321; design: An ask, and your answer getting back, and Before each command). Two holds,
// both decided by the core from what a call does, never from a question's words:
//
// - A "proceed" never covers a call that needs authority. In the turn a proceed starts (from the proceed to the
//   session's next stop or prompt, read from the record), a call whose effect class is push, merge, dispatch, send or
//   delete is held with an authority ask naming it, whichever sorter answered. The guard engine gives the class:
//   deep-hook's `effect:` entries for a shell call, the facts file for an MCP tool.
// - New or changed MCP tools wait for your approval. At each session start every stdio server the session loads,
//   synced or yours, is asked for its tool list, recorded with each tool's input schema digest and hints. A tool
//   that can change or destroy and isn't on the server's first list, or whose schema changed since, is held by one
//   authority ask per server update until you say yes; your yes covers that tool at that digest only.
//
// A hold denies the call, naming its ask; once you say yes the same call runs. #84's sort lives in questions.ts; its
// proceeds are recorded here, and DEEP_HUB_TEST_SORTER, which only tests set, can still plant one.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { AskRefused, type Asks, type PlanInput, type Target } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import { execFile } from 'node:child_process';
import { countMcp, toolLists, type Listed } from './mcp-servers.js';
import { namedIn, pushBranches, type Named } from './named.js';
import { offerPlan, type Effect } from './questions.js';
import type { About } from './standing.js';
import { AUTHORITY, type Gated, type HookMeta, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
const key = (v: unknown) => sha256Hex(canonicalize(v as JsonValue));


export interface HoldOptions {
  /** The session ran a held call again on your yes to this ask: it has your answer. */
  heard?(ask: string): Promise<void>;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  asks: () => Asks;
  now: () => number;
  plant: Plant | undefined;
  sorter: string | undefined;
  append(connection: Connection, input: EventInput): Promise<void>;
  /** The core's connection for a session's events. */
  connection(session: string, agent: string): Connection;
  pin(cwd: string, question: string): Promise<Obj>;
  /** A session.reading on the session's row. */
  reading(session: string, agent: string, reading: string): Promise<void>;
  /** Copies the session's transcript into the record, so a target it read is placed as read. */
  archived(session: string): Promise<void>;
}

/**
 * The plan an authority ask shows (#69): the one call it holds, what it changes, and its undo. A call the guards class
 * as a delete or a send, or a tool that can destroy, can't be undone from here; a push or a merge reverts.
 */
function planFor(source: string, does: string, changes: string[], targets: Target[] = []): PlanInput {
  const undo = /^effect\.(push|pr|merge)$/.test(source) ? 'Revert it with a new commit' : null;
  return { steps: [{ does: does.slice(0, 8192), changes: changes.length ? changes.map((c) => c.slice(0, 8192)) : ['what the call touches'], undo, public: undo !== null, cost: 0, ...(targets.length ? { targets } : {}) }], diff: key({ source, does, changes }) };
}
/**
 * A push's words up to the end of its command, each tool's own flags before its push skipped: git's, jj's, sl's, and
 * gt's and git town's commands that push (#1523).
 */
const PUSH = /\b(?:(git)(?:\s+(?:-[cC]\s+\S+|-\S+))*\s+push|(jj)(?:\s+-\S+(?:\s+\S+)?)*?\s+git\s+push|(sl)\s+push|gt\s+(?:submit|ss?|(?:stack|upstack|downstack|us|ds|branch|b)\s+(?:submit|s))|git[\s-]town\s+(?:propose|new-pull-request|ship|sync))\b([^;&|)\n]*)/g;
const VALUED = { git: new Set(['-o', '--push-option', '--receive-pack', '--exec']), sl: new Set(['--to', '-t', '-r', '--rev', '-B', '--bookmark']) };
/** How long a held push waits for its session's transcript, well inside the gate's hold. */
const ARCHIVE_WAIT_MS = 2000;
/**
 * Where a line's pushes go (#1098): each names its remote or URL, the first word after `push` that isn't a flag or
 * `--repo`'s, and a push that names none goes to git's default, origin. jj names its remote by `--remote`, sl's
 * default is `default`, and gt and git town push to origin (#1523). A value the line computes is kept as written,
 * so it reads unknown on the card.
 */
export function pushTargets(line: string): Target[] {
  const refs = [...line.matchAll(PUSH)].map(([, git, jj, sl, rest]) => {
    const words = (rest ?? '').trim().split(/\s+/).map((w) => w.replace(/^["']|["']$/g, '')).filter(Boolean);
    if (!git && !sl) {
      const at = words.findIndex((w) => w === '--remote' || w.startsWith('--remote='));
      return !jj || at < 0 ? 'origin' : words[at]!.startsWith('--remote=') ? words[at]!.slice('--remote='.length) : (words[at + 1] ?? 'origin');
    }
    for (let at = 0; at < words.length; at++) {
      const word = words[at]!;
      if (git && word === '--repo') return words[at + 1] ?? 'origin';
      if (git && word.startsWith('--repo=')) return word.slice('--repo='.length);
      if (VALUED[git ? 'git' : 'sl'].has(word)) at++;
      else if (!word.startsWith('-')) return word;
    }
    return sl ? 'default' : 'origin';
  });
  return [...new Set(refs)].map((ref): Target => ({ kind: 'remote', ref }));
}

const DOES: Record<string, string> = { push: 'pushes', pr: 'opens a pull request', merge: 'merges', dispatch: 'dispatches', send: 'sends', delete: 'deletes' };
const ANSWERS: Record<string, [string, string]> = {
  commit: ['Commit it', 'Hold the commit'], push: ['Push it', 'Hold the push'], pr: ['Open it', 'Hold the PR'], merge: ['Merge it', 'Hold the merge'], dispatch: ['Dispatch it', 'Hold the dispatch'],
  send: ['Send it', 'Hold it'], delete: ['Delete it', 'Keep it'],
};
/** A reply to a pull request's review comment, which posts in your name on a reviewer's thread (#323). */
const THREAD_REPLY = /\/pulls\/\d+\/comments\/\d+\/replies\b/;

export class Holds {
  constructor(private readonly o: HoldOptions) {}

  /** The planted sorter's rule and questions; none unless a test named a file. */
  private sorted(question: string): string | undefined {
    if (!this.o.sorter || !question) return undefined;
    try {
      const s = JSON.parse(readFileSync(this.o.sorter, 'utf8')) as { rule?: unknown; proceed?: unknown };
      return Array.isArray(s.proceed) && s.proceed.includes(question.trim()) && typeof s.rule === 'string' ? s.rule : undefined;
    } catch {
      return undefined;
    }
  }
  /** The planted sorter's proceed for a stop, if a test named one. */
  planted(meta: HookMeta): { question: string; rule: string } | undefined {
    const question = meta.fields?.last_assistant_message?.trim() ?? '';
    const rule = this.sorted(question);
    return rule ? { question, rule } : undefined;
  }
  /** The proceeds, recorded with each question and its rule once the stop is in the record, so the turn they start begins after it. */
  async record(meta: HookMeta, proceeds: { question: string; rule: string }[], until: number): Promise<void> {
    if (this.o.plant === 'proceed-unrecorded') return;
    while (Date.now() < until && !(await this.o.raw(`SELECT 1 FROM events WHERE id = ?`, [meta.id])).length) await new Promise((done) => setTimeout(done, 20));
    for (const { question, rule } of proceeds) {
      const ts = this.o.now();
      await this.o.append(this.o.connection(meta.session, meta.agent), { v: 1, id: ulid(ts), kind: 'question.proceeded', ts, data: { question: question.slice(0, 8192), rule } });
    }
  }
  /** Keys of the asks offers raised: each waits on its card, and no stop is held for it. */
  readonly offers = new Set<string>();
  private offerKey(effect: string, thread: string): string {
    return key({ offer: effect, thread });
  }
  /** An offer that needs your authority: one ask per effect in a thread, which holds the call when it comes. */
  async offered(meta: Pick<HookMeta, 'session' | 'agent' | 'cwd'>, effect: Effect, question: string): Promise<void> {
    const [thread] = await this.thread(meta.session);
    const k = this.offerKey(effect, thread!);
    this.offers.add(k);
    if (await this.askOf(k)) return;
    const source = effect === 'spend' ? 'budget.raise' : `effect.${effect}`;
    const yes = ANSWERS[effect] ?? ['Go ahead', 'Hold it'];
    await this.raise(meta.session, meta.agent, meta.cwd, source, k, `The agent offers: "${question}" It needs your authority.`, yes, offerPlan(source, `Let the agent do what it offered: ${question}`));
  }

  /** The proceed whose turn the session is in, or undefined: the newest of its proceeds, stops and prompts is a proceed. */
  private async proceeding(session: string): Promise<{ id: string; question: string; rule: string } | undefined> {
    const [last] = (await this.o.raw(`SELECT id, kind, data FROM events WHERE session_id = ? AND kind IN ('question.proceeded', 'agent.stop', 'user.ask') ORDER BY log_pos DESC LIMIT 1`, [session])) as { id: string; kind: string; data: string }[];
    if (last?.kind !== 'question.proceeded') return undefined;
    const d = JSON.parse(last.data) as { question: string; rule: string };
    return { id: last.id, question: d.question, rule: d.rule };
  }

  /** The ask with this key, newest first: its handle, status and decision. */
  private async askOf(k: string): Promise<{ id: string; status: string; decision: string | null } | undefined> {
    const [row] = (await this.o.raw(`SELECT id, status, decision FROM asks WHERE key = ? ORDER BY created DESC LIMIT 1`, [k])) as { id: string; status: string; decision: string | null }[];
    return row;
  }
  /** Raises one authority ask from `source` (a choice that approves, for the hold-as-choice plant); its handle. */
  private async raise(session: string, agent: string, cwd: string, source: string, k: string, question: string, [yes, no]: [string, string], plan: PlanInput): Promise<string> {
    const pinned_to = await this.o.pin(cwd, question);
    const options = [{ id: 'approve', label: yes, decision: 'allow' }, { id: 'decline', label: no, decision: 'deny' }];
    const ask = this.o.plant === 'hold-as-choice'
      ? { kind: 'choice', question, options, recommended: 'approve', default: 'approve', fallback: 'you', provisional: false, owner: 'you', key: k, pinned_to }
      : { kind: 'authority', question, options, recommended: null, default: 'decline', fallback: 'you', provisional: false, owner: 'you', key: k, pinned_to };
    return this.o.plant === 'hold-as-choice'
      ? this.o.asks().raise(this.o.connection(session, agent), 'deep_ask.choice', ask)
      : this.o.asks().raise(this.o.connection(session, agent), source, ask, plan);
  }
  /** The key an ask is raised under: what it is about, hashed. */
  keyOf(about: unknown): string {
    return key(about);
  }
  /** The ask raised under `k`: 'allow' once you said yes, its handle while it waits or after a no; undefined when none was. */
  async prior(k: string): Promise<string | undefined> {
    const asked = await this.askOf(k);
    return asked && (asked.decision === 'allow' ? 'allow' : `ask:${asked.id}`);
  }
  /** A delete whose reach is unknown and couldn't be staged (#347): held by one authority ask that says so, raised under `k`. */
  async holdUnstaged(meta: HookMeta, k: string, label: string, question: string): Promise<string> {
    try {
      const ask = await this.raise(meta.session, meta.agent, meta.cwd, 'command.unstageable', k, question, ['Run it unstaged', 'Don\'t run it'],
        planFor('command.unstageable', `Run \`${label}\` unstaged, with its reach unknown`, [label]));
      return `DeepBuild is holding this: ${question} It waits for your answer to ${ask}; once you say yes, run the same call again.`;
    } catch (error) {
      if (!(error instanceof AskRefused)) throw error;
      return `DeepBuild held this: \`${label}\`'s reach is unknown and it can't be staged, and no ask could be raised for it (${error.message}).`;
    }
  }
  /** Why a call held by `handle` doesn't run: still waiting, or you said no. */
  async waiting(handle: string, label: string): Promise<string> {
    const row = await this.askOf((await this.o.raw(`SELECT key FROM asks WHERE id = ?`, [handle.slice(4)]) as { key: string }[])[0]?.key ?? '');
    return row && row.status !== 'open' && row.status !== 'later'
      ? `DeepBuild held this: you said no to \`${label}\` (${handle}, ${row.status}); it doesn't run.`
      : `DeepBuild is holding this: \`${label}\` needs your authority and waits for ${handle}. Once you say yes, run the same call again.`;
  }

  /** The sessions of `session`'s thread, as a SQL list's values. */
  private async thread(session: string): Promise<string[]> {
    const rows = (await this.o.raw(`SELECT id FROM sessions WHERE COALESCE(thread_id, id) = (SELECT COALESCE(thread_id, id) FROM sessions WHERE id = ?) ORDER BY id`, [session])) as { id: string }[];
    return rows.length ? rows.map((r) => r.id) : [session];
  }
  /** What the prompts typed in these sessions name, read by each prompt's `from` (#303): your words alone authorize. */
  private async named(sessions: string[]): Promise<Set<Named>> {
    const everyFrom = this.o.plant === 'reads-every-from';
    const rows = (await this.o.raw(`SELECT json_extract(data, '$.text') AS text, json_extract(data, '$.from') AS origin FROM events WHERE kind = 'user.ask' AND unverified = 0 AND session_id IN (${sessions.map(() => '?').join(',')})`, sessions)) as { text: string; origin: string }[];
    const named = new Set<Named>();
    for (const row of rows) if (everyFrom || row.origin === 'person' || row.origin === 'app') for (const n of namedIn(String(row.text))) named.add(n);
    return named;
  }
  /** The commit the thread's newest PASS is pinned to. */
  private async passed(sessions: string[]): Promise<string | undefined> {
    const [row] = (await this.o.raw(`SELECT c.commit_sha AS commit_sha FROM verdicts v JOIN claims c ON c.id = v.claim_id WHERE v.outcome = 'PASS' AND c.session_id IN (${sessions.map(() => '?').join(',')}) ORDER BY v.created DESC LIMIT 1`, sessions)) as { commit_sha: string | null }[];
    return row?.commit_sha ?? undefined;
  }
  /** The merges armed with `--auto` the thread hasn't disarmed: each pull request's branch. */
  private async armed(sessions: string[]): Promise<Map<string, string>> {
    const rows = (await this.o.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Merge of pull request %' AND session_id IN (${sessions.map(() => '?').join(',')}) ORDER BY log_pos`, sessions)) as { reading: string }[];
    const armed = new Map<string, string>();
    for (const { reading } of rows) {
      const m = /^Merge of pull request (\S+) (?:armed with --auto on branch (\S*)|disarmed)/.exec(reading);
      if (m?.[2] !== undefined) armed.set(m[1]!, m[2]);
      else if (m) armed.delete(m[1]!);
    }
    return armed;
  }
  private branch(cwd: string): Promise<string> {
    return new Promise((done) => execFile('git', ['-C', cwd, 'branch', '--show-current'], { timeout: 2000 }, (_, out) => done(String(out ?? '').trim())));
  }
  /**
   * The push, PR and merge defaults (#84; design: Requests that name an action, Your written rules, enforced): a call
   * goes through only when a prompt you typed in the thread names it or you said yes to its authority ask. A merge
   * also names the commit the claim's PASS is pinned to, and a merge armed with `--auto` holds its branch's pushes.
   * Why it's denied, naming the rule, or undefined when it runs.
   */
  private async namedDefaults(meta: HookMeta, call: Gated): Promise<string | undefined> {
    const sessions = await this.thread(meta.session);
    const named = await this.named(sessions);
    const every = this.o.plant === 'ask-covers-every-effect' && named.size > 0;
    const unpinned = this.o.plant === 'auto-merge-unpinned';
    // A call with more than one effect no request names, as `git town ship` pushes and merges, is one ask naming each.
    const open: { rule: string; effect: Named }[] = [];
    for (const { rule, effect } of call.named!) {
      if (rule === 'merge-names-head' || every || named.has(effect)) continue;
      const offer = await this.askOf(this.offerKey(effect, sessions[0]!));
      if (offer?.decision === 'allow') continue;
      if (offer) return `DeepBuild denied this (guard ${rule}): ${await this.waiting(`ask:${offer.id}`, call.label)}`;
      open.push({ rule, effect });
    }
    if (open.length) {
      const [{ rule, effect }] = open as [{ rule: string; effect: Named }];
      const does = [...new Set(open.map((o) => DOES[o.effect]!))].join(' and ');
      const source = `effect.${effect}`;
      const k = key({ source, sessions: sessions[0], call: call.label });
      const asked = await this.askOf(k);
      if (asked?.decision !== 'allow') {
        const handle = asked ? `ask:${asked.id}` : await this.raise(meta.session, meta.agent, meta.cwd, source, k,
          `Run \`${call.label}\`? It ${does}, and no request in this thread names that.`, ANSWERS[effect]!, planFor(source, `Run \`${call.label}\`, which ${does}`, [call.label], open.some((o) => o.effect === 'push') ? pushTargets(call.label) : []));
        return `DeepBuild denied this (guard ${rule}): no request you typed in this thread names it. ${await this.waiting(handle, call.label)}`;
      }
    }
    if (every) return undefined;
    const rule = 'merge-names-head';
    if (call.named!.some((n) => n.rule === rule) && !call.merge?.disable && !(unpinned && call.merge?.auto)) {
      const pass = await this.passed(sessions);
      // gt merge and git town ship merge whatever the head is by then: authority for one commit can't cover them.
      if (call.merge?.blind) return `DeepBuild denied this (guard ${rule}): merge authority covers one head commit, and \`${call.label}\` can't name one. Merge with gh pr merge --match-head-commit ${pass ?? "<the commit the claim's PASS is pinned to>"}, which merges only that commit.`;
      if (!pass) return `DeepBuild denied this (guard ${rule}): merge authority covers one head commit, and no claim in this thread has a PASS yet.`;
      const head = call.merge?.head;
      if (!head || head.length < 7 || !pass.startsWith(head)) return `DeepBuild denied this (guard ${rule}): merge authority covers one head commit, and this call names ${head ?? 'none'}. Name ${pass}, the commit the claim's PASS is pinned to: --match-head-commit for gh pr merge, --sha for glab mr merge, expectedHeadOid for GraphQL, sha for the API and the MCP tool.`;
    }
    const pr = call.merge?.pr ?? '';
    if (call.merge?.auto && !unpinned) await this.o.reading(meta.session, meta.agent, `Merge of pull request ${pr} armed with --auto on branch ${await this.branch(meta.cwd)}`);
    if (call.merge?.disable) for (const armed of (await this.armed(sessions)).keys()) if (!pr || armed === pr) await this.o.reading(meta.session, meta.agent, `Merge of pull request ${armed} disarmed`);
    if (call.named!.some((n) => n.effect === 'push') && !unpinned) {
      const armed = await this.armed(sessions);
      if (armed.size) {
        const current = await this.branch(meta.cwd);
        const input = meta.call?.input ?? {};
        const targets = typeof input.branch === 'string' ? [input.branch] : pushBranches(String(input.command ?? ''), current);
        for (const [number, branch] of armed) if (targets.includes(branch) || targets.includes('*')) return `DeepBuild denied this (guard ${rule}): a merge of pull request ${number} armed with --auto is pending, so \`${call.label}\` to ${branch} would change what it merges. Run gh pr merge --disable-auto ${number} first; the new head needs its own verdict.`;
      }
    }
    return undefined;
  }

  /** A PreToolUse's call: why it is held, or undefined when it runs. An ask that can't be raised holds it too. */
  async gate(meta: HookMeta, call: Gated): Promise<string | undefined> {
    try {
      const tool = call.mcp && await this.heldTool(meta, call.mcp.server, call.mcp.tool);
      if (tool) return await this.waiting(tool, call.label);
      if (call.named) {
        // The planted wrong program lets a proceed cover every call of its turn, these too.
        const covered = this.o.plant === 'proceed-covers-turn' && await this.proceeding(meta.session);
        const denied = covered ? undefined : await this.namedDefaults(meta, call);
        if (denied) return denied;
      }
      // What the defaults settled needs no proceed's hold: a request you typed, or your yes, covers it.
      const effects = new Set<string>(call.named?.map((n) => n.effect));
      const held = await this.heldEffect(meta, { ...call, classes: call.classes.filter((c) => !effects.has(c)) });
      return held && await this.waiting(held, call.label);
    } catch (error) {
      if (!(error instanceof AskRefused)) throw error;
      return `DeepBuild held this: \`${call.label}\` needs your authority, and no ask could be raised for it (${error.message}).`;
    }
  }
  /** The ask holding a call whose effect needs authority in the turn a proceed started, or undefined. */
  private async heldEffect(meta: HookMeta, call: Gated): Promise<string | undefined> {
    const classes = call.classes.filter((c) => AUTHORITY.has(c));
    if (!classes.length || this.o.plant === 'proceed-covers-turn') return undefined;
    const turn = await this.proceeding(meta.session);
    // A reply to a reviewer's thread is a send in your name, held in any turn, by one ask however often it's tried (#323).
    const reply = classes.includes('send') && THREAD_REPLY.test(call.label);
    if (!turn && !reply) return undefined;
    const source = `effect.${classes[0]!}`;
    const k = key({ source, session: meta.session, turn: turn?.id ?? null, call: call.label });
    const asked = await this.askOf(k);
    if (asked) return asked.decision === 'allow' ? undefined : `ask:${asked.id}`;
    const question = turn
      ? `Run \`${call.label}\`? It ${classes.map((c) => DOES[c]).join(' and ')}, in the turn a "proceed" started for "${turn.question}" (rule ${turn.rule}); no proceed covers a call that needs your authority.`
      : `Run \`${call.label}\`? It replies in your name to a reviewer's thread on the pull request, a send that needs your authority.`;
    const targets = classes.includes('push') ? pushTargets(call.label) : [];
    // A failed or late copy leaves a target the session read as unknown, which asks you all the same.
    if (targets.length) await Promise.race([this.o.archived(meta.session).catch(() => undefined), sleep(ARCHIVE_WAIT_MS)]);
    return this.raise(meta.session, meta.agent, meta.cwd, source, k, question, ANSWERS[classes[0]!]!, planFor(source, `Run \`${call.label}\`, which ${classes.map((c) => DOES[c]).join(' and ')}`, [call.label], targets));
  }

  /**
   * A call of a class a standing rule decides (#23), or a permission prompt: one authority ask about what it does,
   * raised from its subject so a saved decision that covers it answers it at once, as decided for you. Its handle,
   * and the decision that answered it with its option, if one did.
   */
  async asked(meta: Pick<HookMeta, 'session' | 'agent' | 'cwd'>, about: About): Promise<{ ask: string; decision?: string; option?: string; answered?: string }> {
    const pinned_to = await this.o.pin(meta.cwd, about.question);
    const options = [{ id: 'approve', label: about.options[0], decision: 'allow' }, { id: 'decline', label: about.options[1], decision: 'deny' }];
    const ask = await this.o.asks().raise(this.o.connection(meta.session, meta.agent), about.source, {
      kind: 'authority', question: about.question, options, recommended: null, default: 'decline', fallback: 'you', provisional: false, owner: 'you', subject: about.subject, pinned_to,
    }, planFor(about.source, `${about.options[0]}: ${about.subject.target.ref}`, [about.subject.target.ref]));
    return { ask, ...(await this.applied(ask)) };
  }
  /** The decision that answered an ask for you, with the option it chose; nothing when none did. */
  async applied(ask: string): Promise<{ decision?: string; option?: string; answered?: string }> {
    const [applied] = (await this.o.raw(`SELECT json_extract(data, '$.decision') AS decision FROM events WHERE kind = 'decision.applied' AND json_extract(data, '$.ask') = ? ORDER BY log_pos LIMIT 1`, [ask])) as { decision: string }[];
    if (!applied) return {};
    const [saved] = (await this.o.raw(`SELECT json_extract(data, '$.answer') AS answer, json_extract(data, '$.ask') AS ask FROM events WHERE kind = 'decision.created' AND id = ?`, [applied.decision.slice('decision:'.length)])) as { answer: string; ask: string }[];
    return saved ? { decision: applied.decision, option: saved.answer, answered: saved.ask } : {};
  }

  /** A call a standing rule decides: allowed or denied by your rule, naming it; held by an ask when none covers it. */
  async decide(meta: HookMeta, about: About): Promise<{ held?: string; allow?: string; deny?: string }> {
    const { ask, decision, option, answered } = await this.asked(meta, about);
    const why = this.o.plant === 'rule-without-reason' ? '' : ` by your standing rule ${decision}`;
    if (decision && option === 'approve') {
      if (answered) await this.o.heard?.(answered);
      return { allow: `DeepBuild allowed this${why}: ${about.question.replace(/\? No plan names it\.$/, '.')}` };
    }
    if (decision) return { deny: `DeepBuild denied this${why}: you said no to it. ${about.question}` };
    return { held: `DeepBuild is holding this: ${about.question} It waits for your answer to ${ask}; once you say yes, run the same call again.` };
  }

  /** Every list recorded for `server`, oldest first. */
  private async lists(server: string): Promise<(Listed & { held?: { ask: string; tools: string[] } })[]> {
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'mcp.tools_listed' AND json_extract(data, '$.server') = ? ORDER BY log_pos`, [server])) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Listed & { held?: { ask: string; tools: string[] } });
  }
  /** Whether `tool` at `digest` runs without you: it was on the server's first list as it is, or you approved it so. */
  private async trusted(lists: Awaited<ReturnType<Holds['lists']>>, tool: string, digest: string): Promise<boolean> {
    if (lists[0]?.tools.some((t) => t.name === tool && t.digest === digest)) return true;
    for (const l of lists) {
      if (!l.held?.tools.includes(tool) || !l.tools.some((t) => t.name === tool && t.digest === digest)) continue;
      const [row] = (await this.o.raw(`SELECT decision FROM asks WHERE id = ?`, [l.held.ask.slice(4)])) as { decision: string | null }[];
      if (row?.decision === 'allow') return true;
    }
    return false;
  }
  /** The ask an earlier list holds `tool` at `digest` by. */
  private coveredBy(lists: Awaited<ReturnType<Holds['lists']>>, tool: string, digest: string): string | undefined {
    return lists.find((l) => l.held?.tools.includes(tool) && l.tools.some((t) => t.name === tool && t.digest === digest))?.held?.ask;
  }
  /** Whether a tool can only read: by its facts entry or your decision, never by its hints (except the trusts-hints plant). */
  private reads(server: string, tool: string, hints: Obj, cwd: string): boolean {
    if (this.o.plant === 'trusts-hints' && (hints.readOnlyHint === true || /^(get|list)_/.test(tool))) return true;
    return hints.destructiveHint !== true && countMcp(server, tool, cwd).counts === 'read';
  }

  /** At a session's start: each server's tool list recorded, its new or changed tools held by one ask for the update. */
  async listed(session: string, agent: string, cwd: string): Promise<void> {
    for (const list of await toolLists(cwd)) {
      const before = await this.lists(list.server);
      const watched = this.o.plant !== 'holds-synced-only' || list.scope === 'user';
      let held: { ask: string; tools: string[] } | undefined;
      if (before.length && watched) {
        // Held by an earlier update's ask already, a tool waits on that one: one ask per server update.
        const changed = list.tools.filter((t) => !this.reads(list.server, t.name, t.hints, cwd) && !this.coveredBy(before, t.name, t.digest));
        const fresh = [];
        for (const t of changed) if (!await this.trusted(before, t.name, t.digest)) fresh.push(t);
        if (fresh.length) {
          const claims = fresh.filter((t) => Object.keys(t.hints).length).map((t) => `${t.name}: ${JSON.stringify(t.hints)}`);
          const names = fresh.map((t) => t.name);
          const question = `${list.server} (${list.scope} config${list.version ? `, version ${list.version}` : ''}) has new or changed tools that can change or destroy: ${names.join(', ')}. Let ${list.server} run them?${claims.length ? ` The server says, as its own claims: ${claims.join('; ')}.` : ''}`;
          const k = key({ source: 'mcp.tool_changed', server: list.server, tools: fresh.map((t) => [t.name, t.digest]) });
          // An ask that can't be raised leaves each tool to hold itself at its first call.
          const ask = await this.raise(session, agent, cwd, 'mcp.tool_changed', k, question, ['Allow them', 'Keep them held'],
            planFor('mcp.tool_changed', `Let ${list.server} run ${names.join(', ')}, which can change or destroy`, names.map((n) => `${list.server}/${n}`))).catch(() => undefined);
          if (ask) held = { ask, tools: names };
        }
      }
      const ts = this.o.now();
      await this.o.append(this.o.connection(session, agent), { v: 1, id: ulid(ts), kind: 'mcp.tools_listed', ts, data: { ...list, ...(held ? { held } : {}) } as unknown as JsonValue });
    }
  }
  /**
   * The ask holding `tool` of `server`, or undefined when it runs: one the server's first list had as it is, one you
   * approved at its schema, or one that only reads runs; any other tool of a server with a recorded list waits on the
   * update's ask that holds it, or, with none (a tool no list shows, or an ask that couldn't be raised), on its own.
   */
  private async heldTool(meta: HookMeta, server: string, tool: string): Promise<string | undefined> {
    const lists = await this.lists(server);
    const latest = lists.at(-1);
    if (!latest) return undefined;
    const listed = latest.tools.find((t) => t.name === tool);
    if (listed && await this.trusted(lists, tool, listed.digest)) return undefined;
    if (this.o.plant === 'holds-synced-only' && latest.scope !== 'user') return undefined;
    if (this.reads(server, tool, listed?.hints ?? {}, meta.cwd)) return undefined;
    const covering = listed && this.coveredBy(lists, tool, listed.digest);
    if (covering) return covering;
    const k = key({ source: 'mcp.tool_changed', server, tools: [[tool, listed?.digest ?? null]] });
    const asked = await this.askOf(k);
    if (asked) return asked.decision === 'allow' ? undefined : `ask:${asked.id}`;
    return this.raise(meta.session, meta.agent, meta.cwd, 'mcp.tool_changed', k, `${server} has a tool no update's ask holds yet, ${tool}, which can change or destroy. Let ${server} run ${tool}?`, ['Allow it', 'Keep it held'],
      planFor('mcp.tool_changed', `Let ${server} run ${tool}, which can change or destroy`, [`${server}/${tool}`]));
  }
}
