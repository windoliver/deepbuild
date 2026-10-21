// Fast acceptance tests for issue #79: the DeepBuild mark across the app, CLI, docs and site. They
// read the surfaces manifest (brand/surfaces.json), the kit files it names, the README's <picture>,
// the docs head fragment, the screenshots, the trademark search record and the budget record, and
// they run `deep --help` in a pty. Nothing builds the app; tests/acceptance/79/mark.live.test.mjs does.
// Run: node --test tests/acceptance/79/mark.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  BRAND_README, BUDGET, HASH, SEARCH, SMALL, TERMINALS, TRADEMARK, bannerProblems, budgetRecordProblems, cliHelp, cutProblems, docsIcons, docsProblems,
  kitProblems, loadJson, loadManifest, manifestProblems, pipedHelp, privacyProblems, readmeProblems, root, searchProblems, shotProblems, signalProblems,
} from './helpers.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);

test(`${HASH} every surface the issue names has an entry whose file is, byte for byte, a kit file under brand/`, () => {
  holds(manifestProblems(loadManifest()));
});

test(`${HASH} the README header's light image and dark source are the kit's readme files`, () => {
  holds(readmeProblems(loadManifest()));
});

test(`${HASH} the docs head fragment and web manifest reference only kit files, each declared with its real sizes`, () => {
  holds(docsIcons().problems);
  holds(docsProblems(loadManifest()));
});

test(`${HASH} deep --help prints a one-line banner, and where the terminal can show an image the mark in it is a kit file`, () => {
  const runs = { iterm2: cliHelp(TERMINALS.iterm2), kitty: cliHelp(TERMINALS.kitty), plain: cliHelp(TERMINALS.plain), piped: pipedHelp() };
  assert.ok(runs.iterm2.images.length + runs.kitty.images.length > 0, `deep --help in a pty prints no inline image under iTerm2 (TERM_PROGRAM=iTerm.app) nor kitty (TERM=xterm-kitty); the terminal can show the mark and the banner doesn't\niTerm2 output: ${JSON.stringify(runs.iterm2.output.slice(0, 200))}`);
  holds(bannerProblems(loadManifest(), runs));
});

test(`${SMALL} every use at 24 px and below takes the small cut: the menu bar, the CLI banner, the tab icon, and the 16 pt entries of the .icns and .ico`, () => {
  holds(cutProblems(loadManifest()));
});

test(`${SMALL} nothing puts Signal on white or paper: the surfaces' files bring an Ink ground or carry no Signal, and the kit's light-ground artwork has none`, () => {
  holds(kitProblems());
  holds(signalProblems(loadManifest()));
});

test(`${SMALL} proof: a screenshot of each surface, cropped and small, with no Signal next to white or paper in it`, () => {
  holds(shotProblems(loadManifest()));
});

test(`${TRADEMARK} a trademark search record names the registers, terms, classes and hits behind a conclusion that lets the mark out, and brand/README.md no longer says none was done`, () => {
  const record = loadJson(root, SEARCH, 'trademark search record');
  const readme = existsSync(join(root, BRAND_README)) ? readFileSync(join(root, BRAND_README), 'utf8') : '';
  holds(searchProblems(record, readme));
  holds(privacyProblems());
});

test(`${BUDGET} the mark's assets add under 200 KB to the app: the embedded kit files' sizes, and the stripped app's recorded growth over the merge base on a reference Mac`, () => {
  holds(budgetRecordProblems(loadManifest()));
  holds(privacyProblems());
});
