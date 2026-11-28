import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { commit, linksInto, makeCopy, openIssues, plantFile, renamedAnchors, run, shown, slug } from './helpers.mjs';

const ID = '#3413.e975ffde';
const LANE = 'scripts/design-links.mjs';
const PLANTED = 'Zorvanthic heading 3413';

function readIssues(t, sandbox) {
  const read = openIssues();
  assert.ok(!read.missing, `BLOCKED: the open issues were not read, so the design links lane can't be judged: ${read.missing}`);
  const file = join(sandbox, 'open-issues.json');
  writeFileSync(file, read.json);
  const linked = renamedAnchors().map((a) => ({ ...a, issues: read.issues.filter(({ body }) => linksInto(body, a.doc, a.anchor)).map(({ number }) => number) }));
  t.diagnostic(`${read.issues.length} open issues read; headings that say plug-in at the merge base, with the open issues linking them: ${linked.map((a) => `${a.doc}#${a.anchor} (${a.issues.length})`).join(', ')}`);
  return { file, linked };
}

test(`${ID} AC3: the design links lane passes with the open issues read`, { timeout: 900_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const { file } = readIssues(t, sandbox);
  const r = await run(repo, sandbox, [LANE], { DEEP_OPEN_ISSUES: file });
  t.diagnostic(shown(r, 3));
  assert.ok(!r.lines.some((l) => /^INCONCLUSIVE\b|issues were not read/.test(l)), `the lane did not read the open issues\n${shown(r)}`);
  assert.equal(r.status, 0, shown(r));
});

test(`${ID} AC3: a planted rename with no <a id> fails the design links lane, naming an issue that links the old anchor`, { timeout: 900_000 }, async (t) => {
  const { sandbox, repo } = makeCopy(t);
  const { file, linked } = readIssues(t, sandbox);
  const picks = [...new Map(linked.filter((a) => a.issues.length).map((a) => [a.doc, a])).values()];
  assert.ok(picks.length, 'no open issue links a heading that says plug-in at the merge base, so no planted rename can be judged');
  for (const [i, { doc, anchor }] of picks.entries()) {
    const ids = new RegExp(`<a\\s[^>]*?\\b(?:id|name)\\s*=\\s*["']${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>(?:\\s*</a>)?`, 'gi');
    const lines = readFileSync(join(repo, doc), 'utf8').replace(ids, '').split('\n');
    const at = lines.findIndex((line) => {
      const h = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
      return h && slug(h[2].replace(/(`+)(.+?)\1/g, '$2').replace(/<[^>]*>|\*+|__+/g, '').trim()) === anchor;
    });
    if (at >= 0) lines[at] = lines[at].replace(/^( {0,3}#{1,6}\s+).*$/, `$1${PLANTED} ${i + 1}`);
    plantFile(repo, doc, lines.join('\n'));
  }
  commit(repo, `change: ${picks.map((p) => `${p.doc}#${p.anchor}`).join(' and ')} renamed with no <a id>`);
  const r = await run(repo, sandbox, [LANE], { DEEP_OPEN_ISSUES: file });
  assert.notEqual(r.status, 0, `the lane passes with ${picks.map((p) => `${p.doc}#${p.anchor}`).join(' and ')} renamed and no <a id>\n${shown(r)}`);
  for (const { doc, anchor, issues } of picks) {
    const named = r.lines.filter((l) => issues.some((n) => new RegExp(`(?<![\\w#])#${n}(?!\\d)`).test(l)) && l.includes(`#${anchor}`));
    assert.ok(named.length, `no line of the lane names an open issue (${issues.slice(0, 8).map((n) => `#${n}`).join(' ')}…) that links ${doc}#${anchor}, renamed\n${shown(r)}`);
  }
});
