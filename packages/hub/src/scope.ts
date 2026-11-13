// Size and scope at the done gate (#324; design: An agent says it's done, Size and scope): a reading with no model,
// never a verdict. Each judged stop's claim is measured against its base (packages/gate's size.ts), compared with the
// task's plan and with the changes you accepted for the same kind of issue in that repo, the median of the last 20,
// and recorded as claim.sized. What's over the usual size or outside the plan is sent back once with the numbers;
// still there at a later stop, it's one taste call for you; never the same question twice. A plan marked large is
// sized when its definition locks, before any code, and one past the usual size comes to you once.
import { exec as run } from './children.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Asks } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { diffOf, gitEnv, itemChanges, LAST, measure, over, OVER, usualOf, type ItemChange, type Usual } from '@deepbuild/gate';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import type { Plan } from './ask-tasks.js';
import { headOf } from './session-facts.js';

type Obj = Record<string, unknown>;
/** What the send-back asks of the agent, in the design's words. */
const CUT_IT = 'Cut it to what the issue needs, or say why each part is needed.';
/** How much of a diff a taste call carries in its question, and the most a question holds; the whole diff is pinned as evidence. */
const DIFF_SHOWN = 3000;
const QUESTION_MAX = 8000;
/** A conventional commit's type, as the repo's history names the kind of change; feat is a feature. */
const CONVENTIONAL = /^([a-z]+)(?:\([^)]*\))?!?:/;

interface ScopeOptions {
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  append(connection: Connection, input: EventInput): Promise<void>;
  /** The core's connection for a session's events. */
  connection(session: string, agent: string): Connection;
  asks(): Asks;
  now(): number;
  pin(cwd: string, question: string): Promise<Obj>;
  keep(bytes: Uint8Array, source: string): Promise<string>;
  /** The kind of issue and the plan a task's definition was handed with. */
  scopeOf(task_ref: string): Promise<{ kind: string | null; plan: Plan | null }>;
  /** Where the canvas core keeps each revision's canonical document, by its hash. */
  evidence: string;
  /** The changes you accepted, from DEEP_HUB_TEST_ACCEPTED; only tests set it. Without it, the repo's own history. */
  accepted: string | undefined;
}
/** One change you accepted: its repo, its kind, and its commit with the base it was made on. */
interface Accepted { repo: string; kind: string; base: string; commit: string; accepted_at: number }
/**
 * A claim at its stop: its task, base and folder, its requirements' words, and the files its checks read; whether a
 * question holds the stop's send-back (#325), and the wall-clock time past which its reply can no longer carry one.
 */
interface AtStop { claim: string; task: string; session: string; agent: string; cwd: string; base: string; requirements: { id: string; text: string }[]; reached: string[] | undefined; holds: boolean; deadline: number }

export class SizeScope {
  /** Each accepted change's size, by repo, base and commit: measured once. */
  private readonly sizes = new Map<string, { lines: number; files: number }>();
  constructor(private readonly o: ScopeOptions) {}

  /** The usual size of a change of `kind` in the repo at `cwd` as of commit `at`: the median of the last 20 you accepted; null with none, or no kind. */
  async usual(cwd: string, kind: string | null, at: string): Promise<Usual | null> {
    if (!kind) return null;
    const accepted = (await this.acceptedIn(cwd, at)).filter((a) => a.kind === kind).sort((a, b) => a.accepted_at - b.accepted_at).slice(-LAST);
    const sizes: { lines: number; files: number }[] = [];
    for (const a of accepted) {
      const key = `${a.repo}\0${a.base}\0${a.commit}`;
      let size = this.sizes.get(key);
      if (!size) {
        const m = await measure(cwd, a.base, a.commit).catch(() => undefined);
        if (!m) continue;
        size = { lines: m.added + m.removed, files: m.files.length };
        this.sizes.set(key, size);
      }
      sizes.push(size);
    }
    return usualOf(sizes);
  }
  /**
   * The changes accepted in the repo at `cwd`: the test's list, or each first-parent commit up to `at` whose subject
   * names its kind, so the session's own commits since its base never count as accepted.
   */
  private async acceptedIn(cwd: string, at: string): Promise<Accepted[]> {
    if (this.o.accepted) {
      const list = await readFile(this.o.accepted, 'utf8').then((t) => (JSON.parse(t) as { accepted?: Accepted[] }).accepted ?? []).catch(() => []);
      return list.filter((a) => a.repo === cwd);
    }
    const { error, stdout } = await run('git', ['-C', cwd, 'log', '--first-parent', '--no-merges', '-n', '200', '--format=%H %P %ct %s', at], { env: gitEnv(), timeout: 10_000 });
    const log = error ? '' : stdout;
    return log.split('\n').flatMap((line) => {
      const [commit, base, at, ...subject] = line.split(' ');
      const type = CONVENTIONAL.exec(subject.join(' '))?.[1];
      return commit && base && type ? [{ repo: cwd, kind: type === 'feat' ? 'feature' : type, base, commit, accepted_at: Number(at) * 1000 }] : [];
    });
  }

  /**
   * The keys of the asks size and scope raised in a session, found again from the record: the plan's for each task
   * it locked, and each taste call's from what its stop asked. DeepBuild's readings, never a question the agent left,
   * so none of them holds a send-back.
   */
  async keysIn(session: string): Promise<Set<string>> {
    const locked = (await this.o.raw(`SELECT DISTINCT json_extract(data, '$.task_ref') AS task FROM events WHERE kind = 'definition.locked' AND session_id = ?`, [session])) as { task: string }[];
    const sized = (await this.o.raw(`SELECT data FROM events WHERE kind = 'claim.sized' AND session_id = ?`, [session])) as { data: string }[];
    const keys = new Set(locked.map((r) => sha256Hex(canonicalize({ kind: 'size.plan', task_ref: r.task }))));
    for (const row of sized) {
      const d = JSON.parse(row.data) as { task_ref: string; asked: string[] };
      if (d.asked.length) keys.add(sha256Hex(canonicalize({ kind: 'size.scope', task_ref: d.task_ref, found: [...d.asked].sort() })));
    }
    return keys;
  }
  /** A task's definition locked: a plan marked large whose scope is past the usual size comes to you once, before any code. */
  async planned(r: { task_ref: string; session: string; agent: string; cwd: string }): Promise<void> {
    const { kind, plan } = await this.o.scopeOf(r.task_ref);
    // The usual size is measured now, at the lock, so the task's first stop doesn't wait for it.
    const head = await headOf(r.cwd).catch(() => undefined);
    const usual = head ? await this.usual(r.cwd, kind, head.sha) : null;
    if (!plan?.large) return;
    const files = plan.scope.files.length;
    if (!usual || files <= OVER * usual.files) return;
    const key = sha256Hex(canonicalize({ kind: 'size.plan', task_ref: r.task_ref }));
    if ((await this.o.raw('SELECT 1 FROM asks WHERE key = ? LIMIT 1', [key])).length) return;
    const shown = plan.scope.files.slice(0, 20).join(', ') + (files > 20 ? `, and ${files - 20} more` : '');
    const parts = plan.scope.parts.slice(0, 20).join(', ') + (plan.scope.parts.length > 20 ? `, and ${plan.scope.parts.length - 20} more` : '');
    const asking = `The plan for ${r.task_ref} is marked large, and its scope names ${files} files${plan.scope.parts.length ? ` and ${plan.scope.parts.length} parts (${parts})` : ''} against a usual ${usual.files} files for a ${kind} change in this repo, the median of the last ${usual.n} you accepted: ${shown}. Approve the plan, shrink it, or split the issue?`;
    const question = asking.length > QUESTION_MAX ? `${asking.slice(0, QUESTION_MAX - 1)}…` : asking;
    await this.o.asks().raise(this.o.connection(r.session, r.agent), 'done.plan', {
      kind: 'choice', question, recommended: 'approve', fallback: 'you', provisional: false, owner: 'you', key, pinned_to: await this.o.pin(r.cwd, question),
      options: [{ id: 'approve', label: 'Approve the plan as it is', decision: 'none' }, { id: 'shrink', label: 'Shrink it to what the issue needs', decision: 'none' }, { id: 'split', label: 'Split the issue', decision: 'none' }],
    });
  }

  /**
   * A judged stop's claim, measured and recorded as claim.sized: what it sends the agent back with, once for each
   * thing over or outside the plan, or undefined. What was sent back and is still there comes to you as one taste call.
   */
  async atStop(s: AtStop): Promise<string | undefined> {
    const { kind, plan } = await this.o.scopeOf(s.task);
    const m = await measure(s.cwd, s.base);
    const usual = await this.usual(s.cwd, kind, s.base);
    const lines = m.added + m.removed;
    const big = over({ lines, files: m.files.length }, usual);
    const biggest = [...m.files].sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path)).slice(0, 5).map((f) => ({ path: f.path, lines: f.added + f.removed }));
    // Outside the plan is read only where a plan scopes it: its files, its dependencies and folders, its parts.
    const files = plan?.scope.files ?? [];
    const inPlan = (path: string) => files.some((f) => path === f || path.startsWith(f.endsWith('/') ? f : `${f}/`));
    const dependencies = plan ? m.dependencies.filter((d) => !plan.scope.dependencies.includes(d.name)) : [];
    const folders = plan ? m.folders.filter((f) => !plan.scope.folders.includes(f.name) && !files.some((p) => p === f.name || p.startsWith(`${f.name}/`))) : [];
    // A service or cloud resource is in the plan when its parts name it, as `service api` or `aws_s3_bucket.logs`.
    const resources = plan ? m.resources.filter((r) => !plan.scope.parts.includes(r.name)) : [];
    const unreached = !files.length ? [] : s.reached ? m.files.map((f) => f.path).filter((p) => !inPlan(p) && !s.reached!.includes(p)) : null;
    const items = plan ? await this.items(s, plan) : [];
    const found = [
      ...(big ? ['size'] : []), ...(unreached ?? []).map((p) => `file:${p}`), ...dependencies.map((d) => `dependency:${d.name}`),
      ...resources.map((r) => `resource:${r.name}`), ...folders.map((f) => `folder:${f.name}`), ...items.map((i) => `item:${i.doc}#${i.id}`),
    ];
    // What this task's stops sent back and asked before, from the record: once each.
    const before = (await this.o.raw(`SELECT data FROM events WHERE kind = 'claim.sized' AND json_extract(data, '$.task_ref') = ?`, [s.task])) as { data: string }[];
    const was = (field: 'sent_back' | 'asked') => new Set(before.flatMap((row) => (JSON.parse(row.data) as Record<string, string[]>)[field] ?? []));
    const sentBefore = was('sent_back');
    const askedBefore = was('asked');
    // Nothing is spent while a question holds the send-back, or once this stop's reply can't carry it.
    const quiet = s.holds || Date.now() > s.deadline;
    const sentBack = quiet ? [] : found.filter((f) => !sentBefore.has(f));
    const asked = quiet || sentBack.length ? [] : found.filter((f) => !askedBefore.has(f));
    const said = (keys: string[]) => {
      const has = (k: string) => keys.includes(k);
      const doc = (d: string) => items.filter((i) => has(`item:${i.doc}#${i.id}`) && i.doc === d).map((i) => i.id);
      return [
        ...(has('size') ? [`${lines} lines changed (${m.added} added, ${m.removed} removed${m.duplicated ? `, ${m.duplicated} added in duplicated blocks` : ''}) over ${m.files.length} files, against a usual ${usual!.lines} lines over ${usual!.files} files for a ${kind} change in this repo, the median of the last ${usual!.n} you accepted; the biggest additions: ${biggest.map((b) => `${b.path} (${b.lines})`).join(', ')}`] : []),
        ...(unreached ?? []).filter((p) => has(`file:${p}`)).map((p) => `${p} changed, and neither the plan nor any check reaches it`),
        ...dependencies.filter((d) => has(`dependency:${d.name}`)).map((d) => `the dependency ${d.name}, added in ${d.from}, which the plan doesn't name`),
        ...resources.filter((r) => has(`resource:${r.name}`)).map((r) => `${r.name}, added in ${r.from}, which the plan doesn't name`),
        ...folders.filter((f) => has(`folder:${f.name}`)).map((f) => `the new top-level folder ${f.name}/, from ${f.from}, which the plan doesn't name`),
        ...[...new Set(items.map((i) => i.doc))].filter((d) => doc(d).length).map((d) => `${d}'s items ${doc(d).join(', ')} were changed, and neither the plan nor a requirement names them`),
      ];
    };
    // The taste call is raised before the reading records it as asked, so one that fails to raise is asked again.
    if (asked.length) await this.taste(s, asked, said(asked), unreached ?? []);
    const at = this.o.now();
    await this.o.append(this.o.connection(s.session, s.agent), {
      v: 1, id: ulid(at), kind: 'claim.sized', ts: at, subject: s.claim,
      data: {
        claim: s.claim, task_ref: s.task, kind, lines: { added: m.added, removed: m.removed }, files: m.files.length, usual, over: big, biggest,
        dependencies: dependencies.map((d) => ({ ...d })), folders: folders.map((f) => ({ ...f })), resources: resources.map((r) => ({ ...r })), duplicated: m.duplicated, unreached, items, sent_back: sentBack, asked,
      } as unknown as JsonValue,
    });
    if (!sentBack.length) return undefined;
    return `DeepBuild sent this claim back for its size and scope (a reading, never a FAIL):\n${said(sentBack).map((l) => `- ${l}`).join('\n')}\n${CUT_IT}`;
  }

  /** The items of the documents the session revised since its task opened that neither the plan nor a requirement names, by stable ID. */
  private async items(s: AtStop, plan: Plan): Promise<{ doc: string; id: string; change: ItemChange['change'] }[]> {
    const [opened] = (await this.o.raw(`SELECT log_pos FROM events WHERE kind = 'task.created' AND json_extract(data, '$.task_ref') = ? ORDER BY log_pos LIMIT 1`, [s.task])) as { log_pos: number }[];
    if (!opened) return [];
    const revised = (await this.o.raw(`SELECT subject, json_extract(data, '$.hash') AS hash FROM events WHERE kind = 'doc.patched' AND session_id = ? AND log_pos > ? ORDER BY log_pos`, [s.session, opened.log_pos])) as { subject: string; hash: string }[];
    const named = (id: string) => plan.scope.parts.includes(id) || s.requirements.some((q) => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(q.text));
    const out: { doc: string; id: string; change: ItemChange['change'] }[] = [];
    for (const doc of new Set(revised.map((r) => r.subject))) {
      const after = revised.filter((r) => r.subject === doc).at(-1)!.hash;
      const [was] = (await this.o.raw(`SELECT json_extract(data, '$.hash') AS hash FROM events WHERE kind = 'doc.patched' AND subject = ? AND log_pos < ? ORDER BY log_pos DESC LIMIT 1`, [doc, opened.log_pos])) as { hash: string }[];
      const read = (hash: string | undefined) => (hash ? readFile(join(this.o.evidence, hash.slice(0, 2), hash.slice(2)), 'utf8').then((t) => JSON.parse(t) as unknown).catch(() => undefined) : Promise.resolve(undefined));
      for (const c of itemChanges(await read(was?.hash), await read(after))) if (!named(c.id)) out.push({ doc, ...c });
    }
    return out;
  }

  /** One taste call for what was sent back and is still there: the numbers and the biggest additions, the files with their diff, and the items by ID. */
  private async taste(s: AtStop, keys: string[], lines: string[], unreached: string[]): Promise<void> {
    const files = unreached.filter((p) => keys.includes(`file:${p}`));
    const diff = await diffOf(s.cwd, s.base, files).catch(() => '');
    const shown = diff.length > DIFF_SHOWN ? `${diff.slice(0, DIFF_SHOWN)}\n… (the whole diff is pinned)` : diff;
    const asked = `${s.task} was sent back for its size and scope, and at this stop it still has: ${lines.join('; ')}. Keep it as it is, or have it cut to what the issue needs?${shown ? `\n\n${shown}` : ''}`;
    const question = asked.length > QUESTION_MAX ? `${asked.slice(0, QUESTION_MAX - 1)}…` : asked;
    // Never the same question twice: a taste call this task already raised for these findings isn't raised again.
    const key = sha256Hex(canonicalize({ kind: 'size.scope', task_ref: s.task, found: [...keys].sort() }));
    if ((await this.o.raw('SELECT 1 FROM asks WHERE key = ? LIMIT 1', [key])).length) return;
    const pinned = diff ? { kind: 'evidence', ref: await this.o.keep(new TextEncoder().encode(diff), `${s.claim} diff`) } : await this.o.pin(s.cwd, question);
    await this.o.asks().raise(this.o.connection(s.session, s.agent), 'done.size', {
      kind: 'taste', question, recommended: 'keep', fallback: 'you', provisional: false, owner: 'you', pinned_to: pinned, key,
      options: [{ id: 'keep', label: 'Keep it as it is', decision: 'none' }, { id: 'cut', label: 'Cut it to what the issue needs', decision: 'none' }],
    });
  }
}
