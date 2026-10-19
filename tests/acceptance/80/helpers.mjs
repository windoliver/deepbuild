// Shared by the fast and live #80 acceptance tests. The spike is reached only through what it
// leaves in the repo: spikes/80/decision.json, the hook logs under spikes/80/logs/ and the
// throwaway hook scripts under spikes/80/hooks/ (see README.md for the layout). Each check below
// reads them and returns { problems, cited }: what doesn't hold, and the log lines a finding rests
// on, so a test can drop those lines and see the same check fail.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const spikeDir = join(root, 'spikes/80');
export const STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
export const SURFACES = ['claude-terminal', 'claude-desktop', 'codex-cli', 'codex-desktop'];
export const DESKTOP = ['claude-desktop', 'codex-desktop'];
export const PHASES = ['start', 'beat', 'reply', 'exit', 'answer', 'copied'];
export const VERDICT_WORD = /\b(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/;
export const RECORDING_TYPES = ['video/mp4', 'video/quicktime'];
export const CODEX_TIMEOUT_S = 45 * 60;
export const MARGIN_MS = 5_000; // the design's timing relations: a hold ends at least 5 s before its hook's timeout

// The issue's acceptance criteria, as of October 19. Each ID is the first 8 hex of the SHA-256 of
// its text; idOf recomputes it, so a typo here fails the shape test.
export const CRITERIA = {
  held: ['373518b6', 'A held stop with a reason reaches the agent in both apps'],
  wake: ['6231c088', 'An idle interactive Claude Code session, in the terminal and in the desktop app (never `claude -p`, which ends async hooks at teardown), wakes on an answer, or the fallback is documented with its delay'],
  typed: ['9492ec1f', 'A message typed mid-turn shows up as an ask at the next hook'],
  verdict: ['8c6cf36a', "The verdict line appears in both apps' chats"],
  window: ['1af2fb72', 'The spike records whether the Claude desktop app runs your Claude Code status line command and whether the Codex app writes token events with `rate_limits`; for an app that does neither, the decision says how its account gets a first window reading'],
  codexHold: ['014d1b64', "A Codex stop held by a hook whose timeout setup raised to 45 minutes continues with its reason after 45 minutes, in the CLI and in Codex Desktop; if Codex ends the hold sooner, the decision records when, and the slow lane's hold is set below it"],
  cap: ['9b528e55', "Nine send-backs in a row with no tool call between them show where Claude Code's cap on consecutive stop-hook continuations ends the turn, and the decision records the cap the done gate plans around"],
  codexApp: ['b11edf91', 'Codex Desktop: whether any entry in `~/.codex/hooks.json` fires on the tested app version is recorded; if none fires, Codex app sessions are watch-only: recorded from their transcripts, with verdicts and answers delivered on your next prompt'],
  budgets: ['119fc62b', 'Budgets, on the reference Mac in the local preflight, compared with the merge base: hook overhead at p95 is recorded in both desktop apps, and a held stop adds under 20 ms beyond its checks'],
  route: ['15c33f50', 'The spike records, for the terminal and each app, whether a line reached the chat while a 60 s tool call still ran, and whether anything fired before a session was deleted, each with the recording that shows the route or the version tested with none; #120 and #88 keep the criteria that need a route only where the decision names one'],
  configChange: ['661b1ddf', "The spike records whether Claude Code's ConfigChange hook fires, in the terminal and in the desktop app, when a Bash call's child process removes a hook entry from `~/.claude/settings.json`, with the recording or the version tested; the Claude Code adapter adds a ConfigChange entry only where the decision says it fires"],
};
export const id = (key) => `#80.${CRITERIA[key][0]}`;
export const idOf = (text) => createHash('sha256').update(text.trim().replace(/\s+/g, ' ').replace(/^- \[ \] /, '')).digest('hex').slice(0, 8);

// ------------------------------------------------------------------ loading the spike

// The decision record and every log it cites. A missing record is BLOCKED: nothing unrun passes.
export function loadSpike(dir = spikeDir) {
  const path = join(dir, 'decision.json');
  if (!existsSync(path)) assert.fail(`BLOCKED: the spike left no decision record at ${relative(root, path)}`);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  const logs = new Map();
  const logsDir = join(dir, 'logs');
  for (const name of existsSync(logsDir) ? readdirSync(logsDir).filter((file) => file.endsWith('.jsonl')) : []) {
    const log = `logs/${name}`;
    logs.set(log, readFileSync(join(logsDir, name), 'utf8').split('\n').map((raw, index) => {
      if (!raw.trim()) return null;
      try { return { ...JSON.parse(raw), $log: log, $index: index }; } catch { return { $log: log, $index: index, $unparsed: raw }; }
    }).filter(Boolean));
  }
  return { dir, record, logs };
}

// The same spike with some log lines removed: what a finding would rest on without its evidence.
export function without(spike, cited) {
  const gone = new Set(cited.map((line) => `${line.$log}:${line.$index}`));
  return { ...spike, logs: new Map([...spike.logs].map(([log, lines]) => [log, lines.filter((line) => !gone.has(`${log}:${line.$index}`))])) };
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonce = (value) => typeof value === 'string' && value.length >= 8;
const text = (value) => JSON.stringify(value ?? null);
const strings = (value) => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];

// Hook entries of a surface's installed config, Claude settings or Codex hooks.json, which share
// one shape: { hooks: { <Event>: [{ matcher?, hooks: [{ type, command, timeout?, async?, asyncRewake? }] }] } }.
export function hookEntries(config, event) {
  const map = config?.hooks && !Array.isArray(config.hooks) ? config.hooks : config ?? {};
  return (Array.isArray(map[event]) ? map[event] : []).flatMap((group) => Array.isArray(group?.hooks) ? group.hooks : []);
}
export function configCommands(config) {
  const map = config?.hooks && !Array.isArray(config.hooks) ? config.hooks : {};
  return [...Object.keys(map).flatMap((event) => hookEntries(config, event).map((entry) => entry.command)), config?.statusLine?.command].filter((command) => command !== undefined);
}
const ours = (entry) => typeof entry?.command === 'string' && entry.command.includes('spikes/80/hooks/') && !/deep-hook/.test(entry.command);

export function nearestRankP95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

export function recordingProblems(recording, where) {
  if (!recording || typeof recording !== 'object') return [`${where} names no recording`];
  const problems = [];
  if (!/^[0-9a-f]{64}$/.test(recording.sha256 ?? '')) problems.push(`${where}: a recording is named by its SHA-256, 64 lowercase hex: ${text(recording)}`);
  if (!Number.isSafeInteger(recording.bytes) || recording.bytes <= 0) problems.push(`${where}: a recording names its size in bytes: ${text(recording)}`);
  if (!RECORDING_TYPES.includes(recording.type)) problems.push(`${where}: a recording's type is one of ${RECORDING_TYPES.join(', ')}: ${text(recording)}`);
  return problems;
}

// Entries copied from a session's Claude desktop transcript, in a log of their own under logs/:
// on claude-desktop they stand in for a recording (owner decision, October 19), since the app
// renders its chat from that transcript. Codex Desktop findings keep their recordings.
export function transcriptLines(spike, f) {
  return typeof f?.transcript === 'string' ? (spike.logs.get(f.transcript) ?? []).filter((line) => line.session === f.session) : [];
}
export function transcriptProblems(spike, f, where) {
  if (typeof f?.transcript !== 'string' || !spike.logs.has(f.transcript)) return [`${where} names no transcript log under logs/: ${text(f?.transcript)}`];
  const lines = transcriptLines(spike, f);
  if (!lines.length) return [`${where}: ${f.transcript} has no entry copied from session ${f.session}`];
  return lines.filter((line) => line.phase !== 'copied' || line.surface !== 'claude-desktop' || !finite(line.at) || typeof line.event !== 'string' || !line.payload || typeof line.payload !== 'object')
    .map((line) => `${where}: ${f.transcript} line ${line.$index + 1} isn't an entry copied from the Claude desktop transcript (phase copied, surface claude-desktop, at, event, payload)`);
}
// What stands behind a desktop finding besides its hook log: a recording, or on claude-desktop a
// transcript in its place.
export function proofProblems(spike, f, where) {
  return f?.surface === 'claude-desktop' && f.recording === undefined ? transcriptProblems(spike, f, where) : recordingProblems(f?.recording, where);
}

// ------------------------------------------------------------------ one context per criterion

function context(spike, key) {
  const problems = [], cited = [];
  const entry = spike.record?.criteria?.[id(key)];
  const fail = (message) => { problems.push(message); return null; };
  if (!entry) fail(`the decision has no entry for ${id(key)}`);
  const cite = (...lines) => { for (const line of lines) if (line) cited.push(line); return lines[0]; };
  const findings = (surface, kind) => (Array.isArray(entry?.findings) ? entry.findings : []).filter((f) => f?.surface === surface && (kind === undefined || f.kind === kind));
  const finding = (surface, kind) => {
    const found = findings(surface, kind);
    return found.length === 1 ? found[0] : fail(`${id(key)} needs exactly one ${kind ? `${kind} ` : ''}finding on ${surface}, found ${found.length}`);
  };
  // The lines of one session in the log a finding cites, all from that finding's surface.
  const session = (f) => {
    const where = `${id(key)} on ${f.surface}`;
    if (typeof f.log !== 'string' || !spike.logs.has(f.log)) return fail(`${where} cites no hook log under logs/: ${text(f.log)}`), [];
    if (typeof f.session !== 'string' || !f.session) return fail(`${where} names no session`), [];
    const lines = spike.logs.get(f.log).filter((line) => line.session === f.session).sort((a, b) => a.at - b.at || a.$index - b.$index);
    if (!lines.length) fail(`${where}: ${f.log} has no line from session ${f.session}`);
    for (const line of lines) if (line.surface !== f.surface) fail(`${where}: ${f.log} line ${line.$index + 1} came from ${line.surface}, so it proves nothing about ${f.surface}`);
    return lines;
  };
  const config = (surface) => spike.record?.surfaces?.[surface]?.config;
  return { entry, problems, cited, fail, cite, findings, finding, session, config, spike };
}
const of = (lines, invocation, phase) => lines.find((line) => line.invocation === invocation && line.phase === phase);
const starts = (lines) => lines.filter((line) => line.phase === 'start');
const carrying = (lines, value) => lines.filter((line) => line.phase === 'start' && text(line.payload).includes(value));

// A Stop that a hook held and answered with decision: block, its reason carrying a nonce that
// nothing in the session saw before, and the agent's next hook payload carrying it.
function heldAndContinued(c, f, lines, { minHoldMs = 0 } = {}) {
  const where = `${f.surface} hold ${f.invocation}`;
  const start = of(lines, f.invocation, 'start');
  const reply = of(lines, f.invocation, 'reply');
  if (!start || start.event !== 'Stop') return c.fail(`${where}: no Stop hook started with that invocation in the log`);
  if (!reply || reply.reply?.decision !== 'block' || typeof reply.reply?.reason !== 'string') return c.fail(`${where}: the hook never answered with decision: block and a reason`);
  if (!nonce(reply.nonce) || !reply.reply.reason.includes(reply.nonce)) return c.fail(`${where}: the reason carries no nonce to follow`);
  if (reply.at - start.at < minHoldMs) return c.fail(`${where}: held ${reply.at - start.at} ms, under ${minHoldMs} ms`);
  const early = lines.filter((line) => line.at < reply.at && line !== reply && text(line.payload).includes(reply.nonce));
  if (early.length) return c.fail(`${where}: the nonce was in the session before the hold answered (line ${early[0].$index + 1}), so its arrival proves nothing`);
  const after = carrying(lines.filter((line) => line.at > reply.at), reply.nonce)[0];
  if (!after) return c.fail(`${where}: no later hook payload in the session carries the reason, so it never reached the agent`);
  return c.cite(start, reply, after);
}

// ------------------------------------------------------------------ the checks, one per criterion

export const checks = {
  held(spike) {
    const c = context(spike, 'held');
    for (const surface of DESKTOP) { const f = c.finding(surface); if (f) heldAndContinued(c, f, c.session(f)); }
    return c;
  },

  wake(spike) {
    const c = context(spike, 'wake');
    for (const surface of ['claude-terminal', 'claude-desktop']) {
      const f = c.finding(surface);
      if (!f) continue;
      const lines = c.session(f);
      if (surface === 'claude-terminal') {
        const argv = lines.find((line) => Array.isArray(line.agentArgv));
        if (!argv) c.fail('claude-terminal: no log line records the agent argv, so nothing shows the session was interactive');
        else if (argv.agentArgv.some((arg) => arg === '-p' || arg === '--print')) c.fail(`claude-terminal ran claude -p, which ends async hooks at teardown: ${text(argv.agentArgv)}`);
        else c.cite(argv);
      }
      if (f.result === 'woke') {
        if (!hookEntries(c.config(surface), 'Stop').some((entry) => entry.asyncRewake === true && ours(entry))) c.fail(`${surface}: the installed config has no asyncRewake Stop waiter from spikes/80/hooks/`);
        const start = of(lines, f.invocation, 'start');
        const exit = of(lines, f.invocation, 'exit');
        if (!start || start.event !== 'Stop') { c.fail(`${surface}: the waiter ${f.invocation} has no Stop start line`); continue; }
        if (!exit || exit.exit !== 2 || !nonce(exit.nonce) || !String(exit.stderr ?? '').includes(exit.nonce)) { c.fail(`${surface}: the waiter never exited 2 with the answer's nonce on stderr`); continue; }
        if (exit.at - start.at < 1000) c.fail(`${surface}: the waiter woke ${exit.at - start.at} ms after the stop, so the session was never idle`);
        if (lines.some((line) => line.at < exit.at && line !== exit && text(line.payload).includes(exit.nonce))) c.fail(`${surface}: the answer was in the session before the waiter delivered it`);
        // Claude Code starts the woken turn with a UserPromptSubmit whose prompt is its own
        // notification of the wake, carrying the waiter's whole stderr. That prompt is the wake, not
        // something typed; the agent must then carry the answer in a hook payload of its own.
        const stderr = String(exit.stderr).trim();
        const wake = (line) => line.phase === 'start' && line.event === 'UserPromptSubmit' && line.at >= exit.at && typeof line.payload?.prompt === 'string' && line.payload.prompt.includes(stderr);
        const notice = starts(lines).find(wake);
        const after = carrying(lines.filter((line) => line.at > exit.at), exit.nonce).find((line) => !wake(line));
        if (!after) { c.fail(`${surface}: no later hook payload carries the answer, so the session never woke on it`); continue; }
        const typed = starts(lines).find((line) => line.event === 'UserPromptSubmit' && line.at > start.at && line.at <= after.at && !wake(line));
        if (typed) c.fail(`${surface}: a prompt was typed (line ${typed.$index + 1}) before the session continued, so it didn't wake on its own`);
        c.cite(start, exit, notice, after);
      } else if (f.result === 'fallback') {
        const { route, delayMs } = f.fallback ?? {};
        if (typeof route !== 'string' || !finite(delayMs) || delayMs < 0) { c.fail(`${surface}: a fallback names its route and its delay in ms: ${text(f.fallback)}`); continue; }
        const answer = lines.find((line) => line.phase === 'answer' && nonce(line.nonce));
        if (!answer) { c.fail(`${surface}: the log never shows the answer becoming ready`); continue; }
        const delivered = lines.find((line) => line.event === route && line.phase === 'reply' && line.at >= answer.at && text(line.reply).includes(answer.nonce));
        if (!delivered) { c.fail(`${surface}: no ${route} reply delivered the answer`); continue; }
        if (Math.abs(delivered.at - answer.at - delayMs) > 1000) c.fail(`${surface}: the documented delay ${delayMs} ms isn't what the log shows, ${delivered.at - answer.at} ms`);
        const after = carrying(lines.filter((line) => line.at > delivered.at), answer.nonce)[0];
        if (!after) c.fail(`${surface}: no later hook payload carries the answer the fallback delivered`);
        c.cite(answer, delivered, after);
      } else c.fail(`${surface}: result is "woke" or "fallback": ${text(f.result)}`);
    }
    return c;
  },

  typed(spike) {
    const c = context(spike, 'typed');
    const f = c.finding('claude-desktop');
    if (!f) return c;
    const lines = c.session(f);
    const ask = lines.find((line) => line.invocation === f.invocation && line.ask);
    if (!ask || !nonce(ask.nonce) || !String(ask.ask.text ?? '').includes(ask.nonce)) return c.fail(`claude-desktop: no hook line of ${f.invocation} holds an ask whose text carries the typed nonce`), c;
    if (!finite(f.typedAt)) return c.fail('claude-desktop: the finding names when the message was typed (typedAt, epoch ms, read from the recording)'), c;
    // The ask is the one the next hook after the message was typed records, whichever event that
    // is: on Claude Code 2.1.303 a UserPromptSubmit carrying the typed text fires at once, inside the
    // running turn. Mid-turn means a tool call had started and was still running at that hook: its
    // PreToolUse has no PostToolUse yet and no Stop came between; the call then ends inside the
    // same turn.
    const tool = starts(lines).filter((line) => line.event === 'PreToolUse' && line.at < f.typedAt).at(-1);
    if (!tool) return c.fail('claude-desktop: no tool call was running when the message was typed, so it wasn\'t mid-turn'), c;
    const next = starts(lines).find((line) => line.at > f.typedAt);
    if (!next || next.invocation !== f.invocation) c.fail(`claude-desktop: the ask came at ${f.invocation}, not at the next hook after the message was typed (${next?.invocation})`);
    const ended = starts(lines).find((line) => ['PostToolUse', 'PostToolUseFailure', 'Stop'].includes(line.event) && line.at > tool.at && line.at < (next?.at ?? ask.at));
    if (ended) c.fail(`claude-desktop: the tool call or the turn ended (line ${ended.$index + 1}) before the hook that holds the ask, so the message wasn't typed mid-turn`);
    const callEnd = starts(lines).find((line) => ['PostToolUse', 'PostToolUseFailure'].includes(line.event) && line.at >= (next?.at ?? ask.at));
    const stop = starts(lines).find((line) => line.event === 'Stop' && line.at > tool.at);
    if (!callEnd || (stop && stop.at < callEnd.at)) c.fail('claude-desktop: the running tool call never ended inside the same turn after the ask');
    const early = lines.find((line) => line.at < ask.at && line.invocation !== ask.invocation && text(line.payload).includes(ask.nonce));
    if (early) c.fail(`claude-desktop: the typed nonce reached a hook before the ask (line ${early.$index + 1})`);
    c.cite(tool, ask, callEnd);
    return c;
  },

  verdict(spike) {
    const c = context(spike, 'verdict');
    for (const surface of DESKTOP) {
      const f = c.finding(surface);
      if (!f) continue;
      const reply = of(c.session(f), f.invocation, 'reply');
      const line = reply && nonce(reply.nonce) ? strings(reply.reply).find((value) => value.includes(reply.nonce)) : undefined;
      if (!line) { c.fail(`${surface}: no hook reply of ${f.invocation} carries a verdict line with its nonce`); continue; }
      if (/[\r\n]/.test(line) || !VERDICT_WORD.test(line)) c.fail(`${surface}: the verdict is one line naming one of the five verdicts: ${text(line)}`);
      if (surface === 'claude-desktop') {
        // The chat shows what the transcript holds: a hook_system_message entry with the same line,
        // saved at or after the reply, or the line never reached the chat.
        const shown = transcriptLines(spike, f).find((entry) => entry.phase === 'copied' && entry.event === 'hook_system_message' && entry.at >= reply.at
          && Date.parse(entry.payload?.timestamp) === entry.at && entry.payload?.attachment?.type === 'hook_system_message' && entry.payload.attachment.content === line);
        if (!shown) c.fail(`claude-desktop: no hook_system_message entry copied from the session's transcript (${text(f.transcript)}) holds the verdict line at or after its reply, so it never reached the chat`);
        else c.cite(shown);
        if (f.recording !== undefined) c.problems.push(...recordingProblems(f.recording, `${surface} verdict line`));
      } else c.problems.push(...recordingProblems(f.recording, `${surface} verdict line`));
      c.cite(reply);
    }
    return c;
  },

  window(spike) {
    const c = context(spike, 'window');
    const facts = [
      ['claude-desktop', 'statusLine', (line) => line.phase === 'start' && line.event === 'statusLine'],
      ['codex-desktop', 'rate_limits', (line) => line.phase === 'copied' && line.event === 'token_count' && /"rate_limits":\{/.test(text(line.payload))],
    ];
    for (const [surface, what, shows] of facts) {
      const f = c.finding(surface);
      if (!f) continue;
      if (typeof f.observed !== 'boolean') { c.fail(`${surface}: whether it ${what === 'statusLine' ? 'runs the status line command' : 'writes token events with rate_limits'} is recorded as observed: true or false`); continue; }
      if (f.observed) {
        // Every line that shows it is cited, so dropping them leaves nothing to show it.
        const shown = c.session(f).filter(shows);
        if (!shown.length) c.fail(`${surface}: observed ${what}, but its log shows none`);
        else c.cite(...shown);
      } else if (typeof c.entry?.decision?.firstWindowReading?.[surface] !== 'string' || !c.entry.decision.firstWindowReading[surface].trim()) {
        c.fail(`${surface} does neither, so the decision says how its account gets a first window reading (decision.firstWindowReading["${surface}"])`);
      }
    }
    return c;
  },

  codexHold(spike) {
    const c = context(spike, 'codexHold');
    const cuts = [];
    for (const surface of ['codex-cli', 'codex-desktop']) {
      const f = c.finding(surface);
      if (!f) continue;
      if (!hookEntries(c.config(surface), 'Stop').some((entry) => entry.timeout === CODEX_TIMEOUT_S && ours(entry))) c.fail(`${surface}: the installed hooks.json has no Stop entry from spikes/80/hooks/ with timeout ${CODEX_TIMEOUT_S}`);
      const lines = c.session(f);
      if (f.result === 'held') heldAndContinued(c, f, lines, { minHoldMs: CODEX_TIMEOUT_S * 1000 - MARGIN_MS });
      else if (f.result === 'cut') {
        const start = of(lines, f.invocation, 'start');
        const own = lines.filter((line) => line.invocation === f.invocation);
        if (!start || start.event !== 'Stop' || !finite(f.endedAfterMs) || f.endedAfterMs >= CODEX_TIMEOUT_S * 1000) { c.fail(`${surface}: a cut hold names its Stop and when Codex ended it, under 45 minutes: ${text(f)}`); continue; }
        if (of(lines, f.invocation, 'reply')) c.fail(`${surface}: the hold answered, so Codex didn't end it`);
        const last = own.at(-1).at - start.at;
        if (last > f.endedAfterMs || last < f.endedAfterMs - 60_000) c.fail(`${surface}: the hook's last line came ${last} ms after the stop, which doesn't show it ended at ${f.endedAfterMs} ms`);
        cuts.push(f.endedAfterMs);
        c.cite(start, own.at(-1));
      } else c.fail(`${surface}: result is "held" or "cut": ${text(f.result)}`);
    }
    const hold = c.entry?.decision?.slowLaneHoldMs;
    const ceiling = Math.min(CODEX_TIMEOUT_S * 1000, ...cuts) - MARGIN_MS;
    if (!finite(hold) || hold <= 0 || hold > ceiling) c.fail(`the slow lane's hold (decision.slowLaneHoldMs) ends at least 5 s before Codex ends a hold, at most ${ceiling} ms: ${text(hold)}`);
    return c;
  },

  cap(spike) {
    const c = context(spike, 'cap');
    const found = ['claude-terminal', 'claude-desktop'].flatMap((surface) => c.findings(surface));
    if (!found.length) c.fail('no Claude Code finding shows the cap');
    const observed = [];
    for (const f of found) {
      const all = c.session(f);
      const lines = starts(all);
      const first = lines.findIndex((line) => line.invocation === f.from);
      if (first < 0 || lines[first].event !== 'Stop') { c.fail(`${f.surface}: the run starts at no Stop named ${text(f.from)}`); continue; }
      const run = [];
      let next = first;
      for (; next < lines.length && lines[next].event === 'Stop'; next += 1) {
        const reply = of(all, lines[next].invocation, 'reply');
        if (reply?.reply?.decision !== 'block') break;
        run.push(lines[next], reply);
      }
      const blocks = run.length / 2;
      const after = lines[next];
      // The turn ended at the cap when the last block was followed by no stop or tool call of the
      // same turn; otherwise every send-back continued, which shows the cap only past nine.
      const endedByCap = !after || ['UserPromptSubmit', 'SessionEnd', 'SessionStart'].includes(after.event);
      if (!endedByCap && blocks < 9) { c.fail(`${f.surface}: after ${blocks} send-backs in a row the session went on (line ${after.$index + 1}, ${after.event}), so the run neither reached nine nor ended at the cap`); continue; }
      const continuations = endedByCap ? blocks - 1 : blocks;
      if (endedByCap && f.endedAfter !== continuations) c.fail(`${f.surface}: the turn ended after ${continuations} continuations, but the finding says ${text(f.endedAfter)}`);
      observed.push(continuations);
      c.cite(...run);
    }
    const cap = c.entry?.decision?.stopContinuationCap;
    if (!Number.isSafeInteger(cap) || cap < 1 || (observed.length && cap > Math.min(...observed))) c.fail(`the decision records the cap the done gate plans around (decision.stopContinuationCap), at most what was observed (${observed.join(', ')}): ${text(cap)}`);
    return c;
  },

  codexApp(spike) {
    const c = context(spike, 'codexApp');
    const f = c.finding('codex-desktop');
    if (!f) return c;
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) if (!hookEntries(c.config('codex-desktop'), event).some(ours)) c.fail(`codex-desktop: the installed hooks.json has no ${event} entry from spikes/80/hooks/, so "none fires" would prove nothing`);
    const fired = [...spike.logs.values()].flat().filter((line) => line.surface === 'codex-desktop' && line.phase === 'start'); // hook lines, not copied rollout entries
    if (typeof f.observed !== 'boolean') return c.fail('codex-desktop: whether any entry fires is recorded as observed: true or false'), c;
    if (f.observed && !fired.length) c.fail('codex-desktop: hooks are recorded as firing, but no log line came from Codex Desktop');
    if (!f.observed && fired.length) c.fail(`codex-desktop: hooks are recorded as not firing, but ${fired[0].$log} line ${fired[0].$index + 1} came from Codex Desktop`);
    if (!f.observed && c.entry?.decision?.codexDesktopMode !== 'watch-only') c.fail('codex-desktop: none fires, so the decision makes Codex app sessions watch-only (decision.codexDesktopMode)');
    if (f.observed) c.cite(...fired);
    return c;
  },

  budgets(spike) {
    const c = context(spike, 'budgets');
    const b = c.entry?.budgets ?? {};
    const m = b.machine ?? {};
    if (!(m.model === 'Mac15,7' && /M3 Pro/.test(m.chip ?? '') && m.cpus === 12 && m.memoryBytes === 36 * 2 ** 30 && m.power === 'AC' && m.lowPowerMode === false && m.thermal === 'nominal' && typeof m.macOS === 'string' && m.macOS))
      c.fail(`budgets count only on the reference Mac (Mac15,7, M3 Pro, 12 cores, 36 GB) on AC power, Low Power Mode off, thermal nominal, with its macOS build: ${text(m)}`);
    if (!/^[0-9a-f]{40}$/.test(b.baseCommit ?? '') || spawnSync('git', ['merge-base', '--is-ancestor', b.baseCommit, 'HEAD'], { cwd: root }).status !== 0) c.fail(`the budgets name the merge base they compare with, an ancestor of HEAD: ${text(b.baseCommit)}`);
    if (b.base === null ? !(typeof b.initialReason === 'string' && b.initialReason.trim()) : !DESKTOP.every((surface) => finite(b.base?.hookOverheadMs?.[surface]?.p95))) c.fail('the budgets compare with the merge base: its readings, or base: null with an initialReason when it has none');
    for (const surface of DESKTOP) {
      const overhead = b.hookOverheadMs?.[surface];
      const samples = overhead?.samples;
      if (!Array.isArray(samples) || samples.length < 20 || !samples.every((value) => finite(value) && value >= 0)) c.fail(`${surface}: hook overhead has at least 20 samples in ms: ${text(samples)}`);
      else if (!finite(overhead.p95) || Math.abs(overhead.p95 - nearestRankP95(samples)) > 0.01) c.fail(`${surface}: the recorded p95 ${overhead.p95} isn't the samples' nearest-rank p95 ${nearestRankP95(samples)}`);
      const held = b.heldStopExtraMs?.[surface];
      if (!Array.isArray(held) || held.length < 5) { c.fail(`${surface}: a held stop's added time has at least 5 samples, each citing its hold`); continue; }
      for (const sample of held) {
        const lines = spike.logs.get(sample?.log) ?? [];
        const start = lines.find((line) => line.invocation === sample?.invocation && line.phase === 'start' && line.event === 'Stop' && line.surface === surface);
        const reply = lines.find((line) => line.invocation === sample?.invocation && line.phase === 'reply' && line.reply?.decision === 'block');
        if (!start || !reply || !finite(reply.checkMs)) { c.fail(`${surface}: held-stop sample ${text(sample)} cites no held Stop with its checkMs in ${text(sample?.log)}`); continue; }
        if (!finite(sample.ms) || sample.ms >= 20) c.fail(`${surface}: a held stop added ${text(sample.ms)} ms beyond its checks, not under 20 ms`);
        else if (sample.ms < reply.at - start.at - reply.checkMs - 1) c.fail(`${surface}: sample ${sample.ms} ms is less than the hook's own ${reply.at - start.at - reply.checkMs} ms beyond its checks`);
        c.cite(start, reply);
      }
    }
    return c;
  },

  route(spike) {
    const c = context(spike, 'route');
    for (const surface of SURFACES) {
      const f = c.finding(surface, 'line');
      if (!f) continue;
      if (f.route === null) continue; // the version tested, from surfaces, says where none was found
      if (typeof f.route !== 'string' || !f.route.trim()) { c.fail(`${surface}: the line's route is named, or null when none was found: ${text(f.route)}`); continue; }
      const lines = c.session(f);
      const call = of(lines, f.call, 'start');
      const end = of(lines, f.callEnd, 'start');
      if (call?.event !== 'PreToolUse' || !['PostToolUse', 'PostToolUseFailure'].includes(end?.event) || end.at - call.at < 60_000) { c.fail(`${surface}: no tool call of at least 60 s between ${text(f.call)} and ${text(f.callEnd)}`); continue; }
      const line = lines.find((candidate) => candidate.invocation === f.invocation && nonce(candidate.nonce) && candidate.at > call.at && candidate.at < end.at);
      if (!line) c.fail(`${surface}: no line with a nonce was delivered while the call still ran`);
      c.problems.push(...proofProblems(spike, f, `${surface} line during a call`));
      c.cite(call, line);
    }
    for (const surface of DESKTOP) {
      // An archive counts only as an archive: the delete case stays open until the app's own delete
      // is tested on that surface.
      const found = c.findings(surface, 'delete');
      if (!found.some((f) => f.action === 'delete')) c.fail(`${surface}: no delete finding with action "delete"; an archive counts only as an archive, so the delete case stays open`);
      for (const f of found) {
        if (!['delete', 'archive'].includes(f.action)) { c.fail(`${surface}: a delete finding's action is "delete" or "archive": ${text(f.action)}`); continue; }
        const done = f.action === 'archive' ? 'archived' : 'deleted';
        if (!finite(f.deletedAt)) { c.fail(`${surface}: the ${f.action} finding names when the session was ${done} (deletedAt, epoch ms)`); continue; }
        if (f.route === null) {
          if (f.log !== undefined) { const ended = c.session(f).find((line) => line.event === 'SessionEnd'); if (ended) c.fail(`${surface}: nothing is recorded as firing before the ${f.action}, but line ${ended.$index + 1} is a SessionEnd`); }
          continue;
        }
        if (typeof f.route !== 'string' || !f.route.trim()) { c.fail(`${surface}: the ${f.action} route names the event that fired, or null: ${text(f.route)}`); continue; }
        const fired = starts(c.session(f)).find((line) => line.event === f.route && line.at <= f.deletedAt);
        if (!fired) c.fail(`${surface}: no ${f.route} hook fired in the session before it was ${done}`);
        c.problems.push(...proofProblems(spike, f, `${surface} ${f.action}`));
        c.cite(fired);
      }
    }
    return c;
  },

  configChange(spike) {
    const c = context(spike, 'configChange');
    for (const surface of ['claude-terminal', 'claude-desktop']) {
      const f = c.finding(surface);
      if (!f) continue;
      if (!hookEntries(c.config(surface), 'ConfigChange').some(ours)) c.fail(`${surface}: the installed settings have no ConfigChange entry from spikes/80/hooks/, so whether it fires wasn't tested`);
      if (typeof f.observed !== 'boolean') { c.fail(`${surface}: whether ConfigChange fired is recorded as observed: true or false`); continue; }
      const lines = starts(c.session(f));
      const call = lines.find((line) => line.invocation === f.call);
      if (call?.event !== 'PreToolUse' || call.payload?.tool_name !== 'Bash' || !text(call.payload?.tool_input).includes('settings.json')) { c.fail(`${surface}: ${text(f.call)} is no Bash call that edits settings.json`); continue; }
      const end = lines.find((line) => line.at > call.at && ['PostToolUse', 'PostToolUseFailure'].includes(line.event));
      const later = end && lines.find((line) => line.at > end.at);
      if (!end || !later) { c.fail(`${surface}: the log doesn't show the call ending and the session's hooks still firing after it`); continue; }
      const change = lines.find((line) => line.event === 'ConfigChange' && line.at >= call.at);
      if (f.observed && !(change && text(change.payload).includes('settings.json'))) c.fail(`${surface}: ConfigChange is recorded as firing, but no ConfigChange naming settings.json follows the call`);
      if (!f.observed && change) c.fail(`${surface}: ConfigChange is recorded as not firing, but line ${change.$index + 1} is one`);
      c.cite(call, end, later, f.observed ? change : null);
    }
    return c;
  },
};

// ------------------------------------------------------------------ files

// Every file git would list in this checkout, tracked or not, relative to the root.
export function repoFiles() {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.stdout.split('\0').filter(Boolean).filter((path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile());
}

export function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => item.isDirectory() ? walk(join(directory, item.name)) : [join(directory, item.name)]);
}

export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// An ISO base media file (MP4 or QuickTime) whose top-level boxes add up to the file, with a moov
// box among them: the design's intake rule for a recording that isn't cut short.
export function mediaProblems(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 16 || bytes.toString('latin1', 4, 8) !== 'ftyp') return [`${path} doesn't start with an ftyp box`];
  let offset = 0, moov = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return [`${path} ends inside a box header at byte ${offset}`];
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
    else if (size === 0) size = bytes.length - offset;
    if (size < 8 || offset + size > bytes.length) return [`${path}: box ${type} at byte ${offset} runs past the end, so the file is cut short`];
    if (type === 'moov') moov = true;
    offset += size;
  }
  return moov ? [] : [`${path} has no moov box`];
}
