// A pi extension registering a local provider, `scripted`, whose one model answers from a file of steps. No account,
// no network, nothing spent: the only boundary this suite stands in for is the model API. Each model request takes
// the next step of DEEP_PI_SCRIPT (a JSON array) and is logged, with the messages and tools pi sent, to
// DEEP_PI_REQUESTS when that is set and writable. A step is
// { text?, echo?, tools?: [{ name, arguments }], error?, holdMs?, usage? }; past the last step: { text: 'done' }.
import { appendFileSync, readFileSync } from 'node:fs';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

interface Step {
  text?: string;
  /** Answers with the newest user message's text, so a run proves what prompt reached the model. */
  echo?: boolean;
  tools?: { name: string; arguments: Record<string, unknown> }[];
  error?: string;
  holdMs?: number;
  usage?: { input: number; output: number; cacheRead?: number };
}
interface Declared { name: string; description?: string; parameters?: unknown }
interface Sent { role: string; content: unknown; toolName?: string; toolsAdded?: Declared[]; toolsRemoved?: { name: string }[] }

const scriptFile = process.env.DEEP_PI_SCRIPT;
const logFile = process.env.DEEP_PI_REQUESTS;
let taken = 0;

function nextStep(): Step {
  if (!scriptFile) return { text: 'done' };
  const steps = JSON.parse(readFileSync(scriptFile, 'utf8')) as Step[];
  return steps[taken++] ?? { text: 'done' };
}

function plain(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part: { type?: string; text?: string; name?: string }) => (part.type === 'text' ? part.text ?? '' : part.type === 'toolCall' ? `[tool ${part.name}]` : '')).join('');
}

/** The tools the model is offered: pi 1.4.0 declares them in the transcript's system messages, or context.tools. */
function offered(context: { messages: Sent[]; tools?: Declared[] }): Declared[] {
  const tools = new Map((context.tools ?? []).map((t) => [t.name, t]));
  for (const m of context.messages) {
    if (m.role !== 'system') continue;
    for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
    for (const t of m.toolsAdded ?? []) tools.set(t.name, t);
  }
  return [...tools.values()];
}

export default function scripted(pi: { registerProvider(name: string, config: unknown): void }): void {
  pi.registerProvider('scripted', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'scripted-no-key',
    api: 'scripted-api',
    models: [{ id: 'scripted-1', name: 'scripted-1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }],
    streamSimple(model: { api: string; provider: string; id: string }, context: { messages: Sent[]; tools?: Declared[] }, options?: { signal?: AbortSignal }) {
      const stream = createAssistantMessageEventStream();
      const step = nextStep();
      const at = taken;
      const log = (entry: Record<string, unknown>) => {
        try { if (logFile) appendFileSync(logFile, `${JSON.stringify({ at, ms: Date.now(), ...entry })}\n`); } catch { /* a job's sandbox refuses it */ }
      };
      log({
        phase: 'start',
        messages: context.messages.map((m) => ({ role: m.role, text: plain(m.content), ...(m.toolName ? { tool: m.toolName } : {}) })),
        tools: offered(context).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
      });
      const input = step.usage?.input ?? 10;
      const output = step.usage?.output ?? 5;
      const cacheRead = step.usage?.cacheRead ?? 0;
      const usage = { input, output, cacheRead, cacheWrite: 0, totalTokens: input + output + cacheRead, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      const message = { role: 'assistant', content: [] as unknown[], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: Date.now() };
      void (async () => {
        stream.push({ type: 'start', partial: message } as never);
        if (step.holdMs) {
          await new Promise<void>((done) => {
            const timer = setTimeout(done, step.holdMs);
            options?.signal?.addEventListener('abort', () => { clearTimeout(timer); done(); }, { once: true });
          });
        }
        if (options?.signal?.aborted) {
          log({ phase: 'end', stop: 'aborted' });
          stream.push({ type: 'error', reason: 'aborted', error: { ...message, stopReason: 'aborted', errorMessage: 'aborted' } } as never);
          stream.end();
          return;
        }
        if (step.error) {
          log({ phase: 'end', stop: 'error' });
          stream.push({ type: 'error', reason: 'error', error: { ...message, stopReason: 'error', errorMessage: step.error } } as never);
          stream.end();
          return;
        }
        const newest = [...context.messages].reverse().find((m) => m.role === 'user');
        const text = step.echo ? plain(newest?.content) : step.text;
        if (text) message.content.push({ type: 'text', text });
        (step.tools ?? []).forEach((tool, index) => {
          message.content.push({ type: 'toolCall', id: `call_${at}_${index}`, name: tool.name, arguments: tool.arguments });
        });
        const reason = step.tools?.length ? 'toolUse' : 'stop';
        message.stopReason = reason;
        log({ phase: 'end', stop: reason });
        stream.push({ type: 'done', reason, message } as never);
        stream.end();
      })();
      return stream;
    },
  });
}
