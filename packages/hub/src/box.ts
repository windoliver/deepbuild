// The box (#1998; design: Setup, Add anything): a change you say in words comes back as a proposed change you approve on
// its question card, so the app needs no Settings page. Each proposal records the revision of every thing it changes:
// a spec file's commit at the branch head and its bytes' digest, a Codex file's digest, a lesson's digest, a setting's
// value. Approving it after one of them moved applies nothing, says what moved and drafts it again on the new revision;
// what an earlier proposal moved is named by that proposal. Different things never conflict. The hub reads only the
// sentences below; other words are answered with what it can read, and nothing is drafted.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseDocument, isSeq } from 'yaml';
import { ulid } from '@deepbuild/record';
import type { Plant } from './plant.js';
import { installedCodex, recordedHome } from './codex-settings.js';
import { editConfig, removeCodex } from './setup.js';

type Obj = Record<string, unknown>;
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const SPEC = join('.deepbuild', 'done.yaml');
const WEEK = 7 * 86_400_000;
/** What the box reads, said back when it reads nothing. */
const READS = 'The box reads: remove DeepBuild from Codex, stop checking <check> in <repo>, forget <lesson>, learn again, mute or unmute.';

type Change =
  | { kind: 'agent'; agent: 'codex' }
  | { kind: 'spec'; check: string; repo: string; root: string }
  | { kind: 'sounds'; on: boolean }
  | { kind: 'forget'; lesson: string; text: string }
  | { kind: 'learn' };
interface Revision { thing: string; at: string }
interface Proposal {
  id: string; words: string; created: number; change: Change; revisions: Revision[]; question: string; ask: string;
  status: 'proposed' | 'applied' | 'refused' | 'declined'; reason?: string; redraft?: string;
}
interface BoxOptions {
  root: string;
  plant: Plant | undefined;
  now(): number;
  raise(source: string, ask: Obj, plan: { steps: { does: string; changes: string[]; undo: string | null; public: boolean; cost: number }[]; diff: string }): Promise<string>;
  /** The folders of the repos the hub knows: where a spec change looks for `<repo>`. */
  folders(): Promise<string[]>;
  /** The lessons you can forget, as the memory page lists them. */
  lessons(): Promise<{ id: string; text: string }[]>;
  /** Forgets a lesson; why it didn't, if it didn't. */
  forget(lesson: string): Promise<string | undefined>;
  /** Builds the wiki again from the record. */
  learn(): Promise<void>;
}

const git = (cwd: string, args: string[]): string => {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
};
const bytesOf = (file: string): Buffer | null => { try { return readFileSync(file); } catch { return null; } };
/** Whether sounds play (#1998): `sounds` in config.json, on unless it says false. */
function soundsOn(root: string): boolean {
  try { return (JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as Obj).sounds !== false; } catch { return true; }
}

export class Box {
  private readonly dir: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly o: BoxOptions) {
    this.dir = join(o.root, 'box');
  }

  // ---- Words to a change.

  /**
   * Your words drafted as a proposal and its ask, or one line saying why nothing was drafted. `repo`, a checkout's
   * path, is the repo the words are about, when they name one.
   */
  say(words: string, repo?: string): Promise<Obj> {
    return this.serial(async () => {
      const read = await this.read(words, repo);
      if ('unread' in read) return read;
      const drafted = await this.draft(words.trim(), read.change, '');
      if ('unread' in drafted) return drafted;
      // The planted wrong program applies it at once, with its ask left waiting.
      if (this.o.plant === 'box-applies-at-once') await this.carry(drafted.change);
      return this.shown(drafted);
    });
  }
  private async read(words: string, repo?: string): Promise<{ change: Change } | { unread: string; other?: true }> {
    const said = words.trim().toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
    if (said === 'remove deepbuild from codex') return { change: { kind: 'agent', agent: 'codex' } };
    if (/^remove deepbuild from /.test(said)) return { unread: 'The box removes DeepBuild from Codex only; deep setup --undo removes it from every agent.' };
    if (/^(mute|turn (the )?sounds? off|sounds? off)$/.test(said)) return { change: { kind: 'sounds', on: false } };
    if (/^(unmute|turn (the )?sounds? on|sounds? on)$/.test(said)) return { change: { kind: 'sounds', on: true } };
    if (said === 'learn again') return { change: { kind: 'learn' } };
    const stop = /^stop checking (\S+) in (\S+)$/.exec(said);
    if (stop) {
      const [check, name] = [stop[1]!, stop[2]!];
      const folders = repo ? [repo] : await this.o.folders();
      const roots = [...new Set(folders.map((f) => git(f, ['rev-parse', '--show-toplevel'])).filter((r) => r && basename(r).toLowerCase() === name))];
      if (roots.length !== 1) return { unread: roots.length ? `${roots.length} repos are named ${name}: ${roots.join(', ')}; nothing was drafted.` : `No repo the hub knows is named ${name}${repo ? ` at ${repo}` : ''}; nothing was drafted.` };
      return { change: { kind: 'spec', check, repo: name, root: roots[0]! } };
    }
    const forget = /^forget (.+)$/.exec(said);
    if (forget) {
      const wanted = forget[1]!.split(' ').filter((w) => !['my', 'the', 'a', 'that', 'habit', 'lesson', 'rule', 'about'].includes(w));
      const found = (await this.o.lessons()).filter((l) => wanted.length && wanted.every((w) => l.text.toLowerCase().includes(w)));
      if (found.length !== 1) return { unread: found.length ? `${found.length} lessons match “${forget[1]}”; say more of one: ${found.map((l) => `“${l.text}”`).join(', ')}.` : `No lesson matches “${forget[1]}”; nothing was drafted.` };
      return { change: { kind: 'forget', lesson: found[0]!.id, text: found[0]!.text } };
    }
    // Words that ask for none of these changes are the one input's (#1342): control takes them as a new project.
    return { unread: `The box can't read “${words.trim()}” as a change. ${READS}`, other: true };
  }

  // ---- A proposal, and what it changes.

  /** The things a change touches, each named for what you'd read. */
  private things(c: Change): { thing: string; shown: string; file?: string }[] {
    if (c.kind === 'agent') return ['hooks.json', 'config.toml'].map((f) => ({ thing: `agent:codex:${f}`, shown: `Codex's ${f}`, file: join(recordedHome(this.o.root), f) }));
    if (c.kind === 'spec') return [{ thing: `spec:${c.root}`, shown: `${c.repo}'s ${SPEC}`, file: join(c.root, SPEC) }];
    if (c.kind === 'sounds') return [{ thing: 'config:sounds', shown: 'sounds' }];
    if (c.kind === 'forget') return [{ thing: `lesson:${c.lesson}`, shown: `the lesson “${c.text}”` }];
    return [];
  }
  /** A thing's revision now: a spec's last commit at the branch head and its bytes' digest, a file's digest, a value. */
  private async at(c: Change, thing: string): Promise<string> {
    if (c.kind === 'spec') return `${git(c.root, ['log', '-1', '--format=%H', 'HEAD', '--', SPEC])}:${sha(bytesOf(join(c.root, SPEC)) ?? '')}`;
    if (c.kind === 'agent') { const b = bytesOf(this.things(c).find((t) => t.thing === thing)!.file!); return b ? sha(b) : 'absent'; }
    if (c.kind === 'sounds') return String(soundsOn(this.o.root));
    if (c.kind === 'forget') { const l = (await this.o.lessons()).find((x) => x.id === c.lesson); return l ? sha(l.text) : 'gone'; }
    return '';
  }
  /** Why a change needs nothing now, if it doesn't. */
  private async alreadyTrue(c: Change): Promise<string | undefined> {
    if (c.kind === 'agent') return installedCodex(this.o.root) ? undefined : 'DeepBuild is not in Codex; nothing to remove.';
    if (c.kind === 'spec') return this.specWithout(c) === undefined ? `${c.repo}'s ${SPEC} doesn't check ${c.check}; nothing to change.` : undefined;
    if (c.kind === 'sounds') return soundsOn(this.o.root) === c.on ? `Sounds are already ${c.on ? 'on' : 'off'}.` : undefined;
    if (c.kind === 'forget') return (await this.o.lessons()).some((l) => l.id === c.lesson) ? undefined : `The lesson “${c.text}” is gone already.`;
    return undefined;
  }
  private question(c: Change): { question: string; does: string; undo: string } {
    if (c.kind === 'agent') return { question: "Remove DeepBuild from Codex? Codex's hooks.json and config.toml go back to how they were before setup, as deep setup --undo leaves them; Claude Code and the hub stay.", does: "Put Codex's hooks.json and config.toml back as they were before setup", undo: 'deep setup adds DeepBuild to Codex again' };
    if (c.kind === 'spec') return { question: `Stop checking ${c.check} in ${c.repo}? ${SPEC} no longer lists ${c.check}; you commit the file.`, does: `Take ${c.check} out of ${c.repo}'s ${SPEC}`, undo: `git checkout -- ${SPEC} in ${c.repo}` };
    if (c.kind === 'sounds') return { question: `Turn sounds ${c.on ? 'on' : 'off'}? Sounds are ${c.on ? 'off' : 'on'} now; ${c.on ? 'the question sound plays again' : 'the question sound stops'}.`, does: `Turn sounds ${c.on ? 'on' : 'off'}`, undo: c.on ? 'say mute in the box' : 'say unmute in the box' };
    if (c.kind === 'forget') return { question: `Forget the lesson “${c.text}”? Agents stop getting it.`, does: `Forget “${c.text}”`, undo: 'learn again' };
    return { question: 'Learn again? The wiki is built again from the record.', does: 'Build the wiki again from the record', undo: "can't undo" };
  }
  private async draft(words: string, change: Change, reason: string): Promise<Proposal | { unread: string }> {
    const already = await this.alreadyTrue(change);
    if (already) return { unread: already };
    const id = ulid(this.o.now());
    const revisions = await Promise.all(this.things(change).map(async (t) => ({ thing: t.thing, at: await this.at(change, t.thing) })));
    const asked = this.question(change);
    const question = `${reason ? `${reason} Drafted again: ` : ''}${asked.question}`;
    const key = sha(JSON.stringify({ kind: 'box.change', proposal: id }));
    const changes = this.things(change).map((t) => t.file ?? t.thing);
    const ask = await this.o.raise('box.change', {
      kind: 'authority', question, options: [{ id: 'apply', label: 'Apply it', decision: 'allow' }, { id: 'keep', label: 'Keep it as it is', decision: 'deny' }],
      recommended: null, deadline: this.o.now() + WEEK, fallback: 'you', default: 'keep', provisional: false, owner: 'you', key, pinned_to: { kind: 'evidence', ref: key },
    }, { steps: [{ does: asked.does, changes: changes.length ? changes : ['the wiki'], undo: asked.undo, public: false, cost: 0 }], diff: sha(JSON.stringify(revisions)) });
    const p: Proposal = { id, words, created: this.o.now(), change, revisions, question, ask, status: 'proposed' };
    this.save(p);
    return p;
  }

  // ---- Your answer.

  /** An answer to an ask the box raised; false when it isn't one. */
  delivered(ask: string, option: string | null): boolean {
    const p = this.all().find((x) => x.ask === ask);
    if (!p) return false;
    const fail = (e: unknown) => process.stderr.write(`deep hub: ${p.id}'s answer was not carried out: ${e instanceof Error ? e.message : String(e)}\n`);
    void this.serial(() => (option === 'apply' ? this.apply(p.id) : this.decline(p.id))).catch(fail);
    return true;
  }
  private async decline(id: string): Promise<void> {
    const p = this.load(id);
    if (p?.status === 'proposed') { p.status = 'declined'; this.save(p); }
  }
  private async apply(id: string): Promise<void> {
    const p = this.load(id);
    if (!p || p.status !== 'proposed') return;
    const moved = this.moved();
    const why: string[] = [];
    for (const r of p.revisions) {
      const now = await this.at(p.change, r.thing);
      if (now === r.at || this.o.plant === 'box-ignores-revision') continue;
      const shown = this.things(p.change).find((t) => t.thing === r.thing)!.shown;
      const by = moved[r.thing]?.at === now ? this.load(moved[r.thing]!.by) : undefined;
      if (by) why.push(`${shown} was changed first by ${by.ask} (“${by.words}”), approved before this one.`);
      else if (p.change.kind === 'spec' && now.split(':')[0] !== r.at.split(':')[0]) {
        const commit = now.split(':')[0]!;
        why.push(`${shown} moved at commit ${commit.slice(0, 12)} (“${git(p.change.root, ['log', '-1', '--format=%s', commit])}”) since this was drafted.`);
      } else why.push(`${shown} changed since this was drafted.`);
    }
    if (why.length) {
      p.status = 'refused';
      p.reason = `Nothing was applied: ${why.join(' ')}`;
      const again = await this.draft(p.words, p.change, p.reason);
      if (!('unread' in again)) p.redraft = again.id;
      else p.reason += ` ${again.unread}`;
      this.save(p);
      return;
    }
    await this.carry(p.change);
    p.status = 'applied';
    this.save(p);
    for (const r of p.revisions) moved[r.thing] = { at: await this.at(p.change, r.thing), by: p.id };
    this.write('moved.json', moved);
  }
  private async carry(c: Change): Promise<void> {
    if (c.kind === 'agent') removeCodex(this.o.root);
    else if (c.kind === 'spec') { const text = this.specWithout(c); if (text !== undefined) writeFileSync(join(c.root, SPEC), text); }
    else if (c.kind === 'sounds') editConfig(this.o.root, (config) => { config.sounds = c.on; });
    else if (c.kind === 'forget') { const why = await this.o.forget(c.lesson); if (why) throw Error(why); }
    else await this.o.learn();
  }
  /** The spec's text with the check taken out of every claim's checks (or, with no claims, out of its checks); undefined when it holds no such check. */
  private specWithout(c: Extract<Change, { kind: 'spec' }>): string | undefined {
    const bytes = bytesOf(join(c.root, SPEC));
    if (!bytes) return undefined;
    const doc = parseDocument(bytes.toString('utf8'));
    let changed = false;
    const claims = doc.get('claims');
    if (claims && typeof claims === 'object' && 'items' in claims) {
      for (const item of (claims as { items: { value: unknown }[] }).items) {
        const checks = (item.value as { get?(k: string): unknown })?.get?.('checks');
        if (!isSeq(checks)) continue;
        const at = checks.items.findIndex((x) => String((x as { value?: unknown }).value ?? x) === c.check);
        if (at >= 0) { checks.items.splice(at, 1); changed = true; }
      }
    } else if (doc.hasIn(['checks', c.check])) { doc.deleteIn(['checks', c.check]); changed = true; }
    return changed ? doc.toString() : undefined;
  }

  // ---- Files.

  private shown(p: Proposal): Obj {
    return { proposal: `box:${p.id}`, words: p.words, question: p.question, ask: p.ask, status: p.status, ...(p.reason ? { reason: p.reason } : {}), ...(p.redraft ? { redraft: `box:${p.redraft}` } : {}) };
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private write(name: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const file = join(this.dir, name);
    writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  private save(p: Proposal): void { this.write(`${p.id}.json`, p); }
  private load(id: string): Proposal | undefined {
    try { return JSON.parse(readFileSync(join(this.dir, `${id}.json`), 'utf8')) as Proposal; } catch { return undefined; }
  }
  private all(): Proposal[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => /^[0-9A-Z]{26}\.json$/.test(f)).sort().flatMap((f) => this.load(f.slice(0, -5)) ?? []);
  }
  private moved(): Record<string, { at: string; by: string }> {
    try { return JSON.parse(readFileSync(join(this.dir, 'moved.json'), 'utf8')) as Record<string, { at: string; by: string }>; } catch { return {}; }
  }
}
