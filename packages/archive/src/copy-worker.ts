// Only this worker sees raw transcript text. No raw key crosses to the record or the calling thread.
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { parentPort, type MessagePort } from 'node:worker_threads';
import { patternMatches, scrubPrefix } from '@deepbuild/evidence';
import { sourceStamp, type CopyResult, type Part, type Prefix } from './copy.ts';

const PART = 256 * 1024;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
type Obj = { [key: string]: unknown };
const object = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// The same pattern-only keys as before: a field-name mask alone is not proof that someone pasted a key.
function keysIn(text: string): string[] {
  const keys = patternMatches(text).filter(({ match, field }) => !field || patternMatches(match).some((m) => m.match === match))
    .map(({ match, at }) => ({ match, at, end: at + Buffer.byteLength(match) })).sort((a, b) => a.at - b.at || b.end - a.end);
  return keys.filter((key, n) => {
    let around = key.match;
    for (let next = n + 1; next < keys.length && keys[next]!.at < key.end; next++) if (keys[next]!.end <= key.end) around = around.replaceAll(keys[next]!.match, ' ');
    return around === key.match || around.split(/[^\w+/=]+/).some((part) => part.length >= 8 && /\d/.test(part) && /[a-z]/i.test(part));
  }).map(({ match }) => match);
}
interface Job { path: string; size: number; stamp: string; before?: Prefix; stable: boolean; held: string[]; session: string; port: MessagePort }
parentPort!.on('message', async ({ path, size, stamp, before, stable, held, session, port }: Job) => {
  const file = await open(path, 'r').catch((error: Error) => { port.postMessage({ error: error.message }); port.close(); });
  if (!file) return;
  try {
    if (sourceStamp(await file.stat({ bigint: true })) !== stamp) throw Error('the transcript changed before it could be opened');
    // Without a filesystem write journal, detecting any rewrite requires verifying the prefix. This bounded raw
    // scan never scrubs or stores it again; it cannot be replaced with sampling without losing rewrite detection.
    const buffer = Buffer.allocUnsafe(PART);
    let hash = createHash('sha256');
    let offset = 0;
    let grew = false;
    if (before && before.size <= size && before.ended !== false) {
      while (offset < before.size) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
        if (!bytesRead) throw Error('the transcript shrank during prefix verification');
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      grew = hash.copy().digest('hex') === before.sha256;
    }
    if (!grew) { offset = 0; hash = createHash('sha256'); }
    let copied = offset;
    let carry = Buffer.alloc(0);
    let ended = true;
    let pending: Buffer = Buffer.alloc(0);
    let flushAt = PART;
    const flush = async (final: boolean) => {
      if (!pending.length) return;
      const decoded = Buffer.from(pending.toString('utf8'));
      const kept = scrubPrefix(decoded, held, PART, final);
      if (!kept.end) { flushAt = pending.length + PART; return; }
      const text = decoded.subarray(0, kept.end).toString('utf8');
      // Map a scrub boundary back to source bytes; invalid UTF-8 expands to U+FFFD, but a boundary is a whole line.
      let rawEnd = 0;
      for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) rawEnd = pending.indexOf(10, rawEnd) + 1;
      if (!text.endsWith('\n')) rawEnd = pending.length;
      const input = pending.subarray(0, rawEnd);
      const part: Part = { bytes: Uint8Array.from(kept.bytes), complete: isUtf8(input), keys: [] };
      for (const line of text.split('\n')) {
        let entry: unknown;
        try { entry = JSON.parse(line); } catch { continue; }
        if (!object(entry)) continue;
        const payload = object(entry.payload) ? entry.payload : {};
        const role = entry.role ?? (object(entry.message) ? entry.message.role : undefined) ?? payload.role;
        const cwd = entry.cwd ?? (entry.type === 'session_meta' ? payload.cwd : undefined);
        if (!part.cwd && typeof cwd === 'string') part.cwd = cwd;
        if (role === 'user') for (const secret of keysIn(line)) part.keys.push({ key: sha(`secret.pasted:${session}:${secret}`), ...(typeof entry.uuid === 'string' ? { uuid: entry.uuid } : {}) });
      }
      hash.update(input); copied += input.length;
      ended = input.at(-1) === 10;
      pending = Buffer.from(pending.subarray(rawEnd));
      flushAt = PART;
      port.postMessage({ part }, [part.bytes.buffer as ArrayBuffer]);
      const [reply] = await once(port, 'message') as [{ error?: string }];
      if (reply.error) throw Error(reply.error);
    };
    const line = async (value: Buffer) => {
      pending = Buffer.concat([pending, value]);
      // A read may contain several parts; drain them before reading more. Flushing only once accumulates every
      // shortfall between a part's last newline and PART, eventually retaining most of a long transcript.
      while (pending.length >= flushAt + 65_536) await flush(false);
    };
    while (offset < size) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!bytesRead) throw Error('the transcript shrank while being copied');
      offset += bytesRead;
      const data = Buffer.concat([carry, buffer.subarray(0, bytesRead)]);
      const end = data.lastIndexOf(10) + 1;
      if (end) await line(data.subarray(0, end));
      carry = Buffer.from(data.subarray(end));
    }
    if (stable && carry.length) await line(carry);
    while (pending.length) await flush(true);
    if (sourceStamp(await file.stat({ bigint: true })) !== stamp) throw Error('the transcript changed while it was copied');
    const result: CopyResult = { grew, size: copied, sha256: hash.digest('hex'), ended };
    port.postMessage({ result });
  } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { await file.close(); port.close(); }
});
