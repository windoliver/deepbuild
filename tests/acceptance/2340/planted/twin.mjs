// The body of the planted wrong programs for #2340's acceptance tests: a twin of the script the issue asks for, written
// by the blind test job from the issue and the README's surface alone, never from an implementation. Each planted file
// beside it runs `main` with one fault, named in that file's own code, never chosen by an environment variable (design:
// Wrong programs). No test runs it without a fault; the README says how it was checked clean.
//
// Its link reading is the base's scripts/design-links.mjs (#910): `prose`, `slug`, `headingText`, `targets` and
// `resolve` are copied from it at 9d0256132, so the twin reads a link exactly as the design links lane does.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const DOCS = ['docs/technical-design.md', 'docs/canvas-primitives.md'];
const REPO = 'https://github.com/windoliver/deepbuild/blob/main/';
const PAGE = 100;
const LIMIT = 5000;

// The lines outside fenced code, numbered from 1.
function* prose(text) {
  let fence;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
    } else if (mark) fence = mark[1];
    else yield { number: i + 1, line };
  }
}

// GitHub's slug: lowercase, keeping letters, marks, numbers, connectors, spaces and hyphens, each space a hyphen.
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
// A heading's text as GitHub renders it: code spans, links and images by their text, without tags, entities,
// emphasis or closing hashes.
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

// The link targets on a line, outside code spans: markdown links' targets, and bare links into this repo
// without the trailing punctuation GitHub leaves out of an autolink.
function targets(line) {
  const text = line.replace(/(`+).+?\1/g, '');
  const linked = [...text.matchAll(/\]\(\s*<?([^\s)>]+)/g)].map((m) => m[1]);
  const bare = text.replace(/\]\(\s*<?[^\s)>]+/g, '').split(REPO).slice(1).map((rest) => REPO + rest.match(/^[^\s)>\]"'`]*/)[0].replace(/[.,:;!?*_~]+$/, ''));
  return [...linked, ...bare];
}

// The doc file and anchor an issue's link targets, or null for a link that isn't into docs/*.md. An issue's
// relative links count only as docs/<name>.md or <name>.md.
function resolve(target) {
  const [, path, anchor = ''] = target.match(/^([^#?]*)(?:\?[^#]*)?(?:#(.*))?$/);
  let file;
  if (path.startsWith(REPO)) file = path.slice(REPO.length);
  else if (/^[a-z][\w+.-]*:/i.test(path)) return null;
  else if (/^(?:\.?\/)?(?:docs\/)?[^/]+\.md$/.test(path)) file = `docs/${path.split('/').at(-1)}`;
  else return null;
  if (!/^docs\/[^/]+\.md$/.test(file)) return null;
  let id = anchor;
  try {
    id = decodeURIComponent(anchor);
  } catch { /* an anchor that isn't valid percent-encoding is compared as written */ }
  return { file, id };
}

// A doc's headings by their own slugs, in order, and every anchor in it (a slug, or an explicit <a id> or <a name>)
// to the slug of its heading: an explicit anchor belongs to the heading that follows it.
const docs = new Map();
function doc(file) {
  if (!docs.has(file)) {
    const headings = [];
    const heading = new Map();
    let pending = [];
    if (existsSync(file)) {
      for (const { line } of prose(readFileSync(file, 'utf8'))) {
        for (const [, id] of line.matchAll(/<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi)) pending.push(id);
        const match = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
        if (!match) continue;
        // A repeated slug takes the first free -1, -2, … suffix, as GitHub's does.
        const base = slug(headingText(match[1]));
        let own = base;
        for (let n = 1; headings.includes(own); n++) own = `${base}-${n}`;
        headings.push(own);
        heading.set(own, own);
        for (const id of pending) if (!heading.has(id)) heading.set(id, own);
        pending = [];
      }
    }
    docs.set(file, { headings, heading });
  }
  return docs.get(file);
}

// One gh call's JSON, or why it failed.
function gh(args) {
  const run = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.error || run.status !== 0) return { error: (run.error?.message ?? run.stderr ?? '').trim().replaceAll('\n', ' ') || `gh exited ${run.status}` };
  try {
    return { value: JSON.parse(run.stdout) };
  } catch (error) {
    return { error: `gh's answer isn't JSON: ${error.message}` };
  }
}

function openIssues() {
  const { value, error } = gh(['issue', 'list', '--state', 'open', '--limit', String(LIMIT), '--json', 'number,body']);
  if (error) return { issues: [], missing: `could not fetch the open issues: ${error}` };
  if (value.length >= LIMIT) return { issues: value, missing: `gh listed ${value.length} open issues, the most it was asked for, so some may be unread` };
  return { issues: value };
}

// The closed issues, a page of 100 at a time, until a page comes back short.
function closedIssues(fault) {
  const issues = [];
  for (let page = 1; ; page++) {
    const { value, error } = gh(['api', `repos/{owner}/{repo}/issues?state=closed&per_page=${PAGE}&page=${page}`]);
    if (error) return { issues, missing: `could not fetch page ${page} of the closed issues: ${error}` };
    issues.push(...value.filter((item) => !item.pull_request));
    if (fault.firstPageOnly || value.length < PAGE) return { issues };
  }
}

const reads = ({ closed, open }) => (closed.length && open.length ? 'mixed' : closed.length ? 'closed' : open.length ? 'open' : 'unlinked');
const cell = (numbers) => numbers.map((number) => `#${number}`).join(' ');

/**
 * The script: `[--json <file>]`. Faults, each one a planted file's: notPlannedAsClosed, keyByAnchorAsWritten,
 * countLinks, firstPageOnly, tableOnPartialRead, jsonDropsUnlinked.
 */
export function main(fault = {}) {
  const args = process.argv.slice(2);
  const flag = args.findIndex((arg) => arg === '--json' || arg.startsWith('--json='));
  const jsonFile = flag < 0 ? null : args[flag].startsWith('--json=') ? args[flag].slice('--json='.length) : args[flag + 1];

  const open = openIssues();
  const closed = closedIssues(fault);
  const missing = open.missing ?? closed.missing;
  const blocked = () => {
    console.log(`BLOCKED design issues: ${missing}`);
    process.exitCode = 2;
  };
  if (missing && !fault.tableOnPartialRead) return blocked();

  const completed = closed.issues.filter((issue) => fault.notPlannedAsClosed || issue.state_reason === 'completed');
  const rows = new Map();
  const row = (file, anchor) => {
    const key = `${file}#${anchor}`;
    if (!rows.has(key)) rows.set(key, { file, anchor, closed: [], open: [] });
    return rows.get(key);
  };
  for (const file of DOCS) for (const anchor of doc(file).headings) row(file, anchor);
  const read = (state, { number, body }) => {
    for (const { line } of prose(body ?? '')) {
      for (const target of targets(line)) {
        const link = resolve(target);
        if (!link?.id) continue;
        const { heading } = doc(link.file);
        if (!heading.has(link.id)) continue;
        const anchor = fault.keyByAnchorAsWritten ? link.id : heading.get(link.id);
        const numbers = row(link.file, anchor)[state];
        if (fault.countLinks || !numbers.includes(number)) numbers.push(number);
      }
    }
  };
  for (const issue of completed) read('closed', issue);
  for (const issue of open.issues) read('open', issue);

  const listed = [...rows.values()].map((entry) => ({ ...entry, reads: reads(entry) }));
  const count = (word) => listed.filter((entry) => entry.reads === word).length;
  const summary = {
    linked: listed.length - count('unlinked'),
    closed: count('closed'),
    mixed: count('mixed'),
    open: count('open'),
    unlinked: count('unlinked'),
    issues: { read: completed.length + open.issues.length, closed: completed.length, open: open.issues.length },
  };
  console.log('| Heading | Closed | Open | Reads |');
  console.log('|---|---|---|---|');
  for (const entry of listed) console.log(`| ${entry.file}#${entry.anchor} | ${cell(entry.closed)} | ${cell(entry.open)} | ${entry.reads} |`);
  if (missing) return blocked();
  if (jsonFile) {
    const rowsOut = listed.filter((entry) => !fault.jsonDropsUnlinked || entry.reads !== 'unlinked');
    writeFileSync(jsonFile, `${JSON.stringify({ rows: rowsOut, summary }, null, 2)}\n`);
  }
  console.log(`${summary.linked} headings linked: ${summary.closed} closed, ${summary.mixed} mixed, ${summary.open} open; ${summary.unlinked} unlinked; ${summary.issues.read} issues read: ${summary.issues.closed} closed, ${summary.issues.open} open`);
}
