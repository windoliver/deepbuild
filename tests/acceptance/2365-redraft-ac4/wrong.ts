// The wrong program AC4 names: "a planted archive that appends the rewritten file's tail to the old parts". A whole
// small archive of Claude Code's folder, built only on the record's and the evidence store's public entries, which
// exist at the base. It treats a transcript that is longer than its last copy as one that only grew: it keeps what it
// copied before (the old parts) and adds the scrubbed bytes past the old size (the tail). The parts representation is
// the implementer's, so the twin links its archived transcript the way the base links one, as one whole copy (old parts
// joined, then the tail) in a transcript.archived@2 event; what the record reads through it is old parts + tail.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ARCHIVE, claudeHome, handle, redacted, sha256, ulid, utf8, type World } from '../20/helpers.ts';
import type { Archiver } from './helpers.ts';

/** Every Claude Code transcript under its home's projects folder: path and session ID (the file's name). */
function claudeSources(w: World): { path: string; id: string }[] {
  const projects = join(claudeHome(w.env), 'projects');
  if (!existsSync(projects)) return [];
  return readdirSync(projects).flatMap((folder) => readdirSync(join(projects, folder))
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ path: join(projects, folder, f), id: basename(f, '.jsonl') })));
}

/** AC4's twin: a longer transcript is taken as grown, so a rewrite before its old end is never copied. */
export function tailAppendArchive(w: World): Archiver {
  const copied = new Map<string, { size: number; copy: string }>();
  const writer = w.store.connect({ role: 'deepbuild', via: 'capture' });
  return {
    async pass() {
      for (const s of claudeSources(w)) {
        const raw = readFileSync(s.path);
        const before = copied.get(s.path);
        if (before && raw.length <= before.size) continue;
        const copy = (before?.copy ?? '') + redacted(raw.subarray(before?.size ?? 0).toString('utf8'));
        const put = await writer.put({ bytes: utf8(copy), kind: 'transcript-copy', source: 'archive-twin', redaction: 'complete', license: { name: 'session', allows: [] } });
        if (put.status !== 'stored') throw Error(`BLOCKED: the store refused the twin's copy: ${put.reason}`);
        const at = w.clock.now();
        await w.record.append({ ...ARCHIVE, agent: 'claude' }, {
          v: 2, id: ulid(at), kind: 'transcript.archived', ts: at,
          data: { session: handle(s.id), evidence: put.evidence.sha256, source: { size: raw.length, sha256: sha256(raw) } },
          evidence: [put.evidence.sha256],
        });
        copied.set(s.path, { size: raw.length, copy });
      }
    },
  };
}
