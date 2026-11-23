// The stand-in for gh and GitHub in #3064's acceptance tests (README: Stand-ins), started by a `gh` script first on
// PATH with T3064_GH naming its folder. Issues and pull requests are JSON files there, and every call is recorded with
// its time. `issue list --state closed --json number,stateReason` answers as GitHub does: each closed issue with the
// reason it was closed for. A pull request's head is a branch on the fixture's origin, and `pr merge` merges it into
// origin's main. A call it doesn't know exits 1 and is recorded too, so it can't read as done.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.env.T3064_GH;
const args = process.argv.slice(2);
const refuse = (message) => { console.error(message); process.exit(1); };
if (!folder) refuse('stand-in gh: T3064_GH is not set');
appendFileSync(join(folder, 'calls.jsonl'), `${JSON.stringify({ t: Date.now(), args, cwd: process.cwd() })}\n`);
const flag = (...names) => {
  for (let i = 0; i < args.length; i++) {
    for (const name of names) {
      if (args[i] === name) return args[i + 1];
      if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
    }
  }
  return undefined;
};
const text = (...names) => {
  const file = flag('--body-file', '-F');
  return flag(...names) ?? (file ? readFileSync(file === '-' ? 0 : file, 'utf8') : undefined);
};
const VALUED = new Set(['--json', '-q', '--jq', '--title', '-t', '--body', '-b', '--body-file', '-F', '--comment', '-c', '--state', '-s', '--limit', '-L', '--head', '-H', '--base', '-B', '--label', '-l', '--repo', '-R', '--search', '-S', '--add-label', '--remove-label', '--assignee', '-a', '--reason', '-r']);
const positional = () => {
  const out = [];
  for (let i = 2; i < args.length; i++) {
    if (args[i].startsWith('-')) { if (VALUED.has(args[i])) i++; continue; }
    out.push(args[i]);
  }
  return out;
};
const file = (kind, n) => join(folder, `${kind}-${n}.json`);
const load = (kind, n) => (existsSync(file(kind, n)) ? JSON.parse(readFileSync(file(kind, n), 'utf8')) : null);
const save = (kind, item) => writeFileSync(file(kind, item.number), JSON.stringify(item, null, 2));
const all = (kind) => readdirSync(folder).filter((name) => name.startsWith(`${kind}-`) && name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
const next = (key, start) => {
  const path = join(folder, 'counters.json');
  const counters = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const n = counters[key] ?? start;
  counters[key] = n + 1;
  writeFileSync(path, JSON.stringify(counters));
  return n;
};
const number = (ref) => Number(String(ref ?? '').match(/(\d+)\/?$/)?.[1]);
// --json fields, then -q/--jq with a plain path such as .state, .[].number or .comments[].body.
function show(value) {
  const fields = flag('--json');
  const pick = (item) => (fields ? Object.fromEntries(fields.split(',').map((field) => [field, field === 'comments' ? (item.comments ?? []).map((body) => ({ body })) : field === 'labels' ? (item.labels ?? []).map((name) => ({ name })) : item[field] ?? null])) : item);
  const out = Array.isArray(value) ? value.map(pick) : pick(value);
  const query = flag('-q', '--jq');
  if (query) {
    let values = [out];
    for (const part of query.replace(/^\./, '').split(/\.(?![^[]*\])/).filter(Boolean)) {
      const [, name, each] = part.match(/^([\w]*)(\[\])?$/) ?? refuse(`stand-in gh: --jq takes a plain path only: ${query}`);
      values = values.flatMap((one) => { const got = name ? one?.[name] : one; return each ? (got ?? []) : [got]; });
    }
    for (const one of values) console.log(typeof one === 'object' && one !== null ? JSON.stringify(one) : String(one ?? ''));
    return;
  }
  console.log(JSON.stringify(out));
}
const origin = () => readFileSync(join(folder, 'origin.txt'), 'utf8').trim();
const git = (cwd, ...rest) => execFileSync('git', rest, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const [noun, verb] = args;
const ref = positional()[0];
if (noun === 'auth' && verb === 'status') { console.log('Logged in to github.com as fixture'); process.exit(0); }
if (noun === 'repo' && verb === 'view') { show({ nameWithOwner: 'fixture/watched', url: 'https://github.com/fixture/watched', defaultBranchRef: { name: 'main' }, name: 'watched', owner: { login: 'fixture' } }); process.exit(0); }
if (noun === 'issue') {
  if (verb === 'create') {
    const title = flag('--title', '-t');
    if (!title) refuse('stand-in gh: issue create needs --title');
    const labels = args.flatMap((arg, i) => (['--label', '-l'].includes(args[i - 1]) ? arg.split(',') : []));
    const issue = { number: next('issue', 9900), title, body: text('--body', '-b') ?? '', state: 'OPEN', stateReason: null, comments: [], labels, created: Date.now() };
    save('issue', issue);
    console.log(`https://github.com/fixture/watched/issues/${issue.number}`);
  } else if (verb === 'list') {
    const state = (flag('--state', '-s') ?? 'open').toUpperCase();
    const limit = Number(flag('--limit', '-L') ?? 30);
    show(all('issue').filter((issue) => state === 'ALL' || issue.state === state).sort((a, b) => b.number - a.number).slice(0, limit));
  } else {
    const issue = load('issue', number(ref));
    if (!issue) refuse(`stand-in gh: no issue ${ref}`);
    if (verb === 'view') show(issue);
    else if (verb === 'reopen' || verb === 'close') {
      issue.state = verb === 'reopen' ? 'OPEN' : 'CLOSED';
      issue.stateReason = verb === 'reopen' ? 'REOPENED' : (flag('--reason', '-r') ?? 'completed').toUpperCase().replace(/\s+/g, '_');
      const comment = text('--comment', '-c');
      if (comment) issue.comments.push(comment);
      save('issue', issue);
    } else if (verb === 'comment') {
      const body = text('--body', '-b');
      if (!body) refuse('stand-in gh: issue comment needs --body');
      issue.comments.push(body);
      save('issue', issue);
    } else if (verb === 'edit') {
      const body = text('--body', '-b');
      if (body) issue.body = body;
      const add = flag('--add-label');
      if (add) issue.labels = [...(issue.labels ?? []), ...add.split(',')];
      save('issue', issue);
    } else refuse(`stand-in gh: no ${args.join(' ')}`);
  }
  process.exit(0);
}
if (noun === 'pr') {
  if (verb === 'create') {
    const head = flag('--head', '-H') ?? git(process.cwd(), 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    const base = flag('--base', '-B') ?? 'main';
    const title = flag('--title', '-t');
    if (!title) refuse('stand-in gh: pr create needs --title');
    if (!git(origin(), 'branch', '--list', head).trim()) refuse(`stand-in gh: you must first push ${head} to origin`);
    const pr = { number: next('pr', 9300), title, body: text('--body', '-b') ?? '', state: 'OPEN', headRefName: head, baseRefName: base, created: Date.now(), url: '' };
    pr.url = `https://github.com/fixture/watched/pull/${pr.number}`;
    save('pr', pr);
    console.log(pr.url);
  } else if (verb === 'list') {
    const state = (flag('--state', '-s') ?? 'open').toUpperCase();
    const head = flag('--head', '-H');
    show(all('pr').filter((pr) => (state === 'ALL' || pr.state === state) && (!head || pr.headRefName === head)).sort((a, b) => b.number - a.number));
  } else {
    const pr = load('pr', number(ref)) ?? all('pr').find((one) => one.headRefName === ref);
    if (!pr) refuse(`stand-in gh: no pull request ${ref}`);
    if (verb === 'view') show(pr);
    else if (verb === 'comment') { pr.comments = [...(pr.comments ?? []), text('--body', '-b') ?? '']; save('pr', pr); }
    else if (verb === 'close') { pr.state = 'CLOSED'; save('pr', pr); }
    else if (verb === 'merge') {
      if (pr.state !== 'OPEN') refuse(`stand-in gh: pull request #${pr.number} is ${pr.state.toLowerCase()}`);
      const work = mkdtempSync(join(folder, 'merge-'));
      try {
        git(work, 'clone', '-q', origin(), '.');
        git(work, 'checkout', '-q', pr.baseRefName);
        try {
          git(work, 'merge', '--no-ff', '-q', `origin/${pr.headRefName}`, '-m', `Merge pull request #${pr.number} from ${pr.headRefName}\n\n${pr.title}`);
        } catch {
          refuse(`stand-in gh: Pull request #${pr.number} is not mergeable: the merge commit cannot be cleanly created.`);
        }
        git(work, 'push', '-q', 'origin', pr.baseRefName);
        pr.state = 'MERGED';
        pr.mergeCommit = { oid: git(work, 'rev-parse', 'HEAD').trim() };
        save('pr', pr);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    } else refuse(`stand-in gh: no ${args.join(' ')}`);
  }
  process.exit(0);
}
refuse(`stand-in gh: no ${args.join(' ')}`);
