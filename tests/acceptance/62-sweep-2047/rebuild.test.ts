// #62.190a469d: the learned layer rebuilt from its events equals the incremental projection byte for byte.
//
// A property over generated event sequences: each run opens a real record (file storage) over a real evidence
// store, appends learned changes through the record's own append and rollBack (the path the hub and the CLI use),
// reads every table the learned layer feeds as the appends built it, and what agents read at session start; then,
// later on the clock, closes the record, opens it again with no evidence store (a rebuild needs no bytes), rebuilds
// from the log and reads them again. Every row and column is compared as SQLite stores it (quote()), in primary-key
// order; the first difference names the table, the row and the column.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, RecordError, ulid } from '../../../packages/record/src/index.ts';
import type { Connection, RecordStore } from '../../../packages/record/src/index.ts';

const SEED = 62_190_469;
const RUNS = 150;
const T0 = 1_760_013_451_000;
const DAY = 86_400_000;

const roots: string[] = [];
afterAll(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

// ---- Writers. learn.applied and learn.widened: app, cli, core. learn.proposed: an agent through MCP. Rollbacks:
// app, cli and core may; a hook or an extension may append one, which takes nothing out of force.
const conn = (writer: string, session?: string, project?: string): Connection =>
  ({ writer, actor: 'you', scope: 'you', ...(session ? { session } : {}), ...(project ? { project } : {}) });

/** The tables the learned layer is and feeds (projections.ts: learned_layer, learned_cites, the wiki's claims and their index). */
const TABLES: { name: string; order: string[] }[] = [
  { name: 'learned_layer', order: ['id'] },
  { name: 'learned_cites', order: ['handle', 'id'] },
  { name: 'wiki_claims', order: ['handle'] },
  { name: 'wiki_sources', order: ['claim', 'n'] },
  { name: 'wiki_links', order: ['claim', 'url'] },
  { name: 'wiki_text', order: ['handle', 'page', 'text'] },
];

interface Snap { columns: string[]; rows: string[][]; order: number[] }
type Snapshot = Map<string, Snap>;

/** Every row and column as stored: quote() keeps type and bytes (NULL vs '', 1 vs '1'), columns in table order. */
async function snapshot(record: RecordStore, sessions: string[]): Promise<Snapshot> {
  const out: Snapshot = new Map();
  for (const t of TABLES) {
    const columns = ((await record.raw('SELECT name FROM pragma_table_info(?) ORDER BY cid', [t.name])) as { name: string }[]).map((c) => c.name);
    const sql = `SELECT ${columns.map((c) => `quote("${c}") AS "${c}"`).join(', ')} FROM ${t.name} ORDER BY ${t.order.map((c) => `"${c}"`).join(', ')}`;
    const rows = ((await record.raw(sql)) as Record<string, string>[]).map((r) => columns.map((c) => String(r[c])));
    out.set(t.name, { columns, rows, order: t.order.map((c) => columns.indexOf(c)) });
  }
  // What agents read at session start, and what a session loads of learned steps: the public readers, as JSON.
  for (const s of sessions) {
    out.set(`startSlice(${s})`, { columns: ['json'], rows: [[JSON.stringify(await record.startSlice(s))]], order: [] });
    out.set(`loadLearned(${s})`, { columns: ['json'], rows: [[JSON.stringify(await record.loadLearned(s))]], order: [] });
  }
  return out;
}

/** The first difference between two snapshots, naming the table, the row (by key) and the column; undefined when equal. */
function firstDifference(live: Snapshot, rebuilt: Snapshot): string | undefined {
  for (const [name, a] of live) {
    const b = rebuilt.get(name);
    if (!b) return `${name}: missing after the rebuild`;
    if (a.columns.join(',') !== b.columns.join(',')) return `${name}: columns ${a.columns.join(',')} incrementally, ${b.columns.join(',')} rebuilt`;
    const n = Math.max(a.rows.length, b.rows.length);
    for (let i = 0; i < n; i++) {
      const ra = a.rows[i], rb = b.rows[i];
      const key = (r: string[]) => (a.order.length ? a.order.map((k) => `${a.columns[k]}=${r[k]}`).join(' ') : `#${i}`);
      if (!ra) return `${name}: row ${key(rb!)} only in the rebuilt layer: ${rb!.join(' | ')}`;
      if (!rb) return `${name}: row ${key(ra)} missing from the rebuilt layer: ${ra.join(' | ')}`;
      for (let c = 0; c < a.columns.length; c++) {
        if (ra[c] !== rb[c]) return `${name}: row ${key(ra)} column ${a.columns[c]}: incremental ${ra[c]}, rebuilt ${rb[c]}`;
      }
    }
  }
  for (const name of rebuilt.keys()) if (!live.has(name)) return `${name}: only after the rebuild`;
  return undefined;
}

// ---- The generated operations. Indexes into earlier changes are taken modulo how many exist when the op runs.
const SCOPES = ['session:S1', 'session:S2', 'repo:shop', 'repo:blog', 'all'] as const;
const BY = ['you', 'rule:localfirst', 'rule:install', 'rule:nopush', 'rule:unknown'] as const;
const QUOTES = ['m1', 'm2', 'm3', 'bad', 'outside', 'other', 'ev', 'evbad', 'doc', 'docbad'] as const;
const TARGETS = ['slice:api', 'slice:tests', 'wiki:shop#api', 'wiki:shop#deploy', 'step:test', 'playbook:ship', 'ext:lint', 'rule:nopush', 'kernel:core', 'nothing:here'] as const;

const FITTING = TARGETS.slice(0, 7);
const GOOD = ['m1', 'm2', 'ev', 'doc'] as const;

type Op =
  | { op: 'change'; fit: boolean; kind: 'learn.applied' | 'learn.widened'; writer: 'app' | 'cli' | 'core'; target: number; diff: number; scope: number; by: number; quotes: number[]; cite: number; supersede: number | null }
  | { op: 'base'; writer: 'app' | 'cli' | 'core'; which: 'rule' | 'guard' }
  | { op: 'propose'; target: number; diff: number }
  | { op: 'rollBack'; writer: 'app' | 'cli' | 'core' | 'hook'; change: number }
  | { op: 'rollBackSince'; writer: 'app' | 'cli' | 'core'; change: number }
  | { op: 'handRollBack'; writer: 'hook' | 'ext:lint' | 'core'; change: number }
  | { op: 'wait'; ms: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 8, arbitrary: fc.record({
    op: fc.constant('change' as const), fit: fc.boolean(), kind: fc.constantFrom('learn.applied' as const, 'learn.applied' as const, 'learn.widened' as const),
    writer: fc.constantFrom('app' as const, 'cli' as const, 'core' as const), target: fc.nat(TARGETS.length - 1), diff: fc.nat(9), scope: fc.nat(SCOPES.length - 1),
    by: fc.nat(BY.length - 1), quotes: fc.array(fc.nat(QUOTES.length - 1), { minLength: 1, maxLength: 2 }), cite: fc.nat(50), supersede: fc.option(fc.nat(50), { freq: 2 }),
  }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('base' as const), writer: fc.constantFrom('app' as const, 'cli' as const, 'core' as const), which: fc.constantFrom('rule' as const, 'guard' as const) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('propose' as const), target: fc.nat(TARGETS.length - 1), diff: fc.nat(9) }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('rollBack' as const), writer: fc.constantFrom('app' as const, 'cli' as const, 'core' as const, 'hook' as const), change: fc.nat(50) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('rollBackSince' as const), writer: fc.constantFrom('app' as const, 'cli' as const, 'core' as const), change: fc.nat(50) }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant('handRollBack' as const), writer: fc.constantFrom('hook' as const, 'ext:lint' as const, 'core' as const), change: fc.nat(50) }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('wait' as const), ms: fc.integer({ min: 1, max: 3 * DAY }) }) },
);

/** What the generated runs produced, summed over every run: the property proves nothing unless each is reached. */
const reached = { applied: 0, refused: 0, held: 0, rolledBack: 0, flagged: 0, proposed: 0, widened: 0, learnCheck: 0, cites: 0, wikiClaims: 0, wikiSuperseded: 0, supersedesInForce: 0, refusedRollBack: 0, sinceRolled: 0, apiRefusedRollBack: 0, rows: 0, runs: 0 };

/** One generated run; resolves with the first difference between the incremental and the rebuilt layer, or undefined. */
async function run(ops: Op[]): Promise<string | undefined> {
  const root = mkdtempSync(join(tmpdir(), 'deep-62-sweep-'));
  roots.push(root);
  let now = T0;
  let n = 0;
  const id = (): string => ulid(now, (n++).toString(16).padStart(20, '0'));
  const clock = (): number => now;
  const store: EvidenceStore = await openEvidenceStore({ root: join(root, 'evidence'), now: clock });
  const path = join(root, 'record.db');
  const record = await openRecord({ path, now: clock, evidence: store });

  // Two sessions: S1 in shop, whose transcript holds your words and a fetched page; S2 in blog.
  const sessions: Record<string, string> = {};
  const start = async (name: string, project: string, entries: object[]): Promise<void> => {
    const S = id();
    sessions[name] = S;
    await record.append(conn('hook', S, project), { v: 1, id: id(), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: `~/src/${project}`, branch: 'main', thread: S } });
    const bytes = new Uint8Array(Buffer.from(entries.map((e) => JSON.stringify(e)).join('\n') + '\n'));
    const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes, kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
    if (put.status !== 'stored') throw new Error(`BLOCKED: the evidence store refused ${name}'s transcript`);
    await record.append(conn('app'), { v: 1, id: id(), kind: 'transcript.archived', ts: now, data: { session: `session:${S}`, evidence: put.evidence.sha256 } });
  };
  const said = (uuid: string, text: string) => ({ type: 'user', uuid, message: { role: 'user', content: text } });
  await start('S1', 'shop', [
    said('m1', 'the api runs on 4100'),
    said('m2', 'run the tests with npm test'),
    said('m3', 'never push without asking'),
    { type: 'assistant', uuid: 'c1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu1', name: 'WebFetch', input: { url: 'https://example.com' } }] } },
    { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu1', content: 'the docs say deploy with make ship' }] } },
  ]);
  await start('S2', 'blog', [said('n1', 'the blog builds with hugo')]);
  const S1 = sessions.S1!, S2 = sessions.S2!;
  const ev = await record.keep(conn('app', undefined, 'shop'), { bytes: new Uint8Array(Buffer.from('shop notes: the api runs on 4100 behind nginx\n')), kind: 'note', source: 'notes.md' });

  const claim = (text: string, proof: number, known: string) =>
    `+ - ${text} <!-- deep:claim ${JSON.stringify({ known, proof, sources: [{ at: `session:${S1}#m1`, quote: 'runs on 4100', role: 'user' }] })} -->`;
  const DIFFS: Record<string, string[]> = {
    slice: ['+ api on 4100', '+ tests run with npm test', '- api on 4100', '+ deploy with make ship', '- never push without asking', '+ api on 4100\n+ tests run with npm test'],
    wiki: [claim('the api runs on 4100, see https://example.com/api?x=1', 1, 'you'), claim('the api runs on 4100', 2, 'inferred'), claim('deploy with make ship https://example.com/ship', 1, 'outside')],
    step: ['+ run: npm test\n+ check: npm test', '+ run: curl -s https://example.com/x', '+ mode: bypassPermissions', '+ weird: thing', '- check: npm test', '+ note: run it twice'],
    ext: ['+ note: lint quietly', '+ grant.hosts: example.com', '+ note: lint loudly'],
    other: ['+ push when green', '+ anything'],
  };
  const diffFor = (target: string, i: number): string => {
    const pool = target.startsWith('slice:') ? DIFFS.slice! : target.startsWith('wiki:') ? DIFFS.wiki! : target.startsWith('step:') || target.startsWith('playbook:') ? DIFFS.step! : target.startsWith('ext:') ? DIFFS.ext! : DIFFS.other!;
    return pool[i % pool.length]!;
  };
  const scopeOf = (i: number): string => SCOPES[i]!.replace('S1', S1).replace('S2', S2);
  // Every change appended so far, by event ID, with what it holds, for citations, supersedes and rollbacks.
  const changes: { id: string; layer: string; target: string; scope: string; diff: string; ts: number }[] = [];
  const pick = (i: number) => (changes.length ? changes[i % changes.length] : undefined);
  const quoteOf = (which: string, cite: number): { at: string; quote: string } => {
    const cited = pick(cite);
    switch (which) {
      case 'm1': return { at: `session:${S1}#m1`, quote: 'runs on 4100' };
      case 'm2': return { at: `session:${S1}#m2`, quote: 'npm test' };
      case 'm3': return { at: `session:${S1}#m3`, quote: 'never push' };
      case 'bad': return { at: `session:${S1}#m1`, quote: 'runs on 9999' };
      case 'outside': return { at: `session:${S1}#r1`, quote: 'deploy with make ship' };
      case 'other': return { at: `session:${S2}#n1`, quote: 'builds with hugo' };
      case 'ev': return { at: ev, quote: 'behind nginx' };
      case 'evbad': return { at: ev, quote: 'behind apache' };
      case 'doc': return cited ? { at: `doc:${cited.id}`, quote: cited.diff.split('\n')[0]!.replace(/^[+-] ?/, '').slice(0, 40) || 'x' } : { at: `session:${S1}#m1`, quote: 'runs on 4100' };
      default: return cited ? { at: `doc:${cited.id}`, quote: 'words no change holds' } : { at: `session:${S1}#m1`, quote: 'runs on 9999' };
    }
  };

  for (const o of ops) {
    switch (o.op) {
      case 'wait': now += o.ms; break;
      case 'change': {
        // A fitting change is one the layer can take: a learned target, quotes at their handles, applied by you or by
        // the local-first rule in its own session. The rest are drawn from everything, so most are refused.
        const target = o.fit ? FITTING[o.target % FITTING.length]! : TARGETS[o.target]!;
        const diff = diffFor(target, o.diff);
        const sup = o.supersede === null ? null : pick(o.supersede);
        const by = o.fit ? (o.by % 2 ? 'rule:localfirst' : 'you') : BY[o.by]!;
        const scope = o.fit && by === 'rule:localfirst' ? `session:${S1}` : scopeOf(o.scope);
        const quotes = o.fit ? o.quotes.map((q) => GOOD[q % GOOD.length]!) : o.quotes.map((q) => QUOTES[q]!);
        const e = id();
        await record.append(conn(o.writer), { v: 1, id: e, kind: o.kind, ts: now, data: {
          layer: 'learned', target, diff, evidence: quotes.map((q) => quoteOf(q, o.cite)), scope,
          replay: null, applied_by: by, supersedes: sup ? `doc:${sup.id}` : null,
        } });
        changes.push({ id: e, layer: 'learned', target, scope, diff, ts: now });
        break;
      }
      case 'base': {
        const [target, diff, quote] = o.which === 'rule'
          ? ['rule:nopush', '+ never push without asking', { at: `session:${S1}#m3`, quote: 'never push' }]
          : ['guard:nocurl', '+ match: run:curl\n+ mode: block\n+ reason: no curl from steps', { at: `session:${S1}#m2`, quote: 'npm test' }];
        const e = id();
        await record.append(conn(o.writer), { v: 1, id: e, kind: 'learn.applied', ts: now, data: { layer: 'base', target, diff, evidence: [quote], scope: 'all', replay: null, applied_by: 'you', supersedes: null } });
        changes.push({ id: e, layer: 'base', target, scope: 'all', diff, ts: now });
        break;
      }
      case 'propose': {
        // As deep_propose appends it: an agent's change, applied by no one, citing the ask it raised.
        const target = TARGETS[o.target]!;
        const diff = diffFor(target, o.diff);
        const e = id();
        await record.append(conn(`mcp:${S1}`, S1), { v: 1, id: e, kind: 'learn.proposed', ts: now, data: {
          layer: 'learned', target, diff, evidence: [{ at: `ask:${id()}`, quote: diff.slice(2) || 'x' }], scope: `session:${S1}`, replay: null, applied_by: null, supersedes: null,
        } });
        changes.push({ id: e, layer: 'learned', target, scope: `session:${S1}`, diff, ts: now });
        break;
      }
      case 'rollBack': {
        const c = pick(o.change);
        if (!c) break;
        if (o.writer === 'hook') {
          // The record refuses a hook's rollback before appending anything.
          const refused = await record.rollBack(conn('hook', S1), { change: c.id }).then(() => false, (error: unknown) => error instanceof RecordError);
          if (refused) reached.apiRefusedRollBack++;
          break;
        }
        await record.rollBack(conn(o.writer), { change: c.id });
        break;
      }
      case 'rollBackSince': {
        const c = pick(o.change);
        if (!c) break;
        reached.sinceRolled += (await record.rollBack(conn(o.writer), { since: c.ts })).length;
        break;
      }
      case 'handRollBack': {
        const c = pick(o.change);
        if (!c) break;
        const inverted = c.diff.split('\n').map((l) => (l.startsWith('+') ? `-${l.slice(1)}` : `+${l.slice(1)}`)).join('\n');
        await record.append(conn(o.writer, o.writer === 'hook' ? S1 : undefined), { v: 1, id: id(), kind: 'learn.rolled_back', ts: now, data: {
          layer: c.layer, target: c.target, diff: inverted, evidence: [], scope: c.scope, replay: null, applied_by: 'you', supersedes: `doc:${c.id}`,
        } });
        break;
      }
    }
  }

  const live = await snapshot(record, [S1, S2]);
  const learned = live.get('learned_layer')!;
  const col = (name: string) => learned.columns.indexOf(name);
  for (const r of learned.rows) {
    const state = r[col('state')], kind = r[col('kind')];
    if (state === "'applied'") reached.applied++;
    if (state === "'refused'") reached.refused++;
    if (state === "'held'") reached.held++;
    if (state === "'rolled_back'") reached.rolledBack++;
    if (state === "'proposed'") reached.proposed++;
    if (r[col('flagged')] !== 'NULL') reached.flagged++;
    if (kind === "'learn.widened'") reached.widened++;
    if (kind === "'learn.rolled_back'" && state === "'refused'") reached.refusedRollBack++;
  }
  reached.rows += learned.rows.length;
  reached.cites += live.get('learned_cites')!.rows.length;
  const wiki = live.get('wiki_claims')!;
  reached.wikiClaims += wiki.rows.length;
  reached.wikiSuperseded += wiki.rows.filter((r) => r[wiki.columns.indexOf('state')] === "'superseded'").length;
  reached.supersedesInForce += learned.rows.filter((r) => r[col('supersedes')] !== 'NULL' && r[col('state')] === "'applied'").length;
  reached.learnCheck += Number(((await record.raw("SELECT count(*) AS n FROM events WHERE kind = 'learn_check.made'")) as { n: number }[])[0]!.n);
  reached.runs++;
  await record.close();

  // Later: the clock moves on, the record opens again with no evidence store, and the layer is rebuilt from the log.
  now += 40 * DAY;
  const again = await openRecord({ path, now: clock });
  try {
    await again.rebuild();
    return firstDifference(live, await snapshot(again, [S1, S2]));
  } finally {
    await again.close();
  }
}

describe('#62 the learned layer is a projection rebuilt from its events', () => {
  it('#62.190a469d the layer rebuilt from its events equals the incremental projection byte for byte', async () => {
    let mismatch: string | undefined;
    const details = await fc.check(fc.asyncProperty(fc.array(opArb, { minLength: 6, maxLength: 28 }), async (ops) => {
      const found = await run(ops);
      if (found !== undefined) mismatch = `${found}\n  ops: ${JSON.stringify(ops)}`;
      return found === undefined;
    }), { seed: SEED, numRuns: RUNS, endOnFailure: true });
    // An error a run threw (the record or the store could not open, an append refused) is no pass: it fails here.
    if (details.errorInstance && mismatch === undefined) throw details.errorInstance;
    expect(mismatch, `seed ${SEED}, run ${details.numRuns}: the rebuilt layer differs from the incremental one`).toBeUndefined();
    expect(details.failed, `seed ${SEED}: the property failed`).toBe(false);
    expect(details.numRuns, `seed ${SEED}: every run ran`).toBe(RUNS);
    // Nothing missing passes: the runs must have built real layers, with every outcome the criterion turns on.
    expect(reached.runs).toBe(RUNS);
    for (const [what, count] of Object.entries(reached)) expect(count, `seed ${SEED}: no run produced ${what}`).toBeGreaterThan(0);
  }, 600_000);
});
