// Landing in turn (#1331; design: Landing in turn). A repo's changes reach its default branch one at a time, through the
// forge's merge of each change's pull request, in the order their PASSes came. A change is judged on its merge with the
// default branch's head: the merge commit, written with a fixed identity so the same two sides make the same commit, is
// the claim the gate judges, so when the head moved only the checks whose keys changed run again and the rest carry
// (#1018). A change that no longer merges goes back to its own attempt, naming the files, and reaches no person. Only a
// PASS lands, or a verdict whose one open requirement the scheduled budget window settles (#1116), and then the issue
// stays open naming it; every other result holds the change. An issue closes when its change lands, never before. After
// each landing the default branch is read back: a tree other than the one its verdict covered stops landings, names the
// files and takes the path a red main takes (#1333), whatever the forge says it merged. DeepBuild never closes a PR.
// Under a standing rule or a topic's card (#1345), a change whose only open requirements are calls on you lands too
// when it reaches no release and no published page, its issue left open naming the calls; one that reaches either
// waits for your answer. Your Send back on a landed one reverts it through the forge.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { gitEnv } from '@deepbuild/gate';
import type { AppKey } from './forge-port.js';
import type { Plant } from './plant.js';
import { globMatches } from './rules.js';
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
/** A requirement as a verdict and its definition hold it: its handle, its text, what alone settles it, its outcome and whose word decides it. */
interface Requirement { req: string; text: string; settled_by: string | null; outcome: string; oracle?: string | null }
/**
 * One judgement of a change: its claim's verdict on the merge of its head with main, and what that merge was. One that
 * waits only on calls (#1345) names what its landing would reach that a revert can't take back, and the calls it raised.
 */
export interface Judged { claim: string; outcome: Outcome; requirements: Requirement[]; commit: string; tree: string; head: string; main: string; at: number; why?: string; reaches?: string | null; calls?: string[] }
/** A call a change waits on (#1345): one requirement whose oracle is you, still pending on the change's merge with main. */
export interface Call { issue: number; pr: number; head: string; main: string; commit: string; claim: string; req: string; text: string; reaches: string | null }
/** Raises the call for a requirement, or finds the one raised for it already: its handle. Given only where calls are on. */
export type RaiseCall = (call: Call) => Promise<string>;
/** A change as the lander keeps it: its pull request, its issue and the newest judgement of it. */
interface Change { pr: number; issue: number; branch: string; judged?: Judged; passedAt?: number }
/** What the lander keeps of a repo across rounds and restarts: its changes and how many judgements it made. Why landings stopped is main watch's. */
interface State { repo: string; changes: Record<string, Change>; judgements: number }
/** Why landings stopped: the commit main was read back at, or went red at, and the files that differ. */
interface Stop { commit: string; files: string[] }
/** One round's report, as `deep land --json` prints it. */
export interface Round {
  landed: { pr: number; issue: number; commit: string }[];
  /** Each change held, why, and the calls it waits on where calls are on (#1345). */
  held: { pr: number; issue: number; reason: string; calls?: string[] }[];
  sent_back: { pr: number; issue: number; files: string[] }[];
  stopped: Stop | null;
}

export interface LandingOptions {
  root: string;
  repoOf(remote: string): string | undefined;
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
  /** A claim's newest recorded verdict, made once your answers to its calls came (#1345); undefined while it still waits. */
  verdict(claim: string): Promise<{ outcome: Outcome; requirements: Requirement[] } | undefined>;
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
    const repo = this.o.repoOf(origin.replace(/^https?:\/\/[^/]+\/(?=github\.com\/)/, 'https://'));
    if (!repo) throw Error(`${checkout}'s origin (${origin}) names no forge repository`);
    return repo;
  }
  /** Fetches main and the change's branch into the checkout, without touching its work tree, index or HEAD. */
  private async fetch(checkout: string, branches: string[]): Promise<void> {
    await must(checkout, ['fetch', '-q', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main', ...branches.map((b) => `+refs/heads/${b}:refs/remotes/origin/${b}`)], authEnv(await this.o.token()));
  }

  /**
   * `deep land judge`: each open pull request that links an issue, judged on its merge with the default branch's
   * head, in pull request order. Nothing lands.
   */
  async judgeAll(checkout: string): Promise<Round> {
    const repo = await this.repoOf(checkout);
    return this.inTurn(repo, () => this.judgeIn(checkout, repo));
  }
  /**
   * A work run's turn (#1332): only the pull requests that link its issues judged, then one round of landings. With
   * `calls`, as under a standing rule or a topic's card (#1345), a change that waits only on calls raises them and lands
   * when nothing it reaches is past a revert.
   */
  async work(checkout: string, issues: number[], calls?: RaiseCall): Promise<Round> {
    const repo = await this.repoOf(checkout);
    const judged = await this.inTurn(repo, () => this.judgeIn(checkout, repo, issues, calls));
    const round = await this.inTurn(repo, () => this.landIn(checkout, repo, calls));
    const seen = (pr: number): boolean => round.landed.some((l) => l.pr === pr) || round.held.some((h) => h.pr === pr);
    return { ...round, held: [...round.held, ...judged.held.filter((h) => !seen(h.pr))], sent_back: [...judged.sent_back, ...round.sent_back] };
  }
  private async judgeIn(checkout: string, repo: string, issues?: number[], calls?: RaiseCall): Promise<Round> {
    const s = this.load(repo);
    const round: Round = { landed: [], held: [], sent_back: [], stopped: mainWatch(await topOf(checkout)) };
    const pulls = (await this.pulls(repo)).filter((p) => p.issue !== undefined && (!issues || issues.includes(p.issue)));
    await this.fetch(checkout, pulls.map((p) => p.branch));
    const main = await must(checkout, ['rev-parse', 'refs/remotes/origin/main']);
    for (const p of pulls) {
      const c: Change = s.changes[p.pr] ??= { pr: p.pr, issue: p.issue!, branch: p.branch };
      const head = await must(checkout, ['rev-parse', `refs/remotes/origin/${p.branch}`]);
      const judged = await this.judgeOne(s, checkout, c, head, main, calls);
      this.save(s);
      if ('files' in judged) round.sent_back.push({ pr: c.pr, issue: c.issue, files: judged.files });
      else if (!this.lands(judged, calls)) round.held.push({ pr: c.pr, issue: c.issue, reason: heldWhy(judged), ...(judged.calls?.length ? { calls: judged.calls } : {}) });
    }
    this.save(s);
    return round;
  }
  /** Whether a judgement lands: a PASS, one whose only open requirement the budget window settles, or, where calls are on, one waiting only on calls that reaches nothing a revert can't take back. */
  private lands(j: Judged, calls: RaiseCall | undefined): boolean {
    // The planted wrong program lands a change waiting on calls whatever it reaches.
    return j.outcome === 'PASS' || onlyWindow(j) || (calls !== undefined && onlyCalls(j) && (!j.reaches || this.o.plant === 'lands-unreversible'));
  }
  /** One change judged on its merge with `main`, or sent back with the files that conflict. */
  private async judgeOne(s: State, checkout: string, c: Change, head: string, main: string, calls?: RaiseCall): Promise<Judged | { files: string[] }> {
    const merged = await mergeOf(checkout, main, head);
    if ('files' in merged) {
      await this.step('sent_back', s.repo, c, { head, main, files: merged.files });
      await this.o.sendBack({ checkout, issue: c.issue, pr: c.pr, files: merged.files, text: `DeepBuild: pull request #${c.pr} no longer merges with main (${main.slice(0, 12)}): ${merged.files.join(', ')} conflict. Merge main into ${c.branch}, resolve them and push.` });
      delete c.judged;
      delete c.passedAt;
      return { files: merged.files };
    }
    if (c.judged?.commit === merged.commit) {
      // The same merge judged already stands: nothing runs again. One that waited on your calls takes the verdict your
      // answers made, once they made one (#1345).
      const answered = onlyCalls(c.judged) && c.judged.claim ? await this.o.verdict(c.judged.claim) : undefined;
      if (!answered) return c.judged;
      return this.judgedAs(s, checkout, c, { ...c.judged, outcome: answered.outcome, requirements: answered.requirements, at: Date.now() }, calls);
    }
    // Each judgement is a session of its own, so a check whose key didn't change carries from the last one (#1018).
    const session = `land${letters(s.repo)}x${c.issue}x${++s.judgements}`;
    const v = await this.o.judge({ repo: s.repo, checkout, issue: c.issue, pr: c.pr, commit: merged.commit, session });
    const judged: Judged = v
      ? { claim: v.claim, outcome: v.outcome, requirements: v.requirements, commit: merged.commit, tree: merged.tree, head, main, at: Date.now() }
      // No verdict, as when its definition didn't lock: nothing passed, so it's held, never landed (invariant 2).
      : { claim: '', outcome: 'BLOCKED', requirements: [], commit: merged.commit, tree: merged.tree, head, main, at: Date.now(), why: 'no verdict was made on its merge with main: its definition did not lock or its checks did not end' };
    // A change that waits only on calls asks them, where calls are on, whether it lands or waits for your answers (#1345).
    if (calls && onlyCalls(judged)) {
      judged.reaches = await this.reaches(checkout, s.repo, main, merged.commit);
      judged.calls = [];
      for (const q of judged.requirements.filter(waitsOnYou)) {
        judged.calls.push(await calls({ issue: c.issue, pr: c.pr, head, main, commit: merged.commit, claim: judged.claim, req: q.req, text: q.text, reaches: judged.reaches }));
      }
    }
    return this.judgedAs(s, checkout, c, judged, calls);
  }
  /** A change's newest judgement kept and recorded, and its verdict's status posted where it lands. */
  private async judgedAs(s: State, checkout: string, c: Change, judged: Judged, calls: RaiseCall | undefined): Promise<Judged> {
    const passed = this.lands(judged, calls);
    // Its place in the order is its first PASS: a judgement again on a moved head keeps it.
    if (passed) c.passedAt ??= judged.at;
    else delete c.passedAt;
    c.judged = judged;
    await this.step('judged', s.repo, c, { head: judged.head, main: judged.main, commit: judged.commit, tree: judged.tree, claim: judged.claim || null, outcome: judged.outcome });
    // The planted wrong program closes the issue once its pull request is judged, before anything landed.
    if (this.o.plant === 'closes-on-open') await this.call('PATCH', `/repos/${s.repo}/issues/${c.issue}`, { state: 'closed' });
    if (passed) await this.post(checkout, s.repo, judged.commit, judged);
    return judged;
  }
  /**
   * What landing a change reaches that a revert can't take back (#1345), read from structure and never from words: a
   * file the repo's release ships, by `release.paths` in main's `.deepbuild/done.yaml`, or a file the forge's Pages site
   * is built from. Null when it reaches neither.
   */
  private async reaches(checkout: string, repo: string, main: string, commit: string): Promise<string | null> {
    const files = (await must(checkout, ['diff', '--name-only', main, commit])).split('\n').filter(Boolean);
    let spec: unknown;
    try { spec = parseYaml(await must(checkout, ['show', `${main}:.deepbuild/done.yaml`])); } catch { spec = undefined; }
    const paths = isObj(spec) && isObj(spec.release) && Array.isArray(spec.release.paths) ? spec.release.paths.map(String) : [];
    const shipped = files.filter((f) => paths.some((g) => globMatches(g, f)));
    if (shipped.length) return `a release: done.yaml's release ships ${shipped.join(', ')}`;
    const pages = await this.call('GET', `/repos/${repo}/pages`);
    // No site is a 404; an answer that says neither leaves what it reaches unknown, so it waits for you.
    if (pages.status === 404) return null;
    if (pages.status !== 200 || !isObj(pages.body)) return `the published page: the forge answered ${pages.status} for the repo's Pages site`;
    const source = isObj(pages.body.source) ? pages.body.source : null;
    // A site a workflow builds can publish anything on main; one built from a branch, its folder there.
    const folder = source ? String(source.path ?? '/').replace(/^\/+|\/+$/g, '') : '';
    const published = pages.body.build_type === 'workflow' || !source ? files : source.branch === 'main' ? files.filter((f) => !folder || f.startsWith(`${folder}/`)) : [];
    return published.length ? `the published page: the Pages site is built from ${source ? `${String(source.branch)}:/${folder}` : 'a workflow'}, which holds ${published.join(', ')}` : null;
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
      body: JSON.stringify({ context: CONTEXT, state: 'success', description: `${judged.outcome}${onlyWindow(judged) ? '; the budget window settles the rest' : onlyCalls(judged) ? '; your calls settle the rest' : ''}`.slice(0, 140) }),
    });
    if (!res.ok) throw Error(`the forge refused the verdict's status on ${commit}: ${res.status}`);
  }

  // ---- A round of landings.

  /** `deep land`: one round. Each change with a PASS, in the order the PASSes came, lands one at a time. */
  async land(checkout: string): Promise<Round> {
    const repo = await this.repoOf(checkout);
    return this.inTurn(repo, () => this.landIn(checkout, repo));
  }
  private async landIn(checkout: string, repo: string, calls?: RaiseCall): Promise<Round> {
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
      let judged: Judged | { files: string[] } = stale && this.o.plant !== 'lands-unjudged-commit' ? await this.judgeOne(s, checkout, c, head, main, calls) : c.judged!;
      if (stale && this.o.plant === 'lands-unjudged-commit') {
        const m = await mergeOf(checkout, main, head);
        if (!('files' in m)) judged = { ...c.judged!, ...m, head, main };
      }
      this.save(s);
      if ('files' in judged) { round.sent_back.push({ pr: c.pr, issue: c.issue, files: judged.files }); continue; }
      if (!this.lands(judged, calls)) {
        round.held.push({ pr: c.pr, issue: c.issue, reason: heldWhy(judged), ...(judged.calls?.length ? { calls: judged.calls } : {}) });
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
    const window = judged.requirements.filter((q) => q.outcome !== 'PASS' && q.settled_by === 'budget-window').map((q) => q.text);
    // The calls a change landed with stay open on its issue, as the budget window's requirement does (#1345).
    const asked = onlyCalls(judged) ? judged.requirements.filter(waitsOnYou).map((q) => q.text) : [];
    const open = [...window, ...asked];
    // A change the budget window or your calls still settle part of leaves its issue open (#1332): its PR's closing
    // words become `Part of` before the merge, and an issue the forge closed at the merge anyway is opened again.
    if (open.length) {
      const pr = await this.call('GET', `/repos/${s.repo}/pulls/${c.pr}`);
      const body = isObj(pr.body) && typeof pr.body.body === 'string' ? pr.body.body : '';
      const kept = body.replace(new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?(\\s+#${c.issue}\\b)`, 'gi'), 'Part of$1');
      if (kept !== body) await this.call('PATCH', `/repos/${s.repo}/pulls/${c.pr}`, { body: kept }, gate);
    }
    const merged = await this.call('PUT', `/repos/${s.repo}/pulls/${c.pr}/merge`, { sha: head, merge_method: 'merge' }, gate);
    if (merged.status !== 200) return undefined;
    if (open.length) await this.call('PATCH', `/repos/${s.repo}/issues/${c.issue}`, { state: 'open' }, gate);
    const said = isObj(merged.body) && typeof merged.body.sha === 'string' ? merged.body.sha : '';
    // Landed as the forge merged it, recorded at once (#1332): the forge may close the issue at the merge, and the
    // record holds the landing as soon as it does. The read-back below stops landings if main holds another tree.
    const took = SHA.test(said) ? said : null;
    // The planted wrong program records a change landed with its calls open as a PASS.
    const outcome = asked.length && this.o.plant === 'lands-as-pass' ? 'PASS' : judged.outcome;
    await this.step('landed', s.repo, c, { head, main: took, commit: took, tree: null, claim: judged.claim, outcome, open });
    delete s.changes[c.pr];
    await this.fetch(checkout, []);
    const main = await must(checkout, ['rev-parse', 'refs/remotes/origin/main']);
    // The planted wrong program takes the forge's merged state for the landed tree, with no read-back.
    const read = this.o.plant === 'trusts-forge-merged' ? judged.tree : await must(checkout, ['rev-parse', `${main}^{tree}`]);
    if (read !== judged.tree) {
      const files = (await must(checkout, ['diff', '--name-only', judged.tree, read])).split('\n').filter(Boolean);
      this.save(s);
      await this.step('stopped', s.repo, c, { head, main, commit: main, tree: read, files });
      stopMain(top, main, c.issue, files, said);
      return { commit: main, stopped: { commit: main, files } };
    }
    // The issue closes now that its change landed, unless the budget window or your calls still settle part of it.
    if (window.length) await this.call('POST', `/repos/${s.repo}/issues/${c.issue}/comments`, { body: `DeepBuild landed #${c.pr} at ${main}; this issue stays open until the scheduled budget window settles: ${window.map((t) => `"${t}"`).join(', ')}.` }, gate);
    if (asked.length) await this.call('POST', `/repos/${s.repo}/issues/${c.issue}/comments`, { body: `DeepBuild landed #${c.pr} at ${main}; this issue stays open until you answer its calls: ${asked.map((t, i) => `"${t}" (deepbuild://ask/${(judged.calls?.[i] ?? '').replace(/^ask:/, '')})`).join(', ')}. Each takes its recommended answer at its deadline, and Send back reverts this change.` }, gate);
    if (!open.length) await this.call('PATCH', `/repos/${s.repo}/issues/${c.issue}`, { state: 'closed' }, gate);
    this.save(s);
    return { commit: main, stopped: null };
  }

  // ---- Your answers to the calls a change landed with (#1345).

  /**
   * Your Send back on a call whose change landed: the landing taken back on main as it stands, as a change of its own
   * that lands in turn. The revert goes on a branch, a pull request that closes nothing merges it with the gate's
   * landing identity, it's recorded as the issue's landing with no verdict, and the issue says so. Why it couldn't, if
   * it couldn't.
   */
  async revert(checkout: string, r: { issue: number; pr: number; commit: string; ask: string; words: string | null }): Promise<string | undefined> {
    const repo = await this.repoOf(checkout);
    return this.inTurn(repo, async () => {
      const token = await this.o.token();
      await this.fetch(checkout, []);
      const main = await must(checkout, ['rev-parse', 'refs/remotes/origin/main']);
      // The landing's own change undone on main's head: a three-way merge from the landing to the main it landed on.
      const before = await must(checkout, ['rev-parse', `${r.commit}^1`]);
      const m = await git(checkout, ['merge-tree', '--write-tree', '--name-only', '--no-messages', `--merge-base=${r.commit}`, main, before]);
      const [tree, ...files] = m.out.split('\n').filter(Boolean);
      if (m.code === 1) return `its revert conflicts with main at ${main.slice(0, 12)}: ${files.join(', ')}`;
      if (m.code !== 0 || !tree || !SHA.test(tree)) throw Error(`git merge-tree: ${m.err || m.out}`);
      const commit = await must(checkout, ['commit-tree', tree, '-p', main, '-m', `Revert #${r.pr}: sent back on ${r.ask}`], FIXED);
      const branch = `deepbuild/revert-${r.commit.slice(0, 12)}`;
      await must(checkout, ['push', '-q', '--no-verify', 'origin', `+${commit}:refs/heads/${branch}`], authEnv(token));
      const gate = this.o.gateApp() ? await this.o.landingToken(repo) : undefined;
      const opened = await this.call('POST', `/repos/${repo}/pulls`, { title: `Revert #${r.pr}`, head: branch, base: 'main', body: `Reverts #${r.pr}, sent back on ${r.ask}.` }, gate);
      const pr = isObj(opened.body) ? Number(opened.body.number) : NaN;
      if (opened.status !== 201 || !Number.isSafeInteger(pr)) return `the forge refused the revert's pull request (${opened.status})`;
      const merged = await this.call('PUT', `/repos/${repo}/pulls/${pr}/merge`, { sha: commit, merge_method: 'merge' }, gate);
      if (merged.status !== 200) return `the forge refused the revert's merge (${merged.status})`;
      const said = isObj(merged.body) && typeof merged.body.sha === 'string' && SHA.test(merged.body.sha) ? merged.body.sha : null;
      await this.step('landed', repo, { pr, issue: r.issue }, { head: commit, main: said, commit: said, tree: null, claim: null, outcome: 'none', open: [] });
      await this.call('POST', `/repos/${repo}/issues/${r.issue}/comments`, { body: `DeepBuild reverted #${r.pr} through #${pr} on your Send back on deepbuild://ask/${r.ask.replace(/^ask:/, '')}${r.words ? `: "${r.words}"` : ''}. This issue goes back to the run.` }, gate);
      return undefined;
    });
  }

  /** An issue whose change landed with calls open, once each closed with no Send back: it closes, saying how they closed. */
  async closeAnswered(checkout: string, issue: number, how: string): Promise<void> {
    const repo = await this.repoOf(checkout);
    await this.inTurn(repo, async () => {
      const gate = this.o.gateApp() ? await this.o.landingToken(repo) : undefined;
      await this.call('POST', `/repos/${repo}/issues/${issue}/comments`, { body: `DeepBuild closes this issue: ${how}.` }, gate);
      await this.call('PATCH', `/repos/${repo}/issues/${issue}`, { state: 'closed' }, gate);
    });
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

/** The merge of `head` into `main` as one commit, the same two sides giving the same commit, or the files that conflict. */
export async function mergeOf(checkout: string, main: string, head: string): Promise<{ commit: string; tree: string } | { files: string[] }> {
  const r = await git(checkout, ['merge-tree', '--write-tree', '--name-only', '--no-messages', main, head]);
  const [tree, ...files] = r.out.split('\n').filter(Boolean);
  if (r.code === 1) return { files };
  if (r.code !== 0 || !tree || !SHA.test(tree)) throw Error(`git merge-tree: ${r.err || r.out}`);
  const commit = await must(checkout, ['commit-tree', tree, '-p', main, '-p', head, '-m', `DeepBuild: ${head} merged with main ${main}`], FIXED);
  return { commit, tree };
}
/** Whether a verdict's only open requirements are ones the scheduled budget window alone settles. */
export function onlyWindow(j: Pick<Judged, 'outcome' | 'requirements'>): boolean {
  const open = j.requirements.filter((q) => q.outcome !== 'PASS');
  return j.outcome !== 'PASS' && open.length > 0 && open.every((q) => q.settled_by === 'budget-window');
}
/** A requirement whose oracle is you, still waiting on your answer: a call (#1345). */
const waitsOnYou = (q: Requirement): boolean => q.oracle === 'person' && q.outcome === 'pending';
/** Whether a verdict's only open requirements wait on your answers (#1345): every other one passed. */
export function onlyCalls(j: Pick<Judged, 'outcome' | 'requirements'>): boolean {
  const open = j.requirements.filter((q) => q.outcome !== 'PASS');
  return j.outcome !== 'PASS' && open.length > 0 && open.every(waitsOnYou);
}
/** Why a change is held: its verdict and what isn't PASS, and for one waiting on calls what its landing would reach. */
const heldWhy = (j: Judged): string => {
  const open = j.requirements.filter((q) => q.outcome !== 'PASS' && q.settled_by !== 'budget-window');
  const reaches = j.reaches ? `; it reaches ${j.reaches}, so it waits for your answer to ${j.calls?.join(', ') || 'its calls'}` : '';
  return `${j.outcome}${j.why ? `: ${j.why}` : open.length ? `: ${open.map((q) => `${q.req} ${q.outcome}`).join(', ')}` : ''}${reaches}`;
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
