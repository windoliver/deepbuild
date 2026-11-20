// The stand-in for gh and GitHub in #2818's tests (README: Surface choices). Issues are JSON files in the folder
// $T2818_GH names; one it creates is numbered from 9900 and carries `created`. Every call is recorded there, in
// calls.jsonl. It answers `issue create`, `view`, `list`, `comment`, `close`, `reopen` and `edit`, `auth status` and
// `repo view`; any other call is recorded, refused and exits 1, so it can't read as done. Nothing reaches the network.
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.env.T2818_GH;
const args = process.argv.slice(2);
appendFileSync(join(folder, 'calls.jsonl'), `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
const refuse = (message) => {
  console.error(message);
  process.exit(1);
};
const VALUED = new Set(['--json', '-q', '--jq', '--title', '-t', '--body', '-b', '--body-file', '-F', '--comment', '-c', '--state', '-s', '--limit', '-L',
  '--label', '-l', '--repo', '-R', '--search', '-S', '--add-label', '--remove-label', '--assignee', '-a', '--author', '-A', '--reason', '-r', '--milestone', '-m']);
const flag = (...names) => {
  for (let at = 0; at < args.length; at++) for (const name of names) {
    if (args[at] === name) return args[at + 1];
    if (args[at].startsWith(`${name}=`)) return args[at].slice(name.length + 1);
  }
  return undefined;
};
const every = (...names) => args.flatMap((arg, at) => (names.includes(args[at - 1]) ? [arg] : names.flatMap((name) => (arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []))));
const text = (...names) => {
  const file = flag('--body-file', '-F');
  return flag(...names) ?? (file === undefined ? undefined : readFileSync(file === '-' ? 0 : file, 'utf8'));
};
const positional = () => {
  const found = [];
  for (let at = 2; at < args.length; at++) {
    if (args[at].startsWith('-')) {
      if (VALUED.has(args[at])) at++;
      continue;
    }
    found.push(args[at]);
  }
  return found;
};
const path = (number) => join(folder, `issue-${number}.json`);
const load = (number) => (existsSync(path(number)) ? JSON.parse(readFileSync(path(number), 'utf8')) : null);
const save = (issue) => writeFileSync(path(issue.number), `${JSON.stringify(issue, null, 2)}\n`);
const all = () => readdirSync(folder).filter((name) => /^issue-\d+\.json$/.test(name)).map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
// The first free number, taken by an exclusive create, so issues filed at once never share one.
function create(issue) {
  for (let number = 9900; ; number++) {
    try {
      writeFileSync(path(number), `${JSON.stringify({ ...issue, number }, null, 2)}\n`, { flag: 'wx' });
      return number;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}
const url = (number) => `https://github.com/fixture/fixture-2818/issues/${number}`;
const numberOf = (ref) => Number(String(ref ?? '').match(/(\d+)\/?$/)?.[1]);

// --json fields, then -q/--jq with a plain path such as .state, .[].number or .[0].number; without --json, `plain`.
function show(value, plain) {
  const fields = flag('--json');
  const pick = (issue) => Object.fromEntries(fields.split(',').map((field) => [field,
    field === 'comments' ? issue.comments.map((body) => ({ body })) : field === 'labels' ? issue.labels.map((name) => ({ name })) : field === 'url' ? url(issue.number) : issue[field] ?? null]));
  if (!fields) return console.log(plain);
  const out = Array.isArray(value) ? value.map(pick) : pick(value);
  const query = flag('-q', '--jq');
  if (!query) return console.log(JSON.stringify(out));
  let values = [out];
  for (const part of query.replace(/^\./, '').split('.').filter(Boolean)) {
    const [, name, brackets, index] = part.match(/^(\w*)(\[(\d*)\])?$/) ?? refuse(`stand-in gh: --jq takes a plain path only: ${query}`);
    values = values.flatMap((one) => {
      const got = name ? one?.[name] : one;
      if (!brackets) return [got];
      return index === '' ? got ?? [] : [got?.[Number(index)]];
    });
  }
  for (const one of values) console.log(typeof one === 'object' && one !== null ? JSON.stringify(one) : String(one ?? ''));
}
// GitHub's search, cut to what a script asks of it: its qualifiers dropped, the rest a phrase the title or body holds.
const QUALIFIER = /\b(?:in|is|label|state|author|assignee|sort|type|repo|no|reason):\S+/g;
const found = (issue, search) => {
  const phrase = search.replace(QUALIFIER, ' ').replaceAll('"', ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return !phrase || `${issue.title}\n${issue.body}`.toLowerCase().replace(/\s+/g, ' ').includes(phrase);
};

const [noun, verb] = args;
if (noun === 'auth' && verb === 'status') {
  console.log('github.com\n  ✓ Logged in to github.com account fixture (stand-in)');
  process.exit(0);
}
if (noun === 'repo' && verb === 'view') {
  const repo = { nameWithOwner: 'fixture/fixture-2818', name: 'fixture-2818', owner: { login: 'fixture' }, url: 'https://github.com/fixture/fixture-2818', defaultBranchRef: { name: 'main' } };
  const fields = flag('--json');
  console.log(fields ? JSON.stringify(Object.fromEntries(fields.split(',').map((field) => [field, repo[field] ?? null]))) : repo.nameWithOwner);
  process.exit(0);
}
if (noun !== 'issue') refuse(`stand-in gh: no ${args.join(' ')}`);
if (verb === 'create') {
  const title = flag('--title', '-t');
  if (!title) refuse('stand-in gh: issue create needs --title');
  const number = create({ title, body: text('--body', '-b') ?? '', state: 'OPEN', comments: [], labels: every('--label', '-l').flatMap((names) => names.split(',')), created: Date.now() });
  console.log(url(number));
} else if (verb === 'list') {
  const state = (flag('--state', '-s') ?? 'open').toUpperCase();
  const labels = every('--label', '-l').flatMap((names) => names.split(','));
  const search = flag('--search', '-S') ?? '';
  const list = all().filter((issue) => (state === 'ALL' || issue.state === state) && labels.every((label) => issue.labels.includes(label)) && found(issue, search)).sort((a, b) => b.number - a.number);
  show(list, list.map((issue) => `${issue.number}\t${issue.state}\t${issue.title}\t${issue.labels.join(', ')}\t`).join('\n'));
} else {
  const issue = load(numberOf(positional()[0]));
  if (!issue) refuse(`GraphQL: Could not resolve to an issue or pull request with the number of ${positional()[0]}. (repository.issue)`);
  if (verb === 'view') show(issue, `title:\t${issue.title}\nstate:\t${issue.state}\nnumber:\t${issue.number}\n--\n${issue.body}`);
  else if (verb === 'close' || verb === 'reopen') {
    issue.state = verb === 'close' ? 'CLOSED' : 'OPEN';
    const comment = text('--comment', '-c');
    if (comment) issue.comments.push(comment);
    save(issue);
  } else if (verb === 'comment') {
    const body = text('--body', '-b');
    if (!body) refuse('stand-in gh: issue comment needs --body');
    issue.comments.push(body);
    save(issue);
  } else if (verb === 'edit') {
    issue.title = flag('--title', '-t') ?? issue.title;
    issue.body = text('--body', '-b') ?? issue.body;
    issue.labels = [...new Set([...issue.labels, ...every('--add-label').flatMap((names) => names.split(','))])];
    save(issue);
  } else refuse(`stand-in gh: no ${args.join(' ')}`);
}
