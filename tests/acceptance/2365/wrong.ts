// The planted archives the criteria name, as test-side twins (README, Wrong programs). Each copies the Claude Code
// transcripts it is given in parts, recording each part as its own transcript.archived@1 event (`{ session,
// evidence }`, a shape the base's catalogue already has), built only on the record's and the store's public entries;
// each is wrong in exactly the way its criterion says. The criterion's own check runs on what a twin leaves and must
// fail, naming what the criterion says it names.

import { readFileSync, statSync } from 'node:fs';
import { ARCHIVE, handle, redacted, ulid, utf8, type World } from './helpers.ts';

export interface Twin { pass(): Promise<void> }
export interface Source { id: string; path: string }

/** Stores bytes of a transcript scrubbed as one part, and records it as its own transcript.archived event. */
async function part(w: World, s: Source, bytes: Buffer): Promise<string> {
  const put = await w.store.connect({ role: 'deepbuild', via: 'capture' })
    .put({ bytes: utf8(redacted(bytes.toString('utf8'))), kind: 'transcript-copy', source: 'archive-twin', redaction: 'complete', license: { name: 'session', allows: [] } });
  if (put.status !== 'stored') throw Error(`BLOCKED: the store refused the twin's part: ${put.reason}`);
  const at = w.clock.tick(1);
  await w.record.append(ARCHIVE, { v: 1, id: ulid(at), kind: 'transcript.archived', ts: at, data: { session: handle(s.id), evidence: put.evidence.sha256 }, evidence: [put.evidence.sha256] });
  return put.evidence.sha256;
}

/**
 * AC3: "an archive that cuts at the file's end": each pass stores what the file gained since its last pass, up to
 * the file's end, whether or not the last line is whole, each part scrubbed on its own.
 */
export function cutAtEndArchive(w: World, sources: readonly Source[]): Twin & { parts: string[] } {
  const at = new Map<string, number>();
  const parts: string[] = [];
  return {
    parts,
    async pass() {
      for (const s of sources) {
        const bytes = readFileSync(s.path);
        const from = at.get(s.path) ?? 0;
        if (bytes.length <= from) continue;
        parts.push(await part(w, s, bytes.subarray(from)));
        at.set(s.path, bytes.length);
      }
    },
  };
}

/**
 * AC4: "an archive that appends the rewritten file's tail to the old parts": it copies from where its last part
 * ended whenever the file is longer, never checking whether the bytes before that changed; its parts end at a line's
 * end, as the issue's parts do.
 */
export function appendTailArchive(w: World, sources: readonly Source[]): Twin {
  const at = new Map<string, number>();
  return {
    async pass() {
      for (const s of sources) {
        if (statSync(s.path).size <= (at.get(s.path) ?? 0)) continue;
        const bytes = readFileSync(s.path);
        const from = at.get(s.path) ?? 0;
        const end = bytes.lastIndexOf(10) + 1;
        if (end <= from) continue;
        await part(w, s, bytes.subarray(from, end));
        at.set(s.path, end);
      }
    },
  };
}
