// Each thread's start-up leaves garbage V8 keeps while the thread idles: one collection once the thread is
// warm returns it, so an idle hub holds only what it uses.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

export function shedStartup(): void {
  setFlagsFromString('--expose-gc');
  (runInNewContext('gc') as () => void)();
}

/**
 * Each worker's young generation held at 2 MB: V8 lets it grow to about 17 MB a thread while hooks arrive and gives
 * it back only after the hub has idled a while.
 */
export const YOUNG = { maxYoungGenerationSizeMb: 2 };
