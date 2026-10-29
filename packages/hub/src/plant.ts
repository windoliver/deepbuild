// The planted wrong programs: a test selects one with DEEP_HUB_PLANT, the hub on its side and setup, the doctor and
// status on theirs, all through this one module, so a proof lane's twin (tests/acceptance/<issue>/twins) can lay a
// wrong program over this file alone. Only tests set the variable.
/** The planted wrong programs a test selects with DEEP_HUB_PLANT; only tests set it. */
export type Plant =
  | 'writer-from-payload' | 'unlink-before-lock' | 'accept-stops-at-emfile' | 'ends-binding' | 'git-in-hook-handler' | 'commit-on-event-loop'
  | 'parse-on-event-loop' | 'origin-from-payload' | 'no-run-values' | 'empty-cited' | 'ignores-unknown-field' | 'run-spawns-itself'
  | 'env-kills-by-port' | 'env-leases-port-again' | 'env-holds-lease-for-helper' | 'compose-default-project'
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
  | 'line-at-stop';
const PLANTS: readonly string[] = [
  'writer-from-payload', 'unlink-before-lock', 'accept-stops-at-emfile', 'ends-binding', 'git-in-hook-handler', 'commit-on-event-loop',
  'parse-on-event-loop', 'origin-from-payload', 'no-run-values', 'empty-cited', 'ignores-unknown-field', 'run-spawns-itself',
  'env-kills-by-port', 'env-leases-port-again', 'env-holds-lease-for-helper', 'compose-default-project',
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
];
export function plantOf(value: string | undefined): Plant | undefined {
  if (!value) return undefined;
  if (!PLANTS.includes(value)) throw Error(`DEEP_HUB_PLANT=${value} names no planted program`);
  return value as Plant;
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): the hub's variable. */
export const activePlant = (): string | undefined => process.env.DEEP_HUB_PLANT || undefined;
