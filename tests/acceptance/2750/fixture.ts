// The fixture (README: The fixture): real commits with real trees in real git repositories behind the fixture forge
// (forge.ts), pushed with their pushers and their times, and the record as a list of the record's own events, plain
// data that helpers.ts appends through the real record. Two fixtures are built here: the shop, the issue's ten commits
// with, when a test asks, the revert and the three refused days; and the month, 2,000 commits the default branch gained
// in thirty days. Each also says how the issue's rule reads every commit it landed (`expected`), derived at the end of
// this file from its own commits, trees, pushes and events and from nothing a program under test said.
//
// Nothing here is imported from DeepBuild, and nothing but git and the forge is started.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FixtureForge, ZERO, type RefChange } from './forge.ts';
import type { Expect, Outcome, Span } from './judges.ts';

export const REPO_NAME = 'acme/shop';
/** Your account, made up: it pushes what your sessions made. */
export const YOU = 'maya';
/** A teammate's account, made up: a person who commits and pushes outside any session. */
export const PERSON = 'sam';
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** The reading's span: the last thirty days. */
export const SPAN_DAYS = 30;

/** One event of the fixture's record: its kind at the version the base publishes, and the data this fixture sets. */
export interface Planned { id: string; ts: number; kind: string; v: number; writer: 'hook' | 'core'; session?: string; subject?: string; data: Record<string, unknown> }
/** One commit the default branch gained, as the fixture pushed it. */
export interface Landed { key: string; what: string; sha: string; tree: string; pusher: string; at: number }
interface Verdict { commit: string; outcome: Outcome; branch: string | null; at: number }

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
/** A ULID for `ms`: the time, then a counter, so ids made in order sort in order (as tests/acceptance/45/events.ts mints them). */
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}
const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const blocked = (why: string): never => { throw Error(`BLOCKED: the fixture isn't what the issue describes: ${why}`); };

interface As { at: number; actor?: string; author?: string }
/** Git as one person's machine runs it at one moment: `author` on the commits, `actor` and the time on the forge's record of a push. */
function git(home: string, cwd: string, args: readonly string[], as: As, input?: string): string {
  const who = as.author ?? YOU;
  const date = `@${Math.floor(as.at / 1000)} +0000`;
  return execFileSync('git', ['-c', `user.name=${who}`, '-c', `user.email=${who}@example.invalid`, '-c', 'commit.gpgsign=false', '-c', 'advice.detachedHead=false', ...args], {
    cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 << 20, ...(input === undefined ? {} : { input }),
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', TZ: 'UTC',
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, FORGE_ACTOR: as.actor ?? '', FORGE_AT: String(Math.floor(as.at / 1000)),
    },
  }).trim();
}

/** What both fixtures hold: the repos, the forge's record of the pushes, and the record's events. */
abstract class Fixture {
  readonly dir: string;
  readonly forge: FixtureForge;
  readonly bare: string;
  /** The moment the fixture counts back from, to the whole second: the hub's "now" is later by what the test took. */
  readonly now: number;
  readonly events: Planned[] = [];
  readonly landed: Landed[] = [];
  /** Every clone a session of the record worked in. */
  readonly worktrees: string[] = [];
  /** The commits by what they are. */
  readonly sha: Record<string, string> = {};
  protected readonly verdicts: Verdict[] = [];
  protected readonly made = new Map<string, { session: string; branch: string | null }>();
  protected readonly offs: { from: number; to: number }[] = [];
  protected readonly trees = new Map<string, string>();
  private readonly claims = new Map<string, number>();
  constructor(dir: string, forge: FixtureForge, now: number) {
    this.dir = dir;
    this.forge = forge;
    this.now = now;
    this.bare = forge.repo(REPO_NAME, { private: true });
  }
  /** `days` ago, and `minutes` after that. */
  protected t(days: number, minutes = 0): number { return this.now - days * DAY + minutes * MINUTE; }
  protected git(cwd: string, args: readonly string[], as: As, input?: string): string { return git(this.dir, cwd, args, as, input); }
  protected clone(name: string, as: As): string {
    const path = join(this.dir, 'work', name, 'shop');
    mkdirSync(dirname(path), { recursive: true });
    this.git(this.dir, ['clone', '-q', this.bare, path], as);
    return path;
  }
  protected treeOf(sha: string): string {
    let tree = this.trees.get(sha);
    if (!tree) this.trees.set(sha, tree = this.git(this.bare, ['rev-parse', '--verify', '-q', `${sha}^{tree}`], { at: this.now }));
    return tree;
  }
  protected plan(e: Omit<Planned, 'id'>): string {
    const id = ulid(e.ts);
    this.events.push({ id, ...e });
    return id;
  }
  /** A session of yours in `worktree` on `branch`, from its start to its end (session.start@4, session.end@2). */
  protected session(id: string, worktree: string, branch: string, from: number, to: number): void {
    if (!this.worktrees.includes(worktree)) this.worktrees.push(worktree);
    this.plan({ ts: from, kind: 'session.start', v: 4, writer: 'hook', session: id, data: { agent: 'claude-code', worktree, branch, thread: id, loads: [] } });
    this.plan({ ts: to, kind: 'session.end', v: 2, writer: 'core', session: id, subject: `session:${id}`, data: { reason: 'process_exited' } });
  }
  /** A commit the session made, as its hooks record it (commit.made@1). */
  protected commitMade(session: string, sha: string, worktree: string, branch: string, at: number): void {
    this.made.set(sha, { session, branch });
    this.plan({ ts: at, kind: 'commit.made', v: 1, writer: 'core', session, subject: `session:${session}`, data: { sha, worktree, branch } });
  }
  /** The session's claim on `sha`, a clean worktree's HEAD, so the snapshot is that commit, and the verdict on it (claim.made@3, verdict.made@2). */
  protected judged(session: string, sha: string, outcome: Outcome, at: number): void {
    const nth = this.claims.get(session) ?? 0;
    this.claims.set(session, nth + 1);
    const ref = `session:${session}#${nth}`;
    const claim = this.plan({ ts: at, kind: 'claim.made', v: 3, writer: 'core', session, data: { task_ref: ref, attempt: 1, commit: sha, scope: 'session', predictions: [], hash: createHash('sha256').update(ref).digest('hex') } });
    const verdict = ulid(at + 1000);
    this.events.push({ id: verdict, ts: at + 1000, kind: 'verdict.made', v: 2, writer: 'core', session, subject: `claim:${claim}`, data: { outcome, verdict: `verdict:${verdict}`, claim: `claim:${claim}`, commit: sha } });
    this.verdicts.push({ commit: sha, outcome, branch: this.made.get(sha)?.branch ?? null, at: at + 1000 });
  }
  /** `deep off` from one moment to another: holds.watch@1 with cause off, an event with no session, on and then off. */
  protected gateOff(from: number, to: number): void {
    this.offs.push({ from, to });
    this.plan({ ts: from, kind: 'holds.watch', v: 1, writer: 'core', data: { cause: 'off', on: true } });
    this.plan({ ts: to, kind: 'holds.watch', v: 1, writer: 'core', data: { cause: 'off', on: false } });
  }
  protected land(key: string, what: string, sha: string, pusher: string, at: number): void {
    this.sha[key] = sha;
    this.landed.push({ key, what, sha, tree: this.treeOf(sha), pusher, at });
  }
  /** The record's events, oldest first. */
  record(): Planned[] { return [...this.events].sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1)); }

  /**
   * How the issue's rule reads each commit the default branch gained, from this fixture's own commits and events.
   * A commit is judged by a verdict whose snapshot's tree is the commit's tree: every claim here is on a clean
   * worktree's HEAD, so a verdict's snapshot is its commit and its tree that commit's tree, which git gives. Any other
   * commit reads none, with the first cause that applies: the gate was off when it was pushed (the record's
   * holds.watch events with cause off; the fixture holds no other cause); no session in the record made it (no
   * commit.made names it), with the push's pusher; or its tree wasn't judged, when a claim on the same branch (the
   * branch of the commit.made events) has a verdict on another tree, named with that verdict and its commit.
   */
  get expected(): Expect[] {
    return this.landed.map((l): Expect => {
      const on = this.verdicts.filter((v) => this.treeOf(v.commit) === l.tree).sort((a, b) => a.at - b.at).at(-1);
      if (on) return { commit: l.sha, what: l.what, judged: on.outcome };
      if (this.offs.some((o) => o.from <= l.at && l.at < o.to)) return { commit: l.sha, what: l.what, judged: 'none', cause: 'off' };
      const made = this.made.get(l.sha);
      if (!made) return { commit: l.sha, what: l.what, judged: 'none', cause: 'no_session', pusher: l.pusher };
      const other = this.verdicts.filter((v) => v.branch === made.branch && v.at <= l.at).sort((a, b) => a.at - b.at).at(-1);
      if (other) return { commit: l.sha, what: l.what, judged: 'none', cause: 'tree', verdict: other.outcome, verdict_commit: other.commit };
      return blocked(`${l.key} ${l.sha} has no verdict on its tree and none of the causes the fixture holds`);
    });
  }
  /** The commits that read none. */
  get unjudged(): string[] { return this.expected.filter((e) => e.judged === 'none').map((e) => e.commit); }
}

/**
 * The shop: the issue's ten commits (README: The fixture has the table). `revert` adds criterion 2's revert of the
 * commit pushed while the gate was off; `refused` adds criterion 3's three days of pushes the forge refuses to name.
 */
export class Shop extends Fixture {
  /** Criterion 2's revert and the commit it reverts, when built. */
  revert: { revert: string; of: string } | undefined;
  /** Criterion 3's dates the forge refuses the push readings for, and the commits the pushes of those dates brought. */
  readonly missing: Span[] = [];
  readonly withheld: string[] = [];
  private main = '';

  static async build(dir: string, o: { revert?: boolean; refused?: boolean } = {}): Promise<Shop> {
    const shop = new Shop(dir, await FixtureForge.start(dir), Math.floor(Date.now() / 1000) * 1000);
    shop.fill(o);
    return shop;
  }

  /** A session on the default branch makes one commit; with `outcome`, its claim on that commit gets that verdict; you push it. */
  private sessionLands(key: string, what: string, days: number, outcome: Outcome | undefined, change: (at: number) => string = (at) => this.add(this.main, `src/${key}.ts`, `Add ${key}`, { at })): string {
    const at = this.t(days);
    const session = `shop${key}`;
    this.git(this.main, ['fetch', '-q', 'origin'], { at });
    this.git(this.main, ['checkout', '-q', '-B', 'main', 'origin/main'], { at });
    const sha = change(at);
    this.session(session, this.main, 'main', at - 30 * MINUTE, at + HOUR);
    this.commitMade(session, sha, this.main, 'main', at);
    if (outcome) this.judged(session, sha, outcome, at + 2 * MINUTE);
    this.git(this.main, ['push', '-q', 'origin', 'main'], { at: at + 5 * MINUTE, actor: YOU });
    this.land(key, what, sha, YOU, at + 5 * MINUTE);
    return sha;
  }
  /** One new file, committed; the commit. */
  private add(worktree: string, path: string, message: string, as: As): string {
    mkdirSync(dirname(join(worktree, path)), { recursive: true });
    writeFileSync(join(worktree, path), `// ${message}\nexport const added = ${JSON.stringify(path)};\n`);
    this.git(worktree, ['add', '-A'], as);
    this.git(worktree, ['commit', '-q', '-m', message], as);
    return this.git(worktree, ['rev-parse', 'HEAD'], as);
  }

  private fill(o: { revert?: boolean; refused?: boolean }): void {
    // 45 days ago, outside the thirty: you start the repo. Not one of the ten.
    const start = this.t(45);
    const yours = this.clone(YOU, { at: start });
    this.git(yours, ['checkout', '-q', '-b', 'main'], { at: start });
    this.add(yours, 'README.md', 'Start the shop', { at: start });
    this.git(yours, ['push', '-q', 'origin', 'main'], { at: start, actor: YOU });
    // The clones the record's sessions work in, one per branch, and the teammate's.
    this.main = this.clone('main', { at: start });
    const topic = this.clone('topic', { at: start });
    const feature = this.clone('feature', { at: start });
    const theirs = this.clone(PERSON, { at: start });

    // 1, 2: a PASS on the commit itself.
    this.sessionLands('c1', 'a PASS on its tree', 27, 'PASS');
    this.sessionLands('c2', 'a PASS on its tree', 25, 'PASS');
    // 3: a FAIL on its tree, pushed all the same.
    this.sessionLands('c3', 'a FAIL on its tree', 23, 'FAIL');
    // 4: a PASS on its tree, on another commit. A session's branch head passes; the default branch hasn't moved, so the
    // squash you merge it as has the head's tree and its own SHA. No session made the squash, and it reads PASS.
    this.git(topic, ['fetch', '-q', 'origin'], { at: this.t(22) });
    this.git(topic, ['checkout', '-q', '-B', 'topic', 'origin/main'], { at: this.t(22) });
    const topicHead = this.add(topic, 'src/topic.ts', 'Add the topic page', { at: this.t(22) });
    this.session('shoptopic', topic, 'topic', this.t(22, -30), this.t(22, 60));
    this.commitMade('shoptopic', topicHead, topic, 'topic', this.t(22));
    this.judged('shoptopic', topicHead, 'PASS', this.t(22, 2));
    this.git(topic, ['push', '-q', 'origin', 'topic'], { at: this.t(22, 5), actor: YOU });
    this.sha.topicHead = topicHead;
    this.git(yours, ['fetch', '-q', 'origin'], { at: this.t(21) });
    const c4 = this.git(yours, ['commit-tree', `${topicHead}^{tree}`, '-p', 'origin/main', '-m', 'Add the topic page (#1)'], { at: this.t(21) });
    this.git(yours, ['push', '-q', 'origin', `${c4}:refs/heads/main`], { at: this.t(21), actor: YOU });
    this.land('c4', 'a PASS on its tree: a squash with its branch head\'s tree', c4, YOU, this.t(21));
    if (c4 === topicHead || this.treeOf(c4) !== this.treeOf(topicHead)) blocked('the fourth commit must be another commit than its branch\'s head, with the head\'s tree');
    // 5: pushed while the gate was off. A session made it; no claim was judged.
    this.gateOff(this.t(19, -12 * 60), this.t(19, 12 * 60));
    this.sessionLands('c5', 'pushed while the gate was off', 19, undefined);
    // 6: a PASS on the commit itself.
    this.sessionLands('c6', 'a PASS on its tree', 17, 'PASS');
    // 7: by a person from no session in the record: your teammate commits and pushes from their own clone.
    this.git(theirs, ['fetch', '-q', 'origin'], { at: this.t(15), author: PERSON });
    this.git(theirs, ['checkout', '-q', '-B', 'main', 'origin/main'], { at: this.t(15), author: PERSON });
    const c7 = this.add(theirs, 'docs/prices.md', 'Note the price list', { at: this.t(15), author: PERSON });
    this.git(theirs, ['push', '-q', 'origin', 'main'], { at: this.t(15, 5), actor: PERSON, author: PERSON });
    this.land('c7', 'by a person from no session in the record', c7, PERSON, this.t(15, 5));
    // The feature branch forks here. Its head is committed 14 days ago.
    this.git(feature, ['fetch', '-q', 'origin'], { at: this.t(14) });
    this.git(feature, ['checkout', '-q', '-B', 'feature', 'origin/main'], { at: this.t(14) });
    const featureHead = this.add(feature, 'src/feature.ts', 'Add the feature flag', { at: this.t(14) });
    this.session('shopfeature', feature, 'feature', this.t(14, -30), this.t(11, 60));
    this.commitMade('shopfeature', featureHead, feature, 'feature', this.t(14));
    this.sha.featureHead = featureHead;
    // 8: a PASS on the commit itself. The default branch moves past the feature branch's fork.
    this.sessionLands('c8', 'a PASS on its tree', 13, 'PASS');
    // The feature branch's head passes, and is pushed to its own branch.
    this.judged('shopfeature', featureHead, 'PASS', this.t(12));
    this.git(feature, ['push', '-q', 'origin', 'feature'], { at: this.t(12, 5), actor: YOU });
    // 9: the squash whose tree no snapshot matches. The session squashes its branch onto the moved default branch and
    // pushes that: the squash holds the eighth commit's file, which the head that passed never had.
    this.git(feature, ['fetch', '-q', 'origin'], { at: this.t(11) });
    this.git(feature, ['checkout', '-q', '-B', 'feature', 'origin/main'], { at: this.t(11) });
    this.git(feature, ['merge', '-q', '--squash', featureHead], { at: this.t(11) });
    this.git(feature, ['commit', '-q', '-m', 'Add the feature flag (squashed)'], { at: this.t(11) });
    const c9 = this.git(feature, ['rev-parse', 'HEAD'], { at: this.t(11) });
    this.commitMade('shopfeature', c9, feature, 'feature', this.t(11));
    this.git(feature, ['push', '-q', 'origin', 'feature:main'], { at: this.t(11, 5), actor: YOU });
    this.land('c9', 'the squash whose tree no snapshot matches, its branch\'s head PASS', c9, YOU, this.t(11, 5));
    if (this.verdicts.some((v) => this.treeOf(v.commit) === this.treeOf(c9))) blocked('a snapshot has the squash\'s tree');
    // 10: a PASS on the commit itself.
    this.sessionLands('c10', 'a PASS on its tree', 9, 'PASS');

    if (o.revert) {
      // Criterion 2: seven days ago a session reverts the commit pushed while the gate was off, with git's own revert,
      // and its claim on the revert passes.
      const of = this.sha.c5!;
      const revert = this.sessionLands('revert', 'the revert of the commit pushed while the gate was off, a PASS on its own tree', 7, 'PASS', (at) => {
        this.git(this.main, ['revert', '--no-edit', of], { at });
        return this.git(this.main, ['rev-parse', 'HEAD'], { at });
      });
      const message = this.git(this.bare, ['log', '-1', '--format=%B', revert], { at: this.now });
      if (!message.includes(`This reverts commit ${of}.`) || this.git(this.bare, ['diff', '--name-status', `${revert}~1`, revert], { at: this.now }) !== 'D\tsrc/c5.ts') blocked('the revert must be git\'s revert of the fifth commit');
      this.revert = { revert, of };
    }
    if (o.refused) {
      // Criterion 3: on each of three days, six to four days ago, a session lands two commits with a PASS on each, and
      // the forge refuses every read that would name a commit those pushes brought. They are none of `landed`.
      for (const days of [6, 5, 4]) {
        const at = this.t(days);
        const session = `shopx${days}`;
        this.git(this.main, ['fetch', '-q', 'origin'], { at });
        this.git(this.main, ['checkout', '-q', '-B', 'main', 'origin/main'], { at });
        this.session(session, this.main, 'main', at - 30 * MINUTE, at + HOUR);
        for (const n of [1, 2]) {
          const sha = this.add(this.main, `src/x${days}-${n}.ts`, `Add x${days}-${n}`, { at: at + n * MINUTE });
          this.commitMade(session, sha, this.main, 'main', at + n * MINUTE);
          this.judged(session, sha, 'PASS', at + (n + 2) * MINUTE);
          this.withheld.push(sha);
        }
        this.git(this.main, ['push', '-q', 'origin', 'main'], { at: at + 10 * MINUTE, actor: YOU });
      }
      this.forge.withhold(this.withheld);
      this.missing.push({ from: utcDate(this.t(6, 10)), to: utcDate(this.t(4, 10)) });
    }
  }
}

/**
 * The month (criterion 6): 2,000 commits the default branch gained in thirty days, in 200 pushes of ten, each push a
 * session's or, one in twenty, a teammate's from no session. Of a session's pushes one in twenty holds FAILs, the rest
 * PASSes, each verdict on the commit itself. So 1,800 read PASS, 100 FAIL and 100 none (no session).
 */
export class Month extends Fixture {
  static readonly COMMITS = 2000;
  static readonly PER_PUSH = 10;

  static async build(dir: string): Promise<Month> {
    const month = new Month(dir, await FixtureForge.start(dir), Math.floor(Date.now() / 1000) * 1000);
    month.fill();
    return month;
  }
  private fill(): void {
    const start = this.t(45);
    const yours = this.clone(YOU, { at: start });
    this.git(yours, ['checkout', '-q', '-b', 'main'], { at: start });
    writeFileSync(join(yours, 'README.md'), 'The shop\n');
    this.git(yours, ['add', '-A'], { at: start });
    this.git(yours, ['commit', '-q', '-m', 'Start the shop'], { at: start });
    this.git(yours, ['push', '-q', 'origin', 'main'], { at: start, actor: YOU });
    const base = this.git(yours, ['rev-parse', 'HEAD'], { at: start });

    // The commits, written straight into the forge's repository, each with one new file, so each has a tree of its own.
    const pushes = Month.COMMITS / Month.PER_PUSH;
    const pushAt = (p: number): number => Math.floor((this.t(29) + p * ((28 * DAY) / (pushes - 1))) / 1000) * 1000;
    const kindOf = (p: number): 'person' | 'FAIL' | 'PASS' => (p % 20 === 7 ? 'person' : p % 20 === 3 ? 'FAIL' : 'PASS');
    const data = (text: string): string => `data ${Buffer.byteLength(text)}\n${text}\n`;
    let stream = '';
    for (let i = 0; i < Month.COMMITS; i++) {
      const p = Math.floor(i / Month.PER_PUSH);
      const who = kindOf(p) === 'person' ? PERSON : YOU;
      const stamp = `${Math.floor((pushAt(p) - (Month.PER_PUSH - (i % Month.PER_PUSH)) * MINUTE) / 1000)} +0000`;
      stream += `commit refs/heads/main\nauthor ${who} <${who}@example.invalid> ${stamp}\ncommitter ${who} <${who}@example.invalid> ${stamp}\n${data(`Add note ${i}`)}`
        + `${i === 0 ? `from ${base}\n` : ''}M 100644 inline notes/${String(p).padStart(3, '0')}/n${i}.md\n${data(`note ${i}\n`)}`;
    }
    this.git(this.bare, ['fast-import', '--quiet'], { at: this.now }, stream);
    const log = this.git(this.bare, ['log', '--reverse', '--format=%H %T', `${base}..refs/heads/main`], { at: this.now }).split('\n').map((line) => line.split(' ') as [string, string]);
    if (log.length !== Month.COMMITS) blocked(`the month must hold ${Month.COMMITS} commits past its start, and git lists ${log.length}`);
    for (const [sha, tree] of log) this.trees.set(sha, tree);

    // The session's worktree holds every commit; the forge's record of the pushes; the record's events.
    const worktree = this.clone('month', { at: this.now });
    const changes: RefChange[] = [];
    for (let p = 0; p < pushes; p++) {
      const commits = log.slice(p * Month.PER_PUSH, (p + 1) * Month.PER_PUSH).map(([sha]) => sha);
      const kind = kindOf(p);
      const at = pushAt(p);
      const session = `month${p}`;
      if (kind !== 'person') this.session(session, worktree, 'main', at - 30 * MINUTE, at + 10 * MINUTE);
      commits.forEach((sha, n) => {
        const made = at - (Month.PER_PUSH - n) * MINUTE;
        if (kind !== 'person') {
          this.commitMade(session, sha, worktree, 'main', made);
          this.judged(session, sha, kind, made + 20_000);
        }
        this.land(`n${p * Month.PER_PUSH + n}`, kind === 'person' ? 'by a person from no session in the record' : `a ${kind} on its tree`, sha, kind === 'person' ? PERSON : YOU, at);
      });
      changes.push({ before: p === 0 ? base : log[p * Month.PER_PUSH - 1]![0], after: commits.at(-1)!, ref: 'refs/heads/main', at, actor: kind === 'person' ? PERSON : YOU });
    }
    this.forge.record(REPO_NAME, changes);
    if (changes[0]!.before === ZERO) blocked('the month\'s first push must stand on the repo\'s first commit');
  }
  /**
   * The same rule as the shop's, read from the month's own pushes and events: every verdict is on the commit it
   * judges, each commit has a tree of its own, the gate is never off and no commit a session made is without a verdict.
   */
  override get expected(): Expect[] {
    const outcome = new Map(this.verdicts.map((v) => [this.treeOf(v.commit), v.outcome]));
    return this.landed.map((l): Expect => {
      const on = outcome.get(l.tree);
      if (on) return { commit: l.sha, what: l.what, judged: on };
      if (!this.made.has(l.sha)) return { commit: l.sha, what: l.what, judged: 'none', cause: 'no_session', pusher: l.pusher };
      return blocked(`${l.key} ${l.sha} was made by a session and has no verdict`);
    });
  }
}
