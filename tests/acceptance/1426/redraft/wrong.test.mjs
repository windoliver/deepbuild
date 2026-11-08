// #1426's redrafted judges against wrong programs, and their controls. These test the tests, not #1426, so they pass
// at the base and on any correct implementation and carry no criterion tag. Every file standing for the base's is read
// from the base commit (git show c12a65bb:<path>), never from the working tree, so the work can't move them.
// The AC2 judge runs on planted trees whose row tests are small node tests; its runner is also read on a real vitest
// test and a real cargo test. Needs git with c12a65bb, node_modules (vitest) and cargo; about a minute.
// Run: node --test tests/acceptance/1426/redraft/wrong.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { COLUMNS, DESIGN, README, TABLE_HEADING, atBase, remove, repoRoot, tempRoot, verdict } from './common.mjs';
import { childEnv, foldExact, judgeReverts, offBgra, runTest, unreport, untag } from './reverts-judge.mjs';
import { LINK, judgeDesign, judgeRefusal } from './scope-judge.mjs';

const expectOne = (failures, pattern) => assert.ok(failures.some((line) => pattern.test(line)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);
const RENDERER = 'vendor/gpui-pre-apple/src/metal_renderer.rs';
const SHADERS = 'vendor/gpui-pre-apple/src/shaders.metal';
const COLOR = 'vendor/gpui-pre/src/color.rs';

// The Scope judges ---------------------------------------------------------------------------------------------------

const baseReadme = () => atBase(README);
/** The base README with its paragraph on the pull request's state replaced by `paragraph`. */
const withParagraph = (paragraph) => baseReadme().split(/\n\s*\n/).map((part) => (part.includes('is open and ready for review') ? paragraph : part)).join('\n\n');
const REFUSAL = `Zed closed the pull request, ${LINK}, unmerged on October 28, 2026, so these patches are ours to carry.`;

test('Scope (refusal): the base README fails, with no dated paragraph and the pull request called open', () => {
  const failures = judgeRefusal(baseReadme());
  expectOne(failures, /gives the date of the refusal/);
  expectOne(failures, /still calls the pull request open: ".*The pull request is open and ready for review/);
});

for (const [twin, text, pattern] of [
  ['a refusal added beside the open sentence', () => `${baseReadme()}\n${REFUSAL}\n`, /still calls the pull request open/],
  ['the open sentence gone and no refusal', () => withParagraph('The pull request is described in PR-DESCRIPTION.md.'), /no paragraph linking/],
  ['the link and the date with no word of refusal', () => withParagraph(`Zed closed ${LINK} on October 28, 2026.`), /doesn't say zed refused/],
  ['the wrong date', () => withParagraph(`Zed refused ${LINK} on October 26, 2026.`), /gives the date of the refusal/],
  ['the date and the word apart from the link', () => withParagraph(`Zed refused it on October 28, 2026.\n\nThe pull request was ${LINK}.`), /gives the date of the refusal/],
  ['still open in other words', () => withParagraph(`${REFUSAL} The pull request still open on our fork stays as it was.`), /still calls the pull request open/],
]) {
  test(`Scope (refusal): the judge fails ${twin}`, () => expectOne(judgeRefusal(text()), pattern));
}

test('Scope (refusal): the controls pass: the refusal in place of the open paragraph, and in other words with a Markdown link', () => {
  assert.deepEqual(judgeRefusal(withParagraph(REFUSAL)), []);
  assert.deepEqual(judgeRefusal(withParagraph(`[zed-industries/zed#66114](${LINK}) was declined on 2026-10-28; zed won't take it, and it stays here.`)), []);
});

const baseDesign = () => atBase(DESIGN);
const ONLY = 'the only patch, rquickjs to that same commit, sits in';
const designWith = (text) => {
  const design = baseDesign();
  assert.ok(design.includes(ONLY), `the base design holds "${ONLY}"`);
  return design.replace(ONLY, text);
};
const NAMED = 'rquickjs is patched to that same commit in `.cargo/config.toml`, and the GPUI patches we carry, in `vendor/gpui-pre` and `vendor/gpui-pre-apple` and listed in `vendor/gpui-pre-apple/upstream/README.md`, are patched there too, so the rquickjs patch sits in';

test("Scope (design): the base design fails, calling rquickjs the only patch and naming no GPUI patch", () => {
  const failures = judgeDesign(baseDesign());
  expectOne(failures, /still calls one patch the only one/);
  expectOne(failures, /doesn't name the vendored GPUI patches/);
});

for (const [twin, text, pattern] of [
  ['"the only patch" dropped with nothing named', () => designWith('rquickjs is patched to that same commit in'), /doesn't name the vendored GPUI patches/],
  ['the GPUI patches named and "the only patch" kept', () => designWith(`${ONLY.replace(' sits in', '')} (beside the GPUI patches in \`vendor/gpui-pre\`), sits in`), /still calls one patch the only one/],
  ['"the sole patch"', () => designWith(`the sole patch, rquickjs (the GPUI ones in \`vendor/gpui-pre\` aside), sits in`), /still calls one patch the only one/],
  ['no toolkit row', () => baseDesign().split('\n').filter((line) => !line.startsWith("| The app's toolkit |")).join('\n'), /0 rows/],
]) {
  test(`Scope (design): the judge fails ${twin}`, () => expectOne(judgeDesign(text()), pattern));
}

test('Scope (design): the control passes: rquickjs not called the only patch, and the vendored GPUI patches named', () => {
  assert.deepEqual(judgeDesign(designWith(NAMED)), []);
});

// The reverts, on the base's own carried code -----------------------------------------------------------------------

test("AC2's reverts each match the base's carried code and change only their behavior's lines", () => {
  const renderer = atBase(RENDERER), shaders = atBase(SHADERS);
  const changed = (before, after) => {
    const a = before.split('\n'), b = after.split('\n');
    return b.filter((line) => !a.includes(line));
  };
  assert.deepEqual(changed(renderer, untag(renderer)).map((line) => line.trim()), ['objc2_layer.setColorspace(None);']);
  assert.deepEqual(changed(renderer, offBgra(renderer)).map((line) => line.trim()), ['if false && (CVPixelBufferGetPixelFormatType(image_buffer) == kCVPixelFormatType_32BGRA) {']);
  assert.deepEqual(changed(renderer, unreport(renderer)).map((line) => line.trim()), ['();']);
  assert.ok(!/sampled_surfaces\s*\.\s*push/.test(unreport(renderer)), 'no push is left');
  const folded = foldExact(shaders);
  assert.deepEqual(changed(shaders, folded).map((line) => line.trim()), ['if ((color_space == 1 || color_space == 2)) {', '} else if (color_space == 1002) {', 'case 1: case 2: {', 'case 1002: {']);
  assert.ok(/switch \(background\.tag\)[\s\S]*case 2: \{/.test(folded), "the background tag's own case 2, the pattern, is left alone");
});

test("AC2's reverts match nothing where the behavior isn't, so a row listing the wrong files is INCONCLUSIVE, never passed", () => {
  for (const revert of [untag, offBgra, unreport]) assert.equal(revert(atBase(COLOR)), null);
  assert.equal(foldExact(atBase('vendor/gpui-pre-apple/src/shaders.metal').replace(/color_space == 2/g, 'color_space == 9').replace(/case 2: \{\n\s*\/\/ DeepBuild/, 'case 9: {')), null);
  assert.equal(untag('layer.setColorspace(None);'), null);
});

// The AC2 judge on planted trees -------------------------------------------------------------------------------------

const TESTS = 'tests/planted/rows.test.mjs';
const NAMES = {
  srgb: 'the window layer is tagged sRGB',
  exact: 'the exact gradient mode draws exact stops',
  bgra: 'a BGRA surface composites premultiplied',
  reports: 'each frame reports the surfaces it samples',
  both: 'a BGRA surface draws and is reported',
};
/** Each planted row test, as the body of a node test; each reads the carried code of the tree it runs in. */
const BODIES = {
  srgb: `() => assert.match(read('${RENDERER}'), /\\.setColorspace\\(\\s*srgb/)`,
  exact: `() => assert.match(read('${SHADERS}'), /else if \\(color_space == 2\\)/)`,
  bgra: `() => assert.match(read('${RENDERER}'), /if CVPixelBufferGetPixelFormatType\\(image_buffer\\) == kCVPixelFormatType_32BGRA \\{/)`,
  reports: `() => assert.match(read('${RENDERER}'), /self\\s*\\.sampled_surfaces\\s*\\.push\\(/)`,
  both: `() => { const text = read('${RENDERER}'); assert.match(text, /if CVPixelBufferGetPixelFormatType/); assert.doesNotMatch(text, /if false &&/); assert.match(text, /sampled_surfaces\\s*\\.push\\(/); }`,
};
const cell = (key, name = NAMES[key], file = TESTS) => `\`${file} › ${name}\``;
const ROWS = {
  srgb: { behavior: "The sRGB layer tag on the window's CAMetalLayer", issue: '#140', files: [RENDERER, 'vendor/gpui-pre-apple/Cargo.toml'], test: cell('srgb'), budget: '—' },
  exact: { behavior: 'The exact gradient mode (OklabExact)', issue: '#391', files: [SHADERS, COLOR], test: cell('exact'), budget: '—' },
  bgra: { behavior: 'The BGRA surface, composited premultiplied', issue: '#377', files: [RENDERER, SHADERS], test: cell('bgra'), budget: '1 over: the draw branch is one block' },
  reports: { behavior: 'The surface reports of each frame', issue: '#377', files: [RENDERER], test: cell('reports'), budget: '—' },
  ledger: { behavior: 'The GPU ledger', issue: '#391', files: [RENDERER], test: cell('srgb'), budget: '—' },
};
const tableText = (rows) => [
  '# The GPUI patches we carry', '', 'Planted prose.', '', TABLE_HEADING, '', `| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`,
  ...rows.map((row) => `| ${row.behavior} | ${row.issue} | ${row.files.map((file) => `\`${file}\``).join(', ')} | ${row.test} | ${row.budget} |`), '',
].join('\n');

/** A planted tree: the base's carried files, a table of `rows` and the row tests of `bodies`. */
function plant({ rows = Object.values(ROWS), bodies = {}, readme } = {}) {
  const root = tempRoot('plant');
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const path of [RENDERER, SHADERS, COLOR]) put(path, atBase(path));
  put(README, readme ?? tableText(rows));
  const all = { ...BODIES, ...bodies };
  put(TESTS, [
    "import assert from 'node:assert/strict';", "import { readFileSync } from 'node:fs';", "import { test } from 'node:test';",
    "const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');",
    ...Object.entries(all).map(([key, body]) => `test(${JSON.stringify(NAMES[key])}, ${body});`), '',
  ].join('\n'));
  return root;
}
const anyMachine = () => null;
const judgePlant = async (options) => {
  const root = plant(options);
  try { return await judgeReverts(root, { machine: anyMachine, timeout: 120_000 }); } finally { remove(root); }
};
const snapshot = (root) => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
  return Object.fromEntries(walk(root).map((file) => [relative(root, file), readFileSync(file, 'utf8')]));
};

test('AC2 control: a tree whose four row tests each pass and fail with their revert passes, and the judge leaves the tree as it was', async () => {
  const root = plant();
  try {
    const before = snapshot(root);
    const ran = [];
    assert.deepEqual(await judgeReverts(root, { machine: anyMachine, timeout: 120_000, log: (line) => ran.push(line) }), []);
    assert.deepEqual(snapshot(root), before, 'the judge wrote nothing in the tree it judged');
    for (const key of ['srgb', 'exact', 'bgra', 'reports']) assert.ok(ran.some((line) => line.includes(NAMES[key]) && line.endsWith(': fail')), `${NAMES[key]} ran reverted and failed:\n${ran.join('\n')}`);
  } finally {
    remove(root);
  }
});

test('AC2 control: one row for the BGRA surface and its reports passes when its test fails under both reverts', async () => {
  const both = { behavior: 'The BGRA surface and its per-frame surface reports', issue: '#377', files: [RENDERER, SHADERS], test: cell('both'), budget: '—' };
  assert.deepEqual(await judgePlant({ rows: [ROWS.srgb, ROWS.exact, both] }), []);
});

for (const [program, options, pattern] of [
  ['a row test that reads nothing', { bodies: { bgra: '() => {}' } }, /^the row "The BGRA surface, composited premultiplied" \(the BGRA surface\): its test .* still passes with the BGRA surface reverted/],
  ['a row test that fails with the change in place', { bodies: { srgb: "() => assert.fail('broken as it stands')" } }, /^the row "The sRGB layer tag.*doesn't pass as the tree stands \(fail\)/],
  ['a row whose test name runs nothing', { rows: [ROWS.srgb, { ...ROWS.exact, test: cell('exact', 'no such test') }, ROWS.bgra, ROWS.reports] }, /^the row "The exact gradient mode \(OklabExact\)".*doesn't pass as the tree stands \(none\).*ran no test named "no such test"/],
  ['a row with no test', { rows: [ROWS.srgb, ROWS.exact, ROWS.bgra, { ...ROWS.reports, test: '—' }] }, /^the row "The surface reports of each frame" \(the surface reports\) names no test/],
  ['a row naming a test file that is gone', { rows: [ROWS.srgb, ROWS.exact, { ...ROWS.bgra, test: cell('bgra', NAMES.bgra, 'tests/planted/gone.test.mjs') }, ROWS.reports] }, /names a test file that isn't there: tests\/planted\/gone\.test\.mjs/],
  ['no carried-patch table (the base README)', { readme: undefined, rows: null }, /has no carried-patch table/],
  ['no row for the exact gradient mode', { rows: [ROWS.srgb, ROWS.bgra, ROWS.reports] }, /^no row of the carried-patch table is the exact gradient mode/],
]) {
  test(`AC2: the judge fails ${program}, naming it`, async () => {
    const lines = await judgePlant(options.rows === null ? { readme: atBase(README) } : options);
    expectOne(lines.filter((line) => !/^INCONCLUSIVE\b/.test(line)), pattern);
    assert.throws(() => verdict(lines), /^Error: FAIL/);
  });
}

for (const [program, options, pattern] of [
  ['a row whose files hold none of its behavior', { rows: [{ ...ROWS.srgb, files: [COLOR] }, ROWS.exact, ROWS.bgra, ROWS.reports] }, /^INCONCLUSIVE: the revert of the sRGB layer tag .* matches nothing in the \.rs files the row "The sRGB layer tag/],
  ['a row test that says it is INCONCLUSIVE', { bodies: { reports: "() => { throw new Error('INCONCLUSIVE: no display here'); }" } }, /^INCONCLUSIVE: the row "The surface reports of each frame".*can't run here as the tree stands: .*no display here/],
  ['a row test that is skipped', { bodies: { exact: "{ skip: 'no Metal device' }, () => {}" } }, /^INCONCLUSIVE: the row "The exact gradient mode.*skipped: .*no Metal device/],
  ['a revert under which the build fails', { bodies: { bgra: `() => { if (/if false &&/.test(read('${RENDERER}'))) throw new Error('cargo build failed:\\nerror[E0425]: cannot find value\\nerror: could not compile \`gpui-pre-apple\`'); }` } }, /^INCONCLUSIVE: the row "The BGRA surface.*doesn't build, so its test's failure proves nothing/],
]) {
  test(`AC2: the judge reads ${program} as INCONCLUSIVE, never a pass`, async () => {
    const lines = await judgePlant(options);
    expectOne(lines, pattern);
    assert.ok(lines.length > 0);
  });
}

test('AC2: a machine that lacks what the runs need is INCONCLUSIVE, naming it, once the table is read', async () => {
  const root = plant();
  try {
    assert.deepEqual(await judgeReverts(root, { machine: () => 'no Metal here' }), ['INCONCLUSIVE: no Metal here']);
  } finally {
    remove(root);
  }
});

test('AC2: the verdict fails on any FAIL line, fails as INCONCLUSIVE on INCONCLUSIVE lines alone, and passes on none', () => {
  assert.throws(() => verdict(['a FAIL line', 'INCONCLUSIVE: a missing thing']), /^Error: FAIL:\na FAIL line\nINCONCLUSIVE: a missing thing$/);
  assert.throws(() => verdict(['INCONCLUSIVE: a missing thing']), /^Error: INCONCLUSIVE:\n/);
  assert.doesNotThrow(() => verdict([]));
});

// The runner, on a real vitest test and a real cargo test --------------------------------------------------------------

test("AC2's runner reads a real vitest test: pass, fail, INCONCLUSIVE and a name that runs nothing", async () => {
  const modules = join(repoRoot, 'node_modules');
  if (!existsSync(join(modules, 'vitest', 'vitest.mjs'))) throw new Error('INCONCLUSIVE: no node_modules/vitest here: run npm ci');
  const root = tempRoot('vitest');
  try {
    symlinkSync(modules, join(root, 'node_modules'));
    writeFileSync(join(root, 'sum.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('sums', () => {",
      "  it('adds', () => expect(1 + 1).toBe(2));",
      "  it('subtracts wrong', () => expect(1 - 1).toBe(1));",
      "  it('needs a display', () => { throw new Error('INCONCLUSIVE: no display here'); });",
      '});', '',
    ].join('\n'));
    const states = {};
    for (const name of ['adds', 'sums › adds', 'subtracts wrong', 'needs a display', 'divides']) states[name] = (await runTest(root, { path: 'sum.test.ts', name }, { timeout: 300_000 })).state;
    assert.deepEqual(states, { adds: 'pass', 'sums › adds': 'pass', 'subtracts wrong': 'fail', 'needs a display': 'inconclusive', divides: 'none' });
  } finally {
    remove(root);
  }
});

test("AC2's runner reads a real cargo test: pass, fail, a name that runs nothing, and a crate that doesn't build", async () => {
  if (spawnSync('cargo', ['--version'], { env: childEnv() }).status !== 0) throw new Error('INCONCLUSIVE: no cargo on PATH');
  const root = tempRoot('cargo');
  try {
    copyFileSync(join(repoRoot, 'rust-toolchain.toml'), join(root, 'rust-toolchain.toml'));
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "planted-1426"\nversion = "0.0.0"\nedition = "2021"\n\n[workspace]\n');
    mkdirSync(join(root, 'src'));
    const lib = (extra = '') => `#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(1 + 1, 2); }\n    #[test]\n    fn subtracts_wrong() { assert_eq!(1 - 1, 1); }\n}\n${extra}`;
    writeFileSync(join(root, 'src', 'lib.rs'), lib());
    const lock = spawnSync('cargo', ['generate-lockfile', '--offline'], { cwd: root, encoding: 'utf8', env: childEnv() });
    assert.equal(lock.status, 0, `cargo generate-lockfile: ${lock.stderr}`);
    const state = async (name) => (await runTest(root, { path: 'src/lib.rs', name }, { timeout: 600_000 })).state;
    assert.deepEqual({ adds: await state('adds'), full: await state('tests::adds'), wrong: await state('subtracts_wrong'), none: await state('divides') }, { adds: 'pass', full: 'pass', wrong: 'fail', none: 'none' });
    writeFileSync(join(root, 'src', 'lib.rs'), lib('pub fn broken() -> u8 { "not a number" }\n'));
    assert.equal(await state('adds'), 'build');
  } finally {
    remove(root);
  }
});
