// The readings in the hub (#45): the record's events fed to @deepbuild/readings as they land, served as numbers.read and
// deep_search, with `deep numbers` over them. Your labelled samples, the private baseline and the forge are read only when
// you name them; a number any of them should give and doesn't reads missing.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASSIFIED, checkClassifier, decisionOneInputs, freshness, isItDone, isRework, lifecycleNumbers, panelRows, readingsOf, recompute, recomputeBaseline, searchReadings, update, type BaselineMeasure, type LabelledMessage, type MergedPr, type Reading, type ReadingsState, type RecordEvent } from '@deepbuild/readings';
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
const SAMPLE = 120;
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
   * text and period come from the record, never the file, and one the record doesn't hold doesn't count. A file that
   * can't be read is no check.
   */
  private checks() {
    const typed = this.typed();
    return Object.entries(CLASSIFIERS).map(([id, classifier]) => {
      try {
        const { threshold, before, labels } = JSON.parse(readFileSync(join(this.o.root, 'labels', `${id}.json`), 'utf8')) as { threshold: number; before: number; labels: { message: string; label: boolean }[] };
        // A message labelled twice is one message.
        const sample = [...new Map(labels.map((l) => [l.message, l])).values()].flatMap((l): LabelledMessage[] => {
          const e = typed.get(l.message);
          return e ? [{ message: l.message, text: String(e.data.text), label: l.label, period: e.ts < before ? 'baseline' : 'dogfood', dates_hidden: true, labelled_by: 'you' }] : [];
        });
        return { id, check: checkClassifier({ id, classifier, sample, threshold }) };
      } catch { return { id, check: null }; }
    });
  }
  private checked(readings: Reading[]): Reading[] {
    const checks = new Map(this.checks().map((c) => [c.id, c.check]));
    // A baseline's classified count comes from the same pattern as the live is_it_done.
    return readings.map((r) => {
      const id = r.id.endsWith(CLASSIFIED) ? 'is_it_done' : r.id;
      return checks.has(id) ? { ...r, classifier: checks.get(id) ?? null } : r;
    });
  }
  async read(): Promise<{ rows: ReturnType<typeof panelRows>; decision_one: ReturnType<typeof decisionOneInputs> }> {
    await this.catchUp();
    return { rows: panelRows(this.checked(readingsOf(this.state)), { now: this.o.now(), fresh_for: FRESH_FOR }), decision_one: decisionOneInputs(this.checks()) };
  }
  /** Readings for deep_search: a call reads its own session's and those of no session, never another session's. */
  async search(query: string, session: string | undefined | { everyone: true }) {
    await this.catchUp();
    const own = typeof session === 'string' ? letters(session) : undefined;
    const events = session && typeof session !== 'string' ? this.events : this.events.filter((e) => {
      const named = e.session ?? (typeof e.data.session === 'string' ? e.data.session.slice('session:'.length) : null);
      return named === null || letters(named) === own;
    });
    return searchReadings(this.checked(readingsOf(recompute(events))), query).map((hit) => ({ ...hit, status: freshness(hit.reading, { now: this.o.now(), fresh_for: FRESH_FOR }) }));
  }
  /** Recomputes the pilot baseline a manifest names, keeps its script and output as evidence, and records what it could. */
  async baseline(manifestPath: string) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { baseline_sha256: string; archive_dir?: string; measures: BaselineMeasure[] };
    const bytes = new Map<string, Uint8Array | null>();
    for (const sha of new Set(manifest.measures.flatMap((m) => m.transcripts.map((t) => t.sha256)))) {
      if (!/^[0-9a-f]{64}$/.test(sha)) { bytes.set(sha, null); continue; }
      const path = manifest.archive_dir ? join(manifest.archive_dir, sha) : undefined;
      bytes.set(sha, path && existsSync(path) ? readFileSync(path) : await this.o.evidence(sha));
    }
    const result = recomputeBaseline({ baseline_sha256: manifest.baseline_sha256, measures: manifest.measures, archive: (sha) => bytes.get(sha) ?? null });
    const evidence = [await this.o.keep(Buffer.from(result.script.text), 'readings:baseline-script'), await this.o.keep(Buffer.from(result.output.text), 'readings:baseline-output')];
    for (const m of result.measures) {
      if (m.value === null) continue;
      const ts = this.o.now();
      await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'reading.recorded', ts, evidence, data: { reading: `reading:baseline${manifest.baseline_sha256.slice(0, 8)}${letters(m.id)}${manifest.measures.find((x) => x.id === m.id)?.kind === 'is_it_done' ? CLASSIFIED : ''}`, value: m.value, unit: 'count', as_of: ts, source: `baseline:${manifest.baseline_sha256.slice(0, 8)}`, n: m.transcripts.length, outside: false } });
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
      const prs: MergedPr[] | undefined = await new Forge(this.o.forge, token).merged(owner, name);
      if (!prs) { unread.push(repo); continue; }
      for (const n of lifecycleNumbers(repo, prs)) {
        const ts = this.o.now();
        await this.o.append(this.o.core, { v: 1, id: ulid(ts), kind: 'reading.recorded', ts, data: { reading: n.reading, value: n.value, unit: n.unit, as_of: ts, source: 'github', n: n.n, outside: false } });
      }
    }
    return { repos: [...repos], unread };
  }
  /** Your sample to label: your own messages at random, both sides of a date, with no date or period to see, only an opaque id. */
  async sample(before: number): Promise<{ before: number; messages: { message: string; text: string }[] }> {
    await this.catchUp();
    const typed = [...this.typed()];
    const shuffled = (list: typeof typed) => list.map((e) => ({ e, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.e);
    const half = SAMPLE / 2;
    const drawn = shuffled([...shuffled(typed.filter(([, e]) => e.ts < before)).slice(0, half), ...shuffled(typed.filter(([, e]) => e.ts >= before)).slice(0, half)]);
    return { before, messages: drawn.map(([message, e]) => ({ message, text: String(e.data.text) })) };
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
