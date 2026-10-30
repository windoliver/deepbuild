// The planted wrong programs: a test selects one with DEEP_HUB_PLANT, the hub on its side and setup, the doctor and
// status on theirs, all through this one module, so a proof lane's twin (tests/acceptance/<issue>/twins) can lay a
// wrong program over this file alone. Only tests set the variable.
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
  // #27's: deep_ask raised without its subject, so a repeated question reaches you.
  | 'repeat-reaches-you'
  // #823's: deep_wait reading its ask every 100 ms, and a stopping hub answering waiting calls as a success.
  | 'deep-wait-polls' | 'stop-answers-waiting';
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
  'repeat-reaches-you',
  'deep-wait-polls', 'stop-answers-waiting',
];
export function plantOf(value: string | undefined): Plant | undefined {
  if (!value) return undefined;
  if (!PLANTS.includes(value)) throw Error(`DEEP_HUB_PLANT=${value} names no planted program`);
  return value as Plant;
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): the hub's variable. */
export const activePlant = (): string | undefined => process.env.DEEP_HUB_PLANT || undefined;

/** #40's wrong program on the hub's side: an answer of a replaced session handed to the session that replaced it. Only tests set it. */
export const piAcceptsReplaced = (): boolean => true;
