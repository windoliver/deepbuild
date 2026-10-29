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
// A hold denies the call, naming its ask; once you say yes the same call runs. The sorter #84 builds takes the
// planted one's place (DEEP_HUB_TEST_SORTER, only tests set it).
import { readFileSync } from 'node:fs';
import { AskRefused, type Asks } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import { countMcp, toolLists, type Listed } from './mcp-servers.js';
import type { About } from './standing.js';
import { AUTHORITY, type Gated, type HookMeta, type Plant } from './wire.js';

type Obj = Record<string, unknown>;
const sql = (s: string) => s.replace(/'/g, "''");
const key = (v: unknown) => sha256Hex(canonicalize(v as JsonValue));


export interface HoldOptions {
  raw(query: string): Promise<unknown[]>;
  asks: () => Asks;
  now: () => number;
  plant: Plant | undefined;
  sorter: string | undefined;
  append(connection: Connection, input: EventInput): Promise<void>;
  /** The core's connection for a session's events. */
  connection(session: string, agent: string): Connection;
  pin(cwd: string, question: string): Promise<Obj>;
}

const DOES: Record<string, string> = { push: 'pushes', merge: 'merges', dispatch: 'dispatches', send: 'sends', delete: 'deletes' };
const ANSWERS: Record<string, [string, string]> = {
  push: ['Push it', 'Hold the push'], merge: ['Merge it', 'Hold the merge'], dispatch: ['Dispatch it', 'Hold the dispatch'],
  send: ['Send it', 'Hold it'], delete: ['Delete it', 'Keep it'],
};

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
  /**
   * A stop ending on a question the sorter answers "proceed": the proceed, recorded with the question and the rule
   * once the stop itself is in the record, so the turn it starts begins after it; the words the stop's reply sends.
   */
  async proceed(meta: HookMeta, until: number): Promise<string | undefined> {
    const question = meta.fields?.last_assistant_message?.trim() ?? '';
    const rule = this.sorted(question);
    if (!rule) return undefined;
    while (Date.now() < until && !(await this.o.raw(`SELECT 1 FROM events WHERE id = '${sql(meta.id)}'`)).length) await new Promise((done) => setTimeout(done, 20));
    const ts = this.o.now();
    await this.o.append(this.o.connection(meta.session, meta.agent), { v: 1, id: ulid(ts), kind: 'question.proceeded', ts, data: { question, rule } });
    return `DeepBuild: proceed ("${question}", by rule ${rule}). Go on with the work. A call that pushes, merges, dispatches, sends or deletes still waits for an authority ask.`;
  }

  /** The proceed whose turn the session is in, or undefined: the newest of its proceeds, stops and prompts is a proceed. */
  private async proceeding(session: string): Promise<{ id: string; question: string; rule: string } | undefined> {
    const [last] = (await this.o.raw(`SELECT id, kind, data FROM events WHERE session_id = '${sql(session)}' AND kind IN ('question.proceeded', 'agent.stop', 'user.ask') ORDER BY log_pos DESC LIMIT 1`)) as { id: string; kind: string; data: string }[];
    if (last?.kind !== 'question.proceeded') return undefined;
    const d = JSON.parse(last.data) as { question: string; rule: string };
    return { id: last.id, question: d.question, rule: d.rule };
  }

  /** The ask with this key, newest first: its handle, status and decision. */
  private async askOf(k: string): Promise<{ id: string; status: string; decision: string | null } | undefined> {
    const [row] = (await this.o.raw(`SELECT id, status, decision FROM asks WHERE key = '${k}' ORDER BY created DESC LIMIT 1`)) as { id: string; status: string; decision: string | null }[];
    return row;
  }
  /** Raises one authority ask from `source` (a choice that approves, for the hold-as-choice plant); its handle. */
  private async raise(session: string, agent: string, cwd: string, source: string, k: string, question: string, [yes, no]: [string, string]): Promise<string> {
    const pinned_to = await this.o.pin(cwd, question);
    const options = [{ id: 'approve', label: yes, decision: 'allow' }, { id: 'decline', label: no, decision: 'deny' }];
    const ask = this.o.plant === 'hold-as-choice'
      ? { kind: 'choice', question, options, recommended: 'approve', default: 'approve', fallback: 'you', provisional: false, owner: 'you', key: k, pinned_to }
      : { kind: 'authority', question, options, recommended: null, default: 'decline', fallback: 'you', provisional: false, owner: 'you', key: k, pinned_to };
    return this.o.asks().raise(this.o.connection(session, agent), this.o.plant === 'hold-as-choice' ? 'deep_ask.choice' : source, ask);
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
      const ask = await this.raise(meta.session, meta.agent, meta.cwd, 'command.unstageable', k, question, ['Run it unstaged', 'Don\'t run it']);
      return `DeepBuild is holding this: ${question} It waits for your answer to ${ask}; once you say yes, run the same call again.`;
    } catch (error) {
      if (!(error instanceof AskRefused)) throw error;
      return `DeepBuild held this: \`${label}\`'s reach is unknown and it can't be staged, and no ask could be raised for it (${error.message}).`;
    }
  }
  /** Why a call held by `handle` doesn't run: still waiting, or you said no. */
  async waiting(handle: string, label: string): Promise<string> {
    const row = await this.askOf((await this.o.raw(`SELECT key FROM asks WHERE id = '${sql(handle.slice(4))}'`) as { key: string }[])[0]?.key ?? '');
    return row && row.status !== 'open' && row.status !== 'later'
      ? `DeepBuild held this: you said no to \`${label}\` (${handle}, ${row.status}); it doesn't run.`
      : `DeepBuild is holding this: \`${label}\` needs your authority and waits for ${handle}. Once you say yes, run the same call again.`;
  }

  /** A PreToolUse's call: why it is held, or undefined when it runs. An ask that can't be raised holds it too. */
  async gate(meta: HookMeta, call: Gated): Promise<string | undefined> {
    try {
      const held = (call.mcp && await this.heldTool(meta, call.mcp.server, call.mcp.tool)) || await this.heldEffect(meta, call);
      return held && this.waiting(held, call.label);
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
    if (!turn) return undefined;
    const source = `effect.${classes[0]!}`;
    const k = key({ source, session: meta.session, turn: turn.id, call: call.label });
    const asked = await this.askOf(k);
    if (asked) return asked.decision === 'allow' ? undefined : `ask:${asked.id}`;
    const question = `Run \`${call.label}\`? It ${classes.map((c) => DOES[c]).join(' and ')}, in the turn a "proceed" started for "${turn.question}" (rule ${turn.rule}); no proceed covers a call that needs your authority.`;
    return this.raise(meta.session, meta.agent, meta.cwd, source, k, question, ANSWERS[classes[0]!]!);
  }

  /**
   * A call of a class a standing rule decides (#23), or a permission prompt: one authority ask about what it does,
   * raised from its subject so a saved decision that covers it answers it at once, as decided for you. Its handle,
   * and the decision that answered it with its option, if one did.
   */
  async asked(meta: HookMeta, about: About): Promise<{ ask: string; decision?: string; option?: string }> {
    const pinned_to = await this.o.pin(meta.cwd, about.question);
    const options = [{ id: 'approve', label: about.options[0], decision: 'allow' }, { id: 'decline', label: about.options[1], decision: 'deny' }];
    const ask = await this.o.asks().raise(this.o.connection(meta.session, meta.agent), about.source, {
      kind: 'authority', question: about.question, options, recommended: null, default: 'decline', fallback: 'you', provisional: false, owner: 'you', subject: about.subject, pinned_to,
    });
    return { ask, ...(await this.applied(ask)) };
  }
  /** The decision that answered an ask for you, with the option it chose; nothing when none did. */
  async applied(ask: string): Promise<{ decision?: string; option?: string }> {
    const [applied] = (await this.o.raw(`SELECT json_extract(data, '$.decision') AS decision FROM events WHERE kind = 'decision.applied' AND json_extract(data, '$.ask') = '${sql(ask)}' ORDER BY log_pos LIMIT 1`)) as { decision: string }[];
    if (!applied) return {};
    const [saved] = (await this.o.raw(`SELECT json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'decision.created' AND id = '${sql(applied.decision.slice('decision:'.length))}'`)) as { answer: string }[];
    return saved ? { decision: applied.decision, option: saved.answer } : {};
  }

  /** A call a standing rule decides: allowed or denied by your rule, naming it; held by an ask when none covers it. */
  async decide(meta: HookMeta, about: About): Promise<{ held?: string; allow?: string; deny?: string }> {
    const { ask, decision, option } = await this.asked(meta, about);
    const why = this.o.plant === 'rule-without-reason' ? '' : ` by your standing rule ${decision}`;
    if (decision && option === 'approve') return { allow: `DeepBuild allowed this${why}: ${about.question.replace(/\? No plan names it\.$/, '.')}` };
    if (decision) return { deny: `DeepBuild denied this${why}: you said no to it. ${about.question}` };
    return { held: `DeepBuild is holding this: ${about.question} It waits for your answer to ${ask}; once you say yes, run the same call again.` };
  }

  /** Every list recorded for `server`, oldest first. */
  private async lists(server: string): Promise<(Listed & { held?: { ask: string; tools: string[] } })[]> {
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'mcp.tools_listed' AND json_extract(data, '$.server') = '${sql(server)}' ORDER BY log_pos`)) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Listed & { held?: { ask: string; tools: string[] } });
  }
  /** Whether `tool` at `digest` runs without you: it was on the server's first list as it is, or you approved it so. */
  private async trusted(lists: Awaited<ReturnType<Holds['lists']>>, tool: string, digest: string): Promise<boolean> {
    if (lists[0]?.tools.some((t) => t.name === tool && t.digest === digest)) return true;
    for (const l of lists) {
      if (!l.held?.tools.includes(tool) || !l.tools.some((t) => t.name === tool && t.digest === digest)) continue;
      const [row] = (await this.o.raw(`SELECT decision FROM asks WHERE id = '${sql(l.held.ask.slice(4))}'`)) as { decision: string | null }[];
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
        const changed = list.tools.filter((t) => !this.reads(list.server, t.name, t.hints, cwd)
          && !before.some((l) => l.held?.tools.includes(t.name) && l.tools.some((u) => u.name === t.name && u.digest === t.digest)));
        const fresh = [];
        for (const t of changed) if (!await this.trusted(before, t.name, t.digest)) fresh.push(t);
        if (fresh.length) {
          const claims = fresh.filter((t) => Object.keys(t.hints).length).map((t) => `${t.name}: ${JSON.stringify(t.hints)}`);
          const names = fresh.map((t) => t.name);
          const question = `${list.server} (${list.scope} config${list.version ? `, version ${list.version}` : ''}) has new or changed tools that can change or destroy: ${names.join(', ')}. Let ${list.server} run them?${claims.length ? ` The server says, as its own claims: ${claims.join('; ')}.` : ''}`;
          const k = key({ source: 'mcp.tool_changed', server: list.server, tools: fresh.map((t) => [t.name, t.digest]) });
          // An ask that can't be raised leaves each tool to hold itself at its first call.
          const ask = await this.raise(session, agent, cwd, 'mcp.tool_changed', k, question, ['Allow them', 'Keep them held']).catch(() => undefined);
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
    return this.raise(meta.session, meta.agent, meta.cwd, 'mcp.tool_changed', k, `${server} has a tool no update's ask holds yet, ${tool}, which can change or destroy. Let ${server} run ${tool}?`, ['Allow it', 'Keep it held']);
  }
}
