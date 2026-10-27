// The wrong programs the criteria name, as test-side twins of the archive (README, Wrong programs). Each is a whole
// small archive of Claude Code's folder, built only on the record's and the evidence store's public entries, which
// exist at the base, and each is wrong in exactly the way its criterion says. A twin test runs the criterion's
// scenario on the real archive first, so it fails at the base, then on the twin, and expects the criterion's own
// check to fail on the twin, naming what the criterion says it names.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { ARCHIVE, claudeHome, handle, redacted, text, ulid, utf8, type World } from './helpers.ts';

export interface Twin { pass(): Promise<void>; close(): Promise<void> }

/** Every Claude Code transcript under its home's projects folder: path and session ID (the file's name). */
function claudeSources(w: World): { path: string; id: string }[] {
  const projects = join(claudeHome(w.env), 'projects');
  if (!existsSync(projects)) return [];
  return readdirSync(projects).flatMap((folder) => readdirSync(join(projects, folder))
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ path: join(projects, folder, f), id: basename(f, '.jsonl') })));
}
/** Stores a redacted copy in the world's evidence store; its hash. */
async function put(w: World, source: string): Promise<string> {
  const result = await w.store.connect({ role: 'deepbuild', via: 'capture' })
    .put({ bytes: utf8(redacted(source)), kind: 'transcript', source: 'archive-twin', redaction: 'complete', license: { name: 'own', allows: [] } });
  if (result.status !== 'stored') throw Error(`BLOCKED: the store refused the twin's copy: ${result.reason}`);
  return result.evidence.sha256;
}

/** AC9: "an archive that writes only to its own folder": redacted copies under <root>/archive/, nothing in the store or the record. */
export function ownFolderArchive(w: World): Twin {
  return {
    async pass() {
      const folder = join(w.root, 'archive', 'claude');
      mkdirSync(folder, { recursive: true });
      for (const s of claudeSources(w)) writeFileSync(join(folder, `${s.id}.jsonl`), redacted(text(readFileSync(s.path))));
    },
    async close() {},
  };
}

/**
 * AC9: "an archive whose copies the evidence retention removes": each copy goes into the evidence store, and its
 * transcript.archived link into a ledger of the archive's own (<root>/archive/ledger.db), which the retention pass
 * never reads; so nothing in the hub's record keeps the copy, and the 30-day retention removes it.
 */
export function privateLedgerArchive(w: World): Twin {
  let own: RecordStore | undefined;
  return {
    async pass() {
      mkdirSync(join(w.root, 'archive'), { recursive: true });
      own ??= await openRecord({ path: join(w.root, 'archive', 'ledger.db'), now: w.clock.now });
      for (const s of claudeSources(w)) {
        const sha = await put(w, text(readFileSync(s.path)));
        const at = w.clock.now();
        await own.append(ARCHIVE, { v: 1, id: ulid(at), kind: 'transcript.archived', ts: at, data: { session: handle(s.id), evidence: sha } });
      }
    },
    async close() { await own?.close(); },
  };
}

/** AC10: "an archive that copies once": each session's transcript is copied and linked the first time it is seen, never again. */
export function copyOnceArchive(w: World): Twin {
  const seen = new Set<string>();
  return {
    async pass() {
      for (const s of claudeSources(w)) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        const sha = await put(w, text(readFileSync(s.path)));
        const at = w.clock.now();
        await w.record.append(ARCHIVE, { v: 1, id: ulid(at), kind: 'transcript.archived', ts: at, data: { session: handle(s.id), evidence: sha } });
      }
    },
    async close() {},
  };
}
