// Planted wrong archives for AC5, test-side twins built only on the record's and the evidence store's public entries
// (which exist at the merge base) and on #20's helpers. Each archives every transcript under the agents' homes
// (scenarios.ts, transcriptsIn), links each copy or part to its session with a transcript.archived@2 event through the
// archive's connection, scrubbed as ingestion scrubs, and is wrong in exactly one way:
//
// - `rereadingArchive` keeps whole copies, as the merge base does, but decides whether a transcript changed by reading
//   it and hashing it on every pass. Its copies equal the merge base's; its second pass over an unchanged transcript
//   reads all of it, so the zero-read clause fails, naming the session and the bytes read.
// - `cutBeforeNewlineArchive` reads only what a transcript gained (it reads nothing when the size is unchanged) and
//   stores it in parts cut at the last line's end, but leaves that newline out of the part and starts the next part
//   after it. Its parts joined lack a newline at every cut, so the byte-identity clause fails, naming the session and
//   the first line that differs.

import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { ARCHIVE, handle, redacted, text, ulid, utf8, type World } from '../20/helpers.ts';
import { transcriptsIn, type Make, type Runner } from './scenarios.ts';

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

async function link(w: World, id: string, raw: Uint8Array, copy: string, held: readonly string[]): Promise<void> {
  const put = await w.store.connect({ role: 'deepbuild', via: 'capture' })
    .put({ bytes: utf8(redacted(copy, held)), kind: 'transcript-copy', source: 'archive:twin', redaction: 'complete', license: { name: 'session', allows: [] } });
  if (put.status !== 'stored') throw Error(`BLOCKED: the store refused the twin's copy: ${put.reason}`);
  const at = w.clock.now();
  await w.record.append(ARCHIVE, {
    v: 2, id: ulid(at), kind: 'transcript.archived', ts: at,
    data: { session: handle(id), evidence: put.evidence.sha256, source: { size: raw.length, sha256: sha256(raw) } },
    evidence: [put.evidence.sha256],
  });
}

/** Whole copies; every pass reads and hashes every transcript to see whether it changed. */
export const rereadingArchive: Make = async (w, held): Promise<Runner> => {
  const last = new Map<string, string>();
  return {
    async pass() {
      for (const t of transcriptsIn(w.env)) {
        const raw = await readFile(t.path);
        const sha = sha256(raw);
        if (last.get(t.path) === sha) continue;
        last.set(t.path, sha);
        await link(w, t.id, raw, text(raw), held);
      }
    },
  };
};

/** Parts of what each transcript gained, cut at the last newline, the newline itself left out of every part. */
export const cutBeforeNewlineArchive: Make = async (w, held): Promise<Runner> => {
  const from = new Map<string, number>();
  return {
    async pass() {
      for (const t of transcriptsIn(w.env)) {
        const size = (await stat(t.path)).size;
        const at = from.get(t.path) ?? 0;
        if (size <= at) continue;
        const handleOf = await open(t.path, 'r');
        const gained = Buffer.alloc(size - at);
        try { await handleOf.read(gained, 0, gained.length, at); } finally { await handleOf.close(); }
        const end = gained.lastIndexOf(0x0a);
        if (end < 0) continue;
        const part = gained.subarray(0, end); // wrong: the line's own newline belongs in this part
        from.set(t.path, at + end + 1);
        await link(w, t.id, part, text(part), held);
      }
    },
  };
};
