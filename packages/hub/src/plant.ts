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
  // #1330's: a start with no approval on the record, a start with no sandbox, a sandbox setting that leaves the agent's
  // way out open, and a sandbox that cuts the hub's socket.
  | 'starts-without-approval' | 'starts-without-sandbox' | 'sandbox-way-out-open' | 'sandbox-cuts-hub-socket'
  // #46's: a poster that takes HEAD for the commit a verdict covers, and a recorder that marks every push it reads, or none.
  | 'posts-on-head' | 'unguarded-marks-every-push' | 'unguarded-marks-none'
  // #1537's: the hub holds the shipped message kind with no route into a gate run.
  | 'kind-without-route'
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
  // #1097's: a warn entry a call meets only through what couldn't be read of it decides as block.
  | 'unknown-as-block'
  // #84's defaults: an ask naming any effect covers all, every prompt counts whatever its `from`, the hub reads the
  // command line as text, and `--auto` needs no commit and holds no branch.
  | 'ask-covers-every-effect' | 'reads-every-from' | 'defaults-match-text' | 'auto-merge-unpinned'
  // #84's sorter: a proceed with no record, an ask keyed from a question's words, a send-back a question should hold,
  // a hold on every ask, a proceed that drops what fails, a task sent back naming no tool, a switch only recorded, a link to an agent's URL.
  | 'proceed-unrecorded' | 'keys-ask-from-words' | 'sends-back-held-stop' | 'holds-every-ask' | 'proceed-alone' | 'sends-back-no-tool' | 'records-switch-only' | 'link-from-agent-url'
  // #19's, which only its twins select: the proof lanes' wrong programs for tests no plant above reaches.
  // #580's: an environment that reuses a stale install, keeps a database, Redis, a web image or a mount across runs,
  // keeps installs in a store of its own, clones build output, or starts its stack at every claim; a pool that
  // reclaims a stack whose journey runs; and a sandbox that admits any loopback port.
  | 'env-reuses-stale-install' | 'env-keeps-database' | 'env-keeps-redis' | 'env-reuses-web-image' | 'env-keeps-db-mount' | 'env-second-install-store'
  | 'env-clones-next-whole' | 'env-starts-at-every-claim' | 'pool-reclaims-running' | 'sandbox-any-loopback'
  // #342's: a reaper that takes every volume a session's commands made, a teardown task closed on your word, a pool
  // that asks which stack to stop, and a reaper that takes a killed session's stack.
  | 'reap-session-volumes' | 'teardown-closes-on-word' | 'pool-asks-which-stack' | 'reap-on-kill'
  | 'bundle-raw-logs' | 'doctor-hides-token' | 'doctor-not-checked-first' | 'doctor-takes-any-flag' | 'stop-hold-wide-margin'
  | 'answer-skips-held-stop' | 'stop-hold-releases-without-answer' | 'both-routes' | 'stop-hold-polls' | 'no-stop-count' | 'stop-count-never-resets'
  | 'waiter-never-wakes' | 'waiter-outlives-session' | 'waiter-gives-up-at-600s' | 'waiter-per-stop' | 'waiter-under-stop-only' | 'waiter-polls' | 'waiter-checks-every-5s'
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
  // #1106's: the stand-in's value in the stack's environment too, an environment that loads by value, a filter that
  // substitutes on every allowed host, and the run's CA added to the login keychain.
  | 'standin-value-in-env' | 'env-loads-by-value' | 'standin-every-host' | 'run-ca-in-login-keychain'
  | 'runs-disk-bytes'
  // #325's: a stalled-claim rule that counts any new run as new evidence, and one that counts the stops a question holds.
  | 'new-run-is-evidence' | 'counts-waiting-stops'
  // #120's: the long-wait lines wait for the turn's stop, so a long turn of short calls shows none while it runs.
  | 'line-at-stop'
  // #1014's: the record's turn walk takes a subagent's stop as a turn end.
  | 'turn-closes-at-child-stop'
  // #67's: a workspace verdict's key of only the commit, document revisions, check digests, environment and tools.
  | 'state-left-out-of-key'
  // #340's: a note the waiter delivered recorded as nothing, and the app's words taken for yours with no request ID.
  | 'app-note-unrecorded' | 'app-note-as-person'
  // #340's: a brief with the requirements' text or only at startup, a queue line of the newest message alone,
  // continuations taken for yours or read by their look, every enqueue counted, and a brief sent 25 ms late.
  | 'brief-full-text' | 'brief-at-startup-only' | 'queue-shows-newest' | 'continuation-as-person' | 'continuation-by-likeness'
  | 'counts-every-enqueue' | 'slow-brief' | 'app-note-answers-authority'
  // #347's: a stager with no ceiling on files or seconds, and one that stages every shell call whose writes it can't predict.
  | 'stages-without-ceiling' | 'stages-unpredicted-writes'
  // #1156's: a stager that records its staging and runs the script with no copy behind it.
  | 'stages-without-copy'
  // #1294's: a stager whose class covers only untracked and ignored files, and one that copies on a clean tree too.
  | 'stages-untracked-only' | 'stages-clean-tree'
  // #356's: pages rewritten each run, a deleted line relearned, values copied, merging by name or never, everything read again, a
  // contradicted claim deleted.
  | 'rewrites' | 'resurrects' | 'copies-values' | 'merge-by-name' | 'never-merge' | 'rereads-all' | 'deletes-contradicted'
  // #824's: what the churn benchmark must catch, an entry kept per ended session, a listener per reloaded extension,
  // a socket, timer or child left per cycle, and a hub that can't give a full collection or its resident memory.
  | 'churn-keeps-ended-session' | 'churn-keeps-reload-listener' | 'churn-leaves-socket' | 'churn-leaves-timer' | 'churn-leaves-child'
  | 'churn-no-full-collection' | 'churn-no-resident-read'
  // #824's per-session reading: deep mcp loading the whole hub package, a waiter keeping its session's transcript, and
  // a platform that reads no process's memory.
  | 'mcp-loads-hub' | 'waiter-keeps-transcript' | 'sessions-no-memory-read'
  // #27's: deep_ask raised without its subject, so a repeated question reaches you.
  | 'repeat-reaches-you'
  // #823's: deep_wait reading its ask every 100 ms, and a stopping hub answering waiting calls as a success.
  | 'deep-wait-polls' | 'stop-answers-waiting'
  // #806's: a deep_show stamped with the payload's writer, and one that waits for the app instead of rendering headless.
  | 'deep-show-writer-from-payload' | 'deep-show-waits-for-app'
  // #139's: a deprecated JSON-RPC method served through its replacement with no notice.
  | 'silent-deprecated'
  // #875's: a fix check's base run counted as its proof whatever way it failed.
  | 'any-nonzero-base-exit'
  // #124's: deep_drive launching replicas without the replica lease.
  | 'deep-drive-no-lease'
  // #82's: a stop rule that drops the one send-back of every stop with no work in it, and one that reads every turn a
  // prompt began as an answer.
  | 'no-work-never-sent-back' | 'skips-prompt-turns'
  // #55's: an answer handed to paseo's plugin while deep-hook's waiter for the session is live, so it goes in twice.
  | 'paseo-delivers-beside-waiter'
  // #880's: a confirmation counted on a signature by the stored key over whatever the helper says it signed.
  | 'signature-covers-anything'
  // #909's: a hub that never checks its lock again once it holds it.
  | 'lock-never-rechecked'
  // #906's: an answer recorded delivered as the hub writes its reply, and one sent again without reading the session.
  | 'delivered-when-written' | 'sends-shown-again'
  // #31's: the gate's git gets the hub's whole environment, GIT_DIR and the rest included.
  | 'git-inherits-env'
  // #907's: a cpu.slot pool slow runs may fill, and loop facts that count background subagents but not commands.
  | 'fills-every-slot' | 'background-subagents-only'
  // #1015's: matched commands left as written, a Codex retry denied again, every cargo call leased, a release on the
  // parent's exit, memory pressure ignored, an exclusive GPU lease beside shared ones, and scripts/lease run directly.
  | 'runs-matched-as-written' | 'denies-every-retry' | 'leases-every-cargo' | 'releases-on-parent-exit' | 'ignores-memory-pressure'
  | 'exclusive-beside-shared' | 'lease-script-runs-directly'
  // #1017's: a store that links its folders in, a manifest that knows only Cargo and npm, the nearest key cloned, a clone
  // placed whatever the worktree's sources, a store sessions can write, and a reclaim that ignores open files.
  | 'product-symlinks' | 'product-hard-links' | 'products-cargo-npm-only' | 'nearest-key' | 'places-stale' | 'store-writable' | 'reclaims-open-worktree'
  // #874's: a declared surface never carried to the base checkout, a stand-in's hash never recorded, a stand-in built
  // where the part already starts, and a pass on a stand-in taken as proof.
  | 'stand-in-surface-dropped' | 'stand-in-unrecorded' | 'stand-in-always' | 'stand-in-pass-proves'
  // #965's: slow checks started at every green stop, every loop check held, a loop's claim or your words mid-turn
  // starting nothing, no grace window, no 30-minute cap or one timed from the first stop, and facts read only at stops.
  | 'starts-on-every-green-stop' | 'holds-every-loop-check' | 'holds-claim-stop-for-loop' | 'words-only-at-turn-start'
  | 'no-grace-window' | 'holds-background-without-limit' | 'caps-from-first-stop' | 'rechecks-facts-at-stops-only'
  // #992's: a reading that checks waiting before gone, an adapter that opens an ask from a Notification hook, and an
  // app that reads a session waiting on you as working.
  | 'waiting-first' | 'ask-from-notification' | 'waiting-as-working'
  // #997's: loop facts read as the merge base did, with no monitor's watch.
  | 'monitor-unread'
  // #322's: criteria read from the GitHub API alone, a comment author's role from the comment's text, every author a
  // collaborator, an app's membership taken as collaborator, an early claim judged on the repo spec alone, a lint that
  // only looks for a number, and a gate that runs no check before the definition locks.
  | 'criteria-from-github-api' | 'role-from-comment-text' | 'every-author-collaborator' | 'app-membership-as-collaborator'
  | 'spec-only-judges-early-claim' | 'lint-number-only' | 'lock-before-any-check'
  // #323's: open items' normalizer that drops numbers, a gate that reads only the PR body, one that counts every
  // resolved review thread as closed, and one that closes an item the agent marked completed in its task list.
  | 'normalizer-drops-numbers' | 'pr-body-only' | 'resolved-counts-closed' | 'completed-closes-item'
  // #669's: a command check's runner that reads a masked exit as a clean pass, a stop reply whose line says PASS with no
  // verdict behind it, and a status question sent on to the model.
  | 'runner-passes-masked-exit' | 'line-pass-without-verdict' | 'status-from-model'
  // #1016's: a jobserver of its own for each build, a pipe topped up while a build runs, and a runner's share that
  // ignores the builds running beside it.
  | 'jobserver-per-build' | 'refills-while-running' | 'share-ignores-running-build'
  // #65's: channels that take a channel's word, or cross one channel's trouble over to another.
  | 'trusts-channel-proof' | 'last-writer-wins' | 'live-buttons-after-answer' | 'closes-on-failed-send' | 'takes-turns-at-token' | 'reconnects-every-channel' | 'buttons-for-authority' | 'keeps-unpaired-key'
  // #1018's: runs keyed by session too, a key without the files runs read, a shared run counted once per claim that
  // reads it, a store of the newest result per key, and a carry that copies the source run's evidence whole.
  | 'keys-runs-by-session' | 'key-leaves-out-reads' | 'counts-shared-run-per-claim' | 'keeps-latest-result-per-key' | 'carry-copies-evidence';
const PLANTS: readonly string[] = [
  'posts-on-head', 'unguarded-marks-every-push', 'unguarded-marks-none',
  'writer-from-payload', 'unlink-before-lock', 'accept-stops-at-emfile', 'ends-binding', 'git-in-hook-handler', 'commit-on-event-loop',
  'parse-on-event-loop', 'origin-from-payload', 'no-run-values', 'empty-cited', 'ignores-unknown-field', 'run-spawns-itself',
  'env-kills-by-port', 'env-leases-port-again', 'env-holds-lease-for-helper', 'compose-default-project', 'env-clone-without-record',
  'env-reuses-stale-install', 'env-keeps-database', 'env-keeps-redis', 'env-reuses-web-image', 'env-keeps-db-mount', 'env-second-install-store',
  'env-clones-next-whole', 'env-starts-at-every-claim', 'pool-reclaims-running', 'sandbox-any-loopback',
  'reap-session-volumes', 'teardown-closes-on-word', 'pool-asks-which-stack', 'reap-on-kill',
  'stops-at-first-bad-line', 'remove-spool-after-normal', 'drops-post-tool-use', 'replay-appends-twice',
  'answer-on-peer-check', 'answer-on-token', 'answer-inside-session', 'skip-default-at-deadline',
  'evidence-checks-path-first', 'binds-first-stamp', 'unbound-reads-all', 'errors-without-actual', 'errors-unscrubbed', 'trusts-index',
  'adapter-decides', 'unknown-tool-read', 'unplaced-is-person', 'loop-from-origins', 'holds-stop-anyway', 'restores-at-session-start-only',
  'acts-on-peer-check', 'off-guards-watch-only', 'undo-reserializes', 'gates-before-approval', 'setup-writes-project-settings',
  'setup-last-duplicate-wins', 'setup-renames-over-link', 'undo-keeps-login-service', 'skipped-reads-ok', 'prompt-without-flag',
  'hooks-disable-user-only', 'stop-hold-no-margin', 'stop-hold-entry-only', 'not-checked-exits-0', 'status-exit-unmapped',
  'hooks-order-ours-first', 'log-raw-command',
  'matches-text', 'fail-closed-only-rules', 'installs-unchecked', 'trusts-hints', 'warn-as-block', 'unknown-as-block',
  'bundle-raw-logs', 'doctor-hides-token', 'doctor-not-checked-first', 'doctor-takes-any-flag', 'stop-hold-wide-margin',
  'answer-skips-held-stop', 'stop-hold-releases-without-answer', 'both-routes', 'stop-hold-polls', 'no-stop-count', 'stop-count-never-resets',
  'waiter-never-wakes', 'waiter-outlives-session', 'waiter-gives-up-at-600s', 'waiter-per-stop', 'waiter-under-stop-only', 'waiter-polls', 'waiter-checks-every-5s',
  'delivered-on-waiter-exit', 'wake-assumed', 'delivered-to-dead-waiter', 'routes-from-settings', 'routes-kept-across-sessions',
  'ended-answer-to-worktree', 'ended-answer-at-next-prompt',
  'proceed-covers-turn', 'holds-synced-only', 'hold-as-choice',
  'permission-always-allow', 'typed-saves-decision', 'decision-over-mode', 'decision-before-guard',
  'rule-without-reason', 'copies-no-standing-rules',
  'status-omits-commit', 'doctor-misses-hooks', 'on-stays-off',
  'first-prompt-always-task', 'midturn-always-task', 'hash-ids-only', 'hash-check-paths', 'role-from-text', 'claim-on-tool-calls',
  'runs-disk-bytes',
  'new-run-is-evidence', 'counts-waiting-stops',
  'line-at-stop',
  'turn-closes-at-child-stop',
  'state-left-out-of-key',
  'app-note-unrecorded', 'app-note-as-person',
  'brief-full-text', 'brief-at-startup-only', 'queue-shows-newest', 'continuation-as-person', 'continuation-by-likeness',
  'counts-every-enqueue', 'slow-brief', 'app-note-answers-authority',
  'stages-without-ceiling', 'stages-unpredicted-writes', 'stages-without-copy',
  'stages-untracked-only', 'stages-clean-tree',
  'rewrites', 'resurrects', 'copies-values', 'merge-by-name', 'never-merge', 'rereads-all', 'deletes-contradicted',
  'churn-keeps-ended-session', 'churn-keeps-reload-listener', 'churn-leaves-socket', 'churn-leaves-timer', 'churn-leaves-child',
  'churn-no-full-collection', 'churn-no-resident-read',
  'mcp-loads-hub', 'waiter-keeps-transcript', 'sessions-no-memory-read',
  'repeat-reaches-you',
  'deep-wait-polls', 'stop-answers-waiting',
  'deep-show-writer-from-payload', 'deep-show-waits-for-app',
  'silent-deprecated',
  'deep-drive-no-lease',
  'no-work-never-sent-back', 'skips-prompt-turns',
  'paseo-delivers-beside-waiter',
  'signature-covers-anything',
  'lock-never-rechecked',
  'delivered-when-written', 'sends-shown-again',
  'git-inherits-env', 'fills-every-slot', 'background-subagents-only',
  'runs-matched-as-written', 'denies-every-retry', 'leases-every-cargo', 'releases-on-parent-exit', 'ignores-memory-pressure',
  'exclusive-beside-shared', 'lease-script-runs-directly',
  'product-symlinks', 'product-hard-links', 'products-cargo-npm-only', 'nearest-key', 'places-stale', 'store-writable', 'reclaims-open-worktree',
  'any-nonzero-base-exit',
  'stand-in-surface-dropped', 'stand-in-unrecorded', 'stand-in-always', 'stand-in-pass-proves',
  'starts-on-every-green-stop', 'holds-every-loop-check', 'holds-claim-stop-for-loop', 'words-only-at-turn-start',
  'no-grace-window', 'holds-background-without-limit', 'caps-from-first-stop', 'rechecks-facts-at-stops-only', 'monitor-unread',
  'standin-value-in-env', 'env-loads-by-value', 'standin-every-host', 'run-ca-in-login-keychain',
  'waiting-first', 'ask-from-notification', 'waiting-as-working',
  'criteria-from-github-api', 'role-from-comment-text', 'every-author-collaborator', 'app-membership-as-collaborator',
  'spec-only-judges-early-claim', 'lint-number-only', 'lock-before-any-check',
  'normalizer-drops-numbers', 'pr-body-only', 'resolved-counts-closed', 'completed-closes-item',
  'runner-passes-masked-exit', 'line-pass-without-verdict', 'status-from-model',
  'jobserver-per-build', 'refills-while-running', 'share-ignores-running-build',
  'ask-covers-every-effect', 'reads-every-from', 'defaults-match-text', 'auto-merge-unpinned',
  'proceed-unrecorded', 'keys-ask-from-words', 'sends-back-held-stop', 'holds-every-ask', 'proceed-alone', 'sends-back-no-tool', 'records-switch-only', 'link-from-agent-url',
  'trusts-channel-proof', 'last-writer-wins', 'live-buttons-after-answer', 'closes-on-failed-send', 'takes-turns-at-token', 'reconnects-every-channel', 'buttons-for-authority', 'keeps-unpaired-key',
  'keys-runs-by-session', 'key-leaves-out-reads', 'counts-shared-run-per-claim', 'keeps-latest-result-per-key', 'carry-copies-evidence',
  'starts-without-approval', 'starts-without-sandbox', 'sandbox-way-out-open', 'sandbox-cuts-hub-socket',
  'kind-without-route',
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

/** #40's wrong program on the hub's side: an answer of a replaced session handed to the session that replaced it. Only tests set it. */
export const piAcceptsReplaced = (): boolean => process.env.DEEP_PI_PLANT === 'accepts-replaced';
