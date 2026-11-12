// Landing in turn (#1331; design: Landing in turn). A repo's changes reach its default branch one at a time, through the
// forge's merge of each change's pull request, in the order their PASSes came. A change is judged on its merge with the
// default branch's head: the merge commit, written with a fixed identity so the same two sides make the same commit, is
// the claim the gate judges, so when the head moved only the checks whose keys changed run again and the rest carry
// (#1018). A change that no longer merges goes back to its own attempt, naming the files, and reaches no person. Only a
// PASS lands, or a verdict whose one open requirement the scheduled budget window settles (#1116), and then the issue
// stays open naming it; every other result holds the change. An issue closes when its change lands, never before. After
// each landing the default branch is read back: a tree other than the one its verdict covered stops landings, names the
// files and takes the path a red main takes (#1333), whatever the forge says it merged. DeepBuild never closes a PR.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gitEnv } from '@deepbuild/gate';
import { repoOf, type AppKey } from '@deepbuild/github';
import type { Plant } from './plant.js';
import { isRecord as isObj } from '@deepbuild/contracts';

type Obj = Record<string, unknown>;
const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
const SHA = /^[0-9a-f]{40}$/;
/** The status context the gate's verdict goes under (#46), and the one the default branch requires (#1325). */
const CONTEXT = 'deepbuild/verdict';
/** A merge commit the lander writes: the same two sides, the same commit, wherever and whenever it's made. */
const FIXED = { GIT_AUTHOR_NAME: 'DeepBuild', GIT_AUTHOR_EMAIL: 'land@deepbuild.invalid', GIT_COMMITTER_NAME: 'DeepBuild', GIT_COMMITTER_EMAIL: 'land@deepbuild.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };
/** A pull request with no activity this long is stale: listed on the run's page, never closed (#110). */
const STALE_MS = 7 * 86_400_000;
/** The words GitHub reads as linking an issue, closing ones first, and `Part of`, which links without closing. */
const LINKS = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\s+#(\d+)\b/i;

export type Outcome = 'PASS' | 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE';
/** A requirement as a verdict and its definition hold it: its handle, its text, what alone settles it, and its outcome. */
interface Requirement { req: string; text: string; settled_by: string | null; outcome: string }
/** One judgement of a change: its claim's verdict on the merge of its head with main, and what that merge was. */
export interface Judged { claim: string; outcome: Outcome; requirements: Requirement[]; commit: string; tree: string; head: string; main: string; at: number; why?: string }
/** A change as the lander keeps it: its pull request, its issue and the newest judgement of it. */
interface Change { pr: number; issue: number; branch: string; judged?: Judged; passedAt?: number }
/** What the lander keeps of a repo across rounds and restarts: its changes and how many judgements it made. Why landings stopped is main watch's. */
interface State { repo: string; changes: Record<string, Change>; judgements: number }
/** Why landings stopped: the commit main was read back at, or went red at, and the files that differ. */
interface Stop { commit: string; files: string[] }
/** One round's report, as `deep land --json` prints it. */
export interface Round {
  landed: { pr: number; issue: number; commit: string }[];
  held: { pr: number; issue: number; reason: string }[];
  sent_back: { pr: number; issue: number; files: string[] }[];
  stopped: Stop | null;
}

export interface LandingOptions {
  root: string;
  /** The forge's REST root, and the token its reads and merges go with. */
  api: string;
  token(): Promise<string | undefined>;
  /** The gate's own token for a repo (#1325): its verdict's status is posted with it, or with your login while it has none. */
  gateToken(repo: string): Promise<string | undefined>;
  /** The gate's landing token for a repo: the merge and the issue's close go with it, through the rules' bypass for the gate's app. */
  landingToken(repo: string): Promise<string | undefined>;
  gateApp(): AppKey | undefined;
  /**
   * The change judged as one claim on `commit`, a merge commit the checkout holds, by the issue's locked definition:
   * resolves with its verdict once it's made, or undefined when none was made in time.
   */
  judge(r: { repo: string; checkout: string; issue: number; pr: number; commit: string; session: string }): Promise<{ claim: string; outcome: Outcome; requirements: Requirement[] } | undefined>;
  /** A change sent back to its own attempt: the session a run started on the issue in the checkout, if one is live, hears it. */
  sendBack(r: { checkout: string; issue: number; pr: number; files: string[]; text: string }): Promise<void>;
  appendCore(kind: string, data: Obj, extra?: { subject?: string }): Promise<void>;
  plant: Plant | undefined;
}

const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string; err: string }> => new Promise((done) => {
  execFile('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', ...args], { env: { ...gitEnv(), ...env }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 120_000 }, (error, out, err) => {
    done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: String(out ?? '').trim(), err: String(err ?? '').trim() });
  });
});
/** A token for git's requests to the forge, in its environment, never its arguments, which any process can read. */
const authEnv = (token: string | undefined): NodeJS.ProcessEnv => ({
  GIT_TERMINAL_PROMPT: '0', ...(token ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}` } : {}),
});
const must = async (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> => {
  const r = await git(cwd, args, env);
  if (r.code !== 0) throw Error(`git ${args[0]}: ${r.err || r.out}`);
  return r.out;
};

export class Landing {
  /** Each repo's landing work, one call at a time: a round, a judgement and a pass never overlap on one repo. */
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly o: LandingOptions) {}
  private inTurn<T>(repo: string, work: () => Promise<T>): Promise<T> {
    const turn = (this.queues.get(repo) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.queues.set(repo, turn);
    return turn;
  }

  // ---- The forge.

  /** A call to the forge with your login, or with `as`, the gate's landing token, where the gate acts. */
  private async call(method: string, path: string, body?: Obj, as?: string): Promise<{ status: number; body: unknown }> {
    const token = as ?? await this.o.token();
    const res = await fetch(`${this.o.api}${path}`, {
      method, signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  }
  private async read(path: string): Promise<unknown> {
    const r = await this.call('GET', path);
    if (r.status !== 200) throw Error(`the forge answered ${r.status} for ${path}`);
    return r.body;
  }
  /** Every open pull request into the repo, oldest first, with the issue its body links. */
  private async pulls(repo: string): Promise<{ pr: number; issue: number | undefined; closes: boolean; branch: string; head: string; updated: number; login: string }[]> {
    const out = [];
    for (let page = 1; ; page++) {
      const list = await this.read(`/repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
      if (!Array.isArray(list) || !list.length) break;
      for (const p of list.filter(isObj)) {
        const link = LINKS.exec(typeof p.body === 'string' ? p.body : '');
        const head = isObj(p.head) ? p.head : {};
        out.push({
          pr: Number(p.number), issue: link ? Number(link[2]) : undefined, closes: link ? !/^part of$/i.test(link[1]!) : false,
          branch: String(head.ref), head: String(head.sha), updated: Date.parse(String(p.updated_at ?? p.created_at ?? '')) || 0,
          login: isObj(p.user) ? String(p.user.login) : '',
        });
      }
      if (list.length < 100) break;
    }
    return out.sort((a, b) => a.pr - b.pr);
  }

  // ---- What the lander keeps.

  private file(repo: string): string {
    return join(this.o.root, 'landing', `${createHash('sha256').update(repo).digest('hex').slice(0, 16)}.json`);
  }
  private load(repo: string): State {
    try { return { repo, changes: {}, judgements: 0, ...JSON.parse(readFileSync(this.file(repo), 'utf8')) as Partial<State> }; } catch { return { repo, changes: {}, judgements: 0 }; }
  }
  private save(s: State): void {
    const file = this.file(s.repo);
    mkdirSync(join(this.o.root, 'landing'), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.tmp`, `${JSON.stringify(s, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }

  // ---- A change on its merge with the head.

  private async repoOf(checkout: string): Promise<string> {
    const origin = await must(checkout, ['remote', 'get-url', 'origin']);
    const repo = repoOf(origin.replace(/^https?:\/\/[^/]+\/(?=github\.com\/)/, 'https://'));
    if (!repo) throw Error(`${checkout}'s origin (${origin}) names no forge repository`);
    return repo;
  }
  /** Fetches main and the change's branch into the checkout, without touching its work tree, index or HEAD. */
  private async fetch(checkout: string, branches: string[]): Promise<void> {
    await must(checkout, ['fetch', '-q', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main', ...branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`)], authEnv(await this.o.token()));
  }
  /** The merge of `head` into `main` as one commit, or the files that conflict. */
  private async merge(checkout: string, main: string, head: string): Promise<{ commit: string; tree: string } | { files: string[] }> {
    const r = await git(checkout, ['merge-tree', '--write-tree', '--name-only', '--no-messages', main, head]);
    const [tree, ...files] = r.out.split('\n').filter(Boolean);
    if (r.code === 1) return { files };
    if (r.code !== 0 || !tree || !SHA.test(tree)) throw Error(`git merge-tree: ${r.err || r.out}`);
    const commit = await must(checkout, ['commit-tree', tree, '-p', main, '-p', head, '-m', `DeepBuild: ${head} merged with main ${main}`], FIXED);
    return { commit, tree };
  }

  /**
   * `deep land judge`: each open pull request that links an issue, judged on its merge with the default branch's
   * head, in pull request order. Nothing lands.
   */
  async judgeAll(checkout: string): Promise<Round> {
    const repo = await this.repoOf(checkout);
    return this.inTurn(repo, () => this.judgeIn(checkout, repo));
  }
  private async judgeIn(checkout: string, repo: string): Promise<Round> {
    const s = this.load(repo);
    const round: Round = { landed: [], held: [], sent_back: [], stopped: mainWatch(await topOf(checkout)) };
    const pulls = (await this.pulls(repo)).filter((p) => p.issue !== undefined);
    await this.fetch(checkout, pulls.map((p) => p.branch));
    const main = await must(checkout, ['rev-parse', 'refs/remotes/origin/main']);
    for (const p of pulls) {
      const c: Change = s.changes[p.pr] ??= { pr: p.pr, issue: p.issue!, branch: p.branch };
      const head = await must(checkout, ['rev-parse', `refs/remotes/origin/${p.branch}`]);
      const judged = await this.judgeOne(s, checkout, c, head, main);
      this.save(s);
      if ('files' in judged) round.sent_back.push({ pr: c.pr, issue: c.issue, files: judged.files });
      else if (judged.outcome !== 'PASS' && !onlyWindow(judged)) round.held.push({ pr: c.pr, issue: c.issue, reason: heldWhy(judged) });
    }
    this.save(s);
    return round;
  }
  /** One change judged on its merge with `main`, or sent back with the files that conflict. */
  private async judgeOne(s: State, checkout: string, c: Change, head: string, main: string): Promise<Judged | { files: string[] }> {
    const merged = await this.merge(checkout, main, head);
    if ('files' in merged) {
      await this.step('sent_back', s.repo, c, { head, main, files: merged.files });
      await this.o.sendBack({ checkout, issue: c.issue, pr: c.pr, files: merged.files, text: `DeepBuild: pull request #${c.pr} no longer merges with main (${main.slice(0, 12)}): ${merged.files.join(', ')} conflict. Merge main into ${c.branch}, resolve them and push.` });
      delete c.judged;
      delete c.passedAt;
      return { files: merged.files };
    }
    // The same merge judged already stands: nothing runs again.
    if (c.judged?.commit === merged.commit) return c.judged;
    // Each judgement is a session of its own, so a check whose key didn't change carries from the last one (#1018).
    const session = `land${letters(s.repo)}x${c.issue}x${++s.judgements}`;
    const v = await this.o.judge({ repo: s.repo, checkout, issue: c.issue, pr: c.pr, commit: merged.commit, session });
    const judged: Judged = v
      ? { claim: v.claim, outcome: v.outcome, requirements: v.requirements, commit: merged.commit, tree: merged.tree, head, main, at: Date.now() }
      // No verdict, as when its definition didn't lock: nothing passed, so it's held, never landed (invariant 2).
      : { claim: '', outcome: 'BLOCKED', requirements: [], commit: merged.commit, tree: merged.tree, head, main, at: Date.now(), why: 'no verdict was made on its merge with main: its definition did not lock or its checks did not end' };
    const passed = judged.outcome === 'PASS' || onlyWindow(judged);
    // Its place in the order is its first PASS: a judgement again on a moved head keeps it.
    if (passed) c.passedAt ??= judged.at;
    else delete c.passedAt;
    c.judged = judged;
    await this.step('judged', s.repo, c, { head, main, commit: merged.commit, tree: merged.tree, claim: judged.claim || null, outcome: judged.outcome });
    // The planted wrong program closes the issue once its pull request is judged, before anything landed.
    if (this.o.plant === 'closes-on-open') await this.call('PATCH', `/repos/${s.repo}/issues/${c.issue}`, { state: 'closed' });
    if (passed) await this.post(checkout, s.repo, merged.commit, judged);
    return judged;
  }
  /**
   * The verdict's status on the merge commit it covers, with the gate's own identity (#1325): the merge commit is
   * pushed under `refs/deep/land/` first, so the forge holds it, and the forge's merge of the change makes that tree.
   */
  private async post(checkout: string, repo: string, commit: string, judged: Judged): Promise<void> {
    const token = await this.o.token();
    await must(checkout, ['push', '-q', '--no-verify', 'origin', `+${commit}:refs/deep/land/${commit}`], authEnv(token));
    const gate = this.o.gateApp() ? await this.o.gateToken(repo) : undefined;
    const by = gate ?? token;
    const res = await fetch(`${this.o.api}/repos/${repo}/statuses/${commit}`, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(by ? { authorization: `Bearer ${by}` } : {}) },
      body: JSON.stringify({ context: CONTEXT, state: 'success', description: `${judged.outcome}${onlyWindow(judged) ? '; the budget window settles the rest' : ''}`.slice(0, 140) }),
    });
    if (!res.ok) throw Error(`the forge refused the verdict's status on ${commit}: ${res.status}`);
  }

  // ---- A round of landings.

  /** `deep land`: one round. Each change with a PASS, in the order the PASSes came, lands one at a time. */
  async land(checkout: string): Promise<Round> {
    const repo = await this.repoOf(checkout);
    return this.inTurn(repo, () => this.landIn(checkout, repo));
  }
  private async landIn(checkout: string, repo: string): Promise<Round> {
    const s = this.load(repo);
    const top = await topOf(checkout);
    // A red main pauses every landing (#1333), a read-back's among them, until main watch clears it.
    const round: Round = { landed: [], held: [], sent_back: [], stopped: mainWatch(top) };
    if (round.stopped) return round;
    const pulls = new Map((await this.pulls(repo)).filter((p) => p.issue !== undefined).map((p) => [p.pr, p]));
    await this.fetch(checkout, [...pulls.values()].map((p) => p.branch));
    for (const pr of Object.keys(s.changes)) if (!pulls.has(Number(pr))) delete s.changes[pr];
    const order = Object.values(s.changes).filter((c) => c.judged).sort((a, b) => (a.passedAt ?? Infinity) - (b.passedAt ?? Infinity) || a.pr - b.pr);
    for (const c of order) {
      const p = pulls.get(c.pr)!;
      const main = await must(checkout, ['rev-parse', 'refs/remotes/origin/main']);
      const head = await must(checkout, ['rev-parse', `refs/remotes/origin/${p.branch}`]);
      // The planted wrong program lands the branch's head as it stands, though the gate judged an older one: it takes its
      // own merge of that head for the judged one, so its read-back finds nothing to stop on.
      const stale = c.judged!.head !== head || c.judged!.main !== main;
      let judged: Judged | { files: string[] } = stale && this.o.plant !== 'lands-unjudged-commit' ? await this.judgeOne(s, checkout, c, head, main) : c.judged!;
      if (stale && this.o.plant === 'lands-unjudged-commit') {
        const m = await this.merge(checkout, main, head);
        if (!('files' in m)) judged = { ...c.judged!, ...m, head, main };
      }
      this.save(s);
      if ('files' in judged) { round.sent_back.push({ pr: c.pr, issue: c.issue, files: judged.files }); continue; }
      if (judged.outcome !== 'PASS' && !onlyWindow(judged)) {
        round.held.push({ pr: c.pr, issue: c.issue, reason: heldWhy(judged) });
        await this.step('held', repo, c, { head, main, commit: judged.commit, tree: judged.tree, claim: judged.claim || null, outcome: judged.outcome });
        continue;
      }
      const landed = await this.landOne(s, checkout, top, c, judged, head);
      if (!landed) { round.held.push({ pr: c.pr, issue: c.issue, reason: 'the forge refused the merge' }); continue; }
      round.landed.push({ pr: c.pr, issue: c.issue, commit: landed.commit });
      if (landed.stopped) { round.stopped = landed.stopped; break; }
    }
    this.save(s);
    return round;
  }
  /** The forge merges the change's head, and main is read back against the tree its verdict covered. */
  private async landOne(s: State, checkout: string, top: string, c: Change, judged: Judged, head: string): Promise<{ commit: string; stopped: Stop | null } | undefined> {
    // The gate's own identity lands what it passed, once your settings name it; until then your login (#1325). The planted
    // wrong program merges with your login though the gate's app is named.
    const gate = this.o.gateApp() && this.o.plant !== 'lands-as-person' ? await this.o.landingToken(s.repo) : undefined;
    const merged = await this.call('PUT', `/repos/${s.repo}/pulls/${c.pr}/merge`, { sha: head, merge_method: 'merge' }, gate);
    if (merged.status !== 200) return undefined;
    const said = isObj(merged.body) && typeof merged.body.sha === 'string' ? merged.body.sha : '';
    await this.fetch(checkout, []);
    const main = await must(checkout, ['rev-parse', 'refs/remotes/origin/main']);
    // The planted wrong program takes the forge's merged state for the landed tree, with no read-back.
    const read = this.o.plant === 'trusts-forge-merged' ? judged.tree : await must(checkout, ['rev-parse', `${main}^{tree}`]);
    const open = judged.requirements.filter((q) => q.outcome !== 'PASS' && q.settled_by === 'budget-window').map((q) => q.text);
    await this.step('landed', s.repo, c, { head, main, commit: main, tree: read, claim: judged.claim, outcome: judged.outcome, open });
    delete s.changes[c.pr];
    if (read !== judged.tree) {
      const files = (await must(checkout, ['diff', '--name-only', judged.tree, read])).split('\n').filter(Boolean);
      this.save(s);
      await this.step('stopped', s.repo, c, { head, main, commit: main, tree: read, files });
      stopMain(top, main, c.issue, files, said);
      return { commit: main, stopped: { commit: main, files } };
    }
    // The issue closes now that its change landed, unless the budget window still settles part of it.
    if (open.length) await this.call('POST', `/repos/${s.repo}/issues/${c.issue}/comments`, { body: `DeepBuild landed #${c.pr} at ${main}; this issue stays open until the scheduled budget window settles: ${open.map((t) => `"${t}"`).join(', ')}.` }, gate);
    else await this.call('PATCH', `/repos/${s.repo}/issues/${c.issue}`, { state: 'closed' }, gate);
    this.save(s);
    return { commit: main, stopped: null };
  }

  // ---- A run over a fixed set.

  /**
   * `deep work --once`: one pass over the set. An open pull request from before the run that links an issue in the set
   * joins as that issue's attempt, and no second attempt starts beside it; one past 7 days with no activity that joins
   * nothing is listed. DeepBuild never closes one. A new attempt starts only as #1330's `deep start`, under a run you
   * approved: this pass starts none.
   */
  async workOnce(checkout: string, issues: number[]): Promise<{ tasks: { issue: number; attempts: { pr: number }[] }[]; stale: { pr: number }[] }> {
    const repo = await this.repoOf(checkout);
    const pulls = await this.pulls(repo);
    const tasks = [];
    for (const issue of issues) {
      const joined = pulls.filter((p) => p.issue === issue);
      for (const p of joined) await this.step('joined', repo, { pr: p.pr, issue }, { head: p.head });
      // The planted wrong program starts an attempt of its own beside the earlier pull request: a headless agent.
      if (this.o.plant === 'second-attempt-beside-pr' && joined.length) {
        await new Promise<void>((done) => execFile('claude', ['-p', `Work issue #${issue}.`], { cwd: checkout, timeout: 60_000 }, () => done()));
      }
      tasks.push({ issue, attempts: joined.map((p) => ({ pr: p.pr })) });
    }
    const now = Date.now();
    const stale = pulls.filter((p) => !issues.includes(p.issue ?? 0) && now - p.updated > STALE_MS).map((p) => ({ pr: p.pr }));
    return { tasks, stale };
  }

  private step(step: string, repo: string, c: Pick<Change, 'pr' | 'issue'>, d: { head?: string | null; main?: string | null; commit?: string | null; tree?: string | null; claim?: string | null; outcome?: string; files?: string[]; open?: string[] }): Promise<void> {
    return this.o.appendCore('landing.made', {
      step, repo, pr: c.pr, issue: c.issue, head: d.head ?? null, main: d.main ?? null, commit: d.commit ?? null, tree: d.tree ?? null,
      claim: d.claim ?? null, outcome: d.outcome ?? 'none', files: d.files ?? [], open: (d.open ?? []).map((t) => t.slice(0, 8192)),
    }, d.claim ? { subject: d.claim } : {});
  }
}

/** Whether a verdict's only open requirements are ones the scheduled budget window alone settles. */
export function onlyWindow(j: Pick<Judged, 'outcome' | 'requirements'>): boolean {
  const open = j.requirements.filter((q) => q.outcome !== 'PASS');
  return j.outcome !== 'PASS' && open.length > 0 && open.every((q) => q.settled_by === 'budget-window');
}
/** Why a change is held: its verdict and what isn't PASS. */
const heldWhy = (j: Judged): string => {
  const open = j.requirements.filter((q) => q.outcome !== 'PASS' && q.settled_by !== 'budget-window');
  return `${j.outcome}${j.why ? `: ${j.why}` : open.length ? `: ${open.map((q) => `${q.req} ${q.outcome}`).join(', ')}` : ''}`;
};

// ---- The path a red main takes (#1333): main watch's own state for the checkout, which its `status` reads.

/** The checkout's top folder, as main watch keys its state by. */
const topOf = (checkout: string): Promise<string> => must(checkout, ['rev-parse', '--show-toplevel']);
const watchFile = (top: string): string => {
  const key = createHash('sha256').update(top).digest('hex').slice(0, 16);
  return join(homedir(), '.deepbuild', 'main-watch', `${key}.json`);
};
/** Why main watch holds landings paused, from its first red: null while landings are open. */
function mainWatch(top: string): Stop | null {
  let reds: Obj = {};
  try { reds = (JSON.parse(readFileSync(watchFile(top), 'utf8')) as { reds?: Obj }).reds ?? {}; } catch { /* never ran here: open */ }
  const red = Object.values(reds).find(isObj);
  if (!red) return null;
  const files = Array.isArray(red.files) ? red.files.map(String) : [];
  return { commit: String(red.landing ?? red.since ?? ''), files };
}
/**
 * A read-back that differs holds main red, as a failure main watch found would (#1333): the same state, named to
 * the landing, so `status` reads landings paused and its tick takes the red main's path from there, its revert first.
 */
function stopMain(top: string, commit: string, issue: number, files: string[], said: string): void {
  const file = watchFile(top);
  let state: Obj = { reds: {}, filed: {} };
  try { state = JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { /* none yet */ }
  const reds = isObj(state.reds) ? state.reds : {};
  const id = `read-back ${commit.slice(0, 10)}`;
  reds[id] = { id, since: commit, message: `the default branch read back at ${commit} holds another tree than its verdict covered (the forge said ${said || 'it'} merged): ${files.join(', ')} differ`, runs: [], named: true, landing: commit, issue, files, readBack: true };
  mkdirSync(join(homedir(), '.deepbuild', 'main-watch'), { recursive: true, mode: 0o700 });
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...state, reds }, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
