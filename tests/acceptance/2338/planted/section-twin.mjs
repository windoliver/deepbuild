// The body of the planted section printers for #2338's acceptance tests: a twin of scripts/design-section.mjs written
// by the blind test job from the issue and the README's surface alone, never from an implementation. Each planted file
// beside it runs `main` with one fault, named in that file's own code, never chosen by an environment variable (design:
// Wrong programs). No test runs it without a fault; the README says how it was checked clean.
//
// `node <program> <docs/file.md>#<anchor>` prints that section; `node <program> --issue <n>` prints every section
// issue n links, once each, in first-linked order, each after a `==> <file>#<anchor> <==` line.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { anchors, headings, prose, resolve, targets } from './doc-links-copy.mjs';

// The open issues the lanes read (the base's scripts/open-issues.mjs, without its write-back).
function openIssues() {
  const cached = process.env.DEEP_OPEN_ISSUES;
  if (cached && existsSync(cached)) {
    try {
      return { issues: JSON.parse(readFileSync(cached, 'utf8')) };
    } catch (error) {
      return { missing: `could not read the cached open issues: ${error.message}` };
    }
  }
  const gh = spawnSync('gh', ['issue', 'list', '--state', 'open', '--limit', '5000', '--json', 'number,body'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (gh.status !== 0) return { missing: `could not fetch the open issues: ${(gh.error?.message ?? gh.stderr).trim().replaceAll('\n', ' ')}` };
  return { issues: JSON.parse(gh.stdout) };
}

// The bytes of one section, or a reason it has none.
function section(file, id, fault) {
  if (!existsSync(file)) return { problem: `${file} does not exist` };
  const heading = anchors(file).get(id);
  if (!heading) return { problem: `${file} has no heading or <a id> #${id}` };
  const buffer = readFileSync(file);
  const { lines, headings: all } = headings(buffer, { fenced: fault.fencedHashAsHeading });
  const at = all.findIndex((h) => h.id === heading);
  let start = all[at].index;
  if (id !== heading) {
    // An explicit <a id> before the heading: the section starts at its line.
    for (let i = start - 1; i >= 0; i--) {
      const text = lines[i].text;
      if (new RegExp(`<a\\s[^>]*?\\b(?:id|name)\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(text)) {
        start = i;
        break;
      }
      if (text.replace(/<a\s[^>]*>(?:\s*<\/a>)?/gi, '').trim()) break;
    }
  }
  const level = all[at].level;
  const next = all.slice(at + 1).find((h) => fault.stopsAtAnyHeading || h.level <= level);
  return { bytes: buffer.subarray(lines[start].offset, next ? next.offset : buffer.length) };
}

export function main(fault = {}) {
  const args = process.argv.slice(2);
  if (args[0] === '--issue') {
    const number = Number(args[1]);
    const { issues = [], missing } = openIssues();
    const issue = issues.find((candidate) => candidate.number === number);
    if (missing || !issue) {
      if (fault.blockedPrintsNothing) process.exit(0);
      console.log(`BLOCKED #${number}'s linked sections: ${missing ?? `#${number} is not among the open issues read`}`);
      process.exit(1);
    }
    const printed = new Set();
    const out = [];
    for (const { line } of prose(issue.body ?? '')) {
      for (const target of targets(line)) {
        const link = resolve(target, null);
        if (!link?.id || !existsSync(link.file)) continue;
        const heading = anchors(link.file).get(link.id);
        if (!heading) continue;
        const key = `${link.file}#${heading}`;
        if (printed.has(key) && !fault.oncePerLink) continue;
        printed.add(key);
        const { bytes } = section(link.file, link.id, fault);
        out.push(Buffer.from(`==> ${link.file}#${link.id} <==\n`), bytes);
      }
    }
    process.stdout.write(Buffer.concat(out));
    return;
  }
  const [file, id = ''] = (args[0] ?? '').split('#');
  const { bytes, problem } = section(file, decodeURIComponent(id), fault);
  if (problem) {
    if (fault.unknownExitsZero) process.exit(0);
    console.error(`no section: ${problem}`);
    process.exit(1);
  }
  process.stdout.write(bytes);
}
