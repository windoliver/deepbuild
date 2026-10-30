// The planted wrong programs: a test selects one with DEEP_HUB_PLANT, the hub on its side and setup, the doctor and
// status on theirs, all through this one module, so a proof lane's twin (tests/acceptance/<issue>/twins) can lay a
// wrong program over this file alone. Only tests set the variable.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { close as closeInspector } from 'node:inspector';
import { createServer, type Server } from 'node:net';

/** The planted wrong programs a test selects with DEEP_HUB_PLANT; only tests set it. */
export type Plant =
  | 'writer-from-payload' | 'unlink-before-lock' | 'accept-stops-at-emfile' | 'ends-binding' | 'git-in-hook-handler' | 'commit-on-event-loop'
  | 'parse-on-event-loop' | 'origin-from-payload' | 'no-run-values' | 'empty-cited' | 'ignores-unknown-field' | 'run-spawns-itself'
  | 'env-kills-by-port' | 'env-leases-port-again' | 'env-holds-lease-for-helper' | 'compose-default-project' | 'env-clone-without-record'
  | 'stops-at-first-bad-line' | 'remove-spool-after-normal' | 'drops-post-tool-use' | 'replay-appends-twice'
  | 'answer-on-peer-check' | 'answer-on-token' | 'answer-inside-session' | 'skip-default-at-deadline'
  | 'evidence-checks-path-first' | 'binds-first-stamp' | 'unbound-reads-all' | 'errors-without-actual' | 'errors-unscrubbed' | 'trusts-index'
  | 'adapter-decides' | 'unknown-tool-read' | 'unplaced-is-person' | 'loop-from-origins' | 'holds-stop-anyway' | 'restores-at-session-start-only'
  | 'acts-on-peer-check' | 'off-guards-watch-only' | 'undo-reserializes' | 'gates-before-approval' | 'setup-writes-project-settings'
  | 'setup-last-duplicate-wins' | 'setup-renames-over-link' | 'undo-keeps-login-service' | 'skipped-reads-ok' | 'prompt-without-flag'
  | 'hooks-disable-user-only' | 'stop-hold-no-margin' | 'stop-hold-entry-only' | 'not-checked-exits-0' | 'status-exit-unmapped'
  | 'hooks-order-ours-first' | 'log-raw-command'
  | 'matches-text' | 'fail-closed-only-rules' | 'installs-unchecked' | 'trusts-hints' | 'warn-as-block'
  // #19's, which only its twins select: the proof lanes' wrong programs for tests no plant above reaches.
  | 'bundle-raw-logs' | 'doctor-hides-token' | 'doctor-not-checked-first' | 'doctor-takes-any-flag' | 'stop-hold-wide-margin'
  | 'answer-skips-held-stop' | 'stop-hold-releases-without-answer' | 'both-routes' | 'stop-hold-polls' | 'no-stop-count' | 'stop-count-never-resets'
  | 'waiter-never-wakes' | 'waiter-outlives-session' | 'waiter-gives-up-at-600s' | 'waiter-per-stop' | 'waiter-polls' | 'waiter-checks-every-5s'
  | 'delivered-on-waiter-exit' | 'wake-assumed' | 'delivered-to-dead-waiter' | 'routes-from-settings' | 'routes-kept-across-sessions'
  | 'ended-answer-to-worktree' | 'ended-answer-at-next-prompt'
  // #321's: a proceed that covers its turn's calls, holds for synced servers only, and holds filed as approving choices.
  | 'proceed-covers-turn' | 'holds-synced-only' | 'hold-as-choice'
  // #23's: the agent's "always allow" picked, typed words saved as a decision, a
  // decision over the permission mode or before the guards, a rule's answer without its reason, and no rule copied.
  | 'permission-always-allow' | 'typed-saves-decision' | 'decision-over-mode' | 'decision-before-guard'
  | 'rule-without-reason' | 'copies-no-standing-rules'
  // #668's: a status that leaves out a session's commits, a doctor that trusts setup's record, and a `deep on` that keeps the gates off.
  | 'status-omits-commit' | 'doctor-misses-hooks' | 'on-stays-off'
  // #303's: a task for every first prompt or mid-turn message, hashes blind to text or check bytes, a role read from
  // the text, a stop rule that reads every stop with tool calls as a claim, and a claim whose checks run the file on disk.
  | 'first-prompt-always-task' | 'midturn-always-task' | 'hash-ids-only' | 'hash-check-paths' | 'role-from-text' | 'claim-on-tool-calls'
  | 'runs-disk-bytes'
  // #120's: the long-wait lines wait for the turn's stop, so a long turn of short calls shows none while it runs.
  | 'line-at-stop'
  // #340's: a note the waiter delivered recorded as nothing, and the app's words taken for yours with no request ID.
  | 'app-note-unrecorded' | 'app-note-as-person'
  // #340's: a brief with the requirements' text or only at startup, a queue line of the newest message alone,
  // continuations taken for yours or read by their look, every enqueue counted, and a brief sent 25 ms late.
  | 'brief-full-text' | 'brief-at-startup-only' | 'queue-shows-newest' | 'continuation-as-person' | 'continuation-by-likeness'
  | 'counts-every-enqueue' | 'slow-brief' | 'app-note-answers-authority'
  // #347's: a stager with no ceiling on files or seconds, and one that stages every shell call whose writes it can't predict.
  | 'stages-without-ceiling' | 'stages-unpredicted-writes'
  // #356's: pages rewritten each run, a deleted line relearned, values copied, merging by name or never, everything read again, a
  // contradicted claim deleted.
  | 'rewrites' | 'resurrects' | 'copies-values' | 'merge-by-name' | 'never-merge' | 'rereads-all' | 'deletes-contradicted'
  // #824's: what the churn benchmark must catch, an entry kept per ended session, a listener per reloaded extension,
  // a socket, timer or child left per cycle, and a hub that can't give a full collection or its resident memory.
  | 'churn-keeps-ended-session' | 'churn-keeps-reload-listener' | 'churn-leaves-socket' | 'churn-leaves-timer' | 'churn-leaves-child'
  | 'churn-no-full-collection' | 'churn-no-resident-read';
const PLANTS: readonly string[] = [
  'writer-from-payload', 'unlink-before-lock', 'accept-stops-at-emfile', 'ends-binding', 'git-in-hook-handler', 'commit-on-event-loop',
  'parse-on-event-loop', 'origin-from-payload', 'no-run-values', 'empty-cited', 'ignores-unknown-field', 'run-spawns-itself',
  'env-kills-by-port', 'env-leases-port-again', 'env-holds-lease-for-helper', 'compose-default-project', 'env-clone-without-record',
  'stops-at-first-bad-line', 'remove-spool-after-normal', 'drops-post-tool-use', 'replay-appends-twice',
  'answer-on-peer-check', 'answer-on-token', 'answer-inside-session', 'skip-default-at-deadline',
  'evidence-checks-path-first', 'binds-first-stamp', 'unbound-reads-all', 'errors-without-actual', 'errors-unscrubbed', 'trusts-index',
  'adapter-decides', 'unknown-tool-read', 'unplaced-is-person', 'loop-from-origins', 'holds-stop-anyway', 'restores-at-session-start-only',
  'acts-on-peer-check', 'off-guards-watch-only', 'undo-reserializes', 'gates-before-approval', 'setup-writes-project-settings',
  'setup-last-duplicate-wins', 'setup-renames-over-link', 'undo-keeps-login-service', 'skipped-reads-ok', 'prompt-without-flag',
  'hooks-disable-user-only', 'stop-hold-no-margin', 'stop-hold-entry-only', 'not-checked-exits-0', 'status-exit-unmapped',
  'hooks-order-ours-first', 'log-raw-command',
  'matches-text', 'fail-closed-only-rules', 'installs-unchecked', 'trusts-hints', 'warn-as-block',
  'bundle-raw-logs', 'doctor-hides-token', 'doctor-not-checked-first', 'doctor-takes-any-flag', 'stop-hold-wide-margin',
  'answer-skips-held-stop', 'stop-hold-releases-without-answer', 'both-routes', 'stop-hold-polls', 'no-stop-count', 'stop-count-never-resets',
  'waiter-never-wakes', 'waiter-outlives-session', 'waiter-gives-up-at-600s', 'waiter-per-stop', 'waiter-polls', 'waiter-checks-every-5s',
  'delivered-on-waiter-exit', 'wake-assumed', 'delivered-to-dead-waiter', 'routes-from-settings', 'routes-kept-across-sessions',
  'ended-answer-to-worktree', 'ended-answer-at-next-prompt',
  'proceed-covers-turn', 'holds-synced-only', 'hold-as-choice',
  'permission-always-allow', 'typed-saves-decision', 'decision-over-mode', 'decision-before-guard',
  'rule-without-reason', 'copies-no-standing-rules',
  'status-omits-commit', 'doctor-misses-hooks', 'on-stays-off',
  'first-prompt-always-task', 'midturn-always-task', 'hash-ids-only', 'hash-check-paths', 'role-from-text', 'claim-on-tool-calls',
  'runs-disk-bytes',
  'line-at-stop',
  'app-note-unrecorded', 'app-note-as-person',
  'brief-full-text', 'brief-at-startup-only', 'queue-shows-newest', 'continuation-as-person', 'continuation-by-likeness',
  'counts-every-enqueue', 'slow-brief', 'app-note-answers-authority',
  'stages-without-ceiling', 'stages-unpredicted-writes',
  'rewrites', 'resurrects', 'copies-values', 'merge-by-name', 'never-merge', 'rereads-all', 'deletes-contradicted',
  'churn-keeps-ended-session', 'churn-keeps-reload-listener', 'churn-leaves-socket', 'churn-leaves-timer', 'churn-leaves-child',
  'churn-no-full-collection', 'churn-no-resident-read',
];
export function plantOf(value: string | undefined): Plant | undefined {
  if (!value) return undefined;
  if (!PLANTS.includes(value)) throw Error(`DEEP_HUB_PLANT=${value} names no planted program`);
  return value as Plant;
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): the hub's variable. */
export const activePlant = (): string | undefined => process.env.DEEP_HUB_PLANT || undefined;

// ---- #824's planted leaks: each holds what it leaves until the hub stops, so a run's children go with its hub.
const keptSessions = new Map<string, string>();
const reloads = new EventEmitter().setMaxListeners(0);
const leftSockets: Server[] = [];
const leftTimers: NodeJS.Timeout[] = [];
const leftChildren: ChildProcess[] = [];
/** 1 KiB no other value shares: 1 MB over 5,000 cycles is 200 bytes a cycle, so a short ID alone would stay under it. */
const kibibyte = (): string => randomBytes(512).toString('hex');

/** What a planted hub leaves behind as a session ends. */
export function plantedSessionEnd(plant: Plant | undefined, session: string): void {
  if (plant === 'churn-keeps-ended-session') keptSessions.set(session, kibibyte());
  if (plant === 'churn-leaves-socket') leftSockets.push(createServer().listen(0, '127.0.0.1').unref());
  if (plant === 'churn-leaves-timer') leftTimers.push(setInterval(() => undefined, 2 ** 30).unref());
  if (plant === 'churn-leaves-child') leftChildren.push(spawn('/bin/sleep', ['86400'], { stdio: 'ignore' }));
}
/** What a planted hub leaves behind as an extension reloads. */
export function plantedReload(plant: Plant | undefined): void {
  if (plant !== 'churn-keeps-reload-listener') return;
  const held = kibibyte();
  reloads.on('reload', () => held.length);
}
/** What a planted hub takes away at its start: the inspector that forces a collection, or its resident memory. */
export function plantedStart(plant: Plant | undefined): void {
  if (plant === 'churn-no-full-collection') closeInspector();
  if (plant === 'churn-no-resident-read') process.memoryUsage = (() => { throw Error('this platform reads no resident memory'); }) as unknown as typeof process.memoryUsage;
}
/** The hub stops: nothing a planted run left outlives it. */
export function plantedStop(): void {
  for (const server of leftSockets.splice(0)) server.close();
  for (const timer of leftTimers.splice(0)) clearInterval(timer);
  for (const child of leftChildren.splice(0)) child.kill();
}
