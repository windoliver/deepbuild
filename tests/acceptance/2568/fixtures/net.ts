// A pi extension loaded after the package under test: pi runs `tool_call` handlers in load order and stops at the
// first that blocks, so this one sees a call only when the package let it through. It blocks any shell call that runs
// `pkill`, in words the tests read as "the package let this call run", so `pkill -f node` never runs on this machine.
// It decides nothing the criteria hold: it stands where the system's pkill would be.
const WORDS = 'acceptance-2568 net: the pi package let this call run';

interface Pi { on(event: 'tool_call', handler: (event: { toolName: string; input?: { command?: unknown } }) => { block: true; reason: string } | undefined): void }

export default function net(pi: Pi): void {
  pi.on('tool_call', (event) => {
    const command = event.input?.command;
    return typeof command === 'string' && /\bpkill\b/.test(command) ? { block: true, reason: WORDS } : undefined;
  });
}
