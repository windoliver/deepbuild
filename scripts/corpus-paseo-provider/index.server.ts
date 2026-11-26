// The fixture corpus's stand-in agent for paseo's set (#3136), in the shape of #55's fixtures/fake-provider: a provider
// plugin standing in for the agent's CLI and its model, which this repo doesn't own. Each prompt is one turn that asks
// for one shell call's permission and ends once paseo answers it. It decides nothing about DeepBuild.
type Event = Record<string, unknown>;
interface Input {
  type: string;
  requestId?: string;
  sessionId: string;
  config?: { cwd: string };
  persistence?: unknown;
  permissionId?: string;
  prompt?: { clientMessageId: string; input: { content?: { type: string; text?: string }[] } };
}

const CAPABILITIES = ['prompt.message', 'session.persistence', 'permission'];

export default function contribute(server: { registerProvider(provider: unknown): void }) {
  server.registerProvider({
    id: 'corpus-paseo',
    label: 'corpus stand-in',
    async connect(request: { capabilities: readonly string[] }) {
      return connection(CAPABILITIES.filter((capability) => request.capabilities.includes(capability)));
    },
  });
  return () => {};
}

function connection(capabilities: readonly string[]) {
  const listeners = new Set<(event: Event) => void>();
  const sessions = new Map<string, { cwd: string; turn: number; asked?: { turnId: string; permissionId: string } }>();
  const emit = (event: Event) => { for (const listener of listeners) listener(event); };
  return {
    version: 1,
    capabilities,
    async send(input: Input) {
      queueMicrotask(() => {
        const sessionId = input.sessionId;
        const session = sessions.get(sessionId);
        if (input.type === 'catalog') {
          emit({ type: 'catalog', requestId: input.requestId, catalog: { models: [{ id: 'stand-in', label: 'Stand-in' }], modes: [], defaultModel: 'stand-in' } });
        } else if (input.type === 'session.open' && input.config) {
          const persistence = input.persistence ?? { version: 1, data: { native: sessionId } };
          sessions.set(sessionId, { cwd: input.config.cwd, turn: 0 });
          emit({ type: 'session.opened', requestId: input.requestId, sessionId, capabilities, restoration: 'core', persistence, cwd: input.config.cwd });
          emit({ type: 'session.ready', requestId: input.requestId, sessionId });
        } else if (input.type === 'session.prompt' && session && input.prompt) {
          const text = (input.prompt.input.content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n');
          session.turn += 1;
          const turnId = `t${session.turn}`;
          session.asked = { turnId, permissionId: `p${session.turn}` };
          emit({ type: 'timeline.item', sessionId, item: { type: 'user_message', id: `u${session.turn}`, text, clientMessageId: input.prompt.clientMessageId } });
          emit({ type: 'session.prompt_result', sessionId, clientMessageId: input.prompt.clientMessageId, result: { type: 'turn', turnId } });
          emit({ type: 'session.turn', sessionId, turnId, state: 'started' });
          emit({ type: 'session.permission', sessionId, request: { id: session.asked.permissionId, name: 'Bash', kind: 'tool', title: 'Run echo corpus-probe', input: { command: 'echo corpus-probe' }, detail: { type: 'shell', command: 'echo corpus-probe', cwd: session.cwd } } });
        } else if (input.type === 'session.permission' && session?.asked?.permissionId === input.permissionId) {
          const { turnId, permissionId } = session.asked;
          session.asked = undefined;
          emit({ type: 'session.permission_resolved', sessionId, permissionId });
          emit({ type: 'timeline.item', sessionId, item: { type: 'assistant_message', id: `a${session.turn}`, text: 'done' } });
          emit({ type: 'session.turn', sessionId, turnId, state: 'completed' });
        } else if (input.type === 'session.close') {
          sessions.delete(sessionId);
          emit({ type: 'session.closed', sessionId });
          emit({ type: 'request.completed', requestId: input.requestId });
        } else if (input.requestId) emit({ type: 'request.completed', requestId: input.requestId });
      });
    },
    onEvent(listener: (event: Event) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      listeners.clear();
      sessions.clear();
    },
  };
}
