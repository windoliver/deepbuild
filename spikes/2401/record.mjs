// Spike #2401: what one headless Claude Code job costs a plan window under its default label and under
// CLAUDE_CODE_ENTRYPOINT=deepbuild. One fixed read-only job, the review check's shape, run 20 times under each label,
// interleaved, on one account and model; each run's tokens from its stream, both windows before and after as the
// runner reads them (rate_limit_event in the stream), and the reading by the rule written before the runs.
//
//   node spikes/2401/record.mjs --claude <path> --dry                 # $0: invalid token, tool lists only
//   node spikes/2401/record.mjs --claude <path> --probe               # one real run: what its stream carries
//   node spikes/2401/record.mjs --claude <path> --own-use <pct/Mtok> --basis "<words>" [--streams <dir>]
//
// The last form spends plan usage: run it once, by hand, with nothing else on the account. It writes
// spikes/2401/record.json. Raw streams stay in --streams (outside the repo); the record pins each by SHA-256 and keeps
// only the fields below, never a session ID, account ID or path.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const facts = JSON.parse(readFileSync(join(root, 'adapters/claude-code.facts.json'), 'utf8'));
const PER_LABEL = 20;
const LABELS = ['default', 'deepbuild'];
const ENTRYPOINT = { default: null, deepbuild: 'deepbuild' };
const MIN_KEPT = 15;
const RATIO_FLOOR = 1.25;
const WINDOWS = ['five_hour', 'seven_day'];

// The review check's job (packages/hub/src/kinds.ts): its prompt over the default rubric and one fixed diff, and the
// runner's launch: the facts' readOnlyJob args, then what AGENTS['claude-code'].confine adds for no MCP server and no
// sub-agent (packages/runner/src/agents.ts).
const RUBRIC = [
  'wrong-comparison: an assignment where a comparison is meant',
  'unchecked-parse: parsing input that isn\'t validated or caught',
  'swallowed-error: a catch block that drops the error',
  'off-by-one: a bound, index or range that is one too many or too few',
  'unguarded-null: a value that may be null or undefined used without a check',
];
const DIFF = readFileSync(join(root, 'spikes/2401/job/diff.patch'), 'utf8');
const PROMPT = [
  'Review this diff against the rubric. Answer with one JSON object and nothing else: {"findings": [{"file": "<path>", "line": <line in the new file>, "rule": "<a rule of the rubric>", "quote": "<the text at that line>"}]}. List only findings on lines the diff adds or changes; an empty list when there are none.',
  '', 'Rubric:', ...RUBRIC.map((r) => `- ${r}`), '', 'Diff:', DIFF,
].join('\n');
const ARGS = [...facts.launch.readOnlyJob.args, '--mcp-config', JSON.stringify({ mcpServers: {} }), '--tools', 'Read,Grep,Glob'];

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const has = (name) => process.argv.includes(name);

/** One run of the job under `label`: its raw stream and when it ran. */
function run(claude, label, { home = homedir(), token } = {}) {
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'spike-2401-'));
  // Only what the runner passes (packages/runner/src/runner.ts ALLOWED_ENV and AGENTS reach; USER is how Claude Code
  // finds its keychain login, where the runner hands the token itself), never the caller's
  // CLAUDECODE or CLAUDE_CODE_ENTRYPOINT: under default the variable is unset, as in a job the runner starts.
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const name of ['USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM']) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { HOME: home, TMPDIR: work, CLAUDE_CODE_TMPDIR: work, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
  if (ENTRYPOINT[label]) env.CLAUDE_CODE_ENTRYPOINT = ENTRYPOINT[label];
  if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return new Promise((resolve, reject) => {
    const started = new Date();
    const child = spawn(claude, ARGS, { cwd: work, env, stdio: ['pipe', 'pipe', 'ignore'] });
    const out = [];
    child.stdout.on('data', (c) => out.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      rmSync(work, { recursive: true, force: true });
      const bytes = Buffer.concat(out);
      const rows = bytes.toString('utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
      resolve({ label, code, started, ended: new Date(), bytes, rows, apiKeySet: Object.keys(env).some((k) => facts.billing.apiKeyVariables.includes(k)) });
    });
    child.stdin.end(PROMPT);
  });
}

/** The window readings a stream carries, in order, as the runner reads them: rate_limit_event's utilization. */
const readings = (rows) => rows.flatMap((v) => {
  const l = v?.rate_limit_info;
  if (!l || !WINDOWS.includes(l.rateLimitType) || typeof l.utilization !== 'number') return [];
  return [{ window: l.rateLimitType, used_percent: l.utilization * 100, resets_at: typeof l.resetsAt === 'number' ? l.resetsAt : null, status: l.status ?? null }];
});
const lastOf = (rs, w) => { const x = rs.filter((r) => r.window === w).at(-1); return x ? { used_percent: x.used_percent, resets_at: x.resets_at } : null; };

/** The fields of a run's first and result entries the record keeps: nothing that names a session, account or path. */
// The first entry is the stream's system init: your user settings' SessionStart hooks, which a job's
// --setting-sources user keeps, write their hook_started and hook_response entries before it.
const firstEntry = (rows) => {
  const f = rows.find((v) => v?.type === 'system' && v.subtype === 'init') ?? {};
  return { type: f.type, subtype: f.subtype, model: f.model, claude_code_version: f.claude_code_version, tools: f.tools, agents: f.agents, permissionMode: f.permissionMode, apiKeySource: f.apiKeySource };
};
const resultEntry = (rows) => {
  const r = rows.findLast((v) => v?.type === 'result') ?? {};
  const u = r.usage ?? {};
  return {
    type: r.type, subtype: r.subtype, is_error: r.is_error, num_turns: r.num_turns, duration_ms: r.duration_ms, total_cost_usd: r.total_cost_usd,
    usage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens },
    models: Object.keys(r.modelUsage ?? {}),
  };
};

/** The account a run's home is signed into, compared and never kept. */
const account = () => {
  try { return JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).oauthAccount?.accountUuid ?? null; } catch { return null; }
};

const total = (t) => t.input + t.output + t.cache_creation + t.cache_read;
const change = (run, w) => {
  const { before, after } = run.window[w];
  return !before || !after || before.resets_at !== after.resets_at ? null : after.used_percent - before.used_percent;
};

function whyLeftOut(run, ceiling) {
  const res = run.result_entry;
  if (res.subtype !== 'success' || res.is_error !== false) return `the run ended ${res.subtype}${res.is_error ? ' (is_error)' : ''}`;
  const c = change(run, 'five_hour');
  if (c === null) return 'its 5-hour window was not read on both sides, or reset during the run';
  if (c < 0) return 'its 5-hour window fell during the run';
  const own = (total(run.tokens) / 1e6) * ceiling;
  if (c > own + 1e-9) return `its 5-hour window moved ${c} points, more than its own use (${own})`;
  return null;
}

/** The reading of window `w` over the kept runs, by the rule written before the runs. */
function reading(list, w) {
  const out = { status: 'MEASURED' };
  for (const label of LABELS) {
    const kept = list.filter((r) => r.label === label && r.kept && change(r, w) !== null && change(r, w) >= 0);
    const rates = kept.map((r) => change(r, w) / (total(r.tokens) / 1e6));
    const sum = kept.reduce((s, r) => s + change(r, w), 0);
    const tokens = kept.reduce((s, r) => s + total(r.tokens), 0);
    out[label] = { runs: kept.map((r) => r.n), pct_per_mtok: kept.length ? sum / (tokens / 1e6) : null, range: kept.length ? [Math.min(...rates), Math.max(...rates)] : null };
  }
  const [d, b] = [out.default, out.deepbuild];
  if (d.runs.length < MIN_KEPT || b.runs.length < MIN_KEPT || !(b.pct_per_mtok > 0)) Object.assign(out, { status: 'INCONCLUSIVE', ratio: null, ranges_apart: null });
  else Object.assign(out, { ratio: d.pct_per_mtok / b.pct_per_mtok, ranges_apart: d.range[0] > b.range[1] || b.range[0] > d.range[1] });
  return out;
}
const outcome = (r) => (r.status === 'MEASURED' && r.ratio >= RATIO_FLOOR && r.ranges_apart ? 'offered and off' : 'not set');

const claude = arg('--claude');
if (!claude) { console.error('--claude <path> names the Claude Code binary'); process.exit(2); }

if (has('--dry')) {
  // No plan usage: a throwaway home and an invalid token fail every turn before a model call; the first entry is
  // written before that.
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'spike-2401-home-'));
  const out = {};
  for (const label of LABELS) {
    const r = await run(claude, label, { home, token: 'sk-ant-oat01-invalid' });
    out[label] = { first_entry: firstEntry(r.rows), result: resultEntry(r.rows) };
  }
  rmSync(home, { recursive: true, force: true });
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (has('--probe')) {
  const r = await run(claude, 'default');
  console.log(JSON.stringify({
    first_entry: firstEntry(r.rows), result_entry: resultEntry(r.rows),
    kinds: r.rows.map((v) => `${v.type}${v.subtype ? `:${v.subtype}` : ''}`),
    tokens: resultEntry(r.rows).usage,
    rate_limit_events: r.rows.filter((v) => v?.type === 'rate_limit_event').map((v) => v.rate_limit_info),
  }, null, 2));
  process.exit(0);
}

const ceiling = Number(arg('--own-use'));
const basis = arg('--basis');
if (!(ceiling > 0) || !basis) { console.error('--own-use <window percent per million tokens> and --basis "<words>" fix the ceiling before the runs'); process.exit(2); }
const own_use = { max_pct_per_mtok: ceiling, basis, fixed_at: new Date().toISOString() };
const streams = arg('--streams') ?? mkdtempSync(join(realpathSync(tmpdir()), 'spike-2401-streams-'));
mkdirSync(streams, { recursive: true });

const accounts = new Set([account()]);
// One opening run reads the window before run 1; it is on the record as `lead` and counts under neither label.
const lead = await run(claude, 'default');
writeFileSync(join(streams, 'lead.jsonl'), lead.bytes);
const done = [];
for (let i = 0; i < 2 * PER_LABEL; i++) {
  const label = LABELS[i % 2];
  const r = await run(claude, label);
  accounts.add(account());
  writeFileSync(join(streams, `run-${String(i + 1).padStart(2, '0')}-${label}.jsonl`), r.bytes);
  done.push(r);
  const rs = readings(r.rows);
  console.error(`run ${i + 1}/40 ${label}: ${resultEntry(r.rows).subtype}, ${rs.map((x) => `${x.window} ${x.used_percent}`).join(', ') || 'no reading'}`);
}

// A window before and after each run, as the runner reads it: after is the run's own last reading of that window,
// before the last reading of it the previous run (or the lead) gave. That a reading already counts the request it
// came with is assumed, not shown: the probe saw one reading a run (README: what the probe found).
const runs = done.map((r, i) => {
  const rs = readings(r.rows);
  const prev = readings((i ? done[i - 1] : lead).rows);
  const window = {};
  for (const w of WINDOWS) window[w] = { before: lastOf(prev, w), after: lastOf(rs, w) };
  const res = resultEntry(r.rows);
  const u = res.usage;
  return {
    n: i + 1, label: r.label, entrypoint: ENTRYPOINT[r.label], account: 1, api_key_set: r.apiKeySet,
    started_at: r.started.toISOString(), ended_at: r.ended.toISOString(),
    first_entry: firstEntry(r.rows), result_entry: res, stream_sha256: sha256(r.bytes),
    tokens: { input: u.input_tokens, output: u.output_tokens, cache_creation: u.cache_creation_input_tokens, cache_read: u.cache_read_input_tokens },
    readings: rs.map(({ window: w, used_percent, resets_at, status }) => ({ window: w, used_percent, resets_at, status })),
    window,
  };
});
for (const r of runs) { const why = whyLeftOut(r, ceiling); r.kept = why === null; r.left_out_because = why; }

const tools = {};
for (const label of LABELS) tools[label] = [...(runs.find((r) => r.label === label).first_entry.tools ?? [])].sort();
const differences = LABELS.flatMap((label) => {
  const other = LABELS.find((l) => l !== label);
  return tools[label].filter((t) => !tools[other].includes(t)).map((tool) => ({ tool, under: label, flag: `--disallowedTools ${tool}` }));
});
const five = reading(runs, 'five_hour');
const record = {
  issue: 2401,
  host: { model: execFileSync('/usr/sbin/sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim(), os: 'macOS', os_build: execFileSync('/usr/bin/sw_vers', ['-buildVersion'], { encoding: 'utf8' }).trim() },
  accounts: accounts.has(null) ? 0 : accounts.size,
  claude_code_version: runs[0].first_entry.claude_code_version,
  job: { args: ARGS, prompt_sha256: sha256(PROMPT) },
  own_use,
  runs,
  lead: { started_at: lead.started.toISOString(), ended_at: lead.ended.toISOString(), stream_sha256: sha256(lead.bytes), readings: readings(lead.rows) },
  left_out: runs.filter((r) => !r.kept).length,
  reading: { date: runs.at(-1).ended_at.slice(0, 10), five_hour: five, seven_day: reading(runs, 'seven_day'), outcome: outcome(five) },
  tools: { ...tools, differences },
  decision: outcome(five),
  maker_statement: null,
};
writeFileSync(join(root, 'spikes/2401/record.json'), `${JSON.stringify(record, null, 2)}\n`);
console.error(`record: ${record.left_out} left out; 5-hour ${five.status}${five.ratio ? ` ratio ${five.ratio.toFixed(3)}` : ''}; decision ${record.decision}; streams in ${streams}`);
