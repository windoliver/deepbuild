// Criterion 7: the check on a change to the session row renders it four ways and fails a planted label drawn past its
// frame and a cut-off branch name whose accessibility name lacks the full name, naming each; a change to a file no view
// loads is reported not covered, and the UI claim is INCONCLUSIVE, never PASS. Also the Scope's other two audits (an
// icon-only control with no name, a raw string key) and the stress fixture set for text.
//
// The real session row, the shipped sidebar in crates/deep-app/src/views.rs, drawn from fixtures/stress/text.events.jsonl:
// one session titled with each long string. Every judgment is checked against what the render itself holds: the PNG at
// its path and the snapshot's real node bounds, never words a program merely says. Reading a PNG here is arithmetic on its
// size and pixels, not a look at it; the look is criterion 8's taste call.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { Drive, cleanup, launch, must, nodesOf, requireMacos, type Box, type Image, type Node, type Obj } from './helpers.ts';
import {
  AC, CLEAN, CLEAN_PANEL, MARKS_MAIN, MARKS_PANEL, REFERENCE, REFERENCE_SCALE, ROW_FILE, SIDEBAR, STRESS, STRESS_FILE, UNLOADED_FILE, checked, inkPast, luma, rowIn, shotOf, viewOf,
} from './ui-helpers.ts';

// The runs are shared by the tests that read them, so their files stay until the file ends.
afterAll(cleanup, 60_000);
const runs = new Map<string, Promise<Obj>>();
/** The check on a change to the session row, on the stress set, once per plant. */
const rowCheck = (plant?: string): Promise<Obj> => {
  const key = plant ?? '';
  if (!runs.has(key)) runs.set(key, checked({ changed: [ROW_FILE], fixture: STRESS_FILE }, plant));
  return runs.get(key)!;
};
const BAND_PX = 12;

interface Shot { size: [number, number]; theme: string; sha256: string; image: Image }
/** Every way a view's renders aren't the four the issue names: the reference window and a narrow width, light and dark. */
function fourWays(shots: Shot[]): string[] {
  const problems: string[] = [];
  if (shots.length !== 4) problems.push(`${shots.length} renders, not four`);
  const sizes = [...new Set(shots.map((s) => s.size.join('x')))];
  if (sizes.length !== 2) problems.push(`sizes ${sizes.join(', ')}: not two`);
  if (!sizes.includes(REFERENCE.join('x'))) problems.push(`no render at the reference window ${REFERENCE.join('x')}`);
  if (!shots.some((s) => s.size[0] < REFERENCE[0])) problems.push('no render at a narrow width');
  for (const size of sizes) for (const theme of ['light', 'dark']) {
    if (!shots.some((s) => s.size.join('x') === size && s.theme === theme)) problems.push(`no ${theme} render at ${size}`);
  }
  for (const s of shots) if (s.image.width !== s.size[0] * REFERENCE_SCALE || s.image.height !== s.size[1] * REFERENCE_SCALE) problems.push(`the ${s.theme} render at ${s.size.join('x')} is a ${s.image.width}x${s.image.height} picture`);
  if (new Set(shots.map((s) => s.sha256)).size !== shots.length) problems.push('two renders are the same picture');
  for (const size of sizes) {
    const light = shots.find((s) => s.size.join('x') === size && s.theme === 'light');
    const dark = shots.find((s) => s.size.join('x') === size && s.theme === 'dark');
    if (light && dark && luma(dark.image) > luma(light.image) / 2) problems.push(`the dark render at ${size} isn't dark: mean luma ${luma(dark.image).toFixed(0)}, light ${luma(light.image).toFixed(0)}`);
  }
  return problems;
}

/** Every way a check's answer on a change with `uncovered` files breaks the rule: listed, and never PASS. */
function coverageProblems(reply: Obj, uncovered: string[]): string[] {
  const problems: string[] = [];
  if (JSON.stringify([...(reply.not_covered ?? [])].sort()) !== JSON.stringify([...uncovered].sort())) problems.push(`not_covered is ${JSON.stringify(reply.not_covered)}, not ${JSON.stringify(uncovered)}`);
  if (uncovered.length && reply.claim === 'PASS') problems.push('the UI claim is PASS with files not covered');
  if (uncovered.length && reply.claim !== 'INCONCLUSIVE' && reply.claim !== 'FAIL') problems.push(`the UI claim is ${String(reply.claim)}`);
  return problems;
}

const shots = (renders: Obj[]): Shot[] => renders.map((r) => ({ size: r.size, theme: r.theme, sha256: r.sha256, image: shotOf(r as { path: string; sha256: string }) }));

const titles = Object.values(STRESS);

describe(`${AC.check} the check on a change to the session row renders it four ways, names what is wrong, and never passes what it didn't render`, () => {
  it(`${AC.check} a change to the session row renders it four ways, at the reference window and a narrow width, in light and dark, with the real row in each`, async () => {
    requireMacos();
    const reply = await rowCheck();
    const view = viewOf(reply, SIDEBAR);
    expect(view.files, `the view lists the file it loads: ${JSON.stringify(view.files)}`).toContain(ROW_FILE);
    expect(fourWays(shots(view.renders))).toEqual([]);
    for (const r of view.renders as Obj[]) {
      expect(r.snapshot.window.size, 'each render holds its own snapshot').toEqual(r.size);
      expect(r.snapshot.window.scale).toBe(REFERENCE_SCALE);
      rowIn(r.snapshot, STRESS.branch);
    }
    expect(reply.not_covered, 'the row\'s file is covered').toEqual([]);
    expect((reply.evidence as Obj[]).filter((e) => e.state === 'captured' && (view.renders as Obj[]).some((r) => r.sha256 === e.sha256)).length, 'each render is evidence by hash').toBe(4);
  }, 900_000);

  it(`${AC.check} the honest row draws nothing past its frame, cuts nothing a screen reader can't hear in full, and gets no finding in any of the four`, async () => {
    requireMacos();
    const view = viewOf(await rowCheck(), SIDEBAR);
    for (const r of view.renders as Obj[]) {
      const where = `${r.theme} ${r.size.join('x')}`;
      expect(r.findings, `no finding on the sidebar at ${where}`).toEqual([]);
      const image = shotOf(r as { path: string; sha256: string });
      for (const title of titles) {
        const row = rowIn(r.snapshot, title);
        expect(row.name, `the row's accessible name holds "${title}" whole at ${where}`).toContain(title);
        expect(inkPast(image, row.bounds, BAND_PX), `nothing of "${title.slice(0, 24)}..." is drawn past the row's frame ${JSON.stringify(row.bounds)} at ${where}`).toBe(0);
      }
    }
  }, 900_000);

  it(`${AC.check} a planted label drawn past its frame fails, naming the label's row in each of the four`, async () => {
    requireMacos();
    const plant = 'row-label-past-frame';
    const reply = await rowCheck(plant);
    expect(reply.claim, 'the UI claim fails').toBe('FAIL');
    const view = viewOf(reply, SIDEBAR);
    expect((view.renders as Obj[]).length, 'in all four').toBe(4);
    for (const r of view.renders as Obj[]) {
      const where = `${r.theme} ${r.size.join('x')}`;
      const row = rowIn(r.snapshot, STRESS.repo);
      const image = shotOf(r as { path: string; sha256: string });
      expect(inkPast(image, row.bounds, BAND_PX), `the plant really draws past the row's frame at ${where}`).toBeGreaterThan(0);
      const found = (r.findings as Obj[]).filter((f) => f.audit === 'outside_frame' && String(f.node?.name).includes(STRESS.repo));
      expect(found.length, `one finding names the row at ${where}: ${JSON.stringify(r.findings).slice(0, 600)}`).toBe(1);
      const [f] = found as [Obj];
      expect([f.view, f.theme, f.size], 'the finding says where').toEqual([SIDEBAR, r.theme, r.size]);
      expect(f.node.role).toBe('button');
      expect(f.frame, `the frame it names is the row's real one at ${where}`).toEqual(row.bounds);
      const [x, y, w, h] = f.box as Box;
      const [fx, fy, fw, fh] = row.bounds;
      expect(x + w > fx + fw || y + h > fy + fh, `the box it names ${JSON.stringify(f.box)} runs past the frame ${JSON.stringify(row.bounds)}`).toBe(true);
    }
  }, 900_000);

  it(`${AC.check} a planted cut-off branch name whose accessibility name lacks the full name fails, naming it in each of the four`, async () => {
    requireMacos();
    const plant = 'row-branch-cut-off';
    const reply = await rowCheck(plant);
    expect(reply.claim, 'the UI claim fails').toBe('FAIL');
    const view = viewOf(reply, SIDEBAR);
    expect((view.renders as Obj[]).length, 'in all four').toBe(4);
    for (const r of view.renders as Obj[]) {
      const where = `${r.theme} ${r.size.join('x')}`;
      const row = rowIn(r.snapshot, STRESS.branch);
      expect(row.name, `the plant's row has lost the full name at ${where}`).not.toContain(STRESS.branch);
      const found = (r.findings as Obj[]).filter((f) => f.audit === 'cut_off' && f.node?.name === row.name);
      expect(found.length, `one finding names the row at ${where}: ${JSON.stringify(r.findings).slice(0, 600)}`).toBe(1);
      const [f] = found as [Obj];
      expect([f.view, f.theme, f.size], 'the finding says where').toEqual([SIDEBAR, r.theme, r.size]);
      expect(f.node.bounds, 'and which real row').toEqual(row.bounds);
      const drawn = String(f.text).replace(/(…|\.\.\.)$/, '');
      expect(drawn.length > 8 && drawn.length < STRESS.branch.length && STRESS.branch.startsWith(drawn), `it quotes the cut-off text, a start of the branch: ${JSON.stringify(f.text)}`).toBe(true);
    }
  }, 900_000);

  it(`${AC.check} a change to a file no view loads is reported not covered, and the UI claim is INCONCLUSIVE, never PASS`, async () => {
    requireMacos();
    const reply = await checked({ changed: [UNLOADED_FILE] });
    expect(reply.views, 'nothing renders for it').toEqual([]);
    expect(coverageProblems(reply, [UNLOADED_FILE])).toEqual([]);
    expect(reply.claim).toBe('INCONCLUSIVE');
    const none = await checked({ changed: [] });
    expect(none.claim, 'a change with nothing to render proves nothing either').toBe('INCONCLUSIVE');
  }, 900_000);

  it(`${AC.check} a clean view beside a file no view loads is still INCONCLUSIVE; an imported file counts as loaded and an unimported one in the same folder does not`, async () => {
    requireMacos();
    const covered = await checked({ changed: [CLEAN.main, CLEAN.words], panel: CLEAN_PANEL });
    expect(covered.views.length, 'one view, the panel').toBe(1);
    expect(covered.views[0].files, 'it loads the file main.js imports').toEqual(expect.arrayContaining([CLEAN.main, CLEAN.words]));
    expect(covered.views[0].files, 'and not the one nothing imports').not.toContain(CLEAN.unloaded);
    expect(coverageProblems(covered, [])).toEqual([]);
    expect([covered.claim, covered.findings], `every file rendered and nothing found: ${JSON.stringify(covered.findings).slice(0, 400)}`).toEqual(['PASS', []]);
    const mixed = await checked({ changed: [CLEAN.main, CLEAN.unloaded], panel: CLEAN_PANEL });
    expect(mixed.views[0].renders.length, 'the view still renders four ways').toBe(4);
    expect(mixed.findings, 'and nothing is wrong with it').toEqual([]);
    expect(coverageProblems(mixed, [CLEAN.unloaded])).toEqual([]);
    expect(mixed.claim, 'but the claim can\'t pass').toBe('INCONCLUSIVE');
  }, 900_000);

  it(`${AC.check} a finding beside a file no view loads fails, and still lists the file`, async () => {
    requireMacos();
    const reply = await checked({ changed: [MARKS_MAIN, CLEAN.unloaded], panel: MARKS_PANEL });
    expect(coverageProblems(reply, [CLEAN.unloaded])).toEqual([]);
    expect(reply.claim, 'FAIL outranks INCONCLUSIVE, as in a verdict').toBe('FAIL');
  }, 900_000);
});

describe('scope: the audit names an icon-only control with no name and a raw string key', () => {
  it('the panel with both gets one finding of each in each of the four, each at the real node, and nothing else', async () => {
    requireMacos();
    const reply = await checked({ changed: [MARKS_MAIN], panel: MARKS_PANEL });
    expect(reply.claim).toBe('FAIL');
    expect(reply.views.length).toBe(1);
    const [view] = reply.views as [Obj];
    expect(fourWays(shots(view.renders))).toEqual([]);
    for (const r of view.renders as Obj[]) {
      const where = `${r.theme} ${r.size.join('x')}`;
      const nodes = nodesOf(r.snapshot);
      const icon = nodes.find((n) => n.role === 'button' && !n.name && !(n.children ?? []).length) as Node | undefined;
      const key = nodes.find((n) => n.name === 'panel.actions.save_label');
      expect(icon, `the snapshot holds the unnamed icon button at ${where}`).toBeTruthy();
      expect(key, `and the raw key as drawn at ${where}`).toBeTruthy();
      const findings = r.findings as Obj[];
      expect(findings.map((f) => f.audit).sort(), `exactly the two wrongs at ${where}: ${JSON.stringify(findings).slice(0, 600)}`).toEqual(['no_name', 'raw_key']);
      const unnamed = findings.find((f) => f.audit === 'no_name')!;
      expect([unnamed.node.role, unnamed.node.bounds], 'the control, at its real bounds').toEqual(['button', icon!.bounds]);
      const raw = findings.find((f) => f.audit === 'raw_key')!;
      expect([raw.text, raw.box], 'the key, at its real bounds').toEqual(['panel.actions.save_label', key!.bounds]);
    }
  }, 900_000);

  it('the same panel put right gets none: a named icon button, a text button that needs no name, and words', async () => {
    requireMacos();
    const reply = await checked({ changed: [CLEAN.main], panel: CLEAN_PANEL });
    expect([reply.claim, reply.findings], JSON.stringify(reply.findings).slice(0, 600)).toEqual(['PASS', []]);
  }, 900_000);
});

describe('scope: a stress fixture set for text', () => {
  it('long repo, branch and worktree paths with no spaces, long issue titles, model IDs and commands reach the real row whole, and launch takes the set by path', async () => {
    requireMacos();
    for (const path of [STRESS.repo, STRESS.branch, STRESS.worktree]) expect(path, 'a path with no spaces').not.toMatch(/\s/);
    const text = readFileSync(STRESS_FILE, 'utf8');
    for (const title of titles) expect(text, 'the set holds it').toContain(title);
    const drive = await Drive.start();
    const replica = await launch(drive, { from: 'fixture', fixture: STRESS_FILE, clock: 'virtual' });
    const seen = await must(drive, { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'bounds'] } });
    for (const title of titles) expect(rowIn(seen.snapshot, title).name, 'its row\'s accessible name holds it whole').toContain(title);
    await drive.stop();
    // A set that can't be read refuses, rather than rendering the default record as if it were the stress set.
    const other = await Drive.start();
    const { reply } = await other.call({ call: 'launch', launch: { from: 'fixture', fixture: '/nonexistent/124.events.jsonl' } });
    expect([reply.ok, reply.error?.code], JSON.stringify(reply).slice(0, 300)).toEqual([false, 'refused']);
    await other.stop();
  }, 900_000);

  it('an honest ellipsis isn\'t a finding: the reading cut off in the row keeps its full value in its accessible name', async () => {
    requireMacos();
    const view = viewOf(await rowCheck(), SIDEBAR);
    for (const r of view.renders as Obj[]) {
      const reading = nodesOf(r.snapshot).find((n) => n.role === 'label' && String(n.name).includes(STRESS.command));
      expect(reading, 'the row\'s reading, named in full').toBeTruthy();
      const cut = nodesOf({ tree: reading }).find((n) => n.role === 'text_run');
      expect(cut?.name, 'and drawn cut off').toMatch(/…$/);
      expect((r.findings as Obj[]).filter((f) => f.audit === 'cut_off'), 'with no finding').toEqual([]);
    }
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------------
// The judges on wrong programs written here, on synthetic renders and replies.
describe('the judges, on wrong programs', () => {
  const image = (w: number, h: number, value: number): Image => ({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(value) });
  const sized = (size: [number, number], theme: string, value: number): Shot => ({ size, theme, sha256: `${size.join('x')}${theme}`, image: image(size[0] * 2, size[1] * 2, value) });
  const narrow: [number, number] = [20, 10];
  // The reference window's picture is big; the judge reads its size and every 7th pixel, so these stay small but real.
  const right = (): Shot[] => [sized(REFERENCE, 'light', 240), sized(REFERENCE, 'dark', 20), sized(narrow, 'light', 240), sized(narrow, 'dark', 20)];

  it('four renders pass; three, one size, no narrow width, one picture twice, or a dark that draws light each fail, named', () => {
    expect(fourWays(right())).toEqual([]);
    expect(fourWays(right().slice(1)).join('\n')).toMatch(/3 renders/);
    expect(fourWays(right().map((s) => ({ ...s, size: REFERENCE, image: image(REFERENCE[0] * 2, REFERENCE[1] * 2, s.theme === 'dark' ? 20 : 240) }))).join('\n')).toMatch(/not two/);
    expect(fourWays(right().map((s) => (s.size === narrow ? { ...s, size: [1600, 800] as [number, number], image: image(3200, 1600, s.theme === 'dark' ? 20 : 240) } : s))).join('\n')).toMatch(/no render at a narrow width/);
    const twice = right();
    twice[1] = { ...twice[0]!, theme: 'dark' };
    expect(fourWays(twice).join('\n')).toMatch(/same picture|isn't dark/);
    const light = right().map((s) => ({ ...s, image: image(s.image.width, s.image.height, 240) }));
    expect(fourWays(light).join('\n')).toMatch(/isn't dark/);
  });

  it('PASS beside an uncovered file, an unlisted file, or a claim of neither fail, named', () => {
    expect(coverageProblems({ claim: 'INCONCLUSIVE', not_covered: ['a.rs'] }, ['a.rs'])).toEqual([]);
    expect(coverageProblems({ claim: 'FAIL', not_covered: ['a.rs'] }, ['a.rs'])).toEqual([]);
    expect(coverageProblems({ claim: 'PASS', not_covered: ['a.rs'] }, ['a.rs']).join('\n')).toMatch(/PASS with files not covered/);
    expect(coverageProblems({ claim: 'INCONCLUSIVE', not_covered: [] }, ['a.rs']).join('\n')).toMatch(/not_covered/);
    expect(coverageProblems({ not_covered: ['a.rs'] }, ['a.rs']).join('\n')).toMatch(/UI claim is undefined/);
  });
});
