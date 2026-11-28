import type { AsksOptions, ThreadMessage } from './api.js';
import type { Ask } from './model.js';
import { chatThread } from './stops.js';

export async function readThreads(threads: NonNullable<AsksOptions['threads']>, open: Ask[]): Promise<void> {
  for (const ask of open) {
    const thread = chatThread(ask.data);
    if (!thread || ask.pending.moot) continue;
    const check = String(ask.data.proves);
    let messages: ThreadMessage[];
    try {
      messages = await threads.read(thread.link);
    } catch (error) {
      ask.missing = { check, reasons: [`the thread couldn't be read through the connector: ${(error as Error)?.message ?? String(error)}`], link: thread.link };
      continue;
    }
    const you = String(ask.data.owner);
    const posted = messages.findIndex((m) => m.from === you && m.at >= ask.created);
    if (posted < 0) { delete ask.missing; continue; }
    const replies = messages.slice(posted + 1).filter((m) => m.from !== you);
    if (replies.some((m) => typeof m.text === 'string' && m.text.includes(thread.expect))) {
      ask.pending.moot = { because: 'thread_replied', link: thread.link };
      continue;
    }
    const last = replies.at(-1);
    ask.missing = {
      check, link: thread.link,
      reasons: [last ? `the last reply in the thread, ${JSON.stringify(String(last.text).slice(0, 200))}, doesn't contain ${JSON.stringify(thread.expect)}` : 'no reply in the thread since your post'],
    };
  }
}
