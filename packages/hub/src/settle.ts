// Each thread's start-up leaves garbage V8 keeps while the thread idles: one collection once the thread is
// warm returns it, so an idle hub holds only what it uses.

/** The flag that gives every thread of a process its collector. Node takes it at launch only (#3439): whoever starts a hub passes it. */
export const COLLECTOR = '--expose-gc';

type Collect = (options: { type: 'major'; execution: 'sync'; flavor: 'last-resort' }) => void;
/** Whether this process was launched with its collector: every thread has it, or none does. */
export const collects = (): boolean => typeof (globalThis as { gc?: unknown }).gc === 'function';

/** Sheds this thread's start-up garbage. Where the process was launched without the collector it collects nothing, and never throws. */
export function shedStartup(): void {
  if (collects()) (globalThis as unknown as { gc: Collect }).gc({ type: 'major', execution: 'sync', flavor: 'last-resort' });
}

/**
 * Each worker's young generation held at 2 MB: V8 lets it grow to about 17 MB a thread while hooks arrive and gives
 * it back only after the hub has idled a while.
 */
export const YOUNG = { maxYoungGenerationSizeMb: 2 };
