// The readings in the hub (#45): the record's events fed to @deepbuild/readings as they land, served as numbers.read and
// deep_search, with `deep numbers` over them. Your labelled samples, the private baseline and the forge are read only when
// you name them; a number any of them should give and doesn't reads missing.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { baselineMessages, CLASSIFIED, checkClassifier, decisionOneInputs, freshness, isItDone, isRework, lifecycleNumbers, panelRows, readingsOf, recompute, recomputeBaseline, searchReadings, update, type BaselineMeasure, type LabelledMessage, type MergedPr, type Reading, type ReadingsState, type RecordEvent } from '@deepbuild/readings';
import { scrubText } from '@deepbuild/evidence';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import { Forge } from './forge.js';
import { isStatusQuestion } from './verdict-chat.js';

const HOUR = 3_600_000;
/** How long each outside source stays fresh; the record is read as it lands, so it never goes stale. */
const FRESH_FOR: Record<string, number> = { github: 24 * HOUR };
const KINDS = ['user.ask', 'agent.stop', 'stop.held', 'run.started', 'run.finished', 'run.stale', 'check.held', 'check.held_start', 'turn.usage', 'session.start', 'reading.recorded', 'ask.created', 'ask.answered', 'verdict.made', 'claim.made'];
const CLASSIFIERS = { is_it_done: isItDone, rework: isRework };
const quoted = KINDS.map((k) => `'${k}'`).join(', ');
const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
/** How a recorded baseline count's id says which classifier counted it. */
const suffixOf = (kind: string | undefined): string => (kind === 'rework' ? `rework${CLASSIFIED}` : kind === 'is_it_done' ? `isitdone${CLASSIFIED}` : '');
const SAMPLE = 120;
/** The reading that names the messages `deep numbers sample` took from a manifest, by their evidence's hash. */
const POOL = 'reading:labelpool';
const SAME_MESSAGE_MS = 60_000;
/** The record cuts a message's text after this, so a longer one is compared by what it kept. */
const CUT = 8000;
/** A refresh is yours to wait for, and reads a call or two per pull request: longer than a receipt's forge budget. */
const REFRESH_MS = 60_000;
/** An event's id holds its time; the sample hides it behind a hash. */
const opaque = (id: string): string => createHash('sha256').update(id).digest('hex').slice(0, 16);

export interface NumbersOptions {
  raw(query: string): Promise<unknown[]>;
  now: () => number;
  append(connection: Connection, input: EventInput): Promise<void>;
  core: Connection;
  root: string;
  forge: string;
  token(): Promise<string | undefined>;
  /** Keeps bytes as evidence; resolves with their hash. */
  keep(bytes: Uint8Array, source: string): Promise<string>;
  evidence(sha256: string): Promise<Uint8Array | null>;
  /** Values the hub holds, scrubbed from text it stores. */
  held(): readonly string[] | undefined;
}
interface Row { id: string; kind: string; v: number; ts: number; session_id: string | null; subject: string | null; data: string; log_pos: number }

export class Numbers {
  private state: ReadingsState = recompute([]);
  private events: RecordEvent[] = [];
  private at = 0;
  private catching: Promise<void> = Promise.resolve();
  /** The session each claim and run belongs to: the core writes a run with no session of its own. */
  private readonly claims = new Map<string, string>();
  private readonly runs = new Map<string, string>();
  private readonly pools = new Map<string, { before: number; messages: Record<string, string> }>();
  private taking: Promise<unknown> = Promise.resolve();
  constructor(private readonly o: NumbersOptions) {}

  /** One at a time, so two reads never fold the same rows. */
  private catchUp(): Promise<void> {
    this.catching = this.catching.then(() => this.fold(), () => this.fold());
    return this.catching;
  }
  private async fold(): Promise<void> {
    const rows = (await this.o.raw(`SELECT id, kind, v, ts, session_id, subject, data, log_pos FROM events WHERE log_pos > ${this.at} AND (kind IN (${quoted}) OR (kind = 'tool.after' AND json_extract(data, '$.outcome') = 'failed')) ORDER BY log_pos`)) as Row[];
    if (!rows.length) return;
    const fresh = rows.map((r): RecordEvent => {
      const data = JSON.parse(r.data) as Record<string, unknown>;
      // The hub answers a status question from the record, so no model turn follows it.
      if (r.kind === 'user.ask' && typeof data.text === 'string' && isStatusQuestion(data.text)) data.no_model = true;
      const run = typeof data.run === 'string' ? data.run : undefined;
      if (r.kind === 'claim.made' && r.session_id) this.claims.set(`claim:${r.id}`, r.session_id);
      if (r.kind === 'run.started' && run) { const s = this.claims.get(String(data.claim)); if (s) this.runs.set(run, s); }
      const session = r.session_id ?? (run ? this.runs.get(run) : undefined) ?? null;
      return { id: r.id, kind: r.kind, v: r.v, ts: r.ts, session, subject: r.subject, data };
    });
    this.at = rows.at(-1)!.log_pos;
    this.events.push(...fresh);
    this.state = update(this.state, fresh);
  }
  /** Your own typed messages, by the opaque id `deep numbers sample` showed you. */
  private typed(): Map<string, RecordEvent> {
    return new Map(this.events.filter((e) => e.kind === 'user.ask' && e.data.from === 'person' && typeof e.data.text === 'string').map((e) => [opaque(e.id), e]));
  }
  /**
   * Your labels, as `<root>/labels/<reading>.json`: `{ threshold, before, labels: [{ message, label }] }`. Each message's
   * text and period come from the record, or from the pool `deep numbers sample` took from a manifest for that date, never
   * the file, and one neither holds doesn't count. A file that can't be read is no check.
   */
  private async checks() {
    const typed = this.typed();
    return Promise.all(Object.entries(CLASSIFIERS).map(async ([id, classifier]) => {
      try {
        const { threshold, before, labels } = JSON.parse(readFileSync(join(this.o.root, 'labels', `${id}.json`), 'utf8')) as { threshold: number; before: number; labels: { message: string; label: boolean }[] };
        if (typeof threshold !== 'number') return { id, check: null };
        const pool = await this.pool(before);
        // A message labelled twice is one message.
        const sample = [...new Map(labels.map((l) => [l.message, l])).values()].flatMap((l): LabelledMessage[] => {
          const e = typed.get(l.message);
          const text = e ? String(e.data.text) : Object.hasOwn(pool, l.message) ? pool[l.message] : undefined;
          return text === undefined ? [] : [{ message: l.message, text, label: l.label, period: !e || e.ts < before ? 'baseline' : 'dogfood', dates_hidden: true, labelled_by: 'you' }];
        });
        return { id, check: checkClassifier({ id, classifier, sample, threshold }) };
      } catch { return { id, check: null }; }
    }));
  }
  private async checked(readings: Reading[]): Promise<Reading[]> {
    const checks = new Map((await this.checks()).map((c) => [c.id, c.check]));
    // A baseline's classified count comes from the same pattern as the live is_it_done.
    return readings.map((r) => {
      const id = r.id.endsWith(`rework${CLASSIFIED}`) ? 'rework' : r.id.endsWith(CLASSIFIED) ? 'is_it_done' : r.id;
      return checks.has(id) ? { ...r, classifier: checks.get(id) ?? null } : r;
    });
  }
  async read(): Promise<{ rows: ReturnType<typeof panelRows>; decision_one: ReturnType<typeof decisionOneInputs> }> {
    await this.catchUp();
    return { rows: panelRows(await this.checked(readingsOf(this.state)), { now: this.o.now(), fresh_for: FRESH_FOR }), decision_one: decisionOneInputs(await this.checks()) };
  }
  /** Readings for deep_search: a call reads its own session's and those of no session, never another session's. */
  async search(query: string, session: string | undefined | { everyone: true }) {
    await this.catchUp();
    const own = typeof session === 'string' ? letters(session) : undefined;
    const events = session && typeof session !== 'string' ? this.events : this.events.filter((e) => {
      const named = e.session ?? (typeof e.data.session === 'string' ? e.data.session.slice('session:'.length) : null);
      return named === null || letters(named) === own;
    });
    return searchReadings(await this.checked(readingsOf(recompute(events))), query).map((hit) => ({ ...hit, status: freshness(hit.reading, { now: this.o.now(), fresh_for: FRESH_FOR }) }));
  }
  /** A manifest and the transcripts it names, by hash. */
  private async manifest(manifestPath: string) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { baseline_sha256: string; archive_dir?: string; measures: BaselineMeasure[] };
    const bytes = new Map<string, Uint8Array | null>();
    for (const sha of new Set(manifest.measures.flatMap((m) => m.transcripts.map((t) => t.sha256)))) {
      if (!/^[0-9a-f]{64}$/.test(sha)) { bytes.set(sha, null); continue; }
      // Named from where the manifest sits: the hub's own folder means nothing to you.
      const path = manifest.archive_dir ? join(resolve(dirname(manifestPath), manifest.archive_dir), sha) : undefined;
      bytes.set(sha, path && existsSync(path) ? readFileSync(path) : await this.o.evidence(sha));
    }
    return { manifest, bytes };
  }
  /** The pool taken for a date: only the core writes its reading, so a file can't add messages to your sample. */
  private poolSha(before: number): string | undefined {
    return this.events.flatMap((e) => (e.kind === 'reading.recorded' && e.data.reading === `${POOL}${before}` ? [String(e.data.source).slice('labelpool:'.length)] : [])).at(-1);
  }
  private async pool(before: number): Promise<Record<string, string>> {
    const sha = this.poolSha(before);
    if (!sha) return {};
    let pool = this.pools.get(sha);
    if (!pool) {
      const bytes = await this.o.evidence(sha);
      // Read as nothing, a later draw would write a smaller pool over it.
      if (!bytes) throw new Error(`the label pool ${sha} can't be read`);
      pool = JSON.parse(Buffer.from(bytes).toString('utf8')) as { before: number; messages: Record<string, string> };
      this.pools.set(sha, pool);
    }
    return pool.messages;
  }
  /**
   * Adds a manifest's messages from before the date to the date's pool, never taking one out, so a later draw can't undo
   * a label. A message the record also holds, the same words at about the same time, stays the record's.
   */
  private takePool(before: number, manifestPath: string): Promise<{ messages: Record<string, string>; lost: number }> {
    // One at a time, so two draws never merge from the same pool.
    const taken = this.taking.then(() => this.mergePool(before, manifestPath), () => this.mergePool(before, manifestPath));
    this.taking = taken.catch(() => undefined);
    return taken;
  }
  private async mergePool(before: number, manifestPath: string): Promise<{ messages: Record<string, string>; lost: number }> {
    const { manifest, bytes } = await this.manifest(manifestPath);
    const { messages, lost } = baselineMessages(manifest.measures, (sha) => bytes.get(sha) ?? null);
    const held = [...this.typed().values()];
    const values = this.o.held();
    const fresh = messages.filter((m) => m.ts < before).map((m) => ({ id: opaque(`${m.ts}:${m.text}`), ts: m.ts, text: scrubText(m.text, values ? { held: values } : undefined) })).filter((m) => !held.some((e) => m.text.slice(0, CUT) === String(e.data.text).slice(0, CUT) && Math.abs(e.ts - m.ts) < SAME_MESSAGE_MS));
    const had = await this.pool(before);
    const pool = { ...had, ...Object.fromEntries(fresh.map((m) => [m.id, m.text])) };
    if (JSON.stringify(pool) === JSON.stringify(had)) return { messages: pool, lost };
    const sha = await this.o.keep(Buffer.from(JSON.stringify({ before, messages: pool })), 'readings:label-pool');
    const ts = this.o.now();
    await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'reading.recorded', ts, evidence: [sha], data: { reading: `${POOL}${before}`, value: Object.keys(pool).length, unit: 'count', as_of: ts, source: `labelpool:${sha}`, n: Object.keys(pool).length, outside: false } });
    await this.catchUp();
    return { messages: pool, lost };
  }
  /** Recomputes the pilot baseline a manifest names, keeps its script and output as evidence, and records what it could. */
  async baseline(manifestPath: string) {
    const { manifest, bytes } = await this.manifest(manifestPath);
    const result = recomputeBaseline({ baseline_sha256: manifest.baseline_sha256, measures: manifest.measures, archive: (sha) => bytes.get(sha) ?? null });
    const evidence = [await this.o.keep(Buffer.from(result.script.text), 'readings:baseline-script'), await this.o.keep(Buffer.from(result.output.text), 'readings:baseline-output')];
    for (const m of result.measures) {
      if (m.value === null) continue;
      const ts = this.o.now();
      await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'reading.recorded', ts, evidence, data: { reading: `reading:baseline${manifest.baseline_sha256.slice(0, 8)}${letters(m.id)}${suffixOf(manifest.measures.find((x) => x.id === m.id)?.kind)}`, value: m.value, unit: 'count', as_of: ts, source: `baseline:${manifest.baseline_sha256.slice(0, 8)}`, n: m.transcripts.length, outside: false } });
    }
    return { baseline_sha256: result.baseline_sha256, script: result.script.sha256, output: result.output.sha256, measures: result.measures };
  }
  /** Reads each repo your sessions worked in from the forge; a repo the forge doesn't answer for keeps its last reading, which goes STALE. */
  async refresh(): Promise<{ repos: string[]; unread: string[] }> {
    const rows = (await this.o.raw("SELECT DISTINCT json_extract(data, '$.worktree') AS worktree FROM events WHERE kind = 'session.start'")) as { worktree: string | null }[];
    const repos = new Set<string>();
    for (const { worktree } of rows) if (worktree) { const r = await originOf(worktree); if (r) repos.add(r); }
    const token = await this.o.token();
    const unread: string[] = [];
    for (const repo of repos) {
      const [owner, name] = repo.split('/') as [string, string];
      const prs: MergedPr[] | undefined = await new Forge(this.o.forge, token, REFRESH_MS).merged(owner, name);
      if (!prs) { unread.push(repo); continue; }
      for (const n of lifecycleNumbers(repo, prs)) {
        const ts = this.o.now();
        await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'reading.recorded', ts, data: { reading: n.reading, value: n.value, unit: n.unit, as_of: ts, source: 'github', n: n.n, outside: false } });
      }
    }
    return { repos: [...repos], unread };
  }
  /** Your sample to label: your own messages at random, both sides of a date, with no date or period to see, only an opaque id. A manifest adds its transcripts' messages to the side before it. */
  async sample(before: number, manifest?: string): Promise<{ before: number; label_in: string; warning?: string; messages: { message: string; text: string }[] }> {
    await this.catchUp();
    const typed = [...this.typed()];
    const toMessage = ([message, e]: (typeof typed)[number]) => ({ message, text: String(e.data.text) });
    const taken = manifest ? await this.takePool(before, manifest) : undefined;
    const earlier = [...typed.filter(([, e]) => e.ts < before).map(toMessage), ...Object.entries(taken?.messages ?? await this.pool(before)).map(([message, text]) => ({ message, text }))];
    const later = typed.filter(([, e]) => e.ts >= before).map(toMessage);
    const shuffled = <T>(list: T[]) => list.map((e) => ({ e, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.e);
    const half = SAMPLE / 2;
    // The record holds only what the hub saw: a period before it has no messages to label without a manifest, and the check stays BLOCKED.
    const oneSided = !earlier.length || !later.length;
    const warnings = [...(oneSided ? ['There are messages from only one side of that date, so these labels can\'t pass: a check needs both periods.'] : []), ...(taken?.lost ? [`${taken.lost} of the manifest's transcripts are missing, fail their hash or have a window that isn't one, so their messages aren't here.`] : [])];
    return { before, ...(warnings.length ? { warning: warnings.join(' ') } : {}), label_in: `${join(this.o.root, 'labels')}/<is_it_done|rework>.json as { threshold, before, labels: [{ message, label }] }`, messages: shuffled([...shuffled(earlier).slice(0, half), ...shuffled(later).slice(0, half)]) };
  }
}
/** `owner/name` of a worktree's origin on GitHub, or undefined. */
const originOf = (worktree: string): Promise<string | undefined> => new Promise((done) => {
  execFile('git', ['-C', worktree, 'remote', 'get-url', 'origin'], { timeout: 2000 }, (error, stdout) => {
    done(error ? undefined : /github\.com[:/]([^/\s]+\/[^/\s]+?)(\.git)?\s*$/.exec(stdout)?.[1]);
  });
});

const AGE: [number, string][] = [[86_400_000, 'd'], [HOUR, 'h'], [60_000, 'm'], [1000, 's']];
const ageOf = (ms: number): string => { for (const [unit, name] of AGE) if (ms >= unit) return `${Math.floor(ms / unit)}${name}`; return `${ms}ms`; };
/** One line per row: what, its value, its source, how it was got and its age; STALE when its source is. */
export function numbersLines(rows: Awaited<ReturnType<Numbers['read']>>['rows']): string[] {
  return rows.map((r) => {
    const value = r.value === null ? 'unknown' : String(r.value);
    const cost = r.cost ? ` ${r.cost.basis}${r.cost.basis === 'estimated' ? ` (${r.cost.rate_card})` : ''}` : '';
    const agreement = r.agreement ? ` agrees ${r.agreement.share.toFixed(2)} of ${r.agreement.n} ${r.agreement.status}` : r.id in CLASSIFIERS || r.id.endsWith(CLASSIFIED) ? ' not checked against your labels' : '';
    const by = r.by ? ` (${Object.entries(r.by).filter(([, ms]) => ms).map(([why, ms]) => `${why} ${ms}`).join(', ')})` : '';
    return `${r.id}${r.subject ? ` ${r.subject}` : ''}: ${value} ${r.unit}${by}${cost}${r.complete === false ? ' incomplete' : ''}${r.band === 'over' ? ' OVER BUDGET' : ''}${agreement} · ${r.source} · ${r.basis} · ${ageOf(r.age_ms)}${r.status === 'STALE' ? ' · STALE' : ''}${r.detail ? ` ${JSON.stringify(r.detail)}` : ''}`;
  });
}
