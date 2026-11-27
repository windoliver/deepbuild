#!/usr/bin/env node
// Throwaway #3406 spike: builds what the repo keeps from the raw run folders, which stay outside it.
//   node record.mjs --raw <folder of driver runs> [--desk <folder of desktop runs>] [--rename <folder name>=<name>]
// It writes logs/<run>.jsonl (each run's hook log, entries copied from its transcript, and the lines of Claude Code's
// own debug log about the inbox), settings/<shape>.json (the settings each session ran with), record.json, and the
// corpus session; every line goes through the corpus recorder's redaction first, and --rename writes one folder name
// of this machine's paths as another. It fills the report's tables.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactor } from '../../../../scripts/corpus-redact.mjs';

const here = dirname(fileURLToPath(import.meta.url)), spike = join(here, '..'), root = join(spike, '..', '..', '..');
const flag = (name) => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? undefined : process.argv[at + 1]; };
const scrub = redactor(), [from, to = ''] = (flag('rename') ?? '').split('=');
// The recorder's redaction, then the renamed folder, in every string and key.
const redact = (value) => { const clean = scrub(value); return from ? JSON.parse(JSON.stringify(clean).replaceAll(from, to)) : clean; };
const jsonl = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }) : []);
const words = JSON.parse(readFileSync(join(here, 'words.json'), 'utf8'));
const APP = '6.28899.6'; // the Claude desktop app on the reference Mac, from its bundle
const MODES = { default: 'asks', auto: 'auto', bypassPermissions: 'skips' };
const PRIVATE = ['base_instructions', 'user_instructions', 'developer_instructions', 'instructions', 'systemPrompt'];
const strip = (value) => (Array.isArray(value) ? value.map(strip) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE.includes(key)).map(([key, inner]) => [key, strip(inner)])) : value);
// The transcript entries a recording keeps, as the corpus recorder keeps them, and one more: the attachment a
// message read mid-turn is written as, which is the only entry that holds its origin.
const kept = (entry) => (['user', 'assistant', 'system', 'queue-operation'].includes(entry.type) && entry.subtype !== 'prompt_snapshot') || (entry.type === 'attachment' && entry.attachment?.type === 'queued_command');
const DEBUG = /\[uds-messaging\]|\[cross-session-inbound\]|\[peer-guard\]|\[peer-cred\]|bypassPermissions mode is disabled/;
const nearest = (samples, share) => [...samples].sort((a, b) => a - b)[Math.ceil(share * samples.length) - 1];

// ---- the runs ------------------------------------------------------------------------------------------------
const runs = [];
for (const folder of [flag('raw'), flag('desk')].filter(Boolean)) for (const name of readdirSync(folder).sort()) {
  const dir = join(folder, name);
  if (name.startsWith('invalid') || name.startsWith('pilot') || !existsSync(join(dir, 'log.jsonl'))) continue;
  const hooked = jsonl(join(dir, 'log.jsonl'));
  if (!hooked.length) continue;
  const driven = jsonl(join(dir, 'driver.jsonl')), driver = driven[0] ?? {};
  if (driven.length && !driven.some((line) => line.done)) continue; // a run still going
  const place = hooked[0].place, sessions = [...new Set(hooked.map((line) => line.session))];
  const transcript = readdirSync(dir).filter((file) => file.startsWith('transcript.')).flatMap((file) => jsonl(join(dir, file)));
  const sessionAt = (at) => hooked.filter((line) => line.phase === 'start' && line.at <= at).at(-1)?.session ?? sessions[0];
  const lines = [...hooked];
  // A notice Claude Code writes for the person, never for the model, is kept under a phase of its own: it quotes
  // the message it is about, and the tests read any copied entry that holds a post's nonce as the session having received it.
  // An entry with no uuid, a queue operation, is known only by its type and time: of two that share both, the later is kept.
  const last = new Map(transcript.map((entry, at) => [entry.uuid ?? `${entry.type}@${entry.timestamp}`, at]));
  for (const [at, entry] of transcript.entries()) if (kept(entry) && typeof entry.timestamp === 'string' && last.get(entry.uuid ?? `${entry.type}@${entry.timestamp}`) === at) lines.push({ at: Date.parse(entry.timestamp), place, session: entry.sessionId, event: entry.type, phase: entry.type === 'system' && entry.subtype === 'informational' ? 'notice' : 'copied', payload: strip(entry) });
  for (const text of existsSync(join(dir, 'debug.log')) ? readFileSync(join(dir, 'debug.log'), 'utf8').split('\n').filter((line) => DEBUG.test(line)) : []) {
    const at = Date.parse(text.slice(0, 24));
    if (Number.isFinite(at)) lines.push({ at, place, session: sessionAt(at), event: 'debug', phase: 'debug', text: text.slice(25) });
  }
  for (const { at, line } of jsonl(join(dir, 'stream.jsonl'))) if (line?.type === 'system' && line.subtype === 'peer_message_hold') lines.push({ at, place, session: line.session_id, event: 'stream', phase: 'stream', payload: line });
  for (const shot of jsonl(join(dir, 'screens.jsonl'))) lines.push({ at: shot.at, place, session: sessionAt(shot.at), event: 'screen', phase: 'screen', label: shot.label, text: shot.text.slice(-700) });
  lines.sort((a, b) => a.at - b.at);
  const version = transcript.find((entry) => typeof entry.version === 'string')?.version ?? driver.version;
  const settings = existsSync(join(dir, 'settings.json')) ? JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) : null;
  runs.push({ name, dir, place, driver, sessions, lines, transcript, version, settings });
}

// ---- logs and settings ------------------------------------------------------------------------------------------
for (const folder of ['logs', 'settings']) { rmSync(join(spike, folder), { recursive: true, force: true }); mkdirSync(join(spike, folder)); }
const shapes = new Map();
for (const run of runs) {
  writeFileSync(join(spike, 'logs', `${run.name}.jsonl`), `${run.lines.map((line) => JSON.stringify(redact(line))).join('\n')}\n`);
  const actors = Object.entries(run.settings.hooks).flatMap(([event, groups]) => groups.flatMap((group) => group.hooks).filter((entry) => / 'act'/.test(entry.command)).map((entry) => `${event.toLowerCase()}-${entry.asyncRewake ? 'rewake' : entry.async ? 'async' : 'sync'}-${entry.timeout}`));
  const shape = run.place === 'desktop' ? run.name : [actors.join('-') || 'log-only', run.settings.crossSessionInbound].filter(Boolean).join('-');
  const body = `${JSON.stringify(redact(run.settings), null, 1)}\n`;
  if (shapes.has(shape) && shapes.get(shape) !== body) throw new Error(`two settings of shape ${shape} differ`);
  shapes.set(shape, body);
  run.settingsFile = `settings/${shape}.json`;
  writeFileSync(join(spike, run.settingsFile), body);
}

// ---- what each post became ----------------------------------------------------------------------------------------
const text = (value) => JSON.stringify(value ?? null);
const carries = (line, nonce) => (line.phase === 'start' || line.phase === 'copied') && text(line.payload).includes(nonce);
const short = (version) => version.split('.').at(-1);
function outcomeOf(run, sent) {
  // A post into another run's session is looked for where it went.
  const mine = sent.control?.includes('another session') ? runs.flatMap((other) => other.lines).filter((line) => line.session !== sent.session).sort((a, b) => a.at - b.at) : run.lines.filter((line) => line.session === sent.session);
  const after = mine.find((line) => line.at >= sent.at && carries(line, sent.nonce));
  if (after) return { outcome: 'delivered', first: mine.find((line) => line.phase === 'start' && line.at >= sent.at && line.invocation !== sent.invocation) };
  if (!sent.wrote) return { outcome: 'no-route', reason: `the write failed (${sent.error}): ${words.noRoute[run.driver.scenario] ?? 'no inbox was listening'}` };
  const said = mine.find((line) => line.at >= sent.at && ['debug', 'notice'].includes(line.phase) && /held inbound peer message|Held peer message|refused inbound peer message/.test(text(line)));
  const held = said && /held/i.test(text(said)), shown = said && (said.phase === 'debug' ? said.text.match(/(held inbound peer message \([^)]*\)|refused inbound peer message \([^)]*\))/)?.[1] : 'not delivered to Claude');
  // Written, never seen again, and nothing in the session's log says why: no outcome is claimed.
  return said ? { outcome: held ? 'held' : 'refused', shown } : { outcome: 'unexplained' };
}
const posts = [], sessions = {}, controls = [], notes = [];
for (const run of runs) {
  for (const session of run.sessions) sessions[session] = { place: run.place, version: run.version, ...(run.place === 'desktop' ? { appVersion: APP } : {}), settings: run.settingsFile };
  const scenario = run.driver.scenario ?? run.name;
  if (['latency', 'burst'].includes(scenario)) continue; // counted on their own, below
  for (const sent of run.lines.filter((line) => line.phase === 'post' || line.phase === 'control')) {
    const started = run.lines.filter((line) => line.phase === 'start' && line.session === sent.session && line.at <= sent.at && typeof line.payload?.permission_mode === 'string');
    const mode = MODES[(started.findLast((line) => line.invocation === sent.invocation) ?? started.at(-1))?.payload.permission_mode];
    const found = outcomeOf(run, sent), inbound = run.settings.crossSessionInbound;
    const variant = { 'idle-hook': '', 'idle-outlived': '', 'idle-hook-wait': 'wait', 'working-hook': 'working', 'working-outlived': 'working', 'working-fields': 'working-fields', 'print-sync-hook': 'oneshot', 'print-async-hook': 'oneshot-async', 'print-outlived': 'oneshot', 'worker-hook': 'worker', 'worker-outlived': 'worker', 'long-hook': run.name.match(/(\d+)m$/)?.[0], 'long-outlived': run.name.match(/(\d+)m$/)?.[0], 'ask-answer': 'answer', 'wake-context': 'wake', fields: 'fields', corpus: `corpus-${sent.id}`, resume: 'resume' }[scenario] ?? (run.place === 'desktop' ? `${run.name.replace('desktop-', '')}-${sent.id}` : scenario);
    // A session asked to start in a mode it did not get, as its payloads show.
    const asked = run.driver.mode === 'bypassPermissions' && mode !== 'skips' ? 'asked-to-skip' : null;
    const ms = found.first ? Math.round((found.first.at - sent.at) * 1000) / 1000 : undefined;
    const row = { run: run.name, scenario, version: run.version, firstHook: found.first?.event, ms };
    if (sent.phase === 'control') { controls.push({ ...row, control: sent.control, mode, outcome: found.outcome }); continue; }
    const again = run.name.match(/-(stream|\d)$/)?.[1]; // a scenario run more than once
    const id = [inbound ? `inbound-${inbound}` : null, run.place, mode, sent.way, variant, asked, again, short(run.version)].filter(Boolean).join('-');
    if (found.outcome === 'unexplained' || (['held', 'refused'].includes(found.outcome) && !inbound)) { notes.push(`UNEXPLAINED: ${run.name} post ${sent.id} was written and never arrived, and ${inbound ? 'its log holds no word of a hold or a refusal' : 'its session set no inbound setting'}`); continue; }
    posts.push({ post: { id, place: run.place, mode, way: sent.way, ...(inbound ? { inbound } : {}), outcome: found.outcome, session: sent.session, ...(found.outcome === 'no-route' ? { reason: found.reason } : { nonce: sent.nonce }), ...(found.shown ? { shown: found.shown } : {}) }, ...row });
  }
}
// A place or mode that was not run says so, and keeps its criterion open.
const ran = (place) => posts.some(({ post }) => post.place === place);
const unrun = [
  ...['terminal', 'headless', 'desktop'].filter(ran).map((place) => ({ id: `${place}-skips`, place, mode: 'skips', way: null, outcome: 'not-run', reason: words.notRun.skips })),
  ...(ran('desktop') ? [] : [{ id: 'desktop', place: 'desktop', mode: null, way: null, outcome: 'not-run', reason: words.notRun.desktop }]),
  ...(ran('desktop') && !posts.some(({ post }) => post.place === 'desktop' && post.mode === 'auto') ? [{ id: 'desktop-auto', place: 'desktop', mode: 'auto', way: null, outcome: 'not-run', reason: words.notRun.desktopAuto }] : []),
  { id: 'editor', place: 'editor', mode: null, way: null, outcome: 'not-run', reason: words.notRun.editor },
];

// ---- latency: one session, the post or the waiter's exit to the session's next hook ------------------------------
function latency(run) {
  const session = run.sessions[0], mine = run.lines.filter((line) => line.session === session);
  const side = (phase) => {
    const samples = mine.filter((line) => line.phase === phase && line.nonce).map((sent) => {
      const first = mine.find((line) => line.phase === 'start' && line.at >= sent.at && line.invocation !== sent.invocation);
      return { nonce: sent.nonce, ms: first.at - sent.at, first: first.event };
    });
    return { samples: samples.map(({ nonce, ms }) => ({ nonce, ms })), p50: nearest(samples.map(({ ms }) => ms), 0.5), p95: nearest(samples.map(({ ms }) => ms), 0.95), firsts: [...new Set(samples.map(({ first }) => first))] };
  };
  return { session, run: run.name, version: run.version, load: run.driver.load, inbox: side('post'), waiter: side('exit') };
}
const timed = runs.filter((run) => run.driver.scenario === 'latency').map(latency);

// ---- the corpus session: the 2.1.308 run of the `corpus` scenario -------------------------------------------------
const CORPUS = 'adapters/corpus/claude-code/2.1.308/inbox-post';
const source = runs.find((run) => run.driver.scenario === 'corpus' && run.version === '2.1.308');
const quotes = [];
if (source) {
  const facts = JSON.parse(readFileSync(join(root, 'adapters/claude-code.facts.json'), 'utf8'));
  const listed = Object.keys(facts.events.versions['2.1.308']);
  const entries = source.transcript.filter((entry) => ['user', 'assistant', 'system', 'queue-operation'].includes(entry.type) && entry.subtype !== 'prompt_snapshot').map((entry) => redact(strip(entry)));
  const turnOf = (promptId) => source.transcript.find((entry) => entry.type === 'user' && entry.promptId === promptId);
  // A turn's usage as the facts' stop.usage reads it: its assistant entries' usage, once per message.
  const usage = (promptId) => {
    const from = source.transcript.findIndex((entry) => entry.type === 'user' && entry.promptId === promptId);
    const to = source.transcript.findIndex((entry, at) => at > from && entry.type === 'user' && entry.promptId && entry.promptId !== promptId);
    const messages = new Map(source.transcript.slice(from, to === -1 ? undefined : to).filter((entry) => entry.type === 'assistant' && entry.message?.usage).map((entry) => [entry.message.id, entry.message]));
    if (!messages.size) return null;
    const sum = (field) => ({ value: [...messages.values()].reduce((total, message) => total + (message.usage[field] ?? 0), 0), exact: true });
    return { covers: 'turn', model: [...messages.values()].at(-1).model, input: { value: sum('input_tokens').value + sum('cache_creation_input_tokens').value, exact: true }, cached: sum('cache_read_input_tokens'), output: sum('output_tokens'), context_fill: null, cost: { usd: null, basis: 'unpriced' } };
  };
  const expect = (payload) => {
    const session = payload.session_id;
    if (payload.hook_event_name === 'SessionStart') return [{ kind: 'session.start', data: { session, source: payload.source } }];
    if (payload.hook_event_name === 'UserPromptSubmit') return [{ kind: 'user.ask', data: { session, from: { human: 'person', peer: 'session' }[turnOf(payload.prompt_id)?.turnOrigin] ?? 'unknown', text: payload.prompt } }];
    if (payload.hook_event_name === 'Stop') return [{ kind: 'agent.stop', data: { session, outcome: 'finished', continued: payload.stop_hook_active, cause: 'unknown', usage: usage(payload.prompt_id) } }];
    if (payload.hook_event_name === 'SessionEnd') return [{ kind: 'session.end', data: { session, reason: payload.reason } }];
    if (payload.hook_event_name === 'Notification' && payload.notification_type === 'idle_prompt') return [{ kind: 'session.attention', data: { session, state: 'finished' } }];
    throw new Error(`no expected events written for ${payload.hook_event_name}`);
  };
  const events = source.lines.filter((line) => line.phase === 'start' && line.entry === 'log' && listed.includes(line.event)).map(({ payload }) => ({ payload: redact(payload), expect: expect(payload), source: 'https://code.claude.com/docs/en/hooks', reviewed: words.reviewed, ...(turnOf(payload.prompt_id)?.turnOrigin === 'peer' && payload.hook_event_name === 'UserPromptSubmit' ? { tag: 'inbox-post' } : {}) }));
  rmSync(join(root, CORPUS), { recursive: true, force: true });
  mkdirSync(join(root, CORPUS), { recursive: true });
  writeFileSync(join(root, CORPUS, 'session.json'), `${JSON.stringify({ schema: 'corpus.session@1', agent: 'claude-code', version: '2.1.308', surface: 'terminal', recorded: new Date(source.lines[0].at).toLocaleDateString('sv'), scenario: 'inbox-post' }, null, 2)}\n`);
  writeFileSync(join(root, CORPUS, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  writeFileSync(join(root, CORPUS, 'transcript.jsonl'), `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  for (const sent of source.lines.filter((line) => line.phase === 'post')) {
    const entry = entries.find((candidate) => candidate.type === 'user' && text(candidate).includes(sent.nonce));
    if (entry) quotes.push({ corpus: CORPUS, nonce: sent.nonce, received: entry.message.content, turnOrigin: entry.turnOrigin ?? null, origin: entry.origin ?? null });
  }
}

// ---- record.json --------------------------------------------------------------------------------------------------
const all = [...posts.map(({ post }) => post), ...unrun];
const pick = (test) => posts.find(({ post, ...row }) => test(post, row))?.post;
// The post each wake rests on: one made after the session's stop, by a hook still running.
const wake = (place) => { const post = pick((candidate, row) => candidate.place === place && !candidate.inbound && candidate.way === 'hook' && (place === 'desktop' ? row.run === 'desktop-ask' && candidate.id.includes('-ask-a-') : row.scenario === 'print-sync-hook' && row.version === '2.1.332' && candidate.mode === 'asks')); return post ? { woke: post.outcome === 'delivered', post: post.id } : { woke: false, post: place }; };
const under = (setting) => ({ post: pick((candidate, row) => candidate.inbound === setting && row.scenario === 'idle-hook' && row.version === '2.1.332')?.id, route: 'absent' });
// The criterion's session is the installed version's run at the lowest load; the report gives every run.
const loadOf = (entry) => Number(String(entry.load).match(/[\d.]+/)?.[0] ?? Infinity);
const main = timed.filter((entry) => entry.version === '2.1.332').sort((a, b) => loadOf(a) - loadOf(b))[0] ?? timed[0];
const criterion = (key) => words.criteria[key];
const record = {
  issue: 3406,
  baseCommit: words.baseCommit,
  hooks: ['hooks/hook.mjs'],
  sessions,
  posts: all,
  corpus: source ? [CORPUS] : [],
  criteria: {
    '#3406.aee36c46': { criterion: criterion('places'), status: words.status.places },
    '#3406.5fbeee00': { criterion: criterion('latency'), status: words.status.latency, session: main?.session, inbox: main && { samples: main.inbox.samples, p50: main.inbox.p50, p95: main.inbox.p95 }, waiter: main && { samples: main.waiter.samples, p50: main.waiter.p50, p95: main.waiter.p95 } },
    '#3406.79aefda5': { criterion: criterion('quotes'), status: words.status.quotes, quotes },
    '#3406.3e30684e': { criterion: criterion('wakes'), status: words.status.wakes, headless: wake('headless'), desktop: wake('desktop') },
    '#3406.76bfb799': { criterion: criterion('inbound'), status: words.status.inbound, hold: under('hold'), refuse: under('refuse') },
    '#3406.62e7fbf4': { criterion: criterion('decision'), status: words.status.decision, question: words.decision.question, answers: words.decision.answers },
    '#3406.1fb06894': { criterion: criterion('issues'), status: words.status.issues, recommendation: words.recommendation, issues: words.issues },
  },
};
writeFileSync(join(spike, 'record.json'), `${JSON.stringify(redact(record), null, 1)}\n`);

// ---- the report's tables: written into README.md between its markers, so the report and the record can't drift ---
const said = { 'no-route': 'no route' };
const time = (ms) => (ms === undefined ? '-' : `${Math.round(ms)} ms`);
const blocks = {
  posts: ['| Post | Outcome | Claude Code | The session\'s next hook | After | Log |', '|---|---|---|---|---|---|',
    ...posts.filter(({ post }) => !post.inbound).map(({ post, ...row }) => `| \`${post.id}\` | ${said[post.outcome] ?? post.outcome} | ${row.version} | ${post.outcome === 'delivered' ? row.firstHook : '-'} | ${post.outcome === 'delivered' ? time(row.ms) : '-'} | \`logs/${row.run}.jsonl\` |`),
    ...unrun.map((post) => `| \`${post.id}\` | not run | - | - | - | ${post.reason} |`)],
  inbound: ['| Post | Setting | Outcome | What the session\'s log holds | The route then reads | Log |', '|---|---|---|---|---|---|',
    ...posts.filter(({ post }) => post.inbound).map(({ post, ...row }) => `| \`${post.id}\` | \`${post.inbound}\` | ${post.outcome} | ${post.shown} | absent | \`logs/${row.run}.jsonl\` |`)],
  controls: ['| Control | Mode | Claude Code | Outcome | The session\'s next hook | After | Log |', '|---|---|---|---|---|---|---|',
    ...controls.map((row) => `| ${row.control} | ${row.mode} | ${row.version} | ${said[row.outcome] ?? row.outcome} | ${row.firstHook ?? '-'} | ${time(row.ms)} | \`logs/${row.run}.jsonl\` |`)],
  latency: ['| Claude Code | Load when it started | Inbox posts | p50 | p95 | Waiter wakes | p50 | p95 | Log |', '|---|---|---|---|---|---|---|---|---|',
    ...timed.map((entry) => `| ${entry.version} | ${String(entry.load).replace(/[{}]/g, '').trim().split(/\s+/)[0]} | ${entry.inbox.samples.length} | ${time(entry.inbox.p50)} | ${time(entry.inbox.p95)} | ${entry.waiter.samples.length} | ${time(entry.waiter.p50)} | ${time(entry.waiter.p95)} | \`logs/${entry.run}.jsonl\`${entry === main ? ' (the record\'s session)' : ''} |`)],
  decision: [`> ${words.decision.question}`, '', ...words.decision.answers.flatMap(({ answer, costs }) => [`- **${answer}**`, ...costs.map((cost) => `  - ${cost}`)])],
  quotes: quotes.flatMap((quote) => [`Post \`${posts.find(({ post }) => post.nonce === quote.nonce)?.post.id}\`, nonce \`${quote.nonce}\`. The entry's \`turnOrigin\` is \`${quote.turnOrigin}\` and its \`origin\` is:`, '', '```json', JSON.stringify(quote.origin), '```', '', 'The model received:', '', '```text', quote.received, '```', '']),
};
const report = join(spike, 'README.md');
if (existsSync(report)) {
  let body = readFileSync(report, 'utf8');
  for (const [name, lines] of Object.entries(blocks)) {
    const open = `<!-- generated: ${name} -->`, close = `<!-- end: ${name} -->`;
    if (!body.includes(open) || !body.includes(close)) throw new Error(`README.md has no ${name} block`);
    body = `${body.slice(0, body.indexOf(open) + open.length)}\n${lines.join('\n')}\n${body.slice(body.indexOf(close))}`;
  }
  writeFileSync(report, body);
}
console.log(`runs ${runs.length}, sessions ${Object.keys(sessions).length}, posts ${posts.length}, controls ${controls.length}, settings ${shapes.size}, quotes ${quotes.length}`);
for (const line of notes) console.log(line);
