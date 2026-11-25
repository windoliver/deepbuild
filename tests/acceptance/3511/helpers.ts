// Test-side tools for #3511's acceptance tests (README): #999's world, imported whole from ../999/helpers.ts (a real
// hub in a temp home, the Lima VM as the host behind a relay, `deep` as you, the followed record, the harness's own
// link, and a Claude Code session on the host run through the hooks `deep host add` installed), and on top of it only
// what this issue's scenes need: the sample repo with a test file and, for one scene, a package script; a session
// brought to its first change; the claim a stop made, read once its runs ended; and what its newest verdict says.
// Nothing here stands in for DeepBuild, and nothing here waits on a timer of its own: every wait is the record's
// (`Log.until`), bounded (scripts/wait-ratchet.mjs).
//
// Since #999's helpers make them, the folders carry its prefix: /tmp/dh999-* here, ~/dh999-<id>/ on the host.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHECK, cut, hostAdd, HostSession, openWorld, PROMPT, q, shown, type Ev, type Line, type World } from '../999/helpers.ts';

/** Each criterion's ID and text: `#3511.` and the first 8 hex of SHA-256 of its checkbox text (scripts/proof-change.mjs). */
export const AC = {
  1: '#3511.18fa26af A session on a host whose claim edits the test file its approved spec check runs, so that the check exits 0 there, does not read PASS; the verdict names the check as the agent\'s own and the edited file. The same holds for a claim that edits the package script the check runs. A gate that never reads the host\'s change set passes both claims and fails this test, naming the check.',
  2: '#3511.7e0ccc3e A session on a host whose claim changes only the code under test, with the same check passing there, reads PASS.',
  3: '#3511.6e0d7d73 With the read of what the claim changed failing on the host, for a claim whose check exits 0 there, the claim gets a verdict other than PASS before its stop hold ends, and the verdict names the failed read. A gate that treats the failed read as no change passes the claim and fails this test.',
} as const;

/** The code under test, the test file the check runs, and the file that holds the package script it runs. */
export const CODE = 'price.txt';
export const TEST_FILE = 'tests/price_test.sh';
export const PACKAGE = 'package.json';
/** The cart's test as the base commit holds it: it passes once price.txt holds 17.00. */
const TEST = [
  '# The cart\'s test: the coupon is taken off, so price.txt holds 17.00.',
  'got=$(cat price.txt 2>/dev/null)',
  'if [ "$got" = 17.00 ]; then echo "ok: price.txt holds 17.00"; else echo "not ok: price.txt holds ${got:-nothing}, expected 17.00"; exit 1; fi',
  '',
].join('\n');
/** The same file as a claim leaves it when it edits the test in place of the code: it compares nothing. */
export const TEST_GUTTED = ['# The cart\'s test.', 'echo "ok: the cart total"', ''].join('\n');
const packageJson = (test: string): string => `${JSON.stringify({ name: 'cart', version: '1.0.0', private: true, scripts: { test } }, null, 2)}\n`;
/** package.json as the base commit holds it, and as a claim leaves it when it edits the script the check runs. */
const PACKAGE_BASE = packageJson(`sh ${TEST_FILE}`);
export const PACKAGE_GUTTED = packageJson('echo "ok: the cart total"');

/** How the approved check reaches the test: by running the test file, or by running the package script that runs it. */
export type Via = 'test-file' | 'script';

export interface Scene { w: World; s: HostSession; repo: string; base: string; task: string }
/**
 * The sample repo on the host, as #999's helper makes it (price.txt at 20.00 and the drafted check, one commit on
 * main), then a second commit, the claim's base: the test file, the check rewritten to run it (noting each run as
 * #999's does), and for `script` a package.json whose `test` script runs the test file, which the check runs with
 * `npm test`. Returns the folder and the base commit. A host where a user unit finds no npm is BLOCKED for `script`.
 */
async function sampleRepo(w: World, via: Via): Promise<{ repo: string; base: string }> {
  const repo = await w.host.repo();
  const note = `printf '%s %s\\n' "\${DEEP_RUN_TOKEN:-none}" "$(tail -n 1 /proc/self/cgroup)" >> ${q(`${w.host.folder}/price.starts`)}`;
  const runs = via === 'script'
    ? [`export npm_config_cache=${q(`${w.host.folder}/npm-cache`)} npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false`, 'npm test']
    : [`sh ${TEST_FILE}`];
  if (via === 'script') {
    // A remote run is a user unit (#1942): npm must be where one finds it, or the check could never exit 0 there.
    await w.host.must('systemd-run --user --quiet --collect --wait --pipe /bin/sh -c \'command -v npm >/dev/null\' || { echo "a user unit on the test host finds no npm to run the package script with; install Node there" >&2; exit 7; }');
    await w.host.write(`${repo}/${PACKAGE}`, PACKAGE_BASE);
  }
  await w.host.write(`${repo}/${TEST_FILE}`, TEST);
  await w.host.write(`${repo}/${CHECK}`, ['# The approved check of the sample repo: the cart\'s test passes. Each run notes its run token and its unit.', note, ...runs, ''].join('\n'));
  const base = (await w.host.must(`cd ${q(repo)} && git add -A && git -c user.name=T -c user.email=t@example.test -c commit.gpgsign=false commit -q -m 'the cart, its test and its check' && [ -z "$(git status --porcelain)" ] && git rev-parse HEAD`)).trim();
  return { repo, base };
}

/**
 * A world with the host added and a session there, in the sample repo, at the point where it has taken the prompt, its
 * task's handed definition has locked and it has read price.txt. Everything up to here is #999's, on main: any of it
 * missing is BLOCKED, never a reading of this issue's criteria.
 */
export async function begin(via: Via): Promise<Scene> {
  const w = await openWorld();
  await hostAdd(w).catch((error: unknown) => { throw Error(`BLOCKED: ${error instanceof Error ? error.message : String(error)}`); });
  const { repo, base } = await sampleRepo(w, via);
  const s = await HostSession.open(w);
  try {
    await s.start();
    await s.typed(PROMPT);
  } catch (error) {
    throw Error(`BLOCKED: the session on ${w.alias} didn't record its start and prompt: ${error instanceof Error ? error.message : String(error)}`);
  }
  const taskOf = (events: readonly Ev[]): string | undefined => events.find((e) => e.kind === 'user.ask' && e.session === s.id)?.data.tasks?.[0] as string | undefined;
  if (!await w.log.until((events) => { const t = taskOf(events); return t !== undefined && events.some((e) => e.kind === 'definition.locked' && e.data.task_ref === t); }, 300_000)) {
    throw Error(`BLOCKED: the prompt typed on ${w.alias} opened no task whose handed definition locked: the record holds ${cut(JSON.stringify(w.log.events.filter((e) => /^(user\.ask|task\.|definition\.)/.test(e.kind)).map((e) => [e.kind, e.data])))}`);
  }
  const read = await s.bash(`cat ${CODE}`);
  if (!read.after) throw Error(`BLOCKED: the session's \`cat ${CODE}\` on ${w.alias} wasn't let through: ${w.redact(shown(read.before))}`);
  return { w, s, repo, base, task: taskOf(w.log.events)! };
}

/** The session writes a file of the repo whole, as an Edit; one its hooks don't let through never reached the scene: BLOCKED. */
export async function edits(sc: Scene, file: string, bytes: string): Promise<void> {
  await sc.s.edit(file, bytes).catch((error: unknown) => { throw Error(`BLOCKED: ${error instanceof Error ? error.message : String(error)}`); });
}

export interface Run { run: string; check: string; host: unknown; outcome: string | null }
export interface Claim { id: string; runs: Run[]; verdicts: Ev[]; outcome: string | null }
/**
 * The session stops saying done, and the claim that stop made on its task is read once it has a verdict, every run it
 * started has ended and a run of the sample check has ended; a verdict that follows that run is given 30 s more to
 * land. A stop that makes no claim is BLOCKED (#999's, on main). With `mark`, the session's next hook is fired once its
 * Stop hook has returned on the host, and `stopped` is that hook's place in the record: what the record holds before
 * it was there when the stop's hold ended. Only the test that reads the hold asks for it, so no other claim is
 * followed by a call it didn't need.
 */
export async function stopAndClaim(sc: Scene, mark = false): Promise<Claim & { stopped: number }> {
  const { w, s, task } = sc;
  const from = w.log.events.length;
  await s.stop();
  let stopped = Number.POSITIVE_INFINITY;
  if (mark) {
    const next = await s.bash(`cat ${CODE}`);
    const at = w.log.events.find((e) => e.kind === 'tool.before' && e.session === s.id && e.data.call === next.id)?.log_pos;
    if (at === undefined) throw Error(`BLOCKED: the record holds no tool.before of the call the session made on ${w.alias} after its stop returned`);
    stopped = at;
  }
  const madeOf = (events: readonly Ev[]): Ev | undefined => events.slice(from).find((e) => e.kind === 'claim.made' && e.data.task_ref === task);
  if (!await w.log.until((events) => madeOf(events) !== undefined, 300_000)) {
    throw Error(`BLOCKED: the session's stop on ${w.alias} made no claim on ${task}: the record since holds ${[...new Set(w.log.events.slice(from).map((e) => e.kind))].join(', ') || 'nothing'}`);
  }
  const id = `claim:${madeOf(w.log.events)!.id}`;
  const verdicts = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'verdict.made' && (e.subject === id || e.data.claim === id));
  const runs = (events: readonly Ev[]): (Run & { ended: Ev | undefined })[] => events.filter((e) => e.kind === 'run.started' && e.data.claim === id).map((e) => {
    const ended = events.find((x) => x.kind === 'run.finished' && x.data.run === e.data.run);
    return { run: String(e.data.run), check: String(e.data.check), host: e.data.host, outcome: ended ? String(ended.data.outcome) : null, ended };
  });
  await w.log.until((events) => { const r = runs(events); return verdicts(events).length > 0 && r.every((x) => x.ended) && r.some((x) => x.check === CHECK); }, 900_000);
  await w.log.until((events) => { const v = verdicts(events).at(-1); return v !== undefined && runs(events).some((x) => x.check === CHECK && x.ended !== undefined && x.ended.log_pos < v.log_pos); }, 30_000);
  const all = verdicts(w.log.events);
  return { id, runs: runs(w.log.events).map((r) => ({ run: r.run, check: r.check, host: r.host, outcome: r.outcome })), verdicts: all, outcome: all.length ? String(all.at(-1)!.data.outcome) : null, stopped };
}
export const shownClaim = (c: Claim): string => `${c.id}: outcome ${c.outcome}; verdicts ${cut(JSON.stringify(c.verdicts.map((v) => [v.data.outcome, v.data.reasons])), 900)}; runs ${c.runs.map((r) => `${r.run} ${r.check} on ${String(r.host)} ${r.outcome ?? 'running'}`).join(', ') || 'none'}`;

/**
 * The criteria's "whose check exits 0 there": a run of the sample check for the claim, on the host, ended `passed`.
 * A claim with none isn't the scene the criterion describes (the check never ran there, or didn't exit 0): BLOCKED.
 */
export function exitedZeroThere(sc: Scene, c: Claim): void {
  if (!c.runs.some((r) => r.check === CHECK && r.host === sc.w.alias && r.outcome === 'passed')) {
    throw Error(`BLOCKED: no run of ${CHECK} for the claim ended passed on ${sc.w.alias}, so this isn't a claim whose check exits 0 there: ${sc.w.redact(shownClaim(c))}`);
  }
}

/** Every piece of text a verdict holds, wherever in its data: what the verdict names. */
export function said(verdict: Ev | undefined): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) Object.values(v as Line).forEach(walk);
  };
  walk(verdict?.data);
  return out;
}
/** The design's words for a check that can send a claim back and never pass it (Whose checks count). */
export const AGENTS_OWN = /agent[’']s own/i;

/** The proof (the issue's Proof line), rewritten each run under $TMPDIR/deep-3511-proof/, redacted. */
export function proof(w: World, name: string, value: unknown): void {
  const dir = join(tmpdir(), 'deep-3511-proof');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), w.redact(`${JSON.stringify(value, null, 2)}\n`));
}
