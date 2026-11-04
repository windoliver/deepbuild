// DeepBuild's paseo plugin (#55): each agent paseo runs gets DeepBuild's MCP server, and each of its turn ends and
// permission requests goes to the hub as a hook request, keyed by the agent's own session ID. The hub decides who owns
// the session: one deep-hook or the pi package bound first is only relayed, and the plugin then answers and sends
// nothing for it, except an answer the hub hands it on deep-hook's behalf. It never decides anything: what it sends
// into a session is the hub's send-back or your answer, and what it answers in paseo is the hub's decision.
//
// Every handler returns at once; the work goes on behind it, in the order paseo fired the hooks. Words for a session go
// in only once the agent's own snapshot reads idle (or running, as a steer) with no dialog pending, and never as an
// interrupt.
import { execFile } from 'node:child_process';
import { Answers, deepCommand, hubSocket, sendHook, token, type Obj, type Reply } from './hub.ts';
import { plant } from './plant.ts';

interface Snapshot { status?: string; pendingPermissions?: { id: string }[]; runtimeInfo?: { sessionId?: string | null } | null; persistence?: { sessionId?: string } | null }
interface Handle {
  refresh(): Promise<{ agent: Snapshot } | null>;
  send(text: string, options?: Obj): Promise<void>;
  respondToPermission(options: { requestId: string; response: Obj }): Promise<void>;
}
interface Context { paseo: { agents: { ref(id: string): Handle } } }
interface HookAgent { id: string; provider: string; cwd: string }
interface PermissionRequest { id: string; name?: string; kind?: string; title?: string; input?: Obj; detail?: Obj }
export interface Server { addHook(name: string, handler: (event: never, context: Context) => Promise<unknown>): () => void }

/** The providers that have hooks of their own or an ACP bridge DeepBuild's facts cover, for the planted wrong programs. */
const NATIVE = new Set(['claude', 'codex', 'pi']);
const GATED = new Set([...NATIVE, 'copilot']);
const POLL_MS = 250;
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms).unref());
const parsed = (reply: Reply | undefined): Obj => {
  if (!reply?.stdout) return {};
  try { const value = JSON.parse(reply.stdout) as unknown; return typeof value === 'object' && value !== null ? value as Obj : {}; } catch { return {}; }
};

/** What the plugin keeps of one agent paseo runs. */
interface Agent {
  id: string; provider: string; cwd: string; bind: string; context?: Context; session?: string;
  /** Who the hub says gates the session, when that isn't the plugin. */
  owner?: string;
  /** Each hook goes once the one before is acknowledged. */
  sending: Promise<unknown>;
  /** Words for the session that wait for it to read idle. */
  held: { asks: string[]; text: string }[];
  placing: boolean;
  answers?: Answers;
  /** The permission requests the plugin answered itself, on the hub's word. */
  responded: Set<string>;
}

export function contribute(server: Server): () => void {
  const agents = new Map<string, Agent>();
  let stopped = false;
  const agentOf = (seen: HookAgent | { agentId: string; provider: string; cwd: string }, context?: Context): Agent => {
    const id = 'agentId' in seen ? seen.agentId : seen.id;
    let a = agents.get(id);
    if (!a) agents.set(id, (a = { id, provider: seen.provider, cwd: seen.cwd, bind: token(), sending: Promise.resolve(), held: [], placing: false, responded: new Set() }));
    if (context) a.context = context;
    return a;
  };
  const handle = (a: Agent): Handle | undefined => a.context?.paseo.agents.ref(a.id);
  const snapshot = async (a: Agent): Promise<Snapshot | undefined> => (await handle(a)?.refresh().catch(() => null))?.agent ?? undefined;
  /** The agent's own session ID as paseo reads it: never paseo's agent ID. */
  async function sessionOf(a: Agent): Promise<string | undefined> {
    if (plant === 'keys-by-agent-id') return a.id;
    if (a.session) return a.session;
    const s = await snapshot(a);
    const id = s?.runtimeInfo?.sessionId ?? s?.persistence?.sessionId;
    if (typeof id === 'string' && id) a.session = id;
    return a.session;
  }

  /** A hook for the agent's session, sent once the one before it is acknowledged; its reply when the hub gives it. */
  async function hook(a: Agent, event: string, fields: Obj): Promise<Obj | undefined> {
    let acked!: () => void;
    const ack = new Promise<void>((done) => { acked = done; });
    const before = a.sending;
    a.sending = ack;
    await before;
    const session = await sessionOf(a);
    if (!session || stopped) {
      acked();
      return undefined;
    }
    const payload = { hook_event_name: event, session_id: session, cwd: a.cwd, provider: a.provider, paseo_agent: a.id, bind: a.bind, ...fields };
    const reply = parsed(await sendHook(hubSocket(a.cwd), event, payload, acked));
    if (typeof reply.owner === 'string') {
      a.owner = reply.owner;
      // A session deep-hook gates takes an answer through the plugin only where its own wake can't (#55, AC13).
      if (reply.owner !== 'pi') listen(a, true);
    } else listen(a, false);
    return reply;
  }
  /** Behind the handler, which returns at once; `hook` keeps them in the order paseo fired them. */
  const later = (work: () => Promise<unknown>): void => { void work().catch(() => undefined); };

  /** The hub's long wait for the session's answers, one at a time, until the agent goes. */
  function listen(a: Agent, relay: boolean): void {
    if (a.answers || !a.session || stopped) return;
    const mine = (a.answers = new Answers(hubSocket(a.cwd), a.bind, a.cwd));
    void (async () => {
      while (!mine.closed) {
        const reply = await mine.call('session.wait', { session: a.session, cwd: a.cwd, push: true, ...(relay ? { relay: true } : {}) });
        if (mine.closed) return;
        const result = reply.result as { text?: string; asks?: string[]; exit?: string } | undefined;
        if (result?.text && result.asks) {
          if (!a.held.some((w) => w.asks.some((ask) => result.asks!.includes(ask)))) a.held.push({ asks: result.asks, text: result.text });
          place(a);
        } else if (result?.exit === 'session ended') return;
        else if ((reply.error as { code?: string } | undefined)?.code === 'role') {
          mine.rebind();
          await sleep(1000);
        } else await sleep(reply.error ? 1000 : 50);
      }
    })();
  }

  /** What became of answers the plugin placed in a session it gates, until the hub has it. */
  async function report(a: Agent, asks: string[], via: string): Promise<void> {
    for (let tries = 0; tries < 5 && a.answers && !a.answers.closed; tries++) {
      if (!(await a.answers.call('session.delivered', { session: a.session, asks, via, outcome: 'delivered' })).error) return;
      await sleep(1000);
    }
  }
  /**
   * The words held for the session, sent once the agent's own snapshot says it can take them: idle, or running as a
   * steer, with nothing pending. While it reads anything else, or shows a dialog, they wait; they never answer one.
   */
  function place(a: Agent, guessIdle = false): void {
    if (a.placing || !a.held.length) return;
    a.placing = true;
    void (async () => {
      try {
        while (a.held.length && !stopped) {
          const s = guessIdle && plant === 'idle-guess' ? { status: 'idle', pendingPermissions: [] } : await snapshot(a);
          const open = (s?.pendingPermissions ?? []).length > 0;
          if (s && !open && (s.status === 'idle' || s.status === 'running')) {
            const words = a.held.splice(0);
            const asks = words.flatMap((w) => w.asks);
            await handle(a)!.send(words.map((w) => w.text).join('\n\n'), { activeTurnBehavior: 'steer' }).catch(() => { a.held.unshift(...words); });
            if (asks.length && !a.owner && !a.held.length) await report(a, asks, s.status === 'running' ? 'steer' : 'next_prompt');
            continue;
          }
          if (!s) return;
          await sleep(POLL_MS);
        }
      } finally {
        a.placing = false;
      }
    })();
  }

  async function answered(a: Agent, request: PermissionRequest, reply: Obj | undefined): Promise<void> {
    const decision = reply?.decision;
    if (decision !== 'allow' && decision !== 'deny') return;
    // The planted wrong program leaves a request a saved decision answered unanswered in paseo.
    if (plant === 'ignores-decision' && typeof reply?.because === 'string') return;
    a.responded.add(request.id);
    const response = decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: typeof reply?.message === 'string' ? reply.message : 'DeepBuild denied this.' };
    await handle(a)?.respondToPermission({ requestId: request.id, response }).catch(() => undefined);
    place(a);
  }

  const handlers: Record<string, (event: never, context: Context) => unknown> = {
    'agent.open.before': ({ request }: { request: Obj & { agentId: string; provider: string; cwd: string; mcpServers?: Obj } }) => {
      const a = agentOf(request);
      if (plant === 'saves-server-in-config' || (plant === 'tools-for-gated-only' && !GATED.has(a.provider))) return undefined;
      const { command, args } = deepCommand();
      return { ...request, mcpServers: { ...(request.mcpServers ?? {}), deepbuild: { type: 'stdio', command, args, env: { DEEP_PASEO_BIND: a.bind } } } };
    },
    'agent.turn.before': ({ agent, turnId }: { agent: HookAgent; turnId: string | null }, context) => {
      const a = agentOf(agent, context);
      later(() => hook(a, 'agent.turn.before', { turn_id: turnId ?? '' }));
    },
    'agent.turn.after': ({ agent, turnId, outcome }: { agent: HookAgent; turnId: string | null; outcome: { kind: string; error?: { message?: string } } }, context) => {
      const a = agentOf(agent, context);
      if (plant === 'idle-guess') place(a, true);
      later(async () => {
        const reply = await hook(a, 'agent.turn.after', { turn_id: turnId ?? '', outcome: outcome.kind === 'completed' ? 'finished' : 'failed', ...(outcome.error?.message ? { error: outcome.error.message } : {}) });
        if (!reply || a.owner || reply.decision !== 'block' || typeof reply.reason !== 'string') return;
        // The planted wrong program drops the hub's send-back.
        if (plant === 'drops-send-back') return;
        a.held.push({ asks: [], text: reply.reason });
        place(a, true);
      });
    },
    'agent.permission.before': ({ agent, request }: { agent: HookAgent; request: PermissionRequest }, context) => {
      const a = agentOf(agent, context);
      later(async () => {
        // The planted wrong program approves an ACP agent's requests itself.
        if (plant === 'approves-acp' && !NATIVE.has(a.provider)) {
          a.responded.add(request.id);
          return handle(a)?.respondToPermission({ requestId: request.id, response: { behavior: 'allow' } });
        }
        const kind = plant === 'other-as-tool' && request.kind === 'other' ? 'tool' : request.kind ?? 'tool';
        const command = typeof request.detail?.command === 'string' ? { command: request.detail.command } : {};
        const reply = await hook(a, 'agent.permission.before', {
          request_id: request.id, permission_kind: kind, tool_name: request.name ?? request.title ?? 'unknown', tool_input: request.input ?? command, ...(request.title ? { title: request.title } : {}),
        });
        if (!a.owner) await answered(a, request, reply);
      });
    },
    'agent.permission.after': ({ agent, requestId, resolution }: { agent: HookAgent; requestId: string; resolution: { behavior?: string } }, context) => {
      const a = agentOf(agent, context);
      if (a.responded.delete(requestId)) return place(a);
      later(async () => {
        // Answered in paseo's own app: an answer that counts for DeepBuild comes only through the trusted path.
        const reply = await hook(a, 'agent.permission.after', { request_id: requestId, behavior: String(resolution?.behavior ?? 'unknown'), from: 'app' });
        place(a);
        // The planted wrong program relays it to the open ask as yours, through the CLI's answer, run outside the
        // agent's process tree so the hub's peer check doesn't take it for the session.
        if (plant === 'saves-app-answer' && typeof reply?.ask === 'string') execFile('/bin/sh', ['-c', `(sleep 0.5; deep inbox answer '${reply.ask}' ${resolution?.behavior === 'allow' ? 'approve' : 'decline'}) >/dev/null 2>&1 &`], () => undefined);
      });
    },
    'agent.close.after': ({ agent }: { agent: HookAgent }) => {
      const a = agents.get(agent.id);
      a?.answers?.close();
      agents.delete(agent.id);
    },
  };
  // The planted wrong program saves DeepBuild's server into the agent's configuration, where it outlives the plugin.
  if (plant === 'saves-server-in-config') {
    handlers['agent.create.before'] = ({ request }: { request: { config: Obj & { mcpServers?: Obj } } }) => {
      const { command, args } = deepCommand();
      return { ...request, config: { ...request.config, mcpServers: { ...(request.config.mcpServers ?? {}), deepbuild: { type: 'stdio', command, args } } } };
    };
  }
  const removers = Object.entries(handlers).map(([name, run]) => server.addHook(name, async (event, context) => {
    const result = run(event, context);
    if (plant === 'slow-handlers') await sleep(20);
    return result;
  }));
  return () => {
    stopped = true;
    for (const remove of removers) remove();
    for (const a of agents.values()) a.answers?.close();
    agents.clear();
  };
}
