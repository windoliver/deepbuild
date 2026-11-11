import type { HubEvents, HubRuntime } from './hub-capabilities.js';
import type { StopJudgingPort, TranscriptsPort } from './hub-ports.js';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { chmod, copyFile, mkdir, realpath } from 'node:fs/promises';
import { writtenOf as wikiWritten } from '@deepbuild/wiki';

import { networkInterfaces } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { type Asks } from '@deepbuild/asks';
import { fixtures, type JsonValue } from '@deepbuild/contracts';

import { type RecordStore } from '@deepbuild/record';

import { verdict as claimVerdict, verdictLine } from '@deepbuild/verdicts';
import { ClaudeSettings, relations } from './claude-settings.js';

import { codexRelations, modified, readTrust, trustProblems } from './codex-settings.js';

import { type Root } from './paths.js';

import { changeSentence, openItemSentence, verdictSentence } from './sentences.js';
import { Forge, parsePrUrl } from './forge.js';


import { LogReads } from './log-reads.js';
import type { Libraries } from './libraries.js';

import { copySynced, synced, type Durable } from './vfs.js';
import { refuse, Refused, refusal, ulid, type CoreOptions } from './wire.js';

import { DAY, ghToken, SECRETS_TTL, type Obj, isObj, misjudged } from "./hub-shared.js";

export interface HubReadingsOptions {
 settings: CoreOptions;
 services: {
readonly root: Root;
readonly record: RecordStore;
readonly asks: Asks;
readonly claudeSettings: ClaudeSettings;
readonly log: LogReads;
readonly now: () => number;
readonly durable: Durable;
readonly libraries: Libraries | undefined;
 };
 events: Pick<HubEvents, "appendCore" | "append" | "connection">;
kernel: Pick<HubRuntime, "blocked" | "jobs">;

judging: () => Pick<StopJudgingPort, "lastMessage" | "prOf" | "stateOf">;
transcripts: () => Pick<TranscriptsPort, "backfill">;
}

export class HubReadings {
 constructor(private readonly options: HubReadingsOptions) {}

  /** What the app last said of macOS and its notifications (#994). */
  notifications: string | null = null;

  private secrets: { at: number; value: Promise<string> } | undefined;

  /**
   * `deep backup <folder>` (#572): the record through SQLite's online backup on the writer's connection, which runs
   * here, off the hub's event loop, so hooks are answered while it copies; then the evidence and wiki folders. Evidence
   * is written before the event that cites it commits, so a copy taken after the record's holds every file it cites.
   * The record's copy is named ledger.db only once the folders are copied, so a folder with one holds a whole backup.
   */
  async backup(params: Obj): Promise<Obj> {
    const folder = params.folder;
    if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Refused(refusal('type', '/params/folder', 'Name the backup folder by its absolute path.', folder));
    const ledger = join(folder, 'ledger.db');
    const partial = `${ledger}.partial`;
    // Checked before anything is made: the folder's nearest part that exists, with its links resolved.
    let nearest = folder;
    while (!existsSync(nearest)) nearest = dirname(nearest);
    const [real, own] = [await realpath(nearest), await realpath(this.options.services.root.dir)];
    if (real === own || real.startsWith(`${own}/`)) throw new Refused(refusal('conflict', '/params/folder', `Back up outside DeepBuild's own folder ${own}, which the backup copies.`, folder));
    // Only an empty folder, made yours alone: nothing in it is read or written through, and no one else reads the copy.
    if (existsSync(folder) && readdirSync(folder).length > 0) throw new Refused(refusal('conflict', '/params/folder', `${folder} isn't empty; back up into an empty folder, or one that doesn't exist yet.`, folder));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);
    const copies = [[this.options.services.root.evidence, 'evidence'], [this.options.services.root.wiki, 'wiki']] as const;
    try {
      await this.options.services.record.backup(partial);
      await chmod(partial, 0o600);
      await synced(partial);
      for (const [from, name] of copies) await copySynced(from, join(folder, name));
      // What the wiki last wrote sits beside its folder (#356): without it, every restored page would read as your edit.
      if (existsSync(wikiWritten(this.options.services.root.wiki))) await copyFile(wikiWritten(this.options.services.root.wiki), wikiWritten(join(folder, 'wiki')));
      // ledger.db names a whole backup only once all of it is on disk, and lasts once its folder is synced.
      await synced(folder);
      renameSync(partial, ledger);
    } catch (error) {
      rmSync(partial, { force: true });
      for (const [, name] of copies) rmSync(join(folder, name), { recursive: true, force: true });
      rmSync(wikiWritten(join(folder, 'wiki')), { force: true });
      throw error;
    }
    // After the rename the backup is whole, so a failed sync here leaves it as it is.
    await synced(folder);
    return { folder };
  }

  /** The app that reported the setting left: asks no longer wait on its reading, which `deep doctor` keeps showing. */
  async notifierGone(): Promise<void> {
    await this.options.services.asks.notifications(false);
  }

  async health(): Promise<Obj> {
    const network = Object.values(networkInterfaces()).flat().some((i) => i && !i.internal) ? 'reachable' : 'unreachable';
    // The timing relations our entries in Claude Code's settings keep, and what the settings watch and recheck put back.
    const claude = { relations: relations(this.options.services.root.dir).map((r) => ({ name: r.name, holds: r.holds, reading: r.text })), readings: [...this.options.services.claudeSettings.readings] };
    const codex = { relations: codexRelations(this.options.services.root.dir).map((r) => ({ name: r.name, holds: r.holds, reading: r.text })), readings: [...modified(this.options.services.root.dir), ...trustProblems(this.options.services.root.dir).map((p) => `Codex's hook list reports ${p}`)], trust: readTrust(this.options.services.root.dir) ?? null };
    // The newest sessions, each closed once an end is on record since its last start (#1023); as `deep status` does, this
    // reads a watch-only session's unverified events too, or its own SessionEnd would leave it open here for good.
    const sessions = ((await this.options.services.record.raw(`SELECT s.id, COALESCE((SELECT e.kind <> 'session.start' FROM events e WHERE e.session_id = s.id AND e.kind IN ('session.start', 'session.end', 'session.archived') ORDER BY e.log_pos DESC LIMIT 1), 0) AS closed
      FROM sessions s WHERE s.last_seen IS NOT NULL ORDER BY s.last_seen DESC LIMIT 100`)) as { id: string; closed: number }[]).map((s) => ({ id: s.id, closed: s.closed === 1 }));
    return { gates: { watch_only: this.options.kernel.blocked !== undefined, reason: this.options.kernel.blocked ?? null }, notifications: this.notifications, secrets: await this.secretStore(), network, claude, codex, sessions, jobs: Object.fromEntries([...this.options.kernel.jobs].map(([name, failing]) => [name, { failing }])), packs: await this.options.services.libraries?.packs.shipped() ?? [] };
  }

  /** Whether this process can reach the OS secret store, read at most every ten seconds. */
  private secretStore(): Promise<string> {
    const at = Date.now();
    if (this.secrets && at - this.secrets.at < SECRETS_TTL) return this.secrets.value;
    const value = new Promise<string>((done) => {
      // securityd answers the keychain list for this process's security session, whatever HOME is.
      if (process.platform === 'darwin') execFile('/usr/bin/security', ['list-keychains'], (error) => done(error ? 'unreachable' : 'reachable'));
      else done(process.env.DBUS_SESSION_BUS_ADDRESS ? 'reachable' : 'unreachable');
    });
    this.secrets = { at, value };
    return value;
  }

  /**
   * changes/:id: a claim, with the runs and verdicts of its checks, and its receipt (#83): the line the chat showed
   * and the second line; the checks it ran; its ask with the PR's state and link, read from the forge now; what it
   * produced (the PR, the files the session wrote, the pages the record saw); and, once it passed, the next
   * unblocked issue in its epic.
   */
  change(params: Obj): Promise<Obj> {
    const id = typeof params.id === 'string' && /^claim:[0-9A-Za-z]+$/.test(params.id) ? params.id.slice(6) : undefined;
    if (!id) throw new Refused(refusal('pattern', '/params/id', 'Name the change as claim:<id>.', params.id));
    return this.options.services.log.reflecting(async () => {
      const [claim] = await this.options.services.record.raw(`SELECT * FROM claims WHERE id = ?`, [id]);
      if (!claim) throw new Refused(refusal('not_found', '/params/id', `No change claim:${id} in the record.`, params.id));
      const runs = await this.options.services.record.raw(`SELECT * FROM runs WHERE claim_id = ? ORDER BY started`, [id]);
      const verdicts = await this.options.services.record.raw(`SELECT * FROM verdicts WHERE claim_id = ? ORDER BY created`, [id]);
      const state = (await this.options.judging().stateOf(`claim:${id}`))!;
      const line = verdictLine(state.state);
      const url = await this.options.judging().prOf(state.session);
      const pr = url ? parsePrUrl(url) : undefined;
      const forge = pr ? new Forge(this.options.settings.forge ?? 'https://api.github.com', process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken()) : undefined;
      const pulled = pr && forge ? await forge.pull(pr) : undefined;
      const files = state.session ? ((await this.options.services.record.raw(`SELECT path FROM session_files WHERE session = ? AND kind IN ('edit', 'write') ORDER BY last`, [state.session])) as { path: string }[]).map((r) => r.path) : [];
      const next_issue = pr && forge && pulled?.closes !== undefined && state.state.outcome === 'PASS' ? await forge.nextIssue(pr, pulled.closes) : null;
      // A forge that didn't answer leaves the state unknown, never a guess.
      const asks = [{ ask: state.task, pr: url ? { state: pulled?.state ?? 'unknown', url } : null }];
      const second = [
        state.checks.length ? `checks: ${state.checks.map((c) => `${c.check} ${c.outcome}${c.spend_usd !== undefined ? ` $${c.spend_usd.toFixed(2)}` : ''}${c.stand_in ? ', proven on a stand-in' : ''}`).join(', ')}` : '',
        url ? `PR ${pulled?.state ?? 'unknown'} ${url}` : '',
        files.length ? `wrote ${files.join(', ')}` : '',
        next_issue ? `next issue #${next_issue.number} ${next_issue.url}` : '',
      ].filter(Boolean).join(' · ');
      // One plain sentence on the change, each verdict and each open item, from the template (#1999).
      const say = (sentence: string): Promise<string> => this.options.settings.plant === 'sentence-from-model' ? this.planted(sentence) : Promise.resolve(sentence);
      const [where] = state.session ? (await this.options.services.record.raw(`SELECT worktree FROM sessions WHERE id = ?`, [state.session])) as { worktree: string | null }[] : [];
      const named = files.map((f) => where?.worktree && f.startsWith(`${where.worktree}/`) ? relative(where.worktree, f) : basename(f));
      const said = this.options.settings.plant === 'sentence-from-agent-text' && state.session ? this.options.judging().lastMessage.get(state.session) : undefined;
      const sentence = said ?? await say(changeSentence(named));
      const rounds = new Map(((await this.options.services.record.raw(`SELECT json_extract(data, '$.verdict') AS verdict, json_extract(data, '$.round') AS round FROM events WHERE kind = 'claim.sent_back' AND subject = ?`, [`claim:${id}`])) as { verdict: string; round: number }[]).map((r) => [r.verdict, Number(r.round)]));
      for (const v of verdicts as Obj[]) {
        const reqs = (JSON.parse(String(v.requirements ?? '[]')) as Obj[]).map((r) => ({ req: String(r.req), outcome: String(r.outcome), smallest: typeof r.smallest === 'string' ? r.smallest : null, points_to: typeof r.points_to === 'string' ? r.points_to : null }));
        v.sentence = await say(verdictSentence({ outcome: String(v.outcome), requirements: reqs, smallest: typeof v.smallest === 'string' ? v.smallest : null, stale: Boolean(v.stale), round: rounds.get(String(v.handle)) ?? null }));
      }
      const open_items: Obj[] = [];
      for (const item of (await this.options.services.record.raw(`SELECT text FROM open_items WHERE task_ref = ? AND closed IS NULL ORDER BY opened`, [state.task])) as { text: string }[]) {
        open_items.push(this.options.settings.plant === 'open-item-no-sentence' ? { text: item.text } : { text: item.text, sentence: await say(openItemSentence(item.text)) });
      }
      return { change: { claim, sentence, runs, verdicts, open_items, line, second, checks: state.checks, asks, produced: { pr: url ?? null, files, pages: [] }, next_issue } };
    });
  }

  /** The planted wrong program `sentence-from-model`: a headless agent call writes the sentence from the template's. */
  private planted(sentence: string): Promise<string> {
    return new Promise((done) => execFile('claude', ['-p', `Write one plain sentence saying: ${sentence}`], { timeout: 30_000 }, (error, out) => done(error ? sentence : String(out).trim() || sentence)));
  }

  /**
   * A promotion's health check (#1334): one fixture claim, a requirement its one check covers and a passing run of
   * it, judged by this build's verdict engine and returned as judged() records a claim's. A good build reads it PASS.
   */
  healthClaim(): Obj {
    const commit = '0'.repeat(40), req = 'req:HEALTH#R1', check = 'health', digest = `d1:${'0'.repeat(64)}`, claim = 'claim:HEALTH';
    const v = misjudged(claimVerdict({
      claim, agent: 'session:HEALTH', repo: 'health', task: 'task:HEALTH', commit, now: this.options.services.now(), changes: [], waivers: [],
      requirements: [{ req, depth: 'unit', oracle: 'code', on_base: 'passes' }],
      checks: [{ check, digest, source: 'definition', depth: 'unit', proof: 'test_run', covers: [req], environment: {}, tools: {} }],
      runs: [{ run: 'run:HEALTH', check, claim, commit, digest, environment: {}, tools: {}, outcome: 'passed', ended: 1, tests_run: 1, reads: [], failures: [], evidence: [], kept: true }],
    }), this.options.settings.plant);
    return { claim, outcome: v.outcome, reasons: v.reasons };
  }

  /** The rollback's one notice (#1334), recorded by the build that came back: the promoted commit, the restored one and why. */
  async rolledBack(p: Obj): Promise<Obj> {
    const hex = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
    if (!hex(p.commit) || typeof p.restored !== 'string' || !p.restored) throw refuse('pattern', '/params/commit', 'Name the promoted commit as 40 hex digits, and the build that came back.', p.commit);
    await this.options.events.appendCore('build.rolled_back', { commit: p.commit, restored: p.restored, why: String(p.why ?? '').slice(0, 8192) });
    return { recorded: true };
  }

  /** test.load: ten verdicts each in its own FULL commit, a checkpoint and a transcript backfill, as the hub would do them. */
  async testLoad(params: Obj): Promise<Obj> {
    if (!this.options.settings.vfs) throw new Refused(refusal('unknown_method', '/method', 'test.load is served only to a hub running under the test VFS.', 'test.load'));
    const verdicts = Number.isSafeInteger(params.verdicts) ? (params.verdicts as number) : 0;
    const template = (fixtures('verdict.made@1')[0] as Obj).data as Obj;
    for (let i = 0; i < verdicts; i++) {
      const ts = this.options.services.now();
      const id = ulid(ts);
      await this.options.events.append(this.options.events.connection('core'), { v: 1, id, kind: 'verdict.made', ts, data: { ...template, verdict: `verdict:${id}`, claim: `claim:${ulid(ts)}`, requirements: [] } as JsonValue });
    }
    // The test image has no WAL of its own: a checkpoint costs the hub one sync.
    if (params.checkpoint === true) this.options.services.durable.sync();
    let backfilled = 0;
    if (isObj(params.backfill)) backfilled = await this.options.transcripts().backfill(params.backfill);
    return { done: true, verdicts, backfilled };
  }

  /** The GitHub repos (owner/name) whose worktrees sessions worked in over the last 90 days, GitHub's default log retention. */
  async forgeRepos(): Promise<string[]> {
    const rows = (await this.options.services.record.raw(`SELECT DISTINCT worktree FROM sessions WHERE worktree IS NOT NULL AND last_seen > ${this.options.services.now() - 90 * DAY}`)) as { worktree: string }[];
    const origins = await Promise.all(rows.map(({ worktree }) => new Promise<string>((done) => execFile('git', ['-C', worktree, 'remote', 'get-url', 'origin'], { timeout: 2000 }, (error, out) => done(error ? '' : out.trim())))));
    return [...new Set(origins.flatMap((url) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(url)?.[1] ?? []))];
  }

}
