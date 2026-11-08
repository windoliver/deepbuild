// AC12 #41.b131ba09: "After the new hub wrote `tool.after` events at schema v2, rolling back to the previous version
// opens the record read-only, names `tool.after` v2, turns every gate watch-only and offers the backup taken before
// the new version's first write; a hub that appends to a log holding a kind it can't read fails this test, naming the
// kind." Design, Installs and updates: "Before a new version's first write, the installer takes a backup as `deep
// backup` does. A hub that finds an event kind at a schema version newer than it knows opens the record read-only, so
// every gate turns watch-only, names the kind, and offers that backup; rolling the record back is restoring it."
//
// The scene. tool.after@1..3 already exist, so "v2" here is the running build's highest tool.after version + 1, read
// from packages/contracts/schemas: a version this build can't read. A real hub (packages/hub/test/hub.ts, withHub)
// records a session's tool calls; the installer's backups sit under the root; then, with the hub stopped, two
// tool.after rows at that newer version are written straight into ledger.db's `events` table, as a newer hub writes
// them (the same columns, the next log positions); then the hub this build makes starts on that ledger.
//
// Surface pinned (the issue and design name no code surface or folder, so these are what the tests fix):
//   - The installer keeps the backups it takes in `<root>/backups/<name>/`, each a finished `deep backup` folder
//     (ledger.db beside evidence/ and wiki/). Names sort in the order they were taken (UTC timestamps), and so do
//     their mtimes. The backup "taken before the new version's first write" is the newest finished one: a folder
//     without ledger.db is no finished backup (as `deep restore` reads it) and is never offered.
//   - The hub started on such a ledger starts and serves (withHub's readiness, then `hub.health` over the control
//     socket answers).
//   - `hub.health` answers, beside what it answers today:
//       gates: { watch_only: true, reason: <text naming the kind, its version and the backup's absolute path> }
//       record: { read_only: true, newer: [{ kind: 'tool.after', v: <that version> }, ...], backup: <that path> }
//   - The hub never appends: after hook requests for a new session and a tool call are sent and acknowledged, the
//     `events` row count, and the bytes of ledger.db and of ledger.db-wal (absent stays absent), are what they were
//     before the hub started.
// The wrong program: DEEP_HUB_PLANT=append-unknown-kind (packages/hub/src/plant.ts) is a hub that appends to a log
// holding a kind it can't read; the same judge run on it fails, naming the kind.
//
// Needs the CLI built (packages/cli/dist/main.js), as every test using packages/hub/test/hub.ts does.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ulid } from '../../../../packages/hub/src/wire.js';
import { client, hookLine, recorded, send, session, withHub } from '../../../../packages/hub/test/hub.js';

const KIND = 'tool.after';
const SCHEMAS = fileURLToPath(new URL('../../../../packages/contracts/schemas/', import.meta.url));
/** The running build's highest tool.after version + 1: the version a newer hub writes and this one can't read. */
const NEWER = Math.max(...readdirSync(SCHEMAS).map((f) => /^tool\.after@(\d+)\.json$/.exec(f)?.[1]).filter((v): v is string => v !== undefined).map(Number)) + 1;
const SESSION = '41b131ba-0000-4000-8000-000000000001';
const LATER = '41b131ba-0000-4000-8000-000000000002';

type Obj = Record<string, any>;
const digest = (path: string): string | null => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
const ledgerBytes = (root: string) => ({ db: digest(join(root, 'ledger.db')), wal: digest(join(root, 'ledger.db-wal')) });
function rows(root: string): number {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try { return (db.prepare('SELECT count(*) AS n FROM events').get() as { n: number }).n; } finally { db.close(); }
}

/** One session's hook requests, as deep-hook sends them; each resolves once the hub acknowledged it. */
function hooks(root: string, home: string, id: string) {
  const s = session(home, id);
  const hook = (event: string, extra: Record<string, unknown> = {}) => send(join(root, 'hub.sock'), hookLine(ulid(Date.now()), event, s.payload(event, extra), { ppid: process.pid }));
  return {
    async work(n: number): Promise<void> {
      await hook('SessionStart', { source: 'startup' });
      await hook('UserPromptSubmit', { prompt: 'List the files.', prompt_id: `p-${id}` });
      for (let i = 1; i <= n; i++) {
        const call = { tool_name: 'Bash', tool_input: { command: `ls -la ${i}`, description: 'List files' }, tool_use_id: `toolu_${id.slice(-4)}_${i}` };
        await hook('PreToolUse', call);
        await hook('PostToolUse', { ...call, tool_response: { stdout: 'a\nb\n', stderr: '', interrupted: false, isImage: false } });
      }
    },
  };
}

/** A finished backup as the installer takes one, through the hub's own `deep backup`, moved under `<root>/backups/`. */
async function installerBackup(root: string, home: string, cli: (m: string, p: object) => Promise<Obj>, name: string, at: Date): Promise<string> {
  const staged = join(home, `staged-${name}`);
  await cli('record.backup', { folder: staged });
  const kept = join(root, 'backups', name);
  mkdirSync(join(root, 'backups'), { recursive: true });
  renameSync(staged, kept);
  utimesSync(kept, at, at);
  return kept;
}

/** Writes `n` tool.after rows at version NEWER straight into the stopped hub's ledger, as a newer hub writes them. */
function plantNewer(root: string, n: number): void {
  const db = new DatabaseSync(join(root, 'ledger.db'));
  try {
    const newest = db.prepare('SELECT * FROM events WHERE kind = ? ORDER BY log_pos DESC LIMIT 1');
    newest.setReadBigInts(true); // seq is a nanosecond count, past a double's exact range
    const known = newest.get(KIND) as Obj | undefined;
    if (!known) throw Error(`the setup recorded no ${KIND} to model the newer rows on`);
    let pos = Number((db.prepare('SELECT max(log_pos) AS p FROM events').get() as { p: number }).p);
    for (let i = 0; i < n; i++) {
      pos += 1;
      const data = JSON.stringify({ ...JSON.parse(String(known.data)), duration_ms: 12 + i });
      db.prepare(`INSERT INTO events (id, log_pos, v, ts, project_id, session_id, seq, agent, writer, actor, scope, kind, subject, data, evidence, hash, unverified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        ulid(Date.now() + i), pos, NEWER, Date.now() + i, known.project_id, known.session_id, known.seq === null ? null : (known.seq as bigint) + BigInt(i + 1),
        known.agent, known.writer, known.actor, known.scope, KIND, known.subject, data, known.evidence, createHash('sha256').update(data).digest('hex'), 0,
      );
    }
    // The newer hub reserved its log block durably before it used any of it.
    const end = Number((db.prepare("SELECT value FROM meta WHERE key = 'log_block_end'").get() as { value: string } | undefined)?.value ?? 1);
    if (pos >= end) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('log_block_end', ?)").run(String(pos + 1024));
  } finally {
    db.close();
  }
}

/**
 * The judge: a hub that recorded a session, the installer's backups under the root, then tool.after rows at NEWER
 * written in, then this build's hub (with `plant`, if any) started on that ledger. Throws at the first thing wrong.
 */
async function rollback(plant?: string): Promise<void> {
  await withHub(async (root, home, hub) => {
    await hooks(root, home, SESSION).work(2);
    expect(await recorded(root, SESSION, KIND, 2), `the setup's ${KIND} events are in the record`).toBe(2);
    const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
    const cli = await client(join(root, 'hub.sock'), token);
    await installerBackup(root, home, cli, '2026-11-01T09-00-00Z', new Date('2026-11-01T09:00:00Z'));
    const offered = await installerBackup(root, home, cli, '2026-11-07T09-00-00Z', new Date('2026-11-07T09:00:00Z'));
    // A later backup that never finished: no ledger.db, so it is no backup to offer.
    mkdirSync(join(root, 'backups', '2026-11-07T10-00-00Z'), { recursive: true });
    writeFileSync(join(root, 'backups', '2026-11-07T10-00-00Z', 'ledger.db.partial'), '');

    let before: { rows: number; bytes: ReturnType<typeof ledgerBytes> } | undefined;
    await hub.restart(plant ? { DEEP_HUB_PLANT: plant } : {}, () => {
      plantNewer(root, 2);
      before = { rows: rows(root), bytes: ledgerBytes(root) };
    });
    // Started and serving: hook requests are acknowledged, and they append nothing.
    await hooks(root, home, LATER).work(1);
    await hooks(root, home, SESSION).work(1);
    await new Promise((r) => setTimeout(r, 2_000));
    const holding = `a log holding ${KIND} v${NEWER}, a kind at a version it can't read`;
    expect(rows(root), `the hub appended to ${holding}: the events count changed`).toBe(before!.rows);
    expect(ledgerBytes(root), `the hub wrote to ${holding}: ledger.db or its WAL changed`).toEqual(before!.bytes);

    // The hub writes a new control token at every launch and refuses an earlier launch's.
    const relaunched = readFileSync(join(root, 'control.token'), 'utf8').trim();
    const health = await (await client(join(root, 'hub.sock'), relaunched))('hub.health', {});
    const shown = JSON.stringify({ gates: health.gates, record: health.record });
    expect(health.gates?.watch_only, `every gate is watch-only on a record holding ${KIND} v${NEWER}: ${shown}`).toBe(true);
    expect(health.record?.read_only, `the record is open read-only: ${shown}`).toBe(true);
    expect(health.record?.newer, `the record names ${KIND} v${NEWER}: ${shown}`).toContainEqual({ kind: KIND, v: NEWER });
    expect(health.record?.backup, `the backup taken before the new version's first write is offered: ${shown}`).toBe(offered);
    const reason = String(health.gates?.reason ?? '');
    expect(reason, `the gates' reason names the kind: ${shown}`).toContain(KIND);
    expect(reason, `the gates' reason names the version: ${shown}`).toContain(`v${NEWER}`);
    expect(reason, `the gates' reason offers the backup: ${shown}`).toContain(offered);
  });
}

async function failureOf(f: () => Promise<void>): Promise<string | null> {
  try { await f(); return null; } catch (error) { return error instanceof Error ? error.message : String(error); }
}

describe('AC12 #41.b131ba09 rolling back over a record a newer hub wrote', () => {
  it(`AC12 #41.b131ba09 a hub on a record holding ${KIND} at a version it can't read starts read-only, names ${KIND} and the version, turns every gate watch-only, offers the newest finished backup and appends nothing`, async () => {
    await rollback();
  }, 120_000);

  it('AC12 #41.b131ba09 (wrong program) a hub that appends to a log holding a kind it can\'t read (DEEP_HUB_PLANT=append-unknown-kind) fails this test, naming the kind', async () => {
    const failure = await failureOf(() => rollback('append-unknown-kind'));
    expect(failure, 'the planted hub must fail the judge').not.toBeNull();
    expect(failure, 'it fails on its append').toContain('the hub appended');
    expect(failure, 'the failure names the kind').toContain(KIND);
  }, 120_000);
});
