// What a hook handler's failures leave (#2402; design: Extension API, "Several handlers, one reply"; States people see).
// Each failure, a missed deadline or a throw, goes on the record with its extension, its hook kind and the call it
// failed; the third in a row, which sets the handler aside, records that too. Each session whose calls a set-aside
// handler would have judged holds one reading that says so, as a late answer leaves one. All of it is appended off the
// hook's reply, which never waits on it.
import type { HookReply, SetAside } from '@deepbuild/extension-host';

type Obj = Record<string, unknown>;
export interface HandlerFailuresOptions {
  appendCore(kind: string, data: Obj, extra?: { subject?: string }, who?: { session?: string; agent?: string }): Promise<void>;
  appendReading(session: string, agent: string, reading: string): Promise<void>;
}

/** What a session's reading says of a set-aside handler. */
const asideWords = (a: SetAside): string =>
  `${a.extension}'s ${a.hook} handler is set aside after ${a.failures} failures in a row (the last: ${a.last}), so DeepBuild no longer asks it`;

export class HandlerFailures {
  /** The sessions told of each set-aside handler, by session, extension, hook kind and when it was set aside. */
  private readonly told = new Set<string>();
  constructor(private readonly o: HandlerFailuresOptions) {}

  /** The core forgot the session (#1866). */
  forget(session: string): void { for (const key of this.told) if (key.startsWith(`${session}\n`)) this.told.delete(key); }
  /** Records what a hook's reply says of its handlers; `call` is the agent's ID for the call, or the hook event's. */
  async note(hook: string, reply: Pick<HookReply, 'failed' | 'aside'>, call: string, session: string | undefined, agent: string | undefined): Promise<void> {
    const who = session ? { session, ...(agent ? { agent } : {}) } : {};
    for (const f of reply.failed) await this.o.appendCore('handler.failed', { extension: f.extension, hook, call, reason: f.reason }, {}, who);
    for (const a of reply.aside ?? []) {
      // The failure on this call set it aside; otherwise this call is one it would have judged.
      if (reply.failed.some((f) => f.extension === a.extension)) {
        await this.o.appendCore('handler.set_aside', { extension: a.extension, hook, call, failures: a.failures, last: a.last }, {}, who);
        continue;
      }
      const key = `${session}\n${a.extension}\n${hook}\n${a.since}`;
      if (!session || this.told.has(key)) continue;
      this.told.add(key);
      await this.o.appendReading(session, agent ?? 'unknown', `${asideWords(a)}: this session's calls go on without it until it is restarted, updated or turned on again, or the hub starts.`);
    }
  }
}
