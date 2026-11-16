// #2077: the adopted candidate is a durable intent before an atomic replacement. Recovery finishes its decision,
// never its eval, only while the target is still that intent's original or replacement inode and exact bytes.
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EvidenceStore } from '@deepbuild/evidence';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { decisionKey, type Lesson } from './memory.js';
import { syncPath, synced, type Durable } from './vfs.js';

interface Identity { dev: number; ino: number }
interface Intent {
  job: string; lesson: Pick<Lesson, 'id' | 'text' | 'scope'>; repo: string; file: string; before: string; after: string;
  original: Identity; staged: Identity; temp: string; report: string; id: string; ask: string; ts: number;
}
interface Services { record: RecordStore; store: EvidenceStore; root: { evidence: string }; now(): number; durable: Durable }
const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const identity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
const sha = (handle: string) => handle.replace(/^ev:/, '');

export class RemovalApplication {
  constructor(private readonly services: () => Services) {}

  /** Evidence is durable before a commit may authorize a file change. */
  async keep(job: string, value: unknown, kind: string): Promise<string> {
    const { record, store, root, now } = this.services();
    const put = await store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes: Buffer.from(JSON.stringify(value)), kind, source: job, redaction: 'complete', license: { name: 'local', allows: [] } });
    if (put.status !== 'stored') throw Error(put.reason);
    const ev = put.evidence;
    const file = join(root.evidence, ev.sha256.slice(0, 2), ev.sha256.slice(2));
    await synced(file); await synced(dirname(file)); await synced(root.evidence);
    await record.append(core, { v: 1, id: ulid(now()), ts: now(), kind: 'evidence.stored', subject: job,
      data: { sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [] }, evidence: [ev.sha256] });
    await record.sync();
    return `ev:${ev.sha256}`;
  }

  private matches(i: Intent, expected: string, file: string, id: Identity): boolean {
    try { const stat = lstatSync(file); return stat.isFile() && identity(stat, id) && realpathSync(file) === join(realpathSync(i.repo), file === i.temp ? i.temp.slice(i.repo.length + 1) : i.file) && readFileSync(file, 'utf8') === expected; }
    catch { return false; }
  }
  private discard(i: Intent): void {
    if (this.matches(i, i.after, i.temp, i.staged)) { rmSync(i.temp); syncPath(dirname(i.temp)); }
  }

  async apply(given: Omit<Intent, 'id' | 'ask' | 'ts' | 'staged' | 'temp'>, signal: AbortSignal): Promise<string> {
    const { now, durable } = this.services();
    const ts = now(), id = ulid(ts), path = join(given.repo, given.file);
    const temp = join(dirname(path), `.deepbuild-removal-${id}.tmp`);
    signal.throwIfAborted();
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, lstatSync(path).mode & 0o777);
    let staged: Identity;
    try { writeFileSync(fd, given.after); fsyncSync(fd); const s = fstatSync(fd); staged = { dev: s.dev, ino: s.ino }; }
    finally { closeSync(fd); }
    syncPath(dirname(temp));
    const intent: Intent = { ...given, id, ask: `ask:${ulid(ts)}`, ts, staged, temp };
    const handle = await this.keep(given.job, intent, 'rule-removal-intent');
    durable.point('sync_intent');
    try { signal.throwIfAborted(); return await this.finish(intent, handle, signal); }
    catch (error) {
      if (signal.aborted && this.matches(intent, intent.before, path, intent.original)) await this.hold(intent, handle, 'cancelled before replacement');
      throw error;
    }
  }

  private async hold(i: Intent, handle: string, reason: string): Promise<string> {
    this.discard(i);
    await this.keep(i.job, { intent: handle, reason }, 'rule-removal-held');
    return `BLOCKED: ${i.file}: ${reason}; nothing removed.`;
  }

  private async finish(i: Intent, handle: string, signal?: AbortSignal): Promise<string> {
    const { record, store, durable } = this.services();
    const held = (await record.raw("SELECT 1 FROM events WHERE kind = 'decision.created' AND id = ?", [i.id])).length;
    if (held) { this.discard(i); return `removed “${i.lesson.text}” from ${i.file}`; }
    const linked = await record.raw("SELECT 1 FROM events e JOIN events j ON j.subject = e.subject AND j.kind = 'job.recorded' AND json_extract(j.data, '$.kind') = 'eval' WHERE e.subject = ? AND e.kind = 'evidence.stored' AND json_extract(e.data, '$.kind') = 'configuration-result' AND json_extract(e.data, '$.origin') = 'deepbuild' AND json_extract(e.data, '$.sha256') = ?", [i.job, sha(i.report)]);
    const report = JSON.parse(Buffer.from(await store.read(sha(i.report))).toString('utf8')) as { after?: { outcome?: string } };
    if (!linked.length || report.after?.outcome !== 'adopt') throw Error(`${i.job} has no recorded adopt; nothing removed`);
    const path = join(i.repo, i.file);
    const kept = (await record.raw("SELECT 1 FROM decisions WHERE key = ? AND state = 'active'", [decisionKey(i.lesson.id)])).length;
    const replaced = this.matches(i, i.after, path, i.staged);
    if (kept || (!replaced && (!this.matches(i, i.before, path, i.original) || !this.matches(i, i.after, i.temp, i.staged)))) {
      return this.hold(i, handle, 'changed or you kept its lesson');
    }
    signal?.throwIfAborted();
    if (!replaced) { renameSync(i.temp, path); syncPath(dirname(path)); }
    durable.point('sync_flush');
    await record.append(core, { v: 1, id: i.id, ts: i.ts, kind: 'decision.created', subject: i.job,
      data: { key: decisionKey(i.lesson.id), scope: i.lesson.scope, answer: `removed ${i.lesson.id}: “${i.lesson.text}” from ${i.file} on ${i.job} (${i.report})`, ask: i.ask }, evidence: [sha(i.report), sha(handle)] });
    this.discard(i);
    return `removed “${i.lesson.text}” from ${i.file}`;
  }

  async recover(): Promise<void> {
    const { record, store } = this.services();
    const pending = await record.raw(`SELECT e.subject AS job, json_extract(e.data, '$.sha256') AS hash FROM events e
      JOIN events j ON j.subject = e.subject AND j.kind = 'job.recorded' AND json_extract(j.data, '$.kind') = 'eval' AND j.writer = 'core'
      WHERE e.kind = 'evidence.stored' AND e.writer = 'core' AND json_extract(e.data, '$.origin') = 'deepbuild' AND json_extract(e.data, '$.kind') = 'rule-removal-intent'
      AND NOT EXISTS (SELECT 1 FROM events d WHERE d.subject = e.subject AND (d.kind = 'decision.created' OR (d.kind = 'evidence.stored' AND json_extract(d.data, '$.kind') = 'rule-removal-held' AND json_extract(d.data, '$.origin') = 'deepbuild'))) ORDER BY e.log_pos`) as { job: string; hash: string }[];
    for (const row of pending) {
      const intent = JSON.parse(Buffer.from(await store.read(row.hash)).toString('utf8')) as Intent;
      if (!/^run:[0-9A-HJKMNP-TV-Z]{26}$/.test(row.job) || intent.job !== row.job || !existsSync(intent.repo) || intent.temp !== join(dirname(join(intent.repo, intent.file)), `.deepbuild-removal-${intent.id}.tmp`)) throw Error(`invalid removal intent for ${row.job}`);
      const stopped = await record.raw("SELECT 1 FROM events WHERE subject = ? AND kind = 'job.ended' AND json_extract(data, '$.state') IN ('stopped', 'refused')", [row.job]);
      if (stopped.length && this.matches(intent, intent.before, join(intent.repo, intent.file), intent.original)) await this.hold(intent, `ev:${row.hash}`, 'cancelled before replacement');
      else await this.finish(intent, `ev:${row.hash}`);
    }
  }
}
