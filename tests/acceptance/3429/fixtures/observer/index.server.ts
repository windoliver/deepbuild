// #3429's observer (README, The worlds): a paseo plugin that decides nothing and sends nothing. It writes down each
// agent hook paseo's daemon fires, as it fires, to <agent's folder>/.dh3429-hooks.jsonl, one JSON per line in the order
// paseo fired them: {hook, agent, provider, turn, request?, outcome?}. After a turn's start it also reads the agent's
// snapshot through the SDK, as a plugin does (context.paseo.agents.ref(id).refresh()), and adds how the snapshot reads
// the mode: {snapshot: {turn, currentModeId, runtimeModeId, availableModes}}. It loads nothing from this repo.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

interface Agent { id: string; provider: string; cwd: string }
interface Snapshot { currentModeId?: string | null; availableModes?: { id: string }[]; runtimeInfo?: { modeId?: string | null } | null }
interface Context { paseo: { agents: { ref(id: string): { refresh(): Promise<{ agent: Snapshot } | null> } } } }
interface Payload { agent: Agent; turnId?: string | null; request?: { id: string; name?: string; kind?: string; title?: string }; requestId?: string; outcome?: { kind: string } }
interface Server { addHook(name: string, handler: (payload: Payload, context: Context) => Promise<void>): () => void }

const HOOKS = ['agent.create.after', 'agent.turn.before', 'agent.permission.before', 'agent.permission.after', 'agent.turn.after'];
const keep = (agent: Agent, line: Record<string, unknown>): void => {
  try { appendFileSync(join(agent.cwd, '.dh3429-hooks.jsonl'), `${JSON.stringify(line)}\n`); } catch { /* the folder went */ }
};

export default function observe(server: Server): () => void {
  const removers = HOOKS.map((hook) => server.addHook(hook, async (payload, context) => {
    const request = payload.request ? { id: payload.request.id, name: payload.request.name ?? null, kind: payload.request.kind ?? null, title: payload.request.title ?? null } : payload.requestId ? { id: payload.requestId } : undefined;
    keep(payload.agent, { hook, agent: payload.agent.id, provider: payload.agent.provider, turn: payload.turnId ?? null, ...(request ? { request } : {}), ...(payload.outcome ? { outcome: payload.outcome.kind } : {}) });
    if (hook !== 'agent.turn.before') return;
    const snapshot = (await context.paseo.agents.ref(payload.agent.id).refresh().catch(() => null))?.agent;
    keep(payload.agent, { snapshot: { turn: payload.turnId ?? null, currentModeId: snapshot?.currentModeId ?? null, runtimeModeId: snapshot?.runtimeInfo?.modeId ?? null, availableModes: (snapshot?.availableModes ?? []).map((m) => m.id) } });
  }));
  return () => { for (const remove of removers) remove(); };
}
