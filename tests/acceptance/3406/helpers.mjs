// Shared by the #3406 acceptance tests. The spike is reached only through what it leaves in the
// repo: docs/spikes/3406/ (record.json, README.md, the throwaway hook scripts, the settings its
// sessions ran with and the hook logs) and the recordings it adds to the corpus (see README.md for
// the layout). Each check below reads them and returns { entry, problems, cited }: what doesn't
// hold, and the log lines a finding rests on, so a test can drop those lines and see the check fail.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, hash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactor } from '../../../scripts/corpus-redact.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
export const root = realpathSync(here('../../../'));
export const SPIKE = relative(here('../../../'), here('../../../docs/spikes/3406/'));
export const spikeDir = join(root, SPIKE);
const CORPUS = /^adapters\/corpus\/claude-code\/(\d+\.\d+\.\d+[\w.+-]*)\/([\w.-]+)$/;
const GITLEAKS_RULES = 'packages/evidence/gitleaks/gitleaks.toml';

export const STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
export const PLACES = ['terminal', 'desktop', 'editor', 'headless'];
export const MODES = ['asks', 'auto', 'skips'];
export const WAYS = ['hook', 'outlived'];
export const OUTCOMES = ['delivered', 'held', 'refused'];
export const STATES = [...OUTCOMES, 'no-route', 'no-mode', 'not-run'];
const NAMES = { terminal: 'the terminal', desktop: 'the desktop app', editor: 'the editor extension', headless: 'claude -p' };
// The payload's permission_mode for each mode the issue names: the one that asks and the one that
// skips prompts as adapters/claude-code.facts.json names them (launch.started), and auto.
const MODE_VALUES = { asks: ['default'], auto: ['auto'], skips: ['bypassPermissions'] };
// The hooks that open, run or end a turn; a session whose last one is a stop has no turn open.
const TURN_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure'];
const STOPS = ['Stop', 'StopFailure'];
const WATCH_MS = 5_000; // a post not delivered is watched this long, 2.5 times #25's 2 s wake budget
const IDLE_MS = 1_000; // as #80: a wake under a second after the stop shows no idle session
const SAMPLES = 20; // the criterion's 20 posts, and the design's 20 samples a side
const INBOX_NAMES = ['CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'crossSessionInbound', 'cc-socks'];

// The issue's acceptance criteria, as given to this job on November 24. Each ID is the first 8 hex
// of the SHA-256 of its text; idOf recomputes it, so a typo here fails the record test.
export const CRITERIA = {
  places: ['aee36c46', 'The report holds, for each of the four places and each mode tried, the recording that shows the post delivered, held or refused, or the version tested with no route'],
  latency: ['5fbeee00', "For an idle session that woke, the time from the post to its first hook is given at p50 and p95 over at least 20 posts, beside the waiter's on the same session"],
  quotes: ['79aefda5', "The report quotes what the model received and the transcript entry's origin fields, from a recording added to the corpus (#47) with secrets scrubbed. No recording holds the token's value, and the scrub's own check passes on each"],
  wakes: ['3e30684e', "It says whether a `claude -p` session and a desktop app session can be woken this way, each with its recording, since the waiter can't do the first and is untested in the second"],
  inbound: ['76bfb799', 'It says what a session with `crossSessionInbound` set to `hold` and to `refuse` did with the post, and that the route then reads absent'],
  decision: ['62e7fbf4', 'It states the token decision as a question with what each answer costs, and builds nothing that keeps the token'],
  issues: ['1fb06894', 'It ends with the issues it proposes, each with its depends-on, and builds none of them'],
};
export const id = (key) => `#3406.${CRITERIA[key][0]}`;
export const idOf = (text) => createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8);

// ------------------------------------------------------------------ loading the spike

// The record, the report and every hook log. A missing record is BLOCKED: nothing unrun passes.
export function loadSpike(dir = spikeDir) {
  const path = join(dir, 'record.json');
  if (!existsSync(path)) assert.fail(`BLOCKED: the spike left no record at ${SPIKE}/record.json`);
  let record;
  try { record = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { assert.fail(`INVALID: ${SPIKE}/record.json is not JSON: ${error.message}`); }
  if (!record || typeof record !== 'object' || Array.isArray(record)) assert.fail(`INVALID: ${SPIKE}/record.json is not a JSON object`);
  const logs = new Map();
  let order = 0;
  for (const name of existsSync(join(dir, 'logs')) ? readdirSync(join(dir, 'logs')).filter((file) => file.endsWith('.jsonl')).sort() : []) {
    const log = `logs/${name}`;
    logs.set(log, readFileSync(join(dir, log), 'utf8').split('\n').map((raw, index) => {
      if (!raw.trim()) return null;
      const at = { $log: log, $index: index, $order: order++ };
      try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? { ...value, ...at } : { ...at, $unparsed: true }; } catch { return { ...at, $unparsed: true }; }
    }).filter(Boolean));
  }
  const report = existsSync(join(dir, 'README.md')) ? readFileSync(join(dir, 'README.md'), 'utf8') : '';
  return { dir, record, logs, report };
}

// The same spike with some log lines removed: what a finding would rest on without its evidence.
export function without(spike, cited) {
  const gone = new Set(cited.map((line) => line.$order));
  return { ...spike, logs: new Map([...spike.logs].map(([log, lines]) => [log, lines.filter((line) => !gone.has(line.$order))])) };
}

export function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const words = (value) => typeof value === 'string' && value.trim().length > 0;
const isNonce = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,}$/.test(value);
const text = (value) => JSON.stringify(value ?? null);
const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => (key.startsWith('$') ? [] : strings(inner))) : []);
const sorted = (value) => (Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value);
const find = (value, key) => (!value || typeof value !== 'object' ? undefined : Object.hasOwn(value, key) ? value[key] : Object.values(value).map((inner) => find(inner, key)).find((found) => found !== undefined));
const place = (line) => `${line.$log} line ${line.$index + 1}`;
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const flat = (value) => String(value).replace(/^[ \t]*>[ \t]?/gm, '').replace(/\s+/g, ' ').trim();
/** Whether the report holds a text, read with white space collapsed and quote marks dropped. */
const reportHolds = (spike, value) => words(value) && flat(spike.report).includes(flat(value));
/** The report's lines that name an ID, as a word of its own. */
const reportLines = (spike, name) => spike.report.split('\n').filter((line) => RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`).test(line));

/** What a log line lacks of its shape (README.md, Log lines); empty when it is whole. */
export function lineProblems(line) {
  const where = place(line), problems = [];
  const need = (holds, what) => { if (!holds) problems.push(`${where}: ${what}`); };
  if (line.$unparsed) return [`${where} is not a JSON object`];
  need(finite(line.at), 'a line has its time (at, epoch ms)');
  need(PLACES.includes(line.place), `a line names its place, one of ${PLACES.join(', ')}`);
  for (const field of ['session', 'event', 'phase', ...(['start', 'post', 'exit'].includes(line.phase) ? ['invocation'] : [])]) need(words(line[field]), `a line has its ${field}`);
  const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (line.phase === 'start') {
    need(object(line.payload), "a start line holds the hook's payload");
    const env = object(line.env) ? line.env : {};
    need((env.socket === null || words(env.socket)) && Number.isInteger(env.tokenChars) && env.tokenChars >= 0 && (env.tokenChars > 0) === (typeof env.fingerprint === 'string'),
      'a start line records what the agent exported to its hook, env { socket, tokenChars, fingerprint }: the inbox address or null, and a fingerprint exactly when a token was exported');
  }
  if (line.phase === 'post') need(WAYS.includes(line.way) && isNonce(line.nonce) && typeof line.wrote === 'boolean' && typeof line.auth === 'boolean', 'a post line holds way, nonce, wrote and auth');
  if (line.phase === 'exit') need(line.exit === null || Number.isInteger(line.exit), "an exit line holds the hook's exit code (exit)");
  if (line.phase === 'copied') need(object(line.payload) && (typeof line.payload.timestamp !== 'string' || Date.parse(line.payload.timestamp) === line.at), 'a copied line holds the transcript entry, and its time is the entry\'s own timestamp');
  return problems;
}

/** Every line a session's hooks logged and every entry copied from its transcript, oldest first. */
function sessionLines(spike, session) {
  return [...spike.logs.values()].flat().filter((line) => line.session === session && finite(line.at)).sort((a, b) => a.at - b.at || a.$order - b.$order);
}
const carries = (line, nonce) => (line.phase === 'start' || line.phase === 'copied') && text(line.payload).includes(nonce);
const turnEvents = (lines, at) => lines.filter((line) => line.phase === 'start' && TURN_EVENTS.includes(line.event) && line.at <= at);

// Hook entries of a settings file: { hooks: { <Event>: [{ matcher?, hooks: [{ type, command, async?, asyncRewake? }] }] } }.
function hookEntries(settings, event) {
  const groups = settings?.hooks && typeof settings.hooks === 'object' ? settings.hooks[event] : undefined;
  return (Array.isArray(groups) ? groups : []).flatMap((group) => (Array.isArray(group?.hooks) ? group.hooks : []));
}
const hookCommands = (settings) => Object.keys(settings?.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}).flatMap((event) => hookEntries(settings, event).map((entry) => String(entry?.command)));

function nearestRank(samples, share) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(share * sorted.length) - 1];
}

// ------------------------------------------------------------------ what a session's log shows

const memo = new WeakMap();
const once = (spike, key, make) => {
  if (!memo.has(spike)) memo.set(spike, new Map());
  const made = memo.get(spike);
  if (!made.has(key)) made.set(key, make());
  return made.get(key);
};

/**
 * A session the record rests on: its lines come from the place the record gives it, entries copied
 * from its transcript name the version it ran, its place shows (the agent's argv in the terminal
 * and for claude -p, the transcript's entrypoint in an app), and the settings it ran with wire only
 * the spike's throwaway hooks, for every hook event its log holds.
 */
export function sessionEvidence(spike, session) {
  return once(spike, `session ${session}`, () => {
    const problems = [], cited = [];
    const info = spike.record?.sessions?.[session];
    const lines = typeof session === 'string' ? sessionLines(spike, session) : [];
    const where = `session ${session}`;
    if (!info || typeof info !== 'object') return { problems: [`${where} is not in the record's sessions`], cited, lines, info: null, settings: null };
    if (!lines.length) return { problems: [`${where}: no log under ${SPIKE}/logs/ holds a line from it`], cited, lines, info, settings: null };
    if (!PLACES.includes(info.place)) problems.push(`${where}: its place is one of ${PLACES.join(', ')}: ${text(info.place)}`);
    for (const line of lines) if (line.place !== info.place) { problems.push(`${where}: ${place(line)} came from ${text(line.place)}, so it proves nothing about ${NAMES[info.place]}`); break; }
    const versions = lines.filter((line) => line.phase === 'copied' && typeof line.payload?.version === 'string');
    if (!versions.length) problems.push(`${where}: no entry copied from its transcript names the Claude Code version it ran`);
    else if (versions.some((line) => line.payload.version !== info.version)) problems.push(`${where}: its transcript ran ${[...new Set(versions.map((line) => line.payload.version))].join(', ')}, the record says ${text(info.version)}`);
    else cited.push(versions[0]);
    const argvs = lines.filter((line) => line.phase === 'start' && Array.isArray(line.agentArgv));
    const print = (line) => line.agentArgv.some((arg) => arg === '-p' || arg === '--print');
    const entrypoints = lines.filter((line) => line.phase === 'copied' && typeof line.payload?.entrypoint === 'string');
    const inApp = (line) => /desktop/i.test(line.payload.entrypoint);
    if (info.place === 'terminal' || info.place === 'headless') {
      if (!argvs.length) problems.push(`${where}: no hook line records the agent's argv (agentArgv), so nothing shows ${info.place === 'headless' ? 'it ran claude -p' : 'it was interactive'}`);
      else if (info.place === 'terminal' && argvs.some(print)) problems.push(`${where} ran claude -p, so it is no terminal session: ${text(argvs.find(print).agentArgv)}`);
      else if (info.place === 'headless' && !argvs.every(print)) problems.push(`${where} ran without -p, so it is no claude -p session: ${text(argvs.find((line) => !print(line)).agentArgv)}`);
      else cited.push(argvs[0]);
    } else {
      const shown = entrypoints.find((line) => (info.place === 'desktop' ? inApp(line) : !inApp(line) && line.payload.entrypoint !== 'cli'));
      if (!shown) problems.push(`${where}: no entry copied from its transcript has ${info.place === 'desktop' ? "the desktop app's entrypoint" : "an entrypoint that is neither the terminal's nor the desktop app's"}, so nothing shows it ran in ${NAMES[info.place]}`);
      else cited.push(shown);
      if (!/\d/.test(String(info.appVersion ?? ''))) problems.push(`${where}: a ${info.place} session names its app's version (appVersion)`);
    }
    let settings = null;
    if (typeof info.settings !== 'string' || !/^settings\/[\w.-]+\.json$/.test(info.settings) || !existsSync(join(spike.dir, info.settings))) problems.push(`${where}: its settings are a file under ${SPIKE}/settings/: ${text(info.settings)}`);
    else {
      try { settings = JSON.parse(readFileSync(join(spike.dir, info.settings), 'utf8')); } catch { problems.push(`${where}: ${info.settings} is not JSON`); }
      const hooks = Array.isArray(spike.record.hooks) ? spike.record.hooks : [];
      const commands = hookCommands(settings);
      if (settings && !commands.length) problems.push(`${where}: ${info.settings} wires no hook`);
      for (const command of commands) if (/deep-hook/.test(command) || !hooks.some((hook) => typeof hook === 'string' && command.includes(hook))) problems.push(`${where}: ${info.settings} runs ${command}, which is none of the spike's throwaway hook scripts`);
      for (const event of new Set(lines.filter((line) => line.phase === 'start').map((line) => line.event))) if (settings && !hookEntries(settings, event).length) problems.push(`${where}: its log holds a ${event} hook that ${info.settings} doesn't wire, so those aren't the settings it ran with`);
    }
    return { problems, cited, lines, info, settings };
  });
}

/**
 * One post and what became of it, as the session's own log shows. Delivered: a later hook payload
 * or transcript entry of the session carries its nonce, and none did before. Held or refused: none
 * ever does, the log runs on at least 5 s or to the session's end, and a logged line holds the text
 * the record says shows it. No route: the agent exported no inbox to post to, or no write got through.
 */
function postEvidence(spike, post) {
  return once(spike, `post ${post?.id}`, () => {
    const problems = [], cited = [];
    const where = `post ${post.id}`;
    const fail = (message) => { problems.push(`${where}: ${message}`); };
    const s = sessionEvidence(spike, post.session);
    problems.push(...s.problems.map((problem) => `${where}: ${problem}`));
    cited.push(...s.cited);
    if (!s.info || !s.lines.length) return { problems, cited };
    if (s.info.place !== post.place) fail(`its session ran in ${NAMES[s.info.place]}, not ${NAMES[post.place]}`);
    const inbound = find(s.settings, 'crossSessionInbound');
    if (post.inbound === undefined && ['hold', 'refuse'].includes(inbound)) fail(`its session's settings set crossSessionInbound to ${inbound}, so it doesn't show the place and mode alone`);
    if (post.inbound !== undefined && inbound !== post.inbound) fail(`its session's settings (${s.info?.settings}) don't set crossSessionInbound to ${post.inbound}: ${text(inbound)}`);
    const begun = s.lines.filter((line) => line.phase === 'start');
    const posted = s.lines.filter((line) => line.phase === 'post' && (post.way === null || line.way === post.way));

    if (post.outcome === 'no-route') {
      const wrote = posted.find((line) => line.wrote === true);
      const none = begun.length > 0 && begun.every((line) => line.env && line.env.socket === null);
      const keyless = post.way === 'outlived' && begun.length > 0 && begun.every((line) => line.env && line.env.tokenChars === 0);
      if (!begun.length) fail('no hook of its session started, so nothing shows what the agent exported');
      else if (wrote) fail(`is recorded as no route, but ${place(wrote)} wrote to the inbox`);
      else if (!none && !keyless && !posted.length) fail('is recorded as no route, but its hooks were given an inbox address and no post was tried');
      else cited.push(...(none || keyless ? begun : posted));
      return { problems, cited };
    }

    const found = s.lines.filter((line) => line.phase === 'post' && line.nonce === post.nonce);
    if (!isNonce(post.nonce) || found.length !== 1) return fail(`its session's log holds ${found.length} post lines with its nonce ${text(post.nonce)}; it rests on exactly one`), { problems, cited };
    const [sent] = found;
    cited.push(sent);
    if (sent.way !== post.way) fail(`${place(sent)} posted by way ${text(sent.way)}, not ${post.way}`);
    const exits = s.lines.filter((line) => line.phase === 'exit' && line.invocation === sent.invocation);
    if (post.way === 'hook') {
      if (exits.some((line) => line.at < sent.at)) fail(`its hook had exited before ${place(sent)}, so it wasn't posted from a hook still running`);
      if (sent.auth !== false) fail(`${place(sent)} sent the auth line; a hook still running posts the line alone`);
    } else {
      const exit = exits.find((line) => line.at <= sent.at);
      if (!exit) fail(`no exit line of its hook comes before ${place(sent)}, so nothing shows the process outlived its hook`);
      else cited.push(exit);
      if (sent.auth !== true) fail(`${place(sent)} sent no auth line; a process that outlived its hook sends the token first`);
    }
    const moded = begun.filter((line) => line.at <= sent.at && typeof line.payload?.permission_mode === 'string');
    const mode = moded.findLast((line) => line.invocation === sent.invocation) ?? moded.at(-1);
    if (!mode) fail('no hook payload at or before it names the session\'s permission mode');
    else if (!MODE_VALUES[post.mode]?.includes(mode.payload.permission_mode)) fail(`${place(mode)} has permission_mode ${text(mode.payload.permission_mode)}, which is not the mode that ${post.mode === 'auto' ? 'is auto' : post.mode} (${MODE_VALUES[post.mode]?.join(', ')})`);
    else cited.push(mode);

    const carried = s.lines.filter((line) => carries(line, post.nonce));
    const early = carried.find((line) => line.at < sent.at);
    if (early) fail(`${place(early)} carries its nonce before the post, so its arrival proves nothing`);
    const after = carried.find((line) => line.at >= sent.at);
    if (post.outcome === 'delivered') {
      if (sent.wrote !== true) fail(`${place(sent)} wrote nothing to the inbox`);
      if (!after) fail('is recorded as delivered, but no later hook payload or transcript entry of its session carries its nonce');
      else cited.push(after);
      return { problems, cited };
    }
    if (after) fail(`is recorded as ${post.outcome}, but ${place(after)} (${after.event}) carries its nonce: the session received it`);
    if (post.outcome === 'held' && sent.wrote !== true) fail(`${place(sent)} wrote nothing to the inbox, so nothing was held`);
    // Watched long enough, or over: the session's last hook is its SessionEnd, before the post or after.
    const watched = s.lines.find((line) => line.at >= sent.at + WATCH_MS) ?? (begun.at(-1)?.event === 'SessionEnd' ? begun.at(-1) : undefined);
    if (!watched) fail(`its session's log ends under ${WATCH_MS / 1000} s after the post with no SessionEnd, too soon to show nothing arrived`);
    else cited.push(watched);
    const shown = typeof post.shown === 'string' && post.shown.length >= 4 && !post.shown.includes(post.nonce) && !post.nonce.includes(post.shown)
      ? s.lines.find((line) => line.at >= sent.at && strings(line).some((value) => value.includes(post.shown))) : undefined;
    if (!shown) fail(`names no text (shown) that a line of its session's log holds at or after the post, so nothing shows it was ${post.outcome}: ${text(post.shown)}`);
    else cited.push(shown);
    return { problems, cited };
  });
}

/** Whether the session had stopped, with no turn open, when a post or a waiter's exit came. */
const stopBefore = (lines, at) => {
  const last = turnEvents(lines, at).at(-1);
  return last && STOPS.includes(last.event) ? last : null;
};
/** A prompt someone typed between a post and the line that first carries its nonce. */
const typedBetween = (lines, from, to, nonce) => lines.find((line) => line.phase === 'start' && line.event === 'UserPromptSubmit' && line.at >= from && line.at <= to && !text(line.payload).includes(nonce));

// ------------------------------------------------------------------ the tree: what this change builds

/** The commit the spike ran on: named in full, and an ancestor of HEAD. */
export function baseProblems(record) {
  if (!/^[0-9a-f]{40}$/.test(record?.baseCommit ?? '')) return [`the record names the base commit the spike ran on (baseCommit, 40 hex): ${text(record?.baseCommit)}`];
  return git('merge-base', '--is-ancestor', record.baseCommit, 'HEAD').status === 0 ? [] : [`the record's base commit ${record.baseCommit} is not an ancestor of HEAD`];
}

/** The files this change adds or edits, against its merge base with origin/main, new files included. */
function changedFiles() {
  const base = git('merge-base', 'HEAD', 'origin/main');
  if (base.error || base.status !== 0) return { blocked: 'BLOCKED: git finds no merge base of HEAD with origin/main, so what this change builds can\'t be read (git fetch origin main)' };
  const list = (result) => (result.status === 0 ? result.stdout.split('\0').filter(Boolean) : null);
  const edited = list(git('diff', '--name-only', '-z', base.stdout.trim(), '--')), added = list(git('ls-files', '-z', '--others', '--exclude-standard'));
  if (!edited || !added) return { blocked: 'BLOCKED: git could not list what this change edits' };
  return { files: [...new Set([...edited, ...added])].filter((path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile()) };
}
const outside = (path) => !/^(?:tests|docs|adapters\/corpus)\//.test(path);
const product = (path) => /^(?:packages|crates)\//.test(path) || (path.startsWith('adapters/') && outside(path));
const naming = (files, names) => files.filter((path) => statSync(join(root, path)).size < 4_000_000).flatMap((path) => {
  const body = readFileSync(join(root, path), 'utf8');
  const named = names.filter((name) => body.includes(name));
  return named.length ? [`${path} (${named.join(', ')})`] : [];
});

// ------------------------------------------------------------------ recordings: the token and the scrub

/** The spike's recordings: its hook logs and each corpus entry it added; and its other files. */
export function recordingFiles(spike) {
  const entries = (Array.isArray(spike.record.corpus) ? spike.record.corpus : []).filter((entry) => typeof entry === 'string' && CORPUS.test(entry) && existsSync(join(root, entry)));
  const all = existsSync(spike.dir) ? walk(spike.dir) : [];
  const logs = all.filter((path) => relative(spike.dir, path).startsWith('logs/'));
  return { entries, logs, corpus: entries.flatMap((entry) => walk(join(root, entry))), rest: all.filter((path) => !logs.includes(path)) };
}

const VALUE = /^[A-Za-z0-9_+/=.~-]{12,}$/;
const PLACEHOLDER = /redact|scrub|remov|omit|elid|hidden|placeholder/i;
const valued = (value) => VALUE.test(value) && !PLACEHOLDER.test(value);

/**
 * "No recording holds the token's value." The hooks log each token only as a fingerprint: the
 * SHA-256 of its letters and digits, and how many there are. A file holds the token when some run
 * of that many letters and digits in it, whatever sits between them, has that fingerprint; so a
 * value split by JSON escapes or quoting is still found. A recording also never holds an auth line
 * or an assignment of CLAUDE_CODE_MESSAGING_TOKEN with a value, whether a fingerprint was logged or not.
 */
function tokenProblems(spike) {
  const problems = [];
  const lines = [...spike.logs.values()].flat();
  const prints = new Map();
  for (const line of lines.filter((logged) => logged.phase === 'start')) {
    const { env } = line;
    if (lineProblems(line).length) { problems.push(...lineProblems(line)); break; }
    if (typeof env.fingerprint !== 'string') continue;
    if (!/^[0-9a-f]{64}$/.test(env.fingerprint) || env.tokenChars < 12) { problems.push(`BLOCKED: ${place(line)}: a token of ${env.tokenChars} letters and digits, or a fingerprint that is no SHA-256, can't be told from other text`); break; }
    prints.set(env.tokenChars, (prints.get(env.tokenChars) ?? new Set()).add(env.fingerprint));
  }
  for (const sent of lines.filter((line) => line.phase === 'post' && line.auth === true)) {
    const start = lines.find((line) => line.phase === 'start' && line.session === sent.session && line.invocation === sent.invocation);
    if (typeof start?.env?.fingerprint !== 'string') problems.push(`${place(sent)} sent the token, but its hook's start line logged no fingerprint of it, so no recording can be checked for it`);
  }
  const { logs, corpus, rest } = recordingFiles(spike);
  for (const path of [...logs, ...corpus, ...rest]) {
    const body = readFileSync(path, 'utf8'), where = relative(root, path);
    const letters = body.replace(/[^A-Za-z0-9]/g, '');
    for (const [chars, known] of prints) for (let at = 0; at + chars <= letters.length; at++) {
      if (!known.has(hash('sha256', letters.slice(at, at + chars)))) continue;
      problems.push(`${where} holds a token's value: ${chars} letters and digits in it have the fingerprint a hook logged for CLAUDE_CODE_MESSAGING_TOKEN`);
      break;
    }
    if (rest.includes(path)) continue;
    const plain = body.replace(/\\+/g, '');
    const auth = [...plain.matchAll(/"type"\s*:\s*"auth"[^{}]{0,200}?"token"\s*:\s*"([^"]*)"|"token"\s*:\s*"([^"]*)"[^{}]{0,200}?"type"\s*:\s*"auth"/g)].find((match) => valued(match[1] ?? match[2]));
    if (auth) problems.push(`${where} holds an auth line with a token in it`);
    const assigned = [...plain.matchAll(/CLAUDE_CODE_MESSAGING_TOKEN["']?\s*[=:]\s*["']?([^\s"',;)}\]]*)/g)].find((match) => valued(match[1]));
    if (assigned) problems.push(`${where} holds CLAUDE_CODE_MESSAGING_TOKEN with a value beside it`);
  }
  return problems;
}

/**
 * "The scrub's own check passes on each." The scrub is the corpus recorder's (#47): its redaction,
 * which must leave each recording as it finds it, and its secret scan, gitleaks with the repo's
 * rules, which keeps a fresh set out of the corpus on a finding. A scan that didn't run is BLOCKED.
 */
function scrubProblems(spike) {
  const problems = [];
  const { entries, logs, corpus } = recordingFiles(spike);
  const redact = redactor();
  for (const path of [...logs, ...corpus]) {
    const body = readFileSync(path, 'utf8');
    const same = path.endsWith('.jsonl')
      ? body.split('\n').every((raw) => { try { const value = JSON.parse(raw); return text(redact(value)) === text(value); } catch { return redact(raw) === raw; } })
      : redact(body) === body;
    if (!same) problems.push(`${relative(root, path)} is not scrubbed: the corpus recorder's redaction (scripts/corpus-redact.mjs) would still change it (a home folder, a user name or an email address)`);
  }
  for (const source of [...(logs.length ? [join(spike.dir, 'logs')] : []), ...entries.map((entry) => join(root, entry))]) {
    const scan = spawnSync('gitleaks', ['detect', '--no-git', '--source', source, '--config', join(root, GITLEAKS_RULES), '--redact', '--no-banner', '--verbose', '--exit-code', '3'], { encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 26 });
    if (scan.error) problems.push(`BLOCKED: gitleaks did not run over ${relative(root, source)}: ${scan.error.message}; install gitleaks (brew install gitleaks)`);
    else if (scan.status === 3) problems.push(`gitleaks, with the repo's rules, found secrets in ${relative(root, source)} (values redacted): ${[...new Set((scan.stdout.match(/^RuleID:\s+\S+/gm) ?? []).map((rule) => rule.replace(/^RuleID:\s+/, '')))].join(', ')}`);
    else if (scan.status !== 0) problems.push(`BLOCKED: gitleaks exited ${scan.status} over ${relative(root, source)}: ${scan.stderr.slice(-300)}`);
  }
  return problems;
}

// ------------------------------------------------------------------ one context per criterion

function context(spike, key) {
  const problems = new Set(), cited = [];
  const entry = spike.record?.criteria?.[id(key)];
  const fail = (message) => { problems.add(message); return null; };
  if (!entry || typeof entry !== 'object') fail(`the record has no entry for ${id(key)}`);
  const posts = Array.isArray(spike.record?.posts) ? spike.record.posts.filter((post) => post && typeof post === 'object') : [];
  /** A post's evidence, taken once: its problems and the lines it rests on. */
  const take = (post) => {
    const { problems: found, cited: lines } = postEvidence(spike, post);
    for (const problem of found) fail(problem);
    cited.push(...lines);
    return found.length === 0;
  };
  /** The post an entry names by its ID. A post that wasn't run is BLOCKED, never a finding. */
  const post = (name, what) => {
    const found = posts.filter((candidate) => candidate.id === name);
    if (found.length !== 1) return fail(`${what}: names no one post of the record (post): ${text(name)}`);
    if (found[0].outcome === 'not-run') return fail(`BLOCKED: ${what}: post ${name} was not run (${found[0].reason}), so this stays open`);
    if (![...OUTCOMES, 'no-route'].includes(found[0].outcome)) return fail(`${what}: post ${name} records no outcome: ${text(found[0].outcome)}`);
    return found[0];
  };
  return { spike, entry: entry && typeof entry === 'object' ? entry : {}, posts, fail, take, post, cite: (...lines) => cited.push(...lines.filter(Boolean)), done: () => ({ entry, problems: [...problems], cited: [...new Set(cited)] }) };
}

// ------------------------------------------------------------------ the checks, one per criterion

export const checks = {
  // Four places, three modes, two ways to post. Each cell has a post with its recording or the
  // version tested with no route; a mode a place doesn't have says so; anything not run is BLOCKED.
  places(spike) {
    const c = context(spike, 'places');
    const matrix = c.posts.filter((post) => post.inbound === undefined);
    for (const where of PLACES) {
      let shown = 0, open = 0;
      for (const mode of MODES) for (const way of WAYS) {
        const cell = matrix.filter((post) => post.place === where && (post.mode ?? mode) === mode && (post.way ?? way) === way);
        const real = cell.filter((post) => [...OUTCOMES, 'no-route'].includes(post.outcome));
        const unrun = cell.filter((post) => post.outcome === 'not-run');
        if (real.length) { shown += 1; real.forEach(c.take); }
        else if (unrun.length) { open += 1; for (const post of unrun) c.fail(`BLOCKED: post ${post.id}: ${NAMES[where]}${post.mode ? `, in the mode that ${post.mode === 'auto' ? 'is auto' : post.mode},` : ''} was not run (${post.reason}), so this stays open`); }
        else if (!cell.length) c.fail(`the record has no post for ${NAMES[where]}, in the mode that ${mode === 'auto' ? 'is auto' : mode}, by way ${way}`);
        else for (const post of cell) if (post.outcome !== 'no-mode' || !MODES.includes(post.mode) || !words(post.reason)) c.fail(`post ${post.id}: a place that lacks a mode says which and why (outcome no-mode, mode, reason): ${text(post)}`);
      }
      if (!shown && !open) c.fail(`no post was recorded for ${NAMES[where]}`);
    }
    for (const post of c.posts.filter((candidate) => STATES.includes(candidate.outcome) && typeof candidate.id === 'string')) {
      const said = RegExp(`(?<![\\w-])${post.outcome.replace('-', '[- ]')}(?![\\w-])`, 'i');
      if (!reportLines(spike, post.id).some((line) => said.test(line))) c.fail(`the report (${SPIKE}/README.md) has no line naming post ${post.id} with its outcome, ${post.outcome}`);
    }
    return c.done();
  },

  // An idle session woken by 20 or more posts and, beside them, by its waiter: each sample's time is
  // the one its log shows, from the post (or the waiter's exit 2) to the session's next hook.
  latency(spike) {
    const c = context(spike, 'latency');
    const s = sessionEvidence(spike, c.entry.session);
    for (const problem of s.problems) c.fail(problem);
    c.cite(...s.cited);
    const seen = new Set();
    for (const side of ['inbox', 'waiter']) {
      const samples = Array.isArray(c.entry[side]?.samples) ? c.entry[side].samples : [];
      if (samples.length < SAMPLES) c.fail(`INCONCLUSIVE: ${side === 'inbox' ? 'the posts' : "the waiter's wakes"} number ${samples.length}; p50 and p95 are given over at least ${SAMPLES}`);
      for (const sample of samples) {
        const where = `${side} sample ${text(sample?.nonce)}`;
        if (!isNonce(sample?.nonce) || !finite(sample.ms) || seen.has(sample.nonce)) { c.fail(`${where}: a sample is { nonce, ms }, each nonce once: ${text(sample)}`); continue; }
        seen.add(sample.nonce);
        const from = s.lines.filter((line) => line.nonce === sample.nonce && line.phase === (side === 'inbox' ? 'post' : 'exit'));
        if (from.length !== 1) { c.fail(`${where}: session ${c.entry.session}'s log holds ${from.length} ${side === 'inbox' ? 'post' : "waiter's exit"} lines with that nonce, so it is no sample of this session`); continue; }
        const [sent] = from;
        const entries = hookEntries(s.settings, sent.event);
        if (side === 'inbox') {
          if (sent.wrote !== true) c.fail(`${where}: ${place(sent)} wrote nothing to the inbox`);
          const waitedOn = sent.way === 'hook' ? !entries.some((entry) => entry.async === true || entry.asyncRewake === true) : !s.lines.some((line) => line.phase === 'exit' && line.invocation === sent.invocation && line.at <= sent.at);
          if (waitedOn) c.fail(`${where}: it was posted while the session still waited on its ${sent.event} hook (${sent.way === 'hook' ? 'no async entry in its settings' : 'no exit line before the post'}), so the session wasn't idle`);
        } else {
          if (sent.exit !== 2 || !String(sent.stderr ?? '').includes(sample.nonce)) c.fail(`${where}: ${place(sent)} is no waiter exiting 2 with the answer on stderr`);
          if (!STOPS.includes(sent.event) || !entries.some((entry) => entry.asyncRewake === true)) c.fail(`${where}: the session's settings have no asyncRewake ${sent.event} waiter`);
        }
        const stop = stopBefore(s.lines, sent.at);
        if (!stop) c.fail(`${where}: the session had a turn open at ${place(sent)}, so it wasn't idle`);
        else if (sent.at - stop.at < IDLE_MS) c.fail(`${where}: it came ${Math.round(sent.at - stop.at)} ms after the stop, so the session was never idle`);
        const early = s.lines.find((line) => line.at < sent.at && carries(line, sample.nonce));
        if (early) c.fail(`${where}: ${place(early)} carries the nonce before it was sent`);
        const first = s.lines.find((line) => line.phase === 'start' && line.at >= sent.at && line.invocation !== sent.invocation);
        const woke = s.lines.find((line) => line.at >= sent.at && carries(line, sample.nonce));
        if (!first || !woke) { c.fail(`${where}: ${!first ? 'no hook of the session started after it' : 'no later hook payload or transcript entry carries its nonce'}, so the session never woke on it`); continue; }
        const typed = typedBetween(s.lines, sent.at, woke.at, sample.nonce);
        if (typed) c.fail(`${where}: a prompt was typed (${place(typed)}) before the session carried it, so it didn't wake on its own`);
        if (Math.abs(first.at - sent.at - sample.ms) > 1) c.fail(`${where}: the record says ${sample.ms} ms, the log shows ${first.at - sent.at} ms from ${place(sent)} to the next hook, ${place(first)}`);
        c.cite(sent, stop, first, woke);
      }
      const times = samples.map((sample) => sample?.ms).filter(finite);
      for (const [name, share] of [['p50', 0.5], ['p95', 0.95]]) if (!times.length || c.entry[side]?.[name] !== nearestRank(times, share)) c.fail(`${side}.${name} is ${text(c.entry[side]?.[name])}; the nearest-rank ${name} of its samples is ${text(nearestRank(times, share))}`);
    }
    return c.done();
  },

  // What the model received and the origin fields its transcript entry holds, quoted from a recording
  // the spike added to the corpus; no recording holds the token, and the scrub's own check passes.
  quotes(spike, { scans = true } = {}) {
    const c = context(spike, 'quotes');
    const base = spike.record.baseCommit;
    for (const problem of baseProblems(spike.record)) c.fail(problem);
    const listed = Array.isArray(spike.record.corpus) ? spike.record.corpus : [];
    if (!listed.length) c.fail('the record lists no corpus entry the spike added (corpus)');
    for (const entry of listed) {
      const [, version] = (typeof entry === 'string' ? CORPUS.exec(entry) : null) ?? [];
      const has = (file) => existsSync(join(root, entry, file)) && statSync(join(root, entry, file)).size > 0;
      if (!version || !['session.json', 'events.jsonl', 'transcript.jsonl'].every(has)) { c.fail(`${text(entry)} is no corpus session: adapters/corpus/claude-code/<version>/<session>/ with session.json, events.jsonl and transcript.jsonl`); continue; }
      let meta = {};
      try { meta = JSON.parse(readFileSync(join(root, entry, 'session.json'), 'utf8')); } catch { /* reported below */ }
      if (meta.schema !== 'corpus.session@1' || meta.agent !== 'claude-code' || meta.version !== version) c.fail(`${entry}/session.json is not a corpus.session@1 of claude-code ${version}`);
      if (git('cat-file', '-e', `${base}:${entry}`).status === 0) c.fail(`${entry} is already in the base commit ${base}, so the spike didn't add it`);
    }
    const quotes = Array.isArray(c.entry.quotes) ? c.entry.quotes : [];
    if (!quotes.length) c.fail('the record quotes nothing (quotes)');
    const posted = [...spike.logs.values()].flat().filter((line) => line.phase === 'post');
    for (const quote of quotes) {
      const where = `quote ${text(quote?.nonce)}`;
      if (!quote || !isNonce(quote.nonce) || !listed.includes(quote.corpus) || !existsSync(join(root, String(quote.corpus), 'transcript.jsonl'))) { c.fail(`${where}: a quote names its nonce and the corpus entry it is from, one the record lists: ${text(quote?.corpus)}`); continue; }
      const read = (file) => (existsSync(join(root, quote.corpus, file)) ? readFileSync(join(root, quote.corpus, file), 'utf8') : '').split('\n').filter((raw) => raw.trim()).map((raw) => { try { return JSON.parse(raw); } catch { return null; } }).filter(Boolean);
      const holding = read('transcript.jsonl').filter((entry) => text(entry).includes(quote.nonce));
      const entry = holding.find((candidate) => candidate.turnOrigin !== undefined || candidate.origin !== undefined) ?? holding[0];
      if (!entry) { c.fail(`${where}: no entry of ${quote.corpus}/transcript.jsonl holds the nonce`); continue; }
      if (typeof quote.received !== 'string' || !quote.received.includes(quote.nonce) || !strings(entry).includes(quote.received)) c.fail(`${where}: what the model received (received) is the whole text the transcript entry holds around the message, nonce included`);
      else if (!reportHolds(spike, quote.received)) c.fail(`${where}: the report doesn't quote what the model received`);
      if (text(quote.turnOrigin) !== text(entry.turnOrigin) || text(sorted(quote.origin)) !== text(sorted(entry.origin))) c.fail(`${where}: the transcript entry has turnOrigin ${text(entry.turnOrigin)} and origin ${text(entry.origin)}; the record quotes ${text(quote.turnOrigin)} and ${text(quote.origin)}`);
      else for (const value of [entry.turnOrigin, ...Object.entries(entry.origin && typeof entry.origin === 'object' ? entry.origin : {}).flat()].filter((field) => field !== undefined && typeof field !== 'object')) if (!spike.report.includes(String(value))) c.fail(`${where}: the report doesn't quote the origin field ${text(value)}`);
      const sent = posted.filter((line) => line.nonce === quote.nonce && line.wrote === true);
      if (sent.length !== 1) { c.fail(`${where}: the spike's logs hold ${sent.length} posts that wrote that nonce, so nothing shows the entry is the spike's own post`); continue; }
      c.cite(sent[0]);
      if (!read('events.jsonl').some((recorded) => recorded.payload?.session_id === sent[0].session)) c.fail(`${where}: ${quote.corpus}/events.jsonl holds no hook payload of session ${sent[0].session}, which posted it`);
    }
    if (scans) for (const problem of [...tokenProblems(spike), ...scrubProblems(spike)]) c.fail(problem);
    return c.done();
  },

  // Whether a claude -p session and a desktop app session woke: each had stopped when the post came.
  wakes(spike) {
    const c = context(spike, 'wakes');
    for (const where of ['headless', 'desktop']) {
      const said = c.entry[where], what = NAMES[where];
      if (!said || typeof said.woke !== 'boolean') { c.fail(`${what}: the record says whether it woke (${where}: { woke, post })`); continue; }
      const post = c.post(said.post, what);
      if (!post) continue;
      if (post.place !== where || post.inbound !== undefined) { c.fail(`${what}: post ${post.id} is a post in ${NAMES[post.place]}${post.inbound ? ` under crossSessionInbound ${post.inbound}` : ''}`); continue; }
      if (!c.take(post)) continue;
      if (said.woke !== (post.outcome === 'delivered')) c.fail(`${what}: the record says it ${said.woke ? 'woke' : "didn't wake"}, but post ${post.id} was ${post.outcome}`);
      if (post.outcome === 'no-route') continue;
      const lines = sessionLines(spike, post.session);
      const sent = lines.find((line) => line.phase === 'post' && line.nonce === post.nonce);
      const stop = stopBefore(lines, sent.at);
      if (!stop) { c.fail(`${what}: the session had a turn open at ${place(sent)}, so the post shows no wake`); continue; }
      const woke = lines.find((line) => line.at >= sent.at && carries(line, post.nonce));
      const typed = woke && typedBetween(lines, sent.at, woke.at, post.nonce);
      if (typed) c.fail(`${what}: a prompt was typed (${place(typed)}) before the session carried the post, so it didn't wake on it`);
      c.cite(stop);
    }
    return c.done();
  },

  // A session whose settings hold, and one whose settings refuse, inbound messages: neither received
  // the post, and the record and the report say the route then reads absent.
  inbound(spike) {
    const c = context(spike, 'inbound');
    for (const setting of ['hold', 'refuse']) {
      const said = c.entry[setting], what = `crossSessionInbound ${setting}`;
      if (!said || typeof said !== 'object') { c.fail(`${what}: the record says what the session did with the post (${setting}: { post, route })`); continue; }
      const post = c.post(said.post, what);
      if (!post) continue;
      if (post.inbound !== setting) { c.fail(`${what}: post ${post.id} is not marked as posted under that setting (inbound)`); continue; }
      c.take(post);
      if (post.outcome === 'delivered') c.fail(`${what}: post ${post.id} was delivered, so the route doesn't read absent`);
      if (said.route !== 'absent') c.fail(`${what}: the record says how the route then reads (route: "absent"): ${text(said.route)}`);
      if (!reportLines(spike, post.id).some((line) => /\babsent\b/i.test(line))) c.fail(`${what}: the report has no line naming post ${post.id} that says the route reads absent`);
    }
    return c.done();
  },

  // The token decision: a question, each answer with what it costs, nothing chosen; and this change
  // puts the token's name in no file outside the spike, the tests and the corpus.
  decision(spike) {
    const c = context(spike, 'decision');
    const extra = Object.keys(c.entry).filter((key) => !['criterion', 'status', 'question', 'answers'].includes(key));
    if (extra.length) c.fail(`the decision is the owner's: the entry holds a question and its answers, and nothing chosen (${extra.join(', ')})`);
    if (!words(c.entry.question) || !c.entry.question.trim().endsWith('?') || !/token/i.test(c.entry.question)) c.fail(`the token decision is stated as a question: ${text(c.entry.question)}`);
    else if (!reportHolds(spike, c.entry.question)) c.fail('the report doesn\'t state the question');
    const answers = Array.isArray(c.entry.answers) ? c.entry.answers : [];
    if (answers.length < 2 || new Set(answers.map((answer) => flat(answer?.answer ?? ''))).size !== answers.length) c.fail(`a question has two or more answers, each once: ${answers.length}`);
    for (const answer of answers) {
      const where = `answer ${text(answer?.answer)}`;
      if (!answer || Object.keys(answer).sort().join() !== 'answer,costs' || !words(answer.answer)) { c.fail(`${where}: an answer holds its words and what it costs, and nothing else: ${text(answer)}`); continue; }
      if (!Array.isArray(answer.costs) || !answer.costs.length || !answer.costs.every(words)) { c.fail(`${where} says nothing of what it costs`); continue; }
      for (const said of [answer.answer, ...answer.costs]) if (!reportHolds(spike, said)) c.fail(`${where}: the report doesn't hold ${text(said)}`);
    }
    const change = changedFiles();
    if (change.blocked) c.fail(change.blocked);
    else for (const file of naming(change.files.filter(outside), ['CLAUDE_CODE_MESSAGING_TOKEN'])) c.fail(`this change builds something that reads the token: ${file}`);
    return c.done();
  },

  // The report's last section is the issues it proposes, each with what it depends on; and this
  // change touches no package, crate or adapter file, and names the inbox nowhere else it builds.
  issues(spike) {
    const c = context(spike, 'issues');
    const route = c.entry.recommendation?.route;
    if (!['beside', 'replace', 'none'].includes(route)) c.fail(`the recommendation is one of three (recommendation.route: beside, replace or none): ${text(route)}`);
    if (route === 'none' && !reportHolds(spike, c.entry.recommendation.reason)) c.fail('a recommendation of none gives its reason (recommendation.reason), and the report holds it');
    const issues = Array.isArray(c.entry.issues) ? c.entry.issues : [];
    if (!issues.length && route !== 'none') c.fail('the record proposes no issue (issues)');
    const titles = issues.map((issue) => issue?.title);
    // The report's last section: the last heading that names what it proposes, with only deeper headings after it.
    let fenced = false;
    const lines = spike.report.split('\n');
    const headings = lines.flatMap((line, index) => { if (/^\s*(```|~~~)/.test(line)) fenced = !fenced; const level = fenced ? null : /^(#{1,6})\s+\S/.exec(line)?.[1].length; return level ? [{ index, level }] : []; });
    const last = headings.findLast(({ index }) => /propos/i.test(lines[index]));
    const later = last && headings.find(({ index, level }) => index > last.index && level <= last.level);
    if (!last || later) c.fail(`the report ends with the issues it proposes: ${later ? `after them comes ${text(lines[later.index])}` : 'no heading names them'}`);
    issues.forEach((issue, index) => {
      const where = `proposed issue ${text(issue?.title)}`;
      if (!words(issue?.title) || titles.indexOf(issue.title) !== index) return c.fail(`${where}: a proposed issue has a title of its own`);
      const needs = Array.isArray(issue.dependsOn) ? issue.dependsOn : [];
      if (!needs.length || !needs.every((need) => typeof need === 'string' && (/^#\d+$/.test(need) || (need !== issue.title && titles.includes(need))))) return c.fail(`${where} has no depends-on: dependsOn lists issues as #<number>, or another proposed issue by its title: ${text(issue.dependsOn)}`);
      // Its own part of the last section: from the heading that holds its title to the next heading no deeper.
      const heading = last && headings.find((candidate) => candidate.index > last.index && lines[candidate.index].includes(issue.title));
      if (!heading) return c.fail(`${where} has no heading of its own in the report's last section`);
      const next = headings.find((candidate) => candidate.index > heading.index && candidate.level <= heading.level);
      const own = lines.slice(heading.index + 1, next?.index).join('\n');
      if (!/depends on/i.test(own)) c.fail(`${where}: the report gives it no Depends on`);
      for (const need of needs) if (!(need.startsWith('#') ? RegExp(`${escape(need)}(?!\\d)`).test(own) : flat(own).includes(flat(need)))) c.fail(`${where}: the report's Depends on leaves out ${need}`);
      return null;
    });
    const change = changedFiles();
    if (change.blocked) c.fail(change.blocked);
    else {
      for (const path of change.files.filter(product)) c.fail(`this change builds: it touches ${path}`);
      for (const file of naming(change.files.filter((path) => outside(path) && !product(path)), INBOX_NAMES)) c.fail(`this change builds on the inbox: ${file}`);
    }
    return c.done();
  },
};
