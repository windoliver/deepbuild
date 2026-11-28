import { open, type FileHandle } from 'node:fs/promises';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export interface LiveTurn { uuid: string; from: number; calls: string[]; at?: number }
export interface LiveTranscript {
  transcript: string; read: number; turn: LiveTurn | undefined; closed: LiveTurn[];
  prompts: Map<string, Obj>; entries: Obj[]; results?: string[]; grewAt?: number;
  queued?: { text: string; taken: boolean }[];
}
const TRANSCRIPT_STEP = 64 * 1024 * 1024;
const TURN_ENTRIES = 5_000;
export interface LiveTranscriptOptions { plant: string | undefined; now: () => number }
export class LiveTranscriptReader {
  constructor(private readonly options: LiveTranscriptOptions) {}

  async readTranscript(session: LiveTranscript, modelCalled?: (line: Obj) => Promise<void>): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(session.transcript, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await handle.stat();
      while (size > session.read) {
        const want = Buffer.alloc(Math.min(size - session.read, TRANSCRIPT_STEP));
        const { bytesRead } = await handle.read(want, 0, want.length, session.read);
        if (!bytesRead) return;
        const text = want.subarray(0, bytesRead);
        let end = text.lastIndexOf(0x0a) + 1;
        if (!end) {
          if (text.length < TRANSCRIPT_STEP) return;
          end = text.length;
        }
        const base = session.read;
        session.read += end;
        session.grewAt = this.options.now();
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
          if (isObj(line) && line.type === 'queue-operation') {
            const queue = session.queued ??= [];
            if (line.operation === 'enqueue' && typeof line.content === 'string') queue.push({ text: line.content, taken: false });
            else if (line.operation === 'dequeue' && this.options.plant !== 'counts-every-enqueue') queue.shift();
            if (queue.length > 64) queue.splice(0, queue.length - 64);
          }
          if (modelCalled && isObj(line) && line.isSidechain !== true) await modelCalled(line);
          if (!isObj(line) || line.isSidechain === true || !isObj(line.message)) continue;
          const content = line.message.content;
          const parts = Array.isArray(content) ? content.filter(isObj) : [];
          const prompt = line.type === 'user' && !(parts.length && parts.every((c) => c.type === 'tool_result'));
          if (line.type === 'user' && !prompt) {
            const results = session.results ??= [];
            for (const part of parts) if (part.type === 'tool_result' && typeof part.tool_use_id === 'string') results.push(part.tool_use_id);
            if (results.length > 64) results.splice(0, results.length - 64);
          }
          if (prompt && typeof line.promptId === 'string') {
            if (session.prompts.size >= 256) session.prompts.delete(session.prompts.keys().next().value!);
            session.prompts.set(line.promptId, line);
            session.entries = [line];
          } else if (session.entries.length < TURN_ENTRIES) session.entries.push(line);
          if (prompt) {
            if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
            session.turn = { uuid: typeof line.uuid === 'string' && line.uuid ? line.uuid : `offset:${from}`, from, calls: [] };
          } else if (line.type === 'assistant' && session.turn) {
            for (const part of parts) if (part.type === 'tool_use' && typeof part.id === 'string') session.turn.calls.push(part.id);
          }
        }
      }
    } catch {
    } finally {
      await handle.close();
    }
  }

  endTurn(session: LiveTranscript): void {
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
