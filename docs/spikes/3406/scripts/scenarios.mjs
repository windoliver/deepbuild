// Throwaway #3406 spike scenarios: what each run's session is told, what its hooks post and when, and what the
// driver waits for. A plan entry is one action, claimed once by the first hook of its event: way `hook` posts from
// the hook while it still runs, `outlived` from a process the hook left behind (auth: the token line first), and
// `waiter` exits 2 with the words on stderr, as #25's waiter does. An entry marked `control` is no post of either way.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every hook event each version's program names, less the two whose hook replaces what Claude Code would do
// (WorktreeCreate, WorktreeRemove) and the one 2.1.308 does not know (PreSkillShellCommand).
const EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'Notification', 'UserPromptSubmit', 'UserPromptExpansion', 'SessionStart', 'SessionEnd', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'PermissionRequest', 'PermissionDenied', 'Setup', 'TeammateIdle', 'TaskCreated', 'TaskCompleted', 'Elicitation', 'ElicitationResult', 'ConfigChange', 'InstructionsLoaded', 'CwdChanged', 'FileChanged', 'DirectoryAdded', 'MessageDisplay'];
const quote = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;
// A session's settings: hook.mjs logs every event, and an extra entry on each actor's event does the run's plan.
// A session the driver starts finds its run folder in its environment; one opened by hand has it in the command.
export function settingsFor({ actors = {}, inbound, run, place }) {
  const command = (verb) => [process.execPath, join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hook.mjs'), verb, ...(run ? [run, place] : [])].map(quote).join(' ');
  const hooks = Object.fromEntries(EVENTS.map((event) => [event, [{ hooks: [{ type: 'command', command: command('log') }] }]]));
  for (const [event, entry] of Object.entries(actors)) hooks[event].push({ hooks: [{ type: 'command', command: command('act'), ...entry }] });
  return { env: { DISABLE_AUTOUPDATER: '1' }, ...(inbound ? { crossSessionInbound: inbound } : {}), hooks };
}

const READY = 'Reply with only the word ready.';
const ok = (nonce) => `Reply with only the word ok-${nonce}.`;
const action = (nonce, more) => { const tag = nonce(); return { id: 'a', on: 'Stop', idleMs: 4000, nonce: tag, text: ok(tag), ...more }; };
// The inbox address a run's own hooks last saw.
const addressOf = (run) => readFileSync(join(run, 'log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line).env?.socket).findLast(Boolean);
const AFTER = [{ posted: 'a', ms: 60_000 }, { hookAfter: 'a', ms: 20_000 }, { stops: 2, ms: 30_000 }, { wait: 6000 }, { screen: 'after the post' }];
const idle = (plan, more = {}) => ({ place: 'terminal', plan: [plan], actors: { Stop: { async: true, timeout: 120 } }, steps: [{ type: READY }, { stops: 1 }, ...AFTER], ...more });
const working = (plan) => ({ place: 'terminal', plan: [{ ...plan, on: 'PreToolUse', command: 'sleep 20' }], actors: { PreToolUse: { async: true, timeout: 120 } },
  steps: [{ type: 'Use the Bash tool to run exactly: sleep 20 . When it finishes, reply with only the word done.' }, { posted: 'a', ms: 90_000 }, { stops: 1, ms: 120_000 }, { quiet: 12_000, ms: 60_000 }, { screen: 'after the turn' }] });
const worker = (plan) => ({ place: 'headless', stream: true, plan: [plan], actors: { Stop: { async: true, timeout: 120 } },
  steps: [{ type: READY }, { stops: 1 }, { posted: 'a', ms: 60_000 }, { hookAfter: 'a', ms: 20_000 }, { stops: 2, ms: 30_000 }, { wait: 6000 }, { closeInput: true }, { exits: true, ms: 30_000 }] });
const print = (plan, actor, steps) => ({ place: 'headless', prompt: READY, plan: [plan], actors: { Stop: actor }, steps });
const long = (idleMs) => [{ type: READY }, { stops: 1 }, { posted: 'a', ms: idleMs + 120_000 }, { hookAfter: 'a', ms: 60_000 }, { stops: 2, ms: 60_000 }, { wait: 6000 }, { screen: 'after the post' }];

export const scenarios = {
  // An idle terminal session, one post, by each of the two ways.
  'idle-hook': ({ nonce }) => idle(action(nonce, { way: 'hook' })),
  'idle-outlived': ({ nonce }) => idle(action(nonce, { way: 'outlived', auth: true })),
  // The same post, then five and a half minutes more: what a held message does once its deadline (5 minutes unless set) has passed.
  'idle-hook-wait': ({ nonce }) => idle(action(nonce, { way: 'hook' }), { steps: [{ type: READY }, { stops: 1 }, ...AFTER, { wait: 330_000 }, { screen: 'after the deadline' }] }),
  // Controls, none of them one of the two ways: no auth line from a process left behind, a wrong token, and a
  // post whose sender exits as soon as its line is written.
  'control-no-auth': ({ nonce }) => idle(action(nonce, { way: 'outlived', auth: false, control: 'a process left behind, no auth line' })),
  'control-wrong-auth': ({ nonce }) => idle(action(nonce, { way: 'outlived', auth: 'wrong', control: 'a process left behind, an auth line with a wrong token' })),
  'control-exit-at-once': ({ nonce }) => idle(action(nonce, { way: 'outlived', auth: true, lingerMs: 0, control: 'a process left behind that exits as soon as its lines are written' })),
  // A post that carries a sender name, a message ID and a uuid of ours: what the transcript entry keeps of them.
  fields: ({ nonce, uuid }) => idle(action(nonce, { way: 'hook', extra: { from: 'deepbuild-app', msg_id: uuid(), uuid: uuid(), priority: 'next' } })),
  // The session the corpus keeps: three posts to one idle session, the line alone, the line with a sender name and
  // a message ID of ours, and the auth line first from a process left behind.
  corpus: ({ nonce, uuid }) => ({ place: 'terminal', actors: { Stop: { async: true, timeout: 120 } },
    plan: [action(nonce, { way: 'hook' }), action(nonce, { id: 'b', way: 'hook', extra: { from: 'deepbuild-app', msg_id: uuid() } }), action(nonce, { id: 'c', way: 'outlived', auth: true })],
    steps: [{ type: READY }, { stops: 1 }, { posted: 'a', ms: 60_000 }, { stops: 2, ms: 40_000 }, { posted: 'b', ms: 60_000 }, { stops: 3, ms: 40_000 }, { posted: 'c', ms: 60_000 }, { stops: 4, ms: 40_000 }, { wait: 6000 }] }),
  // A long idle: the post comes idleMs after the stop.
  'long-hook': ({ nonce, idleMs }) => idle(action(nonce, { way: 'hook', idleMs }), { actors: { Stop: { async: true, timeout: 7500 } }, steps: long(idleMs) }),
  'long-outlived': ({ nonce, idleMs }) => idle(action(nonce, { way: 'outlived', auth: true, idleMs }), { steps: long(idleMs) }),
  // A working terminal session: the post lands while a tool call runs.
  'working-hook': ({ nonce }) => working(action(nonce, { way: 'hook' })),
  'working-outlived': ({ nonce }) => working(action(nonce, { way: 'outlived', auth: true })),
  // The same, with a sender name and a message ID of ours on the line: what the mid-turn entry keeps of them.
  'working-fields': ({ nonce, uuid }) => working(action(nonce, { way: 'hook', extra: { from: 'deepbuild-app', msg_id: uuid() } })),
  // The agent asks a question and the post answers it; the last prompt is typed, for the model's own account (a reading).
  'ask-answer': ({ nonce }) => { const tag = nonce(); return idle({ id: 'a', on: 'Stop', idleMs: 4000, way: 'hook', nonce: tag, text: `Blue. (answer ${tag})` }, { steps: [
    { type: 'Ask me one short question: should the button be blue or green? Ask only that and end your turn. When I answer, reply with only the color I chose.' }, { stops: 1 }, { posted: 'a', ms: 60_000 }, { hookAfter: 'a', ms: 20_000 }, { stops: 2, ms: 40_000 }, { wait: 2000 },
    { type: 'In one sentence: who answered your question about the color, and how did that answer reach you?' }, { stops: 3, ms: 60_000 }, { wait: 4000 }] }); },
  // The same question, but the post only wakes the session: the answer rides on the woken turn's UserPromptSubmit
  // hook as context, the route the design already has for the next prompt.
  'wake-context': ({ nonce }) => { const tag = nonce(), answer = nonce(); return idle({ id: 'a', on: 'Stop', idleMs: 4000, way: 'hook', nonce: tag, text: `DeepBuild has an answer for you (wake ${tag}). It is in this turn's hook context.`, context: `Your answer, which you gave in DeepBuild's app: Blue. (answer ${answer})` }, { steps: [
    { type: 'Ask me one short question: should the button be blue or green? Ask only that and end your turn. When I answer, reply with only the color I chose.' }, { stops: 1 }, { posted: 'a', ms: 60_000 }, { hookAfter: 'a', ms: 20_000 }, { stops: 2, ms: 40_000 }, { wait: 2000 },
    { type: 'In one sentence: who answered your question about the color, and how did that answer reach you?' }, { stops: 3, ms: 60_000 }, { wait: 4000 }] }); },
  // The same question answered by the waiter, for what the model makes of the same words on #25's route.
  'ask-answer-waiter': ({ nonce }) => { const tag = nonce(); return idle({ id: 'a', on: 'Stop', idleMs: 4000, way: 'waiter', nonce: tag, text: `Blue. (answer ${tag})` }, { actors: { Stop: { asyncRewake: true, timeout: 120 } }, steps: [
    { type: 'Ask me one short question: should the button be blue or green? Ask only that and end your turn. When I answer, reply with only the color I chose.' }, { stops: 2, ms: 90_000 }, { wait: 2000 },
    { type: 'In one sentence: who answered your question about the color, and how did that answer reach you?' }, { stops: 3, ms: 60_000 }, { wait: 4000 }] }); },
  // claude -p, one prompt: a Stop hook that posts while the session waits for it, one that runs on in the
  // background, and a process left behind.
  'print-sync-hook': ({ nonce }) => print(action(nonce, { way: 'hook', idleMs: 1500 }), { timeout: 60 }, [{ exits: true, ms: 180_000 }, { wait: 2000 }]),
  'print-async-hook': ({ nonce }) => print(action(nonce, { way: 'hook' }), { async: true, timeout: 120 }, [{ exits: true, ms: 180_000 }, { wait: 12_000 }]),
  'print-outlived': ({ nonce }) => print(action(nonce, { way: 'outlived', auth: true }), { timeout: 60 }, [{ exits: true, ms: 180_000 }, { posted: 'a', ms: 40_000 }, { wait: 2000 }]),
  // claude -p kept open on a stream of input, idle between prompts.
  'worker-hook': ({ nonce }) => worker(action(nonce, { way: 'hook' })),
  'worker-outlived': ({ nonce }) => worker(action(nonce, { way: 'outlived', auth: true })),
  // 22 inbox posts and 22 waiter wakes, in turn, on one idle session: the time from each to the session's next hook.
  latency: ({ nonce }) => ({ place: 'terminal', actors: { Stop: { asyncRewake: true, timeout: 600 } },
    plan: Array.from({ length: 44 }, (_, at) => { const tag = nonce(); return { id: `${at % 2 ? 'w' : 'i'}${String(Math.floor(at / 2) + 1).padStart(2, '0')}`, on: 'Stop', way: at % 2 ? 'waiter' : 'hook', idleMs: 3000, lingerMs: 500, nonce: tag, text: ok(tag) }; }),
    steps: [{ type: READY }, { stops: 45, ms: 40 * 60_000 }, { wait: 6000 }] }),
  // 53 posts while one tool call runs (a node timer, since Claude Code refuses a bare `sleep 100`): the first 25 about
  // 0.3 s apart, the rest about 2.2 s, so the inbox's own rate limit (read from the program: 30 at once, then one every 2 s)
  // drops none and the 51st meets a full queue.
  burst: ({ nonce }) => ({ place: 'terminal', actors: { PreToolUse: { async: true, timeout: 300 } },
    plan: [{ id: 'b', on: 'PreToolUse', command: 'setTimeout', way: 'hook', lingerMs: 100, burst: Array.from({ length: 53 }, (_, at) => { const tag = nonce(); return { id: `b${String(at + 1).padStart(2, '0')}`, idleMs: at === 0 ? 4000 : at < 25 ? 200 : 2100, nonce: tag, text: `Note ${at + 1} of 53 (${tag}). No reply is needed for this note.` }; }) }],
    steps: [{ type: `Use the Bash tool to run exactly this command in the foreground and wait for it: node -e "setTimeout(() => console.log('waited'), 100000)" . When it finishes, reply with only the word done.` }, { posted: 'b53', ms: 200_000 }, { stops: 1, ms: 240_000 }, { quiet: 25_000, ms: 600_000 }, { screen: 'after the notes' },
      { type: 'Reply with only the highest note number you were sent.' }, { quiet: 15_000, ms: 120_000 }] }),
  // The token and the address across /clear, and across an exit and a resume while a process left behind still holds the old pair.
  clear: () => ({ place: 'terminal', plan: [], steps: [{ type: READY }, { stops: 1 }, { type: '/clear' }, { wait: 8000 }, { type: 'Reply with only the word after.' }, { stops: 2, ms: 60_000 }, { wait: 2000 }] }),
  resume: ({ nonce }) => ({ place: 'terminal', plan: [action(nonce, { way: 'outlived', auth: true, idleMs: 35_000 })], actors: { Stop: { timeout: 60 } },
    steps: [{ type: READY }, { stops: 1 }, { wait: 2000 }], resume: [{ posted: 'a', ms: 90_000 }, { wait: 6000 }, { type: 'Reply with only the word resumed.' }, { stops: 2, ms: 60_000 }, { wait: 2000 }] }),
  // Where the token is kept: a Stop hook that holds it reads the places a session writes and names the files that hold it.
  scan: () => ({ place: 'terminal', plan: [{ id: 's', on: 'Stop', way: 'scan' }], actors: { Stop: { timeout: 60 } }, steps: [{ type: 'Use the Bash tool to run exactly: echo hi . Then reply with only the word done.' }, { stops: 1 }, { wait: 3000 }] }),
  // One session's token on another session's inbox: `target` waits idle; `cross` posts into it with its own token.
  target: () => ({ place: 'terminal', plan: [], steps: [{ type: READY }, { stops: 1 }, { wait: 120_000 }, { screen: 'after the other session posted' }] }),
  cross: ({ nonce, target }) => ({ place: 'terminal', plan: [action(nonce, { way: 'outlived', auth: true, idleMs: 3000, targetRun: target, control: "a process left behind by another session, with that session's token" })], actors: { Stop: { timeout: 60 } }, steps: [{ type: READY }, { stops: 1 }, { posted: 'a', ms: 60_000 }, { wait: 3000 }] }),
  // A sibling's message, for the entry it leaves beside ours: this session messages the idle `target` session at its
  // address. hook.mjs denies a SendMessage to any other address, so no session outside the spike can get one.
  sibling: ({ nonce, target }) => { const to = `uds:${addressOf(target)}`; return { place: 'terminal', plan: [{ id: 'g', allowTo: to }],
    steps: [{ type: `Use the SendMessage tool once, with "to" set to exactly ${to} and the message set to exactly: ${ok(nonce())} Then reply with only the word sent.` }, { stops: 1, ms: 120_000 }, { wait: 3000 }, { screen: 'after sending' }] }; },
  // The desktop app, one prompt typed by hand: the first post starts a turn with a tool call, a second lands while
  // that call runs, and a third comes from a process left behind once the turn has ended.
  desktop: ({ nonce }) => { const first = nonce(); return { place: 'desktop', actors: { Stop: { async: true, timeout: 120 }, PreToolUse: { async: true, timeout: 120 } }, plan: [
    { id: 'a', on: 'Stop', way: 'hook', idleMs: 5000, nonce: first, text: `Use the Bash tool to run exactly: sleep 20 . When it finishes, reply with only the word ok-${first}.` },
    action(nonce, { id: 'b', on: 'PreToolUse', command: 'sleep 20', way: 'hook' }),
    action(nonce, { id: 'c', way: 'outlived', auth: true, idleMs: 5000 })] }; },
  // The desktop app with inbound messages held or refused: one post at each of the first two stops.
  'desktop-two': ({ nonce }) => ({ place: 'desktop', actors: { Stop: { async: true, timeout: 120 } }, plan: [action(nonce, { way: 'hook', idleMs: 5000 }), action(nonce, { id: 'c', way: 'outlived', auth: true, idleMs: 5000 })] }),
  // The desktop app quit and opened again while a process left behind holds the old address and token: it posts
  // 150 s after the first stop, and the second stop, in the reopened session, posts from its hook.
  'desktop-quit': ({ nonce }) => ({ place: 'desktop', actors: { Stop: { async: true, timeout: 120 } }, plan: [action(nonce, { way: 'outlived', auth: true, idleMs: 150_000 }), action(nonce, { id: 'b', way: 'hook', idleMs: 5000 })] }),
};
