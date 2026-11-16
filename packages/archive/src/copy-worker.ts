// Only this worker sees raw transcript text. No raw key crosses to the record or the calling thread.
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { open } from 'node:fs/promises';
import { once } from 'node:events';
import { isMarkedAsUntransferable, parentPort, type MessagePort } from 'node:worker_threads';
import { patternMatches, scrubPrefix } from '@deepbuild/evidence/scrubbing';
import { sourceStamp, type CopyResult, type Part, type Prefix } from './copy.ts';

const PART = 256 * 1024;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
type Obj = { [key: string]: unknown };
const object = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// A field-name mask alone is not proof that someone pasted a key. Reuse the scrub's pattern matches instead of
// scanning each tool-result line a second time; wider matches still collapse to their independently matched key.
function keysIn(matches: { at: number; match: string; field: boolean }[]): string[] {
  const keys = matches.filter(({ match, field }) => !field || patternMatches(match).some((m) => m.match === match))
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
    let buffer = Buffer.allocUnsafe(4 * PART);
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
    let copied = offset, used = 0, flushAt = PART;
    let ended = true, cwdFound = false;
    const flush = async (final: boolean | 'growing'): Promise<boolean> => {
      const complete = final ? used : buffer.lastIndexOf(10, used - 1) + 1;
      if (!complete) return false;
      const pending = buffer.subarray(0, complete);
      const valid = isUtf8(pending);
      const decoded = valid ? pending : Buffer.from(pending.toString('utf8'));
      const kept = scrubPrefix(decoded, held, PART, final);
      if (!kept.end) { flushAt = used + PART; return false; }
      const text = decoded.subarray(0, kept.end).toString('utf8');
      let rawEnd = kept.end;
      if (!valid) {
        rawEnd = 0;
        for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) rawEnd = pending.indexOf(10, rawEnd) + 1;
        if (!text.endsWith('\n')) rawEnd = complete;
      }
      const output = isMarkedAsUntransferable(kept.bytes.buffer) ? Uint8Array.from(kept.bytes) : kept.bytes;
      const part: Part = { bytes: output, complete: valid || isUtf8(pending.subarray(0, rawEnd)), keys: [] };
      let start = 0, matched = 0;
      for (const line of text.split('\n')) {
        const end = start + Buffer.byteLength(line) + 1;
        const first = matched;
        while (matched < kept.matches.length && kept.matches[matched]!.at < end) matched++;
        start = end;
        if (cwdFound && first === matched) continue;
        let entry: unknown;
        try { entry = JSON.parse(line); } catch { continue; }
        if (!object(entry)) continue;
        const payload = object(entry.payload) ? entry.payload : {};
        const role = entry.role ?? (object(entry.message) ? entry.message.role : undefined) ?? payload.role;
        const cwd = entry.cwd ?? (entry.type === 'session_meta' ? payload.cwd : undefined);
        if (!cwdFound && typeof cwd === 'string') { part.cwd = cwd; cwdFound = true; }
        if (role === 'user') for (const secret of keysIn(kept.matches.slice(first, matched))) part.keys.push({ key: sha(`secret.pasted:${session}:${secret}`), ...(typeof entry.uuid === 'string' ? { uuid: entry.uuid } : {}) });
      }
      hash.update(pending.subarray(0, rawEnd)); copied += rawEnd;
      ended = buffer[rawEnd - 1] === 10;
      // Compact in place rather than allocating a carry, a joined input and a pending copy on every read.
      buffer.copyWithin(0, rawEnd, used); used -= rawEnd;
      flushAt = PART;
      port.postMessage({ part }, [part.bytes.buffer as ArrayBuffer]);
      const [reply] = await once(port, 'message') as [{ error?: string }];
      if (reply.error) throw Error(reply.error);
      return true;
    };
    while (offset < size) {
      while (used >= flushAt + 65_536 && await flush(false)) { /* drain before reading more */ }
      if (used === buffer.length) {
        const larger = Buffer.allocUnsafe(buffer.length * 2);
        buffer.copy(larger, 0, 0, used); buffer = larger;
      }
      const { bytesRead } = await file.read(buffer, used, Math.min(PART, buffer.length - used, size - offset), offset);
      if (!bytesRead) throw Error('the transcript shrank while being copied');
      used += bytesRead; offset += bytesRead;
    }
    if (!stable && used) used = buffer.lastIndexOf(10, used - 1) + 1;
    while (used && await flush(stable ? true : 'growing')) { /* retain an unfinished multi-line match */ }
    if (sourceStamp(await file.stat({ bigint: true })) !== stamp) throw Error('the transcript changed while it was copied');
    const result: CopyResult = { grew, size: copied, sha256: hash.digest('hex'), ended };
    port.postMessage({ result });
  } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
  finally { await file.close(); port.close(); }
});
