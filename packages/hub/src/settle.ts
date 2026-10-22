// Each thread's start-up leaves garbage V8 keeps while the thread idles: one collection once the thread is
// warm returns it, so an idle hub holds only what it uses.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

export function shedStartup(): void {
  setFlagsFromString('--expose-gc');
  (runInNewContext('gc') as () => void)();
}
