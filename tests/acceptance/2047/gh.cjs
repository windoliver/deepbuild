// The stand-in for gh in #2047's acceptance tests (README: The stand-in). It plays one GitHub repository,
// fixture/closed, whose issues and pull requests are JSON files in its state folder: the first argument, which the
// wrapper the sandbox puts first on PATH passes it. It records every call in calls.jsonl, with the text it read from
// stdin, and serves back what earlier calls wrote, as GitHub would. Every call for an issue fail.json names fails. A
// call it doesn't support exits 1 and is recorded in refused.jsonl too, so it can't read as done. It never reaches
// the network.
'use strict';
const { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const [state, ...args] = process.argv.slice(2);
const SLUG = 'fixture/closed';
/** The login of whoever runs the sweep: every comment written through the stand-in carries it. */
const SWEEPER = 'fixture-sweeper';
const call = { t: Date.now(), args, cwd: process.cwd() };
if (args.some((arg, i) => (arg === '-' && ['-F', '--body-file'].includes(args[i - 1])) || arg === '--body-file=-')) call.stdin = readFileSync(0, 'utf8');
appendFileSync(join(state, 'calls.jsonl'), `${JSON.stringify(call)}\n`);

function refuse(why) {
  appendFileSync(join(state, 'refused.jsonl'), `${JSON.stringify({ args, why })}\n`);
  process.stderr.write(`stand-in gh: ${why} (tests/acceptance/2047/README.md lists what it serves)\n`);
  process.exit(1);
}

// The flags each command takes, every one with a value; any other flag is refused.
const VALUED = {
  api: { '-X': 'method', '--method': 'method', '-H': 'header', '--header': 'header', '-f': 'field', '--raw-field': 'field', '-F': 'field', '--field': 'field', '-q': 'jq', '--jq': 'jq', '--hostname': 'hostname' },
  'issue view': { '--json': 'json', '-q': 'jq', '--jq': 'jq', '-R': 'repo', '--repo': 'repo' },
  'issue reopen': { '-c': 'comment', '--comment': 'comment', '-R': 'repo', '--repo': 'repo' },
  'issue comment': { '-b': 'body', '--body': 'body', '-F': 'file', '--body-file': 'file', '-R': 'repo', '--repo': 'repo' },
  'pr list': { '-s': 'state', '--state': 'state', '--json': 'json', '-q': 'jq', '--jq': 'jq', '-L': 'limit', '--limit': 'limit', '-B': 'base', '--base': 'base', '-R': 'repo', '--repo': 'repo' },
  'pr view': { '--json': 'json', '-q': 'jq', '--jq': 'jq', '-R': 'repo', '--repo': 'repo' },
  'repo view': { '--json': 'json', '-q': 'jq', '--jq': 'jq' },
};
function parse(command, from) {
  const valued = VALUED[command];
  const flags = {}, positional = [];
  for (let i = from; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-') || arg === '-') { positional.push(arg); continue; }
    let name = arg, value;
    if (arg.startsWith('--')) { const eq = arg.indexOf('='); if (eq > 0) [name, value] = [arg.slice(0, eq), arg.slice(eq + 1)]; }
    else if (arg.length > 2) [name, value] = [arg.slice(0, 2), arg.slice(2).replace(/^=/, '')];
    const key = valued[name];
    if (!key) refuse(`${command} with ${name}, which it doesn't serve`);
    if (value === undefined) {
      if (i + 1 >= args.length) refuse(`${command}: ${name} needs a value`);
      value = args[++i];
    }
    (flags[key] ??= []).push(value);
  }
  return { flags, positional, one: (key) => flags[key]?.at(-1) };
}

const file = (kind, n) => join(state, `${kind}-${n}.json`);
const load = (kind, n) => (existsSync(file(kind, n)) ? JSON.parse(readFileSync(file(kind, n), 'utf8')) : null);
const save = (kind, item) => writeFileSync(file(kind, item.number), JSON.stringify(item, null, 1));
const all = (kind) => readdirSync(state).filter((name) => name.startsWith(`${kind}-`) && name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(state, name), 'utf8')));
const failing = existsSync(join(state, 'fail.json')) ? JSON.parse(readFileSync(join(state, 'fail.json'), 'utf8')) : [];
const numberOf = (ref) => { const m = String(ref ?? '').match(/(?:^#?|\/)(\d+)\/?$/); return m ? Number(m[1]) : NaN; };
const url = (kind, n) => `https://github.com/${SLUG}/${kind === 'pr' ? 'pull' : 'issues'}/${n}`;

// What gh's --json gives for an issue and a pull request, and what GitHub's REST issue list gives for each item.
const issueView = (issue) => ({
  number: issue.number, title: issue.title, body: issue.body, state: issue.state, stateReason: issue.stateReason ?? null,
  closed: issue.state === 'CLOSED', url: url('issue', issue.number), labels: [], author: { login: 'fixture-person' },
  createdAt: '2026-11-01T00:00:00Z', closedAt: issue.state === 'CLOSED' ? '2026-11-02T00:00:00Z' : null,
  comments: (issue.comments ?? []).map((comment, i) => ({
    id: `IC_${issue.number}_${i + 1}`, author: { login: comment.login }, authorAssociation: 'MEMBER', body: comment.body, createdAt: comment.createdAt,
    url: `${url('issue', issue.number)}#issuecomment-${issue.number}${i + 1}`, viewerDidAuthor: comment.login === SWEEPER,
  })),
});
const ISSUE_FIELDS = Object.keys(issueView({ number: 0, comments: [] }));
const closing = (n) => ({ id: `I_${n}`, number: n, url: url('issue', n), repository: { id: 'R_closed', name: 'closed', owner: { id: 'O_fixture', login: 'fixture' } } });
const prView = (pr) => ({
  number: pr.number, title: pr.title, body: pr.body ?? '', state: pr.state, closed: pr.state !== 'OPEN', isDraft: false, url: url('pr', pr.number),
  headRefName: `fixture/${pr.number}`, baseRefName: 'main', mergedAt: pr.state === 'MERGED' ? '2026-11-03T00:00:00Z' : null,
  closingIssuesReferences: (pr.closes ?? []).map(closing),
});
const PR_FIELDS = Object.keys(prView({ number: 0 }));
const restIssue = (issue) => ({
  number: issue.number, title: issue.title, state: issue.state.toLowerCase(), state_reason: issue.stateReason ? issue.stateReason.toLowerCase() : null,
  html_url: url('issue', issue.number), comments: (issue.comments ?? []).length, labels: [],
});
const restPr = (pr) => ({
  number: pr.number, title: pr.title, state: pr.state === 'OPEN' ? 'open' : 'closed', state_reason: null, html_url: url('pr', pr.number), comments: 0, labels: [],
  pull_request: { url: `https://api.github.com/repos/${SLUG}/pulls/${pr.number}`, html_url: url('pr', pr.number), merged_at: pr.state === 'MERGED' ? '2026-11-03T00:00:00Z' : null },
});

/** The answer as gh prints it: --json's fields, then -q/--jq with a plain path such as .body or .[].number. */
function emit(value, parsed, fields) {
  let out = value;
  if (fields) {
    const wanted = parsed.one('json');
    if (!wanted) refuse(`${args.slice(0, 2).join(' ')} without --json: it answers in JSON only`);
    const names = wanted.split(',').map((name) => name.trim()).filter(Boolean);
    const unknown = names.filter((name) => !fields.includes(name));
    if (unknown.length) refuse(`--json ${unknown.join(',')}, which it doesn't serve (it serves ${fields.join(',')})`);
    const pick = (item) => Object.fromEntries(names.map((name) => [name, item[name]]));
    out = Array.isArray(value) ? value.map(pick) : pick(value);
  }
  const jq = parsed.one('jq')?.trim();
  if (!jq) return void process.stdout.write(`${JSON.stringify(out)}\n`);
  if (!jq.startsWith('.')) refuse(`--jq ${jq}: it takes a plain path such as .body or .[].number`);
  let values = [out];
  for (const part of jq === '.' ? [] : jq.slice(1).split('.')) {
    const m = part.match(/^(\w*)(\[\])?$/);
    if (!m) refuse(`--jq ${jq}: it takes a plain path such as .body or .[].number`);
    values = values.flatMap((one) => { const got = m[1] ? one?.[m[1]] : one; return m[2] ? (Array.isArray(got) ? got : []) : [got]; });
  }
  for (const one of values) process.stdout.write(`${one === null || one === undefined ? 'null' : typeof one === 'object' ? JSON.stringify(one) : String(one)}\n`);
}

const [noun, verb] = args;
if (noun === '--version' || noun === 'version') { process.stdout.write('gh version 0.0.0 (the stand-in of tests/acceptance/2047)\n'); process.exit(0); }
if (noun === 'auth' && verb === 'status') { process.stdout.write(`github.com\n  Logged in to github.com account ${SWEEPER} (stand-in)\n`); process.exit(0); }
if (noun === 'repo' && verb === 'view') {
  const parsed = parse('repo view', 2);
  if (parsed.positional.length) refuse('repo view of another repository');
  emit({ nameWithOwner: SLUG, name: 'closed', owner: { login: 'fixture' }, url: `https://github.com/${SLUG}`, defaultBranchRef: { name: 'main' } }, parsed, ['nameWithOwner', 'name', 'owner', 'url', 'defaultBranchRef']);
  process.exit(0);
}
if (noun === 'api') {
  // GitHub's REST issue list, one page a call: GET repos/<owner>/<repo>/issues with state, per_page (at most 100, 30
  // when unset), page, sort and direction, in the path's query or as -f/-F fields of a GET. Items carry no body.
  const parsed = parse('api', 1);
  if (parsed.positional.length !== 1) refuse('api takes one path');
  const method = (parsed.one('method') ?? (parsed.flags.field ? 'POST' : 'GET')).toUpperCase();
  if (method !== 'GET') refuse(`api ${method} ${parsed.positional[0]}: it only reads`);
  const target = new URL(parsed.positional[0].replace(/^\//, ''), 'https://api.github.com/');
  for (const field of parsed.flags.field ?? []) {
    const eq = field.indexOf('=');
    if (eq < 1) refuse(`api field ${field}`);
    target.searchParams.append(field.slice(0, eq), field.slice(eq + 1));
  }
  if (!/^\/repos\/[^/]+\/[^/]+\/issues$/.test(target.pathname)) refuse(`api ${target.pathname}: it serves repos/<owner>/<repo>/issues only`);
  const query = Object.fromEntries(target.searchParams);
  const extra = Object.keys(query).filter((key) => !['state', 'per_page', 'page', 'sort', 'direction'].includes(key));
  if (extra.length) refuse(`api issues with ${extra.join(', ')}`);
  const wanted = query.state ?? 'open';
  const per = Number(query.per_page ?? 30), page = Number(query.page ?? 1);
  if (!['open', 'closed', 'all'].includes(wanted) || !Number.isInteger(per) || per < 1 || !Number.isInteger(page) || page < 1) refuse(`api issues with ${target.search}`);
  const size = Math.min(per, 100);
  const items = [...all('issue').map(restIssue), ...all('pr').map(restPr)]
    .filter((item) => wanted === 'all' || item.state === wanted)
    .sort((a, b) => (query.direction === 'asc' ? a.number - b.number : b.number - a.number));
  emit(items.slice((page - 1) * size, page * size), parsed, null);
  process.exit(0);
}
if (noun === 'issue' && ['view', 'reopen', 'comment'].includes(verb)) {
  const parsed = parse(`issue ${verb}`, 2);
  if (parsed.positional.length !== 1) refuse(`issue ${verb} takes one issue`);
  const n = numberOf(parsed.positional[0]);
  if (failing.includes(n)) {
    process.stderr.write(`HTTP 502: Bad Gateway (https://api.github.com/graphql)\nstand-in gh: every call for issue #${n} fails, on purpose\n`);
    process.exit(1);
  }
  const issue = load('issue', n);
  if (!issue) {
    process.stderr.write(`GraphQL: Could not resolve to an issue or pull request with the number of ${n}. (repository.issue)\n`);
    process.exit(1);
  }
  if (verb === 'view') emit(issueView(issue), parsed, ISSUE_FIELDS);
  else if (verb === 'reopen') {
    // As gh: an issue that is already open stays as it is, and the comment isn't added.
    if (issue.state === 'OPEN') { process.stderr.write(`! Issue ${SLUG}#${n} (${issue.title}) is already open\n`); process.exit(0); }
    const comment = parsed.one('comment');
    if (comment) issue.comments.push({ login: SWEEPER, body: comment, createdAt: new Date().toISOString() });
    Object.assign(issue, { state: 'OPEN', stateReason: 'REOPENED' });
    save('issue', issue);
    process.stderr.write(`Reopened issue ${SLUG}#${n} (${issue.title})\n`);
  } else {
    const from = parsed.one('file');
    const text = parsed.one('body') ?? (from === undefined ? undefined : from === '-' ? call.stdin : readFileSync(from, 'utf8'));
    if (!text || !text.trim()) refuse('issue comment needs --body or --body-file with text');
    issue.comments.push({ login: SWEEPER, body: text, createdAt: new Date().toISOString() });
    save('issue', issue);
    process.stdout.write(`${url('issue', n)}#issuecomment-${n}${issue.comments.length}\n`);
  }
  process.exit(0);
}
if (noun === 'pr' && ['list', 'view'].includes(verb)) {
  const parsed = parse(`pr ${verb}`, 2);
  if (verb === 'list') {
    if (parsed.positional.length) refuse('pr list takes no arguments');
    const wanted = (parsed.one('state') ?? 'open').toLowerCase();
    const states = { open: ['OPEN'], closed: ['CLOSED', 'MERGED'], merged: ['MERGED'], all: ['OPEN', 'CLOSED', 'MERGED'] }[wanted];
    const limit = Number(parsed.one('limit') ?? 30);
    if (!states || !Number.isInteger(limit) || limit < 1) refuse(`pr list --state ${wanted} --limit ${parsed.one('limit')}`);
    const base = parsed.one('base');
    const prs = all('pr').filter((pr) => states.includes(pr.state) && (!base || base === 'main')).sort((a, b) => b.number - a.number).slice(0, limit);
    emit(prs.map(prView), parsed, PR_FIELDS);
  } else {
    if (parsed.positional.length !== 1) refuse('pr view takes one pull request');
    const pr = load('pr', numberOf(parsed.positional[0]));
    if (!pr) { process.stderr.write(`GraphQL: Could not resolve to a PullRequest with the number of ${parsed.positional[0]}. (repository.pullRequest)\n`); process.exit(1); }
    emit(prView(pr), parsed, PR_FIELDS);
  }
  process.exit(0);
}
if (noun === 'issue' && verb === 'list') refuse('issue list pages inside gh, where no stand-in can show its pages: list closed issues with gh api repos/<owner>/<repo>/issues?state=closed&per_page=100&page=<n>');
refuse(`no ${args.join(' ')}`);
