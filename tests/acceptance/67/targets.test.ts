// #67's scope line, where no criterion names it: targets a definition names keep stable ids with their history, so a
// rename is followed and offered as one proposed diff. Two requirements name one script's symbols; the agent renames the
// script. The claim isn't INVALID for a target that no longer resolves (#323's rule at the base, for a target with no
// history), one proposal names the old path and the new, and the definition doesn't change until you approve it.
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, ASSERTS, CHECK, claimHandle, claimsOf, cleanup, draft, fill, git, lastPos, listed, locked, makeWorld, must, newWorkspace, nodeCheck, req, Session, settle, startHub, taskOf, verdictsOf } from './hub.ts';

afterAll(cleanup, 60_000);
const ASK = 'tidy the report script';
const OLD = 'scripts/total.js';
const NEW = 'scripts/weekly-total.js';

describe('#67 targets a definition names keep stable ids, so a rename is followed and offered as one proposed diff', () => {
  it('a script two requirements target is renamed: the claim follows it, and one proposal names both paths, leaving the definition as it was', async () => {
    const w = makeWorld({ drafts: [draft(ASK, [
      req('R1', 'The report script totals the week', { check: CHECK('totals'), asserts: [ASSERTS('totals')], on_base: 'fails', targets: [`${OLD}#totalOf`] }),
      req('R2', 'The report script rounds its total', { check: CHECK('rounds'), asserts: [ASSERTS('rounds')], on_base: 'fails', targets: [`${OLD}#rounded`] }),
    ])] });
    const hub = await startHub(w);
    const ws = await newWorkspace(w, 'Report script');
    fill(w, ws, { [OLD]: 'function totalOf(rows) { return rows.length; }\nfunction rounded(n) { return Math.round(n); }\nmodule.exports = { totalOf, rounded };\n', ...nodeCheck('totals', `fs.existsSync('notes/tidy.md')`), ...nodeCheck('rounds', `fs.existsSync('notes/tidy.md')`) });
    const s = new Session(w, ws.folder);
    await s.start();
    await s.typed(ASK);
    let events = await settle(hub, (all) => locked(all, taskOf(all, s, ASK)) !== undefined);
    const ref = taskOf(events, s, ASK);
    must(locked(events, ref) !== undefined, `the definition must lock: ${listed(events.slice(-6))}`);
    const since = lastPos(await allEvents(hub));

    await s.bash(`git mv ${OLD} ${NEW} && git commit -m "Name the script for what it does"`, () => {
      renameSync(join(ws.folder, OLD), join(ws.folder, NEW));
      git(w, ws.folder, ['add', '-A']);
      git(w, ws.folder, ['commit', '-q', '-m', 'Name the script for what it does']);
    });
    await s.write(join(ws.folder, 'notes/tidy.md'), 'Renamed the script.\n');
    await s.stop('The script has its new name.');
    events = await settle(hub, (all) => { const c = claimsOf(all, ref, since)[0]; return c !== undefined && verdictsOf(all, claimHandle(c)).length > 0; }, 60_000);
    const claim = claimsOf(events, ref, since)[0];
    must(claim !== undefined, `the stop must make a claim: ${listed(events.slice(-8))}`);
    const verdict = verdictsOf(events, claimHandle(claim)).at(-1);
    expect(verdict?.data.reasons.join(' '), 'a followed rename is no target that stopped resolving').not.toMatch(/doesn't resolve/);
    expect(verdict?.data.outcome, 'and no INVALID').not.toBe('INVALID');

    const proposals = events.filter((e) => e.log_pos > since && /\.proposed$/.test(e.kind) && e.kind !== 'plan.proposed' && JSON.stringify(e.data).includes(OLD));
    expect(proposals.length, `one proposed diff, for both requirements: ${listed(proposals)}`).toBe(1);
    expect(JSON.stringify(proposals[0]!.data), 'it names the new path').toContain(NEW);
    expect(events.filter((e) => e.kind === 'definition.revised'), 'the definition changes only on your approval').toEqual([]);
  }, 180_000);
});
