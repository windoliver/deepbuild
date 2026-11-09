// #1426, the scan every planted guard shares: it reads the change and the signed approvals through the real
// scripts/proof-change.mjs and refuses an unsigned change to a row's budget number, each wrong guard one fault on.
import { git, readApprovals, readChange, show } from '../../../../scripts/proof-change.mjs';
import { carriedRows, README } from '../common.mjs';

const numbers = (text) => (carriedRows(text ?? '') ?? []).map(({ budget }) => Number(/^(\d+) over/.exec(budget)?.[1] ?? 0));

export function guard(fault = {}) {
  const root = process.cwd();
  const change = readChange(root);
  const approvals = readApprovals(root, change);
  let refused = 0;
  for (const commit of change.commits) {
    if (fault.none || !commit.files.some(({ path }) => path === README)) continue;
    const before = numbers(show(root, commit.parent, README)), after = numbers(show(root, commit.sha, README));
    const changed = fault.wholeFile || after.some((value, index) => (fault.raiseOnly ? value > before[index] : value !== before[index]));
    if (!changed) continue;
    const signed = fault.anySignature ? git(root, ['for-each-ref', 'refs/tags/deep/approved/']).trim() !== '' : (approvals.get(commit.sha) ?? []).includes(README);
    if (signed && !fault.neverSigned) continue;
    refused += 1;
    console.log(`FAIL guard: ${README}: a row's budget number changed`);
  }
  if (!refused) console.log('PASS guard: nothing to refuse');
  process.exitCode = refused ? 1 : 0;
}
