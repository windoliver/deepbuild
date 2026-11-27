const WORDS = 'acceptance-2568 net: the pi package let this call run';

interface Pi { on(event: 'tool_call', handler: (event: { toolName: string; input?: { command?: unknown } }) => { block: true; reason: string } | undefined): void }

export default function net(pi: Pi): void {
  pi.on('tool_call', (event) => {
    const command = event.input?.command;
    return typeof command === 'string' && /\bpkill\b/.test(command) ? { block: true, reason: WORDS } : undefined;
  });
}
