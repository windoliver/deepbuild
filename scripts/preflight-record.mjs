// The one check on a release preflight's record (#41, #1495): scripts/release-pack.mjs makes it before it signs a
// manifest and scripts/release.mjs before it tags, so the two can never disagree about which commit passed.
// The record is JSON with at least {commit, verdict}.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Why the record at `path` doesn't let `commit` be released, or null when its preflight passed on that commit. */
export function preflightRefusal(path, commit) {
  let report;
  try {
    report = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    return `the preflight report ${resolve(path)} can't be read as JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (report?.verdict !== 'PASS') return `the preflight report's verdict is ${report?.verdict === undefined ? 'missing' : report.verdict}, not PASS, so nothing is released`;
  if (report.commit !== commit) return `the preflight passed on ${report.commit}, not on ${commit}, the commit being released`;
  return null;
}
