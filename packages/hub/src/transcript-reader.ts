

import { open, type FileHandle } from 'node:fs/promises';

import { type Plant } from './plant.js';

import type { TranscriptReading } from './session-types.js';
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const TRANSCRIPT_STEP = 64 * 1024 * 1024;
const TURN_ENTRIES = 5_000;
export interface TranscriptReaderOptions { plant: Plant | undefined }
export class TranscriptReader {
  constructor(private readonly options: TranscriptReaderOptions) {}

  /**
   * Reads what the session's transcript gained since the last hook. A turn there that made tool calls, none of
   * whose hooks reached the hub, is recorded once the next prompt shows it ended and a later hook judges it: the
   * session then reads "hooks not reaching DeepBuild", so failing open is never silent.
   */
  async readTranscript(session: TranscriptReading): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(session.transcript, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await handle.stat();
      // At most TRANSCRIPT_STEP is held at once: more growth than that is read a step at a time.
      while (size > session.read) {
        const want = Buffer.alloc(Math.min(size - session.read, TRANSCRIPT_STEP));
        // Only the bytes the read returned: a transcript cut shorter since the stat returns fewer.
        const { bytesRead } = await handle.read(want, 0, want.length, session.read);
        if (!bytesRead) return;
        const text = want.subarray(0, bytesRead);
        // Only whole lines: a line still being written is read with the next hook. A line longer than a step is
        // passed over; what is left of it doesn't parse, as no prompt or call longer than a step would.
        let end = text.lastIndexOf(0x0a) + 1;
        if (!end) {
          if (text.length < TRANSCRIPT_STEP) return;
          end = text.length;
        }
        const base = session.read;
        session.read += end;
        for (let at = 0; at < end;) {
          const from = base + at;
          const next = text.indexOf(0x0a, at) + 1 || end;
          const raw = text.subarray(at, next).toString('utf8');
          at = next;
          let line: unknown;
          try {
            line = JSON.parse(raw);
          } catch {
            continue;
          }
          // A message typed while the agent works waits in the queue, with no hook until it is dequeued (#80). The
          // desktop app queues every prompt and dequeues it at once (#340): one no hook found waiting never waited.
          if (isObj(line) && line.type === 'queue-operation') {
            const queue = session.queued ??= [];
            if (line.operation === 'enqueue' && typeof line.content === 'string') queue.push({ text: line.content, taken: false });
            // The planted wrong program counts every enqueue, the app's own before each prompt included.
            else if (line.operation === 'dequeue' && this.options.plant !== 'counts-every-enqueue') queue.shift();
            if (queue.length > 64) queue.splice(0, queue.length - 64);
          }
          if (!isObj(line) || line.isSidechain === true || !isObj(line.message)) continue;
          const content = line.message.content;
          const parts = Array.isArray(content) ? content.filter(isObj) : [];
          const prompt = line.type === 'user' && !(parts.length && parts.every((c) => c.type === 'tool_result'));
          if (line.type === 'user' && !prompt) {
            const results = session.results ??= [];
            for (const part of parts) if (part.type === 'tool_result' && typeof part.tool_use_id === 'string') results.push(part.tool_use_id);
            if (results.length > 64) results.splice(0, results.length - 64);
          }
          // A prompt's entry, which its origin joins to, opens the turn whose records its stop reads.
          if (prompt && typeof line.promptId === 'string') {
            if (session.prompts.size >= 256) session.prompts.delete(session.prompts.keys().next().value!);
            session.prompts.set(line.promptId, line);
            session.entries = [line];
          } else if (session.entries.length < TURN_ENTRIES) session.entries.push(line);
          if (prompt) {
            // A person's prompt ends the turn before it.
            if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
            session.turn = { uuid: typeof line.uuid === 'string' && line.uuid ? line.uuid : `offset:${from}`, from, calls: [] };
          } else if (line.type === 'assistant' && session.turn) {
            for (const part of parts) if (part.type === 'tool_use' && typeof part.id === 'string') session.turn.calls.push(part.id);
          }
        }
      }
    } catch {
      // A transcript that can't be read now is read from the same place with the next hook.
    } finally {
      await handle.close();
    }
  }

  /** A session's last turn ends with it: no prompt comes after it to end it. */
  endTurn(session: TranscriptReading): void {
    if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
    session.turn = undefined;
  }

  async tail(file: string, bytes: number): Promise<string> {
    try {
      const handle = await open(file, 'r');
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, bytes);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, size - length);
        return buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return '';
    }
  }
}
