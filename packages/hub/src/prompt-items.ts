// A prompt's work source is read before the hook joins the core's chain (#2068). Only data is prepared here:
// the core still checks the prompt's origin and ownership before using it or opening a task.
import type { WorkItem } from './ask-tasks.js';
import { ISSUE_LINK } from './github-source.js';
import { childPrompt, FOREIGN } from './hub-shared.js';
import type { Draft, HookMeta } from './wire.js';

export class PromptItems {
  /** Undefined means a read failed; no entry means this draft never requested one. */
  readonly items = new WeakMap<Draft, WorkItem | undefined>();
  private readonly requested = new WeakMap<Draft, string>();
  /** A reply waits only for its own prompt's intake, never another session's read. */
  readonly replying = new Map<string, Promise<void>>();
  /** Later hooks in this session follow its pending prompt, outside the shared chain. */
  readonly ordering = new Map<string, Promise<void>>();
  /** Live/replayed copies of an acknowledged hook share its original settlement. */
  readonly settling = new Map<string, Promise<void>>();
  /** Acknowledged hooks off the chain must finish intake before the hub closes its record. */
  readonly pending = new Set<Promise<void>>();
  constructor(private readonly itemOf: (text: string) => Promise<WorkItem | undefined>) {}

  read(drafts: Draft[], meta: HookMeta): Promise<void> | undefined {
    if (!meta.session || FOREIGN.has(meta.agent) || childPrompt(meta)) return undefined;
    const prompts = drafts.filter((d) => d.kind === 'user.ask' && (d.data.from === 'person' || d.data.from === 'app' || d.data.from === 'unknown') && /https?:\/\//.test(String(d.data.text)));
    if (!prompts.length) return undefined;
    return Promise.all(prompts.map(async (draft) => {
      const text = String(draft.data.text);
      this.requested.set(draft, ISSUE_LINK.exec(text)?.[0] ?? text);
      this.items.set(draft, await this.itemOf(text));
    })).then(() => undefined);
  }

  /** App-note placement can replace the text: bind to the requested link, not GitHub's canonical response URL. */
  item(draft: Draft): WorkItem | undefined {
    const from = draft.data.from, requested = this.requested.get(draft);
    return (from === 'person' || from === 'app') && requested && String(draft.data.text).includes(requested) ? this.items.get(draft) : undefined;
  }

  /** Keep network work through shutdown, but let a prompt awaiting its transcript entry receive its reply (#567). */
  keep(handled: Promise<void>, meta: HookMeta, intake: Promise<unknown> | undefined, afterReplay = false): Promise<void> {
    // A parked job hook settles only after the runner places it; shutdown must be able to cancel that job.
    const kept = (intake ?? handled).then(() => undefined, () => undefined).finally(() => this.pending.delete(kept));
    this.pending.add(kept);
    const settled = handled.catch(() => undefined).finally(() => {
      if (this.settling.get(meta.id) === settled) this.settling.delete(meta.id);
    });
    // A live hook waiting on spool replay cannot be a settlement that replay waits for.
    if (!afterReplay && !this.settling.has(meta.id)) this.settling.set(meta.id, settled);
    if (intake) {
      const queued = intake.then(() => undefined, () => undefined).finally(() => {
        if (this.replying.get(meta.id) === queued) this.replying.delete(meta.id);
        if (this.ordering.get(meta.session) === queued) this.ordering.delete(meta.session);
      });
      this.replying.set(meta.id, queued);
      this.ordering.set(meta.session, queued);
    }
    return handled;
  }
}
