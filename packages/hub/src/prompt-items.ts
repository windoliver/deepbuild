// A prompt's work source is read before the hook joins the core's chain (#2068). Only data is prepared here:
// the core still checks the prompt's origin and ownership before using it or opening a task.
import type { WorkItem } from './ask-tasks.js';
import { childPrompt, FOREIGN } from './hub-shared.js';
import type { Draft, HookMeta } from './wire.js';

export class PromptItems {
  /** Undefined means a read failed; no entry means this draft never requested one. */
  readonly items = new WeakMap<Draft, WorkItem | undefined>();
  /** A reply waits only for its own prompt's intake, never another session's read. */
  readonly replying = new Map<string, Promise<void>>();
  /** Acknowledged hooks off the chain must finish before the hub closes its record. */
  readonly pending = new Set<Promise<void>>();
  constructor(private readonly itemOf: (text: string) => Promise<WorkItem | undefined>) {}

  read(drafts: Draft[], meta: HookMeta): Promise<void> | undefined {
    if (!meta.session || FOREIGN.has(meta.agent) || childPrompt(meta)) return undefined;
    const prompts = drafts.filter((d) => d.kind === 'user.ask' && (d.data.from === 'person' || d.data.from === 'unknown') && /https?:\/\//.test(String(d.data.text)));
    if (!prompts.length) return undefined;
    return Promise.all(prompts.map(async (draft) => {
      this.items.set(draft, await this.itemOf(String(draft.data.text)));
    })).then(() => undefined);
  }

  /** Keep network work through shutdown, but let a prompt awaiting its transcript entry receive its reply (#567). */
  keep(handled: Promise<void>, meta: HookMeta, intake: Promise<unknown> | undefined): Promise<void> {
    const kept = handled.catch(() => undefined).finally(() => this.pending.delete(kept));
    this.pending.add(kept);
    if (intake) {
      const queued = intake.then(() => undefined, () => undefined).finally(() => {
        if (this.replying.get(meta.id) === queued) this.replying.delete(meta.id);
      });
      this.replying.set(meta.id, queued);
    }
    return handled;
  }
}
