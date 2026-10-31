// A second extension for the scripted sessions, standing in for what other extensions and tools do in a real pi:
// - it consumes any input holding the text in DEEP_PI_HANDLE, as an extension that handles a prompt without a run;
// - it logs each input it sees to DEEP_PI_INPUTS, so a test sees how an answer reached pi;
// - `nest` calls another tool `count` times through ctx.executeTool, with `padding` bytes in each call's arguments,
//   so pi itself writes the nested record (over 256 calls, or over 8 KiB of arguments, it marks complete: false).
import { appendFileSync } from 'node:fs';

interface Pi {
  on(event: 'input', handler: (event: { text: string; source: string; streamingBehavior?: string }) => { action: 'handled' } | undefined): void;
  registerTool(tool: unknown): void;
}

export default function lifecycle(pi: Pi): void {
  const marker = process.env.DEEP_PI_HANDLE;
  pi.on('input', (event) => {
    const handled = Boolean(marker) && event.text.includes(marker!);
    if (process.env.DEEP_PI_INPUTS) {
      appendFileSync(process.env.DEEP_PI_INPUTS, `${JSON.stringify({ text: event.text, source: event.source, streaming: event.streamingBehavior ?? null, handled })}\n`);
    }
    return handled ? { action: 'handled' } : undefined;
  });
  pi.registerTool({
    name: 'nest',
    label: 'nest',
    description: 'Calls the read tool the given number of times.',
    parameters: { type: 'object', properties: { count: { type: 'number' }, padding: { type: 'number' } }, required: ['count'] },
    async execute(_id: string, params: { count: number; padding?: number }, _signal: unknown, _update: unknown, ctx: { executeTool(name: string, args: unknown): Promise<unknown> }) {
      for (let i = 0; i < params.count; i++) {
        await ctx.executeTool('read', { path: params.padding ? 'x'.repeat(params.padding) : 'nested.txt' }).catch(() => undefined);
      }
      return { content: [{ type: 'text', text: `called read ${params.count} times` }], details: undefined };
    },
  });
}
