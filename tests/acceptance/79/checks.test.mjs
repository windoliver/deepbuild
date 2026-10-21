// The #79 checks' own tests: each check holds on the kit as it stands and fails on a planted wrong
// file or record. They test the tests, so they pass at the base commit.
// Run: node --test tests/acceptance/79/checks.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ASSET_LIMIT, INK, PAPER, SIGNAL, WHITE, bannerProblems, budgetRecordProblems, cut, decodePng, git, icnsEntries, icoEntries, privacyProblems, root, searchProblems,
  sha256, signalPixels, svgCut, svgSignal,
} from './helpers.mjs';

const brand = (path) => readFileSync(join(root, 'brand', path));
const png = (path) => decodePng(brand(path));

// Composites an image over an opaque ground.
function over(image, [r, g, b]) {
  const pixels = new Uint8Array(image.pixels.length);
  for (let i = 0; i < pixels.length; i += 4) {
    const a = image.pixels[i + 3] / 255;
    pixels[i] = Math.round(image.pixels[i] * a + r * (1 - a));
    pixels[i + 1] = Math.round(image.pixels[i + 1] * a + g * (1 - a));
    pixels[i + 2] = Math.round(image.pixels[i + 2] * a + b * (1 - a));
    pixels[i + 3] = 255;
  }
  return { ...image, pixels };
}

// A box downsample: the regular cut rendered small, which a wrong icon set would hold at 16 px.
function down(image, size) {
  const factor = image.width / size, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      let n = 0;
      for (let sy = y * factor; sy < (y + 1) * factor; sy++) for (let sx = x * factor; sx < (x + 1) * factor; sx++) { const i = (sy * image.width + sx) * 4; for (let c = 0; c < 4; c++) sum[c] += image.pixels[i + c]; n++; }
      for (let c = 0; c < 4; c++) pixels[(y * size + x) * 4 + c] = Math.round(sum[c] / n);
    }
  }
  return { width: size, height: size, pixels };
}

test('cut: the kit\'s 16 and 32 px rasters measure as the small cut, every larger one as the regular cut', () => {
  for (const file of ['DeepBuild.iconset/icon_16x16.png', 'DeepBuild.iconset/icon_16x16@2x.png', 'DeepBuild.iconset/icon_32x32.png', 'png/favicon-16.png', 'png/favicon-32.png', 'png/trayTemplate.png', 'png/trayTemplate@2x.png']) assert.equal(cut(png(file)).cut, 'small', file);
  for (const file of ['DeepBuild.iconset/icon_32x32@2x.png', 'DeepBuild.iconset/icon_128x128.png', 'DeepBuild.iconset/icon_512x512.png', 'png/apple-touch-icon.png', 'png/icon-192.png', 'png/symbol-ink-512.png', 'png/symbol-color-dark-512.png']) assert.equal(cut(png(file)).cut, 'regular', file);
});

test('cut: the regular cut rendered at 16, 24 and 32 px is caught, and a lockup is not judged as a symbol', () => {
  const big = png('DeepBuild.iconset/icon_512x512.png');
  for (const size of [16, 32, 64]) assert.equal(cut(down(big, size)).cut, 'regular', `regular at ${size} px`);
  assert.equal(cut(png('png/lockup-horizontal-color-dark-1200.png')).cut, 'not a symbol');
});

test('cut: the .icns 16 pt entries (ic04 and ic11) and the .ico 16 px entry are the small cut; the 128 px entry is not', () => {
  const icns = icnsEntries(brand('DeepBuild.icns'));
  const byType = Object.fromEntries(icns.map((entry) => [entry.type, entry]));
  assert.equal(cut(byType.ic04.image).cut, 'small');
  assert.equal(cut(byType.ic11.image).cut, 'small');
  assert.equal(cut(byType.ic07.image).cut, 'regular');
  const ico = icoEntries(brand('png/favicon.ico'));
  assert.deepEqual(ico.map((entry) => entry.px), [16, 32, 48]);
  assert.equal(cut(ico[0].image).cut, 'small');
});

test('svgCut: the small masters read as small, the full masters as regular, a wordmark as neither', () => {
  for (const file of ['symbol-small-ink.svg', 'symbol-small-color-dark.svg', 'app-icon-small.svg', 'favicon.svg', 'menubar-template.svg']) assert.equal(svgCut(brand(file).toString()), 'small', file);
  for (const file of ['symbol-ink.svg', 'symbol-color-dark.svg', 'app-icon.svg', 'readme-light.svg', 'lockup-stacked-ink.svg']) assert.equal(svgCut(brand(file).toString()), 'regular', file);
  assert.equal(svgCut(brand('wordmark-ink.svg').toString()), 'none');
});

test('signalPixels: the Ink tiles keep Signal off white and off transparent; colour artwork over white or paper is caught, over Ink it is not', () => {
  for (const file of ['DeepBuild.iconset/icon_512x512.png', 'DeepBuild.iconset/icon_16x16@2x.png', 'png/favicon-32.png', 'png/apple-touch-icon.png']) {
    const found = signalPixels(png(file));
    assert.ok(found.count > 0, `${file} has Signal pixels to judge`);
    assert.deepEqual([found.onLight, found.onUnknown], [[], []], file);
  }
  const symbol = png('png/symbol-color-dark-512.png');
  assert.ok(signalPixels(over(symbol, WHITE), { groundKnownDark: true }).onLight.length > 0, 'the colour symbol over white');
  assert.ok(signalPixels(over(symbol, PAPER), { groundKnownDark: true }).onLight.length > 0, 'the colour symbol over paper');
  assert.deepEqual(signalPixels(over(symbol, INK), { groundKnownDark: true }).onLight, [], 'the colour symbol over Ink');
  assert.ok(signalPixels(symbol).onUnknown.length > 0, 'the colour symbol on transparent, ground unknown');
  assert.deepEqual(signalPixels(symbol, { groundKnownDark: true }).onUnknown, [], 'the colour symbol on transparent, ground known dark');
  assert.ok(signalPixels(over(png('png/lockup-horizontal-color-dark-1200.png'), WHITE), { groundKnownDark: true }).onLight.length > 0, 'the colour lockup over white');
  const yellowOnWhite = { width: 8, height: 8, pixels: new Uint8Array(8 * 8 * 4).fill(255) };
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) yellowOnWhite.pixels.set([...SIGNAL, 255], (y * 8 + x) * 4);
  assert.ok(signalPixels(yellowOnWhite, { groundKnownDark: true }).onLight.length > 0, 'a Signal square on white');
});

test('svgSignal: the light header has no Signal, the favicon brings its Ink tile, the colour symbol brings none', () => {
  assert.deepEqual(svgSignal(brand('readme-light.svg').toString()), { hasSignal: false, firstPaintDark: true });
  assert.deepEqual(svgSignal(brand('favicon.svg').toString()), { hasSignal: true, firstPaintDark: true });
  assert.deepEqual(svgSignal(brand('symbol-color-dark.svg').toString()), { hasSignal: true, firstPaintDark: false });
  assert.equal(svgSignal(brand('readme-light.svg').toString().replace('#151619', '#F2C440')).hasSignal, true, 'a planted Signal fill');
});

const goodSearch = () => ({
  mark: 'DeepBuild',
  searchedOn: '2026-10-20',
  searchedBy: 'a trademark search service',
  registers: [{ register: 'USPTO', queriedOn: '2026-10-20', terms: ['DEEPBUILD', 'DEEP BUILD'], classes: [9, 42], hits: [{ mark: 'DEEPBUILD', status: 'dead', similarity: 'identical', classes: [9], note: 'abandoned 2019' }] }],
  conclusion: { status: 'clear', reason: 'The one identical hit is dead; no live similar mark in classes 9 or 42.' },
});
const goodReadme = 'See `trademark-search.json` for the search.';

test('searchProblems: a complete record with the README updated holds; a blocked conclusion, no registers, a missing class, a future date or the old README line each fail', () => {
  assert.deepEqual(searchProblems(goodSearch(), goodReadme), []);
  assert.ok(searchProblems({ ...goodSearch(), conclusion: { status: 'blocked', reason: 'A live identical mark in class 9 held by another company.' } }, goodReadme).length > 0, 'blocked');
  assert.ok(searchProblems({ ...goodSearch(), registers: [] }, goodReadme).length > 0, 'no registers');
  const noClass = goodSearch(); noClass.registers[0].classes = [9];
  assert.ok(searchProblems(noClass, goodReadme).length > 0, 'class 42 missing');
  assert.ok(searchProblems({ ...goodSearch(), searchedOn: '2099-01-01' }, goodReadme).length > 0, 'future date');
  assert.ok(searchProblems({ ...goodSearch(), conclusion: { status: 'proceed-with-risk', reason: 'A similar live mark in class 42, different field.' } }, goodReadme).length > 0, 'risk with nobody deciding');
  assert.ok(searchProblems(goodSearch(), `${goodReadme}\nNo trademark search has been done; get a professional one before launch.`).length > 0, 'the old README line');
  assert.ok(searchProblems(goodSearch(), 'No pointer to the record.').length > 0, 'the README not pointing at the record');
});

const manifestWith = (app) => ({
  issue: 79,
  surfaces: [
    { surface: 'app-icon', kit: 'brand/DeepBuild.icns', use: 'brand/DeepBuild.icns', shots: ['docs/evidence/79/dock.png'] },
    { surface: 'menu-bar', kit: 'brand/png/trayTemplate.png', use: 'brand/png/trayTemplate.png', px: 16, shots: ['docs/evidence/79/menu-bar.png'] },
  ],
  app,
});

test('budgetRecordProblems: growth under 200 KB on a reference Mac holds; 200 KB, another Mac, or a merge base outside history fail', () => {
  const mergeBase = git(root, 'rev-parse', 'HEAD').stdout.trim();
  const icns = brand('DeepBuild.icns').length, tray = brand('png/trayTemplate.png').length;
  const app = (growth, model = 'Mac15,12') => ({ mergeBase, machine: { model, macosBuild: '23H723' }, measuredOn: '2026-10-20', strippedBytes: { base: 50_000_000, head: 50_000_000 + growth } });
  assert.deepEqual(budgetRecordProblems(manifestWith(app(icns + tray))), []);
  assert.ok(budgetRecordProblems(manifestWith(app(ASSET_LIMIT))).some((problem) => /grew 200000 bytes/.test(problem)), 'exactly 200 KB is not under');
  assert.ok(budgetRecordProblems(manifestWith(app(icns + tray, 'Mac14,2'))).some((problem) => /INCONCLUSIVE/.test(problem)), 'another Mac');
  assert.ok(budgetRecordProblems(manifestWith({ ...app(icns + tray), mergeBase: 'f'.repeat(40) })).some((problem) => /not an ancestor/.test(problem)), 'a merge base outside history');
  assert.ok(budgetRecordProblems(manifestWith(app(100))).some((problem) => /disagree/.test(problem)), 'a growth far under what the manifest embeds');
  assert.ok(budgetRecordProblems(manifestWith(undefined)).some((problem) => /no app record/.test(problem)), 'no record');
});

test('bannerProblems: a kit image once on the first line under iTerm2 holds; another file, a second image, an image on a later line or escapes in a pipe fail', () => {
  const kit = brand('png/trayTemplate@2x.png');
  const manifest = { issue: 79, surfaces: [{ surface: 'cli-banner', kit: 'brand/png/trayTemplate@2x.png', use: 'brand/png/trayTemplate@2x.png', px: 16, scale: 2, shots: ['docs/evidence/79/cli.png'] }] };
  const banner = (image) => `\x1b]1337;File=inline=1;height=1:${image.toString('base64')}\x07 DeepBuild`;
  const run = (first, images, rest = 'Usage: deep [--help | --version]') => ({ status: 0, output: `${first}\r\n${rest}\r\n`, lines: [first, rest, ''], images, text: `${first.replace(/\x1b\][^\x07]*\x07/g, '')}\n${rest}\n` });
  const iterm2 = run(banner(kit), [{ protocol: 'iterm2', args: '', bytes: kit }]);
  const plain = run('DeepBuild', []);
  const piped = { status: 0, stdout: 'Usage: deep [--help | --version]\n' };
  assert.deepEqual(bannerProblems(manifest, { iterm2, kitty: plain, plain, piped }), []);
  const other = Buffer.concat([kit, Buffer.from([0])]);
  assert.ok(bannerProblems(manifest, { iterm2: run(banner(other), [{ protocol: 'iterm2', args: '', bytes: other }]), kitty: plain, plain, piped }).some((problem) => /not byte for byte/.test(problem)), 'another file');
  assert.ok(bannerProblems(manifest, { iterm2: plain, kitty: plain, plain, piped }).some((problem) => /no inline image/.test(problem)), 'no image anywhere');
  assert.ok(bannerProblems(manifest, { iterm2: run('DeepBuild', [{ protocol: 'iterm2', args: '', bytes: kit }], banner(kit)), kitty: plain, plain, piped }).some((problem) => /line 2/.test(problem)), 'the mark on line 2');
  assert.ok(bannerProblems(manifest, { iterm2, kitty: plain, plain, piped: { status: 0, stdout: `${banner(kit)}\nUsage: deep\n` } }).some((problem) => /piped/.test(problem)), 'escapes in a pipe');
  assert.ok(bannerProblems(manifest, { iterm2, kitty: plain, plain: iterm2, piped }).some((problem) => /plain/.test(problem)), 'an image for a terminal that can\'t show one');
  assert.equal(sha256(kit), sha256(brand('png/trayTemplate@2x.png')));
});

// Writes planted records into a scratch folder and runs the privacy rule on them, so nothing personal is
// kept in this repo: the one real value used, this machine's HOME, is read at run time and never stored.
const planted = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'acceptance-79-privacy-'));
  for (const [name, record] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(record, null, 2));
  return privacyProblems(dir, Object.keys(files));
};
const legitManifest = {
  issue: 79,
  surfaces: [
    { surface: 'menu-bar', kit: 'brand/png/trayTemplate@2x.png', use: 'brand/png/trayTemplate@2x.png', px: 16, scale: 2, shots: ['docs/evidence/79/menu-bar.png'] },
    { surface: 'docs-favicon', kit: 'brand/png/favicon.ico', use: 'docs/web/favicon.ico', shots: ['docs/evidence/79/favicon.png'] },
    { surface: 'docs-web-icon', kit: 'brand/png/icon-512.png', use: 'docs/web/icon-512.png', px: 512, shots: ['docs/evidence/79/web-icon.png'] },
  ],
  app: { mergeBase: '0'.repeat(40), machine: { model: 'Mac15,12', macosBuild: '23H723' }, measuredOn: '2026-10-20', strippedBytes: { base: 1, head: 2 } },
};
const legitSearch = {
  mark: 'DeepBuild', searchedOn: '2026-10-20', searchedBy: 'the maintainers, through the offices\' own search tools (brand@example.org)',
  registers: [
    { register: 'USPTO', database: 'Trademark Search, https://tmsearch.uspto.gov/search/home/', queriedOn: '2026-10-20', terms: ['DEEPBUILD'], classes: [9, 42], hits: [{ mark: 'DEEPBUILD', owner: 'Deep Build Homes LLC', status: 'dead', similarity: 'identical', classes: [37], note: 'home building services; abandoned 2019' }] },
    { register: 'EUIPO', database: 'eSearch plus, https://euipo.europa.eu/eSearch/#basic/deepbuild', queriedOn: '2026-10-20', terms: ['DEEP BUILD'], classes: [9, 42], hits: [] },
    { register: 'WIPO', database: 'Global Brand Database (branddb.wipo.int), export saved under ~/Downloads', queriedOn: '2026-10-20', terms: ['DEEPBUILD'], classes: [9, 42], hits: [] },
  ],
  conclusion: { status: 'clear', reason: 'The one identical hit is dead and in class 37; no live similar mark in classes 9 or 42.', contact: 'legal@mail.example.com' },
};

test('privacyProblems: the kit\'s @2x rasters, a register\'s URL with a home segment, a ~ path and example.* addresses hold; a home path on any OS or a personal address, however written, is named with its person cut short', () => {
  assert.deepEqual(planted({ 'surfaces.json': legitManifest, 'trademark-search.json': legitSearch }), []);
  const withShot = (shot) => ({ ...legitManifest, surfaces: [{ ...legitManifest.surfaces[0], shots: [shot] }] });
  for (const shot of ['/Users/sophia/deepbuild/docs/evidence/79/menu-bar.png', '/home/sophia/deepbuild/docs/evidence/79/menu-bar.png', 'C:\\Users\\sophia\\deepbuild\\menu-bar.png', 'file:///Users/sophia/menu-bar.png']) {
    const problems = planted({ 'surfaces.json': withShot(shot) });
    assert.ok(problems.some((problem) => /holds a home path/.test(problem)), shot);
    assert.ok(problems.every((problem) => !problem.includes('sophia')), `the person is cut short: ${problems.join('; ')}`);
  }
  if (process.env.HOME) assert.ok(planted({ 'surfaces.json': withShot(`${process.env.HOME}/menu-bar.png`) }).some((problem) => /home/.test(problem)), 'this machine\'s home folder');
  const withSearcher = (searchedBy) => ({ ...legitSearch, searchedBy });
  for (const searcher of ['sophia.w@gmail.com', 'Sophia <sophia@corp.co.uk>', 'mailto:sophia@fastmail.fm', 'sophia@example.com.evil.net', 'sophia@examples.com', 'sophia+brand@proton.me.']) {
    const problems = planted({ 'trademark-search.json': withSearcher(searcher) });
    assert.ok(problems.some((problem) => /holds an email address: s…@/.test(problem)), `${searcher}: ${problems.join('; ')}`);
    assert.ok(problems.every((problem) => !problem.includes('sophia')), `the local part is cut short: ${problems.join('; ')}`);
  }
  assert.deepEqual(planted({ 'trademark-search.json': withSearcher('a search service; questions to brand@sub.example.net') }), [], 'an address under a subdomain of example.*');
  assert.deepEqual(planted({ 'surfaces.json': { ...legitManifest, note: 'the menu bar takes trayTemplate@2x.png and trayTemplate@3x.png' } }), [], 'bare raster names with a scale suffix');
});
