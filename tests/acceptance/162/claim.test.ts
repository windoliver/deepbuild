// AC9 #162.d05d40e6: "With a definition that names the Lottie export as a deliverable, a title with a glow pass fails the
// export check naming the pass, and outside a claim the same export writes its file with the pass in warnings; a
// definition that lets the glow go passes with it listed, and a spring's sampled keys are listed and never fail"
//
// The claim (#403's form, as #1700's and #1897's suites write it): agent alpha's claim on the title, its locked
// definition holding one requirement, the export module's check kind `export` on the Lottie target (`{kind: "export",
// target: "lottie"}`, README: The check), and, to let the glow go, `except: ["halo"]` (Check input's `except`). The
// verdict's row for it: FAIL with an issue naming the group `halo` and its pass `glow@1`; PASS with `halo` named in the
// row when the definition lets it go; PASS with the spring's item named for the title whose only listed key is a
// spring's. Outside a claim, the plain `export` call delivers the file with a `cannot_hold` warning for `halo` naming
// glow@1.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, TITLE_NAMES, exportedOf, glowing, isObject, lottieExport, readLottie, runShow, show, showRun, titleDoc, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: title', process: { pid: 4100, start: 1_000 } } as const;
const DOCUMENT = '01JB162E000000000000000001';
const CLAIM = 'claim:01JB162C000000000000000001';
const REQ = 'req:01JB162Q000000000000000001';

/** The title with a glow pass (the composed pass item `glow`) on a group `halo` holding a spark; or, for the spring,
 * the title whose tiles turn on a spring (its eased variant's spring alone). */
const glowTitle = (evidence: string): JsonObject => titleDoc(evidence, 'bezier', glowing([250, 20, 40, 40]), { modules: { effects: '^1' } });
function springy(evidence: string): JsonObject {
  const doc = titleDoc(evidence, 'eased');
  const channels = doc['channels'] as JsonObject;
  channels['trim'] = (titleDoc(evidence, 'bezier')['channels'] as JsonObject)['trim']!;
  return doc;
}
/** The world: alpha's session, its process, the title stored as revision 0 on the panel, and alpha's claim. */
function verdictOf(evidence: string, document: JsonObject, check: JsonObject, what: string): JsonObject {
  const sc: JsonObject = {
    evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOCUMENT]: { panel: 'main', document } },
    claims: { [CLAIM]: { session: ALPHA.id, deliverables: [DOCUMENT], requirements: [{ id: REQ, check }] } },
    calls: [{ call: 'verdict', claim: CLAIM }],
  };
  const [v] = runShow(shows.bin(FULL), sc, what);
  const rows = (Array.isArray(v!['requirements']) ? v!['requirements'] : []).filter(isObject) as JsonObject[];
  const row = rows.find((r) => r['id'] === REQ);
  expect(row, `${what}: the verdict has a row for the export requirement: ${show(v!, 1500)}`).toBeDefined();
  return row!;
}
const EXPORT_CHECK: JsonObject = { kind: 'export', target: 'lottie' };
/** What a row lists, its echo of the requirement's own check input left out (so `except: ["halo"]` names nothing). */
const listing = (row: JsonObject): string => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'check' && k !== 'except' && k !== 'id')));

describe(`${AC[9]} a claim's Lottie deliverable fails the export check on a glow pass; outside a claim it's a warning; a let-go glow and a spring are listed and pass`, () => {
  it(`${AC[9]} with the Lottie export a deliverable, the title with a glow pass fails the export check, naming halo and glow@1`, () => {
    const evidence = temp();
    const row = verdictOf(evidence, glowTitle(evidence), EXPORT_CHECK, 'the claim on the title with a glow pass');
    expect(row['result'], `the export check fails: ${show(row, 1500)}`).toBe('FAIL');
    const issues = (Array.isArray(row['issues']) ? row['issues'] : []).filter(isObject) as JsonObject[];
    expect(issues.some((i) => JSON.stringify(i).includes('halo') && /glow/.test(JSON.stringify(i))), `an issue names the item halo and its pass glow@1: ${show(issues)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[9]} outside a claim the same export writes its file, with halo's glow pass in its warnings`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'title.json');
    const [reply] = showRun(shows.bin(FULL), evidence, [glowTitle(evidence)], [lottieExport(0, out)], 'the title with a glow pass, outside a claim');
    const { warnings } = exportedOf(reply!, 'the title with a glow pass, outside a claim');
    readLottie(out, 'the title with a glow pass, outside a claim');
    expect(warnings.some((w) => w.item === 'halo' && w.kind === 'cannot_hold' && /glow/.test(w.text)), `the warnings list halo's glow pass: ${JSON.stringify(warnings.map((w) => w.raw))}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[9]} a definition that lets the glow go passes, with halo listed`, () => {
    const evidence = temp();
    const row = verdictOf(evidence, glowTitle(evidence), { ...EXPORT_CHECK, except: ['halo'] }, 'the claim that lets the glow go');
    expect(row['result'], `the export check passes: ${show(row, 1500)}`).toBe('PASS');
    expect(listing(row), 'the row still lists halo').toContain('halo');
  }, TIMEOUT);

  it(`${AC[9]} a spring's sampled keys are listed and never fail the export check`, () => {
    const evidence = temp();
    const row = verdictOf(evidence, springy(evidence), EXPORT_CHECK, `the claim on the title whose ${TITLE_NAMES.tiles} turn on a spring`);
    expect(row['result'], `the export check passes: ${show(row, 1500)}`).toBe('PASS');
    expect(listing(row), 'the row lists the spring\'s sampled item, tiles').toContain('tiles');
  }, TIMEOUT);
});
