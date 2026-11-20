// The recording stand-in for `gh` in #2340's acceptance tests (README: The stand-in). helpers.mjs puts a `gh` first on
// PATH that runs this file as `node gh-standin.mjs <tracker.json> <calls.log> <gh's own arguments>`. It logs every call,
// one JSON array of arguments a line, and answers from the tracker file:
//
//   gh api repos/<owner>/<repo>/issues?state=<open|closed>&per_page=100&page=<n>   one page of 100, as the REST endpoint
//   gh issue list --state open [--limit <n>] --json <fields>                       the open issues, cut to --limit (30)
//   gh auth status, gh --version
//
// The parameters of `gh api` may also come as -f/-F/--field/--raw-field key=value with -X GET or --method GET. A page
// past the end is []. The closed issues are served only page by page; with `failFromPage` set, every page of the closed
// issues from that one on fails as an HTTP 502 does. Anything else exits 1, naming what it refused. Node built-ins only.
import { appendFileSync, readFileSync } from 'node:fs';

const [trackerFile, logFile, ...args] = process.argv.slice(2);
appendFileSync(logFile, `${JSON.stringify(args)}\n`);
const { issues, failFromPage = null } = JSON.parse(readFileSync(trackerFile, 'utf8'));
const PAGE = 100;
const REPO_URL = 'https://github.com/windoliver/deepbuild';

// The exit status is set, never forced: process.exit could cut a long answer short on a pipe.
function refuse(message) {
  process.stderr.write(`gh stand-in (#2340 acceptance tests): ${message}\n`);
  process.exitCode = 1;
}

// Flags as `--name value` or `--name=value`; `takes` lists the ones that take a value.
function parse(words, takes) {
  const flags = [];
  const positional = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word.startsWith('-') || word === '-') {
      positional.push(word);
      continue;
    }
    const [name, inline] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined];
    if (!takes.includes(name)) return { error: `the flag ${name} isn't served` };
    const value = inline ?? words[++i];
    if (value === undefined) return { error: `the flag ${name} has no value` };
    flags.push([name, value]);
  }
  return { flags, positional };
}

function api(words) {
  const parsed = parse(words, ['-X', '--method', '-f', '-F', '--field', '--raw-field', '-H', '--header']);
  if (parsed.error) return refuse(`${parsed.error}; ask for each page with gh api repos/{owner}/{repo}/issues?state=closed&per_page=100&page=<n>`);
  const { flags, positional } = parsed;
  if (positional.length !== 1) return refuse(`gh api takes one endpoint here, not ${JSON.stringify(positional)}`);
  const fields = flags.filter(([name]) => ['-f', '-F', '--field', '--raw-field'].includes(name)).map(([, value]) => value);
  const method = (flags.find(([name]) => name === '-X' || name === '--method')?.[1] ?? (fields.length ? 'POST' : 'GET')).toUpperCase();
  if (method !== 'GET') return refuse(`only GET is served, and this call is a ${method}`);
  const [path, query = ''] = positional[0].replace(/^\//, '').split('?');
  if (!/^repos\/[^/]+\/[^/]+\/issues$/.test(path)) return refuse(`the endpoint ${path} isn't served; only repos/<owner>/<repo>/issues is`);
  const params = new URLSearchParams(query);
  for (const field of fields) {
    const at = field.indexOf('=');
    if (at < 1) return refuse(`the field ${field} isn't key=value`);
    params.set(field.slice(0, at), field.slice(at + 1));
  }
  const state = params.get('state') ?? 'open';
  if (state !== 'open' && state !== 'closed') return refuse(`state=${state} isn't served; ask for state=open or state=closed`);
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  if (state === 'closed' && failFromPage !== null && page >= failFromPage) {
    process.stderr.write(`gh: Server Error (HTTP 502)\n{"message":"Server Error"} (${REPO_URL.replace('github.com', 'api.github.com/repos')}/issues?state=closed&per_page=100&page=${page})\n`);
    process.exitCode = 1;
    return;
  }
  const listed = issues.filter((issue) => issue.state === state).slice((page - 1) * PAGE, page * PAGE);
  process.stdout.write(`${JSON.stringify(listed.map((issue) => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    state_reason: issue.state === 'closed' ? issue.reason : null,
    body: issue.body,
    html_url: `${REPO_URL}/issues/${issue.number}`,
  })))}\n`);
}

function issueList(words) {
  const parsed = parse(words, ['--state', '-s', '--limit', '-L', '--json', '--repo', '-R']);
  if (parsed.error) return refuse(parsed.error);
  const { flags, positional } = parsed;
  if (positional.length) return refuse(`gh issue list takes no argument ${JSON.stringify(positional)}`);
  const value = (...names) => flags.findLast(([name]) => names.includes(name))?.[1];
  const state = (value('--state', '-s') ?? 'open').toLowerCase();
  if (state !== 'open') return refuse(`gh issue list --state ${state} isn't served: the closed issues come only page by page, from gh api repos/{owner}/{repo}/issues?state=closed&per_page=100&page=<n>`);
  const fields = value('--json');
  if (!fields) return refuse('gh issue list is served only with --json <fields>');
  const limit = Number(value('--limit', '-L') ?? 30);
  const shown = (issue) => {
    const all = { number: issue.number, title: issue.title, body: issue.body, state: 'OPEN', stateReason: null, url: `${REPO_URL}/issues/${issue.number}` };
    return Object.fromEntries(fields.split(',').map((field) => field.trim()).filter((field) => field in all).map((field) => [field, all[field]]));
  };
  process.stdout.write(`${JSON.stringify(issues.filter((issue) => issue.state === 'open').slice(0, limit).map(shown))}\n`);
}

if (args[0] === '--version') process.stdout.write('gh version 2.99.0 (stand-in for #2340 acceptance tests)\n');
else if (args[0] === 'auth' && args[1] === 'status') process.stdout.write('github.com\n  Logged in to github.com (stand-in)\n');
else if (args[0] === 'api') api(args.slice(1));
else if (args[0] === 'issue' && args[1] === 'list') issueList(args.slice(2));
else refuse(`unsupported command: gh ${args.join(' ')}`);
