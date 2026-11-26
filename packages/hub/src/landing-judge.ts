// What a landing judges (#1331, #1347): a change's merge with the head it lands on, claimed and judged in a checkout of
// its own, and a landed claim's newest recorded verdict (#1345).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Hex } from '@deepbuild/contracts';
import { gitEnv } from '@deepbuild/gate';
import { AskTasks } from './ask-tasks.js';
import { liveFetch, readIssue, recordedFetch } from './github-source.js';
import { ghToken, letters } from './hub-shared.js';
import type { Outcome } from './landing.js';
import type { StopJudgingOptions } from './stop-judging-options.js';

/** How long a landing's judgement waits for its verdict (#1331). */
const VERDICT_WAIT_MS = 30 * 60_000;

interface Judged { claim: string; outcome: Outcome; requirements: { req: string; text: string; settled_by: string | null; outcome: string; oracle?: string | null }[] }

export class LandingJudge {
  constructor(private readonly o: {
    options(): StopJudgingOptions;
    /** A claim's gate lane and its verdict's write, while either is unfinished. */
    lane(claim: string): Promise<unknown> | undefined; written(claim: string): Promise<unknown> | undefined;
    /** The judgement ended: what its stand-in session's claims keep in memory goes. */
    forget(session: string): void;
  }) {}
  private get services(): StopJudgingOptions['services'] { return this.o.options().services; }
  private get settings(): StopJudgingOptions['settings'] { return this.o.options().settings; }

  /**
   * A change judged on its merge with the default branch's head (#1331): the issue's task, opened once from its
   * reading, claims the merge commit in a worktree of its own, as `session` did a stop; its slow checks start, and its
   * verdict is read once made. Each check whose key the merge didn't change carries from the run that made it (#1018).
   */
  async judgeLanding(r: { repo: string; checkout: string; issue: number; pr: number; commit: string; session: string }): Promise<Judged | undefined> {
    const [owner, name] = r.repo.split('/') as [string, string];
    const fetch = this.settings.github ? recordedFetch(this.settings.github) : liveFetch(this.settings.forge, process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken());
    // A reading with no revision time is revised by its text: the definition still names the issue it locked from.
    const readings = (await readIssue(fetch, owner, name, r.issue, this.settings.plant).catch(() => undefined))?.map((x) => (x.updated ? x : { ...x, updated: sha256Hex(new TextEncoder().encode(x.body)) }));
    if (!readings?.[0]) throw Error(`issue #${r.issue} of ${r.repo} couldn't be read, so its change can't be judged`);
    return this.judgeMerge({ checkout: r.checkout, commit: r.commit, session: r.session, item: { ...readings[0], readings }, tree: join(this.services.root.dir, 'landing', 'trees', letters(r.session)), keep: false });
  }
  /**
   * A workspace task's change judged on its merge with the workspace's main (#1347), as a pull request's is, from the
   * task's record item and with no forge. Its checkout stays, one per task, so a drift runs its checks again there.
   */
  judgeTask(r: { folder: string; item: Parameters<AskTasks['landing']>[0]['item']; commit: string; session: string }): Promise<Judged | undefined> {
    const tree = join(this.services.root.dir, 'landing', 'tasks', letters(r.item.source_id));
    return this.judgeMerge({ checkout: r.folder, commit: r.commit, session: r.session, item: { ...r.item, readings: [r.item] }, tree, keep: true });
  }
  private async judgeMerge(r: { checkout: string; commit: string; session: string; item: Parameters<AskTasks['landing']>[0]['item']; tree: string; keep: boolean }): Promise<Judged | undefined> {
    const { item, tree } = r;
    mkdirSync(dirname(tree), { recursive: true });
    const worktree = (...args: string[]) => new Promise<void>((done, fail) => execFile('git', ['-C', r.checkout, 'worktree', ...args], { env: gitEnv() }, (error) => (error ? fail(error) : done())));
    // A kept checkout from the task's last judgement gives way to this one: the same repo, so its claims' commits stay reachable.
    if (r.keep && existsSync(tree)) await worktree('remove', '--force', tree).catch(() => rmSync(tree, { recursive: true, force: true }));
    await worktree('add', '--quiet', '--detach', '--force', tree, r.commit);
    // The checkout's installs serve the claim's checks: a link, which the gate's checkouts clone from where it points.
    for (const dep of ['node_modules', '.venv']) if (existsSync(join(r.checkout, dep)) && !existsSync(join(tree, dep))) symlinkSync(join(r.checkout, dep), join(tree, dep));
    try {
      this.o.options().state().live.set(r.session, { agent: 'claude-code', cwd: tree, last: this.services.now(), calls: new Map(), wakeups: [], crons: new Map(), background: new Map(), looping: false, turn: 0, judged: false });
      const made = await this.services.tasks.landing({ session: r.session, cwd: tree, item, at: this.services.now() });
      if (!made) return undefined;
      await this.o.lane(made.claim)?.catch(() => undefined);
      // Nothing sends this claim on: its slow checks start now, as a turn's end starts them.
      await this.services.gate.turnEnded(made.claim, [], this.services.now(), { session: r.session, origin: 'person', due: null, starter: 'claim' }).catch(() => undefined);
      // The verdict the core recorded, once the gate's is no longer pending: what the poster posts and the record keeps.
      const until = Date.now() + VERDICT_WAIT_MS;
      for (;;) {
        await this.o.written(made.claim)?.catch(() => undefined);
        const v = this.services.gate.verdictOf(made.claim);
        const [row] = !v || v.outcome !== 'pending' ? (await this.services.record.raw(`SELECT outcome, requirements FROM verdicts WHERE claim_id = ? ORDER BY created DESC LIMIT 1`, [made.claim.slice(6)])) as { outcome: Outcome; requirements: string | null }[] : [];
        // A verdict that waits only on your answer to requirements whose oracle is you, every other one passed, waits on
        // no check (#1345): it's judged now, INCONCLUSIVE, with those requirements pending, and never recorded as made.
        const calls = !row && v && v.requirements.some((q) => q.oracle === 'person' && q.outcome === 'pending') && v.requirements.every((q) => q.outcome === 'PASS' || (q.oracle === 'person' && q.outcome === 'pending'));
        if (row || calls) {
          const read = row ? JSON.parse(row.requirements ?? '[]') as { req: string; outcome: string; oracle?: string }[] : v!.requirements;
          return { claim: made.claim, outcome: row?.outcome ?? 'INCONCLUSIVE', requirements: await this.landingRequirements(made.task, read) };
        }
        if (Date.now() > until) return undefined;
        await new Promise((done) => setTimeout(done, 200));
      }
    } finally {
      this.o.options().state().live.delete(r.session);
      this.o.forget(r.session);
      if (!r.keep) await worktree('remove', '--force', tree).catch(() => undefined);
    }
  }

  /** A verdict's requirements as the landing reads them: each one's text and what alone settles it, from the task's locked definition, and whose word decides it. */
  private async landingRequirements(task: string, read: { req: string; outcome: string; oracle?: string }[]): Promise<{ req: string; text: string; settled_by: string | null; outcome: string; oracle: string | null }[]> {
    const settled = new Map((await this.services.tasks.lockedRequirements(task)).map((q) => [q.req, q]));
    return read.map((q) => ({ req: q.req, text: settled.get(q.req)?.text ?? q.req, settled_by: settled.get(q.req)?.settled_by ?? null, outcome: q.outcome, oracle: q.oracle ?? null }));
  }
  /** A landed claim's newest recorded verdict (#1345): one your answers to its calls made; undefined while none is recorded. */
  async recorded(claim: string): Promise<{ outcome: Outcome; requirements: { req: string; text: string; settled_by: string | null; outcome: string; oracle: string | null }[] } | undefined> {
    const [row] = (await this.services.record.raw(`SELECT v.outcome AS outcome, v.requirements AS requirements, c.subject_ref AS task FROM verdicts v JOIN claims c ON c.id = v.claim_id WHERE v.claim_id = ? ORDER BY v.created DESC LIMIT 1`, [claim.slice(6)])) as { outcome: Outcome; requirements: string | null; task: string | null }[];
    if (!row?.task) return undefined;
    return { outcome: row.outcome, requirements: await this.landingRequirements(row.task, JSON.parse(row.requirements ?? '[]') as { req: string; outcome: string; oracle?: string }[]) };
  }
}
