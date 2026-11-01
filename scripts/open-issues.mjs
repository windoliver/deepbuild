// The open issues the catalogue drift lane (#605) and the design links lane (#910) read, fetched once per
// run. checks.mjs names a file for the run in DEEP_OPEN_ISSUES, and perf names the kept copy's; the first
// lane to need the issues fetches them into it, and the next reads it. Every fetch also keeps them in
// target/open-issues.json, which perf hands to its copies. A failed fetch returns what is missing, so
// the lane reads INCONCLUSIVE, never PASS.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Far above the open issue count; a list this long may have been cut, so it isn't read as all of them.
const LIMIT = 5000;

export function openIssues() {
  const cached = process.env.DEEP_OPEN_ISSUES;
  if (cached && existsSync(cached)) {
    try {
      return { issues: JSON.parse(readFileSync(cached, 'utf8')) };
    } catch (error) {
      return { missing: `could not read the cached open issues: ${error.message}` };
    }
  }
  const gh = spawnSync('gh', ['issue', 'list', '--state', 'open', '--limit', String(LIMIT), '--json', 'number,body'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (gh.status !== 0) return { missing: `could not fetch the open issues: ${(gh.error?.message ?? gh.stderr).trim().replaceAll('\n', ' ')}` };
  const issues = JSON.parse(gh.stdout);
  if (issues.length >= LIMIT) return { missing: `gh listed ${issues.length} open issues, the most it was asked for, so some may be unread` };
  mkdirSync('target', { recursive: true });
  writeFileSync('target/open-issues.json', gh.stdout);
  if (cached) writeFileSync(cached, gh.stdout);
  return { issues };
}
